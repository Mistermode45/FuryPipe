import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  FuryGatewayAutomationCronError,
  findFuryGatewayCronOccurrenceAtOrBefore,
  findNextFuryGatewayCronOccurrence,
  normalizeFuryGatewayCronExpression,
  normalizeFuryGatewayCronSchedule,
  normalizeFuryGatewayCronTimeZone,
} from '../src/gateway-automation-cron-node.js';
import {
  createFuryGatewayAutomationDefinitionStore,
} from '../src/gateway-automation-definition-node.js';
import {
  createFuryGatewayAutomationRunLedger,
} from '../src/gateway-automation-run-ledger-node.js';
import {
  createFuryGatewayAutomationScheduler,
} from '../src/gateway-automation-scheduler-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-automation-cron-'));
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

function definitionInput(
  trigger: unknown,
) {
  return {
    automationId: 'cron-brief',
    ownerPrincipalId: 'principal:user-1',
    workflowId: 'workflow.cron-brief',
    enabled: true,
    trigger,
    requestedScopes: ['automations.inspect'],
    requestedPluginPermissions: [],
    budgets: {
      maxWallTimeMs: 60_000,
      maxToolCalls: 5,
      maxProviderCalls: 2,
    },
  };
}

async function harness(options: {
  readonly createAt: number;
  readonly now: number;
  readonly expression: string;
  readonly timeZone: string;
  readonly misfirePolicy?: 'skip' | 'run-once';
  readonly startAt?: number;
  readonly endAt?: number;
  readonly misfireGraceMs?: number;
}) {
  const dir = root();
  let clock = options.createAt;
  const definitions = createFuryGatewayAutomationDefinitionStore({
    store: recovery(dir, 'definitions'),
    now: () => clock,
  });
  const definition = await definitions.create(definitionInput({
    kind: 'cron',
    expression: options.expression,
    timeZone: options.timeZone,
    ...(options.startAt === undefined ? {} : { startAt: options.startAt }),
    ...(options.endAt === undefined ? {} : { endAt: options.endAt }),
    misfirePolicy: options.misfirePolicy ?? 'run-once',
  }) as never);

  clock = options.now;
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
  });

  return {
    definition,
    definitions,
    runs,
    scheduler,
    get now() {
      return clock;
    },
    setNow(value: number) {
      clock = value;
    },
  };
}

