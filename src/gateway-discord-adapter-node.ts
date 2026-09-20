import { createHash, randomBytes } from 'node:crypto';

import {
  isGeneratedFuryGatewayChannelAdapterRegistry,
  type FuryGatewayChannelAdapterRegistry,
  type FuryGatewayChannelAttachmentInput,
  type FuryGatewayChannelEventType,
  type FuryGatewayChannelInboundEvent,
} from './gateway-channel-adapter-node.js';
import {
  isGeneratedFuryGatewayChannelDeliveryCoordinator,
  type FuryGatewayChannelDeliveryCoordinator,
  type FuryGatewayChannelDeliveryPermit,
} from './gateway-channel-delivery-node.js';

export const FURY_GATEWAY_DISCORD_SERVICE_AUTH_FORMAT =
  'furypipe-gateway-discord-service-auth/v1' as const;
export const FURY_GATEWAY_DISCORD_EVENT_FORMAT =
  'furypipe-gateway-discord-event/v1' as const;

export const FURY_GATEWAY_DISCORD_AUTH_METHODS = Object.freeze([
  'gateway-session',
  'interaction-signature',
] as const);

export const FURY_GATEWAY_DISCORD_SCOPES = Object.freeze([
  'dm',
  'guild',
] as const);

export type FuryGatewayDiscordAuthenticationMethod =
  (typeof FURY_GATEWAY_DISCORD_AUTH_METHODS)[number];
export type FuryGatewayDiscordScope =
  (typeof FURY_GATEWAY_DISCORD_SCOPES)[number];

export interface FuryGatewayDiscordServiceAuthenticationInput {
  /**
   * Trusted-host boundary only. The host must already have authenticated the
   * Discord bot/service session or verified the interaction signature before
   * calling this method. Raw bot tokens, signatures, authorization headers and
   * request bodies are intentionally not accepted by this API.
   */
  readonly method: FuryGatewayDiscordAuthenticationMethod;
  readonly authenticatedAccountId: string;
  readonly expiresInMs?: number;
}

export interface FuryGatewayDiscordServiceAuthentication {
  readonly format: typeof FURY_GATEWAY_DISCORD_SERVICE_AUTH_FORMAT;
  readonly authenticationId: string;
  readonly adapterId: string;
  readonly accountDigestSha256: string;
  readonly method: FuryGatewayDiscordAuthenticationMethod;
  readonly authenticatedAt: number;
  readonly expiresAt: number;
  readonly serviceAuthenticated: true;
  readonly senderAuthenticated: false;
  readonly authority: 'discord-service-authentication-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayDiscordAttachmentInput {
  readonly id: string;
  readonly mediaType?: string;
  readonly size?: number;
  readonly filename?: string;
}

export interface FuryGatewayDiscordReactionInput {
  readonly messageId: string;
  readonly emoji: string;
}

export interface FuryGatewayDiscordInboundInput {
  readonly eventId: string;
  readonly senderId: string;
  readonly channelId: string;
  readonly scope: FuryGatewayDiscordScope;
  readonly guildId?: string;
  readonly threadId?: string;
  readonly type: FuryGatewayChannelEventType;
  readonly content?: string;
  readonly attachments?: readonly FuryGatewayDiscordAttachmentInput[];
  readonly replyToMessageId?: string;
  readonly reaction?: FuryGatewayDiscordReactionInput;
  readonly observedAt: number;
}

export interface FuryGatewayDiscordInboundEvent {
  readonly format: typeof FURY_GATEWAY_DISCORD_EVENT_FORMAT;
  readonly adapterId: string;
  readonly accountDigestSha256: string;
  readonly authenticationIdSha256: string;
  readonly authenticationMethod: FuryGatewayDiscordAuthenticationMethod;
  readonly scope: FuryGatewayDiscordScope;
  readonly guildDigestSha256?: string;
  readonly channelEvent: FuryGatewayChannelInboundEvent;
  readonly serviceAuthenticated: true;
  readonly senderAuthenticated: false;
  readonly principalMapped: false;
  readonly authority: 'discord-transport-data-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayDiscordOutboundInput {
  readonly scope: FuryGatewayDiscordScope;
  readonly channelId: string;
  readonly guildId?: string;
  readonly threadId?: string;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly expiresInMs?: number;
}

