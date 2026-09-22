import { createHash, randomBytes } from 'node:crypto';

import type { FuryGatewayAuthenticatedDevice } from './gateway-auth-node.js';
import type { FuryGatewayPairingCoordinator } from './gateway-pairing-node.js';
import {
  FURY_GATEWAY_COMMAND_FORMAT,
  createFuryGatewayCommandRegistry,
  evaluateFuryGatewayCommandAdmission,
  type FuryGatewayCommandAdmissionDecision,
} from './gateway-command-authorization-node.js';
import {
  isGeneratedFuryGatewaySessionLease,
  type FuryGatewaySessionCoordinator,
  type FuryGatewaySessionLease,
} from './gateway-session-node.js';
import {
  isGeneratedFuryGatewayNodeCapabilityAdvertisement,
  isGeneratedFuryGatewayNodeDescriptor,
  isGeneratedFuryGatewayNodeRegistry,
  type FuryGatewayNodeCapabilityAdvertisement,
  type FuryGatewayNodeDescriptor,
  type FuryGatewayNodeRegistry,
} from './gateway-node-registry-node.js';
import {
  isGeneratedFuryGatewayNodeSession,
  isGeneratedFuryGatewayNodeSessionCoordinator,
  type FuryGatewayNodeSession,
  type FuryGatewayNodeSessionCoordinator,
  type FuryGatewayNodeSessionObservation,
} from './gateway-node-session-node.js';

export const FURY_GATEWAY_NODE_OPERATION_FORMAT =
  'furypipe-gateway-node-operation/v1' as const;
export const FURY_GATEWAY_NODE_OPERATION_PERMIT_FORMAT =
  'furypipe-gateway-node-operation-permit/v1' as const;
export const FURY_GATEWAY_NODE_OPERATION_CONSUME_RECEIPT_FORMAT =
  'furypipe-gateway-node-operation-consume-receipt/v1' as const;

export interface FuryGatewayNodeOperation {
  readonly format: typeof FURY_GATEWAY_NODE_OPERATION_FORMAT;
  readonly operationId: string;
  readonly capability: string;
  readonly action: string;
  readonly targetDigestSha256: string;
  readonly sideEffecting: boolean;
}

export interface FuryGatewayNodeOperationPermit {
  readonly format: typeof FURY_GATEWAY_NODE_OPERATION_PERMIT_FORMAT;
  readonly permitIdSha256: string;
  readonly operationDigestSha256: string;
  readonly gatewayDecisionIdSha256: string;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly nodeSessionIdSha256: string;
  readonly livenessEpochSha256: string;
  readonly registrationIdSha256: string;
  readonly deviceIdSha256: string;
  readonly pairingIdSha256: string;
  readonly capability: string;
  readonly capabilityGeneration: number;
  readonly capabilitiesDigestSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly authority: 'node-operation-permit';
  readonly executionAuthority: true;
  readonly automaticReplayAllowed: false;
}

export interface FuryGatewayNodeOperationConsumeReceipt {
  readonly format: typeof FURY_GATEWAY_NODE_OPERATION_CONSUME_RECEIPT_FORMAT;
  readonly permitIdSha256: string;
  readonly operationDigestSha256: string;
  readonly gatewayDecisionIdSha256: string;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly nodeSessionIdSha256: string;
  readonly registrationIdSha256: string;
  readonly capability: string;
  readonly capabilityGeneration: number;
  readonly capabilitiesDigestSha256: string;
  readonly consumedAt: number;
  readonly outcome: 'consumed-for-dispatch';
  readonly sideEffecting: boolean;
  readonly reconciliationRequiredIfDispatchOutcomeUnknown: boolean;
  readonly retrySafe: false;
  readonly authority: 'dispatch-admission-evidence-only';
  readonly executionAuthority: false;
  readonly automaticReplayAllowed: false;
}

export interface FuryGatewayNodeOperationCoordinatorOptions {
  readonly nodeRegistry: FuryGatewayNodeRegistry;
  readonly nodeSessionCoordinator: FuryGatewayNodeSessionCoordinator;
  readonly gatewaySessionCoordinator: FuryGatewaySessionCoordinator;
  readonly gatewaySession: FuryGatewaySessionLease;
  readonly currentDevice?: FuryGatewayAuthenticatedDevice;
  readonly pairing?: FuryGatewayPairingCoordinator;
  readonly now?: () => number;
  readonly permitTtlMs?: number;
  readonly maxActivePermits?: number;
}

