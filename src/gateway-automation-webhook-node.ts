import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

import type {
  RecoveryHandle,
  RecoveryMetadata,
  RecoveryStore,
} from './core/recovery-store.js';
import {
  type FuryGatewayAutomationDefinitionInspection,
  type FuryGatewayAutomationDefinitionStore,
  isGeneratedFuryGatewayAutomationDefinitionStore,
} from './gateway-automation-definition-node.js';
import {
  type FuryGatewayAutomationRunLedger,
  type FuryGatewayAutomationRunStatus,
  isGeneratedFuryGatewayAutomationRunLedger,
} from './gateway-automation-run-ledger-node.js';

export const FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT =
  'furypipe-gateway-automation-webhook-source/v1' as const;
export const FURY_GATEWAY_AUTOMATION_WEBHOOK_EVENT_FORMAT =
  'furypipe-gateway-automation-webhook-event/v1' as const;
export const FURY_GATEWAY_AUTOMATION_WEBHOOK_RECEIPT_FORMAT =
  'furypipe-gateway-automation-webhook-receipt/v1' as const;
export const FURY_GATEWAY_AUTOMATION_WEBHOOK_AUTH_METHOD =
  'hmac-sha256-v1' as const;

export interface FuryGatewayAutomationWebhookSourceInput {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT;
  readonly sourceId: string;
  /**
   * Host-owned secret. It is copied into process-local memory and is never
   * persisted or returned by inspection.
   */
  readonly secret: Uint8Array;
  readonly allowedContentTypes?: readonly string[];
  readonly maxBodyBytes?: number;
  readonly replayWindowMs?: number;
  readonly maxFutureSkewMs?: number;
}

export interface FuryGatewayAutomationWebhookSourceInspection {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT;
  readonly sourceId: string;
  readonly authMethod: typeof FURY_GATEWAY_AUTOMATION_WEBHOOK_AUTH_METHOD;
  readonly allowedContentTypes: readonly string[];
  readonly maxBodyBytes: number;
  readonly replayWindowMs: number;
  readonly maxFutureSkewMs: number;
  readonly secretConfigured: true;
  readonly authority: 'webhook-source-config-metadata-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationWebhookRequest {
  readonly automationId: string;
  readonly sourceId: string;
  readonly eventId: string;
  readonly signedAt: number;
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly signature: string;
}

export interface FuryGatewayAutomationWebhookReceipt {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_WEBHOOK_RECEIPT_FORMAT;
  readonly automationId: string;
  readonly sourceId: string;
  readonly definitionRevision: number;
  readonly definitionSha256: string;
  readonly eventIdSha256: string;
  readonly bodySha256: string;
  readonly mediaType: string;
  readonly signedAt: number;
  readonly receivedAt: number;
  readonly duplicate: boolean;
  readonly authenticated: true;
  readonly replayProtected: true;
  readonly run: FuryGatewayAutomationRunStatus;
  readonly authority: 'authenticated-webhook-evidence-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayAutomationWebhookCoordinatorOptions {
  readonly definitions: FuryGatewayAutomationDefinitionStore;
  readonly runs: FuryGatewayAutomationRunLedger;
  readonly store: RecoveryStore;
  readonly now?: () => number;
  readonly maxSources?: number;
  readonly maxEvents?: number;
  readonly defaultReplayWindowMs?: number;
  readonly defaultMaxFutureSkewMs?: number;
  readonly defaultMaxBodyBytes?: number;
}

export interface FuryGatewayAutomationWebhookCoordinator {
  registerSource(
    input: FuryGatewayAutomationWebhookSourceInput,
  ): FuryGatewayAutomationWebhookSourceInspection;
  inspectSource(
    sourceId: string,
  ): FuryGatewayAutomationWebhookSourceInspection | undefined;
  ingest(
    request: FuryGatewayAutomationWebhookRequest,
  ): Promise<FuryGatewayAutomationWebhookReceipt>;
  sourceCount(): number;
  acceptedEventCount(): Promise<number>;
}

export type FuryGatewayAutomationWebhookErrorCode =
  | 'invalid-options'
  | 'invalid-source'
  | 'duplicate-source'
  | 'source-not-found'
  | 'invalid-request'
  | 'unsupported-content-type'
  | 'timestamp-too-old'
  | 'timestamp-in-future'
  | 'invalid-signature'
  | 'definition-not-found'
  | 'definition-disabled'
  | 'trigger-mismatch'
  | 'replay-conflict'
  | 'durable-state-corrupt'
  | 'limit-exceeded';

