import { randomUUID } from 'node:crypto';

import type {
  RecoveryHandle,
  RecoveryMetadata,
  RecoveryStore,
} from './core/recovery-store.js';
import {
  canonicalizeMcpDirectJson,
  digestMcpDirectJson,
} from './mcp-direct-json.js';
import type { McpDirectReplayReason } from './mcp-direct-replay-internal.js';

export type McpDirectDurableReplayOutcome =
  | 'succeeded'
  | 'tool_error'
  | 'unknown'
  | 'evidence_failed'
  | 'verification_failed';

export interface McpDirectDurableReplayCoordinator {
  readonly format: 'furypipe-mcp-direct-durable-coordinator/v1';
  readonly scopeSha256: string;
}

export interface McpDirectDurableReplayCoordinatorOptions {
  readonly store: RecoveryStore;
  readonly tenantId: string;
  readonly principalId: string;
}

export type McpDirectDurableReplayStatus =
  | {
      readonly format: 'furypipe-mcp-direct-durable-status/v1';
      readonly scopeSha256: string;
      readonly replayKeySha256: string;
      readonly state: 'clear';
    }
  | {
      readonly format: 'furypipe-mcp-direct-durable-status/v1';
      readonly scopeSha256: string;
      readonly replayKeySha256: string;
      readonly state: 'pre_call';
      readonly attempt: number;
      readonly leaseExpired: boolean;
      readonly replayed: boolean;
    }
  | {
      readonly format: 'furypipe-mcp-direct-durable-status/v1';
      readonly scopeSha256: string;
      readonly replayKeySha256: string;
      readonly state: 'armed';
      readonly attempt: number;
      readonly replayed: boolean;
    }
  | {
      readonly format: 'furypipe-mcp-direct-durable-status/v1';
      readonly scopeSha256: string;
      readonly replayKeySha256: string;
      readonly state: 'terminal';
      readonly attempt: number;
      readonly replayed: boolean;
      readonly outcome: McpDirectDurableReplayOutcome;
      readonly resultSha256?: string;
      readonly succeeded?: boolean;
    }
  | {
      readonly format: 'furypipe-mcp-direct-durable-status/v1';
      readonly scopeSha256: string;
      readonly replayKeySha256: string;
      readonly state: 'compacted';
      readonly attempt: number;
      readonly historical: true;
      readonly outcome: 'succeeded' | 'tool_error';
      readonly resultSha256: string;
      readonly retainUntil: number;
    };

interface CoordinatorState {
  readonly store: RecoveryStore;
  readonly scopeSha256: string;
}

interface DurableReservationRecord {
  readonly format: 'furypipe-mcp-direct-durable-reservation/v1';
  readonly scopeSha256: string;
  readonly replayKeySha256: string;
  readonly attempt: number;
  readonly reservationIdSha256: string;
  readonly createdAt: number;
  readonly leaseExpiresAt: number;
  readonly replayed: boolean;
  readonly replayReason?: McpDirectReplayReason;
  readonly priorResultSha256?: string;
}

interface DurableArmedRecord {
  readonly format: 'furypipe-mcp-direct-durable-armed/v1';
  readonly scopeSha256: string;
  readonly replayKeySha256: string;
  readonly attempt: number;
  readonly reservationIdSha256: string;
  readonly armedAt: number;
  readonly replayed: boolean;
}

interface DurableTerminalRecord {
  readonly format: 'furypipe-mcp-direct-durable-terminal/v1';
  readonly scopeSha256: string;
  readonly replayKeySha256: string;
  readonly attempt: number;
  readonly reservationIdSha256: string;
  readonly armedRecordSha256: string;
  readonly terminalAt: number;
  readonly replayed: boolean;
  readonly outcome: McpDirectDurableReplayOutcome;
  readonly resultSha256?: string;
  readonly succeeded?: boolean;
}

interface DurableTombstoneRecord {
  readonly format: 'furypipe-mcp-direct-durable-tombstone/v1';
  readonly scopeSha256: string;
  readonly replayKeySha256: string;
  readonly attempt: number;
  readonly reservationIdSha256: string;
  readonly armedRecordSha256: string;
  readonly reservationRecordSha256: string;
  readonly terminalRecordSha256: string;
  readonly terminalAt: number;
  readonly compactedAt: number;
  readonly replayed: boolean;
  readonly outcome: 'succeeded' | 'tool_error';
  readonly resultSha256: string;
  readonly retentionClass: 'known_succeeded' | 'known_tool_error';
  readonly retainUntil: number;
  readonly lineageSha256: string;
}

type DurableRecord =
  | DurableReservationRecord
  | DurableArmedRecord
  | DurableTerminalRecord
  | DurableTombstoneRecord;

interface LoadedRecord {
  readonly handle: RecoveryHandle;
  readonly record: DurableRecord;
}

export interface McpDirectDurableReservation {
  readonly format: 'furypipe-mcp-direct-durable-reservation-evidence/v1';
  readonly scopeSha256: string;
  readonly replayKeySha256: string;
  readonly attempt: number;
  readonly reservationIdSha256: string;
  readonly leaseExpiresAt: number;
  readonly replayed: boolean;
  readonly replayReason?: McpDirectReplayReason;
  readonly priorResultSha256?: string;
}

export interface McpDirectDurableArmedEvidence {
  readonly format: 'furypipe-mcp-direct-durable-armed-evidence/v1';
  readonly scopeSha256: string;
  readonly replayKeySha256: string;
  readonly attempt: number;
  readonly reservationIdSha256: string;
  readonly armedRecordSha256: string;
  readonly replayed: boolean;
}

export interface McpDirectDurableReserveOptions {
  readonly now?: number;
  readonly leaseMs?: number;
  readonly replay?: {
    readonly priorAttempt: number;
    readonly priorResultSha256: string;
    readonly reason: McpDirectReplayReason;
  };
}

export interface McpDirectDurableSettleEvidence {
  readonly resultSha256?: string;
  readonly succeeded?: boolean;
  readonly now?: number;
}

const COORDINATORS = new WeakMap<object, CoordinatorState>();
const RESERVATIONS = new WeakMap<object, {
  readonly coordinator: McpDirectDurableReplayCoordinator;
  readonly handle: RecoveryHandle;
  readonly record: DurableReservationRecord;
}>();
const ARMED = new WeakMap<object, {
  readonly coordinator: McpDirectDurableReplayCoordinator;
  readonly handle: RecoveryHandle;
  readonly record: DurableArmedRecord;
  readonly reservation: McpDirectDurableReservation;
}>();
const SETTLED = new WeakSet<object>();

