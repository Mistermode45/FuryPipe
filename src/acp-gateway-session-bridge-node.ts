import { createHash } from 'node:crypto';

import * as acp from '@agentclientprotocol/sdk';

import type {
  RecoveryHandle,
  RecoveryMetadata,
  RecoveryStore,
} from './core/recovery-store.js';
import {
  createFuryGatewayCommandRegistry,
  evaluateFuryGatewayCommandAdmission,
  type FuryGatewayCommandAdmissionDecision,
} from './gateway-command-authorization-node.js';
import {
  FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
  type FuryGatewayConversationAdapter,
  type FuryGatewayConversationCommandName,
} from './gateway-conversation-adapter-node.js';
import {
  isGeneratedFuryGatewaySessionLease,
  type FuryGatewaySessionCoordinator,
  type FuryGatewaySessionLease,
} from './gateway-session-node.js';
import {
  isGeneratedFuryAcpV1SessionSnapshot,
  type FuryAcpV1PromptInput,
  type FuryAcpV1ServerSessionHooks,
  type FuryAcpV1SessionSnapshot,
} from './acp-v1-server-node.js';

export const FURY_ACP_GATEWAY_BINDING_FORMAT =
  'furypipe-acp-gateway-binding/v1' as const;
export const FURY_ACP_GATEWAY_EVIDENCE_FORMAT =
  'furypipe-acp-gateway-binding-evidence/v1' as const;
export const FURY_ACP_GATEWAY_PROMPT_ADMISSION_FORMAT =
  'furypipe-acp-gateway-prompt-admission/v1' as const;
export const FURY_ACP_GATEWAY_CANCELLATION_FORMAT =
  'furypipe-acp-gateway-cancellation/v1' as const;

export interface FuryAcpGatewayBindingInspection {
  readonly format: typeof FURY_ACP_GATEWAY_BINDING_FORMAT;
  readonly acpSessionIdSha256: string;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly conversationId: string;
  readonly conversationIdSha256: string;
  readonly cwdSha256: string;
  readonly createdAt: number;
  readonly lastValidatedAt: number;
  readonly authority: 'session-mapping-only';
  readonly executionAuthority: false;
}

export interface FuryAcpGatewayBindingEvidence {
  readonly format: typeof FURY_ACP_GATEWAY_EVIDENCE_FORMAT;
  readonly acpSessionIdSha256: string;
  readonly gatewaySessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly conversationIdSha256: string;
  readonly cwdSha256: string;
  readonly protocolVersion: 1;
  readonly createdAt: number;
  readonly state: 'bound';
  readonly authority: 'evidence-only';
  readonly executionAuthority: false;
}

export interface FuryAcpGatewayPromptAdmission {
  readonly format: typeof FURY_ACP_GATEWAY_PROMPT_ADMISSION_FORMAT;
  readonly acpSessionIdSha256: string;
  readonly conversationId: string;
  readonly conversationIdSha256: string;
  readonly decisionIdSha256: string;
  readonly admittedAt: number;
  readonly outcome: 'eligible';
  readonly authority: 'gateway-admission-only';
  readonly executionAuthority: false;
}

export interface FuryAcpGatewayCancellationReceipt {
  readonly format: typeof FURY_ACP_GATEWAY_CANCELLATION_FORMAT;
  readonly acpSessionIdSha256: string;
  readonly observedAt: number;
  readonly authority: 'cancellation-observation-only';
  readonly executionAuthority: false;
}

export interface FuryAcpGatewaySessionBridgeOptions {
  readonly recovery: RecoveryStore;
  readonly gatewaySessionCoordinator: FuryGatewaySessionCoordinator;
  readonly gatewaySession: FuryGatewaySessionLease;
  readonly conversationAdapter: FuryGatewayConversationAdapter;
  readonly now?: () => number;
  readonly maxBindings?: number;
  readonly maxEvidenceRecords?: number;
}