const ERROR_MESSAGES: Readonly<Record<
  FuryGatewayAutomationWebhookErrorCode,
  string
>> = Object.freeze({
  'invalid-options': 'Automation webhook coordinator options are invalid.',
  'invalid-source': 'Automation webhook source configuration is invalid.',
  'duplicate-source': 'Automation webhook source already exists.',
  'source-not-found': 'Automation webhook source is not registered.',
  'invalid-request': 'Automation webhook request is invalid.',
  'unsupported-content-type': 'Automation webhook content type is not allowed.',
  'timestamp-too-old': 'Automation webhook signature timestamp is outside the replay window.',
  'timestamp-in-future': 'Automation webhook signature timestamp is too far in the future.',
  'invalid-signature': 'Automation webhook signature is invalid.',
  'definition-not-found': 'Automation webhook target definition does not exist.',
  'definition-disabled': 'Automation webhook target definition is disabled.',
  'trigger-mismatch': 'Automation webhook route does not match the target definition.',
  'replay-conflict': 'Automation webhook event ID was already used with different evidence.',
  'durable-state-corrupt': 'Automation webhook durable replay state is corrupt.',
  'limit-exceeded': 'Automation webhook durable or process-local limit was exceeded.',
});

export class FuryGatewayAutomationWebhookError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code: FuryGatewayAutomationWebhookErrorCode,
    readonly automationId?: string,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'FuryGatewayAutomationWebhookError';
  }
}

interface WebhookSourceState {
  readonly inspection: FuryGatewayAutomationWebhookSourceInspection;
  readonly secret: Buffer;
}

interface DurableWebhookEvent {
  readonly format: typeof FURY_GATEWAY_AUTOMATION_WEBHOOK_EVENT_FORMAT;
  readonly automationId: string;
  readonly sourceId: string;
  readonly definitionRevision: number;
  readonly definitionSha256: string;
  readonly eventIdSha256: string;
  readonly bodySha256: string;
  readonly mediaType: string;
  readonly signedAt: number;
  readonly receivedAt: number;
  readonly authority: 'authenticated-webhook-evidence-only';
  readonly executionAuthority: false;
}

interface LoadedWebhookEvent {
  readonly handle: RecoveryHandle;
  readonly record: DurableWebhookEvent;
}

const GENERATED_COORDINATORS = new WeakSet<object>();
const SYSTEM = 'gateway-automation-webhook';
const SOURCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const AUTOMATION_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const MEDIA_TYPE_RE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u;
const SIGNATURE_RE = /^[0-9a-f]{64}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

const DEFAULT_MAX_SOURCES = 64;
const HARD_MAX_SOURCES = 1_024;
const DEFAULT_MAX_EVENTS = 10_000;
const HARD_MAX_EVENTS = 10_000;
const DEFAULT_REPLAY_WINDOW_MS = 24 * 60 * 60_000;
const MIN_REPLAY_WINDOW_MS = 60_000;
const HARD_MAX_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60_000;
const HARD_MAX_FUTURE_SKEW_MS = 60 * 60_000;
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const HARD_MAX_BODY_BYTES = 4 * 1024 * 1024;
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 256;
const MAX_EVENT_ID_BYTES = 512;
const MAX_CONTENT_TYPE_BYTES = 256;
const MAX_ALLOWED_CONTENT_TYPES = 16;

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function exactDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  code: FuryGatewayAutomationWebhookErrorCode,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayAutomationWebhookError(code);
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
      throw new FuryGatewayAutomationWebhookError(code);
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayAutomationWebhookError(code);
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
    throw new RangeError(label + ' must be an integer from ' + min + ' to ' + max);
  }
  return resolved;
}

function safeTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FuryGatewayAutomationWebhookError('invalid-request');
  }
  return value as number;
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryGatewayAutomationWebhookError('invalid-options');
  }
  return value;
}

function boundedId(
  value: unknown,
  pattern: RegExp,
  maxBytes: number,
  code: FuryGatewayAutomationWebhookErrorCode,
): string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !pattern.test(value)
    || Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new FuryGatewayAutomationWebhookError(code);
  }
  return value;
}

