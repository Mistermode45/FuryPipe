import { createHash, randomBytes } from 'node:crypto';

import {
  isGeneratedFuryGatewayChannelAdapterRegistry,
  type FuryGatewayChannelAdapterRegistry,
} from './gateway-channel-adapter-node.js';

export const FURY_GATEWAY_CHANNEL_DELIVERY_PERMIT_FORMAT =
  'furypipe-gateway-channel-delivery-permit/v1' as const;
export const FURY_GATEWAY_CHANNEL_DELIVERY_RECEIPT_FORMAT =
  'furypipe-gateway-channel-delivery-receipt/v1' as const;
export const FURY_GATEWAY_CHANNEL_TRANSPORT_REQUEST_FORMAT =
  'furypipe-gateway-channel-transport-request/v1' as const;

export const FURY_GATEWAY_CHANNEL_DELIVERY_RESULT_KINDS = Object.freeze([
  'accepted',
  'delivered',
  'provider-rejected',
] as const);

export type FuryGatewayChannelDeliveryResultKind =
  (typeof FURY_GATEWAY_CHANNEL_DELIVERY_RESULT_KINDS)[number];

export const FURY_GATEWAY_CHANNEL_DELIVERY_STATUSES = Object.freeze([
  'prepared',
  'expired',
  'in-flight',
  'accepted-for-delivery',
  'delivered',
  'provider-rejected',
  'outcome-unknown',
] as const);

export type FuryGatewayChannelDeliveryStatus =
  (typeof FURY_GATEWAY_CHANNEL_DELIVERY_STATUSES)[number];

export interface FuryGatewayChannelDeliveryStatusSnapshot {
  readonly total: number;
  readonly transports: number;
  readonly observedAt: number;
  readonly counts: Readonly<Record<FuryGatewayChannelDeliveryStatus, number>>;
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayChannelDeliveryInput {
  readonly adapterId: string;
  readonly destinationId: string;
  readonly threadId?: string;
  readonly text: string;
  readonly replyToEventId?: string;
  readonly idempotencyKey: string;
  readonly expiresInMs?: number;
}

export interface FuryGatewayChannelDeliveryPermit {
  readonly format: typeof FURY_GATEWAY_CHANNEL_DELIVERY_PERMIT_FORMAT;
  readonly permitId: string;
  readonly adapterId: string;
  readonly channelKind: string;
  readonly accountDigestSha256: string;
  readonly destinationDigestSha256: string;
  readonly threadDigestSha256?: string;
  readonly replyToEventIdSha256?: string;
  readonly payloadSha256: string;
  readonly idempotencyKeySha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly authority: 'single-channel-delivery-permit';
  readonly executionAuthority: true;
}

export interface FuryGatewayChannelTransportRequest {
  readonly format: typeof FURY_GATEWAY_CHANNEL_TRANSPORT_REQUEST_FORMAT;
  readonly adapterId: string;
  readonly channelKind: string;
  readonly accountDigestSha256: string;
  /**
   * Raw destination/thread/message data is exposed only to the host-owned
   * transport callback at the invocation boundary. It is never copied into
   * permits or receipts.
   */
  readonly destinationId: string;
  readonly threadId?: string;
  readonly text: string;
  readonly replyToEventId?: string;
  readonly authority: 'transport-invocation-data';
  readonly executionAuthority: false;
}

export interface FuryGatewayChannelTransportContext {
  readonly signal: AbortSignal;
}

export interface FuryGatewayChannelTransportResult {
  readonly outcome: FuryGatewayChannelDeliveryResultKind;
  readonly providerMessageId?: string;
}

export type FuryGatewayChannelTransport = (
  request: FuryGatewayChannelTransportRequest,
  context: FuryGatewayChannelTransportContext,
) => Promise<FuryGatewayChannelTransportResult> | FuryGatewayChannelTransportResult;

export interface FuryGatewayChannelDeliveryReceipt {
  readonly format: typeof FURY_GATEWAY_CHANNEL_DELIVERY_RECEIPT_FORMAT;
  readonly permitIdSha256: string;
  readonly adapterId: string;
  readonly channelKind: string;
  readonly accountDigestSha256: string;
  readonly destinationDigestSha256: string;
  readonly threadDigestSha256?: string;
  readonly payloadSha256: string;
  readonly idempotencyKeySha256: string;
  readonly status:
    | 'accepted-for-delivery'
    | 'delivered'
    | 'provider-rejected'
    | 'outcome-unknown';
  readonly transportInvoked: true;
  readonly providerAccepted: boolean | 'unknown';
  readonly delivered: boolean | 'unknown';
  readonly providerMessageIdSha256?: string;
  readonly attemptedAt: number;
  readonly settledAt: number;
  readonly retrySafe: false;
  readonly verified: false;
  readonly authority: 'delivery-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayChannelDeliveryInspection {
  readonly permitIdSha256: string;
  readonly adapterId: string;
  readonly channelKind: string;
  readonly accountDigestSha256: string;
  readonly destinationDigestSha256: string;
  readonly idempotencyKeySha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly status: FuryGatewayChannelDeliveryStatus;
  readonly receipt?: FuryGatewayChannelDeliveryReceipt;
}

export interface FuryGatewayChannelDeliveryCoordinatorOptions {
  readonly adapterRegistry: FuryGatewayChannelAdapterRegistry;
  readonly now?: () => number;
  readonly defaultPermitTtlMs?: number;
  readonly maxPermitTtlMs?: number;
  readonly transportTimeoutMs?: number;
  readonly maxTransports?: number;
  readonly maxDeliveries?: number;
}

export interface FuryGatewayChannelDeliveryCoordinator {
  registerTransport(adapterId: string, transport: FuryGatewayChannelTransport): void;
  prepareDelivery(input: FuryGatewayChannelDeliveryInput): FuryGatewayChannelDeliveryPermit;
  executeDelivery(
    permit: FuryGatewayChannelDeliveryPermit,
  ): Promise<FuryGatewayChannelDeliveryReceipt>;
  inspectDelivery(
    permit: FuryGatewayChannelDeliveryPermit,
  ): FuryGatewayChannelDeliveryInspection;
  statusSnapshot(): FuryGatewayChannelDeliveryStatusSnapshot;
  transportCount(): number;
  deliveryCount(): number;
}

export type FuryGatewayChannelDeliveryErrorCode =
  | 'invalid-config'
  | 'invalid-input'
  | 'adapter-not-found'
  | 'capability-mismatch'
  | 'duplicate-transport'
  | 'transport-not-found'
  | 'invalid-permit'
  | 'permit-expired'
  | 'permit-consumed'
  | 'idempotency-conflict'
  | 'limit-exceeded';

export class FuryGatewayChannelDeliveryError extends Error {
  readonly code: FuryGatewayChannelDeliveryErrorCode;
  readonly retrySafe = false;

