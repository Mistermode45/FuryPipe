import { COST_UNKNOWN } from './core/provider-fabric.js';
import type { ProviderCostEstimate, ProviderRuntimeState } from './core/provider-runtime.js';
import type { FuryProviderExecutionPermit } from './provider-execution-gate.js';
import { consumeProviderExecutionPermit } from './provider-execution-gate.js';
import type { FuryProviderRequestEnvelope } from './provider-request-envelope.js';
import { isGeneratedProviderRequestEnvelope } from './provider-request-envelope.js';
import {
  assertKnownKeys,
  exactIdentifier,
  ownDataRecord,
  safeTimestamp,
} from './provider-execution-internal.js';
import {
  MAX_PROVIDER_STREAM_EVENT_BYTES,
  MAX_PROVIDER_STREAM_TEXT_BYTES,
  type ProviderStreamTransport,
  type ProviderStreamTransportEvent,
  type ProviderStreamTransportRegistry,
  type ProviderStreamTerminalStatus,
  validateProviderStreamTransportEvent,
  validateProviderStreamTransportSession,
} from './provider-stream-transport.js';
import {
  FuryGovernedProviderStreamError,
  type FuryGovernedProviderStreamErrorCode,
} from './provider-stream-errors.js';
import type { ProviderTransportResult } from './provider-transport.js';

export interface GovernedProviderStreamEvent {
  readonly format: 'furypipe-governed-provider-stream-event/v1';
  readonly sequence: number;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly requestDigest: string;
  readonly kind: ProviderStreamTransportEvent['kind'];
  readonly providerEventType: string;
  /** Provider-mapped user-visible assistant text only. */
  readonly text?: string;
  readonly usage?: ProviderTransportResult['usage'];
  readonly finishReason?: string;
  readonly terminalStatus?: ProviderStreamTerminalStatus;
  readonly errorCode?: string;
  readonly evidence: 'transport-reported';
  /** Only attached to a terminal/provider-error event. */
  readonly cost?: ProviderCostEstimate;
}

export interface GovernedProviderStreamSession {
  readonly format: 'furypipe-governed-provider-stream-session/v1';
  readonly state: 'STREAM_SESSION';
  readonly transportInvoked: true;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly requestDigest: string;
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
  readonly events: AsyncIterable<GovernedProviderStreamEvent>;
}

export interface GovernedProviderStreamExecutor {
  open(
    request: FuryProviderRequestEnvelope,
    permit: FuryProviderExecutionPermit,
    options?: GovernedProviderStreamExecutionOptions,
  ): Promise<GovernedProviderStreamSession>;
}

export interface GovernedProviderStreamExecutionOptions {
  readonly signal?: AbortSignal;
}

export interface GovernedProviderStreamExecutorOptions {
  readonly transports: ProviderStreamTransportRegistry;
  readonly providerRuntime: ProviderRuntimeState;
  readonly now?: () => number;
}

const GENERATED_STREAM_SESSIONS = new WeakSet<object>();
const GENERATED_STREAM_EVENTS = new WeakSet<object>();
const TRANSPORT_KEYS = ['providerId', 'protocol', 'open'] as const;

export function isGeneratedGovernedProviderStreamSession(
  value: unknown,
): value is GovernedProviderStreamSession {
  return value !== null && typeof value === 'object' && GENERATED_STREAM_SESSIONS.has(value);
}

export function isGeneratedGovernedProviderStreamEvent(
  value: unknown,
): value is GovernedProviderStreamEvent {
  return value !== null && typeof value === 'object' && GENERATED_STREAM_EVENTS.has(value);
}

function fail(code: FuryGovernedProviderStreamErrorCode, transportInvoked = false): never {
  throw new FuryGovernedProviderStreamError(code, transportInvoked);
}

function snapshotSignal(options: GovernedProviderStreamExecutionOptions | undefined): AbortSignal | undefined {
  if (options === undefined) return undefined;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(options);
    assertKnownKeys(record, ['signal']);
  } catch {
    fail('invalid-input');
  }
  if (record.signal === undefined) return undefined;
  if (
    typeof record.signal !== 'object'
    || record.signal === null
    || typeof (record.signal as AbortSignal).aborted !== 'boolean'
    || typeof (record.signal as AbortSignal).addEventListener !== 'function'
    || typeof (record.signal as AbortSignal).removeEventListener !== 'function'
  ) fail('invalid-input');
  return record.signal as AbortSignal;
}

