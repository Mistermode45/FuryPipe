import {
  getV5RequiredReleaseGateIds,
  isAllowedV5ReleaseGateOrigin,
  isExactReleaseAuthorization,
  V5_RELEASE_GATE_REQUIREDNESS,
} from './index.js';
import type { ReleaseAuthorization, ReleaseEvidenceOrigin, ReleaseReadinessReport } from './index.js';

export type RcEvidenceState = 'VERIFIED' | 'PARTIAL' | 'NOT_EXECUTED' | 'BLOCKED';

export interface RcWorkflowEvidence {
  readonly name: string;
  readonly runId: number;
  readonly headSha: string;
  readonly updatedAt: number;
  readonly origin: 'github-actions';
  readonly reference: string;
  readonly conclusion: 'success' | 'failure' | 'cancelled' | 'skipped';
}

export type RcArtifactProofKey =
  | 'packageSmoke' | 'installationSmoke' | 'upgradeSmoke' | 'rollbackEvidence'
  | 'sbom' | 'provenance' | 'compatibilityMatrix' | 'migrationNotes'
  | 'releaseNotes' | 'packageSha256';

export interface RcArtifactProof {
  readonly sourceCommit: string;
  readonly observedAt: number;
  readonly origin: ReleaseEvidenceOrigin;
  readonly reference: string;
  readonly artifactSha256?: string;
}

export interface RcArtifactEvidence {
  readonly packageSmoke: RcEvidenceState;
  readonly installationSmoke: RcEvidenceState;
  readonly upgradeSmoke: RcEvidenceState;
  readonly rollbackEvidence: RcEvidenceState;
  readonly sbom: RcEvidenceState;
  readonly provenance: RcEvidenceState;
  readonly compatibilityMatrix: RcEvidenceState;
  readonly migrationNotes: RcEvidenceState;
  readonly releaseNotes: RcEvidenceState;
  readonly packageSha256?: string;
  readonly proofs?: Readonly<Partial<Record<RcArtifactProofKey, RcArtifactProof>>>;
}

export interface RcEvidenceInput {
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly packageVersion: string;
  readonly readiness: ReleaseReadinessReport;
  readonly workflowRuns: readonly RcWorkflowEvidence[];
  readonly artifacts: RcArtifactEvidence;
}

export interface RcPreparationBlocker {
  readonly id: string;
  readonly state: RcEvidenceState | 'MISMATCH';
  readonly reason: string;
}

export interface RcEvidenceSnapshot {
  readonly format: 'furypipe-rc-evidence/v2';
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly packageVersion: string;
  readonly readinessStatus: ReleaseReadinessReport['status'];
  readonly preparationStatus: 'BLOCKED' | 'READY_FOR_RELEASE_DECISION';
  readonly blockers: readonly RcPreparationBlocker[];
  readonly workflowRuns: readonly RcWorkflowEvidence[];
  readonly artifacts: RcArtifactEvidence;
  readonly authorization: ReleaseAuthorization;
  readonly releaseActionsExecuted: false;
}

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const WORKFLOW_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,127}$/u;
const GATE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const EVIDENCE_ORIGINS: readonly ReleaseEvidenceOrigin[] = ['local', 'github-actions', 'github', 'hosted', 'provider'];
const DENY_ALL_AUTHORIZATION: ReleaseAuthorization = Object.freeze({
  mergeDefaultBranch: false,
  createReleaseTag: false,
  publishNpm: false,
  deployProduction: false,
});

const REQUIRED_ARTIFACTS: readonly Exclude<RcArtifactProofKey, 'packageSha256'>[] = Object.freeze([
  'packageSmoke',
  'installationSmoke',
  'upgradeSmoke',
  'rollbackEvidence',
  'sbom',
  'provenance',
  'compatibilityMatrix',
  'migrationNotes',
  'releaseNotes',
]);

