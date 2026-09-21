import { createHash, randomUUID } from 'node:crypto';

import * as acp from '@agentclientprotocol/sdk';

import {
  getFuryAcpExternalSessionInternal,
} from './acp-external-session-internal-node.js';
import {
  isGeneratedFuryAcpExternalSession,
  type FuryAcpExternalSession,
} from './acp-external-client-runtime-node.js';

export const FURY_ACP_DELEGATION_REQUEST_FORMAT =
  'furypipe-acp-delegation-request/v1' as const;
export const FURY_ACP_DELEGATION_POLICY_FORMAT =
  'furypipe-acp-delegation-policy/v1' as const;
export const FURY_ACP_DELEGATION_PERMIT_FORMAT =
  'furypipe-acp-delegation-permit/v1' as const;
export const FURY_ACP_DELEGATION_RECEIPT_FORMAT =
  'furypipe-acp-delegation-receipt/v1' as const;

export type FuryAcpDelegationCapability =
  | 'prompt:text'
  | 'observe:agent-text'
  | 'observe:tool-calls';

export interface FuryAcpDelegationBudget {
  readonly maxWallTimeMs: number;
  readonly maxMessages: number;
  readonly maxToolCalls: number;
  readonly maxBytesIn: number;
  readonly maxBytesOut: number;
}

export interface FuryAcpDelegationRequest {
  readonly format: typeof FURY_ACP_DELEGATION_REQUEST_FORMAT;
  readonly requestId: string;
  readonly principalIdSha256: string;
  readonly agentId: string;
  readonly agentIdentitySha256: string;
  readonly sessionHandleIdSha256: string;
  readonly protocolVersion: 1;
  readonly taskSha256: string;
  readonly workspaceRootSha256: string;
  readonly capabilities: readonly FuryAcpDelegationCapability[];
  readonly capabilitiesSha256: string;
  readonly budget: FuryAcpDelegationBudget;
  readonly budgetSha256: string;
  readonly requestSha256: string;
  readonly executionAuthority: false;
  readonly delegationAuthority: false;
}

export interface FuryAcpDelegationPolicy {
  readonly format: typeof FURY_ACP_DELEGATION_POLICY_FORMAT;
  readonly policyId: string;
  readonly allowDelegation: boolean;
  readonly principalId: string;
  readonly agentId: string;
  readonly allowedCapabilities: readonly FuryAcpDelegationCapability[];
  readonly maxBudget: FuryAcpDelegationBudget;
  readonly expiresInMs: number;
}

export interface FuryAcpDelegationPermit {
  readonly format: typeof FURY_ACP_DELEGATION_PERMIT_FORMAT;
  readonly permitId: string;
  readonly policyId: string;
  readonly requestSha256: string;
  readonly principalIdSha256: string;
  readonly agentId: string;
  readonly agentIdentitySha256: string;
  readonly sessionHandleIdSha256: string;
  readonly taskSha256: string;
  readonly workspaceRootSha256: string;
  readonly capabilitiesSha256: string;
  readonly budgetSha256: string;
  readonly protocolVersion: 1;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly delegationAuthority: 'one-shot';
}

export type FuryAcpDelegationOutcome =
  | 'completed'
  | 'failed'
  | 'unknown';

export type FuryAcpDelegationVerificationStatus =
  | 'verified'
  | 'rejected'
  | 'unknown'
  | 'not-run';

export interface FuryAcpDelegationReceipt {
  readonly format: typeof FURY_ACP_DELEGATION_RECEIPT_FORMAT;
  readonly receiptId: string;
  readonly permitIdSha256: string;
  readonly requestSha256: string;
  readonly agentIdentitySha256: string;
  readonly workspaceRootSha256: string;
  readonly taskSha256: string;
  readonly capabilitiesSha256: string;
  readonly budgetSha256: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: FuryAcpDelegationOutcome;
  readonly stopReason?: acp.StopReason;
  readonly updateCount: number;
  readonly toolCallCount: number;
  readonly outputBytes: number;
  readonly outputSha256: string;
  readonly verificationStatus: FuryAcpDelegationVerificationStatus;
  readonly accepted: boolean;
  readonly automaticReplayAllowed: false;
  readonly executionAuthority: false;
  readonly delegationAuthority: false;
  readonly errorCode?:
    | 'session-not-ready'
    | 'wall-time-limit'
    | 'message-limit'
    | 'tool-limit'
    | 'capability-violation'
    | 'output-limit'
    | 'cancelled'
    | 'transport-unknown'
    | 'verification-failed';
}

