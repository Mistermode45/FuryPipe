import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
  createFuryGatewayChannelAdapterRegistry,
} from '../src/gateway-channel-adapter-node.js';
import {
  createFuryGatewayChannelDeliveryCoordinator,
} from '../src/gateway-channel-delivery-node.js';
import {
  FURY_GATEWAY_CHANNEL_OBSERVABILITY_COMMAND_DEFINITIONS,
} from '../src/gateway-channel-observability-command-node.js';
import {
  FURY_GATEWAY_CHANNEL_OBSERVABILITY_FORMAT,
  FURY_GATEWAY_CHANNEL_OBSERVABILITY_RESULT_FORMAT,
  createFuryGatewayChannelObservability,
  isGeneratedFuryGatewayChannelObservability,
} from '../src/gateway-channel-observability-node.js';
import {
  createFuryGatewayDiscordAdapter,
} from '../src/gateway-discord-adapter-node.js';
import {
  FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
  createFuryGatewayNotificationCoordinator,
} from '../src/gateway-notification-node.js';

function harness(maxAdapterSummaries = 64) {
  let now = 100_000;
  const channels = createFuryGatewayChannelAdapterRegistry({
    now: () => now,
    replayWindowMs: 60_000,
  });
  channels.register({
    format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
    adapterId: 'discord-main',
    channelKind: 'discord',
    accountId: 'discord-account-alpha',
    policyProfileId: 'discord-policy-alpha',
    capabilities: ['inbound-message', 'outbound-message'],
  });
  channels.register({
    format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
    adapterId: 'slack-secondary',
    channelKind: 'slack',
    accountId: 'slack-account-beta',
    policyProfileId: 'slack-policy-beta',
    capabilities: ['inbound-message'],
  });

  const deliveries = createFuryGatewayChannelDeliveryCoordinator({
    adapterRegistry: channels,
    now: () => now,
    defaultPermitTtlMs: 5_000,
    maxPermitTtlMs: 10_000,
    transportTimeoutMs: 1_000,
  });
  deliveries.registerTransport('discord-main', async () => ({
    outcome: 'delivered',
    providerMessageId: 'provider-message-100',
  }));

  const notifications = createFuryGatewayNotificationCoordinator({
    deliveryCoordinator: deliveries,
    now: () => now,
    deliveryPermitTtlMs: 5_000,
  });
  notifications.registerDestinationPolicy({
    format: FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
    policyKey: 'ops-alerts',
    adapterId: 'discord-main',
    destinationId: 'discord-destination-42',
    allowedKinds: ['ci.completed'],
    allowedSeverities: ['info'],
  });

  const discord = createFuryGatewayDiscordAdapter({
    channelRegistry: channels,
    deliveryCoordinator: deliveries,
    adapterId: 'discord-main',
    accountId: 'discord-account-alpha',
    now: () => now,
    defaultAuthenticationTtlMs: 30_000,
    maxAuthenticationTtlMs: 30_000,
  });

  const observability = createFuryGatewayChannelObservability({
    channelRegistry: channels,
    deliveryCoordinator: deliveries,
    notificationCoordinator: notifications,
    discordAdapter: discord,
    now: () => now,
    maxAdapterSummaries,
  });

  return {
    get now() { return now; },
    set now(value: number) { now = value; },
    channels,
    deliveries,
    notifications,
    discord,
    observability,
  };
}

