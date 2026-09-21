import { createHash, randomBytes } from 'node:crypto';

import type * as acp from '@agentclientprotocol/sdk';

import {
  FURY_GATEWAY_CAPABILITY_SCOPE_BY_PLUGIN_PERMISSION,
  FURY_GATEWAY_COMMAND_FORMAT,
  FURY_GATEWAY_COMMAND_RISK_CLASSES,
  createFuryGatewayCommandRegistry,
  evaluateFuryGatewayCommandAdmission,
  type FuryGatewayCommandAdmissionDecision,
  type FuryGatewayCommandRiskClass,
} from './gateway-command-authorization-node.js';
import type {
  FuryGatewayAuthenticatedDevice,
} from './gateway-auth-node.js';
import type {
  FuryGatewayPairingCoordinator,
} from './gateway-pairing-node.js';
import {
  isFuryGatewayScope,
  isGeneratedFuryGatewaySessionLease,
  type FuryGatewayScope,
  type FuryGatewaySessionCoordinator,
  type FuryGatewaySessionLease,
} from './gateway-session-node.js';
import type { FuryPluginPermission } from './plugin-bundles.js';
import {
  isGeneratedFuryAcpGatewaySessionBridge,
  type FuryAcpGatewaySessionBridge,
} from './acp-gateway-session-bridge-node.js';
import {
  isGeneratedFuryAcpV1PermissionRequesterForSession,
  isGeneratedFuryAcpV1SessionSnapshot,
  type FuryAcpV1PermissionRequester,
  type FuryAcpV1SessionSnapshot,
} from './acp-v1-server-node.js';

export const FURY_ACP_PERMISSION_OPERATION_FORMAT =
  'furypipe-acp-permission-operation/v1' as const;
export const FURY_ACP_PERMISSION_DECISION_FORMAT =
  'furypipe-acp-permission-decision/v1' as const;
export const FURY_ACP_PERMISSION_PERMIT_FORMAT =
  'furypipe-acp-permission-permit/v1' as const;
export const FURY_ACP_PERMISSION_CONSUME_RECEIPT_FORMAT =
  'furypipe-acp-permission-consume-receipt/v1' as const;

export interface FuryAcpPermissionOperation {
  readonly format: typeof FURY_ACP_PERMISSION_OPERATION_FORMAT;
  readonly operationId: string;
  readonly title: string;
  readonly toolKind: acp.ToolKind;
  readonly riskClass: FuryGatewayCommandRiskClass;
  readonly requiredScopes: readonly FuryGatewayScope[];
  readonly requiredPluginPermissions: readonly FuryPluginPermission[];
}

export type FuryAcpPermissionDecisionReason =
  | 'eligible'
  | 'gateway-admission-denied'
  | 'gateway-admission-denied-after-permission'
  | 'client-cancelled'
  | 'client-rejected'
  | 'permit-window-expired';

export interface FuryAcpPermissionDecision {
  readonly format: typeof FURY_ACP_PERMISSION_DECISION_FORMAT;
  readonly decisionIdSha256: string;
  readonly operationDigestSha256: string;
  readonly acpSessionIdSha256: string;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly permissionRequestIdSha256?: string;
  readonly preGatewayDecisionIdSha256?: string;
  readonly postGatewayDecisionIdSha256?: string;
  readonly selectedOption?: 'allow_once' | 'reject_once' | 'cancelled';
  readonly outcome: 'eligible' | 'deny';
  readonly reason: FuryAcpPermissionDecisionReason;
  readonly executionAuthority: false;
}

export interface FuryAcpPermissionPermit {
  readonly format: typeof FURY_ACP_PERMISSION_PERMIT_FORMAT;
  readonly permitIdSha256: string;
  readonly decisionIdSha256: string;
  readonly operationDigestSha256: string;
  readonly acpSessionIdSha256: string;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly requiredScopes: readonly FuryGatewayScope[];
  readonly requiredPluginPermissions: readonly FuryPluginPermission[];
  readonly riskClass: FuryGatewayCommandRiskClass;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly authority: 'acp-operation-permit';
  readonly executionAuthority: true;
}

