import { describe, expect, it } from 'vitest';
import {
  applyInstructionProfiles,
  FURY_INSTRUCTION_PROFILES,
  inspectInstructionProfiles,
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
    expect(inspectInstructionProfiles()).toEqual([karpathy, specDriven]);
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
  });
});