function snapshotTransport(
  value: unknown,
  request: FuryProviderRequestEnvelope,
): ProviderStreamTransport {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(value);
    assertKnownKeys(record, TRANSPORT_KEYS);
  } catch {
    fail('stream-transport-not-registered');
  }
  if (record.providerId !== request.providerId) fail('stream-transport-provider-mismatch');
  if (record.protocol !== request.protocol) fail('stream-transport-protocol-mismatch');
  if (typeof record.open !== 'function') fail('stream-transport-not-registered');
  return Object.freeze({
    providerId: record.providerId as string,
    protocol: record.protocol as ProviderStreamTransport['protocol'],
    open: record.open as ProviderStreamTransport['open'],
  });
}

function exactCost(
  runtime: ProviderRuntimeState,
  request: FuryProviderRequestEnvelope,
  usage: ProviderTransportResult['usage'],
): ProviderCostEstimate {
  if (
    usage?.inputTokens === undefined
    || usage.outputTokens === undefined
    || usage.cacheWriteTokens === undefined
    || usage.cacheReadTokens === undefined
  ) {
    return Object.freeze({
      status: COST_UNKNOWN,
      providerId: request.providerId,
      model: request.model,
      reason: 'complete explicit token usage was not reported',
    });
  }
  try {
    const estimate = runtime.estimateCost(request.providerId, request.model, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      cacheReadTokens: usage.cacheReadTokens,
    });
    if (
      estimate.status === COST_UNKNOWN
      && estimate.providerId === request.providerId
      && estimate.model === request.model
      && exactIdentifier(estimate.reason, 500)
    ) return Object.freeze({ ...estimate });
    if (
      estimate.status === 'known'
      && estimate.providerId === request.providerId
      && estimate.model === request.model
      && Number.isFinite(estimate.totalUsd)
      && estimate.totalUsd >= 0
      && exactIdentifier(estimate.source, 200)
      && Number.isFinite(estimate.observedAt)
      && estimate.observedAt >= 0
    ) return Object.freeze({ ...estimate });
  } catch {
    // Fall through to explicit unknown.
  }
  return Object.freeze({
    status: COST_UNKNOWN,
    providerId: request.providerId,
    model: request.model,
    reason: 'exact provider runtime pricing could not be resolved',
  });
}

function mergeUsage(
  current: ProviderTransportResult['usage'],
  next: ProviderTransportResult['usage'],
): ProviderTransportResult['usage'] {
  if (next === undefined) return current;
  return Object.freeze({
    ...(current?.inputTokens === undefined && next.inputTokens === undefined
      ? {}
      : { inputTokens: next.inputTokens ?? current?.inputTokens }),
    ...(current?.outputTokens === undefined && next.outputTokens === undefined
      ? {}
      : { outputTokens: next.outputTokens ?? current?.outputTokens }),
    ...(current?.cacheWriteTokens === undefined && next.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: next.cacheWriteTokens ?? current?.cacheWriteTokens }),
    ...(current?.cacheReadTokens === undefined && next.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: next.cacheReadTokens ?? current?.cacheReadTokens }),
  });
}

function assertSessionConsistency(session: ReturnType<typeof validateProviderStreamTransportSession>): void {
  if (
    session.network.status === 'not-executed'
    && (
      session.providerRequest.status !== 'unknown'
      || session.httpStatus !== undefined
      || session.providerRequestId !== undefined
    )
  ) fail('stream-session-invalid', true);
  if (
    session.providerRequest.status === 'accepted'
    && session.httpStatus !== undefined
    && (session.httpStatus < 200 || session.httpStatus >= 300)
  ) fail('stream-session-invalid', true);
  if (
    session.providerRequest.status === 'rejected'
    && session.httpStatus !== undefined
    && session.httpStatus >= 200
    && session.httpStatus < 300
  ) fail('stream-session-invalid', true);
}

