import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  inspectBetaConfigFile,
  inspectBetaConfigText,
  type FuryBetaConfigObservation,
} from './beta-config.js';
import {
  createFuryBetaReadinessSnapshot,
  FURY_BETA_READINESS_SUBSYSTEM_FORMAT,
  type FuryBetaReadinessDimensions,
  type FuryBetaReadinessSnapshot,
  type FuryBetaReadinessSubsystemInput,
} from './beta-readiness.js';

export interface FuryBetaReadinessRuntimeOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly configFile?: string;
  readonly configText?: string;
  readonly observedAt?: number;
  readonly nodeVersion?: string;
  readonly gatewayRunning?: boolean;
}

export interface FuryBetaReadinessRuntimeResult {
  readonly snapshot: FuryBetaReadinessSnapshot;
  readonly config: FuryBetaConfigObservation;
}

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 14;

function configPath(env: Readonly<Record<string, string | undefined>>): string {
  return env.FURYPIPE_CONFIG?.trim() || path.join(os.homedir(), '.config', 'furypipe', 'config.json');
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function baseDimensions(overrides: Partial<FuryBetaReadinessDimensions> = {}): FuryBetaReadinessDimensions {
  return {
    discovery: 'ready',
    compatibility: 'ready',
    health: 'ready',
    policy: 'ready',
    authentication: 'not-applicable',
    connection: 'not-applicable',
    executionAuthority: 'not-applicable',
    ...overrides,
  };
}

function subsystem(
  id: string,
  requirement: FuryBetaReadinessSubsystemInput['requirement'],
  observedAt: number,
  dimensions: FuryBetaReadinessDimensions,
  reasonCodes: readonly string[],
  evidence: unknown,
): FuryBetaReadinessSubsystemInput {
  return {
    format: FURY_BETA_READINESS_SUBSYSTEM_FORMAT,
    id,
    requirement,
    evidenceDigestSha256: sha256(evidence),
    observedAt,
    dimensions,
    reasonCodes,
  };
}

function validNodeVersion(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value.trim());
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) return undefined;
  return major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
}

function safeEndpoint(value: string | undefined): { valid: boolean; display: string } {
  const raw = value?.trim();
  if (!raw) return { valid: true, display: '[default]' };
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return { valid: url.protocol === 'http:' || url.protocol === 'https:', display: url.toString() };
  } catch {
    return { valid: false, display: '[invalid]' };
  }
}

function providerReadiness(
  env: Readonly<Record<string, string | undefined>>,
  observedAt: number,
): FuryBetaReadinessSubsystemInput {
  const upstream = safeEndpoint(env.ANTHROPIC_UPSTREAM ?? env.FURYPIPE_UPSTREAM);
  const openAi = safeEndpoint(env.OPENAI_UPSTREAM);
  const provider = env.FURYPIPE_PROVIDER?.trim();
  const providerKnown = provider === undefined || provider === ''
    || provider === 'cloudflare-ai-gateway' || provider === 'omniroute';
  const reasons: string[] = ['provider-health-not-probed', 'provider-connection-not-probed'];
  if (!upstream.valid || !openAi.valid) reasons.push('provider-upstream-invalid');
  if (!providerKnown) reasons.push('provider-kind-unsupported');
  const credentialConfigured = Boolean(
    env.ANTHROPIC_API_KEY?.trim()
    || env.ANTHROPIC_AUTH_TOKEN?.trim()
    || env.ANTHROPIC_OAUTH_TOKEN_FILE?.trim()
    || env.OPENAI_API_KEY?.trim()
    || env.CLOUDFLARE_API_TOKEN?.trim()
    || env.OMNIROUTE_API_KEY?.trim(),
  );
  if (!credentialConfigured) reasons.push('provider-auth-not-probed');
  const invalid = !upstream.valid || !openAi.valid || !providerKnown;
  return subsystem(
    'provider',
    'optional',
    observedAt,
    baseDimensions({
      compatibility: invalid ? 'blocked' : 'ready',
      health: 'unknown',
      authentication: credentialConfigured ? 'unknown' : 'unknown',
      connection: 'unknown',
    }),
    reasons,
    { provider: provider ?? '[default]', upstream: upstream.display, openAi: openAi.display, credentialConfigured },
  );
}

function configurationReadiness(
  config: FuryBetaConfigObservation,
  observedAt: number,
): FuryBetaReadinessSubsystemInput {
  const blocking = config.status === 'invalid' || config.status === 'unsupported';
  return subsystem(
    'configuration',
    'required',
    observedAt,
    baseDimensions({
      compatibility: config.status === 'unsupported' ? 'unsupported' : blocking ? 'blocked' : 'ready',
      health: blocking ? 'blocked' : 'ready',
    }),
    config.reasonCodes,
    {
      status: config.status,
      schemaVersion: config.schemaVersion,
      mode: config.mode,
      migrationId: config.migrationId,
      digestSha256: config.digestSha256,
    },
  );
}

function runtimeReadiness(
  nodeVersion: string | undefined,
  observedAt: number,
): FuryBetaReadinessSubsystemInput {
  const supported = validNodeVersion(nodeVersion);
  const reasons = supported === undefined ? ['runtime-version-unknown'] : supported ? [] : ['runtime-node-unsupported'];
  return subsystem(
    'runtime',
    'required',
    observedAt,
    baseDimensions({
      compatibility: supported === undefined ? 'unknown' : supported ? 'ready' : 'unsupported',
    }),
    reasons,
    { nodeVersion: nodeVersion ?? '[unknown]' },
  );
}

function gatewayReadiness(
  gatewayRunning: boolean,
  observedAt: number,
): FuryBetaReadinessSubsystemInput {
  return subsystem(
    'gateway',
    'optional',
    observedAt,
    baseDimensions({
      health: gatewayRunning ? 'ready' : 'unknown',
      connection: gatewayRunning ? 'ready' : 'unknown',
    }),
    gatewayRunning ? [] : ['gateway-health-not-probed'],
    { gatewayRunning },
  );
}

export function collectFuryBetaReadiness(
  options: FuryBetaReadinessRuntimeOptions = {},
): FuryBetaReadinessRuntimeResult {
  const env = options.env ?? process.env;
  const file = options.configFile ?? configPath(env);
  const observedAt = options.observedAt ?? Date.now();
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    throw new RangeError('beta readiness observedAt must be a non-negative safe integer timestamp');
  }
  const config = options.configText === undefined
    ? inspectBetaConfigFile(file)
    : inspectBetaConfigText(options.configText, file);
  const snapshot = createFuryBetaReadinessSnapshot({
    observedAt,
    subsystems: [
      configurationReadiness(config, observedAt),
      gatewayReadiness(options.gatewayRunning ?? false, observedAt),
      providerReadiness(env, observedAt),
      runtimeReadiness(options.nodeVersion ?? process.versions.node, observedAt),
    ],
  });
  return Object.freeze({ snapshot, config });
}
