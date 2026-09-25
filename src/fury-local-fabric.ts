// FuryLocal Lab — local inference discovery, hardware fit and measurement.
//
// Probes well-known local inference servers (Ollama, LM Studio, llama.cpp,
// vLLM, SGLang, LocalAI, Jan) and explicitly configured OpenAI/Anthropic
// compatible endpoints. Safety boundary:
//   - by default only loopback targets are probed;
//   - LAN targets must be explicitly configured private IP literals (no DNS
//     names, so no DNS-rebinding to a public host);
//   - GET only for discovery, redirects are never followed, every response
//     is size- and time-bounded;
//   - hardware facts never leave the process.
import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import os from 'node:os';

export const FURY_LOCAL_DISCOVERY_FORMAT = 'furypipe-local-discovery/v1' as const;

export type FuryLocalBackendKind = 'ollama' | 'lmstudio' | 'llamacpp' | 'vllm' | 'sglang' | 'localai' | 'jan' | 'openai-compatible' | 'anthropic-compatible';
export type FuryLocalProtocol = 'openai-chat' | 'anthropic-messages' | 'native';
export type FuryModelFit = 'FITS' | 'MAY_BE_SLOW' | 'DOES_NOT_FIT' | 'UNKNOWN';

export interface FuryLocalEndpoint {
  readonly kind: FuryLocalBackendKind;
  readonly baseUrl: string;
}

export interface FuryLocalModel {
  readonly backend: FuryLocalBackendKind;
  readonly baseUrl: string;
  readonly id: string;
  readonly sizeBytes?: number;
  readonly parameterSize?: string;
  readonly quantization?: string;
  readonly contextLength?: number;
  readonly modality?: 'text' | 'vision' | 'embeddings';
  readonly loaded?: boolean;
}

export interface FuryLocalBackendStatus {
  readonly kind: FuryLocalBackendKind;
  readonly baseUrl: string;
  readonly reachable: boolean;
  readonly version?: string;
  readonly protocols: readonly FuryLocalProtocol[];
  readonly models: readonly FuryLocalModel[];
  readonly error?: string;
}

export interface FuryHardwareProfile {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
  readonly freeMemoryBytes: number;
  readonly unifiedMemory: boolean;
  readonly gpus: readonly { readonly name: string; readonly memoryBytes: number; readonly driver?: string }[];
}

export class FuryLocalFabricError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryLocalFabricError';
  }
}

