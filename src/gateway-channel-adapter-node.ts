import { createHash } from 'node:crypto';

export const FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT =
  'furypipe-gateway-channel-adapter/v1' as const;
export const FURY_GATEWAY_CHANNEL_EVENT_FORMAT =
  'furypipe-gateway-channel-event/v1' as const;

export const FURY_GATEWAY_CHANNEL_CAPABILITIES = Object.freeze([
  'inbound-message',
  'inbound-reaction',
  'outbound-message',
] as const);

export const FURY_GATEWAY_CHANNEL_EVENT_TYPES = Object.freeze([
  'message',
  'message-edit',
  'message-delete',
  'reaction-add',
  'reaction-remove',
] as const);

export const FURY_GATEWAY_CHANNEL_CONVERSATION_KINDS = Object.freeze([
  'direct',
  'group',
  'channel',
] as const);

export const FURY_GATEWAY_CHANNEL_ATTACHMENT_REFERENCE_CLASSES = Object.freeze([
  'provider-object',
  'remote-resource',
  'inline-resource',
] as const);

export type FuryGatewayChannelCapability =
  (typeof FURY_GATEWAY_CHANNEL_CAPABILITIES)[number];
export type FuryGatewayChannelEventType =
  (typeof FURY_GATEWAY_CHANNEL_EVENT_TYPES)[number];
export type FuryGatewayChannelConversationKind =
  (typeof FURY_GATEWAY_CHANNEL_CONVERSATION_KINDS)[number];
export type FuryGatewayChannelAttachmentReferenceClass =
  (typeof FURY_GATEWAY_CHANNEL_ATTACHMENT_REFERENCE_CLASSES)[number];

export interface FuryGatewayChannelAdapterRegistrationInput {
  readonly format: typeof FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT;
  readonly adapterId: string;
  readonly channelKind: string;
  /** Host-owned opaque account identity. Stored only as SHA-256. */
  readonly accountId: string;
  readonly policyProfileId: string;
  readonly capabilities: readonly FuryGatewayChannelCapability[];
}

export interface FuryGatewayChannelAdapterInspection {
  readonly format: typeof FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT;
  readonly adapterId: string;
  readonly channelKind: string;
  readonly accountDigestSha256: string;
  readonly policyProfileId: string;
  readonly capabilities: readonly FuryGatewayChannelCapability[];
  readonly authority: 'channel-config-metadata-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayChannelAttachmentInput {
  readonly attachmentId: string;
  readonly referenceClass: FuryGatewayChannelAttachmentReferenceClass;
  readonly declaredMimeType?: string;
  readonly declaredBytes?: number;
  readonly displayName?: string;
}

export interface FuryGatewayChannelAttachmentDescriptor {
  readonly attachmentIdSha256: string;
  readonly referenceClass: FuryGatewayChannelAttachmentReferenceClass;
  readonly declaredMimeType?: string;
  readonly declaredBytes?: number;
  readonly displayName?: string;
}

export interface FuryGatewayChannelReactionInput {
  readonly targetEventId: string;
  readonly value: string;
}

export interface FuryGatewayChannelReaction {
  readonly targetEventIdSha256: string;
  readonly value: string;
}

export interface FuryGatewayChannelInboundInput {
  /** Must match the account bound to the configured adapter. */
  readonly accountId: string;
  readonly eventId: string;
  readonly senderId: string;
  readonly conversationId: string;
  readonly conversationKind: FuryGatewayChannelConversationKind;
  readonly threadId?: string;
  readonly type: FuryGatewayChannelEventType;
  readonly text?: string;
  readonly attachments?: readonly FuryGatewayChannelAttachmentInput[];
  readonly replyToEventId?: string;
  readonly reaction?: FuryGatewayChannelReactionInput;
  readonly observedAt: number;
}