export interface FuryAcpPermissionAdmissionResult {
  readonly decision: FuryAcpPermissionDecision;
  readonly permit?: FuryAcpPermissionPermit;
}

export interface FuryAcpPermissionConsumeReceipt {
  readonly format: typeof FURY_ACP_PERMISSION_CONSUME_RECEIPT_FORMAT;
  readonly permitIdSha256: string;
  readonly decisionIdSha256: string;
  readonly operationDigestSha256: string;
  readonly consumedAt: number;
  readonly requiredScopes: readonly FuryGatewayScope[];
  readonly requiredPluginPermissions: readonly FuryPluginPermission[];
  readonly riskClass: FuryGatewayCommandRiskClass;
  readonly authority: 'admitted-operation-data-only';
  readonly executionAuthority: false;
}

export interface FuryAcpPermissionBridgeOptions {
  readonly bridge: FuryAcpGatewaySessionBridge;
  readonly gatewaySessionCoordinator: FuryGatewaySessionCoordinator;
  readonly gatewaySession: FuryGatewaySessionLease;
  readonly currentDevice?: FuryGatewayAuthenticatedDevice;
  readonly pairing?: FuryGatewayPairingCoordinator;
  readonly now?: () => number;
  readonly permitTtlMs?: number;
}

export interface FuryAcpPermissionBridge {
  admit(
    session: FuryAcpV1SessionSnapshot,
    requester: FuryAcpV1PermissionRequester,
    operation: FuryAcpPermissionOperation,
  ): Promise<FuryAcpPermissionAdmissionResult>;
  consume(
    permit: FuryAcpPermissionPermit,
    session: FuryAcpV1SessionSnapshot,
    observedAt?: number,
  ): FuryAcpPermissionConsumeReceipt;
}

export type FuryAcpPermissionBridgeErrorCode =
  | 'invalid-config'
  | 'invalid-session'
  | 'invalid-requester'
  | 'invalid-operation'
  | 'invalid-permit'
  | 'permit-consumed'
  | 'permit-expired'
  | 'permit-stale';

const ERROR_MESSAGES: Readonly<Record<
  FuryAcpPermissionBridgeErrorCode,
  string
>> = Object.freeze({
  'invalid-config': 'ACP permission bridge configuration is invalid.',
  'invalid-session': 'ACP permission session evidence is invalid.',
  'invalid-requester': 'ACP permission requester is not current process-local evidence for this session.',
  'invalid-operation': 'ACP permission operation is invalid.',
  'invalid-permit': 'ACP permission permit is not current process-local evidence.',
  'permit-consumed': 'ACP permission permit was already consumed.',
  'permit-expired': 'ACP permission permit expired.',
  'permit-stale': 'ACP permission permit no longer matches current authority.',
});

export class FuryAcpPermissionBridgeError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: FuryAcpPermissionBridgeErrorCode,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryAcpPermissionBridgeError';
  }
}

interface PermitState {
  readonly coordinator: FuryAcpPermissionBridge;
  readonly operation: FuryAcpPermissionOperation;
  readonly sessionId: string;
  readonly permit: FuryAcpPermissionPermit;
}

