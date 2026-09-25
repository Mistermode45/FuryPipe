// Harness runner — executes one dispatched task on a harness through its
// structured CLI, inside the task's worktree, under the task's authority.
//
// Authority mapping is fail-closed: ASK cannot be answered in a headless run,
// so it is treated as DENY; a harness that cannot enforce a DENY (e.g. it
// always allows command execution) is refused rather than run with more
// authority than the contract grants. Claude Code flags were verified
// against the installed CLI help (2.1.282); Codex flags come from community
// documentation and are marked unverified until a live run confirms them.
// No provider credentials are passed: harnesses use their own login state,
// or, for local bindings, a loopback Anthropic/OpenAI-compatible endpoint.
// Output claims are never trusted: the runner records an AGENT_RECEIPT for
// the run and a PATCH_RECEIPT computed from `git` in the worktree.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { FuryContextCapsule } from './fury-context-compiler.js';
import type { FuryCapability, FuryCapabilityDecision } from './fury-ir.js';
import { assertFuryLocalEndpoint } from './fury-local-fabric.js';
import type { FuryProofLedger, FuryReceipt } from './fury-proof.js';

export type FuryRunnableHarness = 'claude-code' | 'codex';

export interface FuryHarnessRunRequest {
  readonly harnessId: string;
  readonly executable: string;
  readonly worktree: string;
  readonly taskId: string;
  readonly runId: string;
  readonly capsule: FuryContextCapsule;
  readonly authority: Readonly<Record<FuryCapability, FuryCapabilityDecision>>;
  readonly model?: string;
  /** Local binding: provider kind + loopback base URL. */
  readonly local?: { readonly kind: 'ollama' | 'lmstudio' | 'anthropic-compatible' | 'openai-compatible'; readonly baseUrl: string };
  readonly timeoutMs: number;
}

export interface FuryHarnessInvocation {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly flagsEvidence: 'verified-cli-help' | 'community-docs-unverified';
  readonly deniedByHeadless: readonly FuryCapability[];
}

export interface FuryHarnessRunResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly outputDigest: string;
  readonly changedFiles: readonly string[];
  readonly receipts: readonly FuryReceipt[];
  readonly stdoutTail: string;
}

export class FuryHarnessRunError extends Error {
  constructor(readonly code: 'unsupported-harness' | 'authority-unsupported' | 'invalid-request', message: string) {
    super(message);
    this.name = 'FuryHarnessRunError';
  }
}

const MAX_OUTPUT = 4 * 1024 * 1024;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function renderFuryCapsulePrompt(capsule: FuryContextCapsule): string {
  const lines = [
    `FuryPipe task ${capsule.taskId} (contract ${capsule.irDigest.slice(0, 12)}).`,
    'Hard constraints and success criteria (never drop these):',
    ...capsule.entries.filter((e) => e.pinned).map((e) => `- ${e.content}`),
    '',
    'Context (each entry states why it was included):',
  ];
  for (const e of capsule.entries.filter((x) => !x.pinned)) {
    lines.push(`--- ${e.source} (${e.reason}; sha256 ${e.digest.slice(0, 12)})`, e.content);
  }
  lines.push('', 'Report what you changed. Your claims are verified independently; do not state that tests pass unless you ran them.');
  return lines.join('\n');
}

function allowed(authority: FuryHarnessRunRequest['authority'], cap: FuryCapability): boolean {
  return authority[cap] === 'ALLOW';
}

