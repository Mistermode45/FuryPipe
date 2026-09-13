import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRecoveryStore, type RecoveryStore } from '../src/core/recovery-store.js';
import { createContextOptimizerProfileRegistry } from '../src/context-optimizer-profile.js';
import { createModelAdapterRegistry } from '../src/model-adapter-registry.js';
import { createProviderAttemptPlanner } from '../src/provider-attempt-planner.js';
import { prepareProviderAttemptContext } from '../src/provider-attempt-context-runtime.js';
import { createProviderAttemptPlanReceipt } from '../src/provider-attempt-receipt.js';
import { createProviderAttemptContextReceipt } from '../src/provider-attempt-context-receipt.js';
import { prepareProviderRequestEnvelope } from '../src/provider-request-envelope.js';
import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import { createProviderTransportRegistry } from '../src/provider-transport.js';
import { createGovernedProviderExecutor } from '../src/governed-provider-executor.js';
import { createGovernedProviderExecutionReceipt } from '../src/governed-provider-execution-receipt.js';
import { createProviderExecutionAuditChain } from '../src/provider-execution-audit-chain.js';
import { createProviderExecutionAuditLedger } from '../src/provider-execution-audit-ledger.js';
import {
  appendProviderExecutionAuditLedgerSnapshot,
  findProviderExecutionAuditLedgerSnapshot,
  loadProviderExecutionAuditLedgerSnapshot,
  persistProviderExecutionAuditLedgerSnapshot,
  verifyProviderExecutionAuditLedgerSnapshotLineage,
  type FuryProviderExecutionAuditLedgerSnapshot,
} from '../src/provider-execution-audit-ledger-recovery.js';
import { makePolicy, makeRuntime } from './helpers/provider-executor.js';

function planner(task: string) {
  return createProviderAttemptPlanner({
    basePrompt: {
      level: 'ENGINEERING',
      sections: { task },
    },
    modelAdapters: {
      registry: createModelAdapterRegistry([]),
      qualifications: [],
    },
    contextProfiles: {
      registry: createContextOptimizerProfileRegistry([]),
      qualifications: [],
    },
  });
}

async function auditChain(task: string) {
  const attemptPlan = planner(task).plan({
    providerId: 'openai',
    model: 'gpt-5.6-sol',
    workloadId: 'coding',
  });
  const planning = createProviderAttemptPlanReceipt(attemptPlan);
  const contextResult = prepareProviderAttemptContext({
    attemptPlan,
    items: [{
      id: 'DURABLE_LEDGER_CONTEXT_ID_SENTINEL',
      kind: 'knowledge',
      selected: true,
      representations: [{
        level: 'summary',
        content: 'DURABLE_LEDGER_CONTEXT_PLAINTEXT_SENTINEL',
      }],
    }],
  });
  const context = createProviderAttemptContextReceipt(contextResult);
  const request = prepareProviderRequestEnvelope(contextResult);
  const runtime = makeRuntime();
  const permit = createProviderExecutionGate({
    providerRuntime: runtime,
    now: () => 1_000,
  }).authorize(request, makePolicy(request));
  const outcome = await createGovernedProviderExecutor({
    transports: createProviderTransportRegistry([{
      providerId: request.providerId,
      protocol: request.protocol,
      execute: async () => ({
        providerId: request.providerId,
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        responseBytes: new TextEncoder().encode('DURABLE_LEDGER_RESPONSE_PLAINTEXT_SENTINEL'),
      }),
    }]),
    providerRuntime: runtime,
    now: () => 1_000,
  }).execute(request, permit);
  const execution = createGovernedProviderExecutionReceipt({ request, permit, outcome });
  return createProviderExecutionAuditChain({ planning, context, execution });
}

async function temporaryRecoveryStore() {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-audit-ledger-recovery-'));
  return {
    root,
    store: createRecoveryStore(root, { namespace: 'provider-audit-ledger' }),
  };
}