const GENERATED_COORDINATORS = new WeakSet<object>();
const PERMITS = new WeakMap<object, PermitState>();
const CONSUMED_PERMITS = new WeakSet<object>();
const OPERATION_ID_RE = /^[a-z][a-z0-9._:-]{0,127}$/u;
const TOOL_KINDS = new Set<acp.ToolKind>([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]);
const PLUGIN_PERMISSIONS = new Set<FuryPluginPermission>(
  Object.keys(
    FURY_GATEWAY_CAPABILITY_SCOPE_BY_PLUGIN_PERMISSION,
  ) as FuryPluginPermission[],
);
const DEFAULT_PERMIT_TTL_MS = 30_000;
const MAX_PERMIT_TTL_MS = 5 * 60_000;
const MAX_TITLE_BYTES = 2 * 1024;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digest(label: string, value: string): string {
  return createHash('sha256')
    .update('furypipe-acp-permission/v1\0', 'utf8')
    .update(label, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function safeNow(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FuryAcpPermissionBridgeError('invalid-config');
  }
  return value as number;
}

function permitTtl(value: number | undefined): number {
  const resolved = value ?? DEFAULT_PERMIT_TTL_MS;
  if (
    !Number.isSafeInteger(resolved)
    || resolved < 1_000
    || resolved > MAX_PERMIT_TTL_MS
  ) {
    throw new RangeError(
      'permitTtlMs must be an integer between 1000 and ' + MAX_PERMIT_TTL_MS,
    );
  }
  return resolved;
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new FuryAcpPermissionBridgeError('invalid-operation');
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !allowed.has(key)
    ) {
      throw new FuryAcpPermissionBridgeError('invalid-operation');
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryAcpPermissionBridgeError('invalid-operation');
    }
  }
  return record;
}

function normalizeOperation(
  value: FuryAcpPermissionOperation,
): FuryAcpPermissionOperation {
  const record = exactRecord(
    value,
    [
      'format',
      'operationId',
      'title',
      'toolKind',
      'riskClass',
      'requiredScopes',
      'requiredPluginPermissions',
    ],
    [
      'format',
      'operationId',
      'title',
      'toolKind',
      'riskClass',
      'requiredScopes',
      'requiredPluginPermissions',
    ],
  );
  if (
    record.format !== FURY_ACP_PERMISSION_OPERATION_FORMAT
    || typeof record.operationId !== 'string'
    || !OPERATION_ID_RE.test(record.operationId)
    || typeof record.title !== 'string'
    || record.title.trim().length === 0
    || record.title.includes('\0')
    || Buffer.byteLength(record.title, 'utf8') > MAX_TITLE_BYTES
    || typeof record.toolKind !== 'string'
    || !TOOL_KINDS.has(record.toolKind as acp.ToolKind)
    || typeof record.riskClass !== 'string'
    || !(FURY_GATEWAY_COMMAND_RISK_CLASSES as readonly string[])
      .includes(record.riskClass)
    || !Array.isArray(record.requiredScopes)
    || !Array.isArray(record.requiredPluginPermissions)
  ) {
    throw new FuryAcpPermissionBridgeError('invalid-operation');
  }

  const scopes = new Set<FuryGatewayScope>();
  for (const scope of record.requiredScopes) {
    if (!isFuryGatewayScope(scope)) {
      throw new FuryAcpPermissionBridgeError('invalid-operation');
    }
    scopes.add(scope);
  }
  const permissions = new Set<FuryPluginPermission>();
  for (const permission of record.requiredPluginPermissions) {
    if (
      typeof permission !== 'string'
      || !PLUGIN_PERMISSIONS.has(permission as FuryPluginPermission)
    ) {
      throw new FuryAcpPermissionBridgeError('invalid-operation');
    }
    const normalized = permission as FuryPluginPermission;
    permissions.add(normalized);
    scopes.add(FURY_GATEWAY_CAPABILITY_SCOPE_BY_PLUGIN_PERMISSION[normalized]);
  }
  if (scopes.size > 64 || permissions.size > PLUGIN_PERMISSIONS.size) {
    throw new FuryAcpPermissionBridgeError('invalid-operation');
  }

  return Object.freeze({
    format: FURY_ACP_PERMISSION_OPERATION_FORMAT,
    operationId: record.operationId,
    title: record.title,
    toolKind: record.toolKind as acp.ToolKind,
    riskClass: record.riskClass as FuryGatewayCommandRiskClass,
    requiredScopes: Object.freeze([...scopes].sort()),
    requiredPluginPermissions: Object.freeze([...permissions].sort()),
  });
}

function operationDigest(operation: FuryAcpPermissionOperation): string {
  return digest('operation', JSON.stringify(operation));
}