export interface FuryGatewayDiscordAdapterOptions {
  readonly channelRegistry: FuryGatewayChannelAdapterRegistry;
  readonly deliveryCoordinator: FuryGatewayChannelDeliveryCoordinator;
  readonly adapterId: string;
  readonly accountId: string;
  readonly now?: () => number;
  readonly defaultAuthenticationTtlMs?: number;
  readonly maxAuthenticationTtlMs?: number;
  readonly maxAuthentications?: number;
}

export interface FuryGatewayDiscordAdapter {
  recordAuthenticatedService(
    input: FuryGatewayDiscordServiceAuthenticationInput,
  ): FuryGatewayDiscordServiceAuthentication;
  revokeAuthentication(authenticationId: string): boolean;
  isCurrentAuthentication(
    authentication: FuryGatewayDiscordServiceAuthentication,
  ): boolean;
  normalizeInbound(
    authentication: FuryGatewayDiscordServiceAuthentication,
    input: FuryGatewayDiscordInboundInput,
  ): FuryGatewayDiscordInboundEvent;
  prepareOutboundDelivery(
    authentication: FuryGatewayDiscordServiceAuthentication,
    input: FuryGatewayDiscordOutboundInput,
  ): FuryGatewayChannelDeliveryPermit;
  activeAuthenticationCount(): number;
}

export type FuryGatewayDiscordAdapterErrorCode =
  | 'invalid-config'
  | 'invalid-authentication'
  | 'authentication-expired'
  | 'account-mismatch'
  | 'invalid-event'
  | 'invalid-target'
  | 'invalid-delivery-permit'
  | 'limit-exceeded';

export class FuryGatewayDiscordAdapterError extends Error {
  readonly code: FuryGatewayDiscordAdapterErrorCode;

  constructor(code: FuryGatewayDiscordAdapterErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayDiscordAdapterError';
    this.code = code;
  }
}

interface AuthenticationState {
  readonly authentication: FuryGatewayDiscordServiceAuthentication;
  revoked: boolean;
}

const AUTHENTICATION_EVIDENCE = new WeakSet<object>();
const DISCORD_EVENT_EVIDENCE = new WeakSet<object>();
const GENERATED_ADAPTERS = new WeakSet<object>();

const AUTH_METHOD_SET = new Set<string>(FURY_GATEWAY_DISCORD_AUTH_METHODS);
const SCOPE_SET = new Set<string>(FURY_GATEWAY_DISCORD_SCOPES);

const ADAPTER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const AUTHENTICATION_ID_RE = /^[A-Za-z0-9_-]{32}$/u;
const DEFAULT_AUTH_TTL_MS = 5 * 60_000;
const MIN_AUTH_TTL_MS = 5_000;
const HARD_MAX_AUTH_TTL_MS = 30 * 60_000;
const DEFAULT_MAX_AUTHENTICATIONS = 4_096;
const HARD_MAX_AUTHENTICATIONS = 100_000;
const MAX_OPAQUE_ID_BYTES = 512;
const MAX_TEXT_BYTES = 32 * 1024;
const MAX_ATTACHMENTS = 16;
const MAX_MIME_BYTES = 128;
const MAX_FILENAME_BYTES = 256;
const MAX_EMOJI_BYTES = 128;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024 * 1024;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function exactPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
  code: FuryGatewayDiscordAdapterErrorCode,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayDiscordAdapterError(
      code,
      label + ' must be a plain data object',
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
      throw new FuryGatewayDiscordAdapterError(
        code,
        label + ' contains unsupported or unsafe fields',
      );
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayDiscordAdapterError(
        code,
        label + ' is missing required field: ' + key,
      );
    }
  }
  return record;
}

