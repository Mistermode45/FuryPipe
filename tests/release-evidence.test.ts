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

function readiness(overrides: Partial<V5ReleaseGateStates> = {}, performanceClaims = false) {
  return evaluateReleaseReadiness({
    generatedAt: 1_725_000_000_000,
    sourceCommit: SHA,
    packageVersion: VERSION,
    channel: 'rc',
    performanceClaims,
    gates: (() => {
      const states = { ...verifiedStates(), ...overrides };
      const provenanceByGate = Object.fromEntries(createV5ReleaseGates(states).flatMap((gate) => {
        if (gate.state !== 'VERIFIED') return [];
        const origin = gate.id.startsWith('ci.') || gate.id.startsWith('security.') || gate.id === 'release.provenance'
          ? 'github-actions'
          : gate.id === 'repo.branch-policy' ? 'github'
            : gate.id === 'runtime.mcp' || gate.id === 'runtime.web-studio' ? 'hosted'
              : gate.id === 'benchmarks.provider' ? 'provider' : 'local';
        return [[gate.id, { sourceCommit: SHA, observedAt: 1_725_000_000_000, origin, reference: `evidence:${gate.id}` }]];
      }));
      return createV5ReleaseGates(states, provenanceByGate);
    })(),
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
    { name: 'CI', runId: 1, headSha: SHA, updatedAt: 1, origin: 'github-actions', reference: 'run:1', conclusion: 'success' },
    { name: 'CodeQL', runId: 2, headSha: SHA, updatedAt: 1, origin: 'github-actions', reference: 'run:2', conclusion: 'success' },
    { name: 'Secret Scan', runId: 3, headSha: SHA, updatedAt: 1, origin: 'github-actions', reference: 'run:3', conclusion: 'success' },
    { name: 'Supply Chain', runId: 4, headSha: SHA, updatedAt: 1, origin: 'github-actions', reference: 'run:4', conclusion: 'success' },
    { name: 'License Compliance', runId: 5, headSha: SHA, updatedAt: 1, origin: 'github-actions', reference: 'run:5', conclusion: 'success' },
    { name: 'Provenance Attestation', runId: 6, headSha: SHA, updatedAt: 1, origin: 'github-actions', reference: 'run:6', conclusion: 'success' },
    { name: 'Benchmark Contract', runId: 7, headSha: SHA, updatedAt: 1, origin: 'github-actions', reference: 'run:7', conclusion: 'success' },
  ];
}

function artifacts(overrides: Partial<RcArtifactEvidence> = {}): RcArtifactEvidence {
  const proof = (reference: string, origin: 'local' | 'github-actions'): NonNullable<RcArtifactEvidence['proofs']>[keyof NonNullable<RcArtifactEvidence['proofs']>] => ({
    sourceCommit: SHA, observedAt: 1, origin, reference,
  });
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
    proofs: {
      packageSmoke: proof('package-smoke', 'local'),
      installationSmoke: proof('installation-smoke', 'local'),
      upgradeSmoke: proof('upgrade-smoke', 'local'),
      rollbackEvidence: proof('rollback', 'local'),
      sbom: proof('sbom', 'github-actions'),
      provenance: proof('provenance', 'github-actions'),
      compatibilityMatrix: proof('compatibility', 'local'),
      migrationNotes: proof('migration-notes', 'local'),
      releaseNotes: proof('release-notes', 'local'),
      packageSha256: { ...proof('package', 'github-actions'), artifactSha256: 'b'.repeat(64) },
    },
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

  it('does not let an older successful workflow mask a newer skipped or mixed-SHA run', () => {
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: [
        ...workflows(),
        { name: 'CI', runId: 50, headSha: SHA, updatedAt: 90, origin: 'github-actions', reference: 'run:50', conclusion: 'skipped' },
        { name: 'CodeQL', runId: 51, headSha: 'b'.repeat(40), updatedAt: 90, origin: 'github-actions', reference: 'run:51', conclusion: 'success' },
      ],
      artifacts: artifacts(),
    });

    expect(snapshot.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workflow.ci', state: 'BLOCKED' }),
      expect.objectContaining({ id: 'workflow.codeql', state: 'MISMATCH' }),
    ]));
  });

  it('requires exact-source references for every artifact marked VERIFIED', () => {
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: workflows(),
      artifacts: artifacts({ proofs: undefined }),
    });

    expect(snapshot.preparationStatus).toBe('BLOCKED');
    expect(snapshot.blockers.filter((blocker) => blocker.id.startsWith('artifact.'))).toHaveLength(10);
  });

  it('fails closed on a future readiness report or duplicate gate provenance', () => {
    const base = readiness();
    const futureReport = createRcEvidenceSnapshot({
      generatedAt: 1_725_000_000_100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: { ...base, generatedAt: 1_725_000_000_101 },
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(futureReport.preparationStatus).toBe('BLOCKED');
    expect(futureReport.blockers).toContainEqual(expect.objectContaining({ id: 'readiness.integrity', state: 'MISMATCH' }));

    const firstEvidence = base.verifiedGateEvidence[0]!;
    const duplicateProvenance = createRcEvidenceSnapshot({
      generatedAt: 1_725_000_000_100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: { ...base, verifiedGateEvidence: [firstEvidence, firstEvidence] },
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(duplicateProvenance.preparationStatus).toBe('BLOCKED');
    expect(duplicateProvenance.blockers).toContainEqual(expect.objectContaining({ id: 'readiness.integrity', state: 'MISMATCH' }));
  });

  it('does not accept a ready report whose verified gate IDs are invented', () => {
    const base = readiness();
    const fabricatedEvidence = Array.from({ length: base.verifiedRequiredGates }, (_, index) => ({
      gateId: `fabricated-${index}`,
      sourceCommit: SHA,
      observedAt: base.generatedAt,
      origin: 'local' as const,
      reference: `local-report:${index}`,
    }));
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: base.generatedAt + 100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: { ...base, verifiedGateEvidence: fabricatedEvidence },
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(snapshot.preparationStatus).toBe('BLOCKED');
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({ id: 'readiness.integrity', state: 'MISMATCH' }));
  });

  it('fails closed when verified gate provenance uses the wrong canonical origin', () => {
    const base = readiness();
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: base.generatedAt + 100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: {
        ...base,
        verifiedGateEvidence: base.verifiedGateEvidence.map((evidence) => evidence.gateId === 'runtime.mcp'
          ? { ...evidence, origin: 'local' }
          : evidence),
      },
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(snapshot.preparationStatus).toBe('BLOCKED');
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({ id: 'readiness.integrity', state: 'MISMATCH' }));
  });

  it('accepts the conditional eighteenth verified gate when performance claims require it', () => {
    const report = readiness({ providerBenchmarks: 'VERIFIED' }, true);
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: report.generatedAt + 100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: report,
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(report.requiredGates).toBe(18);
    expect(report.verifiedRequiredGates).toBe(18);
    expect(snapshot.blockers).not.toContainEqual(expect.objectContaining({ id: 'readiness.integrity' }));
  });

  it('rejects a readiness report whose performanceClaims flag contradicts its required-gate count', () => {
    const base = readiness();
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: base.generatedAt + 100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: {
        ...base,
        performanceClaims: true,
      },
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(snapshot.preparationStatus).toBe('BLOCKED');
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({
      id: 'readiness.integrity',
      state: 'MISMATCH',
    }));
  });

  it('deep-freezes copied artifact proofs after validation', () => {
    const artifactInput = artifacts();
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 1_725_000_000_100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: workflows(),
      artifacts: artifactInput,
    });
    const packageProof = snapshot.artifacts.proofs?.packageSmoke;
    expect(Object.isFrozen(snapshot.artifacts)).toBe(true);
    expect(Object.isFrozen(snapshot.artifacts.proofs)).toBe(true);
    expect(Object.isFrozen(packageProof)).toBe(true);

    const originalReference = packageProof?.reference;
    expect(() => {
      (artifactInput.proofs!.packageSmoke as { reference: string }).reference = 'tampered';
    }).not.toThrow();
    expect(snapshot.artifacts.proofs?.packageSmoke?.reference).toBe(originalReference);
    expect(snapshot.artifacts.proofs?.packageSmoke?.reference).not.toBe('tampered');
  });

  it('requires the Provenance Attestation workflow on the exact RC source commit', () => {
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 1_725_000_000_100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: workflows().filter((run) => run.name !== 'Provenance Attestation'),
      artifacts: artifacts(),
    });
    expect(snapshot.preparationStatus).toBe('BLOCKED');
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({
      id: 'workflow.provenance-attestation',
      state: 'NOT_EXECUTED',
    }));
  });

  it('rejects VERIFIED entries inside the readiness blocker list', () => {
    const base = readiness();
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: base.generatedAt + 100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: {
        ...base,
        status: 'BLOCKED',
        blockers: [{
          gateId: 'runtime.mcp',
          title: 'MCP',
          state: 'VERIFIED',
          reason: 'invalid blocker state',
        }],
        verifiedRequiredGates: base.verifiedRequiredGates - 1,
        verifiedGateEvidence: base.verifiedGateEvidence.filter((evidence) => evidence.gateId !== 'runtime.mcp'),
      },
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({
      id: 'readiness.integrity',
      state: 'MISMATCH',
    }));
  });

  it('canonicalizes workflow and artifact evidence without copying unknown runtime fields', () => {
    const workflow = {
      ...workflows()[0]!,
      secretExtra: 'must-not-survive',
    } as RcWorkflowEvidence;
    const artifactInput = {
      ...artifacts(),
      secretExtra: 'must-not-survive',
      proofs: {
        ...artifacts().proofs,
        packageSmoke: {
          ...artifacts().proofs!.packageSmoke!,
          secretExtra: 'must-not-survive',
        },
      },
    } as RcArtifactEvidence;

    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 1_725_000_000_100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: [workflow, ...workflows().slice(1)],
      artifacts: artifactInput,
    });

    expect((snapshot.workflowRuns[0] as unknown as Record<string, unknown>).secretExtra).toBeUndefined();
    expect((snapshot.artifacts as unknown as Record<string, unknown>).secretExtra).toBeUndefined();
    expect((snapshot.artifacts.proofs?.packageSmoke as unknown as Record<string, unknown>).secretExtra).toBeUndefined();
  });

  it('denies authorization objects with unexpected runtime keys', () => {
    const base = readiness();
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: base.generatedAt + 100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: {
        ...base,
        authorization: {
          ...base.authorization,
          unexpected: true,
        } as unknown as typeof base.authorization,
      },
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(snapshot.preparationStatus).toBe('BLOCKED');
    expect(snapshot.authorization).toEqual({
      mergeDefaultBranch: false,
      createReleaseTag: false,
      publishNpm: false,
      deployProduction: false,
    });
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({
      id: 'readiness.integrity',
      state: 'MISMATCH',
    }));
  });

  it('rejects a required gate reported as both verified and blocked', () => {
    const base = readiness();
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: base.generatedAt + 100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: {
        ...base,
        status: 'BLOCKED',
        blockers: [{ gateId: 'runtime.mcp', title: 'MCP', state: 'BLOCKED', reason: 'contradictory fixture' }],
      },
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({ id: 'readiness.integrity', state: 'MISMATCH' }));
  });

  it('never copies malformed maintainer authorization into the RC snapshot', () => {
    const base = readiness();
    const snapshot = createRcEvidenceSnapshot({
      generatedAt: 1_725_000_000_100,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: {
        ...base,
        authorization: { ...base.authorization, publishNpm: 'approved' } as unknown as typeof base.authorization,
      },
      workflowRuns: workflows(),
      artifacts: artifacts(),
    });
    expect(snapshot.preparationStatus).toBe('BLOCKED');
    expect(snapshot.blockers).toContainEqual(expect.objectContaining({ id: 'readiness.integrity', state: 'MISMATCH' }));
    expect(snapshot.authorization).toEqual({
      mergeDefaultBranch: false,
      createReleaseTag: false,
      publishNpm: false,
      deployProduction: false,
    });
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
    const firstWorkflow = workflows()[0]!;
    expect(() => createRcEvidenceSnapshot({
      generatedAt: 1,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: [{ ...firstWorkflow, origin: 'github' } as unknown as RcWorkflowEvidence],
      artifacts: artifacts(),
    })).toThrow(/GitHub Actions reference/);

    expect(() => createRcEvidenceSnapshot({
      generatedAt: 1,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: [{ ...firstWorkflow, reference: '' }],
      artifacts: artifacts(),
    })).toThrow(/GitHub Actions reference/);

    expect(() => createRcEvidenceSnapshot({
      generatedAt: 1,
      sourceCommit: SHA,
      packageVersion: VERSION,
      readiness: readiness(),
      workflowRuns: [
        ...workflows(),
        {
          name: 'CI', runId: 1, headSha: SHA, updatedAt: 1,
          origin: 'github-actions', reference: 'run:duplicate', conclusion: 'success',
        },
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