describe('Provider Execution Audit Ledger Recovery snapshots', () => {
  it('persists and reloads an exact ledger after reopening the RecoveryStore', async () => {
    const { root, store } = await temporaryRecoveryStore();
    try {
      const ledger = createProviderExecutionAuditLedger([await auditChain('durable root')]);
      const snapshot = await persistProviderExecutionAuditLedgerSnapshot(store, ledger);

      const reopened = createRecoveryStore(root, { namespace: 'provider-audit-ledger' });
      const loaded = await loadProviderExecutionAuditLedgerSnapshot(
        reopened,
        snapshot.recoveryHandle,
        ledger.ledgerDigest,
      );

      expect(loaded.ledger).toEqual(ledger);
      expect(loaded.snapshot).toEqual(snapshot);
      expect(loaded.snapshot.verification).toEqual({
        recoveryObjectDigestIntegrity: 'verified',
        ledgerDigestIntegrity: 'verified',
        snapshotPayloadIntegrity: 'verified',
        ledgerProvenance: 'not-verified',
        snapshotProvenance: 'not-verified',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists only the existing plaintext-free ledger surface', async () => {
    const { root, store } = await temporaryRecoveryStore();
    try {
      const ledger = createProviderExecutionAuditLedger([
        await auditChain('DURABLE_LEDGER_TASK_PLAINTEXT_SENTINEL'),
      ]);
      const snapshot = await persistProviderExecutionAuditLedgerSnapshot(store, ledger);
      const bytes = await store.get(snapshot.recoveryHandle);
      const serialized = new TextDecoder().decode(bytes);

      expect(serialized).not.toContain('DURABLE_LEDGER_TASK_PLAINTEXT_SENTINEL');
      expect(serialized).not.toContain('DURABLE_LEDGER_CONTEXT_ID_SENTINEL');
      expect(serialized).not.toContain('DURABLE_LEDGER_CONTEXT_PLAINTEXT_SENTINEL');
      expect(serialized).not.toContain('DURABLE_LEDGER_RESPONSE_PLAINTEXT_SENTINEL');
      expect(serialized).toContain(ledger.ledgerDigest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('binds each appended durable snapshot to the exact prior Recovery object and ledger digest', async () => {
    const { root, store } = await temporaryRecoveryStore();
    try {
      const first = await auditChain('snapshot one');
      const second = await auditChain('snapshot two');
      const third = await auditChain('snapshot three');
      const rootSnapshot = await persistProviderExecutionAuditLedgerSnapshot(
        store,
        createProviderExecutionAuditLedger([first]),
      );
      const secondSnapshot = await appendProviderExecutionAuditLedgerSnapshot(store, rootSnapshot, second);
      const thirdSnapshot = await appendProviderExecutionAuditLedgerSnapshot(store, secondSnapshot, third);

      expect(secondSnapshot.parent).toEqual({
        ledgerDigest: rootSnapshot.ledgerDigest,
        recoveryDigest: rootSnapshot.recoveryDigest,
      });
      expect(thirdSnapshot.parent).toEqual({
        ledgerDigest: secondSnapshot.ledgerDigest,
        recoveryDigest: secondSnapshot.recoveryDigest,
      });

      const lineage = await verifyProviderExecutionAuditLedgerSnapshotLineage(store, thirdSnapshot);
      expect(lineage).toMatchObject({
        depth: 3,
        rootRecoveryDigest: rootSnapshot.recoveryDigest,
        rootLedgerDigest: rootSnapshot.ledgerDigest,
        headRecoveryDigest: thirdSnapshot.recoveryDigest,
        headLedgerDigest: thirdSnapshot.ledgerDigest,
        continuity: 'verified',
        globalHead: 'not-verified',
        ledgerProvenance: 'not-verified',
        snapshotProvenance: 'not-verified',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a load when an independent expected ledger digest anchor does not match', async () => {
    const { root, store } = await temporaryRecoveryStore();
    try {
      const snapshot = await persistProviderExecutionAuditLedgerSnapshot(
        store,
        createProviderExecutionAuditLedger([await auditChain('anchor mismatch')]),
      );
      await expect(loadProviderExecutionAuditLedgerSnapshot(
        store,
        snapshot.recoveryHandle,
        'f'.repeat(64),
      )).rejects.toThrow(/expected ledger digest anchor/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an invalid ledger before durable persistence', async () => {
    const { root, store } = await temporaryRecoveryStore();
    try {
      const ledger = createProviderExecutionAuditLedger([await auditChain('tamper before persist')]);
      const tampered = { ...ledger, count: ledger.count + 1 };
      await expect(persistProviderExecutionAuditLedgerSnapshot(
        store,
        tampered as typeof ledger,
      )).rejects.toThrow(/invalid ledger/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a forged durable snapshot reference before append', async () => {
    const { root, store } = await temporaryRecoveryStore();
    try {
      const snapshot = await persistProviderExecutionAuditLedgerSnapshot(
        store,
        createProviderExecutionAuditLedger([await auditChain('reference root')]),
      );
      const forged = {
        ...snapshot,
        count: snapshot.count + 1,
      } as FuryProviderExecutionAuditLedgerSnapshot;

      await expect(appendProviderExecutionAuditLedgerSnapshot(
        store,
        forged,
        await auditChain('reference append'),
      )).rejects.toThrow(/reference does not match durable content/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discovers only an exact ledger digest and revalidates the durable payload', async () => {
    const { root, store } = await temporaryRecoveryStore();
    try {
      const ledger = createProviderExecutionAuditLedger([await auditChain('discover exact')]);
      const snapshot = await persistProviderExecutionAuditLedgerSnapshot(store, ledger);

      const found = await findProviderExecutionAuditLedgerSnapshot(store, ledger.ledgerDigest);
      expect(found?.snapshot).toEqual(snapshot);
      expect(found?.ledger).toEqual(ledger);
      expect(await findProviderExecutionAuditLedgerSnapshot(store, 'e'.repeat(64))).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails discovery visibly when RecoveryStore.list is unavailable', async () => {
    const { root, store } = await temporaryRecoveryStore();
    try {
      const ledger = createProviderExecutionAuditLedger([await auditChain('no list')]);
      await persistProviderExecutionAuditLedgerSnapshot(store, ledger);
      const withoutList = {
        ...store,
        list: undefined,
      } as RecoveryStore;
      await expect(findProviderExecutionAuditLedgerSnapshot(
        withoutList,
        ledger.ledgerDigest,
      )).rejects.toThrow(/requires RecoveryStore\.list/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('allows detectable branch snapshots without claiming either branch is the global head', async () => {
    const { root, store } = await temporaryRecoveryStore();
    try {
      const rootSnapshot = await persistProviderExecutionAuditLedgerSnapshot(
        store,
        createProviderExecutionAuditLedger([await auditChain('fork root')]),
      );
      const left = await appendProviderExecutionAuditLedgerSnapshot(
        store,
        rootSnapshot,
        await auditChain('fork left'),
      );
      const right = await appendProviderExecutionAuditLedgerSnapshot(
        store,
        rootSnapshot,
        await auditChain('fork right'),
      );

      expect(left.recoveryDigest).not.toBe(right.recoveryDigest);
      expect(left.parent).toEqual(right.parent);
      const leftLineage = await verifyProviderExecutionAuditLedgerSnapshotLineage(store, left);
      const rightLineage = await verifyProviderExecutionAuditLedgerSnapshotLineage(store, right);
      expect(leftLineage.globalHead).toBe('not-verified');
      expect(rightLineage.globalHead).toBe('not-verified');
      expect(leftLineage.rootRecoveryDigest).toBe(rootSnapshot.recoveryDigest);
      expect(rightLineage.rootRecoveryDigest).toBe(rootSnapshot.recoveryDigest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