const SYSTEM = 'mcp-direct-durable-replay';
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_RECORDS_PER_KEY = 16;
const MAX_ATTEMPTS_PER_KEY = 3;
const DEFAULT_PRE_CALL_LEASE_MS = 30_000;
const MAX_PRE_CALL_LEASE_MS = 60_000;
const MAX_RECORD_BYTES = 16 * 1024;
const MAX_RECORD_DEPTH = 16;

export type McpDirectDurableReplayErrorCode =
  | 'invalid-coordinator'
  | 'store-capability-missing'
  | 'durable-state-conflict'
  | 'durable-state-corrupt'
  | 'durable-attempt-limit'
  | 'durable-replay-not-authorized'
  | 'durable-reservation-expired'
  | 'durable-reclaim-not-safe'
  | 'durable-maintenance-not-eligible';

const ERROR_MESSAGES: Readonly<Record<McpDirectDurableReplayErrorCode, string>> = Object.freeze({
  'invalid-coordinator': 'MCP durable replay coordinator is not process-local FuryPipe evidence.',
  'store-capability-missing': 'MCP durable replay requires RecoveryStore list and atomic putBounded capabilities.',
  'durable-state-conflict': 'MCP durable replay state already blocks this execution key.',
  'durable-state-corrupt': 'MCP durable replay state is inconsistent or failed integrity validation.',
  'durable-attempt-limit': 'MCP durable replay attempt limit has been reached for this execution key.',
  'durable-replay-not-authorized': 'MCP durable replay does not have exact prior terminal evidence.',
  'durable-reservation-expired': 'MCP durable pre-call reservation lease expired before the execution was armed.',
  'durable-reclaim-not-safe': 'MCP durable pre-call reservation cannot be reclaimed safely.',
  'durable-maintenance-not-eligible': 'MCP durable evidence is not eligible for automatic maintenance compaction.',
});

export class McpDirectDurableReplayError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: McpDirectDurableReplayErrorCode,
    readonly replayKeySha256?: string,
    readonly attempt?: number,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'McpDirectDurableReplayError';
  }
}

