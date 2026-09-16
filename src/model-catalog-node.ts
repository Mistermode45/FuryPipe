import {
  normalizeAnthropicModelsPayload,
  normalizeGeminiModelsPayload,
  normalizeMistralModelsPayload,
  normalizeOpenAIModelsPayload,
  normalizeOpenRouterModelsPayload,
  normalizeXaiModelsPayload,
  registerRuntimeModelCatalog,
  type ModelFabricEntry,
} from './core/model-fabric.js';

export type NodeModelCatalogProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'mistral'
  | 'openrouter';

export interface NodeModelCatalogProviderResult {
  readonly provider: NodeModelCatalogProvider;
  readonly status: 'refreshed' | 'not_configured' | 'failed';
  readonly models: number;
  readonly httpStatus?: number;
  readonly reason?: 'credentials_missing' | 'http_error' | 'timeout' | 'invalid_payload' | 'payload_too_large' | 'network_error';
}

export interface NodeModelCatalogRefreshReport {
  readonly format: 'furypipe-model-catalog-refresh/v1';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly providers: readonly NodeModelCatalogProviderResult[];
  readonly registeredModels: number;
}

export interface NodeModelCatalogRefreshOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly register?: boolean;
}

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 20;

class CatalogFetchError extends Error {
  constructor(
    readonly reason: NonNullable<NodeModelCatalogProviderResult['reason']>,
    readonly httpStatus?: number,
  ) {
    super(reason);
  }
}

function firstEnv(env: Readonly<Record<string, string | undefined>>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) throw new CatalogFetchError('payload_too_large');

  if (response.body === null) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new CatalogFetchError('payload_too_large');
    try {
      return JSON.parse(text);
    } catch {
      throw new CatalogFetchError('invalid_payload');
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new CatalogFetchError('payload_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    throw new CatalogFetchError('invalid_payload');
  }
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxBytes: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (caught) {
      if (controller.signal.aborted) throw new CatalogFetchError('timeout');
      throw new CatalogFetchError('network_error');
    }
    if (!response.ok) throw new CatalogFetchError('http_error', response.status);
    return await readBoundedJson(response, maxBytes);
  } finally {
    clearTimeout(timer);
  }
}

function arrayLength(payload: unknown, key: string): number {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length : 0;
}

async function refreshSimple(
  provider: NodeModelCatalogProvider,
  configured: boolean,
  fetcher: () => Promise<readonly ModelFabricEntry[]>,
): Promise<{ result: NodeModelCatalogProviderResult; entries: readonly ModelFabricEntry[] }> {
  if (!configured) {
    return {
      result: Object.freeze({
        provider,
        status: 'not_configured',
        models: 0,
        reason: 'credentials_missing',
      }),
      entries: Object.freeze([]),
    };
  }
  try {
    const entries = await fetcher();
    return {
      result: Object.freeze({ provider, status: 'refreshed', models: entries.length }),
      entries,
    };
  } catch (caught) {
    const error = caught instanceof CatalogFetchError ? caught : new CatalogFetchError('network_error');
    return {
      result: Object.freeze({
        provider,
        status: 'failed',
        models: 0,
        reason: error.reason,
        ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
      }),
      entries: Object.freeze([]),
    };
  }
}

/**
 * Refresh only provider catalogs for which explicit credentials are available.
 * This function never sends credentials to the dashboard and never blocks a
 * proxy request.  Callers should invoke it at startup/background refresh
 * boundaries, not from the hot path.
 */
