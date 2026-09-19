import { randomBytes } from 'node:crypto';

import {
  isGeneratedFuryGatewayAuthenticatedDevice,
  type FuryGatewayAuthenticatedDevice,
} from './gateway-auth-node.js';
import {
  type FuryGatewayPairedDevice,
  type FuryGatewayPairingCoordinator,
} from './gateway-pairing-node.js';
import {
  isGeneratedFuryGatewayAuthenticatedPrincipal,
  type FuryGatewayAuthenticatedPrincipal,
  type FuryGatewayPrincipalRegistry,
} from './gateway-principal-node.js';
import {
  FURY_GATEWAY_ROLES,
  type FuryGatewayRole,
} from './gateway.js';

export const FURY_GATEWAY_SESSION_FORMAT = 'furypipe-gateway-session/v1' as const;

export const FURY_GATEWAY_SCOPES = [
  'gateway.inspect',
  'sessions.inspect',
  'sessions.manage',
  'pairings.inspect',
  'pairings.manage',
  'channels.inspect',
  'channels.manage',
  'memory.read',
  'memory.write',
  'memory.manage',
  'automations.inspect',
  'automations.manage',
  'nodes.inspect',
  'nodes.manage',
  'workers.inspect',
  'workers.submit',
  'workers.manage',
  'plugins.inspect',
  'plugins.manage',
  'skills.inspect',
  'skills.manage',
  'mcp.inspect',
  'mcp.manage',
  'models.inspect',
  'models.manage',
  'evidence.read',
  'settings.inspect',
  'settings.manage',
  'capability.network',
  'capability.browser',
  'capability.process',
  'capability.repository-read',
  'capability.repository-write',
  'capability.database-read',
  'capability.database-write',
  'capability.design-read',
  'capability.design-write',
  'capability.cloud-read',
  'capability.cloud-write',
  'capability.provider-inference',
  'capability.provider-management',
] as const;

export type FuryGatewayScope = (typeof FURY_GATEWAY_SCOPES)[number];

export interface FuryGatewayLocalOperatorBinding {
  readonly kind: 'local-operator';
}

export interface FuryGatewayPairedDeviceBinding {
  readonly kind: 'paired-device';
  readonly device: FuryGatewayAuthenticatedDevice;
  readonly pairing: FuryGatewayPairingCoordinator;
}

export type FuryGatewaySessionBindingInput =
  | FuryGatewayLocalOperatorBinding
  | FuryGatewayPairedDeviceBinding;

export interface FuryGatewaySessionBinding {
  readonly kind: 'local-operator' | 'paired-device';
  readonly deviceId?: string;
  readonly publicKeySha256?: string;
  readonly pairingId?: string;
  readonly connectFingerprint?: string;
  readonly deviceAuthenticatedAt?: number;
}

export interface FuryGatewaySessionLease {
  readonly format: typeof FURY_GATEWAY_SESSION_FORMAT;
  readonly sessionId: string;
  readonly principalId: string;
  readonly principalGeneration: number;
  readonly principalAuthenticatedAt: number;
  readonly role: FuryGatewayRole;
  readonly audience: string;
  readonly scopes: readonly FuryGatewayScope[];
  readonly binding: FuryGatewaySessionBinding;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly authority: 'session-lease';
}

export type FuryGatewaySessionStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'principal-revoked';

export interface FuryGatewaySessionInspection {
  readonly sessionId: string;
  readonly principalId: string;
  readonly role: FuryGatewayRole;
  readonly audience: string;
  readonly scopes: readonly FuryGatewayScope[];
  readonly binding: FuryGatewaySessionBinding;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly status: FuryGatewaySessionStatus;
}

export type FuryGatewaySessionErrorCode =
  | 'invalid-principal-evidence'
  | 'invalid-role'
  | 'invalid-scope'
  | 'invalid-binding'
  | 'device-auth-stale'
  | 'pairing-required'
  | 'session-expired'
  | 'session-revoked'
  | 'principal-revoked'
  | 'invalid-session'
  | 'limit-exceeded';

export class FuryGatewaySessionError extends Error {
  readonly code: FuryGatewaySessionErrorCode;

  constructor(code: FuryGatewaySessionErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewaySessionError';
    this.code = code;
  }
}

