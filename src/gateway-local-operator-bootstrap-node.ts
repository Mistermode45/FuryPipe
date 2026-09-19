import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  FuryGatewaySessionCoordinator,
  FuryGatewaySessionLease,
} from './gateway-session-node.js';
import type {
  FuryGatewayWebSocketResolvedConnection,
} from './gateway-websocket-host-node.js';

export const FURY_GATEWAY_LOCAL_BOOTSTRAP_FORMAT =
  'furypipe-gateway-local-bootstrap/v1' as const;
export const FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH =
  '/gateway/local-bootstrap/v1' as const;
export const FURY_GATEWAY_LOCAL_LOGOUT_PATH =
  '/gateway/local-logout/v1' as const;
export const FURY_GATEWAY_LOCAL_COOKIE_NAME =
  'furypipe_gateway_local' as const;

export interface FuryGatewayLocalBootstrapTicket {
  readonly format: typeof FURY_GATEWAY_LOCAL_BOOTSTRAP_FORMAT;
  /**
   * Sensitive one-time value. Intended for trusted local UI/CLI display only.
   * Never persist or log this field.
   */
  readonly code: string;
  readonly expiresAt: number;
  readonly authority: 'bootstrap-ticket';
  readonly executionAuthority: false;
}

export interface FuryGatewayLocalBootstrapOptions {
  readonly sessionCoordinator: FuryGatewaySessionCoordinator;
  readonly session: FuryGatewaySessionLease;
  readonly allowedOrigins: readonly string[];
  readonly now?: () => number;
  readonly bootstrapTtlMs?: number;
  readonly browserSessionTtlMs?: number;
  readonly maxPendingTickets?: number;
  readonly maxBrowserSessions?: number;
  readonly maxRequestBodyBytes?: number;
}

export interface FuryGatewayLocalBootstrapInspection {
  readonly pendingTickets: number;
  readonly browserSessions: number;
  readonly authority: 'observability-only';
}

export interface FuryGatewayLocalBootstrapManager {
  issueTicket(): FuryGatewayLocalBootstrapTicket;
  handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  resolveConnection(request: IncomingMessage): FuryGatewayWebSocketResolvedConnection | undefined;
  revokeAllBrowserSessions(): number;
  inspect(): FuryGatewayLocalBootstrapInspection;
}

export type FuryGatewayLocalBootstrapErrorCode =
  | 'invalid-config'
  | 'ticket-limit'
  | 'session-limit'
  | 'session-inactive';

export class FuryGatewayLocalBootstrapError extends Error {
  readonly code: FuryGatewayLocalBootstrapErrorCode;

  constructor(code: FuryGatewayLocalBootstrapErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayLocalBootstrapError';
    this.code = code;
  }
}

interface PendingTicket {
  readonly digest: string;
  readonly expiresAt: number;
}

interface BrowserSession {
  readonly digest: string;
  readonly origin: string;
  readonly expiresAt: number;
  readonly session: FuryGatewaySessionLease;
}

const DEFAULT_BOOTSTRAP_TTL_MS = 60_000;
const MIN_BOOTSTRAP_TTL_MS = 10_000;
const MAX_BOOTSTRAP_TTL_MS = 5 * 60_000;
const DEFAULT_BROWSER_SESSION_TTL_MS = 15 * 60_000;
const MIN_BROWSER_SESSION_TTL_MS = 30_000;
const MAX_BROWSER_SESSION_TTL_MS = 60 * 60_000;
const DEFAULT_MAX_PENDING_TICKETS = 8;
const MAX_PENDING_TICKETS = 64;
const DEFAULT_MAX_BROWSER_SESSIONS = 16;
const MAX_BROWSER_SESSIONS = 256;
const DEFAULT_MAX_REQUEST_BODY_BYTES = 2 * 1024;
const MIN_REQUEST_BODY_BYTES = 256;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

const SECRET_RE = /^[A-Za-z0-9_-]{43}$/u;
const SAFE_COOKIE_TOKEN_RE = SECRET_RE;

function finiteNow(now: () => number): number {
  const value = now();
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(normalized)) {
    throw new FuryGatewayLocalBootstrapError(
      'invalid-config',
      'Gateway local bootstrap clock must return a safe non-negative timestamp',
    );
  }
  return normalized;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new FuryGatewayLocalBootstrapError(
      'invalid-config',
      `${label} must be an integer between ${min} and ${max}`,
    );
  }
  return resolved;
}

function digestSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

function isLoopback(address: string | undefined): boolean {
  const normalized = address?.trim().toLowerCase() ?? '';
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FuryGatewayLocalBootstrapError(
      'invalid-config',
      'Gateway local bootstrap Origin is invalid',
    );
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    throw new FuryGatewayLocalBootstrapError(
      'invalid-config',
      'Gateway local bootstrap Origins must be exact HTTP(S) origins',
    );
  }
  return parsed.origin;
}

function normalizeAllowedOrigins(origins: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(origins) || origins.length < 1 || origins.length > 32) {
    throw new FuryGatewayLocalBootstrapError(
      'invalid-config',
      'Gateway local bootstrap requires 1-32 exact Origins',
    );
  }
  const normalized = new Set<string>();
  for (const origin of origins) {
    if (typeof origin !== 'string' || origin.includes('*')) {
      throw new FuryGatewayLocalBootstrapError(
        'invalid-config',
        'Gateway local bootstrap Origins must be wildcard-free',
      );
    }
    const exact = normalizeOrigin(origin);
    if (normalized.has(exact)) {
      throw new FuryGatewayLocalBootstrapError(
        'invalid-config',
        'Gateway local bootstrap Origins contain duplicates',
      );
    }
    normalized.add(exact);
  }
  return normalized;
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (value === undefined || Array.isArray(value)) return undefined;
  return value;
}

function requestOrigin(
  request: IncomingMessage,
  allowedOrigins: ReadonlySet<string>,
): string | undefined {
  const raw = singleHeader(request, 'origin');
  if (!raw) return undefined;
  let origin: string;
  try {
    origin = normalizeOrigin(raw);
  } catch {
    return undefined;
  }
  return allowedOrigins.has(origin) ? origin : undefined;
}

function parseRequestPath(request: IncomingMessage): {
  readonly pathname: string;
  readonly clean: boolean;
} | undefined {
  if (typeof request.url !== 'string') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(request.url, 'http://127.0.0.1');
  } catch {
    return undefined;
  }
  return Object.freeze({
    pathname: parsed.pathname,
    clean: parsed.search === '' && parsed.hash === '',
  });
}

function setSafeHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function emptyResponse(response: ServerResponse, status: number): void {
  if (response.writableEnded) return;
  setSafeHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Length', '0');
  response.end();
}

function clearCookie(response: ServerResponse): void {
  response.setHeader(
    'Set-Cookie',
    `${FURY_GATEWAY_LOCAL_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/gateway/; Max-Age=0`,
  );
}

function parseContentType(request: IncomingMessage): boolean {
  const raw = singleHeader(request, 'content-type');
  if (!raw) return false;
  const normalized = raw.toLowerCase().replace(/\s+/gu, '');
  return normalized === 'application/json'
    || normalized === 'application/json;charset=utf-8';
}

async function readBoundedBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<string | undefined> {
  const declaredLength = singleHeader(request, 'content-length');
  if (declaredLength !== undefined) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      request.resume();
      return undefined;
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;
  let overflow = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > maxBytes) {
      overflow = true;
      continue;
    }
    if (!overflow) chunks.push(buffer);
  }
  if (overflow) return undefined;
  return Buffer.concat(chunks, total).toString('utf8');
}

function exactBootstrapCode(body: string): string | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (
    !decoded
    || typeof decoded !== 'object'
    || Array.isArray(decoded)
    || Object.getPrototypeOf(decoded) !== Object.prototype
  ) {
    return undefined;
  }
  const record = decoded as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2
    || keys[0] !== 'code'
    || keys[1] !== 'format'
    || record.format !== FURY_GATEWAY_LOCAL_BOOTSTRAP_FORMAT
    || typeof record.code !== 'string'
    || !SECRET_RE.test(record.code)
  ) {
    return undefined;
  }
  return record.code;
}

function cookieTokens(request: IncomingMessage): readonly string[] {
  const raw = singleHeader(request, 'cookie');
  if (!raw || raw.length > 8 * 1024) return Object.freeze([]);
  const values: string[] = [];
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== FURY_GATEWAY_LOCAL_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    if (SAFE_COOKIE_TOKEN_RE.test(value)) values.push(value);
  }
  return Object.freeze(values);
}

