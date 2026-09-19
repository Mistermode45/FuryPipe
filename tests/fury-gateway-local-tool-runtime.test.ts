import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createFuryGatewayLocalToolRuntime,
  FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
} from '../src/gateway-local-tool-runtime-node.js';

const roots: string[] = [];
const fixturePath = fileURLToPath(
  new URL('./fixtures/mcp-direct-execution-stdio-server.mjs', import.meta.url),
);

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function configFile(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'furypipe-tool-config-'));
  roots.push(root);
  const file = join(root, 'tools.json');
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  return file;
}

function stdioSource(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: 'fixture',
    transport: 'stdio',
    trust: 'trusted',
    command: process.execPath,
    args: [fixturePath],
    policy: {
      governedReadTools: ['governed-echo'],
      operatorApprovalTools: [],
    },
    ...overrides,
  };
}

describe('local Gateway MCP tool runtime', () => {
  it('is disabled when FURYPIPE_WEBCHAT_MCP_CONFIG is absent', () => {
    const runtime = createFuryGatewayLocalToolRuntime({ env: {} });
    expect(runtime).toEqual({
      config: {
        format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
        enabled: false,
      },
      requiresProcess: false,
      requiresNetwork: false,
    });
    expect(runtime.bridge).toBeUndefined();
  });

  it('loads a host-owned stdio source and executes through the governed bridge', async () => {
    const file = configFile({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      sources: [stdioSource()],
    });
    const runtime = createFuryGatewayLocalToolRuntime({
      env: { FURYPIPE_WEBCHAT_MCP_CONFIG: file },
    });

    expect(runtime.config).toEqual({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      enabled: true,
      sourceCount: 1,
      sources: [{
        sourceId: 'fixture',
        transport: 'stdio',
        trust: 'trusted',
        governedReadToolCount: 1,
        operatorApprovalToolCount: 0,
        credentialRefs: 0,
      }],
    });
    expect(runtime.requiresProcess).toBe(true);
    expect(runtime.requiresNetwork).toBe(false);
    expect(runtime.bridge).toBeDefined();

    const inventory = await runtime.bridge!.inspectSource('fixture');
    expect(inventory.tools).toEqual([
      expect.objectContaining({
        name: 'governed-echo',
        riskClass: 'trusted_read_only_closed_world',
      }),
    ]);

    const proposal = await runtime.bridge!.propose({
      sourceId: 'fixture',
      toolName: 'governed-echo',
      arguments: { message: 'runtime integration' },
    });
    expect(proposal.status).toBe('approved');

    const executed = await runtime.bridge!.execute(proposal.proposalId!);
    expect(executed).toMatchObject({
      status: 'completed',
      state: {
        executed: true,
        succeeded: true,
        verified: true,
      },
      executionAuthority: false,
    });
  }, 30_000);

  it('resolves credential references from host env without exposing their values', () => {
    const secret = 'MCP_CONFIG_SECRET_CANARY';
    const file = configFile({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      sources: [stdioSource({
        principalId: 'fixture-principal',
        env: {
          SERVER_TOKEN: 'HOST_MCP_TOKEN',
        },
      })],
    });

    const runtime = createFuryGatewayLocalToolRuntime({
      env: {
        FURYPIPE_WEBCHAT_MCP_CONFIG: file,
        HOST_MCP_TOKEN: secret,
      },
    });

    expect(runtime.config.enabled).toBe(true);
    expect(runtime.config.sources[0]).toMatchObject({
      credentialRefs: 1,
    });
    const serialized = JSON.stringify(runtime.config);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('HOST_MCP_TOKEN');
    expect(serialized).not.toContain('SERVER_TOKEN');

    const bridgeSources = runtime.bridge!.inspectSources();
    expect(JSON.stringify(bridgeSources)).not.toContain(secret);
  });

  it('fails closed when a referenced credential is missing or principal binding is absent', () => {
    const missing = configFile({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      sources: [stdioSource({
        principalId: 'fixture-principal',
        env: { SERVER_TOKEN: 'HOST_MISSING_TOKEN' },
      })],
    });
    expect(() => createFuryGatewayLocalToolRuntime({
      env: { FURYPIPE_WEBCHAT_MCP_CONFIG: missing },
    })).toThrow(/HOST_MISSING_TOKEN/u);

    const noPrincipal = configFile({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      sources: [stdioSource({
        env: { SERVER_TOKEN: 'HOST_TOKEN' },
      })],
    });
    expect(() => createFuryGatewayLocalToolRuntime({
      env: {
        FURYPIPE_WEBCHAT_MCP_CONFIG: noPrincipal,
        HOST_TOKEN: 'secret',
      },
    })).toThrow(/principalId/u);
  });

  it('rejects overlapping governed and operator policy lists', () => {
    const file = configFile({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      sources: [stdioSource({
        policy: {
          governedReadTools: ['governed-echo'],
          operatorApprovalTools: ['governed-echo'],
        },
      })],
    });

    expect(() => createFuryGatewayLocalToolRuntime({
      env: { FURYPIPE_WEBCHAT_MCP_CONFIG: file },
    })).toThrow(/both policy lists/u);
  });

  it('rejects raw credential-looking values where env variable references are required', () => {
    const file = configFile({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      sources: [stdioSource({
        principalId: 'fixture-principal',
        env: {
          SERVER_TOKEN: 'Bearer raw secret',
        },
      })],
    });

    expect(() => createFuryGatewayLocalToolRuntime({
      env: { FURYPIPE_WEBCHAT_MCP_CONFIG: file },
    })).toThrow(/environment variable names/u);
  });

  it('derives a remote HTTP runtime without exposing header credentials', () => {
    const file = configFile({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      sources: [{
        sourceId: 'remote',
        transport: 'streamable_http',
        trust: 'untrusted',
        url: 'https://mcp.example.test/v1',
        allowedHosts: ['mcp.example.test'],
        principalId: 'remote-service',
        headers: {
          Authorization: 'HOST_MCP_AUTH',
        },
        policy: {
          governedReadTools: [],
          operatorApprovalTools: ['search'],
        },
      }],
    });

    const runtime = createFuryGatewayLocalToolRuntime({
      env: {
        FURYPIPE_WEBCHAT_MCP_CONFIG: file,
        HOST_MCP_AUTH: 'Bearer secret-canary',
      },
    });

    expect(runtime.config).toEqual({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      enabled: true,
      sourceCount: 1,
      sources: [{
        sourceId: 'remote',
        transport: 'streamable_http',
        trust: 'untrusted',
        governedReadToolCount: 0,
        operatorApprovalToolCount: 1,
        credentialRefs: 1,
      }],
    });
    expect(runtime.requiresProcess).toBe(false);
    expect(runtime.requiresNetwork).toBe(true);
    expect(JSON.stringify(runtime.config)).not.toContain('secret-canary');
  });

  it('rejects unsupported fields, duplicate source IDs and invalid config format', () => {
    const extra = configFile({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      sources: [stdioSource({ secret: 'nope' })],
    });
    expect(() => createFuryGatewayLocalToolRuntime({
      env: { FURYPIPE_WEBCHAT_MCP_CONFIG: extra },
    })).toThrow(/unsupported field/u);

    const duplicate = configFile({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      sources: [
        stdioSource(),
        stdioSource(),
      ],
    });
    expect(() => createFuryGatewayLocalToolRuntime({
      env: { FURYPIPE_WEBCHAT_MCP_CONFIG: duplicate },
    })).toThrow(/unique/u);

    const wrongFormat = configFile({
      format: 'other/v1',
      sources: [stdioSource()],
    });
    expect(() => createFuryGatewayLocalToolRuntime({
      env: { FURYPIPE_WEBCHAT_MCP_CONFIG: wrongFormat },
    })).toThrow(/format is unsupported/u);
  });
});
