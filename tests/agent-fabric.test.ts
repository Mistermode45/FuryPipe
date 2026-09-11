import { describe, expect, it } from 'vitest';
import { AGENT_FABRIC_DECISIONS, createAgentFabricPlan } from '../src/agent-fabric.js';

describe('FuryPipe Agent Fabric', () => {
  it('keeps the concept ledger explicit and decision-oriented', () => {
    expect(AGENT_FABRIC_DECISIONS.length).toBeGreaterThanOrEqual(7);
    expect(AGENT_FABRIC_DECISIONS.every((entry) => entry.source && entry.reference && entry.license && entry.security && entry.maintenance)).toBe(true);
    expect(AGENT_FABRIC_DECISIONS.map((entry) => entry.decision)).toEqual(expect.arrayContaining(['ADAPT', 'WRAP', 'REFERENCE_ONLY', 'REJECT']));
  });

  it('creates a read-only plan by default with ordered evidence gates', () => {
    const plan = createAgentFabricPlan({ objective: 'Review provider routing and verify the release gates' });

    expect(plan).toMatchObject({
      format: 'furypipe-agent-fabric-plan/v1',
      status: 'plan_only',
      output: 'metadata_only',
      contextBudgetTokens: 16_000,
      permissions: { default: 'read', writeStage: 'none', network: 'disabled', secrets: 'never_requested' },
    });
    expect(plan.stages.map((stage) => stage.id)).toEqual(['research', 'plan', 'implement', 'review', 'verify']);
    expect(plan.stages.every((stage) => stage.permission === 'read')).toBe(true);
    expect(plan.gates).toEqual(['evidence_before_plan', 'review_before_verify', 'failed_gate_blocks_completion']);
  });

  it('requires explicit scoped write authority and bounds the context budget', () => {
    const plan = createAgentFabricPlan({ objective: 'Apply an approved local patch', allowWrites: true, contextBudgetTokens: 2048 });
    expect(plan.permissions.writeStage).toBe('implementer');
    expect(plan.stages.find((stage) => stage.id === 'implement')?.permission).toBe('scoped-write');
    expect(() => createAgentFabricPlan({ objective: 'x', contextBudgetTokens: 255 })).toThrow();
    expect(() => createAgentFabricPlan({ objective: 'x', contextBudgetTokens: 200_001 })).toThrow();
  });

  it('digests objectives instead of persisting their plaintext', () => {
    const plan = createAgentFabricPlan({ objective: 'private prompt value 123' });
    expect(plan.objectiveDigest).toMatch(/^af_[a-f0-9]{16}$/);
    expect(JSON.stringify(plan)).not.toContain('private prompt value 123');
  });

  it('records explicit FuryPrompt routing metadata without persisting its plaintext', () => {
    const plan = createAgentFabricPlan({
      objective: 'Execute the approved workflow.',
      furyPrompt: { sections: { task: 'Preserve the exact tool contract.' }, level: 'ENGINEERING' },
    });

    expect(plan.furyPrompt).toMatchObject({ level: 'ENGINEERING', promptBytes: expect.any(Number) });
    expect(plan.furyPrompt?.promptDigest).toMatch(/^fp_[a-f0-9]{64}$/);
    expect(JSON.stringify(plan)).not.toContain('Preserve the exact tool contract.');
  });
});