  constructor(code: FuryGatewayChannelDeliveryErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayChannelDeliveryError';
    this.code = code;
  }
}

export class FuryGatewayChannelDeliveryOutcomeUnknownError extends Error {
  readonly code = 'FURY_GATEWAY_CHANNEL_DELIVERY_OUTCOME_UNKNOWN';
  readonly retrySafe = false;
  readonly receipt: FuryGatewayChannelDeliveryReceipt;

  constructor(receipt: FuryGatewayChannelDeliveryReceipt) {
    super(
      'channel transport was invoked but did not return trustworthy terminal evidence; delivery outcome is unknown and must not be retried automatically',
    );
    this.name = 'FuryGatewayChannelDeliveryOutcomeUnknownError';
    this.receipt = receipt;
  }
}

interface PreparedState {
  readonly permit: FuryGatewayChannelDeliveryPermit;
  readonly raw: {
    readonly destinationId: string;
    readonly threadId?: string;
    readonly text: string;
    readonly replyToEventId?: string;
  };
  readonly transport: FuryGatewayChannelTransport;
  status: FuryGatewayChannelDeliveryStatus;
  attemptedAt?: number;
  receipt?: FuryGatewayChannelDeliveryReceipt;
}

const GENERATED_COORDINATORS = new WeakSet<object>();
const GENERATED_PERMITS = new WeakSet<object>();
const RESULT_KIND_SET = new Set<string>(FURY_GATEWAY_CHANNEL_DELIVERY_RESULT_KINDS);

const ADAPTER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PERMIT_ID_RE = /^[A-Za-z0-9_-]{32}$/u;
const DEFAULT_PERMIT_TTL_MS = 30_000;
const MIN_PERMIT_TTL_MS = 1_000;
const HARD_MAX_PERMIT_TTL_MS = 60_000;
const DEFAULT_TRANSPORT_TIMEOUT_MS = 30_000;
const MIN_TRANSPORT_TIMEOUT_MS = 100;
const HARD_MAX_TRANSPORT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TRANSPORTS = 64;
const HARD_MAX_TRANSPORTS = 1_024;
const DEFAULT_MAX_DELIVERIES = 20_000;
const HARD_MAX_DELIVERIES = 200_000;
const MAX_OPAQUE_ID_BYTES = 512;
const MAX_IDEMPOTENCY_KEY_BYTES = 256;
const MAX_TEXT_BYTES = 32 * 1024;
const MAX_PROVIDER_MESSAGE_ID_BYTES = 512;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function exactPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
  code: FuryGatewayChannelDeliveryErrorCode = 'invalid-input',
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayChannelDeliveryError(code, label + ' must be a plain data object');
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !allowed.has(key)
    ) {
      throw new FuryGatewayChannelDeliveryError(
        code,
        label + ' contains unsupported or unsafe fields',
      );
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayChannelDeliveryError(
        code,
        label + ' is missing required field: ' + key,
      );
    }
  }
  return record;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new FuryGatewayChannelDeliveryError(
      'invalid-config',
      label + ' must be an integer from ' + min + ' to ' + max,
    );
  }
  return resolved;
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryGatewayChannelDeliveryError(
      'invalid-config',
      'channel delivery clock must return a safe non-negative timestamp',
    );
  }
  return value;
}