export interface FuryGatewayChannelInboundEvent {
  readonly format: typeof FURY_GATEWAY_CHANNEL_EVENT_FORMAT;
  readonly adapterId: string;
  readonly channelKind: string;
  readonly accountDigestSha256: string;
  readonly eventIdSha256: string;
  readonly replayKeySha256: string;
  readonly senderDigestSha256: string;
  readonly conversationDigestSha256: string;
  readonly conversationKind: FuryGatewayChannelConversationKind;
  readonly threadDigestSha256?: string;
  readonly type: FuryGatewayChannelEventType;
  readonly text?: string;
  readonly attachments: readonly FuryGatewayChannelAttachmentDescriptor[];
  readonly replyToEventIdSha256?: string;
  readonly reaction?: FuryGatewayChannelReaction;
  readonly observedAt: number;
  readonly receivedAt: number;
  readonly transportAuthentication: 'not-proven';
  readonly principalMapped: false;
  readonly sessionIssued: false;
  readonly authority: 'transport-data-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayChannelAdapterRegistryOptions {
  readonly now?: () => number;
  readonly maxAdapters?: number;
  readonly maxSeenEvents?: number;
  readonly replayWindowMs?: number;
  readonly maxFutureSkewMs?: number;
}

export interface FuryGatewayChannelAdapterRegistry {
  register(
    input: FuryGatewayChannelAdapterRegistrationInput,
  ): FuryGatewayChannelAdapterInspection;
  inspect(adapterId: string): FuryGatewayChannelAdapterInspection | undefined;
  list(): readonly FuryGatewayChannelAdapterInspection[];
  normalizeInbound(
    adapterId: string,
    input: FuryGatewayChannelInboundInput,
  ): FuryGatewayChannelInboundEvent;
  size(): number;
  replayEntryCount(): number;
}

export type FuryGatewayChannelAdapterErrorCode =
  | 'invalid-config'
  | 'duplicate-adapter'
  | 'adapter-not-found'
  | 'account-mismatch'
  | 'capability-mismatch'
  | 'invalid-event'
  | 'replay-detected'
  | 'limit-exceeded';

export class FuryGatewayChannelAdapterError extends Error {
  readonly code: FuryGatewayChannelAdapterErrorCode;

  constructor(code: FuryGatewayChannelAdapterErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayChannelAdapterError';
    this.code = code;
  }
}

interface StoredAdapter {
  readonly inspection: FuryGatewayChannelAdapterInspection;
}

const NORMALIZED_EVENT_EVIDENCE = new WeakSet<object>();
const GENERATED_REGISTRIES = new WeakSet<object>();

const CAPABILITY_SET = new Set<string>(FURY_GATEWAY_CHANNEL_CAPABILITIES);
const EVENT_TYPE_SET = new Set<string>(FURY_GATEWAY_CHANNEL_EVENT_TYPES);
const CONVERSATION_KIND_SET = new Set<string>(
  FURY_GATEWAY_CHANNEL_CONVERSATION_KINDS,
);
const ATTACHMENT_CLASS_SET = new Set<string>(
  FURY_GATEWAY_CHANNEL_ATTACHMENT_REFERENCE_CLASSES,
);

const DEFAULT_MAX_ADAPTERS = 64;
const HARD_MAX_ADAPTERS = 1_024;
const DEFAULT_MAX_SEEN_EVENTS = 20_000;
const HARD_MAX_SEEN_EVENTS = 200_000;
const DEFAULT_REPLAY_WINDOW_MS = 24 * 60 * 60_000;
const MIN_REPLAY_WINDOW_MS = 60_000;
const HARD_MAX_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60_000;
const HARD_MAX_FUTURE_SKEW_MS = 60 * 60_000;

const MAX_ADAPTER_ID_BYTES = 128;
const MAX_CHANNEL_KIND_BYTES = 64;
const MAX_OPAQUE_ID_BYTES = 512;
const MAX_POLICY_PROFILE_BYTES = 128;
const MAX_TEXT_BYTES = 32 * 1024;
const MAX_ATTACHMENTS = 16;
const MAX_ATTACHMENT_DECLARED_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_MIME_BYTES = 128;
const MAX_DISPLAY_NAME_BYTES = 256;
const MAX_REACTION_BYTES = 64;