function dataArrayValues(
  value: unknown,
  label: string,
  maxItems: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new FuryGatewayDiscordAdapterError(
      'invalid-event',
      label + ' must contain at most ' + maxItems + ' entries',
    );
  }
  if (
    Object.getPrototypeOf(value) !== Array.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayDiscordAdapterError(
      'invalid-event',
      label + ' must be a plain data array',
    );
  }
  const own = Object.getOwnPropertyNames(value);
  if (own.some((name) => name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name))) {
    throw new FuryGatewayDiscordAdapterError(
      'invalid-event',
      label + ' contains unsupported array properties',
    );
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryGatewayDiscordAdapterError(
        'invalid-event',
        label + ' contains sparse, hidden, or accessor entries',
      );
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryGatewayDiscordAdapterError(
      'invalid-config',
      'Discord adapter clock must return a safe non-negative timestamp',
    );
  }
  return value;
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
    throw new FuryGatewayDiscordAdapterError(
      'invalid-config',
      label + ' must be an integer from ' + min + ' to ' + max,
    );
  }
  return resolved;
}

function boundedPrintable(
  value: unknown,
  label: string,
  maxBytes: number,
  code: FuryGatewayDiscordAdapterErrorCode,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayDiscordAdapterError(
      code,
      label + ' must be bounded printable text',
    );
  }
  return value;
}

function boundedText(
  value: unknown,
  label: string,
  maxBytes: number,
  code: FuryGatewayDiscordAdapterErrorCode,
): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new FuryGatewayDiscordAdapterError(
      code,
      label + ' must be bounded text',
    );
  }
  return value;
}

function normalizeDiscordScope(
  scope: unknown,
  guildId: unknown,
  threadId: unknown,
  code: FuryGatewayDiscordAdapterErrorCode,
): {
  readonly scope: FuryGatewayDiscordScope;
  readonly guildId?: string;
  readonly threadId?: string;
} {
  if (typeof scope !== 'string' || !SCOPE_SET.has(scope)) {
    throw new FuryGatewayDiscordAdapterError(code, 'Discord scope is unsupported');
  }
  if (scope === 'dm') {
    if (guildId !== undefined || threadId !== undefined) {
      throw new FuryGatewayDiscordAdapterError(
        code,
        'Discord DM events/targets cannot claim guild or thread context',
      );
    }
    return Object.freeze({ scope: 'dm' as const });
  }
  const normalizedGuildId = boundedPrintable(
    guildId,
    'guildId',
    MAX_OPAQUE_ID_BYTES,
    code,
  );
  const normalizedThreadId = threadId === undefined
    ? undefined
    : boundedPrintable(
        threadId,
        'threadId',
        MAX_OPAQUE_ID_BYTES,
        code,
      );
  return Object.freeze({
    scope: 'guild' as const,
    guildId: normalizedGuildId,
    ...(normalizedThreadId === undefined ? {} : { threadId: normalizedThreadId }),
  });
}

function normalizeAttachments(
  value: unknown,
): readonly FuryGatewayChannelAttachmentInput[] {
  if (value === undefined) return Object.freeze([]);
  const raw = dataArrayValues(value, 'Discord attachments', MAX_ATTACHMENTS);
  const output: FuryGatewayChannelAttachmentInput[] = [];
  for (const item of raw) {
    const record = exactPlainRecord(
      item,
      ['id', 'mediaType', 'size', 'filename'],
      ['id'],
      'Discord attachment',
      'invalid-event',
    );
    const id = boundedPrintable(
      record.id,
      'Discord attachment id',
      MAX_OPAQUE_ID_BYTES,
      'invalid-event',
    );
    const mediaType = record.mediaType === undefined
      ? undefined
      : boundedPrintable(
          record.mediaType,
          'Discord attachment mediaType',
          MAX_MIME_BYTES,
          'invalid-event',
        );
    const filename = record.filename === undefined
      ? undefined
      : boundedPrintable(
          record.filename,
          'Discord attachment filename',
          MAX_FILENAME_BYTES,
          'invalid-event',
        );
    let size: number | undefined;
    if (record.size !== undefined) {
      if (
        !Number.isSafeInteger(record.size)
        || (record.size as number) < 0
        || (record.size as number) > MAX_ATTACHMENT_BYTES
      ) {
        throw new FuryGatewayDiscordAdapterError(
          'invalid-event',
          'Discord attachment size is invalid',
        );
      }
      size = record.size as number;
    }
    output.push(Object.freeze({
      attachmentId: id,
      referenceClass: 'provider-object' as const,
      ...(mediaType === undefined ? {} : { declaredMimeType: mediaType }),
      ...(size === undefined ? {} : { declaredBytes: size }),
      ...(filename === undefined ? {} : { displayName: filename }),
    }));
  }
  return Object.freeze(output);
}

