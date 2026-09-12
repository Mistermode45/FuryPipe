import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_PLUGIN_MCP_SCHEMA,
  AGENT_PLUGIN_SCHEMA,
  inspectAgentPluginPackage,
} from '../src/agent-plugin-inspector.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function pluginRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'furypipe-agent-plugin-'));
  roots.push(root);
  await writeFile(join(root, 'plugin.json'), JSON.stringify({
    $schema: AGENT_PLUGIN_SCHEMA,
    name: 'example-plugin',
    version: '1.2.3',
    description: 'Example portable plugin.',
    license: 'MIT',
    keywords: ['example', 'portable'],
    extensions: {
      'fr.furypipe.client': { enabled: true, privateValue: 'not-interpreted' },
    },
    ignoredFutureField: 'future',
  }), 'utf8');
  return root;
}

describe('Agent Plugins v1 package inspector', () => {
  it('loads the closed manifest while reporting/ignoring unknown top-level fields', async () => {
    const root = await pluginRoot();
    const inspection = inspectAgentPluginPackage(root);

    expect(inspection).toMatchObject({
      format: 'furypipe-agent-plugin-inspection/v1',
      specificationVersion: '1.0.0',
      manifest: {
        schema: AGENT_PLUGIN_SCHEMA,
        name: 'example-plugin',
        version: '1.2.3',
        license: 'MIT',
        keywords: ['example', 'portable'],
        extensionNamespaces: ['fr.furypipe.client'],
        ignoredUnknownFields: ['ignoredFutureField'],
      },
      execution: {
        packageInstalled: false,
        skillExecuted: false,
        subprocessExecuted: false,
        networkConnectionExecuted: false,
      },
    });
    expect(JSON.stringify(inspection)).not.toContain('privateValue');
    expect(JSON.stringify(inspection)).not.toContain('not-interpreted');
  });

  it('discovers only immediate in-root SKILL.md files and does not execute/parse their content', async () => {
    const root = await pluginRoot();
    await mkdir(join(root, 'skills', 'review'), { recursive: true });
    await mkdir(join(root, 'skills', 'nested', 'too-deep'), { recursive: true });
    await writeFile(join(root, 'skills', 'review', 'SKILL.md'), [
      '---',
      'name: review',
      'description: Review code.',
      '---',
      'DO-NOT-EXECUTE: rm -rf /',
    ].join('\n'), 'utf8');
    await writeFile(join(root, 'skills', 'nested', 'too-deep', 'SKILL.md'), 'ignored', 'utf8');

    const inspection = inspectAgentPluginPackage(root);
    expect(inspection.skills).toEqual([{
      directory: './skills/review',
      skillMd: './skills/review/SKILL.md',
      validation: 'NOT_EXECUTED',
      reason: 'requires-agent-skills-validator',
    }]);
    expect(JSON.stringify(inspection)).not.toContain('rm -rf');
  });

  it('skips a skill whose symlinked directory escapes the plugin root', async () => {
    const root = await pluginRoot();
    const outside = await mkdtemp(join(tmpdir(), 'furypipe-agent-plugin-outside-'));
    roots.push(outside);
    await mkdir(join(root, 'skills'), { recursive: true });
    await mkdir(join(outside, 'external-skill'), { recursive: true });
    await writeFile(join(outside, 'external-skill', 'SKILL.md'), 'outside', 'utf8');
    try {
      await symlink(join(outside, 'external-skill'), join(root, 'skills', 'escape'), 'dir');
    } catch {
      return;
    }

    expect(inspectAgentPluginPackage(root).skills).toEqual([]);
  });

  it('inspects safe stdio and streamable-http MCP metadata without executing or retaining values', async () => {
    const root = await pluginRoot();
    await mkdir(join(root, 'bin'));
    await mkdir(join(root, 'data'));
    await writeFile(join(root, 'bin', 'server'), '#!/bin/sh\nexit 0\n', 'utf8');
    await writeFile(join(root, 'mcp.json'), JSON.stringify({
      $schema: AGENT_PLUGIN_MCP_SCHEMA,
      mcpServers: {
        local: {
          type: 'stdio',
          command: './bin/server',
          args: ['--data', '${PLUGIN_DATA}/cache'],
          env: { MODE: 'readonly' },
          cwd: './data',
        },
        remote: {
          type: 'streamable-http',
          url: 'https://mcp.example.test/mcp',
          headers: { 'X-Tenant': 'public-tenant' },
        },
      },
    }), 'utf8');

    const inspection = inspectAgentPluginPackage(root);
    expect(inspection.mcp.configurationValid).toBe(true);
    expect(inspection.mcp.servers).toMatchObject([
      {
        id: 'local',
        transport: 'stdio',
        command: './bin/server',
        cwd: './data',
        argumentCount: 2,
        environmentNames: ['MODE'],
        furyPipeEligible: true,
      },
      {
        id: 'remote',
        transport: 'streamable-http',
        url: 'https://mcp.example.test/mcp',
        headerNames: ['x-tenant'],
        furyPipeEligible: true,
      },
    ]);
    const encoded = JSON.stringify(inspection);
    expect(encoded).not.toContain('readonly');
    expect(encoded).not.toContain('public-tenant');
  });

  it('fails FuryPipe eligibility for embedded credential surfaces without rejecting unrelated servers', async () => {
    const root = await pluginRoot();
    await writeFile(join(root, 'mcp.json'), JSON.stringify({
      $schema: AGENT_PLUGIN_MCP_SCHEMA,
      mcpServers: {
        remote: {
          type: 'streamable-http',
          url: 'https://mcp.example.test/mcp',
          headers: { Authorization: 'Bearer SECRET', 'X-Tenant': 'public' },
        },
        local: {
          type: 'stdio',
          command: 'node',
          env: { API_TOKEN: 'SECRET', MODE: 'safe' },
        },
      },
    }), 'utf8');

    const inspection = inspectAgentPluginPackage(root);
    expect(inspection.mcp.configurationValid).toBe(true);
    expect(inspection.mcp.servers.find((server) => server.id === 'remote')).toMatchObject({
      furyPipeEligible: false,
      blockers: [expect.stringContaining('credential-bearing header')],
    });
    expect(inspection.mcp.servers.find((server) => server.id === 'local')).toMatchObject({
      furyPipeEligible: false,
      blockers: [expect.stringContaining('secret-like variable')],
    });
    expect(JSON.stringify(inspection)).not.toContain('Bearer SECRET');
  });

  it('enforces remote HTTPS outside loopback and accepts loopback HTTP', async () => {
    const root = await pluginRoot();
    await writeFile(join(root, 'mcp.json'), JSON.stringify({
      $schema: AGENT_PLUGIN_MCP_SCHEMA,
      mcpServers: {
        bad: { type: 'streamable-http', url: 'http://example.test/mcp' },
        local: { type: 'streamable-http', url: 'http://127.0.0.1:9000/mcp' },
      },
    }), 'utf8');

    const inspection = inspectAgentPluginPackage(root);
    expect(inspection.mcp.servers.find((server) => server.id === 'bad')).toMatchObject({
      furyPipeEligible: false,
      blockers: ['non-loopback remote MCP requires HTTPS'],
    });
    expect(inspection.mcp.servers.find((server) => server.id === 'local')?.furyPipeEligible).toBe(true);
  });

  it('disables only MCP when mcp.json top-level schema is invalid', async () => {
    const root = await pluginRoot();
    await mkdir(join(root, 'skills', 'review'), { recursive: true });
    await writeFile(join(root, 'skills', 'review', 'SKILL.md'), 'skill', 'utf8');
    await writeFile(join(root, 'mcp.json'), JSON.stringify({
      $schema: 'https://example.test/unsupported.json',
      mcpServers: {},
      extra: true,
    }), 'utf8');

    const inspection = inspectAgentPluginPackage(root);
    expect(inspection.skills).toHaveLength(1);
    expect(inspection.mcp).toMatchObject({
      present: true,
      configurationValid: false,
      servers: [],
    });
    expect(inspection.mcp.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('unknown mcp.json fields'),
      expect.stringContaining('unsupported Agent Plugins schema'),
    ]));
  });

  it('rejects fatal plugin manifest violations and an escaping plugin.json symlink', async () => {
    const root = await pluginRoot();
    await writeFile(join(root, 'plugin.json'), JSON.stringify({
      $schema: AGENT_PLUGIN_SCHEMA,
      name: 'Bad--Name',
    }), 'utf8');
    expect(() => inspectAgentPluginPackage(root)).toThrow(/name constraints/);

    const root2 = await pluginRoot();
    const outside = await mkdtemp(join(tmpdir(), 'furypipe-agent-plugin-manifest-outside-'));
    roots.push(outside);
    await writeFile(join(outside, 'plugin.json'), JSON.stringify({
      $schema: AGENT_PLUGIN_SCHEMA,
      name: 'outside',
    }), 'utf8');
    await rm(join(root2, 'plugin.json'));
    try {
      await symlink(join(outside, 'plugin.json'), join(root2, 'plugin.json'), 'file');
    } catch {
      return;
    }
    expect(() => inspectAgentPluginPackage(root2)).toThrow(/outside the plugin root/);
  });
});
