import { createHash, randomBytes } from 'node:crypto';

import {
  FURY_GATEWAY_COMMAND_FORMAT,
  FURY_GATEWAY_CAPABILITY_SCOPE_BY_PLUGIN_PERMISSION,
  createFuryGatewayCommandRegistry,
  evaluateFuryGatewayCommandAdmission,
  type FuryGatewayCommandAdmissionDecision,
} from './gateway-command-authorization-node.js';
import type {
  FuryGatewayAuthenticatedDevice,
} from './gateway-auth-node.js';
import type {
  FuryGatewayPairingCoordinator,
} from './gateway-pairing-node.js';
import {
  type FuryGatewayAutomationBudgets,
  type FuryGatewayAutomationDefinitionInspection,
  type FuryGatewayAutomationDefinitionStore,
  isGeneratedFuryGatewayAutomationDefinitionStore,
} from './gateway-automation-definition-node.js';
import {
  type FuryGatewayAutomationClaimEvidence,
  type FuryGatewayAutomationRunLedger,
  isGeneratedFuryGatewayAutomationClaimEvidence,
  isGeneratedFuryGatewayAutomationRunLedger,
} from './gateway-automation-run-ledger-node.js';
import {
  type FuryGatewayScope,
  type FuryGatewaySessionCoordinator,
  type FuryGatewaySessionLease,
  isGeneratedFuryGatewaySessionLease,
} from './gateway-session-node.js';
import type { FuryPluginPermission } from './plugin-bundles.js';

export const FURY_GATEWAY_AUTOMATION_RUN_ADMISSION_FORMAT =
  'furypipe-gateway-automation-run-admission/v1' as const;
export const FURY_GATEWAY_AUTOMATION_RUN_PERMIT_FORMAT =
  'furypipe-gateway-automation-run-permit/v1' as const;
export const FURY_GATEWAY_AUTOMATION_RUN_START_RECEIPT_FORMAT =
  'furypipe-gateway-automation-run-start-receipt/v1' as const;

export type FuryGatewayAutomationRunAdmissionReason =
  | 'eligible'
  | 'invalid-claim'
  | 'run-not-claimed'
  | 'trigger-not-found'
  | 'definition-not-found'
  | 'definition-stale'
  | 'definition-disabled'
  | 'principal-mismatch'
  | 'gateway-admission-denied'
  | 'permit-window-expired';

