import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export const FURY_A2A_REMOTE_AGENT_DESCRIPTOR_FORMAT =
  'furypipe-a2a-remote-agent-descriptor/v1' as const;
export const FURY_A2A_REMOTE_ADAPTER_FORMAT =
  'furypipe-a2a-remote-adapter/v1' as const;
export const FURY_A2A_REMOTE_MESSAGE_PLAN_FORMAT =
  'furypipe-a2a-remote-message-plan/v1' as const;

export type FuryA2aProtocolBinding = 'HTTP+JSON' | 'JSONRPC';

export interface FuryA2aRemoteAgentConfig {
  readonly remoteId: string;
  readonly agentCardUrl: string;
  readonly agentCard: Readonly<Record<string, unknown>>;
  readonly allowedOrigins: readonly string[];
  readonly expectedAgentName?: string;
  readonly expectedAgentVersion?: string;
  readonly trustedAgentCardSha256?: string;
  readonly authProfileId?: string;
  readonly allowedProtocolBindings?: readonly FuryA2aProtocolBinding[];
  readonly requestTimeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly replayWindowMs?: number;
}

export interface FuryA2aRemoteAgentDescriptor {
  readonly format: typeof FURY_A2A_REMOTE_AGENT_DESCRIPTOR_FORMAT;
  readonly remoteId: string;
  readonly protocolVersion: '1.0';
  readonly protocolBinding: FuryA2aProtocolBinding;
  readonly agentCardSha256: string;
  readonly agentIdentitySha256: string;
  readonly agentNameSha256: string;
  readonly agentVersionSha256: string;
  readonly interfaceSha256: string;
  readonly destinationOriginSha256: string;
  readonly destinationHostnameSha256: string;
  readonly tenantSha256?: string;
  readonly securityRequirementsSha256: string;
  readonly authProfileIdSha256?: string;
  readonly requestTimeoutMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly replayWindowMs: number;
  readonly redirectPolicy: 'error';
  readonly requiresPublicResolutionVerification: true;
  readonly authority: 'configured-a2a-adapter-evidence-only';
  readonly authenticated: false;
  readonly networkAuthority: false;
  readonly executionAuthority: false;
  readonly delegationAuthority: false;
}

export interface FuryA2aRemoteMessagePlan {
  readonly format: typeof FURY_A2A_REMOTE_MESSAGE_PLAN_FORMAT;
  readonly planId: string;
  readonly remoteId: string;
  readonly protocolVersion: '1.0';
  readonly operation: 'SendMessage';
  readonly agentIdentitySha256: string;
  readonly agentCardSha256: string;
  readonly interfaceSha256: string;
  readonly destinationOriginSha256: string;
  readonly tenantSha256?: string;
  readonly authProfileIdSha256?: string;
  readonly principalIdSha256: string;
  readonly taskSha256: string;
  readonly messageIdSha256: string;
  readonly replayNonceSha256: string;
  readonly payloadSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly requestTimeoutMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly redirectPolicy: 'error';
  readonly requiresPublicResolutionVerification: true;
  readonly automaticReplayAllowed: false;
  readonly authority: 'a2a-message-plan-evidence-only';
  readonly authenticated: false;
  readonly networkAuthority: false;
  readonly executionAuthority: false;
  readonly delegationAuthority: false;
}

export interface FuryA2aRemoteAdapter {
  readonly format: typeof FURY_A2A_REMOTE_ADAPTER_FORMAT;
  readonly authority: 'a2a-adapter-contract-only';
  readonly authenticated: false;
  readonly networkAuthority: false;
  readonly executionAuthority: false;
  readonly delegationAuthority: false;
  resolve(remoteId: string): FuryA2aRemoteAgentDescriptor | undefined;
  list(): readonly FuryA2aRemoteAgentDescriptor[];
  prepareMessage(input: {
    readonly descriptor: FuryA2aRemoteAgentDescriptor;
    readonly principalId: string;
    readonly task: string;
    readonly now?: number;
  }): FuryA2aRemoteMessagePlan;
  inspectPlan(plan: FuryA2aRemoteMessagePlan): FuryA2aRemoteMessagePlan;
}

