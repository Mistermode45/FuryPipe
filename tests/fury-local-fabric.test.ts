import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FuryLocalFabricError,
  assertFuryLocalEndpoint,
  classifyFuryModelFit,
  discoverFuryHardware,
  discoverFuryLocalBackends,
  measureFuryLocalModel,
  type FuryHardwareProfile,
} from '../src/fury-local-fabric.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const GiB = 1024 ** 3;
const hw = (overrides: Partial<FuryHardwareProfile> = {}): FuryHardwareProfile => ({
  platform: 'linux', arch: 'x64', cpuModel: 'test', cpuCount: 8, totalMemoryBytes: 32 * GiB, freeMemoryBytes: 16 * GiB,
  unifiedMemory: false, gpus: [{ name: 'GPU', memoryBytes: 12 * GiB }], ...overrides,
});

describe('FuryLocal fabric discovery', () => {
  it('reads Ollama models, version and advertises Anthropic-compatible messages from 0.14', async () => {
    const baseUrl = await serve((req, res) => {
      if (req.url === '/api/tags') json(res, { models: [{ name: 'qwen2.5-coder:7b', size: 4_700_000_000, details: { parameter_size: '7.6B', quantization_level: 'Q4_K_M' } }] });
      else if (req.url === '/api/version') json(res, { version: '0.14.2' });
      else json(res, {}, 404);
    });
    const { backends } = await discoverFuryLocalBackends({ endpoints: [{ kind: 'ollama', baseUrl }] });
    expect(backends[0]).toMatchObject({ kind: 'ollama', reachable: true, version: '0.14.2' });
    expect(backends[0]?.protocols).toEqual(['native', 'openai-chat', 'anthropic-messages']);
    expect(backends[0]?.models[0]).toMatchObject({ id: 'qwen2.5-coder:7b', sizeBytes: 4_700_000_000, parameterSize: '7.6B', quantization: 'Q4_K_M' });
  });

  it('does not claim Anthropic compatibility for older Ollama', async () => {
    const baseUrl = await serve((req, res) => {
      if (req.url === '/api/tags') json(res, { models: [] });
      else json(res, { version: '0.13.9' });
    });
    const { backends } = await discoverFuryLocalBackends({ endpoints: [{ kind: 'ollama', baseUrl }] });
    expect(backends[0]?.protocols).not.toContain('anthropic-messages');
  });

  it('reads LM Studio native metadata and falls back to /v1/models for vLLM', async () => {
    const lm = await serve((req, res) => {
      if (req.url === '/api/v0/models') json(res, { data: [{ id: 'gemma-3-12b', type: 'vlm', state: 'loaded', max_context_length: 131072, quantization: 'Q4_K_M' }] });
      else json(res, {}, 404);
    });
    const vllm = await serve((req, res) => {
      if (req.url === '/v1/models') json(res, { data: [{ id: 'Qwen/Qwen3-32B', max_model_len: 32768 }] });
      else json(res, {}, 404);
    });
    const { backends } = await discoverFuryLocalBackends({ endpoints: [{ kind: 'lmstudio', baseUrl: lm }, { kind: 'vllm', baseUrl: vllm }] });
    expect(backends[0]?.models[0]).toMatchObject({ id: 'gemma-3-12b', modality: 'vision', loaded: true, contextLength: 131072 });
    expect(backends[1]).toMatchObject({ reachable: true, protocols: ['openai-chat'] });
    expect(backends[1]?.models[0]).toMatchObject({ id: 'Qwen/Qwen3-32B', contextLength: 32768 });
  });

  it('reports unreachable backends and never follows redirects', async () => {
    const redirecting = await serve((_req, res) => {
      res.writeHead(302, { location: 'http://example.com/v1/models' });
      res.end();
    });
    const closed = await serve(() => undefined);
    const closedUrl = closed;
    await new Promise((r) => servers.pop()!.close(r));
    const { backends } = await discoverFuryLocalBackends({ endpoints: [{ kind: 'vllm', baseUrl: redirecting }, { kind: 'jan', baseUrl: closedUrl }], timeoutMs: 500 });
    expect(backends[0]).toMatchObject({ reachable: false, error: 'HTTP 302' });
    expect(backends[1]).toMatchObject({ reachable: false });
  });

  it('rejects oversized discovery bodies', async () => {
    const big = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(`{"data":[${'{"id":"x"},'.repeat(200_000)}{"id":"y"}]}`);
    });
    const { backends } = await discoverFuryLocalBackends({ endpoints: [{ kind: 'vllm', baseUrl: big }] });
    expect(backends[0]).toMatchObject({ reachable: false, error: 'response exceeds the discovery byte bound' });
  });

  it('only probes loopback unless LAN is allowed, and only private IP literals', () => {
    expect(assertFuryLocalEndpoint('http://127.0.0.1:11434').hostname).toBe('127.0.0.1');
    expect(assertFuryLocalEndpoint('http://[::1]:1234').hostname).toBe('[::1]');
    for (const bad of ['http://192.168.1.10:8000', 'http://example.com', 'file:///etc/passwd', 'http://user:pw@127.0.0.1:1', 'http://127.0.0.1:1/?x=1', 'not a url']) {
      expect(() => assertFuryLocalEndpoint(bad)).toThrow(FuryLocalFabricError);
    }
    expect(assertFuryLocalEndpoint('http://192.168.1.10:8000', { allowLan: true }).hostname).toBe('192.168.1.10');
    for (const bad of ['http://8.8.8.8:80', 'http://gpu-box.local:8000', 'http://169.254.169.254/']) {
      expect(() => assertFuryLocalEndpoint(bad, { allowLan: true })).toThrow(FuryLocalFabricError);
    }
  });
});

