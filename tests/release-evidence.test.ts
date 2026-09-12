import { describe, expect, it } from 'vitest';
import {
  createV5ReleaseGates,
  evaluateReleaseReadiness,
  type V5ReleaseGateStates,
} from '../src/release-readiness/index.js';
import {
  createRcEvidenceSnapshot,
  type RcArtifactEvidence,
  type RcWorkflowEvidence,
} from '../src/release-readiness/evidence.js';

const SHA = 'a'.repeat(40);
const VERSION = '0.13.2';

function verifiedStates(): V5ReleaseGateStates {
  return {
    ciPush: 'VERIFIED',
    ciPr: 'VERIFIED',
    codeql: 'VERIFIED',
    secretScan: 'VERIFIED',
    supplyChain: 'VERIFIED',
    licenseCompliance: 'VERIFIED',
    recovery: 'VERIFIED',
    mcp: 'VERIFIED',
    agentRuntime: 'VERIFIED',
    furyPrompt: 'VERIFIED',
    learning: 'VERIFIED',
    webStudio: 'VERIFIED',
    controlRoom: 'VERIFIED',
    i18n: 'VERIFIED',
    documentation: 'VERIFIED',
    branchPolicy: 'VERIFIED',
    provenance: 'VERIFIED',
    dependencyReview: 'BLOCKED_BY_REPO_SETTING',
    providerBenchmarks: 'NOT_EXECUTED',
  };
}

function readiness(overrides: Partial<V5ReleaseGateStates> = {}) {
  return evaluateReleaseReadiness({
    generatedAt: 1_725_000_000_000,
    sourceCommit: SHA,
    packageVersion: VERSION,
    channel: 'rc',
    performanceClaims: false,
    gates: createV5ReleaseGates({ ...verifiedStates(), ...overrides }),
    authorization: {
      mergeDefaultBranch: false,
      createReleaseTag: false,
      publishNpm: false,
      deployProduction: false,
    },
  });
}

function workflows(): RcWorkflowEvidence[] {
  return [
    { name: 'CI', runId: 1, conclusion: 'success' },
    { name: 'CodeQL', runId: 2, conclusion: 'success' },
    { name: 'Secret Scan', runId: 3, conclusion: 'success' },
    { name: 'Supply Chain', runId: 4, conclusion: 'success' },
    { name: 'License Compliance', runId: 5, conclusion: 'success' },
    { name: 'Benchmark Contract', runId: 6, conclusion: 'success' },
  ];
}

function artifacts(overrides: Partial<RcArtifactEvidence> = {}): RcArtifactEvidence {
  return {
    packageSmoke: 'VERIFIED',
    installationSmoke: 'VERIFIED',
    upgradeSmoke: 'VERIFIED',
    rollbackEvidence: 'VERIFIED',
    sbom: 'VERIFIED',
    provenance: 'VERIFIED',
    compatibilityMatrix: 'VERIFIED',
    migrationNotes: 'VERIFIED',
    releaseNotes: 'VERIFIED',
    packageSha256: 'b'.repeat(64),
    ...overrides,
  };
}

describe('RC evidence snapshot', () => {
  it('becomes ready for a release decision without authorizing or executing release actions', () => {
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 1_725_000_000_100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });

    expect(snapshot.preparationStatus).toBe('READY_FOR_RELEASE_DECISION');
    expect(snapshot.blockers).toEqual([]);
    expect(snapshot.authorization).toEqual({
      mergeDefaultBranch: false,
      createReleaseTag: false,
      publishNpm: false,
      deployProduction: false,
    });
    expect(snapshot.releaseActionsExecuted).toBe(false);
  });

  it('fails closed when Release Readiness is still blocked', () => {
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 1,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness({ mcp: 'PARTIAL' }),
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });

    expect(snapshot.preparationStatus).toBe('BLOCKED');
    expect(snapshot.blockers).toContainEqual({
      id: 'readiness.status',
      state: 'BLOCKED',
      reason: 'Release Readiness is still blocked',
    });
  });

  it('rejects stale identity by recording SHA and package-version mismatch blockers', () => {
    const report = readiness();
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 1,
      sourceCommit: 'c'.repeat(40),
      packageVersion: '0.13.3',
      readiness: report,
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });

    expect(snapshot.blockers.map((blocker) => blocker.id)).toEqual(expect.arrayContaining([
      'identity.sourceCommit',
      'identity.packageVersion',
    ]));
    expect(snapshot.preparationStatus).toBe('BLOCKED');
  });

  it('blocks missing or failed workflow evidence instead of inferring CI state', () => {
    const runs = workflows()
      .filter((run) => run.name !== 'CodeQL')
      .map((run) => run.name === 'CI' ? { ...run, conclusion: 'failure' as const } : run);

    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 1,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: runs,
      artifacts: artifacts(),
    });

    expect(snapshot.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workflow.codeql', state: 'NOT_EXECUTED' }),
      expect.objectContaining({ id: 'workflow.ci', state: 'BLOCKED' }),
    ]));
  });

  it('requires every RC preparation artifact and a package SHA-256 digest', () => {
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 1,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: workflows(),
      artifacts: artifacts({ rollbackEvidence: 'NOT_EXECUTED', packageSha256: undefined }),
    });

    expect(snapshot.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'artifact.rollbackEvidence', state: 'NOT_EXECUTED' }),
      expect.objectContaining({ id: 'artifact.packageSha256', state: 'NOT_EXECUTED' }),
    ]));
  });

  it('validates workflow identity and package digests', () => {
    expect(() => createRcEvidenceSnapshot({
      generatedAt: 1,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: [
        ...workflows(),
        { name: 'CI', runId: 1, conclusion: 'success' },
      ],
      artifacts: artifacts(),
    })).toThrow(/duplicate RC workflow runId/);

    expect(() => createRcEvidenceSnapshot({
      generatedAt: 1,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: workflows(),
      artifacts: artifacts({ packageSha256: 'latest' }),
    })).toThrow(/packageSha256/);
  });
});
