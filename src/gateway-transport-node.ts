import { randomBytes } from 'node:crypto';

import {
  FURY_GATEWAY_MESSAGE_FORMAT,
  FURY_GATEWAY_PROTOCOL_VERSION,
  FURY_GATEWAY_ROLES,
  deriveFuryGatewayConnectFingerprint,
  parseFuryGatewayConnectEnvelope,
  parseFuryGatewayMessageText,
  serializeFuryGatewayMessage,
  type FuryGatewayConnectEnvelope,
  type FuryGatewayMessageEnvelope,
  type FuryGatewayMessageKind,
  type FuryGatewayRole,
} from './gateway.js';

export const FURY_GATEWAY_TRANSPORT_CONNECTION_FORMAT =
  'furypipe-gateway-transport-connection/v1' as const;

export type FuryGatewaySecureTransport =
  | 'none'
  | 'tls'
  | 'authenticated-tunnel';

export interface FuryGatewayBindPolicyInput {
  readonly host?: string;
  readonly remoteEnabled?: boolean;
  readonly secureTransport?: FuryGatewaySecureTransport;
  readonly allowedBrowserOrigins?: readonly string[];
}

export interface FuryGatewayBindPolicy {
  readonly host: string;
  readonly remoteEnabled: boolean;
  readonly secureTransport: FuryGatewaySecureTransport;
  readonly allowedBrowserOrigins: readonly string[];
}

export interface FuryGatewayTransportConnectionMetadata {
  readonly clientKind: 'browser' | 'device';
  readonly origin?: string;
}

export interface FuryGatewayTransportConnection {
  readonly format: typeof FURY_GATEWAY_TRANSPORT_CONNECTION_FORMAT;
  readonly connectionId: string;
  readonly role: FuryGatewayRole;
  readonly clientId: string;
  readonly instanceId: string;
  readonly connectFingerprint: string;
  readonly openedAt: number;
  readonly authority: 'transport-connection-only';
}

export interface FuryGatewayOutboundMessageInput {
  readonly kind: FuryGatewayMessageKind;
  readonly type: string;
  readonly payload: unknown;
}

export interface FuryGatewayTransportConnectionInspection {
  readonly connectionId: string;
  readonly role: FuryGatewayRole;
  readonly clientId: string;
  readonly instanceId: string;
  readonly openedAt: number;
  readonly lastActivityAt: number;
  readonly lastInboundSequence: number;
  readonly nextOutboundSequence: number;
  readonly queuedOutboundMessages: number;
  readonly queuedOutboundBytes: number;
}

export type FuryGatewayTransportErrorCode =
  | 'invalid-bind-policy'
  | 'remote-disabled'
  | 'secure-transport-required'
  | 'invalid-origin'
  | 'origin-not-allowed'
  | 'invalid-client-kind'
  | 'transport-not-ready'
  | 'transport-draining'
  | 'invalid-connection'
  | 'connection-limit-exceeded'
  | 'role-limit-exceeded'
  | 'rate-limit-exceeded'
  | 'duplicate-message-id'
  | 'stale-sequence'
  | 'sequence-gap'
  | 'backpressure'
  | 'invalid-transition';

export class FuryGatewayTransportError extends Error {
  readonly code: FuryGatewayTransportErrorCode;

  constructor(code: FuryGatewayTransportErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayTransportError';
    this.code = code;
  }
}

export interface FuryGatewayTransportCoordinatorOptions {
  readonly bindPolicy?: FuryGatewayBindPolicyInput;
  readonly now?: () => number;
  readonly maxConnections?: number;
  readonly maxConnectionsByRole?: Partial<Record<FuryGatewayRole, number>>;
  readonly rateWindowMs?: number;
  readonly maxInboundMessagesPerWindow?: number;
  readonly maxSeenMessageIds?: number;
  readonly maxOutboundMessages?: number;
  readonly maxOutboundBytes?: number;
  readonly idleTimeoutMs?: number;
}

