import type { ReleaseReadinessReport } from '../release-readiness/index.js';

export type ControlRoomEvidenceStatus =
  | 'NOT_AVAILABLE'
  | 'NOT_EXECUTED'
  | 'PARTIAL'
  | 'VERIFIED'
  | 'BLOCKED';

export type ControlRoomOverallStatus = 'HEALTHY' | 'PARTIAL' | 'DEGRADED' | 'BLOCKED';

export interface ReceiptEvidence {
  readonly receipts: number;
  readonly verifiedReceipts: number;
  readonly protectedSpans: number;
  readonly recoveryHandles: number;
  readonly confidence: 'unknown' | 'estimated' | 'verified';
}

export interface RecoveryEvidence {
  readonly objects: number;
  readonly verifiedObjects: number;
  readonly encryption: 'unknown' | 'disabled' | 'aes-256-gcm';
  readonly activeKeyId?: string;
  readonly backupEvidence: 'NOT_CHECKED' | 'BACKUP_EXISTS' | 'RESTORE_VERIFIED';
  readonly crashRecovery: ControlRoomEvidenceStatus;
  readonly multiProcess: ControlRoomEvidenceStatus;
}

export interface AgentEvidence {
  readonly runs: number;
  readonly completedRuns: number;
  readonly handoffRuns: number;
  readonly failedRuns: number;
  readonly contextUsedTokens: number;
  readonly persistedMemory: ControlRoomEvidenceStatus;
  readonly distributedHandoff: ControlRoomEvidenceStatus;
}

export interface LearningEvidence {
  readonly humanTopics: number;
  readonly agentLessons: number;
  readonly reusedLessons: number;
  readonly durableStore: ControlRoomEvidenceStatus;
  readonly semanticRetrieval: ControlRoomEvidenceStatus;
}

export interface ProviderEvidence {
  readonly bufferedExecutions: number;
  readonly streamSessions: number;
  readonly acceptedRequests: number;
  readonly rejectedRequests: number;
  readonly unknownRequests: number;
  readonly streamCompleted: number;
  readonly streamIncomplete: number;
  readonly streamFailed: number;
  readonly streamCancelled: number;
  readonly streamRequiresAction: number;
  readonly streamTerminalUnknown: number;
  readonly streamProviderErrors: number;
  readonly streamOpenAccepted: number;
  readonly usageReports: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
  readonly knownCostObservations: number;
  readonly unknownCostObservations: number;
  /** Verifies only that observations came from process-local FuryPipe runtime objects. */
  readonly runtimeObservability: ControlRoomEvidenceStatus;
  /** Independent provider/network verification. Transport-reported evidence is not enough. */
  readonly providerVerification: ControlRoomEvidenceStatus;
}

export interface McpEvidence {
  readonly stdio: ControlRoomEvidenceStatus;
  readonly http: ControlRoomEvidenceStatus;
  readonly bearerAuth: ControlRoomEvidenceStatus;
  readonly oauth: ControlRoomEvidenceStatus;
  readonly externalConformance: ControlRoomEvidenceStatus;
}

export interface I18nEvidence {
  readonly locale: string;
  readonly direction: 'ltr' | 'rtl';
  readonly runtimeKernel: ControlRoomEvidenceStatus;
  readonly cliWiring: ControlRoomEvidenceStatus;
  readonly dashboardWiring: ControlRoomEvidenceStatus;
}

export interface WebStudioEvidence {
  readonly kernel: ControlRoomEvidenceStatus;
  readonly figma: ControlRoomEvidenceStatus;
  readonly playwright: ControlRoomEvidenceStatus;
  readonly accessibility: ControlRoomEvidenceStatus;
  readonly security: ControlRoomEvidenceStatus;
  readonly seo: ControlRoomEvidenceStatus;
  readonly deployment: ControlRoomEvidenceStatus;
}

