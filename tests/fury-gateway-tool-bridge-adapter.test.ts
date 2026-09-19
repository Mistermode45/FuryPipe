import { describe, expect, it } from 'vitest';

import {
  createFuryGatewayToolBridgeAdapter,
} from '../src/gateway-tool-bridge-adapter-node.js';
import type {
  FuryKernelToolBridge,
  FuryKernelToolExecutionResult,
} from '../src/fury-kernel-tool-bridge-node.js';

function fakeBridge(overrides: Partial<FuryKernelToolBridge> = {}): FuryKernelToolBridge {
  const base: FuryKernelToolBridge = {
    inspectSources: () => Object.freeze([
      Object.freeze({
        sourceId: 'stdio-source',
        transport: 'stdio',
        endpointFingerprint: 'a'.repeat(64),
        trust: 'trusted',
        executionAuthority: false,
      }),
      Object.freeze({
        sourceId: 'http-source',
        transport: 'streamable_http',
        endpointFingerprint: 'b'.repeat(64),
        trust: 'untrusted',
        executionAuthority: false,
      }),
    ]),
    inspectSource: async (sourceId) => Object.freeze({
      format: 'furypipe-kernel-tool-bridge/v1',
      source: Object.freeze({
        sourceId,
        transport: sourceId === 'stdio-source' ? 'stdio' : 'streamable_http',
        endpointFingerprint: 'c'.repeat(64),
        trust: 'trusted',
        executionAuthority: false,
      }),
      connected: true,
      healthy: true,
      listed: true,
      tools: Object.freeze([]),
      executionAuthority: false,
    }),
    propose: async (input) => Object.freeze({
      format: 'furypipe-kernel-tool-bridge/v1',
      status: 'approval-required',
      proposalId: 'ftb_11111111-1111-4111-8111-111111111111',
      sourceId: input.sourceId,
      toolName: input.toolName,
      riskClass: 'trusted_mutating_additive',
      proposalSha256: 'd'.repeat(64),
      inputSchemaSha256: 'e'.repeat(64),
      inputSha256: 'f'.repeat(64),
      policy: Object.freeze({
        policyDecisionIdSha256: '1'.repeat(64),
        outcome: 'require_operator',
        reason: 'operator_exact_allowlist',
        expiresAt: 10_000,
      }),
      executionAuthority: false,
    }),
    approve: (proposalId) => Object.freeze({
      format: 'furypipe-kernel-tool-bridge/v1',
      status: 'approved',
      proposalId,
      sourceId: 'stdio-source',
      toolName: 'tool',
      approvalKind: 'operator',
      expiresAt: 10_000,
      executionAuthority: false,
    }),
    execute: async (proposalId): Promise<FuryKernelToolExecutionResult> => Object.freeze({
      format: 'furypipe-kernel-tool-bridge/v1',
      status: 'completed',
      proposalId,
      sourceId: 'stdio-source',
      toolName: 'tool',
      state: Object.freeze({
        executed: true,
        succeeded: true,
        verified: false,
      }),
      retrySafe: false,
      executionAuthority: false,
    }),
    proposalTransport: (proposalId) =>
      proposalId.includes('http') ? 'streamable_http' : 'stdio',
    discard: () => true,
    pendingProposalCount: () => 0,
    activeExecutionCount: () => 0,
  };
  return Object.freeze({ ...base, ...overrides });
}

