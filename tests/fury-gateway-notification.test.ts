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
  FURY_GATEWAY_NOTIFICATION_FORMAT,
  FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
  FURY_GATEWAY_NOTIFICATION_ROUTE_FORMAT,
  FuryGatewayNotificationDeliveryOutcomeUnknownError,
  createFuryGatewayNotificationCoordinator,
  isGeneratedFuryGatewayNotification,
  isGeneratedFuryGatewayNotificationCoordinator,
  isGeneratedFuryGatewayNotificationRoutePlan,
} from '../src/gateway-notification-node.js';

function harness(
  transport: (
    request: {
      readonly destinationId: string;
      readonly threadId?: string;
      readonly text: string;
    },
  ) => Promise<{
    readonly outcome: 'accepted' | 'delivered' | 'provider-rejected';
    readonly providerMessageId?: string;
  }> | {
    readonly outcome: 'accepted' | 'delivered' | 'provider-rejected';
    readonly providerMessageId?: string;
  } = async () => ({
    outcome: 'delivered',
    providerMessageId: 'provider-message-1',
  }),
) {
  let now = 100_000;
  const adapters = createFuryGatewayChannelAdapterRegistry({ now: () => now });
  adapters.register({
    format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
    adapterId: 'discord-main',
    channelKind: 'discord',
    accountId: 'discord-account-1',
    policyProfileId: 'discord-default',
    capabilities: ['inbound-message', 'outbound-message'],
  });
  const deliveries = createFuryGatewayChannelDeliveryCoordinator({
    adapterRegistry: adapters,
    now: () => now,
    defaultPermitTtlMs: 5_000,
    maxPermitTtlMs: 10_000,
    transportTimeoutMs: 1_000,
    maxDeliveries: 64,
  });
  deliveries.registerTransport('discord-main', async (request) => transport({
    destinationId: request.destinationId,
    ...(request.threadId === undefined ? {} : { threadId: request.threadId }),
    text: request.text,
  }));

  const notifications = createFuryGatewayNotificationCoordinator({
    deliveryCoordinator: deliveries,
    now: () => now,
    deliveryPermitTtlMs: 5_000,
    maxPolicies: 8,
    maxNotifications: 64,
    maxRoutePlans: 64,
  });

  return {
    get now() { return now; },
    set now(value: number) { now = value; },
    adapters,
    deliveries,
    notifications,
  };
}

function registerPolicy(
  h: ReturnType<typeof harness>,
  overrides: Record<string, unknown> = {},
) {
  return h.notifications.registerDestinationPolicy({
    format: FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
    policyKey: 'ops-alerts',
    adapterId: 'discord-main',
    destinationId: 'channel-ops-123',
    threadId: 'thread-alerts',
    allowedKinds: ['ci.completed', 'security.alert'],
    allowedSeverities: ['info', 'warning', 'error', 'critical'],
    ...overrides,
  } as never);
}

function createNotification(
  h: ReturnType<typeof harness>,
  overrides: Record<string, unknown> = {},
) {
  return h.notifications.createNotification({
    kind: 'ci.completed',
    severity: 'info',
    title: 'CI completed',
    summary: 'The exact workflow run completed successfully.',
    sourceEvidenceId: 'github-run:35524710918',
    destinationPolicyKey: 'ops-alerts',
    acknowledgementRequired: true,
    ...overrides,
  } as never);
}

