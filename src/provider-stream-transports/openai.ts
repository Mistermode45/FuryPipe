import type { FuryProviderRequestEnvelope } from '../provider-request-envelope.js';
import type { ProviderStreamTransportEvent } from '../provider-stream-transport.js';
import {
  genericRetryAfter,
  parseProviderReset,
} from '../provider-transports/http-runtime.js';
import {
  resolveProviderHttpTransportOptions,
  type ProviderHttpTransportOptions,
} from '../provider-transports/types.js';
import {
  createProviderSseStreamTransport,
  type ProviderSseEventMapper,
  type ProviderSseFrame,
} from './http-runtime.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parse(frame: ProviderSseFrame): Record<string, unknown> | undefined {
  if (frame.data.length === 0) return undefined;
  try {
    return record(JSON.parse(frame.data) as unknown);
  } catch {
    return undefined;
  }
}

function token(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source && Object.hasOwn(source, key) ? source[key] : undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeString(value: unknown, maximum = 128): string | undefined {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

function usage(response: Record<string, unknown> | undefined): ProviderStreamTransportEvent['usage'] {
  const raw = record(response?.usage);
  const details = record(raw?.input_tokens_details);
  const totalInput = token(raw, 'input_tokens');
  const cached = token(details, 'cached_tokens');
  const written = token(details, 'cache_write_tokens');
  const output = token(raw, 'output_tokens');
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  if (
    totalInput !== undefined
    && cached !== undefined
    && written !== undefined
    && cached + written <= totalInput
  ) result.inputTokens = totalInput - cached - written;
  if (cached !== undefined) result.cacheReadTokens = cached;
  if (written !== undefined) result.cacheWriteTokens = written;
  if (output !== undefined) result.outputTokens = output;
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
}

function eventType(frame: ProviderSseFrame, value: Record<string, unknown> | undefined): string {
  const jsonType = safeString(value?.type, 160);
  if (frame.event.length > 0 && jsonType !== undefined && frame.event !== jsonType) {
    throw new TypeError('provider SSE event type mismatch');
  }
  return jsonType ?? (frame.event.length > 0 ? frame.event : 'unknown');
}

function mapper(): ProviderSseEventMapper {
  return Object.freeze({
    map(frame: ProviderSseFrame): readonly ProviderStreamTransportEvent[] {
      const value = parse(frame);
      const type = eventType(frame, value);

      if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
        const delta = value?.delta;
        if (typeof delta !== 'string' || delta.length === 0) return [];
        return [Object.freeze({
          kind: 'text-delta' as const,
          providerEventType: type,
          text: delta,
        })];
      }

      if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.failed') {
        if (!value) return [];
        const response = record(value.response);
        const normalizedUsage = usage(response);
        const incomplete = record(response?.incomplete_details);
        const responseError = record(response?.error);
        const terminalStatus = type === 'response.completed'
          ? 'completed' as const
          : type === 'response.incomplete'
            ? 'incomplete' as const
            : 'failed' as const;
        return [Object.freeze({
          kind: 'terminal' as const,
          providerEventType: type,
          terminalStatus,
          ...(normalizedUsage === undefined ? {} : { usage: normalizedUsage }),
          ...(safeString(incomplete?.reason) === undefined
            ? {}
            : { finishReason: safeString(incomplete?.reason)! }),
          ...(terminalStatus !== 'failed' || safeString(responseError?.code) === undefined
            ? {}
            : { finishReason: safeString(responseError?.code)! }),
        })];
      }

      if (type === 'error') {
        const error = record(value?.error);
        return [Object.freeze({
          kind: 'provider-error' as const,
          providerEventType: type,
          ...(safeString(error?.code) === undefined ? {} : { errorCode: safeString(error?.code)! }),
        })];
      }

      return [Object.freeze({
        kind: 'provider-event' as const,
        providerEventType: type,
      })];
    },
  });
}

/** OpenAI Responses SSE transport. Text/refusal only; reasoning/tool payloads remain opaque. */
export function createOpenAIProviderStreamTransport(options: ProviderHttpTransportOptions) {
  const runtime = resolveProviderHttpTransportOptions(options);
  return createProviderSseStreamTransport({
    providerId: 'openai',
    protocol: 'openai',
    endpoint: 'https://api.openai.com/v1/responses',
    authHeader: 'Authorization',
    bearerAuth: true,
    requestIdHeader: 'x-request-id',
    runtime,
    buildBody: (request: FuryProviderRequestEnvelope) => ({
      model: request.model,
      input: request.prompt,
      store: false,
      stream: true,
      ...(runtime.maxOutputTokens === undefined ? {} : { max_output_tokens: runtime.maxOutputTokens }),
    }),
    createMapper: mapper,
    retryDelay: (headers, status, now) => {
      const standard = genericRetryAfter(headers, status, now);
      if (standard !== undefined || status !== 429) return standard;
      const resets = [
        parseProviderReset(headers.get('x-ratelimit-reset-requests')),
        parseProviderReset(headers.get('x-ratelimit-reset-tokens')),
        parseProviderReset(headers.get('x-ratelimit-reset-project-tokens')),
      ].filter((value): value is number => value !== undefined);
      return resets.length === 0 ? undefined : Math.max(...resets);
    },
  });
}
