import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  originValidationResponse,
  hostHeaderValidationResponse,
  isJsonContentType,
  oauthMetadataResponse,
  parseJSONRPCMessage,
  requireBearerAuth,
  type AuthInfo,
  type AuthMetadataOptions,
  type BearerAuthOptions,
  type JsonSchemaType,
  type McpHttpHandler,
  type JSONRPCMessage,
  type Transport,
  type TransportSendOptions,
} from '@modelcontextprotocol/server';
import {
  serveStdio,
  StdioServerTransport,
  type ServeStdioOptions,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio';
import {
  executeMcpTool,
  furypipeMcpVersion,
  TOOLS,
} from './mcp.js';
import type { RecoveryStore } from './core/recovery-store.js';
import { MAX_MESSAGE_BYTES } from './mcp.js';

export const MCP_HTTP_MAX_REQUEST_BYTES = MAX_MESSAGE_BYTES;
export const MCP_HTTP_DEFAULT_TIMEOUT_MS = 30_000;

export interface ProductionMcpHttpOptions {
  /** Hostname allowlist used for DNS-rebinding protection. Ports are not allowed. */
  readonly allowedHostnames: readonly string[];
  /** Browser Origin hostname allowlist. Defaults to the Host allowlist. */
  readonly allowedOriginHostnames?: readonly string[];
  /** OAuth 2.0 Resource Server verification. Omit only for explicit loopback mode. */
  readonly bearerAuth?: BearerAuthOptions;
  /** Optional RFC 9728/RFC 8414 discovery documents served by this handler. */
  readonly oauthMetadata?: AuthMetadataOptions;
  /** Explicit unauthenticated mode; construction rejects non-loopback hosts. */
  readonly allowUnauthenticatedLoopback?: boolean;
  /** Maximum encoded HTTP request body, including JSON envelope. */
  readonly maxRequestBytes?: number;
  /** Upper bound for one request exchange; request aborts are propagated too. */
  readonly timeoutMs?: number;
}

export interface ProductionMcpHttpHandler extends McpHttpHandler {}

export interface ProductionMcpRuntimeEvidence {
  readonly format: 'furypipe-mcp-http-runtime-evidence/v1';
  readonly requests: number;
  readonly dispatchedRequests: number;
  readonly bearerAuthConfigured: boolean;
  readonly bearerAuthSuccesses: number;
  readonly oauthMetadataConfigured: boolean;
  readonly oauthMetadataResponses: number;
}

export interface ProductionMcpStdioRuntimeEvidence {
  readonly format: 'furypipe-mcp-stdio-runtime-evidence/v1';
  readonly inboundMessages: number;
  readonly inboundRequests: number;
  readonly outboundMessages: number;
  readonly completedExchanges: number;
  readonly trackingOverflows: number;
}

interface MutableProductionMcpRuntimeEvidence {
  requests: number;
  dispatchedRequests: number;
  bearerAuthConfigured: boolean;
  bearerAuthSuccesses: number;
  oauthMetadataConfigured: boolean;
  oauthMetadataResponses: number;
}

interface MutableProductionMcpStdioRuntimeEvidence {
  inboundMessages: number;
  inboundRequests: number;
  outboundMessages: number;
  completedExchanges: number;
  trackingOverflows: number;
}

const MAX_MCP_RUNTIME_COUNT = 1_000_000_000;
const MAX_MCP_STDIO_PENDING_REQUESTS = 4_096;
const MAX_MCP_STDIO_REQUEST_ID_LENGTH = 256;
const PRODUCTION_MCP_RUNTIME_EVIDENCE = new WeakMap<object, MutableProductionMcpRuntimeEvidence>();
const PRODUCTION_MCP_STDIO_RUNTIME_EVIDENCE = new WeakMap<object, MutableProductionMcpStdioRuntimeEvidence>();
const GENERATED_MCP_STDIO_HANDLES = new WeakSet<object>();

function incrementRuntimeCounter(value: number): number {
  return value >= MAX_MCP_RUNTIME_COUNT ? MAX_MCP_RUNTIME_COUNT : value + 1;
}

/**
 * Read bounded metadata-only evidence from an exact process-local production
 * MCP HTTP handler. Copies and hand-crafted lookalikes return undefined.
 */
export function getProductionMcpRuntimeEvidence(value: unknown): ProductionMcpRuntimeEvidence | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  const state = PRODUCTION_MCP_RUNTIME_EVIDENCE.get(value as object);
  if (state === undefined) return undefined;
  return Object.freeze({
    format: 'furypipe-mcp-http-runtime-evidence/v1' as const,
    requests: state.requests,
    dispatchedRequests: state.dispatchedRequests,
    bearerAuthConfigured: state.bearerAuthConfigured,
    bearerAuthSuccesses: state.bearerAuthSuccesses,
    oauthMetadataConfigured: state.oauthMetadataConfigured,
    oauthMetadataResponses: state.oauthMetadataResponses,
  });
}


