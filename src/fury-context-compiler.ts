// FuryContext Compiler — builds a task-scoped Context Capsule instead of
// shipping the whole repository to every agent.
//
// Every included entry records its source, why it was included, a digest,
// its scope and an expiry. MUST/MUST_NOT constraints and success predicates
// from the FuryIR contract are pinned: they are never dropped, and if they
// alone exceed the budget the compiler refuses rather than silently
// truncating a hard constraint. Everything else is ranked by priority and by
// proximity in the FuryGraph blast radius, then packed into the byte budget.
import { createHash } from 'node:crypto';

import type { FuryIrDocument, FuryIrTask } from './fury-ir.js';
import type { FuryGraph } from './fury-graph.js';
import { furyBlastRadius, furyFileDependencies } from './fury-graph.js';

export const FURY_CONTEXT_CAPSULE_FORMAT = 'furypipe-context-capsule/v1' as const;

export type FuryContextKind = 'constraint' | 'predicate' | 'file' | 'memory' | 'receipt' | 'tool-schema' | 'note';

export interface FuryContextCandidate {
  readonly source: string;
  readonly kind: Exclude<FuryContextKind, 'constraint' | 'predicate'>;
  readonly content: string;
  /** 0 (low) .. 100 (high). */
  readonly priority: number;
  readonly scope?: string;
  readonly expiresAt?: number;
}

export interface FuryContextEntry {
  readonly source: string;
  readonly kind: FuryContextKind;
  readonly reason: string;
  readonly digest: string;
  readonly bytes: number;
  readonly scope: string;
  readonly expiresAt?: number;
  readonly pinned: boolean;
  readonly content: string;
}

export interface FuryContextCapsule {
  readonly format: typeof FURY_CONTEXT_CAPSULE_FORMAT;
  readonly irDigest: string;
  readonly taskId: string;
  readonly budgetBytes: number;
  readonly usedBytes: number;
  readonly candidateBytes: number;
  readonly entries: readonly FuryContextEntry[];
  readonly omitted: readonly { readonly source: string; readonly reason: string; readonly bytes: number }[];
  readonly capsuleDigest: string;
}

