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
});
