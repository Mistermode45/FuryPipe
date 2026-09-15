import { describe, expect, it } from 'vitest';
import {
  applyInstructionProfiles,
  FURY_INSTRUCTION_PROFILES,
  inspectInstructionProfiles,
  recommendInstructionProfiles,
} from '../src/instruction-profiles.js';
import { compileFuryPrompt } from '../src/fury-prompt.js';

describe('FuryPipe instruction profiles', () => {
  it('applies the Karpathy-inspired profile without replacing caller sections', () => {
    const applied = applyInstructionProfiles({
      sections: {
        task: 'Fix the restart race.',
        constraints: 'Do not change the public CLI.',
      },
      level: 'ENGINEERING',
    }, ['karpathy-coding-discipline']);

    const constraints = applied.input.sections.constraints;
    expect(Array.isArray(constraints)).toBe(true);
    expect(constraints).toContain('Do not change the public CLI.');
    expect(constraints).toEqual(expect.arrayContaining([
      expect.stringContaining('smallest implementation'),
      expect.stringContaining('diff scoped'),
    ]));
    expect(applied.input.sections.task).toBe('Fix the restart race.');
    expect(applied.appliedProfiles).toEqual(['karpathy-coding-discipline']);
  });

  it('compiles into FuryPrompt acceptance/verification sections deterministically', () => {
    const first = applyInstructionProfiles({
      sections: { objective: 'Implement the requested change.' },
    }, ['karpathy-coding-discipline']);
    const second = applyInstructionProfiles({
      sections: { objective: 'Implement the requested change.' },
    }, ['karpathy-coding-discipline']);

    expect(first).toEqual(second);
    const compiled = compileFuryPrompt(first.input);
    expect(compiled.level).toBe('ENGINEERING');
    expect(compiled.prompt).toContain('## Constraints');
    expect(compiled.prompt).toContain('## Acceptance Criteria');
    expect(compiled.prompt).toContain('## Verification');
    expect(compiled.prompt).toContain('observable success criteria');
  });

  it('records immutable source provenance for native instruction adaptations', () => {
    const karpathy = FURY_INSTRUCTION_PROFILES['karpathy-coding-discipline'];
    const specDriven = FURY_INSTRUCTION_PROFILES['spec-driven-development'];
    const debugging = FURY_INSTRUCTION_PROFILES['systematic-debugging'];
    const audit = FURY_INSTRUCTION_PROFILES['codebase-audit-discipline'];
    const ui = FURY_INSTRUCTION_PROFILES['ui-design-discipline'];
    const marketing = FURY_INSTRUCTION_PROFILES['product-marketing-context-discipline'];
    expect(karpathy.source).toEqual({
      repository: 'https://github.com/multica-ai/andrej-karpathy-skills',
      commitSha: '2c606141936f1eeef17fa3043a72095b4765b9c2',
      sourcePath: 'CLAUDE.md',
      licenseStatus: 'DECLARED_MIT_NO_ROOT_LICENSE_FILE',
      decision: 'ADAPT',
    });
    expect(specDriven.source).toEqual({
      repository: 'https://github.com/github/spec-kit',
      commitSha: 'd848fb4e18f44640ad6b42e60a280551ee90cdce',
      sourcePath: 'README.md',
      licenseStatus: 'VERIFIED',
      decision: 'ADAPT',
    });
    expect(debugging.source).toEqual({
      repository: 'https://github.com/obra/superpowers',
      commitSha: 'b36e0829c6d0140e93cfef2ca599b1b07d4a7797',
      sourcePath: 'skills/systematic-debugging/SKILL.md',
      licenseStatus: 'VERIFIED',
      decision: 'ADAPT',
    });
    expect(audit.source).toEqual({
      repository: 'https://github.com/ksimback/tech-debt-skill',
      commitSha: '5a15c1ca4a929b2759461c218478de391a8bda0f',
      sourcePath: 'SKILL.md',
      licenseStatus: 'DECLARED_MIT_NO_ROOT_LICENSE_FILE',
      decision: 'ADAPT',
    });
    expect(ui.source).toEqual({
      repository: 'https://github.com/Nutlope/hallmark',
      commitSha: '13ac0ec7e148655948100b6396439e481361d690',
      sourcePath: 'skills/hallmark/SKILL.md',
      licenseStatus: 'VERIFIED',
      decision: 'ADAPT',
    });
    expect(marketing.source).toEqual({
      repository: 'https://github.com/coreyhaines31/marketingskills',
      commitSha: '5b2c0007766c6a1cf1d53fd8fc73e979e0821022',
      sourcePath: 'skills/product-marketing/SKILL.md',
      licenseStatus: 'VERIFIED',
      decision: 'ADAPT',
    });
    expect(inspectInstructionProfiles()).toEqual([karpathy, specDriven, debugging, audit, ui, marketing]);
  });

  it('applies the Spec Kit inspired profile as a spec-plan-task-verification contract', () => {
    const applied = applyInstructionProfiles({
      sections: {
        objective: 'Add a durable memory subsystem.',
        acceptanceCriteria: 'Memory survives process restart.',
      },
      level: 'ENGINEERING',
    }, ['spec-driven-development']);

    expect(applied.input.sections.acceptanceCriteria).toEqual(expect.arrayContaining([
      'Memory survives process restart.',
      expect.stringContaining('Every implementation task'),
    ]));
    expect(applied.input.sections.plan).toEqual(expect.arrayContaining([
      expect.stringContaining('specification, architecture/technical plan'),
      expect.stringContaining('assumptions, dependencies, risks'),
    ]));
    expect(applied.input.sections.verification).toEqual(expect.arrayContaining([
      expect.stringContaining('against the specification'),
    ]));
    expect(applied.appliedProfiles).toEqual(['spec-driven-development']);
  });

  it('applies systematic debugging as evidence-first root-cause discipline', () => {
    const applied = applyInstructionProfiles({
      sections: { task: 'Fix the flaky provider timeout.' },
      level: 'ENGINEERING',
    }, ['systematic-debugging']);

    expect(applied.input.sections.plan).toEqual(expect.arrayContaining([
      expect.stringContaining('Reproduce the failure'),
      expect.stringContaining('falsifiable root-cause hypothesis'),
    ]));
    expect(applied.input.sections.constraints).toEqual(expect.arrayContaining([
      expect.stringContaining('speculative fixes'),
      expect.stringContaining('reassess whether the architecture'),
    ]));
    expect(applied.input.sections.verification).toEqual(expect.arrayContaining([
      expect.stringContaining('original failure'),
      expect.stringContaining('regression suite'),
    ]));
  });

  it('applies codebase audit discipline without turning suspicions into findings', () => {
    const applied = applyInstructionProfiles({
      sections: { objective: 'Audit the repository before a production hardening pass.' },
      level: 'ENGINEERING',
    }, ['codebase-audit-discipline']);

    expect(applied.input.sections.context).toEqual(expect.arrayContaining([
      expect.stringContaining('module boundaries'),
      expect.stringContaining('recent churn'),
    ]));
    expect(applied.input.sections.constraints).toEqual(expect.arrayContaining([
      expect.stringContaining('Do not pad categories'),
      expect.stringContaining('confirmed debt'),
    ]));
    expect(applied.input.sections.outputContract).toEqual(expect.arrayContaining([
      expect.stringContaining('plausible false positives'),
    ]));
  });

  it('composes spec, minimal-change, debugging and audit profiles deterministically', () => {
    const ids = [
      'karpathy-coding-discipline',
      'spec-driven-development',
      'systematic-debugging',
      'codebase-audit-discipline',
    ] as const;
    const first = applyInstructionProfiles({ sections: { task: 'Repair and harden the failing subsystem.' } }, ids);
    const second = applyInstructionProfiles({ sections: { task: 'Repair and harden the failing subsystem.' } }, ids);
    expect(first).toEqual(second);
    expect(first.appliedProfiles).toEqual(ids);
    expect(compileFuryPrompt(first.input).prompt).toContain('falsifiable root-cause hypothesis');
  });

  it('adds UI design discipline without granting execution authority or inventing proof', () => {
    const applied = applyInstructionProfiles({
      sections: { task: 'Design a production-ready pricing page.' },
      level: 'ENGINEERING',
    }, ['ui-design-discipline']);
    expect(applied.input.sections.context).toEqual(expect.arrayContaining([
      expect.stringContaining('typography'),
      expect.stringContaining('component ownership'),
    ]));
    expect(applied.input.sections.constraints).toEqual(expect.arrayContaining([
      expect.stringContaining('Do not fabricate metrics'),
      expect.stringContaining('pixel-faithful copy'),
    ]));
    expect(applied.input.sections.verification).toEqual(expect.arrayContaining([
      expect.stringContaining('keyboard focus'),
      expect.stringContaining('invented content'),
    ]));
    expect(applied.input.sections.tools).toBeUndefined();
    expect(applied.input.sections.mcp).toBeUndefined();
  });

  it('adds reusable marketing context while keeping facts separate from assumptions', () => {
    const applied = applyInstructionProfiles({
      sections: { objective: 'Create a launch message for a new product.' },
      level: 'ENGINEERING',
    }, ['product-marketing-context-discipline']);
    expect(applied.input.sections.context).toEqual(expect.arrayContaining([
      expect.stringContaining('jobs-to-be-done'),
      expect.stringContaining('proof points'),
    ]));
    expect(applied.input.sections.constraints).toEqual(expect.arrayContaining([
      expect.stringContaining('Do not invent customer quotes'),
      expect.stringContaining('hypotheses separate from facts'),
    ]));
    expect(applied.input.sections.outputContract).toEqual(expect.arrayContaining([
      expect.stringContaining('unresolved questions'),
    ]));
  });

  it('recommends bounded explicit profile sets by workload without prompt-text guessing', () => {
    expect(recommendInstructionProfiles('bugfix')).toEqual([
      'karpathy-coding-discipline',
      'systematic-debugging',
    ]);
    expect(recommendInstructionProfiles('ui-development')).toEqual([
      'karpathy-coding-discipline',
      'spec-driven-development',
      'ui-design-discipline',
    ]);
    expect(recommendInstructionProfiles('marketing')).toEqual([
      'product-marketing-context-discipline',
    ]);
    expect(recommendInstructionProfiles('research')).toEqual([]);
    expect(() => recommendInstructionProfiles('unknown' as 'bugfix')).toThrow(/unknown FuryPipe instruction workload/);
  });

  it('rejects duplicate or unknown profile identities', () => {
    expect(() => applyInstructionProfiles(
      { sections: { task: 'x' } },
      ['karpathy-coding-discipline', 'karpathy-coding-discipline'],
    )).toThrow(/duplicate/);

    expect(() => applyInstructionProfiles(
      { sections: { task: 'x' } },
      ['unknown' as 'karpathy-coding-discipline'],
    )).toThrow(/unknown/);
  });

  it('uses native wording rather than embedding the upstream CLAUDE.md text', () => {
    const encoded = JSON.stringify(inspectInstructionProfiles());
    expect(encoded).not.toContain("Would a senior engineer say this is overcomplicated?");
    expect(encoded).not.toContain("Don't assume. Don't hide confusion.");
    expect(encoded).not.toContain('If you write 200 lines and it could be 50');
    expect(encoded).not.toContain('NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST');
    expect(encoded).not.toContain('Things that look bad but are actually fine');
    expect(encoded).not.toContain('Do not ship slop.');
    expect(encoded).not.toContain('Other marketing skills will now use this context automatically.');
  });
});
