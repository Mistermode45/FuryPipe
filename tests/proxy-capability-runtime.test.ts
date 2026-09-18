import { describe, expect, it } from 'vitest';
import { applyAnthropicCapabilityInstructions } from '../src/proxy-capability-augment.js';
import { validateProxyCapabilityInstructionPlan } from '../src/proxy-capability-runtime.js';

function plan() {
  return {
    format: 'furypipe-proxy-capability-instructions/v1' as const,
    blocks: [{
      kind: 'agent-skill' as const,
      id: 'systematic-debugging',
      text: '<furypipe_active_skill name="systematic-debugging">Investigate root cause first.</furypipe_active_skill>',
    }],
    evidence: {
      format: 'furypipe-proxy-capability-evidence/v1' as const,
      selectedSkillIds: ['systematic-debugging'],
      activatedSkills: [{
        format: 'furypipe-agent-skill-activation/v1' as const,
        skillId: 'systematic-debugging',
        status: 'activated' as const,
        instructionBytes: 29,
        instructionSha256: 'a'.repeat(64),
        executionAuthorized: false as const,
      }],
      blockedSkillIds: [],
      executionAuthorized: false as const,
    },
  };
}

describe('proxy capability instruction plan', () => {
  it('validates bounded activation evidence without granting execution', () => {
    expect(validateProxyCapabilityInstructionPlan(plan()).evidence.executionAuthorized).toBe(false);
  });

  it('injects activated skill instructions as native Anthropic system text', () => {
    const body = new TextEncoder().encode(JSON.stringify({
      model: 'claude-opus-5',
      system: 'base',
      messages: [{ role: 'user', content: 'debug this bug' }],
    }));
    const owned = new Uint8Array(new ArrayBuffer(body.byteLength));
    owned.set(body);

    const out = applyAnthropicCapabilityInstructions(owned, plan());
    const parsed = JSON.parse(new TextDecoder().decode(out)) as { system: Array<{ text: string }> };
    expect(parsed.system.map((item) => item.text).join('\n')).toContain('furypipe_active_skill');
    expect(parsed.system.map((item) => item.text).join('\n')).toContain('Investigate root cause first.');
  });

  it('does not duplicate an already activated skill on retries', () => {
    const source = {
      model: 'claude-opus-5',
      system: '<furypipe_active_skill name="systematic-debugging">Already active.</furypipe_active_skill>',
      messages: [{ role: 'user', content: 'debug this bug' }],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(source));
    const owned = new Uint8Array(new ArrayBuffer(bytes.byteLength));
    owned.set(bytes);
    expect(applyAnthropicCapabilityInstructions(owned, plan())).toBe(owned);
  });

  it('rejects malformed receipts instead of silently accepting fake execution state', () => {
    const invalid = {
      ...plan(),
      evidence: { ...plan().evidence, executionAuthorized: true },
    } as unknown as Parameters<typeof validateProxyCapabilityInstructionPlan>[0];
    expect(() => validateProxyCapabilityInstructionPlan(invalid)).toThrow(/invalid/);
  });
});
