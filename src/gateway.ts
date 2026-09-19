import { createHash } from 'node:crypto';

export const FURY_GATEWAY_PROTOCOL_VERSION = 'furypipe-gateway/v1' as const;
export const FURY_GATEWAY_CONNECT_FORMAT = 'furypipe-gateway-connect/v1' as const;
export const FURY_GATEWAY_HEALTH_FORMAT = 'furypipe-gateway-health/v1' as const;

export const FURY_GATEWAY_ROLES = ['operator', 'node', 'channel', 'worker'] as const;
export type FuryGatewayRole = (typeof FURY_GATEWAY_ROLES)[number];

export interface FuryGatewayClientIdentity {
  readonly clientId: string;
  readonly instanceId: string;
  readonly platform?: string;
  readonly deviceFamily?: string;
}

export interface FuryGatewayConnectEnvelope {
  readonly format: typeof FURY_GATEWAY_CONNECT_FORMAT;
  readonly protocolVersion: typeof FURY_GATEWAY_PROTOCOL_VERSION;
  readonly role: FuryGatewayRole;
  readonly client: FuryGatewayClientIdentity;
  readonly capabilities: readonly string[];
  readonly commands: readonly string[];
  /**
   * A parsed connect envelope is descriptive evidence only.
   * Authentication/pairing happens at a separate transport boundary.
   */
  readonly authority: 'unverified';
}

export interface FuryGatewayHealthSnapshot {
  readonly format: typeof FURY_GATEWAY_HEALTH_FORMAT;
  readonly protocolVersion: typeof FURY_GATEWAY_PROTOCOL_VERSION;
  readonly status: 'starting' | 'ready' | 'draining';
  readonly startedAt: number;
  readonly observedAt: number;
  readonly uptimeMs: number;
  readonly connections: Readonly<Record<FuryGatewayRole, number>>;
  readonly sessions: number;
  readonly automations: number;
  readonly workers: number;
}

export type FuryGatewayProtocolErrorCode =
  | 'invalid-envelope'
  | 'unsupported-format'
  | 'unsupported-protocol'
  | 'invalid-role'
  | 'invalid-client'
  | 'invalid-capability'
  | 'invalid-command'
  | 'limit-exceeded';

export class FuryGatewayProtocolError extends Error {
  readonly code: FuryGatewayProtocolErrorCode;

  constructor(code: FuryGatewayProtocolErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayProtocolError';
    this.code = code;
  }
}

const MAX_CLIENT_ID_BYTES = 128;
const MAX_INSTANCE_ID_BYTES = 128;
const MAX_PLATFORM_BYTES = 48;
const MAX_DEVICE_FAMILY_BYTES = 64;
const MAX_CAPABILITY_BYTES = 96;
const MAX_COMMAND_BYTES = 96;
const MAX_CAPABILITIES = 64;
const MAX_COMMANDS = 128;
const MAX_COUNTER = 1_000_000_000;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const CAPABILITY_RE = /^[a-z][a-z0-9._:-]*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  errorCode: FuryGatewayProtocolErrorCode,
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new FuryGatewayProtocolError(errorCode, `${label} contains unsupported field: ${key}`);
    }
  }
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function boundedString(
  value: unknown,
  label: string,
  maxBytes: number,
  pattern: RegExp,
  code: FuryGatewayProtocolErrorCode,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new FuryGatewayProtocolError(code, `${label} must be a non-empty canonical string`);
  }
  if (utf8Bytes(value) > maxBytes) {
    throw new FuryGatewayProtocolError('limit-exceeded', `${label} exceeds ${maxBytes} UTF-8 bytes`);
  }
  if (!pattern.test(value)) {
    throw new FuryGatewayProtocolError(code, `${label} contains unsupported characters`);
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxBytes: number,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, label, maxBytes, ID_RE, 'invalid-client');
}

function normalizeStringList(
  value: unknown,
  label: 'capabilities' | 'commands',
  maxItems: number,
  maxBytes: number,
  pattern: RegExp,
  errorCode: FuryGatewayProtocolErrorCode,
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new FuryGatewayProtocolError(errorCode, `${label} must be an array`);
  }
  if (value.length > maxItems) {
    throw new FuryGatewayProtocolError('limit-exceeded', `${label} exceeds ${maxItems} entries`);
  }

  const normalized = value.map((entry, index) =>
    boundedString(entry, `${label}[${index}]`, maxBytes, pattern, errorCode),
  );

  const seen = new Set<string>();
  for (const entry of normalized) {
    if (seen.has(entry)) {
      throw new FuryGatewayProtocolError(errorCode, `${label} contains duplicate entry: ${entry}`);
    }
    seen.add(entry);
  }

  normalized.sort();
  return Object.freeze(normalized);
}

function parseRole(value: unknown): FuryGatewayRole {
  if (typeof value !== 'string' || !(FURY_GATEWAY_ROLES as readonly string[]).includes(value)) {
    throw new FuryGatewayProtocolError('invalid-role', 'gateway role is unsupported');
  }
  return value as FuryGatewayRole;
}

