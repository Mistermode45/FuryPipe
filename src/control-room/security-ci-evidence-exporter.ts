import {
  parseControlRoomSecurityCiEvidence,
  type ControlRoomSecurityCiEvidence,
  type SecurityCiConclusion,
  type SecurityCiWorkflowRunEvidence,
} from './security-ci-evidence.js';

export const SECURITY_CI_WORKFLOW_NAMES = Object.freeze({
  codeql: 'CodeQL',
  secretScan: 'Secret Scan',
  licenseCompliance: 'License Compliance',
  supplyChain: 'Supply Chain',
} as const);

export const SECURITY_CI_SUPPLY_CHAIN_JOB_NAMES = Object.freeze({
  actionPinning: 'Workflow action pinning',
  dependencyAudit: 'Frozen dependency audit',
  sbom: 'SPDX SBOM',
  dependencyReview: 'GitHub dependency review',
} as const);

export interface RawSecurityCiWorkflowRun {
  readonly runId: number;
  readonly workflowName: string;
  readonly headSha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly createdAt: number;
}

export interface RawSecurityCiWorkflowJob {
  readonly jobId: number;
  readonly runId: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

export interface SecurityCiWorkflowSelection {
  readonly selected: Readonly<{
    readonly codeql?: RawSecurityCiWorkflowRun;
    readonly secretScan?: RawSecurityCiWorkflowRun;
    readonly licenseCompliance?: RawSecurityCiWorkflowRun;
    readonly supplyChain?: RawSecurityCiWorkflowRun;
  }>;
  readonly waiting: readonly string[];
}

export type SecurityCiEvidenceExportEvaluation =
  | Readonly<{
      readonly state: 'waiting';
      readonly waiting: readonly string[];
    }>
  | Readonly<{
      readonly state: 'ready';
      readonly evidence: ControlRoomSecurityCiEvidence;
    }>;

const SHA40 = /^[0-9a-f]{40}$/u;
const TERMINAL_CONCLUSIONS = new Set<SecurityCiConclusion>([
  'success',
  'failure',
  'cancelled',
  'skipped',
]);
const WORKFLOW_STATUSES = new Set([
  'queued',
  'in_progress',
  'requested',
  'waiting',
  'pending',
  'completed',
]);

function sourceSha(value: string): string {
  if (!SHA40.test(value)) {
    throw new Error('Security CI exporter sourceCommit must be a lowercase 40-character commit SHA');
  }
  return value;
}

function boundedId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function boundedTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function boundedName(value: string, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function workflowStatus(value: string, label: string): string {
  if (!WORKFLOW_STATUSES.has(value)) {
    throw new Error(`${label} has an unsupported workflow status`);
  }
  return value;
}

function terminalConclusion(
  status: string,
  conclusion: string | null,
  label: string,
): SecurityCiConclusion | undefined {
  if (status !== 'completed') return undefined;
  if (conclusion === null || !TERMINAL_CONCLUSIONS.has(conclusion as SecurityCiConclusion)) {
    throw new Error(`${label} has an unsupported terminal conclusion`);
  }
  return conclusion as SecurityCiConclusion;
}

function validateRun(
  run: RawSecurityCiWorkflowRun,
  index: number,
): RawSecurityCiWorkflowRun {
  boundedId(run.runId, `workflowRuns[${index}].runId`);
  boundedName(run.workflowName, `workflowRuns[${index}].workflowName`);
  sourceSha(run.headSha);
  workflowStatus(run.status, `workflowRuns[${index}].status`);
  boundedTimestamp(run.createdAt, `workflowRuns[${index}].createdAt`);
  if (run.conclusion !== null && typeof run.conclusion !== 'string') {
    throw new Error(`workflowRuns[${index}].conclusion must be a string or null`);
  }
  return run;
}

function latestRun(
  runs: readonly RawSecurityCiWorkflowRun[],
  workflowName: string,
  expectedSourceCommit: string,
): RawSecurityCiWorkflowRun | undefined {
  const matching = runs.filter((run) => run.workflowName === workflowName);
  for (const run of matching) {
    if (run.headSha !== expectedSourceCommit) {
      throw new Error(`${workflowName} workflow evidence is stale for the requested source commit`);
    }
  }
  return matching.reduce<RawSecurityCiWorkflowRun | undefined>((latest, current) => {
    if (latest === undefined) return current;
    if (current.createdAt > latest.createdAt) return current;
    if (current.createdAt === latest.createdAt && current.runId > latest.runId) return current;
    return latest;
  }, undefined);
}

export function inspectSecurityCiWorkflowRuns(
  workflowRuns: readonly RawSecurityCiWorkflowRun[],
  expectedSourceCommit: string,
): SecurityCiWorkflowSelection {
  const sourceCommit = sourceSha(expectedSourceCommit);
  const validated = workflowRuns.map(validateRun);
  const ids = new Set<number>();
  for (const run of validated) {
    if (ids.has(run.runId)) {
      throw new Error('Security CI workflow run IDs must not be duplicated in exporter input');
    }
    ids.add(run.runId);
  }

  const selected = {
    codeql: latestRun(validated, SECURITY_CI_WORKFLOW_NAMES.codeql, sourceCommit),
    secretScan: latestRun(validated, SECURITY_CI_WORKFLOW_NAMES.secretScan, sourceCommit),
    licenseCompliance: latestRun(validated, SECURITY_CI_WORKFLOW_NAMES.licenseCompliance, sourceCommit),
    supplyChain: latestRun(validated, SECURITY_CI_WORKFLOW_NAMES.supplyChain, sourceCommit),
  };

  const waiting: string[] = [];
  for (const [label, run] of [
    [SECURITY_CI_WORKFLOW_NAMES.codeql, selected.codeql],
    [SECURITY_CI_WORKFLOW_NAMES.secretScan, selected.secretScan],
    [SECURITY_CI_WORKFLOW_NAMES.licenseCompliance, selected.licenseCompliance],
    [SECURITY_CI_WORKFLOW_NAMES.supplyChain, selected.supplyChain],
  ] as const) {
    if (run === undefined) {
      waiting.push(`${label}: no run for exact source SHA`);
      continue;
    }
    if (run.status !== 'completed') {
      waiting.push(`${label}: latest run is not terminal`);
      continue;
    }
    terminalConclusion(run.status, run.conclusion, label);
  }

  return Object.freeze({
    selected: Object.freeze({
      ...(selected.codeql === undefined ? {} : { codeql: selected.codeql }),
      ...(selected.secretScan === undefined ? {} : { secretScan: selected.secretScan }),
      ...(selected.licenseCompliance === undefined ? {} : { licenseCompliance: selected.licenseCompliance }),
      ...(selected.supplyChain === undefined ? {} : { supplyChain: selected.supplyChain }),
    }),
    waiting: Object.freeze(waiting),
  });
}

function runEvidence(
  run: RawSecurityCiWorkflowRun,
  label: string,
): SecurityCiWorkflowRunEvidence {
  const conclusion = terminalConclusion(run.status, run.conclusion, label);
  if (conclusion === undefined) {
    throw new Error(`${label} is not terminal`);
  }
  return Object.freeze({
    runId: run.runId,
    headSha: run.headSha,
    conclusion,
  });
}

function validateJob(job: RawSecurityCiWorkflowJob, index: number): RawSecurityCiWorkflowJob {
  boundedId(job.jobId, `supplyChainJobs[${index}].jobId`);
  boundedId(job.runId, `supplyChainJobs[${index}].runId`);
  boundedName(job.name, `supplyChainJobs[${index}].name`);
  workflowStatus(job.status, `supplyChainJobs[${index}].status`);
  if (job.conclusion !== null && typeof job.conclusion !== 'string') {
    throw new Error(`supplyChainJobs[${index}].conclusion must be a string or null`);
  }
  return job;
}

function inspectSupplyChainJobs(
  jobs: readonly RawSecurityCiWorkflowJob[],
  expectedRunId: number,
): Readonly<{
  readonly waiting: readonly string[];
  readonly conclusions: Readonly<{
    readonly actionPinning?: SecurityCiConclusion;
    readonly dependencyAudit?: SecurityCiConclusion;
    readonly sbom?: SecurityCiConclusion;
    readonly dependencyReview?: SecurityCiConclusion;
  }>;
}> {
  const validated = jobs.map(validateJob);
  const ids = new Set<number>();
  for (const job of validated) {
    if (ids.has(job.jobId)) {
      throw new Error('Supply Chain job IDs must not be duplicated in exporter input');
    }
    ids.add(job.jobId);
  }

  const targets = new Map<string, RawSecurityCiWorkflowJob>();
  const expectedNames = new Set<string>(Object.values(SECURITY_CI_SUPPLY_CHAIN_JOB_NAMES));
  for (const job of validated) {
    if (!expectedNames.has(job.name)) continue;
    if (job.runId !== expectedRunId) {
      throw new Error('Supply Chain job evidence belongs to a different workflow run');
    }
    if (targets.has(job.name)) {
      throw new Error(`Supply Chain contains duplicate mapped job evidence for ${job.name}`);
    }
    targets.set(job.name, job);
  }

  const waiting: string[] = [];
  const conclusions: {
    actionPinning?: SecurityCiConclusion;
    dependencyAudit?: SecurityCiConclusion;
    sbom?: SecurityCiConclusion;
    dependencyReview?: SecurityCiConclusion;
  } = {};

  for (const [key, name] of Object.entries(SECURITY_CI_SUPPLY_CHAIN_JOB_NAMES) as [
    keyof typeof SECURITY_CI_SUPPLY_CHAIN_JOB_NAMES,
    string,
  ][]) {
    const job = targets.get(name);
    if (job === undefined) {
      waiting.push(`Supply Chain: missing ${name} job`);
      continue;
    }
    if (job.status !== 'completed') {
      waiting.push(`Supply Chain: ${name} job is not terminal`);
      continue;
    }
    const conclusion = terminalConclusion(job.status, job.conclusion, `Supply Chain job ${name}`);
    if (conclusion !== undefined) conclusions[key] = conclusion;
  }

  return Object.freeze({
    waiting: Object.freeze(waiting),
    conclusions: Object.freeze(conclusions),
  });
}

export function evaluateSecurityCiEvidenceExport(input: Readonly<{
  readonly sourceCommit: string;
  readonly generatedAt: number;
  readonly workflowRuns: readonly RawSecurityCiWorkflowRun[];
  readonly supplyChainJobs: readonly RawSecurityCiWorkflowJob[];
}>): SecurityCiEvidenceExportEvaluation {
  const sourceCommit = sourceSha(input.sourceCommit);
  const generatedAt = boundedTimestamp(input.generatedAt, 'generatedAt');
  const selection = inspectSecurityCiWorkflowRuns(input.workflowRuns, sourceCommit);
  const waiting = [...selection.waiting];

  const supplyRun = selection.selected.supplyChain;
  let supplyJobs: ReturnType<typeof inspectSupplyChainJobs> | undefined;
  if (supplyRun !== undefined) {
    supplyJobs = inspectSupplyChainJobs(input.supplyChainJobs, supplyRun.runId);
    waiting.push(...supplyJobs.waiting);
  }

  if (waiting.length > 0) {
    return Object.freeze({
      state: 'waiting',
      waiting: Object.freeze(waiting),
    });
  }

  const codeql = selection.selected.codeql;
  const secretScan = selection.selected.secretScan;
  const licenseCompliance = selection.selected.licenseCompliance;
  if (
    codeql === undefined
    || secretScan === undefined
    || licenseCompliance === undefined
    || supplyRun === undefined
    || supplyJobs === undefined
  ) {
    throw new Error('Security CI exporter reached an inconsistent ready state');
  }

  const candidate: ControlRoomSecurityCiEvidence = {
    format: 'furypipe-control-room-security-ci-evidence/v1',
    generatedAt,
    sourceCommit,
    codeql: runEvidence(codeql, SECURITY_CI_WORKFLOW_NAMES.codeql),
    secretScan: runEvidence(secretScan, SECURITY_CI_WORKFLOW_NAMES.secretScan),
    licenseCompliance: runEvidence(licenseCompliance, SECURITY_CI_WORKFLOW_NAMES.licenseCompliance),
    supplyChain: {
      run: runEvidence(supplyRun, SECURITY_CI_WORKFLOW_NAMES.supplyChain),
      jobs: supplyJobs.conclusions,
    },
  };

  return Object.freeze({
    state: 'ready',
    evidence: parseControlRoomSecurityCiEvidence(candidate, sourceCommit),
  });
}

export function serializeControlRoomSecurityCiEvidence(
  evidence: ControlRoomSecurityCiEvidence,
): string {
  const parsed = parseControlRoomSecurityCiEvidence(evidence, evidence.sourceCommit);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
