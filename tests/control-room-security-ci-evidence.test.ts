import { describe, expect, it } from 'vitest';
import {
  createControlRoomSecurityCiSnapshot,
  createControlRoomSecurityCiSnapshotFromUnknown,
  parseControlRoomSecurityCiEvidence,
} from '../src/control-room/security-ci-evidence.js';

const SHA = 'a'.repeat(40);

function run(conclusion: 'success' | 'failure' | 'cancelled' | 'skipped', id = 1) {
  return { runId: id, headSha: SHA, conclusion };
}

describe('Control Room security CI evidence', () => {
  it('maps exact-source successful workflow/job evidence to VERIFIED without inventing skipped checks', () => {
    const snapshot = createControlRoomSecurityCiSnapshot({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 123,
      sourceCommit: SHA,
      codeql: run('success', 10),
      secretScan: run('success', 11),
      licenseCompliance: run('success', 12),
      supplyChain: {
        run: run('success', 13),
        jobs: {
          actionPinning: 'success',
          dependencyAudit: 'success',
          sbom: 'success',
          dependencyReview: 'skipped',
        },
      },
    });

    expect(snapshot).toEqual({
      format: 'furypipe-control-room-security-ci-snapshot/v1',
      generatedAt: 123,
      sourceCommit: SHA,
      security: {
        codeql: 'VERIFIED',
        secretScan: 'VERIFIED',
        dependencyAudit: 'VERIFIED',
        sbom: 'VERIFIED',
        actionPinning: 'VERIFIED',
        licenseCompliance: 'VERIFIED',
        dependencyReview: 'NOT_EXECUTED',
      },
    });
  });

  it('keeps missing, cancelled, skipped and failed evidence semantically distinct', () => {
    const snapshot = createControlRoomSecurityCiSnapshot({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 1,
      sourceCommit: SHA,
      codeql: run('failure', 20),
      secretScan: run('cancelled', 21),
      supplyChain: {
        run: run('failure', 22),
        jobs: {
          actionPinning: 'success',
          dependencyAudit: 'failure',
          sbom: 'cancelled',
          dependencyReview: 'skipped',
        },
      },
    });

    expect(snapshot.security).toEqual({
      codeql: 'BLOCKED',
      secretScan: 'PARTIAL',
      dependencyAudit: 'BLOCKED',
      sbom: 'PARTIAL',
      actionPinning: 'VERIFIED',
      licenseCompliance: 'NOT_AVAILABLE',
      dependencyReview: 'NOT_EXECUTED',
    });
  });

  it('rejects stale head SHAs even when workflow conclusions say success', () => {
    expect(() => parseControlRoomSecurityCiEvidence({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 1,
      sourceCommit: SHA,
      codeql: { runId: 1, headSha: 'b'.repeat(40), conclusion: 'success' },
    }, SHA)).toThrow(/headSha does not match sourceCommit/i);

    expect(() => createControlRoomSecurityCiSnapshotFromUnknown({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 1,
      sourceCommit: SHA,
    }, 'b'.repeat(40))).toThrow(/sourceCommit does not match expected/i);
  });

  it('sanitizes unknown fields instead of retaining logs, URLs or secret-bearing extras', () => {
    const parsed = parseControlRoomSecurityCiEvidence({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 5,
      sourceCommit: SHA,
      codeql: {
        runId: 7,
        headSha: SHA,
        conclusion: 'success',
        logs: 'PRIVATE-CODEQL-LOG',
        url: 'https://example.invalid/private',
        token: 'SECRET',
      },
      supplyChain: {
        run: {
          runId: 8,
          headSha: SHA,
          conclusion: 'success',
          rawOutput: 'PRIVATE-SUPPLY-CHAIN',
        },
        jobs: {
          actionPinning: 'success',
          dependencyAudit: 'success',
          sbom: 'success',
          dependencyReview: 'skipped',
          secret: 'DO-NOT-KEEP',
        },
      },
      rawSecret: 'TOP-SECRET',
    }, SHA);

    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('PRIVATE-CODEQL-LOG');
    expect(serialized).not.toContain('PRIVATE-SUPPLY-CHAIN');
    expect(serialized).not.toContain('DO-NOT-KEEP');
    expect(serialized).not.toContain('TOP-SECRET');
    expect(serialized).not.toContain('example.invalid');
  });

  it('rejects invalid run IDs, timestamps and conclusions', () => {
    expect(() => parseControlRoomSecurityCiEvidence({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: -1,
      sourceCommit: SHA,
    }, SHA)).toThrow(/generatedAt/);

    expect(() => parseControlRoomSecurityCiEvidence({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 1,
      sourceCommit: SHA,
      codeql: { runId: 0, headSha: SHA, conclusion: 'success' },
    }, SHA)).toThrow(/runId/);

    expect(() => parseControlRoomSecurityCiEvidence({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 1,
      sourceCommit: SHA,
      codeql: { runId: 1, headSha: SHA, conclusion: 'timed_out' },
    }, SHA)).toThrow(/invalid workflow conclusion/);
  });
});
