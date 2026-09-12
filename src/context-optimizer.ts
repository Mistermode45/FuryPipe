export const FURY_CONTEXT_LEVELS = Object.freeze([
  'metadata',
  'summary',
  'full',
  'executable',
] as const);

export type FuryContextLevel = typeof FURY_CONTEXT_LEVELS[number];

export const FURY_CONTEXT_KINDS = Object.freeze([
  'instruction',
  'skill',
  'tool',
  'mcp',
  'memory',
  'knowledge',
  'evidence',
  'tool-output',
  'task-state',
  'transcript',
  'other',
] as const);

export type FuryContextKind = typeof FURY_CONTEXT_KINDS[number];
export type FuryContextCacheClass = 'stable' | 'semi-stable' | 'dynamic' | 'not-cacheable';
export type FuryContextExactness = 'normal' | 'exact' | 'secret';

export interface FuryContextRepresentation {
  readonly level: FuryContextLevel;
  readonly content: string;
}

export interface FuryContextItem {
  readonly id: string;
  readonly kind: FuryContextKind;
  readonly representations: readonly FuryContextRepresentation[];
  readonly required?: boolean;
  readonly selected?: boolean;
  readonly discoverable?: boolean;
  readonly relevance?: number;
  readonly importance?: number;
  readonly reuseProbability?: number;
  readonly cacheClass?: FuryContextCacheClass;
  readonly exactness?: FuryContextExactness;
  readonly minimumLevel?: FuryContextLevel;
  readonly preferredLevel?: FuryContextLevel;
}

export interface FuryContextOptimizerInput {
  readonly items: readonly FuryContextItem[];
  readonly maxBytes?: number;
  readonly maxItems?: number;
  readonly discoveryMinRelevance?: number;
  readonly allowSecret?: boolean;
  readonly strictOrdering?: boolean;
  readonly maxBytesByKind?: Readonly<Partial<Record<FuryContextKind, number>>>;
  readonly charsPerTokenEstimate?: number;
}

export interface FuryContextIncludedItem {
  readonly id: string;
  readonly kind: FuryContextKind;
  readonly level: FuryContextLevel;
  readonly content: string;
  readonly bytes: number;
  readonly chars: number;
  readonly cacheClass: FuryContextCacheClass;
  readonly exactness: FuryContextExactness;
  readonly reason: 'required' | 'selected' | 'discovery';
}

export interface FuryContextDeferredItem {
  readonly id: string;
  readonly kind: FuryContextKind;
  readonly reason:
    | 'not-selected'
    | 'below-discovery-threshold'
    | 'secret-policy'
    | 'item-limit'
    | 'byte-budget'
    | 'kind-byte-budget';
}

export interface FuryContextOptimizerPlan {
  readonly format: 'furypipe-context-optimizer-plan/v1';
  readonly included: readonly FuryContextIncludedItem[];
  readonly deferred: readonly FuryContextDeferredItem[];
  readonly totalCandidateBytes: number;
  readonly preferredEligibleBytes: number;
  readonly includedBytes: number;
  readonly savedBytesVsPreferred: number;
  readonly stablePrefixBytes: number;
  readonly cacheFriendlyOrderingApplied: boolean;
  readonly maxBytes: number;
  readonly maxItems: number;
  readonly estimatedTokens?: {
    readonly before: number;
    readonly after: number;
    readonly saved: number;
    readonly charsPerToken: number;
  };
}

interface ValidatedRepresentation extends FuryContextRepresentation {
  readonly bytes: number;
  readonly chars: number;
}

interface ValidatedItem {
  readonly originalIndex: number;
  readonly id: string;
  readonly kind: FuryContextKind;
  readonly representations: ReadonlyMap<FuryContextLevel, ValidatedRepresentation>;
  readonly required: boolean;
  readonly selected: boolean;
  readonly discoverable: boolean;
  readonly relevance: number;
  readonly importance: number;
  readonly reuseProbability: number;
  readonly cacheClass: FuryContextCacheClass;
  readonly exactness: FuryContextExactness;
  readonly minimumLevel?: FuryContextLevel;
  readonly preferredLevel?: FuryContextLevel;
}

interface Candidate {
  readonly item: ValidatedItem;
  readonly reason: FuryContextIncludedItem['reason'];
  readonly preferredLevel: FuryContextLevel;
  readonly minimumLevel: FuryContextLevel;
  readonly score: number;
}

const LEVEL_RANK: Readonly<Record<FuryContextLevel, number>> = Object.freeze({
  metadata: 0,
  summary: 1,
  full: 2,
  executable: 3,
});