const ADAPTER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CHANNEL_KIND_RE = /^[a-z][a-z0-9._:-]{0,63}$/u;
const POLICY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/u;
const MIME_RE =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}$/u;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function exactPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
  code: FuryGatewayChannelAdapterErrorCode,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayChannelAdapterError(
      code,
      `${label} must be a plain data object`,
    );
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
      throw new FuryGatewayChannelAdapterError(
        code,
        `${label} contains unsupported or unsafe fields`,
      );
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayChannelAdapterError(
        code,
        `${label} is missing required field: ${key}`,
      );
    }
  }
  return record;
}

function dataArrayValues(
  value: unknown,
  label: string,
  maxItems: number,
  code: FuryGatewayChannelAdapterErrorCode,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new FuryGatewayChannelAdapterError(
      code,
      `${label} must contain at most ${maxItems} items`,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new FuryGatewayChannelAdapterError(
      code,
      `${label} contains symbol properties`,
    );
  }
  const own = Object.getOwnPropertyNames(value);
  if (own.some((name) =>
    name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name)
  )) {
    throw new FuryGatewayChannelAdapterError(
      code,
      `${label} contains unsupported array properties`,
    );
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
    ) {
      throw new FuryGatewayChannelAdapterError(
        code,
        `${label} contains sparse, hidden, or accessor entries`,
      );
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
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
    throw new FuryGatewayChannelAdapterError(
      'invalid-config',
      `${label} must be an integer from ${min} to ${max}`,
    );
  }
  return resolved;
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryGatewayChannelAdapterError(
      'invalid-config',
      'channel adapter clock is invalid',
    );
  }
  return value;
}

function boundedText(
  value: unknown,
  label: string,
  maxBytes: number,
  code: FuryGatewayChannelAdapterErrorCode,
): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayChannelAdapterError(
      code,
      `${label} must be bounded printable text`,
    );
  }
  return value;
}

function boundedMessageText(
  value: unknown,
): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayChannelAdapterError(
      'invalid-event',
      'channel message text must be bounded text',
    );
  }
  return value;
}

function opaqueId(
  value: unknown,
  label: string,
): string {
  return boundedText(
    value,
    label,
    MAX_OPAQUE_ID_BYTES,
    'invalid-event',
  );
}

function normalizeCapabilities(
  value: unknown,
): readonly FuryGatewayChannelCapability[] {
  const values = dataArrayValues(
    value,
    'channel adapter capabilities',
    FURY_GATEWAY_CHANNEL_CAPABILITIES.length,
    'invalid-config',
  );
  const output: FuryGatewayChannelCapability[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (
      typeof raw !== 'string'
      || !CAPABILITY_SET.has(raw)
      || seen.has(raw)
    ) {
      throw new FuryGatewayChannelAdapterError(
        'invalid-config',
        'channel adapter capabilities contain an unknown or duplicate value',
      );
    }
    seen.add(raw);
    output.push(raw as FuryGatewayChannelCapability);
  }
  if (output.length === 0) {
    throw new FuryGatewayChannelAdapterError(
      'invalid-config',
      'channel adapter requires at least one capability',
    );
  }
  return Object.freeze([...output].sort((a, b) => a.localeCompare(b)));
}

