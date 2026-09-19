import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as FuryPipe from '../src/core/index.js';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { readonly exports: Readonly<Record<string, unknown>> };

describe('direct MCP supported public authority surface', () => {
  it('exports the real inventory probe but not test injection or raw lifecycle mutation', () => {
    const root = FuryPipe as Record<string, unknown>;

    expect(root.probeMcpDirectInventory).toBeTypeOf('function');
    expect(root.deriveMcpDirectEndpointFingerprint).toBeTypeOf('function');
    expect(root.selectMcpDirectTool).toBeTypeOf('function');
    expect(root.executeMcpDirectApprovedTool).toBeTypeOf('function');
    expect(root.executeMcpDirectReplay).toBeTypeOf('function');
    expect(root.createMcpDirectReplayIntent).toBeTypeOf('function');
    expect(root.McpDirectReplayGovernanceError).toBeTypeOf('function');
    expect(root.McpDirectExecutionEvidenceError).toBeTypeOf('function');
    expect(root.McpDirectExecutionDurabilityError).toBeTypeOf('function');
    expect(root.McpDirectExecutionPreCallRejectedError).toBeTypeOf('function');
    expect(root.McpDirectExecutionOutcomeUnknownError).toBeTypeOf('function');
    expect(root.McpDirectExecutionVerificationError).toBeTypeOf('function');
    expect(root.createMcpDirectDurableReplayCoordinator).toBeTypeOf('function');
    expect(root.inspectMcpDirectDurableReplayStatus).toBeTypeOf('function');
    expect(root.reclaimMcpDirectDurableExpiredPreCall).toBeTypeOf('function');
    expect(root.McpDirectDurableReplayError).toBeTypeOf('function');

    expect(root.createMcpDirectLifecycle).toBeUndefined();
    expect(root.recordMcpDirectConnection).toBeUndefined();
    expect(root.recordMcpDirectHealth).toBeUndefined();
    expect(root.recordMcpDirectInventory).toBeUndefined();
    expect(root.recordMcpDirectSelection).toBeUndefined();
    expect(root.recordMcpDirectApproval).toBeUndefined();
    expect(root.createMcpDirectExecutionPermit).toBeUndefined();
    expect(root.consumeMcpDirectExecutionPermit).toBeUndefined();
    expect(root.recordMcpDirectExecution).toBeUndefined();
    expect(root.recordMcpDirectVerification).toBeUndefined();
    expect(root.resolveMcpDirectProposalArguments).toBeUndefined();
    expect(root.reserveMcpDirectDurableExecution).toBeUndefined();
    expect(root.armMcpDirectDurableExecution).toBeUndefined();
    expect(root.settleMcpDirectDurableExecution).toBeUndefined();
    expect(root.abortMcpDirectDurablePreCallReservation).toBeUndefined();
    expect(root.abortMcpDirectDurableArmedBeforeCall).toBeUndefined();
  });

  it('publishes only the safe M1/M2 subpaths, not raw governance or internals', () => {
    expect(packageJson.exports['./mcp-direct-governance']).toBeUndefined();
    expect(packageJson.exports['./mcp-direct-client-node-internal']).toBeUndefined();
    expect(packageJson.exports['./mcp-direct-catalog']).toBeUndefined();
    expect(packageJson.exports['./mcp-direct-json']).toBeUndefined();

    expect(packageJson.exports['./mcp-direct-client-node']).toBeDefined();
    expect(packageJson.exports['./mcp-direct-policy']).toBeDefined();
    expect(packageJson.exports['./mcp-direct-executor-node']).toBeDefined();
    expect(packageJson.exports['./mcp-direct-durable-replay-node']).toBeDefined();
    expect(packageJson.exports['./mcp-direct-policy-internal']).toBeUndefined();
    expect(packageJson.exports['./mcp-direct-executor-node-internal']).toBeUndefined();
    expect(packageJson.exports['./mcp-direct-replay-internal']).toBeUndefined();
    expect(packageJson.exports['./mcp-direct-durable-replay-internal']).toBeUndefined();
  });
});