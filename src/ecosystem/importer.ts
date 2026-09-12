import { CAPABILITY_MANIFEST_FORMAT, type CapabilityCandidate } from './types.js';
import { MAX_CANDIDATE_JSON_BYTES, normalizeCapabilityCandidate, serializeCapabilityCandidate } from './normalize.js';

export const MAX_CAPABILITY_MANIFEST_BYTES = 4_194_304;
export const MAX_CAPABILITY_MANIFEST_CANDIDATES = 256;

export interface CapabilityImporter {
  readonly id: string;
  readonly format: typeof CAPABILITY_MANIFEST_FORMAT;
  import(input: string | unknown): readonly CapabilityCandidate[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseManifest(input: string | unknown): unknown {
  if (typeof input !== 'string') return input;
  if (new TextEncoder().encode(input).byteLength > MAX_CAPABILITY_MANIFEST_BYTES) {
    throw new Error('capability manifest exceeds the configured byte limit');
  }
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new Error('capability manifest JSON is malformed');
  }
}

/** JSON-only importer. It performs no file access, network access, package resolution, or code execution. */
export function createStaticCapabilityImporter(): CapabilityImporter {
  return Object.freeze({
    id: 'furypipe-static-json-v1',
    format: CAPABILITY_MANIFEST_FORMAT,
    import(input: string | unknown) {
      const manifest = parseManifest(input);
      if (!isPlainRecord(manifest)) throw new Error('capability manifest must be a plain object');
      for (const key of Object.keys(manifest)) {
        if (key !== 'format' && key !== 'candidates') throw new Error('capability manifest contains an unsupported field');
      }
      if (manifest.format !== CAPABILITY_MANIFEST_FORMAT) throw new Error('unsupported capability manifest version');
      if (!Array.isArray(manifest.candidates) || manifest.candidates.length > MAX_CAPABILITY_MANIFEST_CANDIDATES) {
        throw new Error(`capability manifest must contain at most ${MAX_CAPABILITY_MANIFEST_CANDIDATES} candidates`);
      }
      const candidates = manifest.candidates.map((candidate) => normalizeCapabilityCandidate(candidate));
      const ids = candidates.map((candidate) => candidate.id);
      if (new Set(ids).size !== ids.length) throw new Error('capability manifest contains duplicate canonical identities');
      candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return Object.freeze(candidates);
    },
  });
}

/** Fixed in-memory fixtures for deterministic tests; the importer accepts no replacement payload. */
export function createFixtureCapabilityImporter(fixtures: readonly unknown[]): CapabilityImporter {
  if (!Array.isArray(fixtures) || fixtures.length > MAX_CAPABILITY_MANIFEST_CANDIDATES) {
    throw new Error(`fixture importer accepts at most ${MAX_CAPABILITY_MANIFEST_CANDIDATES} candidates`);
  }
  const candidates = fixtures.map((fixture) => normalizeCapabilityCandidate(fixture));
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new Error('fixture importer contains duplicate canonical identities');
  }
  candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const snapshot = Object.freeze(candidates);
  return Object.freeze({
    id: 'furypipe-in-memory-fixture-v1',
    format: CAPABILITY_MANIFEST_FORMAT,
    import(input: string | unknown) {
      if (input !== undefined) throw new Error('fixture importer does not accept external input');
      return snapshot;
    },
  });
}

export function serializeCapabilityManifest(candidates: readonly CapabilityCandidate[]): string {
  if (!Array.isArray(candidates) || candidates.length > MAX_CAPABILITY_MANIFEST_CANDIDATES) {
    throw new Error(`capability manifest must contain at most ${MAX_CAPABILITY_MANIFEST_CANDIDATES} candidates`);
  }
  const normalized = candidates.map((candidate) => normalizeCapabilityCandidate(candidate));
  if (new Set(normalized.map((candidate) => candidate.id)).size !== normalized.length) {
    throw new Error('capability manifest contains duplicate canonical identities');
  }
  normalized.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const body = normalized.map((candidate) => serializeCapabilityCandidate(candidate)).join(',');
  const result = `{"candidates":[${body}],"format":${JSON.stringify(CAPABILITY_MANIFEST_FORMAT)}}`;
  if (new TextEncoder().encode(result).byteLength > MAX_CAPABILITY_MANIFEST_BYTES) throw new Error('serialized capability manifest exceeds the byte limit');
  return result;
}

/** Small deterministic fixtures used by tests/examples; callers must opt in and no fixture runs. */
export function importCapabilityFixtures(importer: CapabilityImporter, fixtureJson: string): readonly CapabilityCandidate[] {
  if (new TextEncoder().encode(fixtureJson).byteLength > Math.min(MAX_CAPABILITY_MANIFEST_BYTES, MAX_CANDIDATE_JSON_BYTES * 4)) {
    throw new Error('fixture manifest exceeds the configured byte limit');
  }
  return importer.import(fixtureJson);
}