function parseClient(value: unknown): FuryGatewayClientIdentity {
  if (!isRecord(value)) {
    throw new FuryGatewayProtocolError('invalid-client', 'client identity must be an object');
  }
  assertExactKeys(value, ['clientId', 'instanceId', 'platform', 'deviceFamily'], 'invalid-client', 'client');
  const clientId = boundedString(value.clientId, 'client.clientId', MAX_CLIENT_ID_BYTES, ID_RE, 'invalid-client');
  const instanceId = boundedString(
    value.instanceId,
    'client.instanceId',
    MAX_INSTANCE_ID_BYTES,
    ID_RE,
    'invalid-client',
  );
  const platform = optionalBoundedString(value.platform, 'client.platform', MAX_PLATFORM_BYTES);
  const deviceFamily = optionalBoundedString(
    value.deviceFamily,
    'client.deviceFamily',
    MAX_DEVICE_FAMILY_BYTES,
  );
  return Object.freeze({
    clientId,
    instanceId,
    ...(platform === undefined ? {} : { platform }),
    ...(deviceFamily === undefined ? {} : { deviceFamily }),
  });
}

/**
 * Parse the public, credential-free Fury Gateway handshake.
 *
 * Important: a valid envelope is NOT authentication and never grants authority.
 * The transport/pairing layer must bind a verified principal separately.
 */
export function parseFuryGatewayConnectEnvelope(value: unknown): FuryGatewayConnectEnvelope {
  if (!isRecord(value)) {
    throw new FuryGatewayProtocolError('invalid-envelope', 'gateway connect envelope must be an object');
  }
  assertExactKeys(
    value,
    ['format', 'protocolVersion', 'role', 'client', 'capabilities', 'commands'],
    'invalid-envelope',
    'gateway connect envelope',
  );

  if (value.format !== FURY_GATEWAY_CONNECT_FORMAT) {
    throw new FuryGatewayProtocolError('unsupported-format', 'unsupported gateway connect format');
  }
  if (value.protocolVersion !== FURY_GATEWAY_PROTOCOL_VERSION) {
    throw new FuryGatewayProtocolError('unsupported-protocol', 'unsupported Fury Gateway protocol version');
  }

  const role = parseRole(value.role);
  const client = parseClient(value.client);
  const capabilities = normalizeStringList(
    value.capabilities,
    'capabilities',
    MAX_CAPABILITIES,
    MAX_CAPABILITY_BYTES,
    CAPABILITY_RE,
    'invalid-capability',
  );
  const commands = normalizeStringList(
    value.commands,
    'commands',
    MAX_COMMANDS,
    MAX_COMMAND_BYTES,
    CAPABILITY_RE,
    'invalid-command',
  );

  if ((role === 'operator' || role === 'channel') && commands.length > 0) {
    throw new FuryGatewayProtocolError(
      'invalid-command',
      `${role} connections may not advertise executable commands`,
    );
  }

  return Object.freeze({
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role,
    client,
    capabilities,
    commands,
    authority: 'unverified',
  });
}

export function deriveFuryGatewayConnectFingerprint(envelope: FuryGatewayConnectEnvelope): string {
  const canonical = JSON.stringify({
    format: envelope.format,
    protocolVersion: envelope.protocolVersion,
    role: envelope.role,
    client: envelope.client,
    capabilities: [...envelope.capabilities],
    commands: [...envelope.commands],
    authority: 'unverified',
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function finiteTimestamp(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative timestamp`);
  }
  return value;
}

function boundedCounter(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COUNTER) {
    throw new RangeError(`${label} must be an integer between 0 and ${MAX_COUNTER}`);
  }
  return value;
}

export interface FuryGatewayHealthInput {
  readonly status: FuryGatewayHealthSnapshot['status'];
  readonly startedAt: number;
  readonly observedAt: number;
  readonly connections?: Partial<Record<FuryGatewayRole, number>>;
  readonly sessions?: number;
  readonly automations?: number;
  readonly workers?: number;
}

/**
 * Create a bounded health snapshot. Health is observability only; it never
 * implies that providers, channels, tools, automations or workers are authorized.
 */
export function createFuryGatewayHealthSnapshot(input: FuryGatewayHealthInput): FuryGatewayHealthSnapshot {
  if (!input || typeof input !== 'object') throw new TypeError('gateway health input is required');
  if (!['starting', 'ready', 'draining'].includes(input.status)) {
    throw new RangeError('gateway health status is unsupported');
  }
  const startedAt = finiteTimestamp(input.startedAt, 'startedAt');
  const observedAt = finiteTimestamp(input.observedAt, 'observedAt');
  if (observedAt < startedAt) throw new RangeError('observedAt must be greater than or equal to startedAt');

  const connections = Object.freeze(Object.fromEntries(
    FURY_GATEWAY_ROLES.map((role) => [
      role,
      boundedCounter(input.connections?.[role] ?? 0, `connections.${role}`),
    ]),
  ) as Record<FuryGatewayRole, number>);

  return Object.freeze({
    format: FURY_GATEWAY_HEALTH_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    status: input.status,
    startedAt,
    observedAt,
    uptimeMs: Math.floor(observedAt - startedAt),
    connections,
    sessions: boundedCounter(input.sessions ?? 0, 'sessions'),
    automations: boundedCounter(input.automations ?? 0, 'automations'),
    workers: boundedCounter(input.workers ?? 0, 'workers'),
  });
}
