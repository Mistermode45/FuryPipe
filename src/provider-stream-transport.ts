import type { ProviderFabricProtocol } from './core/provider-fabric.js';
import type { FuryProviderRequestEnvelope } from './provider-request-envelope.js';
import {
  assertKnownKeys,
  canonicalProviderId,
  exactIdentifier,
  MAX_PROVIDER_TRANSPORTS,
  ownDataRecord,
} from './provider-execution-internal.js';
import { FuryGovernedProviderStreamError } from './provider-stream-errors.js';
import type { ProviderTransportResult } from './provider-transport.js';

export const MAX_PROVIDER_STREAM_EVENT_BYTES = 262_144;
export const MAX_PROVIDER_STREAM_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_PROVIDER_STREAM_WIRE_BYTES = 16 * 1024 * 1024;

export interface ProviderStreamTransportExecutionContext {
  readonly requestDigest: string;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly maxEventBytes: typeof MAX_PROVIDER_STREAM_EVENT_BYTES;
  readonly maxTextBytes: typeof MAX_PROVIDER_STREAM_TEXT_BYTES;
  readonly maxWireBytes: typeof MAX_PROVIDER_STREAM_WIRE_BYTES;
  readonly signal?: AbortSignal;
}

export interface ProviderStreamTransportSession {
  readonly providerId: string;
  readonly model: string;
  readonly providerRequestId?: string;
  readonly networkStatus?: 'executed' | 'not-executed' | 'unknown';
  readonly providerRequestStatus?: 'accepted' | 'rejected' | 'unknown';
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly events: AsyncIterable<unknown>;
}

export type ProviderStreamTerminalStatus =
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'cancelled'
  | 'requires-action'
  | 'unknown';

export interface ProviderStreamTransportEvent {
  readonly kind: 'text-delta' | 'usage' | 'terminal' | 'provider-error' | 'provider-event';
  readonly providerEventType: string;
  readonly text?: string;
  readonly usage?: ProviderTransportResult['usage'];
  readonly finishReason?: string;
  readonly terminalStatus?: ProviderStreamTerminalStatus;
  readonly errorCode?: string;
}

export interface ProviderStreamTransport {
  readonly providerId: string;
  readonly protocol: ProviderFabricProtocol;
  open(
    request: FuryProviderRequestEnvelope,
    context: ProviderStreamTransportExecutionContext,
  ): Promise<unknown>;
}

export interface ProviderStreamTransportRegistry {
  get(providerId: string): ProviderStreamTransport | undefined;
}

export interface ValidatedProviderStreamTransportSession {
  readonly providerRequestId?: string;
  readonly network: {
    readonly status: 'executed' | 'not-executed' | 'unknown';
    readonly evidence: 'transport-reported' | 'not-reported';
  };
  readonly providerRequest: {
    readonly status: 'accepted' | 'rejected' | 'unknown';
    readonly evidence: 'transport-reported' | 'not-reported';
  };
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly events: AsyncIterable<unknown>;
}

const TRANSPORT_KEYS = ['providerId', 'protocol', 'open'] as const;
const SESSION_KEYS = [
  'providerId', 'model', 'providerRequestId', 'networkStatus', 'providerRequestStatus',
  'httpStatus', 'retryAfterMs', 'events',
] as const;
const EVENT_KEYS = [
  'kind', 'providerEventType', 'text', 'usage', 'finishReason', 'terminalStatus', 'errorCode',
] as const;
const USAGE_KEYS = ['inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens'] as const;
const EVENT_KINDS = new Set<ProviderStreamTransportEvent['kind']>([
  'text-delta', 'usage', 'terminal', 'provider-error', 'provider-event',
]);
const TERMINAL_STATUSES = new Set<ProviderStreamTerminalStatus>([
  'completed', 'incomplete', 'failed', 'cancelled', 'requires-action', 'unknown',
]);

function streamFail(
  code: ConstructorParameters<typeof FuryGovernedProviderStreamError>[0],
  transportInvoked: boolean,
): never {
  throw new FuryGovernedProviderStreamError(code, transportInvoked);
}

function status<T extends string>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
): {
  readonly status: T | 'unknown';
  readonly evidence: 'transport-reported' | 'not-reported';
} {
  const value = record[key];
  if (value === undefined) return Object.freeze({ status: 'unknown', evidence: 'not-reported' });
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    streamFail('stream-session-invalid', true);
  }
  return Object.freeze({
    status: value as T,
    evidence: 'transport-reported',
  });
}

function snapshotUsage(value: unknown): ProviderTransportResult['usage'] {
  if (value === undefined) return undefined;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(value);
    assertKnownKeys(record, USAGE_KEYS);
  } catch {
    streamFail('stream-event-invalid', true);
  }
  const output: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const key of USAGE_KEYS) {
    const count = record[key];
    if (count === undefined) continue;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      streamFail('stream-event-invalid', true);
    }
    output[key] = count;
  }
  return Object.keys(output).length === 0 ? undefined : Object.freeze(output);
}

function safeOptionalIdentifier(value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (!exactIdentifier(value, maximum)) streamFail('stream-event-invalid', true);
  return value;
}

