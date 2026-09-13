import type { ProxyEvent } from '../core/proxy.js';
import type { AgentRunResult } from '../agent-runtime.js';
import type { AgentLearningCycleResult } from '../learning.js';
import type { ReleaseReadinessReport } from '../release-readiness/index.js';
import {
  getProductionMcpRuntimeEvidence,
  getProductionMcpStdioRuntimeEvidence,
  isGeneratedModernMcpStdioHandle,
  type ProductionMcpHttpHandler,
} from '../mcp-modern.js';
import {
  isGeneratedGovernedProviderExecutionResult,
  type GovernedProviderExecutionResult,
} from '../governed-provider-executor.js';
import {
  isGeneratedGovernedProviderStreamEvent,
  isGeneratedGovernedProviderStreamEventForSession,
  isGeneratedGovernedProviderStreamSession,
  type GovernedProviderStreamEvent,
  type GovernedProviderStreamSession,
} from '../governed-provider-stream-executor.js';
import {
  createControlRoomSnapshot,
  type AgentEvidence,
  type BenchmarkEvidence,
  type ControlRoomSnapshot,
  type I18nEvidence,
  type LearningEvidence,
  type McpEvidence,
  type ProviderEvidence,
  type RecoveryEvidence,
  type SecurityEvidence,
  type WebStudioEvidence,
} from './index.js';

export interface ControlRoomRuntimeOptions {
  readonly sourceCommit: string;
  readonly recovery?: RecoveryEvidence;
  readonly agent?: AgentEvidence;
  readonly learning?: LearningEvidence;
  readonly mcp?: McpEvidence;
  readonly i18n?: I18nEvidence;
  readonly webStudio?: WebStudioEvidence;
  readonly security?: SecurityEvidence;
  readonly benchmarks?: BenchmarkEvidence;
  readonly releaseReadiness?: ReleaseReadinessReport;
  readonly now?: () => number;
}

export interface ControlRoomProviderStreamObservation {
  /**
   * Feed the exact governed events yielded by this session, in sequence.
   * Plaintext text deltas are validated for provenance but never retained.
   */
  observeEvent(event: GovernedProviderStreamEvent): void;
}

export interface ControlRoomRuntime {
  observeProxyEvent(event: Pick<ProxyEvent, 'info'>): void;
  /** Observe the latest state for one opaque Agent run ID. Re-observation replaces that run's prior state. */
  observeAgentRun(result: AgentRunResult): void;
  /** Observe the latest state for one opaque Learning cycle ID. Re-observation replaces that cycle's prior state. */
  observeLearningCycle(result: AgentLearningCycleResult): void;
  /**
   * Observe one exact production MCP HTTP handler. Snapshot reads its latest
   * metadata-only process-local counters; copied handlers are rejected.
   */
  observeMcpHttpHandler(handler: ProductionMcpHttpHandler): void;
  /**
   * Observe one exact stdio handle created by runModernMcpStdio().
   * Starting the handle proves local construction only, not a client exchange.
   */
  observeMcpStdioHandle(handle: unknown): void;
  /** Observe one authentic buffered governed-provider execution exactly once. */
  observeProviderExecution(result: GovernedProviderExecutionResult): void;
  /**
   * Bind Control Room observation to one exact process-local stream session.
   * Re-observing the same session returns the same logical observation and does not double-count it.
   */
  observeProviderStreamSession(session: GovernedProviderStreamSession): ControlRoomProviderStreamObservation;
  snapshot(): ControlRoomSnapshot;
}

const SHA40 = /^[0-9a-f]{40}$/u;

const NOT_AVAILABLE_RECOVERY: RecoveryEvidence = Object.freeze({
  objects: 0,
  verifiedObjects: 0,
  encryption: 'unknown',
  backupEvidence: 'NOT_CHECKED',
  crashRecovery: 'NOT_AVAILABLE',
  multiProcess: 'NOT_AVAILABLE',
});

