import { createHash, randomBytes } from 'node:crypto';

import type {
  FuryGatewayAuthenticatedDevice,
} from './gateway-auth-node.js';
import {
  evaluateFuryGatewayCommandAdmission,
  type FuryGatewayCommandAdmissionDecision,
  type FuryGatewayCommandRegistry,
} from './gateway-command-authorization-node.js';
import type {
  FuryGatewayPairingCoordinator,
} from './gateway-pairing-node.js';
import {
  isGeneratedFuryGatewaySessionLease,
  type FuryGatewaySessionCoordinator,
  type FuryGatewaySessionLease,
} from './gateway-session-node.js';
import type { FuryGatewayRole } from './gateway.js';
import type { FuryPluginPermission } from './plugin-bundles.js';

export const FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT = 'furypipe-gateway-message/v1' as const;
export const FURY_GATEWAY_TRANSPORT_RECEIPT_FORMAT = 'furypipe-gateway-transport-receipt/v1' as const;
export const FURY_GATEWAY_TRANSPORT_CONNECTION_FORMAT = 'furypipe-gateway-transport-connection/v1' as const;

export type FuryGatewayTransportClientKind = 'browser' | 'device';

export type FuryGatewayTransportMessageType =
  | 'command'
  | 'ping'
  | 'resync';

export interface FuryGatewayTransportCommandPayload {
  readonly commandName: string;
  readonly declaredPluginPermissions: readonly FuryPluginPermission[];
  readonly input: unknown;
}

export interface FuryGatewayTransportPingPayload {
  readonly nonce: string;
}

export interface FuryGatewayTransportResyncPayload {
  readonly cursor: string;
}

export type FuryGatewayTransportPayload =
  | FuryGatewayTransportCommandPayload
  | FuryGatewayTransportPingPayload
  | FuryGatewayTransportResyncPayload;

export interface FuryGatewayTransportMessage {
  readonly format: typeof FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT;
  readonly messageId: string;
  readonly connectionId: string;
  readonly sequence: number;
  readonly type: FuryGatewayTransportMessageType;
  readonly sentAt: number;
  readonly payload: FuryGatewayTransportPayload;
}

export interface FuryGatewayTransportConnection {
  readonly format: typeof FURY_GATEWAY_TRANSPORT_CONNECTION_FORMAT;
  readonly connectionId: string;
  readonly role: FuryGatewayRole;
  readonly principalIdSha256: string;
  readonly sessionIdSha256: string;
  readonly clientKind: FuryGatewayTransportClientKind;
  readonly remoteAddress: string;
  readonly origin?: string;
  readonly openedAt: number;
  readonly authority: 'transport-connection';
  readonly executionAuthority: false;
}

export interface FuryGatewayTransportReceipt {
  readonly format: typeof FURY_GATEWAY_TRANSPORT_RECEIPT_FORMAT;
  readonly receiptIdSha256: string;
  readonly connectionId: string;
  readonly messageId: string;
  readonly sequence: number;
  readonly status: 'transport-received';
  readonly executionAuthority: false;
}

export interface FuryGatewayTransportAcceptedMessage {
  readonly message: FuryGatewayTransportMessage;
  readonly receipt: FuryGatewayTransportReceipt;
  readonly release: () => void;
}

export interface FuryGatewayTransportCommandEvaluation {
  readonly transportReceipt: FuryGatewayTransportReceipt;
  readonly admission: FuryGatewayCommandAdmissionDecision;
  readonly executionAuthority: false;
}

export type FuryGatewayTransportErrorCode =
  | 'invalid-config'
  | 'invalid-connection'
  | 'invalid-session'
  | 'role-mismatch'
  | 'remote-disabled'
  | 'origin-required'
  | 'origin-denied'
  | 'connection-limit'
  | 'principal-connection-limit'
  | 'invalid-message'
  | 'unsupported-message'
  | 'payload-too-large'
  | 'rate-limited'
  | 'backpressure'
  | 'sequence-replay'
  | 'sequence-gap'
  | 'connection-closed'
  | 'command-required';

