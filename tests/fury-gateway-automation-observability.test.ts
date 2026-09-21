import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  FURY_GATEWAY_AUTOMATION_OBSERVABILITY_COMMAND_DEFINITIONS,
} from '../src/gateway-automation-observability-command-node.js';
import {
  FURY_GATEWAY_AUTOMATION_OBSERVABILITY_FORMAT,
  FURY_GATEWAY_AUTOMATION_OBSERVABILITY_RESULT_FORMAT,
  createFuryGatewayAutomationObservability,
  isGeneratedFuryGatewayAutomationObservability,
} from '../src/gateway-automation-observability-node.js';
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
    path.join(os.tmpdir(), 'furypipe-automation-observability-'),
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function harness(options: {
  readonly maxAutomationSummaries?: number;
  readonly maxRunSummaries?: number;
} = {}) {
  const dir = root();
  let now = 1_000_000;
  const definitions = createFuryGatewayAutomationDefinitionStore({
    store: recovery(dir, 'definitions'),
    now: () => now,
  });
  const primary = await definitions.create({
    automationId: 'private-daily-brief',
    ownerPrincipalId: 'private-owner-principal',
    workflowId: 'private-workflow-name',
    enabled: true,
    trigger: {
      kind: 'cron',
      expression: '0 9 * * *',
      timeZone: 'Europe/Paris',
      misfirePolicy: 'run-once',
    },
    requestedScopes: ['automations.inspect'],
    requestedPluginPermissions: [],
    budgets: {
      maxWallTimeMs: 60_000,
      maxToolCalls: 5,
      maxProviderCalls: 2,
    },
    notificationPolicyKey: 'private-ops-policy',
    reason: 'private internal reason that observability must not expose',
  });
  const secondary = await definitions.create({
    automationId: 'private-webhook-build',
    ownerPrincipalId: 'private-owner-principal',
    workflowId: 'private-webhook-workflow',
    enabled: false,
    trigger: {
      kind: 'webhook',
      sourceId: 'github-events',
    },
    requestedScopes: ['automations.inspect'],
    requestedPluginPermissions: [],
    budgets: {
      maxWallTimeMs: 30_000,
      maxToolCalls: 2,
      maxProviderCalls: 1,
    },
  });

  const runs = createFuryGatewayAutomationRunLedger({
    store: recovery(dir, 'runs'),
    now: () => now,
  });
  const first = await runs.registerTrigger({
    automationId: primary.definition.automationId,
    definitionRevision: primary.definition.revision,
    definitionSha256: primary.definitionSha256,
    sourceKind: 'cron',
    occurrenceKey: 'cron:1000000',
    scheduledFor: now,
  });
  const claim = await runs.claim(first.runIdSha256, 'gateway-instance-a');
  const armed = await runs.arm(claim);
  await runs.settleArmed(armed, {
    outcome: 'succeeded',
    evidenceSha256: 'a'.repeat(64),
    now: now + 1,
  });

  now += 2;
  await runs.registerTrigger({
    automationId: secondary.definition.automationId,
    definitionRevision: secondary.definition.revision,
    definitionSha256: secondary.definitionSha256,
    sourceKind: 'webhook',
    occurrenceKey: 'webhook:github-events:event-2',
    scheduledFor: now,
  });

  const observability = createFuryGatewayAutomationObservability({
    definitions,
    runs,
    now: () => now,
    ...(options.maxAutomationSummaries === undefined
      ? {}
      : { maxAutomationSummaries: options.maxAutomationSummaries }),
    ...(options.maxRunSummaries === undefined
      ? {}
      : { maxRunSummaries: options.maxRunSummaries }),
  });

  return {
    definitions,
    runs,
    observability,
    primary,
    secondary,
    get now() {
      return now;
    },
  };
}