const CACHE_RANK: Readonly<Record<FuryContextCacheClass, number>> = Object.freeze({
  stable: 0,
  'semi-stable': 1,
  dynamic: 2,
  'not-cacheable': 3,
});

const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_ITEMS = 128;
const MAX_SOURCE_ITEMS = 4096;
const MAX_ITEM_CONTENT_BYTES = 256 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 16 * 1024 * 1024;

const encoder = new TextEncoder();

function bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function boundedUnit(value: unknown, label: string, fallback: number): number {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved < 0 || resolved > 1) {
    throw new Error(`${label} must be a finite number between 0 and 1`);
  }
  return Math.round(resolved * 1_000_000) / 1_000_000;
}

function boundedPositiveInteger(
  value: unknown,
  label: string,
  fallback: number,
  maximum: number,
): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1 || (resolved as number) > maximum) {
    throw new Error(`${label} must be an integer from 1 to ${maximum}`);
  }
  return resolved as number;
}

function validateId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('context item id must be a string');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || trimmed.includes('\0')) {
    throw new Error('context item id must be a bounded non-empty string');
  }
  return trimmed;
}

function validateLevel(value: unknown, label: string): FuryContextLevel {
  if (typeof value !== 'string' || !FURY_CONTEXT_LEVELS.includes(value as FuryContextLevel)) {
    throw new Error(`${label} is invalid`);
  }
  return value as FuryContextLevel;
}

function validateKind(value: unknown): FuryContextKind {
  if (typeof value !== 'string' || !FURY_CONTEXT_KINDS.includes(value as FuryContextKind)) {
    throw new Error('context item kind is invalid');
  }
  return value as FuryContextKind;
}

function validateCacheClass(value: unknown): FuryContextCacheClass {
  const resolved = value ?? 'dynamic';
  if (
    resolved !== 'stable'
    && resolved !== 'semi-stable'
    && resolved !== 'dynamic'
    && resolved !== 'not-cacheable'
  ) {
    throw new Error('context item cache class is invalid');
  }
  return resolved;
}

function validateExactness(value: unknown): FuryContextExactness {
  const resolved = value ?? 'normal';
  if (resolved !== 'normal' && resolved !== 'exact' && resolved !== 'secret') {
    throw new Error('context item exactness is invalid');
  }
  return resolved;
}

function validateRepresentations(
  value: readonly FuryContextRepresentation[],
  itemId: string,
): ReadonlyMap<FuryContextLevel, ValidatedRepresentation> {
  if (!Array.isArray(value) || value.length < 1 || value.length > FURY_CONTEXT_LEVELS.length) {
    throw new Error(`context item ${itemId} must expose 1 to 4 representations`);
  }
  const out = new Map<FuryContextLevel, ValidatedRepresentation>();
  for (const raw of value as readonly unknown[]) {
    if (!raw || typeof raw !== 'object') throw new Error(`context item ${itemId} representation is invalid`);
    const candidate = raw as Partial<FuryContextRepresentation>;
    const level = validateLevel(candidate.level, `context item ${itemId} representation level`);
    if (out.has(level)) throw new Error(`context item ${itemId} has duplicate representation level ${level}`);
    if (typeof candidate.content !== 'string' || candidate.content.includes('\0')) {
      throw new Error(`context item ${itemId} representation content is invalid`);
    }
    const size = bytes(candidate.content);
    if (size > MAX_ITEM_CONTENT_BYTES) {
      throw new Error(`context item ${itemId} representation exceeds 256 KiB`);
    }
    out.set(level, Object.freeze({
      level,
      content: candidate.content,
      bytes: size,
      chars: candidate.content.length,
    }));
  }
  return out;
}