/**
 * Read bounded metadata-only evidence from an exact process-local stdio handle.
 * Request bodies, method names, tool arguments, response payloads and request
 * IDs are never returned by this surface.
 */
export function getProductionMcpStdioRuntimeEvidence(
  value: unknown,
): ProductionMcpStdioRuntimeEvidence | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  const state = PRODUCTION_MCP_STDIO_RUNTIME_EVIDENCE.get(value as object);
  if (state === undefined) return undefined;
  return Object.freeze({
    format: 'furypipe-mcp-stdio-runtime-evidence/v1' as const,
    inboundMessages: state.inboundMessages,
    inboundRequests: state.inboundRequests,
    outboundMessages: state.outboundMessages,
    completedExchanges: state.completedExchanges,
    trackingOverflows: state.trackingOverflows,
  });
}

/** Exact process-local identity check for handles returned by runModernMcpStdio(). */
export function isGeneratedModernMcpStdioHandle(value: unknown): boolean {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && GENERATED_MCP_STDIO_HANDLES.has(value as object);
}

function toolArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

/** Build the same recovery surface for MCP 2026 and the SDK legacy fallback. */
export function createModernMcpServer(store: RecoveryStore): McpServer {
  const server = new McpServer(
    { name: 'furypipe-recovery', version: furypipeMcpVersion() },
    { capabilities: { tools: {} } },
  );

  for (const definition of TOOLS) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: fromJsonSchema(definition.inputSchema as JsonSchemaType),
      },
      async (rawArgs) => executeMcpTool(store, definition.name, toolArgs(rawArgs)),
    );
  }
  return server;
}

/** Fetch-native handler for modern MCP HTTP exchanges and stateless legacy fallback. */
export function createModernMcpHandler(store: RecoveryStore): McpHttpHandler {
  return createMcpHandler(() => createModernMcpServer(store), { legacy: 'stateless' });
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.trim().toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function boundedOption(value: number | undefined, fallback: number, name: string, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new RangeError(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return resolved;
}

function jsonRpcHttpError(status: number, code: number, message: string, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code, message },
  }), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get('vary');
  const values = current?.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!values.includes(value.toLowerCase())) values.push(value.toLowerCase());
  headers.set('vary', values.join(', '));
}

/** Add only response metadata that is safe after the Origin gate has passed. */
function withHttpResponseHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('origin');
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-expose-headers', 'MCP-Protocol-Version');
    appendVary(headers, 'Origin');
  }
  headers.set('x-content-type-options', 'nosniff');
  if (request.method === 'POST') headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function acceptsMcpResponse(value: string | null): boolean {
  if (value === null) return false;
  const accepted = new Set(value.split(',').flatMap((part) => {
    const [mediaType, ...parameters] = part.trim().toLowerCase().split(';');
    if (mediaType !== 'application/json' && mediaType !== 'text/event-stream') return [];
    const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
    return quality === undefined || Number(quality.trim().slice(2)) > 0 ? [mediaType] : [];
  }));
  // The SDK's legacy Streamable HTTP contract requires both possible response
  // media types, and modern clients already send this pair.
  return accepted.has('application/json') && accepted.has('text/event-stream');
}

