// FuryPipe Studio runtime API.
//
// Every route is served only on loopback by the Node host (same guard as the
// dashboard). Read routes expose discovery results; POST routes are
// same-origin, JSON-only and size-bounded. Nothing here executes an agent:
// dispatch is a preview (plan only), and chat is limited to local inference
// endpoints validated by the FuryLocal boundary (no cloud, no paid call).
import { discoverFuryHarnesses, type FuryHarnessDiscovery } from '../fury-harness-hub.js';
import {
  assertFuryLocalEndpoint,
  classifyFuryModelFit,
  discoverFuryHardware,
  discoverFuryLocalBackends,
  type FuryHardwareProfile,
  type FuryLocalBackendKind,
  type FuryLocalBackendStatus,
} from '../fury-local-fabric.js';
import { compileFuryIr, FuryIrError } from '../fury-ir.js';
import { FuryDispatchError, FURY_DISPATCH_MODES, planFuryDispatch, type FuryDispatchMode, type FuryRuntimeBinding } from '../fury-dispatcher.js';
import { furyBlastRadius, furyScopeCoupling, loadFuryGraph, type FuryGraph } from '../fury-graph.js';
import { compileFuryFlow, dryRunFuryFlow, FuryFlowError } from '../fury-flow.js';

export const STUDIO_API_PREFIX = '/api/studio/';
const MAX_POST_BYTES = 256 * 1024;
const CACHE_MS = 10_000;

export type StudioRoute =
  | 'harnesses' | 'local' | 'hardware' | 'bindings' | 'graph' | 'blast-radius' | 'dispatch-preview' | 'chat' | 'flow-preview';

const ROUTES: Readonly<Record<string, { route: StudioRoute; method: 'GET' | 'POST' }>> = Object.freeze({
  '/api/studio/harnesses.json': { route: 'harnesses', method: 'GET' },
  '/api/studio/local.json': { route: 'local', method: 'GET' },
  '/api/studio/hardware.json': { route: 'hardware', method: 'GET' },
  '/api/studio/bindings.json': { route: 'bindings', method: 'GET' },
  '/api/studio/graph.json': { route: 'graph', method: 'GET' },
  '/api/studio/blast-radius': { route: 'blast-radius', method: 'POST' },
  '/api/studio/dispatch-preview': { route: 'dispatch-preview', method: 'POST' },
  '/api/studio/chat': { route: 'chat', method: 'POST' },
  '/api/studio/flow-preview': { route: 'flow-preview', method: 'POST' },
});

export function studioApiRoute(pathname: string): { route: StudioRoute; method: 'GET' | 'POST' } | null {
  return ROUTES[pathname] ?? null;
}

export interface StudioApiOptions {
  /** Project root for FuryGraph (the runtime working directory). */
  readonly projectRoot: string;
  readonly discoverHarnesses?: () => Promise<FuryHarnessDiscovery>;
  readonly discoverLocal?: () => Promise<{ readonly backends: readonly FuryLocalBackendStatus[] }>;
  readonly discoverHardware?: () => Promise<FuryHardwareProfile>;
  readonly loadGraph?: (root: string) => Promise<{ readonly graph: FuryGraph }>;
  readonly now?: () => number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

function problem(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json(?:;|$)/iu.test(type)) throw Object.assign(new Error('content-type must be application/json'), { status: 415 });
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_POST_BYTES) throw Object.assign(new Error('request body too large'), { status: 413 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_POST_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error('request body too large'), { status: 413 });
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw Object.assign(new Error('body is not valid JSON'), { status: 400 });
  }
}

