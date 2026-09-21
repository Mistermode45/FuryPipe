import { createHash, randomBytes } from 'node:crypto';

import type {
  RecoveryHandle,
  RecoveryMetadata,
  RecoveryStore,
} from './core/recovery-store.js';

export const FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT =
  'furypipe-gateway-automation-trigger-record/v1' as const;
export const FURY_GATEWAY_AUTOMATION_CLAIM_RECORD_FORMAT =
  'furypipe-gateway-automation-claim-record/v1' as const;
export const FURY_GATEWAY_AUTOMATION_ARMED_RECORD_FORMAT =
  'furypipe-gateway-automation-armed-record/v1' as const;
export const FURY_GATEWAY_AUTOMATION_TERMINAL_RECORD_FORMAT =
  'furypipe-gateway-automation-terminal-record/v1' as const;
export const FURY_GATEWAY_AUTOMATION_RUN_STATUS_FORMAT =
  'furypipe-gateway-automation-run-status/v1' as const;

export const FURY_GATEWAY_AUTOMATION_TRIGGER_SOURCE_KINDS = Object.freeze([
  'one-shot',
  'interval',
  'cron',
  'webhook',
  'message-event',
  'file-repo-event',
  'connector-event',
  'condition-watch',
] as const);
export type FuryGatewayAutomationTriggerSourceKind =
  (typeof FURY_GATEWAY_AUTOMATION_TRIGGER_SOURCE_KINDS)[number];

export const FURY_GATEWAY_AUTOMATION_TERMINAL_OUTCOMES = Object.freeze([
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
  'outcome-unknown',
] as const);
export type FuryGatewayAutomationTerminalOutcome =
  (typeof FURY_GATEWAY_AUTOMATION_TERMINAL_OUTCOMES)[number];

export interface FuryGatewayAutomationTriggerOccurrenceInput {
  readonly automationId: string;
  readonly definitionRevision: number;
  readonly definitionSha256: string;
  readonly sourceKind: FuryGatewayAutomationTriggerSourceKind;
  /**
   * Stable host/provider occurrence key. It is used only to derive digests and
   * is never persisted in the run ledger.
   */
  readonly occurrenceKey: string;
  readonly scheduledFor: number;
}