export interface FuryGatewayAutomationRunAdmissionDecision {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_RUN_ADMISSION_FORMAT;
  readonly admissionIdSha256: string;
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly generation: number;
  readonly claimIdSha256: string;
  readonly definitionSha256?: string;
  readonly workflowId?: string;
  readonly sessionIdSha256?: string;
  readonly principalIdSha256?: string;
  readonly gatewayDecisionIdSha256?: string;
  readonly gatewayReason?: FuryGatewayCommandAdmissionDecision['reason'];
  readonly outcome: 'eligible' | 'deny';
  readonly reason: FuryGatewayAutomationRunAdmissionReason;
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationRunPermit {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_RUN_PERMIT_FORMAT;
  readonly permitIdSha256: string;
  readonly admissionIdSha256: string;
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly executionIdentitySha256: string;
  readonly generation: number;
  readonly claimIdSha256: string;
  readonly definitionSha256: string;
  readonly workflowId: string;
  readonly sessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly requiredScopes: readonly FuryGatewayScope[];
  readonly requiredPluginPermissions: readonly FuryPluginPermission[];
  readonly budgets: FuryGatewayAutomationBudgets;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly authority: 'automation-run-start-permit';
  readonly executionAuthority: true;
}

export interface FuryGatewayAutomationRunAdmissionResult {
  readonly decision: FuryGatewayAutomationRunAdmissionDecision;
  readonly permit?: FuryGatewayAutomationRunPermit;
}

export interface FuryGatewayAutomationRunStartReceipt {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_RUN_START_RECEIPT_FORMAT;
  readonly permitIdSha256: string;
  readonly admissionIdSha256: string;
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly executionIdentitySha256: string;
  readonly workflowId: string;
  readonly definitionSha256: string;
  readonly startedAt: number;
  readonly budgets: FuryGatewayAutomationBudgets;
  readonly requiredScopes: readonly FuryGatewayScope[];
  readonly requiredPluginPermissions: readonly FuryPluginPermission[];
  readonly authority: 'admitted-run-data-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationRunAuthorityInput {
  readonly sessionCoordinator: FuryGatewaySessionCoordinator;
  readonly session: FuryGatewaySessionLease;
  readonly currentDevice?: FuryGatewayAuthenticatedDevice;
  readonly pairing?: FuryGatewayPairingCoordinator;
}

export interface FuryGatewayAutomationRunAdmissionCoordinatorOptions {
  readonly definitions: FuryGatewayAutomationDefinitionStore;
  readonly runs: FuryGatewayAutomationRunLedger;
  readonly now?: () => number;
  readonly permitTtlMs?: number;
}

export interface FuryGatewayAutomationRunAdmissionCoordinator {
  admit(
    claim: FuryGatewayAutomationClaimEvidence,
    authority: FuryGatewayAutomationRunAuthorityInput,
  ): Promise<FuryGatewayAutomationRunAdmissionResult>;
  consume(
    permit: FuryGatewayAutomationRunPermit,
    observedAt?: number,
  ): Promise<FuryGatewayAutomationRunStartReceipt>;
}

export type FuryGatewayAutomationRunAdmissionErrorCode =
  | 'invalid-options'
  | 'invalid-authority'
  | 'invalid-permit'
  | 'permit-consumed'
  | 'permit-expired'
  | 'permit-stale';

const ERROR_MESSAGES: Readonly<Record<
  FuryGatewayAutomationRunAdmissionErrorCode,
  string
>> = Object.freeze({
  'invalid-options': 'Automation run admission options are invalid.',
  'invalid-authority': 'Automation run authority input is invalid.',
  'invalid-permit': 'Automation run permit is not current process-local evidence.',
  'permit-consumed': 'Automation run permit was already consumed.',
  'permit-expired': 'Automation run permit expired.',
  'permit-stale': 'Automation run permit no longer matches current authority.',
});

export class FuryGatewayAutomationRunAdmissionError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: FuryGatewayAutomationRunAdmissionErrorCode,
    readonly runIdSha256?: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryGatewayAutomationRunAdmissionError';
  }
}

interface ClaimIdentity {
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly generation: number;
  readonly claimIdSha256: string;
}

interface PermitState {
  readonly coordinator: FuryGatewayAutomationRunAdmissionCoordinator;
  readonly claim: FuryGatewayAutomationClaimEvidence;
  readonly definition: FuryGatewayAutomationDefinitionInspection;
  readonly authority: FuryGatewayAutomationRunAuthorityInput;
  readonly permit: FuryGatewayAutomationRunPermit;
}

const GENERATED_COORDINATORS = new WeakSet<object>();
const PERMITS = new WeakMap<object, PermitState>();
const CONSUMED_PERMITS = new WeakSet<object>();
const DEFAULT_PERMIT_TTL_MS = 30_000;
const MAX_PERMIT_TTL_MS = 5 * 60_000;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeNow(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FuryGatewayAutomationRunAdmissionError('invalid-options');
  }
  return value as number;
}

function boundedPermitTtl(value: number | undefined): number {
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

function exactAuthorityInput(
  input: FuryGatewayAutomationRunAuthorityInput,
): FuryGatewayAutomationRunAuthorityInput {
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype
    || Object.getOwnPropertySymbols(input).length > 0
  ) {
    throw new FuryGatewayAutomationRunAdmissionError('invalid-authority');
  }
  const allowed = new Set([
    'sessionCoordinator',
    'session',
    'currentDevice',
    'pairing',
  ]);
  for (const key of Object.getOwnPropertyNames(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !allowed.has(key)
    ) {
      throw new FuryGatewayAutomationRunAdmissionError('invalid-authority');
    }
  }
  if (
    !Object.prototype.hasOwnProperty.call(input, 'sessionCoordinator')
    || !Object.prototype.hasOwnProperty.call(input, 'session')
    || !input.sessionCoordinator
    || typeof input.sessionCoordinator.inspectSession !== 'function'
    || !isGeneratedFuryGatewaySessionLease(input.session)
  ) {
    throw new FuryGatewayAutomationRunAdmissionError('invalid-authority');
  }
  return input;
}

