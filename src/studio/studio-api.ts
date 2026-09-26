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
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodingWorktreeManager, createNodeGitWorktreeProvider, discoverCodingRepository } from '../coding-runtime.js';
import { runFuryHarnessTask } from '../fury-harness-runner.js';
import type { FuryMissionControl, FuryWorkerBinding } from '../fury-mission-control.js';
import { planFuryTask } from '../fury-planner.js';
import { createFuryProofLedger } from '../fury-proof.js';
import { runFuryTask, type FuryRunResult, type FuryTaskExecutor } from '../fury-run.js';
import { createFurySkillHub, FurySkillHubError, FURY_SKILL_GOVERNANCE, type FurySkillGovernance, type FurySkillHub } from '../fury-skill-hub.js';
import { createHash, randomUUID } from 'node:crypto';
import { createFuryKnowledgeBase, FuryKnowledgeError, type FuryEmbedder, type FuryRetrievalMode } from '../fury-knowledge.js';
import { createFurySearxngAdapter, furyWebCrawl, furyWebExtract, furyWebFetch, furyWebMap, furyWebSearch, FuryWebError, type FuryWebFetchOptions } from '../fury-web.js';
import { studioMemoryFromEnv, studioMemoryList, studioMemoryRemember, studioMemoryScopes, studioMemorySearch, type StudioMemory } from './studio-memory.js';
import { buildFuryIntegrationRegistry } from '../fury-integrations.js';
import { createStudioChats, StudioChatError, type StudioChats } from './studio-chats.js';
import { createStudioCode, StudioCodeError } from './studio-code.js';
import { createFuryMcpHub, FuryMcpHubError, type FuryMcpHub, type FuryMcpPolicy } from '../fury-mcp-hub.js';
import { discoverFuryAiConnections, type FuryAiConnections } from '../fury-ai-connections.js';
import { inspectHuggingFaceGguf, recommendHuggingFaceGguf } from '../fury-huggingface-models.js';
import { installFuryLocalRuntime, type FuryRuntimeSetupId, type FuryRuntimeSetupRunner } from '../fury-runtime-setup.js';
import { launchFuryAccountLogin, type FuryAccountLoginLauncher, type FuryAccountProvider } from '../fury-account-connect.js';
import { probeFuryAccountStatuses, type FuryAccountStatusRunner } from '../fury-account-status.js';
import { planStudioAutopilot, type StudioResponseStyle } from './studio-autopilot.js';

export const STUDIO_API_PREFIX = '/api/studio/';
const MAX_POST_BYTES = 256 * 1024;
const CACHE_MS = 10_000;

export type StudioRoute =
  | 'harnesses' | 'local' | 'hardware' | 'local-model-inspect' | 'local-model-recommend' | 'runtime-setup' | 'runtime-setup-status' | 'autopilot-preview' | 'bindings' | 'graph' | 'blast-radius' | 'dispatch-preview' | 'chat' | 'flow-preview'
  | 'runs' | 'run-start' | 'run-act' | 'skills' | 'skill-act' | 'skill-select' | 'skill-install' | 'skill-compare'
  | 'mcp' | 'mcp-act' | 'mcp-probe' | 'mcp-decide'
  | 'knowledge' | 'knowledge-ingest' | 'knowledge-search'
  | 'web'
  | 'memory' | 'memory-remember' | 'memory-search' | 'memory-act'
  | 'integrations' | 'connections' | 'connection-login'
  | 'chats' | 'chat-get' | 'chat-save' | 'chat-branch' | 'chat-delete'
  | 'code-tree' | 'code-file' | 'code-worktrees' | 'code-diff';

