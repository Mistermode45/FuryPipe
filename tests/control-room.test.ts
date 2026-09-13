import { describe, expect, it } from 'vitest';
import {
  createControlRoomSnapshot,
  type ControlRoomInput,
} from '../src/control-room/index.js';
import {
  createV5ReleaseGates,
  evaluateReleaseReadiness,
  type V5ReleaseGateStates,
} from '../src/release-readiness/index.js';

function verifiedReleaseStates(): V5ReleaseGateStates {
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
    dependencyReview: 'VERIFIED',
    providerBenchmarks: 'VERIFIED',
  };
}

function releaseReport(
  sourceCommit = 'a'.repeat(40),
  overrides: Partial<V5ReleaseGateStates> = {},
) {
  const states: V5ReleaseGateStates = { ...verifiedReleaseStates(), ...overrides };
  return evaluateReleaseReadiness({
    generatedAt: 1_725_000_000_000,
    sourceCommit,
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
  });
}

function input(): ControlRoomInput {
  return {
    generatedAt: 1_725_000_000_000,
    sourceCommit: 'a'.repeat(40),
    receipts: {
      receipts: 10,
      verifiedReceipts: 10,
      protectedSpans: 42,
      recoveryHandles: 3,
      confidence: 'verified',
    },
    recovery: {
      objects: 3,
      verifiedObjects: 3,
      encryption: 'aes-256-gcm',
      activeKeyId: 'primary',
      backupEvidence: 'RESTORE_VERIFIED',
      crashRecovery: 'PARTIAL',
      multiProcess: 'PARTIAL',
    },
    agent: {
      runs: 4,
      completedRuns: 4,
      handoffRuns: 0,
      failedRuns: 0,
      contextUsedTokens: 1200,
      persistedMemory: 'PARTIAL',
      distributedHandoff: 'PARTIAL',
    },
    learning: {
      humanTopics: 6,
      agentLessons: 4,
      reusedLessons: 2,
      durableStore: 'PARTIAL',
      semanticRetrieval: 'NOT_EXECUTED',
    },
    provider: {
      bufferedExecutions: 1,
      streamSessions: 1,
      acceptedRequests: 2,
      rejectedRequests: 0,
      unknownRequests: 0,
      streamCompleted: 1,
      streamIncomplete: 0,
      streamFailed: 0,
      streamCancelled: 0,
      streamRequiresAction: 0,
      streamTerminalUnknown: 0,
      streamProviderErrors: 0,
      streamOpenAccepted: 0,
      usageReports: 2,
      inputTokens: 10,
      outputTokens: 4,
      cacheWriteTokens: 0,
      cacheReadTokens: 2,
      knownCostObservations: 1,
      unknownCostObservations: 1,
      runtimeObservability: 'VERIFIED',
      providerVerification: 'PARTIAL',
    },
    mcp: {
      stdio: 'VERIFIED',
      http: 'VERIFIED',
      bearerAuth: 'VERIFIED',
      oauth: 'PARTIAL',
      externalConformance: 'NOT_EXECUTED',
    },
    i18n: {
      locale: 'fr',
      direction: 'ltr',
      runtimeKernel: 'VERIFIED',
      cliWiring: 'NOT_EXECUTED',
      dashboardWiring: 'NOT_EXECUTED',
    },
    webStudio: {
      kernel: 'VERIFIED',
      figma: 'NOT_EXECUTED',
      playwright: 'NOT_EXECUTED',
      accessibility: 'NOT_EXECUTED',
      security: 'NOT_EXECUTED',
      seo: 'NOT_EXECUTED',
      deployment: 'NOT_EXECUTED',
    },
    security: {
      codeql: 'VERIFIED',
      secretScan: 'VERIFIED',
      dependencyAudit: 'VERIFIED',
      sbom: 'VERIFIED',
      actionPinning: 'VERIFIED',
      licenseCompliance: 'VERIFIED',
      dependencyReview: 'BLOCKED',
    },
    benchmarks: {
      harness: 'VERIFIED',
      providerRuns: 'NOT_EXECUTED',
      comparableRuns: 0,
    },
  };
}

