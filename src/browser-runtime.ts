import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';

export const FURY_BROWSER_RUNTIME_FORMAT = 'furypipe-browser-runtime/v1' as const;
export const FURY_BROWSER_SESSION_FORMAT = 'furypipe-browser-session/v1' as const;
export const FURY_BROWSER_PAGE_FORMAT = 'furypipe-browser-page/v1' as const;
export const FURY_BROWSER_PERMIT_FORMAT = 'furypipe-browser-action-permit/v1' as const;
export const FURY_BROWSER_RECEIPT_FORMAT = 'furypipe-browser-action-receipt/v1' as const;
export const FURY_BROWSER_OBSERVATION_FORMAT = 'furypipe-browser-observation/v1' as const;
export const FURY_BROWSER_DOWNLOAD_FORMAT = 'furypipe-browser-download-receipt/v1' as const;

export type BrowserActionName =
  | 'navigate' | 'click' | 'fill' | 'select' | 'keyboard' | 'submit'
  | 'upload' | 'download' | 'screenshot' | 'extract_text'
  | 'accessibility_snapshot' | 'wait' | 'inspect_url';

export type BrowserSessionStatus = 'active' | 'closed';
export type BrowserPageStatus = 'open' | 'closed';
export type BrowserActionOutcome = 'succeeded' | 'failed' | 'outcome-unknown';

export interface BrowserSession {
  readonly format: typeof FURY_BROWSER_SESSION_FORMAT;
  readonly sessionId: string;
  readonly principalIdSha256: string;
  readonly createdAt: number;
  readonly status: BrowserSessionStatus;
  readonly pageCount: number;
  readonly executionAuthority: false;
}

export interface BrowserPage {
  readonly format: typeof FURY_BROWSER_PAGE_FORMAT;
  readonly pageId: string;
  readonly sessionId: string;
  readonly status: BrowserPageStatus;
  readonly currentUrl: string;
  readonly historyLength: number;
  readonly executionAuthority: false;
}

export interface BrowserPolicy {
  readonly policyId: string;
  readonly allowedOrigins?: readonly string[];
  readonly allowedActions: readonly BrowserActionName[];
  readonly maxActionTtlMs?: number;
  readonly maxTimeoutMs?: number;
  readonly maxObservationBytes?: number;
  readonly maxDownloadBytes?: number;
  readonly maxUploadBytes?: number;
}

export interface BrowserRuntimeOptions {
  readonly host: BrowserHost;
  readonly policy: BrowserPolicy;
  readonly now?: () => number;
  readonly maxSessions?: number;
  readonly maxPagesPerSession?: number;
  readonly maxHistoryPerPage?: number;
  readonly downloadsRoot?: string;
  readonly uploadRoots?: readonly string[];
  readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
}

export interface BrowserActionPermit {
  readonly format: typeof FURY_BROWSER_PERMIT_FORMAT;
  readonly permitId: string;
  readonly sessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly pageIdSha256: string;
  readonly action: BrowserActionName;
  readonly targetSha256: string;
  readonly policySha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly executionAuthority: false;
}

export interface BrowserActionReceipt {
  readonly format: typeof FURY_BROWSER_RECEIPT_FORMAT;
  readonly receiptId: string;
  readonly permitIdSha256: string;
  readonly sessionIdSha256: string;
  readonly principalIdSha256: string;
  readonly action: BrowserActionName;
  readonly targetSha256: string;
  readonly policySha256: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: BrowserActionOutcome;
  readonly verificationStatus: 'not-verified' | 'locally-verified';
  readonly resultSha256?: string;
  readonly resultBytes?: number;
  readonly redirectCount?: number;
  readonly originSha256?: string;
  readonly finalUrlSha256?: string;
  readonly errorCode?: BrowserErrorCode;
  readonly executionAuthority: false;
}

export interface BrowserObservation {
  readonly format: typeof FURY_BROWSER_OBSERVATION_FORMAT;
  readonly kind: 'text' | 'accessibility';
  readonly text: string;
  readonly textSha256: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly instructionLike: boolean;
  readonly trust: 'untrusted-data';
  readonly executionAuthority: false;
}

export interface DownloadReceipt {
  readonly format: typeof FURY_BROWSER_DOWNLOAD_FORMAT;
  readonly receiptId: string;
  readonly filename: string;
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceUrlSha256: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly scanStatus: 'not-run' | 'clean' | 'blocked';
  readonly openedAutomatically: false;
  readonly executedAutomatically: false;
  readonly executionAuthority: false;
}

export type BrowserErrorCode =
  | 'invalid-request' | 'invalid-session' | 'invalid-page' | 'session-closed'
  | 'page-closed' | 'permit-invalid' | 'permit-expired' | 'permit-consumed'
  | 'policy-denied' | 'url-invalid' | 'url-private' | 'url-not-allowed'
  | 'redirect-private' | 'upload-invalid' | 'download-invalid' | 'timeout'
  | 'cancelled' | 'host-failed' | 'unsupported-action';

export class BrowserRuntimeError extends Error {
  readonly code: BrowserErrorCode;

  constructor(code: BrowserErrorCode, message: string) {
    super(message);
    this.name = 'BrowserRuntimeError';
    this.code = code;
  }
}

export interface BrowserHostNavigationResult {
  readonly finalUrl: string;
  readonly redirects?: readonly string[];
  readonly title?: string;
}

export interface BrowserHostDownload {
  readonly filename: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly sourceUrl: string;
}

export type BrowserWaitCondition =
  | 'dom-content-loaded' | 'load' | 'network-idle' | 'next-navigation';

