import type { FuryProviderRequestEnvelope } from '../provider-request-envelope.js';
import type {
  ProviderStreamTerminalStatus,
  ProviderStreamTransportEvent,
} from '../provider-stream-transport.js';
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

function safeString(value: unknown, maximum = 160): string | undefined {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

function safeIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : undefined;
}

function usage(value: Record<string, unknown> | undefined): ProviderStreamTransportEvent['usage'] {
  const input = token(value, 'total_input_tokens');
  const output = token(value, 'total_output_tokens');
  const cached = token(value, 'total_cached_tokens');
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  if (input !== undefined && cached !== undefined && cached <= input) result.inputTokens = input - cached;
  if (cached !== undefined) result.cacheReadTokens = cached;
  if (output !== undefined) result.outputTokens = output;
  return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
}

function terminalStatus(value: unknown): ProviderStreamTerminalStatus {
  switch (value) {
    case 'completed': return 'completed';
    case 'incomplete': return 'incomplete';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'requires_action': return 'requires-action';
    default: return 'unknown';
  }
}

function eventType(frame: ProviderSseFrame, value: Record<string, unknown> | undefined): string {
  return safeString(value?.event_type) ?? (frame.event.length > 0 ? frame.event : 'unknown');
}

function createGoogleMapper(): ProviderSseEventMapper {
  const stepTypes = new Map<number, string>();

  return Object.freeze({
    map(frame: ProviderSseFrame): readonly ProviderStreamTransportEvent[] {
      const value = parse(frame);
      const type = eventType(frame, value);

      if (type === 'step.start') {
        const index = safeIndex(value?.index);
        const step = record(value?.step);
        const stepType = safeString(step?.type);
        if (index !== undefined && stepType !== undefined) stepTypes.set(index, stepType);
        return [Object.freeze({
          kind: 'provider-event' as const,
          providerEventType: stepType === undefined ? type : type + ':' + stepType,
        })];
      }

      if (type === 'step.stop') {
        const index = safeIndex(value?.index);
        if (index !== undefined) stepTypes.delete(index);
        const normalizedUsage = usage(record(value?.usage));
        return normalizedUsage === undefined
          ? [Object.freeze({ kind: 'provider-event' as const, providerEventType: type })]
          : [Object.freeze({
              kind: 'usage' as const,
              providerEventType: type,
              usage: normalizedUsage,
            })];
      }

      if (type === 'step.delta') {
        const index = safeIndex(value?.index);
        const delta = record(value?.delta);
        const deltaType = safeString(delta?.type);
        const stepType = index === undefined ? undefined : stepTypes.get(index);
        if (
          stepType === 'model_output'
          && deltaType === 'text'
          && typeof delta?.text === 'string'
          && delta.text.length > 0
        ) {
          return [Object.freeze({
            kind: 'text-delta' as const,
            providerEventType: type,
            text: delta.text,
          })];
        }
        const suffix = [stepType, deltaType].filter((entry): entry is string => entry !== undefined).join(':');
        return [Object.freeze({
          kind: 'provider-event' as const,
          providerEventType: suffix.length === 0 ? type : type + ':' + suffix,
        })];
      }

      if (
        type === 'interaction.completed'
        || type === 'interaction.failed'
        || type === 'interaction.cancelled'
        || type === 'interaction.requires_action'
      ) {
        const interaction = record(value?.interaction);
        const normalizedUsage = usage(record(interaction?.usage));
        return [Object.freeze({
          kind: 'terminal' as const,
          providerEventType: type,
          terminalStatus: terminalStatus(interaction?.status),
          ...(normalizedUsage === undefined ? {} : { usage: normalizedUsage }),
        })];
      }

      if (type === 'error') {
        const error = record(value?.error);
        return [Object.freeze({
          kind: 'provider-error' as const,
          providerEventType: type,
          ...(safeString(error?.code, 128) === undefined
            ? {}
            : { errorCode: safeString(error?.code, 128)! }),
        })];
      }

      return [Object.freeze({
        kind: 'provider-event' as const,
        providerEventType: type,
      })];
    },
  });
}

/** Gemini stable Interactions SSE transport. Thought/tool/image deltas remain opaque. */
export function createGoogleProviderStreamTransport(options: ProviderHttpTransportOptions) {
  const runtime = resolveProviderHttpTransportOptions(options);
  return createProviderSseStreamTransport({
    providerId: 'google',
    protocol: 'google',
    endpoint: 'https://generativelanguage.googleapis.com/v1/interactions',
    authHeader: 'x-goog-api-key',
    runtime,
    buildBody: (request: FuryProviderRequestEnvelope) => ({
      model: request.model,
      input: request.prompt,
      store: false,
      stream: true,
      ...(runtime.maxOutputTokens === undefined ? {} : {
        generation_config: { max_output_tokens: runtime.maxOutputTokens },
      }),
    }),
    createMapper: createGoogleMapper,
    retryDelay: genericRetryAfter,
  });
}