function governedEvents(
  request: FuryProviderRequestEnvelope,
  source: AsyncIterable<unknown>,
  runtime: ProviderRuntimeState,
): AsyncIterable<GovernedProviderStreamEvent> {
  return Object.freeze({
    async *[Symbol.asyncIterator](): AsyncGenerator<GovernedProviderStreamEvent> {
      let sequence = 0;
      let totalTextBytes = 0;
      let terminalSeen = false;
      let usage: ProviderTransportResult['usage'];

      try {
        for await (const raw of source) {
          if (terminalSeen) fail('stream-event-invalid', true);
          const event = validateProviderStreamTransportEvent(raw);
          if (event.kind === 'text-delta') {
            const bytes = new TextEncoder().encode(event.text!).byteLength;
            totalTextBytes += bytes;
            if (totalTextBytes > MAX_PROVIDER_STREAM_TEXT_BYTES) {
              fail('stream-event-too-large', true);
            }
          }
          usage = mergeUsage(usage, event.usage);
          const terminal = event.kind === 'terminal' || event.kind === 'provider-error';
          if (terminal) terminalSeen = true;
          const governed: GovernedProviderStreamEvent = Object.freeze({
            format: 'furypipe-governed-provider-stream-event/v1' as const,
            sequence,
            providerId: request.providerId,
            model: request.model,
            workloadId: request.workloadId,
            requestDigest: request.requestDigest,
            kind: event.kind,
            providerEventType: event.providerEventType,
            ...(event.text === undefined ? {} : { text: event.text }),
            ...(event.usage === undefined ? {} : { usage: event.usage }),
            ...(event.finishReason === undefined ? {} : { finishReason: event.finishReason }),
            ...(event.terminalStatus === undefined ? {} : { terminalStatus: event.terminalStatus }),
            ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
            evidence: 'transport-reported' as const,
            ...(terminal ? { cost: exactCost(runtime, request, usage) } : {}),
          });
          GENERATED_STREAM_EVENTS.add(governed);
          sequence += 1;
          yield governed;
        }
      } catch (error) {
        if (error instanceof FuryGovernedProviderStreamError) throw error;
        fail('stream-transport-error', true);
      }
      if (!terminalSeen) fail('stream-interrupted', true);
    },
  });
}

/**
 * Open one exact governed provider stream.
 *
 * The execution permit is consumed synchronously before the first transport
 * callback can yield. This executor performs no retry, fallback or reconnect.
 */
export function createGovernedProviderStreamExecutor(
  options: GovernedProviderStreamExecutorOptions,
): GovernedProviderStreamExecutor {
  if (
    !options
    || typeof options !== 'object'
    || !options.transports
    || typeof options.transports.get !== 'function'
    || !options.providerRuntime
    || typeof options.providerRuntime.estimateCost !== 'function'
  ) {
    throw new TypeError('governed provider stream executor requires stream transports and ProviderRuntimeState');
  }
  const nowSource = options.now ?? Date.now;
  if (typeof nowSource !== 'function') throw new TypeError('governed provider stream executor clock must be a function');

  return Object.freeze({
    async open(
      request: FuryProviderRequestEnvelope,
      permit: FuryProviderExecutionPermit,
      executionOptions?: GovernedProviderStreamExecutionOptions,
    ): Promise<GovernedProviderStreamSession> {
      if (!isGeneratedProviderRequestEnvelope(request)) fail('invalid-input');
      const signal = snapshotSignal(executionOptions);

      let registered: unknown;
      try {
        registered = options.transports.get(request.providerId);
      } catch {
        fail('stream-transport-not-registered');
      }
      if (registered === undefined) fail('stream-transport-not-registered');
      const transport = snapshotTransport(registered, request);

      let now: number;
      try {
        now = nowSource();
      } catch {
        fail('invalid-input');
      }
      if (!safeTimestamp(now)) fail('invalid-input');

      // Single-use authority is consumed before any await or provider callback.
      consumeProviderExecutionPermit(request, permit, now);

      const context = Object.freeze({
        requestDigest: request.requestDigest,
        providerId: request.providerId,
        model: request.model,
        workloadId: request.workloadId,
        maxEventBytes: MAX_PROVIDER_STREAM_EVENT_BYTES,
        maxTextBytes: MAX_PROVIDER_STREAM_TEXT_BYTES,
        ...(signal === undefined ? {} : { signal }),
      });

      let rawSession: unknown;
      try {
        rawSession = await transport.open(request, context);
      } catch (error) {
        if (error instanceof FuryGovernedProviderStreamError) throw error;
        fail('stream-transport-error', true);
      }

      const streamSession = validateProviderStreamTransportSession(rawSession, request);
      assertSessionConsistency(streamSession);
      const session: GovernedProviderStreamSession = Object.freeze({
        format: 'furypipe-governed-provider-stream-session/v1',
        state: 'STREAM_SESSION',
        transportInvoked: true,
        providerId: request.providerId,
        model: request.model,
        workloadId: request.workloadId,
        requestDigest: request.requestDigest,
        ...(streamSession.providerRequestId === undefined
          ? {}
          : { providerRequestId: streamSession.providerRequestId }),
        network: streamSession.network,
        providerRequest: streamSession.providerRequest,
        ...(streamSession.httpStatus === undefined ? {} : { httpStatus: streamSession.httpStatus }),
        ...(streamSession.retryAfterMs === undefined ? {} : { retryAfterMs: streamSession.retryAfterMs }),
        events: governedEvents(request, streamSession.events, options.providerRuntime),
      });
      GENERATED_STREAM_SESSIONS.add(session);
      return session;
    },
  });
}
