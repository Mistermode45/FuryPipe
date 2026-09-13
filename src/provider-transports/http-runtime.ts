import type { ProviderFabricProtocol } from '../core/provider-fabric.js';
import { MAX_PROVIDER_RESPONSE_BYTES } from '../provider-execution-internal.js';
import { FuryGovernedProviderExecutorError } from '../provider-execution-errors.js';
import type { FuryProviderRequestEnvelope } from '../provider-request-envelope.js';
import type { ProviderTransport, ProviderTransportExecutionContext } from '../provider-transport.js';
import type { ResolvedProviderHttpTransportOptions } from './types.js';

const MAX_RETRY_AFTER_MS = 604_800_000;

function responseTooLargeError(): FuryGovernedProviderExecutorError {
  return new FuryGovernedProviderExecutorError('response-too-large', { transportInvoked: true });
}

function safeTransportFailure(): Error {
  return new Error('Provider HTTP transport request failed.');
}

export interface ProviderHttpResponse {
  readonly status: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  /** Only included for successful HTTP responses; rejected bodies are deliberately discarded. */
  readonly responseBytes?: Uint8Array;
  readonly json?: unknown;
}

export interface ProviderHttpRequestOptions {
  readonly endpoint: string;
  readonly authHeader: 'Authorization' | 'x-goog-api-key';
  readonly bearerAuth?: boolean;
  readonly requestIdHeader?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly runtime: ResolvedProviderHttpTransportOptions;
  readonly context: ProviderTransportExecutionContext;
}

export function createProviderHttpTransport(
  providerId: string,
  protocol: ProviderFabricProtocol,
  runtime: ResolvedProviderHttpTransportOptions,
  buildBody: (request: FuryProviderRequestEnvelope) => Readonly<Record<string, unknown>>,
  requestIdHeader?: string,
  retryDelay?: (headers: Headers, status: number, now: () => number) => number | undefined,
  providerHeaders: Readonly<Record<string, string>> = {},
): ProviderTransport {
  return Object.freeze({
    providerId,
    protocol,
    async execute(request: FuryProviderRequestEnvelope, context: ProviderTransportExecutionContext) {
      if (request.providerId !== providerId || context.providerId !== providerId
        || request.model !== context.model || context.maxResponseBytes !== MAX_PROVIDER_RESPONSE_BYTES) {
        throw safeTransportFailure();
      }
      try {
        const body = buildBody(request);
        const response = await requestJson({
          endpoint: endpointFor(providerId),
          authHeader: providerId === 'google' ? 'x-goog-api-key' : 'Authorization',
          ...(providerId === 'google' ? {} : { bearerAuth: true }),
          ...(requestIdHeader === undefined ? {} : { requestIdHeader }),
          headers: { 'content-type': 'application/json', ...providerHeaders },
          body,
          runtime,
          context,
          ...(retryDelay === undefined ? {} : { retryDelay }),
        });
        const success = response.status >= 200 && response.status < 300;
        return Object.freeze({
          providerId,
          model: request.model,
          networkStatus: 'executed' as const,
          providerRequestStatus: success ? 'accepted' as const : 'rejected' as const,
          httpStatus: response.status,
          ...(response.retryAfterMs === undefined ? {} : { retryAfterMs: response.retryAfterMs }),
          ...(response.requestId === undefined ? {} : { providerRequestId: response.requestId }),
          ...(success && response.responseBytes !== undefined ? { responseBytes: response.responseBytes } : {}),
          ...(success && response.json !== undefined ? normalizeResponse(providerId, response.json) : {}),
        });
      } catch (error) {
        if (error instanceof FuryGovernedProviderExecutorError && error.code === 'response-too-large') throw error;
        throw safeTransportFailure();
      }
    },
  });
}

function endpointFor(providerId: string): string {
  switch (providerId) {
    case 'openai': return 'https://api.openai.com/v1/responses';
    case 'anthropic': return 'https://api.anthropic.com/v1/messages';
    case 'google': return 'https://generativelanguage.googleapis.com/v1/interactions';
    default: throw safeTransportFailure();
  }
}

