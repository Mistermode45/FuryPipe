import { describe, expect, it } from 'vitest';
import {
  createV5ReleaseGates,
  evaluateReleaseReadiness,
  type ReleaseReadinessInput,
  type V5ReleaseGateStates,
} from '../src/release-readiness/index.js';

const verifiedStates = (): V5ReleaseGateStates => ({
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
  dependencyReview: 'VERIFIED',
  providerBenchmarks: 'VERIFIED',
});

function input(states: V5ReleaseGateStates = verifiedStates()): ReleaseReadinessInput {
  const provenanceByGate = Object.fromEntries(createV5ReleaseGates(states).flatMap((gate) => {
    if (gate.state !== 'VERIFIED') return [];
    const origin = gate.id.startsWith('ci.') || gate.id.startsWith('security.') || gate.id === 'release.provenance'
      ? 'github-actions'
      : gate.id === 'repo.branch-policy' ? 'github'
        : gate.id === 'runtime.mcp' || gate.id === 'runtime.web-studio' ? 'hosted'
          : gate.id === 'benchmarks.provider' ? 'provider' : 'local';
    return [[gate.id, {
      sourceCommit: 'a'.repeat(40),
      observedAt: 1_725_000_000_000,
      origin,
      reference: `evidence:${gate.id}`,
    }]];
  }));
  return {
    generatedAt: 1_725_000_000_000,
    sourceCommit: 'a'.repeat(40),
    packageVersion: '0.13.2',
    channel: 'rc',
    performanceClaims: false,
    gates: createV5ReleaseGates(states, provenanceByGate),
    authorization: {
      mergeDefaultBranch: false,
      createReleaseTag: false,
      publishNpm: false,
      deployProduction: false,
    },
  };
}

