import type { FuryGatewayCommandRegistry } from './gateway-command-authorization-node.js';
import type {
  FuryGatewaySessionCoordinator,
} from './gateway-session-node.js';
import {
  createFuryGatewayHealthSnapshot,
  FURY_GATEWAY_ROLES,
  type FuryGatewayHealthSnapshot,
  type FuryGatewayRole,
} from './gateway.js';
import {
  listenFuryGatewayWebSocketHost,
  type FuryGatewayWebSocketConnectionResolver,
  type FuryGatewayWebSocketHostAddress,
  type FuryGatewayWebSocketHostHandle,
  type FuryGatewayWebSocketHostOptions,
  type FuryGatewayWebSocketSafeEvent,
} from './gateway-websocket-host-node.js';

export const FURY_GATEWAY_DAEMON_EVENT_FORMAT =
  'furypipe-gateway-daemon-event/v1' as const;

export type FuryGatewayDaemonStatus =
  | 'starting'
  | 'ready'
  | 'draining'
  | 'stopped';

export type FuryGatewayDaemonEvent =
  | {
      readonly format: typeof FURY_GATEWAY_DAEMON_EVENT_FORMAT;
      readonly sequence: number;
      readonly observedAt: number;
      readonly type: 'status';
      readonly status: FuryGatewayDaemonStatus;
    }
  | {
      readonly format: typeof FURY_GATEWAY_DAEMON_EVENT_FORMAT;
      readonly sequence: number;
      readonly observedAt: number;
      readonly type: 'websocket';
      readonly event: FuryGatewayWebSocketSafeEvent;
    };

export interface FuryGatewayDaemonConfig {
  readonly host?: '127.0.0.1' | '::1' | 'localhost';
  readonly port?: number;
  readonly allowedOrigins?: readonly string[];
  readonly maxPayloadBytes?: number;
  readonly maxConnections?: number;
  readonly maxConnectionsPerPrincipal?: number;
  readonly rateWindowMs?: number;
  readonly maxMessagesPerWindow?: number;
  readonly maxInFlightMessages?: number;
  readonly maxInFlightBytes?: number;
  readonly maxBufferedAmountBytes?: number;
  readonly heartbeatIntervalMs?: number;
  readonly maxPendingUpgrades?: number;
  readonly maxEventHistory?: number;
}

export interface FuryGatewayDaemonOptions {
  readonly sessionCoordinator: FuryGatewaySessionCoordinator;
  readonly commandRegistry: FuryGatewayCommandRegistry;
  readonly resolveConnection: FuryGatewayWebSocketConnectionResolver;
  readonly config?: FuryGatewayDaemonConfig;
  readonly now?: () => number;
}

export interface FuryGatewayDaemonInspection {
  readonly status: FuryGatewayDaemonStatus;
  readonly startedAt: number;
  readonly observedAt: number;
  readonly address?: FuryGatewayWebSocketHostAddress;
  readonly eventSequence: number;
  readonly activeConnections: number;
  readonly connections: Readonly<Record<FuryGatewayRole, number>>;
  readonly activeSessions: number;
  readonly authority: 'observability-only';
}

export interface FuryGatewayDaemonHandle {
  readonly address: FuryGatewayWebSocketHostAddress;
  inspect(): FuryGatewayDaemonInspection;
  health(): FuryGatewayHealthSnapshot;
  events(afterSequence?: number): readonly FuryGatewayDaemonEvent[];
  subscribe(handler: (event: FuryGatewayDaemonEvent) => void): () => void;
  stop(): Promise<void>;
}

export type FuryGatewayDaemonErrorCode =
  | 'invalid-config'
  | 'event-sequence-exhausted'
  | 'stopped';

export class FuryGatewayDaemonError extends Error {
  readonly code: FuryGatewayDaemonErrorCode;

  constructor(code: FuryGatewayDaemonErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayDaemonError';
    this.code = code;
  }
}

const DEFAULT_MAX_EVENT_HISTORY = 512;
const MAX_EVENT_HISTORY = 4096;
const MAX_COUNTER = 1_000_000_000;

