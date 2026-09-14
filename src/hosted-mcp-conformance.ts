import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const HOSTED_MCP_MODERN_PROTOCOL = '2026-07-28';
export const HOSTED_MCP_LEGACY_PROTOCOL = '2025-11-25';
export const HOSTED_MCP_READ_ONLY_HANDLE = `furypipe-recovery/v1/sha256/${'0'.repeat(64)}`;
export const HOSTED_MCP_TIMEOUT_TEST_HANDLE = `furypipe-recovery/v1/sha256/${'f'.repeat(64)}`;

const SHA40 = /^[0-9a-f]{40}$/u;
const MAX_RESPONSE_BYTES = 256 * 1024;
const EXPECTED_TOOLS = Object.freeze([
  'index_text',
  'index_bytes',
  'fetch_text',
  'fetch_exact',
  'fetch_bytes',
  'fetch_bytes_base64',
  'fetch_range',
  'fetch_lines',
  'manifest',
  'delete_handle',
  'verify_handle',
] as const);

export type HostedMcpCheckStatus = 'VERIFIED' | 'PARTIAL' | 'NOT_EXECUTED' | 'BLOCKED';

export interface HostedMcpConformanceReport {
  readonly format: 'furypipe-hosted-mcp-conformance/v1';
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly endpointIdentitySha256: string;
  readonly requestExecuted: true;
  readonly status: 'VERIFIED' | 'PARTIAL' | 'BLOCKED';
  readonly network: {
    readonly remoteEndpoint: true;
    readonly scheme: 'https' | 'http';
    readonly tls: HostedMcpCheckStatus;
    readonly dns: HostedMcpCheckStatus | 'NOT_APPLICABLE';
  };
  readonly sourceBinding: {
    readonly header: 'x-furypipe-source-commit';
    readonly verified: boolean;
  };
  readonly auth: {
    readonly missingBearerRejected: boolean;
    readonly invalidBearerRejected: boolean;
    readonly validBearerAccepted: boolean;
    readonly oauthAuthorizationServerTested: false;
  };
  readonly protocol: {
    readonly modernDiscover: boolean;
    readonly toolsList: boolean;
    readonly readOnlyToolCall: boolean;
    readonly reconnectRoundTrip: boolean;
    readonly legacyFallback: boolean;
  };
  readonly resilience: {
    readonly timeoutPath: boolean;
    readonly cancellationPath: boolean;
  };
  readonly privacy: {
    readonly bearerTokenRecorded: false;
    readonly responseBodiesRecorded: false;
  };
}

export interface HostedMcpConformanceOptions {
  readonly endpoint: string;
  readonly bearerToken: string;
  readonly expectedSourceCommit: string;
  readonly allowInsecureHttp?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly cancellationDelayMs?: number;
}

interface RpcResponse {
  readonly response: Response;
  readonly text: string;
  readonly sourceBound: boolean;
}

function endpointUrl(value: string, allowInsecureHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('hosted MCP endpoint must be an absolute URL');
  }
  if (url.username || url.password) throw new Error('hosted MCP endpoint must not embed credentials');
  if (url.search || url.hash) throw new Error('hosted MCP endpoint must not contain query or fragment');
  if (url.protocol !== 'https:' && !(allowInsecureHttp && url.protocol === 'http:')) {
    throw new Error('hosted MCP endpoint must use HTTPS unless allowInsecureHttp is explicit');
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.')) {
    throw new Error('hosted MCP conformance requires a non-loopback endpoint');
  }
  return url;
}

function boundedToken(value: string): string {
  const token = value.trim();
  if (token.length < 16 || token.length > 4096 || token.includes('\0')) {
    throw new Error('hosted MCP bearer token must be a bounded non-empty secret');
  }
  return token;
}