export function createFuryGatewayLocalBootstrapManager(
  options: FuryGatewayLocalBootstrapOptions,
): FuryGatewayLocalBootstrapManager {
  if (
    !options
    || typeof options !== 'object'
    || !options.sessionCoordinator
    || !options.session
    || !options.sessionCoordinator.isActiveSession(options.session)
    || options.session.role !== 'operator'
    || options.session.binding.kind !== 'local-operator'
  ) {
    throw new FuryGatewayLocalBootstrapError(
      'invalid-config',
      'Gateway local bootstrap requires an active local-operator session',
    );
  }

  const now = options.now ?? Date.now;
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  const bootstrapTtlMs = boundedInteger(
    options.bootstrapTtlMs,
    DEFAULT_BOOTSTRAP_TTL_MS,
    MIN_BOOTSTRAP_TTL_MS,
    MAX_BOOTSTRAP_TTL_MS,
    'bootstrapTtlMs',
  );
  const browserSessionTtlMs = boundedInteger(
    options.browserSessionTtlMs,
    DEFAULT_BROWSER_SESSION_TTL_MS,
    MIN_BROWSER_SESSION_TTL_MS,
    MAX_BROWSER_SESSION_TTL_MS,
    'browserSessionTtlMs',
  );
  const maxPendingTickets = boundedInteger(
    options.maxPendingTickets,
    DEFAULT_MAX_PENDING_TICKETS,
    1,
    MAX_PENDING_TICKETS,
    'maxPendingTickets',
  );
  const maxBrowserSessions = boundedInteger(
    options.maxBrowserSessions,
    DEFAULT_MAX_BROWSER_SESSIONS,
    1,
    MAX_BROWSER_SESSIONS,
    'maxBrowserSessions',
  );
  const maxRequestBodyBytes = boundedInteger(
    options.maxRequestBodyBytes,
    DEFAULT_MAX_REQUEST_BODY_BYTES,
    MIN_REQUEST_BODY_BYTES,
    MAX_REQUEST_BODY_BYTES,
    'maxRequestBodyBytes',
  );

  const pending = new Map<string, PendingTicket>();
  const browserSessions = new Map<string, BrowserSession>();

  const gc = (at: number): void => {
    for (const [digest, ticket] of pending) {
      if (ticket.expiresAt < at) pending.delete(digest);
    }
    for (const [digest, browserSession] of browserSessions) {
      if (
        browserSession.expiresAt < at
        || !options.sessionCoordinator.isActiveSession(browserSession.session)
      ) {
        browserSessions.delete(digest);
      }
    }
  };

  const consumeTicket = (code: string, at: number): boolean => {
    const digest = digestSecret(code);
    const ticket = pending.get(digest);
    if (!ticket || ticket.expiresAt < at) {
      pending.delete(digest);
      return false;
    }
    pending.delete(digest);
    return true;
  };

  const issueBrowserSession = (
    origin: string,
    at: number,
  ): { readonly token: string; readonly expiresAt: number } => {
    gc(at);
    if (!options.sessionCoordinator.isActiveSession(options.session)) {
      throw new FuryGatewayLocalBootstrapError(
        'session-inactive',
        'Gateway local operator session is no longer active',
      );
    }
    if (browserSessions.size >= maxBrowserSessions) {
      throw new FuryGatewayLocalBootstrapError(
        'session-limit',
        'Gateway local browser session limit reached',
      );
    }

    const expiresAt = Math.min(
      at + browserSessionTtlMs,
      options.session.expiresAt,
    );
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= at) {
      throw new FuryGatewayLocalBootstrapError(
        'session-inactive',
        'Gateway local operator session expires too soon for browser bootstrap',
      );
    }

    let token: string;
    let digest: string;
    do {
      token = newSecret();
      digest = digestSecret(token);
    } while (browserSessions.has(digest));

    browserSessions.set(digest, Object.freeze({
      digest,
      origin,
      expiresAt,
      session: options.session,
    }));
    return Object.freeze({ token, expiresAt });
  };

  return Object.freeze({
    issueTicket(): FuryGatewayLocalBootstrapTicket {
      const at = finiteNow(now);
      gc(at);
      if (!options.sessionCoordinator.isActiveSession(options.session)) {
        throw new FuryGatewayLocalBootstrapError(
          'session-inactive',
          'Gateway local operator session is no longer active',
        );
      }
      if (pending.size >= maxPendingTickets) {
        throw new FuryGatewayLocalBootstrapError(
          'ticket-limit',
          'Gateway local bootstrap ticket limit reached',
        );
      }

      let code: string;
      let digest: string;
      do {
        code = newSecret();
        digest = digestSecret(code);
      } while (pending.has(digest));

      const expiresAt = at + bootstrapTtlMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new FuryGatewayLocalBootstrapError(
          'invalid-config',
          'Gateway local bootstrap ticket expiry is unsafe',
        );
      }
      pending.set(digest, Object.freeze({ digest, expiresAt }));

      return Object.freeze({
        format: FURY_GATEWAY_LOCAL_BOOTSTRAP_FORMAT,
        code,
        expiresAt,
        authority: 'bootstrap-ticket' as const,
        executionAuthority: false as const,
      });
    },

    async handleHttpRequest(
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<boolean> {
      const parsed = parseRequestPath(request);
      if (
        !parsed
        || (
          parsed.pathname !== FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH
          && parsed.pathname !== FURY_GATEWAY_LOCAL_LOGOUT_PATH
        )
      ) {
        return false;
      }

      if (!parsed.clean) {
        emptyResponse(response, 400);
        return true;
      }
      if (!isLoopback(request.socket.remoteAddress)) {
        emptyResponse(response, 403);
        return true;
      }

      const origin = requestOrigin(request, allowedOrigins);
      if (!origin) {
        emptyResponse(response, 403);
        return true;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        emptyResponse(response, 405);
        return true;
      }

      const at = finiteNow(now);
      gc(at);

      if (parsed.pathname === FURY_GATEWAY_LOCAL_LOGOUT_PATH) {
        const tokens = cookieTokens(request);
        if (tokens.length !== 1) {
          clearCookie(response);
          emptyResponse(response, 204);
          return true;
        }
        const digest = digestSecret(tokens[0]!);
        const browserSession = browserSessions.get(digest);
        if (browserSession?.origin === origin) {
          browserSessions.delete(digest);
        }
        clearCookie(response);
        emptyResponse(response, 204);
        return true;
      }

      if (!parseContentType(request)) {
        emptyResponse(response, 415);
        return true;
      }

      const body = await readBoundedBody(request, maxRequestBodyBytes);
      if (body === undefined) {
        if (!response.writableEnded) emptyResponse(response, 413);
        return true;
      }
      const code = exactBootstrapCode(body);
      if (!code || !consumeTicket(code, at)) {
        emptyResponse(response, 401);
        return true;
      }

      let browserSession:
        | { readonly token: string; readonly expiresAt: number }
        | undefined;
      try {
        browserSession = issueBrowserSession(origin, at);
      } catch (error) {
        if (error instanceof FuryGatewayLocalBootstrapError) {
          emptyResponse(response, error.code === 'session-limit' ? 429 : 401);
          return true;
        }
        throw error;
      }

      const maxAgeSeconds = Math.max(
        1,
        Math.floor((browserSession.expiresAt - at) / 1000),
      );
      setSafeHeaders(response);
      response.setHeader(
        'Set-Cookie',
        `${FURY_GATEWAY_LOCAL_COOKIE_NAME}=${browserSession.token}; HttpOnly; SameSite=Strict; Path=/gateway/; Max-Age=${maxAgeSeconds}`,
      );
      response.statusCode = 204;
      response.setHeader('Content-Length', '0');
      response.end();
      return true;
    },

    resolveConnection(
      request: IncomingMessage,
    ): FuryGatewayWebSocketResolvedConnection | undefined {
      const at = finiteNow(now);
      gc(at);
      if (!isLoopback(request.socket.remoteAddress)) return undefined;
      const origin = requestOrigin(request, allowedOrigins);
      if (!origin) return undefined;

      const tokens = cookieTokens(request);
      if (tokens.length !== 1) return undefined;

      const digest = digestSecret(tokens[0]!);
      const browserSession = browserSessions.get(digest);
      if (
        !browserSession
        || browserSession.expiresAt < at
        || browserSession.origin !== origin
        || !options.sessionCoordinator.isActiveSession(browserSession.session)
      ) {
        browserSessions.delete(digest);
        return undefined;
      }

      return Object.freeze({
        session: browserSession.session,
        clientKind: 'browser' as const,
      });
    },

    revokeAllBrowserSessions(): number {
      const count = browserSessions.size;
      browserSessions.clear();
      return count;
    },

    inspect(): FuryGatewayLocalBootstrapInspection {
      const at = finiteNow(now);
      gc(at);
      return Object.freeze({
        pendingTickets: pending.size,
        browserSessions: browserSessions.size,
        authority: 'observability-only' as const,
      });
    },
  });
}