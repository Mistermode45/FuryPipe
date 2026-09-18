import { digestMcpDirectJson } from './mcp-direct-json.js';
import {
  isGeneratedMcpDirectLifecycleState,
  type McpDirectLifecycleState,
} from './mcp-direct-governance.js';
import {
  isGeneratedMcpDirectToolProposal,
  type McpDirectToolProposal,
} from './mcp-direct-policy-internal.js';

export type McpDirectReplayReason =
  | 'repeat_closed_world_read'
  | 'retry_known_tool_error';

export type McpDirectReplayLedgerOutcome =
  | 'reserved'
  | 'succeeded'
  | 'tool_error'
  | 'unknown'
  | 'evidence_failed'
  | 'verification_failed';

export interface McpDirectReplayIntent {
  readonly format: 'furypipe-mcp-direct-replay-intent/v1';
  readonly replayIntentSha256: string;
  readonly replayKeySha256: string;
  readonly priorResultSha256: string;
  readonly priorAttempt: number;
  readonly reason: McpDirectReplayReason;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface McpDirectReplayIntentOptions {
  readonly now?: number;
  readonly expiresInMs?: number;
}

export interface McpDirectReplayReservation {
  readonly format: 'furypipe-mcp-direct-replay-reservation/v1';
  readonly replayKeySha256: string;
  readonly attempt: number;
  readonly replayed: boolean;
  readonly reason?: McpDirectReplayReason;
  readonly priorResultSha256?: string;
}

interface ReceiptLike {
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly toolName: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly resultSha256: string;
  readonly executed: true;
  readonly succeeded: boolean;
}

interface ReceiptState {
  readonly replayKeySha256: string;
  readonly attempt: number;
  readonly resultSha256: string;
  readonly succeeded: boolean;
}

interface ReplayIntentState {
  readonly lifecycle: McpDirectLifecycleState;
  readonly proposal: McpDirectToolProposal;
  readonly replayKeySha256: string;
  readonly priorResultSha256: string;
  readonly priorAttempt: number;
  readonly reason: McpDirectReplayReason;
  readonly expiresAt: number;
}

interface LedgerEntry {
  readonly replayKeySha256: string;
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly transport: McpDirectLifecycleState['source']['transport'];
  readonly toolName: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly attempt: number;
  readonly outcome: McpDirectReplayLedgerOutcome;
  readonly resultSha256?: string;
  readonly succeeded?: boolean;
}

const LEDGER = new Map<string, LedgerEntry>();
const RECEIPT_STATE = new WeakMap<object, ReceiptState>();
const REPLAY_INTENT_STATE = new WeakMap<object, ReplayIntentState>();
const CONSUMED_REPLAY_INTENTS = new WeakSet<object>();
const RESERVATIONS = new WeakMap<object, {
  readonly key: string;
  readonly attempt: number;
  readonly previous?: LedgerEntry;
}>();

const SHA256 = /^[a-f0-9]{64}$/u;
const DEFAULT_DUPLICATE_WINDOW_MS = 5 * 60_000;
const MAX_DUPLICATE_WINDOW_MS = 30 * 60_000;
const DEFAULT_REPLAY_INTENT_TTL_MS = 15_000;
const MAX_REPLAY_INTENT_TTL_MS = 30_000;
const MAX_LEDGER_ENTRIES = 4_096;
const MAX_ATTEMPTS_PER_KEY = 3;

export type McpDirectReplayGovernanceErrorCode =
  | 'duplicate-blocked'
  | 'replay-not-authorized'
  | 'replay-ledger-saturated'
  | 'replay-attempt-limit';

const SAFE_ERROR_MESSAGES: Readonly<Record<McpDirectReplayGovernanceErrorCode, string>> =
  Object.freeze({
    'duplicate-blocked': 'An identical MCP execution is already within the duplicate-suppression window.',
    'replay-not-authorized': 'MCP replay is not authorized by fresh process-local replay evidence.',
    'replay-ledger-saturated': 'MCP replay ledger is saturated; execution is blocked fail-closed.',
    'replay-attempt-limit': 'MCP replay attempt limit has been reached for this execution key.',
  });

export class McpDirectReplayGovernanceError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: McpDirectReplayGovernanceErrorCode,
    readonly replayKeySha256?: string,
    readonly priorOutcome?: McpDirectReplayLedgerOutcome,
    readonly priorAttempt?: number,
    readonly expiresAt?: number,
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = 'McpDirectReplayGovernanceError';
  }
}

