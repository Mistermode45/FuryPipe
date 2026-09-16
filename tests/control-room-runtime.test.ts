import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { createControlRoomRuntime } from '../src/control-room/runtime.js';
import { createRecoveryStore } from '../src/core/recovery-store.js';
import { createProductionMcpHandler } from '../src/mcp-modern.js';
import { createGovernedProviderExecutor } from '../src/governed-provider-executor.js';
import { createGovernedProviderStreamExecutor } from '../src/governed-provider-stream-executor.js';
import { createProviderExecutionGate } from '../src/provider-execution-gate.js';
import { createProviderTransportRegistry } from '../src/provider-transport.js';
import {
  createProviderStreamTransportRegistry,
  type ProviderStreamTransport,
} from '../src/provider-stream-transport.js';
import { makePolicy, makeRequest, makeRuntime } from './helpers/provider-executor.js';

const SHA = 'a'.repeat(40);

const PROVIDER_AT = 1_000;

function streamEvents(values: readonly unknown[]): AsyncIterable<unknown> {
  return Object.freeze({
    async *[Symbol.asyncIterator](): AsyncGenerator<unknown> {
      for (const value of values) yield value;
    },
  });
}

async function makeBufferedProviderResult() {
  const request = makeRequest({ task: 'PRIVATE_BUFFERED_PROVIDER_PROMPT' });
  const providerRuntime = makeRuntime({ providerId: request.providerId });
  const gate = createProviderExecutionGate({ providerRuntime, now: () => PROVIDER_AT });
  const permit = gate.authorize(request, makePolicy(request));
  const executor = createGovernedProviderExecutor({
    transports: createProviderTransportRegistry([{
      providerId: 'openai',
      protocol: 'openai',
      execute: async (received) => ({
        providerId: 'openai',
        model: received.model,
        networkStatus: 'executed',
        providerRequestStatus: 'accepted',
        usage: { inputTokens: 7, outputTokens: 2 },
      }),
    }]),
    providerRuntime,
    now: () => PROVIDER_AT,
  });
  return executor.execute(request, permit);
}

async function makeProviderStream() {
  const request = makeRequest({ task: 'PRIVATE_STREAM_PROVIDER_PROMPT' });
  const providerRuntime = makeRuntime({ providerId: request.providerId });
  const gate = createProviderExecutionGate({ providerRuntime, now: () => PROVIDER_AT });
  const permit = gate.authorize(request, makePolicy(request));
  const transport: ProviderStreamTransport = {
    providerId: 'openai',
    protocol: 'openai',
    open: async (received) => ({
      providerId: 'openai',
      model: received.model,
      networkStatus: 'executed',
      providerRequestStatus: 'accepted',
      httpStatus: 200,
      events: streamEvents([
        {
          kind: 'text-delta',
          providerEventType: 'response.output_text.delta',
          text: 'PRIVATE_STREAM_OUTPUT_TEXT',
        },
        {
          kind: 'usage',
          providerEventType: 'response.usage',
          usage: { inputTokens: 5, cacheReadTokens: 2 },
        },
        {
          kind: 'terminal',
          providerEventType: 'response.completed',
          terminalStatus: 'completed',
          usage: { outputTokens: 3 },
        },
      ]),
    }),
  };
  const executor = createGovernedProviderStreamExecutor({
    transports: createProviderStreamTransportRegistry([transport]),
    providerRuntime,
    now: () => PROVIDER_AT,
  });
  return executor.open(request, permit);
}

function receipt(
  verificationStatus: 'verified' | 'unverified',
  confidence: 'unknown' | 'estimated' | 'verified',
  recoveryHandles: string[] = [],
  protectedSpanCount = 0,
) {
  return {
    format: 'furypipe-compression-receipt/v1',
    strategy: 'pxpipe-transform',
    originalHash: 'b'.repeat(64),
    transformedHash: 'c'.repeat(64),
    originalBytes: 100,
    transformedBytes: 50,
    protectedSpans: Array.from({ length: protectedSpanCount }, () => ({})),
    recoveryHandles,
    tokenCost: { confidence },
    confidence,
    verificationStatus,
  };
}

