import { describe, expect, it } from 'vitest';
import { createControlRoomRuntime } from '../src/control-room/runtime.js';
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

  it('feeds exact-source CI evidence into Control Room without inventing a Dependency Review failure cause', () => {
    const ci = createControlRoomSecurityCiSnapshot({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 9,
      sourceCommit: SHA,
      codeql: run('success', 30),
      secretScan: run('success', 31),
      licenseCompliance: run('success', 32),
      supplyChain: {
        run: run('failure', 33),
        jobs: {
          actionPinning: 'success',
          dependencyAudit: 'success',
          sbom: 'success',
          dependencyReview: 'failure',
        },
      },
    });
    const runtime = createControlRoomRuntime({
      sourceCommit: SHA,
      security: ci.security,
      now: () => 10,
    });
    const section = runtime.snapshot().sections.security;

    expect(section.status).toBe('BLOCKED');
    expect(section.evidence.dependencyReview).toBe('BLOCKED');
    expect(section.warnings).toContain(
      'GitHub Dependency Review is blocked or failed; inspect the source-bound CI evidence and repository settings.',
    );
    expect(section.warnings.join(' ')).not.toMatch(/blocked by repository Dependency Graph settings/i);
  });

  it('rejects duplicate workflow run IDs and contradictory Supply Chain evidence', () => {
    expect(() => parseControlRoomSecurityCiEvidence({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 1,
      sourceCommit: SHA,
      codeql: run('success', 50),
      secretScan: run('success', 50),
    }, SHA)).toThrow(/run IDs must be unique/i);

    expect(() => parseControlRoomSecurityCiEvidence({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 1,
      sourceCommit: SHA,
      supplyChain: {
        run: run('success', 51),
        jobs: {
          actionPinning: 'success',
          dependencyAudit: 'failure',
        },
      },
    }, SHA)).toThrow(/Successful Supply Chain workflow cannot contain failed or cancelled job evidence/i);

    expect(() => parseControlRoomSecurityCiEvidence({
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 1,
      sourceCommit: SHA,
      supplyChain: {
        run: run('skipped', 52),
        jobs: {
          actionPinning: 'success',
        },
      },
    }, SHA)).toThrow(/Skipped Supply Chain workflow cannot contain executed job evidence/i);
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
