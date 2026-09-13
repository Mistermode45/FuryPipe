import { createHash } from 'node:crypto';

import type { RecoveryHandle, RecoveryStore } from './core/recovery-store.js';
import type { FuryProviderExecutionAuditChain } from './provider-execution-audit-chain.js';
import {
  appendProviderExecutionAuditLedger,
  verifyProviderExecutionAuditLedger,
  type FuryProviderExecutionAuditLedger,
} from './provider-execution-audit-ledger.js';

const HEX64 = /^[0-9a-f]{64}$/u;
const RECOVERY_HANDLE = /^furypipe-recovery\/v1\/sha256\/([0-9a-f]{64})$/u;
const SNAPSHOT_SOURCE = 'furypipe-provider-execution-audit-ledger-recovery/v1';
const SNAPSHOT_KIND = 'provider-execution-audit-ledger-snapshot';
const MAX_LINEAGE_DEPTH = 10_001;

export interface FuryProviderExecutionAuditLedgerSnapshotParent {
  readonly ledgerDigest: string;
  readonly recoveryDigest: string;
}

export interface FuryProviderExecutionAuditLedgerSnapshot {
  readonly format: 'furypipe-provider-execution-audit-ledger-snapshot/v1';
  readonly recoveryHandle: string;
  readonly recoveryDigest: string;
  readonly bytes: number;
  readonly ledgerDigest: string;
  readonly count: number;
  readonly headDigest: string | null;
  readonly parent: FuryProviderExecutionAuditLedgerSnapshotParent | null;
  readonly verification: {
    readonly recoveryObjectDigestIntegrity: 'verified';
    readonly ledgerDigestIntegrity: 'verified';
    readonly snapshotPayloadIntegrity: 'verified';
    readonly ledgerProvenance: 'not-verified';
    readonly snapshotProvenance: 'not-verified';
  };
}

export interface LoadedProviderExecutionAuditLedgerSnapshot {
  readonly snapshot: FuryProviderExecutionAuditLedgerSnapshot;
  readonly ledger: FuryProviderExecutionAuditLedger;
}

export interface ProviderExecutionAuditLedgerSnapshotLineageVerification {
  readonly format: 'furypipe-provider-execution-audit-ledger-snapshot-lineage/v1';
  readonly depth: number;
  readonly rootRecoveryDigest: string;
  readonly rootLedgerDigest: string;
  readonly headRecoveryDigest: string;
  readonly headLedgerDigest: string;
  readonly continuity: 'verified';
  readonly globalHead: 'not-verified';
  readonly ledgerProvenance: 'not-verified';
  readonly snapshotProvenance: 'not-verified';
}

interface ProviderExecutionAuditLedgerSnapshotPayload {
  readonly format: 'furypipe-provider-execution-audit-ledger-snapshot-payload/v1';
  readonly ledger: FuryProviderExecutionAuditLedger;
  readonly parent: FuryProviderExecutionAuditLedgerSnapshotParent | null;
  readonly provenance: {
    readonly ledgerProvenance: 'not-verified';
    readonly snapshotProvenance: 'not-verified';
  };
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('audit ledger snapshot canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value !== 'object') throw new Error('audit ledger snapshot canonical JSON contains an unsupported value');

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('audit ledger snapshot canonical JSON requires plain objects');
  }
  const parts: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined) {
      throw new Error('audit ledger snapshot canonical JSON requires defined data properties');
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`);
  }
  return `{${parts.join(',')}}`;
}

function plainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a plain object`);
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new Error(`${label} properties are not safely readable`);
  }
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object`);

  const safe = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== 'string') throw new Error(`${label} contains a symbol property`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new Error(`${label} properties are not safely readable`);
    }
    if (!descriptor || !('value' in descriptor)) throw new Error(`${label} contains an accessor property`);
    safe[key] = descriptor.value;
  }
  return safe;
}

function exactKeys(record: Readonly<Record<string, unknown>>, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unsupported or missing fields`);
  }
}

function exactDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HEX64.test(value)) throw new Error(`${label} must be lowercase SHA-256`);
  return value;
}

function exactCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    throw new Error(`${label} must be an integer from 0 to 10000`);
  }
  return value as number;
}

function recoveryHandleString(handle: RecoveryHandle | string): string {
  if (typeof handle === 'string') {
    if (!RECOVERY_HANDLE.test(handle)) throw new Error('provider audit snapshot recovery handle is invalid');
    return handle;
  }
  const record = plainRecord(handle, 'provider audit snapshot recovery handle');
  if (record.format !== 'furypipe-recovery/v1' || record.algorithm !== 'sha256') {
    throw new Error('provider audit snapshot recovery handle is invalid');
  }
  const digest = exactDigest(record.digest, 'provider audit snapshot recovery digest');
  return `furypipe-recovery/v1/sha256/${digest}`;
}

