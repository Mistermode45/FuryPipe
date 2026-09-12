import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTROL_ROOM_EVIDENCE_MAX_BYTES,
  loadControlRoomHostEvidence,
  parseControlRoomHostEvidence,
} from '../src/control-room/evidence-file.js';
import { createControlRoomRuntime } from '../src/control-room/runtime.js';

const SHA = 'a'.repeat(40);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function validEvidence() {
  return {
    format: 'furypipe-control-room-host-evidence/v1',
    generatedAt: 100,
    sourceCommit: SHA,
    security: {
      codeql: 'VERIFIED',
      secretScan: 'VERIFIED',
      dependencyAudit: 'VERIFIED',
      sbom: 'VERIFIED',
      actionPinning: 'VERIFIED',
      licenseCompliance: 'VERIFIED',
      dependencyReview: 'BLOCKED',
      token: 'TOP-SECRET',
    },
    benchmarks: {
      harness: 'VERIFIED',
      providerRuns: 'NOT_EXECUTED',
      comparableRuns: 12,
      rawPrompt: 'PRIVATE',
    },
    mcp: {
      stdio: 'VERIFIED',
      http: 'VERIFIED',
      bearerAuth: 'VERIFIED',
      oauth: 'PARTIAL',
      externalConformance: 'NOT_EXECUTED',
    },
    extraSecret: 'DO-NOT-KEEP',
  };
}

describe('Control Room host evidence file', () => {
  it('sanitizes known evidence fields and drops unknown/secret-bearing extras', () => {
    const parsed = parseControlRoomHostEvidence(validEvidence(), SHA);
    expect(parsed.security).toMatchObject({
      codeql: 'VERIFIED',
      dependencyReview: 'BLOCKED',
    });
    expect(parsed.benchmarks).toEqual({
      harness: 'VERIFIED',
      providerRuns: 'NOT_EXECUTED',
      comparableRuns: 12,
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('TOP-SECRET');
    expect(serialized).not.toContain('PRIVATE');
    expect(serialized).not.toContain('DO-NOT-KEEP');
  });

  it('rejects stale source identity before evidence reaches the runtime', () => {
    expect(() => parseControlRoomHostEvidence(validEvidence(), 'b'.repeat(40))).toThrow(/does not match running build/);
  });

  it('feeds validated static evidence into the live Control Room runtime', () => {
    const parsed = parseControlRoomHostEvidence(validEvidence(), SHA);
    const runtime = createControlRoomRuntime({
      sourceCommit: SHA,
      security: parsed.security,
      benchmarks: parsed.benchmarks,
      mcp: parsed.mcp,
      now: () => 200,
    });
    const snapshot = runtime.snapshot();
    expect(snapshot.sections.security.evidence.codeql).toBe('VERIFIED');
    expect(snapshot.sections.benchmarks.evidence).toMatchObject({
      harness: 'VERIFIED',
      providerRuns: 'NOT_EXECUTED',
      comparableRuns: 12,
    });
    expect(snapshot.sections.mcp.evidence.oauth).toBe('PARTIAL');
  });

  it('loads a bounded regular JSON file and rejects oversized files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-control-room-evidence-'));
    roots.push(root);
    const file = join(root, 'evidence.json');
    await writeFile(file, JSON.stringify(validEvidence()), 'utf8');

    expect(loadControlRoomHostEvidence(file, SHA).sourceCommit).toBe(SHA);

    const oversized = join(root, 'oversized.json');
    await writeFile(oversized, 'x'.repeat(CONTROL_ROOM_EVIDENCE_MAX_BYTES + 1), 'utf8');
    expect(() => loadControlRoomHostEvidence(oversized, SHA)).toThrow(/size boundary/);
  });

  it('rejects symlink evidence files instead of following an attacker-controlled target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-control-room-evidence-link-'));
    roots.push(root);
    const target = join(root, 'target.json');
    const link = join(root, 'evidence.json');
    await writeFile(target, JSON.stringify(validEvidence()), 'utf8');
    try {
      await symlink(target, link, 'file');
    } catch {
      return;
    }
    expect(() => loadControlRoomHostEvidence(link, SHA)).toThrow(/must not be a symlink/);
  });

  it('validates release-readiness identity and strips unknown nested fields', () => {
    const evidence = {
      ...validEvidence(),
      releaseReadiness: {
        format: 'furypipe-release-readiness/v1',
        generatedAt: 99,
        sourceCommit: SHA,
        packageVersion: '0.13.2',
        channel: 'rc',
        status: 'BLOCKED',
        blockers: [{
          gateId: 'runtime.mcp',
          title: 'MCP runtime',
          state: 'PARTIAL',
          reason: 'external conformance missing',
          bearer: 'SECRET',
        }],
        warnings: ['provider benchmarks not executed'],
        verifiedRequiredGates: 3,
        requiredGates: 4,
        authorization: {
          mergeDefaultBranch: false,
          createReleaseTag: false,
          publishNpm: false,
          deployProduction: false,
        },
        releaseActionsExecuted: false,
        rawToken: 'SECRET',
      },
    };
    const parsed = parseControlRoomHostEvidence(evidence, SHA);
    expect(parsed.releaseReadiness?.status).toBe('BLOCKED');
    expect(JSON.stringify(parsed.releaseReadiness)).not.toContain('SECRET');
  });
});
