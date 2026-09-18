import { beforeEach, describe, expect, it } from 'vitest';

import {
  deriveMcpDirectEndpointFingerprint,
  type McpDirectRuntimeConfig,
} from '../src/mcp-direct-client-node.js';
import {
  probeMcpDirectInventory as probeMcpDirectInventoryInternal,
  type McpDirectSdkFactory,
} from '../src/mcp-direct-client-node-internal.js';
import {
  createMcpDirectReplayIntent,
  McpDirectReplayGovernanceError,
} from '../src/mcp-direct-executor-node.js';
import {
  executeMcpDirectApprovedToolInternal,
} from '../src/mcp-direct-executor-node-internal.js';
import {
  approveMcpDirectPolicyDecision,
  createMcpDirectOperatorApprovalIntent,
  createMcpDirectToolProposal,
  evaluateMcpDirectPolicy,
  selectMcpDirectTool,
  type McpDirectPolicy,
} from '../src/mcp-direct-policy.js';
import { resetMcpDirectReplayStateForTests } from '../src/mcp-direct-replay-internal.js';

const sha = (char: string) => char.repeat(64);

const SAFE_TOOL = Object.freeze({
  name: 'replay-proof',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string', minLength: 1 } },
    required: ['message'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { echo: { type: 'string' } },
    required: ['echo'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});

function config(): McpDirectRuntimeConfig {
  const provisional: McpDirectRuntimeConfig = {
    source: {
      sourceId: 'm4-replay-fixture',
      transport: 'stdio',
      endpointFingerprint: sha('0'),
      trust: 'trusted',
    },
    command: 'fixture-server',
    args: ['--stdio'],
  };
  return {
    ...provisional,
    source: {
      ...provisional.source,
      endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional),
    },
  };
}

function fakeFactory(options: {
  readonly callError?: Error;
  readonly tool?: Readonly<Record<string, unknown>>;
}) {
  let callCalls = 0;
  let connectCalls = 0;
  let listCalls = 0;
  let closeCalls = 0;
  const factory: McpDirectSdkFactory = {
    createClient: () => ({
      async connect() {
        connectCalls += 1;
      },
      async listTools() {
        listCalls += 1;
        return { tools: [options.tool ?? SAFE_TOOL] };
      },
      async callTool(params) {
        callCalls += 1;
        if (options.callError) throw options.callError;
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { echo: String(params.arguments?.message ?? '') },
        };
      },
      getProtocolEra: () => 'modern' as const,
      getNegotiatedProtocolVersion: () => '2026-07-28',
      async close() {
        closeCalls += 1;
      },
    }),
    createStdioTransport: runtime => ({ kind: 'stdio', runtime }),
    createHttpTransport: runtime => ({ kind: 'http', runtime }),
  };
  return {
    factory,
    counts: () => ({ callCalls, connectCalls, listCalls, closeCalls }),
  };
}

async function approved(
  factory: McpDirectSdkFactory,
  message: string,
  options: { readonly operator?: boolean } = {},
) {
  const runtime = config();
  const inventory = await probeMcpDirectInventoryInternal(runtime, {
    clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
    factory,
  });
  const selected = selectMcpDirectTool(inventory.lifecycle, 'replay-proof');
  const proposal = await createMcpDirectToolProposal(
    selected,
    inventory.catalog,
    { message },
  );
  const pair = {
    sourceId: selected.source.sourceId,
    endpointFingerprint: selected.source.endpointFingerprint,
    toolName: 'replay-proof',
  };
  const policy: McpDirectPolicy = {
    format: 'furypipe-mcp-direct-policy/v1',
    policyId: 'm4-replay-policy',
    governedPolicyAllowlist: options.operator ? [] : [pair],
    operatorApprovalAllowlist: options.operator ? [pair] : [],
  };
  const decision = evaluateMcpDirectPolicy(selected, proposal, policy);
  const authority = options.operator
    ? createMcpDirectOperatorApprovalIntent(proposal, decision)
    : 'governed_policy';
  const lifecycle = approveMcpDirectPolicyDecision(
    selected,
    proposal,
    decision,
    authority,
  );
  return { runtime, lifecycle, proposal };
}

