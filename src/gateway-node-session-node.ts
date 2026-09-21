import { randomBytes } from 'node:crypto';

import {
  isGeneratedFuryGatewayAuthenticatedDevice,
  type FuryGatewayAuthenticatedDevice,
} from './gateway-auth-node.js';
import {
  isGeneratedFuryGatewayPairingCoordinator,
  type FuryGatewayPairingCoordinator,
} from './gateway-pairing-node.js';
import {
  isGeneratedFuryGatewayNodeCapabilityAdvertisement,
  isGeneratedFuryGatewayNodeDescriptor,
  isGeneratedFuryGatewayNodeRegistry,
  type FuryGatewayNodeCapabilityAdvertisement,
  type FuryGatewayNodeDescriptor,
  type FuryGatewayNodeRegistry,
} from './gateway-node-registry-node.js';

export const FURY_GATEWAY_NODE_SESSION_FORMAT =
  'furypipe-gateway-node-session/v1' as const;
export const FURY_GATEWAY_NODE_HEARTBEAT_FORMAT =
  'furypipe-gateway-node-heartbeat/v1' as const;
export const FURY_GATEWAY_NODE_SESSION_OBSERVATION_FORMAT =
  'furypipe-gateway-node-session-observation/v1' as const;
export const FURY_GATEWAY_NODE_SESSION_SNAPSHOT_FORMAT =
  'furypipe-gateway-node-session-snapshot/v1' as const;

export interface FuryGatewayNodeSession {
  readonly format: typeof FURY_GATEWAY_NODE_SESSION_FORMAT;
  readonly sessionId: string;
  readonly livenessEpoch: string;
  readonly registrationId: string;
  readonly deviceId: string;
  readonly publicKeySha256: string;
  readonly pairingId: string;
  readonly clientId: string;
  readonly instanceId: string;
  readonly connectedAt: number;
  readonly lastHeartbeatAt: number;
  readonly heartbeatTtlMs: number;
  readonly authority: 'node-session-evidence-only';
  readonly authorization: 'none';
  readonly executionAuthority: false;
  readonly automaticReplayAllowed: false;
}

export interface FuryGatewayNodeHeartbeat {
  readonly format: typeof FURY_GATEWAY_NODE_HEARTBEAT_FORMAT;
  readonly sessionId: string;
  readonly livenessEpoch: string;
  readonly sequence: number;
}

export type FuryGatewayNodeSessionStatus =
  | 'live'
  | 'timed-out'
  | 'closed'
  | 'superseded'
  | 'pairing-revoked'
  | 'pairing-changed'
  | 'node-unregistered';

export interface FuryGatewayNodeSessionCapabilityObservation {
  readonly generation: number;
  readonly capabilitiesDigestSha256: string;
  readonly advertisedAt: number;
  readonly currentForSession: true;
  readonly authority: 'advertisement-observation-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayNodeSessionObservation {
  readonly format: typeof FURY_GATEWAY_NODE_SESSION_OBSERVATION_FORMAT;
  readonly sessionId: string;
  readonly livenessEpoch: string;
  readonly registrationId: string;
  readonly deviceId: string;
  readonly pairingId: string;
  readonly clientId: string;
  readonly instanceId: string;
  readonly connectedAt: number;
  readonly lastHeartbeatAt: number;
  readonly heartbeatSequence: number;
  readonly heartbeatTtlMs: number;
  readonly liveUntil: number;
  readonly status: FuryGatewayNodeSessionStatus;
  readonly capability?: FuryGatewayNodeSessionCapabilityObservation;
  readonly authority: 'node-session-observation-only';
  readonly authorization: 'none';
  readonly executionAuthority: false;
  readonly automaticReplayAllowed: false;
}

export interface FuryGatewayNodeSessionSnapshotEntry {
  readonly sessionId: string;
  readonly livenessEpoch: string;
  readonly registrationId: string;
  readonly deviceId: string;
  readonly pairingId: string;
  readonly connectedAt: number;
  readonly lastHeartbeatAt: number;
  readonly heartbeatSequence: number;
  readonly liveUntil: number;
  readonly capabilityGeneration?: number;
  readonly capabilitiesDigestSha256?: string;
  readonly authority: 'node-session-observation-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayNodeSessionSnapshot {
  readonly format: typeof FURY_GATEWAY_NODE_SESSION_SNAPSHOT_FORMAT;
  readonly observedAt: number;
  readonly liveSessionCount: number;
  readonly sessions: readonly FuryGatewayNodeSessionSnapshotEntry[];
  readonly authority: 'node-session-observation-only';
  readonly executionAuthority: false;
}