function timestamp(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error('MCP replay timestamp must be a non-negative safe integer');
  }
  return resolved;
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
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function selectedTool(lifecycle: McpDirectLifecycleState) {
  if (
    !isGeneratedMcpDirectLifecycleState(lifecycle)
    || !lifecycle.connected
    || !lifecycle.healthy
    || !lifecycle.listed
    || !lifecycle.selected
    || !lifecycle.selectedTool
    || !lifecycle.inventory
    || !lifecycle.approved
    || !lifecycle.approval
    || lifecycle.executed
  ) {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }
  const selected = lifecycle.inventory.find(tool => tool.name === lifecycle.selectedTool);
  if (!selected) throw new McpDirectReplayGovernanceError('replay-not-authorized');
  return selected;
}

function assertBound(
  lifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
): NonNullable<McpDirectLifecycleState['inventory']>[number] {
  const selected = selectedTool(lifecycle);
  if (!isGeneratedMcpDirectToolProposal(proposal)) {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }
  if (
    lifecycle.source.sourceId !== proposal.sourceId
    || lifecycle.source.endpointFingerprint !== proposal.endpointFingerprint
    || lifecycle.selectedTool !== proposal.toolName
    || lifecycle.approval?.inputSha256 !== proposal.inputSha256
    || selected.inputSchemaSha256 !== proposal.inputSchemaSha256
    || selected.risk.riskClass !== proposal.riskClass
  ) {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }
  return selected;
}

export function deriveMcpDirectReplayKey(
  lifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
): string {
  assertBound(lifecycle, proposal);
  return digestMcpDirectJson({
    sourceId: lifecycle.source.sourceId,
    transport: lifecycle.source.transport,
    endpointFingerprint: lifecycle.source.endpointFingerprint,
    toolName: proposal.toolName,
    inputSchemaSha256: proposal.inputSchemaSha256,
    inputSha256: proposal.inputSha256,
  }, {
    maxBytes: 16 * 1024,
    maxDepth: 8,
    label: 'MCP replay key evidence',
  });
}

function prune(now: number): void {
  for (const [key, entry] of LEDGER) {
    if (entry.expiresAt <= now) LEDGER.delete(key);
  }
}

function ensureCapacity(now: number): void {
  prune(now);
  if (LEDGER.size >= MAX_LEDGER_ENTRIES) {
    throw new McpDirectReplayGovernanceError('replay-ledger-saturated');
  }
}

function newEntry(
  lifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  key: string,
  attempt: number,
  now: number,
): LedgerEntry {
  const ttl = Math.min(DEFAULT_DUPLICATE_WINDOW_MS, MAX_DUPLICATE_WINDOW_MS);
  return Object.freeze({
    replayKeySha256: key,
    sourceId: lifecycle.source.sourceId,
    endpointFingerprint: lifecycle.source.endpointFingerprint,
    transport: lifecycle.source.transport,
    toolName: proposal.toolName,
    inputSchemaSha256: proposal.inputSchemaSha256,
    inputSha256: proposal.inputSha256,
    createdAt: now,
    expiresAt: now + ttl,
    attempt,
    outcome: 'reserved',
  });
}

