import { COST_UNKNOWN } from './core/provider-fabric.js';
import type { ProviderCostEstimate, ProviderRuntimeState } from './core/provider-runtime.js';
import type { FuryProviderExecutionPermit } from './provider-execution-gate.js';
import { consumeProviderExecutionPermit } from './provider-execution-gate.js';
import type { FuryProviderRequestEnvelope } from './provider-request-envelope.js';
import { isGeneratedProviderRequestEnvelope } from './provider-request-envelope.js';
import { FuryGovernedProviderExecutorError } from './provider-execution-errors.js';
import {
  assertKnownKeys,
  exactIdentifier,
  fail,
  MAX_PROVIDER_RESPONSE_BYTES,
  ownDataRecord,
  safeTimestamp,
} from './provider-execution-internal.js';
import {
  type ProviderTransport,
  type ProviderTransportRegistry,
  type ProviderTransportResult,
  validateProviderTransportResult,
} from './provider-transport.js';

export interface GovernedProviderExecutionResult {
  readonly format: 'furypipe-governed-provider-execution-result/v1';
  readonly state: 'TRANSPORT_RESULT';
  readonly transportInvoked: true;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly requestDigest: string;
  /** Process-local timestamps captured around this exact transport invocation. */
  readonly transportStartedAt: number;
  readonly transportFinishedAt?: number;
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
  readonly usage?: ProviderTransportResult['usage'];
  readonly responseBytes?: Uint8Array;
  readonly finishReason?: string;
  readonly cost: ProviderCostEstimate;
}

export interface GovernedProviderExecutor {
  execute(
    request: FuryProviderRequestEnvelope,
    permit: FuryProviderExecutionPermit,
    options?: GovernedProviderExecutionOptions,
  ): Promise<GovernedProviderExecutionResult>;
}

export interface GovernedProviderExecutionOptions {
  /** Optional caller cancellation; existing two-argument calls remain valid. */
  readonly signal?: AbortSignal;
}

export interface GovernedProviderExecutorOptions {
  readonly transports: ProviderTransportRegistry;
  readonly providerRuntime: ProviderRuntimeState;
  readonly now?: () => number;
}

const generatedGovernedProviderExecutionResults = new WeakSet<object>();

/** Process-local provenance check; serialized/copied results deliberately fail. */
export function isGeneratedGovernedProviderExecutionResult(
  value: unknown,
): value is GovernedProviderExecutionResult {
  return typeof value === 'object'
    && value !== null
    && generatedGovernedProviderExecutionResults.has(value);
}

const TRANSPORT_KEYS = ['providerId', 'protocol', 'execute'] as const;

function snapshotTransport(value: unknown, request: FuryProviderRequestEnvelope): ProviderTransport {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = ownDataRecord(value);
    assertKnownKeys(record, TRANSPORT_KEYS);
  } catch {
    fail('transport-not-registered');
  }
  if (record.providerId !== request.providerId) fail('transport-provider-mismatch');
  if (record.protocol !== request.protocol) fail('transport-protocol-mismatch');
  if (typeof record.execute !== 'function') fail('transport-not-registered');
  return Object.freeze({
    providerId: record.providerId as string,
    protocol: record.protocol as ProviderTransport['protocol'],
    execute: record.execute as ProviderTransport['execute'],
  });
}

function costEstimate(
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
    return {
      status: COST_UNKNOWN,
      providerId: request.providerId,
      model: request.model,
      reason: 'complete explicit token usage was not reported',
    };
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
    ) return estimate;
    if (
      estimate.status === 'known'
      && estimate.providerId === request.providerId
      && estimate.model === request.model
      && Number.isFinite(estimate.totalUsd)
      && estimate.totalUsd >= 0
      && exactIdentifier(estimate.source, 200)
      && Number.isFinite(estimate.observedAt)
      && estimate.observedAt >= 0
    ) return estimate;
    return {
      status: COST_UNKNOWN,
      providerId: request.providerId,
      model: request.model,
      reason: 'provider runtime returned an invalid exact cost estimate',
    };
  } catch {
    return {
      status: COST_UNKNOWN,
      providerId: request.providerId,
      model: request.model,
      reason: 'exact provider runtime pricing could not be resolved',
    };
  }
}