export class FuryA2aRemoteAdapterError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code:
      | 'invalid-config'
      | 'invalid-agent-card'
      | 'identity-mismatch'
      | 'protocol-not-supported'
      | 'destination-denied'
      | 'auth-profile-required'
      | 'invalid-descriptor'
      | 'invalid-plan'
      | 'payload-too-large'
      | 'clock-invalid',
    message: string,
  ) {
    super(message);
    this.name = 'FuryA2aRemoteAdapterError';
  }
}

interface AgentInterfaceSnapshot {
  readonly url: string;
  readonly origin: string;
  readonly hostname: string;
  readonly protocolBinding: FuryA2aProtocolBinding;
  readonly protocolVersion: '1.0';
  readonly tenant?: string;
}

interface NormalizedRemoteConfig {
  readonly remoteId: string;
  readonly agentCardUrl: string;
  readonly agentCardSha256: string;
  readonly agentIdentitySha256: string;
  readonly agentNameSha256: string;
  readonly agentVersionSha256: string;
  readonly interface: AgentInterfaceSnapshot;
  readonly interfaceSha256: string;
  readonly destinationOriginSha256: string;
  readonly destinationHostnameSha256: string;
  readonly securityRequirementsSha256: string;
  readonly authProfileId?: string;
  readonly authProfileIdSha256?: string;
  readonly requestTimeoutMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly replayWindowMs: number;
}

interface DescriptorState {
  readonly adapter: FuryA2aRemoteAdapter;
  readonly config: NormalizedRemoteConfig;
}

interface PlanState {
  readonly adapterToken: object;
  readonly descriptor: FuryA2aRemoteAgentDescriptor;
  readonly destinationUrl: string;
  readonly agentCardUrl: string;
  readonly authProfileId?: string;
  readonly messageId: string;
  readonly replayNonce: string;
  readonly task: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

const ADAPTERS = new WeakSet<object>();
const DESCRIPTORS = new WeakMap<object, DescriptorState>();
const PLANS = new WeakMap<object, PlanState>();

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_CONFIGS = 64;
const MAX_TASK_BYTES = 1024 * 1024;
const MAX_CARD_BYTES = 1024 * 1024;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120_000;
const MIN_BYTES = 1024;
const MAX_BYTES = 16 * 1024 * 1024;
const MIN_REPLAY_WINDOW_MS = 1_000;
const MAX_REPLAY_WINDOW_MS = 10 * 60_000;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function exactIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !SAFE_ID.test(value)
    || value.includes('\0')
  ) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-config',
      label + ' is invalid',
    );
  }
  return value;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (
    typeof resolved !== 'number'
    || !Number.isSafeInteger(resolved)
    || resolved < min
    || resolved > max
  ) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-config',
      label + ' is outside its bound',
    );
  }
  return resolved;
}

