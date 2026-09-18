import { describe, expect, it } from 'vitest';
import { createAgentSkillActivationReceipt } from '../src/agent-skill-activation.js';

describe('Agent Skill activation receipt', () => {
  it('records activation without pretending execution authority exists', async () => {
    const receipt = await createAgentSkillActivationReceipt({
      name: 'repo-audit',
      description: 'Audit repositories.',
      allowedTools: 'Read',
    }, 'Inspect architecture and verify findings.');

    expect(receipt).toMatchObject({
      format: 'furypipe-agent-skill-activation/v1',
      skillId: 'repo-audit',
      status: 'activated',
      executionAuthorized: false,
    });
    expect(receipt.instructionBytes).toBeGreaterThan(0);
    expect(receipt.instructionSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(receipt).not.toHaveProperty('executed');
  });

  it('rejects empty or oversized activation payloads', async () => {
    await expect(createAgentSkillActivationReceipt({
      name: 'repo-audit',
      description: 'Audit repositories.',
    }, '')).rejects.toThrow(/instruction text/);

    await expect(createAgentSkillActivationReceipt({
      name: 'repo-audit',
      description: 'Audit repositories.',
    }, 'x'.repeat(256 * 1024 + 1))).rejects.toThrow(/bounded size/);
  });
});
