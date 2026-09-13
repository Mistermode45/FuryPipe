import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CONTROL_ROOM_SECURITY_CI_EVIDENCE_MAX_BYTES,
  loadControlRoomSecurityCiEvidenceFile,
  resolveControlRoomSecurityEvidence,
} from '../src/control-room/security-ci-evidence-file.js';
import type { SecurityEvidence } from '../src/control-room/index.js';

const SHA = 'a'.repeat(40);
const roots: string[] = [];

function evidence() {
  return {
    format: 'furypipe-control-room-security-ci-evidence/v1',
    generatedAt: 1,
    sourceCommit: SHA,
    codeql: { runId: 1, headSha: SHA, conclusion: 'success' },
    secretScan: { runId: 2, headSha: SHA, conclusion: 'success' },
    licenseCompliance: { runId: 3, headSha: SHA, conclusion: 'success' },
    supplyChain: {
      run: { runId: 4, headSha: SHA, conclusion: 'success' },
      jobs: {
        actionPinning: 'success',
        dependencyAudit: 'success',
        sbom: 'success',
        dependencyReview: 'skipped',
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Control Room Security CI evidence file', () => {
  it('loads a bounded regular exact-source evidence file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-security-ci-evidence-'));
    roots.push(root);
    const file = join(root, 'security-ci.json');
    await writeFile(file, JSON.stringify(evidence()), 'utf8');

    const snapshot = loadControlRoomSecurityCiEvidenceFile(file, SHA);
    expect(snapshot.security).toEqual({
      codeql: 'VERIFIED',
      secretScan: 'VERIFIED',
      dependencyAudit: 'VERIFIED',
      sbom: 'VERIFIED',
      actionPinning: 'VERIFIED',
      licenseCompliance: 'VERIFIED',
      dependencyReview: 'NOT_EXECUTED',
    });
  });

  it('rejects stale identity, oversized files and symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-security-ci-evidence-invalid-'));
    roots.push(root);
    const file = join(root, 'security-ci.json');
    await writeFile(file, JSON.stringify(evidence()), 'utf8');

    expect(() => loadControlRoomSecurityCiEvidenceFile(file, 'b'.repeat(40))).toThrow(/sourceCommit/i);

    const oversized = join(root, 'oversized.json');
    await writeFile(oversized, 'x'.repeat(CONTROL_ROOM_SECURITY_CI_EVIDENCE_MAX_BYTES + 1), 'utf8');
    expect(() => loadControlRoomSecurityCiEvidenceFile(oversized, SHA)).toThrow(/size boundary/i);

    const link = join(root, 'link.json');
    try {
      await symlink(file, link, 'file');
    } catch {
      return;
    }
    expect(() => loadControlRoomSecurityCiEvidenceFile(link, SHA)).toThrow(/must not be a symlink/i);
  });

  it('prefers exact-source CI evidence over conflicting static security without mixing fields', () => {
    const host: SecurityEvidence = {
      codeql: 'BLOCKED',
      secretScan: 'VERIFIED',
      dependencyAudit: 'NOT_EXECUTED',
      sbom: 'NOT_EXECUTED',
      actionPinning: 'NOT_EXECUTED',
      licenseCompliance: 'VERIFIED',
      dependencyReview: 'VERIFIED',
    };
    const ci: SecurityEvidence = {
      codeql: 'VERIFIED',
      secretScan: 'VERIFIED',
      dependencyAudit: 'VERIFIED',
      sbom: 'VERIFIED',
      actionPinning: 'VERIFIED',
      licenseCompliance: 'VERIFIED',
      dependencyReview: 'NOT_EXECUTED',
    };

    expect(resolveControlRoomSecurityEvidence(host, ci)).toEqual({
      security: ci,
      source: 'ci',
      conflict: true,
    });
  });

  it('accepts matching dual evidence and preserves single-source evidence', () => {
    const value: SecurityEvidence = {
      codeql: 'VERIFIED',
      secretScan: 'VERIFIED',
      dependencyAudit: 'VERIFIED',
      sbom: 'VERIFIED',
      actionPinning: 'VERIFIED',
      licenseCompliance: 'VERIFIED',
      dependencyReview: 'NOT_EXECUTED',
    };

    expect(resolveControlRoomSecurityEvidence(value, value)).toEqual({
      security: value,
      source: 'matching',
      conflict: false,
    });
    expect(resolveControlRoomSecurityEvidence(value, undefined)).toEqual({
      security: value,
      source: 'host',
      conflict: false,
    });
    expect(resolveControlRoomSecurityEvidence(undefined, value)).toEqual({
      security: value,
      source: 'ci',
      conflict: false,
    });
    expect(resolveControlRoomSecurityEvidence(undefined, undefined)).toEqual({
      source: 'none',
      conflict: false,
    });
  });
});