function boundedOpaqueText(
  value: unknown,
  maxBytes: number,
  code: FuryGatewayAutomationWebhookErrorCode,
): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayAutomationWebhookError(code);
  }
  return value;
}

function mediaType(value: unknown): string {
  const raw = boundedOpaqueText(
    value,
    MAX_CONTENT_TYPE_BYTES,
    'invalid-request',
  );
  const normalized = raw.split(';', 1)[0]!.trim().toLowerCase();
  if (!MEDIA_TYPE_RE.test(normalized)) {
    throw new FuryGatewayAutomationWebhookError('invalid-request');
  }
  return normalized;
}

function normalizeAllowedContentTypes(
  value: readonly string[] | undefined,
): readonly string[] {
  const input = value ?? ['application/json'];
  if (
    !Array.isArray(input)
    || input.length < 1
    || input.length > MAX_ALLOWED_CONTENT_TYPES
    || Object.getOwnPropertySymbols(input).length > 0
  ) {
    throw new FuryGatewayAutomationWebhookError('invalid-source');
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryGatewayAutomationWebhookError('invalid-source');
    }
    const current = mediaType(descriptor.value);
    if (seen.has(current)) {
      throw new FuryGatewayAutomationWebhookError('invalid-source');
    }
    seen.add(current);
    normalized.push(current);
  }
  normalized.sort();
  return Object.freeze(normalized);
}

function copySecret(value: unknown): Buffer {
  if (!(value instanceof Uint8Array)) {
    throw new FuryGatewayAutomationWebhookError('invalid-source');
  }
  const secret = Buffer.from(value);
  if (
    secret.byteLength < MIN_SECRET_BYTES
    || secret.byteLength > MAX_SECRET_BYTES
  ) {
    throw new FuryGatewayAutomationWebhookError('invalid-source');
  }
  return secret;
}

function copyBody(value: unknown, maxBodyBytes: number): Buffer {
  if (!(value instanceof Uint8Array)) {
    throw new FuryGatewayAutomationWebhookError('invalid-request');
  }
  const body = Buffer.from(value);
  if (body.byteLength > maxBodyBytes) {
    throw new FuryGatewayAutomationWebhookError('limit-exceeded');
  }
  return body;
}

function signingPayload(
  sourceId: string,
  eventId: string,
  signedAt: number,
  body: Uint8Array,
): Buffer {
  const sourceBytes = Buffer.from(sourceId, 'utf8');
  const eventBytes = Buffer.from(eventId, 'utf8');
  const prefix = Buffer.from(
    [
      FURY_GATEWAY_AUTOMATION_WEBHOOK_AUTH_METHOD,
      String(sourceBytes.byteLength),
      sourceId,
      String(eventBytes.byteLength),
      eventId,
      String(signedAt),
      String(body.byteLength),
      '',
    ].join('\n'),
    'utf8',
  );
  return Buffer.concat([prefix, Buffer.from(body)]);
}

export function signFuryGatewayAutomationWebhookRequest(
  secret: Uint8Array,
  input: {
    readonly sourceId: string;
    readonly eventId: string;
    readonly signedAt: number;
    readonly body: Uint8Array;
  },
): string {
  const sourceId = boundedId(
    input.sourceId,
    SOURCE_ID_RE,
    128,
    'invalid-request',
  );
  const eventId = boundedOpaqueText(
    input.eventId,
    MAX_EVENT_ID_BYTES,
    'invalid-request',
  );
  const signedAt = safeTimestamp(input.signedAt);
  const body = Buffer.from(input.body);
  const key = copySecret(secret);
  try {
    return createHmac('sha256', key)
      .update(signingPayload(sourceId, eventId, signedAt, body))
      .digest('hex');
  } finally {
    key.fill(0);
  }
}

function verifySignature(
  secret: Buffer,
  sourceId: string,
  eventId: string,
  signedAt: number,
  body: Buffer,
  signature: string,
): boolean {
  if (!SIGNATURE_RE.test(signature)) return false;
  const expected = createHmac('sha256', secret)
    .update(signingPayload(sourceId, eventId, signedAt, body))
    .digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.byteLength === expected.byteLength
    && timingSafeEqual(supplied, expected);
}