export interface FuryGatewaySessionCoordinatorOptions {
  readonly principalRegistry: FuryGatewayPrincipalRegistry;
  readonly gatewayInstanceId: string;
  readonly now?: () => number;
  readonly defaultTtlMs?: number;
  readonly maxTtlMs?: number;
  readonly maxDeviceAuthAgeMs?: number;
  readonly terminalRetentionMs?: number;
  readonly maxSessions?: number;
}

export interface FuryGatewayIssueSessionInput {
  readonly principal: FuryGatewayAuthenticatedPrincipal;
  readonly role: FuryGatewayRole;
  readonly scopes: readonly FuryGatewayScope[];
  readonly binding: FuryGatewaySessionBindingInput;
  readonly expiresInMs?: number;
}

export interface FuryGatewaySessionCoordinator {
  issueSession(input: FuryGatewayIssueSessionInput): FuryGatewaySessionLease;
  revokeSession(sessionId: string): boolean;
  inspectSession(session: FuryGatewaySessionLease): FuryGatewaySessionInspection;
  isActiveSession(session: FuryGatewaySessionLease): boolean;
  activeCount(): number;
}

interface SessionState {
  readonly lease: FuryGatewaySessionLease;
  status: FuryGatewaySessionStatus;
  terminalAt?: number;
}

const SESSION_EVIDENCE = new WeakSet<object>();
const SESSION_ID_RE = /^[A-Za-z0-9_-]{32}$/u;
const GATEWAY_INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SCOPE_SET = new Set<string>(FURY_GATEWAY_SCOPES);
const DEFAULT_SESSION_TTL_MS = 15 * 60_000;
const MIN_SESSION_TTL_MS = 30_000;
const MAX_SESSION_TTL_MS = 60 * 60_000;
const DEFAULT_MAX_DEVICE_AUTH_AGE_MS = 60_000;
const MIN_DEVICE_AUTH_AGE_MS = 5_000;
const MAX_DEVICE_AUTH_AGE_MS = 5 * 60_000;
const DEFAULT_TERMINAL_RETENTION_MS = 5 * 60_000;
const MIN_TERMINAL_RETENTION_MS = 30_000;
const MAX_TERMINAL_RETENTION_MS = 60 * 60_000;
const DEFAULT_MAX_SESSIONS = 8_192;
const MAX_SESSIONS = 100_000;

function finiteNow(now: () => number): number {
  const value = now();
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(normalized)) {
    throw new RangeError('gateway session clock must return a safe non-negative timestamp');
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
    throw new RangeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function validateRole(role: FuryGatewayRole): FuryGatewayRole {
  if (!(FURY_GATEWAY_ROLES as readonly string[]).includes(role)) {
    throw new FuryGatewaySessionError('invalid-role', 'gateway session role is unsupported');
  }
  return role;
}

function normalizeScopes(scopes: readonly FuryGatewayScope[]): readonly FuryGatewayScope[] {
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 64) {
    throw new FuryGatewaySessionError('invalid-scope', 'gateway session scopes must contain 1-64 entries');
  }
  const seen = new Set<string>();
  const normalized: FuryGatewayScope[] = [];
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !SCOPE_SET.has(scope)) {
      throw new FuryGatewaySessionError('invalid-scope', 'gateway session contains an unknown scope');
    }
    if (scope.includes('*')) {
      throw new FuryGatewaySessionError('invalid-scope', 'gateway session wildcard scopes are forbidden');
    }
    if (seen.has(scope)) {
      throw new FuryGatewaySessionError('invalid-scope', 'gateway session contains duplicate scopes');
    }
    seen.add(scope);
    normalized.push(scope);
  }
  normalized.sort();
  return Object.freeze(normalized);
}

function nextSessionId(states: Map<string, SessionState>): string {
  let sessionId: string;
  do {
    sessionId = randomBytes(24).toString('base64url');
  } while (states.has(sessionId));
  return sessionId;
}

function refreshSessionStatus(
  state: SessionState,
  principalRegistry: FuryGatewayPrincipalRegistry,
  at: number,
): FuryGatewaySessionStatus {
  if (state.status !== 'active') return state.status;
  if (state.lease.expiresAt < at) {
    state.status = 'expired';
    state.terminalAt = state.lease.expiresAt;
    return state.status;
  }
  if (!principalRegistry.isActiveGeneration(
    state.lease.principalId,
    state.lease.principalGeneration,
  )) {
    state.status = 'principal-revoked';
    state.terminalAt = at;
    return state.status;
  }
  return 'active';
}

