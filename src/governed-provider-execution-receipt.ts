import { createHash } from 'node:crypto';

import { COST_UNKNOWN } from './core/provider-fabric.js';
import type { ProviderCostEstimate } from './core/provider-runtime.js';
import {
  FuryGovernedProviderExecutorError,
  type FuryGovernedProviderExecutorErrorCode,
} from './provider-execution-errors.js';
import {
  isGeneratedProviderExecutionPermit,
  type FuryProviderExecutionPermit,
} from './provider-execution-gate.js';
import {
  isGeneratedProviderRequestEnvelope,
  type FuryProviderRequestEnvelope,
} from './provider-request-envelope.js';
import type { GovernedProviderExecutionResult } from './governed-provider-executor.js';

export type FuryGovernedProviderExecutionReceiptOutcome =
  | GovernedProviderExecutionResult
  | FuryGovernedProviderExecutorError;

export interface FuryGovernedProviderExecutionReceipt {
  readonly format: 'furypipe-governed-provider-execution-receipt/v1';
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly protocol: FuryProviderRequestEnvelope['protocol'];
  readonly request: {
    readonly requestDigest: string;
    readonly promptDigest: string;
    readonly promptSourceDigest: string;
    readonly promptBytes: number;
  };
  readonly authorization: {
    readonly permitIdDigest: string;
    readonly policyIdDigest: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
  };
  readonly outcome:
    | {
        readonly kind: 'success';
        readonly transportInvoked: true;
        readonly network: GovernedProviderExecutionResult['network'];
        readonly providerRequest: GovernedProviderExecutionResult['providerRequest'];
        readonly providerRequestIdDigest?: string;
        readonly usage?: Readonly<{
          readonly inputTokens?: number;
          readonly outputTokens?: number;
          readonly cacheWriteTokens?: number;
          readonly cacheReadTokens?: number;
        }>;
        readonly response?: {
          readonly bytes: number;
          readonly sha256: string;
        };
        readonly finishReasonDigest?: string;
        readonly cost:
          | {
              readonly status: 'known';
              readonly totalUsd: number;
              readonly sourceDigest: string;
              readonly observedAt: number;
            }
          | {
              readonly status: typeof COST_UNKNOWN;
              readonly reasonDigest: string;
            };
      }
    | {
        readonly kind: 'error';
        readonly code: FuryGovernedProviderExecutorErrorCode;
        readonly transportInvoked: boolean;
      };
  readonly verification: {
    readonly structuralConsistency: 'verified';
    readonly requestProvenance: 'process-local-verified';
    readonly permitProvenance: 'process-local-verified';
    readonly outcomeProvenance: 'not-verified';
    readonly providerResult:
      | 'transport-reported'
      | 'partially-transport-reported'
      | 'not-reported'
      | 'not-executed';
  };
  readonly receiptDigest: string;
}

const HEX64 = /^[0-9a-f]{64}$/u;
const MAX_SCOPE_CHARS = 256;
const MAX_ID_CHARS = 256;
const MAX_FINISH_REASON_CHARS = 128;
const MAX_COST_TEXT_CHARS = 500;
const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576;

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('execution receipt canonical JSON does not support non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value !== 'object') {
    throw new Error('execution receipt canonical JSON contains an unsupported value');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('execution receipt canonical JSON requires plain objects');
  }
  const parts: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined) {
      throw new Error('execution receipt canonical JSON requires defined data properties');
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`);
  }
  return `{${parts.join(',')}}`;
}

function exactIdentifier(value: unknown, label: string, maxChars = MAX_SCOPE_CHARS): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maxChars
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be an exact bounded printable identifier`);
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function validateRequest(request: FuryProviderRequestEnvelope): FuryProviderRequestEnvelope {
  if (!isGeneratedProviderRequestEnvelope(request)) {
    throw new Error('execution receipt requires a process-local FuryPipe request envelope');
  }
  if (
    request.format !== 'furypipe-provider-request-envelope/v1'
    || !exactIdentifier(request.providerId, 'request providerId')
    || !exactIdentifier(request.model, 'request model')
    || !exactIdentifier(request.workloadId, 'request workloadId')
    || !['openai', 'anthropic', 'google'].includes(request.protocol)
    || typeof request.prompt !== 'string'
    || !HEX64.test(request.requestDigest)
    || !/^fp_[0-9a-f]{64}$/u.test(request.promptDigest)
    || !/^fp_src_[0-9a-f]{64}$/u.test(request.promptSourceDigest)
    || nonNegativeSafeInteger(request.promptBytes, 'request promptBytes') !== new TextEncoder().encode(request.prompt).byteLength
  ) {
    throw new Error('execution receipt request envelope is structurally inconsistent');
  }
  return request;
}