export interface FuryGatewayNodeOperationCoordinator {
  issuePermit(
    node: FuryGatewayNodeDescriptor,
    nodeSession: FuryGatewayNodeSession,
    advertisement: FuryGatewayNodeCapabilityAdvertisement,
    operation: FuryGatewayNodeOperation,
  ): FuryGatewayNodeOperationPermit;
  consumeForDispatch(
    permit: FuryGatewayNodeOperationPermit,
    expectedOperation: FuryGatewayNodeOperation,
  ): FuryGatewayNodeOperationConsumeReceipt;
  activePermitCount(): number;
}

export type FuryGatewayNodeOperationErrorCode =
  | 'invalid-config'
  | 'invalid-operation'
  | 'invalid-node-evidence'
  | 'invalid-session-evidence'
  | 'node-session-not-live'
  | 'capability-not-current'
  | 'capability-not-advertised'
  | 'gateway-admission-denied'
  | 'invalid-permit'
  | 'permit-consumed'
  | 'permit-expired'
  | 'permit-stale'
  | 'limit-exceeded';

const ERROR_MESSAGES: Readonly<Record<FuryGatewayNodeOperationErrorCode, string>> = Object.freeze({
  'invalid-config': 'node operation coordinator configuration is invalid',
  'invalid-operation': 'node operation is invalid',
  'invalid-node-evidence': 'node operation requires current process-local node evidence',
  'invalid-session-evidence': 'node operation requires current process-local node-session evidence',
  'node-session-not-live': 'node operation requires a currently live node session',
  'capability-not-current': 'node capability advertisement is not current for this live session',
  'capability-not-advertised': 'requested node capability is not advertised',
  'gateway-admission-denied': 'gateway policy does not currently admit node operation dispatch',
  'invalid-permit': 'node operation permit is not current process-local evidence',
  'permit-consumed': 'node operation permit was already consumed',
  'permit-expired': 'node operation permit expired',
  'permit-stale': 'node operation permit no longer matches current authority',
  'limit-exceeded': 'node operation permit registry reached its configured limit',
});

export class FuryGatewayNodeOperationError extends Error {
  readonly retrySafe = false;

  constructor(readonly code: FuryGatewayNodeOperationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryGatewayNodeOperationError';
  }
}

interface PermitState {
  readonly coordinator: FuryGatewayNodeOperationCoordinator;
  readonly permit: FuryGatewayNodeOperationPermit;
  readonly node: FuryGatewayNodeDescriptor;
  readonly nodeSession: FuryGatewayNodeSession;
  readonly advertisement: FuryGatewayNodeCapabilityAdvertisement;
  readonly operation: FuryGatewayNodeOperation;
  consumed: boolean;
}

const GENERATED_COORDINATORS = new WeakSet<object>();
const GENERATED_PERMITS = new WeakSet<object>();
const PERMIT_STATES = new WeakMap<object, PermitState>();

const DEFAULT_PERMIT_TTL_MS = 15_000;
const MIN_PERMIT_TTL_MS = 1_000;
const HARD_MAX_PERMIT_TTL_MS = 60_000;
const DEFAULT_MAX_ACTIVE_PERMITS = 1_024;
const HARD_MAX_ACTIVE_PERMITS = 65_536;
const MAX_OPERATION_BYTES = 2 * 1024;
const SAFE_TOKEN = /^[a-z][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digest(label: string, value: string): string {
  return createHash('sha256')
    .update('furypipe-node-operation/v1\0', 'utf8')
    .update(label, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
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

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('gateway node operation clock must return a safe non-negative timestamp');
  }
  return value;
}

function exactOperationRecord(
  operation: FuryGatewayNodeOperation,
): Readonly<Record<string, unknown>> {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new FuryGatewayNodeOperationError('invalid-operation');
  }
  const prototype = Object.getPrototypeOf(operation);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FuryGatewayNodeOperationError('invalid-operation');
  }
  if (Object.getOwnPropertySymbols(operation).length !== 0) {
    throw new FuryGatewayNodeOperationError('invalid-operation');
  }
  const record = operation as unknown as Record<string, unknown>;
  const required = [
    'format',
    'operationId',
    'capability',
    'action',
    'targetDigestSha256',
    'sideEffecting',
  ] as const;
  const allowed = new Set(required);
  for (const key of Object.getOwnPropertyNames(record)) {
    if (!allowed.has(key as (typeof required)[number])) {
      throw new FuryGatewayNodeOperationError('invalid-operation');
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryGatewayNodeOperationError('invalid-operation');
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayNodeOperationError('invalid-operation');
    }
  }
  return record;
}