describe('Control Room live runtime collector', () => {
  it('collects plaintext-free receipt evidence from real proxy-event shape', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 1234 });

    runtime.observeProxyEvent({ info: { receipt: receipt('verified', 'verified', ['furypipe-recovery/v1/sha256/' + 'd'.repeat(64)], 2) } as never });
    runtime.observeProxyEvent({ info: { receipt: receipt('unverified', 'estimated', ['furypipe-recovery/v1/sha256/' + 'd'.repeat(64)], 1) } as never });
    runtime.observeProxyEvent({ info: undefined });

    const snapshot = runtime.snapshot();
    expect(snapshot.generatedAt).toBe(1234);
    expect(snapshot.sourceCommit).toBe(SHA);
    expect(snapshot.sections.receipts.evidence).toEqual({
      receipts: 2,
      verifiedReceipts: 1,
      protectedSpans: 3,
      recoveryHandles: 2,
      confidence: 'estimated',
    });
    expect(snapshot.sections.receipts.status).toBe('PARTIAL');
    expect(snapshot.sections.recovery.evidence.objects).toBe(1);
    expect(snapshot.sections.recovery.evidence.encryption).toBe('unknown');
    expect(snapshot.sections.recovery.warnings).toContain(
      'Recovery encryption state is not observed by this runtime provider.',
    );
  });

  it('keeps unobserved subsystems unavailable instead of inventing green evidence', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 1 });
    const snapshot = runtime.snapshot();

    expect(snapshot.sections.agent.evidence.runs).toBe(0);
    expect(snapshot.sections.agent.evidence.persistedMemory).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.mcp.evidence.externalConformance).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.security.evidence.codeql).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.benchmarks.evidence.providerRuns).toBe('NOT_AVAILABLE');
    expect(snapshot.sections.release.evidence.technicalStatus).toBe('NOT_AVAILABLE');
    expect(snapshot.overall).not.toBe('HEALTHY');
  });

  it('derives fail-visible MCP HTTP evidence from an exact process-local production handler', async () => {
    const handler = createProductionMcpHandler(createRecoveryStore('unused-control-room-mcp'), {
      allowedHostnames: ['localhost'],
      allowUnauthenticatedLoopback: true,
    });
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 2 });
    runtime.observeMcpHttpHandler(handler);
    runtime.observeMcpHttpHandler(handler);

    expect(runtime.snapshot().sections.mcp.evidence).toEqual({
      stdio: 'NOT_AVAILABLE',
      http: 'NOT_EXECUTED',
      bearerAuth: 'NOT_EXECUTED',
      oauth: 'NOT_EXECUTED',
      externalConformance: 'NOT_AVAILABLE',
    });

    const rejected = await handler.fetch(new Request('https://localhost/mcp', {
      method: 'POST',
      headers: {
        host: 'attacker.test',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: '{}',
    }));
    expect(rejected.status).toBe(403);
    expect(runtime.snapshot().sections.mcp.evidence.http).toBe('PARTIAL');

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    });
    const accepted = await handler.fetch(new Request('https://localhost/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body,
    }));
    expect(accepted.status).toBe(200);

    const evidence = runtime.snapshot().sections.mcp;
    expect(evidence.evidence).toEqual({
      stdio: 'NOT_AVAILABLE',
      http: 'VERIFIED',
      bearerAuth: 'NOT_EXECUTED',
      oauth: 'NOT_EXECUTED',
      externalConformance: 'NOT_AVAILABLE',
    });
    expect(evidence.status).toBe('PARTIAL');
    await handler.close();
  });

  it('verifies local Bearer execution without promoting OAuth or external conformance', async () => {
    const verifier: OAuthTokenVerifier = {
      async verifyAccessToken(token): Promise<AuthInfo> {
        if (token !== 'CONTROL_ROOM_PRIVATE_TOKEN') {
          throw new OAuthError(OAuthErrorCode.InvalidToken, 'invalid token');
        }
        return {
          token,
          clientId: 'control-room-test-client',
          scopes: ['mcp'],
          expiresAt: Math.floor(Date.now() / 1000) + 60,
        };
      },
    };
    const handler = createProductionMcpHandler(createRecoveryStore('unused-control-room-mcp-auth'), {
      allowedHostnames: ['localhost'],
      bearerAuth: {
        verifier,
        requiredScopes: ['mcp'],
        resourceMetadataUrl: 'https://localhost/.well-known/oauth-protected-resource/mcp',
      },
    });
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 2 });
    runtime.observeMcpHttpHandler(handler);

    expect(runtime.snapshot().sections.mcp.evidence).toMatchObject({
      http: 'NOT_EXECUTED',
      bearerAuth: 'PARTIAL',
      oauth: 'PARTIAL',
      externalConformance: 'NOT_AVAILABLE',
    });

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    });
    const request = new Request('https://localhost/mcp', {
      method: 'POST',
      headers: {
        host: 'localhost',
        authorization: 'Bearer CONTROL_ROOM_PRIVATE_TOKEN',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list',
      },
      body,
    });
    expect((await handler.fetch(request)).status).toBe(200);

    const snapshot = runtime.snapshot();
    expect(snapshot.sections.mcp.evidence).toEqual({
      stdio: 'NOT_AVAILABLE',
      http: 'VERIFIED',
      bearerAuth: 'VERIFIED',
      oauth: 'PARTIAL',
      externalConformance: 'NOT_AVAILABLE',
    });
    expect(snapshot.sections.mcp.status).toBe('PARTIAL');
    expect(snapshot.sections.mcp.warnings.join(' ')).toMatch(/Authorization Server conformance is proven/i);
    expect(snapshot.sections.mcp.warnings.join(' ')).toMatch(/external client\/network conformance is not verified/i);
    expect(JSON.stringify(snapshot)).not.toContain('CONTROL_ROOM_PRIVATE_TOKEN');
    expect(JSON.stringify(snapshot)).not.toContain('control-room-test-client');
    await handler.close();
  });

  it('rejects copied MCP handlers and forged stdio handles instead of promoting runtime evidence', async () => {
    const handler = createProductionMcpHandler(createRecoveryStore('unused-control-room-mcp-copy'), {
      allowedHostnames: ['localhost'],
      allowUnauthenticatedLoopback: true,
    });
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 2 });

    expect(() => runtime.observeMcpHttpHandler({ ...handler } as never)).toThrow(/process-local/i);
    expect(() => runtime.observeMcpStdioHandle({ close() {} })).toThrow(/process-local/i);
    expect(runtime.snapshot().sections.mcp.evidence.externalConformance).toBe('NOT_AVAILABLE');
    await handler.close();
  });

  it('accepts explicit host evidence overrides without mutating them', () => {
    const mcp = {
      stdio: 'VERIFIED',
      http: 'VERIFIED',
      bearerAuth: 'VERIFIED',
      oauth: 'PARTIAL',
      externalConformance: 'NOT_EXECUTED',
    } as const;
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, mcp, now: () => 2 });
    const snapshot = runtime.snapshot();

    expect(snapshot.sections.mcp.evidence).toEqual(mcp);
    expect(snapshot.sections.mcp.status).toBe('PARTIAL');
    expect(mcp.oauth).toBe('PARTIAL');
  });

  it('rejects unpinned build identity and invalid clocks', () => {
    expect(() => createControlRoomRuntime({ sourceCommit: 'latest' })).toThrow(/40-character commit SHA/);

    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => -1 });
    expect(() => runtime.snapshot()).toThrow(/clock/);
  });

  it('does not retain request body or model text in snapshots', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 3 });
    runtime.observeProxyEvent({
      info: {
        receipt: receipt('verified', 'unknown'),
        imageSourceText: 'TOP-SECRET-REQUEST-BODY',
      } as never,
    });

    expect(JSON.stringify(runtime.snapshot())).not.toContain('TOP-SECRET-REQUEST-BODY');
  });
  it('tracks the latest state of each Agent run without double-counting handoff resumes', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 4 });
    runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'handoff_required',
      runId: 'run-1',
      objectiveDigest: 'afrun_digest',
      completedStages: ['research'],
      contextUsedTokens: 10,
      skillHealth: {},
    });
    runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'completed',
      runId: 'run-1',
      objectiveDigest: 'afrun_digest',
      completedStages: ['research', 'plan', 'implement', 'review', 'verify'],
      contextUsedTokens: 50,
      skillHealth: {},
    });
    runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'failed',
      runId: 'run-2',
      objectiveDigest: 'afrun_other',
      completedStages: ['research'],
      contextUsedTokens: 7,
      skillHealth: {},
      failure: { code: 'STAGE_FAILED', stage: 'plan', reason: 'opaque failure' },
    });

    const agent = runtime.snapshot().sections.agent;
    expect(agent.evidence).toMatchObject({
      runs: 2,
      completedRuns: 1,
      handoffRuns: 0,
      failedRuns: 1,
      contextUsedTokens: 57,
      persistedMemory: 'NOT_AVAILABLE',
      distributedHandoff: 'NOT_AVAILABLE',
      skillExecutions: 0,
      mcpExecutions: 0,
      subagentExecutions: 0,
      automaticCapabilityExecutions: 0,
      manualCapabilityExecutions: 0,
      recentCapabilityExecutions: [],
    });
    expect(agent.status).toBe('PARTIAL');
  });

  it('exposes only successful capability execution metadata from Agent receipts', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 4 });
    runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'completed',
      runId: 'run-capabilities',
      objectiveDigest: 'PRIVATE_OBJECTIVE_DIGEST',
      completedStages: ['research'],
      contextUsedTokens: 12,
      skillHealth: { 'secret-skill': 'healthy' },
      capabilityExecutions: [
        {
          format: 'furypipe-agent-capability-execution/v1',
          kind: 'skill',
          id: 'repo-reader',
          stage: 'research',
          invocation: 'automatic',
          status: 'executed',
          consumedTokens: 2,
          evidenceDigest: 'PRIVATE_EVIDENCE_DIGEST',
        },
        {
          format: 'furypipe-agent-capability-execution/v1',
          kind: 'mcp',
          id: 'github',
          stage: 'research',
          invocation: 'manual',
          status: 'executed',
          method: 'search',
          paramsDigest: 'PRIVATE_PARAMS_DIGEST',
        },
      ],
    });

    const agent = runtime.snapshot().sections.agent.evidence;
    expect(agent.skillExecutions).toBe(1);
    expect(agent.mcpExecutions).toBe(1);
    expect(agent.subagentExecutions).toBe(0);
    expect(agent.automaticCapabilityExecutions).toBe(1);
    expect(agent.manualCapabilityExecutions).toBe(1);
    expect(agent.recentCapabilityExecutions).toEqual([
      { kind: 'skill', id: 'repo-reader', stage: 'research', invocation: 'automatic' },
      { kind: 'mcp', id: 'github', stage: 'research', invocation: 'manual' },
    ]);

    const serialized = JSON.stringify(runtime.snapshot());
    expect(serialized).not.toContain('PRIVATE_EVIDENCE_DIGEST');
    expect(serialized).not.toContain('PRIVATE_PARAMS_DIGEST');
    expect(serialized).not.toContain('PRIVATE_OBJECTIVE_DIGEST');
  });

  it('rejects forged Agent capability receipts before promoting execution evidence', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 4 });
    expect(() => runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'completed',
      runId: 'run-forged-capability',
      objectiveDigest: 'digest',
      completedStages: [],
      contextUsedTokens: 0,
      skillHealth: {},
      capabilityExecutions: [{
        format: 'furypipe-agent-capability-execution/v1',
        kind: 'skill',
        id: '',
        stage: 'research',
        invocation: 'automatic',
        status: 'executed',
      }],
    })).toThrow(/capability execution receipt/i);
    expect(runtime.snapshot().sections.agent.evidence.runs).toBe(0);
  });

  it('tracks completed Learning cycles and unique lesson reuse without retaining lesson metadata', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 5 });
    const reused = (id: string) => ({
      format: 'furypipe-agent-lesson/v1' as const,
      lessonId: id,
      memoryClass: 'Semantic' as const,
      taskDigest: 'task_digest',
      lessonDigest: `digest_${id}`,
      contentHandle: `opaque://PRIVATE-${id}`,
      evidenceDigests: ['evidence_digest'],
      validation: 'validated' as const,
      reuseCount: 1,
    });
    runtime.observeLearningCycle({
      format: 'furypipe-agent-learning-cycle/v1',
      status: 'completed',
      cycleId: 'cycle-1',
      taskDigest: 'task_digest',
      memoryClass: 'Semantic',
      phaseOrder: ['plan', 'execute', 'verify', 'reflect', 'extract_lesson', 'validate', 'store', 'reuse'],
      phases: [],
      contextUsedTokens: 12,
      lessonId: 'new-lesson',
      reusedLessons: [reused('old-a'), reused('old-b'), reused('old-a')],
    });
    runtime.observeLearningCycle({
      format: 'furypipe-agent-learning-cycle/v1',
      status: 'completed',
      cycleId: 'cycle-1',
      taskDigest: 'task_digest',
      memoryClass: 'Semantic',
      phaseOrder: ['plan', 'execute', 'verify', 'reflect', 'extract_lesson', 'validate', 'store', 'reuse'],
      phases: [],
      contextUsedTokens: 13,
      lessonId: 'new-lesson',
      reusedLessons: [reused('old-a')],
    });

    const snapshot = runtime.snapshot();
    expect(snapshot.sections.learning.evidence).toEqual({
      humanTopics: 0,
      agentLessons: 1,
      reusedLessons: 1,
      durableStore: 'NOT_AVAILABLE',
      semanticRetrieval: 'NOT_AVAILABLE',
    });
    expect(snapshot.sections.learning.status).toBe('PARTIAL');
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE-');
    expect(JSON.stringify(snapshot)).not.toContain('new-lesson');
    expect(JSON.stringify(snapshot)).not.toContain('old-a');
  });

  it('collects authentic buffered and streaming provider metadata without retaining prompt or output plaintext', async () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 7 });
    const buffered = await makeBufferedProviderResult();
    runtime.observeProviderExecution(buffered);
    runtime.observeProviderExecution(buffered);

    const session = await makeProviderStream();
    const observation = runtime.observeProviderStreamSession(session);
    expect(runtime.observeProviderStreamSession(session)).toBeDefined();

    const openSnapshot = runtime.snapshot();
    expect(openSnapshot.sections.provider.evidence).toMatchObject({
      bufferedExecutions: 1,
      streamSessions: 1,
      acceptedRequests: 2,
      streamOpenAccepted: 1,
      runtimeObservability: 'VERIFIED',
      providerVerification: 'NOT_AVAILABLE',
    });
    expect(openSnapshot.sections.provider.status).toBe('PARTIAL');

    for await (const event of session.events) {
      observation.observeEvent(event);
      observation.observeEvent(event);
    }

    const snapshot = runtime.snapshot();
    expect(snapshot.sections.provider.evidence).toMatchObject({
      bufferedExecutions: 1,
      streamSessions: 1,
      acceptedRequests: 2,
      rejectedRequests: 0,
      unknownRequests: 0,
      streamCompleted: 1,
      streamOpenAccepted: 0,
      usageReports: 3,
      inputTokens: 12,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
      knownCostObservations: 0,
      unknownCostObservations: 2,
      runtimeObservability: 'VERIFIED',
      providerVerification: 'NOT_AVAILABLE',
    });
    expect(snapshot.sections.provider.status).toBe('PARTIAL');
    expect(snapshot.sections.provider.warnings.join(' ')).toMatch(/independently unverified/i);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('PRIVATE_BUFFERED_PROVIDER_PROMPT');
    expect(serialized).not.toContain('PRIVATE_STREAM_PROVIDER_PROMPT');
    expect(serialized).not.toContain('PRIVATE_STREAM_OUTPUT_TEXT');
  });

  it('rejects forged provider results, sessions and stream events instead of promoting copied evidence', async () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 8 });
    const buffered = await makeBufferedProviderResult();

    expect(() => runtime.observeProviderExecution({ ...buffered } as never)).toThrow(/process-local/i);

    const session = await makeProviderStream();
    expect(() => runtime.observeProviderStreamSession({ ...session } as never)).toThrow(/process-local/i);

    const observation = runtime.observeProviderStreamSession(session);
    const events = [];
    for await (const event of session.events) events.push(event);
    expect(events.length).toBe(3);

    expect(() => observation.observeEvent({ ...events[0] } as never)).toThrow(/process-local/i);

    const otherSession = await makeProviderStream();
    const otherEvents = [];
    for await (const event of otherSession.events) otherEvents.push(event);
    expect(otherSession.requestDigest).toBe(session.requestDigest);
    expect(() => observation.observeEvent(otherEvents[0]!)).toThrow(/exact bound session/i);

    expect(() => observation.observeEvent(events[1]!)).toThrow(/exact sequence/i);

    observation.observeEvent(events[0]!);
    observation.observeEvent(events[1]!);
    observation.observeEvent(events[2]!);
    expect(runtime.snapshot().sections.provider.evidence.streamCompleted).toBe(1);
  });

  it('rejects malformed Agent/Learning observations before they can poison Control Room counters', () => {
    const runtime = createControlRoomRuntime({ sourceCommit: SHA, now: () => 6 });
    expect(() => runtime.observeAgentRun({
      format: 'furypipe-agent-run/v1',
      status: 'completed',
      runId: '',
      objectiveDigest: 'digest',
      completedStages: [],
      contextUsedTokens: 0,
      skillHealth: {},
    })).toThrow(/runId/);

    expect(() => runtime.observeLearningCycle({
      format: 'furypipe-agent-learning-cycle/v1',
      status: 'completed',
      cycleId: 'cycle',
      taskDigest: 'task',
      memoryClass: 'Semantic',
      phaseOrder: [],
      phases: [],
      contextUsedTokens: 0,
      reusedLessons: Array.from({ length: 10_001 }, (_, index) => ({
        format: 'furypipe-agent-lesson/v1' as const,
        lessonId: `lesson-${index}`,
        memoryClass: 'Semantic' as const,
        taskDigest: 'task',
        lessonDigest: 'digest',
        contentHandle: 'opaque://x',
        evidenceDigests: [],
        validation: 'validated' as const,
        reuseCount: 0,
      })),
    })).toThrow(/reusedLessons/);
  });

});
