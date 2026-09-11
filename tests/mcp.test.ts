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
      'index_text', 'index_bytes', 'fetch_text', 'fetch_exact', 'fetch_bytes',
      'fetch_bytes_base64', 'fetch_range', 'fetch_lines', 'manifest', 'delete_handle', 'verify_handle',
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

  it('indexes and retrieves arbitrary bytes through the required exact tools', async () => {
    const mcp = await service();
    const bytes = Uint8Array.from([0, 255, 10, 13, 42]);
    const indexed = await mcp.handle({
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'index_bytes', arguments: { base64: Buffer.from(bytes).toString('base64') } },
    });
    const handle = JSON.parse(((indexed?.result as { content: [{ text: string }] }).content[0]?.text ?? '{}')).handle;
    const encoded = await mcp.handle({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'fetch_bytes_base64', arguments: { handle: handle.format + '/' + handle.algorithm + '/' + handle.digest } } });
    expect((encoded?.result as { content: [{ text: string }] }).content[0]?.text).toBe(Buffer.from(bytes).toString('base64'));
    const legacy = await mcp.handle({ jsonrpc: '2.0', id: 111, method: 'tools/call', params: { name: 'fetch_exact', arguments: { handle: handle.format + '/' + handle.algorithm + '/' + handle.digest } } });
    expect((legacy?.result as { content: [{ text: string }] }).content[0]?.text).toBe(Buffer.from(bytes).toString('base64'));
    const ranged = await mcp.handle({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'fetch_range', arguments: { handle: handle.format + '/' + handle.algorithm + '/' + handle.digest, start: 1, end_exclusive: 4 } } });
    expect(JSON.parse((ranged?.result as { content: [{ text: string }] }).content[0]?.text ?? '{}').base64).toBe(Buffer.from(bytes.slice(1, 4)).toString('base64'));
    const manifest = await mcp.handle({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'manifest', arguments: { handle: handle.format + '/' + handle.algorithm + '/' + handle.digest } } });
    expect((manifest?.result as { content: [{ text: string }] }).content[0]?.text).toContain('"bytes":5');
    const deleted = await mcp.handle({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'delete_handle', arguments: { handle: handle.format + '/' + handle.algorithm + '/' + handle.digest } } });
    expect((deleted?.result as { content: [{ text: string }] }).content[0]?.text).toBe('{"deleted":true}');
  });

  it('rejects invalid requests, unknown tools and oversized text', async () => {
    const mcp = await service();
    expect((await mcp.handle({ jsonrpc: '2.0', method: 'ping' }))?.error?.code).toBe(-32600);
    expect((await mcp.handle({ jsonrpc: '2.0', id: null, method: 'ping' }))?.error?.code).toBe(-32600);
    expect((await mcp.handle({ jsonrpc: '2.0', id: 1.5, method: 'ping' }))?.error?.code).toBe(-32600);
    expect((await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'unknown', arguments: {} } }))?.error?.code).toBe(-32602);
    expect((await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'index_text', arguments: { text: 'x'.repeat(1024 * 1024 + 1) } } }))?.error?.code).toBe(-32602);
    expect(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });
});