function finiteNow(now: () => number): number {
  const value = now();
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(normalized)) {
    throw new FuryGatewayDaemonError(
      'invalid-config',
      'Gateway daemon clock must return a safe non-negative timestamp',
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
    throw new FuryGatewayDaemonError(
      'invalid-config',
      `${label} must be an integer between ${min} and ${max}`,
    );
  }
  return resolved;
}

function emptyRoleCounts(): Record<FuryGatewayRole, number> {
  return Object.fromEntries(
    FURY_GATEWAY_ROLES.map((role) => [role, 0]),
  ) as Record<FuryGatewayRole, number>;
}

function cloneRoleCounts(
  counts: Readonly<Record<FuryGatewayRole, number>>,
): Readonly<Record<FuryGatewayRole, number>> {
  return Object.freeze(Object.fromEntries(
    FURY_GATEWAY_ROLES.map((role) => [role, counts[role]]),
  ) as Record<FuryGatewayRole, number>);
}

function incrementRole(
  counts: Record<FuryGatewayRole, number>,
  role: FuryGatewayRole,
): void {
  if (counts[role] >= MAX_COUNTER) {
    throw new FuryGatewayDaemonError(
      'invalid-config',
      'Gateway daemon connection counter exceeded its bound',
    );
  }
  counts[role] += 1;
}

function decrementRole(
  counts: Record<FuryGatewayRole, number>,
  role: FuryGatewayRole,
): void {
  counts[role] = Math.max(0, counts[role] - 1);
}

