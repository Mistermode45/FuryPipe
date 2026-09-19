import { createHash } from 'node:crypto';

export const FURY_GATEWAY_PROTOCOL_VERSION = 'furypipe-gateway/v1' as const;
export const FURY_GATEWAY_CONNECT_FORMAT = 'furypipe-gateway-connect/v1' as const;
export const FURY_GATEWAY_HEALTH_FORMAT = 'furypipe-gateway-health/v1' as const;
export const FURY_GATEWAY_MESSAGE_FORMAT = 'furypipe-gateway-message/v1' as const;

export const FURY_GATEWAY_MESSAGE_KINDS = [
  'request',
  'response',
  'event',
  'ack',
  'ping',
  'pong',
  'error',
] as const;
export type FuryGatewayMessageKind = (typeof FURY_GATEWAY_MESSAGE_KINDS)[number];

export interface FuryGatewayMessageEnvelope {
  readonly format: typeof FURY_GATEWAY_MESSAGE_FORMAT;
  readonly protocolVersion: typeof FURY_GATEWAY_PROTOCOL_VERSION;
  readonly messageId: string;
  readonly sequence: number;
  readonly kind: FuryGatewayMessageKind;
  readonly type: string;
  /** Informational client/server timestamp only; never used for authorization freshness. */
  readonly sentAt: number;
  readonly payload: unknown;
  /** Parsed transport data is descriptive only and never grants authority. */
  readonly authority: 'transport-data-only';
}

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
  | 'invalid-message'
  | 'invalid-message-id'
  | 'invalid-sequence'
  | 'invalid-message-kind'
  | 'invalid-message-type'
  | 'invalid-payload'
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
export const FURY_GATEWAY_MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_MESSAGE_ID_BYTES = 128;
const MAX_MESSAGE_TYPE_BYTES = 96;
const MAX_MESSAGE_PAYLOAD_DEPTH = 16;
const MAX_MESSAGE_PAYLOAD_NODES = 4_096;
const MAX_MESSAGE_OBJECT_KEYS = 128;
const MAX_MESSAGE_ARRAY_ITEMS = 256;
const MAX_MESSAGE_STRING_BYTES = 16 * 1024;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const CAPABILITY_RE = /^[a-z][a-z0-9._:-]*$/u;
const MESSAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const MESSAGE_TYPE_RE = /^[a-z][a-z0-9._:-]*$/u;
const DANGEROUS_PAYLOAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

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


