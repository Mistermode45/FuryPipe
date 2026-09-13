import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  JSONRPCMessage,
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { createControlRoomRuntime } from '../src/control-room/runtime.js';
import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  getProductionMcpStdioRuntimeEvidence,
  runModernMcpStdio,
} from '../src/mcp-modern.js';

const SHA = 'a'.repeat(40);
const roots: string[] = [];

class TestStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];
  readonly sent: JSONRPCMessage[] = [];
  started = false;
  closed = false;

  async start(): Promise<void> {
    if (this.started) throw new Error('test transport already started');
    this.started = true;
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this.closed) throw new Error('test transport is closed');
    this.sent.push(message);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  receive(message: JSONRPCMessage): void {
    if (!this.started || this.closed) throw new Error('test transport is not active');
    this.onmessage?.(message);
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for MCP stdio observation');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('MCP stdio runtime observability', () => {
  it('promotes Control Room stdio evidence only after an authentic request-response exchange', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-stdio-observe-'));
    roots.push(root);
    const transport = new TestStdioTransport();
    const handle = runModernMcpStdio(
      createRecoveryStore(root, { namespace: 'stdio-observe' }),
      { transport },
    );
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 1 });
    runtime.observeMcpStdioHandle(handle);
    runtime.observeMcpStdioHandle(handle);

    expect(getProductionMcpStdioRuntimeEvidence(handle)).toEqual({
      format: 'furypipe-mcp-stdio-runtime-evidence/v1',
      inboundMessages: 0,
      inboundRequests: 0,
      outboundMessages: 0,
      completedExchanges: 0,
      trackingOverflows: 0,
    });
    expect(runtime.snapshot().sections.mcp.evidence.stdio).toBe('PARTIAL');
    expect(runtime.snapshot().sections.mcp.warnings.join(' ')).toMatch(/no client exchange/i);

    const secret = 'PRIVATE_STDIO_REQUEST_PAYLOAD';
    transport.receive({
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: {
        name: 'index_text',
        arguments: { text: secret },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    } as JSONRPCMessage);

    await waitFor(() => (getProductionMcpStdioRuntimeEvidence(handle)?.completedExchanges ?? 0) === 1);

    const evidence = getProductionMcpStdioRuntimeEvidence(handle);
    expect(evidence).toEqual({
      format: 'furypipe-mcp-stdio-runtime-evidence/v1',
      inboundMessages: 1,
      inboundRequests: 1,
      outboundMessages: 1,
      completedExchanges: 1,
      trackingOverflows: 0,
    });
    expect(transport.sent).toHaveLength(1);
    expect((transport.sent[0] as { id?: unknown }).id).toBe(17);

    const snapshot = runtime.snapshot();
    expect(snapshot.sections.mcp.evidence.stdio).toBe('VERIFIED');
    expect(snapshot.sections.mcp.evidence.externalConformance).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.mcp.status).toBe('PARTIAL');
    expect(JSON.stringify(evidence)).not.toContain(secret);
    expect(JSON.stringify(evidence)).not.toContain('index_text');
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    expect(JSON.stringify(snapshot)).not.toContain('index_text');

    expect(getProductionMcpStdioRuntimeEvidence({ ...handle })).toBeUndefined();
    await handle.close();
  });

  it('keeps Control Room partial when request correlation becomes ambiguous', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-stdio-ambiguous-'));
    roots.push(root);
    const transport = new TestStdioTransport();
    const handle = runModernMcpStdio(
      createRecoveryStore(root, { namespace: 'stdio-ambiguous' }),
      { transport },
    );
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 1 });
    runtime.observeMcpStdioHandle(handle);

    const request = {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    } as JSONRPCMessage;
    transport.receive(request);
    transport.receive(request);

    await waitFor(() => transport.sent.length >= 2);
    const evidence = getProductionMcpStdioRuntimeEvidence(handle);
    expect(evidence?.trackingOverflows).toBeGreaterThan(0);
    expect(evidence?.completedExchanges).toBe(1);
    expect(runtime.snapshot().sections.mcp.evidence.stdio).toBe('PARTIAL');
    await handle.close();
  });

  it('observes a real child-process stdin/stdout exchange without contaminating the JSON-RPC wire', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-stdio-child-'));
    roots.push(root);
    const worker = fileURLToPath(new URL('./fixtures/mcp-stdio-observability-worker.ts', import.meta.url));
    const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const child = spawn(process.execPath, [tsx, worker, root, 'stdio-child'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });

    const secret = 'PRIVATE_CHILD_STDIO_PAYLOAD';
    const request = {
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'index_text',
        arguments: { text: secret },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    };
    child.stdin.write(`${JSON.stringify(request)}\n`);

    let killedForTimeout = false;
    const timeout = setTimeout(() => {
      killedForTimeout = true;
      child.kill();
    }, 20_000);
    const [exitCode] = await once(child, 'close') as [number | null, string];
    clearTimeout(timeout);

    expect(killedForTimeout).toBe(false);
    expect(exitCode).toBe(0);

    const wireLines = stdout.trim().split(/\r?\n/u).filter(Boolean);
    expect(wireLines.length).toBeGreaterThanOrEqual(1);
    const wireMessages = wireLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(wireMessages.some((message) => message.id === 41 && 'result' in message)).toBe(true);

    const marker = stderr
      .split(/\r?\n/u)
      .find((line) => line.startsWith('FURYPIPE_STDIO_EVIDENCE '));
    expect(marker).toBeDefined();
    const evidence = JSON.parse(marker!.slice('FURYPIPE_STDIO_EVIDENCE '.length)) as Record<string, unknown>;
    expect(evidence).toMatchObject({
      format: 'furypipe-mcp-stdio-runtime-evidence/v1',
      inboundMessages: 1,
      inboundRequests: 1,
      outboundMessages: 1,
      completedExchanges: 1,
      trackingOverflows: 0,
    });

    expect(stdout).not.toContain('FURYPIPE_STDIO_EVIDENCE');
    expect(stderr).not.toContain(secret);
    expect(stderr).not.toContain('index_text');
  }, 30_000);
});