export interface FuryAcpDelegationResult {
  readonly receipt: FuryAcpDelegationReceipt;
  readonly outputText: string;
}

export interface FuryAcpDelegationVerificationInput {
  readonly requestSha256: string;
  readonly agentId: string;
  readonly agentIdentitySha256: string;
  readonly workspaceRootSha256: string;
  readonly taskSha256: string;
  readonly capabilitiesSha256: string;
  readonly budgetSha256: string;
  readonly stopReason: acp.StopReason;
  readonly updateCount: number;
  readonly toolCallCount: number;
  readonly outputText: string;
}

export class FuryAcpDelegationError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code:
      | 'invalid-input'
      | 'invalid-session'
      | 'session-not-ready'
      | 'invalid-request'
      | 'invalid-policy'
      | 'not-authorized'
      | 'permit-invalid'
      | 'permit-mismatch'
      | 'permit-expired'
      | 'permit-consumed'
      | 'session-busy',
    message: string,
  ) {
    super(message);
    this.name = 'FuryAcpDelegationError';
  }
}

interface DelegationRequestState {
  readonly session: FuryAcpExternalSession;
  readonly principalId: string;
  readonly task: string;
  readonly capabilities: readonly FuryAcpDelegationCapability[];
  readonly budget: FuryAcpDelegationBudget;
}

interface DelegationPermitState {
  readonly request: FuryAcpDelegationRequest;
  consumed: boolean;
}

const REQUEST_STATE = new WeakMap<object, DelegationRequestState>();
const PERMIT_STATE = new WeakMap<object, DelegationPermitState>();
const ACTIVE_SESSIONS = new WeakSet<object>();

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_TASK_BYTES = 1024 * 1024;
const MAX_WALL_TIME_MS = 300_000;
const MAX_MESSAGES = 1_024;
const MAX_TOOL_CALLS = 256;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_PERMIT_TTL_MS = 60_000;
const CAPABILITY_ORDER: readonly FuryAcpDelegationCapability[] = Object.freeze([
  'prompt:text',
  'observe:agent-text',
  'observe:tool-calls',
]);

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function safeNow(source: () => number): number {
  const value = Math.floor(source());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      'delegation clock must return a safe non-negative timestamp',
    );
  }
  return value;
}

function dataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      label + ' must be a plain data object',
    );
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
      throw new FuryAcpDelegationError(
        'invalid-input',
        label + ' contains unsupported fields',
      );
    }
  }
  return record;
}

function exactIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !SAFE_ID.test(value)
    || value.includes('\0')
  ) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      label + ' is invalid',
    );
  }
  return value;
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < min
    || value > max
  ) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      label + ' is outside its bound',
    );
  }
  return value;
}

function normalizeCapabilities(
  value: unknown,
  label: string,
): readonly FuryAcpDelegationCapability[] {
  if (
    !Array.isArray(value)
    || value.length < 2
    || value.length > CAPABILITY_ORDER.length
    || value.some((_, index) => !Object.prototype.hasOwnProperty.call(value, index))
  ) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      label + ' is invalid',
    );
  }
  const set = new Set<FuryAcpDelegationCapability>();
  for (const item of value) {
    if (!CAPABILITY_ORDER.includes(item as FuryAcpDelegationCapability)) {
      throw new FuryAcpDelegationError(
        'invalid-input',
        label + ' contains an unsupported capability',
      );
    }
    set.add(item as FuryAcpDelegationCapability);
  }
  if (set.size !== value.length) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      label + ' contains duplicate capabilities',
    );
  }
  if (!set.has('prompt:text') || !set.has('observe:agent-text')) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      label + ' must include prompt:text and observe:agent-text',
    );
  }
  return Object.freeze(
    CAPABILITY_ORDER.filter((capability) => set.has(capability)),
  );
}

