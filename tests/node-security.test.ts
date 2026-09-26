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

async function startNode(
  extraEnv: Record<string, string | undefined> = {},
  initialConfig?: Record<string, unknown>,
): Promise<{
  base: string;
  eventsFile: string;
  configFile: string;
  output: () => string;
}> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-node-security-'));
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
  if (initialConfig !== undefined) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(initialConfig));
  }
  const baseChildEnv: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete baseChildEnv[key];
  }
  if (!Object.prototype.hasOwnProperty.call(extraEnv, 'FURYPIPE_MODELS')) {
    baseChildEnv.FURYPIPE_MODELS = 'claude-fable-5';
  }
  baseChildEnv.FURYPIPE_HOST = '127.0.0.1';
  baseChildEnv.FURYPIPE_LOG = eventsFile;
  baseChildEnv.FURYPIPE_CONFIG = configFile;
  baseChildEnv.ANTHROPIC_UPSTREAM = `http://127.0.0.1:${upstreamPort}`;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freePort();
    const childEnv: NodeJS.ProcessEnv = { ...baseChildEnv, FURYPIPE_PORT: String(port) };
    child = spawn(process.execPath, [tsxCli, 'src/node.ts'], {
      cwd: repoRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];
    child.stdout?.on('data', (b) => output.push(String(b)));
    child.stderr?.on('data', (b) => output.push(String(b)));
    try {
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
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      lastError = error;
      const addressRace = output.join('').includes(' is already in use');
      if (!addressRace || attempt === 2) throw error;
      if (child?.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => child!.once('close', () => resolve()));
      }
      child = undefined;
    }
  }
  throw lastError ?? new Error('failed to start FuryPipe node host');
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

describe('Node beta readiness startup gate', () => {
  it('refuses an invalid required config before binding the runtime port', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-beta-startup-'));
    const configFile = path.join(dir, 'config.json');
    fs.writeFileSync(configFile, '[]', { encoding: 'utf8', mode: 0o600 });
    const port = await freePort();
    const output: string[] = [];
    child = spawn(process.execPath, [tsxCli, 'src/node.ts'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        FURYPIPE_CONFIG: configFile,
        FURYPIPE_HOST: '127.0.0.1',
        FURYPIPE_MODELS: 'claude-fable-5',
        FURYPIPE_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => output.push(String(chunk)));
    child.stderr?.on('data', (chunk) => output.push(String(chunk)));
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        child?.kill('SIGTERM');
        reject(new Error(`invalid-config startup did not terminate\n${output.join('')}`));
      }, CHILD_START_TIMEOUT_MS);
      child!.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code, output: output.join('') });
      });
    });

    expect(result.code).toBe(2);
    expect(result.output).toContain('beta readiness blocked; startup refused');
    expect(result.output).not.toContain('[furypipe] listening on');
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

  it('ignores stale Security CI evidence and preserves valid static host security', async () => {
    const staleCommit = 'b'.repeat(40);
    const ciFile = writeAuxiliaryJson('security-ci-stale.json', {
      ...securityCiEvidence(),
      sourceCommit: staleCommit,
      codeql: { runId: 1, headSha: staleCommit, conclusion: 'success' },
      secretScan: { runId: 2, headSha: staleCommit, conclusion: 'success' },
      licenseCompliance: { runId: 3, headSha: staleCommit, conclusion: 'success' },
      supplyChain: {
        run: { runId: 4, headSha: staleCommit, conclusion: 'success' },
        jobs: {
          actionPinning: 'success',
          dependencyAudit: 'success',
          sbom: 'success',
          dependencyReview: 'skipped',
        },
      },
    });
    const hostFile = writeAuxiliaryJson('host-evidence-fallback.json', {
      format: 'furypipe-control-room-host-evidence/v1',
      generatedAt: 1,
      sourceCommit,
      security: {
        codeql: 'BLOCKED',
        secretScan: 'VERIFIED',
        dependencyAudit: 'PARTIAL',
        sbom: 'PARTIAL',
        actionPinning: 'VERIFIED',
        licenseCompliance: 'VERIFIED',
        dependencyReview: 'NOT_EXECUTED',
      },
    });
    const { base, output } = await startNode({
      FURYPIPE_SOURCE_COMMIT: sourceCommit,
      FURYPIPE_CONTROL_ROOM_EVIDENCE: hostFile,
      FURYPIPE_CONTROL_ROOM_SECURITY_CI_EVIDENCE: ciFile,
    });

    const response = await fetch(`${base}/api/control-room.json`);
    const body = await response.json() as any;
    expect(body.sections.security.evidence).toEqual({
      codeql: 'BLOCKED',
      secretScan: 'VERIFIED',
      dependencyAudit: 'PARTIAL',
      sbom: 'PARTIAL',
      actionPinning: 'VERIFIED',
      licenseCompliance: 'VERIFIED',
      dependencyReview: 'NOT_EXECUTED',
    });
    expect(output()).toMatch(/ignored Control Room Security CI evidence: .*sourceCommit/i);
    expect(output()).not.toContain('source-bound CI evidence overrides static host security evidence');
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
  it('rejects unknown or contradictory model-scope commands before mutation', async () => {
    const { base, configFile } = await startNode();
    const headers = {
      'content-type': 'application/json',
      origin: base,
      'sec-fetch-site': 'same-origin',
    };
    const unknown = await fetch(`${base}/fragments/models`, {
      method: 'POST', headers, body: JSON.stringify({ mode: 'future', list: 'off' }),
    });
    expect(unknown.status).toBe(400);
    expect(fs.existsSync(configFile)).toBe(false);
    const contradictory = await fetch(`${base}/fragments/models`, {
      method: 'POST', headers, body: JSON.stringify({ mode: 'automatic', list: 'claude-fable-5' }),
    });
    expect(contradictory.status).toBe(400);
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it('does not apply a visual policy when the model-scope command is contradictory', async () => {
    const { base, configFile } = await startNode();
    const headers = {
      'content-type': 'application/json',
      origin: base,
      'sec-fetch-site': 'same-origin',
    };
    const response = await fetch(`${base}/fragments/models`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'automatic', list: 'claude-fable-5', policy: 'text_only' }),
    });
    expect(response.status).toBe(400);
    expect(fs.existsSync(configFile)).toBe(false);
    const fragment = await (await fetch(`${base}/fragments/models`)).text();
    expect(fragment).toContain('<option value="auto" selected>AUTO</option>');
  });

  it('rejects an oversized model scope before policy or persistence mutation', async () => {
    const { base, configFile } = await startNode();
    const headers = {
      'content-type': 'application/json',
      origin: base,
      'sec-fetch-site': 'same-origin',
    };
    const list = Array.from({ length: 65 }, (_, index) => `model-${index}`).join(',');
    const response = await fetch(`${base}/fragments/models`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mode: 'explicit', list, policy: 'text_only' }),
    });
    expect(response.status).toBe(400);
    expect(fs.existsSync(configFile)).toBe(false);
    const fragment = await (await fetch(`${base}/fragments/models`)).text();
    expect(fragment).toContain('<option value="auto" selected>AUTO</option>');
  });

  it('honors persisted off when the environment variable is present but empty', async () => {
    const { base, output } = await startNode(
      { FURYPIPE_MODELS: '' },
      { modelScopeMode: 'off' },
    );
    const models = await (await fetch(`${base}/api/models.json`)).json() as { scopeMode: string };
    expect(models.scopeMode).toBe('off');
    expect(output()).toContain('model scope: off (source=config)');
  });

  it('returns to automatic after a persisted scope was injected at startup', async () => {
    const { base, configFile, output } = await startNode(
      { FURYPIPE_MODELS: undefined },
      { modelScopeMode: 'explicit', models: ['claude-fable-5'], modelScopeExplicit: true },
    );
    const response = await fetch(`${base}/fragments/models`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ mode: 'automatic' }),
    });
    expect(response.status).toBe(200);
    const fragment = await response.text();
    expect(fragment).toContain('data-model-scope="automatic"');
    const models = await (await fetch(`${base}/api/models.json`)).json() as { scopeMode: string };
    expect(models.scopeMode).toBe('automatic');
    const persisted = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown>;
    expect(persisted.modelScopeMode).toBe('automatic');
    expect(persisted.models).toBeUndefined();
    expect(persisted.modelScopeExplicit).toBeUndefined();
    expect(output()).toContain('model scope: explicit (source=config)');
  });

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
    const dumpDir = path.join(os.tmpdir(), `furypipe-dumps-${process.pid}-${Date.now()}`);
    const { base, output } = await startNode({ FURYPIPE_DUMP_DIR: dumpDir });
    const response = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        model: 'claude-fable-5',
        max_tokens: 1,
        system: 'Sensitive system context. '.repeat(1000),
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(response.status).toBe(200);
    // createProxy deliberately detaches finalize(); onRequest (which writes the
    // debug PNG) can therefore finish shortly after the HTTP response body.
    // Consume the body, then wait for that explicit asynchronous side effect
    // instead of assuming await fetch() means telemetry finalization is done.
    await response.arrayBuffer();
    let files: string[] = [];
    const deadline = Date.now() + (process.platform === 'win32' ? 10_000 : 5_000);
    while (files.length === 0 && Date.now() < deadline) {
      files = fs.readdirSync(dumpDir);
      if (files.length === 0) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expectMode(dumpDir, 0o700);
    expect(files.length, output()).toBeGreaterThan(0);
    expectMode(path.join(dumpDir, files[0]!), 0o600);
    await removeTempTree(dumpDir);
  });
});

