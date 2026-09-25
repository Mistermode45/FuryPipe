import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFuryContextCapsule } from '../src/fury-context-compiler.js';
import { FuryHarnessRunError, buildFuryHarnessInvocation, runFuryHarnessTask } from '../src/fury-harness-runner.js';
import { planFuryTask } from '../src/fury-planner.js';
import { createFuryProofLedger } from '../src/fury-proof.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const plan = planFuryTask({ runId: 'r1', intent: 'Fix the login bug.', must: ['keep login signature'], plannedFiles: ['src/auth/login.ts'], checks: { security: 'never', docs: 'never' } });
const capsule = compileFuryContextCapsule({ ir: plan.ir, taskId: 'impl-src-auth', candidates: [{ source: 'src/auth/login.ts', kind: 'file', content: 'export const x = 1;', priority: 50 }], budgetBytes: 8_000 });
const base = { executable: '/usr/bin/claude', worktree: '/tmp/wt', taskId: 'impl-src-auth', runId: 'r1', capsule, timeoutMs: 60_000 };
const authority = (o: Record<string, string>) => ({ READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'DENY', NETWORK: 'DENY', EXTERNAL_ACTION: 'DENY', ...o }) as never;

describe('Harness invocation (authority mapping)', () => {
  it('maps a write task to Claude Code flags verified from the CLI help', () => {
    const inv = buildFuryHarnessInvocation({ ...base, harnessId: 'claude-code', authority: authority({}) }, { PATH: '/usr/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-secret', OPENAI_API_KEY: 'sk-2' });
    expect(inv.flagsEvidence).toBe('verified-cli-help');
    expect(inv.args.slice(2, 9)).toEqual(['--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--allowedTools']);
    expect(inv.args).toContain('--restricted');
    expect(inv.args.join(' ')).toContain('--allowedTools Read Grep Glob Edit Write');
    expect(inv.args.join(' ')).toContain('--disallowedTools WebFetch WebSearch');
    expect(inv.args[1]).toContain('MUST: keep login signature');
    expect(Object.keys(inv.env)).not.toContain('ANTHROPIC_API_KEY');
    expect(Object.keys(inv.env)).not.toContain('OPENAI_API_KEY');
  });

  it('treats ASK as denied in headless runs and routes local bindings to loopback only', () => {
    const inv = buildFuryHarnessInvocation({ ...base, harnessId: 'claude-code', authority: authority({ WRITE: 'ASK' }), local: { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434' }, model: 'qwen2.5-coder:7b' }, { PATH: '/x' });
    expect(inv.deniedByHeadless).toEqual(['WRITE']);
    expect(inv.args.join(' ')).toContain('--disallowedTools Edit Write NotebookEdit');
    expect(inv.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(inv.env.ANTHROPIC_AUTH_TOKEN).toBe('furypipe-local');
    expect(() => buildFuryHarnessInvocation({ ...base, harnessId: 'claude-code', authority: authority({}), local: { kind: 'ollama', baseUrl: 'https://api.example.com' } })).toThrow();
  });

  it('refuses harness runs that cannot honour the contract', () => {
    expect(() => buildFuryHarnessInvocation({ ...base, harnessId: 'codex', authority: authority({}) })).toThrow(/EXECUTE denied/u);
    expect(() => buildFuryHarnessInvocation({ ...base, harnessId: 'codex', authority: authority({ EXECUTE: 'ALLOW', NETWORK: 'ALLOW' }) })).toThrow(FuryHarnessRunError);
    expect(() => buildFuryHarnessInvocation({ ...base, harnessId: 'claude-code', authority: authority({ EXTERNAL_ACTION: 'ALLOW' }) })).toThrow(/external actions/u);
    expect(() => buildFuryHarnessInvocation({ ...base, harnessId: 'goose', authority: authority({}) })).toThrow(/no execution adapter/u);
    const codex = buildFuryHarnessInvocation({ ...base, harnessId: 'codex', authority: authority({ EXECUTE: 'ALLOW' }), local: { kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234' } });
    expect(codex.flagsEvidence).toBe('community-docs-unverified');
    expect(codex.args.slice(0, 4)).toEqual(['exec', '--json', '--sandbox', 'workspace-write']);
    expect(codex.args).toEqual(expect.arrayContaining(['--oss', '--local-provider', 'lmstudio']));
  });
});

describe.skipIf(process.platform === 'win32')('Harness runner (fake harness binary, real git worktree)', () => {
  it('runs in the worktree, never trusts the claim, and records agent and patch receipts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-runner-'));
    roots.push(root);
    const wt = join(root, 'wt');
    mkdirSync(join(wt, 'src', 'auth'), { recursive: true });
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    execFileSync('git', ['init', '-q'], { cwd: wt, env });
    writeFileSync(join(wt, 'src', 'auth', 'login.ts'), 'export const x = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: wt, env });
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: wt, env });
    const fake = join(root, 'claude');
    writeFileSync(fake, `#!/bin/sh\necho "export const x = 2;" > src/auth/login.ts\nprintf '%s\\n' "$@" > "${join(root, 'args.txt')}"\necho '{"result":"done, all tests pass"}'\n`);
    chmodSync(fake, 0o755);
    const ledger = createFuryProofLedger();
    const result = await runFuryHarnessTask({ ...base, executable: fake, worktree: wt, harnessId: 'claude-code', authority: authority({}) }, ledger);
    expect(result.exitCode).toBe(0);
    expect(result.changedFiles).toEqual(['src/auth/login.ts']);
    expect(result.receipts.map((r) => r.kind)).toEqual(['AGENT_RECEIPT', 'PATCH_RECEIPT']);
    expect(result.receipts.every((r) => ledger.verify(r))).toBe(true);
    expect(readFileSync(join(root, 'args.txt'), 'utf8')).toContain('--restricted');
    // "all tests pass" in the output is only a claim: no TEST_RECEIPT exists.
    const judged = ledger.judge({ requirements: [{ id: 'tests', level: 'MUST', description: 'tests', evidence: [{ kind: 'TEST_RECEIPT', subject: 'test:r1' }] }], receipts: result.receipts, claims: [{ claimId: 'c', subject: 'test:r1', statement: 'all tests pass', claimedBy: 'claude-code', assertedOutcome: 'pass' }] });
    expect(judged.verdict).toBe('UNPROVEN');
    expect(judged.claims[0]?.state).toBe('CLAIMED');
  });

  it('records timeouts as unknown outcomes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-runner-'));
    roots.push(root);
    execFileSync('git', ['init', '-q'], { cwd: root });
    const fake = join(root, 'claude');
    writeFileSync(fake, '#!/bin/sh\nsleep 5\n');
    chmodSync(fake, 0o755);
    const result = await runFuryHarnessTask({ ...base, executable: fake, worktree: root, harnessId: 'claude-code', authority: authority({}), timeoutMs: 1_000 }, createFuryProofLedger());
    expect(result.timedOut).toBe(true);
    expect(result.receipts[0]?.outcome).toBe('unknown');
  });
});