function postInvocationNow(now: () => number, fallback: number): number {
  try {
    return safeNow(now);
  } catch {
    return fallback;
  }
}

function boundedPrintable(
  value: unknown,
  label: string,
  maxBytes: number,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayChannelDeliveryError(
      'invalid-input',
      label + ' must be bounded printable text',
    );
  }
  return value;
}

function boundedMessageText(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayChannelDeliveryError(
      'invalid-input',
      'channel delivery text must be bounded text',
    );
  }
  return value;
}

function normalizeTransportResult(
  value: unknown,
): FuryGatewayChannelTransportResult {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = exactPlainRecord(
      value,
      ['outcome', 'providerMessageId'],
      ['outcome'],
      'channel transport result',
      'invalid-input',
    );
  } catch {
    throw new Error('channel transport returned malformed result evidence');
  }
  if (
    typeof record.outcome !== 'string'
    || !RESULT_KIND_SET.has(record.outcome)
  ) {
    throw new Error('channel transport returned unsupported result outcome');
  }
  const outcome = record.outcome as FuryGatewayChannelDeliveryResultKind;
  let providerMessageId: string | undefined;
  if (record.providerMessageId !== undefined) {
    try {
      providerMessageId = boundedPrintable(
        record.providerMessageId,
        'providerMessageId',
        MAX_PROVIDER_MESSAGE_ID_BYTES,
      );
    } catch {
      throw new Error('channel transport returned invalid provider message identity');
    }
  }
  if (outcome === 'provider-rejected' && providerMessageId !== undefined) {
    throw new Error('provider-rejected result cannot claim a provider message identity');
  }
  return Object.freeze({
    outcome,
    ...(providerMessageId === undefined ? {} : { providerMessageId }),
  });
}

function receiptFromKnownResult(
  state: PreparedState,
  result: FuryGatewayChannelTransportResult,
  attemptedAt: number,
  settledAt: number,
): FuryGatewayChannelDeliveryReceipt {
  const status = result.outcome === 'accepted'
    ? 'accepted-for-delivery'
    : result.outcome;
  return Object.freeze({
    format: FURY_GATEWAY_CHANNEL_DELIVERY_RECEIPT_FORMAT,
    permitIdSha256: sha256(state.permit.permitId),
    adapterId: state.permit.adapterId,
    channelKind: state.permit.channelKind,
    accountDigestSha256: state.permit.accountDigestSha256,
    destinationDigestSha256: state.permit.destinationDigestSha256,
    ...(state.permit.threadDigestSha256 === undefined
      ? {}
      : { threadDigestSha256: state.permit.threadDigestSha256 }),
    payloadSha256: state.permit.payloadSha256,
    idempotencyKeySha256: state.permit.idempotencyKeySha256,
    status,
    transportInvoked: true as const,
    providerAccepted: result.outcome !== 'provider-rejected',
    delivered: result.outcome === 'delivered'
      ? true
      : result.outcome === 'provider-rejected'
        ? false
        : 'unknown',
    ...(result.providerMessageId === undefined
      ? {}
      : { providerMessageIdSha256: sha256(result.providerMessageId) }),
    attemptedAt,
    settledAt,
    retrySafe: false as const,
    verified: false as const,
    authority: 'delivery-evidence-only' as const,
    executionAuthority: false as const,
  });
}

