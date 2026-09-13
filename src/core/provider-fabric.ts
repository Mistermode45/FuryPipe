import { isClaudeModel } from './claude-model-profiles.js';
import { hasGeminiMeasuredProfile, isGeminiModel } from './gemini-model-profiles.js';
import { isMisresolvedModelId } from './gpt-model-profiles.js';

/** A missing provider price is a state, not a zero. */
export const COST_UNKNOWN = 'COST_UNKNOWN' as const;

export type ProviderFabricProtocol = 'anthropic' | 'openai' | 'google';
export type ProviderRegistrationStatus = 'registered' | 'unregistered';
export type ProviderAvailability = 'available' | 'unavailable' | 'unknown';
export type ProviderEvidenceKind = 'local-contract' | 'operator-config' | 'live-probe' | 'transport-result' | 'unknown';
export type ModelCapabilityStatus = 'supported' | 'known-unmeasured' | 'unknown';

export interface ProviderEvidence {
  readonly kind: ProviderEvidenceKind;
  /** Human-readable provenance, never a credential or response body. */
  readonly source: string;
}

export interface ProviderCacheCapabilities {
  readonly status: 'known' | 'unknown';
  readonly minTokens?: number;
  readonly granularity?: 'prefix' | 'request' | 'unknown';
  readonly prefixSemantics?: 'stable-prefix' | 'provider-defined' | 'unknown';
  readonly explicitMarkers?: boolean;
  readonly ttl?: readonly string[];
  readonly modelSpecific?: boolean;
  readonly cost: {
    readonly status: 'known' | typeof COST_UNKNOWN;
    readonly writeUsdPerMillionTokens?: number;
    readonly readUsdPerMillionTokens?: number;
  };
}

export interface ProviderDefinition {
  readonly id: string;
  readonly protocol: ProviderFabricProtocol;
  readonly aliases: readonly string[];
  readonly routePrefix: string;
  /** Registration is local metadata; availability is deliberately separate. */
  readonly status: ProviderRegistrationStatus;
  readonly availability: ProviderAvailability;
  readonly evidence: readonly ProviderEvidence[];
  readonly cache: ProviderCacheCapabilities;
}

export interface ProviderRegistry {
  readonly list: () => readonly ProviderDefinition[];
  readonly get: (id: string) => ProviderDefinition | undefined;
}

export interface ModelCapability {
  readonly requestedModel?: string;
  readonly family: 'anthropic' | 'openai' | 'google' | 'unknown';
  readonly canonicalModel?: string;
  readonly aliases: readonly string[];
  readonly status: ModelCapabilityStatus;
  readonly transform: 'supported' | 'unsupported' | 'unknown';
  readonly availability: ProviderAvailability;
  readonly evidence: readonly ProviderEvidence[];
  readonly cache: Pick<ProviderCacheCapabilities, 'status' | 'modelSpecific'>;
  readonly cost: {
    readonly status: typeof COST_UNKNOWN;
    readonly reason: string;
  };
  /** Unknown or unmeasured models never opt into a lossy route by identity alone. */
  readonly safeFallback: 'native';
}

export interface ProviderFabricRequest {
  /** Explicit route metadata wins over model-family inference. */
  readonly providerId?: string;
  readonly model?: string | null;
  readonly protocol?: ProviderFabricProtocol;
  readonly registry?: ProviderRegistry;
}

export interface ProviderFabricDecision {
  readonly format: 'furypipe-provider-fabric-decision/v1';
  readonly provider: {
    readonly id: string;
    readonly protocol: ProviderFabricProtocol;
    readonly status: ProviderRegistrationStatus;
    readonly availability: ProviderAvailability;
    readonly aliases: readonly string[];
    readonly routePrefix: string;
    readonly evidence: readonly ProviderEvidence[];
  };
  readonly model: ModelCapability;
  readonly routing: {
    readonly reason:
      | 'explicit_provider_route'
      | 'model_family_inference'
      | 'protocol_default'
      | 'unknown_provider_fallback';
    readonly requestedProvider?: string;
    readonly providerMatchesModelFamily: boolean;
  };
  readonly cache: ProviderCacheCapabilities;
  readonly fallback: {
    readonly eligible: false;
    readonly reason: 'provider_availability_not_proven' | 'model_capability_not_proven';
  };
}