describe('Gateway governed tool bridge adapter', () => {
  it('serves configured source metadata through the state-only path', () => {
    const adapter = createFuryGatewayToolBridgeAdapter({
      bridge: fakeBridge(),
    });

    expect(adapter.dispatchState('tools.sources.inspect', {})).toMatchObject({
      format: 'furypipe-gateway-tool-result/v1',
      commandName: 'tools.sources.inspect',
      status: 'ok',
      authority: 'tool-governance',
      executionAuthority: false,
      result: [
        {
          sourceId: 'stdio-source',
          transport: 'stdio',
          executionAuthority: false,
        },
        {
          sourceId: 'http-source',
          transport: 'streamable_http',
          executionAuthority: false,
        },
      ],
    });
  });

  it('keeps explicit discard state-only and bounded', () => {
    let discarded = '';
    const adapter = createFuryGatewayToolBridgeAdapter({
      bridge: fakeBridge({
        discard: (proposalId) => {
          discarded = proposalId;
          return true;
        },
      }),
    });

    const result = adapter.dispatchState('tools.discard', {
      proposalId: 'ftb_11111111-1111-4111-8111-111111111111',
    });
    expect(discarded).toBe('ftb_11111111-1111-4111-8111-111111111111');
    expect(result).toMatchObject({
      status: 'ok',
      result: { discarded: true },
      executionAuthority: false,
    });
  });

  it('rejects source inspection through the wrong transport command before probing', async () => {
    let inspected = false;
    const adapter = createFuryGatewayToolBridgeAdapter({
      bridge: fakeBridge({
        inspectSource: async () => {
          inspected = true;
          throw new Error('must not be called');
        },
      }),
    });

    const result = await adapter.dispatchExecution(
      'tools.source.inspect.http',
      { sourceId: 'stdio-source' },
    );
    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'tool-transport-mismatch' },
      executionAuthority: false,
    });
    expect(inspected).toBe(false);
  });

  it('rejects proposal creation through the wrong transport command before probing', async () => {
    let proposed = false;
    const adapter = createFuryGatewayToolBridgeAdapter({
      bridge: fakeBridge({
        propose: async () => {
          proposed = true;
          throw new Error('must not be called');
        },
      }),
    });

    const result = await adapter.dispatchExecution(
      'tools.propose.stdio',
      {
        sourceId: 'http-source',
        toolName: 'tool',
        arguments: {},
      },
    );
    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'tool-transport-mismatch' },
    });
    expect(proposed).toBe(false);
  });

  it('binds execution routing to the process-local proposal transport', async () => {
    let executions = 0;
    const proposalId = 'ftb_http_11111111-1111-4111-8111-111111111111';
    const adapter = createFuryGatewayToolBridgeAdapter({
      bridge: fakeBridge({
        proposalTransport: (id) =>
          id === proposalId ? 'streamable_http' : undefined,
        execute: async () => {
          executions += 1;
          throw new Error('must not execute');
        },
      }),
    });

    const result = await adapter.dispatchExecution(
      'tools.execute.stdio',
      { proposalId },
    );
    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'tool-transport-mismatch' },
    });
    expect(executions).toBe(0);
  });

  it('allows the matching proposal transport to reach the bridge', async () => {
    let executions = 0;
    const proposalId = 'ftb_http_11111111-1111-4111-8111-111111111111';
    const adapter = createFuryGatewayToolBridgeAdapter({
      bridge: fakeBridge({
        proposalTransport: () => 'streamable_http',
        execute: async (id) => {
          executions += 1;
          return Object.freeze({
            format: 'furypipe-kernel-tool-bridge/v1',
            status: 'completed',
            proposalId: id,
            sourceId: 'http-source',
            toolName: 'tool',
            state: Object.freeze({
              executed: true,
              succeeded: true,
              verified: false,
            }),
            retrySafe: false,
            executionAuthority: false,
          });
        },
      }),
    });

    const result = await adapter.dispatchExecution(
      'tools.execute.http',
      { proposalId },
    );
    expect(result).toMatchObject({
      status: 'ok',
      result: {
        status: 'completed',
        state: {
          executed: true,
          succeeded: true,
          verified: false,
        },
        executionAuthority: false,
      },
      executionAuthority: false,
    });
    expect(executions).toBe(1);
  });

  it('maps bridge rejections to safe codes without leaking internal messages', async () => {
    const secret = 'RAW_MCP_SECRET_CANARY';
    const adapter = createFuryGatewayToolBridgeAdapter({
      bridge: fakeBridge({
        approve: () => {
          throw new Error(`transport failed with ${secret}`);
        },
      }),
    });

    const result = await adapter.dispatchExecution(
      'tools.approve',
      { proposalId: 'ftb_11111111-1111-4111-8111-111111111111' },
    );
    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'tool-bridge-operation-rejected' },
      executionAuthority: false,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('rejects unknown input fields and unsupported commands', async () => {
    const adapter = createFuryGatewayToolBridgeAdapter({
      bridge: fakeBridge(),
    });

    expect(adapter.dispatchState('tools.discard', {
      proposalId: 'ftb_11111111-1111-4111-8111-111111111111',
      permit: 'forged',
    })).toMatchObject({
      status: 'rejected',
      executionAuthority: false,
    });

    await expect(adapter.dispatchExecution(
      'tools.execute.anything' as never,
      {},
    )).rejects.toThrow(/unsupported/u);
  });

  it('fails closed when a serialized result exceeds the Gateway result bound', async () => {
    const adapter = createFuryGatewayToolBridgeAdapter({
      bridge: fakeBridge({
        inspectSource: async () => Object.freeze({
          format: 'furypipe-kernel-tool-bridge/v1',
          source: Object.freeze({
            sourceId: 'stdio-source',
            transport: 'stdio',
            endpointFingerprint: 'a'.repeat(64),
            trust: 'trusted',
            executionAuthority: false,
          }),
          connected: true,
          healthy: true,
          listed: true,
          tools: Object.freeze(Array.from({ length: 64 }, (_, index) => Object.freeze({
            name: `tool-${index}-${'x'.repeat(64)}`,
            inputSchemaSha256: 'b'.repeat(64),
            riskClass: 'trusted_read_only_closed_world' as const,
            closedWorldReadCandidate: true,
            authorizationGranted: false as const,
          }))),
          executionAuthority: false,
        }),
      }),
      maxResultBytes: 1024,
    });

    const result = await adapter.dispatchExecution(
      'tools.source.inspect.stdio',
      { sourceId: 'stdio-source' },
    );
    expect(result).toMatchObject({
      status: 'rejected',
      error: { code: 'tool-result-too-large' },
      executionAuthority: false,
    });
  });
});
