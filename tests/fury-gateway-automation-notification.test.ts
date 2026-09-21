import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
  createFuryGatewayChannelAdapterRegistry,
} from '../src/gateway-channel-adapter-node.js';
import {
  createFuryGatewayChannelDeliveryCoordinator,
} from '../src/gateway-channel-delivery-node.js';
import {
  FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
  createFuryGatewayNotificationCoordinator,
} from '../src/gateway-notification-node.js';
import {
  FURY_GATEWAY_AUTOMATION_NOTIFICATION_PLAN_FORMAT,
  createFuryGatewayAutomationNotificationBridge,
  isGeneratedFuryGatewayAutomationNotificationBridge,
} from '../src/gateway-automation-notification-node.js';
import {
  createFuryGatewayAutomationDefinitionStore,
} from '../src/gateway-automation-definition-node.js';
import {
  createFuryGatewayAutomationRunLedger,
} from '../src/gateway-automation-run-ledger-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'furypipe-automation-notification-'),
  );
  tempDirs.push(dir);
  return dir;
}

function recovery(rootDir: string, namespace: string) {
  return createRecoveryStore(rootDir, {
    namespace,
    maxObjectBytes: 128 * 1024,
    maxTotalBytes: 16 * 1024 * 1024,
  });
}

async function harness(options: {
  readonly notificationConfigured?: boolean;
} = {}) {
  const dir = root();
  let now = 100_000;

  const definitions = createFuryGatewayAutomationDefinitionStore({
    store: recovery(dir, 'definitions'),
    now: () => now,
  });
  const definition = await definitions.create({
    automationId: 'private-notified-automation',
    ownerPrincipalId: 'principal:user-1',
    workflowId: 'workflow.private-notified',
    enabled: true,
    trigger: {
      kind: 'one-shot',
      at: now,
      misfirePolicy: 'run-once',
    },
    requestedScopes: ['automations.inspect'],
    requestedPluginPermissions: [],
    budgets: {
      maxWallTimeMs: 60_000,
      maxToolCalls: 4,
      maxProviderCalls: 2,
    },
    ...(options.notificationConfigured === false
      ? {}
      : { notificationPolicyKey: 'ops-automation-alerts' }),
  });

  const runs = createFuryGatewayAutomationRunLedger({
    store: recovery(dir, 'runs'),
    now: () => now,
  });
  const registered = await runs.registerTrigger({
    automationId: definition.definition.automationId,
    definitionRevision: definition.definition.revision,
    definitionSha256: definition.definitionSha256,
    sourceKind: 'one-shot',
    occurrenceKey: 'one-shot:' + now,
    scheduledFor: now,
  });

  const channels = createFuryGatewayChannelAdapterRegistry({
    now: () => now,
  });
  channels.register({
    format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
    adapterId: 'discord-main',
    channelKind: 'discord',
    accountId: 'private-discord-account',
    policyProfileId: 'private-discord-policy',
    capabilities: ['outbound-message'],
  });
  const deliveries = createFuryGatewayChannelDeliveryCoordinator({
    adapterRegistry: channels,
    now: () => now,
    defaultPermitTtlMs: 5_000,
    maxPermitTtlMs: 10_000,
    transportTimeoutMs: 1_000,
  });
  let deliveryCalls = 0;
  deliveries.registerTransport('discord-main', async () => {
    deliveryCalls += 1;
    return {
      outcome: 'delivered',
      providerMessageId: 'private-provider-message-id',
    };
  });
  const notifications = createFuryGatewayNotificationCoordinator({
    deliveryCoordinator: deliveries,
    now: () => now,
    deliveryPermitTtlMs: 5_000,
  });
  notifications.registerDestinationPolicy({
    format: FURY_GATEWAY_NOTIFICATION_POLICY_FORMAT,
    policyKey: 'ops-automation-alerts',
    adapterId: 'discord-main',
    destinationId: 'private-discord-destination',
    allowedKinds: [
      'automation.run.succeeded',
      'automation.run.failed',
      'automation.run.blocked',
      'automation.run.cancelled',
      'automation.run.outcome-unknown',
    ],
    allowedSeverities: ['info', 'warning', 'error'],
  });

  const intentStore = recovery(dir, 'notification-intents');
  const bridge = createFuryGatewayAutomationNotificationBridge({
    definitions,
    runs,
    notificationCoordinator: notifications,
    store: intentStore,
    now: () => now,
  });

  return {
    dir,
    definitions,
    definition,
    runs,
    registered,
    channels,
    deliveries,
    notifications,
    intentStore,
    bridge,
    get now() {
      return now;
    },
    setNow(value: number) {
      now = value;
    },
    get deliveryCalls() {
      return deliveryCalls;
    },
  };
}