export type FuryGatewayNodeSessionErrorCode =
  | 'invalid-node-registry'
  | 'invalid-pairing-coordinator'
  | 'invalid-node-evidence'
  | 'invalid-authenticated-device'
  | 'authenticated-device-stale'
  | 'identity-mismatch'
  | 'pairing-required'
  | 'pairing-changed'
  | 'invalid-session-evidence'
  | 'invalid-heartbeat'
  | 'stale-heartbeat'
  | 'session-not-live'
  | 'limit-exceeded';

export class FuryGatewayNodeSessionError extends Error {
  readonly code: FuryGatewayNodeSessionErrorCode;

  constructor(code: FuryGatewayNodeSessionErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayNodeSessionError';
    this.code = code;
  }
}

export interface FuryGatewayNodeSessionCoordinatorOptions {
  readonly nodeRegistry: FuryGatewayNodeRegistry;
  readonly pairingCoordinator: FuryGatewayPairingCoordinator;
  readonly now?: () => number;
  readonly heartbeatTtlMs?: number;
  readonly maxAuthenticatedAgeMs?: number;
  readonly maxActiveSessions?: number;
}

export interface FuryGatewayNodeSessionCoordinator {
  openSession(
    node: FuryGatewayNodeDescriptor,
    device: FuryGatewayAuthenticatedDevice,
  ): FuryGatewayNodeSession;
  heartbeat(
    session: FuryGatewayNodeSession,
    heartbeat: FuryGatewayNodeHeartbeat,
  ): FuryGatewayNodeSessionObservation;
  closeSession(session: FuryGatewayNodeSession): boolean;
  inspectSession(session: FuryGatewayNodeSession): FuryGatewayNodeSessionObservation;
  isLiveSession(session: FuryGatewayNodeSession): boolean;
  snapshot(): FuryGatewayNodeSessionSnapshot;
  activeSessionCount(): number;
}

interface NodeSessionState {
  readonly session: FuryGatewayNodeSession;
  readonly node: FuryGatewayNodeDescriptor;
  readonly device: FuryGatewayAuthenticatedDevice;
  readonly baselineAdvertisementGeneration?: number;
  status: FuryGatewayNodeSessionStatus;
  lastHeartbeatAt: number;
  heartbeatSequence: number;
}

const GENERATED_NODE_SESSIONS = new WeakSet<object>();
const GENERATED_NODE_SESSION_COORDINATORS = new WeakSet<object>();

const DEFAULT_HEARTBEAT_TTL_MS = 30_000;
const MIN_HEARTBEAT_TTL_MS = 5_000;
const HARD_MAX_HEARTBEAT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_AUTHENTICATED_AGE_MS = 60_000;
const MIN_AUTHENTICATED_AGE_MS = 5_000;
const HARD_MAX_AUTHENTICATED_AGE_MS = 5 * 60_000;
const DEFAULT_MAX_ACTIVE_SESSIONS = 1_024;
const HARD_MAX_ACTIVE_SESSIONS = 65_536;
const MAX_HEARTBEAT_SEQUENCE = 1_000_000_000;

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

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('gateway node session clock must return a safe non-negative timestamp');
  }
  return value;
}

function safeLiveUntil(lastHeartbeatAt: number, heartbeatTtlMs: number): number {
  const value = lastHeartbeatAt + heartbeatTtlMs;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('node session liveUntil must be a safe integer');
  }
  return value;
}

function nextRandomId(existing: ReadonlySet<string>, bytes: number): string {
  let value: string;
  do {
    value = randomBytes(bytes).toString('base64url');
  } while (existing.has(value));
  return value;
}