function recoveryDigestFromHandle(handle: RecoveryHandle | string): string {
  const match = RECOVERY_HANDLE.exec(recoveryHandleString(handle));
  if (!match?.[1]) throw new Error('provider audit snapshot recovery handle is invalid');
  return match[1];
}

function parseParent(value: unknown): FuryProviderExecutionAuditLedgerSnapshotParent | null {
  if (value === null) return null;
  const record = plainRecord(value, 'provider audit snapshot parent');
  exactKeys(record, ['ledgerDigest', 'recoveryDigest'], 'provider audit snapshot parent');
  return Object.freeze({
    ledgerDigest: exactDigest(record.ledgerDigest, 'provider audit snapshot parent ledger digest'),
    recoveryDigest: exactDigest(record.recoveryDigest, 'provider audit snapshot parent recovery digest'),
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    if (Array.isArray(value)) {
      for (const item of value) deepFreeze(item);
    } else {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
        if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value);
      }
    }
    Object.freeze(value);
  }
  return value;
}

function parsePayload(bytes: Uint8Array): ProviderExecutionAuditLedgerSnapshotPayload {
  let text: string;
  let parsed: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('provider audit snapshot payload is not canonical UTF-8 JSON');
  }

  const record = plainRecord(parsed, 'provider audit snapshot payload');
  exactKeys(record, ['format', 'ledger', 'parent', 'provenance'], 'provider audit snapshot payload');
  if (record.format !== 'furypipe-provider-execution-audit-ledger-snapshot-payload/v1') {
    throw new Error('provider audit snapshot payload format is invalid');
  }

  const provenance = plainRecord(record.provenance, 'provider audit snapshot provenance');
  exactKeys(provenance, ['ledgerProvenance', 'snapshotProvenance'], 'provider audit snapshot provenance');
  if (provenance.ledgerProvenance !== 'not-verified' || provenance.snapshotProvenance !== 'not-verified') {
    throw new Error('provider audit snapshot provenance semantics are invalid');
  }

  const ledger = record.ledger as FuryProviderExecutionAuditLedger;
  if (!verifyProviderExecutionAuditLedger(ledger)) {
    throw new Error('provider audit snapshot ledger integrity check failed');
  }
  const parent = parseParent(record.parent);

  const normalized: ProviderExecutionAuditLedgerSnapshotPayload = {
    format: 'furypipe-provider-execution-audit-ledger-snapshot-payload/v1',
    ledger,
    parent,
    provenance: {
      ledgerProvenance: 'not-verified',
      snapshotProvenance: 'not-verified',
    },
  };
  const canonical = canonicalJson(normalized);
  if (new TextEncoder().encode(canonical).byteLength !== bytes.byteLength || canonical !== text) {
    throw new Error('provider audit snapshot payload is not canonically encoded');
  }
  return deepFreeze(normalized);
}

function snapshotRef(
  payload: ProviderExecutionAuditLedgerSnapshotPayload,
  recoveryHandle: string,
  recoveryDigest: string,
  bytes: number,
): FuryProviderExecutionAuditLedgerSnapshot {
  return Object.freeze({
    format: 'furypipe-provider-execution-audit-ledger-snapshot/v1',
    recoveryHandle,
    recoveryDigest,
    bytes,
    ledgerDigest: payload.ledger.ledgerDigest,
    count: payload.ledger.count,
    headDigest: payload.ledger.headDigest,
    parent: payload.parent,
    verification: Object.freeze({
      recoveryObjectDigestIntegrity: 'verified',
      ledgerDigestIntegrity: 'verified',
      snapshotPayloadIntegrity: 'verified',
      ledgerProvenance: 'not-verified',
      snapshotProvenance: 'not-verified',
    }),
  });
}

function assertSnapshotRefMatches(
  declared: FuryProviderExecutionAuditLedgerSnapshot,
  loaded: FuryProviderExecutionAuditLedgerSnapshot,
): void {
  const record = plainRecord(declared, 'provider audit snapshot reference');
  exactKeys(
    record,
    ['format', 'recoveryHandle', 'recoveryDigest', 'bytes', 'ledgerDigest', 'count', 'headDigest', 'parent', 'verification'],
    'provider audit snapshot reference',
  );
  if (
    record.format !== loaded.format
    || record.recoveryHandle !== loaded.recoveryHandle
    || record.recoveryDigest !== loaded.recoveryDigest
    || record.bytes !== loaded.bytes
    || record.ledgerDigest !== loaded.ledgerDigest
    || record.count !== loaded.count
    || record.headDigest !== loaded.headDigest
    || canonicalJson(record.parent) !== canonicalJson(loaded.parent)
    || canonicalJson(record.verification) !== canonicalJson(loaded.verification)
  ) {
    throw new Error('provider audit snapshot reference does not match durable content');
  }
}