function decision(input: {
  readonly operation: FuryAcpPermissionOperation;
  readonly session: FuryGatewaySessionLease;
  readonly acpSessionId: string;
  readonly permissionRequestIdSha256?: string;
  readonly preGateway?: FuryGatewayCommandAdmissionDecision;
  readonly postGateway?: FuryGatewayCommandAdmissionDecision;
  readonly selectedOption?: 'allow_once' | 'reject_once' | 'cancelled';
  readonly outcome: 'eligible' | 'deny';
  readonly reason: FuryAcpPermissionDecisionReason;
}): FuryAcpPermissionDecision {
  const operationDigestSha256 = operationDigest(input.operation);
  const acpSessionIdSha256 = digest(
    'acp-session',
    input.acpSessionId,
  );
  const payload = {
    operationDigestSha256,
    acpSessionIdSha256,
    gatewaySessionIdSha256: digest(
      'gateway-session',
      input.session.sessionId,
    ),
    principalIdSha256: digest(
      'principal',
      input.session.principalId,
    ),
    permissionRequestIdSha256: input.permissionRequestIdSha256,
    preGatewayDecisionIdSha256: input.preGateway?.decisionIdSha256,
    postGatewayDecisionIdSha256: input.postGateway?.decisionIdSha256,
    selectedOption: input.selectedOption,
    outcome: input.outcome,
    reason: input.reason,
  };
  return Object.freeze({
    format: FURY_ACP_PERMISSION_DECISION_FORMAT,
    decisionIdSha256: sha256(JSON.stringify(payload)),
    operationDigestSha256,
    acpSessionIdSha256,
    gatewaySessionIdSha256: payload.gatewaySessionIdSha256,
    principalIdSha256: payload.principalIdSha256,
    ...(input.permissionRequestIdSha256 === undefined
      ? {}
      : { permissionRequestIdSha256: input.permissionRequestIdSha256 }),
    ...(input.preGateway === undefined
      ? {}
      : { preGatewayDecisionIdSha256: input.preGateway.decisionIdSha256 }),
    ...(input.postGateway === undefined
      ? {}
      : { postGatewayDecisionIdSha256: input.postGateway.decisionIdSha256 }),
    ...(input.selectedOption === undefined
      ? {}
      : { selectedOption: input.selectedOption }),
    outcome: input.outcome,
    reason: input.reason,
    executionAuthority: false as const,
  });
}

function gatewayDecision(
  operation: FuryAcpPermissionOperation,
  options: FuryAcpPermissionBridgeOptions,
): FuryGatewayCommandAdmissionDecision {
  const commandRegistry = createFuryGatewayCommandRegistry([{
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'acp.operation.execute',
    allowedRoles: ['operator'],
    requiredScopes: operation.requiredScopes,
    requiredPluginPermissions: operation.requiredPluginPermissions,
    riskClass: operation.riskClass,
    requiresFreshApproval: false,
  }]);
  return evaluateFuryGatewayCommandAdmission({
    sessionCoordinator: options.gatewaySessionCoordinator,
    session: options.gatewaySession,
    commandRegistry,
    commandName: 'acp.operation.execute',
    declaredPluginPermissions: operation.requiredPluginPermissions,
    ...(options.currentDevice === undefined
      ? {}
      : { currentDevice: options.currentDevice }),
    ...(options.pairing === undefined ? {} : { pairing: options.pairing }),
  });
}

export function isGeneratedFuryAcpPermissionBridge(
  value: unknown,
): value is FuryAcpPermissionBridge {
  return typeof value === 'object'
    && value !== null
    && GENERATED_COORDINATORS.has(value);
}

export function isGeneratedFuryAcpPermissionPermit(
  value: unknown,
): value is FuryAcpPermissionPermit {
  return typeof value === 'object'
    && value !== null
    && PERMITS.has(value);
}

