import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  deriveMcpDirectEndpointFingerprint,
  probeMcpDirectInventory,
  type McpDirectRuntimeConfig,
} from '../src/mcp-direct-client-node.js';
import {
  type McpDirectSdkFactory,
} from '../src/mcp-direct-client-node-internal.js';
import {
  executeMcpDirectApprovedTool,
} from '../src/mcp-direct-executor-node.js';
import {
  executeMcpDirectApprovedToolInternal,
  McpDirectExecutionOutcomeUnknownError,
} from '../src/mcp-direct-executor-node-internal.js';
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
  readonly result?: unknown;
  readonly callError?: Error;
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
        getProtocolEra: () => 'modern' as const,
        getNegotiatedProtocolVersion: () => '2026-07-28',
        async close() {
          closeCalls += 1;
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
  const inventory = await probeMcpDirectInventory(config, {
    clientInfo: { name: 'furypipe-m3-test', version: '1.0.0' },
    factory,
  } as never);
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

  it('turns a thrown call into non-retriable unknown execution outcome and blocks replay', async () => {
    const fake = fakeFactory({ callError: new Error('transport dropped') });
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
    expect(execution.lifecycle).toMatchObject({
      executed: true,
      succeeded: true,
      verified: true,
    });
    expect(execution.receipt.resultSha256).toMatch(/^[0-9a-f]{64}$/u);
  }, 30_000);
});