export async function refreshRuntimeModelCatalog(
  options: NodeModelCatalogRefreshOptions = {},
): Promise<NodeModelCatalogRefreshReport> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(250, Math.min(30_000, Math.floor(options.timeoutMs!)))
    : DEFAULT_TIMEOUT_MS;
  const maxBytes = Number.isFinite(options.maxResponseBytes)
    ? Math.max(4_096, Math.min(20 * 1024 * 1024, Math.floor(options.maxResponseBytes!)))
    : DEFAULT_MAX_RESPONSE_BYTES;
  const startedAt = new Date().toISOString();

  const anthropicKey = firstEnv(env, ['ANTHROPIC_API_KEY']);
  const openAIKey = firstEnv(env, ['OPENAI_API_KEY']);
  const googleKey = firstEnv(env, ['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
  const xaiKey = firstEnv(env, ['XAI_API_KEY']);
  const mistralKey = firstEnv(env, ['MISTRAL_API_KEY']);
  const openRouterKey = firstEnv(env, ['OPENROUTER_API_KEY']);

  const jobs = await Promise.all([
    refreshSimple('anthropic', anthropicKey !== undefined, async () => {
      const payload = await fetchJson(fetchImpl, 'https://api.anthropic.com/v1/models?limit=1000', {
        headers: {
          'x-api-key': anthropicKey!,
          'anthropic-version': '2023-06-01',
        },
      }, timeoutMs, maxBytes);
      return normalizeAnthropicModelsPayload(payload);
    }),

    refreshSimple('openai', openAIKey !== undefined, async () => {
      const payload = await fetchJson(fetchImpl, 'https://api.openai.com/v1/models', {
        headers: { authorization: `Bearer ${openAIKey!}` },
      }, timeoutMs, maxBytes);
      return normalizeOpenAIModelsPayload(payload);
    }),

    refreshSimple('google', googleKey !== undefined, async () => {
      const entries: ModelFabricEntry[] = [];
      let pageToken: string | undefined;
      const seenPageTokens = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        // Gemini REST supports x-goog-api-key. Keep credentials out of URLs so
        // proxy/access logs and thrown URL diagnostics cannot accidentally
        // retain a reusable API key.
        const payload = await fetchJson(fetchImpl, url.toString(), {
          headers: { 'x-goog-api-key': googleKey! },
        }, timeoutMs, maxBytes);
        entries.push(...normalizeGeminiModelsPayload(payload));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) break;
        const next = (payload as Record<string, unknown>).nextPageToken;
        pageToken = typeof next === 'string' && next ? next : undefined;
        if (!pageToken) break;
        if (seenPageTokens.has(pageToken)) throw new CatalogFetchError('invalid_payload');
        seenPageTokens.add(pageToken);
      }
      return Object.freeze(entries);
    }),

    refreshSimple('xai', xaiKey !== undefined, async () => {
      const payload = await fetchJson(fetchImpl, 'https://api.x.ai/v1/language-models', {
        headers: { authorization: `Bearer ${xaiKey!}` },
      }, timeoutMs, maxBytes);
      return normalizeXaiModelsPayload(payload);
    }),

    refreshSimple('mistral', mistralKey !== undefined, async () => {
      const payload = await fetchJson(fetchImpl, 'https://api.mistral.ai/v1/models', {
        headers: { authorization: `Bearer ${mistralKey!}` },
      }, timeoutMs, maxBytes);
      return normalizeMistralModelsPayload(payload);
    }),

    refreshSimple('openrouter', openRouterKey !== undefined, async () => {
      const payload = await fetchJson(fetchImpl, 'https://openrouter.ai/api/v1/models', {
        headers: { authorization: `Bearer ${openRouterKey!}` },
      }, timeoutMs, maxBytes);
      return normalizeOpenRouterModelsPayload(payload);
    }),
  ]);

  const entries = jobs.flatMap((job) => [...job.entries]);
  if (options.register !== false && entries.length > 0) registerRuntimeModelCatalog(entries);

  // Silence an otherwise-unused helper only after its invariant is covered by
  // tests; it intentionally rejects provider schema drift by returning 0.
  void arrayLength;

  return Object.freeze({
    format: 'furypipe-model-catalog-refresh/v1',
    startedAt,
    completedAt: new Date().toISOString(),
    providers: Object.freeze(jobs.map((job) => job.result)),
    registeredModels: entries.length,
  });
}
