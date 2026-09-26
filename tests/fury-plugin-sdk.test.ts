import { describe, expect, it } from 'vitest';

import {
  assessFuryPluginCompatibility,
  compileFuryPluginSdkArtifact,
  defineFuryPlugin,
} from '../src/fury-plugin-sdk.js';
import {
  CONTEXT7_PLUGIN_BUNDLE,
  PLAYWRIGHT_CLI_PLUGIN_BUNDLE,
  type FuryPluginBundle,
} from '../src/plugin-bundles.js';

describe('Fury Plugin SDK', () => {
  it('reuses the authoritative plugin-bundle validator and compiles deterministic metadata-only artifacts', () => {
    const first = compileFuryPluginSdkArtifact(CONTEXT7_PLUGIN_BUNDLE);
    const second = compileFuryPluginSdkArtifact(CONTEXT7_PLUGIN_BUNDLE);

    expect(first.bundleDigestSha256).toBe(second.bundleDigestSha256);
    expect(first).toMatchObject({
      format: 'furypipe-plugin-sdk-artifact/v1',
      authority: 'validated-plugin-metadata-only',
      executionAuthorized: false,
      profileCount: { mcp: 1, cli: 0, provider: 0, healthChecks: 1 },
    });
    expect(first.inspection.secretEnvironmentVariables).toEqual(['CONTEXT7_API_KEY']);
    expect(JSON.stringify(first.inspection)).not.toContain('bearerEnv');
  });

  it('keeps defineFuryPlugin fail-closed through the existing manifest contract', () => {
    expect(defineFuryPlugin(CONTEXT7_PLUGIN_BUNDLE)).toStrictEqual(CONTEXT7_PLUGIN_BUNDLE);
    expect(() => defineFuryPlugin({
      ...CONTEXT7_PLUGIN_BUNDLE,
      mode: 'AUTO_INSTALL' as never,
    })).toThrow(/EXTERNAL_OPT_IN/u);
  });

  it('reports compatibility from explicit host facts without probing or granting authority', () => {
    const compatible = assessFuryPluginCompatibility(CONTEXT7_PLUGIN_BUNDLE, {
      pluginFormats: ['furypipe-plugin-bundle/v1'],
      permissions: ['network'],
      mcpTransports: ['remote-http'],
      authModes: ['oauth-or-bearer-env'],
    });
    expect(compatible).toMatchObject({
      compatible: true,
      reasons: [],
      authority: 'compatibility-observation-only',
      executionAuthorized: false,
    });

    const blocked = assessFuryPluginCompatibility(PLAYWRIGHT_CLI_PLUGIN_BUNDLE, {
      pluginFormats: ['furypipe-plugin-bundle/v1'],
      permissions: ['network'],
      mcpTransports: ['remote-http'],
      authModes: ['oauth'],
      cliExecutables: [],
    });
    expect(blocked.compatible).toBe(false);
    expect(blocked.missingPermissions).toEqual(['browser', 'process']);
    expect(blocked.missingCliExecutables).toEqual(['playwright-cli']);
    expect(blocked.reasons.join(' ')).toMatch(/permissions/u);
  });

  it('changes the artifact digest when reviewed plugin metadata changes', () => {
    const original = compileFuryPluginSdkArtifact(CONTEXT7_PLUGIN_BUNDLE);
    const changed: FuryPluginBundle = {
      ...CONTEXT7_PLUGIN_BUNDLE,
      version: '1.0.1',
    };
    expect(compileFuryPluginSdkArtifact(changed).bundleDigestSha256)
      .not.toBe(original.bundleDigestSha256);
  });

  it('never stores secret values in the authoring artifact', () => {
    const artifact = compileFuryPluginSdkArtifact(CONTEXT7_PLUGIN_BUNDLE);
    const encoded = JSON.stringify(artifact);
    expect(encoded).toContain('CONTEXT7_API_KEY');
    expect(encoded).not.toContain('ctx7sk-');
    expect(encoded).not.toContain('Authorization: Bearer');
  });
});