/** Derive runtime bindings from what is actually installed/reachable. Scores stay 0 until FuryBench provides them. */
export function studioBindings(harnesses: FuryHarnessDiscovery, local: readonly FuryLocalBackendStatus[]): FuryRuntimeBinding[] {
  const bindings: FuryRuntimeBinding[] = [];
  for (const backend of local) {
    if (!backend.reachable) continue;
    for (const model of backend.models.slice(0, 32)) {
      if (model.modality === 'embeddings') continue;
      bindings.push({
        id: `native:${backend.kind}:${model.id}`.slice(0, 200), harnessId: 'furypipe-native', provider: backend.kind, model: model.id,
        locality: 'local', available: true, scores: {}, estimatedCostUsdPerTask: 0,
      });
      const cc = harnesses.harnesses.find((h) => h.id === 'claude-code' && h.installed);
      if (cc && backend.protocols.includes('anthropic-messages')) {
        bindings.push({ id: `claude-code:${backend.kind}:${model.id}`.slice(0, 200), harnessId: 'claude-code', provider: backend.kind, model: model.id, locality: 'local', available: true, scores: {}, estimatedCostUsdPerTask: 0 });
      }
      const codex = harnesses.harnesses.find((h) => h.id === 'codex' && h.installed);
      if (codex && (backend.kind === 'ollama' || backend.kind === 'lmstudio')) {
        bindings.push({ id: `codex:${backend.kind}:${model.id}`.slice(0, 200), harnessId: 'codex', provider: backend.kind, model: model.id, locality: 'local', available: true, scores: {}, estimatedCostUsdPerTask: 0 });
      }
    }
  }
  for (const h of harnesses.harnesses) {
    if (!h.installed || h.id === 'furypipe-native') continue;
    // The harness's own default (cloud) model; its identity and cost are not known to FuryPipe.
    bindings.push({ id: `${h.id}:default`, harnessId: h.id, provider: 'harness-default', model: 'harness-default', locality: 'cloud', available: true, scores: {}, estimatedCostUsdPerTask: 0 });
  }
  return bindings;
}