function validateItems(items: readonly FuryContextItem[]): readonly ValidatedItem[] {
  if (!Array.isArray(items) || items.length > MAX_SOURCE_ITEMS) {
    throw new Error(`context optimizer supports at most ${MAX_SOURCE_ITEMS} items`);
  }
  const ids = new Set<string>();
  const out: ValidatedItem[] = [];
  let totalBytes = 0;

  for (let index = 0; index < items.length; index += 1) {
    const raw = items[index];
    if (!raw || typeof raw !== 'object') throw new Error('context item is invalid');
    const id = validateId(raw.id);
    if (ids.has(id)) throw new Error(`duplicate context item id: ${id}`);
    ids.add(id);
    const representations = validateRepresentations(raw.representations, id);
    for (const representation of representations.values()) totalBytes += representation.bytes;
    if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
      throw new Error('context optimizer source representations exceed 16 MiB');
    }

    const minimumLevel = raw.minimumLevel === undefined
      ? undefined
      : validateLevel(raw.minimumLevel, `context item ${id} minimum level`);
    const preferredLevel = raw.preferredLevel === undefined
      ? undefined
      : validateLevel(raw.preferredLevel, `context item ${id} preferred level`);
    if (
      minimumLevel !== undefined
      && preferredLevel !== undefined
      && LEVEL_RANK[minimumLevel] > LEVEL_RANK[preferredLevel]
    ) {
      throw new Error(`context item ${id} minimum level exceeds preferred level`);
    }

    out.push(Object.freeze({
      originalIndex: index,
      id,
      kind: validateKind(raw.kind),
      representations,
      required: raw.required === true,
      selected: raw.selected === true,
      discoverable: raw.discoverable === true,
      relevance: boundedUnit(raw.relevance, `context item ${id} relevance`, 0),
      importance: boundedUnit(raw.importance, `context item ${id} importance`, 0.5),
      reuseProbability: boundedUnit(raw.reuseProbability, `context item ${id} reuse probability`, 0),
      cacheClass: validateCacheClass(raw.cacheClass),
      exactness: validateExactness(raw.exactness),
      ...(minimumLevel === undefined ? {} : { minimumLevel }),
      ...(preferredLevel === undefined ? {} : { preferredLevel }),
    }));
  }

  return Object.freeze(out);
}

function availableLevels(item: ValidatedItem): readonly FuryContextLevel[] {
  return FURY_CONTEXT_LEVELS.filter((level) => item.representations.has(level));
}

function highestAvailableLevel(item: ValidatedItem): FuryContextLevel {
  const levels = availableLevels(item);
  return levels[levels.length - 1]!;
}

function lowestAvailableLevel(item: ValidatedItem): FuryContextLevel {
  return availableLevels(item)[0]!;
}

function nearestAvailableAtOrBelow(item: ValidatedItem, requested: FuryContextLevel): FuryContextLevel {
  const requestedRank = LEVEL_RANK[requested];
  const levels = availableLevels(item).filter((level) => LEVEL_RANK[level] <= requestedRank);
  if (levels.length === 0) return lowestAvailableLevel(item);
  return levels[levels.length - 1]!;
}

function nearestAvailableAtOrAbove(item: ValidatedItem, requested: FuryContextLevel): FuryContextLevel {
  const requestedRank = LEVEL_RANK[requested];
  const levels = availableLevels(item).filter((level) => LEVEL_RANK[level] >= requestedRank);
  if (levels.length === 0) return highestAvailableLevel(item);
  return levels[0]!;
}

function preferredFor(item: ValidatedItem, reason: Candidate['reason']): FuryContextLevel {
  if (reason === 'discovery') {
    return item.representations.has('metadata') ? 'metadata' : lowestAvailableLevel(item);
  }
  if (item.preferredLevel !== undefined) {
    return nearestAvailableAtOrBelow(item, item.preferredLevel);
  }
  return highestAvailableLevel(item);
}

function minimumFor(
  item: ValidatedItem,
  reason: Candidate['reason'],
  preferred: FuryContextLevel,
): FuryContextLevel {
  if (reason === 'discovery') return preferred;
  if (item.exactness === 'exact') return preferred;
  if (item.minimumLevel !== undefined) return nearestAvailableAtOrAbove(item, item.minimumLevel);
  return lowestAvailableLevel(item);
}

function score(item: ValidatedItem): number {
  return (
    item.relevance * 0.55
    + item.importance * 0.30
    + item.reuseProbability * 0.15
  );
}

function candidateFor(
  item: ValidatedItem,
  discoveryMinRelevance: number,
): Candidate | undefined {
  let reason: Candidate['reason'] | undefined;
  if (item.required) reason = 'required';
  else if (item.selected) reason = 'selected';
  else if (item.discoverable && item.relevance >= discoveryMinRelevance) reason = 'discovery';
  if (reason === undefined) return undefined;

  const preferredLevel = preferredFor(item, reason);
  const minimumLevel = minimumFor(item, reason, preferredLevel);
  if (LEVEL_RANK[minimumLevel] > LEVEL_RANK[preferredLevel]) {
    throw new Error(`context item ${item.id} has no valid level range`);
  }
  return Object.freeze({
    item,
    reason,
    preferredLevel,
    minimumLevel,
    score: score(item),
  });
}

