import type { ProviderFabricProtocol } from './core/provider-fabric.js';
import type { FuryProviderRequestEnvelope } from './provider-request-envelope.js';
import {
  assertKnownKeys,
  canonicalProviderId,
  exactIdentifier,
  fail,
  isProviderProtocol,
  MAX_PROVIDER_RESPONSE_BYTES,
  MAX_PROVIDER_TRANSPORTS,
  ownDataRecord,
} from './provider-execution-internal.js';

export interface ProviderTransportExecutionContext {
  readonly requestDigest: string;
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  /** Hard result-body limit the host transport should also enforce while reading. */
  readonly maxResponseBytes: typeof MAX_PROVIDER_RESPONSE_BYTES;
  /** Optional host cancellation signal; absent for existing callers. */
  readonly signal?: AbortSignal;
}

/** Untrusted, bounded data reported by a host-owned provider transport. */
export interface ProviderTransportResult {
  readonly providerId: string;
  readonly model: string;
  readonly providerRequestId?: string;
  readonly networkStatus?: 'executed' | 'not-executed' | 'unknown';
  readonly providerRequestStatus?: 'accepted' | 'rejected' | 'unknown';
  /** HTTP response status, when the transport received an HTTP response. */
  readonly httpStatus?: number;
  /** Provider-reported retry delay only; FuryPipe never retries automatically. */
  readonly retryAfterMs?: number;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly cacheReadTokens?: number;
  };
  readonly responseBytes?: Uint8Array;
  readonly finishReason?: string;
}

export interface ProviderTransport {
  readonly providerId: string;
  readonly protocol: ProviderFabricProtocol;
  execute(
    request: FuryProviderRequestEnvelope,
    context: ProviderTransportExecutionContext,
  ): Promise<unknown>;
}

export type RegisteredProviderTransport = ProviderTransport;

export interface ProviderTransportRegistry {
  /** Exact canonical provider ID lookup; aliases and fuzzy matches are never used. */
  get(providerId: string): RegisteredProviderTransport | undefined;
}

export interface EvidenceStatus<T extends string> {
  readonly status: T;
  readonly evidence: 'transport-reported' | 'not-reported';
}

export interface ValidatedProviderTransportResult {
  readonly providerRequestId?: string;
  readonly network: EvidenceStatus<'executed' | 'not-executed' | 'unknown'>;
  readonly providerRequest: EvidenceStatus<'accepted' | 'rejected' | 'unknown'>;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly usage?: ProviderTransportResult['usage'];
  /** Independent snapshot; later mutation of the transport's buffer cannot change it. */
  readonly responseBytes?: Uint8Array;
  readonly finishReason?: string;
}

const TRANSPORT_KEYS = ['providerId', 'protocol', 'execute'] as const;
const RESULT_KEYS = [
  'providerId', 'model', 'providerRequestId', 'networkStatus', 'providerRequestStatus',
  'httpStatus', 'retryAfterMs', 'usage', 'responseBytes', 'finishReason',
] as const;
const USAGE_KEYS = ['inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens'] as const;

function reportedStatus<T extends string>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  allowed: readonly T[],
): EvidenceStatus<T> {
  const value = record[key];
  if (value === undefined) return Object.freeze({ status: 'unknown' as T, evidence: 'not-reported' });
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail('transport-result-invalid', true);
  return Object.freeze({ status: value as T, evidence: 'transport-reported' });
}

function snapshotUsage(value: unknown): ProviderTransportResult['usage'] {
  if (value === undefined) return undefined;
  let usage: Readonly<Record<string, unknown>>;
  try {
    usage = ownDataRecord(value);
    assertKnownKeys(usage, USAGE_KEYS);
  } catch {
    fail('transport-result-invalid', true);
  }
  const snapshot: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const key of USAGE_KEYS) {
    const count = usage[key];
    if (count === undefined) continue;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      fail('transport-result-invalid', true);
    }
    snapshot[key] = count;
  }
  return Object.freeze(snapshot);
}