function normalizeReaction(
  value: unknown,
): { readonly targetEventId: string; readonly value: string } | undefined {
  if (value === undefined) return undefined;
  const record = exactPlainRecord(
    value,
    ['messageId', 'emoji'],
    ['messageId', 'emoji'],
    'Discord reaction',
    'invalid-event',
  );
  return Object.freeze({
    targetEventId: boundedPrintable(
      record.messageId,
      'Discord reaction messageId',
      MAX_OPAQUE_ID_BYTES,
      'invalid-event',
    ),
    value: boundedPrintable(
      record.emoji,
      'Discord reaction emoji',
      MAX_EMOJI_BYTES,
      'invalid-event',
    ),
  });
}

export function isGeneratedFuryGatewayDiscordServiceAuthentication(
  value: unknown,
): value is FuryGatewayDiscordServiceAuthentication {
  return typeof value === 'object'
    && value !== null
    && AUTHENTICATION_EVIDENCE.has(value);
}

export function isGeneratedFuryGatewayDiscordInboundEvent(
  value: unknown,
): value is FuryGatewayDiscordInboundEvent {
  return typeof value === 'object'
    && value !== null
    && DISCORD_EVENT_EVIDENCE.has(value);
}

export function isGeneratedFuryGatewayDiscordAdapter(
  value: unknown,
): value is FuryGatewayDiscordAdapter {
  return typeof value === 'object'
    && value !== null
    && GENERATED_ADAPTERS.has(value);
}