function requestBody(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function modernEnvelope(value: Record<string, unknown>, request: Request): boolean {
  if (request.headers.get('mcp-protocol-version') === '2026-07-28') return true;
  const params = requestBody(value.params);
  const metadata = requestBody(params?._meta);
  return metadata?.['io.modelcontextprotocol/protocolVersion'] === '2026-07-28';
}

function validateModernRoutingHeaders(value: Record<string, unknown>, request: Request): Response | undefined {
  if (!modernEnvelope(value, request)) return undefined;
  const params = requestBody(value.params);
  const metadata = requestBody(params?._meta);
  const bodyVersion = typeof metadata?.['io.modelcontextprotocol/protocolVersion'] === 'string'
    ? metadata['io.modelcontextprotocol/protocolVersion']
    : undefined;
  const headerVersion = request.headers.get('mcp-protocol-version');
  // 2026-07-28 requires the per-request body claim and HTTP header to agree.
  // Leave a header-only modern request to the SDK so it can return the
  // canonical missing-envelope -32602 response.
  if (bodyVersion !== undefined && headerVersion !== bodyVersion) {
    return jsonRpcHttpError(400, -32020, 'MCP-Protocol-Version must match the request envelope');
  }
  const method = typeof value.method === 'string' ? value.method : undefined;
  const routeMethod = request.headers.get('mcp-method');
  if (!method || routeMethod !== method) {
    return jsonRpcHttpError(400, -32020, 'Mcp-Method must match the JSON-RPC method');
  }
  if (method === 'tools/call') {
    const params = requestBody(value.params);
    const toolName = typeof params?.name === 'string' ? params.name : undefined;
    if (!toolName || request.headers.get('mcp-name') !== toolName) {
      return jsonRpcHttpError(400, -32020, 'Mcp-Name must match the called tool');
    }
  }
  return undefined;
}

type DeadlineOutcome<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'error' }
  | { readonly kind: 'timeout' };

async function settleBeforeDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<DeadlineOutcome<T>> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return { kind: 'timeout' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ kind: 'value' as const, value }),
        () => ({ kind: 'error' as const }),
      ),
      new Promise<{ readonly kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readAndValidateBody(
  request: Request,
  maxBytes: number,
  deadlineAt: number,
): Promise<{ bytes: Uint8Array; value: Record<string, unknown> } | Response> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) return jsonRpcHttpError(400, -32600, 'invalid Content-Length');
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared)) return jsonRpcHttpError(400, -32600, 'invalid Content-Length');
    if (declared > maxBytes) return jsonRpcHttpError(413, -32600, 'request body exceeds limit');
  }
  let bytes: Uint8Array;
  try {
    const body = request.body;
    if (body === null) {
      bytes = new Uint8Array();
    } else {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const outcome = await settleBeforeDeadline(reader.read(), deadlineAt);
          if (outcome.kind === 'timeout') {
            void reader.cancel().catch(() => undefined);
            return jsonRpcHttpError(504, -32603, 'MCP request timed out');
          }
          if (outcome.kind === 'error') {
            return request.signal.aborted
              ? jsonRpcHttpError(499, -32603, 'request cancelled')
              : jsonRpcHttpError(400, -32700, 'unable to read request body');
          }
          const { value, done } = outcome.value;
          if (done) break;
          if (value === undefined) continue;
          if (value.byteLength > maxBytes - total) {
            await reader.cancel();
            return jsonRpcHttpError(413, -32600, 'request body exceeds limit');
          }
          chunks.push(value);
          total += value.byteLength;
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // A timed-out read may still be settling while cancellation propagates.
        }
      }
      bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
  } catch {
    return request.signal.aborted
      ? jsonRpcHttpError(499, -32603, 'request cancelled')
      : jsonRpcHttpError(400, -32700, 'unable to read request body');
  }
  if (Date.now() >= deadlineAt) return jsonRpcHttpError(504, -32603, 'MCP request timed out');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    parseJSONRPCMessage(value);
  } catch {
    return jsonRpcHttpError(400, -32700, 'invalid JSON-RPC body');
  }
  const object = requestBody(value);
  if (!object) return jsonRpcHttpError(400, -32600, 'JSON-RPC body must be one message object');
  return { bytes, value: object };
}