function assertBoundedGatewayPayload(value: unknown): void {
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_MESSAGE_PAYLOAD_NODES) {
      throw new FuryGatewayProtocolError(
        'limit-exceeded',
        \`gateway message payload exceeds \${MAX_MESSAGE_PAYLOAD_NODES} nodes\`,
      );
    }
    if (depth > MAX_MESSAGE_PAYLOAD_DEPTH) {
      throw new FuryGatewayProtocolError(
        'limit-exceeded',
        \`gateway message payload exceeds depth \${MAX_MESSAGE_PAYLOAD_DEPTH}\`,
      );
    }
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new FuryGatewayProtocolError('invalid-payload', 'gateway message payload contains a non-finite number');
      }
      return;
    }
    if (typeof current === 'string') {
      if (utf8Bytes(current) > MAX_MESSAGE_STRING_BYTES || current.includes('\u0000')) {
        throw new FuryGatewayProtocolError(
          'limit-exceeded',
          \`gateway message payload string exceeds \${MAX_MESSAGE_STRING_BYTES} UTF-8 bytes or contains NUL\`,
        );
      }
      return;
    }
    if (Array.isArray(current)) {
      if (current.length > MAX_MESSAGE_ARRAY_ITEMS) {
        throw new FuryGatewayProtocolError(
          'limit-exceeded',
          \`gateway message payload array exceeds \${MAX_MESSAGE_ARRAY_ITEMS} items\`,
        );
      }
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (!isRecord(current)) {
      throw new FuryGatewayProtocolError('invalid-payload', 'gateway message payload must be JSON-compatible data');
    }
    const keys = Object.keys(current);
    if (keys.length > MAX_MESSAGE_OBJECT_KEYS) {
      throw new FuryGatewayProtocolError(
        'limit-exceeded',
        \`gateway message payload object exceeds \${MAX_MESSAGE_OBJECT_KEYS} keys\`,
      );
    }
    for (const key of keys) {
      if (DANGEROUS_PAYLOAD_KEYS.has(key) || key.includes('\u0000')) {
        throw new FuryGatewayProtocolError('invalid-payload', 'gateway message payload contains an unsafe object key');
      }
      if (utf8Bytes(key) > MAX_MESSAGE_TYPE_BYTES) {
        throw new FuryGatewayProtocolError('limit-exceeded', 'gateway message payload key exceeds its byte bound');
      }
      visit(current[key], depth + 1);
    }
  };
  visit(value, 0);
}

function parseMessageKind(value: unknown): FuryGatewayMessageKind {
  if (
    typeof value !== 'string'
    || !(FURY_GATEWAY_MESSAGE_KINDS as readonly string[]).includes(value)
  ) {
    throw new FuryGatewayProtocolError('invalid-message-kind', 'gateway message kind is unsupported');
  }
  return value as FuryGatewayMessageKind;
}

function parseMessageSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new FuryGatewayProtocolError(
      'invalid-sequence',
      'gateway message sequence must be a positive safe integer',
    );
  }
  return value as number;
}

function parseMessageTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FuryGatewayProtocolError(
      'invalid-message',
      'gateway message sentAt must be a non-negative safe integer',
    );
  }
  return value as number;
}

/**
 * Parse one bounded Fury Gateway transport message from UTF-8 JSON.
 *
 * This parser deliberately does not authenticate a principal, authorize a
 * command, or imply successful execution. The resulting object is data only.
 */
export function parseFuryGatewayMessageText(text: string): FuryGatewayMessageEnvelope {
  if (typeof text !== 'string') {
    throw new FuryGatewayProtocolError('invalid-message', 'gateway message must be UTF-8 text');
  }
  const bytes = utf8Bytes(text);
  if (bytes === 0) {
    throw new FuryGatewayProtocolError('invalid-message', 'gateway message must not be empty');
  }
  if (bytes > FURY_GATEWAY_MAX_MESSAGE_BYTES) {
    throw new FuryGatewayProtocolError(
      'limit-exceeded',
      \`gateway message exceeds \${FURY_GATEWAY_MAX_MESSAGE_BYTES} UTF-8 bytes\`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FuryGatewayProtocolError('invalid-message', 'gateway message is not valid JSON');
  }
  if (!isRecord(parsed)) {
    throw new FuryGatewayProtocolError('invalid-message', 'gateway message must be a JSON object');
  }
  assertExactKeys(
    parsed,
    ['format', 'protocolVersion', 'messageId', 'sequence', 'kind', 'type', 'sentAt', 'payload'],
    'invalid-message',
    'gateway message',
  );
  if (parsed.format !== FURY_GATEWAY_MESSAGE_FORMAT) {
    throw new FuryGatewayProtocolError('unsupported-format', 'unsupported gateway message format');
  }
  if (parsed.protocolVersion !== FURY_GATEWAY_PROTOCOL_VERSION) {
    throw new FuryGatewayProtocolError('unsupported-protocol', 'unsupported Fury Gateway protocol version');
  }

  const messageId = boundedString(
    parsed.messageId,
    'messageId',
    MAX_MESSAGE_ID_BYTES,
    MESSAGE_ID_RE,
    'invalid-message-id',
  );
  const sequence = parseMessageSequence(parsed.sequence);
  const kind = parseMessageKind(parsed.kind);
  const type = boundedString(
    parsed.type,
    'type',
    MAX_MESSAGE_TYPE_BYTES,
    MESSAGE_TYPE_RE,
    'invalid-message-type',
  );
  const sentAt = parseMessageTimestamp(parsed.sentAt);
  assertBoundedGatewayPayload(parsed.payload);

  return Object.freeze({
    format: FURY_GATEWAY_MESSAGE_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    messageId,
    sequence,
    kind,
    type,
    sentAt,
    payload: parsed.payload,
    authority: 'transport-data-only',
  });
}

/**
 * Serialize a validated Fury Gateway transport message and re-apply the same
 * byte/structure bounds used by the parser.
 */
export function serializeFuryGatewayMessage(
  input: Omit<FuryGatewayMessageEnvelope, 'authority'>,
): string {
  const candidate = JSON.stringify({
    format: input.format,
    protocolVersion: input.protocolVersion,
    messageId: input.messageId,
    sequence: input.sequence,
    kind: input.kind,
    type: input.type,
    sentAt: input.sentAt,
    payload: input.payload,
  });
  // Parsing the serialized form gives us one canonical validation path.
  parseFuryGatewayMessageText(candidate);
  return candidate;
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