describe('Control Room V5 kernel', () => {
  it('builds a fail-visible snapshot without promoting incomplete systems', () => {
    const snapshot = createControlRoomSnapshot(input());
    expect(snapshot.format).toBe('furypipe-control-room/v1');
    expect(snapshot.overall).toBe('BLOCKED');
    expect(snapshot.sections.receipts.status).toBe('VERIFIED');
    expect(snapshot.sections.recovery.status).toBe('PARTIAL');
    expect(snapshot.sections.provider.status).toBe('PARTIAL');
    expect(snapshot.sections.provider.warnings[0]).toMatch(/independently unverified/i);
    expect(snapshot.sections.security.status).toBe('BLOCKED');
    expect(snapshot.sections.benchmarks.status).toBe('PARTIAL');
    expect(snapshot.sections.release.status).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.release.warnings[0]).toMatch(/not available/i);
  });

  it('surfaces a blocked release decision with exact blocker counts', () => {
    const base = input();
    const snapshot = createControlRoomSnapshot({
      ...base,
      releaseReadiness: releaseReport(base.sourceCommit, {
        recovery: 'PARTIAL',
        mcp: 'PARTIAL',
      }),
    });

    expect(snapshot.sections.release.status).toBe('BLOCKED');
    expect(snapshot.sections.release.evidence.technicalStatus).toBe('BLOCKED');
    expect(snapshot.sections.release.evidence.blockers).toBe(2);
    expect(snapshot.sections.release.warnings[0]).toMatch(/blocked by 2 required gate/);
  });

  it('maps a technically ready release report to VERIFIED without executing release actions', () => {
    const base = input();
    const snapshot = createControlRoomSnapshot({
      ...base,
      releaseReadiness: releaseReport(base.sourceCommit),
    });

    expect(snapshot.sections.release.status).toBe('VERIFIED');
    expect(snapshot.sections.release.evidence).toMatchObject({
      technicalStatus: 'READY_FOR_RELEASE_DECISION',
      blockers: 0,
      releaseActionsExecuted: false,
      authorizedActions: 0,
    });
  });

  it('rejects stale release evidence from another source commit', () => {
    const base = input();
    expect(() => createControlRoomSnapshot({
      ...base,
      releaseReadiness: releaseReport('b'.repeat(40)),
    })).toThrow(/source commit must match/);
  });

  it('warns that BACKUP_EXISTS is not restore verification', () => {
    const value = input();
    value.recovery = { ...value.recovery, backupEvidence: 'BACKUP_EXISTS' };
    const snapshot = createControlRoomSnapshot(value);
    expect(snapshot.sections.recovery.warnings).toContain('Backup exists but restore has not been verified.');
  });

  it('warns when provider benchmark evidence is absent', () => {
    const snapshot = createControlRoomSnapshot(input());
    expect(snapshot.sections.benchmarks.warnings[0]).toMatch(/do not publish performance claims/i);
  });

  it('rejects impossible receipt and recovery counters', () => {
    const badReceipts = input();
    badReceipts.receipts = { ...badReceipts.receipts, verifiedReceipts: 11 };
    expect(() => createControlRoomSnapshot(badReceipts)).toThrow(/verified receipt count/);

    const badRecovery = input();
    badRecovery.recovery = { ...badRecovery.recovery, verifiedObjects: 4 };
    expect(() => createControlRoomSnapshot(badRecovery)).toThrow(/verified recovery object count/);
  });

  it('rejects encrypted Recovery evidence without a key id', () => {
    const value = input();
    value.recovery = { ...value.recovery, activeKeyId: undefined };
    expect(() => createControlRoomSnapshot(value)).toThrow(/activeKeyId/);
  });

  it('rejects malformed commit evidence', () => {
    const value = input();
    value.sourceCommit = 'latest';
    expect(() => createControlRoomSnapshot(value)).toThrow(/40-character commit SHA/);
  });

  it('can represent a fully verified system without inventing evidence', () => {
    const value = input();
    value.recovery = {
      ...value.recovery,
      crashRecovery: 'VERIFIED',
      multiProcess: 'VERIFIED',
    };
    value.agent = {
      ...value.agent,
      persistedMemory: 'VERIFIED',
      distributedHandoff: 'VERIFIED',
    };
    value.learning = {
      ...value.learning,
      durableStore: 'VERIFIED',
      semanticRetrieval: 'VERIFIED',
    };
    value.provider = {
      ...value.provider!,
      runtimeObservability: 'VERIFIED',
      providerVerification: 'VERIFIED',
    };
    value.mcp = {
      stdio: 'VERIFIED',
      http: 'VERIFIED',
      bearerAuth: 'VERIFIED',
      oauth: 'VERIFIED',
      externalConformance: 'VERIFIED',
    };
    value.i18n = {
      ...value.i18n,
      cliWiring: 'VERIFIED',
      dashboardWiring: 'VERIFIED',
    };
    value.webStudio = {
      kernel: 'VERIFIED',
      figma: 'VERIFIED',
      playwright: 'VERIFIED',
      accessibility: 'VERIFIED',
      security: 'VERIFIED',
      seo: 'VERIFIED',
      deployment: 'VERIFIED',
    };
    value.security = {
      ...value.security,
      dependencyReview: 'VERIFIED',
    };
    value.benchmarks = {
      harness: 'VERIFIED',
      providerRuns: 'VERIFIED',
      comparableRuns: 3,
    };
    const snapshot = createControlRoomSnapshot({
      ...value,
      releaseReadiness: releaseReport(value.sourceCommit),
    });
    expect(snapshot.overall).toBe('HEALTHY');
    expect(Object.values(snapshot.sections).every((section) => section.status === 'VERIFIED')).toBe(true);
  });
});
