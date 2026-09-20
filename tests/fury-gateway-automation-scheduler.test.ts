import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createFuryGatewayAutomationDefinitionStore,
} from '../src/gateway-automation-definition-node.js';
import {
  createFuryGatewayAutomationRunLedger,
} from '../src/gateway-automation-run-ledger-node.js';
import {
  FuryGatewayAutomationSchedulerError,
  createFuryGatewayAutomationScheduler,
  isGeneratedFuryGatewayAutomationScheduler,
} from '../src/gateway-automation-scheduler-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-automation-scheduler-'));
  tempDirs.push(dir);
  return dir;
}

function recovery(rootDir: string, namespace: string) {
  return createRecoveryStore(rootDir, {
    namespace,
    maxObjectBytes: 64 * 1024,
    maxTotalBytes: 16 * 1024 * 1024,
  });
}

function definitionInput(
  trigger: unknown,
  overrides: Record<string, unknown> = {},
) {
  return {
    automationId: 'morning-brief',
    ownerPrincipalId: 'local-owner',
    workflowId: 'workflow.morning-brief',
    enabled: true,
    trigger,
    requestedScopes: ['automations.inspect'],
    requestedPluginPermissions: [],
    budgets: {
      maxWallTimeMs: 60_000,
      maxToolCalls: 5,
      maxProviderCalls: 2,
    },
    ...overrides,
  };
}

async function harness(
  trigger: unknown,
  options: {
    readonly now?: number;
    readonly enabled?: boolean;
    readonly misfireGraceMs?: number;
    readonly claimLeaseMs?: number;
  } = {},
) {
  const dir = root();
  let clock = options.now ?? 0;
  const definitions = createFuryGatewayAutomationDefinitionStore({
    store: recovery(dir, 'definitions'),
    now: () => clock,
  });
  await definitions.create(definitionInput(trigger, {
    enabled: options.enabled ?? true,
  }) as never);

  const runs = createFuryGatewayAutomationRunLedger({
    store: recovery(dir, 'runs'),
    now: () => clock,
  });
  const scheduler = createFuryGatewayAutomationScheduler({
    definitions,
    runs,
    now: () => clock,
    ...(options.misfireGraceMs === undefined
      ? {}
      : { misfireGraceMs: options.misfireGraceMs }),
    ...(options.claimLeaseMs === undefined
      ? {}
      : { claimLeaseMs: options.claimLeaseMs }),
  });

  return {
    dir,
    definitions,
    runs,
    scheduler,
    setNow(value: number) {
      clock = value;
    },
  };
}