export function createFuryAcpPermissionBridge(
  options: FuryAcpPermissionBridgeOptions,
): FuryAcpPermissionBridge {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryAcpGatewaySessionBridge(options.bridge)
    || !options.gatewaySessionCoordinator
    || typeof options.gatewaySessionCoordinator.inspectSession !== 'function'
    || !isGeneratedFuryGatewaySessionLease(options.gatewaySession)
  ) {
    throw new FuryAcpPermissionBridgeError('invalid-config');
  }
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryAcpPermissionBridgeError('invalid-config');
  }
  safeNow(now());
  const ttl = permitTtl(options.permitTtlMs);

  let api: FuryAcpPermissionBridge;

  const currentAdmission = (
    session: FuryAcpV1SessionSnapshot,
    operation: FuryAcpPermissionOperation,
  ): FuryGatewayCommandAdmissionDecision | undefined => {
    try {
      if (
        !options.bridge.matchesGatewayAuthority(
          session,
          options.gatewaySession,
        )
      ) {
        return undefined;
      }
      options.bridge.revalidatePrompt(session);
    } catch {
      return undefined;
    }
    return gatewayDecision(operation, options);
  };

  api = Object.freeze({
    async admit(
      session: FuryAcpV1SessionSnapshot,
      requester: FuryAcpV1PermissionRequester,
      operationInput: FuryAcpPermissionOperation,
    ): Promise<FuryAcpPermissionAdmissionResult> {
      if (!isGeneratedFuryAcpV1SessionSnapshot(session)) {
        throw new FuryAcpPermissionBridgeError('invalid-session');
      }
      if (!isGeneratedFuryAcpV1PermissionRequesterForSession(
        requester,
        session,
      )) {
        throw new FuryAcpPermissionBridgeError('invalid-requester');
      }
      const operation = normalizeOperation(operationInput);
      const preGateway = currentAdmission(session, operation);
      if (!preGateway || preGateway.outcome !== 'eligible') {
        const denied = decision({
          operation,
          session: options.gatewaySession,
          acpSessionId: session.sessionId,
          ...(preGateway === undefined ? {} : { preGateway }),
          outcome: 'deny',
          reason: 'gateway-admission-denied',
        });
        return Object.freeze({ decision: denied });
      }

      const requestNonce = randomBytes(18).toString('base64url');
      const allowId = `fap.allow.${requestNonce}`;
      const rejectId = `fap.reject.${requestNonce}`;
      const permissionRequestIdSha256 = digest(
        'permission-request',
        requestNonce,
      );
      const response = await requester.request({
        toolCallId: operation.operationId,
        title: operation.title,
        toolKind: operation.toolKind,
        options: Object.freeze([
          Object.freeze({
            optionId: allowId,
            name: 'Allow once',
            kind: 'allow_once' as const,
          }),
          Object.freeze({
            optionId: rejectId,
            name: 'Reject',
            kind: 'reject_once' as const,
          }),
        ]),
      });

      if (response.outcome === 'cancelled') {
        const denied = decision({
          operation,
          session: options.gatewaySession,
          acpSessionId: session.sessionId,
          permissionRequestIdSha256,
          preGateway,
          selectedOption: 'cancelled',
          outcome: 'deny',
          reason: 'client-cancelled',
        });
        return Object.freeze({ decision: denied });
      }
      if (response.optionId === rejectId) {
        const denied = decision({
          operation,
          session: options.gatewaySession,
          acpSessionId: session.sessionId,
          permissionRequestIdSha256,
          preGateway,
          selectedOption: 'reject_once',
          outcome: 'deny',
          reason: 'client-rejected',
        });
        return Object.freeze({ decision: denied });
      }
      if (response.optionId !== allowId) {
        throw new FuryAcpPermissionBridgeError('invalid-requester');
      }

      const postGateway = currentAdmission(session, operation);
      if (!postGateway || postGateway.outcome !== 'eligible') {
        const denied = decision({
          operation,
          session: options.gatewaySession,
          acpSessionId: session.sessionId,
          permissionRequestIdSha256,
          preGateway,
          ...(postGateway === undefined ? {} : { postGateway }),
          selectedOption: 'allow_once',
          outcome: 'deny',
          reason: 'gateway-admission-denied-after-permission',
        });
        return Object.freeze({ decision: denied });
      }

      const issuedAt = safeNow(now());
      const expiresAt = Math.min(
        issuedAt + ttl,
        options.gatewaySession.expiresAt,
      );
      if (expiresAt <= issuedAt) {
        const denied = decision({
          operation,
          session: options.gatewaySession,
          acpSessionId: session.sessionId,
          permissionRequestIdSha256,
          preGateway,
          postGateway,
          selectedOption: 'allow_once',
          outcome: 'deny',
          reason: 'permit-window-expired',
        });
        return Object.freeze({ decision: denied });
      }

      const eligible = decision({
        operation,
        session: options.gatewaySession,
        acpSessionId: session.sessionId,
        permissionRequestIdSha256,
        preGateway,
        postGateway,
        selectedOption: 'allow_once',
        outcome: 'eligible',
        reason: 'eligible',
      });
      const permit: FuryAcpPermissionPermit = Object.freeze({
        format: FURY_ACP_PERMISSION_PERMIT_FORMAT,
        permitIdSha256: digest(
          'permit',
          randomBytes(32).toString('base64url'),
        ),
        decisionIdSha256: eligible.decisionIdSha256,
        operationDigestSha256: eligible.operationDigestSha256,
        acpSessionIdSha256: digest('acp-session', session.sessionId),
        gatewaySessionIdSha256: digest(
          'gateway-session',
          options.gatewaySession.sessionId,
        ),
        principalIdSha256: digest(
          'principal',
          options.gatewaySession.principalId,
        ),
        requiredScopes: operation.requiredScopes,
        requiredPluginPermissions: operation.requiredPluginPermissions,
        riskClass: operation.riskClass,
        issuedAt,
        expiresAt,
        authority: 'acp-operation-permit',
        executionAuthority: true,
      });
      PERMITS.set(permit, {
        coordinator: api,
        operation,
        sessionId: session.sessionId,
        permit,
      });
      return Object.freeze({ decision: eligible, permit });
    },

    consume(
      permit: FuryAcpPermissionPermit,
      session: FuryAcpV1SessionSnapshot,
      observedAtInput?: number,
    ): FuryAcpPermissionConsumeReceipt {
      const state = PERMITS.get(permit);
      if (!state || state.coordinator !== api) {
        throw new FuryAcpPermissionBridgeError('invalid-permit');
      }
      if (CONSUMED_PERMITS.has(permit)) {
        throw new FuryAcpPermissionBridgeError('permit-consumed');
      }
      if (
        !isGeneratedFuryAcpV1SessionSnapshot(session)
        || state.sessionId !== session.sessionId
      ) {
        throw new FuryAcpPermissionBridgeError('permit-stale');
      }

      const observedAt = observedAtInput === undefined
        ? safeNow(now())
        : safeNow(observedAtInput);
      CONSUMED_PERMITS.add(permit);
      if (observedAt > permit.expiresAt) {
        throw new FuryAcpPermissionBridgeError('permit-expired');
      }
      const gateway = currentAdmission(session, state.operation);
      if (!gateway || gateway.outcome !== 'eligible') {
        throw new FuryAcpPermissionBridgeError('permit-stale');
      }
      if (
        permit.operationDigestSha256 !== operationDigest(state.operation)
        || permit.acpSessionIdSha256
          !== digest('acp-session', session.sessionId)
        || permit.gatewaySessionIdSha256
          !== digest('gateway-session', options.gatewaySession.sessionId)
        || permit.principalIdSha256
          !== digest('principal', options.gatewaySession.principalId)
      ) {
        throw new FuryAcpPermissionBridgeError('permit-stale');
      }

      return Object.freeze({
        format: FURY_ACP_PERMISSION_CONSUME_RECEIPT_FORMAT,
        permitIdSha256: permit.permitIdSha256,
        decisionIdSha256: permit.decisionIdSha256,
        operationDigestSha256: permit.operationDigestSha256,
        consumedAt: observedAt,
        requiredScopes: permit.requiredScopes,
        requiredPluginPermissions: permit.requiredPluginPermissions,
        riskClass: permit.riskClass,
        authority: 'admitted-operation-data-only' as const,
        executionAuthority: false as const,
      });
    },
  });

  GENERATED_COORDINATORS.add(api);
  return api;
}