function levelChoices(candidate: Candidate): readonly FuryContextLevel[] {
  const preferredRank = LEVEL_RANK[candidate.preferredLevel];
  const minimumRank = LEVEL_RANK[candidate.minimumLevel];
  return [...FURY_CONTEXT_LEVELS]
    .filter((level) =>
      candidate.item.representations.has(level)
      && LEVEL_RANK[level] <= preferredRank
      && LEVEL_RANK[level] >= minimumRank,
    )
    .sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a]);
}

function validateKindBudgets(
  value: FuryContextOptimizerInput['maxBytesByKind'],
  maxBytes: number,
): Readonly<Partial<Record<FuryContextKind, number>>> {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('context kind byte budgets are invalid');
  }
  const out: Partial<Record<FuryContextKind, number>> = {};
  for (const [rawKind, rawLimit] of Object.entries(value)) {
    const kind = validateKind(rawKind);
    const limit = boundedPositiveInteger(rawLimit, `context kind byte budget ${kind}`, maxBytes, maxBytes);
    out[kind] = limit;
  }
  return Object.freeze(out);
}

function preferredCandidateBytes(candidates: readonly Candidate[]): number {
  return candidates.reduce((total, candidate) => {
    const representation = candidate.item.representations.get(candidate.preferredLevel);
    return total + (representation?.bytes ?? 0);
  }, 0);
}

function totalCandidateBytes(items: readonly ValidatedItem[]): number {
  return items.reduce((total, item) => {
    const highest = item.representations.get(highestAvailableLevel(item));
    return total + (highest?.bytes ?? 0);
  }, 0);
}

function chooseRepresentation(
  candidate: Candidate,
  remainingBytes: number,
  remainingKindBytes: number,
): ValidatedRepresentation | undefined {
  for (const level of levelChoices(candidate)) {
    const representation = candidate.item.representations.get(level)!;
    if (representation.bytes <= remainingBytes && representation.bytes <= remainingKindBytes) {
      return representation;
    }
  }
  return undefined;
}

function includedOrder(
  items: readonly FuryContextIncludedItem[],
  sourceIndex: ReadonlyMap<string, number>,
  strictOrdering: boolean,
): readonly FuryContextIncludedItem[] {
  return Object.freeze([...items].sort((a, b) => {
    if (strictOrdering) return sourceIndex.get(a.id)! - sourceIndex.get(b.id)!;
    const cache = CACHE_RANK[a.cacheClass] - CACHE_RANK[b.cacheClass];
    if (cache !== 0) return cache;
    return sourceIndex.get(a.id)! - sourceIndex.get(b.id)!;
  }));
}

function stablePrefixBytes(items: readonly FuryContextIncludedItem[]): number {
  let total = 0;
  for (const item of items) {
    if (item.cacheClass === 'dynamic' || item.cacheClass === 'not-cacheable') break;
    total += item.bytes;
  }
  return total;
}

function tokenEstimate(
  beforeChars: number,
  afterChars: number,
  charsPerToken: number | undefined,
): FuryContextOptimizerPlan['estimatedTokens'] {
  if (charsPerToken === undefined) return undefined;
  if (!Number.isFinite(charsPerToken) || charsPerToken < 1 || charsPerToken > 16) {
    throw new Error('charsPerTokenEstimate must be between 1 and 16');
  }
  const before = Math.ceil(beforeChars / charsPerToken);
  const after = Math.ceil(afterChars / charsPerToken);
  return Object.freeze({
    before,
    after,
    saved: Math.max(0, before - after),
    charsPerToken,
  });
}