function normalizeBudget(
  value: unknown,
  label: string,
): FuryAcpDelegationBudget {
  const record = dataRecord(
    value,
    ['maxWallTimeMs', 'maxMessages', 'maxToolCalls', 'maxBytesIn', 'maxBytesOut'],
    label,
  );
  return Object.freeze({
    maxWallTimeMs: boundedInteger(
      record.maxWallTimeMs,
      1,
      MAX_WALL_TIME_MS,
      label + '.maxWallTimeMs',
    ),
    maxMessages: boundedInteger(
      record.maxMessages,
      1,
      MAX_MESSAGES,
      label + '.maxMessages',
    ),
    maxToolCalls: boundedInteger(
      record.maxToolCalls,
      0,
      MAX_TOOL_CALLS,
      label + '.maxToolCalls',
    ),
    maxBytesIn: boundedInteger(
      record.maxBytesIn,
      1,
      MAX_BYTES,
      label + '.maxBytesIn',
    ),
    maxBytesOut: boundedInteger(
      record.maxBytesOut,
      1,
      MAX_BYTES,
      label + '.maxBytesOut',
    ),
  });
}

function budgetWithin(
  actual: FuryAcpDelegationBudget,
  maximum: FuryAcpDelegationBudget,
): boolean {
  return actual.maxWallTimeMs <= maximum.maxWallTimeMs
    && actual.maxMessages <= maximum.maxMessages
    && actual.maxToolCalls <= maximum.maxToolCalls
    && actual.maxBytesIn <= maximum.maxBytesIn
    && actual.maxBytesOut <= maximum.maxBytesOut;
}

function digestCapabilities(
  capabilities: readonly FuryAcpDelegationCapability[],
): string {
  return sha256(JSON.stringify(capabilities));
}

function digestBudget(budget: FuryAcpDelegationBudget): string {
  return sha256(JSON.stringify(budget));
}

export function isGeneratedFuryAcpDelegationRequest(
  value: unknown,
): value is FuryAcpDelegationRequest {
  return !!value && typeof value === 'object' && REQUEST_STATE.has(value);
}

export function isGeneratedFuryAcpDelegationPermit(
  value: unknown,
): value is FuryAcpDelegationPermit {
  return !!value && typeof value === 'object' && PERMIT_STATE.has(value);
}

