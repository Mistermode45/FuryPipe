import { createHash } from 'node:crypto';
import type { AgentLearningLessonRecord, AgentMemoryClass } from './learning.js';

export type KnowledgeRelation = 'depends_on' | 'supports' | 'contradicts' | 'related_to';

export interface KnowledgeEntry {
  readonly format: 'furypipe-knowledge-entry/v1';
  readonly id: string;
  readonly memoryClass: AgentMemoryClass;
  readonly taskDigest: string;
  readonly lessonDigest: string;
  readonly contentHandle: string;
  readonly evidenceDigests: readonly string[];
  readonly termDigests: readonly string[];
  readonly reuseCount: number;
}

export interface KnowledgeEdge {
  readonly format: 'furypipe-knowledge-edge/v1';
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation: KnowledgeRelation;
  readonly evidenceDigest: string;
}

export interface KnowledgeSearchInput {
  readonly terms: readonly string[];
  readonly memoryClass?: AgentMemoryClass;
  readonly taskDigest?: string;
  readonly limit?: number;
}

export interface KnowledgeSearchHit {
  readonly id: string;
  readonly memoryClass: AgentMemoryClass;
  readonly taskDigest: string;
  readonly lessonDigest: string;
  readonly contentHandle: string;
  readonly reuseCount: number;
  readonly matchedTerms: number;
  readonly relationDegree: number;
}

export interface KnowledgeGraphStats {
  readonly entries: number;
  readonly edges: number;
  readonly indexedTermDigests: number;
}

export interface KnowledgeIndex {
  addLesson(record: AgentLearningLessonRecord, terms: readonly string[]): KnowledgeEntry;
  addEntry(entry: KnowledgeEntry): void;
  link(input: {
    readonly from: string;
    readonly to: string;
    readonly relation: KnowledgeRelation;
    readonly evidence: string;
  }): KnowledgeEdge;
  search(input: KnowledgeSearchInput): readonly KnowledgeSearchHit[];
  neighbors(id: string, relation?: KnowledgeRelation): readonly KnowledgeEdge[];
  get(id: string): KnowledgeEntry | undefined;
  stats(): KnowledgeGraphStats;
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const MEMORY_CLASSES = new Set<AgentMemoryClass>([
  'Working', 'Episodic', 'Semantic', 'Procedural', 'Project', 'User', 'Skills',
]);
const RELATIONS = new Set<KnowledgeRelation>(['depends_on', 'supports', 'contradicts', 'related_to']);
const MAX_TERMS = 64;
const MAX_TERM_LENGTH = 256;
const MAX_EVIDENCE_DIGESTS = 128;
const MAX_HANDLE_LENGTH = 1024;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function boundedText(value: unknown, label: string, max: number): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.includes('\0')) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
}

function validateId(value: string, label: string): void {
  if (!ID.test(value)) throw new Error(`${label} is invalid`);
}

function normalizeTerm(term: string): string {
  boundedText(term, 'knowledge term', MAX_TERM_LENGTH);
  const normalized = term.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (!normalized) throw new Error('knowledge term must not normalize to empty');
  return normalized;
}

function termDigest(term: string): string {
  return sha256(`furypipe-knowledge-term/v1:\0${normalizeTerm(term)}`);
}

function evidenceDigest(evidence: string): string {
  boundedText(evidence, 'knowledge edge evidence', 512);
  return sha256(`furypipe-knowledge-edge-evidence/v1:\0${evidence}`);
}

function validateMemoryClass(value: unknown): asserts value is AgentMemoryClass {
  if (!MEMORY_CLASSES.has(value as AgentMemoryClass)) throw new Error('knowledge memoryClass is invalid');
}

function validateEntry(entry: KnowledgeEntry): void {
  if (entry.format !== 'furypipe-knowledge-entry/v1') throw new Error('knowledge entry format is invalid');
  validateId(entry.id, 'knowledge entry id');
  validateMemoryClass(entry.memoryClass);
  boundedText(entry.taskDigest, 'knowledge taskDigest', 256);
  boundedText(entry.lessonDigest, 'knowledge lessonDigest', 256);
  boundedText(entry.contentHandle, 'knowledge contentHandle', MAX_HANDLE_LENGTH);
  if (!Array.isArray(entry.evidenceDigests) || entry.evidenceDigests.length > MAX_EVIDENCE_DIGESTS
    || entry.evidenceDigests.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 256 || value.includes('\0'))) {
    throw new Error('knowledge evidenceDigests are invalid');
  }
  if (!Array.isArray(entry.termDigests) || entry.termDigests.length < 1 || entry.termDigests.length > MAX_TERMS
    || entry.termDigests.some((value) => typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value))) {
    throw new Error('knowledge termDigests are invalid');
  }
  if (!Number.isSafeInteger(entry.reuseCount) || entry.reuseCount < 0 || entry.reuseCount > 1_000_000) {
    throw new Error('knowledge reuseCount is invalid');
  }
}

