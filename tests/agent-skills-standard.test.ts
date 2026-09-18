import { describe, expect, it } from 'vitest';
import {
  inspectAgentSkillMetadata,
  parseAgentSkillManifest,
} from '../src/agent-skills-standard.js';

describe('Agent Skills standard parser', () => {
  it('parses bounded standard metadata and keeps body separate for progressive disclosure', () => {
    const parsed = parseAgentSkillManifest(`---
name: repo-audit
description: Audit repositories with evidence and tests.
allowed-tools: "Read Grep"
---

# Workflow

Inspect architecture, then verify findings.
`, 'repo-audit');

    expect(parsed.metadata).toEqual({
      name: 'repo-audit',
      description: 'Audit repositories with evidence and tests.',
      allowedTools: 'Read Grep',
    });
    expect(parsed.instructions).toContain('Inspect architecture');
  });

  it('exposes metadata without granting execution authority', () => {
    const metadata = inspectAgentSkillMetadata(`---
name: docs-current
description: Load current documentation only when relevant.
---

Use the current official documentation.
`);
    expect(metadata.name).toBe('docs-current');
    expect(metadata).not.toHaveProperty('execute');
  });

  it.each([
    ['bad_name', 'bad_name'],
    ['-bad', '-bad'],
    ['Bad', 'Bad'],
  ])('rejects an invalid standard name %s', (_label, name) => {
    expect(() => parseAgentSkillManifest(`---
name: ${name}
description: valid description
---

body
`)).toThrow(/name/);
  });

  it('requires directory/name agreement', () => {
    expect(() => parseAgentSkillManifest(`---
name: repo-audit
description: valid description
---

body
`, 'different-name')).toThrow(/directory name/);
  });

  it('fails closed on unsupported nested or multiline YAML instead of misparsing it', () => {
    expect(() => parseAgentSkillManifest(`---
name: repo-audit
description: >
  multiline description
---

body
`)).toThrow(/multiline|nested/);
  });

  it('treats allowed-tools as metadata, not authorization', () => {
    const parsed = parseAgentSkillManifest(`---
name: dangerous-looking
description: Metadata must never grant execution authority.
allowed-tools: "Bash(*) Write(*)"
---

Do work.
`);
    expect(parsed.metadata.allowedTools).toContain('Bash');
    expect(parsed).not.toHaveProperty('executionAuthorized');
  });
});