async function runWithDeadline(
  handler: McpHttpHandler,
  request: Request,
  body: Uint8Array,
  deadlineAt: number,
  authInfo?: AuthInfo,
): Promise<Response> {
  if (request.signal.aborted) return jsonRpcHttpError(499, -32603, 'request cancelled');
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return jsonRpcHttpError(504, -32603, 'MCP request timed out');
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener('abort', onAbort, { once: true });
  let resolveTimeout: ((value: { kind: 'timeout' }) => void) | undefined;
  const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
    resolveTimeout = resolve;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('MCP request timed out', 'TimeoutError'));
    resolveTimeout?.({ kind: 'timeout' });
  }, remainingMs);
  // TypeScript 7 models Uint8Array<ArrayBufferLike> more narrowly than the
  // web Request constructor, while the runtime accepts this exact byte body.
  const downstream = new Request(request, { body: body as unknown as BodyInit, signal: controller.signal });
  const responsePromise = handler.fetch(downstream, authInfo === undefined ? undefined : { authInfo });
  try {
    const outcome = await Promise.race([
      responsePromise.then((response) => ({ kind: 'response' as const, response }), () => ({ kind: 'error' as const })),
      timeoutPromise,
    ]);
    if (outcome.kind === 'timeout') return jsonRpcHttpError(504, -32603, 'MCP request timed out');
    if (outcome.kind === 'error') {
      if (timedOut || request.signal.aborted) return jsonRpcHttpError(request.signal.aborted ? 499 : 504, -32603, request.signal.aborted ? 'request cancelled' : 'MCP request timed out');
      return jsonRpcHttpError(500, -32603, 'MCP request failed');
    }
    return outcome.response;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Secure fetch-native MCP HTTP boundary for Workers, Deno, Bun and Node
 * bridges. The raw SDK handler remains available for hosts that already own
 * these gates; this boundary makes the security posture explicit and tested.
 */
export function createProductionMcpHandler(
  store: RecoveryStore,
  options: ProductionMcpHttpOptions,
): ProductionMcpHttpHandler {
  const runtimeEvidence: MutableProductionMcpRuntimeEvidence = {
    requests: 0,
    dispatchedRequests: 0,
    bearerAuthConfigured: options.bearerAuth !== undefined,
    bearerAuthSuccesses: 0,
    oauthMetadataConfigured: options.oauthMetadata !== undefined,
    oauthMetadataResponses: 0,
  };
  const allowedHostnames = [...options.allowedHostnames].map((value) => value.trim()).filter(Boolean);
  if (allowedHostnames.length === 0) throw new Error('allowedHostnames must not be empty');
  const allowedOriginHostnames = [...(options.allowedOriginHostnames ?? allowedHostnames)].map((value) => value.trim()).filter(Boolean);
  const allowUnauthenticatedLoopback = options.allowUnauthenticatedLoopback === true;
  if (options.bearerAuth === undefined && !allowUnauthenticatedLoopback) {
    throw new Error('bearerAuth is required unless allowUnauthenticatedLoopback is explicit');
  }
  if (allowUnauthenticatedLoopback && allowedHostnames.some((value) => !isLoopbackHostname(value))) {
    throw new Error('unauthenticated MCP HTTP is restricted to loopback hostnames');
  }
  if (allowUnauthenticatedLoopback && allowedOriginHostnames.some((value) => !isLoopbackHostname(value))) {
    throw new Error('unauthenticated MCP HTTP origins are restricted to loopback hostnames');
  }
  const maxBytes = boundedOption(options.maxRequestBytes, MCP_HTTP_MAX_REQUEST_BYTES, 'maxRequestBytes', MCP_HTTP_MAX_REQUEST_BYTES);
  const timeoutMs = boundedOption(options.timeoutMs, MCP_HTTP_DEFAULT_TIMEOUT_MS, 'timeoutMs', 300_000);
  const handler = createModernMcpHandler(store);
  const authenticate = options.bearerAuth === undefined ? undefined : requireBearerAuth(options.bearerAuth);

  const productionHandler: ProductionMcpHttpHandler = {
    fetch: async (request, requestOptions) => {
      runtimeEvidence.requests = incrementRuntimeCounter(runtimeEvidence.requests);
      if (request.signal.aborted) return jsonRpcHttpError(499, -32603, 'request cancelled');
      const hostRejection = hostHeaderValidationResponse(request, allowedHostnames);
      if (hostRejection) return hostRejection;
      const originRejection = originValidationResponse(request, allowedOriginHostnames);
      if (originRejection) return originRejection;

      if (options.oauthMetadata) {
        const metadata = oauthMetadataResponse(request, options.oauthMetadata);
        if (metadata) {
          runtimeEvidence.oauthMetadataResponses = incrementRuntimeCounter(runtimeEvidence.oauthMetadataResponses);
          return withHttpResponseHeaders(metadata, request);
        }
      }
      if (request.method === 'OPTIONS') {
        return withHttpResponseHeaders(new Response(null, {
          status: 204,
          headers: {
            allow: 'POST, OPTIONS',
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'Accept, Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
            'access-control-max-age': '600',
          },
        }), request);
      }
      if (request.method !== 'POST') {
        return withHttpResponseHeaders(jsonRpcHttpError(405, -32600, 'MCP HTTP endpoint accepts POST only', { allow: 'POST, OPTIONS' }), request);
      }
      if (!isJsonContentType(request.headers.get('content-type'))) {
        return withHttpResponseHeaders(jsonRpcHttpError(415, -32600, 'Content-Type must be application/json'), request);
      }
      if (!acceptsMcpResponse(request.headers.get('accept'))) {
        return withHttpResponseHeaders(jsonRpcHttpError(406, -32600, 'Accept must include application/json or text/event-stream'), request);
      }
      const deadlineAt = Date.now() + timeoutMs;
      const checked = await readAndValidateBody(request, maxBytes, deadlineAt);
      if (checked instanceof Response) return withHttpResponseHeaders(checked, request);
      const routingRejection = validateModernRoutingHeaders(checked.value, request);
      if (routingRejection) return withHttpResponseHeaders(routingRejection, request);
      if (authenticate) {
        const authOutcome = await settleBeforeDeadline(authenticate(request), deadlineAt);
        if (authOutcome.kind === 'timeout') {
          return withHttpResponseHeaders(jsonRpcHttpError(504, -32603, 'MCP request timed out'), request);
        }
        if (authOutcome.kind === 'error') {
          return withHttpResponseHeaders(jsonRpcHttpError(500, -32603, 'MCP authentication failed'), request);
        }
        const auth = authOutcome.value;
        if (auth instanceof Response) return withHttpResponseHeaders(auth, request);
        runtimeEvidence.bearerAuthSuccesses = incrementRuntimeCounter(runtimeEvidence.bearerAuthSuccesses);
        runtimeEvidence.dispatchedRequests = incrementRuntimeCounter(runtimeEvidence.dispatchedRequests);
        return withHttpResponseHeaders(await runWithDeadline(handler, request, checked.bytes, deadlineAt, auth), request);
      }
      runtimeEvidence.dispatchedRequests = incrementRuntimeCounter(runtimeEvidence.dispatchedRequests);
      return withHttpResponseHeaders(await runWithDeadline(handler, request, checked.bytes, deadlineAt, requestOptions?.authInfo), request);
    },
    close: handler.close,
    notify: handler.notify,
    bus: handler.bus,
  };
  PRODUCTION_MCP_RUNTIME_EVIDENCE.set(productionHandler as object, runtimeEvidence);
  return productionHandler;
}

type StdioRequestId = string | number;

function stdioRequestIdKey(value: unknown): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return undefined;
    return `n:${value}`;
  }
  if (typeof value === 'string') {
    if (value.length < 1 || value.length > MAX_MCP_STDIO_REQUEST_ID_LENGTH || value.includes('\0')) {
      return undefined;
    }
    return `s:${value}`;
  }
  return undefined;
}

