import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createFuryGatewayAutomationDefinitionStore,
} from '../src/gateway-automation-definition-node.js';
import {
  createFuryGatewayAutomationObservability,
} from '../src/gateway-automation-observability-node.js';
import {
  createFuryGatewayAutomationRunLedger,
} from '../src/gateway-automation-run-ledger-node.js';
import {
  createFuryGatewayAutomationScheduler,
} from '../src/gateway-automation-scheduler-node.js';
import {
  FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT,
  createFuryGatewayAutomationWebhookCoordinator,
  signFuryGatewayAutomationWebhookRequest,
} from '../src/gateway-automation-webhook-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'furypipe-automation-phase5-final-'),
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

describe('Fury Gateway Phase 5 final durability evidence', () => {
  it('recovers an armed crash as outcome-unknown and never reclaims it automatically', async () => {
    const dir = root();
    let now = 100_000;
    const runStore = recovery(dir, 'runs');

    const first = createFuryGatewayAutomationRunLedger({
      store: runStore,
      now: () => now,
    });
    const pending = await first.registerTrigger({
      automationId: 'durable-crash-proof',
      definitionRevision: 1,
      definitionSha256: 'a'.repeat(64),
      sourceKind: 'one-shot',
      occurrenceKey: 'one-shot:100000',
      scheduledFor: now,
    });
    const claim = await first.claim(
      pending.runIdSha256,
      'gateway-instance-before-crash',
    );
    await first.arm(claim);

    now += 5_000;
    const restarted = createFuryGatewayAutomationRunLedger({
      store: recovery(dir, 'runs'),
      now: () => now,
    });
    const recovered = await restarted.inspect(pending.runIdSha256, now);

    expect(recovered?.state).toBe('outcome-unknown');
    if (recovered?.state === 'outcome-unknown') {
      expect(recovered.automaticReplayAllowed).toBe(false);
    }
    await expect(
      restarted.claim(
        pending.runIdSha256,
        'gateway-instance-after-crash',
      ),
    ).rejects.toMatchObject({
      name: 'FuryGatewayAutomationRunLedgerError',
      code: 'run-conflict',
      retrySafe: false,
    });
  });

  it('converges two cron schedulers on one durable occurrence and one claim', async () => {
    const dir = root();
    let now = 0;
    const definitions = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir, 'definitions'),
      now: () => now,
    });
    await definitions.create({
      automationId: 'cron-race-proof',
      ownerPrincipalId: 'principal:user-1',
      workflowId: 'workflow.cron-race-proof',
      enabled: true,
      trigger: {
        kind: 'cron',
        expression: '* * * * *',
        timeZone: 'UTC',
        misfirePolicy: 'run-once',
      },
      requestedScopes: ['automations.inspect'],
      requestedPluginPermissions: [],
      budgets: {
        maxWallTimeMs: 60_000,
        maxToolCalls: 2,
        maxProviderCalls: 1,
      },
    });

    const runs = createFuryGatewayAutomationRunLedger({
      store: recovery(dir, 'runs'),
      now: () => now,
    });
    const first = createFuryGatewayAutomationScheduler({
      definitions,
      runs,
      now: () => now,
    });
    const second = createFuryGatewayAutomationScheduler({
      definitions,
      runs,
      now: () => now,
    });

    now = 60_000;
    const [left, right] = await Promise.all([
      first.tick('cron-race-proof', 'gateway-instance-a'),
      second.tick('cron-race-proof', 'gateway-instance-b'),
    ]);

    expect([left.decision, right.decision].sort())
      .toEqual(['claimed', 'observed']);
    expect(left.run?.runIdSha256).toBe(right.run?.runIdSha256);
    expect(await runs.countRuns()).toBe(1);
  });

  it('treats authenticated webhook payload as data only and never as requested authority', async () => {
    const dir = root();
    let now = 1_000_000;
    const definitions = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir, 'definitions'),
      now: () => now,
    });
    await definitions.create({
      automationId: 'payload-authority-proof',
      ownerPrincipalId: 'principal:user-1',
      workflowId: 'workflow.payload-authority-proof',
      enabled: true,
      trigger: {
        kind: 'webhook',
        sourceId: 'external-source',
      },
      requestedScopes: ['automations.inspect'],
      requestedPluginPermissions: [],
      budgets: {
        maxWallTimeMs: 60_000,
        maxToolCalls: 1,
        maxProviderCalls: 0,
      },
    });

    const runs = createFuryGatewayAutomationRunLedger({
      store: recovery(dir, 'runs'),
      now: () => now,
    });
    const secret = new TextEncoder().encode(
      '0123456789abcdef0123456789abcdef',
    );
    const webhook = createFuryGatewayAutomationWebhookCoordinator({
      definitions,
      runs,
      store: recovery(dir, 'webhooks'),
      now: () => now,
    });
    webhook.registerSource({
      format: FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT,
      sourceId: 'external-source',
      secret,
    });

    const payloadText = JSON.stringify({
      requestedScopes: [
        'automations.manage',
        'capability.provider-inference',
      ],
      requestedPluginPermissions: ['provider-inference'],
      secret: 'payload-must-remain-untrusted-data',
    });
    const body = new TextEncoder().encode(payloadText);
    const eventId = 'evt-authority-attempt';
    const signature = signFuryGatewayAutomationWebhookRequest(secret, {
      sourceId: 'external-source',
      eventId,
      signedAt: now,
      body,
    });

    const receipt = await webhook.ingest({
      automationId: 'payload-authority-proof',
      sourceId: 'external-source',
      eventId,
      signedAt: now,
      contentType: 'application/json',
      body,
      signature,
    });

    expect(receipt.executionAuthority).toBe(false);
    expect(receipt.run.state).toBe('pending');

    const durableDefinition = await definitions.inspect(
      'payload-authority-proof',
    );
    expect(durableDefinition?.definition.requestedScopes)
      .toEqual(['automations.inspect']);
    expect(durableDefinition?.definition.requestedPluginPermissions)
      .toEqual([]);

    const observer = createFuryGatewayAutomationObservability({
      definitions,
      runs,
      now: () => now,
    });
    const snapshot = await observer.snapshot();
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.executionAuthority).toBe(false);
    expect(serialized).not.toContain(payloadText);
    expect(serialized).not.toContain(
      'payload-must-remain-untrusted-data',
    );
    expect(serialized).not.toContain(eventId);
    expect(serialized).not.toContain('principal:user-1');
    expect(serialized).not.toContain('external-source');
  });

  it('keeps exact webhook replay idempotent across coordinator restart', async () => {
    const dir = root();
    const now = 2_000_000;
    const definitions = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir, 'definitions'),
      now: () => now,
    });
    await definitions.create({
      automationId: 'webhook-restart-proof',
      ownerPrincipalId: 'principal:user-1',
      workflowId: 'workflow.webhook-restart-proof',
      enabled: true,
      trigger: {
        kind: 'webhook',
        sourceId: 'restart-source',
      },
      requestedScopes: ['automations.inspect'],
      requestedPluginPermissions: [],
      budgets: {
        maxWallTimeMs: 60_000,
        maxToolCalls: 1,
        maxProviderCalls: 0,
      },
    });

    const secret = new TextEncoder().encode(
      'fedcba9876543210fedcba9876543210',
    );
    const body = new TextEncoder().encode('{"event":"once"}');
    const eventId = 'evt-restart-once';
    const signature = signFuryGatewayAutomationWebhookRequest(secret, {
      sourceId: 'restart-source',
      eventId,
      signedAt: now,
      body,
    });

    const createCoordinator = () => {
      const runs = createFuryGatewayAutomationRunLedger({
        store: recovery(dir, 'runs'),
        now: () => now,
      });
      const webhook = createFuryGatewayAutomationWebhookCoordinator({
        definitions,
        runs,
        store: recovery(dir, 'webhooks'),
        now: () => now,
      });
      webhook.registerSource({
        format: FURY_GATEWAY_AUTOMATION_WEBHOOK_SOURCE_FORMAT,
        sourceId: 'restart-source',
        secret,
      });
      return { runs, webhook };
    };

    const first = createCoordinator();
    const firstReceipt = await first.webhook.ingest({
      automationId: 'webhook-restart-proof',
      sourceId: 'restart-source',
      eventId,
      signedAt: now,
      contentType: 'application/json',
      body,
      signature,
    });

    const restarted = createCoordinator();
    const replayReceipt = await restarted.webhook.ingest({
      automationId: 'webhook-restart-proof',
      sourceId: 'restart-source',
      eventId,
      signedAt: now,
      contentType: 'application/json',
      body,
      signature,
    });

    expect(firstReceipt.duplicate).toBe(false);
    expect(replayReceipt.duplicate).toBe(true);
    expect(replayReceipt.run.runIdSha256)
      .toBe(firstReceipt.run.runIdSha256);
    expect(await restarted.runs.countRuns()).toBe(1);
    expect(await restarted.webhook.acceptedEventCount()).toBe(1);
  });
});