export interface BrowserHost {
  createSession(input: { readonly sessionId: string; readonly signal: AbortSignal }): Promise<void>;
  closeSession(input: { readonly sessionId: string; readonly signal: AbortSignal }): Promise<void>;
  createPage(input: { readonly sessionId: string; readonly pageId: string; readonly signal: AbortSignal }): Promise<void>;
  closePage(input: { readonly sessionId: string; readonly pageId: string; readonly signal: AbortSignal }): Promise<void>;
  navigate(input: {
    readonly sessionId: string;
    readonly pageId: string;
    readonly url: string;
    readonly resolvedAddresses: readonly string[];
    readonly signal: AbortSignal;
    readonly onRedirect: (url: string) => Promise<void>;
  }): Promise<BrowserHostNavigationResult>;
  click(input: { readonly sessionId: string; readonly pageId: string; readonly selector: string; readonly signal: AbortSignal; readonly onRedirect?: (url: string) => Promise<void> }): Promise<void | BrowserHostNavigationResult>;
  fill(input: { readonly sessionId: string; readonly pageId: string; readonly selector: string; readonly value: string; readonly signal: AbortSignal; readonly onRedirect?: (url: string) => Promise<void> }): Promise<void | BrowserHostNavigationResult>;
  select(input: { readonly sessionId: string; readonly pageId: string; readonly selector: string; readonly value: string; readonly signal: AbortSignal; readonly onRedirect?: (url: string) => Promise<void> }): Promise<void | BrowserHostNavigationResult>;
  keyboard(input: { readonly sessionId: string; readonly pageId: string; readonly key: string; readonly signal: AbortSignal; readonly onRedirect?: (url: string) => Promise<void> }): Promise<void | BrowserHostNavigationResult>;
  submit(input: { readonly sessionId: string; readonly pageId: string; readonly formScope: string; readonly signal: AbortSignal; readonly onRedirect?: (url: string) => Promise<void> }): Promise<BrowserHostNavigationResult>;
  upload(input: { readonly sessionId: string; readonly pageId: string; readonly filePath: string; readonly destinationOrigin: string; readonly destinationAddresses: readonly string[]; readonly formScope: string; readonly signal: AbortSignal; readonly onRedirect?: (url: string) => Promise<void> }): Promise<void | BrowserHostNavigationResult>;
  download(input: { readonly sessionId: string; readonly pageId: string; readonly url?: string; readonly resolvedAddresses?: readonly string[]; readonly signal: AbortSignal; readonly onRedirect?: (url: string) => Promise<void> }): Promise<BrowserHostDownload>;
  screenshot(input: { readonly sessionId: string; readonly pageId: string; readonly signal: AbortSignal }): Promise<Uint8Array>;
  extractText(input: { readonly sessionId: string; readonly pageId: string; readonly signal: AbortSignal }): Promise<string>;
  accessibilitySnapshot(input: { readonly sessionId: string; readonly pageId: string; readonly signal: AbortSignal }): Promise<unknown>;
  wait(input: { readonly sessionId: string; readonly pageId: string; readonly condition: BrowserWaitCondition; readonly signal: AbortSignal; readonly onRedirect?: (url: string) => Promise<void> }): Promise<void>;
  inspectUrl(input: { readonly sessionId: string; readonly pageId: string; readonly signal: AbortSignal }): Promise<string>;
}

export type BrowserActionRequest =
  | { readonly action: 'navigate'; readonly session: BrowserSession; readonly page: BrowserPage; readonly url: string }
  | { readonly action: 'click'; readonly session: BrowserSession; readonly page: BrowserPage; readonly selector: string }
  | { readonly action: 'fill'; readonly session: BrowserSession; readonly page: BrowserPage; readonly selector: string; readonly value: string }
  | { readonly action: 'select'; readonly session: BrowserSession; readonly page: BrowserPage; readonly selector: string; readonly value: string }
  | { readonly action: 'keyboard'; readonly session: BrowserSession; readonly page: BrowserPage; readonly key: string }
  | { readonly action: 'submit'; readonly session: BrowserSession; readonly page: BrowserPage; readonly formScope: string }
  | { readonly action: 'upload'; readonly session: BrowserSession; readonly page: BrowserPage; readonly filePath: string; readonly destinationOrigin: string; readonly formScope: string }
  | { readonly action: 'download'; readonly session: BrowserSession; readonly page: BrowserPage; readonly url?: string }
  | { readonly action: 'screenshot' | 'extract_text' | 'accessibility_snapshot' | 'inspect_url'; readonly session: BrowserSession; readonly page: BrowserPage }
  | { readonly action: 'wait'; readonly session: BrowserSession; readonly page: BrowserPage; readonly condition: BrowserWaitCondition };

export interface BrowserActionResult {
  readonly receipt: BrowserActionReceipt;
  readonly observation?: BrowserObservation;
  readonly artifact?: Readonly<{ readonly bytes: Uint8Array; readonly sha256: string }>;
  readonly download?: DownloadReceipt;
}

export interface BrowserRuntime {
  readonly format: typeof FURY_BROWSER_RUNTIME_FORMAT;
  createSession(principalId: string): Promise<BrowserSession>;
  closeSession(session: BrowserSession): Promise<void>;
  createPage(session: BrowserSession): Promise<BrowserPage>;
  closePage(session: BrowserSession, page: BrowserPage): Promise<void>;
  inspectSession(session: BrowserSession): BrowserSession;
  inspectPage(session: BrowserSession, page: BrowserPage): BrowserPage;
  authorize(request: BrowserActionRequest, options?: { readonly ttlMs?: number; readonly timeoutMs?: number }): Promise<BrowserActionPermit>;
  invoke(permit: BrowserActionPermit, options?: { readonly signal?: AbortSignal }): Promise<BrowserActionResult>;
}

interface SessionState {
  readonly sessionId: string;
  readonly principalId: string;
  readonly createdAt: number;
  status: BrowserSessionStatus;
  readonly pages: Map<string, PageState>;
  pendingPages: number;
}

interface PageState {
  readonly pageId: string;
  readonly sessionId: string;
  status: BrowserPageStatus;
  currentUrl: string;
  readonly history: string[];
}

interface PermitState {
  readonly request: BrowserActionRequest;
  readonly session: SessionState;
  readonly page: PageState;
  readonly pageUrl: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly policySha256: string;
  readonly targetSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly timeoutMs: number;
  consumed: boolean;
}

const SESSION_STATE = new WeakMap<object, SessionState>();
const PAGE_STATE = new WeakMap<object, PageState>();
const PERMIT_STATE = new WeakMap<object, PermitState>();

const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_MAX_PAGES = 8;
const DEFAULT_MAX_HISTORY = 32;
const DEFAULT_MAX_TTL_MS = 60_000;
const DEFAULT_MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OBSERVATION_BYTES = 256 * 1024;
const DEFAULT_MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
const MAX_ID_BYTES = 128;
const MAX_SELECTOR_BYTES = 4096;
const MAX_VALUE_BYTES = 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const DANGEROUS_EXTENSIONS = new Set([
  '.bat', '.cmd', '.com', '.dll', '.exe', '.hta', '.jar', '.js', '.jse',
  '.lnk', '.msi', '.ps1', '.scr', '.vbe', '.vbs', '.wsf',
]);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const SECRET_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|credential)/iu;
const INSTRUCTION_LIKE = /\b(?:ignore|disregard|override|previous|system|developer|assistant|execute|run|upload|download|password|secret)\b/iu;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BrowserRuntimeError('invalid-request', label + ' must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new BrowserRuntimeError('invalid-request', label + ' must use a plain-object prototype');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new BrowserRuntimeError('invalid-request', label + ' must not contain symbols');
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new BrowserRuntimeError('invalid-request', label + ' must contain data properties');
    }
  }
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BrowserRuntimeError('invalid-request', label + ' contains unsupported fields');
  }
}

function boundedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || utf8Bytes(value) > MAX_ID_BYTES) {
    throw new BrowserRuntimeError('invalid-request', label + ' is invalid');
  }
  return value;
}

function boundedText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || utf8Bytes(value) > maxBytes) {
    throw new BrowserRuntimeError('invalid-request', label + ' is invalid or exceeds its bound');
  }
  return value;
}

function finiteTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BrowserRuntimeError('invalid-request', label + ' must be a non-negative safe integer');
  }
  return value;
}

function boundedOption(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new BrowserRuntimeError('invalid-request', label + ' must be between ' + min + ' and ' + max);
  }
  return resolved;
}

function principalDigest(principalId: string): string {
  return sha256('principal:' + principalId);
}

function sessionDigest(sessionId: string): string {
  return sha256('session:' + sessionId);
}

function pageDigest(pageId: string): string {
  return sha256('page:' + pageId);
}

function normalizedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserRuntimeError('url-invalid', 'browser URL is invalid');
  }
  if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password || url.hash) {
    throw new BrowserRuntimeError('url-invalid', 'browser URL must be an HTTP(S) URL without credentials or fragments');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new BrowserRuntimeError('url-invalid', 'browser URL port is not allowed');
  }
  return url.origin;
}

function expandIpv6(value: string): readonly bigint[] {
  const withoutZone = value.split('%', 1)[0] ?? value;
  const halves = withoutZone.split('::');
  if (halves.length > 2) return [];
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const parse = (part: string): number[] => /^[0-9a-f]{1,4}$/iu.test(part) ? [Number.parseInt(part, 16)] : [];
  let leftValues = left.flatMap(parse);
  let rightValues = right.flatMap(parse);
  if (leftValues.length !== left.length || rightValues.length !== right.length) return [];
  if (leftValues.length + rightValues.length < 8) {
    const zeros = Array.from({ length: 8 - leftValues.length - rightValues.length }, () => 0);
    leftValues = [...leftValues, ...zeros];
  } else if (leftValues.length + rightValues.length !== 8) {
    return [];
  }
  return [...leftValues, ...rightValues].map((part) => BigInt(part));
}

function ipv4Parts(value: string): readonly number[] {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^[0-9]{1,3}$/u.test(part))) return [];
  const numbers = parts.map((part) => Number(part));
  return numbers.some((part) => part > 255) ? [] : numbers;
}

function ipv4Blocked(value: string): boolean {
  const parts = ipv4Parts(value);
  if (parts.length !== 4) return true;
  const first = parts[0] ?? 0;
  const second = parts[1] ?? 0;
  const third = parts[2] ?? 0;
  return (
    first === 0 || first === 10 || (first === 100 && second >= 64 && second <= 127)
    || first === 127 || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0 && third === 113) || first >= 224
  );
}

function ipv6Blocked(value: string): boolean {
  const parts = expandIpv6(value);
  if (parts.length !== 8) return true;
  const first = Number(parts[0] ?? 0);
  const second = Number(parts[1] ?? 0);
  const unspecified = parts.every((part) => part === 0n);
  const loopback = parts.slice(0, 7).every((part) => part === 0n) && parts[7] === 1n;
  const uniqueLocal = (first & 0xfe00) === 0xfc00;
  const linkLocal = (first & 0xffc0) === 0xfe80;
  const multicast = (first & 0xff00) === 0xff00;
  const documentation = first === 0x2001 && second === 0x0db8;
  const mapped = parts.slice(0, 5).every((part) => part === 0n) && parts[5] === 0xffffn;
  if (mapped) {
    const mappedIp = String(Number((parts[6] ?? 0n) >> 8n)) + '.'
      + String(Number((parts[6] ?? 0n) & 255n)) + '.'
      + String(Number((parts[7] ?? 0n) >> 8n)) + '.'
      + String(Number((parts[7] ?? 0n) & 255n));
    return ipv4Blocked(mappedIp);
  }
  return unspecified || loopback || uniqueLocal || linkLocal || multicast || documentation;
}

function blockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4Blocked(address);
  if (version === 6) return ipv6Blocked(address);
  return true;
}

function validateHostName(hostname: string): void {
  const lower = hostname.toLowerCase().replace(/\.$/u, '');
  if (
    lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')
    || lower.endsWith('.internal') || lower === 'metadata.google.internal'
    || lower === 'instance-data.ec2.internal'
  ) {
    throw new BrowserRuntimeError('url-private', 'browser hostname is local or internal');
  }
}

async function defaultResolveHostname(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return Object.freeze(records.map((record) => record.address));
}

export async function validateBrowserUrl(
  value: string,
  options: {
    readonly allowedOrigins?: readonly string[];
    readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  } = {},
): Promise<{ readonly url: string; readonly origin: string; readonly addresses: readonly string[] }> {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || utf8Bytes(value) > 8192) {
    throw new BrowserRuntimeError('url-invalid', 'browser URL is invalid');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserRuntimeError('url-invalid', 'browser URL is not absolute');
  }
  if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password || url.hash) {
    throw new BrowserRuntimeError('url-invalid', 'browser URL must be an HTTP(S) URL without credentials or fragments');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new BrowserRuntimeError('url-invalid', 'browser URL port is not allowed');
  }
  validateHostName(url.hostname);
  const origin = url.origin;
  if (options.allowedOrigins !== undefined) {
    const allowed = options.allowedOrigins.map((entry) => normalizedOrigin(entry));
    if (!allowed.includes(origin)) {
      throw new BrowserRuntimeError('url-not-allowed', 'browser URL origin is outside the policy allowlist');
    }
  }
  let addresses: readonly string[];
  if (isIP(url.hostname) !== 0) {
    addresses = Object.freeze([url.hostname]);
  } else {
    try {
      addresses = await (options.resolveHostname ?? defaultResolveHostname)(url.hostname);
    } catch {
      throw new BrowserRuntimeError('url-invalid', 'browser hostname could not be resolved');
    }
    if (addresses.length === 0) throw new BrowserRuntimeError('url-invalid', 'browser hostname has no resolved addresses');
  }
  if (addresses.some(blockedAddress)) {
    throw new BrowserRuntimeError('url-private', 'browser URL resolves to a private, loopback, link-local or metadata address');
  }
  return Object.freeze({ url: url.toString(), origin, addresses: Object.freeze([...addresses]) });
}

