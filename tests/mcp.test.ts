import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecoveryStore } from '../src/core/recovery-store.js';
import { createMcpService } from '../src/mcp.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function service() {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-'));
  roots.push(root);
  return createMcpService(createRecoveryStore(root, { namespace: 'test' }));
}

describe('MCP stdio contract', () => {
  it('exposes bounded tools and supports index/fetch/verify', async () => {
    const mcp = await service();
    const listed = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect((listed?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual([
      'index_text', 'fetch_exact', 'fetch_lines', 'verify_handle',
    ]);
    const initialized = await mcp.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
    expect((initialized?.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
    const indexed = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'index_text', arguments: { text: 'alpha\nbeta', metadata: { source: 'test' } } } });
    const handle = JSON.parse(((indexed?.result as { content: [{ text: string }] }).content[0]?.text ?? '{}')).handle;
    expect(handle.algorithm).toBe('sha256');
    const fetched = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fetch_lines', arguments: { handle: handle.format + '/' + handle.algorithm + '/' + handle.digest, from_line: 2 } } });
    expect((fetched?.result as { content: [{ text: string }] }).content[0]?.text).toBe('beta');
    const verified = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'verify_handle', arguments: { handle: handle.format + '/' + handle.algorithm + '/' + handle.digest } } });
    expect((verified?.result as { content: [{ text: string }] }).content[0]?.text).toContain('"ok":true');
  });

  it('rejects invalid requests, unknown tools and oversized text', async () => {
    const mcp = await service();
    expect((await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'unknown', arguments: {} } }))?.error?.code).toBe(-32602);
    expect((await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'index_text', arguments: { text: 'x'.repeat(1024 * 1024 + 1) } } }))?.error?.code).toBe(-32602);
    expect(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });
});
