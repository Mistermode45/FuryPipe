import type { ControlRoomEvidenceStatus, SecurityEvidence } from './index.js';

export type SecurityCiConclusion = 'success' | 'failure' | 'cancelled' | 'skipped';

export interface SecurityCiWorkflowRunEvidence {
  readonly runId: number;
  readonly headSha: string;
  readonly conclusion: SecurityCiConclusion;
}

export interface SecurityCiSupplyChainJobsEvidence {
  readonly actionPinning?: SecurityCiConclusion;
  readonly dependencyAudit?: SecurityCiConclusion;
  readonly sbom?: SecurityCiConclusion;
  readonly dependencyReview?: SecurityCiConclusion;
}

export interface ControlRoomSecurityCiEvidence {
  readonly format: 'furypipe-control-room-security-ci-evidence/v1';
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly codeql?: SecurityCiWorkflowRunEvidence;
  readonly secretScan?: SecurityCiWorkflowRunEvidence;
  readonly licenseCompliance?: SecurityCiWorkflowRunEvidence;
  readonly supplyChain?: Readonly<{
    readonly run: SecurityCiWorkflowRunEvidence;
    readonly jobs: SecurityCiSupplyChainJobsEvidence;
  }>;
}

export interface ControlRoomSecurityCiSnapshot {
  readonly format: 'furypipe-control-room-security-ci-snapshot/v1';
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly security: SecurityEvidence;
}