function ownDataObject(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-config',
      label + ' must be a plain data object',
    );
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryA2aRemoteAdapterError(
        'invalid-config',
        label + ' must contain enumerable data properties only',
      );
    }
  }
  return record;
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 24) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-agent-card',
      'A2A Agent Card exceeds the nesting bound',
    );
  }
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (value.includes('\0')) {
      throw new FuryA2aRemoteAdapterError(
        'invalid-agent-card',
        'A2A Agent Card contains NUL data',
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new FuryA2aRemoteAdapterError(
        'invalid-agent-card',
        'A2A Agent Card contains a non-finite number',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (
      value.length > 512
      || value.some((_, index) => !Object.prototype.hasOwnProperty.call(value, index))
    ) {
      throw new FuryA2aRemoteAdapterError(
        'invalid-agent-card',
        'A2A Agent Card contains an invalid array',
      );
    }
    return '[' + value.map((item) => canonicalJson(item, depth + 1)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const record = ownDataObject(value, 'A2A Agent Card object');
    const keys = Object.getOwnPropertyNames(record).sort();
    if (keys.length > 512) {
      throw new FuryA2aRemoteAdapterError(
        'invalid-agent-card',
        'A2A Agent Card object exceeds its field bound',
      );
    }
    return '{' + keys.map((key) =>
      JSON.stringify(key) + ':' + canonicalJson(record[key], depth + 1)
    ).join(',') + '}';
  }
  throw new FuryA2aRemoteAdapterError(
    'invalid-agent-card',
    'A2A Agent Card contains unsupported data',
  );
}

function safeUrl(value: unknown, label: string): URL {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) {
    throw new FuryA2aRemoteAdapterError(
      'destination-denied',
      label + ' is invalid',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FuryA2aRemoteAdapterError(
      'destination-denied',
      label + ' is not a valid URL',
    );
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.hash !== ''
  ) {
    throw new FuryA2aRemoteAdapterError(
      'destination-denied',
      label + ' must be credential-free HTTPS without a fragment',
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
  ) {
    throw new FuryA2aRemoteAdapterError(
      'destination-denied',
      label + ' points at a local hostname',
    );
  }
  const ipVersion = isIP(hostname.replace(/^\[|\]$/gu, ''));
  if (ipVersion === 4) {
    const parts = hostname.split('.').map((part) => Number(part));
    const [a,b,c,d] = parts;
    if (
      a === undefined
      || b === undefined
      || c === undefined
      || d === undefined
    ) {
      throw new FuryA2aRemoteAdapterError(
        'destination-denied',
        label + ' contains an invalid IPv4 literal',
      );
    }
    if (
      a === 0
      || a === 10
      || (a === 100 && b >= 64 && b <= 127)
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224
    ) {
      throw new FuryA2aRemoteAdapterError(
        'destination-denied',
        label + ' points at a non-public IPv4 address',
      );
    }
  } else if (ipVersion === 6) {
    const normalized = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (
      normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('::ffff:')
      || normalized.startsWith('2001:db8:')
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/u.test(normalized)
    ) {
      throw new FuryA2aRemoteAdapterError(
        'destination-denied',
        label + ' points at a non-public IPv6 address',
      );
    }
  }
  return url;
}

function normalizeOrigins(value: unknown): readonly string[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > 32
    || value.some((_, index) => !Object.prototype.hasOwnProperty.call(value, index))
  ) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-config',
      'A2A allowedOrigins must be a bounded non-empty list',
    );
  }
  const origins = value.map((item) => {
    const url = safeUrl(item, 'A2A allowed origin');
    if (url.pathname !== '/' || url.search !== '') {
      throw new FuryA2aRemoteAdapterError(
        'invalid-config',
        'A2A allowed origin must not contain path or query data',
      );
    }
    return url.origin;
  });
  if (new Set(origins).size !== origins.length) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-config',
      'A2A allowedOrigins contains duplicates',
    );
  }
  return Object.freeze(origins);
}

function normalizeBindings(
  value: unknown,
): readonly FuryA2aProtocolBinding[] {
  const input = value ?? ['HTTP+JSON', 'JSONRPC'];
  if (
    !Array.isArray(input)
    || input.length < 1
    || input.length > 2
    || input.some((_, index) => !Object.prototype.hasOwnProperty.call(input, index))
  ) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-config',
      'A2A protocol binding allowlist is invalid',
    );
  }
  const result: FuryA2aProtocolBinding[] = [];
  for (const item of input) {
    if (item !== 'HTTP+JSON' && item !== 'JSONRPC') {
      throw new FuryA2aRemoteAdapterError(
        'protocol-not-supported',
        'A2A protocol binding is not supported by this adapter',
      );
    }
    if (!result.includes(item)) result.push(item);
  }
  return Object.freeze(result);
}