export class FuryGatewayTransportError extends Error {
  readonly code: FuryGatewayTransportErrorCode;

  constructor(code: FuryGatewayTransportErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayTransportError';
    this.code = code;
  }
}

export interface FuryGatewayTransportCoordinatorOptions {
  readonly sessionCoordinator: FuryGatewaySessionCoordinator;
  readonly now?: () => number;
  readonly allowRemote?: boolean;
  readonly allowedOrigins?: readonly string[];
  readonly maxPayloadBytes?: number;
  readonly maxConnections?: number;
  readonly maxConnectionsPerPrincipal?: number;
  readonly rateWindowMs?: number;
  readonly maxMessagesPerWindow?: number;
  readonly maxInFlightMessages?: number;
  readonly maxInFlightBytes?: number;
}

export interface FuryGatewayOpenTransportConnectionInput {
  readonly session: FuryGatewaySessionLease;
  readonly clientKind: FuryGatewayTransportClientKind;
  readonly remoteAddress: string;
  readonly origin?: string;
}

export interface FuryGatewayEvaluateTransportCommandInput {
  readonly connection: FuryGatewayTransportConnection;
  readonly accepted: FuryGatewayTransportAcceptedMessage;
  readonly commandRegistry: FuryGatewayCommandRegistry;
  readonly currentDevice?: FuryGatewayAuthenticatedDevice;
  readonly pairing?: FuryGatewayPairingCoordinator;
}

export interface FuryGatewayTransportCoordinator {
  openConnection(input: FuryGatewayOpenTransportConnectionInput): FuryGatewayTransportConnection;
  acceptTextMessage(
    connection: FuryGatewayTransportConnection,
    raw: string,
  ): FuryGatewayTransportAcceptedMessage;
  evaluateCommand(
    input: FuryGatewayEvaluateTransportCommandInput,
  ): FuryGatewayTransportCommandEvaluation;
  closeConnection(connection: FuryGatewayTransportConnection): boolean;
  isOpen(connection: FuryGatewayTransportConnection): boolean;
  connectionCount(): number;
}

interface ConnectionState {
  readonly evidence: FuryGatewayTransportConnection;
  readonly session: FuryGatewaySessionLease;
  nextSequence: number;
  windowStartedAt: number;
  messagesInWindow: number;
  inFlightMessages: number;
  inFlightBytes: number;
  open: boolean;
}

const CONNECTION_EVIDENCE = new WeakSet<object>();
const ACCEPTED_EVIDENCE = new WeakSet<object>();

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const MIN_MAX_PAYLOAD_BYTES = 1024;
const HARD_MAX_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_MAX_CONNECTIONS = 512;
const HARD_MAX_CONNECTIONS = 16_384;
const DEFAULT_MAX_CONNECTIONS_PER_PRINCIPAL = 8;
const HARD_MAX_CONNECTIONS_PER_PRINCIPAL = 128;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const MIN_RATE_WINDOW_MS = 1000;
const HARD_MAX_RATE_WINDOW_MS = 10 * 60_000;
const DEFAULT_MAX_MESSAGES_PER_WINDOW = 120;
const HARD_MAX_MESSAGES_PER_WINDOW = 10_000;
const DEFAULT_MAX_IN_FLIGHT_MESSAGES = 32;
const HARD_MAX_IN_FLIGHT_MESSAGES = 1024;
const DEFAULT_MAX_IN_FLIGHT_BYTES = 512 * 1024;
const HARD_MAX_IN_FLIGHT_BYTES = 8 * 1024 * 1024;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 4096;
const MAX_MESSAGE_ID_BYTES = 96;
const MAX_COMMAND_NAME_BYTES = 128;
const MAX_NONCE_BYTES = 128;
const MAX_CURSOR_BYTES = 256;

const MESSAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const COMMAND_NAME_RE = /^[a-z][a-z0-9._:-]*$/u;
const SAFE_TEXT_RE = /^[A-Za-z0-9._:@/+\-=]*$/u;
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PLUGIN_PERMISSIONS = new Set<FuryPluginPermission>([
  'network',
  'browser',
  'process',
  'repository-read',
  'repository-write',
  'database-read',
  'database-write',
  'design-read',
  'design-write',
  'cloud-read',
  'cloud-write',
  'provider-inference',
  'provider-management',
]);

