import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
  createFuryGatewayChannelAdapterRegistry,
} from '../src/gateway-channel-adapter-node.js';
import {
  FURY_GATEWAY_CHANNEL_DELIVERY_PERMIT_FORMAT,
  FURY_GATEWAY_CHANNEL_DELIVERY_RECEIPT_FORMAT,
  FuryGatewayChannelDeliveryOutcomeUnknownError,
  createFuryGatewayChannelDeliveryCoordinator,
  isGeneratedFuryGatewayChannelDeliveryCoordinator,
  isGeneratedFuryGatewayChannelDeliveryPermit,
  type FuryGatewayChannelDeliveryPermit,
} from '../src/gateway-channel-delivery-node.js';

function harness(capabilities: readonly ('inbound-message' | 'inbound-reaction' | 'outbound-message')[] = [
  'inbound-message',
  'outbound-message',
]) {
  let now = 100_000;
  const adapters = createFuryGatewayChannelAdapterRegistry({ now: () => now });
  adapters.register({
    format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
    adapterId: 'discord-main',
    channelKind: 'discord',
    accountId: 'discord-account-secret-free-identity',
    policyProfileId: 'discord-default',
    capabilities,
  });
  const deliveries = createFuryGatewayChannelDeliveryCoordinator({
    adapterRegistry: adapters,
    now: () => now,
    defaultPermitTtlMs: 5_000,
    maxPermitTtlMs: 10_000,
    transportTimeoutMs: 1_000,
    maxTransports: 4,
    maxDeliveries: 32,
  });
  return {
    get now() { return now; },
    set now(value: number) { now = value; },
    adapters,
    deliveries,
  };
}

function deliveryInput(overrides: Record<string, unknown> = {}) {
  return {
    adapterId: 'discord-main',
    destinationId: 'channel-123',
    threadId: 'thread-7',
    text: 'FuryPipe notification payload',
    replyToEventId: 'message-42',
    idempotencyKey: 'notification:ci:run-123',
    ...overrides,
  } as const;
}