function normalizeRegistration(
  input: FuryGatewayChannelAdapterRegistrationInput,
): {
  readonly inspection: FuryGatewayChannelAdapterInspection;
  readonly accountDigestSha256: string;
} {
  const record = exactPlainRecord(
    input,
    [
      'format',
      'adapterId',
      'channelKind',
      'accountId',
      'policyProfileId',
      'capabilities',
    ],
    [
      'format',
      'adapterId',
      'channelKind',
      'accountId',
      'policyProfileId',
      'capabilities',
    ],
    'channel adapter registration',
    'invalid-config',
  );
  if (record.format !== FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT) {
    throw new FuryGatewayChannelAdapterError(
      'invalid-config',
      'channel adapter format is unsupported',
    );
  }
  const adapterId = boundedText(
    record.adapterId,
    'adapterId',
    MAX_ADAPTER_ID_BYTES,
    'invalid-config',
  );
  if (!ADAPTER_ID_RE.test(adapterId)) {
    throw new FuryGatewayChannelAdapterError(
      'invalid-config',
      'channel adapter ID is invalid',
    );
  }
  const channelKind = boundedText(
    record.channelKind,
    'channelKind',
    MAX_CHANNEL_KIND_BYTES,
    'invalid-config',
  );
  if (!CHANNEL_KIND_RE.test(channelKind)) {
    throw new FuryGatewayChannelAdapterError(
      'invalid-config',
      'channel kind is invalid',
    );
  }
  const accountId = boundedText(
    record.accountId,
    'accountId',
    MAX_OPAQUE_ID_BYTES,
    'invalid-config',
  );
  const policyProfileId = boundedText(
    record.policyProfileId,
    'policyProfileId',
    MAX_POLICY_PROFILE_BYTES,
    'invalid-config',
  );
  if (!POLICY_ID_RE.test(policyProfileId)) {
    throw new FuryGatewayChannelAdapterError(
      'invalid-config',
      'channel policy profile ID is invalid',
    );
  }
  const capabilities = normalizeCapabilities(record.capabilities);
  const accountDigestSha256 = sha256(accountId);
  return Object.freeze({
    accountDigestSha256,
    inspection: Object.freeze({
      format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
      adapterId,
      channelKind,
      accountDigestSha256,
      policyProfileId,
      capabilities,
      authority: 'channel-config-metadata-only' as const,
      executionAuthority: false as const,
    }),
  });
}

function attachmentDescriptor(
  raw: unknown,
): FuryGatewayChannelAttachmentDescriptor {
  const record = exactPlainRecord(
    raw,
    [
      'attachmentId',
      'referenceClass',
      'declaredMimeType',
      'declaredBytes',
      'displayName',
    ],
    ['attachmentId', 'referenceClass'],
    'channel attachment',
    'invalid-event',
  );
  const attachmentId = opaqueId(record.attachmentId, 'attachmentId');
  if (
    typeof record.referenceClass !== 'string'
    || !ATTACHMENT_CLASS_SET.has(record.referenceClass)
  ) {
    throw new FuryGatewayChannelAdapterError(
      'invalid-event',
      'channel attachment referenceClass is unsupported',
    );
  }
  let declaredMimeType: string | undefined;
  if (record.declaredMimeType !== undefined) {
    declaredMimeType = boundedText(
      record.declaredMimeType,
      'declaredMimeType',
      MAX_MIME_BYTES,
      'invalid-event',
    );
    if (!MIME_RE.test(declaredMimeType)) {
      throw new FuryGatewayChannelAdapterError(
        'invalid-event',
        'channel attachment MIME type is invalid',
      );
    }
  }
  let declaredBytes: number | undefined;
  if (record.declaredBytes !== undefined) {
    if (
      typeof record.declaredBytes !== 'number'
      || !Number.isSafeInteger(record.declaredBytes)
      || record.declaredBytes < 0
      || record.declaredBytes > MAX_ATTACHMENT_DECLARED_BYTES
    ) {
      throw new FuryGatewayChannelAdapterError(
        'invalid-event',
        'channel attachment declaredBytes is invalid',
      );
    }
    declaredBytes = record.declaredBytes;
  }
  const displayName = record.displayName === undefined
    ? undefined
    : boundedText(
        record.displayName,
        'displayName',
        MAX_DISPLAY_NAME_BYTES,
        'invalid-event',
      );
  return Object.freeze({
    attachmentIdSha256: sha256(attachmentId),
    referenceClass:
      record.referenceClass as FuryGatewayChannelAttachmentReferenceClass,
    ...(declaredMimeType === undefined ? {} : { declaredMimeType }),
    ...(declaredBytes === undefined ? {} : { declaredBytes }),
    ...(displayName === undefined ? {} : { displayName }),
  });
}

