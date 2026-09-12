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

  it('records immutable source provenance without claiming a root LICENSE file exists', () => {
    const profile = FURY_INSTRUCTION_PROFILES['karpathy-coding-discipline'];
    expect(profile.source).toEqual({
      repository: 'https://github.com/multica-ai/andrej-karpathy-skills',
      commitSha: '2c606141936f1eeef17fa3043a72095b4765b9c2',
      sourcePath: 'CLAUDE.md',
      licenseStatus: 'DECLARED_MIT_NO_ROOT_LICENSE_FILE',
      decision: 'ADAPT',
    });
    expect(inspectInstructionProfiles()).toEqual([profile]);
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
