import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FURY_PLUGIN_BUNDLES,
  CONTEXT7_PLUGIN_BUNDLE,
  GITHUB_MCP_PLUGIN_BUNDLE,
  SUPABASE_PLUGIN_BUNDLE,
  createFuryPluginBundleRegistry,
  inspectFuryPluginBundle,
  validateFuryPluginBundle,
} from '../src/plugin-bundles.js';

describe('Fury plugin bundles', () => {
  it('ships only explicit opt-in built-in bundles with pinned GitHub provenance', () => {
    expect(BUILTIN_FURY_PLUGIN_BUNDLES.map((bundle) => bundle.id)).toEqual([
      'context7',
      'github-mcp',
      'supabase',
    ]);
    for (const bundle of BUILTIN_FURY_PLUGIN_BUNDLES) {
      expect(bundle.mode).toBe('EXTERNAL_OPT_IN');
      expect(bundle.source.url).toMatch(/^https:\/\/github\.com\//);
      expect(bundle.source.commitSha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('models Context7 as OAuth or host-owned bearer auth without embedding a key', () => {
    const profile = CONTEXT7_PLUGIN_BUNDLE.mcpProfiles[0]!;
    expect(profile).toMatchObject({
      transport: 'remote-http',
      url: 'https://mcp.context7.com/mcp',
      authentication: 'oauth-or-bearer-env',
      bearerEnv: 'CONTEXT7_API_KEY',
      readOnlyPreferred: true,
    });

    const inspection = inspectFuryPluginBundle(CONTEXT7_PLUGIN_BUNDLE);
    expect(JSON.stringify(inspection)).not.toContain('bearerEnv');
    expect(inspection.secretEnvironmentVariables).toEqual(['CONTEXT7_API_KEY']);
  });

  it('models GitHub remote MCP as OAuth + read-only preferred', () => {
    expect(GITHUB_MCP_PLUGIN_BUNDLE.mcpProfiles[0]).toMatchObject({
      url: 'https://api.githubcopilot.com/mcp/',
      authentication: 'oauth',
      readOnlyPreferred: true,
      permissions: ['network', 'repository-read'],
    });
    expect(GITHUB_MCP_PLUGIN_BUNDLE.secrets).toEqual([]);
  });

  it('marks Supabase as project-scoped and read-only preferred by default', () => {
    expect(SUPABASE_PLUGIN_BUNDLE.mcpProfiles[0]).toMatchObject({
      url: 'https://mcp.supabase.com/mcp',
      authentication: 'oauth',
      projectScoped: true,
      readOnlyPreferred: true,
      permissions: ['network', 'database-read'],
    });
    expect(SUPABASE_PLUGIN_BUNDLE.permissions).not.toContain('database-write');
  });

  it('rejects credential-bearing and plaintext remote MCP URLs', () => {
    expect(() => validateFuryPluginBundle({
      ...CONTEXT7_PLUGIN_BUNDLE,
      id: 'bad-credentials',
      source: {
        ...CONTEXT7_PLUGIN_BUNDLE.source,
        url: 'https://user:secret@github.com/upstash/context7',
      },
    })).toThrow(/credential-free HTTPS/);

    expect(() => validateFuryPluginBundle({
      ...CONTEXT7_PLUGIN_BUNDLE,
      id: 'bad-mcp-http',
      mcpProfiles: [{
        ...CONTEXT7_PLUGIN_BUNDLE.mcpProfiles[0]!,
        url: 'http://mcp.example.test/mcp',
      }],
    })).toThrow(/credential-free HTTPS/);
  });

  it('requires immutable commit provenance for GitHub-backed sources', () => {
    expect(() => validateFuryPluginBundle({
      ...CONTEXT7_PLUGIN_BUNDLE,
      id: 'unpinned-source',
      source: {
        url: 'https://github.com/upstash/context7',
        licenseStatus: 'VERIFIED',
        licenseSpdx: 'MIT',
      },
    })).toThrow(/pinned commitSha/);
  });

  it('requires bearer env variables to be declared in the secret contract', () => {
    expect(() => validateFuryPluginBundle({
      ...CONTEXT7_PLUGIN_BUNDLE,
      id: 'missing-secret-contract',
      secrets: [],
    })).toThrow(/undeclared secret env/);
  });

  it('rejects auto-installing CLI profiles and duplicate profile identities', () => {
    expect(() => validateFuryPluginBundle({
      ...CONTEXT7_PLUGIN_BUNDLE,
      id: 'auto-install',
      cliProfiles: [{
        id: 'browser-cli',
        packageName: '@playwright/cli',
        executable: 'playwright-cli',
        permissions: ['network', 'browser'],
        autoInstall: true as false,
      }],
    })).toThrow(/must never auto-install/);

    expect(() => validateFuryPluginBundle({
      ...CONTEXT7_PLUGIN_BUNDLE,
      id: 'duplicate-profile',
      cliProfiles: [{
        id: 'context7-mcp',
        packageName: '@playwright/cli',
        executable: 'playwright-cli',
        permissions: ['browser'],
        autoInstall: false,
      }],
    })).toThrow(/duplicate plugin profile id/);
  });

  it('registers bundles deterministically and rejects duplicate bundle ids', () => {
    const registry = createFuryPluginBundleRegistry([
      SUPABASE_PLUGIN_BUNDLE,
      CONTEXT7_PLUGIN_BUNDLE,
      GITHUB_MCP_PLUGIN_BUNDLE,
    ]);
    expect(registry.list().map((bundle) => bundle.id)).toEqual([
      'context7',
      'github-mcp',
      'supabase',
    ]);
    expect(registry.get('context7')).toBe(CONTEXT7_PLUGIN_BUNDLE);
    expect(() => registry.register(CONTEXT7_PLUGIN_BUNDLE)).toThrow(/already registered/);
  });

  it('keeps inspection metadata-only and never returns secret values', () => {
    const registry = createFuryPluginBundleRegistry(BUILTIN_FURY_PLUGIN_BUNDLES);
    const encoded = JSON.stringify(registry.inspect());
    expect(encoded).toContain('CONTEXT7_API_KEY');
    expect(encoded).not.toContain('ctx7sk-');
    expect(encoded).not.toContain('Authorization');
  });
});