function normalizeConfig(value: FuryA2aRemoteAgentConfig): NormalizedRemoteConfig {
  const record = ownDataObject(value, 'A2A remote config');
  const allowedConfigKeys = new Set([
    'remoteId',
    'agentCardUrl',
    'agentCard',
    'allowedOrigins',
    'expectedAgentName',
    'expectedAgentVersion',
    'trustedAgentCardSha256',
    'authProfileId',
    'allowedProtocolBindings',
    'requestTimeoutMs',
    'maxRequestBytes',
    'maxResponseBytes',
    'replayWindowMs',
  ]);
  for (const key of Object.getOwnPropertyNames(record)) {
    if (!allowedConfigKeys.has(key)) {
      throw new FuryA2aRemoteAdapterError(
        'invalid-config',
        'A2A remote config contains an unsupported field',
      );
    }
  }

  const remoteId = exactIdentifier(record.remoteId, 'A2A remote ID');
  const allowedOrigins = normalizeOrigins(record.allowedOrigins);
  const cardUrl = safeUrl(record.agentCardUrl, 'A2A Agent Card URL');
  if (!allowedOrigins.includes(cardUrl.origin)) {
    throw new FuryA2aRemoteAdapterError(
      'destination-denied',
      'A2A Agent Card origin is outside the explicit allowlist',
    );
  }
  const card = ownDataObject(record.agentCard, 'A2A Agent Card');
  const cardJson = canonicalJson(card);
  if (byteLength(cardJson) > MAX_CARD_BYTES) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-agent-card',
      'A2A Agent Card exceeds its byte bound',
    );
  }
  const agentCardSha256 = sha256(cardJson);
  if (
    record.trustedAgentCardSha256 !== undefined
    && (
      typeof record.trustedAgentCardSha256 !== 'string'
      || !SHA256.test(record.trustedAgentCardSha256)
      || record.trustedAgentCardSha256 !== agentCardSha256
    )
  ) {
    throw new FuryA2aRemoteAdapterError(
      'identity-mismatch',
      'A2A Agent Card does not match the configured trusted digest',
    );
  }

  const name = typeof card.name === 'string' ? card.name : '';
  const version = typeof card.version === 'string' ? card.version : '';
  if (
    name.length < 1 || name.length > 256 || name.includes('\0')
    || version.length < 1 || version.length > 128 || version.includes('\0')
  ) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-agent-card',
      'A2A Agent Card name/version is invalid',
    );
  }
  if (
    record.expectedAgentName !== undefined
    && record.expectedAgentName !== name
  ) {
    throw new FuryA2aRemoteAdapterError(
      'identity-mismatch',
      'A2A Agent Card name does not match configured identity',
    );
  }
  if (
    record.expectedAgentVersion !== undefined
    && record.expectedAgentVersion !== version
  ) {
    throw new FuryA2aRemoteAdapterError(
      'identity-mismatch',
      'A2A Agent Card version does not match configured identity',
    );
  }

  const bindings = normalizeBindings(record.allowedProtocolBindings);
  if (
    !Array.isArray(card.supportedInterfaces)
    || card.supportedInterfaces.length < 1
    || card.supportedInterfaces.length > 32
  ) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-agent-card',
      'A2A Agent Card supportedInterfaces is invalid',
    );
  }
  let selected: AgentInterfaceSnapshot | undefined;
  for (const item of card.supportedInterfaces) {
    const iface = ownDataObject(item, 'A2A AgentInterface');
    if (
      iface.protocolVersion !== '1.0'
      || !bindings.includes(iface.protocolBinding as FuryA2aProtocolBinding)
    ) {
      continue;
    }
    const target = safeUrl(iface.url, 'A2A interface URL');
    if (!allowedOrigins.includes(target.origin)) {
      continue;
    }
    const tenant = iface.tenant === undefined
      ? undefined
      : exactIdentifier(iface.tenant, 'A2A interface tenant');
    selected = Object.freeze({
      url: target.toString(),
      origin: target.origin,
      hostname: target.hostname.toLowerCase(),
      protocolBinding: iface.protocolBinding as FuryA2aProtocolBinding,
      protocolVersion: '1.0' as const,
      ...(tenant === undefined ? {} : { tenant }),
    });
    break;
  }
  if (!selected) {
    throw new FuryA2aRemoteAdapterError(
      'protocol-not-supported',
      'A2A Agent Card has no allowed stable v1.0 HTTPS interface',
    );
  }

  if (
    typeof card.description !== 'string'
    || card.description.length > 4096
    || card.description.includes('\0')
    || !card.capabilities
    || typeof card.capabilities !== 'object'
    || Array.isArray(card.capabilities)
    || !Array.isArray(card.defaultInputModes)
    || card.defaultInputModes.length < 1
    || card.defaultInputModes.length > 64
    || !Array.isArray(card.defaultOutputModes)
    || card.defaultOutputModes.length < 1
    || card.defaultOutputModes.length > 64
    || !Array.isArray(card.skills)
    || card.skills.length > 256
  ) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-agent-card',
      'A2A Agent Card is missing required v1.0 fields or exceeds bounds',
    );
  }
  canonicalJson(card.capabilities);
  canonicalJson(card.defaultInputModes);
  canonicalJson(card.defaultOutputModes);
  canonicalJson(card.skills);

  const securityRequirements = card.securityRequirements ?? [];
  if (!Array.isArray(securityRequirements) || securityRequirements.length > 64) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-agent-card',
      'A2A security requirements are invalid',
    );
  }
  const securityJson = canonicalJson(securityRequirements);
  const authRequired = securityRequirements.length > 0;
  const authProfileId = record.authProfileId === undefined
    ? undefined
    : exactIdentifier(record.authProfileId, 'A2A auth profile ID');
  if (authRequired && authProfileId === undefined) {
    throw new FuryA2aRemoteAdapterError(
      'auth-profile-required',
      'A2A Agent Card requires authentication but no scoped auth profile was configured',
    );
  }

  const requestTimeoutMs = boundedInteger(
    record.requestTimeoutMs,
    15_000,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    'A2A request timeout',
  );
  const maxRequestBytes = boundedInteger(
    record.maxRequestBytes,
    1024 * 1024,
    MIN_BYTES,
    MAX_BYTES,
    'A2A max request bytes',
  );
  const maxResponseBytes = boundedInteger(
    record.maxResponseBytes,
    4 * 1024 * 1024,
    MIN_BYTES,
    MAX_BYTES,
    'A2A max response bytes',
  );
  const replayWindowMs = boundedInteger(
    record.replayWindowMs,
    60_000,
    MIN_REPLAY_WINDOW_MS,
    MAX_REPLAY_WINDOW_MS,
    'A2A replay window',
  );

  const interfaceSha256 = sha256(canonicalJson({
    url: selected.url,
    protocolBinding: selected.protocolBinding,
    protocolVersion: selected.protocolVersion,
    ...(selected.tenant === undefined ? {} : { tenant: selected.tenant }),
  }));
  const agentNameSha256 = sha256(name);
  const agentVersionSha256 = sha256(version);
  const destinationOriginSha256 = sha256(selected.origin);
  const destinationHostnameSha256 = sha256(selected.hostname);
  const securityRequirementsSha256 = sha256(securityJson);
  const authProfileIdSha256 = authProfileId === undefined
    ? undefined
    : sha256('auth-profile:' + authProfileId);
  const agentIdentitySha256 = sha256(canonicalJson({
    remoteId,
    agentCardSha256,
    agentNameSha256,
    agentVersionSha256,
    interfaceSha256,
    destinationOriginSha256,
    destinationHostnameSha256,
    securityRequirementsSha256,
    ...(authProfileIdSha256 === undefined ? {} : { authProfileIdSha256 }),
  }));

  return Object.freeze({
    remoteId,
    agentCardUrl: cardUrl.toString(),
    agentCardSha256,
    agentIdentitySha256,
    agentNameSha256,
    agentVersionSha256,
    interface: selected,
    interfaceSha256,
    destinationOriginSha256,
    destinationHostnameSha256,
    securityRequirementsSha256,
    ...(authProfileId === undefined ? {} : { authProfileId }),
    ...(authProfileIdSha256 === undefined ? {} : { authProfileIdSha256 }),
    requestTimeoutMs,
    maxRequestBytes,
    maxResponseBytes,
    replayWindowMs,
  });
}