function normalizeReaction(
  value: unknown,
): FuryGatewayChannelReaction {
  const record = exactPlainRecord(
    value,
    ['targetEventId', 'value'],
    ['targetEventId', 'value'],
    'channel reaction',
    'invalid-event',
  );
  const targetEventId = opaqueId(
    record.targetEventId,
    'reaction targetEventId',
  );
  const reactionValue = boundedText(
    record.value,
    'reaction value',
    MAX_REACTION_BYTES,
    'invalid-event',
  );
  return Object.freeze({
    targetEventIdSha256: sha256(targetEventId),
    value: reactionValue,
  });
}

function eventCapability(
  type: FuryGatewayChannelEventType,
): FuryGatewayChannelCapability {
  if (type === 'reaction-add' || type === 'reaction-remove') {
    return 'inbound-reaction';
  }
  return 'inbound-message';
}

function cloneInspection(
  value: FuryGatewayChannelAdapterInspection,
): FuryGatewayChannelAdapterInspection {
  return Object.freeze({
    ...value,
    capabilities: Object.freeze([...value.capabilities]),
  });
}

export function isGeneratedFuryGatewayChannelInboundEvent(
  value: unknown,
): value is FuryGatewayChannelInboundEvent {
  return typeof value === 'object'
    && value !== null
    && NORMALIZED_EVENT_EVIDENCE.has(value);
}

export function isGeneratedFuryGatewayChannelAdapterRegistry(
  value: unknown,
): value is FuryGatewayChannelAdapterRegistry {
  return typeof value === 'object'
    && value !== null
    && GENERATED_REGISTRIES.has(value);
}

