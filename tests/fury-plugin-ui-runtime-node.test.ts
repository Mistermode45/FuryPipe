import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FuryPluginBundle } from '../src/plugin-bundles.js';
import type { FuryPluginRuntimeDescriptor } from '../src/fury-plugin-runtime.js';
import {
  approveFuryPluginUiRender,
  executeFuryPluginUiRender,
  planFuryPluginUiRender,
  validateFuryPluginUiDocument,
} from '../src/fury-plugin-ui-runtime-node.js';

const bundle: FuryPluginBundle = {
  format: 'furypipe-plugin-bundle/v1',
  id: 'ui-pure',
  name: 'UI Pure',
  version: '1.0.0',
  mode: 'EXTERNAL_OPT_IN',
  source: {
    url: 'https://plugins.example.test/ui-pure',
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
  pluginId: 'ui-pure',
  pluginVersion: '1.0.0',
  hostApiVersion: '1.0.0',
  isolation: 'subprocess',
  uiExtensions: [{
    id: 'panel',
    surface: 'panel',
    entrypoint: 'ui.mjs',
    title: 'Pure panel',
    permissions: [],
  }],
  memoryLimitMiB: 64,
  cpuTimeLimitMs: 10_000,
  networkDefault: 'DENY',
  filesystemDefault: 'DENY',
  secretInjection: 'ENV_NAMES_ONLY',
};

describe('Fury Plugin UI Runtime', () => {
  it('validates only the declarative host component vocabulary', () => {
    expect(validateFuryPluginUiDocument({
      format: 'furypipe-plugin-ui/v1',
      title: 'Panel',
      nodes: [
        { type: 'stack', children: [
          { type: 'text', text: 'Hello', tone: 'muted' },
          { type: 'badge', text: 'ready', tone: 'success' },
          { type: 'button', label: 'Refresh', actionId: 'refresh', variant: 'secondary' },
          { type: 'code', text: 'const x = 1;' },
          { type: 'divider' },
        ] },
      ],
    })).toMatchObject({ format: 'furypipe-plugin-ui/v1', title: 'Panel' });

    expect(() => validateFuryPluginUiDocument({
      format: 'furypipe-plugin-ui/v1',
      title: 'Unsafe',
      nodes: [{ type: 'html', html: '<img src=https://evil.test/x>' }],
    })).toThrow(/unsupported/u);
    expect(() => validateFuryPluginUiDocument({
      format: 'furypipe-plugin-ui/v1',
      title: 'Unsafe',
      nodes: [{ type: 'button', label: 'Go', actionId: 'https://evil.test' }],
    })).toThrow(/action id/u);
  });

  it('inherits fail-closed Node and zero-authority sandbox requirements', () => {
    const node24 = planFuryPluginUiRender({
      bundle,
      descriptor,
      extensionId: 'panel',
      hostApiVersion: '1.0.0',
      hostNodeVersion: '24.21.0',
    });
    expect(node24).toMatchObject({
      state: 'REJECTED',
      browserCodeAuthorized: false,
      htmlAuthorized: false,
      networkAuthorized: false,
      filesystemAuthorized: false,
      executionAuthorized: false,
    });
    expect(node24.reasons.join(' ')).toMatch(/Node <25/u);

    const privileged = planFuryPluginUiRender({
      bundle: { ...bundle, permissions: ['network'] },
      descriptor: { ...descriptor, uiExtensions: [{ ...descriptor.uiExtensions[0]!, permissions: ['network'] }] },
      extensionId: 'panel',
      hostApiVersion: '1.0.0',
      hostNodeVersion: '26.8.2',
    });
    expect(privileged.state).toBe('REJECTED');
    expect(privileged.reasons.join(' ')).toMatch(/zero-authority/u);
  });

  it('renders declarative UI and actions through the zero-authority subprocess on Node 25+', async () => {
    if (Number(process.versions.node.split('.')[0]) < 25) return;
    const root = mkdtempSync(join(tmpdir(), 'furypipe-plugin-ui-'));
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'ui.mjs'), [
        "let input = '';",
        "for await (const chunk of process.stdin) input += chunk;",
        "const request = JSON.parse(input);",
        "const action = request.type === 'ACTION' ? request.action.actionId : null;",
        "process.stdout.write(JSON.stringify({",
        "  format: 'furypipe-plugin-ui/v1',",
        "  title: 'Pure panel',",
        "  nodes: [",
        "    { type: 'text', text: action ? 'Action ' + action : 'Hello ' + request.context.name },",
        "    { type: 'button', label: 'Refresh', actionId: 'refresh', variant: 'secondary' }",
        "  ]",
        "}));",
      ].join('\n'));

      const plan = planFuryPluginUiRender({
        bundle,
        descriptor,
        extensionId: 'panel',
        hostApiVersion: '1.0.0',
        hostNodeVersion: process.versions.node,
      });
      expect(plan.state).toBe('READY_FOR_APPROVAL');
      const approval = approveFuryPluginUiRender(plan, {
        confirm: true,
        approvedBy: 'LégendeUrbaine',
        approvedAt: '2026-09-26T18:30:00.000Z',
      });

      const first = await executeFuryPluginUiRender({
        plan,
        approval,
        pluginRoot: root,
        context: { name: 'FuryPipe' },
      });
      expect(first).toMatchObject({
        format: 'furypipe-plugin-ui-render-receipt/v1',
        pluginId: 'ui-pure',
        extensionId: 'panel',
        browserCodeExecuted: false,
        htmlAccepted: false,
        hostAuthorityGranted: false,
        document: {
          format: 'furypipe-plugin-ui/v1',
          title: 'Pure panel',
        },
      });
      expect(first.document.nodes[0]).toMatchObject({ type: 'text', text: 'Hello FuryPipe' });
      expect(first.documentDigestSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(first.sandbox.networkAuthorized).toBe(false);
      expect(first.sandbox.filesystemWriteAuthorized).toBe(false);

      const action = await executeFuryPluginUiRender({
        plan,
        approval,
        pluginRoot: root,
        context: { name: 'FuryPipe' },
        action: { actionId: 'refresh', payload: { source: 'button' } },
      });
      expect(action.document.nodes[0]).toMatchObject({ type: 'text', text: 'Action refresh' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