export interface FuryGatewayAutomationTriggerOccurrence {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT;
  readonly automationId: string;
  readonly definitionRevision: number;
  readonly definitionSha256: string;
  readonly sourceKind: FuryGatewayAutomationTriggerSourceKind;
  readonly occurrenceKeySha256: string;
  readonly triggerIdSha256: string;
  readonly runIdSha256: string;
  readonly executionIdentitySha256: string;
  readonly scheduledFor: number;
  readonly createdAt: number;
  readonly authority: 'durable-trigger-evidence';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationRunInspection {
  readonly trigger: FuryGatewayAutomationTriggerOccurrence;
  readonly status: FuryGatewayAutomationRunStatus;
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationClaimEvidence {
  readonly format: 'furypipe-gateway-automation-claim-evidence/v1';
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly generation: number;
  readonly claimIdSha256: string;
  readonly claimantInstanceSha256: string;
  readonly claimedAt: number;
  readonly leaseExpiresAt: number;
  readonly executionIdentitySha256: string;
  readonly authority: 'coordination-claim-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationArmedEvidence {
  readonly format: 'furypipe-gateway-automation-armed-evidence/v1';
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly generation: number;
  readonly claimIdSha256: string;
  readonly armedRecordSha256: string;
  readonly executionIdentitySha256: string;
  readonly armedAt: number;
  readonly authority: 'side-effect-may-occur';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationTerminalEvidence {
  readonly outcome: FuryGatewayAutomationTerminalOutcome;
  readonly evidenceSha256?: string;
  readonly now?: number;
}

export type FuryGatewayAutomationRunStatus =
  | {
      readonly format: typeof FURY_GATEWAY_AUTOMATION_RUN_STATUS_FORMAT;
      readonly runIdSha256: string;
      readonly triggerIdSha256: string;
      readonly executionIdentitySha256: string;
      readonly automationId: string;
      readonly state: 'pending';
      readonly authority: 'durable-run-evidence';
      readonly executionAuthority: false;
    }
  | {
      readonly format: typeof FURY_GATEWAY_AUTOMATION_RUN_STATUS_FORMAT;
      readonly runIdSha256: string;
      readonly triggerIdSha256: string;
      readonly executionIdentitySha256: string;
      readonly automationId: string;
      readonly state: 'claimed';
      readonly generation: number;
      readonly claimIdSha256: string;
      readonly claimedAt: number;
      readonly leaseExpiresAt: number;
      readonly authority: 'durable-run-evidence';
      readonly executionAuthority: false;
    }
  | {
      readonly format: typeof FURY_GATEWAY_AUTOMATION_RUN_STATUS_FORMAT;
      readonly runIdSha256: string;
      readonly triggerIdSha256: string;
      readonly executionIdentitySha256: string;
      readonly automationId: string;
      readonly state: 'claim-expired';
      readonly generation: number;
      readonly claimIdSha256: string;
      readonly leaseExpiresAt: number;
      readonly reclaimSafe: true;
      readonly authority: 'durable-run-evidence';
      readonly executionAuthority: false;
    }
  | {
      readonly format: typeof FURY_GATEWAY_AUTOMATION_RUN_STATUS_FORMAT;
      readonly runIdSha256: string;
      readonly triggerIdSha256: string;
      readonly executionIdentitySha256: string;
      readonly automationId: string;
      readonly state: 'outcome-unknown';
      readonly generation: number;
      readonly claimIdSha256: string;
      readonly armedAt: number;
      readonly automaticReplayAllowed: false;
      readonly authority: 'durable-run-evidence';
      readonly executionAuthority: false;
    }
  | {
      readonly format: typeof FURY_GATEWAY_AUTOMATION_RUN_STATUS_FORMAT;
      readonly runIdSha256: string;
      readonly triggerIdSha256: string;
      readonly executionIdentitySha256: string;
      readonly automationId: string;
      readonly state: 'terminal';
      readonly generation: number;
      readonly claimIdSha256: string;
      readonly terminalAt: number;
      readonly outcome: FuryGatewayAutomationTerminalOutcome;
      readonly evidenceSha256?: string;
      readonly automaticReplayAllowed: false;
      readonly authority: 'durable-run-evidence';
      readonly executionAuthority: false;
    };

export interface FuryGatewayAutomationRunLedgerOptions {
  readonly store: RecoveryStore;
  readonly now?: () => number;
  readonly defaultClaimLeaseMs?: number;
  readonly maxClaimLeaseMs?: number;
  readonly maxRecords?: number;
  readonly maxClaimGenerations?: number;
}

export interface FuryGatewayAutomationRunLedger {
  registerTrigger(
    input: FuryGatewayAutomationTriggerOccurrenceInput,
  ): Promise<FuryGatewayAutomationRunStatus>;
  inspect(
    runIdSha256: string,
    now?: number,
  ): Promise<FuryGatewayAutomationRunStatus | undefined>;
  inspectTrigger(
    runIdSha256: string,
  ): Promise<FuryGatewayAutomationTriggerOccurrence | undefined>;
  claim(
    runIdSha256: string,
    claimantInstanceId: string,
    leaseMs?: number,
  ): Promise<FuryGatewayAutomationClaimEvidence>;
  arm(
    claim: FuryGatewayAutomationClaimEvidence,
    now?: number,
  ): Promise<FuryGatewayAutomationArmedEvidence>;
  settleArmed(
    armed: FuryGatewayAutomationArmedEvidence,
    terminal: FuryGatewayAutomationTerminalEvidence,
  ): Promise<FuryGatewayAutomationRunStatus>;
  settleWithoutSideEffect(
    claim: FuryGatewayAutomationClaimEvidence,
    outcome: 'blocked' | 'cancelled',
    evidence?: { readonly evidenceSha256?: string; readonly now?: number },
  ): Promise<FuryGatewayAutomationRunStatus>;
  latestTrigger(
    automationId: string,
  ): Promise<FuryGatewayAutomationTriggerOccurrence | undefined>;
  listRecent(
    limit?: number,
    now?: number,
  ): Promise<readonly FuryGatewayAutomationRunInspection[]>;
  countRuns(): Promise<number>;
}

export type FuryGatewayAutomationRunLedgerErrorCode =
  | 'store-capability-missing'
  | 'invalid-input'
  | 'run-not-found'
  | 'run-conflict'
  | 'claim-not-active'
  | 'claim-expired'
  | 'stale-claim'
  | 'run-state-corrupt'
  | 'generation-limit'
  | 'limit-exceeded';

const ERROR_MESSAGES: Readonly<Record<
  FuryGatewayAutomationRunLedgerErrorCode,
  string
>> = Object.freeze({
  'store-capability-missing':
    'Automation run ledger requires RecoveryStore list and atomic putBounded capabilities.',
  'invalid-input': 'Automation run ledger input is invalid.',
  'run-not-found': 'Automation run does not exist.',
  'run-conflict': 'Automation run state already blocks this transition.',
  'claim-not-active': 'Automation run claim is not active process-local evidence.',
  'claim-expired': 'Automation run claim expired before it could be armed or settled.',
  'stale-claim': 'Automation run claim lost its fencing generation.',
  'run-state-corrupt': 'Automation run durable state is inconsistent or corrupt.',
  'generation-limit': 'Automation run claim generation limit was reached.',
  'limit-exceeded': 'Automation run durable record limit was exceeded.',
});

export class FuryGatewayAutomationRunLedgerError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: FuryGatewayAutomationRunLedgerErrorCode,
    readonly runIdSha256?: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryGatewayAutomationRunLedgerError';
  }
}

interface TriggerRecord extends FuryGatewayAutomationTriggerOccurrence {}

interface ClaimRecord {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_CLAIM_RECORD_FORMAT;
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly generation: number;
  readonly claimIdSha256: string;
  readonly claimantInstanceSha256: string;
  readonly claimedAt: number;
  readonly leaseExpiresAt: number;
  readonly executionIdentitySha256: string;
}

interface ArmedRecord {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_ARMED_RECORD_FORMAT;
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly generation: number;
  readonly claimIdSha256: string;
  readonly claimRecordSha256: string;
  readonly executionIdentitySha256: string;
  readonly armedAt: number;
}

interface TerminalRecord {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_TERMINAL_RECORD_FORMAT;
  readonly runIdSha256: string;
  readonly triggerIdSha256: string;
  readonly generation: number;
  readonly claimIdSha256: string;
  readonly claimRecordSha256: string;
  readonly armedRecordSha256?: string;
  readonly executionIdentitySha256: string;
  readonly terminalAt: number;
  readonly outcome: FuryGatewayAutomationTerminalOutcome;
  readonly evidenceSha256?: string;
}

type DurableRunRecord =
  | TriggerRecord
  | ClaimRecord
  | ArmedRecord
  | TerminalRecord;

interface LoadedRecord {
  readonly handle: RecoveryHandle;
  readonly record: DurableRunRecord;
}

interface ClaimState {
  readonly ledger: FuryGatewayAutomationRunLedger;
  readonly handle: RecoveryHandle;
  readonly record: ClaimRecord;
  readonly evidence: FuryGatewayAutomationClaimEvidence;
}

interface ArmedState {
  readonly ledger: FuryGatewayAutomationRunLedger;
  readonly handle: RecoveryHandle;
  readonly record: ArmedRecord;
  readonly claimState: ClaimState;
  readonly evidence: FuryGatewayAutomationArmedEvidence;
}

const GENERATED_LEDGERS = new WeakSet<object>();
const CLAIM_STATES = new WeakMap<object, ClaimState>();
const ARMED_STATES = new WeakMap<object, ArmedState>();
const SETTLED = new WeakSet<object>();

const SYSTEM = 'gateway-automation-run-ledger';
const SHA256_RE = /^[0-9a-f]{64}$/u;
const AUTOMATION_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const MAX_OCCURRENCE_KEY_BYTES = 512;
const MAX_CLAIMANT_ID_BYTES = 256;
const DEFAULT_CLAIM_LEASE_MS = 30_000;
const HARD_MAX_CLAIM_LEASE_MS = 5 * 60_000;
const DEFAULT_MAX_RECORDS = 10_000;
const HARD_MAX_RECORDS = 10_000;
const DEFAULT_MAX_CLAIM_GENERATIONS = 16;
const HARD_MAX_CLAIM_GENERATIONS = 128;
const MAX_RUN_RECORDS = 1 + HARD_MAX_CLAIM_GENERATIONS * 3;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digestParts(parts: readonly (string | number)[]): string {
  return sha256(JSON.stringify(parts));
}

function exactDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayAutomationRunLedgerError('invalid-input');
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
      throw new FuryGatewayAutomationRunLedgerError('invalid-input');
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayAutomationRunLedgerError('invalid-input');
    }
  }
  return record;
}

function safeTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FuryGatewayAutomationRunLedgerError('invalid-input');
  }
  return value as number;
}

function nowValue(now: () => number): number {
  return safeTimestamp(now());
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
    throw new RangeError(label + ' must be an integer from ' + min + ' to ' + max);
  }
  return resolved;
}

function boundedText(value: unknown, maxBytes: number): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value !== value.trim()
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayAutomationRunLedgerError('invalid-input');
  }
  return value;
}

function assertSha(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new FuryGatewayAutomationRunLedgerError('invalid-input');
  }
}

function automationId(value: unknown): string {
  if (typeof value !== 'string' || !AUTOMATION_ID_RE.test(value)) {
    throw new FuryGatewayAutomationRunLedgerError('invalid-input');
  }
  return value;
}

function sourceKind(value: unknown): FuryGatewayAutomationTriggerSourceKind {
  if (
    typeof value !== 'string'
    || !(FURY_GATEWAY_AUTOMATION_TRIGGER_SOURCE_KINDS as readonly string[])
      .includes(value)
  ) {
    throw new FuryGatewayAutomationRunLedgerError('invalid-input');
  }
  return value as FuryGatewayAutomationTriggerSourceKind;
}

