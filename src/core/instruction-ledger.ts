import { createHash } from 'node:crypto';

const MAX_INSTRUCTION_LEDGER_ENTRIES = 4_096;
const MAX_INSTRUCTION_TEXT_BYTES = 256 * 1024;
const MAX_INSTRUCTION_LEDGER_TEXT_BYTES = 8 * 1024 * 1024;
const INSTRUCTION_CATEGORIES: readonly InstructionCategory[] = [
  'objective', 'constraint', 'acceptance_criteria', 'prohibition', 'latest_user_request',
  'unresolved_question', 'decision', 'model_policy', 'task',
];
const INSTRUCTION_SOURCE_ROLES: readonly InstructionSourceRole[] = ['system', 'developer', 'user', 'assistant', 'tool'];

export type InstructionCategory =
  | 'objective'
  | 'constraint'
  | 'acceptance_criteria'
  | 'prohibition'
  | 'latest_user_request'
  | 'unresolved_question'
  | 'decision'
  | 'model_policy'
  | 'task';
export type InstructionSourceRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface InstructionEntry {
  readonly id: string;
  readonly category: InstructionCategory;
  readonly sourceRole: InstructionSourceRole;
  readonly text: string;
  readonly textHash: string;
  readonly provenance: string;
  /** Logical namespace in which a latest user request supersedes another. */
  readonly scope?: string;
  /** Explicit precedence for consumers that need deterministic conflict resolution. */
  readonly precedence?: number;
  readonly supersedes?: string;
  readonly logicalTurn: number;
  readonly active: boolean;
  readonly historical: boolean;
}

export interface InstructionLedger {
  readonly format: 'furypipe-instruction-ledger/v1';
  readonly entries: readonly InstructionEntry[];
  readonly latestUserTurnId?: string;
  readonly latestUserTurnIds?: Readonly<Record<string, string>>;
}

export interface InstructionEntryInput extends Omit<InstructionEntry, 'id' | 'textHash'> {
  readonly id?: string;
}

export interface LedgerValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

function hash(text: string): string {
  return createHash('sha256').update(new TextEncoder().encode(text)).digest('hex');
}

function instructionTextBytes(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length > MAX_INSTRUCTION_TEXT_BYTES) return undefined;
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes <= MAX_INSTRUCTION_TEXT_BYTES ? bytes : undefined;
}

function assertLedgerBounds(entries: readonly InstructionEntry[]): void {
  if (!Array.isArray(entries) || entries.length > MAX_INSTRUCTION_LEDGER_ENTRIES) {
    throw new RangeError(`instruction ledger is limited to ${MAX_INSTRUCTION_LEDGER_ENTRIES} entries`);
  }
  let totalBytes = 0;
  for (const entry of entries) {
    const bytes = instructionTextBytes(entry?.text);
    if (bytes === undefined) throw new RangeError(`instruction text exceeds the ${MAX_INSTRUCTION_TEXT_BYTES}-byte per-entry limit`);
    if (typeof entry.provenance !== 'string' || entry.provenance.length === 0 || entry.provenance.length > 512
      || (entry.scope !== undefined && (typeof entry.scope !== 'string' || entry.scope.length === 0 || entry.scope.length > 256))) {
      throw new RangeError('instruction provenance or scope exceeds its bound');
    }
    totalBytes += bytes;
    if (totalBytes > MAX_INSTRUCTION_LEDGER_TEXT_BYTES) {
      throw new RangeError(`instruction ledger text exceeds the ${MAX_INSTRUCTION_LEDGER_TEXT_BYTES}-byte total limit`);
    }
  }
}

function assertEntryInputBounds(input: InstructionEntryInput): void {
  if (!input || typeof input !== 'object' || instructionTextBytes(input.text) === undefined) {
    throw new RangeError(`instruction text exceeds the ${MAX_INSTRUCTION_TEXT_BYTES}-byte per-entry limit`);
  }
  if (typeof input.provenance !== 'string' || input.provenance.length === 0 || input.provenance.length > 512 || input.provenance.includes('\0')) {
    throw new RangeError('instruction provenance must be 1-512 characters without NUL');
  }
  if (input.scope !== undefined && (typeof input.scope !== 'string' || input.scope.length === 0 || input.scope.length > 256 || input.scope.includes('\0'))) {
    throw new RangeError('instruction scope must be 1-256 characters without NUL');
  }
  if (input.id !== undefined && (typeof input.id !== 'string' || input.id.length === 0 || input.id.length > 128 || input.id.includes('\0'))) {
    throw new RangeError('instruction ID must be 1-128 characters without NUL');
  }
  if (!INSTRUCTION_CATEGORIES.includes(input.category) || !INSTRUCTION_SOURCE_ROLES.includes(input.sourceRole)) {
    throw new TypeError('instruction category or source role is invalid');
  }
  if (!Number.isSafeInteger(input.logicalTurn) || input.logicalTurn < 0
    || typeof input.active !== 'boolean' || typeof input.historical !== 'boolean') {
    throw new TypeError('instruction turn or state flags are invalid');
  }
  if (input.precedence !== undefined && (!Number.isSafeInteger(input.precedence) || input.precedence < 0)) {
    throw new TypeError('instruction precedence must be a non-negative safe integer');
  }
  if (input.supersedes !== undefined && (typeof input.supersedes !== 'string' || input.supersedes.length === 0
    || input.supersedes.length > 128 || input.supersedes.includes('\0'))) {
    throw new TypeError('superseded instruction ID is invalid');
  }
}

