import { describe, expect, it } from 'vitest';

import {
  createFuryGatewayChannelAdapterRegistry,
  FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
  FURY_GATEWAY_CHANNEL_EVENT_FORMAT,
  FuryGatewayChannelAdapterError,
  isGeneratedFuryGatewayChannelAdapterRegistry,
  isGeneratedFuryGatewayChannelInboundEvent,
} from '../src/gateway-channel-adapter-node.js';

function registration(overrides: Record<string, unknown> = {}) {
  return {
    format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
    adapterId: 'discord-main',
    channelKind: 'discord',
    accountId: 'discord-bot-account-CANARY',
    policyProfileId: 'discord-default',
    capabilities: [
      'inbound-message',
      'inbound-reaction',
      'outbound-message',
    ],
    ...overrides,
  };
}

function inbound(overrides: Record<string, unknown> = {}) {
  return {
    accountId: 'discord-bot-account-CANARY',
    eventId: 'message-1001-CANARY',
    senderId: 'external-sender-42-CANARY',
    conversationId: 'guild-channel-777-CANARY',
    conversationKind: 'channel',
    type: 'message',
    text: 'Hello from Discord.\nSecond line\twith tab.',
    attachments: [{
      attachmentId: 'attachment-provider-id-CANARY',
      referenceClass: 'remote-resource',
      declaredMimeType: 'image/png',
      declaredBytes: 12_345,
      displayName: 'screenshot.png',
    }],
    observedAt: 1_000,
    ...overrides,
  };
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof FuryGatewayChannelAdapterError) return error.code;
    throw error;
  }
  return undefined;
}