function safePolicy(policy: BrowserPolicy): BrowserPolicy {
  assertPlainObject(policy, 'browser policy');
  assertExactKeys(
    policy,
    ['policyId', 'allowedOrigins', 'allowedActions', 'maxActionTtlMs', 'maxTimeoutMs', 'maxObservationBytes', 'maxDownloadBytes', 'maxUploadBytes'],
    'browser policy',
  );
  const policyId = boundedId(policy.policyId, 'browser policy ID');
  if (!Array.isArray(policy.allowedActions) || policy.allowedActions.length === 0 || policy.allowedActions.length > 32) {
    throw new BrowserRuntimeError('invalid-request', 'browser policy allowedActions is invalid');
  }
  const allowed = new Set<BrowserActionName>();
  for (const action of policy.allowedActions) {
    if (![
      'navigate', 'click', 'fill', 'select', 'keyboard', 'submit', 'upload', 'download',
      'screenshot', 'extract_text', 'accessibility_snapshot', 'wait', 'inspect_url',
    ].includes(action)) {
      throw new BrowserRuntimeError('invalid-request', 'browser policy contains an unsupported action');
    }
    if (allowed.has(action)) throw new BrowserRuntimeError('invalid-request', 'browser policy contains duplicate actions');
    allowed.add(action);
  }
  const origins = policy.allowedOrigins === undefined
    ? undefined
    : Object.freeze(policy.allowedOrigins.map((origin) => normalizedOrigin(origin)).sort());
  return Object.freeze({
    policyId,
    ...(origins === undefined ? {} : { allowedOrigins: origins }),
    allowedActions: Object.freeze([...allowed].sort() as BrowserActionName[]),
    maxActionTtlMs: boundedOption(policy.maxActionTtlMs, DEFAULT_MAX_TTL_MS, 1, DEFAULT_MAX_TTL_MS, 'maxActionTtlMs'),
    maxTimeoutMs: boundedOption(policy.maxTimeoutMs, DEFAULT_MAX_TIMEOUT_MS, 1, 10 * 60_000, 'maxTimeoutMs'),
    maxObservationBytes: boundedOption(policy.maxObservationBytes, DEFAULT_MAX_OBSERVATION_BYTES, 256, 4 * 1024 * 1024, 'maxObservationBytes'),
    maxDownloadBytes: boundedOption(policy.maxDownloadBytes, DEFAULT_MAX_DOWNLOAD_BYTES, 1, 256 * 1024 * 1024, 'maxDownloadBytes'),
    maxUploadBytes: boundedOption(policy.maxUploadBytes, DEFAULT_MAX_UPLOAD_BYTES, 1, 256 * 1024 * 1024, 'maxUploadBytes'),
  });
}

function policyDigest(policy: BrowserPolicy): string {
  return sha256(JSON.stringify(policy));
}

function validateSelector(value: unknown, label: string): string {
  return boundedText(value, label, MAX_SELECTOR_BYTES);
}

function validateActionRequest(request: BrowserActionRequest): void {
  assertPlainObject(request, 'browser action request');
  if (typeof request.action !== 'string') throw new BrowserRuntimeError('invalid-request', 'browser action is missing');
  const allowedKeys: Readonly<Record<string, readonly string[]>> = {
    navigate: ['action', 'session', 'page', 'url'],
    click: ['action', 'session', 'page', 'selector'],
    fill: ['action', 'session', 'page', 'selector', 'value'],
    select: ['action', 'session', 'page', 'selector', 'value'],
    keyboard: ['action', 'session', 'page', 'key'],
    submit: ['action', 'session', 'page', 'formScope'],
    upload: ['action', 'session', 'page', 'filePath', 'destinationOrigin', 'formScope'],
    download: ['action', 'session', 'page', 'url'],
    screenshot: ['action', 'session', 'page'],
    extract_text: ['action', 'session', 'page'],
    accessibility_snapshot: ['action', 'session', 'page'],
    wait: ['action', 'session', 'page', 'condition'],
    inspect_url: ['action', 'session', 'page'],
  };
  const keys = allowedKeys[request.action];
  if (keys === undefined) throw new BrowserRuntimeError('unsupported-action', 'browser action is unsupported');
  assertExactKeys(request as unknown as Record<string, unknown>, keys, 'browser action request');
  if (!SESSION_STATE.has(request.session as unknown as object)) {
    throw new BrowserRuntimeError('invalid-session', 'browser session is not process-local evidence');
  }
  if (!PAGE_STATE.has(request.page as unknown as object)) {
    throw new BrowserRuntimeError('invalid-page', 'browser page is not process-local evidence');
  }
  if (request.action === 'click' || request.action === 'fill' || request.action === 'select') {
    validateSelector(request.selector, 'browser selector');
  }
  if (request.action === 'fill' || request.action === 'select') boundedText(request.value, 'browser field value', MAX_VALUE_BYTES);
  if (request.action === 'keyboard') boundedText(request.key, 'browser key', 128);
  if (request.action === 'submit') boundedText(request.formScope, 'browser form scope', MAX_SELECTOR_BYTES);
  if (request.action === 'upload') {
    boundedText(request.filePath, 'browser upload path', 4096);
    normalizedOrigin(request.destinationOrigin);
    boundedText(request.formScope, 'browser form scope', MAX_SELECTOR_BYTES);
  }
  if (request.action === 'navigate' || request.action === 'download') {
    if (request.action === 'navigate' || request.url !== undefined) boundedText(request.url, 'browser URL', 8192);
  }
  if (request.action === 'wait' && ![
    'dom-content-loaded', 'load', 'network-idle', 'next-navigation',
  ].includes(request.condition)) {
    throw new BrowserRuntimeError('invalid-request', 'browser wait condition is unsupported');
  }
}

function requestTarget(request: BrowserActionRequest, page: PageState): Readonly<Record<string, unknown>> {
  switch (request.action) {
    case 'navigate': return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl, url: request.url });
    case 'click': return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl, selector: request.selector });
    case 'fill': return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl, selector: request.selector, valueSha256: sha256(request.value) });
    case 'select': return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl, selector: request.selector, valueSha256: sha256(request.value) });
    case 'keyboard': return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl, key: request.key });
    case 'submit': return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl, formScope: request.formScope });
    case 'upload': return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl, filePath: resolve(request.filePath), destinationOrigin: normalizedOrigin(request.destinationOrigin), formScope: request.formScope });
    case 'download': return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl, url: request.url });
    case 'wait': return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl, condition: request.condition });
    default: return Object.freeze({ action: request.action, pageId: page.pageId, pageUrl: page.currentUrl });
  }
}

function safeSnapshotSession(state: SessionState): BrowserSession {
  return Object.freeze({
    format: FURY_BROWSER_SESSION_FORMAT,
    sessionId: state.sessionId,
    principalIdSha256: principalDigest(state.principalId),
    createdAt: state.createdAt,
    status: state.status,
    pageCount: state.pages.size,
    executionAuthority: false,
  });
}

