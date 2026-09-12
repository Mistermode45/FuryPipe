import type { ProxyConfig } from './proxy.js';

export interface OmniRouteAdapterOptions {
  /** OmniRoute origin or OpenAI-style base URL. Both https://host and https://host/v1 are accepted. */
  readonly baseUrl: string;
  /** Optional OmniRoute API key. Omit only when the configured OmniRoute instance intentionally permits it. */
  readonly apiKey?: string;
  /** Optional non-secret gateway headers. Authorization must use apiKey instead. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface OmniRouteAdapterInspection {
  readonly format: 'furypipe-omniroute-adapter/v1';
  readonly baseUrl: string;
  readonly authentication: 'configured' | 'caller-or-disabled';
  readonly protocols: readonly ['anthropic', 'openai', 'google'];
  readonly endpoints: {
    readonly anthropicMessages: '/v1/messages';
    readonly anthropicCountTokens: '/v1/messages/count_tokens';
    readonly openAIChatCompletions: '/v1/chat/completions';
    readonly openAIResponses: '/v1/responses';
    readonly googleModels: '/v1beta/models';
  };
}

const MAX_BASE_URL_LENGTH = 2048;
const MAX_API_KEY_LENGTH = 4096;
const MAX_HEADER_NAME_LENGTH = 128;
const MAX_HEADER_VALUE_LENGTH = 4096;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

function normalizeLoopbackHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/gu, '');
}

function isLoopbackHostname(hostname: string): boolean {
  const host = normalizeLoopbackHostname(hostname);
  return host === 'localhost' || host === '::1'
    || /^127(?:\.\d{1,3}){3}$/u.test(host);
}

function boundedApiKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  if (!key) return undefined;
  if (key.length > MAX_API_KEY_LENGTH || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new Error('OmniRoute API key must be bounded printable text');
  }
  return key;
}

function normalizeHeaderName(value: string): string {
  const name = value.trim().toLowerCase();
  if (!name || name.length > MAX_HEADER_NAME_LENGTH || !HEADER_NAME.test(name)) {
    throw new Error('OmniRoute header name is invalid');
  }
  if (name === 'authorization' || name === 'proxy-authorization' || name === 'cookie' || name === 'set-cookie') {
    throw new Error(`OmniRoute header ${name} must not be supplied through generic headers`);
  }
  return name;
}

function normalizeHeaders(
  values: Readonly<Record<string, string>> | undefined,
  apiKey: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(values ?? {})) {
    const name = normalizeHeaderName(rawName);
    if (typeof rawValue !== 'string' || rawValue.length > MAX_HEADER_VALUE_LENGTH
      || /[\u0000-\u001f\u007f]/u.test(rawValue)) {
      throw new Error(`OmniRoute header value is invalid: ${name}`);
    }
    headers[name] = rawValue;
  }
  if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

/**
 * Normalize an OmniRoute endpoint to its origin/root.
 *
 * OmniRoute clients commonly receive either:
 * - http://127.0.0.1:<port>
 * - http://127.0.0.1:<port>/v1
 *
 * FuryPipe needs the root because it already appends the Anthropic/OpenAI/Gemini
 * protocol paths itself.
 */
export function normalizeOmniRouteBaseUrl(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_BASE_URL_LENGTH
    || value.includes('\0')) {
    throw new Error('OmniRoute base URL must be a bounded non-empty URL');
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('OmniRoute base URL is invalid');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('OmniRoute base URL must not contain credentials, query parameters or fragments');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('OmniRoute base URL must use HTTP or HTTPS');
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error('remote OmniRoute endpoints require HTTPS');
  }

  const pathname = url.pathname.replace(/\/+$/u, '') || '/';
  if (pathname !== '/' && pathname !== '/v1') {
    throw new Error('OmniRoute base URL path must be root or /v1');
  }

  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

export function createOmniRouteProxyConfig(options: OmniRouteAdapterOptions): ProxyConfig {
  const baseUrl = normalizeOmniRouteBaseUrl(options.baseUrl);
  const apiKey = boundedApiKey(options.apiKey);
  const gatewayHeaders = normalizeHeaders(options.headers, apiKey);

  return Object.freeze({
    upstream: baseUrl,
    openAIUpstream: baseUrl,
    googleUpstream: baseUrl,
    gatewayHeaders: Object.freeze(gatewayHeaders),
  });
}

export function inspectOmniRouteAdapter(options: OmniRouteAdapterOptions): OmniRouteAdapterInspection {
  return Object.freeze({
    format: 'furypipe-omniroute-adapter/v1',
    baseUrl: normalizeOmniRouteBaseUrl(options.baseUrl),
    authentication: boundedApiKey(options.apiKey) === undefined ? 'caller-or-disabled' : 'configured',
    protocols: Object.freeze(['anthropic', 'openai', 'google'] as const),
    endpoints: Object.freeze({
      anthropicMessages: '/v1/messages',
      anthropicCountTokens: '/v1/messages/count_tokens',
      openAIChatCompletions: '/v1/chat/completions',
      openAIResponses: '/v1/responses',
      googleModels: '/v1beta/models',
    }),
  });
}