function terminalOutcome(value: unknown): FuryGatewayAutomationTerminalOutcome {
  if (
    typeof value !== 'string'
    || !(FURY_GATEWAY_AUTOMATION_TERMINAL_OUTCOMES as readonly string[])
      .includes(value)
  ) {
    throw new FuryGatewayAutomationRunLedgerError('invalid-input');
  }
  return value as FuryGatewayAutomationTerminalOutcome;
}

function canonicalBytes(value: DurableRunRecord): Uint8Array {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > 32 * 1024) {
    throw new FuryGatewayAutomationRunLedgerError('limit-exceeded');
  }
  return new TextEncoder().encode(encoded);
}

function recordType(
  record: DurableRunRecord,
): 'trigger' | 'claim' | 'armed' | 'terminal' {
  if (record.format === FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT) return 'trigger';
  if (record.format === FURY_GATEWAY_AUTOMATION_CLAIM_RECORD_FORMAT) return 'claim';
  if (record.format === FURY_GATEWAY_AUTOMATION_ARMED_RECORD_FORMAT) return 'armed';
  return 'terminal';
}

function recordMetadata(record: DurableRunRecord): RecoveryMetadata {
  const type = recordType(record);
  return Object.freeze({
    system: SYSTEM,
    recordType: type,
    runIdSha256: record.runIdSha256,
    triggerIdSha256: record.triggerIdSha256,
    ...(type === 'trigger'
      ? { automationId: (record as TriggerRecord).automationId }
      : {
          generation: (record as ClaimRecord | ArmedRecord | TerminalRecord).generation,
          claimIdSha256:
            (record as ClaimRecord | ArmedRecord | TerminalRecord).claimIdSha256,
        }),
  });
}

function slotMetadata(
  runIdSha256: string,
  type: 'trigger' | 'claim' | 'armed' | 'terminal',
  generation?: number,
): Readonly<Record<string, string | number | boolean | null>> {
  return Object.freeze({
    system: SYSTEM,
    recordType: type,
    runIdSha256,
    ...(generation === undefined ? {} : { generation }),
  });
}

function exactRecordMetadata(
  record: DurableRunRecord,
): Readonly<Record<string, string | number | boolean | null>> {
  return recordMetadata(record) as
    Readonly<Record<string, string | number | boolean | null>>;
}

function requiredStore(
  store: RecoveryStore,
): RecoveryStore & Required<Pick<RecoveryStore, 'list' | 'putBounded'>> {
  if (
    !store
    || typeof store !== 'object'
    || typeof store.get !== 'function'
    || typeof store.list !== 'function'
    || typeof store.putBounded !== 'function'
  ) {
    throw new FuryGatewayAutomationRunLedgerError('store-capability-missing');
  }
  return store as RecoveryStore &
    Required<Pick<RecoveryStore, 'list' | 'putBounded'>>;
}

function parseRecord(bytes: Uint8Array): DurableRunRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new FuryGatewayAutomationRunLedgerError('run-state-corrupt');
  }

  try {
    const record = exactDataRecord(
      parsed,
      [
        'format',
        'automationId',
        'definitionRevision',
        'definitionSha256',
        'sourceKind',
        'occurrenceKeySha256',
        'triggerIdSha256',
        'runIdSha256',
        'executionIdentitySha256',
        'scheduledFor',
        'createdAt',
        'authority',
        'executionAuthority',
        'generation',
        'claimIdSha256',
        'claimantInstanceSha256',
        'claimedAt',
        'leaseExpiresAt',
        'claimRecordSha256',
        'armedRecordSha256',
        'armedAt',
        'terminalAt',
        'outcome',
        'evidenceSha256',
      ],
      ['format', 'runIdSha256', 'triggerIdSha256', 'executionIdentitySha256'],
    );
    assertSha(record.runIdSha256);
    assertSha(record.triggerIdSha256);
    assertSha(record.executionIdentitySha256);

    if (record.format === FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT) {
      const required = exactDataRecord(
        parsed,
        [
          'format',
          'automationId',
          'definitionRevision',
          'definitionSha256',
          'sourceKind',
          'occurrenceKeySha256',
          'triggerIdSha256',
          'runIdSha256',
          'executionIdentitySha256',
          'scheduledFor',
          'createdAt',
          'authority',
          'executionAuthority',
        ],
        [
          'format',
          'automationId',
          'definitionRevision',
          'definitionSha256',
          'sourceKind',
          'occurrenceKeySha256',
          'triggerIdSha256',
          'runIdSha256',
          'executionIdentitySha256',
          'scheduledFor',
          'createdAt',
          'authority',
          'executionAuthority',
        ],
      );
      const id = automationId(required.automationId);
      if (
        !Number.isSafeInteger(required.definitionRevision)
        || (required.definitionRevision as number) < 1
        || required.authority !== 'durable-trigger-evidence'
        || required.executionAuthority !== false
      ) {
        throw new Error('invalid trigger');
      }
      assertSha(required.definitionSha256);
      assertSha(required.occurrenceKeySha256);
      const kind = sourceKind(required.sourceKind);
      const scheduledFor = safeTimestamp(required.scheduledFor);
      const createdAt = safeTimestamp(required.createdAt);
      const normalized: TriggerRecord = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT,
        automationId: id,
        definitionRevision: required.definitionRevision as number,
        definitionSha256: required.definitionSha256,
        sourceKind: kind,
        occurrenceKeySha256: required.occurrenceKeySha256,
        triggerIdSha256: required.triggerIdSha256 as string,
        runIdSha256: required.runIdSha256 as string,
        executionIdentitySha256: required.executionIdentitySha256 as string,
        scheduledFor,
        createdAt,
        authority: 'durable-trigger-evidence' as const,
        executionAuthority: false as const,
      });
      if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
        throw new Error('non canonical trigger');
      }
      return normalized;
    }

    if (
      !Number.isSafeInteger(record.generation)
      || (record.generation as number) < 1
      || typeof record.claimIdSha256 !== 'string'
    ) {
      throw new Error('invalid generation');
    }
    assertSha(record.claimIdSha256);
    const generation = record.generation as number;

    if (record.format === FURY_GATEWAY_AUTOMATION_CLAIM_RECORD_FORMAT) {
      const required = exactDataRecord(
        parsed,
        [
          'format',
          'runIdSha256',
          'triggerIdSha256',
          'generation',
          'claimIdSha256',
          'claimantInstanceSha256',
          'claimedAt',
          'leaseExpiresAt',
          'executionIdentitySha256',
        ],
        [
          'format',
          'runIdSha256',
          'triggerIdSha256',
          'generation',
          'claimIdSha256',
          'claimantInstanceSha256',
          'claimedAt',
          'leaseExpiresAt',
          'executionIdentitySha256',
        ],
      );
      assertSha(required.claimantInstanceSha256);
      const claimedAt = safeTimestamp(required.claimedAt);
      const leaseExpiresAt = safeTimestamp(required.leaseExpiresAt);
      if (leaseExpiresAt <= claimedAt) throw new Error('invalid claim lease');
      const normalized: ClaimRecord = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_CLAIM_RECORD_FORMAT,
        runIdSha256: required.runIdSha256 as string,
        triggerIdSha256: required.triggerIdSha256 as string,
        generation,
        claimIdSha256: required.claimIdSha256 as string,
        claimantInstanceSha256: required.claimantInstanceSha256,
        claimedAt,
        leaseExpiresAt,
        executionIdentitySha256: required.executionIdentitySha256 as string,
      });
      if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
        throw new Error('non canonical claim');
      }
      return normalized;
    }

    if (record.format === FURY_GATEWAY_AUTOMATION_ARMED_RECORD_FORMAT) {
      const required = exactDataRecord(
        parsed,
        [
          'format',
          'runIdSha256',
          'triggerIdSha256',
          'generation',
          'claimIdSha256',
          'claimRecordSha256',
          'executionIdentitySha256',
          'armedAt',
        ],
        [
          'format',
          'runIdSha256',
          'triggerIdSha256',
          'generation',
          'claimIdSha256',
          'claimRecordSha256',
          'executionIdentitySha256',
          'armedAt',
        ],
      );
      assertSha(required.claimRecordSha256);
      const normalized: ArmedRecord = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_ARMED_RECORD_FORMAT,
        runIdSha256: required.runIdSha256 as string,
        triggerIdSha256: required.triggerIdSha256 as string,
        generation,
        claimIdSha256: required.claimIdSha256 as string,
        claimRecordSha256: required.claimRecordSha256,
        executionIdentitySha256: required.executionIdentitySha256 as string,
        armedAt: safeTimestamp(required.armedAt),
      });
      if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
        throw new Error('non canonical armed record');
      }
      return normalized;
    }

    if (record.format === FURY_GATEWAY_AUTOMATION_TERMINAL_RECORD_FORMAT) {
      const required = exactDataRecord(
        parsed,
        [
          'format',
          'runIdSha256',
          'triggerIdSha256',
          'generation',
          'claimIdSha256',
          'claimRecordSha256',
          'armedRecordSha256',
          'executionIdentitySha256',
          'terminalAt',
          'outcome',
          'evidenceSha256',
        ],
        [
          'format',
          'runIdSha256',
          'triggerIdSha256',
          'generation',
          'claimIdSha256',
          'claimRecordSha256',
          'executionIdentitySha256',
          'terminalAt',
          'outcome',
        ],
      );
      assertSha(required.claimRecordSha256);
      if (required.armedRecordSha256 !== undefined) {
        assertSha(required.armedRecordSha256);
      }
      if (required.evidenceSha256 !== undefined) {
        assertSha(required.evidenceSha256);
      }
      const outcome = terminalOutcome(required.outcome);
      if (
        (outcome === 'succeeded' || outcome === 'failed' || outcome === 'outcome-unknown')
        !== (required.armedRecordSha256 !== undefined)
      ) {
        throw new Error('terminal armed classification mismatch');
      }
      if (
        (outcome === 'succeeded' || outcome === 'failed')
        && required.evidenceSha256 === undefined
      ) {
        throw new Error('known side-effect outcome requires evidence');
      }
      if (
        outcome === 'outcome-unknown'
        && required.evidenceSha256 !== undefined
      ) {
        throw new Error('unknown outcome must not claim evidence');
      }
      const normalized: TerminalRecord = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_TERMINAL_RECORD_FORMAT,
        runIdSha256: required.runIdSha256 as string,
        triggerIdSha256: required.triggerIdSha256 as string,
        generation,
        claimIdSha256: required.claimIdSha256 as string,
        claimRecordSha256: required.claimRecordSha256,
        ...(required.armedRecordSha256 === undefined
          ? {}
          : { armedRecordSha256: required.armedRecordSha256 }),
        executionIdentitySha256: required.executionIdentitySha256 as string,
        terminalAt: safeTimestamp(required.terminalAt),
        outcome,
        ...(required.evidenceSha256 === undefined
          ? {}
          : { evidenceSha256: required.evidenceSha256 }),
      });
      if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
        throw new Error('non canonical terminal record');
      }
      return normalized;
    }

    throw new Error('unknown record format');
  } catch (error) {
    if (
      error instanceof FuryGatewayAutomationRunLedgerError
      && error.code === 'run-state-corrupt'
    ) {
      throw error;
    }
    throw new FuryGatewayAutomationRunLedgerError('run-state-corrupt');
  }
}