function receiptFromUnknown(
  state: PreparedState,
  attemptedAt: number,
  settledAt: number,
): FuryGatewayChannelDeliveryReceipt {
  return Object.freeze({
    format: FURY_GATEWAY_CHANNEL_DELIVERY_RECEIPT_FORMAT,
    permitIdSha256: sha256(state.permit.permitId),
    adapterId: state.permit.adapterId,
    channelKind: state.permit.channelKind,
    accountDigestSha256: state.permit.accountDigestSha256,
    destinationDigestSha256: state.permit.destinationDigestSha256,
    ...(state.permit.threadDigestSha256 === undefined
      ? {}
      : { threadDigestSha256: state.permit.threadDigestSha256 }),
    payloadSha256: state.permit.payloadSha256,
    idempotencyKeySha256: state.permit.idempotencyKeySha256,
    status: 'outcome-unknown' as const,
    transportInvoked: true as const,
    providerAccepted: 'unknown' as const,
    delivered: 'unknown' as const,
    attemptedAt,
    settledAt,
    retrySafe: false as const,
    verified: false as const,
    authority: 'delivery-evidence-only' as const,
    executionAuthority: false as const,
  });
}

function cloneReceipt(
  receipt: FuryGatewayChannelDeliveryReceipt,
): FuryGatewayChannelDeliveryReceipt {
  return Object.freeze({ ...receipt });
}

export function isGeneratedFuryGatewayChannelDeliveryPermit(
  value: unknown,
): value is FuryGatewayChannelDeliveryPermit {
  return typeof value === 'object'
    && value !== null
    && GENERATED_PERMITS.has(value);
}

export function isGeneratedFuryGatewayChannelDeliveryCoordinator(
  value: unknown,
): value is FuryGatewayChannelDeliveryCoordinator {
  return typeof value === 'object'
    && value !== null
    && GENERATED_COORDINATORS.has(value);
}