function makeId(input: InstructionEntryInput, textHash: string): string {
  return `instruction_${hash([
    input.scope ?? 'global',
    input.sourceRole,
    input.logicalTurn,
    input.provenance,
    textHash,
  ].join('\0')).slice(0, 24)}`;
}

export function createInstructionEntry(input: InstructionEntryInput): InstructionEntry {
  assertEntryInputBounds(input);
  const textHash = hash(input.text);
  return { ...input, id: input.id ?? makeId(input, textHash), textHash };
}

export function createInstructionLedger(entries: readonly InstructionEntry[] = []): InstructionLedger {
  assertLedgerBounds(entries);
  const latestUserTurnIds = latestActiveUserTurns(entries);
  const latestIds = Object.values(latestUserTurnIds);
  const latestUserTurnId = [...entries].reverse().find((entry) =>
    entry.category === 'latest_user_request' && entry.sourceRole === 'user'
    && entry.active && !entry.historical,
  )?.id;
  const ledger: InstructionLedger = {
    format: 'furypipe-instruction-ledger/v1',
    entries: [...entries],
    ...(latestUserTurnId ? { latestUserTurnId } : {}),
    ...(latestIds.length ? { latestUserTurnIds } : {}),
  };
  const validation = validateInstructionLedger(ledger);
  if (!validation.ok) throw new Error(`invalid instruction ledger: ${validation.errors.join('; ')}`);
  return ledger;
}

export function appendInstructionEntry(ledger: InstructionLedger, input: InstructionEntryInput): InstructionLedger {
  assertLedgerBounds(ledger.entries);
  if (ledger.entries.length >= MAX_INSTRUCTION_LEDGER_ENTRIES) {
    throw new RangeError(`instruction ledger is limited to ${MAX_INSTRUCTION_LEDGER_ENTRIES} entries`);
  }
  assertEntryInputBounds(input);
  const scope = input.scope ?? 'global';
  const previousLatest = [...ledger.entries].reverse().find((candidate: InstructionEntry) =>
    candidate.category === 'latest_user_request' && candidate.sourceRole === 'user'
    && candidate.active && !candidate.historical && (candidate.scope ?? 'global') === scope,
  );
  const entry = createInstructionEntry({
    ...input,
    ...(input.scope === undefined ? { scope } : {}),
    ...(entrySupersedes(input) === undefined && previousLatest ? { supersedes: previousLatest.id } : {}),
  });
  const entries = previousLatest && entry.category === 'latest_user_request' && entry.sourceRole === 'user'
    ? ledger.entries.map((candidate) => candidate.id === previousLatest.id
      ? { ...candidate, active: false, historical: true }
      : candidate)
    : [...ledger.entries];
  entries.push(entry);
  const latestUserTurnId = entry.category === 'latest_user_request' && entry.sourceRole === 'user'
    ? entry.id
    : ledger.latestUserTurnId;
  const latestUserTurnIds = latestActiveUserTurns(entries);
  const next: InstructionLedger = {
    format: 'furypipe-instruction-ledger/v1',
    entries,
    ...(latestUserTurnId ? { latestUserTurnId } : {}),
    ...(Object.keys(latestUserTurnIds).length ? { latestUserTurnIds } : {}),
  };
  const validation = validateInstructionLedger(next);
  if (!validation.ok) throw new Error(`invalid instruction ledger: ${validation.errors.join('; ')}`);
  return next;
}

