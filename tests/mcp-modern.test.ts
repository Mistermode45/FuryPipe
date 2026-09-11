import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createModernMcpHandler } from '../src/mcp-modern.js';
import { createRecoveryStore } from '../src/core/recovery-store.js';

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};

const roots: string[] = [];

async function request(handler: ReturnType<typeof createModernMcpHandler>, id: number, method: string, params: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': method,
  };
  if (typeof params.name === 'string') headers['mcp-name'] = params.name;
  const response = await handler.fetch(new Request('https://localhost/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: modernMeta } }),
  }));
  const body = await response.text();
  if (response.status !== 200) throw new Error(`MCP response ${response.status}: ${body}`);
  return JSON.parse(body) as Record<string, any>;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('modern MCP SDK adapter', () => {
  it('serves discovery and the recovery tools on the 2026 protocol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-modern-'));
    roots.push(root);
    const handler = createModernMcpHandler(createRecoveryStore(root));

    const discovery = await request(handler, 1, 'server/discover');
    expect(discovery.result).toMatchObject({ supportedVersions: expect.arrayContaining(['2026-07-28']) });

    const listed = await request(handler, 2, 'tools/list');
    expect((listed.result as { tools: Array<{ name: string }> }).tools).toHaveLength(11);
    expect((listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toContain('fetch_exact');

    const indexed = await request(handler, 3, 'tools/call', { name: 'index_text', arguments: { text: 'modern-proof' } });
    const handleObject = JSON.parse((indexed.result as { content: [{ text: string }] }).content[0].text).handle as { format: string; algorithm: string; digest: string };
    const handle = `${handleObject.format}/${handleObject.algorithm}/${handleObject.digest}`;
    const fetched = await request(handler, 4, 'tools/call', { name: 'fetch_exact', arguments: { handle } });
    expect((fetched.result as { content: [{ text: string }] }).content[0].text).toBe(Buffer.from('modern-proof').toString('base64'));

    await handler.close();
  });

  it('rejects a modern request without its required envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-modern-invalid-'));
    roots.push(root);
    const handler = createModernMcpHandler(createRecoveryStore(root));
    const response = await handler.fetch(new Request('https://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }));
    const responseText = await response.text();
    expect(response.status).toBe(400);
    const body = JSON.parse(responseText) as { error?: { code: number; message: string } };
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toContain('required per-request envelope');
    await handler.close();
  });
});
