import {
  DEFAULT_PROVIDER_REGISTRY,
} from './core/provider-fabric.js';
import {
  createProviderRuntimeState,
} from './core/provider-runtime.js';
import {
  createFuryKernelModelBridge,
  type FuryKernelModelBridge,
  type FuryKernelModelMemoryRuntime,
  type FuryKernelModelRoute,
} from './fury-kernel-model-bridge.js';
import type { FuryKernelConversationStore } from './fury-kernel.js';
import {
  createProviderTransportRegistry,
  type ProviderTransport,
} from './provider-transport.js';
import {
  createAnthropicProviderTransport,
  createGoogleProviderTransport,
  createOpenAIProviderTransport,
} from './provider-transports/index.js';

export const FURY_GATEWAY_LOCAL_MODEL_CONFIG_FORMAT =
  'furypipe-gateway-local-model-config/v1' as const;

export interface FuryGatewayLocalModelConfigDisabled {
  readonly format: typeof FURY_GATEWAY_LOCAL_MODEL_CONFIG_FORMAT;
  readonly enabled: false;
}

export interface FuryGatewayLocalModelConfigEnabled {
  readonly format: typeof FURY_GATEWAY_LOCAL_MODEL_CONFIG_FORMAT;
  readonly enabled: true;
  readonly providerId: 'openai' | 'anthropic' | 'google';
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly credentialSource:
    | 'OPENAI_API_KEY'
    | 'ANTHROPIC_API_KEY'
    | 'GOOGLE_API_KEY';
}

export type FuryGatewayLocalModelConfig =
  | FuryGatewayLocalModelConfigDisabled
  | FuryGatewayLocalModelConfigEnabled;

export interface FuryGatewayLocalModelRuntime {
  readonly config: FuryGatewayLocalModelConfig;
  readonly bridge?: FuryKernelModelBridge;
}

export interface FuryGatewayLocalModelRuntimeOptions {
  readonly kernel: FuryKernelConversationStore;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
  readonly fetchImpl?: typeof fetch;
  /** Optional process-local memory authority supplied by the Gateway host. */
  readonly memory?: FuryKernelModelMemoryRuntime;
}

const MODEL_RE = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_OUTPUT_TOKENS = 65_536;
const HEALTH_TTL_MS = 10 * 60_000;
const PROVIDER_PERMIT_TTL_MS = 30_000;

function exactEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value === '' ? undefined : value;
}

function maxOutputTokens(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const raw = exactEnv(env, 'FURYPIPE_WEBCHAT_MAX_OUTPUT_TOKENS');
  if (raw === undefined) return DEFAULT_MAX_OUTPUT_TOKENS;
  if (!/^\d+$/u.test(raw)) {
    throw new Error('FURYPIPE_WEBCHAT_MAX_OUTPUT_TOKENS must be a positive integer');
  }
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_OUTPUT_TOKENS
  ) {
    throw new Error(
      `FURYPIPE_WEBCHAT_MAX_OUTPUT_TOKENS must be between 1 and ${MAX_OUTPUT_TOKENS}`,
    );
  }
  return value;
}

function credentialSpec(providerId: FuryGatewayLocalModelConfigEnabled['providerId']): {
  readonly envName: FuryGatewayLocalModelConfigEnabled['credentialSource'];
} {
  if (providerId === 'openai') return { envName: 'OPENAI_API_KEY' };
  if (providerId === 'anthropic') return { envName: 'ANTHROPIC_API_KEY' };
  return { envName: 'GOOGLE_API_KEY' };
}