describe('FuryLocal hardware and fit', () => {
  it('classifies fit against VRAM, unified memory and RAM without guessing unknown sizes', () => {
    expect(classifyFuryModelFit({ sizeBytes: 5 * GiB }, hw())).toBe('FITS');
    expect(classifyFuryModelFit({ sizeBytes: 20 * GiB }, hw())).toBe('MAY_BE_SLOW');
    expect(classifyFuryModelFit({ sizeBytes: 60 * GiB }, hw())).toBe('DOES_NOT_FIT');
    expect(classifyFuryModelFit({ sizeBytes: 20 * GiB }, hw({ gpus: [], unifiedMemory: true, totalMemoryBytes: 64 * GiB }))).toBe('FITS');
    expect(classifyFuryModelFit({}, hw())).toBe('UNKNOWN');
  });

  it('parses nvidia-smi output and keeps working without it', async () => {
    const withGpu = await discoverFuryHardware({ gpuQuery: async () => 'NVIDIA RTX 4090, 24564, 560.35\n' });
    expect(withGpu.gpus[0]).toMatchObject({ name: 'NVIDIA RTX 4090', memoryBytes: 24564 * 1024 * 1024, driver: '560.35' });
    const without = await discoverFuryHardware({ gpuQuery: async () => { throw new Error('ENOENT'); } });
    expect(without.gpus).toEqual([]);
    expect(without.totalMemoryBytes).toBeGreaterThan(0);
  });
});

describe('FuryLocal measurement', () => {
  it('measures TTFT and streamed chunks per second from an OpenAI-compatible stream', async () => {
    const baseUrl = await serve((req, res) => {
      expect(req.method).toBe('POST');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const word of ['1', ' 2', ' 3']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
    let t = 0;
    const result = await measureFuryLocalModel({ backend: 'ollama', baseUrl, model: 'm', now: () => (t += 100) });
    expect(result.outputChunks).toBe(3);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.chunksPerSecond).toBeGreaterThan(0);
  });

  it('refuses non-local targets and empty streams', async () => {
    await expect(measureFuryLocalModel({ backend: 'openai-compatible', baseUrl: 'https://api.example.com', model: 'm' })).rejects.toThrow(FuryLocalFabricError);
    const empty = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: [DONE]\n\n');
    });
    await expect(measureFuryLocalModel({ backend: 'vllm', baseUrl: empty, model: 'm' })).rejects.toThrow(/no streamed content/u);
  });
});
