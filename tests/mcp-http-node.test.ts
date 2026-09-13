import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecoveryStore } from '../src/core/recovery-store.js';
import { listenMcpHttpNode, type NodeMcpHttpServer } from '../src/mcp-http-node.js';
import { getProductionMcpRuntimeEvidence } from '../src/mcp-modern.js';

const roots: string[] = [];
const listeners: NodeMcpHttpServer[] = [];

afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function listener(): Promise<{ value: NodeMcpHttpServer; url: string }> {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-http-node-'));
  roots.push(root);
  const value = await listenMcpHttpNode(createRecoveryStore(root), {
    host: '127.0.0.1',
    port: 0,
    allowedHostnames: ['127.0.0.1', 'localhost'],
    allowUnauthenticatedLoopback: true,
  });
  listeners.push(value);
  const address = value.address() as AddressInfo;
  return { value, url: `http://127.0.0.1:${address.port}/mcp` };
}

const modernBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  },
});

describe('Node MCP HTTP listener', () => {
  it('refuses an unauthenticated listener bound to a non-loopback interface', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-http-node-bind-'));
    roots.push(root);
    await expect(listenMcpHttpNode(createRecoveryStore(root), {
      host: '0.0.0.0',
      port: 0,
      allowedHostnames: ['localhost'],
      allowUnauthenticatedLoopback: true,
    })).rejects.toThrow('loopback interface');
  });

  it('serves a real local HTTP request through the secured handler', async () => {
    const { value, url } = await listener();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body: modernBody,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const payload = await response.json() as { result: { tools: unknown[] } };
    expect(payload.result.tools).toHaveLength(11);
    expect(getProductionMcpRuntimeEvidence(value.handler)).toMatchObject({
      requests: 1,
      dispatchedRequests: 1,
      bearerAuthConfigured: false,
      bearerAuthSuccesses: 0,
    });
  });

  it('keeps the listener path isolated and rejects unsupported methods', async () => {
    const { url } = await listener();
    const root = new URL(url);
    const missing = await fetch(`${root.origin}/other`, { method: 'GET' });
    expect(missing.status).toBe(404);
    const method = await fetch(url, { method: 'GET' });
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST, OPTIONS');
  });
});
