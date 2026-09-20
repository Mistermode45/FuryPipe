import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
  createFuryGatewayChannelAdapterRegistry,
} from '../src/gateway-channel-adapter-node.js';
import {
  createFuryGatewayChannelDeliveryCoordinator,
  isGeneratedFuryGatewayChannelDeliveryPermit,
} from '../src/gateway-channel-delivery-node.js';
import {
  FURY_GATEWAY_DISCORD_EVENT_FORMAT,
  FURY_GATEWAY_DISCORD_SERVICE_AUTH_FORMAT,
  createFuryGatewayDiscordAdapter,
  isGeneratedFuryGatewayDiscordAdapter,
  isGeneratedFuryGatewayDiscordInboundEvent,
  isGeneratedFuryGatewayDiscordServiceAuthentication,
} from '../src/gateway-discord-adapter-node.js';
import {
  DISCORD_DM_MESSAGE_FIXTURE,
  DISCORD_GUILD_MESSAGE_FIXTURE,
  DISCORD_GUILD_OUTBOUND_FIXTURE,
  DISCORD_GUILD_THREAD_REACTION_FIXTURE,
} from './fixtures/discord-channel-events.js';

function harness() {
  let now = 100_000;
  const channels = createFuryGatewayChannelAdapterRegistry({
    now: () => now,
    replayWindowMs: 60_000,
  });
  channels.register({
    format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
    adapterId: 'discord-main',
    channelKind: 'discord',
    accountId: 'discord-service-account-1',
    policyProfileId: 'discord-default',
    capabilities: ['inbound-message', 'inbound-reaction', 'outbound-message'],
  });

  const observedDeliveries: Array<{
    readonly destinationId: string;
    readonly threadId?: string;
    readonly text: string;
  }> = [];
  const delivery = createFuryGatewayChannelDeliveryCoordinator({
    adapterRegistry: channels,
    now: () => now,
    defaultPermitTtlMs: 5_000,
    maxPermitTtlMs: 10_000,
    transportTimeoutMs: 1_000,
  });
  delivery.registerTransport('discord-main', async (request) => {
    observedDeliveries.push(Object.freeze({
      destinationId: request.destinationId,
      ...(request.threadId === undefined ? {} : { threadId: request.threadId }),
      text: request.text,
    }));
    return {
      outcome: 'delivered',
      providerMessageId: 'discord-provider-message-1',
    };
  });

  const discord = createFuryGatewayDiscordAdapter({
    channelRegistry: channels,
    deliveryCoordinator: delivery,
    adapterId: 'discord-main',
    accountId: 'discord-service-account-1',
    now: () => now,
    defaultAuthenticationTtlMs: 30_000,
    maxAuthenticationTtlMs: 60_000,
    maxAuthentications: 8,
  });

  return {
    get now() { return now; },
    set now(value: number) { now = value; },
    channels,
    delivery,
    discord,
    observedDeliveries,
  };
}

function authenticate(h: ReturnType<typeof harness>, method: 'gateway-session' | 'interaction-signature' = 'gateway-session') {
  return h.discord.recordAuthenticatedService({
    method,
    authenticatedAccountId: 'discord-service-account-1',
    expiresInMs: 30_000,
  });
}