async function loadedRun(
  store: RecoveryStore & Required<Pick<RecoveryStore, 'list'>>,
  runIdSha256: string,
): Promise<readonly LoadedRecord[]> {
  assertSha(runIdSha256);
  const handles = await store.list({
    metadata: {
      system: SYSTEM,
      runIdSha256,
    },
    limit: MAX_RUN_RECORDS,
  });
  if (handles.length >= MAX_RUN_RECORDS) {
    throw new FuryGatewayAutomationRunLedgerError(
      'run-state-corrupt',
      runIdSha256,
    );
  }

  const loaded: LoadedRecord[] = [];
  for (const handle of handles) {
    const record = parseRecord(await store.get(handle));
    if (
      record.runIdSha256 !== runIdSha256
      || handle.metadata?.system !== SYSTEM
      || handle.metadata?.runIdSha256 !== runIdSha256
      || handle.metadata?.recordType !== recordType(record)
      || handle.metadata?.triggerIdSha256 !== record.triggerIdSha256
      || (
        recordType(record) === 'trigger'
        && handle.metadata?.automationId !== (record as TriggerRecord).automationId
      )
      || (
        recordType(record) !== 'trigger'
        && (
          handle.metadata?.generation
            !== (record as ClaimRecord | ArmedRecord | TerminalRecord).generation
          || handle.metadata?.claimIdSha256
            !== (record as ClaimRecord | ArmedRecord | TerminalRecord).claimIdSha256
        )
      )
    ) {
      throw new FuryGatewayAutomationRunLedgerError(
        'run-state-corrupt',
        runIdSha256,
      );
    }
    loaded.push(Object.freeze({ handle, record }));
  }
  return Object.freeze(loaded);
}

interface ClassifiedRun {
  readonly trigger: LoadedRecord & { readonly record: TriggerRecord };
  readonly claims: readonly (LoadedRecord & { readonly record: ClaimRecord })[];
  readonly armedByGeneration: ReadonlyMap<
    number,
    LoadedRecord & { readonly record: ArmedRecord }
  >;
  readonly terminalByGeneration: ReadonlyMap<
    number,
    LoadedRecord & { readonly record: TerminalRecord }
  >;
}

