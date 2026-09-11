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
  readonly encryption: 'disabled' | 'aes-256-gcm';
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

export interface ControlRoomInput {
  readonly generatedAt: number;
  readonly sourceCommit: string;
  readonly receipts: ReceiptEvidence;
  readonly recovery: RecoveryEvidence;
  readonly agent: AgentEvidence;
  readonly learning: LearningEvidence;
  readonly mcp: McpEvidence;
  readonly i18n: I18nEvidence;
  readonly webStudio: WebStudioEvidence;
  readonly security: SecurityEvidence;
  readonly benchmarks: BenchmarkEvidence;
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
    readonly mcp: ControlRoomSection<McpEvidence>;
    readonly i18n: ControlRoomSection<I18nEvidence>;
    readonly webStudio: ControlRoomSection<WebStudioEvidence>;
    readonly security: ControlRoomSection<SecurityEvidence>;
    readonly benchmarks: ControlRoomSection<BenchmarkEvidence>;
  };
}

const SHA40 = /^[0-9a-f]{40}$/u;
const MAX_COUNT = 1_000_000_000;
const MAX_TOKENS = 10_000_000_000;

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
    'benchmarks.comparableRuns': input.benchmarks.comparableRuns,
  })) {
    safeCount(value, label);
  }
  safeCount(input.agent.contextUsedTokens, 'agent.contextUsedTokens', MAX_TOKENS);

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
}

function overallFromSections(sections: ControlRoomSnapshot['sections']): ControlRoomOverallStatus {
  const statuses = Object.values(sections).map((value) => value.status);
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.every((status) => status === 'VERIFIED')) return 'HEALTHY';
  if (statuses.includes('NOT_EXECUTED') || statuses.includes('PARTIAL')) return 'PARTIAL';
  return 'DEGRADED';
}

export function createControlRoomSnapshot(input: ControlRoomInput): ControlRoomSnapshot {
  validateInput(input);

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

  const sections = Object.freeze({
    receipts: section(receiptStatus, input.receipts),
    recovery: section(recoveryStatus, input.recovery, [
      ...(input.recovery.backupEvidence === 'BACKUP_EXISTS'
        ? ['Backup exists but restore has not been verified.'] : []),
    ]),
    agent: section(agentStatus, input.agent),
    learning: section(learningStatus, input.learning),
    mcp: section(mcpStatus, input.mcp),
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