export const FURY_LOCAL_DEFAULT_ENDPOINTS: readonly FuryLocalEndpoint[] = Object.freeze([
  { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
  { kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234' },
  { kind: 'llamacpp', baseUrl: 'http://127.0.0.1:8080' },
  { kind: 'vllm', baseUrl: 'http://127.0.0.1:8000' },
  { kind: 'sglang', baseUrl: 'http://127.0.0.1:30000' },
  { kind: 'jan', baseUrl: 'http://127.0.0.1:1337' },
].map((e) => Object.freeze(e as FuryLocalEndpoint)));

const MAX_BODY = 1024 * 1024;

function privateIpv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number) as [number, number];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Validate an inference endpoint URL. Loopback always; LAN only when allowLan and an IP literal. */
export function assertFuryLocalEndpoint(baseUrl: string, options: { readonly allowLan?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new FuryLocalFabricError('endpoint is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FuryLocalFabricError('endpoint must be http(s)');
  if (url.username || url.password) throw new FuryLocalFabricError('endpoint must not embed credentials');
  if (url.search || url.hash) throw new FuryLocalFabricError('endpoint must not carry a query or fragment');
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  const loopback = host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
  if (loopback) return url;
  if (!options.allowLan) throw new FuryLocalFabricError('only loopback endpoints are probed unless LAN is explicitly allowed');
  if (isIP(host) === 4 && privateIpv4(host)) return url;
  if (isIP(host) === 6 && /^(fc|fd|fe8|fe9|fea|feb)/iu.test(host)) return url;
  throw new FuryLocalFabricError('LAN endpoints must be private IP literals');
}

async function boundedJson(url: URL, path: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const target = new URL(path.replace(/^\//u, ''), url.href.endsWith('/') ? url.href : `${url.href}/`);
  const response = await fetch(target, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return { status: response.status, body: undefined };
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY) {
        await reader.cancel();
        throw new FuryLocalFabricError('response exceeds the discovery byte bound');
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
}

function str(value: unknown, max = 256): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function openAiModels(kind: FuryLocalBackendKind, baseUrl: string, body: unknown): FuryLocalModel[] {
  const data = (body as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(data)) return [];
  return data.slice(0, 512).flatMap((entry) => {
    const id = str((entry as { id?: unknown }).id);
    if (!id) return [];
    const ctx = num((entry as { max_model_len?: unknown }).max_model_len) ?? num((entry as { context_length?: unknown }).context_length);
    return [{ backend: kind, baseUrl, id, ...(ctx ? { contextLength: ctx } : {}) }];
  });
}

async function probeBackend(endpoint: FuryLocalEndpoint, options: { timeoutMs: number; allowLan: boolean }): Promise<FuryLocalBackendStatus> {
  const url = assertFuryLocalEndpoint(endpoint.baseUrl, { allowLan: options.allowLan });
  const baseUrl = url.href.replace(/\/$/u, '');
  const unreachable = (error: string): FuryLocalBackendStatus => Object.freeze({ kind: endpoint.kind, baseUrl, reachable: false, protocols: [], models: [], error });
  try {
    if (endpoint.kind === 'ollama') {
      const tags = await boundedJson(url, '/api/tags', options.timeoutMs);
      if (tags.status !== 200) return unreachable(`HTTP ${tags.status}`);
      const versionResponse = await boundedJson(url, '/api/version', options.timeoutMs).catch(() => undefined);
      const version = str((versionResponse?.body as { version?: unknown } | undefined)?.version, 64);
      const models = ((tags.body as { models?: unknown })?.models);
      const list = Array.isArray(models) ? models.slice(0, 512).flatMap((m) => {
        const id = str((m as { name?: unknown }).name) ?? str((m as { model?: unknown }).model);
        if (!id) return [];
        const details = (m as { details?: Record<string, unknown> }).details ?? {};
        return [Object.freeze({
          backend: 'ollama' as const, baseUrl, id,
          ...(num((m as { size?: unknown }).size) !== undefined ? { sizeBytes: num((m as { size?: unknown }).size)! } : {}),
          ...(str(details.parameter_size, 32) ? { parameterSize: str(details.parameter_size, 32)! } : {}),
          ...(str(details.quantization_level, 32) ? { quantization: str(details.quantization_level, 32)! } : {}),
        })];
      }) : [];
      // Anthropic-compatible Messages API shipped in Ollama 0.14.0.
      const protocols: FuryLocalProtocol[] = ['native', 'openai-chat'];
      if (version && versionAtLeast(version, [0, 14, 0])) protocols.push('anthropic-messages');
      return Object.freeze({ kind: 'ollama', baseUrl, reachable: true, ...(version ? { version } : {}), protocols: Object.freeze(protocols), models: Object.freeze(list) });
    }
    if (endpoint.kind === 'lmstudio') {
      const native = await boundedJson(url, '/api/v0/models', options.timeoutMs);
      if (native.status === 200 && Array.isArray((native.body as { data?: unknown })?.data)) {
        const list = ((native.body as { data: unknown[] }).data).slice(0, 512).flatMap((m) => {
          const rec = m as Record<string, unknown>;
          const id = str(rec.id);
          if (!id) return [];
          const type = rec.type === 'vlm' ? 'vision' : rec.type === 'embeddings' ? 'embeddings' : 'text';
          return [Object.freeze({
            backend: 'lmstudio' as const, baseUrl, id, modality: type as FuryLocalModel['modality'],
            ...(num(rec.max_context_length) ? { contextLength: num(rec.max_context_length)! } : {}),
            ...(str(rec.quantization, 32) ? { quantization: str(rec.quantization, 32)! } : {}),
            loaded: rec.state === 'loaded',
          })];
        });
        return Object.freeze({ kind: 'lmstudio', baseUrl, reachable: true, protocols: Object.freeze(['native', 'openai-chat', 'anthropic-messages'] as FuryLocalProtocol[]), models: Object.freeze(list) });
      }
    }
    const models = await boundedJson(url, '/v1/models', options.timeoutMs);
    if (models.status !== 200) return unreachable(`HTTP ${models.status}`);
    const protocols: FuryLocalProtocol[] = endpoint.kind === 'anthropic-compatible' ? ['anthropic-messages'] : ['openai-chat'];
    return Object.freeze({ kind: endpoint.kind, baseUrl, reachable: true, protocols: Object.freeze(protocols), models: Object.freeze(openAiModels(endpoint.kind, baseUrl, models.body)) });
  } catch (error) {
    if (error instanceof FuryLocalFabricError) return unreachable(error.message);
    const name = (error as { name?: string }).name;
    return unreachable(name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
}

function versionAtLeast(version: string, min: readonly [number, number, number]): boolean {
  const parts = version.split(/[.+-]/u).slice(0, 3).map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < 3; i += 1) {
    const v = Number.isFinite(parts[i]) ? parts[i]! : 0;
    if (v !== min[i]) return v > min[i]!;
  }
  return true;
}

export async function discoverFuryLocalBackends(options: {
  readonly endpoints?: readonly FuryLocalEndpoint[];
  readonly allowLan?: boolean;
  readonly timeoutMs?: number;
} = {}): Promise<{ readonly format: typeof FURY_LOCAL_DISCOVERY_FORMAT; readonly backends: readonly FuryLocalBackendStatus[] }> {
  const endpoints = options.endpoints ?? FURY_LOCAL_DEFAULT_ENDPOINTS;
  if (endpoints.length > 64) throw new FuryLocalFabricError('too many endpoints');
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 1_500, 50), 15_000);
  const backends = await Promise.all(endpoints.map((endpoint) => probeBackend(endpoint, { timeoutMs, allowLan: options.allowLan ?? false })
    .catch((error: unknown) => Object.freeze({ kind: endpoint.kind, baseUrl: endpoint.baseUrl, reachable: false, protocols: [], models: [], error: error instanceof Error ? error.message : 'invalid endpoint' }))));
  return Object.freeze({ format: FURY_LOCAL_DISCOVERY_FORMAT, backends: Object.freeze(backends) });
}

export type FuryGpuQuery = () => Promise<string>;

const defaultGpuQuery: FuryGpuQuery = () => new Promise((resolve, reject) => {
  execFile('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], {
    timeout: 3_000, maxBuffer: 16 * 1024, shell: false, windowsHide: true, encoding: 'utf8',
  }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
});

/** Local-only hardware profile. Nothing here is transmitted anywhere. */
export async function discoverFuryHardware(options: { readonly gpuQuery?: FuryGpuQuery } = {}): Promise<FuryHardwareProfile> {
  const cpus = os.cpus();
  const gpus: { name: string; memoryBytes: number; driver?: string }[] = [];
  try {
    const out = await (options.gpuQuery ?? defaultGpuQuery)();
    for (const line of out.split(/\r?\n/u).slice(0, 16)) {
      const [name, mem, driver] = line.split(',').map((s) => s.trim());
      const mib = Number(mem);
      if (name && Number.isFinite(mib) && mib > 0) gpus.push({ name: name.slice(0, 128), memoryBytes: mib * 1024 * 1024, ...(driver ? { driver: driver.slice(0, 64) } : {}) });
    }
  } catch {
    // No NVIDIA tooling: not an error, just no discrete GPU facts.
  }
  return Object.freeze({
    platform: process.platform,
    arch: process.arch,
    cpuModel: (cpus[0]?.model ?? 'unknown').slice(0, 128),
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    unifiedMemory: process.platform === 'darwin' && process.arch === 'arm64',
    gpus: Object.freeze(gpus),
  });
}

/**
 * Heuristic fit. Weights need ~their file size plus ~20% for KV cache and
 * runtime buffers at modest context. FITS = inside 80% of the fastest memory
 * pool (largest GPU VRAM, or unified memory on Apple silicon); MAY_BE_SLOW =
 * only fits with CPU/RAM offload inside 90% of system RAM; otherwise
 * DOES_NOT_FIT. Unknown size → UNKNOWN (never guessed).
 */
export function classifyFuryModelFit(model: Pick<FuryLocalModel, 'sizeBytes'>, hardware: FuryHardwareProfile): FuryModelFit {
  if (model.sizeBytes === undefined || model.sizeBytes <= 0) return 'UNKNOWN';
  const needed = model.sizeBytes * 1.2;
  const vram = Math.max(0, ...hardware.gpus.map((g) => g.memoryBytes));
  const fast = hardware.unifiedMemory ? hardware.totalMemoryBytes * 0.75 : vram;
  if (fast > 0 && needed <= fast * 0.8) return 'FITS';
  if (needed <= (hardware.totalMemoryBytes + vram) * 0.9) return 'MAY_BE_SLOW';
  return 'DOES_NOT_FIT';
}

export interface FuryLocalMeasurement {
  readonly backend: FuryLocalBackendKind;
  readonly model: string;
  readonly ttftMs: number;
  readonly totalMs: number;
  readonly outputChunks: number;
  readonly chunksPerSecond: number;
}

/**
 * Stream one short OpenAI-compatible chat completion and time it. Loopback /
 * explicit-LAN only; this never targets a cloud provider and costs nothing.
 * Chunks are streamed deltas, reported as-is rather than as exact tokens.
 */
export async function measureFuryLocalModel(options: {
  readonly backend: FuryLocalBackendKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly prompt?: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly allowLan?: boolean;
  readonly now?: () => number;
}): Promise<FuryLocalMeasurement> {
  const url = assertFuryLocalEndpoint(options.baseUrl, { allowLan: options.allowLan ?? false });
  const now = options.now ?? (() => performance.now());
  const target = new URL('v1/chat/completions', url.href.endsWith('/') ? url.href : `${url.href}/`);
  const started = now();
  const response = await fetch(target, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(Math.min(Math.max(options.timeoutMs ?? 60_000, 1_000), 600_000)),
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ model: options.model, stream: true, max_tokens: Math.min(Math.max(options.maxTokens ?? 64, 1), 1_024), messages: [{ role: 'user', content: options.prompt ?? 'Count from 1 to 20.' }] }),
  });
  if (response.status !== 200 || !response.body) throw new FuryLocalFabricError(`measurement request failed with HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let first: number | undefined;
  let chunks = 0;
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 4 * MAX_BODY) {
      await reader.cancel();
      throw new FuryLocalFabricError('measurement stream exceeds the byte bound');
    }
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          first ??= now();
          chunks += 1;
        }
      } catch {
        // Ignore malformed SSE lines; they do not count as output.
      }
    }
  }
  const end = now();
  if (first === undefined) throw new FuryLocalFabricError('model produced no streamed content');
  const generationSeconds = Math.max((end - first) / 1000, 1e-6);
  return Object.freeze({
    backend: options.backend,
    model: options.model,
    ttftMs: Math.round((first - started) * 1000) / 1000,
    totalMs: Math.round((end - started) * 1000) / 1000,
    outputChunks: chunks,
    chunksPerSecond: Math.round((chunks / generationSeconds) * 100) / 100,
  });
}
