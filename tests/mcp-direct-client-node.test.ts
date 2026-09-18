import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isGeneratedMcpDirectCatalogHandle } from '../src/mcp-direct-catalog.js';
import {
  deriveMcpDirectEndpointFingerprint,
  probeMcpDirectInventory,
  type McpDirectRuntimeConfig,
  type McpDirectSdkFactory,
} from '../src/mcp-direct-client-node.js';

const sha = (char: string) => char.repeat(64);

function stdioConfig(trust: 'trusted' | 'untrusted' = 'trusted'): McpDirectRuntimeConfig {
  const config: McpDirectRuntimeConfig = {
    source: {
      sourceId: 'fixture',
      transport: 'stdio',
      endpointFingerprint: sha('0'),
      trust,
    },
    command: 'fixture-server',
    args: ['--stdio'],
  };
  return {
    ...config,
    source: {
      ...config.source,
      endpointFingerprint: deriveMcpDirectEndpointFingerprint(config),
    },
  };
}

function httpConfig(options: {
  readonly url: string;
  readonly sourceId?: string;
  readonly trust?: 'trusted' | 'untrusted';
  readonly allowedHosts?: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxResponseBytes?: number;
}): McpDirectRuntimeConfig {
  const config: McpDirectRuntimeConfig = {
    source: {
      sourceId: options.sourceId ?? 'http-fixture',
      transport: 'streamable_http',
      endpointFingerprint: sha('0'),
      trust: options.trust ?? 'untrusted',
    },
    url: options.url,
    ...(options.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
  };
  return {
    ...config,
    source: {
      ...config.source,
      endpointFingerprint: deriveMcpDirectEndpointFingerprint(config),
    },
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
    expect(isGeneratedMcpDirectCatalogHandle(result.catalog)).toBe(true);
    expect(result.catalog).toMatchObject({
      format: 'furypipe-mcp-direct-catalog/v1',
      sourceId: 'fixture',
      endpointFingerprint: result.lifecycle.source.endpointFingerprint,
      toolCount: 1,
    });
    expect(result.catalog.inventorySha256).toMatch(/^[0-9a-f]{64}$/u);
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

    const result = await probeMcpDirectInventory(httpConfig({
      url: 'http://127.0.0.1:3000/mcp',
      sourceId: source.sourceId,
      trust: source.trust,
    }), {
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
    const result = await probeMcpDirectInventory(httpConfig({
      sourceId: 'remote',
      trust: 'untrusted',
      url: 'https://mcp.example.test/v1',
      allowedHosts: ['mcp.example.test'],
      headers: { Authorization: secret },
    }), {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    });

    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('Authorization');
    expect(fake.transportConfig()).toMatchObject({
      headers: { Authorization: secret },
    });
  });

  it('rejects endpoint evidence that is not bound to the actual runtime endpoint', async () => {
    const fake = fakeFactory({});
    const config = stdioConfig();
    const forged: McpDirectRuntimeConfig = {
      ...config,
      source: { ...config.source, endpointFingerprint: sha('f') },
    };
    await expect(probeMcpDirectInventory(forged, {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    })).rejects.toThrow(/fingerprint does not match/i);
    expect(fake.counters()).toEqual({ closeCalls: 0, connectCalls: 0, listCalls: 0 });
  });

  it('rejects HTTP query strings so endpoint identity cannot hide query credentials', async () => {
    const fake = fakeFactory({});
    const config: McpDirectRuntimeConfig = {
      source: {
        sourceId: 'remote-query',
        transport: 'streamable_http',
        endpointFingerprint: sha('1'),
        trust: 'untrusted',
      },
      url: 'https://mcp.example.test/v1?token=secret',
      allowedHosts: ['mcp.example.test'],
    };
    await expect(probeMcpDirectInventory(config, {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    })).rejects.toThrow(/must not contain a query string/i);
  });

  it('passes a bounded HTTP response ceiling to the transport', async () => {
    const fake = fakeFactory({});
    await probeMcpDirectInventory(httpConfig({
      url: 'https://mcp.example.test/v1',
      allowedHosts: ['mcp.example.test'],
    }), {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    });
    expect(fake.transportConfig()).toMatchObject({
      maxResponseBytes: 8 * 1024 * 1024,
    });
  });

  it('uses the real official v2 stdio client against a real dual-era server', async () => {
    const fixturePath = fileURLToPath(
      new URL('./fixtures/mcp-direct-stdio-server.mjs', import.meta.url),
    );
    const provisional: McpDirectRuntimeConfig = {
      source: {
        sourceId: 'real-stdio-fixture',
        transport: 'stdio',
        endpointFingerprint: sha('0'),
        trust: 'trusted',
      },
      command: process.execPath,
      args: [fixturePath],
      maxBufferBytes: 1024 * 1024,
    };
    const config: McpDirectRuntimeConfig = {
      ...provisional,
      source: {
        ...provisional.source,
        endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional),
      },
    };

    const result = await probeMcpDirectInventory(config, {
      clientInfo: { name: 'furypipe-real-stdio-test', version: '1.0.0' },
      connectTimeoutMs: 10_000,
      listTimeoutMs: 10_000,
      probeTimeoutMs: 2_000,
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
    expect(result.lifecycle.inventory?.map((tool) => tool.name)).toEqual(['inventory-proof']);
    expect(result.lifecycle.inventory?.[0]?.risk).toMatchObject({
      trust: 'trusted',
      riskClass: 'trusted_read_only_closed_world',
      authorizationGranted: false,
      requiresPolicyGate: true,
    });
  }, 20_000);

  it('rejects non-JSON schema values instead of hashing a lossy serialization', async () => {
    const fake = fakeFactory({
      tools: [{
        name: 'bad-schema',
        inputSchema: { type: 'object', hidden: undefined },
      }],
    });
    await expect(probeMcpDirectInventory(stdioConfig(), {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    })).rejects.toThrow(/non-JSON value/i);
  });

  it('keeps raw schemas out of serialized inventory evidence', async () => {
    const secretDescription = 'SCHEMA_PRIVATE_CANARY_1847';
    const fake = fakeFactory({
      tools: [{
        name: 'safe-schema',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: secretDescription },
          },
        },
      }],
    });
    const result = await probeMcpDirectInventory(stdioConfig(), {
      clientInfo: { name: 'furypipe-test', version: '1.0.0' },
      factory: fake.factory,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretDescription);
    expect(serialized).not.toContain('description');
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
