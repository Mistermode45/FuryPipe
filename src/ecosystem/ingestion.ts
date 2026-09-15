import {
  evaluateFuryTrust,
  type FuryTrustReport,
  type OperatorTrustReview,
  type StaticEvidenceFile,
} from '../fury-trust.js';
import {
  createStaticCapabilityImporter,
  MAX_CAPABILITY_MANIFEST_CANDIDATES,
  type CapabilityImporter,
} from './importer.js';
import { normalizeCapabilityCandidate } from './normalize.js';
import {
  createCapabilityRegistry,
  MAX_CAPABILITY_REGISTRY_SIZE,
  type CapabilityRegistrationStatus,
  type CapabilityRegistry,
} from './registry.js';
import type { CapabilityCandidate } from './types.js';

export const ECOSYSTEM_INGESTION_RESULT_FORMAT = 'furypipe-ingestion-result/v1' as const;

export interface EcosystemIngestionRequest {
  readonly manifest: string | unknown;
  readonly staticEvidence?: ReadonlyMap<string, readonly StaticEvidenceFile[]>;
  readonly operatorReviews?: ReadonlyMap<string, OperatorTrustReview>;
}

export interface EcosystemIngestionItem {
  readonly candidate: CapabilityCandidate;
  readonly trustReport: FuryTrustReport;
  readonly registrationStatus: CapabilityRegistrationStatus;
  readonly duplicateMatches: ReturnType<CapabilityRegistry['register']>['duplicateMatches'];
}

export interface EcosystemIngestionBatch {
  readonly format: typeof ECOSYSTEM_INGESTION_RESULT_FORMAT;
  readonly importerId: string;
  readonly items: readonly EcosystemIngestionItem[];
  readonly registered: number;
  readonly duplicates: number;
  readonly identityConflicts: number;
}

export interface EcosystemIngestionEngine {
  readonly registry: CapabilityRegistry;
  ingest(request: EcosystemIngestionRequest): EcosystemIngestionBatch;
  getTrustReport(candidateId: string): FuryTrustReport | undefined;
}

function validateContextMap<T>(
  map: ReadonlyMap<string, T> | undefined,
  ids: ReadonlySet<string>,
  label: string,
): void {
  if (map === undefined) return;
  if (map === null || typeof map !== 'object' || typeof map[Symbol.iterator] !== 'function'
    || !Number.isSafeInteger(map.size) || map.size > ids.size) {
    throw new Error(`${label} must be a bounded map keyed by candidate ID`);
  }
  for (const [key] of map) if (!ids.has(key)) throw new Error(`${label} references a candidate outside the manifest`);
}

/** End-to-end metadata-only ingestion. A batch is validated and trust-evaluated before registry mutation. */
export function createEcosystemIngestionEngine(
  options: { readonly importer?: CapabilityImporter; readonly registry?: CapabilityRegistry } = {},
): EcosystemIngestionEngine {
  const importer = options.importer ?? createStaticCapabilityImporter();
  if (importer.format !== 'furypipe-capability-manifest/v1' || !/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(importer.id)) {
    throw new Error('capability importer identity or format is invalid');
  }
  const registry = options.registry ?? createCapabilityRegistry();

  return Object.freeze({
    registry,
    ingest(request: EcosystemIngestionRequest) {
      if (request === null || typeof request !== 'object' || Array.isArray(request)) throw new Error('ingestion request is invalid');
      const allowedRequestKeys = new Set(['manifest', 'staticEvidence', 'operatorReviews']);
      if (Object.keys(request).some((key) => !allowedRequestKeys.has(key))) throw new Error('ingestion request contains an unsupported field');
      const imported = importer.import(request.manifest);
      if (!Array.isArray(imported) || imported.length > MAX_CAPABILITY_MANIFEST_CANDIDATES) {
        throw new Error('capability importer returned an invalid or over-limit batch');
      }
      const candidates = imported.map((candidate) => normalizeCapabilityCandidate(candidate));
      if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
        throw new Error('capability importer returned duplicate canonical identities');
      }
      candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const ids = new Set(candidates.map((candidate) => candidate.id));
      validateContextMap(request.staticEvidence, ids, 'staticEvidence');
      validateContextMap(request.operatorReviews, ids, 'operatorReviews');

      const additionalSlots = candidates.filter((candidate) => registry.get(candidate.id) === undefined).length;
      if (registry.size + additionalSlots > MAX_CAPABILITY_REGISTRY_SIZE) throw new Error('ingestion would exceed the registry size limit');

      // Evaluate every item before changing state so a malformed evidence entry cannot leave a partial batch.
      const trustReports = candidates.map((candidate) => evaluateFuryTrust(
        candidate,
        request.staticEvidence?.get(candidate.id) ?? [],
        request.operatorReviews?.get(candidate.id),
      ));

      const items = candidates.map((candidate, index) => {
        const registration = registry.register(candidate);
        if (registration.status !== 'identity-conflict') registry.recordTrustReport(trustReports[index]!);
        return Object.freeze({
          candidate,
          trustReport: trustReports[index]!,
          registrationStatus: registration.status,
          duplicateMatches: registration.duplicateMatches,
        });
      });
      return Object.freeze({
        format: ECOSYSTEM_INGESTION_RESULT_FORMAT,
        importerId: importer.id,
        items: Object.freeze(items),
        registered: items.filter((item) => item.registrationStatus === 'registered').length,
        duplicates: items.filter((item) => item.registrationStatus === 'duplicate').length,
        identityConflicts: items.filter((item) => item.registrationStatus === 'identity-conflict').length,
      });
    },
    getTrustReport(candidateId: string) {
      return registry.getTrustReport(candidateId);
    },
  });
}