function metadata(
  record: DurableWebhookEvent,
): RecoveryMetadata {
  return Object.freeze({
    system: SYSTEM,
    recordType: 'event',
    automationId: record.automationId,
    sourceId: record.sourceId,
    eventIdSha256: record.eventIdSha256,
  });
}

function eventBytes(record: DurableWebhookEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(record));
}

function parseEvent(bytes: Uint8Array): DurableWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new FuryGatewayAutomationWebhookError('durable-state-corrupt');
  }
  try {
    const record = exactDataRecord(
      parsed,
      [
        'format',
        'automationId',
        'sourceId',
        'definitionRevision',
        'definitionSha256',
        'eventIdSha256',
        'bodySha256',
        'mediaType',
        'signedAt',
        'receivedAt',
        'authority',
        'executionAuthority',
      ],
      [
        'format',
        'automationId',
        'sourceId',
        'definitionRevision',
        'definitionSha256',
        'eventIdSha256',
        'bodySha256',
        'mediaType',
        'signedAt',
        'receivedAt',
        'authority',
        'executionAuthority',
      ],
      'durable-state-corrupt',
    );
    if (
      record.format !== FURY_GATEWAY_AUTOMATION_WEBHOOK_EVENT_FORMAT
      || !Number.isSafeInteger(record.definitionRevision)
      || (record.definitionRevision as number) < 1
      || typeof record.definitionSha256 !== 'string'
      || !SHA256_RE.test(record.definitionSha256)
      || typeof record.eventIdSha256 !== 'string'
      || !SHA256_RE.test(record.eventIdSha256)
      || typeof record.bodySha256 !== 'string'
      || !SHA256_RE.test(record.bodySha256)
      || record.authority !== 'authenticated-webhook-evidence-only'
      || record.executionAuthority !== false
    ) {
      throw new FuryGatewayAutomationWebhookError('durable-state-corrupt');
    }
    const normalized: DurableWebhookEvent = Object.freeze({
      format: FURY_GATEWAY_AUTOMATION_WEBHOOK_EVENT_FORMAT,
      automationId: boundedId(
        record.automationId,
        AUTOMATION_ID_RE,
        128,
        'durable-state-corrupt',
      ),
      sourceId: boundedId(
        record.sourceId,
        SOURCE_ID_RE,
        128,
        'durable-state-corrupt',
      ),
      definitionRevision: record.definitionRevision as number,
      definitionSha256: record.definitionSha256,
      eventIdSha256: record.eventIdSha256,
      bodySha256: record.bodySha256,
      mediaType: mediaType(record.mediaType),
      signedAt: safeTimestamp(record.signedAt),
      receivedAt: safeTimestamp(record.receivedAt),
      authority: 'authenticated-webhook-evidence-only' as const,
      executionAuthority: false as const,
    });
    if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
      throw new FuryGatewayAutomationWebhookError('durable-state-corrupt');
    }
    return normalized;
  } catch (error) {
    if (
      error instanceof FuryGatewayAutomationWebhookError
      && error.code === 'durable-state-corrupt'
    ) {
      throw error;
    }
    throw new FuryGatewayAutomationWebhookError('durable-state-corrupt');
  }
}

function requiredStore(
  store: RecoveryStore,
): RecoveryStore & Required<Pick<RecoveryStore, 'list' | 'putBounded'>> {
  if (
    !store
    || typeof store !== 'object'
    || typeof store.get !== 'function'
    || typeof store.list !== 'function'
    || typeof store.putBounded !== 'function'
  ) {
    throw new FuryGatewayAutomationWebhookError('invalid-options');
  }
  return store as RecoveryStore &
    Required<Pick<RecoveryStore, 'list' | 'putBounded'>>;
}

