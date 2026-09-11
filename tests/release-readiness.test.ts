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
  return {
    generatedAt: 1_725_000_000_000,
    sourceCommit: 'a'.repeat(40),
    packageVersion: '0.13.2',
    channel: 'rc',
    performanceClaims: false,
    gates: createV5ReleaseGates(states),
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