function normalizeOperation(operation: FuryGatewayNodeOperation): FuryGatewayNodeOperation {
  const record = exactOperationRecord(operation);
  if (
    record.format !== FURY_GATEWAY_NODE_OPERATION_FORMAT
    || typeof record.operationId !== 'string'
    || !SAFE_TOKEN.test(record.operationId)
    || typeof record.capability !== 'string'
    || !SAFE_TOKEN.test(record.capability)
    || typeof record.action !== 'string'
    || !SAFE_TOKEN.test(record.action)
    || typeof record.targetDigestSha256 !== 'string'
    || !SHA256.test(record.targetDigestSha256)
    || typeof record.sideEffecting !== 'boolean'
  ) {
    throw new FuryGatewayNodeOperationError('invalid-operation');
  }
  const normalized = Object.freeze({
    format: FURY_GATEWAY_NODE_OPERATION_FORMAT,
    operationId: record.operationId,
    capability: record.capability,
    action: record.action,
    targetDigestSha256: record.targetDigestSha256,
    sideEffecting: record.sideEffecting,
  });
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_OPERATION_BYTES) {
    throw new FuryGatewayNodeOperationError('invalid-operation');
  }
  return normalized;
}

function operationDigest(operation: FuryGatewayNodeOperation): string {
  return digest('operation', JSON.stringify(operation));
}

function currentGatewayAdmission(
  options: FuryGatewayNodeOperationCoordinatorOptions,
): FuryGatewayCommandAdmissionDecision {
  const registry = createFuryGatewayCommandRegistry([{
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'nodes.operation.dispatch',
    allowedRoles: ['operator'],
    requiredScopes: ['nodes.manage'],
    requiredPluginPermissions: [],
    riskClass: 'process',
    requiresFreshApproval: false,
  }]);
  return evaluateFuryGatewayCommandAdmission({
    sessionCoordinator: options.gatewaySessionCoordinator,
    session: options.gatewaySession,
    commandRegistry: registry,
    commandName: 'nodes.operation.dispatch',
    declaredPluginPermissions: [],
    ...(options.currentDevice === undefined ? {} : { currentDevice: options.currentDevice }),
    ...(options.pairing === undefined ? {} : { pairing: options.pairing }),
  });
}

function matchingLiveObservation(
  nodeRegistry: FuryGatewayNodeRegistry,
  nodeSessionCoordinator: FuryGatewayNodeSessionCoordinator,
  node: FuryGatewayNodeDescriptor,
  nodeSession: FuryGatewayNodeSession,
  advertisement: FuryGatewayNodeCapabilityAdvertisement,
  capability: string,
): FuryGatewayNodeSessionObservation {
  if (!isGeneratedFuryGatewayNodeDescriptor(node)) {
    throw new FuryGatewayNodeOperationError('invalid-node-evidence');
  }
  if (!isGeneratedFuryGatewayNodeSession(nodeSession)) {
    throw new FuryGatewayNodeOperationError('invalid-session-evidence');
  }
  if (!isGeneratedFuryGatewayNodeCapabilityAdvertisement(advertisement)) {
    throw new FuryGatewayNodeOperationError('capability-not-current');
  }
  let observation: FuryGatewayNodeSessionObservation;
  try {
    observation = nodeSessionCoordinator.inspectSession(nodeSession);
  } catch {
    throw new FuryGatewayNodeOperationError('invalid-session-evidence');
  }
  if (observation.status !== 'live') {
    throw new FuryGatewayNodeOperationError('node-session-not-live');
  }
  if (
    nodeSession.registrationId !== node.registrationId
    || nodeSession.deviceId !== node.deviceId
    || nodeSession.pairingId !== node.pairingId
    || advertisement.registrationId !== node.registrationId
    || advertisement.deviceId !== node.deviceId
    || advertisement.pairingId !== node.pairingId
  ) {
    throw new FuryGatewayNodeOperationError('invalid-node-evidence');
  }
  let current: FuryGatewayNodeCapabilityAdvertisement | undefined;
  try {
    current = nodeRegistry.currentAdvertisement(node);
  } catch {
    throw new FuryGatewayNodeOperationError('invalid-node-evidence');
  }
  if (
    current !== advertisement
    || observation.capability === undefined
    || observation.capability.generation !== advertisement.generation
    || observation.capability.capabilitiesDigestSha256 !== advertisement.capabilitiesDigestSha256
  ) {
    throw new FuryGatewayNodeOperationError('capability-not-current');
  }
  if (!advertisement.capabilities.includes(capability)) {
    throw new FuryGatewayNodeOperationError('capability-not-advertised');
  }
  return observation;
}

