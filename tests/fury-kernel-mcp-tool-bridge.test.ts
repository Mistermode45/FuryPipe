import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  deriveMcpDirectEndpointFingerprint,
  type McpDirectRuntimeConfig,
} from '../src/mcp-direct-client-node.js';
import {
  createFuryKernelMcpToolBridge,
  FuryKernelMcpToolBridgeError,
} from '../src/fury-kernel-mcp-tool-bridge-node.js';
import type { McpDirectPolicy } from '../src/mcp-direct-policy.js';

const fixturePath = fileURLToPath(
  new URL('./fixtures/mcp-direct-stdio-server.mjs', import.meta.url),
);

function config(sourceId = 'webchat-mcp-fixture'): McpDirectRuntimeConfig {
  const provisional: McpDirectRuntimeConfig = {
    source: {
      sourceId,
      transport: 'stdio',
      endpointFingerprint: '0'.repeat(64),
      trust: 'trusted',
    },
    command: process.execPath,
    args: [fixturePath],
    maxBufferBytes: 1024 * 1024,
  };
  return {
    ...provisional,
    source: {
      ...provisional.source,
      endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional),
    },
  };
}

function pair(runtime: McpDirectRuntimeConfig) {
  return {
    sourceId: runtime.source.sourceId,
    endpointFingerprint: runtime.source.endpointFingerprint,
    toolName: 'inventory-proof',
  };
}

function policy(
  runtime: McpDirectRuntimeConfig,
  mode: 'governed' | 'operator' | 'deny',
): McpDirectPolicy {
  return {
    format: 'furypipe-mcp-direct-policy/v1',
    policyId: `webchat-${mode}`,
    governedPolicyAllowlist: mode === 'governed' ? [pair(runtime)] : [],
    operatorApprovalAllowlist: mode === 'operator' ? [pair(runtime)] : [],
  };
}