export interface FuryAcpGatewaySessionBridge {
  bind(
    session: FuryAcpV1SessionSnapshot,
  ): Promise<FuryAcpGatewayBindingInspection>;
  revalidatePrompt(
    session: FuryAcpV1SessionSnapshot,
  ): FuryAcpGatewayPromptAdmission;
  observeCancellation(
    session: FuryAcpV1SessionSnapshot,
  ): FuryAcpGatewayCancellationReceipt;
  inspectBinding(
    session: FuryAcpV1SessionSnapshot,
  ): FuryAcpGatewayBindingInspection | undefined;
  matchesGatewayAuthority(
    session: FuryAcpV1SessionSnapshot,
    candidate: FuryGatewaySessionLease,
  ): boolean;
  listEvidence(): Promise<readonly FuryAcpGatewayBindingEvidence[]>;
  activeBindingCount(): number;
  readonly sessionHooks: FuryAcpV1ServerSessionHooks;
}

export type FuryAcpGatewaySessionBridgeErrorCode =
  | 'invalid-config'
  | 'invalid-acp-session'
  | 'gateway-admission-denied'
  | 'binding-not-found'
  | 'binding-conflict'
  | 'kernel-rejected'
  | 'store-capability-missing'
  | 'persistence-failed'
  | 'evidence-corrupt'
  | 'limit-exceeded';

const ERROR_MESSAGES: Readonly<Record<
  FuryAcpGatewaySessionBridgeErrorCode,
  string
>> = Object.freeze({
  'invalid-config': 'ACP Gateway bridge configuration is invalid.',
  'invalid-acp-session': 'ACP session evidence is invalid.',
  'gateway-admission-denied': 'Current Fury Gateway admission denied this ACP operation.',
  'binding-not-found': 'ACP session is not bound in this bridge instance.',
  'binding-conflict': 'ACP session binding is inconsistent with current process state.',
  'kernel-rejected': 'Fury Kernel conversation state rejected the ACP binding operation.',
  'store-capability-missing': 'ACP Gateway bridge requires RecoveryStore list and putBounded capabilities.',
  'persistence-failed': 'ACP Gateway bridge could not persist bounded evidence.',
  'evidence-corrupt': 'ACP Gateway durable evidence is invalid or inconsistent.',
  'limit-exceeded': 'ACP Gateway bridge reached a configured bound.',
});

export class FuryAcpGatewaySessionBridgeError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: FuryAcpGatewaySessionBridgeErrorCode,
    readonly admissionReason?: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryAcpGatewaySessionBridgeError';
  }
}

interface ActiveBindingState {
  readonly acpSessionId: string;
  readonly conversationId: string;
  readonly evidenceHandle: RecoveryHandle;
  readonly base: Omit<FuryAcpGatewayBindingInspection, 'lastValidatedAt'>;
  lastValidatedAt: number;
  lastCancellationAt?: number;
}

const GENERATED_BRIDGES = new WeakSet<object>();
const SYSTEM = 'acp-gateway-session-bridge';
const RECORD_KIND = 'binding';
const SHA256_RE = /^[0-9a-f]{64}$/u;
const CONVERSATION_ID_RE = /^fkc_[A-Za-z0-9_-]{24}$/u;
const DEFAULT_MAX_BINDINGS = 64;
const HARD_MAX_BINDINGS = 2_048;
const DEFAULT_MAX_EVIDENCE_RECORDS = 10_000;
const HARD_MAX_EVIDENCE_RECORDS = 10_000;
const MAX_EVIDENCE_BYTES = 4 * 1024;

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

function finiteNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryAcpGatewaySessionBridgeError('invalid-config');
  }
  return value;
}

