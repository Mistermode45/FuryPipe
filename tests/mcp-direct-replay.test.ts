import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  deriveMcpDirectEndpointFingerprint,
  probeMcpDirectInventory,
  type McpDirectRuntimeConfig,
} from '../src/mcp-direct-client-node.js';
import {
  probeMcpDirectInventory as probeMcpDirectInventoryInternal,
  type McpDirectSdkFactory,
} from '../src/mcp-direct-client-node-internal.js';
import {
  createMcpDirectReplayIntent,
  executeMcpDirectApprovedTool,
  executeMcpDirectReplay,
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

async function approvedPublic(
  runtime: McpDirectRuntimeConfig,
  message: string,
) {
  const inventory = await probeMcpDirectInventory(runtime, {
    clientInfo: { name: 'furypipe-m4-real-e2e', version: '1.0.0' },
    connectTimeoutMs: 10_000,
    listTimeoutMs: 10_000,
    probeTimeoutMs: 2_000,
  });
  const selected = selectMcpDirectTool(inventory.lifecycle, 'governed-echo');
  const proposal = await createMcpDirectToolProposal(
    selected,
    inventory.catalog,
    { message },
  );
  const policy: McpDirectPolicy = {
    format: 'furypipe-mcp-direct-policy/v1',
    policyId: 'm4-real-replay-policy',
    governedPolicyAllowlist: [{
      sourceId: selected.source.sourceId,
      endpointFingerprint: selected.source.endpointFingerprint,
      toolName: 'governed-echo',
    }],
    operatorApprovalAllowlist: [],
  };
  const decision = evaluateMcpDirectPolicy(selected, proposal, policy);
  const lifecycle = approveMcpDirectPolicyDecision(
    selected,
    proposal,
    decision,
    'governed_policy',
  );
  return { lifecycle, proposal };
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

  it('denies replay for a trusted open-world read even after explicit operator approval', async () => {
    const openWorldTool = {
      ...SAFE_TOOL,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    };
    const fake = fakeFactory({ tool: openWorldTool });
    const first = await approved(fake.factory, 'open-world', { operator: true });
    const original = await executeMcpDirectApprovedToolInternal(
      first.runtime,
      first.lifecycle,
      first.proposal,
      {
        clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );

    const second = await approved(fake.factory, 'open-world', { operator: true });
    expect(() => createMcpDirectReplayIntent(
      original.receipt,
      second.lifecycle,
      second.proposal,
      'repeat_closed_world_read',
    )).toThrow(/not authorized/i);
    expect(fake.counts().callCalls).toBe(1);
  });

  it('allows at most one concurrent original execution for the same replay key', async () => {
    const fake = fakeFactory({});
    const left = await approved(fake.factory, 'concurrent');
    const right = await approved(fake.factory, 'concurrent');

    const results = await Promise.allSettled([
      executeMcpDirectApprovedToolInternal(
        left.runtime,
        left.lifecycle,
        left.proposal,
        {
          clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
          factory: fake.factory,
        },
      ),
      executeMcpDirectApprovedToolInternal(
        right.runtime,
        right.lifecycle,
        right.proposal,
        {
          clientInfo: { name: 'furypipe-m4-test', version: '1.0.0' },
          factory: fake.factory,
        },
      ),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({
        code: 'duplicate-blocked',
      }),
    });
    expect(fake.counts().callCalls).toBe(1);
  });

  it('proves one original plus one explicit replay with the real official v2 stdio stack and no hidden third call', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'furypipe-m4-replay-'));
    const counterPath = join(directory, 'calls.txt');
    try {
      const fixturePath = fileURLToPath(
        new URL('./fixtures/mcp-direct-execution-stdio-server.mjs', import.meta.url),
      );
      const provisional: McpDirectRuntimeConfig = {
        source: {
          sourceId: 'real-m4-stdio-replay',
          transport: 'stdio',
          endpointFingerprint: sha('0'),
          trust: 'trusted',
        },
        command: process.execPath,
        args: [fixturePath, counterPath],
        maxBufferBytes: 1024 * 1024,
      };
      const runtime: McpDirectRuntimeConfig = {
        ...provisional,
        source: {
          ...provisional.source,
          endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional),
        },
      };

      const first = await approvedPublic(runtime, 'M4_REAL_REPLAY_OK');
      const original = await executeMcpDirectApprovedTool(
        runtime,
        first.lifecycle,
        first.proposal,
        {
          clientInfo: { name: 'furypipe-m4-real-e2e', version: '1.0.0' },
          connectTimeoutMs: 10_000,
          listTimeoutMs: 10_000,
          callTimeoutMs: 10_000,
          probeTimeoutMs: 2_000,
        },
      );
      expect(original.receipt).toMatchObject({
        attempt: 1,
        replayed: false,
        executed: true,
        succeeded: true,
        verified: true,
      });
      expect(original.result).toMatchObject({
        structuredContent: {
          echo: 'M4_REAL_REPLAY_OK',
          calls: 1,
        },
      });

      const second = await approvedPublic(runtime, 'M4_REAL_REPLAY_OK');
      const replayIntent = createMcpDirectReplayIntent(
        original.receipt,
        second.lifecycle,
        second.proposal,
        'repeat_closed_world_read',
      );
      const replay = await executeMcpDirectReplay(
        runtime,
        second.lifecycle,
        second.proposal,
        replayIntent,
        {
          clientInfo: { name: 'furypipe-m4-real-e2e', version: '1.0.0' },
          connectTimeoutMs: 10_000,
          listTimeoutMs: 10_000,
          callTimeoutMs: 10_000,
          probeTimeoutMs: 2_000,
        },
      );
      expect(replay.receipt).toMatchObject({
        attempt: 2,
        replayed: true,
        replayReason: 'repeat_closed_world_read',
        priorResultSha256: original.receipt.resultSha256,
        executed: true,
        succeeded: true,
        verified: true,
      });
      expect(replay.result).toMatchObject({
        structuredContent: {
          echo: 'M4_REAL_REPLAY_OK',
          calls: 2,
        },
      });

      const third = await approvedPublic(runtime, 'M4_REAL_REPLAY_OK');
      await expect(executeMcpDirectApprovedTool(
        runtime,
        third.lifecycle,
        third.proposal,
        {
          clientInfo: { name: 'furypipe-m4-real-e2e', version: '1.0.0' },
          connectTimeoutMs: 10_000,
          listTimeoutMs: 10_000,
          callTimeoutMs: 10_000,
          probeTimeoutMs: 2_000,
        },
      )).rejects.toMatchObject({
        code: 'duplicate-blocked',
        priorAttempt: 2,
      });

      expect(readFileSync(counterPath, 'utf8').trim()).toBe('2');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 45_000);

});