const BUILTIN_PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: 'anthropic',
    protocol: 'anthropic',
    aliases: ['claude'],
    routePrefix: '/providers/anthropic',
    status: 'registered',
    availability: 'unknown',
    evidence: [{ kind: 'local-contract', source: 'FuryPipe Anthropic Messages cache planner contract' }],
    cache: {
      status: 'known',
      minTokens: 1024,
      granularity: 'prefix',
      prefixSemantics: 'stable-prefix',
      explicitMarkers: true,
      ttl: ['5m', '1h'],
      modelSpecific: true,
      cost: { status: COST_UNKNOWN },
    },
  },
  {
    id: 'openai',
    protocol: 'openai',
    aliases: ['gpt'],
    routePrefix: '/providers/openai',
    status: 'registered',
    availability: 'unknown',
    evidence: [{ kind: 'local-contract', source: 'FuryPipe OpenAI-compatible bridge registration' }],
    cache: {
      status: 'unknown',
      granularity: 'unknown',
      prefixSemantics: 'unknown',
      modelSpecific: true,
      cost: { status: COST_UNKNOWN },
    },
  },
  {
    id: 'google',
    protocol: 'google',
    aliases: ['gemini'],
    routePrefix: '/providers/google',
    status: 'registered',
    availability: 'unknown',
    evidence: [{ kind: 'local-contract', source: 'FuryPipe Gemini profile registration' }],
    cache: {
      status: 'unknown',
      granularity: 'unknown',
      prefixSemantics: 'unknown',
      modelSpecific: true,
      cost: { status: COST_UNKNOWN },
    },
  },
];

function normalize(value: string | undefined | null): string {
  const source = (value ?? '').trim().toLowerCase();
  let normalized = '';
  let bracketed = false;
  for (const character of source) {
    if (character === '[') {
      bracketed = true;
      continue;
    }
    if (bracketed) {
      if (character === ']') bracketed = false;
      continue;
    }
    normalized += character;
  }
  return normalized;
}

function inferredProviderId(model: string | null | undefined, protocol: ProviderFabricProtocol | undefined): string | undefined {
  const id = normalize(model);
  if (isClaudeModel(id)) return 'anthropic';
  if (isGeminiModel(id)) return 'google';
  if (/^(?:gpt-|o[1-9]|chatgpt|openai(?:\/|$))/.test(id)) return 'openai';
  return protocol;
}

function modelAliases(model: string): string[] {
  const slash = model.lastIndexOf('/');
  const base = slash >= 0 ? model.slice(slash + 1) : model;
  return base === model ? [model] : [model, base];
}

function resolveModelCapability(
  model: string | null | undefined,
  provider: ProviderDefinition,
): ModelCapability {
  const requestedModel = model && model.trim().length > 0 ? model.trim() : undefined;
  const normalized = normalize(requestedModel);
  const aliases = normalized ? modelAliases(normalized) : [];
  const family = isClaudeModel(normalized)
    ? 'anthropic'
    : isGeminiModel(normalized)
      ? 'google'
      : /^(?:gpt-|o[1-9]|chatgpt|openai(?:\/|$))/.test(normalized)
        ? 'openai'
        : 'unknown';
  const familyMatchesProvider = family === 'unknown' || family === provider.protocol
    || (family === 'google' && provider.protocol === 'google');
  const recognized = family !== 'unknown' && familyMatchesProvider;
  const measuredGemini = family === 'google' && hasGeminiMeasuredProfile(normalized);
  const status: ModelCapabilityStatus = !recognized
    ? 'unknown'
    : family === 'google' && !measuredGemini
      ? 'known-unmeasured'
      : 'supported';
  const transform = status === 'supported' && !isMisresolvedModelId(normalized)
    ? 'supported'
    : status === 'unknown' ? 'unknown' : 'unsupported';
  const canonicalModel = recognized ? (family === 'anthropic' ? 'claude' : family === 'google' ? 'gemini' : 'openai') : undefined;
  return {
    ...(requestedModel === undefined ? {} : { requestedModel }),
    family,
    ...(canonicalModel === undefined ? {} : { canonicalModel }),
    aliases,
    status,
    transform,
    availability: provider.availability,
    evidence: recognized
      ? [{ kind: 'local-contract', source: 'FuryPipe model family/profile resolver' }]
      : [{ kind: 'unknown', source: 'no registered model capability matched' }],
    cache: { status: provider.cache.status, ...(provider.cache.modelSpecific === undefined ? {} : { modelSpecific: provider.cache.modelSpecific }) },
    cost: {
      status: COST_UNKNOWN,
      reason: recognized
        ? 'absolute provider/model prices are not registered in the local fabric'
        : 'model capability is unknown; no price may be inferred',
    },
    safeFallback: 'native',
  };
}