describe('Gateway Channel Adapter V1 ingress registry', () => {
  it('registers bounded metadata while hashing the raw channel account identity', () => {
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => 2_000,
    });
    const inspection = registry.register(registration() as never);

    expect(isGeneratedFuryGatewayChannelAdapterRegistry(registry)).toBe(true);
    expect(inspection).toMatchObject({
      format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
      adapterId: 'discord-main',
      channelKind: 'discord',
      policyProfileId: 'discord-default',
      capabilities: [
        'inbound-message',
        'inbound-reaction',
        'outbound-message',
      ],
      authority: 'channel-config-metadata-only',
      executionAuthority: false,
    });
    expect(inspection.accountDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(inspection)).toBe(true);
    expect(Object.isFrozen(inspection.capabilities)).toBe(true);

    const serialized = JSON.stringify(inspection);
    expect(serialized).not.toContain('discord-bot-account-CANARY');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('executionAuthority":true');
  });

  it('normalizes one inbound message as transport data only and redacts external identities', () => {
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => 2_000,
    });
    registry.register(registration() as never);

    const event = registry.normalizeInbound(
      'discord-main',
      inbound() as never,
    );

    expect(isGeneratedFuryGatewayChannelInboundEvent(event)).toBe(true);
    expect(event).toMatchObject({
      format: FURY_GATEWAY_CHANNEL_EVENT_FORMAT,
      adapterId: 'discord-main',
      channelKind: 'discord',
      conversationKind: 'channel',
      type: 'message',
      text: 'Hello from Discord.\nSecond line\twith tab.',
      observedAt: 1_000,
      receivedAt: 2_000,
      transportAuthentication: 'not-proven',
      principalMapped: false,
      sessionIssued: false,
      authority: 'transport-data-only',
      executionAuthority: false,
      attachments: [{
        referenceClass: 'remote-resource',
        declaredMimeType: 'image/png',
        declaredBytes: 12_345,
        displayName: 'screenshot.png',
      }],
    });

    for (const digest of [
      event.accountDigestSha256,
      event.eventIdSha256,
      event.replayKeySha256,
      event.senderDigestSha256,
      event.conversationDigestSha256,
      event.attachments[0]?.attachmentIdSha256,
    ]) {
      expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    }

    const serialized = JSON.stringify(event);
    for (const raw of [
      'discord-bot-account-CANARY',
      'message-1001-CANARY',
      'external-sender-42-CANARY',
      'guild-channel-777-CANARY',
      'attachment-provider-id-CANARY',
    ]) {
      expect(serialized).not.toContain(raw);
    }
    expect(serialized).not.toContain('executionAuthority":true');
  });

  it('keeps thread/reply/reaction identities hashed and reaction events content-free', () => {
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => 2_000,
    });
    registry.register(registration() as never);

    const event = registry.normalizeInbound('discord-main', inbound({
      eventId: 'reaction-event-CANARY',
      conversationKind: 'group',
      threadId: 'thread-raw-CANARY',
      type: 'reaction-add',
      text: undefined,
      attachments: undefined,
      replyToEventId: 'reply-target-CANARY',
      reaction: {
        targetEventId: 'reaction-target-CANARY',
        value: '👍',
      },
    }) as never);

    expect(event).toMatchObject({
      conversationKind: 'group',
      type: 'reaction-add',
      reaction: {
        value: '👍',
      },
      attachments: [],
      executionAuthority: false,
    });
    expect(event.threadDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(event.replyToEventIdSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(event.reaction?.targetEventIdSha256).toMatch(/^[a-f0-9]{64}$/u);

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('thread-raw-CANARY');
    expect(serialized).not.toContain('reply-target-CANARY');
    expect(serialized).not.toContain('reaction-target-CANARY');
  });

  it('rejects unknown fields, custom prototypes, symbols and accessor-backed config/event data', () => {
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => 2_000,
    });

    expect(() => registry.register({
      ...registration(),
      execute: () => undefined,
    } as never)).toThrow(/unsupported or unsafe fields/u);

    const custom = Object.assign(
      Object.create({ inherited: true }),
      registration(),
    );
    expect(() => registry.register(custom as never))
      .toThrow(/plain data object/u);

    const symbolic = registration() as Record<PropertyKey, unknown>;
    symbolic[Symbol('hidden')] = 'secret';
    expect(() => registry.register(symbolic as never))
      .toThrow(/plain data object/u);

    const accessor = registration() as Record<string, unknown>;
    Object.defineProperty(accessor, 'accountId', {
      enumerable: true,
      get() {
        throw new Error('ACCOUNT_GETTER_MUST_NOT_RUN');
      },
    });
    expect(() => registry.register(accessor as never))
      .toThrow(/unsupported or unsafe fields/u);

    registry.register(registration() as never);
    expect(() => registry.normalizeInbound('discord-main', {
      ...inbound(),
      unexpected: true,
    } as never)).toThrow(/unsupported or unsafe fields/u);
  });

  it('rejects sparse/accessor attachment arrays and never accepts a URL/fetch callback in attachment descriptors', () => {
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => 2_000,
    });
    registry.register(registration() as never);

    const sparse = new Array(1);
    expect(() => registry.normalizeInbound('discord-main', inbound({
      attachments: sparse,
    }) as never)).toThrow(/sparse, hidden, or accessor entries/u);

    const accessor = [{
      attachmentId: 'attachment-1',
      referenceClass: 'provider-object',
    }] as unknown[];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        throw new Error('ATTACHMENT_GETTER_MUST_NOT_RUN');
      },
    });
    expect(() => registry.normalizeInbound('discord-main', inbound({
      attachments: accessor,
    }) as never)).toThrow(/accessor entries/u);

    expect(() => registry.normalizeInbound('discord-main', inbound({
      attachments: [{
        attachmentId: 'attachment-2',
        referenceClass: 'remote-resource',
        url: 'https://example.invalid/private',
      }],
    }) as never)).toThrow(/unsupported or unsafe fields/u);

    expect(() => registry.normalizeInbound('discord-main', inbound({
      attachments: [{
        attachmentId: 'attachment-3',
        referenceClass: 'remote-resource',
        fetch: () => undefined,
      }],
    }) as never)).toThrow(/unsupported or unsafe fields/u);
  });

  it('detects replay within the window and permits the same transport event only after replay evidence expires', () => {
    let now = 2_000;
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => now,
      replayWindowMs: 60_000,
    });
    registry.register(registration() as never);

    const first = registry.normalizeInbound(
      'discord-main',
      inbound() as never,
    );
    expect(first.receivedAt).toBe(2_000);
    expect(registry.replayEntryCount()).toBe(1);

    expect(() => registry.normalizeInbound(
      'discord-main',
      inbound() as never,
    )).toThrow(/already observed/u);

    now = 62_001;
    const replayAfterExpiry = registry.normalizeInbound(
      'discord-main',
      inbound() as never,
    );
    expect(replayAfterExpiry.receivedAt).toBe(62_001);
    expect(registry.replayEntryCount()).toBe(1);
  });

  it('bounds replay memory and reclaims capacity after expiry', () => {
    let now = 2_000;
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => now,
      maxSeenEvents: 1,
      replayWindowMs: 60_000,
    });
    registry.register(registration() as never);
    registry.normalizeInbound('discord-main', inbound({
      eventId: 'event-one',
    }) as never);

    expect(errorCode(() => registry.normalizeInbound(
      'discord-main',
      inbound({ eventId: 'event-two' }) as never,
    ))).toBe('limit-exceeded');

    now = 62_001;
    expect(() => registry.normalizeInbound(
      'discord-main',
      inbound({ eventId: 'event-two' }) as never,
    )).not.toThrow();
    expect(registry.replayEntryCount()).toBe(1);
  });

  it('fails closed on account mismatch and undeclared reaction capability', () => {
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => 2_000,
    });
    registry.register(registration({
      capabilities: ['inbound-message'],
    }) as never);

    expect(errorCode(() => registry.normalizeInbound(
      'discord-main',
      inbound({ accountId: 'other-account' }) as never,
    ))).toBe('account-mismatch');

    expect(errorCode(() => registry.normalizeInbound(
      'discord-main',
      inbound({
        eventId: 'reaction-2',
        type: 'reaction-add',
        text: undefined,
        attachments: undefined,
        reaction: {
          targetEventId: 'message-2',
          value: '✅',
        },
      }) as never,
    ))).toBe('capability-mismatch');
  });

  it('enforces semantic event shapes and bounded timestamps', () => {
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => 2_000,
      maxFutureSkewMs: 100,
    });
    registry.register(registration() as never);

    expect(() => registry.normalizeInbound('discord-main', inbound({
      eventId: 'empty-message',
      text: undefined,
      attachments: undefined,
    }) as never)).toThrow(/require text or attachment metadata/u);

    expect(() => registry.normalizeInbound('discord-main', inbound({
      eventId: 'delete-with-content',
      type: 'message-delete',
      text: 'should not be here',
      attachments: undefined,
    }) as never)).toThrow(/cannot contain message content metadata/u);

    expect(() => registry.normalizeInbound('discord-main', inbound({
      eventId: 'reaction-with-text',
      type: 'reaction-add',
      text: 'bad',
      attachments: undefined,
      reaction: {
        targetEventId: 'target',
        value: '👍',
      },
    }) as never)).toThrow(/cannot contain message text or attachments/u);

    expect(() => registry.normalizeInbound('discord-main', inbound({
      eventId: 'future-event',
      observedAt: 2_101,
    }) as never)).toThrow(/observedAt is invalid/u);
  });

  it('enforces deterministic adapter identity, sorting and registry capacity', () => {
    const registry = createFuryGatewayChannelAdapterRegistry({
      now: () => 2_000,
      maxAdapters: 2,
    });

    registry.register(registration({
      adapterId: 'z-discord',
    }) as never);
    registry.register(registration({
      adapterId: 'a-discord',
      accountId: 'another-account',
    }) as never);

    expect(registry.list().map((item) => item.adapterId)).toEqual([
      'a-discord',
      'z-discord',
    ]);
    expect(registry.size()).toBe(2);

    expect(() => registry.register(registration({
      adapterId: 'z-discord',
    }) as never)).toThrow(/already registered/u);

    expect(errorCode(() => registry.register(registration({
      adapterId: 'third',
      accountId: 'third-account',
    }) as never))).toBe('limit-exceeded');
  });
});