const NOT_AVAILABLE_AGENT: AgentEvidence = Object.freeze({
  runs: 0,
  completedRuns: 0,
  handoffRuns: 0,
  failedRuns: 0,
  contextUsedTokens: 0,
  persistedMemory: 'NOT_AVAILABLE',
  distributedHandoff: 'NOT_AVAILABLE',
});

const NOT_AVAILABLE_LEARNING: LearningEvidence = Object.freeze({
  humanTopics: 0,
  agentLessons: 0,
  reusedLessons: 0,
  durableStore: 'NOT_AVAILABLE',
  semanticRetrieval: 'NOT_AVAILABLE',
});

const NOT_AVAILABLE_I18N: I18nEvidence = Object.freeze({
  locale: 'en',
  direction: 'ltr',
  runtimeKernel: 'NOT_AVAILABLE',
  cliWiring: 'NOT_AVAILABLE',
  dashboardWiring: 'NOT_AVAILABLE',
});

const NOT_AVAILABLE_WEB_STUDIO: WebStudioEvidence = Object.freeze({
  kernel: 'NOT_AVAILABLE',
  figma: 'NOT_AVAILABLE',
  playwright: 'NOT_AVAILABLE',
  accessibility: 'NOT_AVAILABLE',
  security: 'NOT_AVAILABLE',
  seo: 'NOT_AVAILABLE',
  deployment: 'NOT_AVAILABLE',
});

const NOT_AVAILABLE_SECURITY: SecurityEvidence = Object.freeze({
  codeql: 'NOT_AVAILABLE',
  secretScan: 'NOT_AVAILABLE',
  dependencyAudit: 'NOT_AVAILABLE',
  sbom: 'NOT_AVAILABLE',
  actionPinning: 'NOT_AVAILABLE',
  licenseCompliance: 'NOT_AVAILABLE',
  dependencyReview: 'NOT_AVAILABLE',
});

const NOT_AVAILABLE_BENCHMARKS: BenchmarkEvidence = Object.freeze({
  harness: 'NOT_AVAILABLE',
  providerRuns: 'NOT_AVAILABLE',
  comparableRuns: 0,
});

type ProviderRequestStatus = GovernedProviderExecutionResult['providerRequest']['status'];
type ProviderUsage = NonNullable<GovernedProviderExecutionResult['usage']>;

interface ProviderUsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

type MutableProviderEvidence = {
  -readonly [K in keyof ProviderEvidence]: ProviderEvidence[K];
};

interface BufferedProviderObservation {
  readonly providerStatus: ProviderRequestStatus;
  readonly usage?: Readonly<ProviderUsageSummary>;
  readonly cost: 'known' | 'unknown';
}

interface StreamProviderObservationState {
  readonly providerId: string;
  readonly model: string;
  readonly workloadId: string;
  readonly requestDigest: string;
  readonly providerStatus: GovernedProviderStreamSession['providerRequest']['status'];
  nextSequence: number;
  terminal:
    | undefined
    | { readonly kind: 'terminal'; readonly status: NonNullable<GovernedProviderStreamEvent['terminalStatus']> }
    | { readonly kind: 'provider-error' };
  usageReports: number;
  readonly usage: ProviderUsageSummary;
  cost?: 'known' | 'unknown';
  readonly seenEvents: WeakSet<object>;
}

const MAX_PROVIDER_OBSERVATIONS = 100_000;

function snapshotProviderUsage(value: ProviderUsage | undefined): Readonly<ProviderUsageSummary> | undefined {
  if (value === undefined) return undefined;
  const output: ProviderUsageSummary = {};
  for (const key of ['inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens'] as const) {
    const count = value[key];
    if (count === undefined) continue;
    safeRuntimeCount(count, `Provider usage ${key}`);
    output[key] = count;
  }
  return Object.keys(output).length === 0 ? undefined : Object.freeze(output);
}