function normalizedRequiredScopes(
  definition: FuryGatewayAutomationDefinitionInspection,
): readonly FuryGatewayScope[] {
  const scopes = new Set<FuryGatewayScope>([
    'automations.manage',
    ...definition.definition.requestedScopes,
  ]);
  for (const permission of definition.definition.requestedPluginPermissions) {
    scopes.add(
      FURY_GATEWAY_CAPABILITY_SCOPE_BY_PLUGIN_PERMISSION[permission],
    );
  }
  return Object.freeze([...scopes].sort());
}

function createCommandAdmission(
  definition: FuryGatewayAutomationDefinitionInspection,
  authority: FuryGatewayAutomationRunAuthorityInput,
): FuryGatewayCommandAdmissionDecision {
  const requiredScopes = normalizedRequiredScopes(definition);
  const commandRegistry = createFuryGatewayCommandRegistry([{
    format: FURY_GATEWAY_COMMAND_FORMAT,
    name: 'automations.run',
    allowedRoles: ['operator'],
    requiredScopes,
    requiredPluginPermissions:
      definition.definition.requestedPluginPermissions,
    riskClass: 'process',
    requiresFreshApproval: false,
  }]);

  return evaluateFuryGatewayCommandAdmission({
    sessionCoordinator: authority.sessionCoordinator,
    session: authority.session,
    commandRegistry,
    commandName: 'automations.run',
    declaredPluginPermissions:
      definition.definition.requestedPluginPermissions,
    ...(authority.currentDevice === undefined
      ? {}
      : { currentDevice: authority.currentDevice }),
    ...(authority.pairing === undefined
      ? {}
      : { pairing: authority.pairing }),
  });
}

function admissionDecision(input: {
  readonly claim: ClaimIdentity;
  readonly definition?: FuryGatewayAutomationDefinitionInspection;
  readonly authority?: FuryGatewayAutomationRunAuthorityInput;
  readonly gateway?: FuryGatewayCommandAdmissionDecision;
  readonly outcome: 'eligible' | 'deny';
  readonly reason: FuryGatewayAutomationRunAdmissionReason;
}): FuryGatewayAutomationRunAdmissionDecision {
  const sessionIdSha256 = input.authority
    ? sha256(input.authority.session.sessionId)
    : undefined;
  const principalIdSha256 = input.authority
    ? sha256(input.authority.session.principalId)
    : undefined;
  const payload = {
    runIdSha256: input.claim.runIdSha256,
    triggerIdSha256: input.claim.triggerIdSha256,
    generation: input.claim.generation,
    claimIdSha256: input.claim.claimIdSha256,
    definitionSha256: input.definition?.definitionSha256,
    workflowId: input.definition?.definition.workflowId,
    sessionIdSha256,
    principalIdSha256,
    gatewayDecisionIdSha256: input.gateway?.decisionIdSha256,
    gatewayReason: input.gateway?.reason,
    outcome: input.outcome,
    reason: input.reason,
    executionAuthority: false,
  };
  return Object.freeze({
    format: FURY_GATEWAY_AUTOMATION_RUN_ADMISSION_FORMAT,
    admissionIdSha256: sha256(JSON.stringify(payload)),
    runIdSha256: input.claim.runIdSha256,
    triggerIdSha256: input.claim.triggerIdSha256,
    generation: input.claim.generation,
    claimIdSha256: input.claim.claimIdSha256,
    ...(input.definition === undefined
      ? {}
      : {
          definitionSha256: input.definition.definitionSha256,
          workflowId: input.definition.definition.workflowId,
        }),
    ...(sessionIdSha256 === undefined ? {} : { sessionIdSha256 }),
    ...(principalIdSha256 === undefined ? {} : { principalIdSha256 }),
    ...(input.gateway === undefined
      ? {}
      : {
          gatewayDecisionIdSha256: input.gateway.decisionIdSha256,
          gatewayReason: input.gateway.reason,
        }),
    outcome: input.outcome,
    reason: input.reason,
    executionAuthority: false as const,
  });
}