describe('Fury Kernel governed MCP tool bridge', () => {
  it('auto-approves only exact governed-policy read-only tools and exposes receipts without raw output', async () => {
    const runtime = config();
    const bridge = createFuryKernelMcpToolBridge({
      sources: [runtime],
      policy: policy(runtime, 'governed'),
      now: () => 1_000,
    });

    const proposed = await bridge.propose({
      sourceId: runtime.source.sourceId,
      toolName: 'inventory-proof',
    });

    expect(proposed).toMatchObject({
      format: 'furypipe-kernel-mcp-tool-bridge/v1',
      sourceId: runtime.source.sourceId,
      transport: 'stdio',
      endpointFingerprint: runtime.source.endpointFingerprint,
      toolName: 'inventory-proof',
      policyOutcome: 'allow_governed_policy',
      status: 'approved',
      approvalKind: 'governed_policy',
      executionStatus: 'not-executed',
      executionAuthority: false,
    });
    expect(proposed.proposalId).toMatch(/^fkmcp_[A-Za-z0-9_-]{24}$/u);
    expect(proposed.inputSchemaSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(proposed.inputSha256).toMatch(/^[a-f0-9]{64}$/u);

    const executed = await bridge.execute(proposed.proposalId);
    expect(executed).toMatchObject({
      status: 'executed',
      executionStatus: 'executed',
      approvalKind: 'governed_policy',
      succeeded: true,
      verified: false,
      executionAuthority: false,
    });
    expect(executed.resultSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(executed)).not.toContain('unexpected execution');

    expect(bridge.inspect(proposed.proposalId)).toEqual(executed);
    await expect(bridge.execute(proposed.proposalId)).rejects.toMatchObject({
      code: 'proposal-terminal',
    });
  }, 30_000);

  it('requires a distinct explicit operator approval before executing an operator-allowlisted tool', async () => {
    const runtime = config('operator-source');
    const bridge = createFuryKernelMcpToolBridge({
      sources: [runtime],
      policy: policy(runtime, 'operator'),
      now: () => 2_000,
    });

    const proposed = await bridge.propose({
      sourceId: runtime.source.sourceId,
      toolName: 'inventory-proof',
    });

    expect(proposed).toMatchObject({
      policyOutcome: 'require_operator',
      status: 'approval_required',
      executionStatus: 'not-executed',
      executionAuthority: false,
    });
    await expect(bridge.execute(proposed.proposalId)).rejects.toMatchObject({
      code: 'proposal-not-approved',
    });

    const approved = bridge.approve(proposed.proposalId);
    expect(approved).toMatchObject({
      status: 'approved',
      approvalKind: 'operator',
      executionStatus: 'not-executed',
      executionAuthority: false,
    });

    const executed = await bridge.execute(proposed.proposalId);
    expect(executed).toMatchObject({
      status: 'executed',
      approvalKind: 'operator',
      executionStatus: 'executed',
      succeeded: true,
      verified: false,
    });
  }, 30_000);

  it('keeps denied policy decisions non-executable', async () => {
    const runtime = config('denied-source');
    const bridge = createFuryKernelMcpToolBridge({
      sources: [runtime],
      policy: policy(runtime, 'deny'),
      now: () => 3_000,
    });

    const proposed = await bridge.propose({
      sourceId: runtime.source.sourceId,
      toolName: 'inventory-proof',
    });

    expect(proposed).toMatchObject({
      policyOutcome: 'deny',
      status: 'denied',
      executionStatus: 'not-executed',
      executionAuthority: false,
    });
    expect(() => bridge.approve(proposed.proposalId)).toThrowError(
      expect.objectContaining({ code: 'approval-not-required' }),
    );
    await expect(bridge.execute(proposed.proposalId)).rejects.toMatchObject({
      code: 'proposal-not-approved',
    });
  }, 20_000);

  it('rejects unknown source before probing and sanitizes unknown-tool failures', async () => {
    const runtime = config('safe-source');
    const bridge = createFuryKernelMcpToolBridge({
      sources: [runtime],
      policy: policy(runtime, 'deny'),
      now: () => 4_000,
    });

    await expect(bridge.propose({
      sourceId: 'missing-source',
      toolName: 'inventory-proof',
    })).rejects.toMatchObject({ code: 'unknown-source' });

    await expect(bridge.propose({
      sourceId: runtime.source.sourceId,
      toolName: 'missing-tool',
    })).rejects.toMatchObject({ code: 'proposal-blocked' });
  }, 20_000);

  it('bounds proposal capacity and reclaims it after explicit expiry', async () => {
    let now = 5_000;
    const runtime = config('bounded-source');
    const bridge = createFuryKernelMcpToolBridge({
      sources: [runtime],
      policy: policy(runtime, 'deny'),
      now: () => now,
      maxProposals: 1,
      proposalTtlMs: 1_000,
    });

    const first = await bridge.propose({
      sourceId: runtime.source.sourceId,
      toolName: 'inventory-proof',
    });
    expect(bridge.proposalCount()).toBe(1);

    await expect(bridge.propose({
      sourceId: runtime.source.sourceId,
      toolName: 'inventory-proof',
    })).rejects.toMatchObject({ code: 'proposal-limit' });

    now = 6_000;
    expect(() => bridge.inspect(first.proposalId)).toThrowError(
      expect.objectContaining({ code: 'proposal-expired' }),
    );
    expect(bridge.proposalCount()).toBe(0);

    const second = await bridge.propose({
      sourceId: runtime.source.sourceId,
      toolName: 'inventory-proof',
    });
    expect(second.proposalId).not.toBe(first.proposalId);
  }, 30_000);

  it('snapshots source and policy configuration instead of trusting later caller mutation', async () => {
    const runtime = config('snapshot-source') as {
      source: {
        sourceId: string;
        transport: 'stdio';
        endpointFingerprint: string;
        trust: 'trusted';
      };
      command: string;
      args?: readonly string[];
      maxBufferBytes?: number;
    };
    const configuredPolicy = policy(runtime, 'governed') as {
      format: 'furypipe-mcp-direct-policy/v1';
      policyId: string;
      governedPolicyAllowlist: Array<ReturnType<typeof pair>>;
      operatorApprovalAllowlist: Array<ReturnType<typeof pair>>;
    };

    const bridge = createFuryKernelMcpToolBridge({
      sources: [runtime],
      policy: configuredPolicy,
      now: () => 7_000,
    });

    runtime.source.sourceId = 'mutated-source';
    configuredPolicy.governedPolicyAllowlist.splice(0);

    const proposed = await bridge.propose({
      sourceId: 'snapshot-source',
      toolName: 'inventory-proof',
    });
    expect(proposed).toMatchObject({
      sourceId: 'snapshot-source',
      policyOutcome: 'allow_governed_policy',
      status: 'approved',
    });
  }, 20_000);

  it('rejects malformed source fingerprints and malformed policies at construction', () => {
    const runtime = config('invalid-config-source');
    const badRuntime = {
      ...runtime,
      source: {
        ...runtime.source,
        endpointFingerprint: 'f'.repeat(64),
      },
    } as McpDirectRuntimeConfig;

    expect(() => createFuryKernelMcpToolBridge({
      sources: [badRuntime],
      policy: policy(runtime, 'deny'),
    })).toThrowError(FuryKernelMcpToolBridgeError);

    expect(() => createFuryKernelMcpToolBridge({
      sources: [runtime],
      policy: {
        ...policy(runtime, 'deny'),
        policyId: 'invalid policy id with spaces',
      },
    })).toThrowError(expect.objectContaining({ code: 'invalid-config' }));
  });
});