describe('Release Readiness V5', () => {
  it('blocks a release decision while required runtime milestones are partial', () => {
    const states: V5ReleaseGateStates = {
      ...verifiedStates(),
      recovery: 'PARTIAL',
      mcp: 'PARTIAL',
      agentRuntime: 'PARTIAL',
      furyPrompt: 'PARTIAL',
    };
    const report = evaluateReleaseReadiness(input(states));

    expect(report.status).toBe('BLOCKED');
    expect(report.blockers.map((blocker) => blocker.gateId)).toEqual([
      'runtime.recovery',
      'runtime.mcp',
      'runtime.agent',
      'runtime.furyprompt',
    ]);
    expect(report.releaseActionsExecuted).toBe(false);
  });

  it('does not pretend that readiness authorizes a release action', () => {
    const report = evaluateReleaseReadiness(input());
    expect(report.status).toBe('READY_FOR_RELEASE_DECISION');
    expect(report.authorization).toEqual({
      mergeDefaultBranch: false,
      createReleaseTag: false,
      publishNpm: false,
      deployProduction: false,
    });
    expect(report.releaseActionsExecuted).toBe(false);
  });

  it('binds performanceClaims into the report and validates authorization/state at runtime', () => {
    const report = evaluateReleaseReadiness({
      ...input(),
      performanceClaims: true,
    });
    expect(report.performanceClaims).toBe(true);
    expect(report.requiredGates).toBe(18);

    expect(() => evaluateReleaseReadiness({
      ...input(),
      authorization: {
        ...input().authorization,
        unexpected: true,
      } as unknown as ReleaseReadinessInput['authorization'],
    })).toThrow(/exactly the four boolean authorization fields/);

    expect(() => evaluateReleaseReadiness({
      ...input(),
      gates: input().gates.map((gate) => gate.id === 'runtime.agent'
        ? { ...gate, state: 'GREEN' as unknown as typeof gate.state }
        : gate),
    })).toThrow(/release gate state is invalid/);

    expect(() => evaluateReleaseReadiness({
      ...input(),
      performanceClaims: 'no' as unknown as boolean,
    })).toThrow(/performanceClaims must be boolean/);
  });

  it('fails closed when VERIFIED gates omit or mismatch source-bound provenance', () => {
    const base = input();
    const withoutProvenance = evaluateReleaseReadiness({
      ...base,
      gates: createV5ReleaseGates(verifiedStates()),
    });
    expect(withoutProvenance.status).toBe('BLOCKED');
    expect(withoutProvenance.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: 'ci.push', reason: expect.stringContaining('no source-bound') }),
    ]));

    const mixedSha = evaluateReleaseReadiness({
      ...base,
      gates: base.gates.map((gate) => gate.id === 'ci.push'
        ? { ...gate, provenance: { ...gate.provenance!, sourceCommit: 'b'.repeat(40) } }
        : gate),
    });
    expect(mixedSha.blockers).toContainEqual(expect.objectContaining({
      gateId: 'ci.push',
      reason: 'evidence source commit does not match the release source commit',
    }));
  });

  it('requires provenance origin to match the gate that is being verified', () => {
    const base = input();
    const report = evaluateReleaseReadiness({
      ...base,
      gates: base.gates.map((gate) => gate.id === 'runtime.mcp'
        ? { ...gate, provenance: { ...gate.provenance!, origin: 'local' } }
        : gate),
    });
    expect(report.blockers).toContainEqual(expect.objectContaining({
      gateId: 'runtime.mcp',
      reason: expect.stringContaining('origin must be one of: hosted'),
    }));
  });

  it('keeps provider benchmarks optional when no performance claim is made', () => {
    const states: V5ReleaseGateStates = {
      ...verifiedStates(),
      providerBenchmarks: 'NOT_EXECUTED',
    };
    const report = evaluateReleaseReadiness(input(states));

    expect(report.status).toBe('READY_FOR_RELEASE_DECISION');
    expect(report.warnings.join(' ')).toMatch(/must not make performance claims/i);
  });

  it('requires provider benchmarks when performance claims are requested', () => {
    const states: V5ReleaseGateStates = {
      ...verifiedStates(),
      providerBenchmarks: 'NOT_EXECUTED',
    };
    const value: ReleaseReadinessInput = {
      ...input(states),
      performanceClaims: true,
    };
    const report = evaluateReleaseReadiness(value);

    expect(report.status).toBe('BLOCKED');
    expect(report.blockers.map((blocker) => blocker.gateId)).toContain('benchmarks.provider');
  });

  it('counts verified provider benchmarks as the conditional eighteenth required gate', () => {
    const report = evaluateReleaseReadiness({
      ...input({ ...verifiedStates(), providerBenchmarks: 'VERIFIED' }),
      performanceClaims: true,
    });
    expect(report.status).toBe('READY_FOR_RELEASE_DECISION');
    expect(report.requiredGates).toBe(18);
    expect(report.verifiedRequiredGates).toBe(18);
    expect(report.verifiedGateEvidence.map((evidence) => evidence.gateId)).toContain('benchmarks.provider');
  });

  it('reports repository dependency review blockers without replacing the required audit/SBOM gates', () => {
    const states: V5ReleaseGateStates = {
      ...verifiedStates(),
      dependencyReview: 'BLOCKED_BY_REPO_SETTING',
    };
    const report = evaluateReleaseReadiness(input(states));

    expect(report.status).toBe('READY_FOR_RELEASE_DECISION');
    expect(report.warnings.join(' ')).toContain('security.dependency-review');
  });

  it('rejects duplicate gate IDs and unpinned source identity', () => {
    const base = input();
    const value: ReleaseReadinessInput = {
      ...base,
      gates: [...base.gates, base.gates[0]],
    };
    expect(() => evaluateReleaseReadiness(value)).toThrow(/duplicate release gate id/);

    const badCommit: ReleaseReadinessInput = {
      ...input(),
      sourceCommit: 'latest',
    };
    expect(() => evaluateReleaseReadiness(badCommit)).toThrow(/40-character commit SHA/);
  });

  it('requires the complete canonical V5 gate set and requiredness', () => {
    const base = input();
    expect(() => evaluateReleaseReadiness({
      ...base,
      gates: base.gates.filter((gate) => gate.id !== 'runtime.mcp'),
    })).toThrow(/missing V5 release gate: runtime\.mcp/);

    expect(() => evaluateReleaseReadiness({
      ...base,
      gates: base.gates.map((gate) => gate.id === 'runtime.mcp' ? { ...gate, required: false } : gate),
    })).toThrow(/requiredness is fixed by contract/);

    expect(() => evaluateReleaseReadiness({
      ...base,
      gates: base.gates.filter((gate) => gate.id !== 'benchmarks.provider'),
    })).toThrow(/missing V5 release gate: benchmarks\.provider/);
  });

  it('keeps NOT_APPLICABLE invalid for a required gate', () => {
    const states: V5ReleaseGateStates = {
      ...verifiedStates(),
      recovery: 'NOT_APPLICABLE',
    };
    const report = evaluateReleaseReadiness(input(states));

    expect(report.status).toBe('BLOCKED');
    expect(report.blockers[0]).toMatchObject({
      gateId: 'runtime.recovery',
      state: 'NOT_APPLICABLE',
    });
  });
});
