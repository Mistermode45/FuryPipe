import { createHash } from 'node:crypto';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import {
  createMcpDirectLifecycle,
  recordMcpDirectConnection,
  recordMcpDirectInventory,
  type McpDirectLifecycleState,
  type McpDirectSourceConfig,
} from './mcp-direct-governance.js';
import {
  assessMcpToolRisk,
  type McpToolBehaviorHints,
} from './mcp-tool-risk.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_LIST_TIMEOUT_MS = 15_000;
const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const DEFAULT_LIST_MAX_PAGES = 16;
const DEFAULT_STDIO_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const DEFAULT_HTTP_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_COUNT = 256;
const MAX_SCHEMA_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_STDIO_ARGS = 128;
const MAX_STDIO_ENV = 128;
const MAX_HTTP_HEADERS = 64;
const MAX_HEADER_VALUE = 8 * 1024;

export interface McpDirectClientInfo {
  readonly name: string;
  readonly version: string;
}

export interface McpDirectStdioRuntimeConfig {
  readonly source: McpDirectSourceConfig & { readonly transport: 'stdio' };
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly maxBufferBytes?: number;
}

export interface McpDirectHttpRuntimeConfig {
  readonly source: McpDirectSourceConfig & { readonly transport: 'streamable_http' };
  readonly url: string;
  /**
   * Explicit operator-owned allowlist for non-loopback remote hosts.
   * Loopback HTTP is allowed for local development; every non-loopback endpoint
   * must be HTTPS and present here.
   */
  readonly allowedHosts?: readonly string[];
  /**
   * Runtime-only request headers. Values may contain credentials but are never
   * copied into FuryPipe lifecycle evidence or receipts.
   */
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxResponseBytes?: number;
}

export type McpDirectRuntimeConfig =
  | McpDirectStdioRuntimeConfig
  | McpDirectHttpRuntimeConfig;

export interface McpDirectInventoryProbeOptions {
  readonly clientInfo: McpDirectClientInfo;
  readonly connectTimeoutMs?: number;
  readonly listTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  readonly listMaxPages?: number;
  readonly factory?: McpDirectSdkFactory;
}

export interface McpDirectInventoryProbeEvidence {
  readonly format: 'furypipe-mcp-direct-inventory-probe/v1';
  readonly lifecycle: McpDirectLifecycleState;
  readonly protocolVersion?: string;
  readonly toolCount: number;
}

interface SdkListTool {
  readonly name?: unknown;
  readonly inputSchema?: unknown;
  readonly annotations?: unknown;
}

interface SdkClientLike {
  connect(
    transport: unknown,
    options: { readonly timeout: number; readonly signal: AbortSignal },
  ): Promise<void>;
  listTools(options: {
    readonly timeout: number;
    readonly signal: AbortSignal;
    readonly cacheMode: 'refresh';
  }): Promise<{ readonly tools: readonly SdkListTool[] }>;
  getProtocolEra(): 'modern' | 'legacy' | undefined;
  getNegotiatedProtocolVersion(): string | undefined;
  close(): Promise<void>;
}

export interface McpDirectSdkFactory {
  createClient(
    clientInfo: McpDirectClientInfo,
    options: {
      readonly listMaxPages: number;
      readonly probeTimeoutMs: number;
    },
  ): SdkClientLike;
  createStdioTransport(config: {
    readonly command: string;
    readonly args: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly cwd?: string;
    readonly maxBufferBytes: number;
  }): unknown;
  createHttpTransport(config: {
    readonly url: URL;
    readonly headers: Readonly<Record<string, string>>;
    readonly maxResponseBytes: number;
  }): unknown;
}