export async function startFuryGatewayDaemon(
  options: FuryGatewayDaemonOptions,
): Promise<FuryGatewayDaemonHandle> {
  if (
    !options
    || typeof options !== 'object'
    || !options.sessionCoordinator
    || !options.commandRegistry
    || typeof options.resolveConnection !== 'function'
  ) {
    throw new FuryGatewayDaemonError(
      'invalid-config',
      'Gateway daemon requires session, command and connection-resolver dependencies',
    );
  }

  const now = options.now ?? Date.now;
  const config = options.config ?? {};
  const maxEventHistory = boundedInteger(
    config.maxEventHistory,
    DEFAULT_MAX_EVENT_HISTORY,
    1,
    MAX_EVENT_HISTORY,
    'maxEventHistory',
  );
  const startedAt = finiteNow(now);

  let status: FuryGatewayDaemonStatus = 'starting';
  let eventSequence = 0;
  const history: FuryGatewayDaemonEvent[] = [];
  const subscribers = new Set<(event: FuryGatewayDaemonEvent) => void>();
  const roleCounts = emptyRoleCounts();
  const connectionRoles = new Map<string, FuryGatewayRole>();
  let websocketHandle: FuryGatewayWebSocketHostHandle | undefined;
  let stopPromise: Promise<void> | undefined;

  const emit = (
    event:
      | { readonly type: 'status'; readonly status: FuryGatewayDaemonStatus }
      | { readonly type: 'websocket'; readonly event: FuryGatewayWebSocketSafeEvent },
  ): void => {
    if (eventSequence >= Number.MAX_SAFE_INTEGER) {
      throw new FuryGatewayDaemonError(
        'event-sequence-exhausted',
        'Gateway daemon event sequence is exhausted',
      );
    }
    eventSequence += 1;
    const observedAt = finiteNow(now);
    const normalized: FuryGatewayDaemonEvent = event.type === 'status'
      ? Object.freeze({
          format: FURY_GATEWAY_DAEMON_EVENT_FORMAT,
          sequence: eventSequence,
          observedAt,
          type: 'status' as const,
          status: event.status,
        })
      : Object.freeze({
          format: FURY_GATEWAY_DAEMON_EVENT_FORMAT,
          sequence: eventSequence,
          observedAt,
          type: 'websocket' as const,
          event: event.event,
        });

    history.push(normalized);
    while (history.length > maxEventHistory) history.shift();

    for (const subscriber of [...subscribers]) {
      try {
        subscriber(normalized);
      } catch {
        // Subscribers are observability only and never runtime authority.
      }
    }
  };

  const setStatus = (next: FuryGatewayDaemonStatus): void => {
    status = next;
    emit({ type: 'status', status: next });
  };

  const onWebSocketEvent = (event: FuryGatewayWebSocketSafeEvent): void => {
    if (event.type === 'connection-open') {
      if (!connectionRoles.has(event.connectionId)) {
        connectionRoles.set(event.connectionId, event.role);
        incrementRole(roleCounts, event.role);
      }
    } else if (event.type === 'connection-close') {
      const role = connectionRoles.get(event.connectionId);
      if (role !== undefined) {
        connectionRoles.delete(event.connectionId);
        decrementRole(roleCounts, role);
      }
    }
    emit({ type: 'websocket', event });
  };

  emit({ type: 'status', status: 'starting' });

  const hostOptions: FuryGatewayWebSocketHostOptions = {
    sessionCoordinator: options.sessionCoordinator,
    commandRegistry: options.commandRegistry,
    resolveConnection: options.resolveConnection,
    host: config.host,
    port: config.port,
    allowedOrigins: config.allowedOrigins,
    maxPayloadBytes: config.maxPayloadBytes,
    maxConnections: config.maxConnections,
    maxConnectionsPerPrincipal: config.maxConnectionsPerPrincipal,
    rateWindowMs: config.rateWindowMs,
    maxMessagesPerWindow: config.maxMessagesPerWindow,
    maxInFlightMessages: config.maxInFlightMessages,
    maxInFlightBytes: config.maxInFlightBytes,
    maxBufferedAmountBytes: config.maxBufferedAmountBytes,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    maxPendingUpgrades: config.maxPendingUpgrades,
    onEvent: onWebSocketEvent,
  };

  try {
    websocketHandle = await listenFuryGatewayWebSocketHost(hostOptions);
  } catch (error) {
    status = 'stopped';
    emit({ type: 'status', status: 'stopped' });
    throw error;
  }

  setStatus('ready');

  const inspection = (): FuryGatewayDaemonInspection => {
    const observedAt = finiteNow(now);
    return Object.freeze({
      status,
      startedAt,
      observedAt,
      ...(websocketHandle === undefined ? {} : { address: websocketHandle.address }),
      eventSequence,
      activeConnections: connectionRoles.size,
      connections: cloneRoleCounts(roleCounts),
      activeSessions: options.sessionCoordinator.activeCount(),
      authority: 'observability-only' as const,
    });
  };

  return Object.freeze({
    address: websocketHandle.address,

    inspect(): FuryGatewayDaemonInspection {
      return inspection();
    },

    health(): FuryGatewayHealthSnapshot {
      if (status === 'stopped') {
        throw new FuryGatewayDaemonError(
          'stopped',
          'Gateway daemon is stopped; live health is unavailable',
        );
      }
      const observedAt = finiteNow(now);
      return createFuryGatewayHealthSnapshot({
        status: status === 'draining' ? 'draining' : status === 'starting' ? 'starting' : 'ready',
        startedAt,
        observedAt,
        connections: cloneRoleCounts(roleCounts),
        sessions: options.sessionCoordinator.activeCount(),
        automations: 0,
        workers: 0,
      });
    },

    events(afterSequence = 0): readonly FuryGatewayDaemonEvent[] {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new FuryGatewayDaemonError(
          'invalid-config',
          'afterSequence must be a non-negative safe integer',
        );
      }
      return Object.freeze(
        history.filter((event) => event.sequence > afterSequence),
      );
    },

    subscribe(handler: (event: FuryGatewayDaemonEvent) => void): () => void {
      if (typeof handler !== 'function') {
        throw new FuryGatewayDaemonError(
          'invalid-config',
          'Gateway daemon event subscriber must be a function',
        );
      }
      subscribers.add(handler);
      let active = true;
      return (): void => {
        if (!active) return;
        active = false;
        subscribers.delete(handler);
      };
    },

    stop(): Promise<void> {
      if (stopPromise) return stopPromise;
      stopPromise = (async (): Promise<void> => {
        if (status !== 'stopped') setStatus('draining');
        try {
          await websocketHandle?.stop();
        } finally {
          connectionRoles.clear();
          for (const role of FURY_GATEWAY_ROLES) roleCounts[role] = 0;
          setStatus('stopped');
          subscribers.clear();
        }
      })();
      return stopPromise;
    },
  });
}
