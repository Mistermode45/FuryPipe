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

  it('discovers metadata from frontmatter alone without loading the skill body', () => {
    const metadata = inspectAgentSkillMetadata(`---
name: docs-current
description: Load current documentation only when relevant.
---
`);
    expect(metadata.name).toBe('docs-current');
    expect(metadata).not.toHaveProperty('execute');
  });

  it('supports the optional standard license, compatibility and metadata fields', () => {
    const parsed = parseAgentSkillManifest(`---
name: pdf-processing
description: Extract PDF text and merge documents when the task involves PDFs.
license: Apache-2.0
compatibility: Requires Python 3.14+ and uv
metadata:
  author: example-org
  version: "1.0"
allowed-tools: "Read Bash(pdftotext:*)"
---

Process the document safely.
`, 'pdf-processing');

    expect(parsed.metadata).toEqual({
      name: 'pdf-processing',
      description: 'Extract PDF text and merge documents when the task involves PDFs.',
      license: 'Apache-2.0',
      compatibility: 'Requires Python 3.14+ and uv',
      metadata: { author: 'example-org', version: '1.0' },
      allowedTools: 'Read Bash(pdftotext:*)',
    });
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

  it('fails closed on unsupported multiline YAML outside the standard metadata map', () => {
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