function safeIdentity(value: string, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be a bounded printable non-secret identity`);
  }
  return value;
}

function assertSha(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function timestamp(value: number | undefined, fallback = Date.now()): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error('MCP durable replay timestamp must be a non-negative safe integer');
  }
  return resolved;
}

function boundedLease(value: number | undefined): number {
  const resolved = value ?? DEFAULT_PRE_CALL_LEASE_MS;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_PRE_CALL_LEASE_MS) {
    throw new Error('MCP durable pre-call lease must be between 1 and 60000 ms');
  }
  return resolved;
}

function coordinatorState(
  coordinator: McpDirectDurableReplayCoordinator,
): CoordinatorState {
  const state = COORDINATORS.get(coordinator as object);
  if (!state) throw new McpDirectDurableReplayError('invalid-coordinator');
  return state;
}

function requiredStore(
  coordinator: McpDirectDurableReplayCoordinator,
): CoordinatorState & {
  readonly store: RecoveryStore & Required<Pick<RecoveryStore, 'list' | 'putBounded' | 'deleteBounded' | 'compactBounded'>>;
} {
  const state = coordinatorState(coordinator);
  if (
    typeof state.store.list !== 'function'
    || typeof state.store.putBounded !== 'function'
    || typeof state.store.deleteBounded !== 'function'
    || typeof state.store.compactBounded !== 'function'
  ) {
    throw new McpDirectDurableReplayError('store-capability-missing');
  }
  return state as CoordinatorState & {
    readonly store: RecoveryStore & Required<Pick<RecoveryStore, 'list' | 'putBounded' | 'deleteBounded' | 'compactBounded'>>;
  };
}

function slotMetadata(
  scopeSha256: string,
  replayKeySha256: string,
  recordType: 'reservation' | 'armed' | 'terminal' | 'tombstone',
  attempt: number,
): RecoveryMetadata {
  return Object.freeze({
    system: SYSTEM,
    scopeSha256,
    replayKeySha256,
    recordType,
    attempt,
  });
}

function metadata(
  scopeSha256: string,
  replayKeySha256: string,
  recordType: 'reservation' | 'armed' | 'terminal' | 'tombstone',
  attempt: number,
  reservationIdSha256: string,
): RecoveryMetadata {
  return Object.freeze({
    ...slotMetadata(scopeSha256, replayKeySha256, recordType, attempt),
    reservationIdSha256,
  });
}

function recordType(record: DurableRecord): 'reservation' | 'armed' | 'terminal' | 'tombstone' {
  if (record.format === 'furypipe-mcp-direct-durable-reservation/v1') return 'reservation';
  if (record.format === 'furypipe-mcp-direct-durable-armed/v1') return 'armed';
  if (record.format === 'furypipe-mcp-direct-durable-terminal/v1') return 'terminal';
  return 'tombstone';
}

function canonicalBytes(record: DurableRecord): Uint8Array {
  const canonical = canonicalizeMcpDirectJson(record, {
    maxBytes: MAX_RECORD_BYTES,
    maxDepth: MAX_RECORD_DEPTH,
    label: 'MCP durable replay record',
  });
  return new TextEncoder().encode(canonical);
}

function exactObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const names = Object.keys(value);
  if (required.some(key => !names.includes(key)) || names.some(key => !allowed.has(key))) {
    throw new Error(`${label} fields are invalid`);
  }
}

function parseRecord(bytes: Uint8Array): DurableRecord {
  let parsed: unknown;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new McpDirectDurableReplayError('durable-state-corrupt');
  }
  try {
    const value = exactObject(parsed, 'MCP durable replay record');
    const format = value.format;
    if (typeof format !== 'string') throw new Error('missing format');

    const commonRequired = [
      'format',
      'scopeSha256',
      'replayKeySha256',
      'attempt',
      'reservationIdSha256',
    ] as const;

    if (format === 'furypipe-mcp-direct-durable-reservation/v1') {
      exactKeys(
        value,
        [...commonRequired, 'createdAt', 'leaseExpiresAt', 'replayed'],
        ['replayReason', 'priorResultSha256'],
        'MCP durable reservation',
      );
    } else if (format === 'furypipe-mcp-direct-durable-armed/v1') {
      exactKeys(
        value,
        [...commonRequired, 'armedAt', 'replayed'],
        [],
        'MCP durable armed marker',
      );
    } else if (format === 'furypipe-mcp-direct-durable-terminal/v1') {
      exactKeys(
        value,
        [...commonRequired, 'armedRecordSha256', 'terminalAt', 'replayed', 'outcome'],
        ['resultSha256', 'succeeded'],
        'MCP durable terminal',
      );
    } else if (format === 'furypipe-mcp-direct-durable-tombstone/v1') {
      exactKeys(
        value,
        [...commonRequired, 'armedRecordSha256', 'terminalAt', 'compactedAt', 'replayed',
          'outcome', 'resultSha256', 'retentionClass', 'retainUntil', 'lineageSha256',
          'reservationRecordSha256', 'terminalRecordSha256'],
        [],
        'MCP durable tombstone',
      );
    } else {
      throw new Error('unknown record version');
    }

    if (
      typeof value.scopeSha256 !== 'string'
      || typeof value.replayKeySha256 !== 'string'
      || typeof value.reservationIdSha256 !== 'string'
    ) {
      throw new Error('digest type mismatch');
    }
    assertSha(value.scopeSha256, 'scopeSha256');
    assertSha(value.replayKeySha256, 'replayKeySha256');
    assertSha(value.reservationIdSha256, 'reservationIdSha256');
    if (!Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1 || (value.attempt as number) > MAX_ATTEMPTS_PER_KEY) {
      throw new Error('attempt is invalid');
    }
    if (typeof value.replayed !== 'boolean') throw new Error('replayed is invalid');

    if (format === 'furypipe-mcp-direct-durable-reservation/v1') {
      if (
        !Number.isSafeInteger(value.createdAt)
        || !Number.isSafeInteger(value.leaseExpiresAt)
        || (value.createdAt as number) < 0
        || (value.leaseExpiresAt as number) <= (value.createdAt as number)
      ) throw new Error('reservation timestamps are invalid');
      if (value.replayReason !== undefined && value.replayReason !== 'repeat_closed_world_read' && value.replayReason !== 'retry_known_tool_error') {
        throw new Error('replay reason is invalid');
      }
      if (value.priorResultSha256 !== undefined) {
        if (typeof value.priorResultSha256 !== 'string') throw new Error('prior result digest is invalid');
        assertSha(value.priorResultSha256, 'priorResultSha256');
      }
      if (
        (value.replayed === true && (value.replayReason === undefined || value.priorResultSha256 === undefined))
        || (value.replayed === false && (value.replayReason !== undefined || value.priorResultSha256 !== undefined))
      ) throw new Error('reservation replay evidence is inconsistent');
    } else if (format === 'furypipe-mcp-direct-durable-armed/v1') {
      if (!Number.isSafeInteger(value.armedAt) || (value.armedAt as number) < 0) {
        throw new Error('armedAt is invalid');
      }
    } else if (format === 'furypipe-mcp-direct-durable-tombstone/v1') {
      if (typeof value.armedRecordSha256 !== 'string'
        || typeof value.reservationRecordSha256 !== 'string'
        || typeof value.terminalRecordSha256 !== 'string'
        || typeof value.resultSha256 !== 'string'
        || typeof value.lineageSha256 !== 'string') {
        throw new Error('tombstone digest is invalid');
      }
      assertSha(value.armedRecordSha256, 'armedRecordSha256');
      assertSha(value.reservationRecordSha256, 'reservationRecordSha256');
      assertSha(value.terminalRecordSha256, 'terminalRecordSha256');
      assertSha(value.resultSha256, 'resultSha256');
      assertSha(value.lineageSha256, 'lineageSha256');
      if (!Number.isSafeInteger(value.terminalAt)
        || !Number.isSafeInteger(value.compactedAt)
        || !Number.isSafeInteger(value.retainUntil)
        || (value.terminalAt as number) < 0
        || (value.compactedAt as number) < (value.terminalAt as number)
        || (value.retainUntil as number) < (value.compactedAt as number)) {
        throw new Error('tombstone timestamps are invalid');
      }
      if (value.outcome !== 'succeeded' && value.outcome !== 'tool_error') {
        throw new Error('tombstone outcome is invalid');
      }
      if (value.retentionClass !== 'known_succeeded' && value.retentionClass !== 'known_tool_error') {
        throw new Error('tombstone retention class is invalid');
      }
      if ((value.outcome === 'succeeded' && value.retentionClass !== 'known_succeeded')
        || (value.outcome === 'tool_error' && value.retentionClass !== 'known_tool_error')) {
        throw new Error('tombstone retention classification is inconsistent');
      }
    } else {
      if (typeof value.armedRecordSha256 !== 'string') throw new Error('armed record digest is invalid');
      assertSha(value.armedRecordSha256, 'armedRecordSha256');
      if (!Number.isSafeInteger(value.terminalAt) || (value.terminalAt as number) < 0) {
        throw new Error('terminalAt is invalid');
      }
      if (!['succeeded', 'tool_error', 'unknown', 'evidence_failed', 'verification_failed'].includes(value.outcome as string)) {
        throw new Error('terminal outcome is invalid');
      }
      if (value.resultSha256 !== undefined) {
        if (typeof value.resultSha256 !== 'string') throw new Error('resultSha256 is invalid');
        assertSha(value.resultSha256, 'resultSha256');
      }
      if (value.succeeded !== undefined && typeof value.succeeded !== 'boolean') {
        throw new Error('succeeded is invalid');
      }
      if (
        (value.outcome === 'succeeded' && value.succeeded !== true)
        || (value.outcome === 'tool_error' && value.succeeded !== false)
        || (value.outcome === 'verification_failed' && value.succeeded !== true)
      ) {
        throw new Error('terminal succeeded classification is inconsistent');
      }
      if (
        (value.outcome === 'succeeded'
          || value.outcome === 'tool_error'
          || value.outcome === 'verification_failed')
        && value.resultSha256 === undefined
      ) {
        throw new Error('known MCP durable terminal outcome requires resultSha256');
      }
      if (
        (value.outcome === 'unknown' || value.outcome === 'evidence_failed')
        && value.resultSha256 !== undefined
      ) {
        throw new Error('non-digest terminal outcome must not claim resultSha256');
      }
      if (value.outcome === 'unknown' && value.succeeded !== undefined) {
        throw new Error('unknown MCP durable terminal outcome must not claim succeeded');
      }
    }

    const canonical = canonicalizeMcpDirectJson(parsed, {
      maxBytes: MAX_RECORD_BYTES,
      maxDepth: MAX_RECORD_DEPTH,
      label: 'MCP durable replay record',
    });
    if (canonical !== text) throw new Error('record is not canonical');

    return parsed as DurableRecord;
  } catch (caught) {
    if (caught instanceof McpDirectDurableReplayError) throw caught;
    throw new McpDirectDurableReplayError('durable-state-corrupt');
  }
}

async function loadedRecords(
  coordinator: McpDirectDurableReplayCoordinator,
  replayKeySha256: string,
): Promise<readonly LoadedRecord[]> {
  assertSha(replayKeySha256, 'replayKeySha256');
  const { store, scopeSha256 } = requiredStore(coordinator);
  const handles = await store.list({
    metadata: {
      system: SYSTEM,
      scopeSha256,
      replayKeySha256,
    },
    limit: MAX_RECORDS_PER_KEY,
  });
  if (handles.length >= MAX_RECORDS_PER_KEY) {
    throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256);
  }

  const records: LoadedRecord[] = [];
  for (const handle of handles) {
    const bytes = await store.get(handle);
    const record = parseRecord(bytes);
    if (
      record.scopeSha256 !== scopeSha256
      || record.replayKeySha256 !== replayKeySha256
      || handle.metadata?.system !== SYSTEM
      || handle.metadata?.scopeSha256 !== scopeSha256
      || handle.metadata?.replayKeySha256 !== replayKeySha256
      || handle.metadata?.recordType !== recordType(record)
      || handle.metadata?.attempt !== record.attempt
      || handle.metadata?.reservationIdSha256 !== record.reservationIdSha256
    ) {
      throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, record.attempt);
    }
    records.push(Object.freeze({ handle, record }));
  }
  return Object.freeze(records);
}

function recordHandleDigest(records: readonly LoadedRecord[], target: DurableRecord): string {
  const loaded = records.find(({ record }) => record === target);
  if (!loaded) throw new McpDirectDurableReplayError('durable-state-corrupt');
  return loaded.handle.digest;
}

function classify(
  scopeSha256: string,
  replayKeySha256: string,
  records: readonly LoadedRecord[],
  now: number,
): McpDirectDurableReplayStatus {
  if (records.length === 0) {
    return Object.freeze({
      format: 'furypipe-mcp-direct-durable-status/v1',
      scopeSha256,
      replayKeySha256,
      state: 'clear',
    });
  }

  const tombstones = records.filter(({ record }) =>
    record.format === 'furypipe-mcp-direct-durable-tombstone/v1');
  if (tombstones.length > 0) {
    if (tombstones.length !== 1) {
      throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256);
    }
    const tombstone = tombstones[0]!.record;
    if (tombstone.format !== 'furypipe-mcp-direct-durable-tombstone/v1') {
      throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256);
    }
    if (records.some(({ record }) =>
      record.format !== 'furypipe-mcp-direct-durable-tombstone/v1'
      && (record.attempt !== tombstone.attempt
        || ![
          tombstone.reservationRecordSha256,
          tombstone.armedRecordSha256,
          tombstone.terminalRecordSha256,
        ].includes(recordHandleDigest(records, record)))) ) {
      throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256);
    }
    return Object.freeze({
      format: 'furypipe-mcp-direct-durable-status/v1',
      scopeSha256,
      replayKeySha256,
      state: 'compacted',
      attempt: tombstone.attempt,
      historical: true as const,
      outcome: tombstone.outcome,
      resultSha256: tombstone.resultSha256,
      retainUntil: tombstone.retainUntil,
    });
  }

  const byAttempt = new Map<number, {
    reservation?: LoadedRecord & { readonly record: DurableReservationRecord };
    armed?: LoadedRecord & { readonly record: DurableArmedRecord };
    terminal?: LoadedRecord & { readonly record: DurableTerminalRecord };
  }>();

  for (const loaded of records) {
    const { record } = loaded;
    const group = byAttempt.get(record.attempt) ?? {};
    if (record.format === 'furypipe-mcp-direct-durable-reservation/v1') {
      if (group.reservation !== undefined) {
        throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, record.attempt);
      }
      group.reservation = loaded as LoadedRecord & { readonly record: DurableReservationRecord };
    } else if (record.format === 'furypipe-mcp-direct-durable-armed/v1') {
      if (group.armed !== undefined) {
        throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, record.attempt);
      }
      group.armed = loaded as LoadedRecord & { readonly record: DurableArmedRecord };
    } else {
      if (group.terminal !== undefined) {
        throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, record.attempt);
      }
      group.terminal = loaded as LoadedRecord & { readonly record: DurableTerminalRecord };
    }
    byAttempt.set(record.attempt, group);
  }

  const attempts = [...byAttempt.keys()].sort((left, right) => left - right);
  if (attempts[0] !== 1 || attempts.some((attempt, index) => attempt !== index + 1)) {
    throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256);
  }

  for (const attempt of attempts) {
    const group = byAttempt.get(attempt)!;
    const reservationLoaded = group.reservation;
    if (!reservationLoaded) {
      throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, attempt);
    }
    const reservation = reservationLoaded.record;

    if (attempt === 1) {
      if (
        reservation.replayed
        || reservation.replayReason !== undefined
        || reservation.priorResultSha256 !== undefined
      ) {
        throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, attempt);
      }
    } else {
      const previous = byAttempt.get(attempt - 1)?.terminal?.record;
      if (
        !reservation.replayed
        || !previous
        || (previous.outcome !== 'succeeded' && previous.outcome !== 'tool_error')
        || previous.resultSha256 === undefined
        || reservation.priorResultSha256 !== previous.resultSha256
        || (previous.outcome === 'succeeded' && reservation.replayReason !== 'repeat_closed_world_read')
        || (previous.outcome === 'tool_error' && reservation.replayReason !== 'retry_known_tool_error')
        || reservation.createdAt < previous.terminalAt
      ) {
        throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, attempt);
      }
    }

    if (group.armed) {
      const armed = group.armed.record;
      if (
        armed.reservationIdSha256 !== reservation.reservationIdSha256
        || armed.replayed !== reservation.replayed
        || armed.armedAt < reservation.createdAt
        || armed.armedAt >= reservation.leaseExpiresAt
      ) {
        throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, attempt);
      }
    }

    if (group.terminal) {
      const terminal = group.terminal.record;
      const armedLoaded = group.armed;
      if (
        !armedLoaded
        || terminal.reservationIdSha256 !== reservation.reservationIdSha256
        || terminal.replayed !== reservation.replayed
        || terminal.armedRecordSha256 !== armedLoaded.handle.digest
        || terminal.terminalAt < armedLoaded.record.armedAt
      ) {
        throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, attempt);
      }
    }

    if (attempt < attempts[attempts.length - 1]! && !group.terminal) {
      throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256, attempt);
    }
  }

  const attempt = attempts[attempts.length - 1]!;
  const group = byAttempt.get(attempt)!;
  const reservation = group.reservation!.record;

  if (group.terminal) {
    const terminal = group.terminal.record;
    return Object.freeze({
      format: 'furypipe-mcp-direct-durable-status/v1',
      scopeSha256,
      replayKeySha256,
      state: 'terminal',
      attempt,
      replayed: terminal.replayed,
      outcome: terminal.outcome,
      ...(terminal.resultSha256 === undefined ? {} : { resultSha256: terminal.resultSha256 }),
      ...(terminal.succeeded === undefined ? {} : { succeeded: terminal.succeeded }),
    });
  }
  if (group.armed) {
    return Object.freeze({
      format: 'furypipe-mcp-direct-durable-status/v1',
      scopeSha256,
      replayKeySha256,
      state: 'armed',
      attempt,
      replayed: group.armed.record.replayed,
    });
  }
  return Object.freeze({
    format: 'furypipe-mcp-direct-durable-status/v1',
    scopeSha256,
    replayKeySha256,
    state: 'pre_call',
    attempt,
    leaseExpired: reservation.leaseExpiresAt <= now,
    replayed: reservation.replayed,
  });
}

export function createMcpDirectDurableReplayCoordinatorInternal(
  options: McpDirectDurableReplayCoordinatorOptions,
): McpDirectDurableReplayCoordinator {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('MCP durable replay coordinator options must be an object');
  }
  const tenantId = safeIdentity(options.tenantId, 'tenantId');
  const principalId = safeIdentity(options.principalId, 'principalId');
  if (!options.store || typeof options.store !== 'object') {
    throw new Error('MCP durable replay coordinator requires a RecoveryStore');
  }
  if (
    typeof options.store.list !== 'function'
    || typeof options.store.putBounded !== 'function'
    || typeof options.store.deleteBounded !== 'function'
  ) {
    throw new McpDirectDurableReplayError('store-capability-missing');
  }

  const scopeSha256 = digestMcpDirectJson({
    tenantId,
    principalId,
  }, {
    maxBytes: 4096,
    maxDepth: 4,
    label: 'MCP durable replay scope',
  });

  const coordinator = Object.freeze({
    format: 'furypipe-mcp-direct-durable-coordinator/v1' as const,
    scopeSha256,
  });
  COORDINATORS.set(coordinator, Object.freeze({
    store: options.store,
    scopeSha256,
  }));
  return coordinator;
}

export function isGeneratedMcpDirectDurableReplayCoordinator(
  value: unknown,
): value is McpDirectDurableReplayCoordinator {
  return typeof value === 'object' && value !== null && COORDINATORS.has(value);
}

export async function inspectMcpDirectDurableReplayStatusInternal(
  coordinator: McpDirectDurableReplayCoordinator,
  replayKeySha256: string,
  nowValue?: number,
): Promise<McpDirectDurableReplayStatus> {
  const { scopeSha256 } = coordinatorState(coordinator);
  const now = timestamp(nowValue);
  return classify(
    scopeSha256,
    replayKeySha256,
    await loadedRecords(coordinator, replayKeySha256),
    now,
  );
}

export async function reclaimMcpDirectDurableExpiredPreCallInternal(
  coordinator: McpDirectDurableReplayCoordinator,
  replayKeySha256: string,
  nowValue?: number,
): Promise<McpDirectDurableReplayStatus> {
  assertSha(replayKeySha256, 'replayKeySha256');
  const { store, scopeSha256 } = requiredStore(coordinator);
  const now = timestamp(nowValue);
  const records = await loadedRecords(coordinator, replayKeySha256);
  const current = classify(scopeSha256, replayKeySha256, records, now);
  if (current.state !== 'pre_call' || !current.leaseExpired) {
    throw new McpDirectDurableReplayError(
      'durable-reclaim-not-safe',
      replayKeySha256,
      'attempt' in current ? current.attempt : undefined,
    );
  }

  const reservationLoaded = records.find(({ record }) =>
    record.format === 'furypipe-mcp-direct-durable-reservation/v1'
    && record.attempt === current.attempt);
  if (
    !reservationLoaded
    || reservationLoaded.record.format !== 'furypipe-mcp-direct-durable-reservation/v1'
  ) {
    throw new McpDirectDurableReplayError(
      'durable-state-corrupt',
      replayKeySha256,
      current.attempt,
    );
  }
  const reservation = reservationLoaded.record;
  const reservationMetadata = metadata(
    scopeSha256,
    replayKeySha256,
    'reservation',
    reservation.attempt,
    reservation.reservationIdSha256,
  );
  const armedMetadata = metadata(
    scopeSha256,
    replayKeySha256,
    'armed',
    reservation.attempt,
    reservation.reservationIdSha256,
  );

  let deleted: boolean;
  try {
    deleted = await store.deleteBounded(
      reservationLoaded.handle,
      {
        targetMetadata: reservationMetadata as Readonly<Record<string, string | number | boolean | null>>,
        matchConstraints: [
          {
            metadata: reservationMetadata as Readonly<Record<string, string | number | boolean | null>>,
            minMatches: 1,
            maxMatches: 1,
          },
          {
            metadata: armedMetadata as Readonly<Record<string, string | number | boolean | null>>,
            maxMatches: 0,
          },
        ],
      },
    );
  } catch {
    throw new McpDirectDurableReplayError(
      'durable-reclaim-not-safe',
      replayKeySha256,
      current.attempt,
    );
  }
  if (!deleted) {
    throw new McpDirectDurableReplayError(
      'durable-reclaim-not-safe',
      replayKeySha256,
      current.attempt,
    );
  }

  return inspectMcpDirectDurableReplayStatusInternal(
    coordinator,
    replayKeySha256,
    now,
  );
}

export interface McpDirectDurableCompactionOptions {
  readonly now: number;
  readonly retainUntil: number;
}

export async function compactMcpDirectDurableEvidenceInternal(
  coordinator: McpDirectDurableReplayCoordinator,
  replayKeySha256: string,
  options: McpDirectDurableCompactionOptions,
): Promise<McpDirectDurableReplayStatus> {
  assertSha(replayKeySha256, 'replayKeySha256');
  if (!Number.isSafeInteger(options.now) || options.now < 0
    || !Number.isSafeInteger(options.retainUntil) || options.retainUntil < options.now) {
    throw new Error('MCP durable compaction timestamps are invalid');
  }
  const { store, scopeSha256 } = requiredStore(coordinator);
  const records = await loadedRecords(coordinator, replayKeySha256);
  const current = classify(scopeSha256, replayKeySha256, records, options.now);
  if (current.state === 'compacted') {
    const tombstoneLoaded = records.find(({ record }) =>
      record.format === 'furypipe-mcp-direct-durable-tombstone/v1');
    if (!tombstoneLoaded || tombstoneLoaded.record.format !== 'furypipe-mcp-direct-durable-tombstone/v1') {
      throw new McpDirectDurableReplayError('durable-state-corrupt', replayKeySha256);
    }
    const remaining = records.filter(({ record }) =>
      record.format !== 'furypipe-mcp-direct-durable-tombstone/v1');
    if (remaining.length === 0) return current;
    const tombstoneMetadata = metadata(scopeSha256, replayKeySha256, 'tombstone',
      tombstoneLoaded.record.attempt, tombstoneLoaded.record.reservationIdSha256);
    const slot = slotMetadata(scopeSha256, replayKeySha256, 'tombstone',
      tombstoneLoaded.record.attempt) as Readonly<Record<string, string | number | boolean | null>>;
    await store.compactBounded(
      canonicalBytes(tombstoneLoaded.record),
      tombstoneMetadata,
      { metadata: slot, maxMatches: 1 },
      remaining.map(({ handle, record }) => ({
        handle,
        targetMetadata: metadata(scopeSha256, replayKeySha256, recordType(record),
          record.attempt, record.reservationIdSha256) as Readonly<Record<string, string | number | boolean | null>>,
        matchConstraints: [{
          metadata: metadata(scopeSha256, replayKeySha256, recordType(record),
            record.attempt, record.reservationIdSha256) as Readonly<Record<string, string | number | boolean | null>>,
          minMatches: 1,
          maxMatches: 1,
        }],
      })),
    );
    return inspectMcpDirectDurableReplayStatusInternal(coordinator, replayKeySha256, options.now);
  }
  if (
    current.state !== 'terminal'
    || (current.outcome !== 'succeeded' && current.outcome !== 'tool_error')
    || current.resultSha256 === undefined
  ) {
    throw new McpDirectDurableReplayError(
      'durable-maintenance-not-eligible',
      replayKeySha256,
      'attempt' in current ? current.attempt : undefined,
    );
  }

  const attempt = current.attempt;
  const complete = records.filter(({ record }) => record.attempt === attempt);
  const reservation = complete.find(({ record }) =>
    record.format === 'furypipe-mcp-direct-durable-reservation/v1');
  const armed = complete.find(({ record }) =>
    record.format === 'furypipe-mcp-direct-durable-armed/v1');
  const terminal = complete.find(({ record }) =>
    record.format === 'furypipe-mcp-direct-durable-terminal/v1');
  if (!reservation || !armed || !terminal
    || terminal.record.format !== 'furypipe-mcp-direct-durable-terminal/v1'
    || armed.record.format !== 'furypipe-mcp-direct-durable-armed/v1'
    || reservation.record.format !== 'furypipe-mcp-direct-durable-reservation/v1') {
    throw new McpDirectDurableReplayError('durable-maintenance-not-eligible', replayKeySha256, attempt);
  }

  const lineageSha256 = digestMcpDirectJson([
    reservation.handle.digest,
    armed.handle.digest,
    terminal.handle.digest,
  ], { maxBytes: 4096, maxDepth: 4, label: 'MCP durable compaction lineage' });
  const tombstone: DurableTombstoneRecord = Object.freeze({
    format: 'furypipe-mcp-direct-durable-tombstone/v1',
    scopeSha256,
    replayKeySha256,
    attempt,
    reservationIdSha256: reservation.record.reservationIdSha256,
    armedRecordSha256: armed.handle.digest,
    reservationRecordSha256: reservation.handle.digest,
    terminalRecordSha256: terminal.handle.digest,
    terminalAt: terminal.record.terminalAt,
    // Deterministic identity: concurrent maintainers must publish the same
    // content-addressed tombstone for the same terminal lineage.
    compactedAt: terminal.record.terminalAt,
    replayed: terminal.record.replayed,
    outcome: terminal.record.outcome as 'succeeded' | 'tool_error',
    resultSha256: terminal.record.resultSha256!,
    retentionClass: terminal.record.outcome === 'succeeded'
      ? 'known_succeeded'
      : 'known_tool_error',
    retainUntil: options.retainUntil,
    lineageSha256,
  });
  const tombstoneMetadata = metadata(scopeSha256, replayKeySha256, 'tombstone', attempt,
    reservation.record.reservationIdSha256);
  const slot = slotMetadata(scopeSha256, replayKeySha256, 'tombstone', attempt) as
    Readonly<Record<string, string | number | boolean | null>>;
  const fullConstraints = [reservation, armed, terminal].map(({ handle, record }) => ({
    metadata: metadata(scopeSha256, replayKeySha256, recordType(record), attempt,
      record.reservationIdSha256) as Readonly<Record<string, string | number | boolean | null>>,
    minMatches: 1,
    maxMatches: 1,
  }));
  await store.compactBounded(
    canonicalBytes(tombstone),
    tombstoneMetadata,
    { metadata: slot, maxMatches: 1, matchConstraints: fullConstraints },
    [reservation, armed, terminal].map(({ handle, record }) => ({
      handle,
      targetMetadata: metadata(scopeSha256, replayKeySha256, recordType(record), attempt,
        record.reservationIdSha256) as Readonly<Record<string, string | number | boolean | null>>,
      matchConstraints: [{
        metadata: metadata(scopeSha256, replayKeySha256, recordType(record), attempt,
          record.reservationIdSha256) as Readonly<Record<string, string | number | boolean | null>>,
        minMatches: 1,
        maxMatches: 1,
      }],
    })),
  );
  return inspectMcpDirectDurableReplayStatusInternal(coordinator, replayKeySha256, options.now);
}

export async function reserveMcpDirectDurableExecution(
  coordinator: McpDirectDurableReplayCoordinator,
  replayKeySha256: string,
  options: McpDirectDurableReserveOptions = {},
): Promise<McpDirectDurableReservation> {
  assertSha(replayKeySha256, 'replayKeySha256');
  const { store, scopeSha256 } = requiredStore(coordinator);
  const now = timestamp(options.now);
  const leaseMs = boundedLease(options.leaseMs);
  const current = await inspectMcpDirectDurableReplayStatusInternal(
    coordinator,
    replayKeySha256,
    now,
  );

  let attempt = 1;
  let replayed = false;
  let replayReason: McpDirectReplayReason | undefined;
  let priorResultSha256: string | undefined;

  if (options.replay === undefined) {
    if (current.state !== 'clear') {
      throw new McpDirectDurableReplayError(
        'durable-state-conflict',
        replayKeySha256,
        'attempt' in current ? current.attempt : undefined,
      );
    }
  } else {
    assertSha(options.replay.priorResultSha256, 'priorResultSha256');
    if (
      current.state !== 'terminal'
      || (current.outcome !== 'succeeded' && current.outcome !== 'tool_error')
      || current.attempt !== options.replay.priorAttempt
      || current.resultSha256 !== options.replay.priorResultSha256
    ) {
      throw new McpDirectDurableReplayError(
        'durable-replay-not-authorized',
        replayKeySha256,
        'attempt' in current ? current.attempt : undefined,
      );
    }
    if (current.attempt >= MAX_ATTEMPTS_PER_KEY) {
      throw new McpDirectDurableReplayError(
        'durable-attempt-limit',
        replayKeySha256,
        current.attempt,
      );
    }
    if (
      (current.outcome === 'succeeded' && options.replay.reason !== 'repeat_closed_world_read')
      || (current.outcome === 'tool_error' && options.replay.reason !== 'retry_known_tool_error')
    ) {
      throw new McpDirectDurableReplayError(
        'durable-replay-not-authorized',
        replayKeySha256,
        current.attempt,
      );
    }
    attempt = current.attempt + 1;
    replayed = true;
    replayReason = options.replay.reason;
    priorResultSha256 = options.replay.priorResultSha256;
  }

  const leaseExpiresAt = now + leaseMs;
  if (!Number.isSafeInteger(leaseExpiresAt)) {
    throw new Error('MCP durable replay lease expiry exceeds the safe integer range');
  }
  const reservationIdSha256 = digestMcpDirectJson(randomUUID(), {
    maxBytes: 1024,
    maxDepth: 2,
    label: 'MCP durable reservation id',
  });
  const record: DurableReservationRecord = Object.freeze({
    format: 'furypipe-mcp-direct-durable-reservation/v1',
    scopeSha256,
    replayKeySha256,
    attempt,
    reservationIdSha256,
    createdAt: now,
    leaseExpiresAt,
    replayed,
    ...(replayReason === undefined ? {} : { replayReason }),
    ...(priorResultSha256 === undefined ? {} : { priorResultSha256 }),
  });
  const recordMetadata = metadata(
    scopeSha256,
    replayKeySha256,
    'reservation',
    attempt,
    reservationIdSha256,
  );
  let handle: RecoveryHandle;
  try {
    handle = await store.putBounded(
      canonicalBytes(record),
      recordMetadata,
      {
        metadata: slotMetadata(
          scopeSha256,
          replayKeySha256,
          'reservation',
          attempt,
        ) as Readonly<Record<string, string | number | boolean | null>>,
        maxMatches: 1,
      },
    );
  } catch (caught) {
    const reloaded = await inspectMcpDirectDurableReplayStatusInternal(
      coordinator,
      replayKeySha256,
      now,
    ).catch(() => undefined);
    if (reloaded !== undefined && reloaded.state !== 'clear') {
      throw new McpDirectDurableReplayError(
        'durable-state-conflict',
        replayKeySha256,
        'attempt' in reloaded ? reloaded.attempt : attempt,
      );
    }
    throw caught;
  }

  const reservation = Object.freeze({
    format: 'furypipe-mcp-direct-durable-reservation-evidence/v1' as const,
    scopeSha256,
    replayKeySha256,
    attempt,
    reservationIdSha256,
    leaseExpiresAt,
    replayed,
    ...(replayReason === undefined ? {} : { replayReason }),
    ...(priorResultSha256 === undefined ? {} : { priorResultSha256 }),
  });
  RESERVATIONS.set(reservation, Object.freeze({ coordinator, handle, record }));
  return reservation;
}

export async function abortMcpDirectDurablePreCallReservation(
  coordinator: McpDirectDurableReplayCoordinator,
  reservation: McpDirectDurableReservation,
): Promise<void> {
  const state = RESERVATIONS.get(reservation as object);
  if (!state || state.coordinator !== coordinator) {
    throw new McpDirectDurableReplayError(
      'durable-state-corrupt',
      reservation?.replayKeySha256,
      reservation?.attempt,
    );
  }
  if (ARMED.has(reservation as object)) {
    throw new McpDirectDurableReplayError(
      'durable-state-conflict',
      reservation.replayKeySha256,
      reservation.attempt,
    );
  }
  const { store } = requiredStore(coordinator);
  await store.delete(state.handle);
  RESERVATIONS.delete(reservation as object);
}

export async function armMcpDirectDurableExecution(
  coordinator: McpDirectDurableReplayCoordinator,
  reservation: McpDirectDurableReservation,
  nowValue?: number,
): Promise<McpDirectDurableArmedEvidence> {
  const reservationState = RESERVATIONS.get(reservation as object);
  if (!reservationState || reservationState.coordinator !== coordinator) {
    throw new McpDirectDurableReplayError(
      'durable-state-corrupt',
      reservation?.replayKeySha256,
      reservation?.attempt,
    );
  }
  const now = timestamp(nowValue);
  if (now >= reservationState.record.leaseExpiresAt) {
    throw new McpDirectDurableReplayError(
      'durable-reservation-expired',
      reservation.replayKeySha256,
      reservation.attempt,
    );
  }
  if (ARMED.has(reservation as object)) {
    throw new McpDirectDurableReplayError(
      'durable-state-conflict',
      reservation.replayKeySha256,
      reservation.attempt,
    );
  }

  const { store, scopeSha256 } = requiredStore(coordinator);
  const record: DurableArmedRecord = Object.freeze({
    format: 'furypipe-mcp-direct-durable-armed/v1',
    scopeSha256,
    replayKeySha256: reservation.replayKeySha256,
    attempt: reservation.attempt,
    reservationIdSha256: reservation.reservationIdSha256,
    armedAt: now,
    replayed: reservation.replayed,
  });
  const recordMetadata = metadata(
    scopeSha256,
    reservation.replayKeySha256,
    'armed',
    reservation.attempt,
    reservation.reservationIdSha256,
  );
  const reservationMetadata = metadata(
    scopeSha256,
    reservation.replayKeySha256,
    'reservation',
    reservation.attempt,
    reservation.reservationIdSha256,
  );
  let handle: RecoveryHandle;
  try {
    handle = await store.putBounded(
      canonicalBytes(record),
      recordMetadata,
      {
        metadata: slotMetadata(
          scopeSha256,
          reservation.replayKeySha256,
          'armed',
          reservation.attempt,
        ) as Readonly<Record<string, string | number | boolean | null>>,
        maxMatches: 1,
        matchConstraints: [{
          metadata: reservationMetadata as Readonly<Record<string, string | number | boolean | null>>,
          minMatches: 1,
          maxMatches: 1,
        }],
      },
    );
  } catch (caught) {
    const current = await inspectMcpDirectDurableReplayStatusInternal(
      coordinator,
      reservation.replayKeySha256,
      now,
    ).catch(() => undefined);
    if (current?.state !== 'pre_call' || current.attempt !== reservation.attempt) {
      throw new McpDirectDurableReplayError(
        'durable-state-conflict',
        reservation.replayKeySha256,
        reservation.attempt,
      );
    }
    throw caught;
  }
  const armedRecordSha256 = handle.digest;
  const armed = Object.freeze({
    format: 'furypipe-mcp-direct-durable-armed-evidence/v1' as const,
    scopeSha256,
    replayKeySha256: reservation.replayKeySha256,
    attempt: reservation.attempt,
    reservationIdSha256: reservation.reservationIdSha256,
    armedRecordSha256,
    replayed: reservation.replayed,
  });
  const armedState = Object.freeze({ coordinator, handle, record, reservation });
  ARMED.set(armed, armedState);
  ARMED.set(reservation as object, armedState);
  return armed;
}

export async function abortMcpDirectDurableArmedBeforeCall(
  coordinator: McpDirectDurableReplayCoordinator,
  armed: McpDirectDurableArmedEvidence,
): Promise<void> {
  const armedState = ARMED.get(armed as object);
  if (!armedState || armedState.coordinator !== coordinator || SETTLED.has(armed as object)) {
    throw new McpDirectDurableReplayError(
      'durable-state-corrupt',
      armed?.replayKeySha256,
      armed?.attempt,
    );
  }
  const reservationState = RESERVATIONS.get(armedState.reservation as object);
  if (!reservationState || reservationState.coordinator !== coordinator) {
    throw new McpDirectDurableReplayError(
      'durable-state-corrupt',
      armed.replayKeySha256,
      armed.attempt,
    );
  }

  const { store } = requiredStore(coordinator);
  // Delete the armed marker first. Until the reservation is also deleted, any
  // observer remains fail-closed at pre_call. Only after both deletes may a
  // fresh execution reserve this key again.
  await store.delete(armedState.handle);
  await store.delete(reservationState.handle);
  SETTLED.add(armed as object);
  ARMED.delete(armed as object);
  ARMED.delete(armedState.reservation as object);
  RESERVATIONS.delete(armedState.reservation as object);
}

export async function settleMcpDirectDurableExecution(
  coordinator: McpDirectDurableReplayCoordinator,
  armed: McpDirectDurableArmedEvidence,
  outcome: McpDirectDurableReplayOutcome,
  evidence: McpDirectDurableSettleEvidence = {},
): Promise<McpDirectDurableReplayStatus> {
  const armedState = ARMED.get(armed as object);
  if (!armedState || armedState.coordinator !== coordinator || SETTLED.has(armed as object)) {
    throw new McpDirectDurableReplayError(
      'durable-state-corrupt',
      armed?.replayKeySha256,
      armed?.attempt,
    );
  }
  if (!['succeeded', 'tool_error', 'unknown', 'evidence_failed', 'verification_failed'].includes(outcome)) {
    throw new Error('unsupported MCP durable terminal outcome');
  }
  if (evidence.resultSha256 !== undefined) assertSha(evidence.resultSha256, 'resultSha256');
  if (
    (outcome === 'succeeded' && evidence.succeeded !== true)
    || (outcome === 'tool_error' && evidence.succeeded !== false)
    || (outcome === 'verification_failed' && evidence.succeeded !== true)
    || (outcome === 'unknown' && evidence.succeeded !== undefined)
  ) {
    throw new Error('MCP durable terminal outcome has inconsistent succeeded evidence');
  }

  const { store, scopeSha256 } = requiredStore(coordinator);
  const now = timestamp(evidence.now);
  const record: DurableTerminalRecord = Object.freeze({
    format: 'furypipe-mcp-direct-durable-terminal/v1',
    scopeSha256,
    replayKeySha256: armed.replayKeySha256,
    attempt: armed.attempt,
    reservationIdSha256: armed.reservationIdSha256,
    armedRecordSha256: armed.armedRecordSha256,
    terminalAt: now,
    replayed: armed.replayed,
    outcome,
    ...(evidence.resultSha256 === undefined ? {} : { resultSha256: evidence.resultSha256 }),
    ...(evidence.succeeded === undefined ? {} : { succeeded: evidence.succeeded }),
  });
  const recordMetadata = metadata(
    scopeSha256,
    armed.replayKeySha256,
    'terminal',
    armed.attempt,
    armed.reservationIdSha256,
  );
  const armedMetadata = metadata(
    scopeSha256,
    armed.replayKeySha256,
    'armed',
    armed.attempt,
    armed.reservationIdSha256,
  );
  await store.putBounded(
    canonicalBytes(record),
    recordMetadata,
    {
      metadata: slotMetadata(
        scopeSha256,
        armed.replayKeySha256,
        'terminal',
        armed.attempt,
      ) as Readonly<Record<string, string | number | boolean | null>>,
      maxMatches: 1,
      matchConstraints: [{
        metadata: armedMetadata as Readonly<Record<string, string | number | boolean | null>>,
        minMatches: 1,
        maxMatches: 1,
      }],
    },
  );
  SETTLED.add(armed as object);
  return inspectMcpDirectDurableReplayStatusInternal(
    coordinator,
    armed.replayKeySha256,
    now,
  );
}