export interface FuryGatewayTransportCoordinator {
  readonly bindPolicy: FuryGatewayBindPolicy;
  status(): 'starting' | 'ready' | 'draining' | 'stopped';
  setStatus(next: 'ready' | 'draining' | 'stopped'): void;
  openConnection(
    connect: unknown,
    metadata: FuryGatewayTransportConnectionMetadata,
  ): FuryGatewayTransportConnection;
  acceptInbound(
    connection: FuryGatewayTransportConnection,
    text: string,
  ): FuryGatewayMessageEnvelope;
  enqueueOutbound(
    connection: FuryGatewayTransportConnection,
    message: FuryGatewayOutboundMessageInput,
  ): string;
  dequeueOutbound(connection: FuryGatewayTransportConnection): string | undefined;
  inspectConnection(
    connection: FuryGatewayTransportConnection,
  ): FuryGatewayTransportConnectionInspection;
  closeConnection(connection: FuryGatewayTransportConnection): boolean;
  sweepIdle(): readonly FuryGatewayTransportConnection[];
  connectionCount(role?: FuryGatewayRole): number;
}

interface ConnectionState {
  readonly handle: FuryGatewayTransportConnection;
  readonly connect: FuryGatewayConnectEnvelope;
  readonly metadata: FuryGatewayTransportConnectionMetadata;
  lastActivityAt: number;
  lastInboundSequence: number;
  nextOutboundSequence: number;
  readonly seenMessageIds: Map<string, number>;
  readonly inboundAttempts: number[];
  readonly outboundQueue: string[];
  outboundBytes: number;
}

const CONNECTION_EVIDENCE = new WeakSet<object>();
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const DEFAULT_MAX_CONNECTIONS = 2_048;
const ABSOLUTE_MAX_CONNECTIONS = 65_536;
const DEFAULT_ROLE_LIMITS: Readonly<Record<FuryGatewayRole, number>> = Object.freeze({
  operator: 64,
  node: 1_024,
  channel: 256,
  worker: 1_024,
});
const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_MAX_INBOUND_MESSAGES = 240;
const DEFAULT_MAX_SEEN_MESSAGE_IDS = 4_096;
const DEFAULT_MAX_OUTBOUND_MESSAGES = 128;
const DEFAULT_MAX_OUTBOUND_BYTES = 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60_000;

function finiteNow(now: () => number): number {
  const raw = now();
  const value = Math.floor(raw);
  if (!Number.isFinite(raw) || raw < 0 || !Number.isSafeInteger(value)) {
    throw new RangeError('gateway transport clock must return a safe non-negative timestamp');
  }
  return value;
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
    throw new RangeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function normalizeOrigin(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new FuryGatewayTransportError('invalid-origin', 'browser Origin is invalid');
  }
  if (value.includes('*') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new FuryGatewayTransportError('invalid-origin', 'browser Origin must be an exact origin');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FuryGatewayTransportError('invalid-origin', 'browser Origin is not a valid URL origin');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.origin !== value
  ) {
    throw new FuryGatewayTransportError(
      'invalid-origin',
      'browser Origin must be an exact http(s) origin without path, query or fragment',
    );
  }
  return parsed.origin;
}

export function resolveFuryGatewayBindPolicy(
  input: FuryGatewayBindPolicyInput = {},
): FuryGatewayBindPolicy {
  const host = input.host ?? '127.0.0.1';
  if (
    typeof host !== 'string'
    || host.length === 0
    || host.length > 255
    || /[\u0000-\u001f\u007f]/u.test(host)
  ) {
    throw new FuryGatewayTransportError('invalid-bind-policy', 'gateway bind host is invalid');
  }
  const remoteEnabled = input.remoteEnabled ?? false;
  if (typeof remoteEnabled !== 'boolean') {
    throw new FuryGatewayTransportError('invalid-bind-policy', 'remoteEnabled must be boolean');
  }
  const secureTransport = input.secureTransport ?? 'none';
  if (!['none', 'tls', 'authenticated-tunnel'].includes(secureTransport)) {
    throw new FuryGatewayTransportError(
      'invalid-bind-policy',
      'gateway secure transport mode is unsupported',
    );
  }
  if (!remoteEnabled && !LOOPBACK_HOSTS.has(host)) {
    throw new FuryGatewayTransportError(
      'remote-disabled',
      'non-loopback Gateway binding requires explicit remoteEnabled',
    );
  }
  if (remoteEnabled && secureTransport === 'none') {
    throw new FuryGatewayTransportError(
      'secure-transport-required',
      'remote Gateway binding requires TLS or an authenticated secure tunnel',
    );
  }
  const rawOrigins = input.allowedBrowserOrigins ?? [];
  if (!Array.isArray(rawOrigins) || rawOrigins.length > 64) {
    throw new FuryGatewayTransportError(
      'invalid-bind-policy',
      'browser Origin allowlist exceeds its bound',
    );
  }
  const normalizedOrigins = rawOrigins.map(normalizeOrigin);
  if (new Set(normalizedOrigins).size !== normalizedOrigins.length) {
    throw new FuryGatewayTransportError(
      'invalid-bind-policy',
      'browser Origin allowlist contains duplicates',
    );
  }
  normalizedOrigins.sort();
  return Object.freeze({
    host,
    remoteEnabled,
    secureTransport,
    allowedBrowserOrigins: Object.freeze(normalizedOrigins),
  });
}