function classifyLoaded(
  records: readonly LoadedRecord[],
  runIdSha256: string,
): ClassifiedRun {
  const triggers = records.filter(
    (entry): entry is LoadedRecord & { readonly record: TriggerRecord } =>
      entry.record.format === FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT,
  );
  if (triggers.length !== 1) {
    throw new FuryGatewayAutomationRunLedgerError(
      'run-state-corrupt',
      runIdSha256,
    );
  }
  const trigger = triggers[0]!;
  if (
    trigger.record.runIdSha256 !==
      digestParts(['run', trigger.record.triggerIdSha256])
    || trigger.record.executionIdentitySha256 !==
      digestParts(['execution', trigger.record.runIdSha256])
  ) {
    throw new FuryGatewayAutomationRunLedgerError(
      'run-state-corrupt',
      runIdSha256,
    );
  }

  const claims = records
    .filter(
      (entry): entry is LoadedRecord & { readonly record: ClaimRecord } =>
        entry.record.format === FURY_GATEWAY_AUTOMATION_CLAIM_RECORD_FORMAT,
    )
    .sort((left, right) => left.record.generation - right.record.generation);
  const armedByGeneration = new Map<
    number,
    LoadedRecord & { readonly record: ArmedRecord }
  >();
  const terminalByGeneration = new Map<
    number,
    LoadedRecord & { readonly record: TerminalRecord }
  >();

  for (const entry of records) {
    if (entry.record.format === FURY_GATEWAY_AUTOMATION_ARMED_RECORD_FORMAT) {
      if (armedByGeneration.has(entry.record.generation)) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-state-corrupt',
          runIdSha256,
        );
      }
      armedByGeneration.set(entry.record.generation, entry as
        LoadedRecord & { readonly record: ArmedRecord });
    }
    if (entry.record.format === FURY_GATEWAY_AUTOMATION_TERMINAL_RECORD_FORMAT) {
      if (terminalByGeneration.has(entry.record.generation)) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-state-corrupt',
          runIdSha256,
        );
      }
      terminalByGeneration.set(entry.record.generation, entry as
        LoadedRecord & { readonly record: TerminalRecord });
    }
  }

  for (let index = 0; index < claims.length; index += 1) {
    const claim = claims[index]!;
    const expectedGeneration = index + 1;
    if (
      claim.record.generation !== expectedGeneration
      || claim.record.triggerIdSha256 !== trigger.record.triggerIdSha256
      || claim.record.executionIdentitySha256
        !== trigger.record.executionIdentitySha256
    ) {
      throw new FuryGatewayAutomationRunLedgerError(
        'run-state-corrupt',
        runIdSha256,
      );
    }

    const armed = armedByGeneration.get(expectedGeneration);
    const terminal = terminalByGeneration.get(expectedGeneration);
    if (armed) {
      if (
        armed.record.claimIdSha256 !== claim.record.claimIdSha256
        || armed.record.claimRecordSha256 !== claim.handle.digest
        || armed.record.triggerIdSha256 !== trigger.record.triggerIdSha256
        || armed.record.executionIdentitySha256
          !== trigger.record.executionIdentitySha256
        || armed.record.armedAt < claim.record.claimedAt
        || armed.record.armedAt >= claim.record.leaseExpiresAt
      ) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-state-corrupt',
          runIdSha256,
        );
      }
    }
    if (terminal) {
      if (
        terminal.record.claimIdSha256 !== claim.record.claimIdSha256
        || terminal.record.claimRecordSha256 !== claim.handle.digest
        || terminal.record.triggerIdSha256 !== trigger.record.triggerIdSha256
        || terminal.record.executionIdentitySha256
          !== trigger.record.executionIdentitySha256
      ) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-state-corrupt',
          runIdSha256,
        );
      }
      if (terminal.record.armedRecordSha256 !== undefined) {
        if (
          !armed
          || terminal.record.armedRecordSha256 !== armed.handle.digest
          || terminal.record.terminalAt < armed.record.armedAt
        ) {
          throw new FuryGatewayAutomationRunLedgerError(
            'run-state-corrupt',
            runIdSha256,
          );
        }
      } else if (
        armed
        || terminal.record.terminalAt < claim.record.claimedAt
      ) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-state-corrupt',
          runIdSha256,
        );
      }
    }

    if (index < claims.length - 1) {
      const next = claims[index + 1]!;
      if (
        armed
        || terminal
        || next.record.claimedAt < claim.record.leaseExpiresAt
      ) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-state-corrupt',
          runIdSha256,
        );
      }
    }
  }

  for (const generation of armedByGeneration.keys()) {
    if (!claims.some((entry) => entry.record.generation === generation)) {
      throw new FuryGatewayAutomationRunLedgerError(
        'run-state-corrupt',
        runIdSha256,
      );
    }
  }
  for (const generation of terminalByGeneration.keys()) {
    if (!claims.some((entry) => entry.record.generation === generation)) {
      throw new FuryGatewayAutomationRunLedgerError(
        'run-state-corrupt',
        runIdSha256,
      );
    }
  }

  return Object.freeze({
    trigger,
    claims: Object.freeze(claims),
    armedByGeneration,
    terminalByGeneration,
  });
}

function statusFromClassified(
  classified: ClassifiedRun,
  now: number,
): FuryGatewayAutomationRunStatus {
  const { trigger, claims, armedByGeneration, terminalByGeneration } = classified;
  const base = {
    format: FURY_GATEWAY_AUTOMATION_RUN_STATUS_FORMAT,
    runIdSha256: trigger.record.runIdSha256,
    triggerIdSha256: trigger.record.triggerIdSha256,
    executionIdentitySha256: trigger.record.executionIdentitySha256,
    automationId: trigger.record.automationId,
    authority: 'durable-run-evidence' as const,
    executionAuthority: false as const,
  };

  const latest = claims[claims.length - 1];
  if (!latest) {
    return Object.freeze({
      ...base,
      state: 'pending' as const,
    });
  }

  const generation = latest.record.generation;
  const terminal = terminalByGeneration.get(generation);
  if (terminal) {
    return Object.freeze({
      ...base,
      state: 'terminal' as const,
      generation,
      claimIdSha256: latest.record.claimIdSha256,
      terminalAt: terminal.record.terminalAt,
      outcome: terminal.record.outcome,
      ...(terminal.record.evidenceSha256 === undefined
        ? {}
        : { evidenceSha256: terminal.record.evidenceSha256 }),
      automaticReplayAllowed: false as const,
    });
  }

  const armed = armedByGeneration.get(generation);
  if (armed) {
    return Object.freeze({
      ...base,
      state: 'outcome-unknown' as const,
      generation,
      claimIdSha256: latest.record.claimIdSha256,
      armedAt: armed.record.armedAt,
      automaticReplayAllowed: false as const,
    });
  }

  if (now >= latest.record.leaseExpiresAt) {
    return Object.freeze({
      ...base,
      state: 'claim-expired' as const,
      generation,
      claimIdSha256: latest.record.claimIdSha256,
      leaseExpiresAt: latest.record.leaseExpiresAt,
      reclaimSafe: true as const,
    });
  }

  return Object.freeze({
    ...base,
    state: 'claimed' as const,
    generation,
    claimIdSha256: latest.record.claimIdSha256,
    claimedAt: latest.record.claimedAt,
    leaseExpiresAt: latest.record.leaseExpiresAt,
  });
}

export function isGeneratedFuryGatewayAutomationRunLedger(
  value: unknown,
): value is FuryGatewayAutomationRunLedger {
  return typeof value === 'object'
    && value !== null
    && GENERATED_LEDGERS.has(value);
}

export function isGeneratedFuryGatewayAutomationClaimEvidence(
  value: unknown,
): value is FuryGatewayAutomationClaimEvidence {
  return typeof value === 'object'
    && value !== null
    && CLAIM_STATES.has(value);
}