async function fetchWithResponseLimit(
  input: string | URL | Request,
  init: RequestInit | undefined,
  maxResponseBytes: number,
): Promise<Response> {
  const response = await globalThis.fetch(input, init);
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader !== null) {
    const declared = Number(lengthHeader);
    if (Number.isFinite(declared) && declared > maxResponseBytes) {
      await response.body?.cancel().catch(() => {});
      throw new Error('MCP HTTP response exceeds the configured byte bound');
    }
  }
  if (response.body === null) return response;

  const reader = response.body.getReader();
  let received = 0;
  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          return;
        }
        received += next.value.byteLength;
        if (received > maxResponseBytes) {
          await reader.cancel('MCP HTTP response byte bound exceeded').catch(() => {});
          controller.error(new Error('MCP HTTP response exceeds the configured byte bound'));
          return;
        }
        controller.enqueue(next.value);
      } catch (caught) {
        controller.error(caught);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  });

  return new Response(boundedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

const DEFAULT_FACTORY: McpDirectSdkFactory = Object.freeze({
  createClient(
    clientInfo: McpDirectClientInfo,
    options: { readonly listMaxPages: number; readonly probeTimeoutMs: number },
  ) {
    const client = new Client(
      { name: clientInfo.name, version: clientInfo.version },
      {
        versionNegotiation: {
          mode: 'auto',
          probe: {
            timeoutMs: options.probeTimeoutMs,
            maxRetries: 0,
          },
        },
        listMaxPages: options.listMaxPages,
        defaultCacheTtlMs: 0,
      },
    );
    return {
      connect: (
        transport: unknown,
        connectOptions: { readonly timeout: number; readonly signal: AbortSignal },
      ) => client.connect(
        transport as Parameters<Client['connect']>[0],
        connectOptions,
      ),
      listTools: async (listOptions: {
        readonly timeout: number;
        readonly signal: AbortSignal;
        readonly cacheMode: 'refresh';
      }) => client.listTools(undefined, {
        ...listOptions,
        cacheMode: 'refresh',
      }),
      getProtocolEra: () => client.getProtocolEra(),
      getNegotiatedProtocolVersion: () => client.getNegotiatedProtocolVersion(),
      close: () => client.close(),
    };
  },

  createStdioTransport(config: Parameters<McpDirectSdkFactory['createStdioTransport']>[0]) {
    const transport = new StdioClientTransport({
      command: config.command,
      args: [...config.args],
      ...(config.env === undefined ? {} : { env: { ...config.env } }),
      ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
      stderr: 'pipe',
      maxBufferSize: config.maxBufferBytes,
    });
    // Drain child stderr so a noisy server cannot backpressure its own process.
    // Nothing from stderr is persisted into FuryPipe evidence.
    const stderr = transport.stderr as { resume?: () => unknown } | null;
    stderr?.resume?.();
    return transport;
  },

  createHttpTransport(config: Parameters<McpDirectSdkFactory['createHttpTransport']>[0]) {
    return new StreamableHTTPClientTransport(config.url, {
      fetch: (input: string | URL | Request, init?: RequestInit) =>
        fetchWithResponseLimit(input, init, config.maxResponseBytes),
      requestInit: {
        headers: { ...config.headers },
        // Direct MCP endpoints are source-bound. Never silently follow a
        // redirect to a different origin/private address.
        redirect: 'manual',
      },
      // M1 is inventory-only: background reconnect loops are unnecessary and
      // would create ambiguous liveness evidence.
      reconnectionOptions: {
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 1_000,
        reconnectionDelayGrowFactor: 1,
        maxRetries: 0,
      },
      onInsufficientScope: 'throw',
      maxStepUpRetries: 0,
    });
  },
});

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function assertClientInfo(info: McpDirectClientInfo): void {
  if (
    !info
    || typeof info.name !== 'string'
    || info.name.trim().length < 1
    || info.name.length > 128
    || /[\u0000-\u001f\u007f]/u.test(info.name)
  ) {
    throw new Error('MCP client name must be a bounded printable string');
  }
  if (
    typeof info.version !== 'string'
    || info.version.trim().length < 1
    || info.version.length > 64
    || /[\u0000-\u001f\u007f]/u.test(info.version)
  ) {
    throw new Error('MCP client version must be a bounded printable string');
  }
}

function assertStdioConfig(config: McpDirectStdioRuntimeConfig): void {
  if (
    typeof config.command !== 'string'
    || config.command.trim().length < 1
    || config.command.length > 1_024
    || /[\u0000-\u001f\u007f]/u.test(config.command)
  ) {
    throw new Error('MCP stdio command must be a bounded printable string');
  }

  const args = config.args ?? [];
  if (!Array.isArray(args) || args.length > MAX_STDIO_ARGS) {
    throw new Error('MCP stdio args exceed the 128 argument bound');
  }
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length > 4_096 || /[\u0000]/u.test(arg)) {
      throw new Error('MCP stdio argument is invalid or too large');
    }
  }

  if (config.cwd !== undefined && (
    typeof config.cwd !== 'string'
    || config.cwd.length < 1
    || config.cwd.length > 4_096
    || /[\u0000]/u.test(config.cwd)
  )) {
    throw new Error('MCP stdio cwd is invalid or too large');
  }

  if (config.env !== undefined) {
    const entries = Object.entries(config.env);
    if (entries.length > MAX_STDIO_ENV) {
      throw new Error('MCP stdio env exceeds the 128 variable bound');
    }
    for (const [name, value] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(name)) {
        throw new Error('MCP stdio env name is invalid');
      }
      if (typeof value !== 'string' || value.length > 16_384 || /[\u0000]/u.test(value)) {
        throw new Error('MCP stdio env value is invalid or too large');
      }
    }
  }
}

function normalizeHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function validatedHttpConfig(config: McpDirectHttpRuntimeConfig): {
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
} {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error('MCP Streamable HTTP URL is invalid');
  }
  if (url.username || url.password) {
    throw new Error('MCP Streamable HTTP URL must not contain credentials');
  }
  if (url.hash) {
    throw new Error('MCP Streamable HTTP URL must not contain a fragment');
  }
  if (url.search) {
    throw new Error('MCP Streamable HTTP URL must not contain a query string; use runtime headers for credentials');
  }

  const host = normalizeHost(url.hostname);
  const loopback = isLoopbackHost(host);
  if (loopback) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('loopback MCP URL must use http or https');
    }
  } else {
    if (url.protocol !== 'https:') {
      throw new Error('non-loopback MCP URL must use https');
    }
    const allowed = new Set((config.allowedHosts ?? []).map(normalizeHost));
    if (!allowed.has(host)) {
      throw new Error('non-loopback MCP host is not explicitly allowlisted');
    }
  }

  const entries = Object.entries(config.headers ?? {});
  if (entries.length > MAX_HTTP_HEADERS) {
    throw new Error('MCP HTTP headers exceed the 64 header bound');
  }
  const headers: Record<string, string> = {};
  const reserved = new Set([
    'host',
    'content-length',
    'connection',
    'transfer-encoding',
    'mcp-protocol-version',
    'mcp-session-id',
    'mcp-method',
    'mcp-name',
  ]);
  for (const [rawName, value] of entries) {
    const name = rawName.trim();
    const lower = name.toLowerCase();
    if (!/^[A-Za-z0-9-]{1,128}$/u.test(name) || reserved.has(lower)) {
      throw new Error('MCP HTTP header name is invalid or reserved');
    }
    if (
      typeof value !== 'string'
      || value.length > MAX_HEADER_VALUE
      || /[\u0000\r\n]/u.test(value)
    ) {
      throw new Error('MCP HTTP header value is invalid or too large');
    }
    headers[name] = value;
  }

  return Object.freeze({ url, headers: Object.freeze(headers) });
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new Error('MCP tool input schema is not JSON-serializable');
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_SCHEMA_BYTES) {
    throw new Error('MCP tool input schema exceeds the 1 MiB bound');
  }
  const parsed = JSON.parse(serialized) as unknown;

  const normalize = (input: unknown, depth: number): unknown => {
    if (depth > MAX_JSON_DEPTH) throw new Error('MCP tool input schema exceeds the depth bound');
    if (input === null || typeof input !== 'object') return input;
    if (Array.isArray(input)) return input.map((entry) => normalize(entry, depth + 1));
    const object = input as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, normalize(object[key], depth + 1)]),
    );
  };

  return JSON.stringify(normalize(parsed, 0));
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function behaviorHints(value: unknown): McpToolBehaviorHints | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const hints: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } = {};
  if (typeof source.readOnlyHint === 'boolean') hints.readOnlyHint = source.readOnlyHint;
  if (typeof source.destructiveHint === 'boolean') hints.destructiveHint = source.destructiveHint;
  if (typeof source.idempotentHint === 'boolean') hints.idempotentHint = source.idempotentHint;
  if (typeof source.openWorldHint === 'boolean') hints.openWorldHint = source.openWorldHint;
  return Object.keys(hints).length === 0 ? undefined : Object.freeze(hints);
}