function cloneBinding(binding: FuryGatewaySessionBinding): FuryGatewaySessionBinding {
  return Object.freeze({
    kind: binding.kind,
    ...(binding.deviceId === undefined ? {} : { deviceId: binding.deviceId }),
    ...(binding.publicKeySha256 === undefined ? {} : { publicKeySha256: binding.publicKeySha256 }),
    ...(binding.pairingId === undefined ? {} : { pairingId: binding.pairingId }),
    ...(binding.connectFingerprint === undefined ? {} : { connectFingerprint: binding.connectFingerprint }),
    ...(binding.deviceAuthenticatedAt === undefined ? {} : { deviceAuthenticatedAt: binding.deviceAuthenticatedAt }),
  });
}

export function isFuryGatewayScope(value: unknown): value is FuryGatewayScope {
  return typeof value === 'string' && SCOPE_SET.has(value);
}

export function isGeneratedFuryGatewaySessionLease(
  value: unknown,
): value is FuryGatewaySessionLease {
  return typeof value === 'object'
    && value !== null
    && SESSION_EVIDENCE.has(value);
}

export function createFuryGatewaySessionCoordinator(
  options: FuryGatewaySessionCoordinatorOptions,
): FuryGatewaySessionCoordinator {
  if (!options || typeof options !== 'object' || !options.principalRegistry) {
    throw new TypeError('gateway session coordinator requires a principal registry');
  }
  if (
    typeof options.gatewayInstanceId !== 'string'
    || !GATEWAY_INSTANCE_RE.test(options.gatewayInstanceId)
  ) {
    throw new RangeError('gatewayInstanceId is invalid');
  }
  const principalRegistry = options.principalRegistry;
  const audience = options.gatewayInstanceId;
  const now = options.now ?? Date.now;
  const defaultTtlMs = boundedInteger(
    options.defaultTtlMs,
    DEFAULT_SESSION_TTL_MS,
    MIN_SESSION_TTL_MS,
    MAX_SESSION_TTL_MS,
    'defaultTtlMs',
  );
  const maxTtlMs = boundedInteger(
    options.maxTtlMs,
    MAX_SESSION_TTL_MS,
    MIN_SESSION_TTL_MS,
    MAX_SESSION_TTL_MS,
    'maxTtlMs',
  );
  if (defaultTtlMs > maxTtlMs) {
    throw new RangeError('defaultTtlMs must not exceed maxTtlMs');
  }
  const maxDeviceAuthAgeMs = boundedInteger(
    options.maxDeviceAuthAgeMs,
    DEFAULT_MAX_DEVICE_AUTH_AGE_MS,
    MIN_DEVICE_AUTH_AGE_MS,
    MAX_DEVICE_AUTH_AGE_MS,
    'maxDeviceAuthAgeMs',
  );
  const terminalRetentionMs = boundedInteger(
    options.terminalRetentionMs,
    DEFAULT_TERMINAL_RETENTION_MS,
    MIN_TERMINAL_RETENTION_MS,
    MAX_TERMINAL_RETENTION_MS,
    'terminalRetentionMs',
  );
  const maxSessions = boundedInteger(
    options.maxSessions,
    DEFAULT_MAX_SESSIONS,
    1,
    MAX_SESSIONS,
    'maxSessions',
  );

  const states = new Map<string, SessionState>();

  const gc = (at: number): void => {
    for (const [sessionId, state] of states) {
      const status = refreshSessionStatus(state, principalRegistry, at);
      if (
        status !== 'active'
        && state.terminalAt !== undefined
        && at - state.terminalAt > terminalRetentionMs
      ) {
        states.delete(sessionId);
      }
    }
  };

  const resolveState = (session: FuryGatewaySessionLease): SessionState => {
    if (!isGeneratedFuryGatewaySessionLease(session)) {
      throw new FuryGatewaySessionError(
        'invalid-session',
        'gateway session must be process-local FuryPipe evidence',
      );
    }
    const state = states.get(session.sessionId);
    if (!state || state.lease !== session) {
      throw new FuryGatewaySessionError('invalid-session', 'gateway session is not owned by this coordinator');
    }
    return state;
  };

  return Object.freeze({
    issueSession(input: FuryGatewayIssueSessionInput): FuryGatewaySessionLease {
      const issuedAt = finiteNow(now);
      gc(issuedAt);

      if (
        !input
        || typeof input !== 'object'
        || !isGeneratedFuryGatewayAuthenticatedPrincipal(input.principal)
        || !principalRegistry.isCurrentEvidence(input.principal)
      ) {
        throw new FuryGatewaySessionError(
          'invalid-principal-evidence',
          'session issuance requires current process-local principal evidence',
        );
      }
      if (states.size >= maxSessions) {
        throw new FuryGatewaySessionError('limit-exceeded', 'gateway session registry is full');
      }
      const role = validateRole(input.role);
      const scopes = normalizeScopes(input.scopes);
      const expiresInMs = boundedInteger(
        input.expiresInMs,
        defaultTtlMs,
        MIN_SESSION_TTL_MS,
        maxTtlMs,
        'expiresInMs',
      );
      const expiresAt = issuedAt + expiresInMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new RangeError('gateway session expiry must be a safe integer');
      }

      let binding: FuryGatewaySessionBinding;
      if (input.binding?.kind === 'local-operator') {
        if (
          role !== 'operator'
          || input.principal.kind !== 'human'
          || input.principal.authenticationMethod !== 'local-owner'
        ) {
          throw new FuryGatewaySessionError(
            'invalid-binding',
            'local-operator sessions require a local-owner human principal and operator role',
          );
        }
        binding = Object.freeze({ kind: 'local-operator' as const });
      } else if (input.binding?.kind === 'paired-device') {
        const device = input.binding.device;
        if (
          !isGeneratedFuryGatewayAuthenticatedDevice(device)
          || device.role !== role
          || device.authenticatedAt > issuedAt
          || issuedAt - device.authenticatedAt > maxDeviceAuthAgeMs
        ) {
          throw new FuryGatewaySessionError(
            'device-auth-stale',
            'paired-device session requires fresh matching device authentication evidence',
          );
        }
        let paired: FuryGatewayPairedDevice | undefined;
        try {
          paired = input.binding.pairing.inspectPairing(device);
        } catch {
          throw new FuryGatewaySessionError(
            'pairing-required',
            'paired-device session requires a current matching pairing',
          );
        }
        if (!paired) {
          throw new FuryGatewaySessionError(
            'pairing-required',
            'paired-device session requires a current matching pairing',
          );
        }
        binding = Object.freeze({
          kind: 'paired-device' as const,
          deviceId: device.deviceId,
          publicKeySha256: device.publicKeySha256,
          pairingId: paired.pairingId,
          connectFingerprint: device.connectFingerprint,
          deviceAuthenticatedAt: device.authenticatedAt,
        });
      } else {
        throw new FuryGatewaySessionError('invalid-binding', 'gateway session binding is unsupported');
      }

      const lease = Object.freeze({
        format: FURY_GATEWAY_SESSION_FORMAT,
        sessionId: nextSessionId(states),
        principalId: input.principal.principalId,
        principalGeneration: input.principal.generation,
        principalAuthenticatedAt: input.principal.authenticatedAt,
        role,
        audience,
        scopes,
        binding,
        issuedAt,
        expiresAt,
        authority: 'session-lease' as const,
      });
      SESSION_EVIDENCE.add(lease);
      states.set(lease.sessionId, { lease, status: 'active' });
      return lease;
    },

    revokeSession(sessionId: string): boolean {
      if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
        throw new FuryGatewaySessionError('invalid-session', 'gateway session ID is invalid');
      }
      const at = finiteNow(now);
      gc(at);
      const state = states.get(sessionId);
      if (!state || refreshSessionStatus(state, principalRegistry, at) !== 'active') return false;
      state.status = 'revoked';
      state.terminalAt = at;
      return true;
    },

    inspectSession(session: FuryGatewaySessionLease): FuryGatewaySessionInspection {
      const at = finiteNow(now);
      gc(at);
      const state = resolveState(session);
      const status = refreshSessionStatus(state, principalRegistry, at);
      return Object.freeze({
        sessionId: session.sessionId,
        principalId: session.principalId,
        role: session.role,
        audience: session.audience,
        scopes: session.scopes,
        binding: cloneBinding(session.binding),
        issuedAt: session.issuedAt,
        expiresAt: session.expiresAt,
        status,
      });
    },

    isActiveSession(session: FuryGatewaySessionLease): boolean {
      const at = finiteNow(now);
      try {
        gc(at);
        const state = resolveState(session);
        return refreshSessionStatus(state, principalRegistry, at) === 'active';
      } catch {
        return false;
      }
    },

    activeCount(): number {
      const at = finiteNow(now);
      gc(at);
      let count = 0;
      for (const state of states.values()) {
        if (refreshSessionStatus(state, principalRegistry, at) === 'active') count += 1;
      }
      return count;
    },
  });
}