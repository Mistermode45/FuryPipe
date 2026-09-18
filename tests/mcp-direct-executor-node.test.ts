import { mkdtemp, rm } from 'node:fs/promises';
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
  executeMcpDirectApprovedTool,
} from '../src/mcp-direct-executor-node.js';
import {
  executeMcpDirectApprovedToolInternal,
  McpDirectExecutionDurabilityError,
  McpDirectExecutionEvidenceError,
  McpDirectExecutionOutcomeUnknownError,
} from '../src/mcp-direct-executor-node-internal.js';
import { createRecoveryStore, type RecoveryStore } from '../src/core/recovery-store.js';
import {
  createMcpDirectDurableReplayCoordinatorInternal,
  inspectMcpDirectDurableReplayStatusInternal,
} from '../src/mcp-direct-durable-replay-internal.js';
import {
  createMcpDirectReplayIntentInternal,
  resetMcpDirectReplayStateForTests,
} from '../src/mcp-direct-replay-internal.js';
import {
  approveMcpDirectPolicyDecision,
  createMcpDirectToolProposal,
  evaluateMcpDirectPolicy,
  selectMcpDirectTool,
  type McpDirectPolicy,
} from '../src/mcp-direct-policy.js';

const sha = (char: string) => char.repeat(64);

const SAFE_TOOL = Object.freeze({
  name: 'governed-echo',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string', minLength: 1 } },
    required: ['message'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      echo: { type: 'string' },
      calls: { type: 'integer', minimum: 1 },
    },
    required: ['echo', 'calls'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});

function stdioConfig(command = 'fixture-server'): McpDirectRuntimeConfig {
  const provisional: McpDirectRuntimeConfig = {
    source: {
      sourceId: 'm3-fixture',
      transport: 'stdio',
      endpointFingerprint: sha('0'),
      trust: 'trusted',
    },
    command,
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
  readonly toolSequence?: readonly (readonly Record<string, unknown>[])[];
  readonly eraSequence?: readonly ('modern' | 'legacy')[];
  readonly result?: unknown;
  readonly callError?: Error;
  readonly closeErrorSequence?: readonly (Error | undefined)[];
}) {
  let clients = 0;
  let connectCalls = 0;
  let listCalls = 0;
  let callCalls = 0;
  let closeCalls = 0;
  let lastCall: unknown;

  const factory: McpDirectSdkFactory = {
    createClient() {
      const clientIndex = clients++;
      return {
        async connect() {
          connectCalls += 1;
        },
        async listTools() {
          listCalls += 1;
          return {
            tools: options.toolSequence?.[clientIndex]
              ?? options.toolSequence?.at(-1)
              ?? [SAFE_TOOL],
          };
        },
        async callTool(params, callOptions) {
          callCalls += 1;
          lastCall = { params, callOptions };
          if (options.callError) throw options.callError;
          return options.result ?? {
            content: [{ type: 'text', text: 'ok' }],
            structuredContent: {
              echo: String(params.arguments?.message ?? ''),
              calls: callCalls,
            },
          };
        },
        getProtocolEra: () => options.eraSequence?.[clientIndex]
          ?? options.eraSequence?.at(-1)
          ?? 'modern',
        getNegotiatedProtocolVersion: () => (
          (options.eraSequence?.[clientIndex] ?? options.eraSequence?.at(-1) ?? 'modern') === 'modern'
            ? '2026-07-28'
            : '2025-11-25'
        ),
        async close() {
          closeCalls += 1;
          const closeError = options.closeErrorSequence?.[clientIndex];
          if (closeError) throw closeError;
        },
      };
    },
    createStdioTransport: config => ({ kind: 'stdio', config }),
    createHttpTransport: config => ({ kind: 'http', config }),
  };

  return {
    factory,
    counters: () => ({ clients, connectCalls, listCalls, callCalls, closeCalls }),
    lastCall: () => lastCall,
  };
}

async function approvedWithFactory(
  factory: McpDirectSdkFactory,
  message: string,
): Promise<{
  readonly config: McpDirectRuntimeConfig;
  readonly lifecycle: Awaited<ReturnType<typeof probeMcpDirectInventory>>['lifecycle'];
  readonly proposal: Awaited<ReturnType<typeof createMcpDirectToolProposal>>;
}> {
  const config = stdioConfig();
  const inventory = await probeMcpDirectInventoryInternal(config, {
    clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
    factory,
  });
  const selected = selectMcpDirectTool(inventory.lifecycle, 'governed-echo');
  const proposal = await createMcpDirectToolProposal(
    selected,
    inventory.catalog,
    { message },
  );
  const policy: McpDirectPolicy = {
    format: 'furypipe-mcp-direct-policy/v1',
    policyId: 'm3-test-policy',
    governedPolicyAllowlist: [{
      sourceId: selected.source.sourceId,
      endpointFingerprint: selected.source.endpointFingerprint,
      toolName: 'governed-echo',
    }],
    operatorApprovalAllowlist: [],
  };
  const decision = evaluateMcpDirectPolicy(selected, proposal, policy);
  const approved = approveMcpDirectPolicyDecision(
    selected,
    proposal,
    decision,
    'governed_policy',
  );
  return { config, lifecycle: approved, proposal };
}

describe('Direct MCP M3 governed execution', () => {
  beforeEach(() => {
    resetMcpDirectReplayStateForTests();
  });
  it('executes exactly once after fresh same-session revalidation and produces digest-only evidence', async () => {
    const canary = 'M3_ARGUMENT_RESULT_CANARY_71D9';
    const fake = fakeFactory({});
    const approved = await approvedWithFactory(fake.factory, canary);

    const executed = await executeMcpDirectApprovedToolInternal(
      approved.config,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );

    expect(fake.counters()).toEqual({
      clients: 2,
      connectCalls: 2,
      listCalls: 2,
      callCalls: 1,
      closeCalls: 2,
    });
    expect(executed.lifecycle).toMatchObject({
      approved: true,
      executed: true,
      succeeded: true,
      verified: true,
    });
    expect(executed.receipt).toMatchObject({
      format: 'furypipe-mcp-direct-execution-receipt/v1',
      executed: true,
      succeeded: true,
      verified: true,
      verificationKind: 'schema',
      outputSchemaSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      protocolVersion: '2026-07-28',
    });
    expect(JSON.stringify({ lifecycle: executed.lifecycle, receipt: executed.receipt }))
      .not.toContain(canary);
    expect(executed.result).toMatchObject({
      structuredContent: { echo: canary, calls: 1 },
    });

    const call = fake.lastCall() as {
      readonly params: { readonly name: string; readonly arguments: Record<string, unknown> };
      readonly callOptions: { readonly toolDefinition: Record<string, unknown> };
    };
    expect(call.params).toEqual({
      name: 'governed-echo',
      arguments: { message: canary },
    });
    expect(call.callOptions.toolDefinition).toMatchObject({
      name: 'governed-echo',
      inputSchema: SAFE_TOOL.inputSchema,
      outputSchema: SAFE_TOOL.outputSchema,
    });
  });

  it('fails closed on fresh input-schema drift before callTool', async () => {
    const drifted = {
      ...SAFE_TOOL,
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'integer' } },
        required: ['message'],
        additionalProperties: false,
      },
    };
    const fake = fakeFactory({ toolSequence: [[SAFE_TOOL], [drifted]] });
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    await expect(executeMcpDirectApprovedToolInternal(
      approved.config,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      },
    )).rejects.toThrow(/schema drifted/i);
    expect(fake.counters().callCalls).toBe(0);
  });

  it('fails closed on fresh risk drift before callTool', async () => {
    const drifted = {
      ...SAFE_TOOL,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    };
    const fake = fakeFactory({ toolSequence: [[SAFE_TOOL], [drifted]] });
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    await expect(executeMcpDirectApprovedToolInternal(
      approved.config,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      },
    )).rejects.toThrow(/risk class drifted/i);
    expect(fake.counters().callCalls).toBe(0);
  });

  it('fails closed on protocol-era drift before callTool', async () => {
    const fake = fakeFactory({ eraSequence: ['modern', 'legacy'] });
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    await expect(executeMcpDirectApprovedToolInternal(
      approved.config,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      },
    )).rejects.toThrow(/identity\/protocol does not match/i);
    expect(fake.counters().callCalls).toBe(0);
  });

  it('records execution but refuses verification when structured output violates the fresh schema', async () => {
    const fake = fakeFactory({
      result: {
        content: [{ type: 'text', text: 'bad structured output' }],
        structuredContent: { echo: 42, calls: 'not-an-integer' },
      },
    });
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    let caught: unknown;
    try {
      await executeMcpDirectApprovedToolInternal(
        approved.config,
        approved.lifecycle,
        approved.proposal,
        {
          clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
          factory: fake.factory,
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'MCP_DIRECT_EXECUTION_VERIFICATION_FAILED',
      retrySafe: false,
      executed: true,
      succeeded: true,
      verified: false,
      sourceId: approved.lifecycle.source.sourceId,
      toolName: 'governed-echo',
      inputSha256: approved.proposal.inputSha256,
      outputSchemaSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(JSON.stringify(caught)).not.toContain('permitId');
    expect(fake.counters().callCalls).toBe(1);
  });

  it('turns a thrown call into non-retriable unknown execution outcome and blocks replay', async () => {
    const transportSecret = 'M3_TRANSPORT_SECRET_CANARY_3A11';
    const fake = fakeFactory({ callError: new Error(`transport dropped ${transportSecret}`) });
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    let caught: unknown;
    try {
      await executeMcpDirectApprovedToolInternal(
        approved.config,
        approved.lifecycle,
        approved.proposal,
        {
          clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
          factory: fake.factory,
        },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(McpDirectExecutionOutcomeUnknownError);
    expect(caught).toMatchObject({
      code: 'MCP_DIRECT_EXECUTION_OUTCOME_UNKNOWN',
      retrySafe: false,
    });
    expect(JSON.stringify(caught)).not.toContain(transportSecret);
    expect(String(caught)).not.toContain(transportSecret);
    expect(fake.counters().callCalls).toBe(1);

    await expect(executeMcpDirectApprovedToolInternal(
      approved.config,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      },
    )).rejects.toThrow(/already used/i);
    expect(fake.counters().callCalls).toBe(1);
  });

  it('does not claim schema verification when the tool advertises no output schema', async () => {
    const toolWithoutOutput = {
      name: SAFE_TOOL.name,
      inputSchema: SAFE_TOOL.inputSchema,
      annotations: SAFE_TOOL.annotations,
    };
    const fake = fakeFactory({
      toolSequence: [[toolWithoutOutput], [toolWithoutOutput]],
      result: {
        content: [{ type: 'text', text: 'successful result without output schema' }],
      },
    });
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    const executed = await executeMcpDirectApprovedToolInternal(
      approved.config,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );

    expect(executed.lifecycle).toMatchObject({
      executed: true,
      succeeded: true,
      verified: false,
    });
    expect(executed.receipt).toMatchObject({
      executed: true,
      succeeded: true,
      verified: false,
    });
    expect(executed.receipt).not.toHaveProperty('verificationKind');
    expect(executed.receipt).not.toHaveProperty('outputSchemaSha256');
  });

  it('records a returned tool error as executed but not succeeded or verified', async () => {
    const toolWithoutOutput = {
      name: SAFE_TOOL.name,
      inputSchema: SAFE_TOOL.inputSchema,
      annotations: SAFE_TOOL.annotations,
    };
    const fake = fakeFactory({
      toolSequence: [[toolWithoutOutput], [toolWithoutOutput]],
      result: {
        content: [{ type: 'text', text: 'fixture failure' }],
        isError: true,
      },
    });
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    const executed = await executeMcpDirectApprovedToolInternal(
      approved.config,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );
    expect(executed.lifecycle).toMatchObject({
      executed: true,
      succeeded: false,
      verified: false,
    });
    expect(executed.receipt).toMatchObject({
      executed: true,
      succeeded: false,
      verified: false,
    });
  });

  it('does not erase a successful tool result when client close fails afterward', async () => {
    const fake = fakeFactory({
      closeErrorSequence: [undefined, new Error('close failed after execution')],
    });
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    const executed = await executeMcpDirectApprovedToolInternal(
      approved.config,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      },
    );

    expect(executed.receipt).toMatchObject({
      executed: true,
      succeeded: true,
      verified: true,
    });
    expect(fake.counters()).toMatchObject({ callCalls: 1, closeCalls: 2 });
  });

  it('reports post-call digest/evidence failure as executed and non-retriable without raw result leakage', async () => {
    const resultCanary = 'M3_OVERSIZED_RESULT_CANARY_A91C';
    const fake = fakeFactory({
      result: {
        content: [{ type: 'text', text: resultCanary.repeat(4096) }],
      },
    });
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    let caught: unknown;
    try {
      await executeMcpDirectApprovedToolInternal(
        approved.config,
        approved.lifecycle,
        approved.proposal,
        {
          clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
          maxResultBytes: 1024,
          factory: fake.factory,
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(McpDirectExecutionEvidenceError);
    expect(caught).toMatchObject({
      code: 'MCP_DIRECT_EXECUTION_EVIDENCE_FAILED',
      retrySafe: false,
      executed: true,
      succeeded: true,
      verified: false,
    });
    expect(JSON.stringify(caught)).not.toContain(resultCanary);
    expect(fake.counters().callCalls).toBe(1);
  });

  it('rejects execution rebinding to a different runtime principal before connecting', async () => {
    const fake = fakeFactory({});
    const approved = await approvedWithFactory(fake.factory, 'alpha');
    const provisional: McpDirectRuntimeConfig = {
      source: {
        ...approved.config.source,
        endpointFingerprint: sha('0'),
      },
      command: 'fixture-server',
      args: ['--stdio'],
      env: { API_TOKEN: 'secret-b' },
      principalId: 'principal-b',
    };
    const rebound: McpDirectRuntimeConfig = {
      ...provisional,
      source: {
        ...provisional.source,
        endpointFingerprint: deriveMcpDirectEndpointFingerprint(provisional),
      },
    };

    await expect(executeMcpDirectApprovedToolInternal(
      rebound,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      },
    )).rejects.toThrow(/not bound to the approved lifecycle/i);

    expect(fake.counters()).toEqual({
      clients: 1,
      connectCalls: 1,
      listCalls: 1,
      callCalls: 0,
      closeCalls: 1,
    });
  });

  it('rejects test-only factory injection from the public execution facade', async () => {
    const fake = fakeFactory({});
    const approved = await approvedWithFactory(fake.factory, 'alpha');

    await expect(executeMcpDirectApprovedTool(
      approved.config,
      approved.lifecycle,
      approved.proposal,
      {
        clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
        factory: fake.factory,
      } as never,
    )).rejects.toThrow(/unsupported or unsafe fields/i);
    expect(fake.counters().callCalls).toBe(0);
  });


  it('persists a successful durable execution before returning the M3/M4 receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m5-executor-success-'));
    try {
      const store = createRecoveryStore(root, { namespace: 'mcp-m5-executor' });
      const coordinator = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-m5',
        principalId: 'principal-m5',
      });
      const durableCanary = 'M5_DURABLE_ARGUMENT_CANARY_9F31';
      const fake = fakeFactory({});
      const approved = await approvedWithFactory(fake.factory, durableCanary);

      const executed = await executeMcpDirectApprovedToolInternal(
        approved.config,
        approved.lifecycle,
        approved.proposal,
        {
          clientInfo: { name: 'furypipe-m5-test', version: '1.0.0' },
          factory: fake.factory,
          durableReplay: coordinator,
        },
      );

      expect(fake.counters().callCalls).toBe(1);
      expect(executed.receipt).toMatchObject({
        executed: true,
        succeeded: true,
        verified: true,
        durableScopeSha256: coordinator.scopeSha256,
        durableAttempt: 1,
      });
      const status = await inspectMcpDirectDurableReplayStatusInternal(
        coordinator,
        executed.receipt.replayKeySha256,
      );
      expect(status).toMatchObject({
        state: 'terminal',
        attempt: 1,
        outcome: 'succeeded',
        resultSha256: executed.receipt.resultSha256,
        succeeded: true,
      });
      const durableHandles = await store.list!({ limit: 100 });
      let durableSerialized = '';
      for (const handle of durableHandles) {
        durableSerialized += new TextDecoder().decode(await store.get(handle));
        durableSerialized += JSON.stringify(handle.metadata ?? {});
      }
      expect(durableSerialized).not.toContain(durableCanary);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps M4 replay authority mandatory for durable attempt two', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m5-executor-replay-'));
    try {
      const store = createRecoveryStore(root, { namespace: 'mcp-m5-executor' });
      const coordinator = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-m5',
        principalId: 'principal-m5',
      });
      const fake = fakeFactory({});

      const firstApproved = await approvedWithFactory(fake.factory, 'durable-replay');
      const first = await executeMcpDirectApprovedToolInternal(
        firstApproved.config,
        firstApproved.lifecycle,
        firstApproved.proposal,
        {
          clientInfo: { name: 'furypipe-m5-test', version: '1.0.0' },
          factory: fake.factory,
          durableReplay: coordinator,
          now: () => 20_000,
        },
      );

      const secondApproved = await approvedWithFactory(fake.factory, 'durable-replay');
      const replayIntent = createMcpDirectReplayIntentInternal(
        first.receipt,
        secondApproved.lifecycle,
        secondApproved.proposal,
        'repeat_closed_world_read',
        { now: 20_100, expiresInMs: 5_000 },
      );
      const second = await executeMcpDirectApprovedToolInternal(
        secondApproved.config,
        secondApproved.lifecycle,
        secondApproved.proposal,
        {
          clientInfo: { name: 'furypipe-m5-test', version: '1.0.0' },
          factory: fake.factory,
          durableReplay: coordinator,
          replayIntent,
          now: () => 20_101,
        },
      );

      expect(second.receipt).toMatchObject({
        attempt: 2,
        replayed: true,
        replayReason: 'repeat_closed_world_read',
        priorResultSha256: first.receipt.resultSha256,
        durableAttempt: 2,
      });
      await expect(inspectMcpDirectDurableReplayStatusInternal(
        coordinator,
        second.receipt.replayKeySha256,
      )).resolves.toMatchObject({
        state: 'terminal',
        attempt: 2,
        replayed: true,
        outcome: 'succeeded',
        resultSha256: second.receipt.resultSha256,
      });
      expect(fake.counters().callCalls).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists unknown durable state when callTool throws and never marks it replay-safe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m5-executor-unknown-'));
    try {
      const store = createRecoveryStore(root, { namespace: 'mcp-m5-executor' });
      const coordinator = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-m5',
        principalId: 'principal-m5',
      });
      const fake = fakeFactory({ callError: new Error('transport lost after send') });
      const approved = await approvedWithFactory(fake.factory, 'durable-unknown');

      let caught: unknown;
      try {
        await executeMcpDirectApprovedToolInternal(
          approved.config,
          approved.lifecycle,
          approved.proposal,
          {
            clientInfo: { name: 'furypipe-m5-test', version: '1.0.0' },
            factory: fake.factory,
            durableReplay: coordinator,
          },
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(McpDirectExecutionOutcomeUnknownError);
      expect(fake.counters().callCalls).toBe(1);
      const replayKeySha256 = (caught as McpDirectExecutionOutcomeUnknownError).replayKeySha256;
      await expect(inspectMcpDirectDurableReplayStatusInternal(
        coordinator,
        replayKeySha256,
      )).resolves.toMatchObject({
        state: 'terminal',
        attempt: 1,
        outcome: 'unknown',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails before callTool when durable arming cannot be committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m5-executor-arm-fail-'));
    try {
      const real = createRecoveryStore(root, { namespace: 'mcp-m5-executor' });
      let boundedWrites = 0;
      const store: RecoveryStore = {
        ...real,
        async putBounded(bytes, metadata, bound) {
          boundedWrites += 1;
          if (boundedWrites === 2) throw new Error('fixture armed persistence failure');
          return real.putBounded!(bytes, metadata, bound);
        },
      };
      const coordinator = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-m5',
        principalId: 'principal-m5',
      });
      const fake = fakeFactory({});
      const approved = await approvedWithFactory(fake.factory, 'durable-arm-fail');

      await expect(executeMcpDirectApprovedToolInternal(
        approved.config,
        approved.lifecycle,
        approved.proposal,
        {
          clientInfo: { name: 'furypipe-m5-test', version: '1.0.0' },
          factory: fake.factory,
          durableReplay: coordinator,
        },
      )).rejects.toThrow(/fixture armed persistence failure/i);

      expect(fake.counters().callCalls).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns a non-retriable durability error when terminal persistence fails after a known result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-m5-executor-terminal-fail-'));
    try {
      const real = createRecoveryStore(root, { namespace: 'mcp-m5-executor' });
      let boundedWrites = 0;
      const store: RecoveryStore = {
        ...real,
        async putBounded(bytes, metadata, bound) {
          boundedWrites += 1;
          if (boundedWrites === 3) throw new Error('fixture terminal persistence failure');
          return real.putBounded!(bytes, metadata, bound);
        },
      };
      const coordinator = createMcpDirectDurableReplayCoordinatorInternal({
        store,
        tenantId: 'tenant-m5',
        principalId: 'principal-m5',
      });
      const fake = fakeFactory({});
      const approved = await approvedWithFactory(fake.factory, 'durable-terminal-fail');

      let caught: unknown;
      try {
        await executeMcpDirectApprovedToolInternal(
          approved.config,
          approved.lifecycle,
          approved.proposal,
          {
            clientInfo: { name: 'furypipe-m5-test', version: '1.0.0' },
            factory: fake.factory,
            durableReplay: coordinator,
          },
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(McpDirectExecutionDurabilityError);
      expect(caught).toMatchObject({
        code: 'MCP_DIRECT_EXECUTION_DURABILITY_FAILED',
        retrySafe: false,
        executed: true,
        succeeded: true,
      });
      expect(fake.counters().callCalls).toBe(1);
      const replayKeySha256 = (caught as McpDirectExecutionDurabilityError).replayKeySha256;
      await expect(inspectMcpDirectDurableReplayStatusInternal(
        coordinator,
        replayKeySha256,
      )).resolves.toMatchObject({
        state: 'armed',
        attempt: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the real official v2 stdio client for one governed callTool and validates structured output', async () => {
    const fixturePath = fileURLToPath(
      new URL('./fixtures/mcp-direct-execution-stdio-server.mjs', import.meta.url),
    );
    const provisional: McpDirectRuntimeConfig = {
      source: {
        sourceId: 'real-m3-stdio-fixture',
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
      clientInfo: { name: 'furypipe-real-m3-e2e', version: '1.0.0' },
      connectTimeoutMs: 10_000,
      listTimeoutMs: 10_000,
      probeTimeoutMs: 2_000,
    });
    const selected = selectMcpDirectTool(inventory.lifecycle, 'governed-echo');
    const proposal = await createMcpDirectToolProposal(
      selected,
      inventory.catalog,
      { message: 'M3_REAL_E2E_OK' },
    );
    const policy: McpDirectPolicy = {
      format: 'furypipe-mcp-direct-policy/v1',
      policyId: 'm3-real-e2e-policy',
      governedPolicyAllowlist: [{
        sourceId: selected.source.sourceId,
        endpointFingerprint: selected.source.endpointFingerprint,
        toolName: 'governed-echo',
      }],
      operatorApprovalAllowlist: [],
    };
    const decision = evaluateMcpDirectPolicy(selected, proposal, policy);
    const approved = approveMcpDirectPolicyDecision(
      selected,
      proposal,
      decision,
      'governed_policy',
    );

    const execution = await executeMcpDirectApprovedTool(
      config,
      approved,
      proposal,
      {
        clientInfo: { name: 'furypipe-real-m3-e2e', version: '1.0.0' },
        connectTimeoutMs: 10_000,
        listTimeoutMs: 10_000,
        callTimeoutMs: 10_000,
        probeTimeoutMs: 2_000,
      },
    );

    expect(execution.result).toMatchObject({
      structuredContent: {
        echo: 'M3_REAL_E2E_OK',
        calls: 1,
      },
    });
    expect(execution.receipt).toMatchObject({
      executed: true,
      succeeded: true,
      verified: true,
      verificationKind: 'schema',
      outputSchemaSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(execution.receipt.resultSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect('lifecycle' in execution).toBe(false);
  }, 30_000);
});