export class FuryContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryContextError';
  }
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function compileFuryContextCapsule(input: {
  readonly ir: FuryIrDocument;
  readonly taskId: string;
  readonly candidates: readonly FuryContextCandidate[];
  readonly budgetBytes: number;
  readonly graph?: FuryGraph;
  readonly changedFiles?: readonly string[];
  readonly now?: number;
}): FuryContextCapsule {
  const task: FuryIrTask | undefined = input.ir.tasks.find((t) => t.id === input.taskId);
  if (!task) throw new FuryContextError(`task ${input.taskId} is not in the contract`);
  if (!Number.isSafeInteger(input.budgetBytes) || input.budgetBytes < 1 || input.budgetBytes > 64 * 1024 * 1024) throw new FuryContextError('budgetBytes must be 1..64 MiB');
  if (!Array.isArray(input.candidates) || input.candidates.length > 10_000) throw new FuryContextError('too many candidates');
  const now = input.now ?? Date.now();

  const pinned: FuryContextEntry[] = [];
  const pin = (kind: FuryContextKind, source: string, content: string, reason: string) => {
    pinned.push(Object.freeze({ source, kind, reason, digest: sha(content), bytes: Buffer.byteLength(content, 'utf8'), scope: 'task', pinned: true, content }));
  };
  pin('constraint', 'ir:intent', input.ir.intent, 'task intent');
  input.ir.must.forEach((c, i) => pin('constraint', `ir:must[${i}]`, `MUST: ${c}`, 'hard constraint (MUST)'));
  input.ir.mustNot.forEach((c, i) => pin('constraint', `ir:mustNot[${i}]`, `MUST NOT: ${c}`, 'hard constraint (MUST NOT)'));
  for (const p of input.ir.successPredicates) pin('predicate', `ir:predicate:${p.id}`, `${p.level} ${p.id}: ${p.description}`, 'success predicate');
  pin('constraint', `ir:task:${task.id}`, `TASK ${task.id} (${task.role}): ${task.description}; write scopes: ${task.writeScopes.join(', ') || 'read-only'}`, 'assigned task');

  const pinnedBytes = pinned.reduce((n, e) => n + e.bytes, 0);
  if (pinnedBytes > input.budgetBytes) {
    throw new FuryContextError(`pinned constraints need ${pinnedBytes} bytes but the budget is ${input.budgetBytes}; refusing to drop a MUST constraint`);
  }

  const blast = input.graph && input.changedFiles?.length ? furyBlastRadius(input.graph, input.changedFiles) : undefined;
  // Direct neighbours rank above the transitive radius: files the change imports
  // and files that import it are the ones most often edited together.
  const direct = new Set<string>();
  if (input.graph && blast) {
    const deps = furyFileDependencies(input.graph);
    for (const f of blast.changed) for (const to of deps.get(f)?.keys() ?? []) direct.add(to);
    for (const [from, row] of deps) if (blast.changed.some((f) => row.has(f))) direct.add(from);
  }
  const changedDirs = new Set((blast?.changed ?? input.changedFiles ?? []).map((f) => f.replace(/\/[^/]*$/u, '')));
  const inWriteScope = (file: string) => task.writeScopes.some((s) => {
    const p = s.replace(/\*+$/u, '').replace(/\/+$/u, '');
    return file === p || file.startsWith(`${p}/`);
  });

  const omitted: { source: string; reason: string; bytes: number }[] = [];
  const ranked: { c: FuryContextCandidate; score: number; reason: string; bytes: number }[] = [];
  const seen = new Set<string>();
  for (const c of input.candidates) {
    const bytes = Buffer.byteLength(c.content, 'utf8');
    if (typeof c.source !== 'string' || c.source.length === 0 || c.source.length > 512) throw new FuryContextError('candidate source is invalid');
    if (seen.has(c.source)) {
      omitted.push({ source: c.source, reason: 'duplicate source', bytes });
      continue;
    }
    seen.add(c.source);
    if (c.expiresAt !== undefined && c.expiresAt <= now) {
      omitted.push({ source: c.source, reason: 'expired', bytes });
      continue;
    }
    let score = Math.min(Math.max(Number.isFinite(c.priority) ? c.priority : 0, 0), 100);
    const reasons = [`priority ${score}`];
    if (c.kind === 'file') {
      if (blast?.changed.includes(c.source)) { score += 60; reasons.push('changed file'); }
      else if (direct.has(c.source)) { score += 45; reasons.push('direct import neighbour of the change'); }
      else if (blast?.affected.includes(c.source)) { score += 30; reasons.push('in blast radius'); }
      if (changedDirs.has(c.source.replace(/\/[^/]*$/u, ''))) { score += 10; reasons.push('same folder as the change'); }
      if (inWriteScope(c.source)) { score += 30; reasons.push('inside task write scope'); }
    }
    ranked.push({ c, score, reason: reasons.join('; '), bytes });
  }
  ranked.sort((a, b) => b.score - a.score || a.bytes - b.bytes || (a.c.source < b.c.source ? -1 : 1));

  let used = pinnedBytes;
  const entries: FuryContextEntry[] = [...pinned];
  for (const r of ranked) {
    if (used + r.bytes > input.budgetBytes) {
      omitted.push({ source: r.c.source, reason: `over budget (score ${r.score})`, bytes: r.bytes });
      continue;
    }
    used += r.bytes;
    entries.push(Object.freeze({
      source: r.c.source, kind: r.c.kind, reason: r.reason, digest: sha(r.c.content), bytes: r.bytes,
      scope: r.c.scope ?? 'task', ...(r.c.expiresAt !== undefined ? { expiresAt: r.c.expiresAt } : {}), pinned: false, content: r.c.content,
    }));
  }
  const candidateBytes = pinnedBytes + ranked.reduce((n, r) => n + r.bytes, 0);
  const capsuleDigest = sha(JSON.stringify(entries.map((e) => [e.source, e.digest])));
  return Object.freeze({
    format: FURY_CONTEXT_CAPSULE_FORMAT,
    irDigest: input.ir.digest,
    taskId: task.id,
    budgetBytes: input.budgetBytes,
    usedBytes: used,
    candidateBytes,
    entries: Object.freeze(entries),
    omitted: Object.freeze(omitted.map((o) => Object.freeze(o))),
    capsuleDigest,
  });
}
