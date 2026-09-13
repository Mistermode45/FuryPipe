import type { ProviderFabricProtocol } from '../core/provider-fabric.js';
import type { FuryProviderRequestEnvelope } from '../provider-request-envelope.js';
import { FuryGovernedProviderStreamError } from '../provider-stream-errors.js';
import {
  MAX_PROVIDER_STREAM_EVENT_BYTES,
  MAX_PROVIDER_STREAM_TEXT_BYTES,
  MAX_PROVIDER_STREAM_WIRE_BYTES,
  type ProviderStreamTransport,
  type ProviderStreamTransportEvent,
  type ProviderStreamTransportExecutionContext,
} from '../provider-stream-transport.js';
import { parseRetryAfter } from '../provider-transports/http-runtime.js';
import type { ResolvedProviderHttpTransportOptions } from '../provider-transports/types.js';

export interface ProviderSseFrame {
  readonly event: string;
  readonly data: string;
}

export interface ProviderSseEventMapper {
  map(frame: ProviderSseFrame): readonly ProviderStreamTransportEvent[];
}

export interface ProviderSseStreamTransportOptions {
  readonly providerId: string;
  readonly protocol: ProviderFabricProtocol;
  readonly endpoint: string;
  readonly authHeader: 'Authorization' | 'x-goog-api-key';
  readonly bearerAuth?: boolean;
  readonly requestIdHeader?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly runtime: ResolvedProviderHttpTransportOptions;
  readonly buildBody: (request: FuryProviderRequestEnvelope) => Readonly<Record<string, unknown>>;
  readonly createMapper: () => ProviderSseEventMapper;
  readonly retryDelay?: (headers: Headers, status: number, now: () => number) => number | undefined;
}

const encoder = new TextEncoder();

function fail(code: ConstructorParameters<typeof FuryGovernedProviderStreamError>[0]): never {
  throw new FuryGovernedProviderStreamError(code, true);
}

function safeTransportFailure(): FuryGovernedProviderStreamError {
  return new FuryGovernedProviderStreamError('stream-transport-error', true);
}

function validCredential(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 8192
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function safeHeaderValue(value: string | null, maximum: number): string | undefined {
  if (
    value === null
    || value.length === 0
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) return undefined;
  return value;
}

function emptyEvents(): AsyncIterable<unknown> {
  return Object.freeze({
    async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
      return;
    },
  });
}

function separator(buffer: string): { readonly index: number; readonly length: number } | undefined {
  const matches = [
    { index: buffer.indexOf('\r\n\r\n'), length: 4 },
    { index: buffer.indexOf('\n\n'), length: 2 },
    { index: buffer.indexOf('\r\r'), length: 2 },
  ].filter((entry) => entry.index >= 0);
  if (matches.length === 0) return undefined;
  matches.sort((left, right) => left.index - right.index || right.length - left.length);
  return matches[0];
}

function parseFrame(raw: string): ProviderSseFrame | undefined {
  if (raw.length === 0) return undefined;
  const lines = raw.split(/\r\n|\n|\r/u);
  let event = '';
  const data: string[] = [];
  for (const line of lines) {
    if (line.length === 0 || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      event = value;
      continue;
    }
    if (field === 'data') data.push(value);
  }
  if (event.length === 0 && data.length === 0) return undefined;
  if (event.length > 160 || /[\u0000-\u001f\u007f]/u.test(event)) fail('stream-event-invalid');
  return Object.freeze({ event, data: data.join('\n') });
}

function mappedSafe(
  events: readonly ProviderStreamTransportEvent[],
  credential: string,
): readonly ProviderStreamTransportEvent[] {
  if (!Array.isArray(events) || events.length > 8) fail('stream-event-invalid');
  for (let index = 0; index < events.length; index += 1) {
    if (!Object.hasOwn(events, index)) fail('stream-event-invalid');
    const event = events[index];
    if (!event || typeof event !== 'object') fail('stream-event-invalid');
    const exposed = [
      event.text,
      event.finishReason,
      event.errorCode,
      event.providerEventType,
    ];
    if (exposed.some((value) => typeof value === 'string' && value.includes(credential))) {
      fail('stream-event-invalid');
    }
  }
  return events;
}

