import { describe, expect, it } from 'vitest';

import { CONTEXT7_PLUGIN_BUNDLE } from '../src/plugin-bundles.js';
import { compileFuryPluginManifest, defineFuryPlugin } from '../src/fury-plugin-sdk.js';

describe('Fury Plugin SDK', () => {
  it('uses the existing plugin-bundle validator instead of creating a parallel authority model', () => {
    const plugin = defineFuryPlugin(CONTEXT7_PLUGIN_BUNDLE);
    expect(plugin).toEqual(CONTEXT7_PLUGIN_BUNDLE);
    expect(plugin.mode).toBe('EXTERNAL_OPT_IN');
  });

  it('compiles deterministic redacted manifests without installation or execution authority', () => {
    const a = compileFuryPluginManifest(CONTEXT7_PLUGIN_BUNDLE);
    const b = compileFuryPluginManifest(CONTEXT7_PLUGIN_BUNDLE);

    expect(a.manifestDigestSha256).toBe(b.manifestDigestSha256);
    expect(a.manifestDigestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(a).toMatchObject({
      format: 'furypipe-plugin-sdk-manifest/v1',
      authority: 'authoring-and-inspection-only',
      installAuthorized: false,
      networkAuthorized: false,
      filesystemAuthorized: false,
      executionAuthorized: false,
    });
    expect(JSON.stringify(a)).toContain('CONTEXT7_API_KEY');
    expect(JSON.stringify(a)).not.toContain('bearerEnv');
    expect(JSON.stringify(a)).not.toContain('Authorization');
  });

  it('fails closed through the canonical bundle validator', () => {
    expect(() => defineFuryPlugin({
      ...CONTEXT7_PLUGIN_BUNDLE,
      id: 'unsafe-sdk-plugin',
      mode: 'AUTO' as never,
    })).toThrow(/EXTERNAL_OPT_IN/u);
  });
});
