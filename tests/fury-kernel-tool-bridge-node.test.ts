import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createFuryKernelToolBridge,
  type FuryKernelToolBridgeSource,
} from '../src/fury-kernel-tool-bridge-node.js';
import {
  deriveMcpDirectEndpointFingerprint,
  type McpDirectRuntimeConfig,
} from '../src/mcp-direct-client-node.js';
import type { McpDirectPolicy } from '../src/mcp-direct-policy.js';

const fixturePath = fileURLToPath(
  new URL('./fixtures/mcp-direct-execution-stdio-server.mjs', import.meta.url),
);

function sourceConfig(options: {
  readonly sourceId?: string;
  readonly secret?: string;
} = {}): McpDirectRuntimeConfig {
  const provisional: McpDirectRuntimeConfig = {
    source: {
      sourceId: options.sourceId ?? 'tool-bridge-fixture',
      transport: 'stdio',
      endpointFingerprint: '0'.repeat(64),
      trust: 'trusted',
    },
    command: process.execPath,
    args: [fixturePath],
    ...(options.secret === undefined
      ? {}
      : {
          env: { BRIDGE_SECRET: options.secret },
          principalId: 'tool-bridge-fixture-principal',
        }),
  };
  return {
    ...provisional,
    source: {
      ...provisional.source,
      endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional),
    },
  };
}

function policy(
  config: McpDirectRuntimeConfig,
  mode: 'auto' | 'operator' | 'deny',
): McpDirectPolicy {
  const pair = Object.freeze({
    sourceId: config.source.sourceId,
    endpointFingerprint: config.source.endpointFingerprint,
    toolName: 'governed-echo',
  });
  return Object.freeze({
    format: 'furypipe-mcp-direct-policy/v1',
    policyId: `bridge-policy-${mode}`,
    governedPolicyAllowlist: mode === 'auto' ? Object.freeze([pair]) : Object.freeze([]),
    operatorApprovalAllowlist: mode === 'operator' ? Object.freeze([pair]) : Object.freeze([]),
  });
}

function source(
  mode: 'auto' | 'operator' | 'deny',
  options: { readonly sourceId?: string; readonly secret?: string } = {},
): FuryKernelToolBridgeSource {
  const config = sourceConfig(options);
  return Object.freeze({
    config,
    policy: policy(config, mode),
  });
}

function bridge(
  mode: 'auto' | 'operator' | 'deny',
  options: {
    readonly maxPendingProposals?: number;
    readonly allowDisplayResult?: boolean;
    readonly maxDisplayResultBytes?: number;
    readonly secret?: string;
  } = {},
) {
  return createFuryKernelToolBridge({
    sources: [source(mode, { secret: options.secret })],
    clientInfo: { name: 'furypipe-tool-bridge-test', version: '1.0.0' },
    connectTimeoutMs: 10_000,
    listTimeoutMs: 10_000,
    probeTimeoutMs: 2_000,
    callTimeoutMs: 10_000,
    ...(options.maxPendingProposals === undefined
      ? {}
      : { maxPendingProposals: options.maxPendingProposals }),
    ...(options.allowDisplayResult === undefined
      ? {}
      : { allowDisplayResult: options.allowDisplayResult }),
    ...(options.maxDisplayResultBytes === undefined
      ? {}
      : { maxDisplayResultBytes: options.maxDisplayResultBytes }),
  });
}