export function optimizeContext(input: FuryContextOptimizerInput): FuryContextOptimizerPlan {
  if (!input || typeof input !== 'object') throw new TypeError('context optimizer input is required');
  const items = validateItems(input.items);
  const maxBytes = boundedPositiveInteger(input.maxBytes, 'context byte budget', DEFAULT_MAX_BYTES, 4 * 1024 * 1024);
  const maxItems = boundedPositiveInteger(input.maxItems, 'context item budget', DEFAULT_MAX_ITEMS, 1024);
  const discoveryMinRelevance = boundedUnit(
    input.discoveryMinRelevance,
    'context discovery relevance threshold',
    0.5,
  );
  const kindBudgets = validateKindBudgets(input.maxBytesByKind, maxBytes);
  const allowSecret = input.allowSecret === true;
  const strictOrdering = input.strictOrdering === true;

  const sourceIndex = new Map(items.map((item) => [item.id, item.originalIndex]));
  const candidates: Candidate[] = [];
  const deferred: FuryContextDeferredItem[] = [];

  for (const item of items) {
    if (item.exactness === 'secret' && !allowSecret) {
      if (item.required) throw new Error(`required secret context item is blocked by policy: ${item.id}`);
      deferred.push(Object.freeze({ id: item.id, kind: item.kind, reason: 'secret-policy' }));
      continue;
    }
    const candidate = candidateFor(item, discoveryMinRelevance);
    if (candidate !== undefined) {
      candidates.push(candidate);
      continue;
    }
    deferred.push(Object.freeze({
      id: item.id,
      kind: item.kind,
      reason: item.discoverable && item.relevance < discoveryMinRelevance
        ? 'below-discovery-threshold'
        : 'not-selected',
    }));
  }

  candidates.sort((a, b) => {
    if (a.reason !== b.reason) {
      const rank: Record<Candidate['reason'], number> = { required: 0, selected: 1, discovery: 2 };
      return rank[a.reason] - rank[b.reason];
    }
    if (a.reason === 'required') return a.item.originalIndex - b.item.originalIndex;
    if (a.score !== b.score) return b.score - a.score;
    return a.item.id.localeCompare(b.item.id);
  });

  const requiredCount = candidates.filter((candidate) => candidate.reason === 'required').length;
  if (requiredCount > maxItems) throw new Error('required context items exceed the item budget');

  const included: FuryContextIncludedItem[] = [];
  const kindBytes: Partial<Record<FuryContextKind, number>> = {};
  let usedBytes = 0;

  for (const candidate of candidates) {
    if (included.length >= maxItems) {
      if (candidate.reason === 'required') throw new Error(`required context item exceeds the item budget: ${candidate.item.id}`);
      deferred.push(Object.freeze({ id: candidate.item.id, kind: candidate.item.kind, reason: 'item-limit' }));
      continue;
    }

    const kindLimit = kindBudgets[candidate.item.kind] ?? maxBytes;
    const currentKindBytes = kindBytes[candidate.item.kind] ?? 0;
    const remainingBytes = maxBytes - usedBytes;
    const remainingKindBytes = kindLimit - currentKindBytes;
    const representation = chooseRepresentation(candidate, remainingBytes, remainingKindBytes);

    if (representation === undefined) {
      if (candidate.reason === 'required') {
        throw new Error(`required context item does not fit the configured budgets: ${candidate.item.id}`);
      }
      const minimumRepresentation = candidate.item.representations.get(candidate.minimumLevel)!;
      const reason = minimumRepresentation.bytes > remainingKindBytes
        ? 'kind-byte-budget'
        : 'byte-budget';
      deferred.push(Object.freeze({ id: candidate.item.id, kind: candidate.item.kind, reason }));
      continue;
    }

    usedBytes += representation.bytes;
    kindBytes[candidate.item.kind] = currentKindBytes + representation.bytes;
    included.push(Object.freeze({
      id: candidate.item.id,
      kind: candidate.item.kind,
      level: representation.level,
      content: representation.content,
      bytes: representation.bytes,
      chars: representation.chars,
      cacheClass: candidate.item.cacheClass,
      exactness: candidate.item.exactness,
      reason: candidate.reason,
    }));
  }

  const ordered = includedOrder(included, sourceIndex, strictOrdering);
  const preferredBytes = preferredCandidateBytes(candidates);
  const preferredChars = candidates.reduce((total, candidate) => {
    const representation = candidate.item.representations.get(candidate.preferredLevel);
    return total + (representation?.chars ?? 0);
  }, 0);
  const includedChars = ordered.reduce((total, item) => total + item.chars, 0);
  const estimate = tokenEstimate(preferredChars, includedChars, input.charsPerTokenEstimate);

  return Object.freeze({
    format: 'furypipe-context-optimizer-plan/v1',
    included: ordered,
    deferred: Object.freeze(deferred),
    totalCandidateBytes: totalCandidateBytes(items),
    preferredEligibleBytes: preferredBytes,
    includedBytes: usedBytes,
    savedBytesVsPreferred: Math.max(0, preferredBytes - usedBytes),
    stablePrefixBytes: stablePrefixBytes(ordered),
    cacheFriendlyOrderingApplied: !strictOrdering,
    maxBytes,
    maxItems,
    ...(estimate === undefined ? {} : { estimatedTokens: estimate }),
  });
}