export function prepareFuryAcpDelegationRequest(input: {
  readonly session: FuryAcpExternalSession;
  readonly principalId: string;
  readonly task: string;
  readonly capabilities: readonly FuryAcpDelegationCapability[];
  readonly budget: FuryAcpDelegationBudget;
}): FuryAcpDelegationRequest {
  const record = dataRecord(
    input,
    ['session', 'principalId', 'task', 'capabilities', 'budget'],
    'delegation request input',
  );
  const session = record.session as FuryAcpExternalSession;
  if (!isGeneratedFuryAcpExternalSession(session)) {
    throw new FuryAcpDelegationError(
      'invalid-session',
      'delegation requires a process-local external ACP session',
    );
  }
  const internal = getFuryAcpExternalSessionInternal(session);
  if (!internal) {
    throw new FuryAcpDelegationError(
      'invalid-session',
      'delegation session has no process-local internal binding',
    );
  }
  if (internal.lifecycle() !== 'ready') {
    throw new FuryAcpDelegationError(
      'session-not-ready',
      'delegation session is not ready',
    );
  }
  const principalId = exactIdentifier(record.principalId, 'delegation principal');
  if (
    typeof record.task !== 'string'
    || record.task.trim().length === 0
    || record.task.includes('\0')
    || byteLength(record.task) > MAX_TASK_BYTES
  ) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      'delegation task is invalid or exceeds its bound',
    );
  }
  const task = record.task;
  const capabilities = normalizeCapabilities(
    record.capabilities,
    'delegation capabilities',
  );
  const budget = normalizeBudget(record.budget, 'delegation budget');
  if (byteLength(task) > budget.maxBytesIn) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      'delegation task exceeds the input-byte budget',
    );
  }
  if (
    !capabilities.includes('observe:tool-calls')
    && budget.maxToolCalls !== 0
  ) {
    throw new FuryAcpDelegationError(
      'invalid-input',
      'tool-call budget requires observe:tool-calls capability',
    );
  }

  const principalIdSha256 = sha256('principal:' + principalId);
  const taskSha256 = sha256(task);
  const sessionHandleIdSha256 = sha256(
    'session-handle:' + session.sessionHandleId,
  );
  const capabilitiesSha256 = digestCapabilities(capabilities);
  const budgetSha256 = digestBudget(budget);
  const digestInput = {
    principalIdSha256,
    agentId: internal.agentId,
    agentIdentitySha256: internal.agentIdentitySha256,
    sessionHandleIdSha256,
    protocolVersion: internal.protocolVersion,
    taskSha256,
    workspaceRootSha256: internal.workspaceRootSha256,
    capabilitiesSha256,
    budgetSha256,
  };
  const request = Object.freeze({
    format: FURY_ACP_DELEGATION_REQUEST_FORMAT,
    requestId: 'fadr_' + randomUUID(),
    principalIdSha256,
    agentId: internal.agentId,
    agentIdentitySha256: internal.agentIdentitySha256,
    sessionHandleIdSha256,
    protocolVersion: internal.protocolVersion,
    taskSha256,
    workspaceRootSha256: internal.workspaceRootSha256,
    capabilities,
    capabilitiesSha256,
    budget,
    budgetSha256,
    requestSha256: sha256(JSON.stringify(digestInput)),
    executionAuthority: false as const,
    delegationAuthority: false as const,
  });
  REQUEST_STATE.set(request, {
    session,
    principalId,
    task,
    capabilities,
    budget,
  });
  return request;
}