describe('Fury Gateway cron scheduler', () => {
  it('normalizes the supported five-field cron grammar and IANA time zone', () => {
    expect(
      normalizeFuryGatewayCronExpression('*/15   8-18 * * 1-5'),
    ).toBe('*/15 8-18 * * 1-5');
    expect(normalizeFuryGatewayCronTimeZone('Europe/Paris'))
      .toBe('Europe/Paris');
    expect(
      normalizeFuryGatewayCronSchedule(
        '0 9 * * 1-5',
        'Europe/Paris',
      ),
    ).toEqual({
      format: 'furypipe-gateway-cron/v1',
      expression: '0 9 * * 1-5',
      timeZone: 'Europe/Paris',
    });
  });

  it('rejects malformed fields, unsupported names and invalid time zones', () => {
    for (const expression of [
      '60 9 * * *',
      '0 24 * * *',
      '0 9 0 * *',
      '0 9 * 13 *',
      '0 9 * * 8',
      '0 9 * JAN *',
      '0 9 * *',
      '0 9 * * * extra',
      '*/0 9 * * *',
      '0 9 10-1 * *',
    ]) {
      expect(() => normalizeFuryGatewayCronExpression(expression))
        .toThrow(FuryGatewayAutomationCronError);
    }
    expect(() => normalizeFuryGatewayCronTimeZone('Mars/Olympus_Mons'))
      .toThrow(FuryGatewayAutomationCronError);
  });

  it('stores only normalized cron policy data in the durable definition', async () => {
    const createAt = Date.UTC(2026, 8, 20, 12, 0);
    const h = await harness({
      createAt,
      now: createAt,
      expression: '0   9 * * 1-5',
      timeZone: 'Europe/Paris',
    });

    expect(h.definition.definition.trigger).toEqual({
      kind: 'cron',
      expression: '0 9 * * 1-5',
      timeZone: 'Europe/Paris',
      misfirePolicy: 'run-once',
    });
    expect(h.definition.definition.executionAuthority).toBe(false);
  });

  it('runs only the latest missed daily occurrence under run-once semantics', async () => {
    const h = await harness({
      createAt: Date.UTC(2026, 8, 18, 12, 0),
      now: Date.UTC(2026, 8, 21, 7, 5),
      expression: '0 9 * * *',
      timeZone: 'Europe/Paris',
      misfirePolicy: 'run-once',
    });

    const first = await h.scheduler.tick(
      'cron-brief',
      'gateway-instance-a',
    );
    const second = await h.scheduler.tick(
      'cron-brief',
      'gateway-instance-b',
    );

    expect(first.decision).toBe('claimed');
    expect(first.scheduledFor).toBe(Date.UTC(2026, 8, 21, 7, 0));
    expect(first.nextDueAt).toBe(Date.UTC(2026, 8, 22, 7, 0));
    expect(second.decision).toBe('observed');
    expect(second.run?.runIdSha256).toBe(first.run?.runIdSha256);
    expect(await h.runs.countRuns()).toBe(1);
  });

  it('skips an overdue cron occurrence outside explicit misfire grace', async () => {
    const h = await harness({
      createAt: Date.UTC(2026, 8, 20, 0, 0),
      now: Date.UTC(2026, 8, 21, 7, 5),
      expression: '0 9 * * *',
      timeZone: 'Europe/Paris',
      misfirePolicy: 'skip',
      misfireGraceMs: 60_000,
    });

    const tick = await h.scheduler.tick(
      'cron-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('misfire-skipped');
    expect(tick.scheduledFor).toBe(Date.UTC(2026, 8, 21, 7, 0));
    expect(tick.nextDueAt).toBe(Date.UTC(2026, 8, 22, 7, 0));
    expect(await h.runs.countRuns()).toBe(0);
  });

  it('does not backfill cron occurrences that predate definition creation', async () => {
    const h = await harness({
      createAt: Date.UTC(2026, 8, 21, 7, 30),
      now: Date.UTC(2026, 8, 21, 7, 31),
      expression: '0 9 * * *',
      timeZone: 'Europe/Paris',
    });

    const tick = await h.scheduler.tick(
      'cron-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('not-due');
    expect(tick.nextDueAt).toBe(Date.UTC(2026, 8, 22, 7, 0));
    expect(await h.runs.countRuns()).toBe(0);
  });

  it('skips a nonexistent spring-forward wall-clock minute', async () => {
    const startAt = Date.UTC(2026, 2, 29, 0, 0);
    const h = await harness({
      createAt: startAt,
      startAt,
      now: Date.UTC(2026, 2, 29, 2, 30),
      expression: '30 2 * * *',
      timeZone: 'Europe/Paris',
    });

    const tick = await h.scheduler.tick(
      'cron-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('not-due');
    expect(tick.nextDueAt).toBe(Date.UTC(2026, 2, 30, 0, 30));
    expect(await h.runs.countRuns()).toBe(0);
  });

  it('treats both fall-back wall-clock repeats as distinct UTC occurrences', async () => {
    const h = await harness({
      createAt: Date.UTC(2026, 9, 25, 0, 0),
      now: Date.UTC(2026, 9, 25, 0, 40),
      expression: '30 2 * * *',
      timeZone: 'Europe/Paris',
    });

    const first = await h.scheduler.tick(
      'cron-brief',
      'gateway-instance-a',
    );
    expect(first.decision).toBe('claimed');
    expect(first.scheduledFor).toBe(Date.UTC(2026, 9, 25, 0, 30));

    h.setNow(Date.UTC(2026, 9, 25, 1, 40));
    const second = await h.scheduler.tick(
      'cron-brief',
      'gateway-instance-b',
    );
    expect(second.decision).toBe('claimed');
    expect(second.scheduledFor).toBe(Date.UTC(2026, 9, 25, 1, 30));
    expect(second.run?.runIdSha256).not.toBe(first.run?.runIdSha256);
    expect(await h.runs.countRuns()).toBe(2);

    h.setNow(Date.UTC(2026, 9, 25, 0, 40));
    const rollback = await h.scheduler.tick(
      'cron-brief',
      'gateway-instance-c',
    );
    expect(rollback.decision).toBe('clock-regression-ignored');
    expect(rollback.scheduledFor).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(rollback.nextDueAt).toBe(Date.UTC(2026, 9, 26, 1, 30));
    expect(await h.runs.countRuns()).toBe(2);
  });

  it('uses Vixie-style OR semantics when both day-of-month and day-of-week are restricted', () => {
    const firstMonday = findNextFuryGatewayCronOccurrence({
      expression: '0 9 15 * 1',
      timeZone: 'UTC',
      lowerBound: Date.UTC(2026, 6, 5, 0, 0),
      afterExclusive: Date.UTC(2026, 6, 5, 0, 0),
    });
    expect(firstMonday).toBe(Date.UTC(2026, 6, 6, 9, 0));

    const fifteenth = findNextFuryGatewayCronOccurrence({
      expression: '0 9 15 * 1',
      timeZone: 'UTC',
      lowerBound: Date.UTC(2026, 6, 13, 10, 0),
      afterExclusive: Date.UTC(2026, 6, 13, 10, 0),
    });
    expect(fifteenth).toBe(Date.UTC(2026, 6, 15, 9, 0));
  });

  it('searches far enough to cross a non-leap century for February 29', () => {
    const next = findNextFuryGatewayCronOccurrence({
      expression: '0 0 29 2 *',
      timeZone: 'UTC',
      lowerBound: Date.UTC(2099, 2, 1, 0, 0),
      afterExclusive: Date.UTC(2099, 2, 1, 0, 0),
    });

    expect(next).toBe(Date.UTC(2104, 1, 29, 0, 0));
  });

  it('honors explicit cron endAt and reports no later occurrence', async () => {
    const endAt = Date.UTC(2026, 8, 21, 7, 0);
    const h = await harness({
      createAt: Date.UTC(2026, 8, 20, 0, 0),
      now: Date.UTC(2026, 8, 21, 7, 1),
      endAt,
      expression: '0 9 * * *',
      timeZone: 'Europe/Paris',
    });

    const tick = await h.scheduler.tick(
      'cron-brief',
      'gateway-instance-a',
    );

    expect(tick.decision).toBe('claimed');
    expect(tick.scheduledFor).toBe(endAt);
    expect(tick.nextDueAt).toBeUndefined();
  });

  it('can resolve an exact prior occurrence without using server-local time', () => {
    const occurrence = findFuryGatewayCronOccurrenceAtOrBefore({
      expression: '0 9 * * *',
      timeZone: 'Europe/Paris',
      lowerBound: Date.UTC(2026, 8, 20, 0, 0),
      upperBound: Date.UTC(2026, 8, 21, 7, 5),
    });

    expect(occurrence).toBe(Date.UTC(2026, 8, 21, 7, 0));
  });
});
