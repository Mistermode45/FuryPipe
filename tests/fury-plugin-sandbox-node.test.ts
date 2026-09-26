import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FuryPluginBundle } from '../src/plugin-bundles.js';
import type { FuryPluginRuntimeDescriptor } from '../src/fury-plugin-runtime.js';
import {
  approveFuryPluginSandboxExecution,
  executeFuryPluginSandbox,
  planFuryPluginSandboxExecution,
  type FuryPluginSandboxApproval,
} from '../src/fury-plugin-sandbox-node.js';

const bundle: FuryPluginBundle = {
  format: 'furypipe-plugin-bundle/v1',
  id: 'pure-plugin',
  name: 'Pure Plugin',
  version: '1.0.0',
  mode: 'EXTERNAL_OPT_IN',
  source: {
    url: 'https://plugins.example.test/pure-plugin',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
  },
  skills: [],
  mcpProfiles: [],
  cliProfiles: [],
  providerProfiles: [],
  permissions: [],
  secrets: [],
  healthChecks: [],
};

const descriptor: FuryPluginRuntimeDescriptor = {
  format: 'furypipe-plugin-runtime/v1',
  pluginId: 'pure-plugin',
  pluginVersion: '1.0.0',
  hostApiVersion: '1.0.0',
  isolation: 'subprocess',
  uiExtensions: [],
  memoryLimitMiB: 64,
  cpuTimeLimitMs: 10_000,
  networkDefault: 'DENY',
  filesystemDefault: 'DENY',
  secretInjection: 'ENV_NAMES_ONLY',
};

describe('Fury Plugin Sandbox Node', () => {
  it('fails closed on Node versions that cannot deny network through the Permission Model', () => {
    const plan = planFuryPluginSandboxExecution({
      bundle,
      descriptor,
      entrypoint: 'plugin.mjs',
      hostApiVersion: '1.2.0',
      hostNodeVersion: '24.21.0',
    });
    expect(plan).toMatchObject({
      state: 'REJECTED',
      networkAuthorized: false,
      filesystemWriteAuthorized: false,
      executionAuthorized: false,
    });
    expect(plan.reasons.join(' ')).toMatch(/Node <25/u);
    expect(() => approveFuryPluginSandboxExecution(plan, {
      confirm: true,
      approvedBy: 'operator',
      approvedAt: '2026-09-26T17:30:00.000Z',
    })).toThrow(/rejected/u);
  });

  it('rejects runtime-authority plugins from zero-authority sandbox v1', () => {
    const plan = planFuryPluginSandboxExecution({
      bundle: { ...bundle, permissions: ['network'] },
      descriptor: { ...descriptor },
      entrypoint: 'plugin.mjs',
      hostApiVersion: '1.0.0',
      hostNodeVersion: '26.8.2',
    });
    expect(plan.state).toBe('REJECTED');
    expect(plan.reasons.join(' ')).toMatch(/zero-authority/u);
  });

  it('uses process-local plans and approvals so serialized forgeries cannot execute', async () => {
    const plan = planFuryPluginSandboxExecution({
      bundle,
      descriptor,
      entrypoint: 'plugin.mjs',
      hostApiVersion: '1.0.0',
      hostNodeVersion: process.versions.node,
    });
    if (Number(process.versions.node.split('.')[0]) < 25) {
      expect(plan.state).toBe('REJECTED');
      return;
    }
    expect(plan.state).toBe('READY_FOR_APPROVAL');
    const forged = {
      format: 'furypipe-plugin-sandbox-approval/v1',
      planDigestSha256: plan.planDigestSha256,
      approvedBy: 'forged',
      approvedAt: '2026-09-26T17:30:00.000Z',
      executionAuthorized: true,
    } as FuryPluginSandboxApproval;
    await expect(executeFuryPluginSandbox({
      plan,
      approval: forged,
      pluginRoot: tmpdir(),
      payload: {},
    })).rejects.toThrow(/forged or replayed/u);
  });

  it('executes an approved single-file plugin with deny-by-default host authority on Node 25+', async () => {
    if (Number(process.versions.node.split('.')[0]) < 25) return;
    const root = mkdtempSync(join(tmpdir(), 'furypipe-plugin-sandbox-'));
    const pluginRoot = join(root, 'plugin');
    mkdirSync(pluginRoot);
    const oldSecret = process.env.FURYPIPE_SANDBOX_TEST_SECRET;
    process.env.FURYPIPE_SANDBOX_TEST_SECRET = 'must-not-leak';
    try {
      writeFileSync(join(pluginRoot, 'plugin.mjs'), [
        "let input = '';",
        "for await (const chunk of process.stdin) input += chunk;",
        "const result = {",
        "  input: JSON.parse(input),",
        "  permissions: {",
        "    net: process.permission.has('net'),",
        "    child: process.permission.has('child'),",
        "    worker: process.permission.has('worker'),",
        "    fsWrite: process.permission.has('fs.write')",
        "  },",
        "  leakedSecret: process.env.FURYPIPE_SANDBOX_TEST_SECRET ?? null,",
        "  envKeys: Object.keys(process.env).sort()",
        "};",
        "process.stdout.write(JSON.stringify(result));",
      ].join('\n'));

      const plan = planFuryPluginSandboxExecution({
        bundle,
        descriptor,
        entrypoint: 'plugin.mjs',
        hostApiVersion: '1.0.0',
        hostNodeVersion: process.versions.node,
      });
      expect(plan.state).toBe('READY_FOR_APPROVAL');
      const approval = approveFuryPluginSandboxExecution(plan, {
        confirm: true,
        approvedBy: 'LégendeUrbaine',
        approvedAt: '2026-09-26T17:30:00.000Z',
      });
      const receipt = await executeFuryPluginSandbox({
        plan,
        approval,
        pluginRoot,
        payload: { task: 'ping' },
      });
      expect(receipt).toMatchObject({
        format: 'furypipe-plugin-sandbox-receipt/v1',
        outcome: 'SUCCEEDED',
        executionPerformed: true,
        networkAuthorized: false,
        filesystemWriteAuthorized: false,
        childProcessAuthorized: false,
        workerAuthorized: false,
        addonAuthorized: false,
        wasiAuthorized: false,
      });
      expect(receipt.output).toMatchObject({
        input: { task: 'ping' },
        permissions: { net: false, child: false, worker: false, fsWrite: false },
        leakedSecret: null,
      });
      expect((receipt.output as { envKeys: string[] }).envKeys).toContain('FURYPIPE_PLUGIN_SANDBOX');
      expect((receipt.output as { envKeys: string[] }).envKeys).not.toContain('FURYPIPE_SANDBOX_TEST_SECRET');
    } finally {
      if (oldSecret === undefined) delete process.env.FURYPIPE_SANDBOX_TEST_SECRET;
      else process.env.FURYPIPE_SANDBOX_TEST_SECRET = oldSecret;
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