function normalizeRoleLimits(
  input: Partial<Record<FuryGatewayRole, number>> | undefined,
): Readonly<Record<FuryGatewayRole, number>> {
  const out = {} as Record<FuryGatewayRole, number>;
  for (const role of FURY_GATEWAY_ROLES) {
    out[role] = boundedInteger(
      input?.[role],
      DEFAULT_ROLE_LIMITS[role],
      1,
      ABSOLUTE_MAX_CONNECTIONS,
      `maxConnectionsByRole.${role}`,
    );
  }
  return Object.freeze(out);
}

function assertConnectionMetadata(
  metadata: FuryGatewayTransportConnectionMetadata,
  role: FuryGatewayRole,
  policy: FuryGatewayBindPolicy,
): FuryGatewayTransportConnectionMetadata {
  if (!metadata || typeof metadata !== 'object') {
    throw new FuryGatewayTransportError('invalid-client-kind', 'transport connection metadata is required');
  }
  if (metadata.clientKind === 'browser') {
    if (role === 'node' || role === 'worker') {
      throw new FuryGatewayTransportError(
        'invalid-client-kind',
        'browser clients cannot claim node or worker transport roles',
      );
    }
    if (metadata.origin === undefined) {
      throw new FuryGatewayTransportError('invalid-origin', 'browser transport requires an Origin');
    }
    const origin = normalizeOrigin(metadata.origin);
    if (!policy.allowedBrowserOrigins.includes(origin)) {
      throw new FuryGatewayTransportError('origin-not-allowed', 'browser Origin is not allowed');
    }
    return Object.freeze({ clientKind: 'browser', origin });
  }
  if (metadata.clientKind === 'device') {
    if (metadata.origin !== undefined) {
      throw new FuryGatewayTransportError(
        'invalid-origin',
        'non-browser transport must not supply browser Origin metadata',
      );
    }
    return Object.freeze({ clientKind: 'device' });
  }
  throw new FuryGatewayTransportError('invalid-client-kind', 'transport client kind is unsupported');
}

function isGeneratedConnection(value: unknown): value is FuryGatewayTransportConnection {
  return typeof value === 'object' && value !== null && CONNECTION_EVIDENCE.has(value);
}

function nextConnectionId(states: Map<string, ConnectionState>): string {
  let id: string;
  do {
    id = randomBytes(24).toString('base64url');
  } while (states.has(id));
  return id;
}

function nextMessageId(): string {
  return `fgwmsg_${randomBytes(18).toString('base64url')}`;
}