/** Execute exactly one host-registered transport after synchronously consuming its permit. */
export function createGovernedProviderExecutor(
  options: GovernedProviderExecutorOptions,
): GovernedProviderExecutor {
  if (
    !options
    || typeof options !== 'object'
    || !options.transports
    || typeof options.transports.get !== 'function'
    || !options.providerRuntime
    || typeof options.providerRuntime.estimateCost !== 'function'
  ) throw new TypeError('governed provider executor requires a transport registry and ProviderRuntimeState');
  const nowSource = options.now ?? Date.now;
  if (typeof nowSource !== 'function') throw new TypeError('governed provider executor clock must be a function');

  return Object.freeze({
    async execute(
      request: FuryProviderRequestEnvelope,
      permit: FuryProviderExecutionPermit,
      executionOptions?: GovernedProviderExecutionOptions,
    ): Promise<GovernedProviderExecutionResult> {
      if (!isGeneratedProviderRequestEnvelope(request)) fail('invalid-prepared-attempt');

      let signal: AbortSignal | undefined;
      if (executionOptions !== undefined) {
        let input: Readonly<Record<string, unknown>>;
        try {
          input = ownDataRecord(executionOptions);
          assertKnownKeys(input, ['signal']);
        } catch {
          fail('invalid-input');
        }
        if (input.signal !== undefined) {
          if (typeof input.signal !== 'object' || input.signal === null
            || typeof (input.signal as AbortSignal).aborted !== 'boolean'
            || typeof (input.signal as AbortSignal).addEventListener !== 'function'
            || typeof (input.signal as AbortSignal).removeEventListener !== 'function') fail('invalid-input');
          signal = input.signal as AbortSignal;
        }
      }

      let registered: unknown;
      try {
        registered = options.transports.get(request.providerId);
      } catch {
        fail('transport-not-registered');
      }
      if (registered === undefined) fail('transport-not-registered');
      const transport = snapshotTransport(registered, request);

      let now: number;
      try {
        now = nowSource();
      } catch {
        fail('invalid-input');
      }
      if (!safeTimestamp(now)) fail('invalid-input');
      consumeProviderExecutionPermit(request, permit, now);

      const context = Object.freeze({
        requestDigest: request.requestDigest,
        providerId: request.providerId,
        model: request.model,
        workloadId: request.workloadId,
        maxResponseBytes: MAX_PROVIDER_RESPONSE_BYTES,
        ...(signal === undefined ? {} : { signal }),
      });
      let rawResult: unknown;
      try {
        // The permit was marked consumed synchronously above, before this callback can yield.
        rawResult = await transport.execute(request, context);
      } catch (error) {
        if (error instanceof FuryGovernedProviderExecutorError && error.code === 'response-too-large') throw error;
        fail('transport-error', true);
      }

      let transportFinishedAt: number | undefined;
      try {
        const finishedAt = nowSource();
        if (safeTimestamp(finishedAt) && finishedAt >= now) transportFinishedAt = finishedAt;
      } catch {
        // A completed provider call remains reportable, but without a trustworthy
        // finish timestamp it cannot create freshness evidence.
      }

      const result = validateProviderTransportResult(rawResult, request);
      const cost = costEstimate(options.providerRuntime, request, result.usage);
      const executionResult = Object.freeze({
        format: 'furypipe-governed-provider-execution-result/v1' as const,
        state: 'TRANSPORT_RESULT' as const,
        transportInvoked: true as const,
        providerId: request.providerId,
        model: request.model,
        workloadId: request.workloadId,
        requestDigest: request.requestDigest,
        transportStartedAt: now,
        ...(transportFinishedAt === undefined ? {} : { transportFinishedAt }),
        ...(result.providerRequestId === undefined ? {} : { providerRequestId: result.providerRequestId }),
        network: result.network,
        providerRequest: result.providerRequest,
        ...(result.httpStatus === undefined ? {} : { httpStatus: result.httpStatus }),
        ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        ...(result.responseBytes === undefined ? {} : { responseBytes: result.responseBytes }),
        ...(result.finishReason === undefined ? {} : { finishReason: result.finishReason }),
        cost,
      });
      generatedGovernedProviderExecutionResults.add(executionResult);
      return executionResult;
    },
  });
}