describe('Fury Gateway one-shot + interval scheduler', () => {
  it('does not create a run for a disabled automation', async () => {
    const h = await harness({
      kind: 'one-shot',
      at: 1_000,
      misfirePolicy: 'run-once',
    }, {
      now: 2_000,
      enabled: false,
    });

    const tick = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('disabled');
    expect(tick.executionAuthority).toBe(false);
    expect(await h.runs.countRuns()).toBe(0);
  });

  it('reports a future one-shot as not due without creating durable run state', async () => {
    const h = await harness({
      kind: 'one-shot',
      at: 10_000,
      misfirePolicy: 'run-once',
    }, { now: 5_000 });

    const tick = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('not-due');
    expect(tick.nextDueAt).toBe(10_000);
    expect(await h.runs.countRuns()).toBe(0);
  });

  it('runs an overdue one-shot exactly once under run-once semantics', async () => {
    const h = await harness({
      kind: 'one-shot',
      at: 1_000,
      misfirePolicy: 'run-once',
    }, {
      now: 100_000,
      misfireGraceMs: 1_000,
    });

    const first = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );
    const second = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );

    expect(first.decision).toBe('claimed');
    expect(first.scheduledFor).toBe(1_000);
    expect(second.decision).toBe('observed');
    expect(second.run?.runIdSha256).toBe(first.run?.runIdSha256);
    expect(await h.runs.countRuns()).toBe(1);
  });

  it('skips an overdue one-shot when skip grace is exceeded', async () => {
    const h = await harness({
      kind: 'one-shot',
      at: 1_000,
      misfirePolicy: 'skip',
    }, {
      now: 10_000,
      misfireGraceMs: 500,
    });

    const tick = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('misfire-skipped');
    expect(tick.scheduledFor).toBe(1_000);
    expect(await h.runs.countRuns()).toBe(0);
  });

  it('accepts a skip one-shot that is still inside its explicit grace window', async () => {
    const h = await harness({
      kind: 'one-shot',
      at: 1_000,
      misfirePolicy: 'skip',
    }, {
      now: 1_400,
      misfireGraceMs: 500,
    });

    const tick = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('claimed');
    expect(tick.scheduledFor).toBe(1_000);
    expect(await h.runs.countRuns()).toBe(1);
  });

  it('coalesces an interval backlog to one latest logical occurrence', async () => {
    const h = await harness({
      kind: 'interval',
      everyMs: 1_000,
      startAt: 1_000,
      misfirePolicy: 'run-once',
    }, {
      now: 10_900,
      misfireGraceMs: 100,
    });

    const tick = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('claimed');
    expect(tick.scheduledFor).toBe(10_000);
    expect(tick.nextDueAt).toBe(11_000);
    expect(await h.runs.countRuns()).toBe(1);
  });

  it('does not create catch-up backlog for an interval using skip', async () => {
    const h = await harness({
      kind: 'interval',
      everyMs: 1_000,
      startAt: 1_000,
      misfirePolicy: 'skip',
    }, {
      now: 10_900,
      misfireGraceMs: 100,
    });

    const skipped = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );
    expect(skipped.decision).toBe('misfire-skipped');
    expect(skipped.scheduledFor).toBe(10_000);
    expect(skipped.nextDueAt).toBe(11_000);
    expect(await h.runs.countRuns()).toBe(0);

    h.setNow(11_050);
    const current = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );
    expect(current.decision).toBe('claimed');
    expect(current.scheduledFor).toBe(11_000);
    expect(await h.runs.countRuns()).toBe(1);
  });

  it('uses the last valid interval occurrence before endAt and never invents a later one', async () => {
    const h = await harness({
      kind: 'interval',
      everyMs: 1_000,
      startAt: 1_000,
      endAt: 5_500,
      misfirePolicy: 'run-once',
    }, { now: 50_000 });

    const tick = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('claimed');
    expect(tick.scheduledFor).toBe(5_000);
    expect(tick.nextDueAt).toBeUndefined();
    expect(await h.runs.countRuns()).toBe(1);
  });

  it('blocks clock rollback from creating an older interval run', async () => {
    const h = await harness({
      kind: 'interval',
      everyMs: 1_000,
      startAt: 1_000,
      misfirePolicy: 'run-once',
    }, { now: 5_100 });

    const first = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );
    expect(first.scheduledFor).toBe(5_000);
    expect(first.decision).toBe('claimed');

    h.setNow(4_100);
    const rollback = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-b',
    );

    expect(rollback.decision).toBe('clock-regression-ignored');
    expect(rollback.scheduledFor).toBe(4_000);
    expect(rollback.nextDueAt).toBe(6_000);
    expect(await h.runs.countRuns()).toBe(1);
  });

  it('deduplicates the same interval occurrence after a definition revision', async () => {
    const h = await harness({
      kind: 'interval',
      everyMs: 10_000,
      startAt: 10_000,
      misfirePolicy: 'run-once',
    }, { now: 10_100 });

    const first = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );
    expect(first.decision).toBe('claimed');

    await h.definitions.revise({
      automationId: 'morning-brief',
      expectedRevision: 1,
      reason: 'Budget-neutral metadata revision.',
    });

    const second = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-b',
    );

    expect(second.decision).toBe('observed');
    expect(second.run?.runIdSha256).toBe(first.run?.runIdSha256);
    expect(await h.runs.countRuns()).toBe(1);
  });

  it('resolves a two-scheduler race to one claim without duplicate runs', async () => {
    const dir = root();
    const clock = 10_100;
    const definitions = createFuryGatewayAutomationDefinitionStore({
      store: recovery(dir, 'definitions'),
      now: () => clock,
    });
    await definitions.create(definitionInput({
      kind: 'interval',
      everyMs: 10_000,
      startAt: 10_000,
      misfirePolicy: 'run-once',
    }) as never);
    const runs = createFuryGatewayAutomationRunLedger({
      store: recovery(dir, 'runs'),
      now: () => clock,
    });
    const firstScheduler = createFuryGatewayAutomationScheduler({
      definitions,
      runs,
      now: () => clock,
    });
    const secondScheduler = createFuryGatewayAutomationScheduler({
      definitions,
      runs,
      now: () => clock,
    });

    const [first, second] = await Promise.all([
      firstScheduler.tick('morning-brief', 'gateway-instance-a'),
      secondScheduler.tick('morning-brief', 'gateway-instance-b'),
    ]);

    expect([first.decision, second.decision].sort())
      .toEqual(['claimed', 'observed']);
    expect(await runs.countRuns()).toBe(1);
    expect(first.run?.runIdSha256).toBe(second.run?.runIdSha256);
  });

  it('passes a bounded claim lease into the durable run ledger', async () => {
    const h = await harness({
      kind: 'one-shot',
      at: 1_000,
      misfirePolicy: 'run-once',
    }, {
      now: 1_000,
      claimLeaseMs: 12_345,
    });

    const tick = await h.scheduler.tick(
      'morning-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('claimed');
    expect(tick.claim?.leaseExpiresAt).toBe(13_345);
  });

  it('marks only genuine generated schedulers as process-local wrappers', async () => {
    const h = await harness({
      kind: 'one-shot',
      at: 1_000,
      misfirePolicy: 'run-once',
    }, { now: 0 });

    expect(isGeneratedFuryGatewayAutomationScheduler(h.scheduler)).toBe(true);
    expect(isGeneratedFuryGatewayAutomationScheduler({ ...h.scheduler })).toBe(false);
    expect(new FuryGatewayAutomationSchedulerError('invalid-options'))
      .toBeInstanceOf(Error);
  });
});