async function persistSnapshot(
  store: RecoveryStore,
  ledger: FuryProviderExecutionAuditLedger,
  parent: FuryProviderExecutionAuditLedgerSnapshotParent | null,
): Promise<FuryProviderExecutionAuditLedgerSnapshot> {
  if (!store || typeof store.put !== 'function' || typeof store.verify !== 'function' || typeof store.get !== 'function') {
    throw new TypeError('provider audit snapshot persistence requires a RecoveryStore');
  }
  if (!verifyProviderExecutionAuditLedger(ledger)) {
    throw new Error('provider audit snapshot refuses an invalid ledger');
  }

  const payload: ProviderExecutionAuditLedgerSnapshotPayload = deepFreeze({
    format: 'furypipe-provider-execution-audit-ledger-snapshot-payload/v1',
    ledger,
    parent,
    provenance: {
      ledgerProvenance: 'not-verified',
      snapshotProvenance: 'not-verified',
    },
  });
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const expectedRecoveryDigest = sha256Bytes(bytes);
  const handle = await store.put(bytes, {
    contentType: 'application/vnd.furypipe.provider-execution-audit-ledger-snapshot+json',
    source: SNAPSHOT_SOURCE,
    kind: SNAPSHOT_KIND,
    ledgerDigest: ledger.ledgerDigest,
    ledgerCount: ledger.count,
    headDigest: ledger.headDigest,
    parentLedgerDigest: parent?.ledgerDigest ?? null,
    parentRecoveryDigest: parent?.recoveryDigest ?? null,
    plaintextFree: true,
  });
  const handleString = recoveryHandleString(handle);
  const recoveryDigest = recoveryDigestFromHandle(handle);
  if (recoveryDigest !== expectedRecoveryDigest || handle.bytes !== bytes.byteLength) {
    throw new Error('provider audit snapshot RecoveryStore returned an inconsistent content-addressed handle');
  }
  const verification = await store.verify(handle);
  if (
    !verification.ok
    || !verification.exists
    || !verification.digestMatches
    || verification.handle !== handleString
    || verification.bytes !== bytes.byteLength
  ) {
    throw new Error('provider audit snapshot RecoveryStore verification failed after persist');
  }

  return snapshotRef(payload, handleString, recoveryDigest, bytes.byteLength);
}

export async function persistProviderExecutionAuditLedgerSnapshot(
  store: RecoveryStore,
  ledger: FuryProviderExecutionAuditLedger,
): Promise<FuryProviderExecutionAuditLedgerSnapshot> {
  return persistSnapshot(store, ledger, null);
}

export async function loadProviderExecutionAuditLedgerSnapshot(
  store: RecoveryStore,
  handle: RecoveryHandle | string,
  expectedLedgerDigest?: string,
): Promise<LoadedProviderExecutionAuditLedgerSnapshot> {
  if (!store || typeof store.get !== 'function' || typeof store.verify !== 'function') {
    throw new TypeError('provider audit snapshot loading requires a RecoveryStore');
  }
  const handleString = recoveryHandleString(handle);
  const recoveryDigest = recoveryDigestFromHandle(handleString);
  if (expectedLedgerDigest !== undefined) exactDigest(expectedLedgerDigest, 'expected provider audit ledger digest');

  const verification = await store.verify(handleString);
  if (!verification.ok || !verification.exists || !verification.digestMatches || verification.handle !== handleString) {
    throw new Error('provider audit snapshot RecoveryStore object failed integrity verification');
  }
  const bytes = await store.get(handleString);
  if (sha256Bytes(bytes) !== recoveryDigest || verification.bytes !== bytes.byteLength) {
    throw new Error('provider audit snapshot RecoveryStore bytes do not match their content address');
  }

  const payload = parsePayload(bytes);
  if (expectedLedgerDigest !== undefined && payload.ledger.ledgerDigest !== expectedLedgerDigest) {
    throw new Error('provider audit snapshot does not match the expected ledger digest anchor');
  }
  const snapshot = snapshotRef(payload, handleString, recoveryDigest, bytes.byteLength);
  return Object.freeze({ snapshot, ledger: payload.ledger });
}