function mergeProviderUsage(target: ProviderUsageSummary, value: ProviderUsage | undefined): void {
  const snapshot = snapshotProviderUsage(value);
  if (snapshot === undefined) return;
  if (snapshot.inputTokens !== undefined) target.inputTokens = snapshot.inputTokens;
  if (snapshot.outputTokens !== undefined) target.outputTokens = snapshot.outputTokens;
  if (snapshot.cacheWriteTokens !== undefined) target.cacheWriteTokens = snapshot.cacheWriteTokens;
  if (snapshot.cacheReadTokens !== undefined) target.cacheReadTokens = snapshot.cacheReadTokens;
}

function providerCostState(value: GovernedProviderExecutionResult['cost'] | GovernedProviderStreamEvent['cost']): 'known' | 'unknown' {
  if (!value || typeof value !== 'object') throw new Error('Control Room provider cost observation is invalid');
  if (value.status === 'known') return 'known';
  if (value.status === 'COST_UNKNOWN') return 'unknown';
  throw new Error('Control Room provider cost observation status is invalid');
}

function providerEvidenceFromObservations(
  buffered: readonly BufferedProviderObservation[],
  streams: readonly StreamProviderObservationState[],
): ProviderEvidence {
  const evidence: MutableProviderEvidence = {
    bufferedExecutions: buffered.length,
    streamSessions: streams.length,
    acceptedRequests: 0,
    rejectedRequests: 0,
    unknownRequests: 0,
    streamCompleted: 0,
    streamIncomplete: 0,
    streamFailed: 0,
    streamCancelled: 0,
    streamRequiresAction: 0,
    streamTerminalUnknown: 0,
    streamProviderErrors: 0,
    streamOpenAccepted: 0,
    usageReports: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    knownCostObservations: 0,
    unknownCostObservations: 0,
    runtimeObservability: buffered.length + streams.length > 0 ? 'VERIFIED' : 'NOT_EXECUTED',
    providerVerification: 'NOT_AVAILABLE',
  };

  const observeStatus = (status: ProviderRequestStatus) => {
    if (status === 'accepted') evidence.acceptedRequests += 1;
    else if (status === 'rejected') evidence.rejectedRequests += 1;
    else evidence.unknownRequests += 1;
  };
  const addUsage = (usage: Readonly<ProviderUsageSummary> | undefined) => {
    if (usage === undefined) return;
    if (usage.inputTokens !== undefined) evidence.inputTokens += usage.inputTokens;
    if (usage.outputTokens !== undefined) evidence.outputTokens += usage.outputTokens;
    if (usage.cacheWriteTokens !== undefined) evidence.cacheWriteTokens += usage.cacheWriteTokens;
    if (usage.cacheReadTokens !== undefined) evidence.cacheReadTokens += usage.cacheReadTokens;
  };
  const addCost = (cost: 'known' | 'unknown' | undefined) => {
    if (cost === 'known') evidence.knownCostObservations += 1;
    if (cost === 'unknown') evidence.unknownCostObservations += 1;
  };

  for (const observation of buffered) {
    observeStatus(observation.providerStatus);
    if (observation.usage !== undefined) evidence.usageReports += 1;
    addUsage(observation.usage);
    addCost(observation.cost);
  }

  for (const stream of streams) {
    observeStatus(stream.providerStatus);
    evidence.usageReports += stream.usageReports;
    addUsage(stream.usage);
    addCost(stream.cost);
    if (stream.terminal?.kind === 'provider-error') {
      evidence.streamProviderErrors += 1;
    } else if (stream.terminal?.kind === 'terminal') {
      switch (stream.terminal.status) {
        case 'completed': evidence.streamCompleted += 1; break;
        case 'incomplete': evidence.streamIncomplete += 1; break;
        case 'failed': evidence.streamFailed += 1; break;
        case 'cancelled': evidence.streamCancelled += 1; break;
        case 'requires-action': evidence.streamRequiresAction += 1; break;
        case 'unknown': evidence.streamTerminalUnknown += 1; break;
      }
    } else if (stream.providerStatus === 'accepted') {
      evidence.streamOpenAccepted += 1;
    }
  }

  for (const [label, count] of Object.entries({
    inputTokens: evidence.inputTokens,
    outputTokens: evidence.outputTokens,
    cacheWriteTokens: evidence.cacheWriteTokens,
    cacheReadTokens: evidence.cacheReadTokens,
  })) safeRuntimeCount(count, `Control Room provider ${label}`);

  return Object.freeze(evidence);
}

