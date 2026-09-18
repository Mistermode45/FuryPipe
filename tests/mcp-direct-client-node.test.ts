import { describe, expect, it } from 'vitest';

import {
  probeMcpDirectInventory,
  type McpDirectRuntimeConfig,
  type McpDirectSdkFactory,
} from '../src/mcp-direct-client-node.js';

const sha = (char: string) => char.repeat(64);

function stdioConfig(trust: 'trusted' | 'untrusted' = 'trusted'): McpDirectRuntimeConfig {
  return {
    source: {
      sourceId: 'fixture',
      transport: 'stdio',
      endpointFingerprint: sha('a'),
      trust,
    },
    command: 'fixture-server',
    args: ['--stdio'],
  };
}

function fakeFactory(options: {
  readonly era?: 'modern' | 'legacy' | undefined;
  readonly protocolVersion?: string;
  readonly tools?: readonly Record<string, unknown>[];
  readonly connectError?: Error;
  readonly listError?: Error;
}) {
  let closeCalls = 0;
  let connectCalls = 0;
  let listCalls = 0;
  let transportConfig: unknown;

  const factory: McpDirectSdkFactory = {
    createClient: () => ({
      async connect() {
        connectCalls += 1;
        if (options.connectError) throw options.connectError;
      },
      async listTools() {
        listCalls += 1;
        if (options.listError) throw options.listError;
        return { tools: options.tools ?? [] };
      },
      getProtocolEra: () => options.era ?? 'modern',
      getNegotiatedProtocolVersion: () => options.protocolVersion ?? '2026-07-28',
      async close() {
        closeCalls += 1;
      },
    }),
    createStdioTransport(config) {
      transportConfig = config;
      return { kind: 'stdio' };
    },
    createHttpTransport(config) {
      transportConfig = config;
      return { kind: 'http' };
    },
  };

  return {
    factory,
    counters: () => ({ closeCalls, connectCalls, listCalls }),
    transportConfig: () => transportConfig,
  };
}

describe('direct MCP client inventory transport', () => {
  it('negotiates modern era, lists tools and keeps execution authority absent', async () => {
    const fake = fakeFactory({
      era: 'modern',
      protocolVersion: '2026-07-28',
      tools: [{
        name: 'search',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        annotations: { readOnlyHint: true, openWorldHint: false },
      }],
    });

    const result = await probeMcpDirectInventory(stdioConfig(), {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    });

    expect(result.protocolVersion).toBe('2026-07-28');
    expect(result.toolCount).toBe(1);
    expect(result.lifecycle).toMatchObject({
      connected: true,
      healthy: true,
      listed: true,
      trusted: true,
      selected: false,
      approved: false,
      executed: false,
      succeeded: false,
      verified: false,
      protocolEra: 'modern_2026',
      handshake: 'discover',
      healthEvidence: 'list_tools_success',
    });
    expect(result.lifecycle.inventory?.[0]?.inputSchemaSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.lifecycle.inventory?.[0]?.risk).toMatchObject({
      trust: 'trusted',
      riskClass: 'trusted_read_only_closed_world',
      authorizationGranted: false,
      requiresPolicyGate: true,
    });
    expect(fake.counters()).toEqual({ closeCalls: 1, connectCalls: 1, listCalls: 1 });
  });

  it('records a legacy initialize connection without relabeling it modern', async () => {
    const fake = fakeFactory({
      era: 'legacy',
      protocolVersion: '2025-11-25',
    });
    const result = await probeMcpDirectInventory(stdioConfig(), {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    });
    expect(result.lifecycle.protocolEra).toBe('legacy_2025');
    expect(result.lifecycle.handshake).toBe('initialize');
    expect(result.lifecycle.healthy).toBe(true);
  });

  it('keeps untrusted tool annotations non-authoritative', async () => {
    const fake = fakeFactory({
      tools: [{
        name: 'read',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, openWorldHint: false },
      }],
    });
    const result = await probeMcpDirectInventory(stdioConfig('untrusted'), {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    });
    expect(result.lifecycle.inventory?.[0]?.risk).toMatchObject({
      trust: 'untrusted',
      riskClass: 'untrusted_unknown',
      closedWorldReadCandidate: false,
      authorizationGranted: false,
      requiresPolicyGate: true,
    });
  });

  it('rejects more than 256 tools and still closes the client', async () => {
    const fake = fakeFactory({
      tools: Array.from({ length: 257 }, (_, index) => ({
        name: `tool-${index}`,
        inputSchema: { type: 'object' },
      })),
    });
    await expect(probeMcpDirectInventory(stdioConfig(), {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    })).rejects.toThrow(/256 tool bound/i);
    expect(fake.counters().closeCalls).toBe(1);
  });

  it('closes the client after connect failure', async () => {
    const fake = fakeFactory({ connectError: new Error('offline') });
    await expect(probeMcpDirectInventory(stdioConfig(), {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    })).rejects.toThrow('offline');
    expect(fake.counters()).toEqual({ closeCalls: 1, connectCalls: 1, listCalls: 0 });
  });

  it('requires HTTPS and an explicit host allowlist for remote HTTP', async () => {
    const fake = fakeFactory({});
    const source = {
      sourceId: 'remote',
      transport: 'streamable_http' as const,
      endpointFingerprint: sha('b'),
      trust: 'untrusted' as const,
    };

    await expect(probeMcpDirectInventory({
      source,
      url: 'http://example.com/mcp',
      allowedHosts: ['example.com'],
    }, {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    })).rejects.toThrow(/must use https/i);

    await expect(probeMcpDirectInventory({
      source,
      url: 'https://example.com/mcp',
    }, {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    })).rejects.toThrow(/not explicitly allowlisted/i);
  });

  it('allows loopback HTTP but rejects URL credentials', async () => {
    const fake = fakeFactory({});
    const source = {
      sourceId: 'local-http',
      transport: 'streamable_http' as const,
      endpointFingerprint: sha('c'),
      trust: 'trusted' as const,
    };

    const result = await probeMcpDirectInventory({
      source,
      url: 'http://127.0.0.1:3000/mcp',
    }, {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    });
    expect(result.lifecycle.connected).toBe(true);

    await expect(probeMcpDirectInventory({
      source,
      url: 'https://user:secret@example.com/mcp',
      allowedHosts: ['example.com'],
    }, {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    })).rejects.toThrow(/must not contain credentials/i);
  });

  it('does not persist runtime HTTP credentials in returned evidence', async () => {
    const fake = fakeFactory({});
    const secret = 'Bearer MCP_SECRET_CANARY_77';
    const result = await probeMcpDirectInventory({
      source: {
        sourceId: 'remote',
        transport: 'streamable_http',
        endpointFingerprint: sha('d'),
        trust: 'untrusted',
      },
      url: 'https://mcp.example.test/v1',
      allowedHosts: ['mcp.example.test'],
      headers: { Authorization: secret },
    }, {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    });

    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('Authorization');
    expect(fake.transportConfig()).toMatchObject({
      headers: { Authorization: secret },
    });
  });

  it('uses bounded stdio parameters and does not invoke a shell', async () => {
    const fake = fakeFactory({});
    await probeMcpDirectInventory({
      ...stdioConfig(),
      env: { SAFE_VAR: 'value' },
      maxBufferBytes: 1024 * 1024,
    }, {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    });

    expect(fake.transportConfig()).toMatchObject({
      command: 'fixture-server',
      args: ['--stdio'],
      env: { SAFE_VAR: 'value' },
      maxBufferBytes: 1024 * 1024,
    });
  });
});