async function requestJson(options: ProviderHttpRequestOptions & {
  readonly retryDelay?: (headers: Headers, status: number, now: () => number) => number | undefined;
}): Promise<ProviderHttpResponse> {
  const controller = new AbortController();
  const tooLarge = responseTooLargeError();
  let abortFailure: unknown = safeTransportFailure();
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  void aborted.catch(() => undefined);
  const onControllerAbort = () => rejectAbort(abortFailure);
  controller.signal.addEventListener('abort', onControllerAbort, { once: true });

  const cancelActiveBody = () => {
    if (activeReader) void activeReader.cancel().catch(() => undefined);
  };
  const abortWith = (failure: unknown) => {
    if (controller.signal.aborted) return;
    abortFailure = failure;
    controller.abort();
    cancelActiveBody();
  };
  const parentSignal = options.context.signal;
  const onParentAbort = () => abortWith(safeTransportFailure());
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    if (parentSignal?.aborted) abortWith(safeTransportFailure());
    else parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    timer = setTimeout(() => abortWith(safeTransportFailure()), options.runtime.timeoutMs);

    const work = (async () => {
      if (controller.signal.aborted) throw abortFailure;
      const credential = await options.runtime.getCredential();
      if (controller.signal.aborted) throw abortFailure;
      if (typeof credential !== 'string' || credential.length === 0 || credential !== credential.trim() || credential.length > 8192
        || /[\u0000-\u001f\u007f]/u.test(credential)) throw safeTransportFailure();

      const headers = new Headers(options.headers);
      headers.set(options.authHeader, options.bearerAuth ? `Bearer ${credential}` : credential);
      const fetchResult = await options.runtime.fetchImpl(options.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(options.body),
        signal: controller.signal,
        redirect: 'error',
      });
      if (controller.signal.aborted) throw abortFailure;
      if (!Number.isSafeInteger(fetchResult.status) || fetchResult.status < 100 || fetchResult.status > 599) {
        throw safeTransportFailure();
      }

      const contentLength = fetchResult.headers.get('content-length')?.trim();
      if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > options.context.maxResponseBytes) {
        void fetchResult.body?.cancel().catch(() => undefined);
        abortWith(tooLarge);
        throw tooLarge;
      }

      const responseBytes = await readBoundedBody(fetchResult.body, options.context.maxResponseBytes, (reader) => {
        activeReader = reader;
      }, () => { activeReader = undefined; }, abortWith);
      if (controller.signal.aborted) throw abortFailure;
      const success = fetchResult.status >= 200 && fetchResult.status < 300;
      let json: unknown;
      if (success && responseBytes.length > 0) {
        const text = new TextDecoder('utf-8').decode(responseBytes);
        if (text.includes(credential)) throw safeTransportFailure();
        try {
          json = JSON.parse(text) as unknown;
        } catch { /* Keep the bounded HTTP result without parsed metadata. */ }
        if (json !== undefined && containsCredential(json, credential)) throw safeTransportFailure();
      }
      const reportedRequestId = options.requestIdHeader === undefined
        ? undefined
        : safeHeaderValue(fetchResult.headers.get(options.requestIdHeader), 256);
      const requestId = reportedRequestId !== undefined && !reportedRequestId.includes(credential)
        ? reportedRequestId
        : undefined;
      const retryAfterMs = options.retryDelay?.(fetchResult.headers, fetchResult.status, options.runtime.now)
        ?? parseRetryAfter(fetchResult.headers.get('retry-after'), options.runtime.now);
      if (controller.signal.aborted) throw abortFailure;
      return {
        status: fetchResult.status,
        ...(requestId === undefined ? {} : { requestId }),
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        ...(success ? { responseBytes } : {}),
        ...(json === undefined ? {} : { json }),
      } satisfies ProviderHttpResponse;
    })();

    return await Promise.race([work, aborted]);
  } catch (error) {
    if (error instanceof FuryGovernedProviderExecutorError && error.code === 'response-too-large') throw error;
    throw safeTransportFailure();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
    controller.signal.removeEventListener('abort', onControllerAbort);
    cancelActiveBody();
  }
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  setReader: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
  clearReader: () => void,
  abortWith: (failure: unknown) => void,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  setReader(reader);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) {
        completed = true;
        break;
      }
      if (!(part.value instanceof Uint8Array)) {
        abortWith(safeTransportFailure());
        void reader.cancel().catch(() => undefined);
        throw safeTransportFailure();
      }
      if (total + part.value.byteLength > maximum) {
        const tooLarge = responseTooLargeError();
        abortWith(tooLarge);
        throw tooLarge;
      }
      chunks.push(Uint8Array.from(part.value));
      total += part.value.byteLength;
    }
  } finally {
    clearReader();
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function safeHeaderValue(value: string | null, maximum: number): string | undefined {
  if (value === null || value.length === 0 || value.length > maximum || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)) return undefined;
  return value;
}