export interface SecurityEvidence {
  readonly codeql: ControlRoomEvidenceStatus;
  readonly secretScan: ControlRoomEvidenceStatus;
  readonly dependencyAudit: ControlRoomEvidenceStatus;
  readonly sbom: ControlRoomEvidenceStatus;
  readonly actionPinning: ControlRoomEvidenceStatus;
  readonly licenseCompliance: ControlRoomEvidenceStatus;
  readonly dependencyReview: ControlRoomEvidenceStatus;
}

export interface BenchmarkEvidence {
  readonly harness: ControlRoomEvidenceStatus;
  readonly providerRuns: ControlRoomEvidenceStatus;
  readonly comparableRuns: number;
}

export interface ReleaseReadinessEvidence {
  readonly technicalStatus: 'NOT_AVAILABLE' | 'BLOCKED' | 'READY_FOR_RELEASE_DECISION';
  readonly channel?: 'rc' | 'stable';
  readonly blockers: number;
  readonly warnings: number;
  readonly verifiedRequiredGates: number;
  readonly requiredGates: number;
  readonly authorizedActions: number;
  readonly releaseActionsExecuted: false;
}

export interface ControlRoomInput {
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly receipts: ReceiptEvidence;
  readonly recovery: RecoveryEvidence;
  readonly agent: AgentEvidence;
  readonly learning: LearningEvidence;
  readonly provider?: ProviderEvidence;
  readonly mcp: McpEvidence;
  readonly i18n: I18nEvidence;
  readonly webStudio: WebStudioEvidence;
  readonly security: SecurityEvidence;
  readonly benchmarks: BenchmarkEvidence;
  /** Optional M19 technical-readiness report for this exact source commit. */
  readonly releaseReadiness?: ReleaseReadinessReport;
}

export interface ControlRoomSection<T> {
  readonly status: ControlRoomEvidenceStatus;
  readonly evidence: T;
  readonly warnings: readonly string[];
}

export interface ControlRoomSnapshot {
  readonly format: 'furypipe-control-room/v1';
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly overall: ControlRoomOverallStatus;
  readonly sections: {
    readonly receipts: ControlRoomSection<ReceiptEvidence>;
    readonly recovery: ControlRoomSection<RecoveryEvidence>;
    readonly agent: ControlRoomSection<AgentEvidence>;
    readonly learning: ControlRoomSection<LearningEvidence>;
    readonly provider: ControlRoomSection<ProviderEvidence>;
    readonly mcp: ControlRoomSection<McpEvidence>;
    readonly i18n: ControlRoomSection<I18nEvidence>;
    readonly webStudio: ControlRoomSection<WebStudioEvidence>;
    readonly security: ControlRoomSection<SecurityEvidence>;
    readonly benchmarks: ControlRoomSection<BenchmarkEvidence>;
    readonly release: ControlRoomSection<ReleaseReadinessEvidence>;
  };
}

const SHA40 = /^[0-9a-f]{40}$/u;
const MAX_COUNT = 1_000_000_000;
const MAX_TOKENS = 10_000_000_000;

const DEFAULT_PROVIDER_EVIDENCE: ProviderEvidence = Object.freeze({
  bufferedExecutions: 0,
  streamSessions: 0,
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
  runtimeObservability: 'NOT_EXECUTED',
  providerVerification: 'NOT_AVAILABLE',
});