function inboundRequestId(message: JSONRPCMessage): StdioRequestId | undefined {
  if (!('method' in message) || !('id' in message)) return undefined;
  return typeof message.id === 'string' || typeof message.id === 'number'
    ? message.id
    : undefined;
}

function outboundResponseId(message: JSONRPCMessage): StdioRequestId | undefined {
  if ('method' in message || !('id' in message)) return undefined;
  if (!('result' in message) && !('error' in message)) return undefined;
  return typeof message.id === 'string' || typeof message.id === 'number'
    ? message.id
    : undefined;
}

class ObservableMcpStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];

  private readonly pendingRequestIds = new Set<string>();
  private started = false;

  constructor(
    private readonly inner: Transport,
    private readonly evidence: MutableProductionMcpStdioRuntimeEvidence,
  ) {}

  get hasPerRequestStream(): boolean | undefined {
    return this.inner.hasPerRequestStream;
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  set sessionId(value: string | undefined) {
    this.inner.sessionId = value;
  }

  setProtocolVersion = (version: string): void => {
    this.inner.setProtocolVersion?.(version);
  };

  setSupportedProtocolVersions = (versions: string[]): void => {
    this.inner.setSupportedProtocolVersions?.(versions);
  };

  async start(): Promise<void> {
    if (this.started) throw new Error('Observable MCP stdio transport already started');
    this.started = true;

    const priorMessage = this.inner.onmessage;
    const priorError = this.inner.onerror;
    const priorClose = this.inner.onclose;

    this.inner.onmessage = (message, extra) => {
      this.evidence.inboundMessages = incrementRuntimeCounter(this.evidence.inboundMessages);
      const requestId = inboundRequestId(message);
      if (requestId !== undefined) {
        this.evidence.inboundRequests = incrementRuntimeCounter(this.evidence.inboundRequests);
        const key = stdioRequestIdKey(requestId);
        if (
          key === undefined
          || this.pendingRequestIds.has(key)
          || this.pendingRequestIds.size >= MAX_MCP_STDIO_PENDING_REQUESTS
        ) {
          this.evidence.trackingOverflows = incrementRuntimeCounter(this.evidence.trackingOverflows);
        } else {
          this.pendingRequestIds.add(key);
        }
      }
      priorMessage?.(message, extra);
      this.onmessage?.(message, extra);
    };
    this.inner.onerror = (error) => {
      priorError?.(error);
      this.onerror?.(error);
    };
    this.inner.onclose = () => {
      this.pendingRequestIds.clear();
      priorClose?.();
      this.onclose?.();
    };

    await this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const responseId = outboundResponseId(message);
    const responseKey = responseId === undefined ? undefined : stdioRequestIdKey(responseId);
    await this.inner.send(message, options);
    this.evidence.outboundMessages = incrementRuntimeCounter(this.evidence.outboundMessages);
    if (responseKey !== undefined && this.pendingRequestIds.delete(responseKey)) {
      this.evidence.completedExchanges = incrementRuntimeCounter(this.evidence.completedExchanges);
    }
  }

  async close(): Promise<void> {
    this.pendingRequestIds.clear();
    await this.inner.close();
  }
}

/**
 * Official SDK stdio transport with process-local metadata-only exchange
 * evidence. Construction alone is not a verified client exchange: Control
 * Room promotes stdio only after a request/response pair is observed.
 */
export function runModernMcpStdio(
  store: RecoveryStore,
  options: ServeStdioOptions = {},
): StdioServerHandle {
  const runtimeEvidence: MutableProductionMcpStdioRuntimeEvidence = {
    inboundMessages: 0,
    inboundRequests: 0,
    outboundMessages: 0,
    completedExchanges: 0,
    trackingOverflows: 0,
  };
  const transport = new ObservableMcpStdioTransport(
    options.transport ?? new StdioServerTransport(),
    runtimeEvidence,
  );
  const handle = serveStdio(
    () => createModernMcpServer(store),
    { ...options, legacy: options.legacy ?? 'serve', transport },
  );
  if (handle !== null && (typeof handle === 'object' || typeof handle === 'function')) {
    GENERATED_MCP_STDIO_HANDLES.add(handle as object);
    PRODUCTION_MCP_STDIO_RUNTIME_EVIDENCE.set(handle as object, runtimeEvidence);
  }
  return handle;
}
