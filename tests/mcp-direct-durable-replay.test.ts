import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createMcpDirectDurableReplayCoordinatorInternal,
  inspectMcpDirectDurableReplayStatusInternal,
  reclaimMcpDirectDurableExpiredPreCallInternal,
  reserveMcpDirectDurableExecution,
  armMcpDirectDurableExecution,
  settleMcpDirectDurableExecution,
  compactMcpDirectDurableEvidenceInternal,
  abortMcpDirectDurablePreCallReservation,
  McpDirectDurableReplayError,
} from '../src/mcp-direct-durable-replay-internal.js';

const KEY = 'a'.repeat(64);
const RESULT = 'b'.repeat(64);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-mcp-durable-replay-'));
  const store = createRecoveryStore(root, {
    namespace: 'mcp-direct-durable-replay',
    maxObjectBytes: 64 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
    maxGlobalBytes: 16 * 1024 * 1024,
  });
  const coordinator = createMcpDirectDurableReplayCoordinatorInternal({
    store,
    tenantId: 'tenant-a',
    principalId: 'principal-a',
  });
  return { root, store, coordinator };
}

describe('Direct MCP durable replay foundation', () => {
  it('allows only one cross-coordinator pre-call reservation for one exact scope/key/attempt', async () => {
    const { root, store, coordinator } = await fixture();
    try {
      const second = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-a',
        principalId: 'principal-a',
      });

      const results = await Promise.allSettled([
        reserveMcpDirectDurableExecution(coordinator, KEY, { now: 1_000 }),
        reserveMcpDirectDurableExecution(second, KEY, { now: 1_000 }),
      ]);

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      const rejected = results.find(result => result.status === 'rejected');
      expect(rejected).toMatchObject({
        reason: expect.objectContaining({
          name: 'McpDirectDurableReplayError',
          code: 'durable-state-conflict',
          retrySafe: false,
        }),
      });

      const status = await inspectMcpDirectDurableReplayStatusInternal(
        coordinator,
        KEY,
        1_001,
      );
      expect(status).toMatchObject({
        state: 'pre_call',
        attempt: 1,
        leaseExpired: false,
        replayed: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists armed state across a new coordinator and never converts it into replay authority', async () => {
    const { root, store, coordinator } = await fixture();
    try {
      const reservation = await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        { now: 2_000, leaseMs: 10_000 },
      );
      await armMcpDirectDurableExecution(coordinator, reservation, 2_001);

      const reopened = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-a',
        principalId: 'principal-a',
      });
      const status = await inspectMcpDirectDurableReplayStatusInternal(
        reopened,
        KEY,
        99_000,
      );
      expect(status).toMatchObject({
        state: 'armed',
        attempt: 1,
        replayed: false,
      });

      await expect(reserveMcpDirectDurableExecution(
        reopened,
        KEY,
        {
          now: 99_000,
          replay: {
            priorAttempt: 1,
            priorResultSha256: RESULT,
            reason: 'repeat_closed_world_read',
          },
        },
      )).rejects.toMatchObject({
        code: 'durable-replay-not-authorized',
        retrySafe: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reloads a known terminal digest and permits only an exact next replay attempt', async () => {
    const { root, store, coordinator } = await fixture();
    try {
      const one = await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        { now: 3_000 },
      );
      const armedOne = await armMcpDirectDurableExecution(coordinator, one, 3_001);
      const terminal = await settleMcpDirectDurableExecution(
        coordinator,
        armedOne,
        'succeeded',
        { resultSha256: RESULT, succeeded: true, now: 3_002 },
      );
      expect(terminal).toMatchObject({
        state: 'terminal',
        attempt: 1,
        outcome: 'succeeded',
        resultSha256: RESULT,
        succeeded: true,
      });

      const reopened = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-a',
        principalId: 'principal-a',
      });
      const two = await reserveMcpDirectDurableExecution(
        reopened,
        KEY,
        {
          now: 3_100,
          replay: {
            priorAttempt: 1,
            priorResultSha256: RESULT,
            reason: 'repeat_closed_world_read',
          },
        },
      );
      expect(two).toMatchObject({
        attempt: 2,
        replayed: true,
        replayReason: 'repeat_closed_world_read',
        priorResultSha256: RESULT,
      });

      const wrongResult = 'c'.repeat(64);
      await expect(reserveMcpDirectDurableExecution(
        reopened,
        KEY,
        {
          now: 3_101,
          replay: {
            priorAttempt: 1,
            priorResultSha256: wrongResult,
            reason: 'repeat_closed_world_read',
          },
        },
      )).rejects.toBeInstanceOf(McpDirectDurableReplayError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps unknown terminal outcomes non-replayable after restart', async () => {
    const { root, store, coordinator } = await fixture();
    try {
      const reservation = await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        { now: 4_000 },
      );
      const armed = await armMcpDirectDurableExecution(coordinator, reservation, 4_001);
      await settleMcpDirectDurableExecution(
        coordinator,
        armed,
        'unknown',
        { now: 4_002 },
      );

      const reopened = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-a',
        principalId: 'principal-a',
      });
      await expect(reserveMcpDirectDurableExecution(
        reopened,
        KEY,
        {
          now: 5_000,
          replay: {
            priorAttempt: 1,
            priorResultSha256: RESULT,
            reason: 'repeat_closed_world_read',
          },
        },
      )).rejects.toMatchObject({
        code: 'durable-replay-not-authorized',
        retrySafe: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reclaims only an expired unarmed reservation and restores the prior safe state', async () => {
    const { root, coordinator } = await fixture();
    try {
      await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        { now: 6_000, leaseMs: 10 },
      );

      await expect(reclaimMcpDirectDurableExpiredPreCallInternal(
        coordinator,
        KEY,
        6_009,
      )).rejects.toMatchObject({
        code: 'durable-reclaim-not-safe',
        retrySafe: false,
      });

      const reclaimed = await reclaimMcpDirectDurableExpiredPreCallInternal(
        coordinator,
        KEY,
        6_010,
      );
      expect(reclaimed).toMatchObject({ state: 'clear' });

      const fresh = await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        { now: 6_011 },
      );
      expect(fresh).toMatchObject({ attempt: 1, replayed: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes expired reclaim against arm so exactly one transition wins', async () => {
    const { root, store, coordinator } = await fixture();
    try {
      const reservation = await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        { now: 6_100, leaseMs: 10 },
      );
      const reclaimer = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-a',
        principalId: 'principal-a',
      });

      const outcomes = await Promise.allSettled([
        armMcpDirectDurableExecution(
          coordinator,
          reservation,
          6_109,
        ),
        reclaimMcpDirectDurableExpiredPreCallInternal(
          reclaimer,
          KEY,
          6_110,
        ),
      ]);

      expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);

      const final = await inspectMcpDirectDurableReplayStatusInternal(
        reclaimer,
        KEY,
        6_111,
      );
      expect(['clear', 'armed']).toContain(final.state);

      if (final.state === 'armed') {
        await expect(reclaimMcpDirectDurableExpiredPreCallInternal(
          reclaimer,
          KEY,
          99_000,
        )).rejects.toMatchObject({
          code: 'durable-reclaim-not-safe',
          retrySafe: false,
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('isolates durable state by tenant and principal without persisting their plaintext identities', async () => {
    const { root, store, coordinator } = await fixture();
    try {
      const tenantB = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-b',
        principalId: 'principal-a',
      });
      const principalB = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-a',
        principalId: 'principal-b',
      });

      expect(tenantB.scopeSha256).not.toBe(coordinator.scopeSha256);
      expect(principalB.scopeSha256).not.toBe(coordinator.scopeSha256);

      await reserveMcpDirectDurableExecution(coordinator, KEY, { now: 7_000 });
      await expect(inspectMcpDirectDurableReplayStatusInternal(tenantB, KEY, 7_001))
        .resolves.toMatchObject({ state: 'clear' });
      await expect(inspectMcpDirectDurableReplayStatusInternal(principalB, KEY, 7_001))
        .resolves.toMatchObject({ state: 'clear' });

      const manifests = await store.list!({ limit: 100 });
      let serialized = '';
      for (const manifest of manifests) {
        serialized += new TextDecoder().decode(await store.get(manifest));
        serialized += JSON.stringify(manifest.metadata ?? {});
      }
      expect(serialized).not.toContain('tenant-a');
      expect(serialized).not.toContain('principal-a');
      expect(serialized).not.toContain('tenant-b');
      expect(serialized).not.toContain('principal-b');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('caps durable replay at three attempts and keeps attempt lineage contiguous', async () => {
    const { root, coordinator } = await fixture();
    try {
      const one = await reserveMcpDirectDurableExecution(coordinator, KEY, { now: 8_000 });
      const armedOne = await armMcpDirectDurableExecution(coordinator, one, 8_001);
      await settleMcpDirectDurableExecution(
        coordinator,
        armedOne,
        'succeeded',
        { resultSha256: RESULT, succeeded: true, now: 8_002 },
      );

      const two = await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        {
          now: 8_100,
          replay: {
            priorAttempt: 1,
            priorResultSha256: RESULT,
            reason: 'repeat_closed_world_read',
          },
        },
      );
      const armedTwo = await armMcpDirectDurableExecution(coordinator, two, 8_101);
      await settleMcpDirectDurableExecution(
        coordinator,
        armedTwo,
        'succeeded',
        { resultSha256: RESULT, succeeded: true, now: 8_102 },
      );

      const three = await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        {
          now: 8_200,
          replay: {
            priorAttempt: 2,
            priorResultSha256: RESULT,
            reason: 'repeat_closed_world_read',
          },
        },
      );
      const armedThree = await armMcpDirectDurableExecution(coordinator, three, 8_201);
      await settleMcpDirectDurableExecution(
        coordinator,
        armedThree,
        'succeeded',
        { resultSha256: RESULT, succeeded: true, now: 8_202 },
      );

      await expect(reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        {
          now: 8_300,
          replay: {
            priorAttempt: 3,
            priorResultSha256: RESULT,
            reason: 'repeat_closed_world_read',
          },
        },
      )).rejects.toMatchObject({
        code: 'durable-attempt-limit',
        retrySafe: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('keeps copied coordinators non-authoritative and rejects corrupted durable payloads', async () => {
    const { root, store, coordinator } = await fixture();
    try {
      await reserveMcpDirectDurableExecution(coordinator, KEY, { now: 9_000 });

      const copied = { ...coordinator };
      await expect(inspectMcpDirectDurableReplayStatusInternal(
        copied,
        KEY,
        9_001,
      )).rejects.toMatchObject({
        code: 'invalid-coordinator',
        retrySafe: false,
      });

      const corruptStore = {
        ...store,
        get: async (handle: Parameters<typeof store.get>[0]) => {
          const bytes = await store.get(handle);
          const text = new TextDecoder().decode(bytes);
          return new TextEncoder().encode(text.replace('"attempt":1', '"attempt":2'));
        },
      };
      const corruptCoordinator = createMcpDirectDurableReplayCoordinatorInternal({
        store: corruptStore,
        tenantId: 'tenant-a',
        principalId: 'principal-a',
      });
      await expect(inspectMcpDirectDurableReplayStatusInternal(
        corruptCoordinator,
        KEY,
        9_001,
      )).rejects.toMatchObject({
        code: 'durable-state-corrupt',
        retrySafe: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can abort only its own still-unarmed process-local pre-call reservation', async () => {
    const { root, coordinator } = await fixture();
    try {
      const reservation = await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        { now: 10_000 },
      );
      await abortMcpDirectDurablePreCallReservation(coordinator, reservation);
      await expect(inspectMcpDirectDurableReplayStatusInternal(
        coordinator,
        KEY,
        10_001,
      )).resolves.toMatchObject({ state: 'clear' });

      const second = await reserveMcpDirectDurableExecution(
        coordinator,
        KEY,
        { now: 10_002 },
      );
      await armMcpDirectDurableExecution(coordinator, second, 10_003);
      await expect(abortMcpDirectDurablePreCallReservation(
        coordinator,
        second,
      )).rejects.toMatchObject({
        code: 'durable-state-conflict',
        retrySafe: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('compacts known succeeded evidence without replay authority', async () => {
    const { root, coordinator } = await fixture();
    try {
      const reservation = await reserveMcpDirectDurableExecution(coordinator, KEY, { now: 11_000 });
      const armed = await armMcpDirectDurableExecution(coordinator, reservation, 11_001);
      await settleMcpDirectDurableExecution(coordinator, armed, 'succeeded', {
        resultSha256: RESULT, succeeded: true, now: 11_002,
      });
      await expect(compactMcpDirectDurableEvidenceInternal(coordinator, KEY, {
        now: 12_000, retainUntil: 42_000,
      })).resolves.toMatchObject({
        state: 'compacted', attempt: 1, outcome: 'succeeded', historical: true,
      });
      await expect(inspectMcpDirectDurableReplayStatusInternal(coordinator, KEY, 12_001))
        .resolves.toMatchObject({ state: 'compacted', historical: true });
      await expect(reserveMcpDirectDurableExecution(coordinator, KEY, { now: 12_002 }))
        .rejects.toMatchObject({ code: 'durable-state-conflict', retrySafe: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('compacts known tool_error evidence', async () => {
    const { root, coordinator } = await fixture();
    try {
      const reservation = await reserveMcpDirectDurableExecution(coordinator, KEY, { now: 13_000 });
      const armed = await armMcpDirectDurableExecution(coordinator, reservation, 13_001);
      await settleMcpDirectDurableExecution(coordinator, armed, 'tool_error', {
        resultSha256: RESULT, succeeded: false, now: 13_002,
      });
      await expect(compactMcpDirectDurableEvidenceInternal(coordinator, KEY, {
        now: 14_000, retainUntil: 44_000,
      })).resolves.toMatchObject({ state: 'compacted', outcome: 'tool_error' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['unknown', 'evidence_failed', 'verification_failed'] as const)(
    'rejects compaction for unresolved %s evidence',
    async (outcome) => {
      const { root, coordinator } = await fixture();
      try {
        const reservation = await reserveMcpDirectDurableExecution(coordinator, KEY, { now: 15_000 });
        const armed = await armMcpDirectDurableExecution(coordinator, reservation, 15_001);
        await settleMcpDirectDurableExecution(coordinator, armed, outcome, {
          ...(outcome === 'verification_failed' ? {
            resultSha256: RESULT,
            succeeded: true,
          } : {}),
          now: 15_002,
        });
        await expect(compactMcpDirectDurableEvidenceInternal(coordinator, KEY, {
          now: 16_000, retainUntil: 46_000,
        })).rejects.toMatchObject({
          code: 'durable-maintenance-not-eligible', retrySafe: false,
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );


  it('retains historical existence across restart and never treats a tombstone as replay authority', async () => {
    const { root, store, coordinator } = await fixture();
    try {
      const reservation = await reserveMcpDirectDurableExecution(coordinator, KEY, { now: 17_000 });
      const armed = await armMcpDirectDurableExecution(coordinator, reservation, 17_001);
      await settleMcpDirectDurableExecution(coordinator, armed, 'succeeded', {
        resultSha256: RESULT, succeeded: true, now: 17_002,
      });
      await compactMcpDirectDurableEvidenceInternal(coordinator, KEY, {
        now: 18_000, retainUntil: 48_000,
      });

      const reopened = createMcpDirectDurableReplayCoordinatorInternal({
        store, tenantId: 'tenant-a', principalId: 'principal-a',
      });
      await expect(inspectMcpDirectDurableReplayStatusInternal(reopened, KEY, 18_001))
        .resolves.toMatchObject({ state: 'compacted', historical: true, attempt: 1 });
      await expect(reserveMcpDirectDurableExecution(reopened, KEY, { now: 18_002 }))
        .rejects.toMatchObject({ code: 'durable-state-conflict', retrySafe: false });
      await expect(reserveMcpDirectDurableExecution(reopened, KEY, {
        now: 18_003,
        replay: {
          priorAttempt: 1,
          priorResultSha256: RESULT,
          reason: 'repeat_closed_world_read',
        },
      })).rejects.toMatchObject({ code: 'durable-replay-not-authorized', retrySafe: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed on a corrupt tombstone and exposes no plaintext identity or payload', async () => {
    const { root, store, coordinator } = await fixture();
    try {
      const corrupt = new TextEncoder().encode('{"format":"furypipe-mcp-direct-durable-tombstone/v1"}');
      await store.put(corrupt, {
        system: 'mcp-direct-durable-replay',
        scopeSha256: coordinator.scopeSha256,
        replayKeySha256: KEY,
        recordType: 'tombstone',
        attempt: 1,
        reservationIdSha256: RESULT,
      });
      await expect(inspectMcpDirectDurableReplayStatusInternal(coordinator, KEY, 19_000))
        .rejects.toMatchObject({ code: 'durable-state-corrupt', retrySafe: false });
      const manifests = await store.list({ metadata: {
        system: 'mcp-direct-durable-replay',
        scopeSha256: coordinator.scopeSha256,
        replayKeySha256: KEY,
      }});
      expect(JSON.stringify(manifests)).not.toContain('tenant-a');
      expect(JSON.stringify(manifests)).not.toContain('principal-a');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});