function normalizedInventory(
  tools: readonly SdkListTool[],
  source: McpDirectSourceConfig,
): Parameters<typeof recordMcpDirectInventory>[1] {
  if (!Array.isArray(tools) || tools.length > MAX_TOOL_COUNT) {
    throw new Error('MCP tool inventory exceeds the 256 tool bound');
  }
  return Object.freeze(tools.map((tool) => {
    if (!tool || typeof tool !== 'object') throw new Error('MCP tool definition must be an object');
    if (typeof tool.name !== 'string') throw new Error('MCP tool name is missing');
    if (tool.inputSchema === undefined) throw new Error('MCP tool input schema is missing');
    return Object.freeze({
      name: tool.name,
      inputSchemaSha256: sha256Json(tool.inputSchema),
      risk: assessMcpToolRisk(behaviorHints(tool.annotations), source.trust),
    });
  }));
}

function createTimeout(
  timeoutMs: number,
  label: string,
): { readonly signal: AbortSignal; readonly cancel: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeoutMs);
  timeout.unref?.();
  return Object.freeze({
    signal: controller.signal,
    cancel: () => clearTimeout(timeout),
  });
}

function transportFor(
  config: McpDirectRuntimeConfig,
  factory: McpDirectSdkFactory,
): unknown {
  if (config.source.transport === 'stdio') {
    if (!('command' in config)) throw new Error('MCP source transport/config mismatch');
    assertStdioConfig(config);
    const maxBufferBytes = boundedInteger(
      config.maxBufferBytes,
      DEFAULT_STDIO_MAX_BUFFER_BYTES,
      64 * 1024,
      16 * 1024 * 1024,
      'MCP stdio maxBufferBytes',
    );
    return factory.createStdioTransport({
      command: config.command,
      args: Object.freeze([...(config.args ?? [])]),
      ...(config.env === undefined ? {} : { env: Object.freeze({ ...config.env }) }),
      ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
      maxBufferBytes,
    });
  }

  if (!('url' in config)) throw new Error('MCP source transport/config mismatch');
  const http = validatedHttpConfig(config);
  const maxResponseBytes = boundedInteger(
    config.maxResponseBytes,
    DEFAULT_HTTP_MAX_RESPONSE_BYTES,
    64 * 1024,
    16 * 1024 * 1024,
    'MCP HTTP maxResponseBytes',
  );
  return factory.createHttpTransport({ ...http, maxResponseBytes });
}

/**
 * Derives the source identity from the actual non-secret endpoint definition.
 * HTTP credentials/headers and stdio env values are deliberately excluded.
 * Stdio args are identity-bearing and therefore must not contain secrets; pass
 * secrets through env instead.
 */