export function createFuryGatewayChannelDeliveryCoordinator(
  options: FuryGatewayChannelDeliveryCoordinatorOptions,
): FuryGatewayChannelDeliveryCoordinator {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayChannelAdapterRegistry(options.adapterRegistry)
  ) {
    throw new FuryGatewayChannelDeliveryError(
      'invalid-config',
      'channel delivery coordinator requires a process-local channel adapter registry',
    );
  }

  const adapterRegistry = options.adapterRegistry;
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayChannelDeliveryError(
      'invalid-config',
      'channel delivery now must be a function',
    );
  }
  safeNow(now);

  const defaultPermitTtlMs = boundedInteger(
    options.defaultPermitTtlMs,
    DEFAULT_PERMIT_TTL_MS,
    MIN_PERMIT_TTL_MS,
    HARD_MAX_PERMIT_TTL_MS,
    'defaultPermitTtlMs',
  );
  const maxPermitTtlMs = boundedInteger(
    options.maxPermitTtlMs,
    HARD_MAX_PERMIT_TTL_MS,
    MIN_PERMIT_TTL_MS,
    HARD_MAX_PERMIT_TTL_MS,
    'maxPermitTtlMs',
  );
  if (defaultPermitTtlMs > maxPermitTtlMs) {
    throw new FuryGatewayChannelDeliveryError(
      'invalid-config',
      'defaultPermitTtlMs must not exceed maxPermitTtlMs',
    );
  }
  const transportTimeoutMs = boundedInteger(
    options.transportTimeoutMs,
    DEFAULT_TRANSPORT_TIMEOUT_MS,
    MIN_TRANSPORT_TIMEOUT_MS,
    HARD_MAX_TRANSPORT_TIMEOUT_MS,
    'transportTimeoutMs',
  );
  const maxTransports = boundedInteger(
    options.maxTransports,
    DEFAULT_MAX_TRANSPORTS,
    1,
    HARD_MAX_TRANSPORTS,
    'maxTransports',
  );
  const maxDeliveries = boundedInteger(
    options.maxDeliveries,
    DEFAULT_MAX_DELIVERIES,
    1,
    HARD_MAX_DELIVERIES,
    'maxDeliveries',
  );

  const transports = new Map<string, FuryGatewayChannelTransport>();
  const stateByPermitId = new Map<string, PreparedState>();
  const permitIdByIdempotency = new Map<string, string>();

  const resolveState = (
    permit: FuryGatewayChannelDeliveryPermit,
  ): PreparedState => {
    if (!isGeneratedFuryGatewayChannelDeliveryPermit(permit)) {
      throw new FuryGatewayChannelDeliveryError(
        'invalid-permit',
        'channel delivery requires process-local FuryPipe permit evidence',
      );
    }
    const state = stateByPermitId.get(permit.permitId);
    if (!state || state.permit !== permit) {
      throw new FuryGatewayChannelDeliveryError(
        'invalid-permit',
        'channel delivery permit is not owned by this coordinator',
      );
    }
    return state;
  };

  const api: FuryGatewayChannelDeliveryCoordinator = Object.freeze({
    registerTransport(
      adapterId: string,
      transport: FuryGatewayChannelTransport,
    ): void {
      if (typeof adapterId !== 'string' || !ADAPTER_ID_RE.test(adapterId)) {
        throw new FuryGatewayChannelDeliveryError(
          'adapter-not-found',
          'channel adapter ID is invalid or not registered',
        );
      }
      const adapter = adapterRegistry.inspect(adapterId);
      if (!adapter) {
        throw new FuryGatewayChannelDeliveryError(
          'adapter-not-found',
          'channel adapter is not registered',
        );
      }
      if (!adapter.capabilities.includes('outbound-message')) {
        throw new FuryGatewayChannelDeliveryError(
          'capability-mismatch',
          'channel adapter does not declare outbound-message capability',
        );
      }
      if (typeof transport !== 'function') {
        throw new FuryGatewayChannelDeliveryError(
          'invalid-config',
          'channel transport must be a host-owned function',
        );
      }
      if (transports.has(adapterId)) {
        throw new FuryGatewayChannelDeliveryError(
          'duplicate-transport',
          'channel adapter already has a registered transport',
        );
      }
      if (transports.size >= maxTransports) {
        throw new FuryGatewayChannelDeliveryError(
          'limit-exceeded',
          'channel transport registry is full',
        );
      }
      transports.set(adapterId, transport);
    },

    prepareDelivery(
      input: FuryGatewayChannelDeliveryInput,
    ): FuryGatewayChannelDeliveryPermit {
      const issuedAt = safeNow(now);
      const record = exactPlainRecord(
        input,
        [
          'adapterId',
          'destinationId',
          'threadId',
          'text',
          'replyToEventId',
          'idempotencyKey',
          'expiresInMs',
        ],
        ['adapterId', 'destinationId', 'text', 'idempotencyKey'],
        'channel delivery input',
      );
      if (
        typeof record.adapterId !== 'string'
        || !ADAPTER_ID_RE.test(record.adapterId)
      ) {
        throw new FuryGatewayChannelDeliveryError(
          'adapter-not-found',
          'channel adapter ID is invalid or not registered',
        );
      }
      const adapterId = record.adapterId;
      const adapter = adapterRegistry.inspect(adapterId);
      if (!adapter) {
        throw new FuryGatewayChannelDeliveryError(
          'adapter-not-found',
          'channel adapter is not registered',
        );
      }
      if (!adapter.capabilities.includes('outbound-message')) {
        throw new FuryGatewayChannelDeliveryError(
          'capability-mismatch',
          'channel adapter does not declare outbound-message capability',
        );
      }
      const transport = transports.get(adapterId);
      if (!transport) {
        throw new FuryGatewayChannelDeliveryError(
          'transport-not-found',
          'channel adapter does not have a registered outbound transport',
        );
      }
      if (stateByPermitId.size >= maxDeliveries) {
        throw new FuryGatewayChannelDeliveryError(
          'limit-exceeded',
          'channel delivery registry is full',
        );
      }

      const destinationId = boundedPrintable(
        record.destinationId,
        'destinationId',
        MAX_OPAQUE_ID_BYTES,
      );
      const threadId = record.threadId === undefined
        ? undefined
        : boundedPrintable(record.threadId, 'threadId', MAX_OPAQUE_ID_BYTES);
      const text = boundedMessageText(record.text);
      const replyToEventId = record.replyToEventId === undefined
        ? undefined
        : boundedPrintable(
            record.replyToEventId,
            'replyToEventId',
            MAX_OPAQUE_ID_BYTES,
          );
      const idempotencyKey = boundedPrintable(
        record.idempotencyKey,
        'idempotencyKey',
        MAX_IDEMPOTENCY_KEY_BYTES,
      );
      const destinationDigestSha256 = sha256(destinationId);
      const threadDigestSha256 = threadId === undefined ? undefined : sha256(threadId);
      const replyToEventIdSha256 = replyToEventId === undefined
        ? undefined
        : sha256(replyToEventId);
      const payloadSha256 = sha256(JSON.stringify([
        text,
        replyToEventIdSha256 ?? null,
      ]));
      const idempotencyKeySha256 = sha256(JSON.stringify([
        adapterId,
        adapter.accountDigestSha256,
        destinationDigestSha256,
        threadDigestSha256 ?? null,
        idempotencyKey,
      ]));
      if (permitIdByIdempotency.has(idempotencyKeySha256)) {
        throw new FuryGatewayChannelDeliveryError(
          'idempotency-conflict',
          'channel delivery idempotency key was already reserved in this coordinator',
        );
      }

      const expiresInMs = boundedInteger(
        record.expiresInMs as number | undefined,
        defaultPermitTtlMs,
        MIN_PERMIT_TTL_MS,
        maxPermitTtlMs,
        'expiresInMs',
      );
      const expiresAt = issuedAt + expiresInMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new FuryGatewayChannelDeliveryError(
          'invalid-input',
          'channel delivery permit expiry must be a safe integer',
        );
      }

      let permitId: string;
      do {
        permitId = randomBytes(24).toString('base64url');
      } while (stateByPermitId.has(permitId));
      if (!PERMIT_ID_RE.test(permitId)) {
        throw new FuryGatewayChannelDeliveryError(
          'invalid-permit',
          'generated channel delivery permit ID is invalid',
        );
      }

      const permit = Object.freeze({
        format: FURY_GATEWAY_CHANNEL_DELIVERY_PERMIT_FORMAT,
        permitId,
        adapterId,
        channelKind: adapter.channelKind,
        accountDigestSha256: adapter.accountDigestSha256,
        destinationDigestSha256,
        ...(threadDigestSha256 === undefined ? {} : { threadDigestSha256 }),
        ...(replyToEventIdSha256 === undefined ? {} : { replyToEventIdSha256 }),
        payloadSha256,
        idempotencyKeySha256,
        issuedAt,
        expiresAt,
        authority: 'single-channel-delivery-permit' as const,
        executionAuthority: true as const,
      });
      GENERATED_PERMITS.add(permit);
      stateByPermitId.set(permitId, {
        permit,
        raw: Object.freeze({
          destinationId,
          ...(threadId === undefined ? {} : { threadId }),
          text,
          ...(replyToEventId === undefined ? {} : { replyToEventId }),
        }),
        transport,
        status: 'prepared',
      });
      permitIdByIdempotency.set(idempotencyKeySha256, permitId);
      return permit;
    },

    async executeDelivery(
      permit: FuryGatewayChannelDeliveryPermit,
    ): Promise<FuryGatewayChannelDeliveryReceipt> {
      const attemptedAt = safeNow(now);
      const state = resolveState(permit);

      if (state.status !== 'prepared') {
        throw new FuryGatewayChannelDeliveryError(
          'permit-consumed',
          'channel delivery permit was already consumed or is no longer executable',
        );
      }
      if (attemptedAt >= permit.expiresAt) {
        state.status = 'expired';
        throw new FuryGatewayChannelDeliveryError(
          'permit-expired',
          'channel delivery permit expired before transport invocation',
        );
      }

      const currentAdapter = adapterRegistry.inspect(permit.adapterId);
      if (
        !currentAdapter
        || currentAdapter.channelKind !== permit.channelKind
        || currentAdapter.accountDigestSha256 !== permit.accountDigestSha256
        || !currentAdapter.capabilities.includes('outbound-message')
      ) {
        state.status = 'expired';
        throw new FuryGatewayChannelDeliveryError(
          'capability-mismatch',
          'channel adapter identity or outbound capability changed before delivery',
        );
      }
      if (transports.get(permit.adapterId) !== state.transport) {
        state.status = 'expired';
        throw new FuryGatewayChannelDeliveryError(
          'transport-not-found',
          'channel transport identity changed before delivery',
        );
      }

      // The one-shot permit is consumed before the callback is allowed to see
      // raw destination/message data. From this point on, any callback failure
      // is outcome-unknown and never automatically retry-safe.
      state.status = 'in-flight';
      state.attemptedAt = attemptedAt;

      const request = Object.freeze({
        format: FURY_GATEWAY_CHANNEL_TRANSPORT_REQUEST_FORMAT,
        adapterId: permit.adapterId,
        channelKind: permit.channelKind,
        accountDigestSha256: permit.accountDigestSha256,
        destinationId: state.raw.destinationId,
        ...(state.raw.threadId === undefined ? {} : { threadId: state.raw.threadId }),
        text: state.raw.text,
        ...(state.raw.replyToEventId === undefined
          ? {}
          : { replyToEventId: state.raw.replyToEventId }),
        authority: 'transport-invocation-data' as const,
        executionAuthority: false as const,
      });

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error('channel delivery transport timed out'));
          reject(new Error('channel delivery transport timed out'));
        }, transportTimeoutMs);
        timer.unref?.();
      });

      try {
        const rawResult = await Promise.race([
          Promise.resolve(state.transport(
            request,
            Object.freeze({ signal: controller.signal }),
          )),
          timeoutPromise,
        ]);
        const result = normalizeTransportResult(rawResult);
        const settledAt = postInvocationNow(now, attemptedAt);
        const receipt = receiptFromKnownResult(
          state,
          result,
          attemptedAt,
          settledAt,
        );
        state.status = receipt.status;
        state.receipt = receipt;
        return cloneReceipt(receipt);
      } catch (error) {
        if (
          error instanceof FuryGatewayChannelDeliveryOutcomeUnknownError
        ) {
          throw error;
        }
        const settledAt = postInvocationNow(now, attemptedAt);
        const receipt = receiptFromUnknown(state, attemptedAt, settledAt);
        state.status = 'outcome-unknown';
        state.receipt = receipt;
        throw new FuryGatewayChannelDeliveryOutcomeUnknownError(
          cloneReceipt(receipt),
        );
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },

    inspectDelivery(
      permit: FuryGatewayChannelDeliveryPermit,
    ): FuryGatewayChannelDeliveryInspection {
      const at = safeNow(now);
      const state = resolveState(permit);
      if (state.status === 'prepared' && at >= permit.expiresAt) {
        state.status = 'expired';
      }
      return Object.freeze({
        permitIdSha256: sha256(permit.permitId),
        adapterId: permit.adapterId,
        channelKind: permit.channelKind,
        accountDigestSha256: permit.accountDigestSha256,
        destinationDigestSha256: permit.destinationDigestSha256,
        idempotencyKeySha256: permit.idempotencyKeySha256,
        issuedAt: permit.issuedAt,
        expiresAt: permit.expiresAt,
        status: state.status,
        ...(state.receipt === undefined
          ? {}
          : { receipt: cloneReceipt(state.receipt) }),
      });
    },

    statusSnapshot(): FuryGatewayChannelDeliveryStatusSnapshot {
      const at = safeNow(now);
      const counts = Object.fromEntries(
        FURY_GATEWAY_CHANNEL_DELIVERY_STATUSES.map((status) => [status, 0]),
      ) as Record<FuryGatewayChannelDeliveryStatus, number>;
      for (const state of stateByPermitId.values()) {
        if (state.status === 'prepared' && at >= state.permit.expiresAt) {
          state.status = 'expired';
        }
        counts[state.status] += 1;
      }
      return Object.freeze({
        total: stateByPermitId.size,
        transports: transports.size,
        observedAt: at,
        counts: Object.freeze({ ...counts }),
        authority: 'observability-only' as const,
        executionAuthority: false as const,
      });
    },

    transportCount(): number {
      return transports.size;
    },

    deliveryCount(): number {
      return stateByPermitId.size;
    },
  });

  GENERATED_COORDINATORS.add(api);
  return api;
}