export function createFuryGatewayDiscordAdapter(
  options: FuryGatewayDiscordAdapterOptions,
): FuryGatewayDiscordAdapter {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayChannelAdapterRegistry(options.channelRegistry)
    || !isGeneratedFuryGatewayChannelDeliveryCoordinator(options.deliveryCoordinator)
  ) {
    throw new FuryGatewayDiscordAdapterError(
      'invalid-config',
      'Discord adapter requires process-local channel registry and delivery coordinator',
    );
  }
  if (
    typeof options.adapterId !== 'string'
    || !ADAPTER_ID_RE.test(options.adapterId)
  ) {
    throw new FuryGatewayDiscordAdapterError(
      'invalid-config',
      'Discord adapter ID is invalid',
    );
  }
  const accountId = boundedPrintable(
    options.accountId,
    'Discord accountId',
    MAX_OPAQUE_ID_BYTES,
    'invalid-config',
  );
  const configured = options.channelRegistry.inspect(options.adapterId);
  if (
    !configured
    || configured.channelKind !== 'discord'
    || configured.accountDigestSha256 !== sha256(accountId)
  ) {
    throw new FuryGatewayDiscordAdapterError(
      'invalid-config',
      'Discord adapter configuration does not match the registered channel adapter identity',
    );
  }

  const channelRegistry = options.channelRegistry;
  const deliveryCoordinator = options.deliveryCoordinator;
  const adapterId = options.adapterId;
  const accountDigestSha256 = configured.accountDigestSha256;
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayDiscordAdapterError(
      'invalid-config',
      'Discord adapter now must be a function',
    );
  }
  safeNow(now);

  const defaultAuthenticationTtlMs = boundedInteger(
    options.defaultAuthenticationTtlMs,
    DEFAULT_AUTH_TTL_MS,
    MIN_AUTH_TTL_MS,
    HARD_MAX_AUTH_TTL_MS,
    'defaultAuthenticationTtlMs',
  );
  const maxAuthenticationTtlMs = boundedInteger(
    options.maxAuthenticationTtlMs,
    HARD_MAX_AUTH_TTL_MS,
    MIN_AUTH_TTL_MS,
    HARD_MAX_AUTH_TTL_MS,
    'maxAuthenticationTtlMs',
  );
  if (defaultAuthenticationTtlMs > maxAuthenticationTtlMs) {
    throw new FuryGatewayDiscordAdapterError(
      'invalid-config',
      'defaultAuthenticationTtlMs must not exceed maxAuthenticationTtlMs',
    );
  }
  const maxAuthentications = boundedInteger(
    options.maxAuthentications,
    DEFAULT_MAX_AUTHENTICATIONS,
    1,
    HARD_MAX_AUTHENTICATIONS,
    'maxAuthentications',
  );

  const authentications = new Map<string, AuthenticationState>();

  const gcAuthentications = (at: number): void => {
    for (const [authenticationId, state] of authentications) {
      if (state.revoked || at >= state.authentication.expiresAt) {
        authentications.delete(authenticationId);
      }
    }
  };

  const resolveAuthentication = (
    authentication: FuryGatewayDiscordServiceAuthentication,
  ): AuthenticationState => {
    if (!isGeneratedFuryGatewayDiscordServiceAuthentication(authentication)) {
      throw new FuryGatewayDiscordAdapterError(
        'invalid-authentication',
        'Discord service authentication must be process-local FuryPipe evidence',
      );
    }
    const state = authentications.get(authentication.authenticationId);
    if (!state || state.authentication !== authentication) {
      throw new FuryGatewayDiscordAdapterError(
        'invalid-authentication',
        'Discord service authentication is not owned by this adapter',
      );
    }
    return state;
  };

  const assertCurrentAuthentication = (
    authentication: FuryGatewayDiscordServiceAuthentication,
  ): AuthenticationState => {
    const state = resolveAuthentication(authentication);
    const at = safeNow(now);
    if (state.revoked || at >= authentication.expiresAt) {
      throw new FuryGatewayDiscordAdapterError(
        'authentication-expired',
        'Discord service authentication is revoked or expired',
      );
    }
    if (
      authentication.adapterId !== adapterId
      || authentication.accountDigestSha256 !== accountDigestSha256
    ) {
      throw new FuryGatewayDiscordAdapterError(
        'account-mismatch',
        'Discord service authentication does not match adapter identity',
      );
    }
    return state;
  };

  const api: FuryGatewayDiscordAdapter = Object.freeze({
    recordAuthenticatedService(
      input: FuryGatewayDiscordServiceAuthenticationInput,
    ): FuryGatewayDiscordServiceAuthentication {
      const authenticatedAt = safeNow(now);
      gcAuthentications(authenticatedAt);
      const record = exactPlainRecord(
        input,
        ['method', 'authenticatedAccountId', 'expiresInMs'],
        ['method', 'authenticatedAccountId'],
        'Discord service authentication input',
        'invalid-authentication',
      );
      if (
        typeof record.method !== 'string'
        || !AUTH_METHOD_SET.has(record.method)
      ) {
        throw new FuryGatewayDiscordAdapterError(
          'invalid-authentication',
          'Discord service authentication method is unsupported',
        );
      }
      const authenticatedAccountId = boundedPrintable(
        record.authenticatedAccountId,
        'authenticatedAccountId',
        MAX_OPAQUE_ID_BYTES,
        'invalid-authentication',
      );
      if (sha256(authenticatedAccountId) !== accountDigestSha256) {
        throw new FuryGatewayDiscordAdapterError(
          'account-mismatch',
          'Discord authenticated account does not match configured adapter',
        );
      }
      if (authentications.size >= maxAuthentications) {
        throw new FuryGatewayDiscordAdapterError(
          'limit-exceeded',
          'Discord authentication registry is full',
        );
      }
      const ttlMs = boundedInteger(
        record.expiresInMs as number | undefined,
        defaultAuthenticationTtlMs,
        MIN_AUTH_TTL_MS,
        maxAuthenticationTtlMs,
        'expiresInMs',
      );
      const expiresAt = authenticatedAt + ttlMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new FuryGatewayDiscordAdapterError(
          'invalid-authentication',
          'Discord authentication expiry must be a safe integer',
        );
      }

      let authenticationId: string;
      do {
        authenticationId = randomBytes(24).toString('base64url');
      } while (authentications.has(authenticationId));
      if (!AUTHENTICATION_ID_RE.test(authenticationId)) {
        throw new FuryGatewayDiscordAdapterError(
          'invalid-authentication',
          'generated Discord authentication ID is invalid',
        );
      }

      const authentication = Object.freeze({
        format: FURY_GATEWAY_DISCORD_SERVICE_AUTH_FORMAT,
        authenticationId,
        adapterId,
        accountDigestSha256,
        method: record.method as FuryGatewayDiscordAuthenticationMethod,
        authenticatedAt,
        expiresAt,
        serviceAuthenticated: true as const,
        senderAuthenticated: false as const,
        authority: 'discord-service-authentication-only' as const,
        executionAuthority: false as const,
      });
      AUTHENTICATION_EVIDENCE.add(authentication);
      authentications.set(authenticationId, {
        authentication,
        revoked: false,
      });
      return authentication;
    },

    revokeAuthentication(authenticationId: string): boolean {
      if (
        typeof authenticationId !== 'string'
        || !AUTHENTICATION_ID_RE.test(authenticationId)
      ) {
        throw new FuryGatewayDiscordAdapterError(
          'invalid-authentication',
          'Discord authentication ID is invalid',
        );
      }
      const state = authentications.get(authenticationId);
      if (!state || state.revoked) return false;
      state.revoked = true;
      return true;
    },

    isCurrentAuthentication(
      authentication: FuryGatewayDiscordServiceAuthentication,
    ): boolean {
      try {
        assertCurrentAuthentication(authentication);
        return true;
      } catch {
        return false;
      }
    },

    normalizeInbound(
      authentication: FuryGatewayDiscordServiceAuthentication,
      input: FuryGatewayDiscordInboundInput,
    ): FuryGatewayDiscordInboundEvent {
      assertCurrentAuthentication(authentication);
      const record = exactPlainRecord(
        input,
        [
          'eventId',
          'senderId',
          'channelId',
          'scope',
          'guildId',
          'threadId',
          'type',
          'content',
          'attachments',
          'replyToMessageId',
          'reaction',
          'observedAt',
        ],
        [
          'eventId',
          'senderId',
          'channelId',
          'scope',
          'type',
          'observedAt',
        ],
        'Discord inbound event',
        'invalid-event',
      );
      const eventId = boundedPrintable(
        record.eventId,
        'Discord eventId',
        MAX_OPAQUE_ID_BYTES,
        'invalid-event',
      );
      const senderId = boundedPrintable(
        record.senderId,
        'Discord senderId',
        MAX_OPAQUE_ID_BYTES,
        'invalid-event',
      );
      const channelId = boundedPrintable(
        record.channelId,
        'Discord channelId',
        MAX_OPAQUE_ID_BYTES,
        'invalid-event',
      );
      const scope = normalizeDiscordScope(
        record.scope,
        record.guildId,
        record.threadId,
        'invalid-event',
      );
      const attachments = normalizeAttachments(record.attachments);
      const content = record.content === undefined
        ? undefined
        : boundedText(
            record.content,
            'Discord content',
            MAX_TEXT_BYTES,
            'invalid-event',
          );
      const replyToMessageId = record.replyToMessageId === undefined
        ? undefined
        : boundedPrintable(
            record.replyToMessageId,
            'Discord replyToMessageId',
            MAX_OPAQUE_ID_BYTES,
            'invalid-event',
          );
      const reaction = normalizeReaction(record.reaction);

      const channelEvent = channelRegistry.normalizeInbound(adapterId, {
        accountId,
        eventId,
        senderId,
        conversationId: channelId,
        conversationKind: scope.scope === 'dm' ? 'direct' : 'channel',
        ...(scope.threadId === undefined ? {} : { threadId: scope.threadId }),
        type: record.type as FuryGatewayChannelEventType,
        ...(content === undefined ? {} : { text: content }),
        ...(attachments.length === 0 ? {} : { attachments }),
        ...(replyToMessageId === undefined ? {} : { replyToEventId: replyToMessageId }),
        ...(reaction === undefined ? {} : { reaction }),
        observedAt: record.observedAt as number,
      });

      const event = Object.freeze({
        format: FURY_GATEWAY_DISCORD_EVENT_FORMAT,
        adapterId,
        accountDigestSha256,
        authenticationIdSha256: sha256(authentication.authenticationId),
        authenticationMethod: authentication.method,
        scope: scope.scope,
        ...(scope.guildId === undefined
          ? {}
          : { guildDigestSha256: sha256(scope.guildId) }),
        channelEvent,
        serviceAuthenticated: true as const,
        senderAuthenticated: false as const,
        principalMapped: false as const,
        authority: 'discord-transport-data-only' as const,
        executionAuthority: false as const,
      });
      DISCORD_EVENT_EVIDENCE.add(event);
      return event;
    },

    prepareOutboundDelivery(
      authentication: FuryGatewayDiscordServiceAuthentication,
      input: FuryGatewayDiscordOutboundInput,
    ): FuryGatewayChannelDeliveryPermit {
      assertCurrentAuthentication(authentication);
      const record = exactPlainRecord(
        input,
        [
          'scope',
          'channelId',
          'guildId',
          'threadId',
          'text',
          'idempotencyKey',
          'expiresInMs',
        ],
        ['scope', 'channelId', 'text', 'idempotencyKey'],
        'Discord outbound delivery input',
        'invalid-target',
      );
      const channelId = boundedPrintable(
        record.channelId,
        'Discord channelId',
        MAX_OPAQUE_ID_BYTES,
        'invalid-target',
      );
      const scope = normalizeDiscordScope(
        record.scope,
        record.guildId,
        record.threadId,
        'invalid-target',
      );
      const text = boundedText(
        record.text,
        'Discord outbound text',
        MAX_TEXT_BYTES,
        'invalid-target',
      );
      const idempotencyKey = boundedPrintable(
        record.idempotencyKey,
        'Discord idempotencyKey',
        256,
        'invalid-target',
      );
      const permit = deliveryCoordinator.prepareDelivery({
        adapterId,
        destinationId: channelId,
        ...(scope.threadId === undefined ? {} : { threadId: scope.threadId }),
        text,
        idempotencyKey,
        ...(record.expiresInMs === undefined
          ? {}
          : { expiresInMs: record.expiresInMs as number }),
      });
      if (
        permit.adapterId !== adapterId
        || permit.accountDigestSha256 !== accountDigestSha256
        || permit.destinationDigestSha256 !== sha256(channelId)
        || permit.threadDigestSha256 !== (
          scope.threadId === undefined ? undefined : sha256(scope.threadId)
        )
      ) {
        throw new FuryGatewayDiscordAdapterError(
          'invalid-delivery-permit',
          'Discord outbound mapping did not produce a permit for the exact adapter target',
        );
      }
      return permit;
    },

    activeAuthenticationCount(): number {
      const at = safeNow(now);
      gcAuthentications(at);
      return authentications.size;
    },
  });

  GENERATED_ADAPTERS.add(api);
  return api;
}