describe('Fury Gateway Discord adapter contract', () => {
  it('binds to exact process-local generic channel/delivery infrastructure', () => {
    const h = harness();
    expect(isGeneratedFuryGatewayDiscordAdapter(h.discord)).toBe(true);
    expect(isGeneratedFuryGatewayDiscordAdapter({ ...h.discord })).toBe(false);

    expect(() => createFuryGatewayDiscordAdapter({
      channelRegistry: { ...h.channels },
      deliveryCoordinator: h.delivery,
      adapterId: 'discord-main',
      accountId: 'discord-service-account-1',
    } as never)).toThrowError(/process-local channel registry/u);

    expect(() => createFuryGatewayDiscordAdapter({
      channelRegistry: h.channels,
      deliveryCoordinator: h.delivery,
      adapterId: 'discord-main',
      accountId: 'wrong-account',
    })).toThrowError(/does not match the registered channel adapter identity/u);
  });

  it('records service authentication without accepting raw token/signature material', () => {
    const h = harness();
    const auth = authenticate(h, 'interaction-signature');

    expect(auth.format).toBe(FURY_GATEWAY_DISCORD_SERVICE_AUTH_FORMAT);
    expect(auth.serviceAuthenticated).toBe(true);
    expect(auth.senderAuthenticated).toBe(false);
    expect(auth.executionAuthority).toBe(false);
    expect(auth.accountDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect('authenticatedAccountId' in auth).toBe(false);
    expect('token' in auth).toBe(false);
    expect('signature' in auth).toBe(false);
    expect(isGeneratedFuryGatewayDiscordServiceAuthentication(auth)).toBe(true);
    expect(isGeneratedFuryGatewayDiscordServiceAuthentication({ ...auth })).toBe(false);

    expect(() => h.discord.recordAuthenticatedService({
      method: 'gateway-session',
      authenticatedAccountId: 'discord-service-account-1',
      token: 'must-never-enter-the-contract',
    } as never)).toThrowError(/unsupported or unsafe fields/u);

    expect(() => h.discord.recordAuthenticatedService({
      method: 'interaction-signature',
      authenticatedAccountId: 'discord-service-account-1',
      signature: 'raw-signature-must-stay-at-host-boundary',
      rawBody: '{}',
    } as never)).toThrowError(/unsupported or unsafe fields/u);
  });

  it('rejects wrong-account, copied, expired and revoked service evidence', () => {
    const h = harness();

    expect(() => h.discord.recordAuthenticatedService({
      method: 'gateway-session',
      authenticatedAccountId: 'another-discord-account',
    })).toThrowError(/does not match configured adapter/u);

    const auth = authenticate(h);
    expect(() => h.discord.normalizeInbound(
      { ...auth },
      DISCORD_DM_MESSAGE_FIXTURE,
    )).toThrowError(/process-local FuryPipe evidence/u);

    expect(h.discord.revokeAuthentication(auth.authenticationId)).toBe(true);
    expect(h.discord.isCurrentAuthentication(auth)).toBe(false);
    expect(() => h.discord.normalizeInbound(
      auth,
      DISCORD_DM_MESSAGE_FIXTURE,
    )).toThrowError(/revoked or expired/u);

    const h2 = harness();
    const expiring = h2.discord.recordAuthenticatedService({
      method: 'gateway-session',
      authenticatedAccountId: 'discord-service-account-1',
      expiresInMs: 5_000,
    });
    h2.now = expiring.expiresAt;
    expect(h2.discord.isCurrentAuthentication(expiring)).toBe(false);
    expect(h2.discord.activeAuthenticationCount()).toBe(0);
  });

  it('normalizes deterministic Discord DM message fixtures without sender authority', () => {
    const h = harness();
    const auth = authenticate(h);
    const event = h.discord.normalizeInbound(auth, DISCORD_DM_MESSAGE_FIXTURE);

    expect(event.format).toBe(FURY_GATEWAY_DISCORD_EVENT_FORMAT);
    expect(event.scope).toBe('dm');
    expect(event.guildDigestSha256).toBeUndefined();
    expect(event.serviceAuthenticated).toBe(true);
    expect(event.senderAuthenticated).toBe(false);
    expect(event.principalMapped).toBe(false);
    expect(event.executionAuthority).toBe(false);
    expect(event.authenticationIdSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(isGeneratedFuryGatewayDiscordInboundEvent(event)).toBe(true);
    expect(isGeneratedFuryGatewayDiscordInboundEvent({ ...event })).toBe(false);

    expect(event.channelEvent.conversationKind).toBe('direct');
    expect(event.channelEvent.type).toBe('message');
    expect(event.channelEvent.text).toBe('hello from a DM');
    expect(event.channelEvent.attachments).toHaveLength(1);
    expect(event.channelEvent.attachments[0]?.referenceClass).toBe('provider-object');
    expect(event.channelEvent.attachments[0]?.declaredMimeType).toBe('image/png');
    expect(event.channelEvent.transportAuthentication).toBe('not-proven');
    expect(event.channelEvent.executionAuthority).toBe(false);
    expect('senderId' in event.channelEvent).toBe(false);
    expect('principalId' in event).toBe(false);
    expect('sessionId' in event).toBe(false);
  });

  it('distinguishes guild channel and guild thread context', () => {
    const h = harness();
    const auth = authenticate(h);

    const guild = h.discord.normalizeInbound(auth, DISCORD_GUILD_MESSAGE_FIXTURE);
    expect(guild.scope).toBe('guild');
    expect(guild.guildDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(guild.channelEvent.conversationKind).toBe('channel');
    expect(guild.channelEvent.threadDigestSha256).toBeUndefined();

    const threaded = h.discord.normalizeInbound(
      auth,
      DISCORD_GUILD_THREAD_REACTION_FIXTURE,
    );
    expect(threaded.scope).toBe('guild');
    expect(threaded.channelEvent.conversationKind).toBe('channel');
    expect(threaded.channelEvent.threadDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(threaded.channelEvent.type).toBe('reaction-add');
    expect(threaded.channelEvent.reaction?.targetEventIdSha256)
      .toMatch(/^[a-f0-9]{64}$/u);
    expect(threaded.channelEvent.reaction?.value).toBe('✅');
  });

  it('forbids guild/thread claims on DM input and requires guild identity for guild input', () => {
    const h = harness();
    const auth = authenticate(h);

    expect(() => h.discord.normalizeInbound(auth, {
      ...DISCORD_DM_MESSAGE_FIXTURE,
      guildId: 'forged-guild',
    } as never)).toThrowError(/DM events\/targets cannot claim guild or thread context/u);

    expect(() => h.discord.normalizeInbound(auth, {
      ...DISCORD_GUILD_MESSAGE_FIXTURE,
      guildId: undefined,
    })).toThrowError(/guildId must be bounded printable text/u);

    expect(() => h.discord.prepareOutboundDelivery(auth, {
      scope: 'dm',
      channelId: 'dm-channel',
      threadId: 'forged-thread',
      text: 'no',
      idempotencyKey: 'dm-invalid-thread',
    } as never)).toThrowError(/DM events\/targets cannot claim guild or thread context/u);
  });

  it('does not accept attachment URLs or fetch attachment content', () => {
    const h = harness();
    const auth = authenticate(h);

    expect(() => h.discord.normalizeInbound(auth, {
      ...DISCORD_DM_MESSAGE_FIXTURE,
      eventId: 'discord-event-dm-url',
      attachments: [{
        id: 'attachment-1',
        mediaType: 'image/png',
        size: 123,
        filename: 'image.png',
        url: 'https://cdn.example.invalid/image.png',
      }],
    } as never)).toThrowError(/unsupported or unsafe fields/u);
  });

  it('reuses generic replay protection for duplicate Discord events', () => {
    const h = harness();
    const auth = authenticate(h);

    h.discord.normalizeInbound(auth, DISCORD_GUILD_MESSAGE_FIXTURE);
    expect(() => h.discord.normalizeInbound(
      auth,
      DISCORD_GUILD_MESSAGE_FIXTURE,
    )).toThrowError(/replay/i);
  });

  it('maps Discord guild outbound targets into the exact governed delivery permit', async () => {
    const h = harness();
    const auth = authenticate(h);
    const permit = h.discord.prepareOutboundDelivery(
      auth,
      DISCORD_GUILD_OUTBOUND_FIXTURE,
    );

    expect(isGeneratedFuryGatewayChannelDeliveryPermit(permit)).toBe(true);
    expect(permit.adapterId).toBe('discord-main');
    expect(permit.accountDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(permit.destinationDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(permit.threadDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect('channelId' in permit).toBe(false);
    expect('guildId' in permit).toBe(false);
    expect('threadId' in permit).toBe(false);
    expect('text' in permit).toBe(false);

    const receipt = await h.delivery.executeDelivery(permit);
    expect(receipt.status).toBe('delivered');
    expect(h.observedDeliveries).toEqual([{
      destinationId: 'discord-channel-400',
      threadId: 'discord-thread-88',
      text: 'FuryPipe governed outbound message',
    }]);
  });

  it('maps Discord DM outbound targets without inventing guild/thread context', async () => {
    const h = harness();
    const auth = authenticate(h);
    const permit = h.discord.prepareOutboundDelivery(auth, {
      scope: 'dm',
      channelId: 'discord-dm-channel-500',
      text: 'direct governed reply',
      idempotencyKey: 'discord-dm-outbound-1',
    });
    expect(permit.threadDigestSha256).toBeUndefined();

    await h.delivery.executeDelivery(permit);
    expect(h.observedDeliveries[0]).toEqual({
      destinationId: 'discord-dm-channel-500',
      text: 'direct governed reply',
    });
  });

  it('fails closed on inbound unknown fields, accessors, custom prototypes and sparse arrays', () => {
    const h = harness();
    const auth = authenticate(h);

    expect(() => h.discord.normalizeInbound(auth, {
      ...DISCORD_DM_MESSAGE_FIXTURE,
      token: 'forbidden',
    } as never)).toThrowError(/unsupported or unsafe fields/u);

    const accessor = { ...DISCORD_DM_MESSAGE_FIXTURE } as Record<string, unknown>;
    Object.defineProperty(accessor, 'senderId', {
      enumerable: true,
      get: () => 'discord-user-100',
    });
    expect(() => h.discord.normalizeInbound(auth, accessor as never))
      .toThrowError(/unsupported or unsafe fields/u);

    const custom = Object.create({ polluted: true }) as Record<string, unknown>;
    Object.assign(custom, DISCORD_DM_MESSAGE_FIXTURE);
    expect(() => h.discord.normalizeInbound(auth, custom as never))
      .toThrowError(/plain data object/u);

    const sparse = new Array(2);
    sparse[0] = { id: 'attachment-1' };
    expect(() => h.discord.normalizeInbound(auth, {
      ...DISCORD_DM_MESSAGE_FIXTURE,
      eventId: 'discord-event-sparse',
      attachments: sparse,
    } as never)).toThrowError(/sparse, hidden, or accessor entries/u);
  });

  it('collects expired/revoked service authentication evidence before quota checks', () => {
    let now = 50_000;
    const channels = createFuryGatewayChannelAdapterRegistry({ now: () => now });
    channels.register({
      format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
      adapterId: 'discord-main',
      channelKind: 'discord',
      accountId: 'discord-service-account-1',
      policyProfileId: 'discord-default',
      capabilities: ['outbound-message'],
    });
    const delivery = createFuryGatewayChannelDeliveryCoordinator({
      adapterRegistry: channels,
      now: () => now,
    });
    delivery.registerTransport('discord-main', async () => ({
      outcome: 'delivered',
    }));
    const discord = createFuryGatewayDiscordAdapter({
      channelRegistry: channels,
      deliveryCoordinator: delivery,
      adapterId: 'discord-main',
      accountId: 'discord-service-account-1',
      now: () => now,
      defaultAuthenticationTtlMs: 5_000,
      maxAuthenticationTtlMs: 5_000,
      maxAuthentications: 1,
    });

    const first = discord.recordAuthenticatedService({
      method: 'gateway-session',
      authenticatedAccountId: 'discord-service-account-1',
    });
    expect(discord.revokeAuthentication(first.authenticationId)).toBe(true);
    expect(discord.recordAuthenticatedService({
      method: 'gateway-session',
      authenticatedAccountId: 'discord-service-account-1',
    })).toBeDefined();

    now += 6_000;
    expect(discord.activeAuthenticationCount()).toBe(0);
    expect(discord.recordAuthenticatedService({
      method: 'interaction-signature',
      authenticatedAccountId: 'discord-service-account-1',
    })).toBeDefined();
  });
});
