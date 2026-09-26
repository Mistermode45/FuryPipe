import { describe, expect, it } from 'vitest';

import { CONTEXT7_PLUGIN_BUNDLE } from '../src/plugin-bundles.js';
import { planFuryPluginActivation, validateFuryPluginRuntimeDescriptor } from '../src/fury-plugin-runtime.js';

const descriptor = {
  format: 'furypipe-plugin-runtime/v1',
  pluginId: 'context7',
  pluginVersion: '1.0.0',
  hostApiVersion: '1.0.0',
  isolation: 'worker-thread',
  uiExtensions: [{
    id: 'context7-panel',
    surface: 'panel',
    entrypoint: 'ui/context7-panel.js',
    title: 'Context7',
    permissions: ['network'],
  }],
  memoryLimitMiB: 128,
  cpuTimeLimitMs: 5_000,
  networkDefault: 'DENY',
  filesystemDefault: 'DENY',
  secretInjection: 'ENV_NAMES_ONLY',
} as const;

describe('Fury Plugin Runtime Isolation', () => {
  it('validates a deny-by-default isolated runtime descriptor', () => {
    expect(validateFuryPluginRuntimeDescriptor(CONTEXT7_PLUGIN_BUNDLE, descriptor)).toMatchObject({
      pluginId: 'context7',
      isolation: 'worker-thread',
      networkDefault: 'DENY',
      filesystemDefault: 'DENY',
      secretInjection: 'ENV_NAMES_ONLY',
    });
  });

  it('produces deterministic approval-only activation plans', () => {
    const a = planFuryPluginActivation({ bundle: CONTEXT7_PLUGIN_BUNDLE, descriptor, hostApiVersion: '1.4.0' });
    const b = planFuryPluginActivation({ bundle: CONTEXT7_PLUGIN_BUNDLE, descriptor, hostApiVersion: '1.4.0' });

    expect(a.descriptorDigestSha256).toBe(b.descriptorDigestSha256);
    expect(a).toMatchObject({
      compatible: true,
      requiresApproval: true,
      installAuthorized: false,
      networkAuthorized: false,
      filesystemAuthorized: false,
      executionAuthorized: false,
    });
  });

  it('fails compatibility closed without turning incompatibility into execution authority', () => {
    const plan = planFuryPluginActivation({
      bundle: CONTEXT7_PLUGIN_BUNDLE,
      descriptor,
      hostApiVersion: '2.0.0',
      supportedIsolation: ['subprocess'],
    });
    expect(plan.compatible).toBe(false);
    expect(plan.incompatibilities).toHaveLength(2);
    expect(plan.executionAuthorized).toBe(false);
  });

  it('rejects traversal and undeclared UI permissions', () => {
    expect(() => validateFuryPluginRuntimeDescriptor(CONTEXT7_PLUGIN_BUNDLE, {
      ...descriptor,
      uiExtensions: [{ ...descriptor.uiExtensions[0], entrypoint: '../escape.js' }],
    })).toThrow(/entrypoint/u);

    expect(() => validateFuryPluginRuntimeDescriptor(CONTEXT7_PLUGIN_BUNDLE, {
      ...descriptor,
      uiExtensions: [{ ...descriptor.uiExtensions[0], permissions: ['process'] }],
    })).toThrow(/undeclared permission/u);
  });
});