function digest(label: string, value: string): string {
  return createHash('sha256')
    .update('furypipe-acp-gateway/v1\0', 'utf8')
    .update(label, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function bindingInspection(
  state: ActiveBindingState,
): FuryAcpGatewayBindingInspection {
  return Object.freeze({
    ...state.base,
    lastValidatedAt: state.lastValidatedAt,
  });
}

function evidencePayload(
  input: Omit<
    FuryAcpGatewayBindingEvidence,
    'format' | 'protocolVersion' | 'state' | 'authority' | 'executionAuthority'
  >,
): FuryAcpGatewayBindingEvidence {
  return Object.freeze({
    format: FURY_ACP_GATEWAY_EVIDENCE_FORMAT,
    ...input,
    protocolVersion: 1 as const,
    state: 'bound' as const,
    authority: 'evidence-only' as const,
    executionAuthority: false as const,
  });
}

function parseEvidence(value: unknown): FuryAcpGatewayBindingEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FuryAcpGatewaySessionBridgeError('evidence-corrupt');
  }
  const record = value as Record<string, unknown>;
  const exactKeys = [
    'acpSessionIdSha256',
    'authority',
    'conversationIdSha256',
    'createdAt',
    'cwdSha256',
    'executionAuthority',
    'format',
    'gatewaySessionIdSha256',
    'principalIdSha256',
    'protocolVersion',
    'state',
  ].sort();
  if (
    Object.getOwnPropertySymbols(record).length !== 0
    || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(exactKeys)
    || record.format !== FURY_ACP_GATEWAY_EVIDENCE_FORMAT
    || record.protocolVersion !== 1
    || record.state !== 'bound'
    || record.authority !== 'evidence-only'
    || record.executionAuthority !== false
    || !Number.isSafeInteger(record.createdAt)
    || (record.createdAt as number) < 0
  ) {
    throw new FuryAcpGatewaySessionBridgeError('evidence-corrupt');
  }
  for (const key of [
    'acpSessionIdSha256',
    'gatewaySessionIdSha256',
    'principalIdSha256',
    'conversationIdSha256',
    'cwdSha256',
  ] as const) {
    if (typeof record[key] !== 'string' || !SHA256_RE.test(record[key] as string)) {
      throw new FuryAcpGatewaySessionBridgeError('evidence-corrupt');
    }
  }
  return Object.freeze({
    format: FURY_ACP_GATEWAY_EVIDENCE_FORMAT,
    acpSessionIdSha256: record.acpSessionIdSha256 as string,
    gatewaySessionIdSha256: record.gatewaySessionIdSha256 as string,
    principalIdSha256: record.principalIdSha256 as string,
    conversationIdSha256: record.conversationIdSha256 as string,
    cwdSha256: record.cwdSha256 as string,
    protocolVersion: 1,
    createdAt: record.createdAt as number,
    state: 'bound',
    authority: 'evidence-only',
    executionAuthority: false,
  });
}

function bridgeAcpError(error: unknown): unknown {
  if (!(error instanceof FuryAcpGatewaySessionBridgeError)) return error;
  const code = error.code === 'persistence-failed' || error.code === 'evidence-corrupt'
    ? -32021
    : -32020;
  return new acp.RequestError(
    code,
    'FuryPipe ACP Gateway bridge rejected the operation',
    { code: error.code },
  );
}

export function isGeneratedFuryAcpGatewaySessionBridge(
  value: unknown,
): value is FuryAcpGatewaySessionBridge {
  return typeof value === 'object'
    && value !== null
    && GENERATED_BRIDGES.has(value);
}

