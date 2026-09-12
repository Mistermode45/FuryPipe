import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FURY_PLUGIN_BUNDLES,
  CLOUDFLARE_PLUGIN_BUNDLE,
  CONTEXT7_PLUGIN_BUNDLE,
  EXA_PLUGIN_BUNDLE,
  FIGMA_PLUGIN_BUNDLE,
  GITHUB_MCP_PLUGIN_BUNDLE,
  PLAYWRIGHT_CLI_PLUGIN_BUNDLE,
  SUPABASE_PLUGIN_BUNDLE,
  createFuryPluginBundleRegistry,
  inspectFuryPluginBundle,
  validateFuryPluginBundle,
} from '../src/plugin-bundles.js';

describe('Fury plugin bundles', () => {
  it('ships only explicit opt-in built-in bundles and pins every GitHub-backed source', () => {
    expect(BUILTIN_FURY_PLUGIN_BUNDLES.map((bundle) => bundle.id)).toEqual([
      'cloudflare',
      'context7',
      'exa',
      'figma',
      'github-mcp',
      'playwright-cli',
      'supabase',
    ]);
    for (const bundle of BUILTIN_FURY_PLUGIN_BUNDLES) {
      expect(bundle.mode).toBe('EXTERNAL_OPT_IN');
      expect(bundle.source.url).toMatch(/^https:\/\//);
      if (new URL(bundle.source.url).hostname === 'github.com') {
        expect(bundle.source.commitSha).toMatch(/^[0-9a-f]{40}$/);
      }
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

  it('pins the Playwright CLI package and never auto-installs it', () => {
    expect(PLAYWRIGHT_CLI_PLUGIN_BUNDLE.cliProfiles[0]).toMatchObject({
      packageName: '@playwright/cli',
      packageVersion: '0.1.19',
      executable: 'playwright-cli',
      autoInstall: false,
      permissions: ['browser', 'process', 'network'],
    });
    expect(PLAYWRIGHT_CLI_PLUGIN_BUNDLE.source.commitSha)
      .toBe('655530f6d0dc71a0d6bf46ae165877d3c7311099');
  });

  it('models Figma as OAuth design-read only by default', () => {
    expect(FIGMA_PLUGIN_BUNDLE.mcpProfiles[0]).toMatchObject({
      url: 'https://mcp.figma.com/mcp',
      authentication: 'oauth',
      readOnlyPreferred: true,
      permissions: ['network', 'design-read'],
    });
    expect(FIGMA_PLUGIN_BUNDLE.permissions).not.toContain('design-write');
    expect(FIGMA_PLUGIN_BUNDLE.source.licenseStatus).toBe('NOT_APPLICABLE');
  });

  it('models Cloudflare API MCP as OAuth cloud-read only by default', () => {
    expect(CLOUDFLARE_PLUGIN_BUNDLE.mcpProfiles[0]).toMatchObject({
      url: 'https://mcp.cloudflare.com/mcp',
      authentication: 'oauth',
      readOnlyPreferred: true,
      permissions: ['network', 'cloud-read'],
    });
    expect(CLOUDFLARE_PLUGIN_BUNDLE.permissions).not.toContain('cloud-write');
    expect(CLOUDFLARE_PLUGIN_BUNDLE.source.commitSha)
      .toBe('1027dbd2865fc1932120db42ed53749bc30d2af0');
  });

  it('models Exa as a bounded research MCP profile without embedding an API key', () => {
    expect(EXA_PLUGIN_BUNDLE.mcpProfiles[0]).toMatchObject({
      url: 'https://mcp.exa.ai/mcp',
      authentication: 'oauth',
      readOnlyPreferred: true,
      permissions: ['network'],
    });
    expect(EXA_PLUGIN_BUNDLE.secrets).toEqual([]);
    expect(EXA_PLUGIN_BUNDLE.source.commitSha)
      .toBe('15ffb50519e719dc791cdc750ce5ed1934c0a1ed');
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
        packageVersion: '0.1.19',
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
        packageVersion: '0.1.19',
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
    expect(registry.get('context7')).toStrictEqual(CONTEXT7_PLUGIN_BUNDLE);
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