function finiteNow(now: () => number): number {
  const value = now();
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(normalized)) {
    throw new FuryGatewayTransportError(
      'invalid-config',
      'Gateway transport clock must return a safe non-negative timestamp',
    );
  }
  return normalized;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new FuryGatewayTransportError(
      'invalid-config',
      `${label} must be an integer between ${min} and ${max}`,
    );
  }
  return resolved;
}

function boundedText(
  value: unknown,
  label: string,
  maxBytes: number,
  pattern: RegExp,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || !pattern.test(value)
  ) {
    throw new FuryGatewayTransportError('invalid-message', `${label} is invalid`);
  }
  return value;
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FuryGatewayTransportError('invalid-message', `${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FuryGatewayTransportError(
      'invalid-message',
      `${label} must use a plain-object prototype`,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new FuryGatewayTransportError('invalid-message', `${label} must not contain symbol keys`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    if (POLLUTION_KEYS.has(key) || !allowed.has(key)) {
      throw new FuryGatewayTransportError(
        'invalid-message',
        `${label} contains unsupported field: ${key}`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryGatewayTransportError(
        'invalid-message',
        `${label} must contain enumerable data properties only`,
      );
    }
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayTransportError(
        'invalid-message',
        `${label} is missing required field: ${key}`,
      );
    }
  }
  return record;
}

function validateJsonValue(value: unknown): void {
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new FuryGatewayTransportError(
        'invalid-message',
        'Gateway message JSON exceeds structural bounds',
      );
    }
    if (
      current === null
      || typeof current === 'string'
      || typeof current === 'boolean'
    ) {
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new FuryGatewayTransportError('invalid-message', 'Gateway JSON numbers must be finite');
      }
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (typeof current === 'object') {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new FuryGatewayTransportError('invalid-message', 'Gateway JSON objects must be plain');
      }
      for (const key of Object.keys(current as Record<string, unknown>)) {
        if (POLLUTION_KEYS.has(key)) {
          throw new FuryGatewayTransportError('invalid-message', 'Gateway JSON contains unsafe keys');
        }
        visit((current as Record<string, unknown>)[key], depth + 1);
      }
      return;
    }
    throw new FuryGatewayTransportError('invalid-message', 'Gateway JSON contains unsupported values');
  };
  visit(value, 0);
}

function isLoopback(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FuryGatewayTransportError('origin-denied', 'Gateway browser Origin is invalid');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    throw new FuryGatewayTransportError(
      'origin-denied',
      'Gateway browser Origin must be an exact HTTP(S) origin',
    );
  }
  return parsed.origin;
}

function normalizeAllowedOrigins(origins: readonly string[] | undefined): ReadonlySet<string> {
  if (origins === undefined) return new Set();
  if (!Array.isArray(origins) || origins.length > 64) {
    throw new FuryGatewayTransportError('invalid-config', 'allowedOrigins exceeds its bound');
  }
  const normalized = new Set<string>();
  for (const origin of origins) {
    if (typeof origin !== 'string' || origin.includes('*')) {
      throw new FuryGatewayTransportError(
        'invalid-config',
        'Gateway allowed Origins must be exact and wildcard-free',
      );
    }
    const exact = normalizeOrigin(origin);
    if (normalized.has(exact)) {
      throw new FuryGatewayTransportError('invalid-config', 'Gateway allowed Origins contain duplicates');
    }
    normalized.add(exact);
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isGeneratedConnection(
  value: unknown,
): value is FuryGatewayTransportConnection {
  return typeof value === 'object' && value !== null && CONNECTION_EVIDENCE.has(value);
}

function parsePluginPermissions(value: unknown): readonly FuryPluginPermission[] {
  if (!Array.isArray(value) || value.length > PLUGIN_PERMISSIONS.size) {
    throw new FuryGatewayTransportError(
      'invalid-message',
      'declaredPluginPermissions is invalid',
    );
  }
  const seen = new Set<FuryPluginPermission>();
  const normalized: FuryPluginPermission[] = [];
  for (const item of value) {
    if (
      typeof item !== 'string'
      || !PLUGIN_PERMISSIONS.has(item as FuryPluginPermission)
      || seen.has(item as FuryPluginPermission)
    ) {
      throw new FuryGatewayTransportError(
        'invalid-message',
        'declaredPluginPermissions contains unknown or duplicate permissions',
      );
    }
    const permission = item as FuryPluginPermission;
    seen.add(permission);
    normalized.push(permission);
  }
  normalized.sort();
  return Object.freeze(normalized);
}

function parsePayload(type: FuryGatewayTransportMessageType, value: unknown): FuryGatewayTransportPayload {
  if (type === 'command') {
    const record = exactRecord(
      value,
      ['commandName', 'declaredPluginPermissions', 'input'],
      'command payload',
    );
    const commandName = boundedText(
      record.commandName,
      'commandName',
      MAX_COMMAND_NAME_BYTES,
      COMMAND_NAME_RE,
    );
    const declaredPluginPermissions = parsePluginPermissions(record.declaredPluginPermissions);
    validateJsonValue(record.input);
    return Object.freeze({
      commandName,
      declaredPluginPermissions,
      input: record.input,
    });
  }

  if (type === 'ping') {
    const record = exactRecord(value, ['nonce'], 'ping payload');
    return Object.freeze({
      nonce: boundedText(record.nonce, 'ping nonce', MAX_NONCE_BYTES, SAFE_TEXT_RE),
    });
  }

  if (type === 'resync') {
    const record = exactRecord(value, ['cursor'], 'resync payload');
    return Object.freeze({
      cursor: boundedText(record.cursor, 'resync cursor', MAX_CURSOR_BYTES, SAFE_TEXT_RE),
    });
  }

  throw new FuryGatewayTransportError('unsupported-message', 'Gateway message type is unsupported');
}

function parseMessage(raw: string, maxPayloadBytes: number): FuryGatewayTransportMessage {
  if (typeof raw !== 'string') {
    throw new FuryGatewayTransportError(
      'invalid-message',
      'Gateway transport accepts text frames only',
    );
  }
  const bytes = Buffer.byteLength(raw, 'utf8');
  if (bytes === 0) {
    throw new FuryGatewayTransportError('invalid-message', 'Gateway message is empty');
  }
  if (bytes > maxPayloadBytes) {
    throw new FuryGatewayTransportError(
      'payload-too-large',
      `Gateway message exceeds ${maxPayloadBytes} UTF-8 bytes`,
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new FuryGatewayTransportError('invalid-message', 'Gateway message is not valid JSON');
  }
  validateJsonValue(decoded);

  const record = exactRecord(
    decoded,
    ['format', 'messageId', 'connectionId', 'sequence', 'type', 'sentAt', 'payload'],
    'Gateway message',
  );
  if (record.format !== FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT) {
    throw new FuryGatewayTransportError('invalid-message', 'unsupported Gateway message format');
  }
  const messageId = boundedText(
    record.messageId,
    'messageId',
    MAX_MESSAGE_ID_BYTES,
    MESSAGE_ID_RE,
  );
  const connectionId = boundedText(
    record.connectionId,
    'connectionId',
    64,
    MESSAGE_ID_RE,
  );
  if (!Number.isSafeInteger(record.sequence) || (record.sequence as number) < 1) {
    throw new FuryGatewayTransportError('invalid-message', 'Gateway sequence must be a positive safe integer');
  }
  if (!Number.isSafeInteger(record.sentAt) || (record.sentAt as number) < 0) {
    throw new FuryGatewayTransportError('invalid-message', 'Gateway sentAt must be a non-negative safe integer');
  }
  if (
    record.type !== 'command'
    && record.type !== 'ping'
    && record.type !== 'resync'
  ) {
    throw new FuryGatewayTransportError('unsupported-message', 'Gateway message type is unsupported');
  }
  const type = record.type;
  const payload = parsePayload(type, record.payload);

  return Object.freeze({
    format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
    messageId,
    connectionId,
    sequence: record.sequence as number,
    type,
    sentAt: record.sentAt as number,
    payload,
  });
}

export function createFuryGatewayTransportCoordinator(
  options: FuryGatewayTransportCoordinatorOptions,
): FuryGatewayTransportCoordinator {
  if (!options || typeof options !== 'object' || !options.sessionCoordinator) {
    throw new FuryGatewayTransportError(
      'invalid-config',
      'Gateway transport requires a session coordinator',
    );
  }

  const sessionCoordinator = options.sessionCoordinator;
  const now = options.now ?? Date.now;
  const allowRemote = options.allowRemote ?? false;
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  const maxPayloadBytes = boundedInteger(
    options.maxPayloadBytes,
    DEFAULT_MAX_PAYLOAD_BYTES,
    MIN_MAX_PAYLOAD_BYTES,
    HARD_MAX_PAYLOAD_BYTES,
    'maxPayloadBytes',
  );
  const maxConnections = boundedInteger(
    options.maxConnections,
    DEFAULT_MAX_CONNECTIONS,
    1,
    HARD_MAX_CONNECTIONS,
    'maxConnections',
  );
  const maxConnectionsPerPrincipal = boundedInteger(
    options.maxConnectionsPerPrincipal,
    DEFAULT_MAX_CONNECTIONS_PER_PRINCIPAL,
    1,
    HARD_MAX_CONNECTIONS_PER_PRINCIPAL,
    'maxConnectionsPerPrincipal',
  );
  const rateWindowMs = boundedInteger(
    options.rateWindowMs,
    DEFAULT_RATE_WINDOW_MS,
    MIN_RATE_WINDOW_MS,
    HARD_MAX_RATE_WINDOW_MS,
    'rateWindowMs',
  );
  const maxMessagesPerWindow = boundedInteger(
    options.maxMessagesPerWindow,
    DEFAULT_MAX_MESSAGES_PER_WINDOW,
    1,
    HARD_MAX_MESSAGES_PER_WINDOW,
    'maxMessagesPerWindow',
  );
  const maxInFlightMessages = boundedInteger(
    options.maxInFlightMessages,
    DEFAULT_MAX_IN_FLIGHT_MESSAGES,
    1,
    HARD_MAX_IN_FLIGHT_MESSAGES,
    'maxInFlightMessages',
  );
  const maxInFlightBytes = boundedInteger(
    options.maxInFlightBytes,
    DEFAULT_MAX_IN_FLIGHT_BYTES,
    maxPayloadBytes,
    HARD_MAX_IN_FLIGHT_BYTES,
    'maxInFlightBytes',
  );

  const states = new Map<string, ConnectionState>();
  const principalCounts = new Map<string, number>();

  const resolveState = (connection: FuryGatewayTransportConnection): ConnectionState => {
    if (!isGeneratedConnection(connection)) {
      throw new FuryGatewayTransportError(
        'invalid-connection',
        'Gateway connection must be process-local transport evidence',
      );
    }
    const state = states.get(connection.connectionId);
    if (!state || state.evidence !== connection) {
      throw new FuryGatewayTransportError(
        'invalid-connection',
        'Gateway connection is not owned by this coordinator',
      );
    }
    if (!state.open) {
      throw new FuryGatewayTransportError('connection-closed', 'Gateway connection is closed');
    }
    return state;
  };

  const decrementPrincipal = (principalId: string): void => {
    const current = principalCounts.get(principalId) ?? 0;
    if (current <= 1) principalCounts.delete(principalId);
    else principalCounts.set(principalId, current - 1);
  };

  return Object.freeze({
    openConnection(input: FuryGatewayOpenTransportConnectionInput): FuryGatewayTransportConnection {
      const openedAt = finiteNow(now);
      if (
        !input
        || typeof input !== 'object'
        || !isGeneratedFuryGatewaySessionLease(input.session)
        || !sessionCoordinator.isActiveSession(input.session)
      ) {
        throw new FuryGatewayTransportError(
          'invalid-session',
          'Gateway transport requires an active process-local session',
        );
      }
      if (input.clientKind !== 'browser' && input.clientKind !== 'device') {
        throw new FuryGatewayTransportError('invalid-connection', 'Gateway client kind is unsupported');
      }
      if (
        typeof input.remoteAddress !== 'string'
        || input.remoteAddress.length === 0
        || input.remoteAddress.length > 128
      ) {
        throw new FuryGatewayTransportError('invalid-connection', 'Gateway remote address is invalid');
      }
      if (!allowRemote && !isLoopback(input.remoteAddress)) {
        throw new FuryGatewayTransportError(
          'remote-disabled',
          'Gateway remote connections are disabled',
        );
      }

      let origin: string | undefined;
      if (input.clientKind === 'browser') {
        if (typeof input.origin !== 'string' || input.origin.length === 0) {
          throw new FuryGatewayTransportError(
            'origin-required',
            'Gateway browser connections require Origin',
          );
        }
        origin = normalizeOrigin(input.origin);
        if (!allowedOrigins.has(origin)) {
          throw new FuryGatewayTransportError(
            'origin-denied',
            'Gateway browser Origin is not allowlisted',
          );
        }
      } else if (input.origin !== undefined) {
        origin = normalizeOrigin(input.origin);
      }

      if (states.size >= maxConnections) {
        throw new FuryGatewayTransportError('connection-limit', 'Gateway connection limit reached');
      }
      const principalCount = principalCounts.get(input.session.principalId) ?? 0;
      if (principalCount >= maxConnectionsPerPrincipal) {
        throw new FuryGatewayTransportError(
          'principal-connection-limit',
          'Gateway principal connection limit reached',
        );
      }
      if (input.session.role !== 'operator' && input.clientKind === 'browser') {
        throw new FuryGatewayTransportError(
          'role-mismatch',
          'Browser transport is limited to operator sessions in Phase 1.3A',
        );
      }

      let connectionId: string;
      do {
        connectionId = randomBytes(18).toString('base64url');
      } while (states.has(connectionId));

      const evidence = Object.freeze({
        format: FURY_GATEWAY_TRANSPORT_CONNECTION_FORMAT,
        connectionId,
        role: input.session.role,
        principalIdSha256: sha256(input.session.principalId),
        sessionIdSha256: sha256(input.session.sessionId),
        clientKind: input.clientKind,
        remoteAddress: input.remoteAddress,
        ...(origin === undefined ? {} : { origin }),
        openedAt,
        authority: 'transport-connection' as const,
        executionAuthority: false as const,
      });
      CONNECTION_EVIDENCE.add(evidence);
      states.set(connectionId, {
        evidence,
        session: input.session,
        nextSequence: 1,
        windowStartedAt: openedAt,
        messagesInWindow: 0,
        inFlightMessages: 0,
        inFlightBytes: 0,
        open: true,
      });
      principalCounts.set(input.session.principalId, principalCount + 1);
      return evidence;
    },

    acceptTextMessage(
      connection: FuryGatewayTransportConnection,
      raw: string,
    ): FuryGatewayTransportAcceptedMessage {
      const at = finiteNow(now);
      const state = resolveState(connection);
      if (!sessionCoordinator.isActiveSession(state.session)) {
        throw new FuryGatewayTransportError(
          'invalid-session',
          'Gateway session is no longer active',
        );
      }

      const bytes = Buffer.byteLength(raw, 'utf8');
      if (bytes > maxPayloadBytes) {
        throw new FuryGatewayTransportError(
          'payload-too-large',
          `Gateway message exceeds ${maxPayloadBytes} UTF-8 bytes`,
        );
      }
      if (at - state.windowStartedAt >= rateWindowMs) {
        state.windowStartedAt = at;
        state.messagesInWindow = 0;
      }
      if (state.messagesInWindow >= maxMessagesPerWindow) {
        throw new FuryGatewayTransportError('rate-limited', 'Gateway connection rate limit reached');
      }
      if (
        state.inFlightMessages >= maxInFlightMessages
        || state.inFlightBytes + bytes > maxInFlightBytes
      ) {
        throw new FuryGatewayTransportError(
          'backpressure',
          'Gateway connection backpressure limit reached',
        );
      }

      const message = parseMessage(raw, maxPayloadBytes);
      if (message.connectionId !== connection.connectionId) {
        throw new FuryGatewayTransportError(
          'invalid-message',
          'Gateway message is bound to a different connection',
        );
      }
      if (message.sequence < state.nextSequence) {
        throw new FuryGatewayTransportError(
          'sequence-replay',
          'Gateway message sequence was already consumed',
        );
      }
      if (message.sequence > state.nextSequence) {
        throw new FuryGatewayTransportError(
          'sequence-gap',
          'Gateway message sequence contains a gap',
        );
      }

      state.nextSequence += 1;
      state.messagesInWindow += 1;
      state.inFlightMessages += 1;
      state.inFlightBytes += bytes;

      let released = false;
      const receipt = Object.freeze({
        format: FURY_GATEWAY_TRANSPORT_RECEIPT_FORMAT,
        receiptIdSha256: sha256(JSON.stringify({
          connectionId: connection.connectionId,
          messageId: message.messageId,
          sequence: message.sequence,
          status: 'transport-received',
        })),
        connectionId: connection.connectionId,
        messageId: message.messageId,
        sequence: message.sequence,
        status: 'transport-received' as const,
        executionAuthority: false as const,
      });
      const accepted = Object.freeze({
        message,
        receipt,
        release: (): void => {
          if (released) return;
          released = true;
          state.inFlightMessages = Math.max(0, state.inFlightMessages - 1);
          state.inFlightBytes = Math.max(0, state.inFlightBytes - bytes);
        },
      });
      ACCEPTED_EVIDENCE.add(accepted);
      return accepted;
    },

    evaluateCommand(
      input: FuryGatewayEvaluateTransportCommandInput,
    ): FuryGatewayTransportCommandEvaluation {
      if (!input || typeof input !== 'object') {
        throw new FuryGatewayTransportError('command-required', 'Gateway command input is required');
      }
      const state = resolveState(input.connection);
      if (
        !input.accepted
        || typeof input.accepted !== 'object'
        || !ACCEPTED_EVIDENCE.has(input.accepted)
      ) {
        throw new FuryGatewayTransportError(
          'invalid-message',
          'Gateway command requires process-local accepted-message evidence',
        );
      }
      if (input.accepted.message.connectionId !== input.connection.connectionId) {
        throw new FuryGatewayTransportError(
          'invalid-message',
          'Accepted Gateway message belongs to another connection',
        );
      }
      if (input.accepted.message.type !== 'command') {
        throw new FuryGatewayTransportError(
          'command-required',
          'Gateway command evaluation requires a command message',
        );
      }
      const payload = input.accepted.message.payload as FuryGatewayTransportCommandPayload;
      const admission = evaluateFuryGatewayCommandAdmission({
        sessionCoordinator,
        session: state.session,
        commandRegistry: input.commandRegistry,
        commandName: payload.commandName,
        declaredPluginPermissions: payload.declaredPluginPermissions,
        ...(input.currentDevice === undefined ? {} : { currentDevice: input.currentDevice }),
        ...(input.pairing === undefined ? {} : { pairing: input.pairing }),
      });
      return Object.freeze({
        transportReceipt: input.accepted.receipt,
        admission,
        executionAuthority: false as const,
      });
    },

    closeConnection(connection: FuryGatewayTransportConnection): boolean {
      if (!isGeneratedConnection(connection)) return false;
      const state = states.get(connection.connectionId);
      if (!state || state.evidence !== connection || !state.open) return false;
      state.open = false;
      states.delete(connection.connectionId);
      decrementPrincipal(state.session.principalId);
      return true;
    },

    isOpen(connection: FuryGatewayTransportConnection): boolean {
      if (!isGeneratedConnection(connection)) return false;
      const state = states.get(connection.connectionId);
      return state?.evidence === connection && state.open;
    },

    connectionCount(): number {
      return states.size;
    },
  });
}