export function createFuryAcpGatewaySessionBridge(
  options: FuryAcpGatewaySessionBridgeOptions,
): FuryAcpGatewaySessionBridge {
  if (
    !options
    || typeof options !== 'object'
    || !options.recovery
    || typeof options.recovery.list !== 'function'
    || typeof options.recovery.putBounded !== 'function'
    || !options.gatewaySessionCoordinator
    || !options.conversationAdapter
    || !isGeneratedFuryGatewaySessionLease(options.gatewaySession)
  ) {
    throw new FuryAcpGatewaySessionBridgeError(
      options?.recovery
      && (typeof options.recovery.list !== 'function'
        || typeof options.recovery.putBounded !== 'function')
        ? 'store-capability-missing'
        : 'invalid-config',
    );
  }

  try {
    const inspection = options.gatewaySessionCoordinator.inspectSession(
      options.gatewaySession,
    );
    if (inspection.status !== 'active') {
      throw new FuryAcpGatewaySessionBridgeError('invalid-config');
    }
  } catch (error) {
    if (error instanceof FuryAcpGatewaySessionBridgeError) throw error;
    throw new FuryAcpGatewaySessionBridgeError('invalid-config');
  }

  const now = options.now ?? Date.now;
  const maxBindings = boundedInteger(
    options.maxBindings,
    DEFAULT_MAX_BINDINGS,
    1,
    HARD_MAX_BINDINGS,
    'maxBindings',
  );
  const maxEvidenceRecords = boundedInteger(
    options.maxEvidenceRecords,
    DEFAULT_MAX_EVIDENCE_RECORDS,
    1,
    HARD_MAX_EVIDENCE_RECORDS,
    'maxEvidenceRecords',
  );
  const recovery = options.recovery;
  const gatewaySession = options.gatewaySession;
  const commandRegistry = createFuryGatewayCommandRegistry(
    FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
  );
  const states = new Map<string, ActiveBindingState>();
  const pendingBindings = new Map<
    string,
    Promise<FuryAcpGatewayBindingInspection>
  >();

  const requireAcpSession = (
    session: FuryAcpV1SessionSnapshot,
  ): FuryAcpV1SessionSnapshot => {
    if (!isGeneratedFuryAcpV1SessionSnapshot(session)) {
      throw new FuryAcpGatewaySessionBridgeError('invalid-acp-session');
    }
    return session;
  };

  const admit = (
    commandName: FuryGatewayConversationCommandName,
  ): FuryGatewayCommandAdmissionDecision => {
    const decision = evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: options.gatewaySessionCoordinator,
      session: gatewaySession,
      commandRegistry,
      commandName,
    });
    if (decision.outcome !== 'eligible') {
      throw new FuryAcpGatewaySessionBridgeError(
        'gateway-admission-denied',
        decision.reason,
      );
    }
    return decision;
  };

  const requireState = (
    session: FuryAcpV1SessionSnapshot,
  ): ActiveBindingState => {
    const valid = requireAcpSession(session);
    const state = states.get(valid.sessionId);
    if (!state) {
      throw new FuryAcpGatewaySessionBridgeError('binding-not-found');
    }
    if (
      state.base.acpSessionIdSha256 !== digest('acp-session', valid.sessionId)
      || state.base.cwdSha256 !== digest('cwd', valid.cwd)
    ) {
      throw new FuryAcpGatewaySessionBridgeError('binding-conflict');
    }
    return state;
  };

  const persistEvidence = async (
    evidence: FuryAcpGatewayBindingEvidence,
  ): Promise<RecoveryHandle> => {
    const encoded = Buffer.from(JSON.stringify(evidence) + '\n', 'utf8');
    if (encoded.byteLength > MAX_EVIDENCE_BYTES) {
      throw new FuryAcpGatewaySessionBridgeError('persistence-failed');
    }
    const metadata: RecoveryMetadata = Object.freeze({
      system: SYSTEM,
      kind: RECORD_KIND,
      acpSessionIdSha256: evidence.acpSessionIdSha256,
      gatewaySessionIdSha256: evidence.gatewaySessionIdSha256,
      principalIdSha256: evidence.principalIdSha256,
    });
    try {
      return await recovery.putBounded!(
        encoded,
        metadata,
        {
          metadata: { system: SYSTEM, kind: RECORD_KIND },
          maxMatches: maxEvidenceRecords,
          additionalBounds: [
            {
              metadata: {
                system: SYSTEM,
                kind: RECORD_KIND,
                acpSessionIdSha256: evidence.acpSessionIdSha256,
              },
              maxMatches: 1,
            },
          ],
        },
      );
    } catch {
      throw new FuryAcpGatewaySessionBridgeError('persistence-failed');
    }
  };

  const bind = async (
    sessionInput: FuryAcpV1SessionSnapshot,
  ): Promise<FuryAcpGatewayBindingInspection> => {
    const session = requireAcpSession(sessionInput);
    const existing = states.get(session.sessionId);
    if (existing) {
      admit('conversation.open');
      existing.lastValidatedAt = finiteNow(now);
      return bindingInspection(existing);
    }
    const pending = pendingBindings.get(session.sessionId);
    if (pending) return pending;
    if (states.size + pendingBindings.size >= maxBindings) {
      throw new FuryAcpGatewaySessionBridgeError('limit-exceeded');
    }

    const operation = (async (): Promise<FuryAcpGatewayBindingInspection> => {
      admit('conversation.open');
      const opened = options.conversationAdapter.dispatch(
        'conversation.open',
        {},
      );
      if (
        opened.status !== 'ok'
        || !opened.result
        || typeof opened.result !== 'object'
        || Array.isArray(opened.result)
      ) {
        throw new FuryAcpGatewaySessionBridgeError('kernel-rejected');
      }
      const conversationId = (
        opened.result as Record<string, unknown>
      ).conversationId;
      if (
        typeof conversationId !== 'string'
        || !CONVERSATION_ID_RE.test(conversationId)
      ) {
        throw new FuryAcpGatewaySessionBridgeError('kernel-rejected');
      }

      const createdAt = finiteNow(now);
      const acpSessionIdSha256 = digest('acp-session', session.sessionId);
      const gatewaySessionIdSha256 = digest(
        'gateway-session',
        gatewaySession.sessionId,
      );
      const principalIdSha256 = digest(
        'principal',
        gatewaySession.principalId,
      );
      const conversationIdSha256 = digest(
        'conversation',
        conversationId,
      );
      const cwdSha256 = digest('cwd', session.cwd);
      const evidence = evidencePayload({
        acpSessionIdSha256,
        gatewaySessionIdSha256,
        principalIdSha256,
        conversationIdSha256,
        cwdSha256,
        createdAt,
      });

      let evidenceHandle: RecoveryHandle;
      try {
        evidenceHandle = await persistEvidence(evidence);
      } catch (error) {
        options.conversationAdapter.dispatch(
          'conversation.close',
          { conversationId },
        );
        throw error;
      }

      const base = Object.freeze({
        format: FURY_ACP_GATEWAY_BINDING_FORMAT,
        acpSessionIdSha256,
        gatewaySessionIdSha256,
        principalIdSha256,
        conversationId,
        conversationIdSha256,
        cwdSha256,
        createdAt,
        authority: 'session-mapping-only' as const,
        executionAuthority: false as const,
      });
      const state: ActiveBindingState = {
        acpSessionId: session.sessionId,
        conversationId,
        evidenceHandle,
        base,
        lastValidatedAt: createdAt,
      };
      states.set(session.sessionId, state);
      return bindingInspection(state);
    })();

    pendingBindings.set(session.sessionId, operation);
    try {
      return await operation;
    } finally {
      pendingBindings.delete(session.sessionId);
    }
  };

  const revalidatePrompt = (
    sessionInput: FuryAcpV1SessionSnapshot,
  ): FuryAcpGatewayPromptAdmission => {
    const session = requireAcpSession(sessionInput);
    const state = requireState(session);
    const decision = admit('conversation.message.submit');
    const admittedAt = finiteNow(now);
    state.lastValidatedAt = admittedAt;
    return Object.freeze({
      format: FURY_ACP_GATEWAY_PROMPT_ADMISSION_FORMAT,
      acpSessionIdSha256: state.base.acpSessionIdSha256,
      conversationId: state.conversationId,
      conversationIdSha256: state.base.conversationIdSha256,
      decisionIdSha256: decision.decisionIdSha256,
      admittedAt,
      outcome: 'eligible' as const,
      authority: 'gateway-admission-only' as const,
      executionAuthority: false as const,
    });
  };

  const observeCancellation = (
    sessionInput: FuryAcpV1SessionSnapshot,
  ): FuryAcpGatewayCancellationReceipt => {
    const session = requireAcpSession(sessionInput);
    const state = requireState(session);
    const observedAt = finiteNow(now);
    state.lastCancellationAt = observedAt;
    return Object.freeze({
      format: FURY_ACP_GATEWAY_CANCELLATION_FORMAT,
      acpSessionIdSha256: state.base.acpSessionIdSha256,
      observedAt,
      authority: 'cancellation-observation-only' as const,
      executionAuthority: false as const,
    });
  };

  const listEvidence = async (): Promise<
    readonly FuryAcpGatewayBindingEvidence[]
  > => {
    let handles: readonly (RecoveryHandle & { metadata?: RecoveryMetadata })[];
    try {
      handles = await recovery.list!({
        metadata: { system: SYSTEM, kind: RECORD_KIND },
        limit: maxEvidenceRecords,
      });
    } catch {
      throw new FuryAcpGatewaySessionBridgeError('evidence-corrupt');
    }
    const result: FuryAcpGatewayBindingEvidence[] = [];
    for (const handle of handles) {
      let parsed: FuryAcpGatewayBindingEvidence;
      try {
        const bytes = await recovery.get(handle);
        parsed = parseEvidence(JSON.parse(Buffer.from(bytes).toString('utf8')));
      } catch (error) {
        if (error instanceof FuryAcpGatewaySessionBridgeError) throw error;
        throw new FuryAcpGatewaySessionBridgeError('evidence-corrupt');
      }
      if (
        handle.metadata?.system !== SYSTEM
        || handle.metadata?.kind !== RECORD_KIND
        || handle.metadata?.acpSessionIdSha256 !== parsed.acpSessionIdSha256
        || handle.metadata?.gatewaySessionIdSha256 !== parsed.gatewaySessionIdSha256
        || handle.metadata?.principalIdSha256 !== parsed.principalIdSha256
      ) {
        throw new FuryAcpGatewaySessionBridgeError('evidence-corrupt');
      }
      result.push(parsed);
    }
    result.sort((left, right) =>
      left.createdAt - right.createdAt
      || left.acpSessionIdSha256.localeCompare(right.acpSessionIdSha256)
    );
    return Object.freeze(result);
  };

  const sessionHooks: FuryAcpV1ServerSessionHooks = Object.freeze({
    async onCreated(session: FuryAcpV1SessionSnapshot): Promise<void> {
      try {
        await bind(session);
      } catch (error) {
        throw bridgeAcpError(error);
      }
    },
    async beforePrompt(
      session: FuryAcpV1SessionSnapshot,
      _prompt: FuryAcpV1PromptInput,
    ): Promise<void> {
      try {
        revalidatePrompt(session);
      } catch (error) {
        throw bridgeAcpError(error);
      }
    },
    async onCancelled(session: FuryAcpV1SessionSnapshot): Promise<void> {
      try {
        observeCancellation(session);
      } catch (error) {
        throw bridgeAcpError(error);
      }
    },
  });

  const bridge: FuryAcpGatewaySessionBridge = Object.freeze({
    bind,
    revalidatePrompt,
    observeCancellation,
    inspectBinding(
      sessionInput: FuryAcpV1SessionSnapshot,
    ): FuryAcpGatewayBindingInspection | undefined {
      const session = requireAcpSession(sessionInput);
      const state = states.get(session.sessionId);
      if (!state) return undefined;
      if (
        state.base.acpSessionIdSha256 !== digest(
          'acp-session',
          session.sessionId,
        )
        || state.base.cwdSha256 !== digest('cwd', session.cwd)
      ) {
        throw new FuryAcpGatewaySessionBridgeError('binding-conflict');
      }
      return bindingInspection(state);
    },
    matchesGatewayAuthority(
      sessionInput: FuryAcpV1SessionSnapshot,
      candidate: FuryGatewaySessionLease,
    ): boolean {
      if (
        !isGeneratedFuryGatewaySessionLease(candidate)
        || candidate !== gatewaySession
      ) {
        return false;
      }
      const state = requireState(sessionInput);
      return (
        state.base.gatewaySessionIdSha256
          === digest('gateway-session', candidate.sessionId)
        && state.base.principalIdSha256
          === digest('principal', candidate.principalId)
      );
    },
    listEvidence,
    activeBindingCount(): number {
      return states.size;
    },
    sessionHooks,
  });
  GENERATED_BRIDGES.add(bridge);
  return bridge;
}
