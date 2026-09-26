import { describe, expect, it } from 'vitest';

import { discoverFuryAiConnections } from '../src/fury-ai-connections.js';
import type { FuryHarnessDiscovery } from '../src/fury-harness-hub.js';

const harnesses: FuryHarnessDiscovery = {
  format: 'furypipe-harness-discovery/v1',
  platform: 'linux',
  harnesses: [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      installed: true,
      executable: '/usr/bin/claude',
      version: '2.1.282',
      versionStatus: 'ok',
      authentication: 'not-probed',
      definition: {
        id: 'claude-code',
        displayName: 'Claude Code',
        executables: ['claude'],
        versionArgs: ['--version'],
        integrations: ['structured-cli'],
        protocols: ['mcp'],
        skillsDirectories: ['.claude/skills'],
        localModel: { mechanism: 'anthropic-compatible-base-url', note: 'test' },
        capabilities: { streaming: true, resume: true, subagents: true },
        evidence: 'BUILTIN',
      },
    },
    {
      id: 'codex',
      displayName: 'Codex CLI',
      installed: false,
      versionStatus: 'not-installed',
      authentication: 'not-probed',
      definition: {
        id: 'codex',
        displayName: 'Codex CLI',
        executables: ['codex'],
        versionArgs: ['--version'],
        integrations: ['structured-cli'],
        protocols: ['mcp'],
        skillsDirectories: [],
        localModel: { mechanism: 'oss-flag', note: 'test' },
        capabilities: { streaming: true, resume: true, subagents: 'unverified' },
        evidence: 'BUILTIN',
      },
    },
  ],
};

describe('AI connection discovery', () => {
  it('detects installed runtimes and credential-source names without returning secrets', () => {
    const result = discoverFuryAiConnections(harnesses, {
      ANTHROPIC_API_KEY: 'anthropic-secret-never-return',
      CODEX_ACCESS_TOKEN: 'codex-secret-never-return',
    });
    expect(result.connections.find((c) => c.id === 'anthropic')).toMatchObject({
      state: 'credential-configured',
      configuredVia: ['ANTHROPIC_API_KEY'],
      runtimes: [{ id: 'claude-code', version: '2.1.282' }],
      accountVerification: 'not-probed',
    });
    expect(result.connections.find((c) => c.id === 'openai')).toMatchObject({
      state: 'credential-configured',
      configuredVia: ['CODEX_ACCESS_TOKEN'],
      runtimes: [],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('anthropic-secret-never-return');
    expect(serialized).not.toContain('codex-secret-never-return');
  });

  it('does not claim an account is authenticated from an installed runtime alone', () => {
    const result = discoverFuryAiConnections(harnesses, {});
    expect(result.connections.find((c) => c.id === 'anthropic')).toMatchObject({
      state: 'runtime-detected',
      accountVerification: 'not-probed',
    });
    expect(result.connections.find((c) => c.id === 'openai')?.state).toBe('not-detected');
    expect(result.policy).toEqual({
      browserSessions: 'not-inspected',
      credentialStores: 'not-inspected',
      secretValues: 'never-returned',
      accountStatus: 'official-cli-only',
    });
  });
});