export function createFuryAcpDelegationGate(options: {
  readonly now?: () => number;
} = {}) {
  const nowSource = options.now ?? Date.now;
  return Object.freeze({
    authorize(
      request: FuryAcpDelegationRequest,
      policy: FuryAcpDelegationPolicy,
    ): FuryAcpDelegationPermit {
      if (!isGeneratedFuryAcpDelegationRequest(request)) {
        throw new FuryAcpDelegationError(
          'invalid-request',
          'delegation request is not process-local evidence',
        );
      }
      const state = REQUEST_STATE.get(request)!;
      const internal = getFuryAcpExternalSessionInternal(state.session);
      if (!internal || internal.lifecycle() !== 'ready') {
        throw new FuryAcpDelegationError(
          'session-not-ready',
          'delegation session is not currently ready',
        );
      }
      if (
        internal.agentId !== request.agentId
        || internal.agentIdentitySha256 !== request.agentIdentitySha256
        || internal.workspaceRootSha256 !== request.workspaceRootSha256
        || internal.protocolVersion !== request.protocolVersion
      ) {
        throw new FuryAcpDelegationError(
          'invalid-request',
          'delegation request no longer matches the live session',
        );
      }

      let authority: Readonly<Record<string, unknown>>;
      try {
        authority = dataRecord(
          policy,
          [
            'format',
            'policyId',
            'allowDelegation',
            'principalId',
            'agentId',
            'allowedCapabilities',
            'maxBudget',
            'expiresInMs',
          ],
          'delegation policy',
        );
      } catch {
        throw new FuryAcpDelegationError(
          'invalid-policy',
          'delegation policy is invalid',
        );
      }
      let policyId: string;
      let principalId: string;
      let agentId: string;
      let allowedCapabilities: readonly FuryAcpDelegationCapability[];
      let maxBudget: FuryAcpDelegationBudget;
      let expiresInMs: number;
      try {
        if (
          authority.format !== FURY_ACP_DELEGATION_POLICY_FORMAT
          || authority.allowDelegation !== true
        ) {
          throw new Error('policy does not allow delegation');
        }
        policyId = exactIdentifier(authority.policyId, 'delegation policy ID');
        principalId = exactIdentifier(
          authority.principalId,
          'delegation policy principal',
        );
        agentId = exactIdentifier(authority.agentId, 'delegation policy agent');
        allowedCapabilities = normalizeCapabilities(
          authority.allowedCapabilities,
          'delegation policy capabilities',
        );
        maxBudget = normalizeBudget(
          authority.maxBudget,
          'delegation policy max budget',
        );
        expiresInMs = boundedInteger(
          authority.expiresInMs,
          1,
          MAX_PERMIT_TTL_MS,
          'delegation policy expiry',
        );
      } catch {
        throw new FuryAcpDelegationError(
          'invalid-policy',
          'delegation policy is invalid',
        );
      }
      const allowed = new Set(allowedCapabilities);
      if (
        principalId !== state.principalId
        || agentId !== request.agentId
        || request.capabilities.some((capability) => !allowed.has(capability))
        || !budgetWithin(request.budget, maxBudget)
      ) {
        throw new FuryAcpDelegationError(
          'not-authorized',
          'delegation request is outside the current policy',
        );
      }

      const issuedAt = safeNow(nowSource);
      const expiresAt = issuedAt + expiresInMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new FuryAcpDelegationError(
          'invalid-policy',
          'delegation permit expiry is invalid',
        );
      }
      const permit = Object.freeze({
        format: FURY_ACP_DELEGATION_PERMIT_FORMAT,
        permitId: 'fadp_' + randomUUID(),
        policyId,
        requestSha256: request.requestSha256,
        principalIdSha256: request.principalIdSha256,
        agentId: request.agentId,
        agentIdentitySha256: request.agentIdentitySha256,
        sessionHandleIdSha256: request.sessionHandleIdSha256,
        taskSha256: request.taskSha256,
        workspaceRootSha256: request.workspaceRootSha256,
        capabilitiesSha256: request.capabilitiesSha256,
        budgetSha256: request.budgetSha256,
        protocolVersion: request.protocolVersion,
        issuedAt,
        expiresAt,
        delegationAuthority: 'one-shot' as const,
      });
      PERMIT_STATE.set(permit, { request, consumed: false });
      return permit;
    },
  });
}

function consumePermit(
  request: FuryAcpDelegationRequest,
  permit: FuryAcpDelegationPermit,
  now: number,
): void {
  if (!isGeneratedFuryAcpDelegationPermit(permit)) {
    throw new FuryAcpDelegationError(
      'permit-invalid',
      'delegation permit is not process-local evidence',
    );
  }
  const state = PERMIT_STATE.get(permit)!;
  if (
    state.request !== request
    || permit.requestSha256 !== request.requestSha256
    || permit.principalIdSha256 !== request.principalIdSha256
    || permit.agentId !== request.agentId
    || permit.agentIdentitySha256 !== request.agentIdentitySha256
    || permit.sessionHandleIdSha256 !== request.sessionHandleIdSha256
    || permit.taskSha256 !== request.taskSha256
    || permit.workspaceRootSha256 !== request.workspaceRootSha256
    || permit.capabilitiesSha256 !== request.capabilitiesSha256
    || permit.budgetSha256 !== request.budgetSha256
    || permit.protocolVersion !== request.protocolVersion
  ) {
    throw new FuryAcpDelegationError(
      'permit-mismatch',
      'delegation permit does not match the exact request',
    );
  }
  if (now >= permit.expiresAt) {
    throw new FuryAcpDelegationError(
      'permit-expired',
      'delegation permit has expired',
    );
  }
  if (state.consumed) {
    throw new FuryAcpDelegationError(
      'permit-consumed',
      'delegation permit was already consumed',
    );
  }
  state.consumed = true;
}

