import { createHash } from 'node:crypto';

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
  const textHash = hash(input.text);
  return { ...input, id: input.id ?? makeId(input, textHash), textHash };
}

export function createInstructionLedger(entries: readonly InstructionEntry[] = []): InstructionLedger {
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
  const ids = new Set<string>();
  for (const entry of ledger.entries) {
    if (ids.has(entry.id)) errors.push(`duplicate id ${entry.id}`);
    ids.add(entry.id);
    if (hash(entry.text) !== entry.textHash) errors.push(`text hash mismatch ${entry.id}`);
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
      const target = ledger.entries.find((candidate) => candidate.id === entry.supersedes);
      if (!target) errors.push(`superseded entry is missing ${entry.id}->${entry.supersedes}`);
      else if ((target.scope ?? 'global') !== (entry.scope ?? 'global')) errors.push(`superseded entry has a different scope ${entry.id}`);
    }
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
  const latest: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.category === 'latest_user_request' && entry.sourceRole === 'user' && entry.active && !entry.historical) {
      latest[entry.scope ?? 'global'] = entry.id;
    }
  }
  return latest;
}
