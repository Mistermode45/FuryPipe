import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  evaluateSecurityCiEvidenceExport,
  inspectSecurityCiWorkflowRuns,
  serializeControlRoomSecurityCiEvidence,
  type RawSecurityCiWorkflowJob,
  type RawSecurityCiWorkflowRun,
} from '../src/control-room/security-ci-evidence-exporter.js';

const SHA = 'a'.repeat(40);
const STALE_SHA = 'b'.repeat(40);

function workflow(
  workflowName: string,
  runId: number,
  conclusion: string | null = 'success',
  createdAt = runId,
  status = 'completed',
  headSha = SHA,
): RawSecurityCiWorkflowRun {
  return { workflowName, runId, conclusion, createdAt, status, headSha };
}

function workflows(overrides: RawSecurityCiWorkflowRun[] = []): RawSecurityCiWorkflowRun[] {
  return [
    workflow('CodeQL', 10),
    workflow('Secret Scan', 11),
    workflow('License Compliance', 12),
    workflow('Supply Chain', 13),
    ...overrides,
  ];
}

function job(
  name: string,
  jobId: number,
  conclusion: string | null = 'success',
  status = 'completed',
  runId = 13,
): RawSecurityCiWorkflowJob {
  return { name, jobId, conclusion, status, runId };
}

function jobs(overrides: RawSecurityCiWorkflowJob[] = []): RawSecurityCiWorkflowJob[] {
  return [
    job('Workflow action pinning', 101),
    job('Frozen dependency audit', 102),
    job('SPDX SBOM', 103),
    job('GitHub dependency review', 104, 'skipped'),
    ...overrides,
  ];
}

