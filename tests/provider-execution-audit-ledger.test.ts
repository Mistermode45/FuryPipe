import { describe, expect, it } from 'vitest';

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
import {
  appendProviderExecutionAuditLedger,
  createProviderExecutionAuditLedger,
  verifyProviderExecutionAuditLedger,
} from '../src/provider-execution-audit-ledger.js';
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
      id: 'LEDGER_CONTEXT_ID_SENTINEL',
      kind: 'knowledge',
      selected: true,
      representations: [{
        level: 'summary',
        content: 'LEDGER_CONTEXT_PLAINTEXT_SENTINEL',
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
        responseBytes: new TextEncoder().encode('LEDGER_RESPONSE_PLAINTEXT_SENTINEL'),
      }),
    }]),
    providerRuntime: runtime,
    now: () => 1_000,
  }).execute(request, permit);

  const execution = createGovernedProviderExecutionReceipt({
    request,
    permit,
    outcome,
  });

  return createProviderExecutionAuditChain({
    planning,
    context,
    execution,
  });
}

describe('Provider Execution Audit Ledger', () => {
  it('creates a deterministic empty ledger', () => {
    const first = createProviderExecutionAuditLedger();
    const second = createProviderExecutionAuditLedger([]);

    expect(first).toEqual(second);
    expect(first.count).toBe(0);
    expect(first.entries).toEqual([]);
    expect(first.headDigest).toBeNull();
    expect(first.ledgerDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(verifyProviderExecutionAuditLedger(first)).toBe(true);
  });

  it('creates a plaintext-free linked ledger from multiple audit chains', async () => {
    const firstChain = await auditChain('LEDGER_TASK_ONE_SENTINEL');
    const secondChain = await auditChain('LEDGER_TASK_TWO_SENTINEL');
    const ledger = createProviderExecutionAuditLedger([firstChain, secondChain]);

    expect(ledger.count).toBe(2);
    expect(ledger.entries[0]?.index).toBe(0);
    expect(ledger.entries[0]?.previousEntryDigest).toBeNull();
    expect(ledger.entries[1]?.index).toBe(1);
    expect(ledger.entries[1]?.previousEntryDigest).toBe(ledger.entries[0]?.entryDigest);
    expect(ledger.headDigest).toBe(ledger.entries[1]?.entryDigest);
    expect(ledger.entries[0]?.chainDigest).toBe(firstChain.chainDigest);
    expect(ledger.entries[1]?.chainDigest).toBe(secondChain.chainDigest);
    expect(verifyProviderExecutionAuditLedger(ledger)).toBe(true);

    const serialized = JSON.stringify(ledger);
    expect(serialized).not.toContain('LEDGER_TASK_ONE_SENTINEL');
    expect(serialized).not.toContain('LEDGER_TASK_TWO_SENTINEL');
    expect(serialized).not.toContain('LEDGER_CONTEXT_ID_SENTINEL');
    expect(serialized).not.toContain('LEDGER_CONTEXT_PLAINTEXT_SENTINEL');
    expect(serialized).not.toContain('LEDGER_RESPONSE_PLAINTEXT_SENTINEL');
  });

  it('appends immutably and preserves the previous ledger snapshot', async () => {
    const firstChain = await auditChain('append one');
    const secondChain = await auditChain('append two');
    const original = createProviderExecutionAuditLedger([firstChain]);
    const originalDigest = original.ledgerDigest;

    const appended = appendProviderExecutionAuditLedger(original, secondChain);

    expect(original.count).toBe(1);
    expect(original.ledgerDigest).toBe(originalDigest);
    expect(appended.count).toBe(2);
    expect(appended.entries[1]?.previousEntryDigest).toBe(original.headDigest);
    expect(appended.ledgerDigest).not.toBe(original.ledgerDigest);
    expect(verifyProviderExecutionAuditLedger(original)).toBe(true);
    expect(verifyProviderExecutionAuditLedger(appended)).toBe(true);
  });

  it('rejects duplicate source-chain replay on creation and append', async () => {
    const chain = await auditChain('duplicate replay');
    expect(() => createProviderExecutionAuditLedger([chain, chain]))
      .toThrow(/duplicate chain replay/);

    const ledger = createProviderExecutionAuditLedger([chain]);
    expect(() => appendProviderExecutionAuditLedger(ledger, chain))
      .toThrow(/duplicate chain replay/);
  });

  it('rejects a tampered source audit chain before append', async () => {
    const chain = await auditChain('tampered source');
    const tampered = {
      ...chain,
      workloadId: 'tampered-workload',
    };

    expect(() => createProviderExecutionAuditLedger([
      tampered as typeof chain,
    ])).toThrow(/digest integrity check failed/);
  });

  it('detects entry reordering and deletion', async () => {
    const firstChain = await auditChain('reorder one');
    const secondChain = await auditChain('reorder two');
    const ledger = createProviderExecutionAuditLedger([firstChain, secondChain]);

    const reordered = {
      ...ledger,
      entries: [ledger.entries[1]!, ledger.entries[0]!],
    };
    expect(verifyProviderExecutionAuditLedger(reordered as typeof ledger)).toBe(false);

    const deleted = {
      ...ledger,
      entries: [ledger.entries[0]!],
      count: 1,
      headDigest: ledger.entries[0]!.entryDigest,
    };
    expect(verifyProviderExecutionAuditLedger(deleted as typeof ledger)).toBe(false);
  });

  it('detects entry metadata tampering', async () => {
    const chain = await auditChain('metadata tamper');
    const ledger = createProviderExecutionAuditLedger([chain]);
    const entry = ledger.entries[0]!;
    const tampered = {
      ...ledger,
      entries: [{
        ...entry,
        execution: {
          ...entry.execution,
          outcome: 'error',
        },
      }],
    };

    expect(verifyProviderExecutionAuditLedger(
      tampered as unknown as typeof ledger,
    )).toBe(false);
  });

  it('uses an external expected ledger digest as a stronger anchor check', async () => {
    const firstChain = await auditChain('anchor one');
    const secondChain = await auditChain('anchor two');
    const first = createProviderExecutionAuditLedger([firstChain]);
    const anchoredDigest = first.ledgerDigest;
    const second = appendProviderExecutionAuditLedger(first, secondChain);

    expect(verifyProviderExecutionAuditLedger(first, anchoredDigest)).toBe(true);
    expect(verifyProviderExecutionAuditLedger(second, anchoredDigest)).toBe(false);
    expect(verifyProviderExecutionAuditLedger(second, second.ledgerDigest)).toBe(true);
  });

  it('rejects a forged previous-entry link even when all entry fields look plausible', async () => {
    const firstChain = await auditChain('link one');
    const secondChain = await auditChain('link two');
    const ledger = createProviderExecutionAuditLedger([firstChain, secondChain]);
    const second = ledger.entries[1]!;
    const forged = {
      ...ledger,
      entries: [
        ledger.entries[0]!,
        {
          ...second,
          previousEntryDigest: null,
        },
      ],
    };

    expect(verifyProviderExecutionAuditLedger(
      forged as unknown as typeof ledger,
    )).toBe(false);
  });
});