describe('Fury Kernel governed MCP tool bridge', () => {
  it('exposes only sanitized configured source metadata', () => {
    const secret = 'MCP_TOOL_BRIDGE_SECRET_CANARY';
    const instance = bridge('auto', { secret });
    const sources = instance.inspectSources();

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      sourceId: 'tool-bridge-fixture',
      transport: 'stdio',
      trust: 'trusted',
      endpointFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      executionAuthority: false,
    });
    const serialized = JSON.stringify(sources);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(fixturePath);
    expect(serialized).not.toContain('BRIDGE_SECRET');
  });

  it('probes a real MCP inventory without granting execution authority', async () => {
    const instance = bridge('auto');
    const inspected = await instance.inspectSource('tool-bridge-fixture');

    expect(inspected).toMatchObject({
      format: 'furypipe-kernel-tool-bridge/v1',
      connected: true,
      healthy: true,
      listed: true,
      protocolEra: 'modern_2026',
      executionAuthority: false,
    });
    expect(inspected.tools).toEqual([
      expect.objectContaining({
        name: 'governed-echo',
        riskClass: 'trusted_read_only_closed_world',
        closedWorldReadCandidate: true,
        authorizationGranted: false,
      }),
    ]);
  }, 20_000);

  it('auto-approves only the exact governed closed-world read and executes separately', async () => {
    const instance = bridge('auto');
    const proposed = await instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 'hello governed tool' },
    });

    expect(proposed).toMatchObject({
      status: 'approved',
      approvalKind: 'governed_policy',
      riskClass: 'trusted_read_only_closed_world',
      policy: {
        outcome: 'allow_governed_policy',
      },
      executionAuthority: false,
    });
    expect(proposed.proposalId).toMatch(/^ftb_[0-9a-f-]{36}$/u);
    expect(instance.pendingProposalCount()).toBe(1);

    const executed = await instance.execute(proposed.proposalId!);
    expect(executed).toMatchObject({
      status: 'completed',
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      state: {
        executed: true,
        succeeded: true,
        verified: true,
      },
      receipt: {
        executed: true,
        succeeded: true,
        verified: true,
        verificationKind: 'schema',
      },
      displayResult: {
        available: false,
        reason: 'display-disabled',
      },
      retrySafe: false,
      executionAuthority: false,
    });
    expect(executed.displayResult?.value).toBeUndefined();
    expect(instance.pendingProposalCount()).toBe(0);
  }, 30_000);

  it('requires explicit operator approval before executing an operator-gated proposal', async () => {
    const instance = bridge('operator');
    const proposed = await instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 'operator gated' },
    });

    expect(proposed).toMatchObject({
      status: 'approval-required',
      policy: {
        outcome: 'require_operator',
      },
      executionAuthority: false,
    });
    const proposalId = proposed.proposalId!;

    await expect(instance.execute(proposalId))
      .rejects.toThrow(/not approved/i);

    const approved = instance.approve(proposalId);
    expect(approved).toMatchObject({
      status: 'approved',
      approvalKind: 'operator',
      proposalId,
      executionAuthority: false,
    });
    expect(() => instance.approve(proposalId))
      .toThrow(/not awaiting operator approval/i);

    const executed = await instance.execute(proposalId);
    expect(executed.state).toEqual({
      executed: true,
      succeeded: true,
      verified: true,
    });
  }, 30_000);

  it('does not retain executable authority for denied policy decisions', async () => {
    const instance = bridge('deny');
    const proposed = await instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 'denied' },
    });

    expect(proposed).toMatchObject({
      status: 'denied',
      policy: {
        outcome: 'deny',
      },
      executionAuthority: false,
    });
    expect(proposed.proposalId).toBeUndefined();
    expect(instance.pendingProposalCount()).toBe(0);
  }, 20_000);

  it('rejects invalid arguments at proposal validation before execution authority exists', async () => {
    const instance = bridge('auto');

    await expect(instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 42 },
    })).rejects.toThrow(/schema validation/i);

    expect(instance.pendingProposalCount()).toBe(0);
    expect(instance.activeExecutionCount()).toBe(0);
  }, 20_000);

  it('rejects forged proposal identifiers and allows explicit discard', async () => {
    const instance = bridge('operator');

    expect(() => instance.approve('ftb_00000000-0000-4000-8000-000000000000'))
      .toThrow(/missing or expired/i);
    await expect(instance.execute('ftb_00000000-0000-4000-8000-000000000000'))
      .rejects.toThrow(/missing or expired/i);

    const proposed = await instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 'discard me' },
    });
    expect(instance.discard(proposed.proposalId!)).toBe(true);
    expect(instance.discard(proposed.proposalId!)).toBe(false);
    expect(() => instance.approve(proposed.proposalId!))
      .toThrow(/missing or expired/i);
  }, 20_000);

  it('bounds pending proposal capacity', async () => {
    const instance = bridge('operator', { maxPendingProposals: 1 });

    await instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 'first' },
    });
    await expect(instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 'second' },
    })).rejects.toThrow(/capacity/i);
  }, 30_000);

  it('withholds oversized display output without rewriting the successful execution receipt', async () => {
    const instance = bridge('auto', {
      allowDisplayResult: true,
      maxDisplayResultBytes: 1024,
    });
    const proposed = await instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 'x'.repeat(2048) },
    });

    const executed = await instance.execute(proposed.proposalId!);
    expect(executed).toMatchObject({
      status: 'completed',
      state: {
        executed: true,
        succeeded: true,
        verified: true,
      },
      displayResult: {
        available: false,
        reason: 'result-too-large',
      },
    });
  }, 30_000);

  it('snapshots proposal arguments before the asynchronous inventory probe', async () => {
    const instance = bridge('auto', { allowDisplayResult: true });
    const args = { message: 'snapshot-before-await' };

    const proposing = instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: args,
    });
    // Mutation occurs immediately after propose() returns its Promise. The bridge
    // must already have canonicalized the arguments before the first await.
    args.message = 'mutated-after-call';

    const proposed = await proposing;
    const executed = await instance.execute(proposed.proposalId!);

    expect(executed).toMatchObject({
      status: 'completed',
      state: {
        executed: true,
        succeeded: true,
        verified: true,
      },
    });
    expect(JSON.stringify(executed.displayResult?.value))
      .toContain('snapshot-before-await');
    expect(JSON.stringify(executed.displayResult?.value))
      .not.toContain('mutated-after-call');
  }, 30_000);

  it('snapshots host source and policy configuration at bridge construction', async () => {
    const config = sourceConfig() as {
      source: {
        sourceId: string;
        transport: 'stdio';
        endpointFingerprint: string;
        trust: 'trusted';
      };
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
    const configuredPolicy = policy(config, 'auto') as {
      format: 'furypipe-mcp-direct-policy/v1';
      policyId: string;
      governedPolicyAllowlist: Array<{
        sourceId: string;
        endpointFingerprint: string;
        toolName: string;
      }>;
      operatorApprovalAllowlist: Array<{
        sourceId: string;
        endpointFingerprint: string;
        toolName: string;
      }>;
    };

    const instance = createFuryKernelToolBridge({
      sources: [{ config, policy: configuredPolicy }],
      clientInfo: { name: 'furypipe-tool-bridge-test', version: '1.0.0' },
      connectTimeoutMs: 10_000,
      listTimeoutMs: 10_000,
      probeTimeoutMs: 2_000,
      callTimeoutMs: 10_000,
    });

    config.command = 'must-not-be-used';
    config.source.sourceId = 'mutated-source';
    configuredPolicy.governedPolicyAllowlist.splice(0);

    expect(instance.inspectSources()[0]).toMatchObject({
      sourceId: 'tool-bridge-fixture',
      transport: 'stdio',
      trust: 'trusted',
    });
    const proposed = await instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 'snapshot-config' },
    });
    expect(proposed).toMatchObject({
      status: 'approved',
      approvalKind: 'governed_policy',
      policy: { outcome: 'allow_governed_policy' },
    });
  }, 20_000);

  it('rejects accessor-based host configuration without invoking the getter', () => {
    const validConfig = sourceConfig();
    let getterCalls = 0;
    const hostileConfig = {
      source: validConfig.source,
      get command() {
        getterCalls += 1;
        return process.execPath;
      },
      args: [fixturePath],
    };

    expect(() => createFuryKernelToolBridge({
      sources: [{
        config: hostileConfig as unknown as McpDirectRuntimeConfig,
        policy: policy(validConfig, 'auto'),
      }],
      clientInfo: { name: 'furypipe-tool-bridge-test', version: '1.0.0' },
    })).toThrow(/data properties|plain data object/u);
    expect(getterCalls).toBe(0);
  });

  it('bounds concurrent MCP inventory probes independently from executions', async () => {
    const config = sourceConfig();
    const instance = createFuryKernelToolBridge({
      sources: [{
        config,
        policy: policy(config, 'auto'),
      }],
      clientInfo: { name: 'furypipe-tool-bridge-test', version: '1.0.0' },
      maxConcurrentProbes: 1,
      connectTimeoutMs: 10_000,
      listTimeoutMs: 10_000,
      probeTimeoutMs: 2_000,
    });

    const first = instance.inspectSource('tool-bridge-fixture');
    expect(instance.activeProbeCount()).toBe(1);
    await expect(instance.inspectSource('tool-bridge-fixture'))
      .rejects.toThrow(/probe concurrency/i);
    await first;
    expect(instance.activeProbeCount()).toBe(0);
    expect(instance.activeExecutionCount()).toBe(0);
  }, 20_000);

  it('prunes expired proposal authority before approval', async () => {
    let now = 1_000;
    const config = sourceConfig();
    const instance = createFuryKernelToolBridge({
      sources: [{
        config,
        policy: policy(config, 'operator'),
      }],
      clientInfo: { name: 'furypipe-tool-bridge-test', version: '1.0.0' },
      now: () => now,
    });

    const proposed = await instance.propose({
      sourceId: 'tool-bridge-fixture',
      toolName: 'governed-echo',
      arguments: { message: 'expire me' },
    });
    expect(proposed.status).toBe('approval-required');
    now = 40_000;
    expect(instance.pendingProposalCount()).toBe(0);
    expect(() => instance.approve(proposed.proposalId!))
      .toThrow(/missing or expired/i);
  }, 20_000);
});