describe('Security CI evidence exporter builder', () => {
  it('builds exact-source evidence while preserving skipped Dependency Review', () => {
    const result = evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 123,
      workflowRuns: workflows(),
      supplyChainJobs: jobs(),
    });

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('expected ready evidence');
    expect(result.evidence).toEqual({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 123,
      sourceCommit: SHA,
      codeql: { runId: 10, headSha: SHA, conclusion: 'success' },
      secretScan: { runId: 11, headSha: SHA, conclusion: 'success' },
      licenseCompliance: { runId: 12, headSha: SHA, conclusion: 'success' },
      supplyChain: {
        run: { runId: 13, headSha: SHA, conclusion: 'success' },
        jobs: {
          actionPinning: 'success',
          dependencyAudit: 'success',
          sbom: 'success',
          dependencyReview: 'skipped',
        },
      },
    });
  });

  it('selects the newest run for the exact SHA even when an older run was green', () => {
    const result = evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 1,
      workflowRuns: workflows([
        workflow('CodeQL', 20, 'failure', 1000),
        workflow('Secret Scan', 21, 'cancelled', 1001),
      ]),
      supplyChainJobs: jobs(),
    });

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('expected ready evidence');
    expect(result.evidence.codeql).toMatchObject({ runId: 20, conclusion: 'failure' });
    expect(result.evidence.secretScan).toMatchObject({ runId: 21, conclusion: 'cancelled' });
  });

  it('rejects stale target-workflow SHAs rather than silently ignoring them', () => {
    expect(() => inspectSecurityCiWorkflowRuns([
      workflow('CodeQL', 1, 'success', 1, 'completed', STALE_SHA),
    ], SHA)).toThrow(/stale/i);
  });

  it('waits for missing, queued and in-progress target workflows', () => {
    const missing = inspectSecurityCiWorkflowRuns([
      workflow('CodeQL', 1),
      workflow('Secret Scan', 2, null, 2, 'queued'),
      workflow('License Compliance', 3, null, 3, 'in_progress'),
      workflow('Almost Supply Chain', 4),
    ], SHA);

    expect(missing.waiting.join(' ')).toContain('Secret Scan');
    expect(missing.waiting.join(' ')).toContain('License Compliance');
    expect(missing.waiting.join(' ')).toContain('Supply Chain');
  });

  it('rejects duplicate run IDs and unsupported terminal conclusions', () => {
    expect(() => inspectSecurityCiWorkflowRuns([
      workflow('CodeQL', 1),
      workflow('Secret Scan', 1),
    ], SHA)).toThrow(/duplicated/i);

    expect(() => inspectSecurityCiWorkflowRuns([
      workflow('CodeQL', 1, 'timed_out'),
      workflow('Secret Scan', 2),
      workflow('License Compliance', 3),
      workflow('Supply Chain', 4),
    ], SHA)).toThrow(/unsupported terminal conclusion/i);
  });

  it('does not infer nested Supply Chain success from the parent workflow', () => {
    const result = evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 1,
      workflowRuns: workflows(),
      supplyChainJobs: [
        job('Workflow action pinning', 101),
        job('Frozen dependency audit', 102),
        job('SPDX SBOM', 103),
      ],
    });
    expect(result.state).toBe('waiting');
    if (result.state !== 'waiting') throw new Error('expected waiting evidence');
    expect(result.waiting.join(' ')).toMatch(/dependency review/i);
  });

  it('preserves failed/cancelled/skipped Supply Chain jobs independently', () => {
    const result = evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 1,
      workflowRuns: [
        workflow('CodeQL', 10),
        workflow('Secret Scan', 11),
        workflow('License Compliance', 12),
        workflow('Supply Chain', 13, 'failure'),
      ],
      supplyChainJobs: [
        job('Workflow action pinning', 101, 'failure'),
        job('Frozen dependency audit', 102, 'cancelled'),
        job('SPDX SBOM', 103, 'success'),
        job('GitHub dependency review', 104, 'skipped'),
      ],
    });

    expect(result.state).toBe('ready');
    if (result.state !== 'ready') throw new Error('expected ready evidence');
    expect(result.evidence.supplyChain?.jobs).toEqual({
      actionPinning: 'failure',
      dependencyAudit: 'cancelled',
      sbom: 'success',
      dependencyReview: 'skipped',
    });
  });

  it('rejects contradictory parent success and nested failure through the canonical #121 parser', () => {
    expect(() => evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 1,
      workflowRuns: workflows(),
      supplyChainJobs: [
        job('Workflow action pinning', 101, 'failure'),
        job('Frozen dependency audit', 102),
        job('SPDX SBOM', 103),
        job('GitHub dependency review', 104, 'skipped'),
      ],
    })).toThrow(/Successful Supply Chain workflow cannot contain failed or cancelled job evidence/i);
  });

  it('rejects duplicate mapped jobs and jobs from another workflow run', () => {
    expect(() => evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 1,
      workflowRuns: workflows(),
      supplyChainJobs: [
        ...jobs(),
        job('SPDX SBOM', 999),
      ],
    })).toThrow(/duplicate mapped job/i);

    expect(() => evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 1,
      workflowRuns: workflows(),
      supplyChainJobs: [
        job('Workflow action pinning', 101),
        job('Frozen dependency audit', 102),
        job('SPDX SBOM', 103, 'success', 'completed', 999),
        job('GitHub dependency review', 104, 'skipped'),
      ],
    })).toThrow(/different workflow run/i);
  });

  it('waits for non-terminal jobs and rejects unsupported terminal job conclusions', () => {
    const waiting = evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 1,
      workflowRuns: workflows(),
      supplyChainJobs: [
        job('Workflow action pinning', 101),
        job('Frozen dependency audit', 102, null, 'in_progress'),
        job('SPDX SBOM', 103),
        job('GitHub dependency review', 104, 'skipped'),
      ],
    });
    expect(waiting.state).toBe('waiting');

    expect(() => evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 1,
      workflowRuns: workflows(),
      supplyChainJobs: [
        job('Workflow action pinning', 101),
        job('Frozen dependency audit', 102, 'timed_out'),
        job('SPDX SBOM', 103),
        job('GitHub dependency review', 104, 'skipped'),
      ],
    })).toThrow(/unsupported terminal conclusion/i);
  });

  it('serializes deterministically and yields a stable SHA-256 for identical canonical evidence', () => {
    const first = evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 777,
      workflowRuns: workflows(),
      supplyChainJobs: jobs(),
    });
    const second = evaluateSecurityCiEvidenceExport({
      sourceCommit: SHA,
      generatedAt: 777,
      workflowRuns: [...workflows()].reverse(),
      supplyChainJobs: [...jobs()].reverse(),
    });

    expect(first.state).toBe('ready');
    expect(second.state).toBe('ready');
    if (first.state !== 'ready' || second.state !== 'ready') throw new Error('expected ready evidence');

    const a = serializeControlRoomSecurityCiEvidence(first.evidence);
    const b = serializeControlRoomSecurityCiEvidence(second.evidence);
    expect(a).toBe(b);
    expect(createHash('sha256').update(a, 'utf8').digest('hex'))
      .toBe(createHash('sha256').update(b, 'utf8').digest('hex'));
    expect(a).not.toContain('Authorization');
    expect(a).not.toContain('api.github.com');
  });
});