/** Validate untrusted transport output and attach evidence labels in FuryPipe. */
export function validateProviderTransportResult(
  value: unknown,
  request: FuryProviderRequestEnvelope,
): ValidatedProviderTransportResult {
  let result: Readonly<Record<string, unknown>>;
  try {
    result = ownDataRecord(value);
    assertKnownKeys(result, RESULT_KEYS);
  } catch {
    fail('transport-result-invalid', true);
  }
  if (result.providerId !== request.providerId || result.model !== request.model) {
    fail('transport-result-invalid', true);
  }

  let providerRequestId: string | undefined;
  if (result.providerRequestId !== undefined) {
    if (!exactIdentifier(result.providerRequestId, 256)) fail('transport-result-invalid', true);
    providerRequestId = result.providerRequestId;
  }
  let finishReason: string | undefined;
  if (result.finishReason !== undefined) {
    if (!exactIdentifier(result.finishReason, 128)) fail('transport-result-invalid', true);
    finishReason = result.finishReason;
  }

  let responseBytes: Uint8Array | undefined;
  if (result.responseBytes !== undefined) {
    const bytes = result.responseBytes;
    if (!(bytes instanceof Uint8Array) || !ArrayBuffer.isView(bytes) || !(bytes.buffer instanceof ArrayBuffer)) {
      fail('transport-result-invalid', true);
    }
    if (bytes.byteLength > MAX_PROVIDER_RESPONSE_BYTES) fail('response-too-large', true);
    responseBytes = Uint8Array.from(bytes);
  }

  const network = reportedStatus(result, 'networkStatus', ['executed', 'not-executed', 'unknown']);
  const providerRequest = reportedStatus(result, 'providerRequestStatus', ['accepted', 'rejected', 'unknown']);
  let httpStatus: number | undefined;
  if (result.httpStatus !== undefined) {
    if (typeof result.httpStatus !== 'number' || !Number.isSafeInteger(result.httpStatus)
      || result.httpStatus < 100 || result.httpStatus > 599) fail('transport-result-invalid', true);
    httpStatus = result.httpStatus;
  }
  let retryAfterMs: number | undefined;
  if (result.retryAfterMs !== undefined) {
    if (typeof result.retryAfterMs !== 'number' || !Number.isSafeInteger(result.retryAfterMs)
      || result.retryAfterMs < 0 || result.retryAfterMs > 604_800_000) fail('transport-result-invalid', true);
    retryAfterMs = result.retryAfterMs;
  }
  const usage = snapshotUsage(result.usage);
  return Object.freeze({
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
    network,
    providerRequest,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(usage === undefined ? {} : { usage }),
    ...(responseBytes === undefined ? {} : { responseBytes }),
    ...(finishReason === undefined ? {} : { finishReason }),
  });
}

/** Snapshot host-owned transport references into a bounded, immutable registry. */
export function createProviderTransportRegistry(
  transports: readonly ProviderTransport[],
): ProviderTransportRegistry {
  if (!Array.isArray(transports) || transports.length > MAX_PROVIDER_TRANSPORTS) {
    throw new TypeError(`provider transport registry must contain at most ${MAX_PROVIDER_TRANSPORTS} entries`);
  }
  const byProvider = new Map<string, RegisteredProviderTransport>();
  for (let index = 0; index < transports.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(transports, String(index));
    if (!descriptor || !('value' in descriptor)) throw new TypeError('provider transport registry entry is invalid');
    let source: Readonly<Record<string, unknown>>;
    try {
      source = ownDataRecord(descriptor.value);
      assertKnownKeys(source, TRANSPORT_KEYS);
    } catch {
      throw new TypeError('provider transport registration is invalid');
    }
    if (
      !canonicalProviderId(source.providerId)
      || !isProviderProtocol(source.protocol)
      || typeof source.execute !== 'function'
    ) throw new TypeError('provider transport registration is invalid');
    if (byProvider.has(source.providerId)) throw new TypeError('provider transport providerId is duplicated');
    byProvider.set(source.providerId, Object.freeze({
      providerId: source.providerId,
      protocol: source.protocol,
      execute: source.execute as ProviderTransport['execute'],
    }));
  }
  return Object.freeze({ get: (providerId: string) => byProvider.get(providerId) });
}