function validatePermit(
  permit: FuryProviderExecutionPermit,
  request: FuryProviderRequestEnvelope,
): FuryProviderExecutionPermit {
  if (!isGeneratedProviderExecutionPermit(permit)) {
    throw new Error('execution receipt requires a process-local FuryPipe execution permit');
  }
  if (
    permit.format !== 'furypipe-provider-execution-permit/v1'
    || !exactIdentifier(permit.permitId, 'permitId', MAX_ID_CHARS)
    || !exactIdentifier(permit.policyId, 'policyId', MAX_ID_CHARS)
    || permit.providerId !== request.providerId
    || permit.model !== request.model
    || permit.workloadId !== request.workloadId
    || permit.requestDigest !== request.requestDigest
    || !Number.isSafeInteger(permit.issuedAt)
    || permit.issuedAt < 0
    || !Number.isSafeInteger(permit.expiresAt)
    || permit.expiresAt < permit.issuedAt
  ) {
    throw new Error('execution receipt permit does not match the exact request');
  }
  return permit;
}

function validateEvidence<T extends string>(
  value: Readonly<{
    readonly status: T;
    readonly evidence: 'transport-reported' | 'not-reported';
  }>,
  allowed: readonly T[],
  label: string,
): Readonly<{
  readonly status: T;
  readonly evidence: 'transport-reported' | 'not-reported';
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} evidence is invalid`);
  }
  if (!allowed.includes(value.status)) throw new Error(`${label} status is invalid`);
  if (value.evidence !== 'transport-reported' && value.evidence !== 'not-reported') {
    throw new Error(`${label} evidence kind is invalid`);
  }
  if (value.evidence === 'not-reported' && value.status !== 'unknown') {
    throw new Error(`${label} cannot claim a concrete status without transport evidence`);
  }
  return Object.freeze({ status: value.status, evidence: value.evidence });
}

function validateUsage(
  value: GovernedProviderExecutionResult['usage'],
): Readonly<{
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheReadTokens?: number;
}> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('execution receipt usage is invalid');
  }
  const allowed = ['inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens'] as const;
  const snapshot: Partial<Record<(typeof allowed)[number], number>> = {};
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key as (typeof allowed)[number])) {
      throw new Error('execution receipt usage contains an unsupported field');
    }
  }
  for (const key of allowed) {
    const count = value[key];
    if (count === undefined) continue;
    snapshot[key] = nonNegativeSafeInteger(count, `usage ${key}`);
  }
  return Object.freeze(snapshot);
}

function validateCost(
  cost: ProviderCostEstimate,
  request: FuryProviderRequestEnvelope,
): Extract<FuryGovernedProviderExecutionReceipt['outcome'], { kind: 'success' }>['cost'] {
  if (!cost || typeof cost !== 'object' || Array.isArray(cost)) {
    throw new Error('execution receipt cost is invalid');
  }
  if (cost.providerId !== request.providerId || cost.model !== request.model) {
    throw new Error('execution receipt cost scope does not match the request');
  }
  if (cost.status === 'known') {
    if (
      !Number.isFinite(cost.totalUsd)
      || cost.totalUsd < 0
      || !Number.isSafeInteger(cost.observedAt)
      || cost.observedAt < 0
    ) {
      throw new Error('execution receipt known cost is invalid');
    }
    const source = exactIdentifier(cost.source, 'cost source', MAX_COST_TEXT_CHARS);
    return Object.freeze({
      status: 'known',
      totalUsd: cost.totalUsd,
      sourceDigest: sha256Text(source),
      observedAt: cost.observedAt,
    });
  }
  if (cost.status === COST_UNKNOWN) {
    const reason = exactIdentifier(cost.reason, 'cost unknown reason', MAX_COST_TEXT_CHARS);
    return Object.freeze({
      status: COST_UNKNOWN,
      reasonDigest: sha256Text(reason),
    });
  }
  throw new Error('execution receipt cost status is invalid');
}

function providerResultVerification(
  result: GovernedProviderExecutionResult,
): FuryGovernedProviderExecutionReceipt['verification']['providerResult'] {
  const networkReported = result.network.evidence === 'transport-reported';
  const providerReported = result.providerRequest.evidence === 'transport-reported';
  if (networkReported && providerReported) return 'transport-reported';
  if (networkReported || providerReported) return 'partially-transport-reported';
  return 'not-reported';
}

function successOutcome(
  result: GovernedProviderExecutionResult,
  request: FuryProviderRequestEnvelope,
): {
  readonly outcome: Extract<FuryGovernedProviderExecutionReceipt['outcome'], { kind: 'success' }>;
  readonly providerResult: FuryGovernedProviderExecutionReceipt['verification']['providerResult'];
} {
  if (
    result.format !== 'furypipe-governed-provider-execution-result/v1'
    || result.state !== 'TRANSPORT_RESULT'
    || result.transportInvoked !== true
    || result.providerId !== request.providerId
    || result.model !== request.model
    || result.workloadId !== request.workloadId
    || result.requestDigest !== request.requestDigest
  ) {
    throw new Error('execution receipt success result does not match the exact request');
  }

  const network = validateEvidence(result.network, ['executed', 'not-executed', 'unknown'], 'network');
  const providerRequest = validateEvidence(
    result.providerRequest,
    ['accepted', 'rejected', 'unknown'],
    'provider request',
  );
  const usage = validateUsage(result.usage);

  let providerRequestIdDigest: string | undefined;
  if (result.providerRequestId !== undefined) {
    providerRequestIdDigest = sha256Text(
      exactIdentifier(result.providerRequestId, 'providerRequestId', MAX_ID_CHARS),
    );
  }

  let response: { readonly bytes: number; readonly sha256: string } | undefined;
  if (result.responseBytes !== undefined) {
    if (!(result.responseBytes instanceof Uint8Array)) {
      throw new Error('execution receipt response bytes are invalid');
    }
    if (result.responseBytes.byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new Error('execution receipt response exceeds the governed response bound');
    }
    response = Object.freeze({
      bytes: result.responseBytes.byteLength,
      sha256: sha256Bytes(result.responseBytes),
    });
  }

  let finishReasonDigest: string | undefined;
  if (result.finishReason !== undefined) {
    finishReasonDigest = sha256Text(
      exactIdentifier(result.finishReason, 'finishReason', MAX_FINISH_REASON_CHARS),
    );
  }

  return Object.freeze({
    outcome: Object.freeze({
      kind: 'success',
      transportInvoked: true,
      network,
      providerRequest,
      ...(providerRequestIdDigest === undefined ? {} : { providerRequestIdDigest }),
      ...(usage === undefined ? {} : { usage }),
      ...(response === undefined ? {} : { response }),
      ...(finishReasonDigest === undefined ? {} : { finishReasonDigest }),
      cost: validateCost(result.cost, request),
    }),
    providerResult: providerResultVerification(result),
  });
}

function errorOutcome(
  error: FuryGovernedProviderExecutorError,
): {
  readonly outcome: Extract<FuryGovernedProviderExecutionReceipt['outcome'], { kind: 'error' }>;
  readonly providerResult: FuryGovernedProviderExecutionReceipt['verification']['providerResult'];
} {
  if (!(error instanceof FuryGovernedProviderExecutorError)) {
    throw new Error('execution receipt error outcome must be a FuryGovernedProviderExecutorError');
  }
  if (typeof error.transportInvoked !== 'boolean') {
    throw new Error('execution receipt error transport state is invalid');
  }
  return Object.freeze({
    outcome: Object.freeze({
      kind: 'error',
      code: error.code,
      transportInvoked: error.transportInvoked,
    }),
    providerResult: error.transportInvoked ? 'not-reported' : 'not-executed',
  });
}

function receiptCore(input: {
  readonly request: FuryProviderRequestEnvelope;
  readonly permit: FuryProviderExecutionPermit;
  readonly outcome: FuryGovernedProviderExecutionReceiptOutcome;
}): Omit<FuryGovernedProviderExecutionReceipt, 'receiptDigest'> {
  const request = validateRequest(input.request);
  const permit = validatePermit(input.permit, request);

  const summarized = input.outcome instanceof FuryGovernedProviderExecutorError
    ? errorOutcome(input.outcome)
    : successOutcome(input.outcome, request);

  return Object.freeze({
    format: 'furypipe-governed-provider-execution-receipt/v1',
    providerId: request.providerId,
    model: request.model,
    workloadId: request.workloadId,
    protocol: request.protocol,
    request: Object.freeze({
      requestDigest: request.requestDigest,
      promptDigest: request.promptDigest,
      promptSourceDigest: request.promptSourceDigest,
      promptBytes: request.promptBytes,
    }),
    authorization: Object.freeze({
      permitIdDigest: sha256Text(permit.permitId),
      policyIdDigest: sha256Text(permit.policyId),
      issuedAt: permit.issuedAt,
      expiresAt: permit.expiresAt,
    }),
    outcome: summarized.outcome,
    verification: Object.freeze({
      structuralConsistency: 'verified',
      requestProvenance: 'process-local-verified',
      permitProvenance: 'process-local-verified',
      outcomeProvenance: 'not-verified',
      providerResult: summarized.providerResult,
    }),
  });
}

function digestCore(core: unknown): string {
  return sha256Text(canonicalJson(core));
}

export function createGovernedProviderExecutionReceipt(input: {
  readonly request: FuryProviderRequestEnvelope;
  readonly permit: FuryProviderExecutionPermit;
  readonly outcome: FuryGovernedProviderExecutionReceiptOutcome;
}): FuryGovernedProviderExecutionReceipt {
  const core = receiptCore(input);
  return Object.freeze({
    ...core,
    receiptDigest: digestCore(core),
  });
}

export function verifyGovernedProviderExecutionReceipt(
  receipt: FuryGovernedProviderExecutionReceipt,
  input: {
    readonly request: FuryProviderRequestEnvelope;
    readonly permit: FuryProviderExecutionPermit;
    readonly outcome: FuryGovernedProviderExecutionReceiptOutcome;
  },
): boolean {
  try {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
    if (!HEX64.test(receipt.receiptDigest)) return false;

    const suppliedCore: Record<string, unknown> = {};
    for (const key of Object.keys(receipt)) {
      if (key === 'receiptDigest') continue;
      const descriptor = Object.getOwnPropertyDescriptor(receipt, key);
      if (!descriptor || !('value' in descriptor)) return false;
      suppliedCore[key] = descriptor.value;
    }

    const expected = createGovernedProviderExecutionReceipt(input);
    return digestCore(suppliedCore) === receipt.receiptDigest
      && receipt.receiptDigest === expected.receiptDigest;
  } catch {
    return false;
  }
}
