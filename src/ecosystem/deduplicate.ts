import { serializeCapabilityCandidate, normalizeCapabilityCandidate } from './normalize.js';
import type { CapabilityCandidate } from './types.js';

export type DuplicateRelation =
  | 'same-canonical-source'
  | 'same-content-digest'
  | 'same-repository'
  | 'same-package'
  | 'same-marketplace-entry'
  | 'marketplace-repository'
  | 'fork-of'
  | 'mirror-of'
  | 'renamed-from'
  | 'package-for'
  | 'marketplace-entry-for'
  | 'possible-semantic-match';
export type DuplicateConfidence = 'EXACT' | 'HIGH' | 'POSSIBLE';

export interface CapabilityDuplicateMatch {
  readonly leftId: string;
  readonly rightId: string;
  readonly relation: DuplicateRelation;
  readonly confidence: DuplicateConfidence;
  readonly possibleDuplicate: boolean;
  readonly reason: string;
  readonly autoMergeAllowed: boolean;
}

export const MAX_DEDUPLICATION_CANDIDATES = 5_000;

const PRIORITY: Readonly<Record<DuplicateRelation, number>> = Object.freeze({
  'same-canonical-source': 100,
  'same-content-digest': 95,
  'same-repository': 80,
  'same-package': 75,
  'same-marketplace-entry': 70,
  'marketplace-repository': 78,
  'renamed-from': 65,
  'mirror-of': 60,
  'fork-of': 55,
  'package-for': 50,
  'marketplace-entry-for': 45,
  'possible-semantic-match': 10,
});

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pairKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function relationMatch(
  left: CapabilityCandidate,
  right: CapabilityCandidate,
  relation: DuplicateRelation,
  sameMetadata: boolean,
): CapabilityDuplicateMatch {
  const ordered = [left.id, right.id].sort(compareText);
  const confidence: DuplicateConfidence = relation === 'same-canonical-source' || relation === 'same-content-digest'
    ? 'EXACT'
    : relation === 'possible-semantic-match'
      ? 'POSSIBLE'
      : 'HIGH';
  return Object.freeze({
    leftId: ordered[0]!,
    rightId: ordered[1]!,
    relation,
    confidence,
    possibleDuplicate: relation === 'possible-semantic-match',
    reason: relation === 'possible-semantic-match'
      ? 'same type, normalized name and publisher; manual review required'
      : relation === 'same-canonical-source'
        ? 'same canonical source and immutable revision'
        : relation === 'same-content-digest'
          ? 'same declared SHA-256 content digest'
          : relation === 'same-repository'
            ? 'same repository identity; revisions are not automatically merged'
            : relation === 'same-package'
              ? 'same package coordinates; confirm repository and artifact relationship'
            : relation === 'same-marketplace-entry'
              ? 'same marketplace or service listing alias'
              : relation === 'marketplace-repository'
                ? 'marketplace listing and repository URL intersect; project identity needs review'
                : `${relation} relationship was explicitly declared by a candidate`,
    autoMergeAllowed: sameMetadata && (relation === 'same-canonical-source' || relation === 'same-content-digest'),
  });
}

/** Detects exact and declared relationships without merging records or guessing from text similarity. */
export function deduplicateCapabilities(values: readonly CapabilityCandidate[]): readonly CapabilityDuplicateMatch[] {
  if (!Array.isArray(values) || values.length > MAX_DEDUPLICATION_CANDIDATES) {
    throw new Error(`deduplication accepts at most ${MAX_DEDUPLICATION_CANDIDATES} candidates`);
  }
  const candidates = values.map((value) => normalizeCapabilityCandidate(value));
  const serialized = candidates.map((candidate) => serializeCapabilityCandidate(candidate));
  const matches = new Map<string, { left: number; right: number; relation: DuplicateRelation }>();

  const addPair = (leftIndex: number, rightIndex: number, relation: DuplicateRelation): void => {
    if (leftIndex === rightIndex) return;
    const key = pairKey(leftIndex, rightIndex);
    const existing = matches.get(key);
    if (existing && PRIORITY[existing.relation] >= PRIORITY[relation]) return;
    matches.set(key, { left: leftIndex, right: rightIndex, relation });
  };

  const firstByKey = new Map<string, number>();
  const addKey = (key: string, index: number, relation: DuplicateRelation): void => {
    const first = firstByKey.get(key);
    if (first === undefined) firstByKey.set(key, index);
    else addPair(first, index, relation);
  };

  const indexByCanonicalUrl = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    if (!indexByCanonicalUrl.has(candidate.canonicalUrl)) indexByCanonicalUrl.set(candidate.canonicalUrl, index);
    addKey(`canonical:${candidate.id}`, index, 'same-canonical-source');
    addKey(`url-alias:${candidate.canonicalUrl}`, index, 'marketplace-repository');
    if (candidate.source.contentSha256) addKey(`digest:${candidate.source.contentSha256}`, index, 'same-content-digest');
    if (candidate.source.repositoryUrl) addKey(`repository:${candidate.source.repositoryUrl}`, index, 'same-repository');
    for (const alias of candidate.aliases) {
      const relation: DuplicateRelation = alias.kind === 'repository'
        ? 'same-repository'
        : alias.kind === 'package'
          ? 'same-package'
          : alias.kind === 'marketplace'
            ? 'same-marketplace-entry'
            : alias.kind === 'registry'
              ? 'same-package'
              : 'same-marketplace-entry';
      addKey(`alias:${alias.kind}:${alias.value}`, index, relation);
      if (alias.kind !== 'package') addKey(`url-alias:${alias.value}`, index, 'marketplace-repository');
    }
    if (candidate.source.package) {
      const pkg = candidate.source.package;
      addKey(`package:${pkg.ecosystem}:${pkg.name}${pkg.version ? `@${pkg.version}` : ''}`, index, 'same-package');
    }
  });

  candidates.forEach((candidate, index) => {
    for (const relationship of candidate.relationships) {
      const targetIndex = indexByCanonicalUrl.get(relationship.targetUrl);
      if (targetIndex === undefined) continue;
      addPair(index, targetIndex, relationship.kind);
    }
  });

  const semanticFirst = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    const nameKey = candidate.name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (nameKey.length < 3) return;
    const publisherKey = candidate.publisher?.normalize('NFKC').toLowerCase() ?? '';
    const key = `${candidate.type}:${publisherKey}:${nameKey}`;
    const first = semanticFirst.get(key);
    if (first === undefined) semanticFirst.set(key, index);
    else addPair(first, index, 'possible-semantic-match');
  });

  const results = [...matches.values()].map(({ left, right, relation }) => relationMatch(
    candidates[left]!,
    candidates[right]!,
    relation,
    serialized[left] === serialized[right],
  ));
  results.sort((a, b) => compareText(a.leftId, b.leftId)
    || compareText(a.rightId, b.rightId)
    || PRIORITY[b.relation] - PRIORITY[a.relation]);
  return Object.freeze(results);
}

export function findCapabilityDuplicates(
  candidate: CapabilityCandidate,
  existing: readonly CapabilityCandidate[],
): readonly CapabilityDuplicateMatch[] {
  const normalized = normalizeCapabilityCandidate(candidate);
  return deduplicateCapabilities([...existing, normalized]).filter((match) =>
    match.leftId === normalized.id || match.rightId === normalized.id);
}