function safeSnapshotPage(state: PageState): BrowserPage {
  return Object.freeze({
    format: FURY_BROWSER_PAGE_FORMAT,
    pageId: state.pageId,
    sessionId: state.sessionId,
    status: state.status,
    currentUrl: state.currentUrl,
    historyLength: state.history.length,
    executionAuthority: false,
  });
}

function secretSafeJson(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 16) return '[depth-limited]';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (typeof value !== 'object') return '[' + typeof value + ']';
  if (seen.has(value)) return '[cycle]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 1024).map((entry) => secretSafeJson(entry, depth + 1, seen));
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).slice(0, 1024)) {
    output[key] = SECRET_KEY.test(key) ? '[redacted]' : secretSafeJson((value as Record<string, unknown>)[key], depth + 1, seen);
  }
  return output;
}

function boundedObservationText(value: unknown, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const raw = typeof value === 'string' ? value : JSON.stringify(secretSafeJson(value)) ?? '';
  const bytes = Buffer.from(raw, 'utf8');
  if (bytes.byteLength <= maxBytes) return Object.freeze({ text: raw, truncated: false });
  return Object.freeze({ text: bytes.subarray(0, maxBytes).toString('utf8'), truncated: true });
}

function observation(kind: BrowserObservation['kind'], value: unknown, maxBytes: number): BrowserObservation {
  const bounded = boundedObservationText(value, maxBytes);
  return Object.freeze({
    format: FURY_BROWSER_OBSERVATION_FORMAT,
    kind,
    text: bounded.text,
    textSha256: sha256(bounded.text),
    bytes: utf8Bytes(bounded.text),
    truncated: bounded.truncated,
    instructionLike: INSTRUCTION_LIKE.test(bounded.text),
    trust: 'untrusted-data',
    executionAuthority: false,
  });
}

function sanitizedFilename(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[\/\\\u0000-\u001f\u007f]/gu, '_').trim();
  const base = basename(normalized).replace(/[ .]+$/gu, '');
  const fallback = base.length > 0 ? base : 'download.bin';
  const lower = fallback.toLowerCase();
  const extension = extname(lower);
  const dangerous = DANGEROUS_EXTENSIONS.has(extension)
    || WINDOWS_RESERVED_NAME.test(fallback)
    || lower.startsWith('.')
    || /\.[a-z0-9]{1,12}\.(?:exe|com|bat|cmd|js|ps1|vbs|scr|msi)$/iu.test(lower);
  if (dangerous) return 'download-' + sha256(fallback).slice(0, 16) + '.bin';
  return fallback.slice(0, 240);
}