describe('Fury Gateway notification plane', () => {
  it('requires a process-local governed channel delivery coordinator', () => {
    const h = harness();
    expect(() => createFuryGatewayNotificationCoordinator({
      deliveryCoordinator: {
        ...h.deliveries,
      },
    } as never)).toThrowError(/process-local channel delivery coordinator/u);
  });

  it('registers destination policy without exposing raw destination identifiers', () => {
    const h = harness();
    const policy = registerPolicy(h);

    expect(policy.format).toBe(FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT);
    expect(policy.policyKey).toBe('ops-alerts');
    expect(policy.adapterId).toBe('discord-main');
    expect(policy.destinationDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(policy.threadDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(policy.authority).toBe('notification-routing-policy-only');
    expect(policy.executionAuthority).toBe(false);
    expect('destinationId' in policy).toBe(false);
    expect('threadId' in policy).toBe(false);

    const inspected = h.notifications.inspectDestinationPolicy('ops-alerts');
    expect(inspected).toEqual(policy);
    expect(inspected).not.toBe(policy);
  });

  it('creates process-local notification data while hashing source evidence identity', () => {
    const h = harness();
    registerPolicy(h);
    const notification = createNotification(h);

    expect(notification.format).toBe(FURY_GATEWAY_NOTIFICATION_FORMAT);
    expect(notification.notificationId).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(notification.sourceEvidenceDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(notification.authority).toBe('notification-data-only');
    expect(notification.executionAuthority).toBe(false);
    expect('sourceEvidenceId' in notification).toBe(false);
    expect(isGeneratedFuryGatewayNotification(notification)).toBe(true);
    expect(isGeneratedFuryGatewayNotification({ ...notification })).toBe(false);
    expect(isGeneratedFuryGatewayNotificationCoordinator(h.notifications)).toBe(true);
    expect(isGeneratedFuryGatewayNotificationCoordinator({
      ...h.notifications,
    })).toBe(false);
  });

  it('selects a data-only destination plan and rejects copied notification evidence', () => {
    const h = harness();
    registerPolicy(h);
    const notification = createNotification(h);

    const route = h.notifications.selectDestination(notification);
    expect(route.format).toBe(FURY_GATEWAY_NOTIFICATION_ROUTE_FORMAT);
    expect(route.notificationId).toBe(notification.notificationId);
    expect(route.adapterId).toBe('discord-main');
    expect(route.destinationDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(route.renderedPayloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(route.authority).toBe('notification-routing-data-only');
    expect(route.executionAuthority).toBe(false);
    expect(isGeneratedFuryGatewayNotificationRoutePlan(route)).toBe(true);
    expect(isGeneratedFuryGatewayNotificationRoutePlan({ ...route })).toBe(false);

    expect(() => h.notifications.selectDestination({
      ...notification,
    })).toThrowError(/process-local FuryPipe evidence/u);
  });

  it('fails closed when notification kind or severity is outside destination policy', () => {
    const h = harness();
    registerPolicy(h, {
      allowedKinds: ['security.alert'],
      allowedSeverities: ['critical'],
    });

    const wrongKind = createNotification(h, {
      kind: 'ci.completed',
      severity: 'critical',
    });
    expect(() => h.notifications.selectDestination(wrongKind))
      .toThrowError(/not eligible/u);

    const wrongSeverity = createNotification(h, {
      kind: 'security.alert',
      severity: 'warning',
    });
    expect(() => h.notifications.selectDestination(wrongSeverity))
      .toThrowError(/not eligible/u);
  });

  it('prepares one exact delivery permit and keeps raw destination private until transport invocation', async () => {
    let observedDestination: string | undefined;
    let observedThread: string | undefined;
    let observedText: string | undefined;
    const h = harness(async (request) => {
      observedDestination = request.destinationId;
      observedThread = request.threadId;
      observedText = request.text;
      return {
        outcome: 'delivered',
        providerMessageId: 'discord-msg-9001',
      };
    });
    registerPolicy(h);
    const notification = createNotification(h);
    const route = h.notifications.selectDestination(notification);

    const permit = h.notifications.prepareDelivery(route);
    expect(isGeneratedFuryGatewayChannelDeliveryPermit(permit)).toBe(true);
    expect(permit.destinationDigestSha256).toBe(route.destinationDigestSha256);
    expect(permit.payloadSha256).toBe(route.renderedPayloadSha256);
    expect(observedDestination).toBeUndefined();

    expect(() => h.notifications.prepareDelivery(route))
      .toThrowError(/already has a delivery permit/u);

    const receipt = await h.notifications.executeDelivery(route, permit);
    expect(observedDestination).toBe('channel-ops-123');
    expect(observedThread).toBe('thread-alerts');
    expect(observedText).toBe(
      'CI completed\n\nThe exact workflow run completed successfully.',
    );
    expect(receipt.delivery.status).toBe('delivered');
    expect(receipt.delivery.delivered).toBe(true);
    expect(receipt.acknowledgement).toBe('pending');
    expect(receipt.underlyingTaskStatus).toBe('not-inferred');
    expect(receipt.executionAuthority).toBe(false);
    expect('destinationId' in receipt).toBe(false);
    expect('taskSucceeded' in receipt).toBe(false);
  });

  it('keeps accepted-for-delivery separate from delivered, acknowledgement and task status', async () => {
    const h = harness(async () => ({
      outcome: 'accepted',
      providerMessageId: 'queued-provider-message',
    }));
    registerPolicy(h);
    const notification = createNotification(h);
    const route = h.notifications.selectDestination(notification);
    const permit = h.notifications.prepareDelivery(route);

    const receipt = await h.notifications.executeDelivery(route, permit);
    expect(receipt.delivery.status).toBe('accepted-for-delivery');
    expect(receipt.delivery.providerAccepted).toBe(true);
    expect(receipt.delivery.delivered).toBe('unknown');
    expect(receipt.acknowledgement).toBe('pending');
    expect(receipt.underlyingTaskStatus).toBe('not-inferred');
  });

  it('marks acknowledgement not-required independently from successful delivery', async () => {
    const h = harness(async () => ({
      outcome: 'provider-rejected',
    }));
    registerPolicy(h);
    const notification = createNotification(h, {
      acknowledgementRequired: false,
    });
    const route = h.notifications.selectDestination(notification);
    const permit = h.notifications.prepareDelivery(route);

    const receipt = await h.notifications.executeDelivery(route, permit);
    expect(receipt.delivery.status).toBe('provider-rejected');
    expect(receipt.delivery.delivered).toBe(false);
    expect(receipt.acknowledgement).toBe('not-required');
    expect(receipt.underlyingTaskStatus).toBe('not-inferred');
  });

  it('wraps transport ambiguity as notification outcome-unknown without authorizing retry', async () => {
    let calls = 0;
    const h = harness(async () => {
      calls += 1;
      throw new Error('simulated disconnect after transport invocation');
    });
    registerPolicy(h);
    const notification = createNotification(h);
    const route = h.notifications.selectDestination(notification);
    const permit = h.notifications.prepareDelivery(route);

    let unknown: FuryGatewayNotificationDeliveryOutcomeUnknownError | undefined;
    try {
      await h.notifications.executeDelivery(route, permit);
    } catch (error) {
      expect(error).toBeInstanceOf(
        FuryGatewayNotificationDeliveryOutcomeUnknownError,
      );
      unknown = error as FuryGatewayNotificationDeliveryOutcomeUnknownError;
    }

    expect(calls).toBe(1);
    expect(unknown?.retrySafe).toBe(false);
    expect(unknown?.receipt.delivery.status).toBe('outcome-unknown');
    expect(unknown?.receipt.delivery.delivered).toBe('unknown');
    expect(unknown?.receipt.acknowledgement).toBe('pending');
    expect(unknown?.receipt.underlyingTaskStatus).toBe('not-inferred');

    await expect(h.notifications.executeDelivery(route, permit))
      .rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('requires exact process-local route and permit evidence', async () => {
    const h = harness();
    registerPolicy(h);
    const notification = createNotification(h);
    const route = h.notifications.selectDestination(notification);
    const permit = h.notifications.prepareDelivery(route);

    expect(() => h.notifications.prepareDelivery({
      ...route,
    })).toThrowError(/process-local FuryPipe evidence/u);

    await expect(h.notifications.executeDelivery(route, {
      ...permit,
    })).rejects.toThrow(/exact prepared process-local channel permit/u);
  });

  it('fails closed on unknown fields, accessors, custom prototypes and sparse arrays', () => {
    const h = harness();

    expect(() => h.notifications.registerDestinationPolicy({
      format: FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
      policyKey: 'ops-alerts',
      adapterId: 'discord-main',
      destinationId: 'channel-ops',
      allowedKinds: ['ci.completed'],
      allowedSeverities: ['info'],
      secret: 'forbidden',
    } as never)).toThrowError(/unsupported or unsafe fields/u);

    const accessor = {
      kind: 'ci.completed',
      severity: 'info',
      title: 'CI',
      summary: 'done',
      sourceEvidenceId: 'run-1',
      destinationPolicyKey: 'ops-alerts',
      acknowledgementRequired: false,
    } as Record<string, unknown>;
    Object.defineProperty(accessor, 'summary', {
      enumerable: true,
      get: () => 'done',
    });
    expect(() => h.notifications.createNotification(accessor as never))
      .toThrowError(/unsupported or unsafe fields/u);

    const custom = Object.create({ polluted: true }) as Record<string, unknown>;
    Object.assign(custom, {
      kind: 'ci.completed',
      severity: 'info',
      title: 'CI',
      summary: 'done',
      sourceEvidenceId: 'run-1',
      destinationPolicyKey: 'ops-alerts',
      acknowledgementRequired: false,
    });
    expect(() => h.notifications.createNotification(custom as never))
      .toThrowError(/plain data object/u);

    const sparse = new Array<string>(2);
    sparse[0] = 'ci.completed';
    expect(() => registerPolicy(h, {
      allowedKinds: sparse,
    })).toThrowError(/sparse, hidden, or accessor entries/u);
  });

  it('enforces bounded policy, notification and route registries', () => {
    const base = harness();
    const constrained = createFuryGatewayNotificationCoordinator({
      deliveryCoordinator: base.deliveries,
      now: () => base.now,
      maxPolicies: 1,
      maxNotifications: 1,
      maxRoutePlans: 1,
    });

    constrained.registerDestinationPolicy({
      format: FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
      policyKey: 'one',
      adapterId: 'discord-main',
      destinationId: 'channel-one',
      allowedKinds: ['ci.completed'],
      allowedSeverities: ['info'],
    });
    expect(() => constrained.registerDestinationPolicy({
      format: FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
      policyKey: 'two',
      adapterId: 'discord-main',
      destinationId: 'channel-two',
      allowedKinds: ['ci.completed'],
      allowedSeverities: ['info'],
    })).toThrowError(/policy registry is full/u);

    const first = constrained.createNotification({
      kind: 'ci.completed',
      severity: 'info',
      title: 'one',
      summary: 'one',
      sourceEvidenceId: 'run-one',
      destinationPolicyKey: 'one',
      acknowledgementRequired: false,
    });
    expect(() => constrained.createNotification({
      kind: 'ci.completed',
      severity: 'info',
      title: 'two',
      summary: 'two',
      sourceEvidenceId: 'run-two',
      destinationPolicyKey: 'one',
      acknowledgementRequired: false,
    })).toThrowError(/notification registry is full/u);

    constrained.selectDestination(first);
    expect(constrained.notificationCount()).toBe(1);
    expect(constrained.routePlanCount()).toBe(1);
    expect(() => constrained.selectDestination(first))
      .toThrowError(/route registry is full/u);
  });
});