function validateInput(input: RcEvidenceInput): void {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new RangeError('RC evidence generatedAt must be a non-negative safe integer');
  }
  if (!SHA40.test(input.sourceCommit)) {
    throw new Error('RC evidence sourceCommit must be a lowercase 40-character commit SHA');
  }
  if (!SEMVER.test(input.packageVersion)) {
    throw new Error('RC evidence packageVersion must be a valid semver without a leading v');
  }
  if (input.readiness.format !== 'furypipe-release-readiness/v2') {
    throw new Error('RC evidence readiness report format is invalid');
  }
  if (input.readiness.releaseActionsExecuted !== false) {
    throw new Error('RC evidence only accepts non-executing readiness reports');
  }
  if (input.readiness.status !== 'BLOCKED' && input.readiness.status !== 'READY_FOR_RELEASE_DECISION') {
    throw new Error('RC evidence readiness status is invalid');
  }
  if (typeof input.readiness.performanceClaims !== 'boolean') {
    throw new Error('RC evidence readiness performanceClaims is invalid');
  }
  if (!Array.isArray(input.workflowRuns) || input.workflowRuns.length > 64) {
    throw new Error('RC workflow evidence must contain at most 64 runs');
  }
  const seenRuns = new Set<number>();
  for (const run of input.workflowRuns) {
    if (!WORKFLOW_NAME.test(run.name)) throw new Error('RC workflow evidence name is invalid');
    if (!Number.isSafeInteger(run.runId) || run.runId < 1) throw new Error('RC workflow runId must be a positive safe integer');
    if (!SHA40.test(run.headSha)) throw new Error('RC workflow headSha must be a lowercase 40-character SHA');
    if (!Number.isSafeInteger(run.updatedAt) || run.updatedAt < 0 || run.updatedAt > input.generatedAt) {
      throw new Error('RC workflow updatedAt must be a safe timestamp no later than the evidence snapshot');
    }
    if (run.origin !== 'github-actions' || typeof run.reference !== 'string'
      || run.reference.length === 0 || run.reference.length > 512 || run.reference.includes('\0')) {
      throw new Error('RC workflow evidence requires a bounded GitHub Actions reference');
    }
    if (seenRuns.has(run.runId)) throw new Error(`duplicate RC workflow runId: ${run.runId}`);
    seenRuns.add(run.runId);
  }
  if (input.artifacts.proofs !== undefined) {
    if (!input.artifacts.proofs || typeof input.artifacts.proofs !== 'object' || Array.isArray(input.artifacts.proofs)) {
      throw new Error('RC artifact proofs must be a record');
    }
    const validKeys = new Set<string>([...REQUIRED_ARTIFACTS, 'packageSha256']);
    for (const [key, proof] of Object.entries(input.artifacts.proofs)) {
      if (!validKeys.has(key) || !proof || typeof proof !== 'object'
        || !SHA40.test(proof.sourceCommit)
        || !Number.isSafeInteger(proof.observedAt) || proof.observedAt < 0 || proof.observedAt > input.generatedAt
        || !EVIDENCE_ORIGINS.includes(proof.origin)
        || typeof proof.reference !== 'string' || proof.reference.length === 0 || proof.reference.length > 512 || proof.reference.includes('\0')
        || (proof.artifactSha256 !== undefined && !SHA256.test(proof.artifactSha256))) {
        throw new Error(`RC artifact proof is invalid: ${key}`);
      }
    }
  }
  for (const key of REQUIRED_ARTIFACTS) {
    if (!['VERIFIED', 'PARTIAL', 'NOT_EXECUTED', 'BLOCKED'].includes(input.artifacts[key])) {
      throw new Error(`RC artifact state is invalid: ${key}`);
    }
  }
  if (input.artifacts.packageSha256 !== undefined && !SHA256.test(input.artifacts.packageSha256)) {
    throw new Error('RC packageSha256 must be a lowercase SHA-256 digest');
  }
}

function artifactProofFailure(
  key: RcArtifactProofKey,
  proof: RcArtifactProof | undefined,
  sourceCommit: string,
  packageSha256: string | undefined,
): string | undefined {
  if (!proof) return 'VERIFIED artifact has no source-bound evidence reference';
  if (proof.sourceCommit !== sourceCommit) return 'artifact evidence source commit does not match the RC source commit';
  if (proof.observedAt < 0) return 'artifact evidence timestamp is invalid';
  const requiredOrigins: readonly ReleaseEvidenceOrigin[] = key === 'sbom' || key === 'provenance'
    ? ['github-actions']
    : key === 'packageSha256' ? ['local', 'github-actions'] : ['local', 'hosted'];
  if (!requiredOrigins.includes(proof.origin)) return `artifact evidence origin must be one of: ${requiredOrigins.join(', ')}`;
  if (key === 'packageSha256' && (packageSha256 === undefined || proof.artifactSha256 !== packageSha256)) {
    return 'package digest evidence does not match the exact package SHA-256';
  }
  return undefined;
}

