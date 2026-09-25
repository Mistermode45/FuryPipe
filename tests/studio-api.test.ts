import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { FuryHarnessDiscovery } from '../src/fury-harness-hub.js';
import { FURY_HARNESS_REGISTRY } from '../src/fury-harness-hub.js';
import type { FuryLocalBackendStatus } from '../src/fury-local-fabric.js';
import { createStudioApi, studioApiRoute, studioBindings } from '../src/studio/studio-api.js';
import { renderStudioHtml, STUDIO_EXAMPLE_IR } from '../src/studio/studio-page.js';

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
  });
});