function entryFromLesson(record: AgentLearningLessonRecord, terms: readonly string[]): KnowledgeEntry {
  if (record.format !== 'furypipe-agent-lesson/v1' || record.validation !== 'validated') {
    throw new Error('only validated agent lessons may enter the knowledge index');
  }
  validateId(record.lessonId, 'lessonId');
  validateMemoryClass(record.memoryClass);
  boundedText(record.taskDigest, 'lesson taskDigest', 256);
  boundedText(record.lessonDigest, 'lesson lessonDigest', 256);
  boundedText(record.contentHandle, 'lesson contentHandle', MAX_HANDLE_LENGTH);
  if (!Array.isArray(terms) || terms.length < 1 || terms.length > MAX_TERMS) {
    throw new Error('knowledge terms must contain between 1 and 64 items');
  }
  const termDigests = [...new Set(terms.map(termDigest))].sort();
  const entry: KnowledgeEntry = {
    format: 'furypipe-knowledge-entry/v1',
    id: record.lessonId,
    memoryClass: record.memoryClass,
    taskDigest: record.taskDigest,
    lessonDigest: record.lessonDigest,
    contentHandle: record.contentHandle,
    evidenceDigests: Object.freeze([...record.evidenceDigests]),
    termDigests: Object.freeze(termDigests),
    reuseCount: record.reuseCount,
  };
  validateEntry(entry);
  return Object.freeze(entry);
}

function edgeId(from: string, relation: KnowledgeRelation, to: string, digest: string): string {
  return `edge_${sha256(`${from}\0${relation}\0${to}\0${digest}`).slice(0, 32)}`;
}

export function createKnowledgeIndex(): KnowledgeIndex {
  const entries = new Map<string, KnowledgeEntry>();
  const edges = new Map<string, KnowledgeEdge>();

  const degree = (id: string): number => {
    let count = 0;
    for (const edge of edges.values()) {
      if (edge.from === id || edge.to === id) count += 1;
    }
    return count;
  };

  return {
    addLesson(record, terms) {
      const entry = entryFromLesson(record, terms);
      this.addEntry(entry);
      return entry;
    },

    addEntry(entry) {
      validateEntry(entry);
      if (entries.has(entry.id)) throw new Error(`knowledge entry already exists: ${entry.id}`);
      entries.set(entry.id, Object.freeze({
        ...entry,
        evidenceDigests: Object.freeze([...entry.evidenceDigests]),
        termDigests: Object.freeze([...new Set(entry.termDigests)].sort()),
      }));
    },

    link(input) {
      validateId(input.from, 'knowledge edge from');
      validateId(input.to, 'knowledge edge to');
      if (input.from === input.to) throw new Error('knowledge self-edge is not allowed');
      if (!entries.has(input.from) || !entries.has(input.to)) {
        throw new Error('knowledge edge endpoints must exist');
      }
      if (!RELATIONS.has(input.relation)) throw new Error('knowledge relation is invalid');
      const digest = evidenceDigest(input.evidence);
      const edge: KnowledgeEdge = Object.freeze({
        format: 'furypipe-knowledge-edge/v1',
        id: edgeId(input.from, input.relation, input.to, digest),
        from: input.from,
        to: input.to,
        relation: input.relation,
        evidenceDigest: digest,
      });
      edges.set(edge.id, edge);
      return edge;
    },

    search(input) {
      if (!Array.isArray(input.terms) || input.terms.length < 1 || input.terms.length > MAX_TERMS) {
        throw new Error('knowledge search terms must contain between 1 and 64 items');
      }
      if (input.memoryClass !== undefined) validateMemoryClass(input.memoryClass);
      if (input.taskDigest !== undefined) boundedText(input.taskDigest, 'knowledge search taskDigest', 256);
      const limit = input.limit ?? 20;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new RangeError('knowledge search limit must be an integer from 1 to 100');
      }
      const queryDigests = new Set(input.terms.map(termDigest));
      const hits: KnowledgeSearchHit[] = [];
      for (const entry of entries.values()) {
        if (input.memoryClass !== undefined && entry.memoryClass !== input.memoryClass) continue;
        if (input.taskDigest !== undefined && entry.taskDigest !== input.taskDigest) continue;
        const matchedTerms = entry.termDigests.reduce((count, value) => count + (queryDigests.has(value) ? 1 : 0), 0);
        if (matchedTerms === 0) continue;
        hits.push({
          id: entry.id,
          memoryClass: entry.memoryClass,
          taskDigest: entry.taskDigest,
          lessonDigest: entry.lessonDigest,
          contentHandle: entry.contentHandle,
          reuseCount: entry.reuseCount,
          matchedTerms,
          relationDegree: degree(entry.id),
        });
      }
      hits.sort((a, b) =>
        b.matchedTerms - a.matchedTerms
        || b.relationDegree - a.relationDegree
        || b.reuseCount - a.reuseCount
        || a.id.localeCompare(b.id));
      return Object.freeze(hits.slice(0, limit).map((hit) => Object.freeze(hit)));
    },

    neighbors(id, relation) {
      validateId(id, 'knowledge entry id');
      if (relation !== undefined && !RELATIONS.has(relation)) throw new Error('knowledge relation is invalid');
      if (!entries.has(id)) return [];
      return Object.freeze([...edges.values()]
        .filter((edge) => (edge.from === id || edge.to === id) && (relation === undefined || edge.relation === relation))
        .sort((a, b) => a.id.localeCompare(b.id)));
    },

    get(id) {
      validateId(id, 'knowledge entry id');
      return entries.get(id);
    },

    stats() {
      const terms = new Set<string>();
      for (const entry of entries.values()) entry.termDigests.forEach((value) => terms.add(value));
      return Object.freeze({ entries: entries.size, edges: edges.size, indexedTermDigests: terms.size });
    },
  };
}
