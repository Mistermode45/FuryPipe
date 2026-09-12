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
