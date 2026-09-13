import { createHash } from 'node:crypto';

import type { FuryProviderExecutionAuditChain } from './provider-execution-audit-chain.js';

export interface FuryProviderExecutionAuditLedgerEntry {
  readonly index: number;
  readonly chainDigest: string;
  readonly previousEntryDigest: string | null;
  readonly scope: {
    readonly providerId: string;
    readonly model: string;
    readonly workloadId: string;
  };
  readonly execution: {
    readonly protocol: FuryProviderExecutionAuditChain['execution']['protocol'];
    readonly requestDigest: string;
    readonly outcome: FuryProviderExecutionAuditChain['execution']['outcome'];
    readonly providerResult: FuryProviderExecutionAuditChain['execution']['providerResult'];
  };
  readonly sourceChainProvenance: 'not-verified';
  readonly entryDigest: string;
}

export interface FuryProviderExecutionAuditLedger {
  readonly format: 'furypipe-provider-execution-audit-ledger/v1';
  readonly entries: readonly FuryProviderExecutionAuditLedgerEntry[];
  readonly count: number;
  readonly headDigest: string | null;
  readonly verification: {
    readonly sourceChainDigestIntegrity: 'verified-at-append';
    readonly entryDigestIntegrity: 'verified';
    readonly linkContinuity: 'verified';
    readonly duplicateReplayProtection: 'verified';
    readonly sourceChainProvenance: 'not-verified';
    readonly ledgerProvenance: 'not-verified';
  };
  readonly ledgerDigest: string;
}

const HEX64 = /^[0-9a-f]{64}$/u;
const MAX_SCOPE_CHARS = 256;
const MAX_LEDGER_ENTRIES = 10_000;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('audit ledger canonical JSON does not support non-finite numbers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value !== 'object') {
    throw new Error('audit ledger canonical JSON contains an unsupported value');
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('audit ledger canonical JSON requires plain objects');
  }

  const parts: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined) {
      throw new Error('audit ledger canonical JSON requires defined data properties');
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`);
  }
  return `{${parts.join(',')}}`;
}

function plainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} contains unsupported or missing fields`);
  }
}