describe('Node host serves FuryPipe Studio', () => {
  it('serves Studio at / with a nonce CSP and the dashboard at /control-plane', async () => {
    const { base } = await startNode();
    const studio = await fetch(`${base}/`);
    expect(studio.status).toBe(200);
    const csp = studio.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/u);
    expect(csp).toContain("default-src 'none'");
    const html = await studio.text();
    expect(html).toContain('FuryPipe Studio');
    for (const view of ['chat', 'cowork', 'code', 'agents', 'automations']) expect(html).toContain(`data-view="${view}"`);
    expect(html).toContain('href="/control-plane"');
    const controlPlane = await fetch(`${base}/control-plane`);
    expect(controlPlane.status).toBe(200);
    expect(await controlPlane.text()).not.toContain('FuryPipe Studio</title>');
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });

  it('guards the Studio API: method, same-origin POST, JSON only and preview-only dispatch', async () => {
    const { base } = await startNode();
    const harnesses = await fetch(`${base}/api/studio/harnesses.json`);
    expect(harnesses.status).toBe(200);
    expect(((await harnesses.json()) as { harnesses: { id: string }[] }).harnesses.map((h) => h.id)).toContain('furypipe-native');
    expect((await fetch(`${base}/api/studio/harnesses.json`, { method: 'POST' })).status).toBe(405);
    const crossOrigin = await fetch(`${base}/api/studio/dispatch-preview`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    expect(crossOrigin.status).toBe(403);
    const notJson = await fetch(`${base}/api/studio/dispatch-preview`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(notJson.status).toBe(415);
    const badIr = await fetch(`${base}/api/studio/dispatch-preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ir: { format: 'x' } }) });
    expect(badIr.status).toBe(422);
    const chatToCloud = await fetch(`${base}/api/studio/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: 'https://api.openai.com', model: 'm', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(chatToCloud.status).toBe(403);
  });
});