function mcpEvidenceFromObservations(
  httpHandlers: readonly ProductionMcpHttpHandler[],
  stdioHandles: readonly object[],
): McpEvidence {
  let sawRequest = false;
  let sawDispatch = false;
  let bearerConfigured = false;
  let sawBearerSuccess = false;
  let oauthConfigured = false;
  let sawOauthResponse = false;

  for (const handler of httpHandlers) {
    const evidence = getProductionMcpRuntimeEvidence(handler);
    if (evidence === undefined) {
      throw new Error('Control Room MCP HTTP handler lost process-local FuryPipe provenance');
    }
    sawRequest ||= evidence.requests > 0;
    sawDispatch ||= evidence.dispatchedRequests > 0;
    bearerConfigured ||= evidence.bearerAuthConfigured;
    sawBearerSuccess ||= evidence.bearerAuthSuccesses > 0;
    oauthConfigured ||= evidence.oauthMetadataConfigured;
    sawOauthResponse ||= evidence.oauthMetadataResponses > 0;
  }

  const http: McpEvidence['http'] = httpHandlers.length === 0
    ? 'NOT_AVAILABLE'
    : sawDispatch
      ? 'VERIFIED'
      : sawRequest
        ? 'PARTIAL'
        : 'NOT_EXECUTED';

  const bearerAuth: McpEvidence['bearerAuth'] = httpHandlers.length === 0
    ? 'NOT_AVAILABLE'
    : sawBearerSuccess
      ? 'VERIFIED'
      : bearerConfigured
        ? 'PARTIAL'
        : 'NOT_EXECUTED';

  const oauth: McpEvidence['oauth'] = httpHandlers.length === 0
    ? 'NOT_AVAILABLE'
    : oauthConfigured || bearerConfigured || sawOauthResponse || sawBearerSuccess
      ? 'PARTIAL'
      : 'NOT_EXECUTED';

  let stdioExchanges = 0;
  for (const handle of stdioHandles) {
    const evidence = getProductionMcpStdioRuntimeEvidence(handle);
    if (evidence === undefined) {
      throw new Error('Control Room MCP stdio handle lost process-local FuryPipe provenance');
    }
    safeRuntimeCount(evidence.inboundMessages, 'Control Room MCP stdio inboundMessages');
    safeRuntimeCount(evidence.inboundRequests, 'Control Room MCP stdio inboundRequests');
    safeRuntimeCount(evidence.outboundMessages, 'Control Room MCP stdio outboundMessages');
    safeRuntimeCount(evidence.completedExchanges, 'Control Room MCP stdio completedExchanges');
    safeRuntimeCount(evidence.trackingOverflows, 'Control Room MCP stdio trackingOverflows');
    stdioExchanges += evidence.completedExchanges;
    safeRuntimeCount(stdioExchanges, 'Control Room MCP stdio total completedExchanges');
  }

  const stdio: McpEvidence['stdio'] = stdioHandles.length === 0
    ? 'NOT_AVAILABLE'
    : stdioExchanges > 0
      ? 'VERIFIED'
      : 'PARTIAL';

  return Object.freeze({
    stdio,
    http,
    bearerAuth,
    oauth,
    externalConformance: 'NOT_AVAILABLE',
  });
}

function clone<T extends object>(value: T): T {
  return { ...value };
}

function boundedOpaqueId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || value.includes('\0')) {
    throw new Error(`${label} must be a bounded opaque identifier`);
  }
}