describe('Fury Gateway channel observability', () => {
  it('defines one inspect-only channels.status command with no execution permission', () => {
    expect(FURY_GATEWAY_CHANNEL_OBSERVABILITY_COMMAND_DEFINITIONS).toEqual([
      {
        format: 'furypipe-gateway-command-definition/v1',
        name: 'channels.status',
        allowedRoles: ['operator'],
        requiredScopes: ['channels.inspect'],
        requiredPluginPermissions: [],
        riskClass: 'inspect',
        requiresFreshApproval: false,
      },
    ]);
  });

  it('requires exact process-local Phase 4 dependencies', () => {
    const h = harness();
    expect(isGeneratedFuryGatewayChannelObservability(h.observability)).toBe(true);
    expect(isGeneratedFuryGatewayChannelObservability({ ...h.observability })).toBe(false);

    expect(() => createFuryGatewayChannelObservability({
      channelRegistry: { ...h.channels },
      deliveryCoordinator: h.deliveries,
      notificationCoordinator: h.notifications,
    } as never)).toThrowError(/process-local channel, delivery, notification/u);
  });

  it('projects redacted aggregate channel, delivery and notification lifecycle state', async () => {
    const h = harness();
    const auth = h.discord.recordAuthenticatedService({
      method: 'gateway-session',
      authenticatedAccountId: 'discord-account-alpha',
    });
    h.discord.normalizeInbound(auth, {
      eventId: 'event-1',
      senderId: 'sender-1',
      channelId: 'conversation-1',
      scope: 'dm',
      type: 'message',
      content: 'private inbound body that must not appear in observability',
      observedAt: h.now,
    });

    const directPermit = h.deliveries.prepareDelivery({
      adapterId: 'discord-main',
      destinationId: 'direct-destination-77',
      text: 'private outbound body that must not appear in observability',
      idempotencyKey: ['delivery', 'observation', '1'].join('-'),
    });
    await h.deliveries.executeDelivery(directPermit);

    const notification = h.notifications.createNotification({
      kind: 'ci.completed',
      severity: 'info',
      title: 'CI complete',
      summary: 'Build completed.',
      sourceEvidenceId: 'workflow-run-123',
      destinationPolicyKey: 'ops-alerts',
      acknowledgementRequired: true,
    });
    const route = h.notifications.selectDestination(notification);
    h.notifications.prepareDelivery(route);

    const snapshot = h.observability.snapshot();
    expect(snapshot.format).toBe(FURY_GATEWAY_CHANNEL_OBSERVABILITY_FORMAT);
    expect(snapshot.executionAuthority).toBe(false);
    expect(snapshot.browserAuthority).toBe('none');
    expect(snapshot.channels.adaptersConfigured).toBe(2);
    expect(snapshot.channels.replayEntries).toBe(1);
    expect(snapshot.channels.adapterSummaries).toEqual([
      {
        adapterId: 'discord-main',
        channelKind: 'discord',
        capabilities: ['inbound-message', 'outbound-message'],
        authority: 'observability-only',
        executionAuthority: false,
      },
      {
        adapterId: 'slack-secondary',
        channelKind: 'slack',
        capabilities: ['inbound-message'],
        authority: 'observability-only',
        executionAuthority: false,
      },
    ]);
    expect(snapshot.delivery.counts.delivered).toBe(1);
    expect(snapshot.delivery.counts.prepared).toBe(1);
    expect(snapshot.notifications.notificationsCreated).toBe(1);
    expect(snapshot.notifications.routesSelected).toBe(1);
    expect(snapshot.notifications.deliveryPermitsPrepared).toBe(1);
    expect(snapshot.notifications.deliveriesSettled).toBe(0);
    expect(snapshot.notifications.underlyingTaskStatus).toBe('not-inferred');
    expect(snapshot.discord?.activeServiceAuthentications).toBe(1);

    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      'discord-account-alpha',
      'discord-policy-alpha',
      'slack-account-beta',
      'slack-policy-beta',
      'sender-1',
      'conversation-1',
      'private inbound body',
      'direct-destination-77',
      'private outbound body',
      'discord-destination-42',
      'workflow-run-123',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/credential|authorization|bearer|api[_-]?key/i);
  });

  it('bounds adapter summaries while preserving total configured count', () => {
    const h = harness(1);
    const snapshot = h.observability.snapshot();

    expect(snapshot.channels.adaptersConfigured).toBe(2);
    expect(snapshot.channels.adapterSummaries).toHaveLength(1);
    expect(snapshot.channels.adapterSummariesTruncated).toBe(true);
  });

  it('dispatches only exact empty channels.status input and remains non-authoritative', () => {
    const h = harness();
    const result = h.observability.dispatchState('channels.status', {});

    expect(result.format).toBe(FURY_GATEWAY_CHANNEL_OBSERVABILITY_RESULT_FORMAT);
    expect(result.status).toBe('ok');
    expect(result.executionAuthority).toBe(false);
    expect(result.result?.browserAuthority).toBe('none');
    expect(result.result?.executionAuthority).toBe(false);

    expect(h.observability.dispatchState('channels.status', {
      action: 'send-message',
    }).status).toBe('rejected');

    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'action', {
      enumerable: true,
      get: () => 'inspect',
    });
    expect(h.observability.dispatchState('channels.status', accessor).status)
      .toBe('rejected');

    expect(() => h.observability.dispatchState(
      'channels.execute' as never,
      {},
    )).toThrowError(/unsupported/u);
  });

  it('shows delivery ambiguity without promoting delivery, acknowledgement or task success', async () => {
    let now = 200_000;
    const channels = createFuryGatewayChannelAdapterRegistry({ now: () => now });
    channels.register({
      format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
      adapterId: 'discord-main',
      channelKind: 'discord',
      accountId: 'discord-account',
      policyProfileId: 'discord-policy',
      capabilities: ['outbound-message'],
    });
    const deliveries = createFuryGatewayChannelDeliveryCoordinator({
      adapterRegistry: channels,
      now: () => now,
      transportTimeoutMs: 1_000,
    });
    deliveries.registerTransport('discord-main', async () => {
      throw new Error('simulated ambiguous transport boundary');
    });
    const notifications = createFuryGatewayNotificationCoordinator({
      deliveryCoordinator: deliveries,
      now: () => now,
    });
    notifications.registerDestinationPolicy({
      format: FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
      policyKey: 'ops',
      adapterId: 'discord-main',
      destinationId: 'destination-1',
      allowedKinds: ['ci.completed'],
      allowedSeverities: ['info'],
    });
    const observer = createFuryGatewayChannelObservability({
      channelRegistry: channels,
      deliveryCoordinator: deliveries,
      notificationCoordinator: notifications,
      now: () => now,
    });

    const notification = notifications.createNotification({
      kind: 'ci.completed',
      severity: 'info',
      title: 'CI',
      summary: 'Unknown delivery simulation.',
      sourceEvidenceId: 'run-unknown',
      destinationPolicyKey: 'ops',
      acknowledgementRequired: true,
    });
    const route = notifications.selectDestination(notification);
    const permit = notifications.prepareDelivery(route);
    await expect(notifications.executeDelivery(route, permit)).rejects.toThrow();

    now += 1;
    const snapshot = observer.snapshot();
    expect(snapshot.delivery.counts['outcome-unknown']).toBe(1);
    expect(snapshot.notifications.deliveryStatuses['outcome-unknown']).toBe(1);
    expect(snapshot.notifications.deliveriesSettled).toBe(1);
    expect(snapshot.notifications.acknowledgementsPending).toBe(1);
    expect(snapshot.notifications.underlyingTaskStatus).toBe('not-inferred');
    expect(snapshot.executionAuthority).toBe(false);
  });
});