function resolveConfig(
  env: Readonly<Record<string, string | undefined>>,
): FuryGatewayLocalModelConfig {
  const provider = exactEnv(env, 'FURYPIPE_WEBCHAT_PROVIDER');
  const model = exactEnv(env, 'FURYPIPE_WEBCHAT_MODEL');

  if (provider === undefined && model === undefined) {
    return Object.freeze({
      format: FURY_GATEWAY_LOCAL_MODEL_CONFIG_FORMAT,
      enabled: false as const,
    });
  }
  if (
    provider !== 'openai'
    && provider !== 'anthropic'
    && provider !== 'google'
  ) {
    throw new Error(
      'FURYPIPE_WEBCHAT_PROVIDER must be openai, anthropic, or google',
    );
  }
  if (
    model === undefined
    || !MODEL_RE.test(model)
    || model.trim() !== model
  ) {
    throw new Error(
      'FURYPIPE_WEBCHAT_MODEL must be a bounded exact model identifier',
    );
  }

  const spec = credentialSpec(provider);
  const credential = exactEnv(env, spec.envName);
  if (credential === undefined) {
    throw new Error(
      `${spec.envName} is required when FURYPIPE_WEBCHAT_PROVIDER=${provider}`,
    );
  }
  if (
    credential.length > 8192
    || /[\u0000-\u001f\u007f]/u.test(credential)
  ) {
    throw new Error(`${spec.envName} is invalid`);
  }

  return Object.freeze({
    format: FURY_GATEWAY_LOCAL_MODEL_CONFIG_FORMAT,
    enabled: true as const,
    providerId: provider,
    model,
    maxOutputTokens: maxOutputTokens(env),
    credentialSource: spec.envName,
  });
}

function createTransport(
  config: FuryGatewayLocalModelConfigEnabled,
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: typeof fetch | undefined,
): ProviderTransport {
  const runtime = {
    getCredential: () => {
      const credential = exactEnv(env, config.credentialSource);
      if (credential === undefined) {
        throw new Error('configured WebChat provider credential is unavailable');
      }
      return credential;
    },
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    maxOutputTokens: config.maxOutputTokens,
  };

  if (config.providerId === 'openai') {
    return createOpenAIProviderTransport(runtime);
  }
  if (config.providerId === 'anthropic') {
    return createAnthropicProviderTransport(runtime);
  }
  return createGoogleProviderTransport(runtime);
}

export function createFuryGatewayLocalModelRuntime(
  options: FuryGatewayLocalModelRuntimeOptions,
): FuryGatewayLocalModelRuntime {
  if (!options || typeof options !== 'object' || !options.kernel) {
    throw new Error('local Gateway model runtime requires a Fury Kernel store');
  }
  const env = options.env ?? process.env;
  const config = resolveConfig(env);
  if (!config.enabled) return Object.freeze({ config });

  const now = options.now ?? Date.now;
  const observedAt = now();
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    throw new Error('local Gateway model runtime clock is invalid');
  }

  const providerRuntime = createProviderRuntimeState(DEFAULT_PROVIDER_REGISTRY);
  const observeConfiguredHealth = (): void => {
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new Error('local Gateway model runtime clock is invalid');
    }
    const expiresAt = at + HEALTH_TTL_MS;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new Error('local Gateway model runtime health expiry is invalid');
    }
    providerRuntime.observeHealth({
      providerId: config.providerId,
      availability: 'available',
      observedAt: at,
      expiresAt,
      source: 'local-webchat-operator-config',
      evidenceKind: 'operator-config',
    });
  };
  observeConfiguredHealth();

  const route: FuryKernelModelRoute = Object.freeze({
    providerId: config.providerId,
    model: config.model,
    allowProviderRequest: true,
    permitTtlMs: PROVIDER_PERMIT_TTL_MS,
  });

  const governedBridge = createFuryKernelModelBridge({
    kernel: options.kernel,
    providerRuntime,
    transports: createProviderTransportRegistry([
      createTransport(config, env, options.fetchImpl),
    ]),
    routes: [route],
    continuationPolicy: Object.freeze({
      format: 'furypipe-provider-retry-fallback-continuation-policy/v1' as const,
      retryOn: Object.freeze([]),
      fallbackOn: Object.freeze([]),
      retryHttpStatuses: Object.freeze([]),
      fallbackHttpStatuses: Object.freeze([]),
      allowCrossProviderFallback: false,
    }),
    ...(options.memory === undefined ? {} : { memory: options.memory }),
    now,
  });

  const bridge: FuryKernelModelBridge = Object.freeze({
    async executeTurn(
      input: Parameters<FuryKernelModelBridge['executeTurn']>[0],
    ) {
      // Refresh host-owned operator-config evidence immediately before the
      // governed planner evaluates provider availability. This does not claim
      // live provider health and does not bypass transport credential checks.
      observeConfiguredHealth();
      return governedBridge.executeTurn(input);
    },
    cancelTurn(conversationId: string, turnId: string) {
      return governedBridge.cancelTurn(conversationId, turnId);
    },
    activeExecutionCount() {
      return governedBridge.activeExecutionCount();
    },
  });

  return Object.freeze({ config, bridge });
}