export function validateInstructionLedger(ledger: InstructionLedger): LedgerValidation {
  const errors: string[] = [];
  if (!ledger || ledger.format !== 'furypipe-instruction-ledger/v1' || !Array.isArray(ledger.entries)) {
    return { ok: false, errors: ['instruction ledger format or entries are invalid'] };
  }
  if (ledger.entries.length > MAX_INSTRUCTION_LEDGER_ENTRIES) {
    return { ok: false, errors: [`instruction ledger exceeds ${MAX_INSTRUCTION_LEDGER_ENTRIES} entries`] };
  }
  const ids = new Set<string>();
  const entriesById = new Map<string, InstructionEntry>();
  let totalTextBytes = 0;
  for (const entry of ledger.entries) {
    if (entry && typeof entry.id === 'string') entriesById.set(entry.id, entry);
  }
  for (const entry of ledger.entries) {
    if (!entry || typeof entry !== 'object') {
      errors.push('instruction entry is invalid');
      continue;
    }
    if (ids.has(entry.id)) errors.push(`duplicate id ${entry.id}`);
    ids.add(entry.id);
    const textBytes = instructionTextBytes(entry.text);
    if (textBytes === undefined) errors.push(`instruction text exceeds per-entry limit ${entry.id}`);
    else totalTextBytes += textBytes;
    if (typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 128 || entry.id.includes('\0')) {
      errors.push('instruction ID is invalid');
    }
    if (typeof entry.provenance !== 'string' || entry.provenance.length === 0 || entry.provenance.length > 512 || entry.provenance.includes('\0')) {
      errors.push(`instruction provenance is invalid ${entry.id}`);
    }
    if (!INSTRUCTION_CATEGORIES.includes(entry.category) || !INSTRUCTION_SOURCE_ROLES.includes(entry.sourceRole)
      || typeof entry.active !== 'boolean' || typeof entry.historical !== 'boolean') {
      errors.push(`instruction category, role or state flags are invalid ${entry.id}`);
    }
    if (entry.scope !== undefined && (typeof entry.scope !== 'string' || entry.scope.length === 0 || entry.scope.length > 256 || entry.scope.includes('\0'))) {
      errors.push(`instruction scope is invalid ${entry.id}`);
    }
    if (textBytes !== undefined && hash(entry.text) !== entry.textHash) errors.push(`text hash mismatch ${entry.id}`);
    if (!Number.isSafeInteger(entry.logicalTurn) || entry.logicalTurn < 0) errors.push(`logicalTurn is invalid ${entry.id}`);
    if (entry.category === 'latest_user_request' && entry.sourceRole !== 'user') {
      errors.push(`latest_user_request must retain user role ${entry.id}`);
    }
    if (entry.active && entry.historical) {
      errors.push(`active instruction cannot be historical ${entry.id}`);
    }
    if (entry.precedence !== undefined && (!Number.isSafeInteger(entry.precedence) || entry.precedence < 0)) {
      errors.push(`precedence must be a non-negative safe integer ${entry.id}`);
    }
    if (entry.supersedes !== undefined) {
      const target = entriesById.get(entry.supersedes);
      if (!target) errors.push(`superseded entry is missing ${entry.id}->${entry.supersedes}`);
      else if ((target.scope ?? 'global') !== (entry.scope ?? 'global')) errors.push(`superseded entry has a different scope ${entry.id}`);
    }
  }
  if (ledger.entries.some((entry) => !entry || typeof entry !== 'object')) {
    return { ok: false, errors };
  }
  if (totalTextBytes > MAX_INSTRUCTION_LEDGER_TEXT_BYTES) {
    errors.push(`instruction ledger text exceeds ${MAX_INSTRUCTION_LEDGER_TEXT_BYTES} bytes`);
  }
  const latestByScope = latestActiveUserTurns(ledger.entries);
  const latestScopes = new Map<string, string>();
  for (const entry of ledger.entries) {
    if (entry.category !== 'latest_user_request' || entry.sourceRole !== 'user' || !entry.active) continue;
    if (entry.historical) errors.push(`active latest_user_request cannot be historical ${entry.id}`);
    const scope = entry.scope ?? 'global';
    const prior = latestScopes.get(scope);
    if (prior) errors.push(`multiple active latest user requests in scope ${scope}: ${prior}, ${entry.id}`);
    latestScopes.set(scope, entry.id);
  }
  if (ledger.latestUserTurnId !== undefined) {
    const latest = ledger.entries.find((entry) => entry.id === ledger.latestUserTurnId);
    if (!latest || latest.category !== 'latest_user_request' || latest.sourceRole !== 'user' || !latest.active || latest.historical) {
      errors.push('latestUserTurnId does not point to an active user request');
    }
  }
  if (ledger.latestUserTurnIds !== undefined) {
    for (const [scope, id] of Object.entries(ledger.latestUserTurnIds)) {
      if (latestByScope[scope] !== id) errors.push(`latestUserTurnIds is stale for scope ${scope}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function entrySupersedes(input: InstructionEntryInput): string | undefined {
  return input.supersedes;
}

function latestActiveUserTurns(entries: readonly InstructionEntry[]): Record<string, string> {
  const latest = new Map<string, string>();
  for (const entry of entries) {
    if (entry.category === 'latest_user_request' && entry.sourceRole === 'user' && entry.active && !entry.historical) {
      latest.set(entry.scope ?? 'global', entry.id);
    }
  }
  return Object.fromEntries(latest);
}