export function isGeneratedFuryGatewayNodeOperationCoordinator(
  value: unknown,
): value is FuryGatewayNodeOperationCoordinator {
  return typeof value === 'object' && value !== null && GENERATED_COORDINATORS.has(value);
}

export function isGeneratedFuryGatewayNodeOperationPermit(
  value: unknown,
): value is FuryGatewayNodeOperationPermit {
  return typeof value === 'object' && value !== null && GENERATED_PERMITS.has(value);
}

export function createFuryGatewayNodeOperationCoordinator(
  options: FuryGatewayNodeOperationCoordinatorOptions,
): FuryGatewayNodeOperationCoordinator {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayNodeRegistry(options.nodeRegistry)
    || !isGeneratedFuryGatewayNodeSessionCoordinator(options.nodeSessionCoordinator)
    || !isGeneratedFuryGatewaySessionLease(options.gatewaySession)
    || !options.gatewaySessionCoordinator
    || typeof options.gatewaySessionCoordinator.inspectSession !== 'function'
  ) {
    throw new FuryGatewayNodeOperationError('invalid-config');
  }
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') throw new FuryGatewayNodeOperationError('invalid-config');
  safeNow(now);
  const permitTtlMs = boundedInteger(
    options.permitTtlMs,
    DEFAULT_PERMIT_TTL_MS,
    MIN_PERMIT_TTL_MS,
    HARD_MAX_PERMIT_TTL_MS,
    'permitTtlMs',
  );
  const maxActivePermits = boundedInteger(
    options.maxActivePermits,
    DEFAULT_MAX_ACTIVE_PERMITS,
    1,
    HARD_MAX_ACTIVE_PERMITS,
    'maxActivePermits',
  );
  const active = new Map<FuryGatewayNodeOperationPermit, PermitState>();

  const prune = (at: number): void => {
    for (const [permit, state] of active) {
      if (state.consumed || at > permit.expiresAt) active.delete(permit);
    }
  };

  const gatewayAdmission = (): FuryGatewayCommandAdmissionDecision => {
    const decision = currentGatewayAdmission(options);
    if (decision.outcome !== 'eligible') {
      throw new FuryGatewayNodeOperationError('gateway-admission-denied');
    }
    return decision;
  };

  let coordinator: FuryGatewayNodeOperationCoordinator;

  coordinator = Object.freeze({
    issuePermit(
      node: FuryGatewayNodeDescriptor,
      nodeSession: FuryGatewayNodeSession,
      advertisement: FuryGatewayNodeCapabilityAdvertisement,
      operationInput: FuryGatewayNodeOperation,
    ): FuryGatewayNodeOperationPermit {
      const at = safeNow(now);
      prune(at);
      if (active.size >= maxActivePermits) {
        throw new FuryGatewayNodeOperationError('limit-exceeded');
      }
      const operation = normalizeOperation(operationInput);
      const decision = gatewayAdmission();
      matchingLiveObservation(
        options.nodeRegistry,
        options.nodeSessionCoordinator,
        node,
        nodeSession,
        advertisement,
        operation.capability,
      );
      const expiresAt = at + permitTtlMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new RangeError('node operation permit expiry exceeds safe integer range');
      }
      const permitIdSha256 = digest(
        'permit',
        randomBytes(32).toString('base64url'),
      );
      const permit: FuryGatewayNodeOperationPermit = Object.freeze({
        format: FURY_GATEWAY_NODE_OPERATION_PERMIT_FORMAT,
        permitIdSha256,
        operationDigestSha256: operationDigest(operation),
        gatewayDecisionIdSha256: decision.decisionIdSha256,
        gatewaySessionIdSha256: digest('gateway-session', options.gatewaySession.sessionId),
        principalIdSha256: digest('principal', options.gatewaySession.principalId),
        nodeSessionIdSha256: digest('node-session', nodeSession.sessionId),
        livenessEpochSha256: digest('liveness-epoch', nodeSession.livenessEpoch),
        registrationIdSha256: digest('registration', node.registrationId),
        deviceIdSha256: digest('device', node.deviceId),
        pairingIdSha256: digest('pairing', node.pairingId),
        capability: operation.capability,
        capabilityGeneration: advertisement.generation,
        capabilitiesDigestSha256: advertisement.capabilitiesDigestSha256,
        issuedAt: at,
        expiresAt,
        authority: 'node-operation-permit' as const,
        executionAuthority: true as const,
        automaticReplayAllowed: false as const,
      });
      const state: PermitState = {
        coordinator,
        permit,
        node,
        nodeSession,
        advertisement,
        operation,
        consumed: false,
      };
      GENERATED_PERMITS.add(permit);
      PERMIT_STATES.set(permit, state);
      active.set(permit, state);
      return permit;
    },

    consumeForDispatch(
      permit: FuryGatewayNodeOperationPermit,
      expectedOperationInput: FuryGatewayNodeOperation,
    ): FuryGatewayNodeOperationConsumeReceipt {
      const at = safeNow(now);
      prune(at);
      if (!isGeneratedFuryGatewayNodeOperationPermit(permit)) {
        throw new FuryGatewayNodeOperationError('invalid-permit');
      }
      const state = PERMIT_STATES.get(permit);
      if (!state || state.coordinator !== coordinator || state.permit !== permit) {
        throw new FuryGatewayNodeOperationError('invalid-permit');
      }
      if (state.consumed) {
        throw new FuryGatewayNodeOperationError('permit-consumed');
      }
      if (at > permit.expiresAt) {
        active.delete(permit);
        throw new FuryGatewayNodeOperationError('permit-expired');
      }
      const expectedOperation = normalizeOperation(expectedOperationInput);
      if (operationDigest(expectedOperation) !== permit.operationDigestSha256) {
        throw new FuryGatewayNodeOperationError('permit-stale');
      }

      let decision: FuryGatewayCommandAdmissionDecision;
      try {
        decision = gatewayAdmission();
        matchingLiveObservation(
          options.nodeRegistry,
          options.nodeSessionCoordinator,
          state.node,
          state.nodeSession,
          state.advertisement,
          state.operation.capability,
        );
      } catch (error) {
        if (error instanceof FuryGatewayNodeOperationError) {
          throw new FuryGatewayNodeOperationError('permit-stale');
        }
        throw error;
      }

      if (
        decision.decisionIdSha256 !== permit.gatewayDecisionIdSha256
        || digest('gateway-session', options.gatewaySession.sessionId) !== permit.gatewaySessionIdSha256
        || digest('principal', options.gatewaySession.principalId) !== permit.principalIdSha256
      ) {
        throw new FuryGatewayNodeOperationError('permit-stale');
      }

      state.consumed = true;
      active.delete(permit);
      return Object.freeze({
        format: FURY_GATEWAY_NODE_OPERATION_CONSUME_RECEIPT_FORMAT,
        permitIdSha256: permit.permitIdSha256,
        operationDigestSha256: permit.operationDigestSha256,
        gatewayDecisionIdSha256: decision.decisionIdSha256,
        gatewaySessionIdSha256: permit.gatewaySessionIdSha256,
        principalIdSha256: permit.principalIdSha256,
        nodeSessionIdSha256: permit.nodeSessionIdSha256,
        registrationIdSha256: permit.registrationIdSha256,
        capability: permit.capability,
        capabilityGeneration: permit.capabilityGeneration,
        capabilitiesDigestSha256: permit.capabilitiesDigestSha256,
        consumedAt: at,
        outcome: 'consumed-for-dispatch' as const,
        sideEffecting: state.operation.sideEffecting,
        reconciliationRequiredIfDispatchOutcomeUnknown: state.operation.sideEffecting,
        retrySafe: false as const,
        authority: 'dispatch-admission-evidence-only' as const,
        executionAuthority: false as const,
        automaticReplayAllowed: false as const,
      });
    },

    activePermitCount(): number {
      const at = safeNow(now);
      prune(at);
      return active.size;
    },
  });

  GENERATED_COORDINATORS.add(coordinator);
  return coordinator;
}