function deny(
  claim: ClaimIdentity,
  reason: Exclude<FuryGatewayAutomationRunAdmissionReason, 'eligible'>,
  extras: {
    readonly definition?: FuryGatewayAutomationDefinitionInspection;
    readonly authority?: FuryGatewayAutomationRunAuthorityInput;
    readonly gateway?: FuryGatewayCommandAdmissionDecision;
  } = {},
): FuryGatewayAutomationRunAdmissionResult {
  return Object.freeze({
    decision: admissionDecision({
      claim,
      ...extras,
      outcome: 'deny',
      reason,
    }),
  });
}

export function isGeneratedFuryGatewayAutomationRunAdmissionCoordinator(
  value: unknown,
): value is FuryGatewayAutomationRunAdmissionCoordinator {
  return typeof value === 'object'
    && value !== null
    && GENERATED_COORDINATORS.has(value);
}

export function isGeneratedFuryGatewayAutomationRunPermit(
  value: unknown,
): value is FuryGatewayAutomationRunPermit {
  return typeof value === 'object'
    && value !== null
    && PERMITS.has(value);
}

export function createFuryGatewayAutomationRunAdmissionCoordinator(
  options: FuryGatewayAutomationRunAdmissionCoordinatorOptions,
): FuryGatewayAutomationRunAdmissionCoordinator {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayAutomationDefinitionStore(options.definitions)
    || !isGeneratedFuryGatewayAutomationRunLedger(options.runs)
  ) {
    throw new FuryGatewayAutomationRunAdmissionError('invalid-options');
  }
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayAutomationRunAdmissionError('invalid-options');
  }
  safeNow(now());
  const permitTtlMs = boundedPermitTtl(options.permitTtlMs);

  let api: FuryGatewayAutomationRunAdmissionCoordinator;

  const currentEligibility = async (
    state: PermitState,
    observedAt: number,
  ): Promise<boolean> => {
    const status = await options.runs.inspect(
      state.claim.runIdSha256,
      observedAt,
    );
    if (
      status?.state !== 'claimed'
      || status.generation !== state.claim.generation
      || status.claimIdSha256 !== state.claim.claimIdSha256
    ) {
      return false;
    }
    const latest = await options.definitions.inspect(
      state.definition.definition.automationId,
    );
    if (
      !latest
      || !latest.definition.enabled
      || latest.definitionSha256 !== state.definition.definitionSha256
      || latest.definition.revision !== state.definition.definition.revision
      || latest.definition.ownerPrincipalId !== state.authority.session.principalId
    ) {
      return false;
    }
    const gateway = createCommandAdmission(latest, state.authority);
    return gateway.outcome === 'eligible';
  };

  api = Object.freeze({
    async admit(
      claim: FuryGatewayAutomationClaimEvidence,
      authorityInput: FuryGatewayAutomationRunAuthorityInput,
    ): Promise<FuryGatewayAutomationRunAdmissionResult> {
      if (!isGeneratedFuryGatewayAutomationClaimEvidence(claim)) {
        const candidate = claim as unknown as Partial<ClaimIdentity> | undefined;
        const placeholder: ClaimIdentity = Object.freeze({
          runIdSha256:
            typeof candidate?.runIdSha256 === 'string'
              ? candidate.runIdSha256
              : sha256('invalid-run'),
          triggerIdSha256:
            typeof candidate?.triggerIdSha256 === 'string'
              ? candidate.triggerIdSha256
              : sha256('invalid-trigger'),
          generation:
            Number.isSafeInteger(candidate?.generation)
              ? candidate!.generation!
              : 0,
          claimIdSha256:
            typeof candidate?.claimIdSha256 === 'string'
              ? candidate.claimIdSha256
              : sha256('invalid-claim'),
        });
        return deny(placeholder, 'invalid-claim');
      }
      const authority = exactAuthorityInput(authorityInput);
      const observedAt = safeNow(now());
      const status = await options.runs.inspect(claim.runIdSha256, observedAt);
      if (
        status?.state !== 'claimed'
        || status.generation !== claim.generation
        || status.claimIdSha256 !== claim.claimIdSha256
      ) {
        return deny(claim, 'run-not-claimed', { authority });
      }

      const trigger = await options.runs.inspectTrigger(claim.runIdSha256);
      if (!trigger || trigger.triggerIdSha256 !== claim.triggerIdSha256) {
        return deny(claim, 'trigger-not-found', { authority });
      }
      const definition = await options.definitions.inspect(
        trigger.automationId,
      );
      if (!definition) {
        return deny(claim, 'definition-not-found', { authority });
      }
      if (
        definition.definitionSha256 !== trigger.definitionSha256
        || definition.definition.revision !== trigger.definitionRevision
      ) {
        return deny(claim, 'definition-stale', { definition, authority });
      }
      if (!definition.definition.enabled) {
        return deny(claim, 'definition-disabled', {
          definition,
          authority,
        });
      }
      if (authority.session.principalId !== definition.definition.ownerPrincipalId) {
        return deny(claim, 'principal-mismatch', {
          definition,
          authority,
        });
      }

      const gateway = createCommandAdmission(definition, authority);
      if (gateway.outcome !== 'eligible') {
        return deny(claim, 'gateway-admission-denied', {
          definition,
          authority,
          gateway,
        });
      }

      const expiresAt = Math.min(
        observedAt + permitTtlMs,
        claim.leaseExpiresAt,
        authority.session.expiresAt,
      );
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= observedAt) {
        return deny(claim, 'permit-window-expired', {
          definition,
          authority,
          gateway,
        });
      }

      const decision = admissionDecision({
        claim,
        definition,
        authority,
        gateway,
        outcome: 'eligible',
        reason: 'eligible',
      });
      const permit = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_RUN_PERMIT_FORMAT,
        permitIdSha256: sha256(randomBytes(32).toString('hex')),
        admissionIdSha256: decision.admissionIdSha256,
        runIdSha256: claim.runIdSha256,
        triggerIdSha256: claim.triggerIdSha256,
        executionIdentitySha256: claim.executionIdentitySha256,
        generation: claim.generation,
        claimIdSha256: claim.claimIdSha256,
        definitionSha256: definition.definitionSha256,
        workflowId: definition.definition.workflowId,
        sessionIdSha256: sha256(authority.session.sessionId),
        principalIdSha256: sha256(authority.session.principalId),
        requiredScopes: normalizedRequiredScopes(definition),
        requiredPluginPermissions:
          definition.definition.requestedPluginPermissions,
        budgets: definition.definition.budgets,
        issuedAt: observedAt,
        expiresAt,
        authority: 'automation-run-start-permit' as const,
        executionAuthority: true as const,
      });
      PERMITS.set(permit, Object.freeze({
        coordinator: api,
        claim,
        definition,
        authority,
        permit,
      }));
      return Object.freeze({ decision, permit });
    },

    async consume(
      permit: FuryGatewayAutomationRunPermit,
      observedAtInput?: number,
    ): Promise<FuryGatewayAutomationRunStartReceipt> {
      const state = PERMITS.get(permit as object);
      if (!state || state.coordinator !== api) {
        throw new FuryGatewayAutomationRunAdmissionError(
          'invalid-permit',
          permit?.runIdSha256,
        );
      }
      if (CONSUMED_PERMITS.has(permit as object)) {
        throw new FuryGatewayAutomationRunAdmissionError(
          'permit-consumed',
          permit.runIdSha256,
        );
      }
      const observedAt = observedAtInput === undefined
        ? safeNow(now())
        : safeNow(observedAtInput);
      if (observedAt >= permit.expiresAt) {
        throw new FuryGatewayAutomationRunAdmissionError(
          'permit-expired',
          permit.runIdSha256,
        );
      }
      if (!(await currentEligibility(state, observedAt))) {
        throw new FuryGatewayAutomationRunAdmissionError(
          'permit-stale',
          permit.runIdSha256,
        );
      }

      CONSUMED_PERMITS.add(permit as object);
      return Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_RUN_START_RECEIPT_FORMAT,
        permitIdSha256: permit.permitIdSha256,
        admissionIdSha256: permit.admissionIdSha256,
        runIdSha256: permit.runIdSha256,
        triggerIdSha256: permit.triggerIdSha256,
        executionIdentitySha256: permit.executionIdentitySha256,
        workflowId: permit.workflowId,
        definitionSha256: permit.definitionSha256,
        startedAt: observedAt,
        budgets: permit.budgets,
        requiredScopes: permit.requiredScopes,
        requiredPluginPermissions: permit.requiredPluginPermissions,
        authority: 'admitted-run-data-only' as const,
        executionAuthority: false as const,
      });
    },
  });

  GENERATED_COORDINATORS.add(api);
  return api;
}