export function parseRetryAfter(value: string | null, now: () => number): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1000;
    return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_RETRY_AFTER_MS ? milliseconds : undefined;
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return undefined;
  let current: number;
  try {
    current = now();
  } catch {
    return undefined;
  }
  if (!Number.isSafeInteger(current) || current < 0) return undefined;
  const milliseconds = Math.max(0, date - current);
  return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_RETRY_AFTER_MS ? milliseconds : undefined;
}

export function parseProviderReset(value: string | null): number | undefined {
  if (value === null || value.length === 0 || value.length > 100) return undefined;
  const token = /(\d+(?:\.\d+)?)(ms|s|m|h)/gu;
  let position = 0;
  let totalMs = 0;
  for (const match of value.matchAll(token)) {
    if (match.index !== position) return undefined;
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : 3_600_000;
    totalMs += amount * multiplier;
    if (!Number.isFinite(totalMs) || totalMs > MAX_RETRY_AFTER_MS) return undefined;
    position += match[0].length;
  }
  if (position !== value.length) return undefined;
  const rounded = Math.ceil(totalMs);
  return Number.isSafeInteger(rounded) && rounded <= MAX_RETRY_AFTER_MS ? rounded : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function own(record: Record<string, unknown> | undefined, key: string): unknown {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function token(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = own(record, key);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeReason(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined;
}

function containsCredential(value: unknown, credential: string): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      if (current.includes(credential)) return true;
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    const record = object(current);
    if (!record) continue;
    for (const key of Object.keys(record)) {
      if (key.includes(credential)) return true;
      pending.push(record[key]);
    }
  }
  return false;
}

function normalizeResponse(providerId: string, value: unknown): Record<string, unknown> {
  const response = object(value);
  const usageObject = object(own(response, 'usage'));
  if (!response) return {};
  const usage: Record<string, number> = Object.create(null) as Record<string, number>;
  if (providerId === 'openai') {
    const details = object(own(usageObject, 'input_tokens_details'));
    const input = token(usageObject, 'input_tokens');
    const cached = token(details, 'cached_tokens');
    const written = token(details, 'cache_write_tokens');
    const output = token(usageObject, 'output_tokens');
    if (input !== undefined && cached !== undefined && written !== undefined && cached + written <= input) {
      usage.inputTokens = input - cached - written;
    }
    if (cached !== undefined) usage.cacheReadTokens = cached;
    if (written !== undefined) usage.cacheWriteTokens = written;
    if (output !== undefined) usage.outputTokens = output;
    const incomplete = object(own(response, 'incomplete_details'));
    const finishReason = safeReason(own(incomplete, 'reason'));
    return {
      ...(Object.keys(usage).length === 0 ? {} : { usage: Object.freeze(usage) }),
      ...(finishReason === undefined ? {} : { finishReason }),
    };
  }
  if (providerId === 'anthropic') {
    const input = token(usageObject, 'input_tokens');
    const output = token(usageObject, 'output_tokens');
    const cacheWrite = token(usageObject, 'cache_creation_input_tokens');
    const cacheRead = token(usageObject, 'cache_read_input_tokens');
    if (input !== undefined) usage.inputTokens = input;
    if (output !== undefined) usage.outputTokens = output;
    if (cacheWrite !== undefined) usage.cacheWriteTokens = cacheWrite;
    if (cacheRead !== undefined) usage.cacheReadTokens = cacheRead;
    const finishReason = safeReason(own(response, 'stop_reason'));
    return {
      ...(Object.keys(usage).length === 0 ? {} : { usage: Object.freeze(usage) }),
      ...(finishReason === undefined ? {} : { finishReason }),
    };
  }
  const input = token(usageObject, 'total_input_tokens');
  const output = token(usageObject, 'total_output_tokens');
  const cacheRead = token(usageObject, 'total_cached_tokens');
  if (input !== undefined && cacheRead !== undefined && cacheRead <= input) usage.inputTokens = input - cacheRead;
  if (cacheRead !== undefined) usage.cacheReadTokens = cacheRead;
  if (output !== undefined) usage.outputTokens = output;
  return Object.keys(usage).length === 0 ? {} : { usage: Object.freeze(usage) };
}

export function genericRetryAfter(
  headers: Headers,
  _status: number,
  now: () => number,
): number | undefined {
  return parseRetryAfter(headers.get('retry-after'), now);
}