export function createStudioApi(options: StudioApiOptions) {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  const cached = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { at: now(), value });
    value.catch(() => cache.delete(key));
    return value;
  };
  const discovery = <T>(load: () => Promise<T>) => () => load().catch((error: unknown) => {
    throw Object.assign(new Error(`discovery failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`), { status: 503 });
  });
  const harnesses = () => cached('harnesses', discovery(options.discoverHarnesses ?? (() => discoverFuryHarnesses())));
  const local = () => cached('local', discovery(options.discoverLocal ?? (() => discoverFuryLocalBackends())));
  const hardware = () => cached('hardware', discovery(options.discoverHardware ?? (() => discoverFuryHardware())));
  const graph = () => cached('graph', async () => (await (options.loadGraph ?? loadFuryGraph)(options.projectRoot)).graph);

  return Object.freeze({
    async handle(route: StudioRoute, request: Request): Promise<Response> {
      try {
        switch (route) {
          case 'harnesses':
            return json(await harnesses());
          case 'hardware':
            return json(await hardware());
          case 'local': {
            const [status, hw] = await Promise.all([local(), hardware()]);
            return json({
              backends: status.backends.map((b) => ({
                ...b,
                models: b.models.map((m) => ({ ...m, fit: classifyFuryModelFit(m, hw) })),
              })),
            });
          }
          case 'bindings': {
            const [h, l] = await Promise.all([harnesses(), local()]);
            return json({ bindings: studioBindings(h, l.backends), scoring: 'unscored: routing scores come from FuryBench runs; none recorded yet' });
          }
          case 'graph': {
            const g = await graph();
            const files = g.nodes.filter((n) => n.kind === 'file').length;
            return json({ provider: g.provider, stale: g.stale, staleFiles: g.staleFiles.slice(0, 50), outputs: g.outputs, nodes: g.nodes.length, files, edges: g.edges.length });
          }
          case 'blast-radius': {
            const body = await readJson(request) as { files?: unknown; depth?: unknown };
            if (!Array.isArray(body?.files) || body.files.length === 0 || body.files.length > 200 || !body.files.every((f) => typeof f === 'string')) {
              return problem(400, 'invalid-input', 'files must be a non-empty array of relative paths');
            }
            const depth = typeof body.depth === 'number' ? body.depth : 2;
            return json(furyBlastRadius(await graph(), body.files as string[], depth));
          }
          case 'dispatch-preview': {
            const body = await readJson(request) as { ir?: unknown; mode?: unknown; graphAware?: unknown };
            const mode = typeof body?.mode === 'string' && (FURY_DISPATCH_MODES as readonly string[]).includes(body.mode) ? body.mode as FuryDispatchMode : 'AUTO';
            const ir = compileFuryIr(body?.ir);
            const [h, l] = await Promise.all([harnesses(), local()]);
            const candidates = studioBindings(h, l.backends);
            let coupling: ((a: readonly string[], b: readonly string[]) => number) | undefined;
            if (body?.graphAware === true) {
              const g = await graph().catch(() => undefined);
              if (g) coupling = (a, b) => furyScopeCoupling(g, a, b);
            }
            const plan = planFuryDispatch({ ir, candidates, mode, ...(coupling ? { coupling } : {}) });
            return json({ plan, candidates: candidates.map((c) => ({ id: c.id, harnessId: c.harnessId, provider: c.provider, model: c.model, locality: c.locality })), execution: 'NOT_EXECUTED: preview only' });
          }
          case 'flow-preview': {
            const body = await readJson(request) as { flow?: unknown; fixtures?: unknown; approvals?: unknown };
            const flow = compileFuryFlow(body?.flow);
            let run: unknown;
            if (body?.fixtures !== undefined) {
              if (!body.fixtures || typeof body.fixtures !== 'object' || Array.isArray(body.fixtures)) return problem(400, 'invalid-input', 'fixtures must be an object');
              const approvals = Array.isArray(body.approvals) ? body.approvals.filter((a): a is string => typeof a === 'string').slice(0, 100) : [];
              run = dryRunFuryFlow(flow, { fixtures: body.fixtures as Record<string, unknown>, approvals });
            }
            return json({ flow, ...(run ? { run } : {}), execution: 'DRY_RUN: deterministic handlers are pass-through, agentic nodes use fixtures; no side effect' });
          }
          case 'chat': {
            const body = await readJson(request) as { kind?: unknown; baseUrl?: unknown; model?: unknown; messages?: unknown };
            if (typeof body?.baseUrl !== 'string' || typeof body.model !== 'string' || body.model.length > 256 || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 64) {
              return problem(400, 'invalid-input', 'baseUrl, model and 1..64 messages are required');
            }
            const messages = body.messages.map((m) => {
              const role = (m as { role?: unknown }).role;
              const content = (m as { content?: unknown }).content;
              if ((role !== 'user' && role !== 'assistant' && role !== 'system') || typeof content !== 'string' || content.length > 32_768) throw Object.assign(new Error('invalid message'), { status: 400 });
              return { role, content };
            });
            const url = assertFuryLocalEndpoint(body.baseUrl); // loopback only from Studio
            const upstream = await fetch(new URL('v1/chat/completions', url.href.endsWith('/') ? url.href : `${url.href}/`), {
              method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(300_000),
              headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
              body: JSON.stringify({ model: body.model, stream: true, messages }),
            });
            if (upstream.status !== 200 || !upstream.body) return problem(502, 'local-backend-error', `local backend answered HTTP ${upstream.status}`);
            return new Response(upstream.body, {
              status: 200,
              headers: {
                'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
                'x-furypipe-locality': 'local', 'x-furypipe-backend': String(body.kind ?? 'openai-compatible').slice(0, 32) as FuryLocalBackendKind,
              },
            });
          }
        }
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status) return problem(status, status === 503 ? 'discovery-failed' : 'invalid-request', (error as Error).message);
        if (error instanceof FuryIrError) return problem(422, 'invalid-ir', error.message);
        if (error instanceof FuryDispatchError) return problem(422, 'dispatch-rejected', error.message);
        if (error instanceof FuryFlowError) return problem(422, 'invalid-flow', error.message);
        if ((error as Error).name === 'FuryLocalFabricError') return problem(403, 'endpoint-denied', (error as Error).message);
        if ((error as Error).name === 'FuryGraphError') return problem(404, 'graph-unavailable', (error as Error).message);
        return problem(500, 'internal', 'studio request failed');
      }
    },
  });
}