function safeRuntimeCount(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10_000_000_000) {
    throw new Error(`${label} must be a bounded non-negative safe integer`);
  }
}

function observeStreamEvent(
  session: GovernedProviderStreamSession,
  state: StreamProviderObservationState,
  event: GovernedProviderStreamEvent,
): void {
  if (!isGeneratedGovernedProviderStreamEvent(event)) {
    throw new Error('Control Room provider stream event requires a process-local FuryPipe event');
  }
  if (!isGeneratedGovernedProviderStreamEventForSession(session, event)) {
    throw new Error('Control Room provider stream event does not belong to the exact bound session');
  }
  if (
    event.providerId !== state.providerId
    || event.model !== state.model
    || event.workloadId !== state.workloadId
    || event.requestDigest !== state.requestDigest
  ) {
    throw new Error('Control Room provider stream event does not match the bound session');
  }
  if (state.seenEvents.has(event)) return;
  if (state.providerStatus !== 'accepted') {
    throw new Error('Control Room cannot attach stream events to a non-accepted provider session');
  }
  if (state.terminal !== undefined) {
    throw new Error('Control Room provider stream observation already reached a terminal event');
  }
  if (event.sequence !== state.nextSequence) {
    throw new Error('Control Room provider stream events must be observed in exact sequence');
  }

  state.seenEvents.add(event);
  state.nextSequence += 1;
  if (event.usage !== undefined) {
    state.usageReports += 1;
    mergeProviderUsage(state.usage, event.usage);
  }
  if (event.kind === 'provider-error') {
    state.terminal = Object.freeze({ kind: 'provider-error' as const });
    state.cost = providerCostState(event.cost);
  } else if (event.kind === 'terminal') {
    if (event.terminalStatus === undefined) {
      throw new Error('Control Room provider terminal event is missing terminal status');
    }
    state.terminal = Object.freeze({ kind: 'terminal' as const, status: event.terminalStatus });
    state.cost = providerCostState(event.cost);
  }
}