async function settleKnown(
  h: Awaited<ReturnType<typeof harness>>,
  outcome: 'succeeded' | 'failed',
) {
  const claim = await h.runs.claim(
    h.registered.runIdSha256,
    'gateway-instance-a',
  );
  const armed = await h.runs.arm(claim);
  h.setNow(h.now + 1);
  return h.runs.settleArmed(armed, {
    outcome,
    evidenceSha256: outcome === 'succeeded'
      ? 'a'.repeat(64)
      : 'b'.repeat(64),
    now: h.now,
  });
}

describe('Fury Gateway automation notification bridge', () => {
  it('requires exact process-local dependencies', async () => {
    const h = await harness();
    expect(
      isGeneratedFuryGatewayAutomationNotificationBridge(h.bridge),
    ).toBe(true);
    expect(
      isGeneratedFuryGatewayAutomationNotificationBridge({ ...h.bridge }),
    ).toBe(false);

    expect(() => createFuryGatewayAutomationNotificationBridge({
      definitions: { ...h.definitions },
      runs: h.runs,
      notificationCoordinator: h.notifications,
      store: h.intentStore,
    } as never)).toThrow(/invalid/i);
  });

  it('does not notify pending or claimed runs', async () => {
    const h = await harness();

    const pending = await h.bridge.plan(h.registered.runIdSha256);
    expect(pending.format).toBe(FURY_GATEWAY_AUTOMATION_NOTIFICATION_PLAN_FORMAT);
    expect(pending.status).toBe('not-eligible');
    expect(pending.underlyingRunStatus).toBe('pending');
    expect(pending.underlyingTaskStatus).toBe('not-inferred');
    expect(pending.executionAuthority).toBe(false);
    expect(await h.bridge.intentCount()).toBe(0);

    await h.runs.claim(h.registered.runIdSha256, 'gateway-instance-a');
    const claimed = await h.bridge.plan(h.registered.runIdSha256);
    expect(claimed.status).toBe('not-eligible');
    expect(claimed.underlyingRunStatus).toBe('claimed');
    expect(await h.bridge.intentCount()).toBe(0);
  });

  it('returns not-configured without creating notification intent', async () => {
    const h = await harness({ notificationConfigured: false });
    await settleKnown(h, 'succeeded');

    const plan = await h.bridge.plan(h.registered.runIdSha256);

    expect(plan.status).toBe('not-configured');
    expect(plan.underlyingTaskStatus).toBe('not-inferred');
    expect(await h.bridge.intentCount()).toBe(0);
    expect(h.notifications.notificationCount()).toBe(0);
  });

  it('creates one downstream notification plan from known success evidence', async () => {
    const h = await harness();
    const terminal = await settleKnown(h, 'succeeded');

    const plan = await h.bridge.plan(h.registered.runIdSha256);

    expect(plan.status).toBe('created');
    expect(plan.underlyingRunStatus).toBe('terminal');
    expect(plan.underlyingTaskStatus).toBe('not-inferred');
    expect(plan.executionAuthority).toBe(false);
    expect(plan.notification?.kind).toBe('automation.run.succeeded');
    expect(plan.notification?.severity).toBe('info');
    expect(plan.notification?.executionAuthority).toBe(false);
    expect(plan.route?.executionAuthority).toBe(false);
    expect(await h.bridge.intentCount()).toBe(1);
    expect(h.notifications.notificationCount()).toBe(1);
    expect(h.notifications.routePlanCount()).toBe(1);

    const permit = h.notifications.prepareDelivery(plan.route!);
    const receipt = await h.notifications.executeDelivery(
      plan.route!,
      permit,
    );
    expect(receipt.delivery.status).toBe('delivered');
    expect(receipt.underlyingTaskStatus).toBe('not-inferred');
    expect(h.deliveryCalls).toBe(1);

    const afterDelivery = await h.runs.inspect(
      h.registered.runIdSha256,
      h.now,
    );
    expect(afterDelivery).toEqual(terminal);
    expect(afterDelivery?.state).toBe('terminal');
    if (afterDelivery?.state === 'terminal') {
      expect(afterDelivery.outcome).toBe('succeeded');
    }
  });

  it('plans outcome-unknown as acknowledgement-required without authorizing replay', async () => {
    const h = await harness();
    const claim = await h.runs.claim(
      h.registered.runIdSha256,
      'gateway-instance-a',
    );
    await h.runs.arm(claim);
    h.setNow(h.now + 1);

    const status = await h.runs.inspect(
      h.registered.runIdSha256,
      h.now,
    );
    expect(status?.state).toBe('outcome-unknown');

    const plan = await h.bridge.plan(h.registered.runIdSha256);
    expect(plan.status).toBe('created');
    expect(plan.notification?.kind).toBe('automation.run.outcome-unknown');
    expect(plan.notification?.severity).toBe('warning');
    expect(plan.notification?.acknowledgementRequired).toBe(true);
    expect(plan.underlyingTaskStatus).toBe('not-inferred');

    const afterPlan = await h.runs.inspect(
      h.registered.runIdSha256,
      h.now,
    );
    expect(afterPlan?.state).toBe('outcome-unknown');
    if (afterPlan?.state === 'outcome-unknown') {
      expect(afterPlan.automaticReplayAllowed).toBe(false);
    }
    expect(h.deliveryCalls).toBe(0);
  });

  it('returns the same process-local plan without duplicating notification state', async () => {
    const h = await harness();
    await settleKnown(h, 'failed');

    const first = await h.bridge.plan(h.registered.runIdSha256);
    const second = await h.bridge.plan(h.registered.runIdSha256);

    expect(first.status).toBe('created');
    expect(second.status).toBe('existing');
    expect(second.notification).toBe(first.notification);
    expect(second.route).toBe(first.route);
    expect(h.notifications.notificationCount()).toBe(1);
    expect(h.notifications.routePlanCount()).toBe(1);
    expect(await h.bridge.intentCount()).toBe(1);
  });

  it('requires reconciliation after bridge restart instead of recreating a durable intent', async () => {
    const h = await harness();
    await settleKnown(h, 'failed');
    const first = await h.bridge.plan(h.registered.runIdSha256);
    expect(first.status).toBe('created');

    const restarted = createFuryGatewayAutomationNotificationBridge({
      definitions: createFuryGatewayAutomationDefinitionStore({
        store: recovery(h.dir, 'definitions'),
        now: () => h.now,
      }),
      runs: createFuryGatewayAutomationRunLedger({
        store: recovery(h.dir, 'runs'),
        now: () => h.now,
      }),
      notificationCoordinator: h.notifications,
      store: recovery(h.dir, 'notification-intents'),
      now: () => h.now,
    });

    const recovered = await restarted.plan(h.registered.runIdSha256);

    expect(recovered.status).toBe('reconciliation-required');
    expect(recovered.notification).toBeUndefined();
    expect(recovered.route).toBeUndefined();
    expect(recovered.underlyingTaskStatus).toBe('not-inferred');
    expect(h.notifications.notificationCount()).toBe(1);
    expect(h.notifications.routePlanCount()).toBe(1);
    expect(await restarted.intentCount()).toBe(1);
  });

  it('resolves concurrent bridges to one durable notification intent', async () => {
    const h = await harness();
    await settleKnown(h, 'succeeded');

    const secondBridge = createFuryGatewayAutomationNotificationBridge({
      definitions: h.definitions,
      runs: h.runs,
      notificationCoordinator: h.notifications,
      store: h.intentStore,
      now: () => h.now,
    });

    const results = await Promise.all([
      h.bridge.plan(h.registered.runIdSha256),
      secondBridge.plan(h.registered.runIdSha256),
    ]);

    expect(results.map((entry) => entry.status).sort()).toEqual([
      'created',
      'reconciliation-required',
    ]);
    expect(await h.bridge.intentCount()).toBe(1);
    expect(h.notifications.notificationCount()).toBe(1);
    expect(h.notifications.routePlanCount()).toBe(1);
  });

  it('persists only digest metadata and not raw policy, automation, destination or payload text', async () => {
    const h = await harness();
    await settleKnown(h, 'succeeded');
    await h.bridge.plan(h.registered.runIdSha256);

    const handles = await h.intentStore.list?.({
      metadata: {
        system: 'gateway-automation-notification-intent',
        recordType: 'intent',
      },
      limit: 10,
    }) ?? [];
    expect(handles).toHaveLength(1);
    const stored = new TextDecoder().decode(
      await h.intentStore.get(handles[0]!),
    );

    for (const forbidden of [
      'ops-automation-alerts',
      'private-notified-automation',
      'private-discord-destination',
      'private-discord-account',
      'private-provider-message-id',
      'Automation run succeeded',
    ]) {
      expect(stored).not.toContain(forbidden);
    }
    expect(stored).toContain(h.registered.runIdSha256);
    expect(stored).toContain('notification-intent-evidence-only');
  });
});
