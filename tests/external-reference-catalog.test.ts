import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_REFERENCE_CATALOG,
  inspectExternalReferences,
  referencesByCapability,
} from '../src/external-reference-catalog.js';

describe('external reference catalog', () => {
  it('pins every GitHub source and keeps IDs unique', () => {
    expect(new Set(EXTERNAL_REFERENCE_CATALOG.map((entry) => entry.id)).size).toBe(
      EXTERNAL_REFERENCE_CATALOG.length,
    );
    for (const entry of EXTERNAL_REFERENCE_CATALOG) {
      if (entry.kind === 'github') {
        expect(entry.commitSha).toMatch(/^[0-9a-f]{40}$/);
      } else {
        expect(entry.commitSha).toBeUndefined();
      }
    }
  });

  it('keeps commercial and uncertain sources out of executable integration modes', () => {
    for (const entry of EXTERNAL_REFERENCE_CATALOG) {
      if (entry.licenseStatus === 'COMMERCIAL') {
        expect(entry.mode).toBe('REFERENCE_ONLY');
      }
    }
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'horizonx')).toMatchObject({
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'COMMERCIAL',
    });
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'strix-claude-code')).toMatchObject({
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'UNKNOWN',
    });
  });

  it('classifies requested app-building references without silently enabling them', () => {
    expect(referencesByCapability('browser-automation').map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['playwright-cli', 'strix-claude-code']),
    );
    expect(referencesByCapability('app-backend').map((entry) => entry.id)).toContain('supabase-ai-plugin');
    expect(referencesByCapability('ui-design').map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['playwright-cli', 'addy-agent-skills', 'ui-skills', 'horizonx']),
    );
    expect(referencesByCapability('documentation-retrieval').map((entry) => entry.id)).toContain('context7');
  });

  it('marks OmniRoute as an adapter candidate, not an active provider', () => {
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'omniroute')).toMatchObject({
      mode: 'ADAPTER_CANDIDATE',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'MIT',
      capabilities: expect.arrayContaining(['provider-gateway']),
    });
  });

  it('catalogs current skill/spec standards and memory backends without auto-enabling them', () => {
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'agent-skills-standard')).toMatchObject({
      mode: 'ADAPTER_CANDIDATE',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'Apache-2.0',
      capabilities: expect.arrayContaining(['skill-standard']),
    });
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'github-spec-kit')).toMatchObject({
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'VERIFIED',
      capabilities: expect.arrayContaining(['spec-driven-development']),
    });
    expect(referencesByCapability('memory-backend').map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['mem0', 'letta', 'graphiti']),
    );
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'graphiti')?.capabilities)
      .toContain('temporal-knowledge');
  });

  it('catalogs 2026 registries as discovery rather than execution authority', () => {
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'skills-re')).toMatchObject({
      kind: 'service',
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'NOT_APPLICABLE',
      capabilities: expect.arrayContaining(['skill-registry', 'agent-skills']),
    });
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'antigravity-awesome-skills')).toMatchObject({
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'REPORTED',
      commitSha: 'fa724b5e12b4e77870ab8a85e5e587474d6cee91',
      capabilities: expect.arrayContaining(['skill-registry', 'security-testing']),
    });
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'voltagent-awesome-agent-skills')).toMatchObject({
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'REPORTED',
    });
  });

  it('keeps mixed or source-available context tools conservative', () => {
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'caveman')).toMatchObject({
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'REPORTED',
      commitSha: '15581d14007fd01fb3f132016741962f34936ca2',
    });
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'context-mode')).toMatchObject({
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'Elastic-2.0',
      commitSha: 'ba5f5dfd1a0cd3e8a8f812c219d50390ed0a61c8',
    });
    expect(referencesByCapability('context-efficiency').map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['caveman', 'context-mode', 'code-review-graph']),
    );
  });

  it('pins requested API and code-audit references without overstating trust', () => {
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'api-evangelist-api-layer')).toMatchObject({
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'UNKNOWN',
      commitSha: '549115d70ebd9f0163810b1e5fc3a1b264c53df6',
      capabilities: ['api-discovery'],
    });
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'tech-debt-skill')).toMatchObject({
      mode: 'REFERENCE_ONLY',
      licenseStatus: 'REPORTED',
      commitSha: '5a15c1ca4a929b2759461c218478de391a8bda0f',
    });
  });

  it('allows verified official and specialist skill sources to remain adapter candidates only', () => {
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'microsoft-skills')).toMatchObject({
      mode: 'ADAPTER_CANDIDATE',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'MIT',
    });
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'gemini-skills')).toMatchObject({
      mode: 'ADAPTER_CANDIDATE',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'Apache-2.0',
    });
    expect(EXTERNAL_REFERENCE_CATALOG.find((entry) => entry.id === 'supabase-agent-skills')).toMatchObject({
      mode: 'ADAPTER_CANDIDATE',
      licenseStatus: 'VERIFIED',
      licenseSpdx: 'MIT',
    });
    expect(referencesByCapability('ui-design').map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['ui-ux-pro-max', 'hallmark']),
    );
    expect(referencesByCapability('marketing').map((entry) => entry.id)).toContain('marketing-skills');
    expect(referencesByCapability('code-review').map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['tech-debt-skill', 'hallmark', 'code-review-graph']),
    );
  });

  it('returns defensive copies from inspection helpers', () => {
    const first = inspectExternalReferences();
    expect(first).not.toBe(EXTERNAL_REFERENCE_CATALOG);
    expect(first[0]?.capabilities).not.toBe(EXTERNAL_REFERENCE_CATALOG[0]?.capabilities);
  });

  it('keeps AGPL references visible but reference-only', () => {
    expect(EXTERNAL_REFERENCE_CATALOG.filter((entry) => entry.licenseSpdx === 'AGPL-3.0')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'openmontage', mode: 'REFERENCE_ONLY' }),
        expect.objectContaining({ id: 'claude-squad', mode: 'REFERENCE_ONLY' }),
      ]),
    );
  });
});