export function createFuryGatewayAutomationRunLedger(
  options: FuryGatewayAutomationRunLedgerOptions,
): FuryGatewayAutomationRunLedger {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new FuryGatewayAutomationRunLedgerError('invalid-input');
  }
  const store = requiredStore(options.store);
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayAutomationRunLedgerError('invalid-input');
  }
  nowValue(now);
  const defaultClaimLeaseMs = boundedInteger(
    options.defaultClaimLeaseMs,
    DEFAULT_CLAIM_LEASE_MS,
    1,
    HARD_MAX_CLAIM_LEASE_MS,
    'defaultClaimLeaseMs',
  );
  const maxClaimLeaseMs = boundedInteger(
    options.maxClaimLeaseMs,
    HARD_MAX_CLAIM_LEASE_MS,
    defaultClaimLeaseMs,
    HARD_MAX_CLAIM_LEASE_MS,
    'maxClaimLeaseMs',
  );
  const maxRecords = boundedInteger(
    options.maxRecords,
    DEFAULT_MAX_RECORDS,
    1,
    HARD_MAX_RECORDS,
    'maxRecords',
  );
  const maxClaimGenerations = boundedInteger(
    options.maxClaimGenerations,
    DEFAULT_MAX_CLAIM_GENERATIONS,
    1,
    HARD_MAX_CLAIM_GENERATIONS,
    'maxClaimGenerations',
  );

  let api: FuryGatewayAutomationRunLedger;

  const loadStatus = async (
    runIdSha256: string,
    at: number,
  ): Promise<{
    readonly records: readonly LoadedRecord[];
    readonly classified?: ClassifiedRun;
    readonly status?: FuryGatewayAutomationRunStatus;
  }> => {
    assertSha(runIdSha256);
    const records = await loadedRun(store, runIdSha256);
    if (records.length === 0) return Object.freeze({ records });
    const classified = classifyLoaded(records, runIdSha256);
    return Object.freeze({
      records,
      classified,
      status: statusFromClassified(classified, at),
    });
  };

  api = Object.freeze({
    async registerTrigger(
      input: FuryGatewayAutomationTriggerOccurrenceInput,
    ): Promise<FuryGatewayAutomationRunStatus> {
      exactDataRecord(
        input,
        [
          'automationId',
          'definitionRevision',
          'definitionSha256',
          'sourceKind',
          'occurrenceKey',
          'scheduledFor',
        ],
        [
          'automationId',
          'definitionRevision',
          'definitionSha256',
          'sourceKind',
          'occurrenceKey',
          'scheduledFor',
        ],
      );
      const id = automationId(input.automationId);
      if (
        !Number.isSafeInteger(input.definitionRevision)
        || input.definitionRevision < 1
      ) {
        throw new FuryGatewayAutomationRunLedgerError('invalid-input');
      }
      assertSha(input.definitionSha256);
      const kind = sourceKind(input.sourceKind);
      const occurrenceKey = boundedText(
        input.occurrenceKey,
        MAX_OCCURRENCE_KEY_BYTES,
      );
      const scheduledFor = safeTimestamp(input.scheduledFor);
      const occurrenceKeySha256 = sha256(occurrenceKey);
      const triggerIdSha256 = digestParts([
        'trigger',
        id,
        kind,
        occurrenceKeySha256,
      ]);
      const runIdSha256 = digestParts(['run', triggerIdSha256]);
      const executionIdentitySha256 = digestParts(['execution', runIdSha256]);
      const record: TriggerRecord = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT,
        automationId: id,
        definitionRevision: input.definitionRevision,
        definitionSha256: input.definitionSha256,
        sourceKind: kind,
        occurrenceKeySha256,
        triggerIdSha256,
        runIdSha256,
        executionIdentitySha256,
        scheduledFor,
        createdAt: nowValue(now),
        authority: 'durable-trigger-evidence' as const,
        executionAuthority: false as const,
      });

      const existing = await loadStatus(runIdSha256, nowValue(now));
      if (existing.status && existing.classified) {
        const durableTrigger = existing.classified.trigger.record;
        if (
          durableTrigger.scheduledFor !== scheduledFor
          || durableTrigger.automationId !== id
          || durableTrigger.sourceKind !== kind
          || durableTrigger.occurrenceKeySha256 !== occurrenceKeySha256
        ) {
          throw new FuryGatewayAutomationRunLedgerError(
            'run-conflict',
            runIdSha256,
          );
        }
        return existing.status;
      }

      try {
        await store.putBounded(
          canonicalBytes(record),
          recordMetadata(record),
          {
            metadata: { system: SYSTEM },
            maxMatches: maxRecords,
            additionalBounds: [{
              metadata: slotMetadata(runIdSha256, 'trigger'),
              maxMatches: 1,
            }],
          },
        );
      } catch (error) {
        const raced = await loadStatus(runIdSha256, nowValue(now));
        if (raced.status) return raced.status;
        throw new FuryGatewayAutomationRunLedgerError(
          'limit-exceeded',
          runIdSha256,
        );
      }
      const registered = await loadStatus(runIdSha256, nowValue(now));
      if (!registered.status) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-state-corrupt',
          runIdSha256,
        );
      }
      return registered.status;
    },

    async inspect(
      runIdSha256: string,
      atInput?: number,
    ): Promise<FuryGatewayAutomationRunStatus | undefined> {
      const at = atInput === undefined ? nowValue(now) : safeTimestamp(atInput);
      return (await loadStatus(runIdSha256, at)).status;
    },

    async inspectTrigger(
      runIdSha256: string,
    ): Promise<FuryGatewayAutomationTriggerOccurrence | undefined> {
      assertSha(runIdSha256);
      const records = await loadedRun(store, runIdSha256);
      if (records.length === 0) return undefined;
      return classifyLoaded(records, runIdSha256).trigger.record;
    },

    async claim(
      runIdSha256: string,
      claimantInstanceId: string,
      leaseMsInput?: number,
    ): Promise<FuryGatewayAutomationClaimEvidence> {
      assertSha(runIdSha256);
      const claimant = boundedText(
        claimantInstanceId,
        MAX_CLAIMANT_ID_BYTES,
      );
      const at = nowValue(now);
      const loaded = await loadStatus(runIdSha256, at);
      if (!loaded.classified || !loaded.status) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-not-found',
          runIdSha256,
        );
      }

      let generation: number;
      if (loaded.status.state === 'pending') {
        generation = 1;
      } else if (loaded.status.state === 'claim-expired') {
        generation = loaded.status.generation + 1;
      } else {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-conflict',
          runIdSha256,
        );
      }
      if (generation > maxClaimGenerations) {
        throw new FuryGatewayAutomationRunLedgerError(
          'generation-limit',
          runIdSha256,
        );
      }

      const leaseMs = boundedInteger(
        leaseMsInput,
        defaultClaimLeaseMs,
        1,
        maxClaimLeaseMs,
        'claim lease',
      );
      const leaseExpiresAt = at + leaseMs;
      if (!Number.isSafeInteger(leaseExpiresAt)) {
        throw new FuryGatewayAutomationRunLedgerError('invalid-input');
      }
      const claimIdSha256 = sha256(randomBytes(32).toString('hex'));
      const claimantInstanceSha256 = sha256(claimant);
      const trigger = loaded.classified.trigger.record;
      const record: ClaimRecord = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_CLAIM_RECORD_FORMAT,
        runIdSha256,
        triggerIdSha256: trigger.triggerIdSha256,
        generation,
        claimIdSha256,
        claimantInstanceSha256,
        claimedAt: at,
        leaseExpiresAt,
        executionIdentitySha256: trigger.executionIdentitySha256,
      });

      const matchConstraints: Array<{
        readonly metadata: Readonly<Record<
          string,
          string | number | boolean | null
        >>;
        readonly minMatches?: number;
        readonly maxMatches?: number;
      }> = [{
        metadata: slotMetadata(runIdSha256, 'trigger'),
        minMatches: 1,
        maxMatches: 1,
      }];

      if (generation > 1) {
        const previous = loaded.classified.claims[generation - 2];
        if (
          !previous
          || at < previous.record.leaseExpiresAt
          || loaded.classified.armedByGeneration.has(generation - 1)
          || loaded.classified.terminalByGeneration.has(generation - 1)
        ) {
          throw new FuryGatewayAutomationRunLedgerError(
            'run-conflict',
            runIdSha256,
          );
        }
        matchConstraints.push(
          {
            metadata: exactRecordMetadata(previous.record),
            minMatches: 1,
            maxMatches: 1,
          },
          {
            metadata: slotMetadata(runIdSha256, 'armed', generation - 1),
            maxMatches: 0,
          },
          {
            metadata: slotMetadata(runIdSha256, 'terminal', generation - 1),
            maxMatches: 0,
          },
        );
      }

      let handle: RecoveryHandle;
      try {
        handle = await store.putBounded(
          canonicalBytes(record),
          recordMetadata(record),
          {
            metadata: { system: SYSTEM },
            maxMatches: maxRecords,
            additionalBounds: [{
              metadata: slotMetadata(runIdSha256, 'claim', generation),
              maxMatches: 1,
            }],
            matchConstraints,
          },
        );
      } catch {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-conflict',
          runIdSha256,
        );
      }

      const evidence = Object.freeze({
        format: 'furypipe-gateway-automation-claim-evidence/v1' as const,
        runIdSha256,
        triggerIdSha256: trigger.triggerIdSha256,
        generation,
        claimIdSha256,
        claimantInstanceSha256,
        claimedAt: at,
        leaseExpiresAt,
        executionIdentitySha256: trigger.executionIdentitySha256,
        authority: 'coordination-claim-only' as const,
        executionAuthority: false as const,
      });
      CLAIM_STATES.set(
        evidence,
        Object.freeze({ ledger: api, handle, record, evidence }),
      );
      return evidence;
    },

    async arm(
      claim: FuryGatewayAutomationClaimEvidence,
      atInput?: number,
    ): Promise<FuryGatewayAutomationArmedEvidence> {
      const claimState = CLAIM_STATES.get(claim as object);
      if (!claimState || claimState.ledger !== api) {
        throw new FuryGatewayAutomationRunLedgerError(
          'claim-not-active',
          claim?.runIdSha256,
        );
      }
      const at = atInput === undefined ? nowValue(now) : safeTimestamp(atInput);
      if (at >= claimState.record.leaseExpiresAt) {
        throw new FuryGatewayAutomationRunLedgerError(
          'claim-expired',
          claim.runIdSha256,
        );
      }
      const nextGeneration = claim.generation + 1;
      const record: ArmedRecord = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_ARMED_RECORD_FORMAT,
        runIdSha256: claim.runIdSha256,
        triggerIdSha256: claim.triggerIdSha256,
        generation: claim.generation,
        claimIdSha256: claim.claimIdSha256,
        claimRecordSha256: claimState.handle.digest,
        executionIdentitySha256: claim.executionIdentitySha256,
        armedAt: at,
      });

      let handle: RecoveryHandle;
      try {
        handle = await store.putBounded(
          canonicalBytes(record),
          recordMetadata(record),
          {
            metadata: { system: SYSTEM },
            maxMatches: maxRecords,
            additionalBounds: [{
              metadata: slotMetadata(
                claim.runIdSha256,
                'armed',
                claim.generation,
              ),
              maxMatches: 1,
            }],
            matchConstraints: [
              {
                metadata: exactRecordMetadata(claimState.record),
                minMatches: 1,
                maxMatches: 1,
              },
              {
                metadata: slotMetadata(
                  claim.runIdSha256,
                  'terminal',
                  claim.generation,
                ),
                maxMatches: 0,
              },
              {
                metadata: slotMetadata(
                  claim.runIdSha256,
                  'claim',
                  nextGeneration,
                ),
                maxMatches: 0,
              },
            ],
          },
        );
      } catch {
        throw new FuryGatewayAutomationRunLedgerError(
          'stale-claim',
          claim.runIdSha256,
        );
      }

      const evidence = Object.freeze({
        format: 'furypipe-gateway-automation-armed-evidence/v1' as const,
        runIdSha256: claim.runIdSha256,
        triggerIdSha256: claim.triggerIdSha256,
        generation: claim.generation,
        claimIdSha256: claim.claimIdSha256,
        armedRecordSha256: handle.digest,
        executionIdentitySha256: claim.executionIdentitySha256,
        armedAt: at,
        authority: 'side-effect-may-occur' as const,
        executionAuthority: false as const,
      });
      const armedState = Object.freeze({
        ledger: api,
        handle,
        record,
        claimState,
        evidence,
      });
      ARMED_STATES.set(evidence, armedState);
      return evidence;
    },

    async settleArmed(
      armed: FuryGatewayAutomationArmedEvidence,
      terminalInput: FuryGatewayAutomationTerminalEvidence,
    ): Promise<FuryGatewayAutomationRunStatus> {
      const armedState = ARMED_STATES.get(armed as object);
      if (
        !armedState
        || armedState.ledger !== api
        || SETTLED.has(armed as object)
      ) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-conflict',
          armed?.runIdSha256,
        );
      }
      exactDataRecord(
        terminalInput,
        ['outcome', 'evidenceSha256', 'now'],
        ['outcome'],
      );
      const outcome = terminalOutcome(terminalInput.outcome);
      if (outcome === 'blocked' || outcome === 'cancelled') {
        throw new FuryGatewayAutomationRunLedgerError('invalid-input');
      }
      if (terminalInput.evidenceSha256 !== undefined) {
        assertSha(terminalInput.evidenceSha256);
      }
      if (
        (outcome === 'succeeded' || outcome === 'failed')
        && terminalInput.evidenceSha256 === undefined
      ) {
        throw new FuryGatewayAutomationRunLedgerError('invalid-input');
      }
      if (
        outcome === 'outcome-unknown'
        && terminalInput.evidenceSha256 !== undefined
      ) {
        throw new FuryGatewayAutomationRunLedgerError('invalid-input');
      }
      const at = terminalInput.now === undefined
        ? nowValue(now)
        : safeTimestamp(terminalInput.now);
      if (at < armedState.record.armedAt) {
        throw new FuryGatewayAutomationRunLedgerError('invalid-input');
      }
      const claim = armedState.claimState;
      const record: TerminalRecord = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_TERMINAL_RECORD_FORMAT,
        runIdSha256: armed.runIdSha256,
        triggerIdSha256: armed.triggerIdSha256,
        generation: armed.generation,
        claimIdSha256: armed.claimIdSha256,
        claimRecordSha256: claim.handle.digest,
        armedRecordSha256: armedState.handle.digest,
        executionIdentitySha256: armed.executionIdentitySha256,
        terminalAt: at,
        outcome,
        ...(terminalInput.evidenceSha256 === undefined
          ? {}
          : { evidenceSha256: terminalInput.evidenceSha256 }),
      });
      try {
        await store.putBounded(
          canonicalBytes(record),
          recordMetadata(record),
          {
            metadata: { system: SYSTEM },
            maxMatches: maxRecords,
            additionalBounds: [{
              metadata: slotMetadata(
                armed.runIdSha256,
                'terminal',
                armed.generation,
              ),
              maxMatches: 1,
            }],
            matchConstraints: [
              {
                metadata: exactRecordMetadata(armedState.record),
                minMatches: 1,
                maxMatches: 1,
              },
              {
                metadata: slotMetadata(
                  armed.runIdSha256,
                  'claim',
                  armed.generation + 1,
                ),
                maxMatches: 0,
              },
            ],
          },
        );
      } catch {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-conflict',
          armed.runIdSha256,
        );
      }
      SETTLED.add(armed as object);
      const status = await api.inspect(armed.runIdSha256, at);
      if (!status) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-state-corrupt',
          armed.runIdSha256,
        );
      }
      return status;
    },

    async settleWithoutSideEffect(
      claim: FuryGatewayAutomationClaimEvidence,
      outcome: 'blocked' | 'cancelled',
      evidence: {
        readonly evidenceSha256?: string;
        readonly now?: number;
      } = {},
    ): Promise<FuryGatewayAutomationRunStatus> {
      const claimState = CLAIM_STATES.get(claim as object);
      if (!claimState || claimState.ledger !== api) {
        throw new FuryGatewayAutomationRunLedgerError(
          'claim-not-active',
          claim?.runIdSha256,
        );
      }
      if (outcome !== 'blocked' && outcome !== 'cancelled') {
        throw new FuryGatewayAutomationRunLedgerError('invalid-input');
      }
      if (evidence.evidenceSha256 !== undefined) {
        assertSha(evidence.evidenceSha256);
      }
      const at = evidence.now === undefined
        ? nowValue(now)
        : safeTimestamp(evidence.now);
      if (at >= claimState.record.leaseExpiresAt) {
        throw new FuryGatewayAutomationRunLedgerError(
          'claim-expired',
          claim.runIdSha256,
        );
      }
      const record: TerminalRecord = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_TERMINAL_RECORD_FORMAT,
        runIdSha256: claim.runIdSha256,
        triggerIdSha256: claim.triggerIdSha256,
        generation: claim.generation,
        claimIdSha256: claim.claimIdSha256,
        claimRecordSha256: claimState.handle.digest,
        executionIdentitySha256: claim.executionIdentitySha256,
        terminalAt: at,
        outcome,
        ...(evidence.evidenceSha256 === undefined
          ? {}
          : { evidenceSha256: evidence.evidenceSha256 }),
      });
      try {
        await store.putBounded(
          canonicalBytes(record),
          recordMetadata(record),
          {
            metadata: { system: SYSTEM },
            maxMatches: maxRecords,
            additionalBounds: [{
              metadata: slotMetadata(
                claim.runIdSha256,
                'terminal',
                claim.generation,
              ),
              maxMatches: 1,
            }],
            matchConstraints: [
              {
                metadata: exactRecordMetadata(claimState.record),
                minMatches: 1,
                maxMatches: 1,
              },
              {
                metadata: slotMetadata(
                  claim.runIdSha256,
                  'armed',
                  claim.generation,
                ),
                maxMatches: 0,
              },
              {
                metadata: slotMetadata(
                  claim.runIdSha256,
                  'claim',
                  claim.generation + 1,
                ),
                maxMatches: 0,
              },
            ],
          },
        );
      } catch {
        throw new FuryGatewayAutomationRunLedgerError(
          'stale-claim',
          claim.runIdSha256,
        );
      }
      const status = await api.inspect(claim.runIdSha256, at);
      if (!status) {
        throw new FuryGatewayAutomationRunLedgerError(
          'run-state-corrupt',
          claim.runIdSha256,
        );
      }
      return status;
    },

    async latestTrigger(
      automationIdInput: string,
    ): Promise<FuryGatewayAutomationTriggerOccurrence | undefined> {
      const id = automationId(automationIdInput);
      const handles = await store.list({
        metadata: {
          system: SYSTEM,
          recordType: 'trigger',
          automationId: id,
        },
        limit: maxRecords,
      });
      let latest: FuryGatewayAutomationTriggerOccurrence | undefined;
      for (const handle of handles) {
        const record = parseRecord(await store.get(handle));
        if (
          record.format !== FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT
          || record.automationId !== id
          || handle.metadata?.automationId !== id
        ) {
          throw new FuryGatewayAutomationRunLedgerError(
            'run-state-corrupt',
            record.runIdSha256,
          );
        }
        if (
          latest === undefined
          || record.scheduledFor > latest.scheduledFor
          || (
            record.scheduledFor === latest.scheduledFor
            && record.createdAt > latest.createdAt
          )
        ) {
          latest = record;
        }
      }
      return latest;
    },

    async listRecent(
      limitInput = 64,
      observedAtInput?: number,
    ): Promise<readonly FuryGatewayAutomationRunInspection[]> {
      const limit = boundedInteger(
        limitInput,
        64,
        1,
        256,
        'listRecent limit',
      );
      const observedAt = observedAtInput === undefined
        ? nowValue(now)
        : safeTimestamp(observedAtInput);
      const handles = await store.list({
        metadata: {
          system: SYSTEM,
          recordType: 'trigger',
        },
        limit: maxRecords,
      });
      const triggers: TriggerRecord[] = [];
      for (const handle of handles) {
        const record = parseRecord(await store.get(handle));
        if (
          record.format !== FURY_GATEWAY_AUTOMATION_TRIGGER_RECORD_FORMAT
          || handle.metadata?.automationId !== record.automationId
          || handle.metadata?.runIdSha256 !== record.runIdSha256
        ) {
          throw new FuryGatewayAutomationRunLedgerError(
            'run-state-corrupt',
            record.runIdSha256,
          );
        }
        triggers.push(record);
      }
      triggers.sort((left, right) =>
        right.createdAt - left.createdAt
        || right.scheduledFor - left.scheduledFor
        || right.runIdSha256.localeCompare(left.runIdSha256));
      const output: FuryGatewayAutomationRunInspection[] = [];
      for (const trigger of triggers.slice(0, limit)) {
        const loaded = await loadStatus(trigger.runIdSha256, observedAt);
        if (!loaded.status) {
          throw new FuryGatewayAutomationRunLedgerError(
            'run-state-corrupt',
            trigger.runIdSha256,
          );
        }
        output.push(Object.freeze({
          trigger,
          status: loaded.status,
          authority: 'observability-only' as const,
          executionAuthority: false as const,
        }));
      }
      return Object.freeze(output);
    },

    async countRuns(): Promise<number> {
      const handles = await store.list({
        metadata: {
          system: SYSTEM,
          recordType: 'trigger',
        },
        limit: maxRecords,
      });
      return handles.length;
    },
  });

  GENERATED_LEDGERS.add(api);
  return api;
}