async function boundedText(response: Response): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      if (value.byteLength > MAX_RESPONSE_BYTES - total) {
        await reader.cancel();
        throw new Error('hosted MCP response exceeds the evidence body limit');
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function modernBody(id: number, method: string, params: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': HOSTED_MCP_MODERN_PROTOCOL,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  });
}

function sourceHeaderMatches(response: Response, expectedSourceCommit: string): boolean {
  return response.headers.get('x-furypipe-source-commit') === expectedSourceCommit;
}

function jsonObject(text: string): Record<string, any> {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP response must be a JSON object');
  return value as Record<string, any>;
}

function sseJsonObject(text: string): Record<string, any> {
  const payload = text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .find(Boolean);
  if (!payload) throw new Error('legacy MCP response did not contain an SSE data event');
  return jsonObject(payload);
}

function endpointIdentity(url: URL): string {
  return createHash('sha256').update(`${url.protocol}//${url.host}${url.pathname}`).digest('hex');
}

export async function probeHostedMcpConformance(
  options: HostedMcpConformanceOptions,
): Promise<HostedMcpConformanceReport> {
  if (!SHA40.test(options.expectedSourceCommit)) {
    throw new Error('expectedSourceCommit must be a lowercase 40-character commit SHA');
  }
  const allowInsecureHttp = options.allowInsecureHttp === true;
  const url = endpointUrl(options.endpoint, allowInsecureHttp);
  const bearerToken = boundedToken(options.bearerToken);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cancellationDelayMs = options.cancellationDelayMs ?? 25;
  if (!Number.isSafeInteger(cancellationDelayMs) || cancellationDelayMs < 1 || cancellationDelayMs > 5_000) {
    throw new RangeError('cancellationDelayMs must be an integer from 1 to 5000');
  }

  let nextId = 1;
  let sourceBound = true;
  const rpcModern = async (
    method: string,
    params: Record<string, unknown>,
    authorization: string | undefined,
  ): Promise<RpcResponse> => {
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': HOSTED_MCP_MODERN_PROTOCOL,
      'mcp-method': method,
    };
    if (method === 'tools/call' && typeof params.name === 'string') headers['mcp-name'] = params.name;
    if (authorization !== undefined) headers.authorization = `Bearer ${authorization}`;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: modernBody(nextId++, method, params),
      redirect: 'error',
      cache: 'no-store',
    });
    const bound = sourceHeaderMatches(response, options.expectedSourceCommit);
    sourceBound &&= bound;
    return { response, text: await boundedText(response), sourceBound: bound };
  };

  const missing = await rpcModern('server/discover', {}, undefined);
  const invalidToken = bearerToken === 'furypipe-invalid-hosted-conformance-token'
    ? 'furypipe-invalid-hosted-conformance-token-x'
    : 'furypipe-invalid-hosted-conformance-token';
  const invalid = await rpcModern('server/discover', {}, invalidToken);
  const discover = await rpcModern('server/discover', {}, bearerToken);

  let modernDiscover = false;
  if (discover.response.status === 200) {
    const payload = jsonObject(discover.text);
    const versions = payload.result?.supportedVersions;
    modernDiscover = Array.isArray(versions) && versions.includes(HOSTED_MCP_MODERN_PROTOCOL);
  }

  const listed = await rpcModern('tools/list', {}, bearerToken);
  let toolsList = false;
  if (listed.response.status === 200) {
    const payload = jsonObject(listed.text);
    const tools = payload.result?.tools;
    const names = Array.isArray(tools)
      ? tools.map((tool: any) => tool?.name).filter((name: unknown): name is string => typeof name === 'string')
      : [];
    toolsList = EXPECTED_TOOLS.every((name) => names.includes(name));
  }

  const readOnly = await rpcModern('tools/call', {
    name: 'verify_handle',
    arguments: { handle: HOSTED_MCP_READ_ONLY_HANDLE },
  }, bearerToken);
  let readOnlyToolCall = false;
  if (readOnly.response.status === 200) {
    const payload = jsonObject(readOnly.text);
    const text = payload.result?.content?.[0]?.text;
    if (typeof text === 'string') {
      const result = jsonObject(text);
      readOnlyToolCall = result.ok === false && result.exists === false && result.digestMatches === false;
    }
  }

  const reconnect = await rpcModern('server/discover', {}, bearerToken);
  let reconnectRoundTrip = false;
  if (reconnect.response.status === 200) {
    const payload = jsonObject(reconnect.text);
    reconnectRoundTrip = Array.isArray(payload.result?.supportedVersions)
      && payload.result.supportedVersions.includes(HOSTED_MCP_MODERN_PROTOCOL);
  }

  const legacyHeaders: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    authorization: `Bearer ${bearerToken}`,
  };
  const legacyResponse = await fetchImpl(url, {
    method: 'POST',
    headers: legacyHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'initialize',
      params: {
        protocolVersion: HOSTED_MCP_LEGACY_PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'furypipe-hosted-conformance', version: '1' },
      },
    }),
    redirect: 'error',
    cache: 'no-store',
  });
  sourceBound &&= sourceHeaderMatches(legacyResponse, options.expectedSourceCommit);
  const legacyText = await boundedText(legacyResponse);
  let legacyFallback = false;
  if (legacyResponse.status === 200) {
    const payload = legacyResponse.headers.get('content-type')?.includes('text/event-stream')
      ? sseJsonObject(legacyText)
      : jsonObject(legacyText);
    legacyFallback = payload.result?.protocolVersion === HOSTED_MCP_LEGACY_PROTOCOL;
  }

  const timeout = await rpcModern('tools/call', {
    name: 'verify_handle',
    arguments: { handle: HOSTED_MCP_TIMEOUT_TEST_HANDLE },
  }, bearerToken);
  const timeoutPath = timeout.response.status === 504
    && (() => {
      try {
        return jsonObject(timeout.text).error?.code === -32603;
      } catch {
        return false;
      }
    })();

  const abortController = new AbortController();
  const cancelTimer = setTimeout(() => abortController.abort(new DOMException('Hosted MCP conformance cancellation', 'AbortError')), cancellationDelayMs);
  let cancellationPath = false;
  try {
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': HOSTED_MCP_MODERN_PROTOCOL,
      'mcp-method': 'tools/call',
      'mcp-name': 'verify_handle',
      authorization: `Bearer ${bearerToken}`,
    };
    await fetchImpl(url, {
      method: 'POST',
      headers,
      body: modernBody(nextId++, 'tools/call', {
        name: 'verify_handle',
        arguments: { handle: HOSTED_MCP_TIMEOUT_TEST_HANDLE },
      }),
      redirect: 'error',
      cache: 'no-store',
      signal: abortController.signal,
    });
  } catch (error) {
    cancellationPath = abortController.signal.aborted
      && (error instanceof DOMException ? error.name === 'AbortError' : true);
  } finally {
    clearTimeout(cancelTimer);
  }

  const missingBearerRejected = missing.response.status === 401;
  const invalidBearerRejected = invalid.response.status === 401;
  const validBearerAccepted = discover.response.status === 200;
  const tls = url.protocol === 'https:' ? 'VERIFIED' as const : 'NOT_EXECUTED' as const;
  const dns = isIP(url.hostname.replace(/^\[|\]$/gu, '')) === 0 ? 'VERIFIED' as const : 'NOT_APPLICABLE' as const;

  const allProtocol = modernDiscover && toolsList && readOnlyToolCall && reconnectRoundTrip && legacyFallback;
  const allAuth = missingBearerRejected && invalidBearerRejected && validBearerAccepted;
  const allResilience = timeoutPath && cancellationPath;
  const verified = sourceBound && allProtocol && allAuth && allResilience && tls === 'VERIFIED';

  return Object.freeze({
    format: 'furypipe-hosted-mcp-conformance/v1' as const,
    generatedAt: now(),
    sourceCommit: options.expectedSourceCommit,
    endpointIdentitySha256: endpointIdentity(url),
    requestExecuted: true as const,
    status: verified ? 'VERIFIED' as const
      : sourceBound && allProtocol && allAuth && allResilience ? 'PARTIAL' as const
        : 'BLOCKED' as const,
    network: Object.freeze({
      remoteEndpoint: true as const,
      scheme: url.protocol === 'https:' ? 'https' as const : 'http' as const,
      tls,
      dns,
    }),
    sourceBinding: Object.freeze({
      header: 'x-furypipe-source-commit' as const,
      verified: sourceBound,
    }),
    auth: Object.freeze({
      missingBearerRejected,
      invalidBearerRejected,
      validBearerAccepted,
      oauthAuthorizationServerTested: false as const,
    }),
    protocol: Object.freeze({
      modernDiscover,
      toolsList,
      readOnlyToolCall,
      reconnectRoundTrip,
      legacyFallback,
    }),
    resilience: Object.freeze({
      timeoutPath,
      cancellationPath,
    }),
    privacy: Object.freeze({
      bearerTokenRecorded: false as const,
      responseBodiesRecorded: false as const,
    }),
  });
}