async function loadEvent(
  store: RecoveryStore & Required<Pick<RecoveryStore, 'list'>>,
  automationId: string,
  sourceId: string,
  eventIdSha256: string,
): Promise<LoadedWebhookEvent | undefined> {
  const handles = await store.list({
    metadata: {
      system: SYSTEM,
      recordType: 'event',
      automationId,
      sourceId,
      eventIdSha256,
    },
    limit: 2,
  });
  if (handles.length > 1) {
    throw new FuryGatewayAutomationWebhookError(
      'durable-state-corrupt',
      automationId,
    );
  }
  const handle = handles[0];
  if (!handle) return undefined;
  const record = parseEvent(await store.get(handle));
  if (
    record.automationId !== automationId
    || record.sourceId !== sourceId
    || record.eventIdSha256 !== eventIdSha256
    || handle.metadata?.system !== SYSTEM
    || handle.metadata?.recordType !== 'event'
    || handle.metadata?.automationId !== automationId
    || handle.metadata?.sourceId !== sourceId
    || handle.metadata?.eventIdSha256 !== eventIdSha256
  ) {
    throw new FuryGatewayAutomationWebhookError(
      'durable-state-corrupt',
      automationId,
    );
  }
  return Object.freeze({ handle, record });
}

function assertWebhookDefinition(
  inspection: FuryGatewayAutomationDefinitionInspection | undefined,
  sourceId: string,
  automationId: string,
): FuryGatewayAutomationDefinitionInspection {
  if (!inspection) {
    throw new FuryGatewayAutomationWebhookError(
      'definition-not-found',
      automationId,
    );
  }
  if (!inspection.definition.enabled) {
    throw new FuryGatewayAutomationWebhookError(
      'definition-disabled',
      automationId,
    );
  }
  if (
    inspection.definition.trigger.kind !== 'webhook'
    || inspection.definition.trigger.sourceId !== sourceId
  ) {
    throw new FuryGatewayAutomationWebhookError(
      'trigger-mismatch',
      automationId,
    );
  }
  return inspection;
}

function eventMatches(
  left: DurableWebhookEvent,
  right: DurableWebhookEvent,
): boolean {
  return left.automationId === right.automationId
    && left.sourceId === right.sourceId
    && left.eventIdSha256 === right.eventIdSha256
    && left.bodySha256 === right.bodySha256
    && left.mediaType === right.mediaType
    && left.signedAt === right.signedAt;
}

function receipt(
  record: DurableWebhookEvent,
  duplicate: boolean,
  run: FuryGatewayAutomationRunStatus,
): FuryGatewayAutomationWebhookReceipt {
  return Object.freeze({
    format: FURY_GATEWAY_AUTOMATION_WEBHOOK_RECEIPT_FORMAT,
    automationId: record.automationId,
    sourceId: record.sourceId,
    definitionRevision: record.definitionRevision,
    definitionSha256: record.definitionSha256,
    eventIdSha256: record.eventIdSha256,
    bodySha256: record.bodySha256,
    mediaType: record.mediaType,
    signedAt: record.signedAt,
    receivedAt: record.receivedAt,
    duplicate,
    authenticated: true as const,
    replayProtected: true as const,
    run,
    authority: 'authenticated-webhook-evidence-only' as const,
    executionAuthority: false as const,
  });
}

export function isGeneratedFuryGatewayAutomationWebhookCoordinator(
  value: unknown,
): value is FuryGatewayAutomationWebhookCoordinator {
  return typeof value === 'object'
    && value !== null
    && GENERATED_COORDINATORS.has(value);
}

