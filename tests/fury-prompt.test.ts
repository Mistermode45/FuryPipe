import { describe, expect, it } from 'vitest';
import { compileFuryPrompt } from '../src/fury-prompt.js';

describe('FuryPrompt compiler', () => {
  it('keeps a short task compact instead of adding a structured wrapper', () => {
    const compiled = compileFuryPrompt({ sections: { task: 'List the current branch.' } });

    expect(compiled.level).toBe('TRIVIAL');
    expect(compiled.explanation.strategy).toBe('compact');
    expect(compiled.prompt).toBe('List the current branch.');
    expect(compiled.prompt).not.toContain('## Task');
  });

  it('renders every supported section in a stable canonical order', () => {
    const compiled = compileFuryPrompt({
      sections: {
        verification: 'Run the checks.',
        acceptanceCriteria: 'All acceptance criteria are observable.',
        outputContract: 'Return evidence.',
        subagents: ['reviewer', 'verifier'],
        mcp: 'Use the bounded MCP registry.',
        skills: 'Use only approved skills.',
        tools: 'Use the read-only tool set.',
        plan: 'Research, implement, review, verify.',
        task: 'Implement the change.',
        constraints: 'Do not widen the scope.',
        inputs: 'The supplied repository state.',
        context: 'A production hardening task.',
        objective: 'Reduce operational risk.',
        role: 'Senior maintainer.',
        intent: 'Improve reliability.',
      },
      level: 'MULTI_AGENT',
    });

    expect(compiled.level).toBe('MULTI_AGENT');
    expect(compiled.source.orderedSections).toEqual([
      'intent', 'role', 'objective', 'context', 'inputs', 'constraints', 'task', 'plan',
      'tools', 'skills', 'mcp', 'subagents', 'outputContract', 'acceptanceCriteria', 'verification',
    ]);
    expect(compiled.prompt.indexOf('## Intent')).toBeLessThan(compiled.prompt.indexOf('## Task'));
    expect(compiled.prompt.indexOf('## Task')).toBeLessThan(compiled.prompt.indexOf('## Subagents'));
    expect(compiled.prompt).toContain('- reviewer');
    expect(compiled.prompt).toContain('Return evidence.');
  });

  it('is deterministic and exposes exactness metadata without changing exact values', () => {
    const input = {
      sections: {
        objective: 'Preserve id req_1234 and path C:\\Work\\FuryPipe\\src\\index.ts exactly.',
        constraints: ['Do not alter SHA 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.'],
      },
      exactGuardMode: 'coding-safe' as const,
    };
    const first = compileFuryPrompt(input);
    const second = compileFuryPrompt(input);

    expect(first).toEqual(second);
    expect(first.prompt).toContain('req_1234');
    expect(first.prompt).toContain('C:\\Work\\FuryPipe\\src\\index.ts');
    expect(first.exactGuard.mode).toBe('coding-safe');
    expect(first.exactGuard.manifest.sourceHash).toBe(first.promptDigest.slice(3));
    expect(first.exactGuard.manifest.spans.length).toBeGreaterThan(0);
    expect(first.integrationHints).toEqual({
      contextFabric: 'section_metadata_and_sha256',
      agentFabric: 'stage_contract_and_read_default',
    });
  });

  it('only enters the security-critical format with an explicit signal', () => {
    const automatic = compileFuryPrompt({ sections: { task: 'Review authentication.' } });
    const critical = compileFuryPrompt({ sections: { task: 'Review authentication.' }, securityCritical: true });

    expect(automatic.level).toBe('TRIVIAL');
    expect(critical.level).toBe('SECURITY_CRITICAL');
    expect(critical.prompt).toContain('[FuryPipe SECURITY_CRITICAL compilation]');
    expect(critical.explanation.reason).toContain('caller-selected');
  });

  it('rejects empty sections and oversized collections before rendering', () => {
    expect(() => compileFuryPrompt({ sections: { task: '   ' } })).toThrow('empty value');
    expect(() => compileFuryPrompt({ sections: { tools: Array.from({ length: 257 }, (_, index) => `tool-${index}`) } })).toThrow('too many values');
  });
});
