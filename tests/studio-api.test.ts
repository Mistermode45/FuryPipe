import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { FuryHarnessDiscovery } from '../src/fury-harness-hub.js';
import { FURY_HARNESS_REGISTRY } from '../src/fury-harness-hub.js';
import type { FuryLocalBackendStatus } from '../src/fury-local-fabric.js';
import { createStudioApi, studioApiRoute, studioBindings } from '../src/studio/studio-api.js';
import { renderStudioHtml, STUDIO_EXAMPLE_FLOW, STUDIO_EXAMPLE_IR } from '../src/studio/studio-page.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const harnesses: FuryHarnessDiscovery = {
  format: 'furypipe-harness-discovery/v1', platform: 'linux',
  harnesses: FURY_HARNESS_REGISTRY.map((definition) => ({
    id: definition.id, displayName: definition.displayName, authentication: 'not-probed' as const, definition,
    installed: definition.id === 'furypipe-native' || definition.id === 'claude-code' || definition.id === 'codex',
    versionStatus: definition.id === 'furypipe-native' ? 'builtin' as const : 'ok' as const,
  })),
};

async function fakeOllama(): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body) as { model: string; messages: unknown[] };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `hello from ${parsed.model} (${parsed.messages.length})` } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const local = (baseUrl: string): FuryLocalBackendStatus[] => [{
  kind: 'ollama', baseUrl, reachable: true, version: '0.14.2', protocols: ['native', 'openai-chat', 'anthropic-messages'],
  models: [{ backend: 'ollama', baseUrl, id: 'qwen2.5-coder:7b', sizeBytes: 4_700_000_000 }, { backend: 'ollama', baseUrl, id: 'nomic-embed', modality: 'embeddings' }],
}];

function api(baseUrl: string) {
  return createStudioApi({
    projectRoot: process.cwd(),
    discoverHarnesses: async () => harnesses,
    discoverLocal: async () => ({ backends: local(baseUrl) }),
    discoverHardware: async () => ({ platform: 'linux', arch: 'x64', cpuModel: 't', cpuCount: 8, totalMemoryBytes: 32 * 1024 ** 3, freeMemoryBytes: 1, unifiedMemory: false, gpus: [{ name: 'g', memoryBytes: 12 * 1024 ** 3 }] }),
  });
}

const post = (body: unknown, type = 'application/json') => new Request('http://127.0.0.1/x', { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });

describe('Studio API', () => {
  it('matches only the declared routes', () => {
    expect(studioApiRoute('/api/studio/local.json')).toEqual({ route: 'local', method: 'GET' });
    expect(studioApiRoute('/api/studio/chat')).toEqual({ route: 'chat', method: 'POST' });
    expect(studioApiRoute('/api/studio/setup/runtime')).toEqual({ route: 'runtime-setup', method: 'POST' });
    expect(studioApiRoute('/api/studio/connections/login')).toEqual({ route: 'connection-login', method: 'POST' });
    expect(studioApiRoute('/api/studio/../control-room.json')).toBeNull();
  });

  it('derives bindings from installed harnesses and reachable local models (harness x provider x model)', () => {
    const b = studioBindings(harnesses, local('http://127.0.0.1:11434'));
    const ids = b.map((x) => x.id);
    expect(ids).toContain('native:ollama:qwen2.5-coder:7b');
    expect(ids).toContain('claude-code:ollama:qwen2.5-coder:7b');
    expect(ids).toContain('codex:ollama:qwen2.5-coder:7b');
    expect(ids).toContain('claude-code:default');
    expect(ids.some((id) => id.includes('nomic-embed'))).toBe(false);
    expect(b.every((x) => Object.keys(x.scores).length === 0)).toBe(true);
  });

  it('requires confirmation for one-click local runtime installation and uses the fixed installer', async () => {
    const calls: string[][] = [];
    const studio = createStudioApi({
      projectRoot: process.cwd(),
      discoverHarnesses: async () => harnesses,
      discoverLocal: async () => ({ backends: [] }),
      discoverHardware: async () => ({ platform:'win32', arch:'x64', cpuModel:'t', cpuCount:8, totalMemoryBytes:32*1024**3, freeMemoryBytes:16*1024**3, unifiedMemory:false, gpus:[] }),
      runtimeSetupPlatform: 'win32',
      runtimeSetupRunner: async (executable, args) => {
        calls.push([executable, ...args]);
        return { exitCode:0, stdout:'ok', stderr:'' };
      },
    });
    expect((await studio.handle('runtime-setup', post({ runtime:'ollama' }))).status).toBe(400);
    const response = await studio.handle('runtime-setup', post({ runtime:'ollama', confirm:true }));
    expect(response.status).toBe(201);
    expect(calls[0]).toContain('Ollama.Ollama');
  });

  it('launches account sign-in only with confirmation and a known installed provider runtime', async () => {
    const calls: string[][] = [];
    const studio = createStudioApi({
      projectRoot: process.cwd(),
      discoverHarnesses: async () => harnesses,
      discoverLocal: async () => ({ backends: [] }),
      discoverHardware: async () => ({ platform:'win32', arch:'x64', cpuModel:'t', cpuCount:8, totalMemoryBytes:32*1024**3, freeMemoryBytes:16*1024**3, unifiedMemory:false, gpus:[] }),
      accountLoginPlatform: 'win32',
      accountLoginLauncher: (executable, args) => calls.push([executable, ...args]),
    });
    expect((await studio.handle('connection-login', post({ provider:'anthropic' }))).status).toBe(400);
    const response = await studio.handle('connection-login', post({ provider:'anthropic', confirm:true }));
    expect(response.status).toBe(202);
    expect(calls[0]?.slice(-2)).toEqual(['auth','login']);
  });

  it('reports local models with hardware fit', async () => {
    const res = await api('http://127.0.0.1:11434').handle('local', new Request('http://127.0.0.1/x'));
    const body = await res.json() as { backends: { models: { id: string; fit: string }[] }[] };
    expect(body.backends[0]?.models[0]).toMatchObject({ id: 'qwen2.5-coder:7b', fit: 'FITS' });
  });

  it('previews a dispatch plan without executing anything', async () => {
    const res = await api('http://127.0.0.1:11434').handle('dispatch-preview', post({ ir: STUDIO_EXAMPLE_IR, mode: 'LOCAL_ONLY' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { plan: { status: string; assignments: { bindingIds: string[] }[] }; execution: string };
    expect(body.execution).toMatch(/NOT_EXECUTED/u);
    expect(body.plan.status).toBe('PLANNED');
    expect(body.plan.assignments.every((a) => a.bindingIds.every((id) => !id.endsWith(':default')))).toBe(true);
  });

  it('streams chat from a loopback backend and refuses anything else', async () => {
    const baseUrl = await fakeOllama();
    const studio = api(baseUrl);
    const res = await studio.handle('chat', post({ kind: 'ollama', baseUrl, model: 'qwen2.5-coder:7b', messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-furypipe-locality')).toBe('local');
    expect(await res.text()).toContain('hello from qwen2.5-coder:7b (1)');
    expect((await studio.handle('chat', post({ baseUrl: 'http://169.254.169.254', model: 'm', messages: [{ role: 'user', content: 'x' }] }))).status).toBe(403);
    expect((await studio.handle('chat', post({ baseUrl, model: 'm', messages: [{ role: 'tool', content: 'x' }] }))).status).toBe(400);
    expect((await studio.handle('chat', post({ baseUrl, model: 'm', messages: [] }))).status).toBe(400);
    expect((await studio.handle('chat', post({}, 'text/plain'))).status).toBe(415);
    const huge = new Request('http://127.0.0.1/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(300_000) });
    expect((await studio.handle('chat', huge)).status).toBe(413);
  });

  it('validates and dry-runs a FuryFlow without side effects', async () => {
    const studio = api('http://127.0.0.1:1');
    const ok = await studio.handle('flow-preview', post({ flow: STUDIO_EXAMPLE_FLOW, fixtures: { classify: 'refund', route: 'refund', reply: 'x' } }));
    expect(ok.status).toBe(200);
    const body = await ok.json() as { flow: { stochasticSurface: { agentic: number } }; run: { status: string }; execution: string };
    expect(body.flow.stochasticSurface.agentic).toBe(2);
    expect(body.run.status).toBe('waiting-approval');
    expect(body.execution).toMatch(/DRY_RUN/u);
    const bad = await studio.handle('flow-preview', post({ flow: { ...STUDIO_EXAMPLE_FLOW, nodes: STUDIO_EXAMPLE_FLOW.nodes.map((n) => (n.id === 'classify' ? { ...n, critical: true } : n)) } }));
    expect(bad.status).toBe(422);
  });

  it('validates blast-radius input', async () => {
    const studio = api('http://127.0.0.1:1');
    expect((await studio.handle('blast-radius', post({ files: [] }))).status).toBe(400);
    expect((await studio.handle('blast-radius', post({ files: [1] }))).status).toBe(400);
  });
});

describe('Studio page', () => {
  it('uses a fresh nonce, no inline handlers and escapes the example contract', () => {
    const a = renderStudioHtml();
    const b = renderStudioHtml();
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.html).not.toMatch(/\son[a-z]+=/u);
    expect(a.html).not.toMatch(/style="/u);
    expect(a.html).toContain('<a class="skip" href="#main">');
    expect(a.html).toContain('&quot;format&quot;: &quot;furypipe-ir/v1&quot;');
    const fr = renderStudioHtml({ locale: 'fr' });
    expect(fr.html).toContain('<html lang="fr"');
    expect(fr.html).toContain('const SERVER_LANGUAGE = "fr";');
    expect(fr.html).not.toContain('__SERVER_LANGUAGE__');
  });
});

describe('Studio runs (Mission Control)', () => {
  it('requires confirmation, refuses cloud by default and runs a local plan to a judged result', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'furypipe-studio-run-'));
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'src', 'auth'), { recursive: true });
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    execFileSync('git', ['init', '-q'], { cwd: repo, env });
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repo, env });
    writeFileSync(join(repo, 'src', 'auth', 'login.ts'), 'export const x = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: repo, env });
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo, env });
    try {
      const seen: string[] = [];
      const authorities: string[] = [];
      const studio = createStudioApi({
        projectRoot: repo, worktreeRoot: join(root, 'wt'),
        discoverHarnesses: async () => harnesses,
        discoverLocal: async () => ({ backends: local('http://127.0.0.1:11434') }),
        discoverHardware: async () => ({ platform: 'linux', arch: 'x64', cpuModel: 't', cpuCount: 1, totalMemoryBytes: 1, freeMemoryBytes: 1, unifiedMemory: false, gpus: [] }),
        loadGraph: async () => { throw new Error('no graph'); },
        executor: async ({ assignment, binding, worktree }) => {
          seen.push(`${assignment.taskId}@${binding.locality}`);
          authorities.push(assignment.authority.WRITE);
          if (assignment.role === 'implementer') writeFileSync(join(worktree, 'src', 'auth', 'login.ts'), 'export const x = 2;\n');
          return { ok: true, receipts: [] };
        },
      });
      expect((await studio.handle('run-start', post({ intent: 'Fix login', plannedFiles: ['src/auth/login.ts'] }))).status).toBe(400);
      const started = await studio.handle('run-start', post({ intent: 'Fix login', plannedFiles: ['src/auth/login.ts'], confirm: true }));
      expect(started.status).toBe(202);
      const { runId } = await started.json() as { runId: string };
      let snapshot: { status: string; verdict?: string; workers: { locality: string }[] } | undefined;
      for (let i = 0; i < 200; i += 1) {
        const list = await (await studio.handle('runs', new Request('http://127.0.0.1/x'))).json() as { runs: typeof snapshot[] };
        snapshot = list.runs.find((r) => (r as { runId: string }).runId === runId)!;
        if (snapshot.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(snapshot?.status).toBe('COMPLETED');
      // No test/review receipt was produced by the fake executor: never ACCEPT.
      expect(snapshot?.verdict).toBe('UNPROVEN');
      expect(seen.every((s) => s.endsWith('@local'))).toBe(true);
      expect(snapshot?.workers.every((w) => w.locality === 'local')).toBe(true);
      expect((await studio.handle('run-act', post({ runId, workerId: 'x', action: 'DELETE' }))).status).toBe(400);
      expect((await studio.handle('run-act', post({ runId: 'nope', workerId: 'x', action: 'STOP' }))).status).toBe(404);

      // Cowork permissions: ASK must be approved first, external actions never ALLOW, DENY reaches every agent.
      const ask = await studio.handle('run-start', post({ intent: 'Tidy', plannedFiles: ['src/auth/login.ts'], confirm: true, capabilities: { READ: 'ALLOW', WRITE: 'ASK' } }));
      expect(ask.status).toBe(409);
      expect(await ask.json()).toMatchObject({ approvalRequired: ['WRITE'] });
      expect((await studio.handle('run-start', post({ intent: 'Tidy', plannedFiles: [], confirm: true, capabilities: { EXTERNAL_ACTION: 'ALLOW' } }))).status).toBe(400);
      // Malformed or partial approvals never count as approval.
      expect((await studio.handle('run-start', post({ intent: 'Tidy', plannedFiles: [], confirm: true, capabilities: { WRITE: 'ASK' }, approvedCapabilities: 'WRITE' }))).status).toBe(409);
      expect((await studio.handle('run-start', post({ intent: 'Tidy', plannedFiles: [], confirm: true, capabilities: { WRITE: 'ASK', EXECUTE: 'ASK' }, approvedCapabilities: ['WRITE'] }))).status).toBe(409);
      expect((await studio.handle('run-start', post({ intent: 'Tidy', plannedFiles: [], confirm: true, capabilities: { SUDO: 'ALLOW' } }))).status).toBe(400);
      authorities.length = 0;
      const denied = await studio.handle('run-start', post({ intent: 'Read only review', plannedFiles: ['src/auth/login.ts'], confirm: true, capabilities: { READ: 'ALLOW', WRITE: 'DENY', EXECUTE: 'DENY' } }));
      expect(denied.status, await denied.clone().text()).toBe(202);
      const deniedId = (await denied.json() as { runId: string }).runId;
      for (let i = 0; i < 200; i += 1) {
        const list = await (await studio.handle('runs', new Request('http://127.0.0.1/x'))).json() as { runs: { runId: string; status: string }[] };
        if (list.runs.find((r) => r.runId === deniedId)?.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(authorities.length).toBeGreaterThan(0);
      expect(authorities.every((a) => a === 'DENY')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('Studio Skills Hub', () => {
  it('lists, pins, selects and installs skills with confirmation', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createFurySkillHub } = await import('../src/fury-skill-hub.js');
    const root = mkdtempSync(join(tmpdir(), 'furypipe-studio-skills-'));
    try {
      const project = join(root, 'p');
      const mk = (dir: string, name: string, description: string) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBody.\n`); return join(dir, name); };
      mk(join(project, '.agents', 'skills'), 'api-docs', 'Write API reference documentation for endpoints.');
      const skillHub = createFurySkillHub({ projectRoot: project, homeDir: join(root, 'h'), stateDir: join(root, 's'), projectTrustedForInstructions: true });
      const studio = createStudioApi({ projectRoot: project, skillHub, discoverHarnesses: async () => harnesses, discoverLocal: async () => ({ backends: [] }) });
      const list = await (await studio.handle('skills', new Request('http://127.0.0.1/'))).json() as { skills: { name: string; checksum: string }[] };
      expect(list.skills.map((s) => s.name)).toEqual(['api-docs']);
      const pinned = await (await studio.handle('skill-act', post({ name: 'api-docs', action: 'PIN' }))).json() as { pinned: string };
      expect(pinned.pinned).toBe(list.skills[0]!.checksum);
      expect((await studio.handle('skill-act', post({ name: 'api-docs', action: 'GOVERNANCE', value: 'ROOT' }))).status).toBe(400);
      expect((await studio.handle('skill-act', post({ name: 'ghost', action: 'PIN' }))).status).toBe(404);
      const sel = await (await studio.handle('skill-select', post({ objective: 'write API reference documentation', harnessId: 'codex' }))).json() as { plan: { selected: { name: string }[] }; execution: string };
      expect(sel.plan.selected.map((s) => s.name)).toEqual(['api-docs']);
      expect(sel.execution).toMatch(/NOT_EXECUTED/u);
      const src = mk(join(root, 'in'), 'changelog', 'Summarise changes into a changelog.');
      expect((await studio.handle('skill-install', post({ sourceDir: src }))).status).toBe(400);
      expect((await studio.handle('skill-install', post({ sourceDir: 'relative/dir', confirm: true }))).status).toBe(400);
      expect((await studio.handle('skill-install', post({ sourceDir: join(root, 'missing'), confirm: true }))).status).toBe(404);
      expect((await studio.handle('skill-install', post({ sourceDir: src, confirm: true }))).status).toBe(201);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Studio MCP Hub', () => {
  it('lists redacted sources, sets policies and requires confirmation to probe', async () => {
    const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { createFuryMcpHub } = await import('../src/fury-mcp-hub.js');
    const root = mkdtempSync(join(tmpdir(), 'furypipe-studio-mcp-'));
    try {
      const project = join(root, 'p');
      mkdirSync(project);
      const fixture = fileURLToPath(new URL('./fixtures/mcp-direct-stdio-server.mjs', import.meta.url));
      writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { fx: { command: process.execPath, args: [fixture], env: { K: 'secret-env-value' } } } }));
      const mcpHub = createFuryMcpHub({ projectRoot: project, homeDir: join(root, 'h'), stateDir: join(root, 's') });
      const studio = createStudioApi({ projectRoot: project, mcpHub, discoverHarnesses: async () => harnesses, discoverLocal: async () => ({ backends: [] }) });
      const listed = await (await studio.handle('mcp', new Request('http://127.0.0.1/'))).text();
      expect(listed).toContain('project-mcp.fx');
      expect(listed).not.toContain('secret-env-value');
      expect((await studio.handle('mcp-probe', post({ sourceId: 'project-mcp.fx' }))).status).toBe(400);
      expect((await studio.handle('mcp-probe', post({ sourceId: 'ghost', confirm: true }))).status).toBe(404);
      expect((await studio.handle('mcp-act', post({ sourceId: 'project-mcp.fx', action: 'DEFAULT_POLICY', value: 'SOMETIMES' }))).status).toBe(422);
      await studio.handle('mcp-act', post({ sourceId: 'project-mcp.fx', action: 'TRUST' }));
      await studio.handle('mcp-act', post({ sourceId: 'project-mcp.fx', action: 'DEFAULT_POLICY', value: 'READ_ONLY' }));
      const probed = await (await studio.handle('mcp-probe', post({ sourceId: 'project-mcp.fx', confirm: true }))).json() as { health: { ok: boolean } };
      expect(probed.health.ok).toBe(true);
      expect(await (await studio.handle('mcp-decide', post({ sourceId: 'project-mcp.fx', tool: 'inventory-proof' }))).json()).toMatchObject({ decision: 'ALLOW' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('Studio Knowledge', () => {
  it('indexes a project folder, refuses escapes and returns cited hits', async () => {
    const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'furypipe-studio-kb-'));
    try {
      const project = join(root, 'p');
      mkdirSync(join(project, 'docs'), { recursive: true });
      writeFileSync(join(project, 'docs', 'ops.md'), '# Operations\n\n## Backups\n\nBackups run nightly and are kept for 30 days.\n');
      const studio = createStudioApi({ projectRoot: project, knowledgeDir: join(root, 'kb'), discoverHarnesses: async () => harnesses, discoverLocal: async () => ({ backends: [] }) });
      expect((await studio.handle('knowledge-ingest', post({ dir: '../' }))).status).toBe(400);
      expect((await studio.handle('knowledge-ingest', post({ dir: '/etc' }))).status).toBe(400);
      expect(await (await studio.handle('knowledge-ingest', post({ dir: 'docs' }))).json()).toMatchObject({ filesIndexed: 1 });
      const found = await (await studio.handle('knowledge-search', post({ query: 'how long are backups kept?' }))).json() as { mode: string; hits: { citation: string }[] };
      expect(found.mode).toBe('lexical');
      expect(found.hits[0]?.citation).toBe('docs/ops.md:3-5');
      expect((await studio.handle('knowledge-search', post({ query: 'backups', mode: 'semantic' }))).status).toBe(422);
      expect(await (await studio.handle('knowledge', new Request('http://127.0.0.1/'))).json()).toMatchObject({ files: 1, availableEmbeddingModel: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Studio Web', () => {
  it('fetches through the SSRF-safe path, refuses private targets and has no default search provider', async () => {
    const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Hi</title><main><h1>Hello</h1><a href="/next">n</a></main>'));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const studio = createStudioApi({
      projectRoot: process.cwd(), discoverHarnesses: async () => harnesses, discoverLocal: async () => ({ backends: [] }),
      webFetch: { resolveHostname: async () => ['93.184.216.34'], dial: () => ({ host: '127.0.0.1', port }) },
    });
    const page = await (await studio.handle('web', post({ action: 'FETCH', url: 'http://site.test/' }))).json() as { title: string; headings: string[]; receiptId: string; capability: string };
    expect(page).toMatchObject({ capability: 'FETCH+EXTRACT', title: 'Hi', headings: ['Hello'] });
    expect(page.receiptId).toBeTruthy();
    expect((await studio.handle('web', post({ action: 'FETCH', url: 'http://127.0.0.1:1/' }))).status).toBe(403);
    const prev = process.env.FURYPIPE_SEARXNG_URL;
    delete process.env.FURYPIPE_SEARXNG_URL;
    try {
      expect((await studio.handle('web', post({ action: 'SEARCH', query: 'x' }))).status).toBe(409);
    } finally {
      if (prev !== undefined) process.env.FURYPIPE_SEARXNG_URL = prev;
    }
    expect((await studio.handle('web', post({ action: 'CLICK', url: 'http://site.test/' }))).status).toBe(400);
  });
});

describe('Studio Memory', () => {
  it('is off without an encrypted config and, when on, remembers, recalls with reasons and forgets', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createRecoveryStore } = await import('../src/core/recovery-store.js');
    const { createMemoryVNextStore } = await import('../src/memory-vnext.js');
    const off = createStudioApi({ projectRoot: process.cwd(), memory: { enabled: false, reason: 'Memory is off.' }, discoverHarnesses: async () => harnesses, discoverLocal: async () => ({ backends: [] }) });
    expect(await (await off.handle('memory', new Request('http://127.0.0.1/'))).json()).toEqual({ enabled: false, reason: 'Memory is off.', records: [] });
    expect((await off.handle('memory-remember', post({ text: 'x', scope: 'user' }))).status).toBe(409);
    const root = mkdtempSync(join(tmpdir(), 'furypipe-studio-mem-'));
    try {
      let t = 10_000;
      const store = createMemoryVNextStore({ recovery: createRecoveryStore(root, { namespace: 'studio-mem' }), authorize: () => true, now: () => t });
      const studio = createStudioApi({ projectRoot: root, now: () => t, memory: { enabled: true, store }, discoverHarnesses: async () => harnesses, discoverLocal: async () => ({ backends: [] }) });
      expect((await studio.handle('memory-remember', post({ text: 'We deploy on Tuesdays only', scope: 'team' }))).status).toBe(400);
      const saved = await (await studio.handle('memory-remember', post({ text: 'We deploy on Tuesdays only', scope: 'project' }))).json() as { memoryId: string };
      t += 3_600_000;
      const recall = await (await studio.handle('memory-search', post({ query: 'when do we deploy?' }))).json() as { hits: { text: string; scope: string; ageMs: number; why: string }[]; authority: string };
      expect(recall.authority).toBe('memory-data-only');
      expect(recall.hits[0]).toMatchObject({ text: 'We deploy on Tuesdays only', scope: 'project', ageMs: 3_600_000 });
      expect(recall.hits[0]!.why).toMatch(/user-declared from user-message/u);
      const listed = await (await studio.handle('memory', new Request('http://127.0.0.1/'))).json() as { records: { memoryId: string; state: string }[] };
      expect(listed.records).toMatchObject([{ memoryId: saved.memoryId, state: 'active' }]);
      await studio.handle('memory-act', post({ memoryId: saved.memoryId, scope: 'project', action: 'DISABLE' }));
      expect((await (await studio.handle('memory-search', post({ query: 'deploy' }))).json() as { hits: unknown[] }).hits).toEqual([]);
      expect((await studio.handle('memory-act', post({ memoryId: saved.memoryId, scope: 'project', action: 'FORGET' }))).status).toBe(200);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Studio Integrations', () => {
  it('lists the registry with credential names only', async () => {
    const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createFuryMcpHub } = await import('../src/fury-mcp-hub.js');
    const root = mkdtempSync(join(tmpdir(), 'furypipe-studio-int-'));
    try {
      mkdirSync(join(root, '.furypipe'));
      writeFileSync(join(root, '.furypipe', 'integrations.json'), JSON.stringify({ format: 'furypipe-integrations/v1', integrations: [{ id: 'ci', kind: 'WEBHOOK_OUT', url: 'https://ci.example.com/hook', credentialEnv: 'CI_HOOK_TOKEN_TEST_UNSET' }] }));
      writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { command: 'docs-mcp', env: { DOCS_TOKEN: 'real-secret' } } } }));
      const studio = createStudioApi({ projectRoot: root, mcpHub: createFuryMcpHub({ projectRoot: root, homeDir: join(root, 'h'), stateDir: join(root, 's') }), discoverHarnesses: async () => harnesses, discoverLocal: async () => ({ backends: [] }) });
      const text = await (await studio.handle('integrations', new Request('http://127.0.0.1/'))).text();
      expect(text).not.toContain('real-secret');
      const reg = JSON.parse(text) as { manifest: string; entries: { id: string; status: string }[] };
      expect(reg.manifest).toBe('loaded');
      expect(reg.entries.map((e) => [e.id, e.status])).toEqual([['mcp:project-mcp.docs', 'ready'], ['webhook_out:ci', 'needs-credentials']]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Studio Code', () => {
  it('browses inside the project only, lists worktrees with diffs', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'furypipe-studio-code-'));
    try {
      const repo = join(root, 'repo');
      mkdirSync(join(repo, 'src'), { recursive: true });
      const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
      const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env, encoding: 'utf8' });
      git(repo, 'init', '-q', '-b', 'main');
      git(repo, 'config', 'core.autocrlf', 'false');
      writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'base');
      git(repo, 'worktree', 'add', '-q', '-b', 'fury/r1/impl', join(root, 'wt'));
      writeFileSync(join(root, 'wt', 'src', 'a.ts'), 'export const a = 2;\n');
      if (process.platform !== 'win32') symlinkSync('/etc', join(repo, 'etc-link'));
      const studio = createStudioApi({ projectRoot: repo, discoverHarnesses: async () => harnesses, discoverLocal: async () => ({ backends: [] }) });
      const tree = await (await studio.handle('code-tree', post({ path: '' }))).json() as { entries: { name: string; kind: string }[] };
      expect(tree.entries.map((e) => e.name)).toContain('src');
      expect(tree.entries.map((e) => e.name)).not.toContain('.git');
      expect(await (await studio.handle('code-file', post({ path: 'src/a.ts' }))).json()).toMatchObject({ content: 'export const a = 1;\n' });
      expect((await studio.handle('code-file', post({ path: '../x' }))).status).toBe(404);
      expect((await studio.handle('code-file', post({ path: '/etc/passwd' }))).status).toBe(400);
      if (process.platform !== 'win32') expect((await studio.handle('code-tree', post({ path: 'etc-link' }))).status).toBe(403);
      const wts = await (await studio.handle('code-worktrees', new Request('http://127.0.0.1/'))).json() as { worktrees: { path: string; branch?: string; changedFiles: number }[] };
      const wt = wts.worktrees.find((w) => w.branch === 'fury/r1/impl')!;
      expect(wt.changedFiles).toBe(1);
      const diff = await (await studio.handle('code-diff', post({ worktree: wt.path }))).json() as { files: { file: string; added: number; removed: number }[]; patch: string };
      expect(diff.files).toEqual([{ file: 'src/a.ts', added: 1, removed: 1 }]);
      expect(diff.patch).toContain('+export const a = 2;');
      expect((await studio.handle('code-diff', post({ worktree: '/tmp' }))).status).toBe(404);
      expect((await studio.handle('code-diff', post({ worktree: wt.path, base: 'HEAD; rm -rf /' }))).status).toBe(400);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