export function createProviderRegistry(
  definitions: readonly ProviderDefinition[] = BUILTIN_PROVIDERS,
): ProviderRegistry {
  const byId = new Map<string, ProviderDefinition>();
  const byAlias = new Map<string, ProviderDefinition>();
  for (const definition of definitions) {
    const id = normalize(definition.id);
    if (!id || byId.has(id)) throw new Error(`duplicate provider registry id: ${definition.id}`);
    byId.set(id, definition);
    for (const alias of definition.aliases) {
      const key = normalize(alias);
      if (!key || byAlias.has(key) || byId.has(key)) throw new Error(`duplicate provider registry alias: ${alias}`);
      byAlias.set(key, definition);
    }
  }
  return {
    list: () => [...byId.values()],
    get: (id: string) => byId.get(normalize(id)) ?? byAlias.get(normalize(id)),
  };
}

export const DEFAULT_PROVIDER_REGISTRY = createProviderRegistry();

/** Resolve route metadata without contacting or probing any provider. */
export function resolveProviderFabric(input: ProviderFabricRequest): ProviderFabricDecision {
  const registry = input.registry ?? DEFAULT_PROVIDER_REGISTRY;
  const requestedProvider = normalize(input.providerId);
  const inferred = inferredProviderId(input.model, input.protocol);
  // An explicit but unknown route must not be silently redirected by a model
  // string. Fall back to the declared protocol and leave the mismatch visible.
  const provider = (requestedProvider ? registry.get(requestedProvider) : undefined)
    ?? (requestedProvider ? undefined : inferred ? registry.get(inferred) : undefined)
    ?? registry.get(input.protocol ?? 'anthropic')
    ?? registry.list()[0];
  if (!provider) throw new Error('provider registry is empty');

  const explicitKnown = requestedProvider !== '' && registry.get(requestedProvider) !== undefined;
  const inferredKnown = requestedProvider === '' && !explicitKnown && inferred !== undefined && registry.get(inferred) !== undefined;
  const reason = explicitKnown
    ? 'explicit_provider_route'
    : inferredKnown
      ? 'model_family_inference'
      : requestedProvider !== ''
        ? 'unknown_provider_fallback'
        : 'protocol_default';
  const model = resolveModelCapability(input.model, provider);
  const providerMatchesModelFamily = model.family === 'unknown' || model.family === provider.protocol;
  return {
    format: 'furypipe-provider-fabric-decision/v1',
    provider: {
      id: provider.id,
      protocol: provider.protocol,
      status: provider.status,
      availability: provider.availability,
      aliases: provider.aliases,
      routePrefix: provider.routePrefix,
      evidence: provider.evidence,
    },
    model,
    routing: {
      reason,
      ...(requestedProvider ? { requestedProvider } : {}),
      providerMatchesModelFamily,
    },
    cache: provider.cache,
    fallback: {
      eligible: false,
      reason: provider.availability === 'unknown' ? 'provider_availability_not_proven' : 'model_capability_not_proven',
    },
  };
}

/** Metadata-only registry view for doctor/control-room consumers. */
export function inspectProviderRegistry(registry: ProviderRegistry = DEFAULT_PROVIDER_REGISTRY): readonly ProviderDefinition[] {
  return registry.list().map((provider) => ({
    ...provider,
    aliases: [...provider.aliases],
    evidence: provider.evidence.map((entry) => ({ ...entry })),
    cache: {
      ...provider.cache,
      ...(provider.cache.ttl === undefined ? {} : { ttl: [...provider.cache.ttl] }),
      cost: { ...provider.cache.cost },
    },
  }));
}