function exactHeartbeatRecord(
  heartbeat: FuryGatewayNodeHeartbeat,
): Readonly<Record<string, unknown>> {
  if (!heartbeat || typeof heartbeat !== 'object' || Array.isArray(heartbeat)) {
    throw new FuryGatewayNodeSessionError(
      'invalid-heartbeat',
      'node heartbeat must be a plain data object',
    );
  }
  const prototype = Object.getPrototypeOf(heartbeat);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FuryGatewayNodeSessionError(
      'invalid-heartbeat',
      'node heartbeat must use a plain-object prototype',
    );
  }
  if (Object.getOwnPropertySymbols(heartbeat).length > 0) {
    throw new FuryGatewayNodeSessionError(
      'invalid-heartbeat',
      'node heartbeat must not contain symbol keys',
    );
  }
  const record = heartbeat as unknown as Record<string, unknown>;
  const allowed = new Set(['format', 'sessionId', 'livenessEpoch', 'sequence']);
  for (const key of Object.getOwnPropertyNames(record)) {
    if (!allowed.has(key)) {
      throw new FuryGatewayNodeSessionError(
        'invalid-heartbeat',
        `node heartbeat contains unsupported field: ${key}`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryGatewayNodeSessionError(
        'invalid-heartbeat',
        'node heartbeat must contain enumerable data properties only',
      );
    }
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayNodeSessionError(
        'invalid-heartbeat',
        `node heartbeat is missing required field: ${key}`,
      );
    }
  }
  return record;
}

function assertHeartbeatShape(heartbeat: FuryGatewayNodeHeartbeat): void {
  const record = exactHeartbeatRecord(heartbeat);
  if (record.format !== FURY_GATEWAY_NODE_HEARTBEAT_FORMAT) {
    throw new FuryGatewayNodeSessionError(
      'invalid-heartbeat',
      'unsupported node heartbeat format',
    );
  }
  if (
    typeof record.sessionId !== 'string'
    || !/^[A-Za-z0-9_-]{32}$/u.test(record.sessionId)
    || typeof record.livenessEpoch !== 'string'
    || !/^[A-Za-z0-9_-]{22}$/u.test(record.livenessEpoch)
    || typeof record.sequence !== 'number'
    || !Number.isSafeInteger(record.sequence)
    || record.sequence < 1
    || record.sequence > MAX_HEARTBEAT_SEQUENCE
  ) {
    throw new FuryGatewayNodeSessionError(
      'invalid-heartbeat',
      'node heartbeat contains invalid identity or sequence fields',
    );
  }
}

function sameNodeIdentity(
  node: FuryGatewayNodeDescriptor,
  device: FuryGatewayAuthenticatedDevice,
): boolean {
  return node.deviceId === device.deviceId
    && node.publicKeySha256 === device.publicKeySha256
    && node.role === device.role
    && node.clientId === device.clientId
    && node.instanceId === device.instanceId;
}

export function isGeneratedFuryGatewayNodeSession(
  value: unknown,
): value is FuryGatewayNodeSession {
  return typeof value === 'object'
    && value !== null
    && GENERATED_NODE_SESSIONS.has(value);
}

export function isGeneratedFuryGatewayNodeSessionCoordinator(
  value: unknown,
): value is FuryGatewayNodeSessionCoordinator {
  return typeof value === 'object'
    && value !== null
    && GENERATED_NODE_SESSION_COORDINATORS.has(value);
}

