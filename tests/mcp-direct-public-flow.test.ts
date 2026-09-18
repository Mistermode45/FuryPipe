import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  approveMcpDirectPolicyDecision,
  createMcpDirectToolProposal,
  deriveMcpDirectEndpointFingerprint,
  evaluateMcpDirectPolicy,
  probeMcpDirectInventory,
  selectMcpDirectTool,
  type McpDirectPolicy,
  type McpDirectRuntimeConfig,
} from '../src/core/index.js';

const sha = (char: string) => char.repeat(64);

describe('supported direct MCP M1 -> M2 public flow', () => {
  it('probes, selects, validates, evaluates and approves without executing a tool', async () => {
    const fixturePath = fileURLToPath(
      new URL('./fixtures/mcp-direct-stdio-server.mjs', import.meta.url),
    );
    const provisional: McpDirectRuntimeConfig = {
      source: {
        sourceId: 'public-m2-e2e',
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

    const inventory = await probeMcpDirectInventory(config, {
      clientInfo: { name: 'furypipe-public-m2-e2e', version: '1.0.0' },
      connectTimeoutMs: 10_000,
      listTimeoutMs: 10_000,
      probeTimeoutMs: 2_000,
    });

    const selected = selectMcpDirectTool(inventory.lifecycle, 'inventory-proof');
    const proposal = await createMcpDirectToolProposal(
      selected,
      inventory.catalog,
      undefined,
    );
    const policy: McpDirectPolicy = {
      format: 'furypipe-mcp-direct-policy/v1',
      policyId: 'public-m2-e2e-policy',
      governedPolicyAllowlist: [{
        sourceId: selected.source.sourceId,
        endpointFingerprint: selected.source.endpointFingerprint,
        toolName: 'inventory-proof',
      }],
      operatorApprovalAllowlist: [],
    };
    const decision = evaluateMcpDirectPolicy(
      selected,
      proposal,
      policy,
      { now: 1_000 },
    );
    const approved = approveMcpDirectPolicyDecision(
      selected,
      proposal,
      decision,
      'governed_policy',
      1_000,
    );

    expect(inventory.protocolVersion).toBe('2026-07-28');
    expect(proposal.argumentsValidated).toBe(true);
    expect(decision).toMatchObject({
      policyEvaluated: true,
      outcome: 'allow_governed_policy',
      riskClass: 'trusted_read_only_closed_world',
    });
    expect(approved).toMatchObject({
      selected: true,
      approved: true,
      executed: false,
      succeeded: false,
      verified: false,
    });
    expect(approved.approval).toMatchObject({
      inputSha256: proposal.inputSha256,
      policyDecisionIdSha256: decision.policyDecisionIdSha256,
      approvalKind: 'governed_policy',
      approvedAt: 1_000,
      expiresAt: 31_000,
    });
  }, 20_000);
});
