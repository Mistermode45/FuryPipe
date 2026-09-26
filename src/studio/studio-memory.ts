// Studio Memory — operator surface over Memory VNext.
//
// Memory is opt-in and encrypted: without FURYPIPE_WEBCHAT_MEMORY_CONFIG the
// view says it is disabled rather than silently storing anything. Studio only
// records what the operator types (user-declared evidence); every recalled
// item shows its scope, source, age, confidence and why it matched.
import path from 'node:path';

import { createFuryGatewayLocalMemoryRuntime } from '../gateway-local-memory-runtime-node.js';
import { createMemoryVNextStore, type MemoryVNextMemoryClass, type MemoryVNextScopeQuery, type MemoryVNextStore } from '../memory-vnext.js';

const CLASSES: readonly MemoryVNextMemoryClass[] = ['Semantic', 'Episodic', 'Procedural', 'Project', 'User', 'Skills'];
const STOP = new Set('the a an and or of to in on for with is are was be it this that we you i my our your de la le les des du et est un une pour dans sur'.split(' '));

export function memoryTerms(text: string): string[] {
  return [...new Set((text.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((t) => !STOP.has(t)))].slice(0, 24);
}

export interface StudioMemory {
  readonly enabled: boolean;
  readonly reason?: string;
  readonly store?: MemoryVNextStore;
}

export function studioMemoryFromEnv(): StudioMemory {
  try {
    const runtime = createFuryGatewayLocalMemoryRuntime();
    if (!runtime.config.enabled || !runtime.recovery) return { enabled: false, reason: 'Memory is off. Set FURYPIPE_WEBCHAT_MEMORY_CONFIG to an encrypted memory config to turn it on.' };
    // Loopback operator surface: Studio is the host authority for its own requests.
    return { enabled: true, store: createMemoryVNextStore({ recovery: runtime.recovery, authorize: () => true }) };
  } catch (error) {
    return { enabled: false, reason: `Memory config rejected: ${(error as Error).message.slice(0, 200)}` };
  }
}

export function studioMemoryScopes(projectRoot: string): { readonly project: MemoryVNextScopeQuery; readonly user: MemoryVNextScopeQuery } {
  return { project: { kind: 'project', id: path.resolve(projectRoot) }, user: { kind: 'user', id: 'local-operator' } };
}

export async function studioMemoryList(store: MemoryVNextStore, projectRoot: string, now: number) {
  const scopes = studioMemoryScopes(projectRoot);
  const records = await store.inspect({ scopes: [scopes.project, scopes.user], now });
  return records.map(({ record, sourceRevoked }) => ({
    memoryId: record.memoryId, version: record.version, state: record.state, memoryClass: record.memoryClass,
    scope: record.scope.kind, source: record.sourceKind, evidence: record.evidenceClass, confidence: record.confidence,
    ageMs: Math.max(0, now - record.createdAt), lastConfirmedAt: record.lastConfirmedAt, retention: record.retention.kind, visibility: record.visibility, sourceRevoked,
  }));
}

export async function studioMemoryRemember(store: MemoryVNextStore, projectRoot: string, input: { text: string; scope: 'project' | 'user'; memoryClass?: string }, now: number) {
  const scopes = studioMemoryScopes(projectRoot);
  const memoryClass = (CLASSES as readonly string[]).includes(input.memoryClass ?? '') ? input.memoryClass as MemoryVNextMemoryClass : 'Semantic';
  const terms = memoryTerms(input.text);
  if (!terms.length) throw Object.assign(new Error('memory text needs at least one meaningful word'), { status: 400 });
  const candidate = store.observe({
    key: `studio.${input.scope}.${terms.slice(0, 6).join('-')}`.slice(0, 120),
    text: input.text, memoryClass, scope: scopes[input.scope], source: { kind: 'user-message', id: 'furypipe-studio' },
    evidenceClass: 'user-declared', confidence: 1, terms,
  }, now);
  await store.accept({ candidate, acceptedBy: 'user-declared', retention: { kind: 'until-revoked' }, visibility: input.scope === 'project' ? 'project' : 'private', now });
  await store.activate({ memoryId: candidate.memoryId, scope: scopes[input.scope], now });
  return { memoryId: candidate.memoryId, terms };
}

export async function studioMemorySearch(store: MemoryVNextStore, projectRoot: string, query: string, now: number) {
  const scopes = studioMemoryScopes(projectRoot);
  const terms = memoryTerms(query);
  if (!terms.length) return [];
  const hits = await store.search({ scopes: [scopes.project, scopes.user], terms, now, limit: 20 });
  return hits.map((h) => ({
    memoryId: h.memoryId, text: h.text, memoryClass: h.memoryClass, scope: h.scope.kind, source: h.sourceKind, evidence: h.evidenceClass,
    confidence: h.confidence, ageMs: Math.max(0, now - h.updatedAt), score: h.score,
    why: `${h.matchedTerms} of ${terms.length} query term(s) matched; ${h.evidenceClass} from ${h.sourceKind}; confidence ${h.confidence}`,
  }));
}