export function createFuryGatewayChannelAdapterRegistry(
  options: FuryGatewayChannelAdapterRegistryOptions = {},
): FuryGatewayChannelAdapterRegistry {
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayChannelAdapterError(
      'invalid-config',
      'channel adapter now must be a function',
    );
  }
  safeNow(now);

  const maxAdapters = boundedInteger(
    options.maxAdapters,
    DEFAULT_MAX_ADAPTERS,
    1,
    HARD_MAX_ADAPTERS,
    'maxAdapters',
  );
  const maxSeenEvents = boundedInteger(
    options.maxSeenEvents,
    DEFAULT_MAX_SEEN_EVENTS,
    1,
    HARD_MAX_SEEN_EVENTS,
    'maxSeenEvents',
  );
  const replayWindowMs = boundedInteger(
    options.replayWindowMs,
    DEFAULT_REPLAY_WINDOW_MS,
    MIN_REPLAY_WINDOW_MS,
    HARD_MAX_REPLAY_WINDOW_MS,
    'replayWindowMs',
  );
  const maxFutureSkewMs = boundedInteger(
    options.maxFutureSkewMs,
    DEFAULT_MAX_FUTURE_SKEW_MS,
    0,
    HARD_MAX_FUTURE_SKEW_MS,
    'maxFutureSkewMs',
  );

  const adapters = new Map<string, StoredAdapter>();
  const seenEvents = new Map<string, number>();

  const gcReplay = (at: number): void => {
    const cutoff = at - replayWindowMs;
    for (const [key, receivedAt] of seenEvents) {
      if (receivedAt <= cutoff) seenEvents.delete(key);
    }
  };

  const api: FuryGatewayChannelAdapterRegistry = Object.freeze({
    register(
      input: FuryGatewayChannelAdapterRegistrationInput,
    ): FuryGatewayChannelAdapterInspection {
      const normalized = normalizeRegistration(input);
      if (adapters.has(normalized.inspection.adapterId)) {
        throw new FuryGatewayChannelAdapterError(
          'duplicate-adapter',
          'channel adapter ID is already registered',
        );
      }
      if (adapters.size >= maxAdapters) {
        throw new FuryGatewayChannelAdapterError(
          'limit-exceeded',
          'channel adapter registry is full',
        );
      }
      adapters.set(
        normalized.inspection.adapterId,
        Object.freeze({ inspection: normalized.inspection }),
      );
      return cloneInspection(normalized.inspection);
    },

    inspect(adapterId: string): FuryGatewayChannelAdapterInspection | undefined {
      if (typeof adapterId !== 'string' || !ADAPTER_ID_RE.test(adapterId)) {
        throw new FuryGatewayChannelAdapterError(
          'invalid-config',
          'channel adapter ID is invalid',
        );
      }
      const stored = adapters.get(adapterId);
      return stored ? cloneInspection(stored.inspection) : undefined;
    },

    list(): readonly FuryGatewayChannelAdapterInspection[] {
      return Object.freeze(
        [...adapters.values()]
          .map((entry) => cloneInspection(entry.inspection))
          .sort((a, b) => a.adapterId.localeCompare(b.adapterId)),
      );
    },

    normalizeInbound(
      adapterId: string,
      input: FuryGatewayChannelInboundInput,
    ): FuryGatewayChannelInboundEvent {
      const receivedAt = safeNow(now);
      gcReplay(receivedAt);

      if (typeof adapterId !== 'string' || !ADAPTER_ID_RE.test(adapterId)) {
        throw new FuryGatewayChannelAdapterError(
          'adapter-not-found',
          'channel adapter is not registered',
        );
      }
      const stored = adapters.get(adapterId);
      if (!stored) {
        throw new FuryGatewayChannelAdapterError(
          'adapter-not-found',
          'channel adapter is not registered',
        );
      }

      const record = exactPlainRecord(
        input,
        [
          'accountId',
          'eventId',
          'senderId',
          'conversationId',
          'conversationKind',
          'threadId',
          'type',
          'text',
          'attachments',
          'replyToEventId',
          'reaction',
          'observedAt',
        ],
        [
          'accountId',
          'eventId',
          'senderId',
          'conversationId',
          'conversationKind',
          'type',
          'observedAt',
        ],
        'channel inbound event',
        'invalid-event',
      );

      const accountId = opaqueId(record.accountId, 'accountId');
      if (sha256(accountId) !== stored.inspection.accountDigestSha256) {
        throw new FuryGatewayChannelAdapterError(
          'account-mismatch',
          'channel inbound event does not match the configured account',
        );
      }

      if (
        typeof record.type !== 'string'
        || !EVENT_TYPE_SET.has(record.type)
      ) {
        throw new FuryGatewayChannelAdapterError(
          'invalid-event',
          'channel inbound event type is unsupported',
        );
      }
      const type = record.type as FuryGatewayChannelEventType;
      const capability = eventCapability(type);
      if (!stored.inspection.capabilities.includes(capability)) {
        throw new FuryGatewayChannelAdapterError(
          'capability-mismatch',
          'channel adapter does not declare the required inbound capability',
        );
      }

      if (
        typeof record.conversationKind !== 'string'
        || !CONVERSATION_KIND_SET.has(record.conversationKind)
      ) {
        throw new FuryGatewayChannelAdapterError(
          'invalid-event',
          'channel conversation kind is unsupported',
        );
      }
      const conversationKind =
        record.conversationKind as FuryGatewayChannelConversationKind;

      if (
        typeof record.observedAt !== 'number'
        || !Number.isSafeInteger(record.observedAt)
        || record.observedAt < 0
        || record.observedAt > receivedAt + maxFutureSkewMs
      ) {
        throw new FuryGatewayChannelAdapterError(
          'invalid-event',
          'channel event observedAt is invalid',
        );
      }

      const eventId = opaqueId(record.eventId, 'eventId');
      const senderId = opaqueId(record.senderId, 'senderId');
      const conversationId = opaqueId(
        record.conversationId,
        'conversationId',
      );
      const threadId = record.threadId === undefined
        ? undefined
        : opaqueId(record.threadId, 'threadId');
      const replyToEventId = record.replyToEventId === undefined
        ? undefined
        : opaqueId(record.replyToEventId, 'replyToEventId');

      let text: string | undefined;
      if (record.text !== undefined) {
        text = boundedMessageText(record.text);
      }

      const rawAttachments = record.attachments === undefined
        ? Object.freeze([])
        : dataArrayValues(
            record.attachments,
            'channel attachments',
            MAX_ATTACHMENTS,
            'invalid-event',
          );
      const attachments = Object.freeze(
        rawAttachments.map((raw) => attachmentDescriptor(raw)),
      );

      let reaction: FuryGatewayChannelReaction | undefined;
      if (type === 'reaction-add' || type === 'reaction-remove') {
        if (record.reaction === undefined) {
          throw new FuryGatewayChannelAdapterError(
            'invalid-event',
            'reaction events require reaction metadata',
          );
        }
        reaction = normalizeReaction(record.reaction);
        if (text !== undefined || attachments.length > 0) {
          throw new FuryGatewayChannelAdapterError(
            'invalid-event',
            'reaction events cannot contain message text or attachments',
          );
        }
      } else if (record.reaction !== undefined) {
        throw new FuryGatewayChannelAdapterError(
          'invalid-event',
          'non-reaction events cannot contain reaction metadata',
        );
      }

      if (
        (type === 'message' || type === 'message-edit')
        && text === undefined
        && attachments.length === 0
      ) {
        throw new FuryGatewayChannelAdapterError(
          'invalid-event',
          'message events require text or attachment metadata',
        );
      }
      if (
        (type === 'message-delete')
        && (
          text !== undefined
          || attachments.length > 0
          || replyToEventId !== undefined
        )
      ) {
        throw new FuryGatewayChannelAdapterError(
          'invalid-event',
          'message-delete events cannot contain message content metadata',
        );
      }

      const eventIdSha256 = sha256(eventId);
      const replayKeySha256 = sha256(JSON.stringify([
        stored.inspection.adapterId,
        stored.inspection.accountDigestSha256,
        eventIdSha256,
        type,
      ]));
      if (seenEvents.has(replayKeySha256)) {
        throw new FuryGatewayChannelAdapterError(
          'replay-detected',
          'channel inbound event was already observed in the replay window',
        );
      }
      if (seenEvents.size >= maxSeenEvents) {
        throw new FuryGatewayChannelAdapterError(
          'limit-exceeded',
          'channel replay registry is full',
        );
      }
      seenEvents.set(replayKeySha256, receivedAt);

      const event = Object.freeze({
        format: FURY_GATEWAY_CHANNEL_EVENT_FORMAT,
        adapterId: stored.inspection.adapterId,
        channelKind: stored.inspection.channelKind,
        accountDigestSha256: stored.inspection.accountDigestSha256,
        eventIdSha256,
        replayKeySha256,
        senderDigestSha256: sha256(senderId),
        conversationDigestSha256: sha256(conversationId),
        conversationKind,
        ...(threadId === undefined
          ? {}
          : { threadDigestSha256: sha256(threadId) }),
        type,
        ...(text === undefined ? {} : { text }),
        attachments,
        ...(replyToEventId === undefined
          ? {}
          : { replyToEventIdSha256: sha256(replyToEventId) }),
        ...(reaction === undefined ? {} : { reaction }),
        observedAt: record.observedAt,
        receivedAt,
        transportAuthentication: 'not-proven' as const,
        principalMapped: false as const,
        sessionIssued: false as const,
        authority: 'transport-data-only' as const,
        executionAuthority: false as const,
      });
      NORMALIZED_EVENT_EVIDENCE.add(event);
      return event;
    },

    size(): number {
      return adapters.size;
    },

    replayEntryCount(): number {
      gcReplay(safeNow(now));
      return seenEvents.size;
    },
  });

  GENERATED_REGISTRIES.add(api);
  return api;
}
