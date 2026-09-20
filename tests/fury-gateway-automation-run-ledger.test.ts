import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  FuryGatewayAutomationRunLedgerError,
  createFuryGatewayAutomationRunLedger,
  isGeneratedFuryGatewayAutomationRunLedger,
} from '../src/gateway-automation-run-ledger-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-automation-run-'));
  tempDirs.push(dir);
  return dir;
}

function recovery(rootDir: string) {
  return createRecoveryStore(rootDir, {
    namespace: 'gateway-automation-runs',
    maxObjectBytes: 64 * 1024,
    maxTotalBytes: 16 * 1024 * 1024,
  });
}

function triggerInput(overrides: Record<string, unknown> = {}) {
  return {
    automationId: 'morning-brief',
    definitionRevision: 3,
    definitionSha256: 'a'.repeat(64),
    sourceKind: 'interval',
    occurrenceKey: 'interval:2026-09-21T06:00:00.000Z',
    scheduledFor: 1_000_000,
    ...overrides,
  };
}

describe('Fury Gateway durable automation trigger/run ledger', () => {
  it('registers one deterministic logical run for one trigger occurrence', async () => {
    const dir = root();
    let now = 10;
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => now++,
    });

    const first = await ledger.registerTrigger(triggerInput() as never);
    const second = await ledger.registerTrigger(triggerInput() as never);

    expect(first.state).toBe('pending');
    expect(second).toEqual(first);
    expect(first.runIdSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.triggerIdSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.executionIdentitySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.executionAuthority).toBe(false);
    expect(await ledger.countRuns()).toBe(1);
  });

  it('never persists the raw occurrence key', async () => {
    const dir = root();
    const raw = recovery(dir);
    const ledger = createFuryGatewayAutomationRunLedger({
      store: raw,
      now: () => 10,
    });

    const secretLikeOccurrence = 'provider-event-body-ref:customer-private-123';
    await ledger.registerTrigger(triggerInput({
      occurrenceKey: secretLikeOccurrence,
    }) as never);

    const handles = await raw.list?.({
      metadata: {
        system: 'gateway-automation-run-ledger',
        recordType: 'trigger',
      },
      limit: 10,
    }) ?? [];
    expect(handles).toHaveLength(1);
    const body = new TextDecoder().decode(await raw.get(handles[0]!));

    expect(body).not.toContain(secretLikeOccurrence);
    expect(body).toContain('occurrenceKeySha256');
  });

  it('deduplicates the same trigger occurrence across definition revisions', async () => {
    const dir = root();
    let now = 10;
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => now++,
    });

    const first = await ledger.registerTrigger(triggerInput() as never);
    const afterRevision = await ledger.registerTrigger(triggerInput({
      definitionRevision: 4,
      definitionSha256: 'f'.repeat(64),
    }) as never);

    expect(afterRevision).toEqual(first);
    expect(await ledger.countRuns()).toBe(1);
  });

  it('rejects reuse of an occurrence key with a conflicting scheduled timestamp', async () => {
    const dir = root();
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => 10,
    });

    await ledger.registerTrigger(triggerInput() as never);

    await expect(ledger.registerTrigger(triggerInput({
      scheduledFor: 2_000_000,
    }) as never)).rejects.toMatchObject({
      name: 'FuryGatewayAutomationRunLedgerError',
      code: 'run-conflict',
    });
  });

  it('recovers a pending run after a fresh process/store instance', async () => {
    const dir = root();
    const first = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => 10,
    });
    const created = await first.registerTrigger(triggerInput() as never);

    const restarted = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => 20,
    });
    const recovered = await restarted.inspect(created.runIdSha256);

    expect(recovered).toEqual(created);
  });

  it('allows exactly one winner in a concurrent first-claim race', async () => {
    const dir = root();
    let now = 100;
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => now,
      defaultClaimLeaseMs: 5_000,
    });
    const run = await ledger.registerTrigger(triggerInput() as never);

    const results = await Promise.allSettled([
      ledger.claim(run.runIdSha256, 'gateway-instance-a'),
      ledger.claim(run.runIdSha256, 'gateway-instance-b'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      name: 'FuryGatewayAutomationRunLedgerError',
      code: 'run-conflict',
    });

    const status = await ledger.inspect(run.runIdSha256);
    expect(status?.state).toBe('claimed');
    if (status?.state === 'claimed') {
      expect(status.generation).toBe(1);
    }
  });

  it('reclaims only an expired unarmed claim and fences the stale generation', async () => {
    const dir = root();
    let now = 100;
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => now,
      defaultClaimLeaseMs: 1_000,
      maxClaimLeaseMs: 10_000,
    });
    const run = await ledger.registerTrigger(triggerInput() as never);
    const first = await ledger.claim(run.runIdSha256, 'gateway-instance-a');

    now = first.leaseExpiresAt;
    const expired = await ledger.inspect(run.runIdSha256);
    expect(expired?.state).toBe('claim-expired');

    const second = await ledger.claim(run.runIdSha256, 'gateway-instance-b');
    expect(second.generation).toBe(2);
    expect(second.executionIdentitySha256).toBe(first.executionIdentitySha256);

    await expect(
      ledger.arm(first, first.claimedAt + 1),
    ).rejects.toMatchObject({
      name: 'FuryGatewayAutomationRunLedgerError',
      code: 'stale-claim',
    });

    const status = await ledger.inspect(run.runIdSha256);
    expect(status?.state).toBe('claimed');
    if (status?.state === 'claimed') {
      expect(status.generation).toBe(2);
      expect(status.claimIdSha256).toBe(second.claimIdSha256);
    }
  });

  it('treats armed-without-terminal after restart as outcome-unknown and blocks replay', async () => {
    const dir = root();
    let now = 100;
    const first = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => now,
    });
    const run = await first.registerTrigger(triggerInput() as never);
    const claim = await first.claim(run.runIdSha256, 'gateway-instance-a');
    now = 200;
    await first.arm(claim);

    const restarted = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => 10_000,
    });
    const recovered = await restarted.inspect(run.runIdSha256);

    expect(recovered?.state).toBe('outcome-unknown');
    if (recovered?.state === 'outcome-unknown') {
      expect(recovered.automaticReplayAllowed).toBe(false);
      expect(recovered.generation).toBe(1);
    }
    await expect(
      restarted.claim(run.runIdSha256, 'gateway-instance-b'),
    ).rejects.toMatchObject({
      code: 'run-conflict',
    });
  });

  it('settles an armed known outcome only with evidence and recovers terminal state', async () => {
    const dir = root();
    let now = 100;
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => now,
    });
    const run = await ledger.registerTrigger(triggerInput() as never);
    const claim = await ledger.claim(run.runIdSha256, 'gateway-instance-a');
    now = 150;
    const armed = await ledger.arm(claim);

    await expect(
      ledger.settleArmed(armed, { outcome: 'succeeded' }),
    ).rejects.toMatchObject({ code: 'invalid-input' });

    now = 200;
    const terminal = await ledger.settleArmed(armed, {
      outcome: 'succeeded',
      evidenceSha256: 'b'.repeat(64),
    });
    expect(terminal.state).toBe('terminal');
    if (terminal.state === 'terminal') {
      expect(terminal.outcome).toBe('succeeded');
      expect(terminal.evidenceSha256).toBe('b'.repeat(64));
      expect(terminal.automaticReplayAllowed).toBe(false);
    }

    const restarted = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => 500,
    });
    expect(await restarted.inspect(run.runIdSha256)).toEqual(terminal);
  });

  it('can terminally block a run before any side effect without creating armed evidence', async () => {
    const dir = root();
    let now = 100;
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => now,
    });
    const run = await ledger.registerTrigger(triggerInput() as never);
    const claim = await ledger.claim(run.runIdSha256, 'gateway-instance-a');

    now = 200;
    const blocked = await ledger.settleWithoutSideEffect(
      claim,
      'blocked',
      { evidenceSha256: 'c'.repeat(64) },
    );

    expect(blocked.state).toBe('terminal');
    if (blocked.state === 'terminal') {
      expect(blocked.outcome).toBe('blocked');
      expect(blocked.evidenceSha256).toBe('c'.repeat(64));
    }

    await expect(ledger.arm(claim, 250)).rejects.toMatchObject({
      code: 'stale-claim',
    });
  });

  it('refuses to arm an expired process-local claim', async () => {
    const dir = root();
    let now = 100;
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => now,
      defaultClaimLeaseMs: 1_000,
    });
    const run = await ledger.registerTrigger(triggerInput() as never);
    const claim = await ledger.claim(run.runIdSha256, 'gateway-instance-a');

    now = claim.leaseExpiresAt;
    await expect(ledger.arm(claim)).rejects.toMatchObject({
      code: 'claim-expired',
    });
  });

  it('rejects cloned claim/armed evidence as non-authoritative process-local objects', async () => {
    const dir = root();
    let now = 100;
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => now,
    });
    const run = await ledger.registerTrigger(triggerInput() as never);
    const claim = await ledger.claim(run.runIdSha256, 'gateway-instance-a');

    await expect(ledger.arm({ ...claim })).rejects.toMatchObject({
      code: 'claim-not-active',
    });

    now = 200;
    const armed = await ledger.arm(claim);
    await expect(ledger.settleArmed({ ...armed }, {
      outcome: 'outcome-unknown',
    })).rejects.toMatchObject({
      code: 'run-conflict',
    });
  });

  it('detects injected durable lineage that is not backed by a claim', async () => {
    const dir = root();
    const raw = recovery(dir);
    const ledger = createFuryGatewayAutomationRunLedger({
      store: raw,
      now: () => 100,
    });
    const run = await ledger.registerTrigger(triggerInput() as never);

    const fakeClaimId = 'd'.repeat(64);
    const fakeArmed = {
      format: 'furypipe-gateway-automation-armed-record/v1',
      runIdSha256: run.runIdSha256,
      triggerIdSha256: run.triggerIdSha256,
      generation: 1,
      claimIdSha256: fakeClaimId,
      claimRecordSha256: 'e'.repeat(64),
      executionIdentitySha256: run.executionIdentitySha256,
      armedAt: 150,
    };
    await raw.put(
      new TextEncoder().encode(JSON.stringify(fakeArmed)),
      {
        system: 'gateway-automation-run-ledger',
        recordType: 'armed',
        runIdSha256: run.runIdSha256,
        triggerIdSha256: run.triggerIdSha256,
        generation: 1,
        claimIdSha256: fakeClaimId,
      },
    );

    await expect(ledger.inspect(run.runIdSha256)).rejects.toMatchObject({
      name: 'FuryGatewayAutomationRunLedgerError',
      code: 'run-state-corrupt',
    });
  });

  it('marks only genuine generated ledgers as process-local wrappers', () => {
    const dir = root();
    const ledger = createFuryGatewayAutomationRunLedger({
      store: recovery(dir),
      now: () => 100,
    });

    expect(isGeneratedFuryGatewayAutomationRunLedger(ledger)).toBe(true);
    expect(isGeneratedFuryGatewayAutomationRunLedger({ ...ledger })).toBe(false);
    expect(new FuryGatewayAutomationRunLedgerError('run-conflict'))
      .toBeInstanceOf(Error);
  });
});