export function createFuryGatewayNodeSessionCoordinator(
  options: FuryGatewayNodeSessionCoordinatorOptions,
): FuryGatewayNodeSessionCoordinator {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayNodeRegistry(options.nodeRegistry)
  ) {
    throw new FuryGatewayNodeSessionError(
      'invalid-node-registry',
      'node session coordinator requires a process-local FuryPipe node registry',
    );
  }
  if (!isGeneratedFuryGatewayPairingCoordinator(options.pairingCoordinator)) {
    throw new FuryGatewayNodeSessionError(
      'invalid-pairing-coordinator',
      'node session coordinator requires a process-local FuryPipe pairing coordinator',
    );
  }

  const nodeRegistry = options.nodeRegistry;
  const pairingCoordinator = options.pairingCoordinator;
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new TypeError('gateway node session now must be a function');
  }
  safeNow(now);

  const heartbeatTtlMs = boundedInteger(
    options.heartbeatTtlMs,
    DEFAULT_HEARTBEAT_TTL_MS,
    MIN_HEARTBEAT_TTL_MS,
    HARD_MAX_HEARTBEAT_TTL_MS,
    'heartbeatTtlMs',
  );
  const maxAuthenticatedAgeMs = boundedInteger(
    options.maxAuthenticatedAgeMs,
    DEFAULT_MAX_AUTHENTICATED_AGE_MS,
    MIN_AUTHENTICATED_AGE_MS,
    HARD_MAX_AUTHENTICATED_AGE_MS,
    'maxAuthenticatedAgeMs',
  );
  const maxActiveSessions = boundedInteger(
    options.maxActiveSessions,
    DEFAULT_MAX_ACTIVE_SESSIONS,
    1,
    HARD_MAX_ACTIVE_SESSIONS,
    'maxActiveSessions',
  );

  const states = new WeakMap<FuryGatewayNodeSession, NodeSessionState>();
  const activeByRegistrationId = new Map<string, NodeSessionState>();
  const activeSessionIds = new Set<string>();

  const retire = (
    state: NodeSessionState,
    status: Exclude<FuryGatewayNodeSessionStatus, 'live'>,
  ): void => {
    if (state.status !== 'live') return;
    state.status = status;
    if (activeByRegistrationId.get(state.session.registrationId) === state) {
      activeByRegistrationId.delete(state.session.registrationId);
    }
    activeSessionIds.delete(state.session.sessionId);
  };

  const resolveState = (session: FuryGatewayNodeSession): NodeSessionState => {
    if (!isGeneratedFuryGatewayNodeSession(session)) {
      throw new FuryGatewayNodeSessionError(
        'invalid-session-evidence',
        'node session must be process-local FuryPipe evidence',
      );
    }
    const state = states.get(session);
    if (!state || state.session !== session) {
      throw new FuryGatewayNodeSessionError(
        'invalid-session-evidence',
        'node session is not owned by this coordinator',
      );
    }
    return state;
  };

  const currentAdvertisementForState = (
    state: NodeSessionState,
  ): FuryGatewayNodeCapabilityAdvertisement | undefined => {
    try {
      const advertisement = nodeRegistry.currentAdvertisement(state.node);
      return advertisement !== undefined
        && isGeneratedFuryGatewayNodeCapabilityAdvertisement(advertisement)
        ? advertisement
        : undefined;
    } catch {
      retire(state, 'node-unregistered');
      return undefined;
    }
  };

  const refreshState = (state: NodeSessionState, at: number): FuryGatewayNodeSessionStatus => {
    if (state.status !== 'live') return state.status;

    if (at < state.lastHeartbeatAt || at - state.lastHeartbeatAt > heartbeatTtlMs) {
      retire(state, 'timed-out');
      return state.status;
    }

    currentAdvertisementForState(state);
    if (state.status !== 'live') return state.status;

    let pairing;
    try {
      pairing = pairingCoordinator.inspectPairing(state.device);
    } catch {
      retire(state, 'pairing-changed');
      return state.status;
    }
    if (!pairing) {
      retire(state, 'pairing-revoked');
      return state.status;
    }
    if (pairing.pairingId !== state.session.pairingId) {
      retire(state, 'pairing-changed');
      return state.status;
    }

    return state.status;
  };

  const capabilityObservation = (
    state: NodeSessionState,
  ): FuryGatewayNodeSessionCapabilityObservation | undefined => {
    if (state.status !== 'live') return undefined;
    const current = currentAdvertisementForState(state);
    if (!current || state.status !== 'live') return undefined;
    if (
      state.baselineAdvertisementGeneration !== undefined
      && current.generation <= state.baselineAdvertisementGeneration
    ) {
      return undefined;
    }
    return Object.freeze({
      generation: current.generation,
      capabilitiesDigestSha256: current.capabilitiesDigestSha256,
      advertisedAt: current.advertisedAt,
      currentForSession: true as const,
      authority: 'advertisement-observation-only' as const,
      executionAuthority: false as const,
    });
  };

  const observe = (
    state: NodeSessionState,
    at: number,
  ): FuryGatewayNodeSessionObservation => {
    refreshState(state, at);
    const liveUntil = safeLiveUntil(state.lastHeartbeatAt, heartbeatTtlMs);
    const capability = capabilityObservation(state);
    return Object.freeze({
      format: FURY_GATEWAY_NODE_SESSION_OBSERVATION_FORMAT,
      sessionId: state.session.sessionId,
      livenessEpoch: state.session.livenessEpoch,
      registrationId: state.session.registrationId,
      deviceId: state.session.deviceId,
      pairingId: state.session.pairingId,
      clientId: state.session.clientId,
      instanceId: state.session.instanceId,
      connectedAt: state.session.connectedAt,
      lastHeartbeatAt: state.lastHeartbeatAt,
      heartbeatSequence: state.heartbeatSequence,
      heartbeatTtlMs,
      liveUntil,
      status: state.status,
      ...(capability === undefined ? {} : { capability }),
      authority: 'node-session-observation-only' as const,
      authorization: 'none' as const,
      executionAuthority: false as const,
      automaticReplayAllowed: false as const,
    });
  };

  const coordinator: FuryGatewayNodeSessionCoordinator = Object.freeze({
    openSession(
      node: FuryGatewayNodeDescriptor,
      device: FuryGatewayAuthenticatedDevice,
    ): FuryGatewayNodeSession {
      const connectedAt = safeNow(now);

      if (!isGeneratedFuryGatewayNodeDescriptor(node)) {
        throw new FuryGatewayNodeSessionError(
          'invalid-node-evidence',
          'node session requires process-local node registry evidence',
        );
      }
      let baselineAdvertisement: FuryGatewayNodeCapabilityAdvertisement | undefined;
      try {
        baselineAdvertisement = nodeRegistry.currentAdvertisement(node);
      } catch {
        throw new FuryGatewayNodeSessionError(
          'invalid-node-evidence',
          'node descriptor does not belong to this node registry',
        );
      }
      if (
        !isGeneratedFuryGatewayAuthenticatedDevice(device)
        || device.authority !== 'authenticated-device'
        || device.pairing !== 'unpaired'
        || device.authorization !== 'none'
        || device.role !== 'node'
      ) {
        throw new FuryGatewayNodeSessionError(
          'invalid-authenticated-device',
          'node session requires process-local authenticated node evidence',
        );
      }
      if (
        device.authenticatedAt > connectedAt
        || connectedAt - device.authenticatedAt > maxAuthenticatedAgeMs
      ) {
        throw new FuryGatewayNodeSessionError(
          'authenticated-device-stale',
          'node session requires fresh authenticated-device evidence',
        );
      }
      if (!sameNodeIdentity(node, device)) {
        throw new FuryGatewayNodeSessionError(
          'identity-mismatch',
          'authenticated device identity does not match the registered node',
        );
      }

      let pairing;
      try {
        pairing = pairingCoordinator.inspectPairing(device);
      } catch {
        throw new FuryGatewayNodeSessionError(
          'pairing-required',
          'node session requires a current matching pairing',
        );
      }
      if (!pairing) {
        throw new FuryGatewayNodeSessionError(
          'pairing-required',
          'node session requires a current matching pairing',
        );
      }
      if (pairing.pairingId !== node.pairingId) {
        throw new FuryGatewayNodeSessionError(
          'pairing-changed',
          'node registration is bound to an older pairing identity',
        );
      }

      const previous = activeByRegistrationId.get(node.registrationId);
      if (previous) {
        refreshState(previous, connectedAt);
        if (previous.status === 'live') retire(previous, 'superseded');
      }
      if (activeByRegistrationId.size >= maxActiveSessions) {
        throw new FuryGatewayNodeSessionError(
          'limit-exceeded',
          'gateway node session registry is full',
        );
      }

      const sessionId = nextRandomId(activeSessionIds, 24);
      const livenessEpoch = randomBytes(16).toString('base64url');
      const session: FuryGatewayNodeSession = Object.freeze({
        format: FURY_GATEWAY_NODE_SESSION_FORMAT,
        sessionId,
        livenessEpoch,
        registrationId: node.registrationId,
        deviceId: node.deviceId,
        publicKeySha256: node.publicKeySha256,
        pairingId: node.pairingId,
        clientId: node.clientId,
        instanceId: node.instanceId,
        connectedAt,
        lastHeartbeatAt: connectedAt,
        heartbeatTtlMs,
        authority: 'node-session-evidence-only' as const,
        authorization: 'none' as const,
        executionAuthority: false as const,
        automaticReplayAllowed: false as const,
      });
      const state: NodeSessionState = {
        session,
        node,
        device,
        ...(baselineAdvertisement === undefined
          ? {}
          : { baselineAdvertisementGeneration: baselineAdvertisement.generation }),
        status: 'live',
        lastHeartbeatAt: connectedAt,
        heartbeatSequence: 0,
      };
      GENERATED_NODE_SESSIONS.add(session);
      states.set(session, state);
      activeByRegistrationId.set(node.registrationId, state);
      activeSessionIds.add(sessionId);
      return session;
    },

    heartbeat(
      session: FuryGatewayNodeSession,
      heartbeat: FuryGatewayNodeHeartbeat,
    ): FuryGatewayNodeSessionObservation {
      assertHeartbeatShape(heartbeat);
      const at = safeNow(now);
      const state = resolveState(session);
      refreshState(state, at);
      if (state.status !== 'live') {
        throw new FuryGatewayNodeSessionError(
          'session-not-live',
          `node session is not live: ${state.status}`,
        );
      }
      if (
        heartbeat.sessionId !== session.sessionId
        || heartbeat.livenessEpoch !== session.livenessEpoch
      ) {
        throw new FuryGatewayNodeSessionError(
          'invalid-heartbeat',
          'node heartbeat is bound to a different session identity',
        );
      }
      if (heartbeat.sequence <= state.heartbeatSequence) {
        throw new FuryGatewayNodeSessionError(
          'stale-heartbeat',
          'node heartbeat sequence must increase monotonically',
        );
      }
      state.heartbeatSequence = heartbeat.sequence;
      state.lastHeartbeatAt = at;
      return observe(state, at);
    },

    closeSession(session: FuryGatewayNodeSession): boolean {
      const at = safeNow(now);
      const state = resolveState(session);
      refreshState(state, at);
      if (state.status !== 'live') return false;
      retire(state, 'closed');
      return true;
    },

    inspectSession(session: FuryGatewayNodeSession): FuryGatewayNodeSessionObservation {
      const at = safeNow(now);
      return observe(resolveState(session), at);
    },

    isLiveSession(session: FuryGatewayNodeSession): boolean {
      const at = safeNow(now);
      try {
        const state = resolveState(session);
        return refreshState(state, at) === 'live';
      } catch {
        return false;
      }
    },

    snapshot(): FuryGatewayNodeSessionSnapshot {
      const observedAt = safeNow(now);
      const sessions: FuryGatewayNodeSessionSnapshotEntry[] = [];
      for (const state of [...activeByRegistrationId.values()]) {
        if (refreshState(state, observedAt) !== 'live') continue;
        const capability = capabilityObservation(state);
        sessions.push(Object.freeze({
          sessionId: state.session.sessionId,
          livenessEpoch: state.session.livenessEpoch,
          registrationId: state.session.registrationId,
          deviceId: state.session.deviceId,
          pairingId: state.session.pairingId,
          connectedAt: state.session.connectedAt,
          lastHeartbeatAt: state.lastHeartbeatAt,
          heartbeatSequence: state.heartbeatSequence,
          liveUntil: safeLiveUntil(state.lastHeartbeatAt, heartbeatTtlMs),
          ...(capability === undefined
            ? {}
            : {
                capabilityGeneration: capability.generation,
                capabilitiesDigestSha256: capability.capabilitiesDigestSha256,
              }),
          authority: 'node-session-observation-only' as const,
          executionAuthority: false as const,
        }));
      }
      sessions.sort((a, b) => (
        a.registrationId < b.registrationId ? -1 : a.registrationId > b.registrationId ? 1 : 0
      ));
      return Object.freeze({
        format: FURY_GATEWAY_NODE_SESSION_SNAPSHOT_FORMAT,
        observedAt,
        liveSessionCount: sessions.length,
        sessions: Object.freeze(sessions),
        authority: 'node-session-observation-only' as const,
        executionAuthority: false as const,
      });
    },

    activeSessionCount(): number {
      const at = safeNow(now);
      for (const state of [...activeByRegistrationId.values()]) {
        refreshState(state, at);
      }
      return activeByRegistrationId.size;
    },
  });

  GENERATED_NODE_SESSION_COORDINATORS.add(coordinator);
  return coordinator;
}