describe('Fury Gateway automation observability', () => {
  it('defines an inspect-only automations.status command', () => {
    expect(FURY_GATEWAY_AUTOMATION_OBSERVABILITY_COMMAND_DEFINITIONS).toEqual([
      {
        format: 'furypipe-gateway-command-definition/v1',
        name: 'automations.status',
        allowedRoles: ['operator'],
        requiredScopes: ['automations.inspect'],
        requiredPluginPermissions: [],
        riskClass: 'inspect',
        requiresFreshApproval: false,
      },
    ]);
  });

  it('requires process-local generated stores', async () => {
    const h = await harness();
    expect(isGeneratedFuryGatewayAutomationObservability(h.observability))
      .toBe(true);
    expect(isGeneratedFuryGatewayAutomationObservability({
      ...h.observability,
    })).toBe(false);

    expect(() => createFuryGatewayAutomationObservability({
      definitions: { ...h.definitions },
      runs: h.runs,
    } as never)).toThrow(/process-local definition and run stores/u);
  });

  it('projects redacted definition and run lifecycle state only', async () => {
    const h = await harness();
    const snapshot = await h.observability.snapshot();

    expect(snapshot.format).toBe(FURY_GATEWAY_AUTOMATION_OBSERVABILITY_FORMAT);
    expect(snapshot.executionAuthority).toBe(false);
    expect(snapshot.authority).toBe('observability-only');
    expect(snapshot.automations.total).toBe(2);
    expect(snapshot.automations.enabled).toBe(1);
    expect(snapshot.automations.disabled).toBe(1);
    expect(snapshot.automations.notificationConfigured).toBe(1);
    expect(snapshot.automations.byTriggerKind.cron).toBe(1);
    expect(snapshot.automations.byTriggerKind.webhook).toBe(1);
    expect(snapshot.runs.total).toBe(2);
    expect(snapshot.runs.summarized).toBe(2);
    expect(snapshot.runs.summarizedByState.terminal).toBe(1);
    expect(snapshot.runs.summarizedByState.pending).toBe(1);

    const primarySummary = snapshot.automations.summaries.find(
      (entry) =>
        entry.automationIdSha256
        === sha256(h.primary.definition.automationId),
    );
    expect(primarySummary?.notificationConfigured).toBe(true);
    expect(primarySummary?.executionAuthority).toBe(false);

    const terminal = snapshot.runs.recent.find(
      (entry) => entry.state === 'terminal',
    );
    expect(terminal?.outcome).toBe('succeeded');
    expect(terminal?.automaticReplayAllowed).toBe(false);
    expect(terminal?.executionAuthority).toBe(false);

    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      'private-daily-brief',
      'private-webhook-build',
      'private-owner-principal',
      'private-workflow-name',
      'private-webhook-workflow',
      'private-ops-policy',
      'private internal reason',
      'github-events',
      'occurrenceKey',
      'claimId',
      'session',
      'permit',
      'credential',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('bounds summaries while preserving total counts and explicit truncation', async () => {
    const h = await harness({
      maxAutomationSummaries: 1,
      maxRunSummaries: 1,
    });
    const snapshot = await h.observability.snapshot();

    expect(snapshot.automations.total).toBe(2);
    expect(snapshot.automations.summaries).toHaveLength(1);
    expect(snapshot.automations.summariesTruncated).toBe(true);
    expect(snapshot.runs.total).toBe(2);
    expect(snapshot.runs.recent).toHaveLength(1);
    expect(snapshot.runs.summariesTruncated).toBe(true);
    expect(
      Object.values(snapshot.runs.summarizedByState)
        .reduce((left, right) => left + right, 0),
    ).toBe(1);
  });

  it('dispatches only exact empty automations.status input', async () => {
    const h = await harness();
    const result = await h.observability.dispatchState(
      'automations.status',
      {},
    );

    expect(result.format)
      .toBe(FURY_GATEWAY_AUTOMATION_OBSERVABILITY_RESULT_FORMAT);
    expect(result.status).toBe('ok');
    expect(result.executionAuthority).toBe(false);
    expect(result.result?.executionAuthority).toBe(false);

    expect(
      (await h.observability.dispatchState(
        'automations.status',
        { execute: true },
      )).status,
    ).toBe('rejected');

    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'run', {
      enumerable: true,
      get: () => 'now',
    });
    expect(
      (await h.observability.dispatchState(
        'automations.status',
        accessor,
      )).status,
    ).toBe('rejected');

    await expect(h.observability.dispatchState(
      'automations.execute' as never,
      {},
    )).rejects.toThrow(/unsupported/u);
  });
});
