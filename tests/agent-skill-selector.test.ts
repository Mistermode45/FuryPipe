import { describe, expect, it } from 'vitest';
import { selectAgentSkillsForTask } from '../src/agent-skill-selector.js';

describe('Agent Skill task selector', () => {
  const candidates = [
    {
      name: 'systematic-debugging',
      description: 'Investigate bugs, failing tests, crashes, regressions and root causes before changing code.',
      activationEligible: true,
    },
    {
      name: 'seo-audit',
      description: 'Audit technical SEO, metadata, indexing, structured data and search visibility for websites.',
      activationEligible: true,
    },
    {
      name: 'untrusted-deploy',
      description: 'Deploy production infrastructure.',
      activationEligible: false,
    },
  ] as const;

  it('selects the relevant eligible skill without loading unrelated skills', () => {
    const plan = selectAgentSkillsForTask(
      'The tests fail after my refactor. Investigate the root cause of this regression.',
      candidates,
    );
    expect(plan.selected.map((item) => item.name)).toEqual(['systematic-debugging']);
    expect(plan.executionAuthorized).toBe(false);
  });

  it('gives explicit activation syntax deterministic priority', () => {
    const plan = selectAgentSkillsForTask(
      'Use $seo-audit and review this landing page.',
      candidates,
      { maxActive: 1 },
    );
    expect(plan.selected).toEqual([
      expect.objectContaining({ name: 'seo-audit', reason: 'explicit_user_activation' }),
    ]);
  });

  it('treats explicit activation as exclusive over automatic relevance matches', () => {
    const plan = selectAgentSkillsForTask(
      'Use $seo-audit while debugging this failing test and root cause.',
      candidates,
    );

    expect(plan.selected).toEqual([
      expect.objectContaining({
        name: 'seo-audit',
        reason: 'explicit_user_activation',
      }),
    ]);
    expect(plan.selected.map((item) => item.name)).not.toContain('systematic-debugging');
  });

  it('does not activate an explicitly requested untrusted skill', () => {
    const plan = selectAgentSkillsForTask(
      'Please use /untrusted-deploy now.',
      candidates,
    );
    expect(plan.selected.map((item) => item.name)).not.toContain('untrusted-deploy');
    expect(plan.blocked).toContainEqual({
      name: 'untrusted-deploy',
      reason: 'activation_not_eligible',
      requestedExplicitly: true,
    });
  });

  it('normalizes sentence-final periods without destroying internal identifier dots', () => {
    const plan = selectAgentSkillsForTask(
      'Debug this failing test and find the root cause.',
      [{
        name: 'systematic-debugging',
        description: 'Investigate bugs and root causes before changing code.',
        activationEligible: true,
      }],
    );
    expect(plan.selected).toEqual([
      expect.objectContaining({ name: 'systematic-debugging', reason: 'description_relevance' }),
    ]);
  });

  it('does not select skills for unrelated objectives', () => {
    const plan = selectAgentSkillsForTask('Translate this sentence into French.', candidates);
    expect(plan.selected).toEqual([]);
  });
});