/** Build the exact invocation for a harness under the task authority. Pure; exported for tests. */
export function buildFuryHarnessInvocation(req: FuryHarnessRunRequest, baseEnv: NodeJS.ProcessEnv = process.env): FuryHarnessInvocation {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(req.taskId) || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(req.runId)) throw new FuryHarnessRunError('invalid-request', 'taskId/runId invalid');
  if (req.model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/u.test(req.model)) throw new FuryHarnessRunError('invalid-request', 'model id invalid');
  const deniedByHeadless = (Object.keys(req.authority) as FuryCapability[]).filter((c) => req.authority[c] === 'ASK');
  const keep = process.platform === 'win32' ? ['PATH', 'PATHEXT', 'SystemRoot', 'ComSpec', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'] : ['PATH', 'HOME', 'TMPDIR', 'LANG', 'XDG_CONFIG_HOME'];
  const env: Record<string, string> = { NO_COLOR: '1', FURYPIPE_TASK_ID: req.taskId, FURYPIPE_RUN_ID: req.runId };
  for (const k of keep) if (baseEnv[k]) env[k] = baseEnv[k]!;
  if (req.authority.EXTERNAL_ACTION === 'ALLOW') throw new FuryHarnessRunError('authority-unsupported', 'external actions are executed by FuryPipe gates, not delegated to a harness');
  const prompt = renderFuryCapsulePrompt(req.capsule);

  if (req.harnessId === 'claude-code') {
    const tools: string[] = [];
    if (allowed(req.authority, 'READ')) tools.push('Read', 'Grep', 'Glob');
    if (allowed(req.authority, 'WRITE')) tools.push('Edit', 'Write');
    if (allowed(req.authority, 'EXECUTE')) tools.push('Bash');
    if (allowed(req.authority, 'NETWORK')) tools.push('WebFetch', 'WebSearch');
    const args = ['-p', prompt, '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--permission-mode', 'dontAsk'];
    if (tools.length) args.push('--allowedTools', ...tools);
    if (!allowed(req.authority, 'EXECUTE')) args.push('--restricted');
    const disallow = [
      ...(allowed(req.authority, 'WRITE') ? [] : ['Edit', 'Write', 'NotebookEdit']),
      ...(allowed(req.authority, 'NETWORK') ? [] : ['WebFetch', 'WebSearch']),
    ];
    if (disallow.length) args.push('--disallowedTools', ...disallow);
    if (req.model) args.push('--model', req.model);
    if (req.local) {
      const url = assertFuryLocalEndpoint(req.local.baseUrl);
      if (req.local.kind !== 'ollama' && req.local.kind !== 'lmstudio' && req.local.kind !== 'anthropic-compatible') throw new FuryHarnessRunError('authority-unsupported', 'Claude Code needs an Anthropic-compatible local endpoint');
      env.ANTHROPIC_BASE_URL = url.href.replace(/\/$/u, '');
      env.ANTHROPIC_AUTH_TOKEN = 'furypipe-local'; // placeholder accepted by local servers; never a real key
    }
    return Object.freeze({ file: req.executable, args: Object.freeze(args), env: Object.freeze(env), flagsEvidence: 'verified-cli-help', deniedByHeadless: Object.freeze(deniedByHeadless) });
  }

  if (req.harnessId === 'codex') {
    // Codex runs commands inside its sandbox as part of its loop; it cannot
    // honour EXECUTE=DENY, so refuse instead of silently widening authority.
    if (!allowed(req.authority, 'EXECUTE')) throw new FuryHarnessRunError('authority-unsupported', 'Codex cannot run with EXECUTE denied');
    if (allowed(req.authority, 'NETWORK')) throw new FuryHarnessRunError('authority-unsupported', 'network-enabled Codex runs are not supported by this adapter');
    const args = ['exec', '--json', '--sandbox', allowed(req.authority, 'WRITE') ? 'workspace-write' : 'read-only'];
    if (req.model) args.push('-m', req.model);
    if (req.local) {
      assertFuryLocalEndpoint(req.local.baseUrl);
      if (req.local.kind !== 'ollama' && req.local.kind !== 'lmstudio') throw new FuryHarnessRunError('authority-unsupported', 'Codex --oss supports ollama or lmstudio');
      args.push('--oss', '--local-provider', req.local.kind);
    }
    args.push(prompt);
    return Object.freeze({ file: req.executable, args: Object.freeze(args), env: Object.freeze(env), flagsEvidence: 'community-docs-unverified', deniedByHeadless: Object.freeze(deniedByHeadless) });
  }
  throw new FuryHarnessRunError('unsupported-harness', `no execution adapter for ${req.harnessId} yet`);
}

function run(file: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>>, timeoutMs: number): Promise<{ code: number | null; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, [...args], { cwd, env, shell: false, windowsHide: true, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT, encoding: 'utf8' }, (error, stdout, stderr) => {
      const e = error as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : null) : 0, timedOut: Boolean(e?.killed), stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** Execute the invocation in the worktree and record receipts. */
export async function runFuryHarnessTask(req: FuryHarnessRunRequest, ledger: FuryProofLedger): Promise<FuryHarnessRunResult> {
  const invocation = buildFuryHarnessInvocation(req);
  const timeoutMs = Math.min(Math.max(req.timeoutMs, 1_000), 24 * 60 * 60 * 1000);
  const result = await run(invocation.file, invocation.args, req.worktree, invocation.env, timeoutMs);
  const status = await run('git', ['status', '--porcelain', '--untracked-files=all'], req.worktree, { PATH: process.env.PATH ?? '', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, 60_000);
  const changedFiles = status.stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean).sort();
  const diff = await run('git', ['diff', '--binary', 'HEAD'], req.worktree, { PATH: process.env.PATH ?? '' }, 60_000);
  const outputDigest = sha(result.stdout);
  const subject = `agent:${req.runId}:${req.taskId}`;
  const receipts = [
    ledger.issue({
      kind: 'AGENT_RECEIPT', subject, outcome: result.timedOut ? 'unknown' : result.code === 0 ? 'pass' : 'fail', producer: `host:harness-runner:${req.harnessId}`,
      evidenceDigest: outputDigest,
      details: { harnessId: req.harnessId, model: req.model ?? 'harness-default', locality: req.local ? 'local' : 'cloud', exitCode: result.code, timedOut: result.timedOut, flagsEvidence: invocation.flagsEvidence, deniedByHeadless: invocation.deniedByHeadless, capsuleDigest: req.capsule.capsuleDigest },
    }),
    ledger.issue({
      kind: 'PATCH_RECEIPT', subject: `patch:${req.runId}:${req.taskId}`, outcome: status.code === 0 ? 'pass' : 'unknown', producer: 'host:git',
      evidenceDigest: sha(diff.stdout), details: { changedFiles: changedFiles.slice(0, 500) },
    }),
  ];
  return Object.freeze({ exitCode: result.code, timedOut: result.timedOut, outputDigest, changedFiles: Object.freeze(changedFiles), receipts: Object.freeze(receipts), stdoutTail: result.stdout.slice(-4_000) });
}