export function createFuryAcpDelegationRuntime(options: {
  readonly now?: () => number;
  readonly verifyResult: (
    input: FuryAcpDelegationVerificationInput,
  ) => FuryAcpDelegationVerificationStatus
    | Promise<FuryAcpDelegationVerificationStatus>;
}) {
  if (!options || typeof options.verifyResult !== 'function') {
    throw new FuryAcpDelegationError(
      'invalid-input',
      'delegation runtime requires an independent result verifier',
    );
  }
  const nowSource = options.now ?? Date.now;

  return Object.freeze({
    async execute(
      request: FuryAcpDelegationRequest,
      permit: FuryAcpDelegationPermit,
      invokeOptions: { readonly signal?: AbortSignal } = {},
    ): Promise<FuryAcpDelegationResult> {
      if (!isGeneratedFuryAcpDelegationRequest(request)) {
        throw new FuryAcpDelegationError(
          'invalid-request',
          'delegation request is not process-local evidence',
        );
      }
      const requestState = REQUEST_STATE.get(request)!;
      const internal = getFuryAcpExternalSessionInternal(requestState.session);
      if (
        !internal
        || internal.lifecycle() !== 'ready'
        || internal.agentId !== request.agentId
        || internal.agentIdentitySha256 !== request.agentIdentitySha256
        || internal.workspaceRootSha256 !== request.workspaceRootSha256
        || internal.protocolVersion !== request.protocolVersion
      ) {
        throw new FuryAcpDelegationError(
          'session-not-ready',
          'delegation session is not live and exact',
        );
      }
      if (ACTIVE_SESSIONS.has(requestState.session as object)) {
        throw new FuryAcpDelegationError(
          'session-busy',
          'delegation session already has an active prompt',
        );
      }

      const startedAt = safeNow(nowSource);
      consumePermit(request, permit, startedAt);
      ACTIVE_SESSIONS.add(requestState.session as object);

      let updateCount = 0;
      let toolCallCount = 0;
      let outputBytes = 0;
      let outputText = '';
      let abortCode: FuryAcpDelegationReceipt['errorCode'] | undefined;
      let invoked = false;
      let response: acp.PromptResponse | undefined;
      const controller = new AbortController();

      const cancelBestEffort = (): void => {
        if (!controller.signal.aborted) controller.abort();
        void internal.connection.agent.notify(
          acp.methods.agent.session.cancel,
          { sessionId: internal.acpSessionId },
        ).catch(() => undefined);
      };

      const failBudget = (
        code: Exclude<
          FuryAcpDelegationReceipt['errorCode'],
          undefined | 'session-not-ready' | 'cancelled' | 'transport-unknown'
            | 'verification-failed'
        >,
      ): void => {
        if (abortCode !== undefined) return;
        abortCode = code;
        cancelBestEffort();
      };

      const unsubscribe = internal.subscribeUpdates((notification) => {
        updateCount += 1;
        let encoded = '';
        try {
          encoded = JSON.stringify(notification.update);
        } catch {
          failBudget('output-limit');
          return;
        }
        outputBytes += byteLength(encoded);
        if (updateCount > requestState.budget.maxMessages) {
          failBudget('message-limit');
          return;
        }
        if (outputBytes > requestState.budget.maxBytesOut) {
          failBudget('output-limit');
          return;
        }
        const update = notification.update;
        if (update.sessionUpdate === 'tool_call') {
          toolCallCount += 1;
          if (!requestState.capabilities.includes('observe:tool-calls')) {
            failBudget('capability-violation');
            return;
          }
          if (toolCallCount > requestState.budget.maxToolCalls) {
            failBudget('tool-limit');
            return;
          }
        }
        if (
          update.sessionUpdate === 'agent_message_chunk'
          && update.content.type === 'text'
        ) {
          const nextOutput = outputText + update.content.text;
          if (byteLength(nextOutput) > requestState.budget.maxBytesOut) {
            failBudget('output-limit');
            return;
          }
          outputText = nextOutput;
        }
      });

      const timeout = setTimeout(() => {
        if (abortCode === undefined) abortCode = 'wall-time-limit';
        cancelBestEffort();
      }, requestState.budget.maxWallTimeMs);
      timeout.unref();

      const onExternalAbort = (): void => {
        if (abortCode === undefined) abortCode = 'cancelled';
        cancelBestEffort();
      };
      invokeOptions.signal?.addEventListener('abort', onExternalAbort, {
        once: true,
      });

      try {
        invoked = true;
        response = await internal.connection.agent.request(
          acp.methods.agent.session.prompt,
          {
            sessionId: internal.acpSessionId,
            prompt: [{ type: 'text', text: requestState.task }],
          },
          { cancellationSignal: controller.signal },
        );
      } catch {
        // Once session/prompt is invoked, transport/cancellation failure cannot
        // prove that the external agent made no side effects.
      } finally {
        clearTimeout(timeout);
        invokeOptions.signal?.removeEventListener('abort', onExternalAbort);
        unsubscribe();
        ACTIVE_SESSIONS.delete(requestState.session as object);
      }

      const finishedAt = safeNow(nowSource);
      let outcome: FuryAcpDelegationOutcome;
      let errorCode = abortCode;
      if (response) {
        if (response.stopReason === 'cancelled') {
          outcome = 'unknown';
          errorCode = errorCode ?? 'cancelled';
        } else if (abortCode !== undefined) {
          outcome = 'unknown';
        } else {
          outcome = 'completed';
        }
      } else if (invoked) {
        outcome = 'unknown';
        errorCode = errorCode ?? 'transport-unknown';
      } else {
        outcome = 'failed';
        errorCode = errorCode ?? 'session-not-ready';
      }

      let verificationStatus: FuryAcpDelegationVerificationStatus = 'not-run';
      if (outcome === 'completed' && response) {
        try {
          const verified = await options.verifyResult(Object.freeze({
            requestSha256: request.requestSha256,
            agentId: request.agentId,
            agentIdentitySha256: request.agentIdentitySha256,
            workspaceRootSha256: request.workspaceRootSha256,
            taskSha256: request.taskSha256,
            capabilitiesSha256: request.capabilitiesSha256,
            budgetSha256: request.budgetSha256,
            stopReason: response.stopReason,
            updateCount,
            toolCallCount,
            outputText,
          }));
          verificationStatus = ['verified', 'rejected', 'unknown'].includes(verified)
            ? verified
            : 'unknown';
        } catch {
          verificationStatus = 'unknown';
        }
        if (verificationStatus === 'unknown') {
          errorCode = errorCode ?? 'verification-failed';
        }
      }

      const accepted = outcome === 'completed'
        && response?.stopReason === 'end_turn'
        && verificationStatus === 'verified';

      const receipt = Object.freeze({
        format: FURY_ACP_DELEGATION_RECEIPT_FORMAT,
        receiptId: 'fadc_' + randomUUID(),
        permitIdSha256: sha256('permit:' + permit.permitId),
        requestSha256: request.requestSha256,
        agentIdentitySha256: request.agentIdentitySha256,
        workspaceRootSha256: request.workspaceRootSha256,
        taskSha256: request.taskSha256,
        capabilitiesSha256: request.capabilitiesSha256,
        budgetSha256: request.budgetSha256,
        startedAt,
        finishedAt,
        outcome,
        ...(response === undefined ? {} : { stopReason: response.stopReason }),
        updateCount,
        toolCallCount,
        outputBytes,
        outputSha256: sha256(outputText),
        verificationStatus,
        accepted,
        automaticReplayAllowed: false as const,
        executionAuthority: false as const,
        delegationAuthority: false as const,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
      return Object.freeze({ receipt, outputText });
    },
  });
}