export function createMcpDirectReplayIntentInternal(
  priorReceipt: ReceiptLike,
  approvedLifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  reason: McpDirectReplayReason,
  options: McpDirectReplayIntentOptions = {},
): McpDirectReplayIntent {
  if (!priorReceipt || typeof priorReceipt !== 'object') {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }
  const receiptState = RECEIPT_STATE.get(priorReceipt as object);
  if (!receiptState) throw new McpDirectReplayGovernanceError('replay-not-authorized');

  const selected = assertBound(approvedLifecycle, proposal);
  if (
    approvedLifecycle.source.trust !== 'trusted'
    || selected.risk.riskClass !== 'trusted_read_only_closed_world'
    || selected.risk.closedWorldReadCandidate !== true
  ) {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }

  const now = timestamp(options.now, Date.now());
  prune(now);
  if (!approvedLifecycle.approval || approvedLifecycle.approval.expiresAt <= now) {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }

  const key = deriveMcpDirectReplayKey(approvedLifecycle, proposal);
  if (
    key !== receiptState.replayKeySha256
    || priorReceipt.sourceId !== approvedLifecycle.source.sourceId
    || priorReceipt.endpointFingerprint !== approvedLifecycle.source.endpointFingerprint
    || priorReceipt.toolName !== proposal.toolName
    || priorReceipt.inputSchemaSha256 !== proposal.inputSchemaSha256
    || priorReceipt.inputSha256 !== proposal.inputSha256
    || priorReceipt.resultSha256 !== receiptState.resultSha256
    || priorReceipt.succeeded !== receiptState.succeeded
  ) {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }

  const entry = LEDGER.get(key);
  if (
    !entry
    || entry.attempt !== receiptState.attempt
    || entry.resultSha256 !== receiptState.resultSha256
    || (entry.outcome !== 'succeeded' && entry.outcome !== 'tool_error')
  ) {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }
  if (entry.attempt >= MAX_ATTEMPTS_PER_KEY) {
    throw new McpDirectReplayGovernanceError(
      'replay-attempt-limit',
      key,
      entry.outcome,
      entry.attempt,
      entry.expiresAt,
    );
  }

  if (
    (receiptState.succeeded && reason !== 'repeat_closed_world_read')
    || (!receiptState.succeeded && reason !== 'retry_known_tool_error')
  ) {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }

  const requestedTtl = boundedInteger(
    options.expiresInMs,
    DEFAULT_REPLAY_INTENT_TTL_MS,
    1,
    MAX_REPLAY_INTENT_TTL_MS,
    'MCP replay intent expiresInMs',
  );
  const expiresAt = Math.min(
    now + requestedTtl,
    approvedLifecycle.approval.expiresAt,
    entry.expiresAt,
  );
  if (expiresAt <= now) {
    throw new McpDirectReplayGovernanceError('replay-not-authorized');
  }

  const replayIntentSha256 = digestMcpDirectJson({
    replayKeySha256: key,
    priorResultSha256: receiptState.resultSha256,
    priorAttempt: receiptState.attempt,
    reason,
    proposalSha256: proposal.proposalSha256,
    issuedAt: now,
    expiresAt,
  }, {
    maxBytes: 16 * 1024,
    maxDepth: 8,
    label: 'MCP replay intent evidence',
  });

  const intent = Object.freeze({
    format: 'furypipe-mcp-direct-replay-intent/v1' as const,
    replayIntentSha256,
    replayKeySha256: key,
    priorResultSha256: receiptState.resultSha256,
    priorAttempt: receiptState.attempt,
    reason,
    issuedAt: now,
    expiresAt,
  });
  REPLAY_INTENT_STATE.set(intent, Object.freeze({
    lifecycle: approvedLifecycle,
    proposal,
    replayKeySha256: key,
    priorResultSha256: receiptState.resultSha256,
    priorAttempt: receiptState.attempt,
    reason,
    expiresAt,
  }));
  return intent;
}

export function isGeneratedMcpDirectReplayIntent(
  value: unknown,
): value is McpDirectReplayIntent {
  return typeof value === 'object' && value !== null && REPLAY_INTENT_STATE.has(value);
}

export function reserveMcpDirectExecutionAttempt(
  lifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  replayIntent: McpDirectReplayIntent | undefined,
  nowValue: number,
): McpDirectReplayReservation {
  assertBound(lifecycle, proposal);
  const now = timestamp(nowValue, nowValue);
  prune(now);
  const key = deriveMcpDirectReplayKey(lifecycle, proposal);
  const existing = LEDGER.get(key);

  let attempt = 1;
  let reason: McpDirectReplayReason | undefined;
  let priorResultSha256: string | undefined;

  if (replayIntent === undefined) {
    if (existing) {
      throw new McpDirectReplayGovernanceError(
        'duplicate-blocked',
        key,
        existing.outcome,
        existing.attempt,
        existing.expiresAt,
      );
    }
    ensureCapacity(now);
  } else {
    const intentState = REPLAY_INTENT_STATE.get(replayIntent);
    if (
      !intentState
      || CONSUMED_REPLAY_INTENTS.has(replayIntent)
      || replayIntent.format !== 'furypipe-mcp-direct-replay-intent/v1'
      || replayIntent.replayKeySha256 !== key
      || intentState.replayKeySha256 !== key
      || intentState.lifecycle !== lifecycle
      || intentState.proposal !== proposal
      || replayIntent.priorResultSha256 !== intentState.priorResultSha256
      || replayIntent.priorAttempt !== intentState.priorAttempt
      || replayIntent.reason !== intentState.reason
      || replayIntent.expiresAt !== intentState.expiresAt
      || replayIntent.expiresAt <= now
      || !existing
      || existing.attempt !== intentState.priorAttempt
      || existing.resultSha256 !== intentState.priorResultSha256
      || (existing.outcome !== 'succeeded' && existing.outcome !== 'tool_error')
    ) {
      throw new McpDirectReplayGovernanceError('replay-not-authorized', key);
    }
    if (existing.attempt >= MAX_ATTEMPTS_PER_KEY) {
      throw new McpDirectReplayGovernanceError(
        'replay-attempt-limit',
        key,
        existing.outcome,
        existing.attempt,
        existing.expiresAt,
      );
    }
    CONSUMED_REPLAY_INTENTS.add(replayIntent);
    attempt = existing.attempt + 1;
    reason = intentState.reason;
    priorResultSha256 = intentState.priorResultSha256;
  }

  LEDGER.set(key, newEntry(lifecycle, proposal, key, attempt, now));
  const reservation = Object.freeze({
    format: 'furypipe-mcp-direct-replay-reservation/v1' as const,
    replayKeySha256: key,
    attempt,
    replayed: replayIntent !== undefined,
    ...(reason === undefined ? {} : { reason }),
    ...(priorResultSha256 === undefined ? {} : { priorResultSha256 }),
  });
  RESERVATIONS.set(reservation, Object.freeze({
    key,
    attempt,
    ...(replayIntent === undefined || existing === undefined
      ? {}
      : { previous: existing }),
  }));
  return reservation;
}

