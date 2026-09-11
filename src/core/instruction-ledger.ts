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
  readonly logicalTurn: number;
  readonly active: boolean;
  readonly historical: boolean;
}

export interface InstructionLedger {
  readonly format: 'furypipe-instruction-ledger/v1';
  readonly entries: readonly InstructionEntry[];
  readonly latestUserTurnId?: string;
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
  return `instruction_${hash(`${input.sourceRole}\0${input.logicalTurn}\0${textHash}`).slice(0, 24)}`;
}

export function createInstructionEntry(input: InstructionEntryInput): InstructionEntry {
  const textHash = hash(input.text);
  return { ...input, id: input.id ?? makeId(input, textHash), textHash };
}

export function createInstructionLedger(entries: readonly InstructionEntry[] = []): InstructionLedger {
  const ledger: InstructionLedger = { format: 'furypipe-instruction-ledger/v1', entries: [...entries] };
  const validation = validateInstructionLedger(ledger);
  if (!validation.ok) throw new Error(`invalid instruction ledger: ${validation.errors.join('; ')}`);
  return ledger;
}

export function appendInstructionEntry(ledger: InstructionLedger, input: InstructionEntryInput): InstructionLedger {
  const entry = createInstructionEntry(input);
  const latestUserTurnId = entry.category === 'latest_user_request' && entry.sourceRole === 'user'
    ? entry.id
    : ledger.latestUserTurnId;
  const next: InstructionLedger = {
    format: 'furypipe-instruction-ledger/v1',
    entries: [...ledger.entries, entry],
    ...(latestUserTurnId ? { latestUserTurnId } : {}),
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
    if (entry.historical && entry.category === 'latest_user_request') {
      errors.push(`latest_user_request cannot be historical ${entry.id}`);
    }
  }
  if (ledger.latestUserTurnId !== undefined) {
    const latest = ledger.entries.find((entry) => entry.id === ledger.latestUserTurnId);
    if (!latest || latest.category !== 'latest_user_request' || latest.sourceRole !== 'user') {
      errors.push('latestUserTurnId does not point to an active user request');
    }
  }
  return { ok: errors.length === 0, errors };
}