function artifactBlockers(artifacts: RcArtifactEvidence, sourceCommit: string): RcPreparationBlocker[] {
  const blockers: RcPreparationBlocker[] = [];
  for (const key of REQUIRED_ARTIFACTS) {
    const state = artifacts[key];
    const proofFailure = state === 'VERIFIED'
      ? artifactProofFailure(key, artifacts.proofs?.[key], sourceCommit, artifacts.packageSha256)
      : undefined;
    if (state !== 'VERIFIED' || proofFailure !== undefined) {
      blockers.push({
        id: `artifact.${key}`,
        state: proofFailure ? 'MISMATCH' : state,
        reason: proofFailure ?? 'required RC preparation evidence is not verified',
      });
    }
  }
  if (!artifacts.packageSha256) {
    blockers.push({
      id: 'artifact.packageSha256',
      state: 'NOT_EXECUTED',
      reason: 'RC package digest has not been recorded',
    });
  } else {
    const proofFailure = artifactProofFailure('packageSha256', artifacts.proofs?.packageSha256,
      sourceCommit, artifacts.packageSha256);
    if (proofFailure) blockers.push({
      id: 'artifact.packageSha256',
      state: 'MISMATCH',
      reason: proofFailure,
    });
  }
  return blockers;
}

function workflowBlockers(runs: readonly RcWorkflowEvidence[], sourceCommit: string): RcPreparationBlocker[] {
  const required = ['CI', 'CodeQL', 'Secret Scan', 'Supply Chain', 'License Compliance', 'Benchmark Contract'];
  const blockers: RcPreparationBlocker[] = [];
  for (const name of required) {
    const matching = runs.filter((run) => run.name === name);
    if (matching.length === 0) {
      blockers.push({
        id: `workflow.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        state: 'NOT_EXECUTED',
        reason: `required workflow evidence is missing: ${name}`,
      });
      continue;
    }
    const latest = matching.reduce((current, candidate) => candidate.runId > current.runId ? candidate : current);
    if (latest.headSha !== sourceCommit) {
      blockers.push({
        id: `workflow.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        state: 'MISMATCH',
        reason: `latest workflow run is for a different source commit: ${name}`,
      });
    } else if (latest.conclusion !== 'success') {
      blockers.push({
        id: `workflow.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        state: 'BLOCKED',
        reason: `latest workflow run is not successful: ${name}`,
      });
    }
  }
  return blockers;
}

function freezeArtifactEvidence(artifacts: RcArtifactEvidence): RcArtifactEvidence {
  const proofs = artifacts.proofs === undefined
    ? undefined
    : Object.freeze(Object.fromEntries(
      Object.entries(artifacts.proofs).map(([key, proof]) => [
        key,
        proof === undefined ? undefined : Object.freeze({ ...proof }),
      ]),
    ) as Partial<Record<RcArtifactProofKey, RcArtifactProof>>);
  return Object.freeze({
    ...artifacts,
    ...(proofs === undefined ? {} : { proofs }),
  });
}

export function createRcEvidenceSnapshot(input: RcEvidenceInput): RcEvidenceSnapshot {
  validateInput(input);

  const blockers: RcPreparationBlocker[] = [];
  const authorization = input.readiness.authorization;
  const authorizationValid = isExactReleaseAuthorization(authorization);
  const safeAuthorization = authorizationValid ? Object.freeze({ ...authorization }) : DENY_ALL_AUTHORIZATION;
  const expectedRequiredGateCount = 17 + (input.readiness.performanceClaims ? 1 : 0);
  const effectiveRequiredGateIds = input.readiness.requiredGates === expectedRequiredGateCount
    ? getV5RequiredReleaseGateIds(input.readiness.requiredGates)
    : undefined;
  const effectiveRequiredGateSet = new Set(effectiveRequiredGateIds ?? []);
  const verifiedEvidenceIds = new Set<string>();
  const blockerIds = new Set<string>();
  let verifiedRequiredEvidenceCount = 0;
  const readinessConsistent = effectiveRequiredGateIds !== undefined
    && Array.isArray(input.readiness.blockers)
    && input.readiness.blockers.length <= 128
    && input.readiness.blockers.every((blocker) => blocker && GATE_ID.test(blocker.gateId)
      && Object.hasOwn(V5_RELEASE_GATE_REQUIREDNESS, blocker.gateId)
      && effectiveRequiredGateSet.has(blocker.gateId)
      && !blockerIds.has(blocker.gateId)
      && (blockerIds.add(blocker.gateId), true)
      && typeof blocker.title === 'string' && blocker.title.length > 0 && blocker.title.length <= 160
      && ['VERIFIED', 'PARTIAL', 'NOT_EXECUTED', 'BLOCKED', 'BLOCKED_BY_REPO_SETTING', 'NOT_APPLICABLE'].includes(blocker.state)
      && typeof blocker.reason === 'string' && blocker.reason.length > 0 && blocker.reason.length <= 1024)
    && Array.isArray(input.readiness.warnings)
    && input.readiness.warnings.length <= 128
    && input.readiness.warnings.every((warning) => typeof warning === 'string' && warning.length > 0 && warning.length <= 1024)
    && Number.isSafeInteger(input.readiness.generatedAt)
    && input.readiness.generatedAt >= 0
    && input.readiness.generatedAt <= input.generatedAt
    && Number.isSafeInteger(input.readiness.verifiedRequiredGates)
    && input.readiness.verifiedRequiredGates >= 0
    && input.readiness.verifiedRequiredGates <= 128
    && Number.isSafeInteger(input.readiness.requiredGates)
    && input.readiness.requiredGates >= 0
    && input.readiness.requiredGates === effectiveRequiredGateIds.length
    && input.readiness.verifiedRequiredGates <= input.readiness.requiredGates
    && Array.isArray(input.readiness.verifiedGateEvidence)
    && input.readiness.verifiedGateEvidence.length <= 128
    && input.readiness.verifiedGateEvidence.every((evidence) => evidence
      && typeof evidence.gateId === 'string'
      && GATE_ID.test(evidence.gateId)
      && Object.hasOwn(V5_RELEASE_GATE_REQUIREDNESS, evidence.gateId)
      && !verifiedEvidenceIds.has(evidence.gateId)
      && (verifiedEvidenceIds.add(evidence.gateId), effectiveRequiredGateSet.has(evidence.gateId)
        ? (verifiedRequiredEvidenceCount += 1, true)
        : true)
      && SHA40.test(evidence.sourceCommit)
      && evidence.sourceCommit === input.readiness.sourceCommit
      && Number.isSafeInteger(evidence.observedAt)
      && evidence.observedAt >= 0
      && evidence.observedAt <= input.readiness.generatedAt
      && EVIDENCE_ORIGINS.includes(evidence.origin)
      && isAllowedV5ReleaseGateOrigin(evidence.gateId, evidence.origin)
      && typeof evidence.reference === 'string'
      && evidence.reference.length > 0
      && evidence.reference.length <= 512)
    && input.readiness.verifiedRequiredGates === verifiedRequiredEvidenceCount
    && effectiveRequiredGateIds.every((id) => verifiedEvidenceIds.has(id) !== blockerIds.has(id))
    && (input.readiness.status !== 'READY_FOR_RELEASE_DECISION'
      || (input.readiness.blockers.length === 0
        && input.readiness.verifiedRequiredGates === input.readiness.requiredGates
        && effectiveRequiredGateIds.every((id) => verifiedEvidenceIds.has(id))
        && input.readiness.verifiedGateEvidence.length >= input.readiness.verifiedRequiredGates))
    && (input.readiness.status !== 'BLOCKED'
      || (input.readiness.blockers.length > 0
        || input.readiness.verifiedRequiredGates < input.readiness.requiredGates));
  if (!readinessConsistent || !authorizationValid) blockers.push({
    id: 'readiness.integrity',
    state: 'MISMATCH',
    reason: 'Release Readiness status, timestamps, authorization, blockers, counts and evidence are inconsistent',
  });
  if (input.readiness.sourceCommit !== input.sourceCommit) {
    blockers.push({
      id: 'identity.sourceCommit',
      state: 'MISMATCH',
      reason: 'Release Readiness source commit does not match the RC evidence source commit',
    });
  }
  if (input.readiness.packageVersion !== input.packageVersion) {
    blockers.push({
      id: 'identity.packageVersion',
      state: 'MISMATCH',
      reason: 'Release Readiness package version does not match the RC evidence package version',
    });
  }
  if (input.readiness.status !== 'READY_FOR_RELEASE_DECISION') {
    blockers.push({
      id: 'readiness.status',
      state: 'BLOCKED',
      reason: 'Release Readiness is still blocked',
    });
  }

  blockers.push(...workflowBlockers(input.workflowRuns, input.sourceCommit));
  blockers.push(...artifactBlockers(input.artifacts, input.sourceCommit));

  return Object.freeze({
    format: 'furypipe-rc-evidence/v2',
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    packageVersion: input.packageVersion,
    readinessStatus: input.readiness.status,
    preparationStatus: blockers.length === 0 ? 'READY_FOR_RELEASE_DECISION' : 'BLOCKED',
    blockers: Object.freeze(blockers.map((blocker) => Object.freeze({ ...blocker }))),
    workflowRuns: Object.freeze(input.workflowRuns.map((run) => Object.freeze({ ...run }))),
    artifacts: freezeArtifactEvidence(input.artifacts),
    authorization: safeAuthorization,
    releaseActionsExecuted: false,
  });
}