function exactScope(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_SCOPE_CHARS
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be an exact bounded printable identifier`);
  }
  return value;
}

function exactDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HEX64.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function verifyAuditChainIntegrity(chain: FuryProviderExecutionAuditChain): {
  readonly chainDigest: string;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly execution: FuryProviderExecutionAuditChain['execution'];
} {
  const record = plainRecord(chain, 'provider execution audit chain');
  exactKeys(
    record,
    [
      'format',
      'providerId',
      'model',
      'workloadId',
      'receipts',
      'continuity',
      'execution',
      'provenance',
      'verification',
      'chainDigest',
    ],
    'provider execution audit chain',
  );

  if (record.format !== 'furypipe-provider-execution-audit-chain/v1') {
    throw new Error('provider execution audit chain format is invalid');
  }

  const chainDigest = exactDigest(record.chainDigest, 'audit chain digest');
  const core: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (key === 'chainDigest') continue;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new Error('provider execution audit chain contains an accessor');
    }
    core[key] = descriptor.value;
  }
  if (sha256(canonicalJson(core)) !== chainDigest) {
    throw new Error('provider execution audit chain digest integrity check failed');
  }

  const providerId = exactScope(record.providerId, 'audit chain providerId');
  const model = exactScope(record.model, 'audit chain model');
  const workloadId = exactScope(record.workloadId, 'audit chain workloadId');

  const execution = plainRecord(record.execution, 'audit chain execution');
  exactKeys(
    execution,
    ['protocol', 'requestDigest', 'outcome', 'providerResult'],
    'audit chain execution',
  );
  if (
    execution.protocol !== 'openai'
    && execution.protocol !== 'anthropic'
    && execution.protocol !== 'google'
  ) {
    throw new Error('audit chain execution protocol is invalid');
  }
  exactDigest(execution.requestDigest, 'audit chain requestDigest');
  if (execution.outcome !== 'success' && execution.outcome !== 'error') {
    throw new Error('audit chain execution outcome is invalid');
  }
  if (
    execution.providerResult !== 'transport-reported'
    && execution.providerResult !== 'partially-transport-reported'
    && execution.providerResult !== 'not-reported'
    && execution.providerResult !== 'not-executed'
  ) {
    throw new Error('audit chain provider result is invalid');
  }

  const provenance = plainRecord(record.provenance, 'audit chain provenance');
  if (provenance.chainProvenance !== 'not-verified') {
    throw new Error('audit chain provenance must remain not-verified');
  }

  const verification = plainRecord(record.verification, 'audit chain verification');
  if (
    verification.receiptDigestIntegrity !== 'verified'
    || verification.structuralContinuity !== 'verified'
    || verification.sourceObjectProvenance !== 'not-verified'
  ) {
    throw new Error('audit chain verification semantics are invalid');
  }

  return Object.freeze({
    chainDigest,
    providerId,
    model,
    workloadId,
    execution: Object.freeze({
      protocol: execution.protocol,
      requestDigest: execution.requestDigest,
      outcome: execution.outcome,
      providerResult: execution.providerResult,
    }) as FuryProviderExecutionAuditChain['execution'],
  });
}

function entryCore(input: {
  readonly index: number;
  readonly chainDigest: string;
  readonly previousEntryDigest: string | null;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly execution: FuryProviderExecutionAuditChain['execution'];
}): Omit<FuryProviderExecutionAuditLedgerEntry, 'entryDigest'> {
  return Object.freeze({
    index: input.index,
    chainDigest: input.chainDigest,
    previousEntryDigest: input.previousEntryDigest,
    scope: Object.freeze({
      providerId: input.providerId,
      model: input.model,
      workloadId: input.workloadId,
    }),
    execution: Object.freeze({
      protocol: input.execution.protocol,
      requestDigest: input.execution.requestDigest,
      outcome: input.execution.outcome,
      providerResult: input.execution.providerResult,
    }),
    sourceChainProvenance: 'not-verified',
  });
}

function createEntry(
  index: number,
  previousEntryDigest: string | null,
  chain: FuryProviderExecutionAuditChain,
): FuryProviderExecutionAuditLedgerEntry {
  const validated = verifyAuditChainIntegrity(chain);
  const core = entryCore({
    index,
    chainDigest: validated.chainDigest,
    previousEntryDigest,
    providerId: validated.providerId,
    model: validated.model,
    workloadId: validated.workloadId,
    execution: validated.execution,
  });
  return Object.freeze({
    ...core,
    entryDigest: sha256(canonicalJson(core)),
  });
}

function validateEntry(
  entry: FuryProviderExecutionAuditLedgerEntry,
  expectedIndex: number,
  expectedPreviousDigest: string | null,
): FuryProviderExecutionAuditLedgerEntry {
  const record = plainRecord(entry, `audit ledger entry ${expectedIndex}`);
  exactKeys(
    record,
    [
      'index',
      'chainDigest',
      'previousEntryDigest',
      'scope',
      'execution',
      'sourceChainProvenance',
      'entryDigest',
    ],
    `audit ledger entry ${expectedIndex}`,
  );

  if (!Number.isSafeInteger(record.index) || record.index !== expectedIndex) {
    throw new Error('audit ledger entry index continuity failed');
  }
  const chainDigest = exactDigest(record.chainDigest, 'audit ledger chainDigest');
  if (record.previousEntryDigest !== expectedPreviousDigest) {
    throw new Error('audit ledger previous-entry link continuity failed');
  }

  const scope = plainRecord(record.scope, 'audit ledger entry scope');
  exactKeys(scope, ['providerId', 'model', 'workloadId'], 'audit ledger entry scope');
  const providerId = exactScope(scope.providerId, 'audit ledger providerId');
  const model = exactScope(scope.model, 'audit ledger model');
  const workloadId = exactScope(scope.workloadId, 'audit ledger workloadId');

  const execution = plainRecord(record.execution, 'audit ledger entry execution');
  exactKeys(
    execution,
    ['protocol', 'requestDigest', 'outcome', 'providerResult'],
    'audit ledger entry execution',
  );
  if (
    execution.protocol !== 'openai'
    && execution.protocol !== 'anthropic'
    && execution.protocol !== 'google'
  ) {
    throw new Error('audit ledger entry protocol is invalid');
  }
  const requestDigest = exactDigest(execution.requestDigest, 'audit ledger requestDigest');
  if (execution.outcome !== 'success' && execution.outcome !== 'error') {
    throw new Error('audit ledger entry outcome is invalid');
  }
  if (
    execution.providerResult !== 'transport-reported'
    && execution.providerResult !== 'partially-transport-reported'
    && execution.providerResult !== 'not-reported'
    && execution.providerResult !== 'not-executed'
  ) {
    throw new Error('audit ledger entry provider result is invalid');
  }
  if (record.sourceChainProvenance !== 'not-verified') {
    throw new Error('audit ledger source chain provenance must remain not-verified');
  }

  const entryDigest = exactDigest(record.entryDigest, 'audit ledger entryDigest');
  const core = entryCore({
    index: expectedIndex,
    chainDigest,
    previousEntryDigest: expectedPreviousDigest,
    providerId,
    model,
    workloadId,
    execution: {
      protocol: execution.protocol,
      requestDigest,
      outcome: execution.outcome,
      providerResult: execution.providerResult,
    } as FuryProviderExecutionAuditChain['execution'],
  });
  if (sha256(canonicalJson(core)) !== entryDigest) {
    throw new Error('audit ledger entry digest integrity check failed');
  }

  return Object.freeze({
    ...core,
    entryDigest,
  });
}

function ledgerCore(
  entries: readonly FuryProviderExecutionAuditLedgerEntry[],
): Omit<FuryProviderExecutionAuditLedger, 'ledgerDigest'> {
  const frozenEntries = Object.freeze([...entries]);
  return Object.freeze({
    format: 'furypipe-provider-execution-audit-ledger/v1',
    entries: frozenEntries,
    count: frozenEntries.length,
    headDigest: frozenEntries.length === 0
      ? null
      : frozenEntries[frozenEntries.length - 1]!.entryDigest,
    verification: Object.freeze({
      sourceChainDigestIntegrity: 'verified-at-append',
      entryDigestIntegrity: 'verified',
      linkContinuity: 'verified',
      duplicateReplayProtection: 'verified',
      sourceChainProvenance: 'not-verified',
      ledgerProvenance: 'not-verified',
    }),
  });
}

function makeLedger(
  entries: readonly FuryProviderExecutionAuditLedgerEntry[],
): FuryProviderExecutionAuditLedger {
  const core = ledgerCore(entries);
  return Object.freeze({
    ...core,
    ledgerDigest: sha256(canonicalJson(core)),
  });
}

function validatedLedgerEntries(
  ledger: FuryProviderExecutionAuditLedger,
): readonly FuryProviderExecutionAuditLedgerEntry[] {
  const record = plainRecord(ledger, 'provider execution audit ledger');
  exactKeys(
    record,
    ['format', 'entries', 'count', 'headDigest', 'verification', 'ledgerDigest'],
    'provider execution audit ledger',
  );
  if (record.format !== 'furypipe-provider-execution-audit-ledger/v1') {
    throw new Error('provider execution audit ledger format is invalid');
  }
  if (!Array.isArray(record.entries) || record.entries.length > MAX_LEDGER_ENTRIES) {
    throw new Error(`audit ledger entries must contain at most ${MAX_LEDGER_ENTRIES} entries`);
  }
  if (!Number.isSafeInteger(record.count) || record.count !== record.entries.length) {
    throw new Error('audit ledger count is inconsistent');
  }

  const verification = plainRecord(record.verification, 'audit ledger verification');
  exactKeys(
    verification,
    [
      'sourceChainDigestIntegrity',
      'entryDigestIntegrity',
      'linkContinuity',
      'duplicateReplayProtection',
      'sourceChainProvenance',
      'ledgerProvenance',
    ],
    'audit ledger verification',
  );
  if (
    verification.sourceChainDigestIntegrity !== 'verified-at-append'
    || verification.entryDigestIntegrity !== 'verified'
    || verification.linkContinuity !== 'verified'
    || verification.duplicateReplayProtection !== 'verified'
    || verification.sourceChainProvenance !== 'not-verified'
    || verification.ledgerProvenance !== 'not-verified'
  ) {
    throw new Error('audit ledger verification semantics are invalid');
  }

  const entries: FuryProviderExecutionAuditLedgerEntry[] = [];
  const seenChains = new Set<string>();
  let previous: string | null = null;
  for (let index = 0; index < record.entries.length; index += 1) {
    const entry = validateEntry(
      record.entries[index] as FuryProviderExecutionAuditLedgerEntry,
      index,
      previous,
    );
    if (seenChains.has(entry.chainDigest)) {
      throw new Error('audit ledger duplicate chain replay detected');
    }
    seenChains.add(entry.chainDigest);
    entries.push(entry);
    previous = entry.entryDigest;
  }

  const expectedHead = entries.length === 0 ? null : entries[entries.length - 1]!.entryDigest;
  if (record.headDigest !== expectedHead) {
    throw new Error('audit ledger head digest is inconsistent');
  }

  const ledgerDigest = exactDigest(record.ledgerDigest, 'audit ledger digest');
  const expectedCore = ledgerCore(entries);
  if (sha256(canonicalJson(expectedCore)) !== ledgerDigest) {
    throw new Error('audit ledger digest integrity check failed');
  }

  return Object.freeze(entries);
}

export function createProviderExecutionAuditLedger(
  chains: readonly FuryProviderExecutionAuditChain[] = [],
): FuryProviderExecutionAuditLedger {
  if (!Array.isArray(chains) || chains.length > MAX_LEDGER_ENTRIES) {
    throw new Error(`audit ledger can contain at most ${MAX_LEDGER_ENTRIES} source chains`);
  }

  const entries: FuryProviderExecutionAuditLedgerEntry[] = [];
  const seen = new Set<string>();
  let previous: string | null = null;

  for (const [index, chain] of chains.entries()) {
    const entry = createEntry(index, previous, chain);
    if (seen.has(entry.chainDigest)) {
      throw new Error('audit ledger duplicate chain replay detected');
    }
    seen.add(entry.chainDigest);
    entries.push(entry);
    previous = entry.entryDigest;
  }

  return makeLedger(entries);
}

export function appendProviderExecutionAuditLedger(
  ledger: FuryProviderExecutionAuditLedger,
  chain: FuryProviderExecutionAuditChain,
): FuryProviderExecutionAuditLedger {
  const entries = validatedLedgerEntries(ledger);
  if (entries.length >= MAX_LEDGER_ENTRIES) {
    throw new Error('audit ledger entry limit reached');
  }

  const validatedChain = verifyAuditChainIntegrity(chain);
  if (entries.some((entry) => entry.chainDigest === validatedChain.chainDigest)) {
    throw new Error('audit ledger duplicate chain replay detected');
  }

  const previous = entries.length === 0 ? null : entries[entries.length - 1]!.entryDigest;
  const next = createEntry(entries.length, previous, chain);
  return makeLedger([...entries, next]);
}

export function verifyProviderExecutionAuditLedger(
  ledger: FuryProviderExecutionAuditLedger,
  expectedLedgerDigest?: string,
): boolean {
  try {
    validatedLedgerEntries(ledger);
    if (expectedLedgerDigest !== undefined) {
      if (!HEX64.test(expectedLedgerDigest) || ledger.ledgerDigest !== expectedLedgerDigest) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