const ROUTES: Readonly<Record<string, { route: StudioRoute; method: 'GET' | 'POST' }>> = Object.freeze({
  '/api/studio/harnesses.json': { route: 'harnesses', method: 'GET' },
  '/api/studio/local.json': { route: 'local', method: 'GET' },
  '/api/studio/hardware.json': { route: 'hardware', method: 'GET' },
  '/api/studio/local-model/inspect': { route: 'local-model-inspect', method: 'POST' },
  '/api/studio/local-model/recommend': { route: 'local-model-recommend', method: 'POST' },
  '/api/studio/setup/runtime': { route: 'runtime-setup', method: 'POST' },
  '/api/studio/setup/runtime/status': { route: 'runtime-setup-status', method: 'GET' },
  '/api/studio/autopilot/preview': { route: 'autopilot-preview', method: 'POST' },
  '/api/studio/bindings.json': { route: 'bindings', method: 'GET' },
  '/api/studio/graph.json': { route: 'graph', method: 'GET' },
  '/api/studio/blast-radius': { route: 'blast-radius', method: 'POST' },
  '/api/studio/dispatch-preview': { route: 'dispatch-preview', method: 'POST' },
  '/api/studio/chat': { route: 'chat', method: 'POST' },
  '/api/studio/flow-preview': { route: 'flow-preview', method: 'POST' },
  '/api/studio/runs.json': { route: 'runs', method: 'GET' },
  '/api/studio/runs': { route: 'run-start', method: 'POST' },
  '/api/studio/runs/act': { route: 'run-act', method: 'POST' },
  '/api/studio/skills.json': { route: 'skills', method: 'GET' },
  '/api/studio/skills/act': { route: 'skill-act', method: 'POST' },
  '/api/studio/skills/select': { route: 'skill-select', method: 'POST' },
  '/api/studio/skills/install': { route: 'skill-install', method: 'POST' },
  '/api/studio/skills/compare': { route: 'skill-compare', method: 'POST' },
  '/api/studio/mcp.json': { route: 'mcp', method: 'GET' },
  '/api/studio/mcp/act': { route: 'mcp-act', method: 'POST' },
  '/api/studio/mcp/probe': { route: 'mcp-probe', method: 'POST' },
  '/api/studio/mcp/decide': { route: 'mcp-decide', method: 'POST' },
  '/api/studio/knowledge.json': { route: 'knowledge', method: 'GET' },
  '/api/studio/knowledge/ingest': { route: 'knowledge-ingest', method: 'POST' },
  '/api/studio/knowledge/search': { route: 'knowledge-search', method: 'POST' },
  '/api/studio/web': { route: 'web', method: 'POST' },
  '/api/studio/memory.json': { route: 'memory', method: 'GET' },
  '/api/studio/memory/remember': { route: 'memory-remember', method: 'POST' },
  '/api/studio/memory/search': { route: 'memory-search', method: 'POST' },
  '/api/studio/memory/act': { route: 'memory-act', method: 'POST' },
  '/api/studio/integrations.json': { route: 'integrations', method: 'GET' },
  '/api/studio/connections.json': { route: 'connections', method: 'GET' },
  '/api/studio/connections/login': { route: 'connection-login', method: 'POST' },
  '/api/studio/chats.json': { route: 'chats', method: 'GET' },
  '/api/studio/chats/get': { route: 'chat-get', method: 'POST' },
  '/api/studio/chats/save': { route: 'chat-save', method: 'POST' },
  '/api/studio/chats/branch': { route: 'chat-branch', method: 'POST' },
  '/api/studio/chats/delete': { route: 'chat-delete', method: 'POST' },
  '/api/studio/code/tree': { route: 'code-tree', method: 'POST' },
  '/api/studio/code/file': { route: 'code-file', method: 'POST' },
  '/api/studio/code/worktrees.json': { route: 'code-worktrees', method: 'GET' },
  '/api/studio/code/diff': { route: 'code-diff', method: 'POST' },
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
  /** Safe account/provider hints. Never returns credential values or browser-session data. */
  readonly discoverConnections?: () => Promise<FuryAiConnections>;
  /** Public Hugging Face catalog fetch hook (tests); no credentials are attached. */
  readonly huggingFaceFetch?: typeof fetch;
  /** Test hook for the fixed, explicit local-runtime package installer. */
  readonly runtimeSetupRunner?: FuryRuntimeSetupRunner;
  readonly runtimeSetupPlatform?: NodeJS.Platform;
  /** Test hook for explicit official CLI sign-in launch. */
  readonly accountLoginLauncher?: FuryAccountLoginLauncher;
  readonly accountLoginPlatform?: NodeJS.Platform;
  /** Test hook for official CLI auth-status probes. */
  readonly accountStatusRunner?: FuryAccountStatusRunner;
  readonly accountStatusPlatform?: NodeJS.Platform;
  readonly loadGraph?: (root: string) => Promise<{ readonly graph: FuryGraph }>;
  readonly now?: () => number;
  /** Task executor for real runs; defaults to the structured-CLI harness runner. */
  readonly executor?: FuryTaskExecutor;
  /** Where writer and integration worktrees are created (default: OS temp dir). */
  readonly worktreeRoot?: string;
  /** Skills Hub; defaults to one keyed by project under ~/.furypipe/studio/skill-hub. */
  readonly skillHub?: FurySkillHub;
  /** MCP Hub; defaults to one keyed by project under ~/.furypipe/studio/mcp-hub. */
  readonly mcpHub?: FuryMcpHub;
  /** Knowledge base state directory (default ~/.furypipe/studio/knowledge/<project>). */
  readonly knowledgeDir?: string;
  /** Local SearXNG endpoint for web search (default: FURYPIPE_SEARXNG_URL, else search is not configured). */
  readonly searxngUrl?: string;
  /** Network hooks for tests (DNS override, dialer). */
  readonly webFetch?: Pick<FuryWebFetchOptions, 'resolveHostname' | 'dial'>;
  /** Memory store; defaults to the encrypted local memory config, else disabled. */
  readonly memory?: StudioMemory;
  /** Conversation store directory (default ~/.furypipe/studio/chats/<project>). */
  readonly chatsDir?: string;
}

interface StudioRun {
  readonly runId: string;
  readonly intent: string;
  readonly startedAt: number;
  status: 'running' | FuryRunResult['status'] | 'ERROR';
  mission?: FuryMissionControl;
  result?: FuryRunResult;
  error?: string;
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

function gitHead(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => execFile('git', ['rev-parse', 'HEAD'], { cwd, shell: false, windowsHide: true }, (e, out) => (e ? reject(Object.assign(new Error('project root is not a git repository with a commit'), { status: 409 })) : resolve(String(out).trim()))));
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
  const connections = discovery(options.discoverConnections ?? (async () => {
    const discovered = await harnesses();
    const verification = await probeFuryAccountStatuses(discovered, {
      ...(options.accountStatusRunner ? { runner: options.accountStatusRunner } : {}),
      ...(options.accountStatusPlatform ? { platform: options.accountStatusPlatform } : {}),
    });
    return discoverFuryAiConnections(discovered, process.env, verification);
  }));
  const graph = () => cached('graph', async () => (await (options.loadGraph ?? loadFuryGraph)(options.projectRoot)).graph);

  const projectKey = createHash('sha256').update(path.resolve(options.projectRoot)).digest('hex').slice(0, 16);
  const skills = options.skillHub ?? createFurySkillHub({ projectRoot: options.projectRoot, stateDir: path.join(os.homedir(), '.furypipe', 'studio', 'skill-hub', projectKey) });
  const mcp = options.mcpHub ?? createFuryMcpHub({ projectRoot: options.projectRoot, stateDir: path.join(os.homedir(), '.furypipe', 'studio', 'mcp-hub', projectKey) });

  // Embeddings come only from a reachable loopback backend that lists an embeddings model.
  const knowledge = async () => {
    const backends = (await local().catch(() => ({ backends: [] as readonly FuryLocalBackendStatus[] }))).backends;
    const model = backends.filter((b) => b.reachable).flatMap((b) => b.models).find((m) => m.modality === 'embeddings');
    const embed: FuryEmbedder | undefined = model ? async (input) => {
      const url = assertFuryLocalEndpoint(model.baseUrl);
      const res = await fetch(new URL('v1/embeddings', url.href.endsWith('/') ? url.href : `${url.href}/`), { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(120_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: model.id, input }) });
      if (res.status !== 200) throw Object.assign(new Error(`local embeddings answered HTTP ${res.status}`), { status: 502 });
      const body = await res.json() as { data?: { embedding?: number[] }[] };
      return (body.data ?? []).map((d) => d.embedding ?? []);
    } : undefined;
    return { kb: createFuryKnowledgeBase({ stateDir: options.knowledgeDir ?? path.join(os.homedir(), '.furypipe', 'studio', 'knowledge', projectKey), ...(embed && model ? { embed, embeddingModel: `${model.backend}:${model.id}` } : {}) }), embeddingModel: model ? `${model.backend}:${model.id}` : null };
  };

  const chats: StudioChats = createStudioChats({ stateDir: options.chatsDir ?? path.join(os.homedir(), '.furypipe', 'studio', 'chats', projectKey), now });
  const code = createStudioCode(options.projectRoot);
  let memoryState: StudioMemory | undefined = options.memory;
  const memory = () => (memoryState ??= studioMemoryFromEnv());
  const memoryStore = () => {
    const m = memory();
    if (!m.enabled || !m.store) throw Object.assign(new Error(m.reason ?? 'memory is off'), { status: 409 });
    return m.store;
  };

  const runs = new Map<string, StudioRun>();
  type RuntimeSetupJob = {
    readonly id:string;
    readonly runtime:FuryRuntimeSetupId;
    readonly startedAt:number;
    state:'running'|'installed'|'failed'|'unsupported';
    next:string;
    error?:string;
  };
  const runtimeSetupJobs = new Map<string, RuntimeSetupJob>();
  const cleanRuntimeSetupJobs = () => {
    const cutoff = now() - 30 * 60_000;
    for (const [id, job] of runtimeSetupJobs) if (job.startedAt < cutoff && job.state !== 'running') runtimeSetupJobs.delete(id);
  };
  const runtimeSetupSnapshot = (job:RuntimeSetupJob) => Object.freeze({
    id:job.id, runtime:job.runtime, state:job.state, startedAt:job.startedAt, next:job.next, ...(job.error ? { error:job.error } : {}),
  });
  const ledger = createFuryProofLedger();
  const runSnapshot = (r: StudioRun) => ({
    runId: r.runId, intent: r.intent, startedAt: r.startedAt, status: r.status,
    ...(r.error ? { error: r.error } : {}),
    workers: (r.mission?.workers() ?? []).map((w) => ({ workerId: w.workerId, taskId: w.taskId, role: w.role, state: w.state, progress: w.progress, harnessId: w.binding.harnessId, provider: w.binding.provider, model: w.binding.model, locality: w.binding.locality, worktree: w.worktree, usage: w.usage, errors: w.errors.slice(-3), receipts: w.receiptIds.length })),
    totals: r.mission?.totals() ?? null,
    replayEntries: r.mission?.replay().entries.length ?? 0,
    ...(r.result ? { verdict: r.result.judgement.verdict, pendingGates: r.result.pendingGates, bundleDigest: r.result.bundle.bundleDigest, requirements: r.result.judgement.requirements.map((q) => ({ id: q.id, status: q.status })) } : {}),
  });

  return Object.freeze({
    async handle(route: StudioRoute, request: Request): Promise<Response> {
      try {
        switch (route) {
          case 'harnesses':
            return json(await harnesses());
          case 'connections':
            return json(await connections());
          case 'connection-login': {
            const body = await readJson(request) as { provider?: unknown; confirm?: unknown };
            if (body.confirm !== true) return problem(400, 'confirmation-required', 'launching account sign-in requires confirm: true');
            if (body.provider !== 'anthropic' && body.provider !== 'openai' && body.provider !== 'google') return problem(400, 'invalid-input', 'provider must be anthropic, openai or google');
            const result = launchFuryAccountLogin(body.provider as FuryAccountProvider, await harnesses(), {
              ...(options.accountLoginLauncher ? { launcher: options.accountLoginLauncher } : {}),
              ...(options.accountLoginPlatform ? { platform: options.accountLoginPlatform } : {}),
            });
            return json(result, result.status === 'launched' ? 202 : 409);
          }
          case 'hardware':
            return json(await hardware());
          case 'local-model-inspect': {
            const body = await readJson(request) as { model?: unknown };
            if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 512) return problem(400, 'invalid-input', 'model must be a Hugging Face owner/model or URL');
            return json(await inspectHuggingFaceGguf(body.model, await hardware(), { ...(options.huggingFaceFetch ? { fetch: options.huggingFaceFetch } : {}) }));
          }
          case 'local-model-recommend': {
            const body = await readJson(request) as { profile?: unknown };
            const profile = body.profile === 'coding' || body.profile === 'reasoning' || body.profile === 'vision' ? body.profile : 'general';
            return json(await recommendHuggingFaceGguf(await hardware(), { profile, ...(options.huggingFaceFetch ? { fetch: options.huggingFaceFetch } : {}) }));
          }
          case 'runtime-setup': {
            const body = await readJson(request) as { runtime?: unknown; confirm?: unknown };
            if (body.confirm !== true) return problem(400, 'confirmation-required', 'installing local AI requires confirm: true');
            if (body.runtime !== 'ollama' && body.runtime !== 'lmstudio') return problem(400, 'invalid-input', 'runtime must be ollama or lmstudio');
            cleanRuntimeSetupJobs();
            const existing = [...runtimeSetupJobs.values()].find((job) => job.runtime === body.runtime && job.state === 'running');
            if (existing) return json(runtimeSetupSnapshot(existing), 202);
            const job:RuntimeSetupJob = {
              id:randomUUID(),
              runtime:body.runtime,
              startedAt:now(),
              state:'running',
              next:'Installing with Windows Package Manager…',
            };
            runtimeSetupJobs.set(job.id, job);
            void installFuryLocalRuntime(body.runtime as FuryRuntimeSetupId, {
              ...(options.runtimeSetupRunner ? { runner: options.runtimeSetupRunner } : {}),
              ...(options.runtimeSetupPlatform ? { platform: options.runtimeSetupPlatform } : {}),
            }).then((result) => {
              job.state = result.status;
              job.next = result.next;
              cache.delete('local');
            }).catch((error:unknown) => {
              job.state = 'failed';
              job.error = error instanceof Error ? error.message.slice(0,500) : 'runtime installation failed';
              job.next = 'Installation failed.';
            });
            return json(runtimeSetupSnapshot(job), 202);
          }
          case 'runtime-setup-status': {
            cleanRuntimeSetupJobs();
            const id = new URL(request.url).searchParams.get('id');
            if (!id || id.length > 100) return problem(400, 'invalid-input', 'setup job id is required');
            const job = runtimeSetupJobs.get(id);
            return job ? json(runtimeSetupSnapshot(job)) : problem(404, 'not-found', 'setup job not found');
          }
          case 'local': {
            const [status, hw] = await Promise.all([local(), hardware()]);
            return json({
              backends: status.backends.map((b) => ({
                ...b,
                models: b.models.map((m) => ({ ...m, fit: classifyFuryModelFit(m, hw) })),
              })),
            });
          }
          case 'autopilot-preview': {
            const body = await readJson(request) as { objective?: unknown; harnessId?: unknown; responseStyle?: unknown };
            if (typeof body.objective !== 'string' || !body.objective.trim() || body.objective.length > 32_768) {
              return problem(400, 'invalid-input', 'objective is required (max 32768 characters)');
            }
            if (body.harnessId !== undefined && (typeof body.harnessId !== 'string' || body.harnessId.length > 128)) {
              return problem(400, 'invalid-input', 'harnessId must be bounded text');
            }
            if (body.responseStyle !== undefined && typeof body.responseStyle !== 'string') {
              return problem(400, 'invalid-input', 'responseStyle must be text');
            }
            return json(await planStudioAutopilot({
              objective: body.objective,
              projectRoot: options.projectRoot,
              skills,
              mcp,
              ...(typeof body.harnessId === 'string' && body.harnessId ? { harnessId: body.harnessId } : {}),
              ...(typeof body.responseStyle === 'string' ? { responseStyle: body.responseStyle as StudioResponseStyle } : {}),
            }));
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
          case 'runs':
            return json({ runs: [...runs.values()].map(runSnapshot).reverse() });
          case 'run-act': {
            const body = await readJson(request) as { runId?: unknown; workerId?: unknown; action?: unknown };
            const run = typeof body?.runId === 'string' ? runs.get(body.runId) : undefined;
            if (!run?.mission) return problem(404, 'unknown-run', 'run not found');
            if (body.action !== 'STOP') return problem(400, 'invalid-input', 'only STOP is available on a live run');
            run.mission.act(String(body.workerId), 'STOP', { reason: 'stopped by operator' });
            return json(runSnapshot(run));
          }
          case 'run-start': {
            const body = await readJson(request) as { intent?: unknown; plannedFiles?: unknown; mode?: unknown; profile?: unknown; allowCloud?: unknown; confirm?: unknown; capabilities?: unknown; approvedCapabilities?: unknown };
            if (body?.confirm !== true) return problem(400, 'confirmation-required', 'starting agents requires confirm: true');
            // Cowork permissions: DENY never runs, ASK must be approved (or it is refused) before agents start.
            let capabilities: Partial<Record<'READ' | 'WRITE' | 'EXECUTE' | 'NETWORK' | 'EXTERNAL_ACTION', 'ALLOW' | 'ASK' | 'DENY'>> | undefined;
            if (body.capabilities !== undefined) {
              const caps = body.capabilities as Record<string, unknown>;
              const names = ['READ', 'WRITE', 'EXECUTE', 'NETWORK', 'EXTERNAL_ACTION'] as const;
              if (!caps || typeof caps !== 'object' || Object.keys(caps).some((k) => !(names as readonly string[]).includes(k)) || Object.values(caps).some((v) => v !== 'ALLOW' && v !== 'ASK' && v !== 'DENY')) return problem(400, 'invalid-input', 'capabilities map READ/WRITE/EXECUTE/NETWORK/EXTERNAL_ACTION to ALLOW, ASK or DENY');
              if (caps.EXTERNAL_ACTION === 'ALLOW') return problem(400, 'invalid-input', 'external actions only run through a human gate; use ASK or DENY');
              const approved = new Set(Array.isArray(body.approvedCapabilities) ? body.approvedCapabilities.filter((c): c is string => typeof c === 'string') : []);
              const pending = names.filter((n) => caps[n] === 'ASK' && n !== 'EXTERNAL_ACTION' && !approved.has(n));
              if (pending.length) return json({ error: { code: 'approval-required', message: `approve or deny before agents start: ${pending.join(', ')}` }, approvalRequired: pending }, 409);
              capabilities = Object.fromEntries(names.filter((n) => caps[n] !== undefined).map((n) => [n, caps[n] === 'ASK' && n !== 'EXTERNAL_ACTION' ? 'ALLOW' : caps[n]])) as typeof capabilities;
            }
            if (typeof body.intent !== 'string' || !body.intent.trim() || body.intent.length > 4_000) return problem(400, 'invalid-input', 'intent is required');
            if (!Array.isArray(body.plannedFiles) || body.plannedFiles.length > 200 || !body.plannedFiles.every((f) => typeof f === 'string')) return problem(400, 'invalid-input', 'plannedFiles must be an array of relative paths');
            if ([...runs.values()].filter((r) => r.status === 'running').length >= 2) return problem(429, 'too-many-runs', 'two runs are already active');
            const runId = `run-${now().toString(36)}-${runs.size + 1}`;
            const graphValue = await graph().catch(() => undefined);
            const plan = planFuryTask({ runId, intent: body.intent, plannedFiles: body.plannedFiles as string[], ...(capabilities ? { capabilities } : {}), ...(graphValue ? { graph: graphValue } : {}) });
            const [h, l] = await Promise.all([harnesses(), local()]);
            const all = studioBindings(h, l.backends);
            // Paid-call guard: cloud runtimes only on explicit request.
            const candidates = body.allowCloud === true ? all : all.filter((c) => c.locality === 'local');
            const mode = typeof body.mode === 'string' && (FURY_DISPATCH_MODES as readonly string[]).includes(body.mode) ? body.mode as FuryDispatchMode : 'AUTO';
            const dispatch = planFuryDispatch({ ir: plan.ir, candidates, mode, ...(typeof body.profile === 'string' ? { profile: body.profile as never } : {}), ...(graphValue ? { coupling: (a, b) => furyScopeCoupling(graphValue, a, b) } : {}) });
            if (dispatch.status !== 'PLANNED') return problem(409, 'dispatch-blocked', dispatch.reasons.join('; ') || 'dispatch blocked');
            const repoRoot = options.projectRoot;
            const baseSha = await gitHead(repoRoot);
            const root = path.join(options.worktreeRoot ?? path.join(os.tmpdir(), 'furypipe-studio-runs'), runId);
            await mkdir(path.join(root, 'writers'), { recursive: true });
            const bindingsById = new Map(candidates.map((c) => [c.id, c]));
            const workerBindings: FuryWorkerBinding[] = candidates.map((c) => ({ bindingId: c.id, harnessId: c.harnessId, provider: c.provider, model: c.model, locality: c.locality }));
            const executor: FuryTaskExecutor = options.executor ?? (async ({ assignment, binding, worktree, capsule }) => {
              const status = h.harnesses.find((x) => x.id === binding.harnessId);
              if (!status?.installed || !status.executable) return { ok: false, receipts: [], error: `${binding.harnessId} has no executable adapter on this machine` };
              const b = bindingsById.get(binding.bindingId)!;
              const localBackend = b.locality === 'local' ? l.backends.find((x) => x.kind === b.provider && x.reachable) : undefined;
              const res = await runFuryHarnessTask({
                harnessId: binding.harnessId, executable: status.executable, worktree, taskId: assignment.taskId, runId, capsule,
                authority: assignment.authority, timeoutMs: plan.ir.budget.maxWallTimeMs,
                ...(b.model !== 'harness-default' ? { model: b.model } : {}),
                ...(localBackend ? { local: { kind: localBackend.kind as 'ollama' | 'lmstudio', baseUrl: localBackend.baseUrl } } : {}),
              }, ledger);
              return { ok: res.exitCode === 0 && !res.timedOut, receipts: res.receipts, ...(res.exitCode !== 0 ? { error: `harness exited ${res.exitCode ?? 'by timeout'}` } : {}) };
            });
            const run: StudioRun = { runId, intent: body.intent, startedAt: now(), status: 'running' };
            runs.set(runId, run);
            const repository = await discoverCodingRepository(repoRoot);
            void runFuryTask({
              runId, ir: plan.ir, plan: dispatch, bindings: workerBindings, repository, repoRoot, baseSha,
              manager: createCodingWorktreeManager({ provider: createNodeGitWorktreeProvider() }),
              writableRoot: path.join(root, 'writers'), integrationRoot: path.join(root, 'integration'), ledger, execute: executor,
              ...(graphValue ? { graph: graphValue } : {}),
              onMission: (m) => { run.mission = m; },
            }).then((result) => { run.result = result; run.status = result.status; }, (error: unknown) => { run.status = 'ERROR'; run.error = error instanceof Error ? error.message.slice(0, 300) : 'run failed'; });
            return json({ runId, status: 'running', dispatch: { mode: dispatch.mode, benefit: dispatch.dispatchBenefit, reasons: dispatch.reasons, agents: dispatch.agents } }, 202);
          }
          case 'skills':
            return json(await skills.list());
          case 'skill-act': {
            const body = await readJson(request) as { name?: unknown; action?: unknown; value?: unknown };
            const name = String(body?.name ?? '');
            switch (body?.action) {
              case 'ENABLE': return json(await skills.setEnabled(name, true));
              case 'DISABLE': return json(await skills.setEnabled(name, false));
              case 'PIN': return json(await skills.pin(name));
              case 'UNPIN': return json(await skills.unpin(name));
              case 'GOVERNANCE':
                if (!(FURY_SKILL_GOVERNANCE as readonly unknown[]).includes(body.value)) return problem(400, 'invalid-input', `value must be one of ${FURY_SKILL_GOVERNANCE.join(', ')}`);
                return json(await skills.setGovernance(name, body.value as FurySkillGovernance));
              case 'ROLLBACK': return json(await skills.rollback(name, String(body.value ?? '')));
              default: return problem(400, 'invalid-input', 'action must be ENABLE, DISABLE, PIN, UNPIN, GOVERNANCE or ROLLBACK');
            }
          }
          case 'skill-select': {
            const body = await readJson(request) as { objective?: unknown; harnessId?: unknown };
            if (typeof body?.objective !== 'string' || !body.objective.trim() || body.objective.length > 16_000) return problem(400, 'invalid-input', 'objective is required');
            return json({ ...(await skills.autoSelect(body.objective, typeof body.harnessId === 'string' ? { harnessId: body.harnessId } : {})), execution: 'NOT_EXECUTED: instruction routing only' });
          }
          case 'skill-install': {
            const body = await readJson(request) as { sourceDir?: unknown; confirm?: unknown };
            if (body?.confirm !== true) return problem(400, 'confirmation-required', 'installing a skill requires confirm: true');
            if (typeof body.sourceDir !== 'string' || !path.isAbsolute(body.sourceDir) || body.sourceDir.length > 1_024) return problem(400, 'invalid-input', 'sourceDir must be an absolute local directory');
            return json(await skills.install(body.sourceDir), 201);
          }
          case 'skill-compare': {
            const body = await readJson(request) as { name?: unknown; a?: unknown; b?: unknown };
            return json(await skills.compare(String(body?.name ?? ''), String(body?.a ?? ''), String(body?.b ?? '')));
          }
          case 'mcp':
            return json(await mcp.list());
          case 'mcp-act': {
            const body = await readJson(request) as { sourceId?: unknown; action?: unknown; tool?: unknown; value?: unknown };
            const id = String(body?.sourceId ?? '');
            switch (body?.action) {
              case 'ENABLE': return json(await mcp.setEnabled(id, true));
              case 'DISABLE': return json(await mcp.setEnabled(id, false));
              case 'TRUST': return json(await mcp.setTrusted(id, true));
              case 'UNTRUST': return json(await mcp.setTrusted(id, false));
              case 'DEFAULT_POLICY': return json(await mcp.setDefaultPolicy(id, body.value as FuryMcpPolicy));
              case 'TOOL_POLICY': return json(await mcp.setToolPolicy(id, String(body.tool ?? ''), body.value === null ? null : body.value as FuryMcpPolicy));
              default: return problem(400, 'invalid-input', 'action must be ENABLE, DISABLE, TRUST, UNTRUST, DEFAULT_POLICY or TOOL_POLICY');
            }
          }
          case 'mcp-probe': {
            const body = await readJson(request) as { sourceId?: unknown; allowRemote?: unknown; confirm?: unknown };
            if (body?.confirm !== true) return problem(400, 'confirmation-required', 'a health probe starts the configured server; it requires confirm: true');
            return json(await mcp.probe(String(body.sourceId ?? ''), { allowRemote: body.allowRemote === true }));
          }
          case 'mcp-decide': {
            const body = await readJson(request) as { sourceId?: unknown; tool?: unknown };
            return json(await mcp.decide(String(body?.sourceId ?? ''), String(body?.tool ?? '')));
          }
          case 'knowledge': {
            const { kb, embeddingModel } = await knowledge();
            return json({ ...(await kb.stats()), availableEmbeddingModel: embeddingModel });
          }
          case 'knowledge-ingest': {
            const body = await readJson(request) as { dir?: unknown; label?: unknown };
            const rel = typeof body?.dir === 'string' ? body.dir : '';
            const abs = path.resolve(options.projectRoot, rel);
            if (!rel || path.isAbsolute(rel) || (abs !== path.resolve(options.projectRoot) && !abs.startsWith(`${path.resolve(options.projectRoot)}${path.sep}`))) return problem(400, 'invalid-input', 'dir must be a relative folder inside the project');
            const { kb } = await knowledge();
            return json(await kb.ingest(abs, { label: typeof body.label === 'string' && body.label ? body.label : path.basename(abs) }));
          }
          case 'knowledge-search': {
            const body = await readJson(request) as { query?: unknown; mode?: unknown; limit?: unknown };
            const mode = body?.mode === 'lexical' || body?.mode === 'semantic' || body?.mode === 'hybrid' ? body.mode as FuryRetrievalMode : undefined;
            const { kb } = await knowledge();
            return json(await kb.search(String(body?.query ?? ''), { ...(mode ? { mode } : {}), ...(typeof body?.limit === 'number' ? { limit: body.limit } : {}) }));
          }
          case 'web': {
            const body = await readJson(request) as { action?: unknown; url?: unknown; query?: unknown; maxPages?: unknown };
            const net: FuryWebFetchOptions = { ...(options.webFetch ?? {}), ledger };
            const url = typeof body?.url === 'string' ? body.url : '';
            switch (body?.action) {
              case 'FETCH': {
                const doc = await furyWebFetch(url, net);
                const page = /html|xml/u.test(doc.contentType) ? furyWebExtract(doc.body, doc.url) : { title: '', description: '', headings: [], text: doc.body.slice(0, 200_000), links: [] };
                return json({ capability: 'FETCH+EXTRACT', url: doc.url, status: doc.status, contentType: doc.contentType, bytes: doc.bytes, sha256: doc.sha256, redirects: doc.redirects, receiptId: doc.receipt?.receiptId, title: page.title, description: page.description, headings: page.headings, text: page.text.slice(0, 20_000), links: page.links.slice(0, 200) });
              }
              case 'MAP': return json({ capability: 'MAP', ...(await furyWebMap(url, net)) });
              case 'CRAWL': return json({ capability: 'CRAWL', ...(await furyWebCrawl(url, { ...net, maxPages: typeof body.maxPages === 'number' ? Math.min(body.maxPages, 50) : 10 })) });
              case 'SEARCH': {
                const endpoint = options.searxngUrl ?? process.env.FURYPIPE_SEARXNG_URL;
                return json({ capability: 'SEARCH', ...(await furyWebSearch(String(body.query ?? ''), endpoint ? createFurySearxngAdapter(endpoint) : undefined)) });
              }
              default: return problem(400, 'invalid-input', 'action must be FETCH, MAP, CRAWL or SEARCH (browser actions go through the governed browser runtime)');
            }
          }
          case 'code-tree':
            return json(await code.tree(((await readJson(request)) as { path?: unknown })?.path ?? ''));
          case 'code-file':
            return json(await code.file(((await readJson(request)) as { path?: unknown })?.path));
          case 'code-worktrees': {
            // Attach the Mission Control workers (and their receipts) that ran in each worktree.
            const workers = [...runs.values()].flatMap((r) => (r.mission?.workers() ?? []).map((w) => ({ runId: r.runId, verdict: r.result?.judgement.verdict ?? null, taskId: w.taskId, role: w.role, state: w.state, worktree: w.worktree, receipts: w.receiptIds.length, harnessId: w.binding.harnessId })));
            const list = await code.worktrees();
            return json({ worktrees: list.map((w) => ({ ...w, workers: workers.filter((x) => x.worktree && path.resolve(x.worktree) === path.resolve(w.path)) })) });
          }
          case 'code-diff': {
            const body = await readJson(request) as { worktree?: unknown; base?: unknown };
            return json(await code.diff(body?.worktree, body?.base));
          }
          case 'chats':
            return json({ conversations: await chats.list() });
          case 'chat-get':
            return json(await chats.get(((await readJson(request)) as { id?: unknown })?.id));
          case 'chat-save': {
            const body = await readJson(request) as { id?: unknown; title?: unknown; messages?: unknown };
            return json(await chats.save({ ...(body?.id !== undefined ? { id: body.id } : {}), ...(body?.title !== undefined ? { title: body.title } : {}), messages: body?.messages }));
          }
          case 'chat-branch': {
            const body = await readJson(request) as { id?: unknown; atMessage?: unknown };
            return json(await chats.branch(body?.id, body?.atMessage), 201);
          }
          case 'chat-delete':
            return json(await chats.remove(((await readJson(request)) as { id?: unknown })?.id));
          case 'integrations': {
            const { sources } = await mcp.list();
            return json(await buildFuryIntegrationRegistry({ projectRoot: options.projectRoot, mcp: sources }));
          }
          case 'memory': {
            const m = memory();
            if (!m.enabled || !m.store) return json({ enabled: false, reason: m.reason, records: [] });
            return json({ enabled: true, status: await m.store.status(now()), records: await studioMemoryList(m.store, options.projectRoot, now()) });
          }
          case 'memory-remember': {
            const body = await readJson(request) as { text?: unknown; scope?: unknown; memoryClass?: unknown };
            if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 4_000) return problem(400, 'invalid-input', 'text is required (max 4000 characters)');
            if (body.scope !== 'project' && body.scope !== 'user') return problem(400, 'invalid-input', 'scope must be project or user');
            return json(await studioMemoryRemember(memoryStore(), options.projectRoot, { text: body.text.trim(), scope: body.scope, ...(typeof body.memoryClass === 'string' ? { memoryClass: body.memoryClass } : {}) }, now()), 201);
          }
          case 'memory-search': {
            const body = await readJson(request) as { query?: unknown };
            if (typeof body?.query !== 'string' || !body.query.trim() || body.query.length > 2_000) return problem(400, 'invalid-input', 'query is required');
            return json({ hits: await studioMemorySearch(memoryStore(), options.projectRoot, body.query, now()), authority: 'memory-data-only' });
          }
          case 'memory-act': {
            const body = await readJson(request) as { memoryId?: unknown; scope?: unknown; action?: unknown };
            if (typeof body?.memoryId !== 'string' || (body.scope !== 'project' && body.scope !== 'user')) return problem(400, 'invalid-input', 'memoryId and scope are required');
            const store = memoryStore();
            const selector = { memoryId: body.memoryId, scope: studioMemoryScopes(options.projectRoot)[body.scope], now: now() };
            if (body.action === 'DISABLE') return json(await store.disable(selector));
            if (body.action === 'ACTIVATE') return json(await store.activate(selector));
            if (body.action === 'FORGET') return json(await store.requestForget({ memoryId: body.memoryId, scope: selector.scope, hard: true, now: now() }));
            return problem(400, 'invalid-input', 'action must be DISABLE, ACTIVATE or FORGET');
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
        if (status) return problem(status, status === 503 ? 'discovery-failed' : status === 409 ? 'not-runnable' : 'invalid-request', (error as Error).message);
        if (error instanceof FuryIrError) return problem(422, 'invalid-ir', error.message);
        if (error instanceof FuryDispatchError) return problem(422, 'dispatch-rejected', error.message);
        if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPROTO'].includes((error as NodeJS.ErrnoException).code ?? '')) return problem(502, 'upstream-unreachable', `upstream unreachable (${(error as NodeJS.ErrnoException).code})`);
        if (error instanceof StudioCodeError) return problem(error.status, 'code-rejected', error.message);
        if (error instanceof StudioChatError) return problem(error.status, 'chat-rejected', error.message);
        if (error instanceof FuryWebError) return problem(error.code === 'blocked' ? 403 : error.code === 'not-configured' ? 409 : 502, `web-${error.code}`, error.message);
        if (error instanceof FuryKnowledgeError) return problem(422, 'knowledge-rejected', error.message);
        if (error instanceof FuryMcpHubError) return problem(/^unknown MCP source/u.test(error.message) ? 404 : 422, 'mcp-rejected', error.message);
        if (error instanceof FurySkillHubError) return problem(/^unknown skill/u.test(error.message) ? 404 : 422, 'skill-rejected', error.message);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return problem(404, 'not-found', 'path not found');
        if (error instanceof FuryFlowError) return problem(422, 'invalid-flow', error.message);
        if ((error as Error).name === 'FuryLocalFabricError') return problem(403, 'endpoint-denied', (error as Error).message);
        if ((error as Error).name === 'FuryGraphError') return problem(404, 'graph-unavailable', (error as Error).message);
        if (route.startsWith('memory')) return problem(422, 'memory-rejected', (error as Error).message.slice(0, 300));
        return problem(500, 'internal', 'studio request failed');
      }
    },
  });
}
