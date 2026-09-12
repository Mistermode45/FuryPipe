import type { ReleaseAuthorization, ReleaseReadinessReport } from './index.js';

export type RcEvidenceState = 'VERIFIED' | 'PARTIAL' | 'NOT_EXECUTED' | 'BLOCKED';

export interface RcWorkflowEvidence {
  readonly name: string;
  readonly runId: number;
  readonly conclusion: 'success' | 'failure' | 'cancelled' | 'skipped';
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
  readonly format: 'furypipe-rc-evidence/v1';
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

const REQUIRED_ARTIFACTS: readonly (keyof Omit<RcArtifactEvidence, 'packageSha256'>)[] = Object.freeze([
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
  if (input.readiness.format !== 'furypipe-release-readiness/v1') {
    throw new Error('RC evidence readiness report format is invalid');
  }
  if (input.readiness.releaseActionsExecuted !== false) {
    throw new Error('RC evidence only accepts non-executing readiness reports');
  }
  if (!Array.isArray(input.workflowRuns) || input.workflowRuns.length > 64) {
    throw new Error('RC workflow evidence must contain at most 64 runs');
  }
  const seenRuns = new Set<number>();
  for (const run of input.workflowRuns) {
    if (!WORKFLOW_NAME.test(run.name)) throw new Error('RC workflow evidence name is invalid');
    if (!Number.isSafeInteger(run.runId) || run.runId < 1) throw new Error('RC workflow runId must be a positive safe integer');
    if (seenRuns.has(run.runId)) throw new Error(`duplicate RC workflow runId: ${run.runId}`);
    seenRuns.add(run.runId);
  }
  if (input.artifacts.packageSha256 !== undefined && !SHA256.test(input.artifacts.packageSha256)) {
    throw new Error('RC packageSha256 must be a lowercase SHA-256 digest');
  }
}

function artifactBlockers(artifacts: RcArtifactEvidence): RcPreparationBlocker[] {
  const blockers: RcPreparationBlocker[] = [];
  for (const key of REQUIRED_ARTIFACTS) {
    const state = artifacts[key];
    if (state !== 'VERIFIED') {
      blockers.push({
        id: `artifact.${key}`,
        state,
        reason: 'required RC preparation evidence is not verified',
      });
    }
  }
  if (!artifacts.packageSha256) {
    blockers.push({
      id: 'artifact.packageSha256',
      state: 'NOT_EXECUTED',
      reason: 'RC package digest has not been recorded',
    });
  }
  return blockers;
}

function workflowBlockers(runs: readonly RcWorkflowEvidence[]): RcPreparationBlocker[] {
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
    if (!matching.some((run) => run.conclusion === 'success')) {
      blockers.push({
        id: `workflow.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        state: 'BLOCKED',
        reason: `required workflow has no successful run: ${name}`,
      });
    }
  }
  return blockers;
}

export function createRcEvidenceSnapshot(input: RcEvidenceInput): RcEvidenceSnapshot {
  validateInput(input);

  const blockers: RcPreparationBlocker[] = [];
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

  blockers.push(...workflowBlockers(input.workflowRuns));
  blockers.push(...artifactBlockers(input.artifacts));

  return Object.freeze({
    format: 'furypipe-rc-evidence/v1',
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    packageVersion: input.packageVersion,
    readinessStatus: input.readiness.status,
    preparationStatus: blockers.length === 0 ? 'READY_FOR_RELEASE_DECISION' : 'BLOCKED',
    blockers: Object.freeze(blockers.map((blocker) => Object.freeze({ ...blocker }))),
    workflowRuns: Object.freeze(input.workflowRuns.map((run) => Object.freeze({ ...run }))),
    artifacts: Object.freeze({ ...input.artifacts }),
    authorization: Object.freeze({ ...input.readiness.authorization }),
    releaseActionsExecuted: false,
  });
}
