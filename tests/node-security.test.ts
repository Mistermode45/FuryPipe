import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CHILD_START_TIMEOUT_MS = process.platform === 'win32' ? 30_000 : 15_000;

// NTFS has no POSIX permission bits: Node reports 0o666 for every file and
// directory on Windows, and chmodSync() only toggles the read-only flag. The
// hardening in src/node.ts still runs there — only the assertion is moot, so
// we check the mode where the platform can actually express it.
const hasPosixModes = process.platform !== 'win32';

function expectMode(target: string, expected: number): void {
  if (!hasPosixModes) return;
  expect(fs.statSync(target).mode & 0o777).toBe(expected);
}

let child: ChildProcess | undefined;
let upstream: Server | undefined;
let dir: string | undefined;
const auxiliaryDirs: string[] = [];

async function removeTempTree(target: string): Promise<void> {
  // Windows can keep a just-closed child-process handle alive after the child
  // emitted `close`. Node 22 has occasionally surfaced EBUSY even when
  // rmSync(maxRetries) is used, so retry the whole removal operation only for
  // the transient Windows filesystem errors we expect here.
  const transientWindowsCodes = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);
  const attempts = process.platform === 'win32' ? 50 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (caught) {
      const code = (caught as NodeJS.ErrnoException).code;
      const retryable = process.platform === 'win32'
        && code !== undefined
        && transientWindowsCodes.has(code)
        && attempt + 1 < attempts;
      if (!retryable) throw caught;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

afterEach(async () => {
  if (child?.exitCode === null) {
    child.kill('SIGTERM');
    // `exit` can precede stdio/handle closure on Windows. Wait for `close`
    // so the log and dump files are no longer held by the child process.
    await new Promise<void>((resolve) => child!.once('close', () => resolve()));
  }
  child = undefined;
  if (upstream) await new Promise<void>((resolve) => upstream!.close(() => resolve()));
  upstream = undefined;
  if (dir) await removeTempTree(dir);
  dir = undefined;
  await Promise.all(auxiliaryDirs.splice(0).map((root) => removeTempTree(root)));
});

function writeAuxiliaryJson(name: string, value: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-node-evidence-'));
  auxiliaryDirs.push(root);
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  return file;
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function startNode(extraEnv: Record<string, string> = {}): Promise<{
  base: string;
  eventsFile: string;
  configFile: string;
  output: () => string;
}> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpipe-node-security-'));
  const port = await freePort();
  const upstreamPort = await freePort();
  upstream = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.endsWith('/count_tokens')) {
      res.end(JSON.stringify({ input_tokens: 100 }));
      return;
    }
    res.end(JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-fable-5',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 1 },
    }));
  });
  await new Promise<void>((resolve) => upstream!.listen(upstreamPort, '127.0.0.1', resolve));
  const eventsFile = path.join(dir, 'data', 'events.jsonl');
  const configFile = path.join(dir, 'config', 'config.json');
  child = spawn(process.execPath, [tsxCli, 'src/node.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      PXPIPE_LOG: eventsFile,
      PXPIPE_CONFIG: configFile,
      PXPIPE_MODELS: 'claude-fable-5',
      ANTHROPIC_UPSTREAM: `http://127.0.0.1:${upstreamPort}`,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout?.on('data', (b) => output.push(String(b)));
  child.stderr?.on('data', (b) => output.push(String(b)));
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`child did not report listening within ${CHILD_START_TIMEOUT_MS}ms\n${output.join('')}`)),
      CHILD_START_TIMEOUT_MS,
    );
    const poll = () => {
      if (output.join('').includes('[furypipe] listening on')) {
        clearTimeout(deadline);
        resolve();
        return;
      }
      if (child?.exitCode !== null) {
        clearTimeout(deadline);
        reject(new Error(output.join('')));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
  return {
    base: `http://127.0.0.1:${port}`,
    eventsFile,
    configFile,
    output: () => output.join(''),
  };
}

describe('Node CLI evidence help', () => {
  it('documents the source-bound Security CI evidence environment variable', () => {
    const result = spawnSync(process.execPath, [tsxCli, 'src/node.ts', '--help'], {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('FURYPIPE_SOURCE_COMMIT');
    expect(result.stdout).toContain('FURYPIPE_CONTROL_ROOM_EVIDENCE');
    expect(result.stdout).toContain('FURYPIPE_CONTROL_ROOM_SECURITY_CI_EVIDENCE');
    expect(result.stdout).toContain('exact-source CI security');
  });
});

describe('Node Control Room Security CI ingestion', () => {
  const sourceCommit = 'a'.repeat(40);

  function securityCiEvidence() {
    return {
      format: 'furypipe-control-room-security-ci-evidence/v1',
      generatedAt: 1,
      sourceCommit,
      codeql: { runId: 1, headSha: sourceCommit, conclusion: 'success' },
      secretScan: { runId: 2, headSha: sourceCommit, conclusion: 'success' },
      licenseCompliance: { runId: 3, headSha: sourceCommit, conclusion: 'success' },
      supplyChain: {
        run: { runId: 4, headSha: sourceCommit, conclusion: 'success' },
        jobs: {
          actionPinning: 'success',
          dependencyAudit: 'success',
          sbom: 'success',
          dependencyReview: 'skipped',
        },
      },
    };
  }

  it('feeds exact-source Security CI evidence into the live Control Room endpoint', async () => {
    const ciFile = writeAuxiliaryJson('security-ci.json', securityCiEvidence());
    const { base } = await startNode({
      FURYPIPE_SOURCE_COMMIT: sourceCommit,
      FURYPIPE_CONTROL_ROOM_SECURITY_CI_EVIDENCE: ciFile,
    });

    const response = await fetch(`${base}/api/control-room.json`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.sourceCommit).toBe(sourceCommit);
    expect(body.sections.security.evidence).toEqual({
      codeql: 'VERIFIED',
      secretScan: 'VERIFIED',
      dependencyAudit: 'VERIFIED',
      sbom: 'VERIFIED',
      actionPinning: 'VERIFIED',
      licenseCompliance: 'VERIFIED',
      dependencyReview: 'NOT_EXECUTED',
    });
    expect(body.sections.security.status).toBe('PARTIAL');
  });

  it('uses exact-source CI Security evidence on conflict and emits an explicit warning', async () => {
    const ciFile = writeAuxiliaryJson('security-ci.json', securityCiEvidence());
    const hostFile = writeAuxiliaryJson('host-evidence.json', {
      format: 'furypipe-control-room-host-evidence/v1',
      generatedAt: 1,
      sourceCommit,
      security: {
        codeql: 'BLOCKED',
        secretScan: 'VERIFIED',
        dependencyAudit: 'NOT_EXECUTED',
        sbom: 'NOT_EXECUTED',
        actionPinning: 'NOT_EXECUTED',
        licenseCompliance: 'VERIFIED',
        dependencyReview: 'VERIFIED',
      },
    });
    const { base, output } = await startNode({
      FURYPIPE_SOURCE_COMMIT: sourceCommit,
      FURYPIPE_CONTROL_ROOM_EVIDENCE: hostFile,
      FURYPIPE_CONTROL_ROOM_SECURITY_CI_EVIDENCE: ciFile,
    });

    const response = await fetch(`${base}/api/control-room.json`);
    const body = await response.json() as any;
    expect(body.sections.security.evidence.codeql).toBe('VERIFIED');
    expect(body.sections.security.evidence.dependencyAudit).toBe('VERIFIED');
    expect(body.sections.security.evidence.dependencyReview).toBe('NOT_EXECUTED');
    expect(output()).toContain(
      'Control Room Security evidence conflict: source-bound CI evidence overrides static host security evidence',
    );
  });
});

describe('Node dashboard security', () => {
  it('rejects cross-origin mutations and accepts same-origin mutations', async () => {
    const { base, configFile } = await startNode();
    const denied = await fetch(`${base}/fragments/models`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
      },
      body: 'list=off',
    });
    expect(denied.status).toBe(403);
    expect(fs.existsSync(configFile)).toBe(false);

    const allowed = await fetch(`${base}/fragments/models`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: base,
        'sec-fetch-site': 'same-origin',
      },
      body: 'list=claude-fable-5',
    });
    expect(allowed.status).toBe(200);
    expectMode(configFile, 0o600);
    expectMode(path.dirname(configFile), 0o700);
  });

  it('rejects dashboard requests with a non-loopback Host header', async () => {
    const { base } = await startNode();
    const response = await fetch(`${base}/fragments/models`, {
      method: 'POST',
      headers: {
        host: 'attacker.example',
        origin: 'http://attacker.example',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'list=off',
    });
    expect(response.status).toBe(403);
  });

  it('creates the event log and containing directory with private permissions', async () => {
    const { base, eventsFile } = await startNode();
    await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        model: 'claude-fable-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    for (let i = 0; i < 100 && !fs.existsSync(eventsFile); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expectMode(eventsFile, 0o600);
    expectMode(path.dirname(eventsFile), 0o700);
  });

  it('creates rendered PNG dumps with private permissions', async () => {
    const dumpDir = path.join(os.tmpdir(), `pxpipe-dumps-${process.pid}-${Date.now()}`);
    const { base } = await startNode({ PXPIPE_DUMP_DIR: dumpDir });
    await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        model: 'claude-fable-5',
        max_tokens: 1,
        system: 'Sensitive system context. '.repeat(1000),
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    let files: string[] = [];
    for (let i = 0; i < 100 && files.length === 0; i++) {
      files = fs.readdirSync(dumpDir);
      if (files.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expectMode(dumpDir, 0o700);
    expect(files.length).toBeGreaterThan(0);
    expectMode(path.join(dumpDir, files[0]!), 0o600);
    await removeTempTree(dumpDir);
  });
});