const SHA40 = /^[0-9a-f]{40}$/u;
const CONCLUSIONS = new Set<SecurityCiConclusion>([
  'success',
  'failure',
  'cancelled',
  'skipped',
]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function runId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA40.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character commit SHA`);
  }
  return value;
}

function conclusion(value: unknown, label: string): SecurityCiConclusion {
  if (!CONCLUSIONS.has(value as SecurityCiConclusion)) {
    throw new Error(`${label} has an invalid workflow conclusion`);
  }
  return value as SecurityCiConclusion;
}

function parseRun(
  value: unknown,
  label: string,
  sourceCommit: string,
): SecurityCiWorkflowRunEvidence {
  const v = object(value, label);
  const headSha = sha(v.headSha, `${label}.headSha`);
  if (headSha !== sourceCommit) {
    throw new Error(`${label}.headSha does not match sourceCommit`);
  }
  return Object.freeze({
    runId: runId(v.runId, `${label}.runId`),
    headSha,
    conclusion: conclusion(v.conclusion, `${label}.conclusion`),
  });
}

function optionalRun(
  value: unknown,
  label: string,
  sourceCommit: string,
): SecurityCiWorkflowRunEvidence | undefined {
  return value === undefined ? undefined : parseRun(value, label, sourceCommit);
}

function optionalConclusion(value: unknown, label: string): SecurityCiConclusion | undefined {
  return value === undefined ? undefined : conclusion(value, label);
}

function parseSupplyChain(
  value: unknown,
  sourceCommit: string,
): ControlRoomSecurityCiEvidence['supplyChain'] {
  if (value === undefined) return undefined;
  const v = object(value, 'supplyChain');
  const jobsValue = object(v.jobs, 'supplyChain.jobs');
  return Object.freeze({
    run: parseRun(v.run, 'supplyChain.run', sourceCommit),
    jobs: Object.freeze({
      ...(jobsValue.actionPinning === undefined
        ? {}
        : { actionPinning: optionalConclusion(jobsValue.actionPinning, 'supplyChain.jobs.actionPinning')! }),
      ...(jobsValue.dependencyAudit === undefined
        ? {}
        : { dependencyAudit: optionalConclusion(jobsValue.dependencyAudit, 'supplyChain.jobs.dependencyAudit')! }),
      ...(jobsValue.sbom === undefined
        ? {}
        : { sbom: optionalConclusion(jobsValue.sbom, 'supplyChain.jobs.sbom')! }),
      ...(jobsValue.dependencyReview === undefined
        ? {}
        : { dependencyReview: optionalConclusion(jobsValue.dependencyReview, 'supplyChain.jobs.dependencyReview')! }),
    }),
  });
}

export function parseControlRoomSecurityCiEvidence(
  value: unknown,
  expectedSourceCommit: string,
): ControlRoomSecurityCiEvidence {
  const expected = sha(expectedSourceCommit, 'expectedSourceCommit');
  const v = object(value, 'Control Room security CI evidence');
  if (v.format !== 'furypipe-control-room-security-ci-evidence/v1') {
    throw new Error('Control Room security CI evidence format is invalid');
  }
  const sourceCommit = sha(v.sourceCommit, 'sourceCommit');
  if (sourceCommit !== expected) {
    throw new Error('Control Room security CI evidence sourceCommit does not match expected source commit');
  }
  const codeql = optionalRun(v.codeql, 'codeql', sourceCommit);
  const secretScan = optionalRun(v.secretScan, 'secretScan', sourceCommit);
  const licenseCompliance = optionalRun(v.licenseCompliance, 'licenseCompliance', sourceCommit);
  const supplyChain = parseSupplyChain(v.supplyChain, sourceCommit);

  const runIds = [
    codeql?.runId,
    secretScan?.runId,
    licenseCompliance?.runId,
    supplyChain?.run.runId,
  ].filter((value): value is number => value !== undefined);
  if (new Set(runIds).size !== runIds.length) {
    throw new Error('Security CI workflow run IDs must be unique across evidence sources');
  }

  if (supplyChain !== undefined) {
    const jobConclusions = Object.values(supplyChain.jobs);
    if (
      supplyChain.run.conclusion === 'success'
      && jobConclusions.some((value) => value === 'failure' || value === 'cancelled')
    ) {
      throw new Error('Successful Supply Chain workflow cannot contain failed or cancelled job evidence');
    }
    if (
      supplyChain.run.conclusion === 'skipped'
      && jobConclusions.some((value) => value !== 'skipped')
    ) {
      throw new Error('Skipped Supply Chain workflow cannot contain executed job evidence');
    }
  }

  return Object.freeze({
    format: 'furypipe-control-room-security-ci-evidence/v1',
    generatedAt: timestamp(v.generatedAt, 'generatedAt'),
    sourceCommit,
    ...(codeql === undefined ? {} : { codeql }),
    ...(secretScan === undefined ? {} : { secretScan }),
    ...(licenseCompliance === undefined ? {} : { licenseCompliance }),
    ...(supplyChain === undefined ? {} : { supplyChain }),
  });
}

function statusFromConclusion(value: SecurityCiConclusion | undefined): ControlRoomEvidenceStatus {
  if (value === undefined) return 'NOT_AVAILABLE';
  switch (value) {
    case 'success': return 'VERIFIED';
    case 'failure': return 'BLOCKED';
    case 'cancelled': return 'PARTIAL';
    case 'skipped': return 'NOT_EXECUTED';
  }
}

function workflowStatus(value: SecurityCiWorkflowRunEvidence | undefined): ControlRoomEvidenceStatus {
  return statusFromConclusion(value?.conclusion);
}

export function createControlRoomSecurityCiSnapshot(
  input: ControlRoomSecurityCiEvidence,
): ControlRoomSecurityCiSnapshot {
  const parsed = parseControlRoomSecurityCiEvidence(input, input.sourceCommit);
  const supply = parsed.supplyChain;
  const security: SecurityEvidence = Object.freeze({
    codeql: workflowStatus(parsed.codeql),
    secretScan: workflowStatus(parsed.secretScan),
    dependencyAudit: statusFromConclusion(supply?.jobs.dependencyAudit),
    sbom: statusFromConclusion(supply?.jobs.sbom),
    actionPinning: statusFromConclusion(supply?.jobs.actionPinning),
    licenseCompliance: workflowStatus(parsed.licenseCompliance),
    dependencyReview: statusFromConclusion(supply?.jobs.dependencyReview),
  });
  return Object.freeze({
    format: 'furypipe-control-room-security-ci-snapshot/v1',
    generatedAt: parsed.generatedAt,
    sourceCommit: parsed.sourceCommit,
    security,
  });
}

export function createControlRoomSecurityCiSnapshotFromUnknown(
  value: unknown,
  expectedSourceCommit: string,
): ControlRoomSecurityCiSnapshot {
  return createControlRoomSecurityCiSnapshot(
    parseControlRoomSecurityCiEvidence(value, expectedSourceCommit),
  );
}