function safeCount(value: number, label: string, max = MAX_COUNT): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be a bounded non-negative safe integer`);
  }
  return value;
}

function safeTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('generatedAt must be a non-negative safe integer');
  }
  return value;
}

function sectionStatus(statuses: readonly ControlRoomEvidenceStatus[]): ControlRoomEvidenceStatus {
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.every((status) => status === 'VERIFIED')) return 'VERIFIED';
  if (statuses.every((status) => status === 'NOT_AVAILABLE' || status === 'NOT_EXECUTED')) return 'NOT_EXECUTED';
  return 'PARTIAL';
}

function section<T>(status: ControlRoomEvidenceStatus, evidence: T, warnings: readonly string[] = []): ControlRoomSection<T> {
  return Object.freeze({
    status,
    evidence: Object.freeze({ ...(evidence as object) }) as T,
    warnings: Object.freeze([...warnings]),
  });
}

function validateInput(input: ControlRoomInput): void {
  safeTimestamp(input.generatedAt);
  if (!SHA40.test(input.sourceCommit)) throw new Error('sourceCommit must be a lowercase 40-character commit SHA');
  const provider = input.provider ?? DEFAULT_PROVIDER_EVIDENCE;

  for (const [label, value] of Object.entries({
    'receipts.receipts': input.receipts.receipts,
    'receipts.verifiedReceipts': input.receipts.verifiedReceipts,
    'receipts.protectedSpans': input.receipts.protectedSpans,
    'receipts.recoveryHandles': input.receipts.recoveryHandles,
    'recovery.objects': input.recovery.objects,
    'recovery.verifiedObjects': input.recovery.verifiedObjects,
    'agent.runs': input.agent.runs,
    'agent.completedRuns': input.agent.completedRuns,
    'agent.handoffRuns': input.agent.handoffRuns,
    'agent.failedRuns': input.agent.failedRuns,
    'learning.humanTopics': input.learning.humanTopics,
    'learning.agentLessons': input.learning.agentLessons,
    'learning.reusedLessons': input.learning.reusedLessons,
    'provider.bufferedExecutions': provider.bufferedExecutions,
    'provider.streamSessions': provider.streamSessions,
    'provider.acceptedRequests': provider.acceptedRequests,
    'provider.rejectedRequests': provider.rejectedRequests,
    'provider.unknownRequests': provider.unknownRequests,
    'provider.streamCompleted': provider.streamCompleted,
    'provider.streamIncomplete': provider.streamIncomplete,
    'provider.streamFailed': provider.streamFailed,
    'provider.streamCancelled': provider.streamCancelled,
    'provider.streamRequiresAction': provider.streamRequiresAction,
    'provider.streamTerminalUnknown': provider.streamTerminalUnknown,
    'provider.streamProviderErrors': provider.streamProviderErrors,
    'provider.streamOpenAccepted': provider.streamOpenAccepted,
    'provider.usageReports': provider.usageReports,
    'provider.knownCostObservations': provider.knownCostObservations,
    'provider.unknownCostObservations': provider.unknownCostObservations,
    'benchmarks.comparableRuns': input.benchmarks.comparableRuns,
  })) {
    safeCount(value, label);
  }
  safeCount(input.agent.contextUsedTokens, 'agent.contextUsedTokens', MAX_TOKENS);
  safeCount(provider.inputTokens, 'provider.inputTokens', MAX_TOKENS);
  safeCount(provider.outputTokens, 'provider.outputTokens', MAX_TOKENS);
  safeCount(provider.cacheWriteTokens, 'provider.cacheWriteTokens', MAX_TOKENS);
  safeCount(provider.cacheReadTokens, 'provider.cacheReadTokens', MAX_TOKENS);
  if (
    provider.acceptedRequests + provider.rejectedRequests + provider.unknownRequests
    !== provider.bufferedExecutions + provider.streamSessions
  ) {
    throw new Error('provider request status counts must equal total observed provider attempts');
  }
  if (
    provider.streamCompleted
      + provider.streamIncomplete
      + provider.streamFailed
      + provider.streamCancelled
      + provider.streamRequiresAction
      + provider.streamTerminalUnknown
      + provider.streamProviderErrors
      + provider.streamOpenAccepted
    > provider.streamSessions
  ) {
    throw new Error('provider stream terminal/open counts cannot exceed observed stream sessions');
  }

  if (input.receipts.verifiedReceipts > input.receipts.receipts) {
    throw new Error('verified receipt count cannot exceed total receipt count');
  }
  if (input.recovery.verifiedObjects > input.recovery.objects) {
    throw new Error('verified recovery object count cannot exceed total objects');
  }
  if (input.agent.completedRuns + input.agent.handoffRuns + input.agent.failedRuns > input.agent.runs) {
    throw new Error('agent terminal/handoff counts cannot exceed total runs');
  }
  if (input.learning.reusedLessons > input.learning.agentLessons) {
    throw new Error('reused lesson count cannot exceed stored lessons');
  }
  if (input.recovery.encryption === 'aes-256-gcm' && !input.recovery.activeKeyId) {
    throw new Error('encrypted Recovery evidence requires an activeKeyId');
  }
  if (!input.i18n.locale.trim()) throw new Error('i18n locale must not be empty');

  if (input.releaseReadiness !== undefined) {
    const release = input.releaseReadiness;
    if (release.format !== 'furypipe-release-readiness/v1') {
      throw new Error('release readiness report format is invalid');
    }
    if (release.sourceCommit !== input.sourceCommit) {
      throw new Error('release readiness source commit must match Control Room source commit');
    }
    safeCount(release.blockers.length, 'release.blockers');
    safeCount(release.warnings.length, 'release.warnings');
    safeCount(release.verifiedRequiredGates, 'release.verifiedRequiredGates');
    safeCount(release.requiredGates, 'release.requiredGates');
    if (release.verifiedRequiredGates > release.requiredGates) {
      throw new Error('release verified gate count cannot exceed required gate count');
    }
    if (release.releaseActionsExecuted !== false) {
      throw new Error('Control Room accepts evidence-only release reports');
    }
  }
}

function overallFromSections(sections: ControlRoomSnapshot['sections']): ControlRoomOverallStatus {
  const statuses = Object.values(sections).map((value) => value.status);
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.every((status) => status === 'VERIFIED')) return 'HEALTHY';
  if (statuses.includes('NOT_AVAILABLE') || statuses.includes('NOT_EXECUTED') || statuses.includes('PARTIAL')) return 'PARTIAL';
  return 'DEGRADED';
}

export function createControlRoomSnapshot(input: ControlRoomInput): ControlRoomSnapshot {
  validateInput(input);
  const provider = input.provider ?? DEFAULT_PROVIDER_EVIDENCE;

  const receiptStatus = input.receipts.receipts === 0
    ? 'NOT_EXECUTED'
    : input.receipts.verifiedReceipts === input.receipts.receipts
      ? 'VERIFIED'
      : 'PARTIAL';

  const recoveryStatus = sectionStatus([
    input.recovery.objects > 0 && input.recovery.verifiedObjects === input.recovery.objects ? 'VERIFIED' : 'PARTIAL',
    input.recovery.crashRecovery,
    input.recovery.multiProcess,
  ]);

  const agentStatus = sectionStatus([
    input.agent.runs > 0 && input.agent.failedRuns === 0 ? 'VERIFIED' : input.agent.runs === 0 ? 'NOT_EXECUTED' : 'PARTIAL',
    input.agent.persistedMemory,
    input.agent.distributedHandoff,
  ]);

  const learningStatus = sectionStatus([
    input.learning.humanTopics > 0 || input.learning.agentLessons > 0 ? 'VERIFIED' : 'NOT_EXECUTED',
    input.learning.durableStore,
    input.learning.semanticRetrieval,
  ]);

  const providerStatus = sectionStatus([
    provider.runtimeObservability,
    provider.providerVerification,
  ]);

  const mcpStatus = sectionStatus([
    input.mcp.stdio,
    input.mcp.http,
    input.mcp.bearerAuth,
    input.mcp.oauth,
    input.mcp.externalConformance,
  ]);

  const i18nStatus = sectionStatus([
    input.i18n.runtimeKernel,
    input.i18n.cliWiring,
    input.i18n.dashboardWiring,
  ]);

  const webStudioStatus = sectionStatus([
    input.webStudio.kernel,
    input.webStudio.figma,
    input.webStudio.playwright,
    input.webStudio.accessibility,
    input.webStudio.security,
    input.webStudio.seo,
    input.webStudio.deployment,
  ]);

  const securityStatus = sectionStatus([
    input.security.codeql,
    input.security.secretScan,
    input.security.dependencyAudit,
    input.security.sbom,
    input.security.actionPinning,
    input.security.licenseCompliance,
    input.security.dependencyReview,
  ]);

  const benchmarkStatus = sectionStatus([
    input.benchmarks.harness,
    input.benchmarks.providerRuns,
  ]);

  const releaseReport = input.releaseReadiness;
  const releaseEvidence: ReleaseReadinessEvidence = releaseReport === undefined
    ? {
        technicalStatus: 'NOT_AVAILABLE',
        blockers: 0,
        warnings: 0,
        verifiedRequiredGates: 0,
        requiredGates: 0,
        authorizedActions: 0,
        releaseActionsExecuted: false,
      }
    : {
        technicalStatus: releaseReport.status,
        channel: releaseReport.channel,
        blockers: releaseReport.blockers.length,
        warnings: releaseReport.warnings.length,
        verifiedRequiredGates: releaseReport.verifiedRequiredGates,
        requiredGates: releaseReport.requiredGates,
        authorizedActions: Object.values(releaseReport.authorization).filter((value) => value === true).length,
        releaseActionsExecuted: false,
      };
  const releaseStatus: ControlRoomEvidenceStatus = releaseReport === undefined
    ? 'NOT_AVAILABLE'
    : releaseReport.status === 'BLOCKED'
      ? 'BLOCKED'
      : 'VERIFIED';

  const sections = Object.freeze({
    receipts: section(receiptStatus, input.receipts),
    recovery: section(recoveryStatus, input.recovery, [
      ...(input.recovery.backupEvidence === 'BACKUP_EXISTS'
        ? ['Backup exists but restore has not been verified.'] : []),
      ...(input.recovery.encryption === 'unknown'
        ? ['Recovery encryption state is not observed by this runtime provider.'] : []),
    ]),
    agent: section(agentStatus, input.agent),
    learning: section(learningStatus, input.learning),
    provider: section(providerStatus, provider, [
      ...(provider.runtimeObservability === 'VERIFIED' && provider.providerVerification !== 'VERIFIED'
        ? ['Provider/runtime observations are process-local; provider/network truth remains independently unverified.']
        : []),
      ...(provider.streamOpenAccepted > 0
        ? [`${provider.streamOpenAccepted} accepted provider stream(s) have no observed terminal event yet.`]
        : []),
    ]),
    mcp: section(mcpStatus, input.mcp, [
      ...(input.mcp.stdio === 'PARTIAL'
        ? ['MCP stdio was constructed locally; no client exchange is independently observed by this runtime feed.']
        : []),
      ...(input.mcp.oauth === 'PARTIAL'
        ? ['MCP OAuth evidence is local/configuration-level only; no external Authorization Server conformance is proven.']
        : []),
      ...(input.mcp.externalConformance !== 'VERIFIED'
        ? ['MCP external client/network conformance is not verified by local runtime observations.']
        : []),
    ]),
    i18n: section(i18nStatus, input.i18n),
    webStudio: section(webStudioStatus, input.webStudio),
    security: section(securityStatus, input.security, [
      ...(input.security.dependencyReview === 'BLOCKED'
        ? ['GitHub Dependency Review is blocked by repository Dependency Graph settings.'] : []),
    ]),
    benchmarks: section(benchmarkStatus, input.benchmarks, [
      ...(input.benchmarks.providerRuns !== 'VERIFIED'
        ? ['Provider benchmarks are not verified; do not publish performance claims.'] : []),
    ]),
    release: section(releaseStatus, releaseEvidence, [
      ...(releaseReport === undefined
        ? ['Release readiness evidence is not available for this commit.']
        : releaseReport.status === 'BLOCKED'
          ? [`Release decision is blocked by ${releaseReport.blockers.length} required gate(s).`]
          : []),
      ...(releaseReport !== undefined && Object.values(releaseReport.authorization).some((value) => value === true)
        ? ['Release authorization is recorded separately; Control Room does not execute release actions.'] : []),
    ]),
  });

  return Object.freeze({
    format: 'furypipe-control-room/v1',
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    overall: overallFromSections(sections),
    sections,
  });
}

export function redactControlRoomSnapshot(snapshot: ControlRoomSnapshot): ControlRoomSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ControlRoomSnapshot;
}