export function releaseMcpDirectExecutionReservation(
  reservation: McpDirectReplayReservation,
): void {
  const state = RESERVATIONS.get(reservation);
  if (!state) return;
  const entry = LEDGER.get(state.key);
  if (
    entry
    && entry.attempt === state.attempt
    && entry.outcome === 'reserved'
  ) {
    if (state.previous) LEDGER.set(state.key, state.previous);
    else LEDGER.delete(state.key);
  }
}

export function settleMcpDirectExecutionAttempt(
  reservation: McpDirectReplayReservation,
  outcome: Exclude<McpDirectReplayLedgerOutcome, 'reserved'>,
  evidence: {
    readonly resultSha256?: string;
    readonly succeeded?: boolean;
    readonly now?: number;
  } = {},
): void {
  const state = RESERVATIONS.get(reservation);
  if (!state) throw new Error('MCP replay reservation must be process-local FuryPipe evidence');
  const entry = LEDGER.get(state.key);
  if (!entry || entry.attempt !== state.attempt || entry.outcome !== 'reserved') {
    throw new Error('MCP replay reservation is no longer active');
  }
  if (evidence.resultSha256 !== undefined && !SHA256.test(evidence.resultSha256)) {
    throw new Error('MCP replay resultSha256 must be a lowercase SHA-256 digest');
  }
  const now = timestamp(evidence.now, Date.now());
  const expiresAt = Math.max(entry.expiresAt, now + DEFAULT_DUPLICATE_WINDOW_MS);
  LEDGER.set(state.key, Object.freeze({
    ...entry,
    expiresAt,
    outcome,
    ...(evidence.resultSha256 === undefined ? {} : { resultSha256: evidence.resultSha256 }),
    ...(evidence.succeeded === undefined ? {} : { succeeded: evidence.succeeded }),
  }));
}

export function registerGeneratedMcpDirectExecutionReceipt(
  receipt: ReceiptLike,
  reservation: McpDirectReplayReservation,
): void {
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('MCP execution receipt must be an object');
  }
  const state = RESERVATIONS.get(reservation);
  if (!state) throw new Error('MCP replay reservation must be process-local FuryPipe evidence');
  const entry = LEDGER.get(state.key);
  if (
    !entry
    || entry.attempt !== state.attempt
    || entry.resultSha256 !== receipt.resultSha256
    || (entry.outcome !== 'succeeded' && entry.outcome !== 'tool_error')
    || entry.succeeded !== receipt.succeeded
  ) {
    throw new Error('MCP execution receipt does not match replay ledger evidence');
  }
  RECEIPT_STATE.set(receipt as object, Object.freeze({
    replayKeySha256: state.key,
    attempt: state.attempt,
    resultSha256: receipt.resultSha256,
    succeeded: receipt.succeeded,
  }));
}

export function inspectMcpDirectReplayLedgerForTests(
  replayKeySha256: string,
): Readonly<LedgerEntry> | undefined {
  return LEDGER.get(replayKeySha256);
}


export function resetMcpDirectReplayStateForTests(): void {
  LEDGER.clear();
}