export function createFuryGatewayTransportCoordinator(
  options: FuryGatewayTransportCoordinatorOptions = {},
): FuryGatewayTransportCoordinator {
  const bindPolicy = resolveFuryGatewayBindPolicy(options.bindPolicy);
  const now = options.now ?? Date.now;
  const maxConnections = boundedInteger(
    options.maxConnections,
    DEFAULT_MAX_CONNECTIONS,
    1,
    ABSOLUTE_MAX_CONNECTIONS,
    'maxConnections',
  );
  const roleLimits = normalizeRoleLimits(options.maxConnectionsByRole);
  const rateWindowMs = boundedInteger(
    options.rateWindowMs,
    DEFAULT_RATE_WINDOW_MS,
    1_000,
    10 * 60_000,
    'rateWindowMs',
  );
  const maxInboundMessagesPerWindow = boundedInteger(
    options.maxInboundMessagesPerWindow,
    DEFAULT_MAX_INBOUND_MESSAGES,
    1,
    100_000,
    'maxInboundMessagesPerWindow',
  );
  const maxSeenMessageIds = boundedInteger(
    options.maxSeenMessageIds,
    DEFAULT_MAX_SEEN_MESSAGE_IDS,
    32,
    65_536,
    'maxSeenMessageIds',
  );
  const maxOutboundMessages = boundedInteger(
    options.maxOutboundMessages,
    DEFAULT_MAX_OUTBOUND_MESSAGES,
    1,
    4_096,
    'maxOutboundMessages',
  );
  const maxOutboundBytes = boundedInteger(
    options.maxOutboundBytes,
    DEFAULT_MAX_OUTBOUND_BYTES,
    64 * 1024,
    64 * 1024 * 1024,
    'maxOutboundBytes',
  );
  const idleTimeoutMs = boundedInteger(
    options.idleTimeoutMs,
    DEFAULT_IDLE_TIMEOUT_MS,
    5_000,
    60 * 60_000,
    'idleTimeoutMs',
  );

  const states = new Map<string, ConnectionState>();
  let lifecycle: 'starting' | 'ready' | 'draining' | 'stopped' = 'starting';

  const resolveState = (connection: FuryGatewayTransportConnection): ConnectionState => {
    if (!isGeneratedConnection(connection)) {
      throw new FuryGatewayTransportError(
        'invalid-connection',
        'Gateway transport connection must be process-local evidence',
      );
    }
    const state = states.get(connection.connectionId);
    if (!state || state.handle !== connection) {
      throw new FuryGatewayTransportError(
        'invalid-connection',
        'Gateway transport connection is not owned by this coordinator',
      );
    }
    return state;
  };

  const countRole = (role: FuryGatewayRole): number => {
    let count = 0;
    for (const state of states.values()) {
      if (state.handle.role === role) count += 1;
    }
    return count;
  };

  const recordInboundAttempt = (state: ConnectionState, at: number): void => {
    const threshold = at - rateWindowMs;
    while (state.inboundAttempts.length > 0 && state.inboundAttempts[0]! <= threshold) {
      state.inboundAttempts.shift();
    }
    if (state.inboundAttempts.length >= maxInboundMessagesPerWindow) {
      throw new FuryGatewayTransportError(
        'rate-limit-exceeded',
        'Gateway inbound message rate limit exceeded',
      );
    }
    state.inboundAttempts.push(at);
  };

  const rememberMessageId = (state: ConnectionState, messageId: string, sequence: number): void => {
    if (state.seenMessageIds.has(messageId)) {
      throw new FuryGatewayTransportError(
        'duplicate-message-id',
        'Gateway message ID was already observed on this connection',
      );
    }
    state.seenMessageIds.set(messageId, sequence);
    while (state.seenMessageIds.size > maxSeenMessageIds) {
      const oldest = state.seenMessageIds.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      state.seenMessageIds.delete(oldest);
    }
  };

  return Object.freeze({
    bindPolicy,

    status(): 'starting' | 'ready' | 'draining' | 'stopped' {
      return lifecycle;
    },

    setStatus(next: 'ready' | 'draining' | 'stopped'): void {
      const allowed =
        (lifecycle === 'starting' && (next === 'ready' || next === 'draining' || next === 'stopped'))
        || (lifecycle === 'ready' && (next === 'draining' || next === 'stopped'))
        || (lifecycle === 'draining' && next === 'stopped');
      if (!allowed) {
        throw new FuryGatewayTransportError(
          'invalid-transition',
          `Gateway transport cannot transition from ${lifecycle} to ${next}`,
        );
      }
      lifecycle = next;
    },

    openConnection(
      connectInput: unknown,
      metadataInput: FuryGatewayTransportConnectionMetadata,
    ): FuryGatewayTransportConnection {
      if (lifecycle === 'draining') {
        throw new FuryGatewayTransportError(
          'transport-draining',
          'Gateway transport is draining and rejects new connections',
        );
      }
      if (lifecycle !== 'ready') {
        throw new FuryGatewayTransportError(
          'transport-not-ready',
          'Gateway transport is not accepting connections',
        );
      }
      const connect = parseFuryGatewayConnectEnvelope(connectInput);
      const metadata = assertConnectionMetadata(metadataInput, connect.role, bindPolicy);
      if (states.size >= maxConnections) {
        throw new FuryGatewayTransportError(
          'connection-limit-exceeded',
          'Gateway transport connection limit exceeded',
        );
      }
      if (countRole(connect.role) >= roleLimits[connect.role]) {
        throw new FuryGatewayTransportError(
          'role-limit-exceeded',
          'Gateway transport role connection limit exceeded',
        );
      }
      const openedAt = finiteNow(now);
      const handle = Object.freeze({
        format: FURY_GATEWAY_TRANSPORT_CONNECTION_FORMAT,
        connectionId: nextConnectionId(states),
        role: connect.role,
        clientId: connect.client.clientId,
        instanceId: connect.client.instanceId,
        connectFingerprint: deriveFuryGatewayConnectFingerprint(connect),
        openedAt,
        authority: 'transport-connection-only' as const,
      });
      CONNECTION_EVIDENCE.add(handle);
      states.set(handle.connectionId, {
        handle,
        connect,
        metadata,
        lastActivityAt: openedAt,
        lastInboundSequence: 0,
        nextOutboundSequence: 1,
        seenMessageIds: new Map(),
        inboundAttempts: [],
        outboundQueue: [],
        outboundBytes: 0,
      });
      return handle;
    },

    acceptInbound(
      connection: FuryGatewayTransportConnection,
      text: string,
    ): FuryGatewayMessageEnvelope {
      const state = resolveState(connection);
      const at = finiteNow(now);
      recordInboundAttempt(state, at);
      const message = parseFuryGatewayMessageText(text);
      const expected = state.lastInboundSequence + 1;
      if (message.sequence < expected) {
        throw new FuryGatewayTransportError(
          'stale-sequence',
          'Gateway message sequence is stale or duplicated',
        );
      }
      if (message.sequence > expected) {
        throw new FuryGatewayTransportError(
          'sequence-gap',
          'Gateway message sequence contains a gap',
        );
      }
      rememberMessageId(state, message.messageId, message.sequence);
      state.lastInboundSequence = message.sequence;
      state.lastActivityAt = at;
      return message;
    },

    enqueueOutbound(
      connection: FuryGatewayTransportConnection,
      message: FuryGatewayOutboundMessageInput,
    ): string {
      const state = resolveState(connection);
      const at = finiteNow(now);
      if (state.outboundQueue.length >= maxOutboundMessages) {
        throw new FuryGatewayTransportError(
          'backpressure',
          'Gateway outbound message queue is full',
        );
      }
      const sequence = state.nextOutboundSequence;
      const text = serializeFuryGatewayMessage({
        format: FURY_GATEWAY_MESSAGE_FORMAT,
        protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
        messageId: nextMessageId(),
        sequence,
        kind: message.kind,
        type: message.type,
        sentAt: at,
        payload: message.payload,
      });
      const bytes = Buffer.byteLength(text, 'utf8');
      if (state.outboundBytes + bytes > maxOutboundBytes) {
        throw new FuryGatewayTransportError(
          'backpressure',
          'Gateway outbound byte queue limit exceeded',
        );
      }
      state.outboundQueue.push(text);
      state.outboundBytes += bytes;
      state.nextOutboundSequence += 1;
      state.lastActivityAt = at;
      return text;
    },

    dequeueOutbound(connection: FuryGatewayTransportConnection): string | undefined {
      const state = resolveState(connection);
      const text = state.outboundQueue.shift();
      if (text === undefined) return undefined;
      state.outboundBytes -= Buffer.byteLength(text, 'utf8');
      state.lastActivityAt = finiteNow(now);
      return text;
    },

    inspectConnection(
      connection: FuryGatewayTransportConnection,
    ): FuryGatewayTransportConnectionInspection {
      const state = resolveState(connection);
      finiteNow(now);
      return Object.freeze({
        connectionId: state.handle.connectionId,
        role: state.handle.role,
        clientId: state.handle.clientId,
        instanceId: state.handle.instanceId,
        openedAt: state.handle.openedAt,
        lastActivityAt: state.lastActivityAt,
        lastInboundSequence: state.lastInboundSequence,
        nextOutboundSequence: state.nextOutboundSequence,
        queuedOutboundMessages: state.outboundQueue.length,
        queuedOutboundBytes: state.outboundBytes,
      });
    },

    closeConnection(connection: FuryGatewayTransportConnection): boolean {
      const state = resolveState(connection);
      finiteNow(now);
      return states.delete(state.handle.connectionId);
    },

    sweepIdle(): readonly FuryGatewayTransportConnection[] {
      const at = finiteNow(now);
      const expired: FuryGatewayTransportConnection[] = [];
      for (const [id, state] of states) {
        if (at - state.lastActivityAt > idleTimeoutMs) {
          states.delete(id);
          expired.push(state.handle);
        }
      }
      return Object.freeze(expired);
    },

    connectionCount(role?: FuryGatewayRole): number {
      finiteNow(now);
      if (role === undefined) return states.size;
      if (!(FURY_GATEWAY_ROLES as readonly string[]).includes(role)) return 0;
      return countRole(role);
    },
  });
}
