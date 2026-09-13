import { describe, expect, it } from 'vitest';

import { createContextOptimizerProfileRegistry } from '../src/context-optimizer-profile.js';
import { createModelAdapterRegistry } from '../src/model-adapter-registry.js';
import { createProviderAttemptPlanner } from '../src/provider-attempt-planner.js';
import { prepareProviderAttemptContext } from '../src/provider-attempt-context-runtime.js';
import {
  createProviderAttemptPlanReceipt,
} from '../src/provider-attempt-receipt.js';
import {
  createProviderAttemptContextReceipt,
} from '../src/provider-attempt-context-receipt.js';
import {
  prepareProviderRequestEnvelope,
} from '../src/provider-request-envelope.js';
import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import { createProviderTransportRegistry } from '../src/provider-transport.js';
import { createGovernedProviderExecutor } from '../src/governed-provider-executor.js';
import {
  createGovernedProviderExecutionReceipt,
} from '../src/governed-provider-execution-receipt.js';
import {
  createProviderExecutionAuditChain,
  verifyProviderExecutionAuditChain,
} from '../src/provider-execution-audit-chain.js';
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

async function trace(options: {
  readonly task?: string;
  readonly contextText?: string;
} = {}) {
  const task = options.task ?? 'AUDIT_TASK_PLAINTEXT_SENTINEL';
  const attemptPlan = planner(task).plan({
    providerId: 'openai',
    model: 'gpt-5.6-sol',
    workloadId: 'coding',
  });
  const planning = createProviderAttemptPlanReceipt(attemptPlan);

  const contextResult = prepareProviderAttemptContext({
    attemptPlan,
    items: options.contextText === undefined ? [] : [{
      id: 'AUDIT_CONTEXT_ID_SENTINEL',
      kind: 'knowledge',
      selected: true,
      representations: [{
        level: 'full',
        content: options.contextText,
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

  const executor = createGovernedProviderExecutor({
    transports: createProviderTransportRegistry([{
      providerId: request.providerId,
      protocol: request.protocol,
      execute: async () => ({
        providerId: request.providerId,
        model: request.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        responseBytes: new TextEncoder().encode('AUDIT_RESPONSE_PLAINTEXT_SENTINEL'),
      }),
    }]),
    providerRuntime: runtime,
    now: () => 1_000,
  });
  const outcome = await executor.execute(request, permit);
  const execution = createGovernedProviderExecutionReceipt({
    request,
    permit,
    outcome,
  });

  return { planning, context, execution };
}

describe('Provider Execution Audit Chain', () => {
  it('creates a deterministic plaintext-free chain for an identity context attempt', async () => {
    const receipts = await trace();
    const first = createProviderExecutionAuditChain(receipts);
    const second = createProviderExecutionAuditChain(receipts);

    expect(first).toEqual(second);
    expect(first.chainDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.continuity).toEqual({
      exactScope: 'verified',
      contextProfile: 'verified',
      planningToContextPrompt: 'verified-identical',
      planningToContextCompileInput: 'not-comparable-across-receipt-v1-formats',
      contextToExecutionPrompt: 'verified',
    });
    expect(first.verification).toEqual({
      receiptDigestIntegrity: 'verified',
      structuralContinuity: 'verified',
      sourceObjectProvenance: 'not-verified',
    });
    expect(first.provenance).toEqual({
      planningReceipt: 'not-verified',
      contextRuntimeReceipt: 'not-verified',
      executionRequestReceipt: 'process-local-verified',
      executionPermitReceipt: 'process-local-verified',
      executionOutcomeReceipt: 'not-verified',
      chainProvenance: 'not-verified',
    });

    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('AUDIT_TASK_PLAINTEXT_SENTINEL');
    expect(serialized).not.toContain('AUDIT_CONTEXT_ID_SENTINEL');
    expect(serialized).not.toContain('AUDIT_RESPONSE_PLAINTEXT_SENTINEL');
  });

  it('does not overclaim planning-to-context prompt continuity after context injection', async () => {
    const receipts = await trace({
      contextText: 'AUDIT_CONTEXT_PLAINTEXT_SENTINEL',
    });
    const chain = createProviderExecutionAuditChain(receipts);

    expect(chain.continuity.planningToContextPrompt)
      .toBe('context-transformed-not-verifiable-from-receipts');
    expect(chain.continuity.contextToExecutionPrompt).toBe('verified');
    expect(JSON.stringify(chain)).not.toContain('AUDIT_CONTEXT_PLAINTEXT_SENTINEL');
  });

  it('rejects a context receipt from another exact provider scope', async () => {
    const normal = await trace();
    const otherPlan = planner('other').plan({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      workloadId: 'coding',
    });
    const otherContext = createProviderAttemptContextReceipt(
      prepareProviderAttemptContext({
        attemptPlan: otherPlan,
        items: [],
      }),
    );

    expect(() => createProviderExecutionAuditChain({
      ...normal,
      context: otherContext,
    })).toThrow(/scope continuity failed/);
  });

  it('rejects an execution receipt for a different final prompt at the same scope', async () => {
    const first = await trace({ task: 'first audit task' });
    const second = await trace({ task: 'second audit task' });

    expect(() => createProviderExecutionAuditChain({
      planning: first.planning,
      context: first.context,
      execution: second.execution,
    })).toThrow(/final context prompt identity/);
  });

  it('rejects receipt tampering even when the continuity fields still look plausible', async () => {
    const receipts = await trace();
    const tampered = {
      ...receipts.context,
      workloadId: 'coding-tampered',
    };

    expect(() => createProviderExecutionAuditChain({
      ...receipts,
      context: tampered as typeof receipts.context,
    })).toThrow(/digest integrity check failed|scope continuity failed/);
  });

  it('verifies exact chain binding and rejects tampering or extra fields', async () => {
    const receipts = await trace({
      contextText: 'context for audit verification',
    });
    const chain = createProviderExecutionAuditChain(receipts);

    expect(verifyProviderExecutionAuditChain(chain, receipts)).toBe(true);

    const reordered = Object.fromEntries(Object.entries(chain).reverse());
    expect(verifyProviderExecutionAuditChain(
      reordered as unknown as typeof chain,
      receipts,
    )).toBe(true);

    const tampered = {
      ...chain,
      model: 'gpt-5.6-luna',
    };
    expect(verifyProviderExecutionAuditChain(
      tampered as typeof chain,
      receipts,
    )).toBe(false);

    const extended = {
      ...chain,
      claim: 'fully-verified',
    };
    expect(verifyProviderExecutionAuditChain(
      extended as unknown as typeof chain,
      receipts,
    )).toBe(false);
  });

  it('changes chain identity when any source receipt changes', async () => {
    const firstReceipts = await trace({ task: 'first receipt chain' });
    const secondReceipts = await trace({ task: 'second receipt chain' });

    const first = createProviderExecutionAuditChain(firstReceipts);
    const second = createProviderExecutionAuditChain(secondReceipts);

    expect(first.receipts.planning).not.toBe(second.receipts.planning);
    expect(first.receipts.context).not.toBe(second.receipts.context);
    expect(first.receipts.execution).not.toBe(second.receipts.execution);
    expect(first.chainDigest).not.toBe(second.chainDigest);
  });
});