export function validateProviderStreamTransportSession(
  value: unknown,
  request: FuryProviderRequestEnvelope,
): ValidatedProviderStreamTransportSession {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(value);
    assertKnownKeys(record, SESSION_KEYS);
  } catch {
    streamFail('stream-session-invalid', true);
  }
  if (record.providerId !== request.providerId || record.model !== request.model) {
    streamFail('stream-session-invalid', true);
  }
  const events = record.events;
  if (
    !events
    || (typeof events !== 'object' && typeof events !== 'function')
    || typeof (events as AsyncIterable<unknown>)[Symbol.asyncIterator] !== 'function'
  ) {
    streamFail('stream-session-invalid', true);
  }

  const providerRequestId = record.providerRequestId === undefined
    ? undefined
    : safeOptionalIdentifier(record.providerRequestId, 256);
  const network = status(record, 'networkStatus', ['executed', 'not-executed', 'unknown']);
  const providerRequest = status(record, 'providerRequestStatus', ['accepted', 'rejected', 'unknown'] as const);

  let httpStatus: number | undefined;
  if (record.httpStatus !== undefined) {
    if (
      typeof record.httpStatus !== 'number'
      || !Number.isSafeInteger(record.httpStatus)
      || record.httpStatus < 100
      || record.httpStatus > 599
    ) streamFail('stream-session-invalid', true);
    httpStatus = record.httpStatus;
  }
  let retryAfterMs: number | undefined;
  if (record.retryAfterMs !== undefined) {
    if (
      typeof record.retryAfterMs !== 'number'
      || !Number.isSafeInteger(record.retryAfterMs)
      || record.retryAfterMs < 0
      || record.retryAfterMs > 604_800_000
    ) streamFail('stream-session-invalid', true);
    retryAfterMs = record.retryAfterMs;
  }

  return Object.freeze({
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
    network,
    providerRequest,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    events: events as AsyncIterable<unknown>,
  });
}

export function validateProviderStreamTransportEvent(
  value: unknown,
): ProviderStreamTransportEvent {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(value);
    assertKnownKeys(record, EVENT_KEYS);
  } catch {
    streamFail('stream-event-invalid', true);
  }
  if (
    typeof record.kind !== 'string'
    || !EVENT_KINDS.has(record.kind as ProviderStreamTransportEvent['kind'])
    || !exactIdentifier(record.providerEventType, 160)
  ) streamFail('stream-event-invalid', true);

  const kind = record.kind as ProviderStreamTransportEvent['kind'];
  const text = record.text;
  if (kind === 'text-delta') {
    if (typeof text !== 'string' || text.length === 0 || text.includes('\0')) {
      streamFail('stream-event-invalid', true);
    }
    if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_STREAM_EVENT_BYTES) {
      streamFail('stream-event-too-large', true);
    }
  } else if (text !== undefined) {
    streamFail('stream-event-invalid', true);
  }

  const usage = snapshotUsage(record.usage);
  if (kind !== 'usage' && kind !== 'terminal' && usage !== undefined) {
    streamFail('stream-event-invalid', true);
  }

  const finishReason = safeOptionalIdentifier(record.finishReason, 128);
  if (finishReason !== undefined && kind !== 'terminal') streamFail('stream-event-invalid', true);

  let terminalStatus: ProviderStreamTerminalStatus | undefined;
  if (record.terminalStatus !== undefined) {
    if (
      kind !== 'terminal'
      || typeof record.terminalStatus !== 'string'
      || !TERMINAL_STATUSES.has(record.terminalStatus as ProviderStreamTerminalStatus)
    ) streamFail('stream-event-invalid', true);
    terminalStatus = record.terminalStatus as ProviderStreamTerminalStatus;
  } else if (kind === 'terminal') {
    streamFail('stream-event-invalid', true);
  }

  const errorCode = safeOptionalIdentifier(record.errorCode, 128);
  if (errorCode !== undefined && kind !== 'provider-error') streamFail('stream-event-invalid', true);

  return Object.freeze({
    kind,
    providerEventType: record.providerEventType,
    ...(kind === 'text-delta' ? { text: text as string } : {}),
    ...(usage === undefined ? {} : { usage }),
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(terminalStatus === undefined ? {} : { terminalStatus }),
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}

export function createProviderStreamTransportRegistry(
  transports: readonly ProviderStreamTransport[],
): ProviderStreamTransportRegistry {
  if (!Array.isArray(transports) || transports.length > MAX_PROVIDER_TRANSPORTS) {
    throw new TypeError('provider stream transport registry contains too many entries');
  }
  const byProvider = new Map<string, ProviderStreamTransport>();
  for (let index = 0; index < transports.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(transports, String(index));
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError('provider stream transport registry entry is invalid');
    }
    let record: Readonly<Record<string, unknown>>;
    try {
      record = ownDataRecord(descriptor.value);
      assertKnownKeys(record, TRANSPORT_KEYS);
    } catch {
      throw new TypeError('provider stream transport registration is invalid');
    }
    if (
      !canonicalProviderId(record.providerId)
      || !['openai', 'anthropic', 'google'].includes(String(record.protocol))
      || typeof record.open !== 'function'
    ) throw new TypeError('provider stream transport registration is invalid');
    if (byProvider.has(record.providerId)) throw new TypeError('provider stream transport providerId is duplicated');
    byProvider.set(record.providerId, Object.freeze({
      providerId: record.providerId,
      protocol: record.protocol as ProviderFabricProtocol,
      open: record.open as ProviderStreamTransport['open'],
    }));
  }
  return Object.freeze({ get: (providerId: string) => byProvider.get(providerId) });
}