export function isGeneratedFuryA2aRemoteAgentDescriptor(
  value: unknown,
): value is FuryA2aRemoteAgentDescriptor {
  return !!value && typeof value === 'object' && DESCRIPTORS.has(value);
}

export function isGeneratedFuryA2aRemoteMessagePlan(
  value: unknown,
): value is FuryA2aRemoteMessagePlan {
  return !!value && typeof value === 'object' && PLANS.has(value);
}

export function createFuryA2aRemoteAdapter(
  configs: readonly FuryA2aRemoteAgentConfig[],
): FuryA2aRemoteAdapter {
  if (
    !Array.isArray(configs)
    || configs.length < 1
    || configs.length > MAX_CONFIGS
    || configs.some((_, index) => !Object.prototype.hasOwnProperty.call(configs, index))
  ) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-config',
      'A2A adapter requires a bounded non-empty config list',
    );
  }
  const normalized = configs.map(normalizeConfig);
  if (new Set(normalized.map((item) => item.remoteId)).size !== normalized.length) {
    throw new FuryA2aRemoteAdapterError(
      'invalid-config',
      'A2A remote IDs must be unique',
    );
  }

  const byId = new Map<string, FuryA2aRemoteAgentDescriptor>();
  const issuedMessageIds = new Set<string>();
  const adapterToken = Object.freeze({});
  let adapter: FuryA2aRemoteAdapter;

  adapter = Object.freeze({
    format: FURY_A2A_REMOTE_ADAPTER_FORMAT,
    authority: 'a2a-adapter-contract-only' as const,
    authenticated: false as const,
    networkAuthority: false as const,
    executionAuthority: false as const,
    delegationAuthority: false as const,

    resolve(remoteId: string): FuryA2aRemoteAgentDescriptor | undefined {
      if (!ADAPTERS.has(adapter as object)) {
        throw new FuryA2aRemoteAdapterError(
          'invalid-config',
          'A2A adapter is not process-local evidence',
        );
      }
      return typeof remoteId === 'string' ? byId.get(remoteId) : undefined;
    },

    list(): readonly FuryA2aRemoteAgentDescriptor[] {
      if (!ADAPTERS.has(adapter as object)) {
        throw new FuryA2aRemoteAdapterError(
          'invalid-config',
          'A2A adapter is not process-local evidence',
        );
      }
      return Object.freeze([...byId.values()]);
    },

    prepareMessage(input: {
      readonly descriptor: FuryA2aRemoteAgentDescriptor;
      readonly principalId: string;
      readonly task: string;
      readonly now?: number;
    }): FuryA2aRemoteMessagePlan {
      const record = ownDataObject(input, 'A2A message input');
      const allowed = new Set(['descriptor', 'principalId', 'task', 'now']);
      for (const key of Object.getOwnPropertyNames(record)) {
        if (!allowed.has(key)) {
          throw new FuryA2aRemoteAdapterError(
            'invalid-config',
            'A2A message input contains an unsupported field',
          );
        }
      }
      const descriptor = record.descriptor as FuryA2aRemoteAgentDescriptor;
      const descriptorState = DESCRIPTORS.get(descriptor as object);
      if (!descriptorState || descriptorState.adapter !== adapter) {
        throw new FuryA2aRemoteAdapterError(
          'invalid-descriptor',
          'A2A descriptor is not owned by this adapter',
        );
      }
      const config = descriptorState.config;
      const principalId = exactIdentifier(record.principalId, 'A2A principal ID');
      if (
        typeof record.task !== 'string'
        || record.task.trim().length === 0
        || record.task.includes('\0')
        || byteLength(record.task) > MAX_TASK_BYTES
      ) {
        throw new FuryA2aRemoteAdapterError(
          'invalid-config',
          'A2A task is invalid or exceeds its bound',
        );
      }
      const task = record.task;
      const now = record.now === undefined ? Date.now() : record.now;
      if (
        typeof now !== 'number'
        || !Number.isSafeInteger(now)
        || now < 0
      ) {
        throw new FuryA2aRemoteAdapterError(
          'clock-invalid',
          'A2A message clock is invalid',
        );
      }

      let messageId = '';
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = randomUUID();
        if (!issuedMessageIds.has(candidate)) {
          messageId = candidate;
          issuedMessageIds.add(candidate);
          break;
        }
      }
      if (messageId === '') {
        throw new FuryA2aRemoteAdapterError(
          'invalid-plan',
          'A2A message ID collision budget exhausted',
        );
      }
      const expiresAt = now + config.replayWindowMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new FuryA2aRemoteAdapterError(
          'clock-invalid',
          'A2A replay-window expiry is invalid',
        );
      }
      const replayNonce = randomBytes(32).toString('base64url');
      const message: Record<string, unknown> = {
        role: 'ROLE_USER',
        parts: [{ text: task, mediaType: 'text/plain' }],
        messageId,
      };
      const payload: Record<string, unknown> = {
        message,
        ...(config.interface.tenant === undefined
          ? {}
          : { tenant: config.interface.tenant }),
      };
      const payloadJson = canonicalJson(payload);
      if (byteLength(payloadJson) > config.maxRequestBytes) {
        throw new FuryA2aRemoteAdapterError(
          'payload-too-large',
          'A2A request payload exceeds the configured byte bound',
        );
      }

      const plan = Object.freeze({
        format: FURY_A2A_REMOTE_MESSAGE_PLAN_FORMAT,
        planId: 'fa2ap_' + randomUUID(),
        remoteId: config.remoteId,
        protocolVersion: '1.0' as const,
        operation: 'SendMessage' as const,
        agentIdentitySha256: config.agentIdentitySha256,
        agentCardSha256: config.agentCardSha256,
        interfaceSha256: config.interfaceSha256,
        destinationOriginSha256: config.destinationOriginSha256,
        ...(config.interface.tenant === undefined
          ? {}
          : { tenantSha256: sha256(config.interface.tenant) }),
        ...(config.authProfileIdSha256 === undefined
          ? {}
          : { authProfileIdSha256: config.authProfileIdSha256 }),
        principalIdSha256: sha256('principal:' + principalId),
        taskSha256: sha256(task),
        messageIdSha256: sha256('message-id:' + messageId),
        replayNonceSha256: sha256('replay-nonce:' + replayNonce),
        payloadSha256: sha256(payloadJson),
        issuedAt: now,
        expiresAt,
        requestTimeoutMs: config.requestTimeoutMs,
        maxRequestBytes: config.maxRequestBytes,
        maxResponseBytes: config.maxResponseBytes,
        redirectPolicy: 'error' as const,
        requiresPublicResolutionVerification: true as const,
        automaticReplayAllowed: false as const,
        authority: 'a2a-message-plan-evidence-only' as const,
        authenticated: false as const,
        networkAuthority: false as const,
        executionAuthority: false as const,
        delegationAuthority: false as const,
      });
      PLANS.set(plan, {
        adapterToken,
        descriptor,
        destinationUrl: config.interface.url,
        agentCardUrl: config.agentCardUrl,
        ...(config.authProfileId === undefined
          ? {}
          : { authProfileId: config.authProfileId }),
        messageId,
        replayNonce,
        task,
        payload: Object.freeze(payload),
      });
      return plan;
    },

    inspectPlan(plan: FuryA2aRemoteMessagePlan): FuryA2aRemoteMessagePlan {
      const state = PLANS.get(plan as object);
      if (!state || state.adapterToken !== adapterToken) {
        throw new FuryA2aRemoteAdapterError(
          'invalid-plan',
          'A2A message plan is not owned by this adapter',
        );
      }
      return plan;
    },
  });

  ADAPTERS.add(adapter as object);
  for (const config of normalized) {
    const descriptor = Object.freeze({
      format: FURY_A2A_REMOTE_AGENT_DESCRIPTOR_FORMAT,
      remoteId: config.remoteId,
      protocolVersion: config.interface.protocolVersion,
      protocolBinding: config.interface.protocolBinding,
      agentCardSha256: config.agentCardSha256,
      agentIdentitySha256: config.agentIdentitySha256,
      agentNameSha256: config.agentNameSha256,
      agentVersionSha256: config.agentVersionSha256,
      interfaceSha256: config.interfaceSha256,
      destinationOriginSha256: config.destinationOriginSha256,
      destinationHostnameSha256: config.destinationHostnameSha256,
      ...(config.interface.tenant === undefined
        ? {}
        : { tenantSha256: sha256(config.interface.tenant) }),
      securityRequirementsSha256: config.securityRequirementsSha256,
      ...(config.authProfileIdSha256 === undefined
        ? {}
        : { authProfileIdSha256: config.authProfileIdSha256 }),
      requestTimeoutMs: config.requestTimeoutMs,
      maxRequestBytes: config.maxRequestBytes,
      maxResponseBytes: config.maxResponseBytes,
      replayWindowMs: config.replayWindowMs,
      redirectPolicy: 'error' as const,
      requiresPublicResolutionVerification: true as const,
      authority: 'configured-a2a-adapter-evidence-only' as const,
      authenticated: false as const,
      networkAuthority: false as const,
      executionAuthority: false as const,
      delegationAuthority: false as const,
    });
    DESCRIPTORS.set(descriptor, { adapter, config });
    byId.set(config.remoteId, descriptor);
  }
  return adapter;
}