export async function appendProviderExecutionAuditLedgerSnapshot(
  store: RecoveryStore,
  parent: FuryProviderExecutionAuditLedgerSnapshot,
  chain: FuryProviderExecutionAuditChain,
): Promise<FuryProviderExecutionAuditLedgerSnapshot> {
  const loaded = await loadProviderExecutionAuditLedgerSnapshot(
    store,
    parent.recoveryHandle,
    parent.ledgerDigest,
  );
  assertSnapshotRefMatches(parent, loaded.snapshot);

  const nextLedger = appendProviderExecutionAuditLedger(loaded.ledger, chain);
  return persistSnapshot(store, nextLedger, {
    ledgerDigest: loaded.snapshot.ledgerDigest,
    recoveryDigest: loaded.snapshot.recoveryDigest,
  });
}

export async function findProviderExecutionAuditLedgerSnapshot(
  store: RecoveryStore,
  ledgerDigest: string,
): Promise<LoadedProviderExecutionAuditLedgerSnapshot | undefined> {
  const digest = exactDigest(ledgerDigest, 'provider audit ledger discovery digest');
  if (!store || typeof store.list !== 'function') {
    throw new Error('provider audit snapshot discovery requires RecoveryStore.list');
  }
  const matches = await store.list({
    metadata: {
      source: SNAPSHOT_SOURCE,
      kind: SNAPSHOT_KIND,
      ledgerDigest: digest,
    },
    limit: 2,
  });
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new Error('provider audit snapshot discovery is ambiguous for the exact ledger digest');
  }
  return loadProviderExecutionAuditLedgerSnapshot(store, matches[0]!, digest);
}

function verifyLedgerExtension(
  parent: FuryProviderExecutionAuditLedger,
  child: FuryProviderExecutionAuditLedger,
): void {
  if (child.count !== parent.count + 1 || child.entries.length !== parent.entries.length + 1) {
    throw new Error('provider audit snapshot lineage does not represent exactly one append');
  }
  for (let index = 0; index < parent.entries.length; index += 1) {
    if (child.entries[index]?.entryDigest !== parent.entries[index]?.entryDigest) {
      throw new Error('provider audit snapshot lineage changed an existing ledger prefix');
    }
  }
  const appended = child.entries[child.entries.length - 1];
  if (!appended || appended.previousEntryDigest !== parent.headDigest) {
    throw new Error('provider audit snapshot lineage append link does not match the parent head');
  }
}

export async function verifyProviderExecutionAuditLedgerSnapshotLineage(
  store: RecoveryStore,
  head: FuryProviderExecutionAuditLedgerSnapshot,
): Promise<ProviderExecutionAuditLedgerSnapshotLineageVerification> {
  let current = await loadProviderExecutionAuditLedgerSnapshot(
    store,
    head.recoveryHandle,
    head.ledgerDigest,
  );
  assertSnapshotRefMatches(head, current.snapshot);

  const headRecoveryDigest = current.snapshot.recoveryDigest;
  const headLedgerDigest = current.snapshot.ledgerDigest;
  const seen = new Set<string>();
  let depth = 1;

  while (current.snapshot.parent !== null) {
    if (seen.has(current.snapshot.recoveryDigest)) {
      throw new Error('provider audit snapshot lineage contains a recovery-object cycle');
    }
    seen.add(current.snapshot.recoveryDigest);
    if (depth >= MAX_LINEAGE_DEPTH) {
      throw new Error('provider audit snapshot lineage exceeds the bounded verification depth');
    }

    const parentLink = current.snapshot.parent;
    const parentHandle = `furypipe-recovery/v1/sha256/${parentLink.recoveryDigest}`;
    const parent = await loadProviderExecutionAuditLedgerSnapshot(
      store,
      parentHandle,
      parentLink.ledgerDigest,
    );
    verifyLedgerExtension(parent.ledger, current.ledger);
    current = parent;
    depth += 1;
  }

  if (seen.has(current.snapshot.recoveryDigest)) {
    throw new Error('provider audit snapshot lineage contains a recovery-object cycle');
  }

  return Object.freeze({
    format: 'furypipe-provider-execution-audit-ledger-snapshot-lineage/v1',
    depth,
    rootRecoveryDigest: current.snapshot.recoveryDigest,
    rootLedgerDigest: current.snapshot.ledgerDigest,
    headRecoveryDigest,
    headLedgerDigest,
    continuity: 'verified',
    globalHead: 'not-verified',
    ledgerProvenance: 'not-verified',
    snapshotProvenance: 'not-verified',
  });
}
