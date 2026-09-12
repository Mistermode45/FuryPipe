import { describe, expect, it } from 'vitest';
import { createControlRoomRuntime } from '../src/control-room/runtime.js';

const SHA = 'a'.repeat(40);

function receipt(
  verificationStatus: 'verified' | 'unverified',
  confidence: 'unknown' | 'estimated' | 'verified',
  recoveryHandles: string[] = [],
  protectedSpanCount = 0,
) {
  return {
    format: 'furypipe-compression-receipt/v1',
    strategy: 'pxpipe-transform',
    originalHash: 'b'.repeat(64),
    transformedHash: 'c'.repeat(64),
    originalBytes: 100,
    transformedBytes: 50,
    protectedSpans: Array.from({ length: protectedSpanCount }, () => ({})),
    recoveryHandles,
    tokenCost: { confidence },
    confidence,
    verificationStatus,
  };
}

describe('Control Room live runtime collector', () => {
  it('collects plaintext-free receipt evidence from real proxy-event shape', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 1234 });

    runtime.observeProxyEvent({ info: { receipt: receipt('verified', 'verified', ['furypipe-recovery/v1/sha256/' + 'd'.repeat(64)], 2) } as never });
    runtime.observeProxyEvent({ info: { receipt: receipt('unverified', 'estimated', ['furypipe-recovery/v1/sha256/' + 'd'.repeat(64)], 1) } as never });
    runtime.observeProxyEvent({ info: undefined });

    const snapshot = runtime.snapshot();
    expect(snapshot.generatedAt).toBe(1234);
    expect(snapshot.sourceCommit).toBe(SHA);
    expect(snapshot.sections.receipts.evidence).toEqual({
      receipts: 2,
      verifiedReceipts: 1,
      protectedSpans: 3,
      recoveryHandles: 2,
      confidence: 'estimated',
    });
    expect(snapshot.sections.receipts.status).toBe('PARTIAL');
    expect(snapshot.sections.recovery.evidence.objects).toBe(1);
    expect(snapshot.sections.recovery.evidence.encryption).toBe('unknown');
    expect(snapshot.sections.recovery.warnings).toContain(
      'Recovery encryption state is not observed by this runtime provider.',
    );
  });

  it('keeps unobserved subsystems unavailable instead of inventing green evidence', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 1 });
    const snapshot = runtime.snapshot();

    expect(snapshot.sections.agent.evidence.runs).toBe(0);
    expect(snapshot.sections.agent.evidence.persistedMemory).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.mcp.evidence.externalConformance).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.security.evidence.codeql).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.benchmarks.evidence.providerRuns).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.release.evidence.technicalStatus).toBe('NOT_AVAILABLE');
    expect(snapshot.overall).not.toBe('HEALTHY');
  });

  it('accepts explicit host evidence overrides without mutating them', () => {
    const mcp = {
      stdio: 'VERIFIED',
      http: 'VERIFIED',
      bearerAuth: 'VERIFIED',
      oauth: 'PARTIAL',
      externalConformance: 'NOT_EXECUTED',
    } as const;
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, mcp, now: () => 2 });
    const snapshot = runtime.snapshot();

    expect(snapshot.sections.mcp.evidence).toEqual(mcp);
    expect(snapshot.sections.mcp.status).toBe('PARTIAL');
    expect(mcp.oauth).toBe('PARTIAL');
  });

  it('rejects unpinned build identity and invalid clocks', () => {
    expect(() => createControlRoomRuntime({ sourceCommit: 'latest' })).toThrow(/40-character commit SHA/);

    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => -1 });
    expect(() => runtime.snapshot()).toThrow(/clock/);
  });

  it('does not retain request body or model text in snapshots', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 3 });
    runtime.observeProxyEvent({
      info: {
        receipt: receipt('verified', 'unknown'),
        imageSourceText: 'TOP-SECRET-REQUEST-BODY',
      } as never,
    });

    expect(JSON.stringify(runtime.snapshot())).not.toContain('TOP-SECRET-REQUEST-BODY');
  });
  it('tracks the latest state of each Agent run without double-counting handoff resumes', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 4 });
    runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'handoff_required',
      runId: 'run-1',
      objectiveDigest: 'afrun_digest',
      completedStages: ['research'],
      contextUsedTokens: 10,
      skillHealth: {},
    });
    runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'completed',
      runId: 'run-1',
      objectiveDigest: 'afrun_digest',
      completedStages: ['research', 'plan', 'implement', 'review', 'verify'],
      contextUsedTokens: 50,
      skillHealth: {},
    });
    runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'failed',
      runId: 'run-2',
      objectiveDigest: 'afrun_other',
      completedStages: ['research'],
      contextUsedTokens: 7,
      skillHealth: {},
      failure: { code: 'STAGE_FAILED', stage: 'plan', reason: 'opaque failure' },
    });

    const agent = runtime.snapshot().sections.agent;
    expect(agent.evidence).toEqual({
      runs: 2,
      completedRuns: 1,
      handoffRuns: 0,
      failedRuns: 1,
      contextUsedTokens: 57,
      persistedMemory: 'NOT_AVAILABLE',
      distributedHandoff: 'NOT_AVAILABLE',
    });
    expect(agent.status).toBe('PARTIAL');
  });

  it('tracks completed Learning cycles and unique lesson reuse without retaining lesson metadata', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 5 });
    const reused = (id: string) => ({
      format: 'furypipe-agent-lesson/v1' as const,
      lessonId: id,
      memoryClass: 'Semantic' as const,
      taskDigest: 'task_digest',
      lessonDigest: `digest_${id}`,
      contentHandle: `opaque://PRIVATE-${id}`,
      evidenceDigests: ['evidence_digest'],
      validation: 'validated' as const,
      reuseCount: 1,
    });
    runtime.observeLearningCycle({
      format: 'furypipe-agent-learning-cycle/v1',
      status: 'completed',
      cycleId: 'cycle-1',
      taskDigest: 'task_digest',
      memoryClass: 'Semantic',
      phaseOrder: ['plan', 'execute', 'verify', 'reflect', 'extract_lesson', 'validate', 'store', 'reuse'],
      phases: [],
      contextUsedTokens: 12,
      lessonId: 'new-lesson',
      reusedLessons: [reused('old-a'), reused('old-b'), reused('old-a')],
    });
    runtime.observeLearningCycle({
      format: 'furypipe-agent-learning-cycle/v1',
      status: 'completed',
      cycleId: 'cycle-1',
      taskDigest: 'task_digest',
      memoryClass: 'Semantic',
      phaseOrder: ['plan', 'execute', 'verify', 'reflect', 'extract_lesson', 'validate', 'store', 'reuse'],
      phases: [],
      contextUsedTokens: 13,
      lessonId: 'new-lesson',
      reusedLessons: [reused('old-a')],
    });

    const snapshot = runtime.snapshot();
    expect(snapshot.sections.learning.evidence).toEqual({
      humanTopics: 0,
      agentLessons: 1,
      reusedLessons: 1,
      durableStore: 'NOT_AVAILABLE',
      semanticRetrieval: 'NOT_AVAILABLE',
    });
    expect(snapshot.sections.learning.status).toBe('PARTIAL');
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE-');
    expect(JSON.stringify(snapshot)).not.toContain('new-lesson');
    expect(JSON.stringify(snapshot)).not.toContain('old-a');
  });

  it('rejects malformed Agent/Learning observations before they can poison Control Room counters', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 6 });
    expect(() => runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'completed',
      runId: '',
      objectiveDigest: 'digest',
      completedStages: [],
      contextUsedTokens: 0,
      skillHealth: {},
    })).toThrow(/runId/);

    expect(() => runtime.observeLearningCycle({
      format: 'furypipe-agent-learning-cycle/v1',
      status: 'completed',
      cycleId: 'cycle',
      taskDigest: 'task',
      memoryClass: 'Semantic',
      phaseOrder: [],
      phases: [],
      contextUsedTokens: 0,
      reusedLessons: Array.from({ length: 10_001 }, (_, index) => ({
        format: 'furypipe-agent-lesson/v1' as const,
        lessonId: `lesson-${index}`,
        memoryClass: 'Semantic' as const,
        taskDigest: 'task',
        lessonDigest: 'digest',
        contentHandle: 'opaque://x',
        evidenceDigests: [],
        validation: 'validated' as const,
        reuseCount: 0,
      })),
    })).toThrow(/reusedLessons/);
  });

});