describe('Fury Gateway governed channel delivery', () => {
  it('requires a process-local adapter registry', () => {
    const h = harness();
    expect(() => createFuryGatewayChannelDeliveryCoordinator({
      adapterRegistry: {
        ...h.adapters,
      },
    } as never)).toThrowError(/process-local channel adapter registry/u);
  });

  it('registers only outbound-capable host transports and pins coordinator provenance', () => {
    const h = harness();
    expect(isGeneratedFuryGatewayChannelDeliveryCoordinator(h.deliveries)).toBe(true);
    expect(isGeneratedFuryGatewayChannelDeliveryCoordinator({
      ...h.deliveries,
    })).toBe(false);

    h.deliveries.registerTransport('discord-main', async () => ({
      outcome: 'delivered',
    }));
    expect(h.deliveries.transportCount()).toBe(1);
    expect(() => h.deliveries.registerTransport('discord-main', async () => ({
      outcome: 'delivered',
    }))).toThrowError(/already has a registered transport/u);

    const noOutbound = harness(['inbound-message']);
    expect(() => noOutbound.deliveries.registerTransport(
      'discord-main',
      async () => ({ outcome: 'delivered' }),
    )).toThrowError(/does not declare outbound-message/u);
  });

  it('creates a one-shot process-local permit without exposing raw destination or payload', () => {
    const h = harness();
    h.deliveries.registerTransport('discord-main', async () => ({
      outcome: 'delivered',
    }));

    const permit = h.deliveries.prepareDelivery(deliveryInput());
    expect(permit.format).toBe(FURY_GATEWAY_CHANNEL_DELIVERY_PERMIT_FORMAT);
    expect(permit.authority).toBe('single-channel-delivery-permit');
    expect(permit.executionAuthority).toBe(true);
    expect(permit.destinationDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(permit.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(permit.idempotencyKeySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect('destinationId' in permit).toBe(false);
    expect('text' in permit).toBe(false);
    expect('idempotencyKey' in permit).toBe(false);
    expect(isGeneratedFuryGatewayChannelDeliveryPermit(permit)).toBe(true);
    expect(isGeneratedFuryGatewayChannelDeliveryPermit({ ...permit })).toBe(false);
    expect(h.deliveries.inspectDelivery(permit).status).toBe('prepared');
  });

  it('rejects copied permits and consumes the permit before invoking transport', async () => {
    const h = harness();
    let permit!: FuryGatewayChannelDeliveryPermit;
    let reentryRejected = false;

    h.deliveries.registerTransport('discord-main', async (request) => {
      expect(request.destinationId).toBe('channel-123');
      expect(request.text).toBe('FuryPipe notification payload');
      expect(request.authority).toBe('transport-invocation-data');
      expect(request.executionAuthority).toBe(false);
      try {
        await h.deliveries.executeDelivery(permit);
      } catch (error) {
        reentryRejected = /already consumed|no longer executable/u.test(String(error));
      }
      return {
        outcome: 'delivered',
        providerMessageId: 'discord-message-9001',
      };
    });

    permit = h.deliveries.prepareDelivery(deliveryInput());
    await expect(h.deliveries.executeDelivery({ ...permit }))
      .rejects.toThrow(/process-local FuryPipe permit evidence/u);

    const receipt = await h.deliveries.executeDelivery(permit);
    expect(reentryRejected).toBe(true);
    expect(receipt.status).toBe('delivered');
    expect(receipt.delivered).toBe(true);
    expect(receipt.providerAccepted).toBe(true);
    expect(receipt.providerMessageIdSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect('providerMessageId' in receipt).toBe(false);
    expect('taskSucceeded' in receipt).toBe(false);
    expect(receipt.executionAuthority).toBe(false);

    await expect(h.deliveries.executeDelivery(permit))
      .rejects.toThrow(/already consumed|no longer executable/u);
  });

  it('keeps accepted-for-delivery distinct from delivered', async () => {
    const h = harness();
    h.deliveries.registerTransport('discord-main', async () => ({
      outcome: 'accepted',
      providerMessageId: 'queued-message-1',
    }));

    const permit = h.deliveries.prepareDelivery(deliveryInput());
    const receipt = await h.deliveries.executeDelivery(permit);

    expect(receipt.format).toBe(FURY_GATEWAY_CHANNEL_DELIVERY_RECEIPT_FORMAT);
    expect(receipt.status).toBe('accepted-for-delivery');
    expect(receipt.transportInvoked).toBe(true);
    expect(receipt.providerAccepted).toBe(true);
    expect(receipt.delivered).toBe('unknown');
    expect(receipt.verified).toBe(false);
    expect(receipt.retrySafe).toBe(false);
    expect(h.deliveries.inspectDelivery(permit).status).toBe('accepted-for-delivery');
  });

  it('records provider rejection without claiming delivery or task status', async () => {
    const h = harness();
    h.deliveries.registerTransport('discord-main', async () => ({
      outcome: 'provider-rejected',
    }));

    const permit = h.deliveries.prepareDelivery(deliveryInput());
    const receipt = await h.deliveries.executeDelivery(permit);

    expect(receipt.status).toBe('provider-rejected');
    expect(receipt.providerAccepted).toBe(false);
    expect(receipt.delivered).toBe(false);
    expect(receipt.retrySafe).toBe(false);
    expect('taskSucceeded' in receipt).toBe(false);
  });

  it('turns any post-invocation transport failure into sticky outcome-unknown', async () => {
    const h = harness();
    let calls = 0;
    h.deliveries.registerTransport('discord-main', async () => {
      calls += 1;
      throw new Error('simulated connection loss after send boundary');
    });

    const permit = h.deliveries.prepareDelivery(deliveryInput());

    let unknown: FuryGatewayChannelDeliveryOutcomeUnknownError | undefined;
    try {
      await h.deliveries.executeDelivery(permit);
    } catch (error) {
      expect(error).toBeInstanceOf(FuryGatewayChannelDeliveryOutcomeUnknownError);
      unknown = error as FuryGatewayChannelDeliveryOutcomeUnknownError;
    }

    expect(calls).toBe(1);
    expect(unknown?.retrySafe).toBe(false);
    expect(unknown?.receipt.status).toBe('outcome-unknown');
    expect(unknown?.receipt.providerAccepted).toBe('unknown');
    expect(unknown?.receipt.delivered).toBe('unknown');
    expect(h.deliveries.inspectDelivery(permit).status).toBe('outcome-unknown');

    await expect(h.deliveries.executeDelivery(permit))
      .rejects.toThrow(/already consumed|no longer executable/u);
    expect(() => h.deliveries.prepareDelivery(deliveryInput()))
      .toThrowError(/idempotency key was already reserved/u);
    expect(calls).toBe(1);
  });

  it('preserves outcome-unknown evidence even if the host clock fails after invocation', async () => {
    const h = harness();
    h.deliveries.registerTransport('discord-main', async () => {
      h.now = Number.NaN;
      throw new Error('simulated post-send failure with broken clock');
    });

    const permit = h.deliveries.prepareDelivery(deliveryInput());
    let unknown: FuryGatewayChannelDeliveryOutcomeUnknownError | undefined;
    try {
      await h.deliveries.executeDelivery(permit);
    } catch (error) {
      expect(error).toBeInstanceOf(FuryGatewayChannelDeliveryOutcomeUnknownError);
      unknown = error as FuryGatewayChannelDeliveryOutcomeUnknownError;
    }

    expect(unknown?.receipt.status).toBe('outcome-unknown');
    expect(unknown?.receipt.settledAt).toBe(unknown?.receipt.attemptedAt);
    expect(unknown?.retrySafe).toBe(false);
  });

  it('treats malformed post-call result evidence as outcome-unknown, never pre-call rejection', async () => {
    const h = harness();
    h.deliveries.registerTransport('discord-main', async () => ({
      outcome: 'delivered',
      secret: 'must-not-enter-receipt',
    } as never));

    const permit = h.deliveries.prepareDelivery(deliveryInput());
    await expect(h.deliveries.executeDelivery(permit))
      .rejects.toBeInstanceOf(FuryGatewayChannelDeliveryOutcomeUnknownError);
    expect(h.deliveries.inspectDelivery(permit).status).toBe('outcome-unknown');
  });

  it('expires pre-call without invoking transport', async () => {
    const h = harness();
    let calls = 0;
    h.deliveries.registerTransport('discord-main', async () => {
      calls += 1;
      return { outcome: 'delivered' };
    });

    const permit = h.deliveries.prepareDelivery({
      ...deliveryInput(),
      expiresInMs: 1_000,
    });
    h.now = permit.expiresAt;

    await expect(h.deliveries.executeDelivery(permit))
      .rejects.toThrow(/expired before transport invocation/u);
    expect(calls).toBe(0);
    expect(h.deliveries.inspectDelivery(permit).status).toBe('expired');
  });

  it('fails closed on input schema drift, accessors, bad transport evidence and idempotency replay', async () => {
    const h = harness();
    h.deliveries.registerTransport('discord-main', async () => ({
      outcome: 'provider-rejected',
      providerMessageId: 'impossible-id',
    }));

    expect(() => h.deliveries.prepareDelivery({
      ...deliveryInput(),
      token: 'must-not-enter-delivery',
    } as never)).toThrowError(/unsupported or unsafe fields/u);

    const accessor = { ...deliveryInput() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'destinationId', {
      enumerable: true,
      get: () => 'channel-123',
    });
    expect(() => h.deliveries.prepareDelivery(accessor as never))
      .toThrowError(/unsupported or unsafe fields/u);

    const permit = h.deliveries.prepareDelivery(deliveryInput());
    await expect(h.deliveries.executeDelivery(permit))
      .rejects.toBeInstanceOf(FuryGatewayChannelDeliveryOutcomeUnknownError);

    expect(() => h.deliveries.prepareDelivery(deliveryInput()))
      .toThrowError(/idempotency key was already reserved/u);
  });

  it('enforces delivery registry quota without silently dropping idempotency evidence', () => {
    let now = 200_000;
    const adapters = createFuryGatewayChannelAdapterRegistry({ now: () => now });
    adapters.register({
      format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
      adapterId: 'discord-main',
      channelKind: 'discord',
      accountId: 'discord-account',
      policyProfileId: 'discord-default',
      capabilities: ['outbound-message'],
    });
    const deliveries = createFuryGatewayChannelDeliveryCoordinator({
      adapterRegistry: adapters,
      now: () => now,
      maxDeliveries: 1,
      defaultPermitTtlMs: 1_000,
      maxPermitTtlMs: 1_000,
    });
    deliveries.registerTransport('discord-main', async () => ({
      outcome: 'delivered',
    }));
    deliveries.prepareDelivery(deliveryInput({ idempotencyKey: 'first' }));
    expect(() => deliveries.prepareDelivery(deliveryInput({
      idempotencyKey: 'second',
    }))).toThrowError(/delivery registry is full/u);
    now += 60_000;
    expect(deliveries.deliveryCount()).toBe(1);
  });
});