describe('Direct MCP M4 replay governance', () => {
  beforeEach(() => {
    resetMcpDirectReplayStateForTests();
  });
  it('blocks a duplicate fresh approval for the same exact execution key', async () => {
    const fake = fakeFactory({});
    const first = await approved(fake.factory, 'same');
    const one = await executeMcpDirectApprovedToolInternal(
      first.runtime,
      first.lifecycle,
      first.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );
    expect(one.receipt).toMatchObject({
      attempt: 1,
      replayed: false,
      executed: true,
      succeeded: true,
    });

    const second = await approved(fake.factory, 'same');
    let caught: unknown;
    try {
      await executeMcpDirectApprovedToolInternal(
        second.runtime,
        second.lifecycle,
        second.proposal,
        {
          clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
          factory: fake.factory,
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(McpDirectReplayGovernanceError);
    expect(caught).toMatchObject({
      code: 'duplicate-blocked',
      retrySafe: false,
      priorAttempt: 1,
    });
    expect(fake.counts().callCalls).toBe(1);
  });

  it('permits one explicit replay of a trusted closed-world read with a fresh approval', async () => {
    const fake = fakeFactory({});
    const first = await approved(fake.factory, 'same');
    const original = await executeMcpDirectApprovedToolInternal(
      first.runtime,
      first.lifecycle,
      first.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );

    const second = await approved(fake.factory, 'same');
    const intent = createMcpDirectReplayIntent(
      original.receipt,
      second.lifecycle,
      second.proposal,
      'repeat_closed_world_read',
    );
    const internalReplay = await executeMcpDirectApprovedToolInternal(
      second.runtime,
      second.lifecycle,
      second.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
        replayIntent: intent,
      },
    );
    expect(internalReplay.receipt).toMatchObject({
      attempt: 2,
      replayed: true,
      replayReason: 'repeat_closed_world_read',
      priorResultSha256: original.receipt.resultSha256,
      executed: true,
      succeeded: true,
    });
    expect(fake.counts().callCalls).toBe(2);

    await expect(executeMcpDirectApprovedToolInternal(
      second.runtime,
      second.lifecycle,
      second.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
        replayIntent: intent,
      },
    )).rejects.toThrow(/already used|not authorized/i);
    expect(fake.counts().callCalls).toBe(2);
  });

  it('does not let idempotent mutation annotations become replay authority', async () => {
    const mutatingTool = {
      ...SAFE_TOOL,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    };
    const fake = fakeFactory({ tool: mutatingTool });
    const first = await approved(fake.factory, 'mutating', { operator: true });
    const original = await executeMcpDirectApprovedToolInternal(
      first.runtime,
      first.lifecycle,
      first.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );

    const second = await approved(fake.factory, 'mutating', { operator: true });
    expect(() => createMcpDirectReplayIntent(
      original.receipt,
      second.lifecycle,
      second.proposal,
      'repeat_closed_world_read',
    )).toThrow(/not authorized/i);
    expect(fake.counts().callCalls).toBe(1);
  });

  it('cannot authorize replay from an unknown execution outcome', async () => {
    const fake = fakeFactory({ callError: new Error('transport dropped') });
    const first = await approved(fake.factory, 'same');

    await expect(executeMcpDirectApprovedToolInternal(
      first.runtime,
      first.lifecycle,
      first.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
      },
    )).rejects.toMatchObject({
      code: 'MCP_DIRECT_EXECUTION_OUTCOME_UNKNOWN',
      retrySafe: false,
    });

    const second = await approved(fake.factory, 'same');
    await expect(executeMcpDirectApprovedToolInternal(
      second.runtime,
      second.lifecycle,
      second.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
      },
    )).rejects.toMatchObject({
      code: 'duplicate-blocked',
      priorOutcome: 'unknown',
    });
    expect(fake.counts().callCalls).toBe(1);
  });

  it('uses different replay keys for different exact input digests', async () => {
    const fake = fakeFactory({});
    const first = await approved(fake.factory, 'one');
    const one = await executeMcpDirectApprovedToolInternal(
      first.runtime,
      first.lifecycle,
      first.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );

    const second = await approved(fake.factory, 'two');
    const two = await executeMcpDirectApprovedToolInternal(
      second.runtime,
      second.lifecycle,
      second.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );

    expect(two.receipt.replayKeySha256).not.toBe(one.receipt.replayKeySha256);
    expect(fake.counts().callCalls).toBe(2);
  });
});