export function deriveMcpDirectEndpointFingerprint(
  config: McpDirectRuntimeConfig,
): string {
  if (config.source.transport === 'stdio') {
    if (!('command' in config)) throw new Error('MCP source transport/config mismatch');
    assertStdioConfig(config);
    return sha256Json({
      transport: 'stdio',
      command: config.command,
      args: [...(config.args ?? [])],
      cwd: config.cwd ?? null,
    });
  }
  if (!('url' in config)) throw new Error('MCP source transport/config mismatch');
  const http = validatedHttpConfig(config);
  return sha256Json({
    transport: 'streamable_http',
    url: http.url.toString(),
  });
}

/**
 * Connects a FuryPipe-owned MCP client, negotiates protocol era, performs one
 * bounded tools/list inventory request, then closes the client.
 *
 * M1 is deliberately inventory-only. This function has no tool-execution
 * method and returns no execution authority.
 */
export async function probeMcpDirectInventory(
  config: McpDirectRuntimeConfig,
  options: McpDirectInventoryProbeOptions,
): Promise<McpDirectInventoryProbeEvidence> {
  assertClientInfo(options.clientInfo);
  const connectTimeoutMs = boundedInteger(
    options.connectTimeoutMs,
    DEFAULT_CONNECT_TIMEOUT_MS,
    100,
    60_000,
    'MCP connectTimeoutMs',
  );
  const listTimeoutMs = boundedInteger(
    options.listTimeoutMs,
    DEFAULT_LIST_TIMEOUT_MS,
    100,
    60_000,
    'MCP listTimeoutMs',
  );
  const probeTimeoutMs = boundedInteger(
    options.probeTimeoutMs,
    DEFAULT_PROBE_TIMEOUT_MS,
    100,
    15_000,
    'MCP probeTimeoutMs',
  );
  const listMaxPages = boundedInteger(
    options.listMaxPages,
    DEFAULT_LIST_MAX_PAGES,
    1,
    32,
    'MCP listMaxPages',
  );

  const derivedEndpointFingerprint = deriveMcpDirectEndpointFingerprint(config);
  if (derivedEndpointFingerprint !== config.source.endpointFingerprint) {
    throw new Error('MCP source endpoint fingerprint does not match the runtime endpoint');
  }

  let lifecycle = createMcpDirectLifecycle(config.source);
  const factory = options.factory ?? DEFAULT_FACTORY;
  const client = factory.createClient(options.clientInfo, { listMaxPages, probeTimeoutMs });
  const transport = transportFor(config, factory);
  let primaryError: unknown;

  try {
    const connectDeadline = createTimeout(connectTimeoutMs, 'MCP connect');
    try {
      await client.connect(transport, {
        timeout: connectTimeoutMs,
        signal: connectDeadline.signal,
      });
    } finally {
      connectDeadline.cancel();
    }

    const era = client.getProtocolEra();
    if (era === undefined) {
      throw new Error('MCP client connected without negotiated protocol era evidence');
    }
    lifecycle = recordMcpDirectConnection(lifecycle, era === 'modern'
      ? { protocolEra: 'modern_2026', handshake: 'discover' }
      : { protocolEra: 'legacy_2025', handshake: 'initialize' });

    const listDeadline = createTimeout(listTimeoutMs, 'MCP tools/list');
    let result: { readonly tools: readonly SdkListTool[] };
    try {
      result = await client.listTools({
        timeout: listTimeoutMs,
        signal: listDeadline.signal,
        cacheMode: 'refresh',
      });
    } finally {
      listDeadline.cancel();
    }

    const inventory = normalizedInventory(result.tools, config.source);
    lifecycle = recordMcpDirectInventory(lifecycle, inventory);

    return Object.freeze({
      format: 'furypipe-mcp-direct-inventory-probe/v1',
      lifecycle,
      ...(client.getNegotiatedProtocolVersion() === undefined
        ? {}
        : { protocolVersion: client.getNegotiatedProtocolVersion() }),
      toolCount: inventory.length,
    });
  } catch (caught) {
    primaryError = caught;
    throw caught;
  } finally {
    try {
      await client.close();
    } catch (closeError) {
      if (primaryError === undefined) throw closeError;
    }
  }
}
