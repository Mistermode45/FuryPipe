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
} from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
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
  const method = typeof value.method === 'string' ? value.method : undefined;
  const routeMethod = request.headers.get('mcp-method');
  if (!method || routeMethod !== method) {
    return jsonRpcHttpError(400, -32600, 'Mcp-Method must match the JSON-RPC method');
  }
  if (method === 'tools/call') {
    const params = requestBody(value.params);
    const toolName = typeof params?.name === 'string' ? params.name : undefined;
    if (!toolName || request.headers.get('mcp-name') !== toolName) {
      return jsonRpcHttpError(400, -32600, 'Mcp-Name must match the called tool');
    }
  }
  return undefined;
}

async function readAndValidateBody(request: Request, maxBytes: number): Promise<{ bytes: Uint8Array; value: Record<string, unknown> } | Response> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) return jsonRpcHttpError(400, -32600, 'invalid Content-Length');
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared)) return jsonRpcHttpError(400, -32600, 'invalid Content-Length');
    if (declared > maxBytes) return jsonRpcHttpError(413, -32600, 'request body exceeds limit');
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.clone().arrayBuffer());
  } catch {
    return jsonRpcHttpError(400, -32700, 'unable to read request body');
  }
  if (bytes.byteLength > maxBytes) return jsonRpcHttpError(413, -32600, 'request body exceeds limit');
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
  timeoutMs: number,
  authInfo?: AuthInfo,
): Promise<Response> {
  if (request.signal.aborted) return jsonRpcHttpError(499, -32603, 'request cancelled');
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
  }, timeoutMs);
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

  return {
    fetch: async (request, requestOptions) => {
      if (request.signal.aborted) return jsonRpcHttpError(499, -32603, 'request cancelled');
      const hostRejection = hostHeaderValidationResponse(request, allowedHostnames);
      if (hostRejection) return hostRejection;
      const originRejection = originValidationResponse(request, allowedOriginHostnames);
      if (originRejection) return originRejection;

      if (options.oauthMetadata) {
        const metadata = oauthMetadataResponse(request, options.oauthMetadata);
        if (metadata) return withHttpResponseHeaders(metadata, request);
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
      const checked = await readAndValidateBody(request, maxBytes);
      if (checked instanceof Response) return withHttpResponseHeaders(checked, request);
      const routingRejection = validateModernRoutingHeaders(checked.value, request);
      if (routingRejection) return withHttpResponseHeaders(routingRejection, request);
      if (authenticate) {
        const auth = await authenticate(request);
        if (auth instanceof Response) return withHttpResponseHeaders(auth, request);
        return withHttpResponseHeaders(await runWithDeadline(handler, request, checked.bytes, timeoutMs, auth), request);
      }
      return withHttpResponseHeaders(await runWithDeadline(handler, request, checked.bytes, timeoutMs, requestOptions?.authInfo), request);
    },
    close: handler.close,
    notify: handler.notify,
    bus: handler.bus,
  };
}

/** Official SDK stdio transport; the SDK selects modern or legacy per connection. */
export function runModernMcpStdio(store: RecoveryStore): StdioServerHandle {
  return serveStdio(() => createModernMcpServer(store), { legacy: 'serve' });
}