async function* sseEvents(input: {
  readonly body: ReadableStream<Uint8Array>;
  readonly mapper: ProviderSseEventMapper;
  readonly credential: string;
  readonly context: ProviderStreamTransportExecutionContext;
  readonly setReader: (reader: ReadableStreamDefaultReader<Uint8Array>) => void;
  readonly clearReader: () => void;
  readonly armTimeout: () => void;
}): AsyncGenerator<unknown> {
  const reader = input.body.getReader();
  input.setReader(reader);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let totalWireBytes = 0;
  let completed = false;

  const emitFrame = function* (raw: string): Generator<ProviderStreamTransportEvent> {
    if (encoder.encode(raw).byteLength > input.context.maxEventBytes) {
      fail('stream-event-too-large');
    }
    const frame = parseFrame(raw);
    if (frame === undefined) return;
    let mapped: readonly ProviderStreamTransportEvent[];
    try {
      mapped = input.mapper.map(frame);
    } catch (error) {
      if (error instanceof FuryGovernedProviderStreamError) throw error;
      fail('stream-event-invalid');
    }
    for (const event of mappedSafe(mapped, input.credential)) yield event;
  };

  try {
    while (true) {
      input.armTimeout();
      const part = await reader.read();
      if (part.done) {
        completed = true;
        break;
      }
      if (!(part.value instanceof Uint8Array)) fail('stream-event-invalid');
      totalWireBytes += part.value.byteLength;
      if (totalWireBytes > input.context.maxWireBytes) fail('stream-wire-too-large');

      buffer += decoder.decode(part.value, { stream: true });
      while (true) {
        const boundary = separator(buffer);
        if (boundary === undefined) break;
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        yield* emitFrame(raw);
      }
      if (encoder.encode(buffer).byteLength > input.context.maxEventBytes) {
        fail('stream-event-too-large');
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) yield* emitFrame(buffer);
  } finally {
    input.clearReader();
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function createProviderSseStreamTransport(
  options: ProviderSseStreamTransportOptions,
): ProviderStreamTransport {
  return Object.freeze({
    providerId: options.providerId,
    protocol: options.protocol,

    async open(
      request: FuryProviderRequestEnvelope,
      context: ProviderStreamTransportExecutionContext,
    ) {
      if (
        request.providerId !== options.providerId
        || context.providerId !== options.providerId
        || request.model !== context.model
        || request.requestDigest !== context.requestDigest
        || context.maxEventBytes !== MAX_PROVIDER_STREAM_EVENT_BYTES
        || context.maxTextBytes !== MAX_PROVIDER_STREAM_TEXT_BYTES
        || context.maxWireBytes !== MAX_PROVIDER_STREAM_WIRE_BYTES
      ) throw safeTransportFailure();

      const controller = new AbortController();
      let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const parentSignal = context.signal;

      const cancelReader = () => {
        if (activeReader) void activeReader.cancel().catch(() => undefined);
      };
      const abort = () => {
        if (!controller.signal.aborted) controller.abort();
        cancelReader();
      };
      const armTimeout = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(abort, options.runtime.timeoutMs);
      };
      const onParentAbort = () => abort();
      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        parentSignal?.removeEventListener('abort', onParentAbort);
        cancelReader();
      };

      try {
        if (parentSignal?.aborted) throw safeTransportFailure();
        parentSignal?.addEventListener('abort', onParentAbort, { once: true });
        armTimeout();

        const credential = await options.runtime.getCredential();
        if (!validCredential(credential) || controller.signal.aborted) throw safeTransportFailure();

        const headers = new Headers({
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(options.headers ?? {}),
        });
        headers.set(
          options.authHeader,
          options.bearerAuth ? 'Bearer ' + credential : credential,
        );

        const response = await options.runtime.fetchImpl(options.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(options.buildBody(request)),
          signal: controller.signal,
          redirect: 'error',
        });
        if (controller.signal.aborted) throw safeTransportFailure();
        if (
          !Number.isSafeInteger(response.status)
          || response.status < 100
          || response.status > 599
        ) throw safeTransportFailure();

        const requestIdCandidate = options.requestIdHeader === undefined
          ? undefined
          : safeHeaderValue(response.headers.get(options.requestIdHeader), 256);
        const providerRequestId = requestIdCandidate !== undefined
          && !requestIdCandidate.includes(credential)
          ? requestIdCandidate
          : undefined;
        const retryAfterMs = options.retryDelay?.(
          response.headers,
          response.status,
          options.runtime.now,
        ) ?? parseRetryAfter(response.headers.get('retry-after'), options.runtime.now);
        const success = response.status >= 200 && response.status < 300;

        if (!success) {
          void response.body?.cancel().catch(() => undefined);
          cleanup();
          return Object.freeze({
            providerId: options.providerId,
            model: request.model,
            networkStatus: 'executed' as const,
            providerRequestStatus: 'rejected' as const,
            httpStatus: response.status,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            ...(providerRequestId === undefined ? {} : { providerRequestId }),
            events: emptyEvents(),
          });
        }

        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        if (!contentType.startsWith('text/event-stream') || response.body === null) {
          void response.body?.cancel().catch(() => undefined);
          throw safeTransportFailure();
        }

        const mapper = options.createMapper();
        const events = Object.freeze({
          async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
            try {
              yield* sseEvents({
                body: response.body!,
                mapper,
                credential,
                context,
                setReader: (reader) => { activeReader = reader; },
                clearReader: () => { activeReader = undefined; },
                armTimeout,
              });
            } catch (error) {
              if (error instanceof FuryGovernedProviderStreamError) throw error;
              throw safeTransportFailure();
            } finally {
              cleanup();
            }
          },
        });

        armTimeout();
        return Object.freeze({
          providerId: options.providerId,
          model: request.model,
          networkStatus: 'executed' as const,
          providerRequestStatus: 'accepted' as const,
          httpStatus: response.status,
          ...(providerRequestId === undefined ? {} : { providerRequestId }),
          events,
        });
      } catch (error) {
        cleanup();
        if (error instanceof FuryGovernedProviderStreamError) throw error;
        throw safeTransportFailure();
      }
    },
  });
}