export function createControlRoomRuntime(options: ControlRoomRuntimeOptions): ControlRoomRuntime {
  if (!SHA40.test(options.sourceCommit)) {
    throw new Error('Control Room runtime sourceCommit must be a lowercase 40-character commit SHA');
  }

  const now = options.now ?? Date.now;
  let receipts = 0;
  let verifiedReceipts = 0;
  let protectedSpans = 0;
  let recoveryHandles = 0;
  let sawEstimatedConfidence = false;
  let sawUnknownConfidence = false;
  const uniqueRecoveryHandles = new Set<string>();
  const observedAgentRuns = new Map<string, { status: AgentRunResult['status']; contextUsedTokens: number }>();
  const observedLearningCycles = new Map<string, {
    status: AgentLearningCycleResult['status'];
    lessonId?: string;
    reusedLessonIds: readonly string[];
  }>();
  const observedBufferedProviderResults = new WeakSet<object>();
  const bufferedProviderObservations: BufferedProviderObservation[] = [];
  const streamProviderObservations = new WeakMap<GovernedProviderStreamSession, StreamProviderObservationState>();
  const streamProviderObservationList: StreamProviderObservationState[] = [];
  const observedMcpHttpHandlers = new WeakSet<object>();
  const mcpHttpHandlers: ProductionMcpHttpHandler[] = [];
  const observedMcpStdioHandles = new WeakSet<object>();
  const mcpStdioHandles: object[] = [];

  return {
    observeProxyEvent(event) {
      const receipt = event.info?.receipt;
      if (!receipt) return;
      receipts += 1;
      if (receipt.verificationStatus === 'verified') verifiedReceipts += 1;
      protectedSpans += receipt.protectedSpans.length;
      recoveryHandles += receipt.recoveryHandles.length;
      for (const handle of receipt.recoveryHandles) uniqueRecoveryHandles.add(handle);
      if (receipt.confidence === 'estimated') sawEstimatedConfidence = true;
      if (receipt.confidence === 'unknown') sawUnknownConfidence = true;
    },

    observeAgentRun(result) {
      if (!result || result.format !== 'furypipe-agent-run/v1') {
        throw new Error('Control Room Agent observation format is invalid');
      }
      boundedOpaqueId(result.runId, 'Agent runId');
      if (!['completed', 'failed', 'handoff_required'].includes(result.status)) {
        throw new Error('Control Room Agent observation status is invalid');
      }
      safeRuntimeCount(result.contextUsedTokens, 'Agent contextUsedTokens');
      observedAgentRuns.set(result.runId, {
        status: result.status,
        contextUsedTokens: result.contextUsedTokens,
      });
    },

    observeLearningCycle(result) {
      if (!result || result.format !== 'furypipe-agent-learning-cycle/v1') {
        throw new Error('Control Room Learning observation format is invalid');
      }
      boundedOpaqueId(result.cycleId, 'Learning cycleId');
      if (!['completed', 'failed'].includes(result.status)) {
        throw new Error('Control Room Learning observation status is invalid');
      }
      if (result.lessonId !== undefined) boundedOpaqueId(result.lessonId, 'Learning lessonId');
      if (!Array.isArray(result.reusedLessons) || result.reusedLessons.length > 10_000) {
        throw new Error('Control Room Learning reusedLessons are invalid');
      }
      const reusedLessonIds = result.reusedLessons.map((lesson) => {
        boundedOpaqueId(lesson?.lessonId, 'Learning reused lessonId');
        return lesson.lessonId;
      });
      observedLearningCycles.set(result.cycleId, {
        status: result.status,
        ...(result.lessonId === undefined ? {} : { lessonId: result.lessonId }),
        reusedLessonIds: Object.freeze([...new Set(reusedLessonIds)]),
      });
    },

    observeMcpHttpHandler(handler) {
      const evidence = getProductionMcpRuntimeEvidence(handler);
      if (evidence === undefined) {
        throw new Error('Control Room MCP HTTP observation requires a process-local FuryPipe production handler');
      }
      if (observedMcpHttpHandlers.has(handler as object)) return;
      if (mcpHttpHandlers.length >= 1_000) throw new Error('Control Room MCP HTTP observation limit reached');
      observedMcpHttpHandlers.add(handler as object);
      mcpHttpHandlers.push(handler);
    },

    observeMcpStdioHandle(handle) {
      if (!isGeneratedModernMcpStdioHandle(handle)) {
        throw new Error('Control Room MCP stdio observation requires a process-local FuryPipe handle');
      }
      const key = handle as object;
      if (observedMcpStdioHandles.has(key)) return;
      if (mcpStdioHandles.length >= 1_000) throw new Error('Control Room MCP stdio observation limit reached');
      observedMcpStdioHandles.add(key);
      mcpStdioHandles.push(key);
    },

    observeProviderExecution(result) {
      if (!isGeneratedGovernedProviderExecutionResult(result)) {
        throw new Error('Control Room provider execution requires a process-local FuryPipe result');
      }
      if (observedBufferedProviderResults.has(result)) return;
      if (bufferedProviderObservations.length >= MAX_PROVIDER_OBSERVATIONS) {
        throw new Error('Control Room provider observation limit reached');
      }
      const usage = snapshotProviderUsage(result.usage);
      bufferedProviderObservations.push(Object.freeze({
        providerStatus: result.providerRequest.status,
        ...(usage === undefined ? {} : { usage }),
        cost: providerCostState(result.cost),
      }));
      observedBufferedProviderResults.add(result);
    },

    observeProviderStreamSession(session) {
      if (!isGeneratedGovernedProviderStreamSession(session)) {
        throw new Error('Control Room provider stream observation requires a process-local FuryPipe session');
      }
      const existing = streamProviderObservations.get(session);
      if (existing) return Object.freeze({
        observeEvent: (event: GovernedProviderStreamEvent) => observeStreamEvent(session, existing, event),
      });
      if (streamProviderObservationList.length >= MAX_PROVIDER_OBSERVATIONS) {
        throw new Error('Control Room provider stream observation limit reached');
      }
      const state: StreamProviderObservationState = {
        providerId: session.providerId,
        model: session.model,
        workloadId: session.workloadId,
        requestDigest: session.requestDigest,
        providerStatus: session.providerRequest.status,
        nextSequence: 0,
        terminal: undefined,
        usageReports: 0,
        usage: {},
        cost: undefined,
        seenEvents: new WeakSet<object>(),
      };
      streamProviderObservations.set(session, state);
      streamProviderObservationList.push(state);
      return Object.freeze({
        observeEvent: (event: GovernedProviderStreamEvent) => observeStreamEvent(session, state, event),
      });
    },

    snapshot() {
      const generatedAt = now();
      if (!Number.isSafeInteger(generatedAt) || generatedAt < 0) {
        throw new RangeError('Control Room runtime clock must return a non-negative safe integer');
      }

      const confidence = receipts === 0 || sawUnknownConfidence
        ? 'unknown'
        : sawEstimatedConfidence
          ? 'estimated'
          : 'verified';

      const recovery = options.recovery
        ? clone(options.recovery)
        : {
            ...NOT_AVAILABLE_RECOVERY,
            objects: uniqueRecoveryHandles.size,
          };

      const baseAgent = options.agent ?? NOT_AVAILABLE_AGENT;
      const agentRuns = [...observedAgentRuns.values()];
      const agent: AgentEvidence = {
        ...baseAgent,
        runs: baseAgent.runs + observedAgentRuns.size,
        completedRuns: baseAgent.completedRuns + agentRuns.filter((run) => run.status === 'completed').length,
        handoffRuns: baseAgent.handoffRuns + agentRuns.filter((run) => run.status === 'handoff_required').length,
        failedRuns: baseAgent.failedRuns + agentRuns.filter((run) => run.status === 'failed').length,
        contextUsedTokens: baseAgent.contextUsedTokens + agentRuns.reduce((sum, run) => sum + run.contextUsedTokens, 0),
      };

      const baseLearning = options.learning ?? NOT_AVAILABLE_LEARNING;
      const completedLearning = [...observedLearningCycles.values()].filter((cycle) => cycle.status === 'completed');
      const learnedLessonIds = new Set(completedLearning.flatMap((cycle) => cycle.lessonId === undefined ? [] : [cycle.lessonId]));
      const reusedLessonIds = new Set(completedLearning.flatMap((cycle) => cycle.reusedLessonIds));
      const learning: LearningEvidence = {
        ...baseLearning,
        agentLessons: baseLearning.agentLessons + learnedLessonIds.size,
        reusedLessons: baseLearning.reusedLessons + reusedLessonIds.size,
      };

      return createControlRoomSnapshot({
        generatedAt,
        sourceCommit: options.sourceCommit,
        receipts: {
          receipts,
          verifiedReceipts,
          protectedSpans,
          recoveryHandles,
          confidence,
        },
        recovery,
        agent,
        learning,
        provider: providerEvidenceFromObservations(
          bufferedProviderObservations,
          streamProviderObservationList,
        ),
        mcp: options.mcp
          ? clone(options.mcp)
          : mcpEvidenceFromObservations(mcpHttpHandlers, mcpStdioHandles),
        i18n: clone(options.i18n ?? NOT_AVAILABLE_I18N),
        webStudio: clone(options.webStudio ?? NOT_AVAILABLE_WEB_STUDIO),
        security: clone(options.security ?? NOT_AVAILABLE_SECURITY),
        benchmarks: clone(options.benchmarks ?? NOT_AVAILABLE_BENCHMARKS),
        ...(options.releaseReadiness === undefined ? {} : { releaseReadiness: options.releaseReadiness }),
      });
    },
  };
}