function contained(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

async function validatedUploadPath(
  filePath: string,
  roots: readonly string[],
  maxBytes: number,
): Promise<{ readonly filePath: string; readonly sha256: string; readonly bytes: number }> {
  let real: string;
  try {
    const info = await stat(resolve(filePath));
    if (!info.isFile()) throw new Error('not-file');
    real = await realpath(resolve(filePath));
  } catch {
    throw new BrowserRuntimeError('upload-invalid', 'upload path is unavailable or not a regular file');
  }
  const canonicalRoots = await Promise.all(roots.map(async (root) => {
    try {
      return await realpath(root);
    } catch {
      return undefined;
    }
  }));
  if (!canonicalRoots.some((root) => root !== undefined && contained(root, real))) {
    throw new BrowserRuntimeError('upload-invalid', 'upload path is outside the governed upload roots');
  }
  const info = await stat(real);
  if (info.size > maxBytes) throw new BrowserRuntimeError('upload-invalid', 'upload file exceeds the governed byte limit');
  const bytes = new Uint8Array(await readFile(real));
  return Object.freeze({ filePath: real, sha256: sha256(bytes), bytes: bytes.byteLength });
}

async function writeDownload(
  root: string,
  download: BrowserHostDownload,
  maxBytes: number,
  urlOptions: { readonly allowedOrigins?: readonly string[]; readonly resolveHostname?: (hostname: string) => Promise<readonly string[]> },
  now: () => number,
): Promise<DownloadReceipt> {
  if (!(download.bytes instanceof Uint8Array) || download.bytes.byteLength > maxBytes) {
    throw new BrowserRuntimeError('download-invalid', 'download exceeds the governed byte limit');
  }
  const source = await validateBrowserUrl(download.sourceUrl, urlOptions);
  const filename = sanitizedFilename(download.filename);
  const mediaType = boundedText(download.mediaType, 'download media type', 256);
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root).catch(() => undefined);
  if (canonicalRoot === undefined) throw new BrowserRuntimeError('download-invalid', 'download root is unavailable');
  const target = join(canonicalRoot, filename);
  if (!contained(canonicalRoot, target) || dirname(target) !== canonicalRoot) throw new BrowserRuntimeError('download-invalid', 'download filename escapes the governed root');
  const startedAt = now();
  try {
    const existing = await stat(target);
    if (!existing.isFile()) throw new Error('download-target-not-file');
    throw new BrowserRuntimeError('download-invalid', 'download target already exists');
  } catch (error) {
    if (error instanceof BrowserRuntimeError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const file = await open(target, 'wx', 0o600);
  try {
    await file.writeFile(download.bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  return Object.freeze({
    format: FURY_BROWSER_DOWNLOAD_FORMAT,
    receiptId: 'bdl_' + randomUUID(),
    filename,
    path: target,
    mediaType,
    bytes: download.bytes.byteLength,
    sha256: sha256(download.bytes),
    sourceUrlSha256: sha256(source.url),
    startedAt,
    finishedAt: now(),
    scanStatus: 'not-run',
    openedAutomatically: false,
    executedAutomatically: false,
    executionAuthority: false,
  });
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): Promise<{ readonly state: 'completed'; readonly value: T } | { readonly state: 'timeout' | 'cancelled' }> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (parentSignal?.aborted) return Object.freeze({ state: 'cancelled' });
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new BrowserRuntimeError('timeout', 'browser action timed out'));
      }, timeoutMs);
      timer.unref();
    });
    const value = await Promise.race([operation(controller.signal), timeout]);
    return Object.freeze({ state: 'completed' as const, value });
  } catch (error) {
    if (error instanceof BrowserRuntimeError && error.code === 'timeout') return Object.freeze({ state: 'timeout' });
    if (parentSignal?.aborted) return Object.freeze({ state: 'cancelled' });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

export function isGeneratedBrowserSession(value: unknown): value is BrowserSession {
  return typeof value === 'object' && value !== null && SESSION_STATE.has(value);
}

export function isGeneratedBrowserPage(value: unknown): value is BrowserPage {
  return typeof value === 'object' && value !== null && PAGE_STATE.has(value);
}

export function isGeneratedBrowserActionPermit(value: unknown): value is BrowserActionPermit {
  return typeof value === 'object' && value !== null && PERMIT_STATE.has(value);
}

export function createManagedBrowserRuntime(options: BrowserRuntimeOptions): BrowserRuntime {
  if (!options || typeof options !== 'object' || !options.host) throw new BrowserRuntimeError('invalid-request', 'browser host is required');
  const policy = safePolicy(options.policy);
  const policySha256 = policyDigest(policy);
  const now = options.now ?? Date.now;
  const maxSessions = boundedOption(options.maxSessions, DEFAULT_MAX_SESSIONS, 1, 128, 'maxSessions');
  const maxPages = boundedOption(options.maxPagesPerSession, DEFAULT_MAX_PAGES, 1, 128, 'maxPagesPerSession');
  const maxHistory = boundedOption(options.maxHistoryPerPage, DEFAULT_MAX_HISTORY, 1, 1024, 'maxHistoryPerPage');
  const maxObservationBytes = policy.maxObservationBytes ?? DEFAULT_MAX_OBSERVATION_BYTES;
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const uploads = Object.freeze((options.uploadRoots ?? []).map((root) => resolve(root)));
  const downloadsRoot = options.downloadsRoot === undefined ? undefined : resolve(options.downloadsRoot);
  const sessions = new Map<string, SessionState>();
  let pendingSessions = 0;
  const at = (): number => finiteTimestamp(now(), 'browser clock');
  const requireSession = (value: BrowserSession): SessionState => {
    const state = SESSION_STATE.get(value as unknown as object);
    if (!state) throw new BrowserRuntimeError('invalid-session', 'browser session is not process-local evidence');
    return state;
  };
  const requirePage = (session: BrowserSession, value: BrowserPage): { readonly session: SessionState; readonly page: PageState } => {
    const sessionState = requireSession(session);
    const page = PAGE_STATE.get(value as unknown as object);
    if (!page || page.sessionId !== sessionState.sessionId) throw new BrowserRuntimeError('invalid-page', 'browser page is not bound to browser session');
    if (sessionState.status !== 'active') throw new BrowserRuntimeError('session-closed', 'browser session is closed');
    if (page.status !== 'open') throw new BrowserRuntimeError('page-closed', 'browser page is closed');
    return Object.freeze({ session: sessionState, page });
  };
  const checkedAction = async (request: BrowserActionRequest): Promise<{ readonly session: SessionState; readonly page: PageState; readonly target: Readonly<Record<string, unknown>> }> => {
    validateActionRequest(request);
    const session = requireSession(request.session);
    const page = requirePage(request.session, request.page).page;
    if (request.action === 'navigate' || (request.action === 'download' && request.url !== undefined)) {
      await validateBrowserUrl(request.action === 'navigate' ? request.url : request.url!, { allowedOrigins: policy.allowedOrigins, resolveHostname });
    }
    let target: Readonly<Record<string, unknown>> = requestTarget(request, page);
    if (request.action === 'upload') {
      await validateBrowserUrl(request.destinationOrigin, { allowedOrigins: policy.allowedOrigins, resolveHostname });
      if (uploads.length === 0) throw new BrowserRuntimeError('upload-invalid', 'upload roots are not configured');
      const file = await validatedUploadPath(request.filePath, uploads, policy.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES);
      target = Object.freeze({ ...target, filePath: file.filePath, fileSha256: file.sha256, fileBytes: file.bytes });
    }
    return Object.freeze({ session, page, target });
  };
  const invokeHost = async (
    request: BrowserActionRequest,
    session: SessionState,
    page: PageState,
    signal: AbortSignal,
    onRedirect: (url: string) => Promise<void>,
    expectedUploadSha256?: string,
  ): Promise<{ readonly value: unknown; readonly pageUrl?: string; readonly redirects?: readonly string[] }> => {
    const base = { sessionId: session.sessionId, pageId: page.pageId, signal };
    const navigation = (value: void | BrowserHostNavigationResult, resultValue: unknown = null): { readonly value: unknown; readonly pageUrl?: string; readonly redirects?: readonly string[] } => value === undefined
      ? Object.freeze({ value: resultValue })
      : Object.freeze({ value: resultValue, pageUrl: value.finalUrl, redirects: value.redirects });
    switch (request.action) {
      case 'navigate': {
        const checked = await validateBrowserUrl(request.url, { allowedOrigins: policy.allowedOrigins, resolveHostname });
        const result = await options.host.navigate({ ...base, url: checked.url, resolvedAddresses: checked.addresses, onRedirect });
        return Object.freeze({ value: result, pageUrl: result.finalUrl, redirects: result.redirects });
      }
      case 'click': return navigation(await options.host.click({ ...base, selector: request.selector, onRedirect }));
      case 'fill': return navigation(await options.host.fill({ ...base, selector: request.selector, value: request.value, onRedirect }));
      case 'select': return navigation(await options.host.select({ ...base, selector: request.selector, value: request.value, onRedirect }));
      case 'keyboard': return navigation(await options.host.keyboard({ ...base, key: request.key, onRedirect }));
      case 'submit': {
        const result = await options.host.submit({ ...base, formScope: request.formScope, onRedirect });
        return Object.freeze({ value: result, pageUrl: result.finalUrl, redirects: result.redirects });
      }
      case 'upload': {
        const destination = await validateBrowserUrl(request.destinationOrigin, { allowedOrigins: policy.allowedOrigins, resolveHostname });
        const file = await validatedUploadPath(request.filePath, uploads, policy.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES);
        if (expectedUploadSha256 !== undefined && file.sha256 !== expectedUploadSha256) {
          throw new BrowserRuntimeError('permit-invalid', 'upload file changed after permit authorization');
        }
        const result = await options.host.upload({ ...base, filePath: file.filePath, destinationOrigin: destination.origin, destinationAddresses: destination.addresses, formScope: request.formScope, onRedirect });
        return navigation(result, file);
      }
      case 'download': {
        const checked = request.url === undefined
          ? undefined
          : await validateBrowserUrl(request.url, { allowedOrigins: policy.allowedOrigins, resolveHostname });
        return Object.freeze({ value: await options.host.download({ ...base, ...(checked === undefined ? {} : { url: checked.url, resolvedAddresses: checked.addresses }), onRedirect }) });
      }
      case 'screenshot': return Object.freeze({ value: await options.host.screenshot(base) });
      case 'extract_text': return Object.freeze({ value: await options.host.extractText(base) });
      case 'accessibility_snapshot': return Object.freeze({ value: await options.host.accessibilitySnapshot(base) });
      case 'wait': await options.host.wait({ ...base, condition: request.condition, onRedirect }); return Object.freeze({ value: null });
      case 'inspect_url': return Object.freeze({ value: await options.host.inspectUrl(base) });
      default: throw new BrowserRuntimeError('unsupported-action', 'browser action is unsupported');
    }
  };

  return Object.freeze({
    format: FURY_BROWSER_RUNTIME_FORMAT,
    async createSession(principalId: string): Promise<BrowserSession> {
      boundedId(principalId, 'browser principal ID');
      if (sessions.size + pendingSessions >= maxSessions) throw new BrowserRuntimeError('policy-denied', 'browser session limit reached');
      const sessionId = 'brs_' + randomUUID();
      const state: SessionState = { sessionId, principalId, createdAt: at(), status: 'active', pages: new Map(), pendingPages: 0 };
      pendingSessions += 1;
      let result: Awaited<ReturnType<typeof withTimeout<void>>>;
      try {
        result = await withTimeout((signal) => options.host.createSession({ sessionId, signal }), policy.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS, undefined);
      } finally {
        pendingSessions -= 1;
      }
      if (result.state !== 'completed') throw new BrowserRuntimeError(result.state === 'timeout' ? 'timeout' : 'cancelled', 'browser session creation did not complete');
      sessions.set(sessionId, state);
      const snapshot = safeSnapshotSession(state);
      SESSION_STATE.set(snapshot, state);
      return snapshot;
    },
    async closeSession(session: BrowserSession): Promise<void> {
      const state = requireSession(session);
      if (state.status === 'closed') return;
      const result = await withTimeout((signal) => options.host.closeSession({ sessionId: state.sessionId, signal }), policy.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS, undefined);
      if (result.state !== 'completed') throw new BrowserRuntimeError(result.state === 'timeout' ? 'timeout' : 'cancelled', 'browser session close did not complete');
      state.status = 'closed';
      for (const page of state.pages.values()) page.status = 'closed';
      sessions.delete(state.sessionId);
    },
    async createPage(session: BrowserSession): Promise<BrowserPage> {
      const state = requireSession(session);
      if (state.status !== 'active') throw new BrowserRuntimeError('session-closed', 'browser session is closed');
      if (state.pages.size + state.pendingPages >= maxPages) throw new BrowserRuntimeError('policy-denied', 'browser page limit reached');
      const pageId = 'brp_' + randomUUID();
      const page: PageState = { pageId, sessionId: state.sessionId, status: 'open', currentUrl: 'about:blank', history: [] };
      state.pendingPages += 1;
      let result: Awaited<ReturnType<typeof withTimeout<void>>>;
      try {
        result = await withTimeout((signal) => options.host.createPage({ sessionId: state.sessionId, pageId, signal }), policy.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS, undefined);
      } finally {
        state.pendingPages -= 1;
      }
      if (result.state !== 'completed') throw new BrowserRuntimeError(result.state === 'timeout' ? 'timeout' : 'cancelled', 'browser page creation did not complete');
      if (state.status !== 'active') {
        await options.host.closePage({ sessionId: state.sessionId, pageId, signal: new AbortController().signal }).catch(() => undefined);
        throw new BrowserRuntimeError('session-closed', 'browser session closed while page was being created');
      }
      state.pages.set(pageId, page);
      const snapshot = safeSnapshotPage(page);
      PAGE_STATE.set(snapshot, page);
      return snapshot;
    },
    async closePage(session: BrowserSession, page: BrowserPage): Promise<void> {
      const state = requirePage(session, page);
      const result = await withTimeout((signal) => options.host.closePage({ sessionId: state.session.sessionId, pageId: state.page.pageId, signal }), policy.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS, undefined);
      if (result.state !== 'completed') throw new BrowserRuntimeError(result.state === 'timeout' ? 'timeout' : 'cancelled', 'browser page close did not complete');
      state.page.status = 'closed';
      state.session.pages.delete(state.page.pageId);
    },
    inspectSession(session: BrowserSession): BrowserSession {
      return safeSnapshotSession(requireSession(session));
    },
    inspectPage(session: BrowserSession, page: BrowserPage): BrowserPage {
      return safeSnapshotPage(requirePage(session, page).page);
    },
    async authorize(request: BrowserActionRequest, requestOptions: { readonly ttlMs?: number; readonly timeoutMs?: number } = {}): Promise<BrowserActionPermit> {
      validateActionRequest(request);
      if (!policy.allowedActions.includes(request.action)) throw new BrowserRuntimeError('policy-denied', 'browser action is not allowed: ' + request.action);
      const checked = await checkedAction(request);
      const ttlMs = boundedOption(requestOptions.ttlMs, policy.maxActionTtlMs ?? DEFAULT_MAX_TTL_MS, 1, policy.maxActionTtlMs ?? DEFAULT_MAX_TTL_MS, 'browser permit TTL');
      const timeoutMs = boundedOption(requestOptions.timeoutMs, policy.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS, 1, policy.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS, 'browser action timeout');
      const issuedAt = at();
      const expiresAt = issuedAt + ttlMs;
      if (!Number.isSafeInteger(expiresAt)) throw new BrowserRuntimeError('invalid-request', 'browser permit expiry is unsafe');
      const targetSha256 = sha256(JSON.stringify(checked.target));
      const permitId = 'brpmt_' + randomUUID();
      const boundRequest = Object.freeze({ ...request }) as BrowserActionRequest;
      const permitState: PermitState = {
        request: boundRequest, session: checked.session, page: checked.page, pageUrl: checked.page.currentUrl, target: checked.target,
        policySha256, targetSha256,
        issuedAt, expiresAt, timeoutMs, consumed: false,
      };
      const permit = Object.freeze({
        format: FURY_BROWSER_PERMIT_FORMAT,
        permitId,
        sessionIdSha256: sessionDigest(checked.session.sessionId),
        principalIdSha256: principalDigest(checked.session.principalId),
        pageIdSha256: pageDigest(checked.page.pageId),
        action: request.action, targetSha256, policySha256, issuedAt, expiresAt,
        executionAuthority: false as const,
      });
      PERMIT_STATE.set(permit, permitState);
      return permit;
    },
    async invoke(permit: BrowserActionPermit, invokeOptions: { readonly signal?: AbortSignal } = {}): Promise<BrowserActionResult> {
      const state = PERMIT_STATE.get(permit as unknown as object);
      if (!state) throw new BrowserRuntimeError('permit-invalid', 'browser permit is not process-local evidence');
      if (state.consumed) throw new BrowserRuntimeError('permit-consumed', 'browser permit was already consumed');
      state.consumed = true;
      const now = at();
      if (now > state.expiresAt) throw new BrowserRuntimeError('permit-expired', 'browser permit has expired');
      if (state.session.status !== 'active') throw new BrowserRuntimeError('session-closed', 'browser session is closed');
      if (state.page.status !== 'open') throw new BrowserRuntimeError('page-closed', 'browser page is closed');
      if (state.pageUrl !== state.page.currentUrl) throw new BrowserRuntimeError('permit-invalid', 'browser page changed after permit authorization');
      const common = {
        format: FURY_BROWSER_RECEIPT_FORMAT,
        receiptId: 'brc_' + randomUUID(),
        permitIdSha256: sha256('permit:' + permit.permitId),
        sessionIdSha256: sessionDigest(state.session.sessionId),
        principalIdSha256: principalDigest(state.session.principalId),
        action: state.request.action, targetSha256: state.targetSha256, policySha256: state.policySha256,
        startedAt: now, executionAuthority: false as const,
      };
      const finish = (input: Omit<BrowserActionReceipt, keyof typeof common>): BrowserActionReceipt => Object.freeze({ ...common, ...input });
      let invocation: { readonly value: unknown; readonly pageUrl?: string; readonly redirects?: readonly string[] };
      try {
        const result = await withTimeout(
          (signal) => invokeHost(
            state.request,
            state.session,
            state.page,
            signal,
            async (redirect) => {
            await validateBrowserUrl(redirect, { allowedOrigins: policy.allowedOrigins, resolveHostname });
            },
            state.request.action === 'upload' && typeof state.target.fileSha256 === 'string' ? state.target.fileSha256 : undefined,
          ),
          Math.min(state.timeoutMs, policy.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS),
          invokeOptions.signal,
        );
        if (result.state !== 'completed') {
          return Object.freeze({ receipt: finish({ finishedAt: at(), outcome: 'outcome-unknown', verificationStatus: 'not-verified', errorCode: result.state === 'timeout' ? 'timeout' : 'cancelled' }) });
        }
        invocation = result.value;
        for (const redirect of invocation.redirects ?? []) {
          try {
            await validateBrowserUrl(redirect, { allowedOrigins: policy.allowedOrigins, resolveHostname });
          } catch {
            return Object.freeze({ receipt: finish({ finishedAt: at(), outcome: 'failed', verificationStatus: 'not-verified', redirectCount: invocation.redirects?.length ?? 0, errorCode: 'redirect-private' }) });
          }
        }
      } catch (error) {
        const code = error instanceof BrowserRuntimeError ? error.code : 'host-failed';
        return Object.freeze({ receipt: finish({ finishedAt: at(), outcome: 'failed', verificationStatus: 'not-verified', errorCode: code }) });
      }
      if (invocation.pageUrl !== undefined) {
        const checkedUrl = await validateBrowserUrl(invocation.pageUrl, { allowedOrigins: policy.allowedOrigins, resolveHostname }).catch(() => undefined);
        if (!checkedUrl) return Object.freeze({ receipt: finish({ finishedAt: at(), outcome: 'failed', verificationStatus: 'not-verified', redirectCount: invocation.redirects?.length ?? 0, errorCode: 'redirect-private' }) });
        if (state.page.history.length >= maxHistory) state.page.history.shift();
        state.page.history.push(checkedUrl.url);
        state.page.currentUrl = checkedUrl.url;
      }
      const resultValue = invocation.value;
      if (state.request.action === 'download') {
        if (downloadsRoot === undefined) return Object.freeze({ receipt: finish({ finishedAt: at(), outcome: 'failed', verificationStatus: 'not-verified', errorCode: 'download-invalid' }) });
        try {
          const download = await writeDownload(
            downloadsRoot,
            resultValue as BrowserHostDownload,
            policy.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES,
            { allowedOrigins: policy.allowedOrigins, resolveHostname },
            at,
          );
          return Object.freeze({
            receipt: finish({ finishedAt: at(), outcome: 'succeeded', verificationStatus: 'locally-verified', resultSha256: download.sha256, resultBytes: download.bytes, originSha256: download.sourceUrlSha256 }),
            download,
          });
        } catch (error) {
          const code = error instanceof BrowserRuntimeError ? error.code : 'download-invalid';
          return Object.freeze({ receipt: finish({ finishedAt: at(), outcome: 'failed', verificationStatus: 'not-verified', errorCode: code }) });
        }
      }
      if (state.request.action === 'extract_text' || state.request.action === 'accessibility_snapshot') {
        const data = observation(state.request.action === 'extract_text' ? 'text' : 'accessibility', resultValue, maxObservationBytes);
        return Object.freeze({
          receipt: finish({ finishedAt: at(), outcome: 'succeeded', verificationStatus: 'locally-verified', resultSha256: data.textSha256, resultBytes: data.bytes }),
          observation: data,
        });
      }
      if (state.request.action === 'screenshot') {
        if (!(resultValue instanceof Uint8Array)) return Object.freeze({ receipt: finish({ finishedAt: at(), outcome: 'failed', verificationStatus: 'not-verified', errorCode: 'host-failed' }) });
        const bytes = new Uint8Array(resultValue);
        return Object.freeze({
          receipt: finish({ finishedAt: at(), outcome: 'succeeded', verificationStatus: 'locally-verified', resultSha256: sha256(bytes), resultBytes: bytes.byteLength }),
          artifact: Object.freeze({ bytes, sha256: sha256(bytes) }),
        });
      }
      if (state.request.action === 'inspect_url') {
        const checkedUrl = await validateBrowserUrl(String(resultValue), { allowedOrigins: policy.allowedOrigins, resolveHostname }).catch(() => undefined);
        if (!checkedUrl) return Object.freeze({ receipt: finish({ finishedAt: at(), outcome: 'failed', verificationStatus: 'not-verified', errorCode: 'url-private' }) });
        return Object.freeze({
          receipt: finish({ finishedAt: at(), outcome: 'succeeded', verificationStatus: 'locally-verified', resultSha256: sha256(checkedUrl.url), resultBytes: utf8Bytes(checkedUrl.url), originSha256: sha256(checkedUrl.origin), finalUrlSha256: sha256(checkedUrl.url) }),
        });
      }
      const resultText = resultValue === null || resultValue === undefined ? 'null' : JSON.stringify(secretSafeJson(resultValue)) ?? '';
      return Object.freeze({
        receipt: finish({
          finishedAt: at(), outcome: 'succeeded', verificationStatus: 'locally-verified',
          resultSha256: sha256(resultText), resultBytes: utf8Bytes(resultText),
          ...(invocation.redirects === undefined ? {} : { redirectCount: invocation.redirects.length }),
          ...(invocation.pageUrl === undefined ? {} : { finalUrlSha256: sha256(state.page.currentUrl) }),
        }),
      });
    },
  });
}
