import type { FuryProviderRequestEnvelope } from '../provider-request-envelope.js';
import type { ProviderStreamTransportEvent } from '../provider-stream-transport.js';
import { ANTHROPIC_API_VERSION } from '../provider-transports/anthropic.js';
import { genericRetryAfter } from '../provider-transports/http-runtime.js';
import {
  resolveProviderHttpTransportOptions,
  type ProviderHttpTransportOptions,
} from '../provider-transports/types.js';
import {
  createProviderSseStreamTransport,
  type ProviderSseEventMapper,
  type ProviderSseFrame,
} from './http-runtime.js';

export interface AnthropicProviderStreamTransportOptions extends ProviderHttpTransportOptions {
  readonly maxOutputTokens: number;
}

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

function usage(value: Record<string, unknown> | undefined): ProviderStreamTransportEvent['usage'] {
  const input = token(value, 'input_tokens');
  const output = token(value, 'output_tokens');
  const cacheWrite = token(value, 'cache_creation_input_tokens');
  const cacheRead = token(value, 'cache_read_input_tokens');
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  if (input !== undefined) result.inputTokens = input;
  if (output !== undefined) result.outputTokens = output;
  if (cacheWrite !== undefined) result.cacheWriteTokens = cacheWrite;
  if (cacheRead !== undefined) result.cacheReadTokens = cacheRead;
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
}

function eventType(frame: ProviderSseFrame, value: Record<string, unknown> | undefined): string {
  return safeString(value?.type, 160) ?? (frame.event.length > 0 ? frame.event : 'unknown');
}

function createAnthropicMapper(): ProviderSseEventMapper {
  let stopReason: string | undefined;

  return Object.freeze({
    map(frame: ProviderSseFrame): readonly ProviderStreamTransportEvent[] {
      const value = parse(frame);
      const type = eventType(frame, value);

      if (type === 'message_start') {
        const message = record(value?.message);
        const normalizedUsage = usage(record(message?.usage));
        return normalizedUsage === undefined
          ? [Object.freeze({ kind: 'provider-event' as const, providerEventType: type })]
          : [Object.freeze({
              kind: 'usage' as const,
              providerEventType: type,
              usage: normalizedUsage,
            })];
      }

      if (type === 'content_block_delta') {
        const delta = record(value?.delta);
        const deltaType = safeString(delta?.type, 160);
        if (deltaType === 'text_delta' && typeof delta?.text === 'string' && delta.text.length > 0) {
          return [Object.freeze({
            kind: 'text-delta' as const,
            providerEventType: type,
            text: delta.text,
          })];
        }
        return [Object.freeze({
          kind: 'provider-event' as const,
          providerEventType: deltaType === undefined ? type : type + ':' + deltaType,
        })];
      }

      if (type === 'message_delta') {
        const delta = record(value?.delta);
        stopReason = safeString(delta?.stop_reason);
        const normalizedUsage = usage(record(value?.usage));
        if (normalizedUsage === undefined) {
          return [Object.freeze({ kind: 'provider-event' as const, providerEventType: type })];
        }
        return [Object.freeze({
          kind: 'usage' as const,
          providerEventType: type,
          usage: normalizedUsage,
        })];
      }

      if (type === 'message_stop') {
        return [Object.freeze({
          kind: 'terminal' as const,
          providerEventType: type,
          terminalStatus: 'completed' as const,
          ...(stopReason === undefined ? {} : { finishReason: stopReason }),
        })];
      }

      if (type === 'error') {
        const error = record(value?.error);
        return [Object.freeze({
          kind: 'provider-error' as const,
          providerEventType: type,
          ...(safeString(error?.type) === undefined ? {} : { errorCode: safeString(error?.type)! }),
        })];
      }

      return [Object.freeze({
        kind: 'provider-event' as const,
        providerEventType: type,
      })];
    },
  });
}

/** Anthropic Messages SSE transport. Thinking/signature/tool deltas are intentionally opaque. */
export function createAnthropicProviderStreamTransport(
  options: AnthropicProviderStreamTransportOptions,
) {
  const runtime = resolveProviderHttpTransportOptions(options, true);
  return createProviderSseStreamTransport({
    providerId: 'anthropic',
    protocol: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    authHeader: 'Authorization',
    bearerAuth: true,
    requestIdHeader: 'request-id',
    headers: { 'anthropic-version': ANTHROPIC_API_VERSION },
    runtime,
    buildBody: (request: FuryProviderRequestEnvelope) => ({
      model: request.model,
      max_tokens: runtime.maxOutputTokens,
      messages: [{ role: 'user', content: request.prompt }],
      stream: true,
    }),
    createMapper: createAnthropicMapper,
    retryDelay: genericRetryAfter,
  });
}