export function createFuryGatewayAutomationWebhookCoordinator(
  options: FuryGatewayAutomationWebhookCoordinatorOptions,
): FuryGatewayAutomationWebhookCoordinator {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayAutomationDefinitionStore(options.definitions)
    || !isGeneratedFuryGatewayAutomationRunLedger(options.runs)
  ) {
    throw new FuryGatewayAutomationWebhookError('invalid-options');
  }
  const store = requiredStore(options.store);
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayAutomationWebhookError('invalid-options');
  }
  safeNow(now);

  const maxSources = boundedInteger(
    options.maxSources,
    DEFAULT_MAX_SOURCES,
    1,
    HARD_MAX_SOURCES,
    'maxSources',
  );
  const maxEvents = boundedInteger(
    options.maxEvents,
    DEFAULT_MAX_EVENTS,
    1,
    HARD_MAX_EVENTS,
    'maxEvents',
  );
  const defaultReplayWindowMs = boundedInteger(
    options.defaultReplayWindowMs,
    DEFAULT_REPLAY_WINDOW_MS,
    MIN_REPLAY_WINDOW_MS,
    HARD_MAX_REPLAY_WINDOW_MS,
    'defaultReplayWindowMs',
  );
  const defaultMaxFutureSkewMs = boundedInteger(
    options.defaultMaxFutureSkewMs,
    DEFAULT_MAX_FUTURE_SKEW_MS,
    0,
    HARD_MAX_FUTURE_SKEW_MS,
    'defaultMaxFutureSkewMs',
  );
  const defaultMaxBodyBytes = boundedInteger(
    options.defaultMaxBodyBytes,
    DEFAULT_MAX_BODY_BYTES,
    1,
    HARD_MAX_BODY_BYTES,
    'defaultMaxBodyBytes',
  );

  const sources = new Map<string, WebhookSourceState>();

  const api: FuryGatewayAutomationWebhookCoordinator = Object.freeze({
    registerSource(
      input: FuryGatewayAutomationWebhookSourceInput,
    ): FuryGatewayAutomationWebhookSourceInspection {
      const record = exactDataRecord(
        input,
        [
          'format',
          'sourceId',
          'secret',
          'allowedContentTypes',
          'maxBodyBytes',
          'replayWindowMs',
          'maxFutureSkewMs',
        ],
        ['format', 'sourceId', 'secret'],
        'invalid-source',
      );
      if (record.format !== FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT) {
        throw new FuryGatewayAutomationWebhookError('invalid-source');
      }
      const sourceId = boundedId(
        record.sourceId,
        SOURCE_ID_RE,
        128,
        'invalid-source',
      );
      if (sources.has(sourceId)) {
        throw new FuryGatewayAutomationWebhookError('duplicate-source');
      }
      if (sources.size >= maxSources) {
        throw new FuryGatewayAutomationWebhookError('limit-exceeded');
      }
      const secret = copySecret(record.secret);
      const allowedContentTypes = normalizeAllowedContentTypes(
        record.allowedContentTypes as readonly string[] | undefined,
      );
      const maxBodyBytes = boundedInteger(
        record.maxBodyBytes as number | undefined,
        defaultMaxBodyBytes,
        1,
        HARD_MAX_BODY_BYTES,
        'webhook maxBodyBytes',
      );
      const replayWindowMs = boundedInteger(
        record.replayWindowMs as number | undefined,
        defaultReplayWindowMs,
        MIN_REPLAY_WINDOW_MS,
        HARD_MAX_REPLAY_WINDOW_MS,
        'webhook replayWindowMs',
      );
      const maxFutureSkewMs = boundedInteger(
        record.maxFutureSkewMs as number | undefined,
        defaultMaxFutureSkewMs,
        0,
        HARD_MAX_FUTURE_SKEW_MS,
        'webhook maxFutureSkewMs',
      );
      const inspection = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT,
        sourceId,
        authMethod: FURY_GATEWAY_AUTOMATION_WEBHOOK_AUTH_METHOD,
        allowedContentTypes,
        maxBodyBytes,
        replayWindowMs,
        maxFutureSkewMs,
        secretConfigured: true as const,
        authority: 'webhook-source-config-metadata-only' as const,
        executionAuthority: false as const,
      });
      sources.set(sourceId, Object.freeze({ inspection, secret }));
      return inspection;
    },

    inspectSource(
      sourceIdInput: string,
    ): FuryGatewayAutomationWebhookSourceInspection | undefined {
      const sourceId = boundedId(
        sourceIdInput,
        SOURCE_ID_RE,
        128,
        'invalid-source',
      );
      return sources.get(sourceId)?.inspection;
    },

    async ingest(
      request: FuryGatewayAutomationWebhookRequest,
    ): Promise<FuryGatewayAutomationWebhookReceipt> {
      const requestRecord = exactDataRecord(
        request,
        [
          'automationId',
          'sourceId',
          'eventId',
          'signedAt',
          'contentType',
          'body',
          'signature',
        ],
        [
          'automationId',
          'sourceId',
          'eventId',
          'signedAt',
          'contentType',
          'body',
          'signature',
        ],
        'invalid-request',
      );
      const automationId = boundedId(
        requestRecord.automationId,
        AUTOMATION_ID_RE,
        128,
        'invalid-request',
      );
      const sourceId = boundedId(
        requestRecord.sourceId,
        SOURCE_ID_RE,
        128,
        'invalid-request',
      );
      const source = sources.get(sourceId);
      if (!source) {
        throw new FuryGatewayAutomationWebhookError(
          'source-not-found',
          automationId,
        );
      }

      const definition = assertWebhookDefinition(
        await options.definitions.inspect(automationId),
        sourceId,
        automationId,
      );
      const eventId = boundedOpaqueText(
        requestRecord.eventId,
        MAX_EVENT_ID_BYTES,
        'invalid-request',
      );
      const signedAt = safeTimestamp(requestRecord.signedAt);
      const receivedAt = safeNow(now);
      if (signedAt > receivedAt + source.inspection.maxFutureSkewMs) {
        throw new FuryGatewayAutomationWebhookError(
          'timestamp-in-future',
          automationId,
        );
      }
      if (receivedAt - signedAt > source.inspection.replayWindowMs) {
        throw new FuryGatewayAutomationWebhookError(
          'timestamp-too-old',
          automationId,
        );
      }

      const normalizedMediaType = mediaType(requestRecord.contentType);
      if (!source.inspection.allowedContentTypes.includes(normalizedMediaType)) {
        throw new FuryGatewayAutomationWebhookError(
          'unsupported-content-type',
          automationId,
        );
      }
      const body = copyBody(
        requestRecord.body,
        source.inspection.maxBodyBytes,
      );
      const signature = boundedOpaqueText(
        requestRecord.signature,
        64,
        'invalid-request',
      ).toLowerCase();
      if (
        !SIGNATURE_RE.test(signature)
        || !verifySignature(
          source.secret,
          sourceId,
          eventId,
          signedAt,
          body,
          signature,
        )
      ) {
        throw new FuryGatewayAutomationWebhookError(
          'invalid-signature',
          automationId,
        );
      }

      const eventIdSha256 = sha256(eventId);
      const candidate: DurableWebhookEvent = Object.freeze({
        format: FURY_GATEWAY_AUTOMATION_WEBHOOK_EVENT_FORMAT,
        automationId,
        sourceId,
        definitionRevision: definition.definition.revision,
        definitionSha256: definition.definitionSha256,
        eventIdSha256,
        bodySha256: sha256(body),
        mediaType: normalizedMediaType,
        signedAt,
        receivedAt,
        authority: 'authenticated-webhook-evidence-only' as const,
        executionAuthority: false as const,
      });

      let durable = await loadEvent(
        store,
        automationId,
        sourceId,
        eventIdSha256,
      );
      let duplicate = durable !== undefined;
      if (durable && !eventMatches(durable.record, candidate)) {
        throw new FuryGatewayAutomationWebhookError(
          'replay-conflict',
          automationId,
        );
      }

      if (!durable) {
        try {
          const handle = await store.putBounded(
            eventBytes(candidate),
            metadata(candidate),
            {
              metadata: { system: SYSTEM },
              maxMatches: maxEvents,
              additionalBounds: [{
                metadata: {
                  system: SYSTEM,
                  recordType: 'event',
                  automationId,
                  sourceId,
                  eventIdSha256,
                },
                maxMatches: 1,
              }],
            },
          );
          durable = Object.freeze({ handle, record: candidate });
        } catch {
          durable = await loadEvent(
            store,
            automationId,
            sourceId,
            eventIdSha256,
          );
          if (!durable) {
            throw new FuryGatewayAutomationWebhookError(
              'limit-exceeded',
              automationId,
            );
          }
          if (!eventMatches(durable.record, candidate)) {
            throw new FuryGatewayAutomationWebhookError(
              'replay-conflict',
              automationId,
            );
          }
          duplicate = true;
        }
      }

      const run = await options.runs.registerTrigger({
        automationId,
        definitionRevision: durable.record.definitionRevision,
        definitionSha256: durable.record.definitionSha256,
        sourceKind: 'webhook',
        occurrenceKey:
          'webhook:' + sourceId + ':' + durable.record.eventIdSha256,
        scheduledFor: durable.record.signedAt,
      });

      return receipt(durable.record, duplicate, run);
    },

    sourceCount(): number {
      return sources.size;
    },

    async acceptedEventCount(): Promise<number> {
      const handles = await store.list({
        metadata: {
          system: SYSTEM,
          recordType: 'event',
        },
        limit: maxEvents,
      });
      return handles.length;
    },
  });

  GENERATED_COORDINATORS.add(api);
  return api;
}
