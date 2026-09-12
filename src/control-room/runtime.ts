import type { ProxyEvent } from '../core/proxy.js';
import type { ReleaseReadinessReport } from '../release-readiness/index.js';
import {
  createControlRoomSnapshot,
  type AgentEvidence,
  type BenchmarkEvidence,
  type ControlRoomSnapshot,
  type I18nEvidence,
  type LearningEvidence,
  type McpEvidence,
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

export interface ControlRoomRuntime {
  observeProxyEvent(event: Pick<ProxyEvent, 'info'>): void;
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

const NOT_AVAILABLE_MCP: McpEvidence = Object.freeze({
  stdio: 'NOT_AVAILABLE',
  http: 'NOT_AVAILABLE',
  bearerAuth: 'NOT_AVAILABLE',
  oauth: 'NOT_AVAILABLE',
  externalConformance: 'NOT_AVAILABLE',
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

function clone<T extends object>(value: T): T {
  return { ...value };
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
        agent: clone(options.agent ?? NOT_AVAILABLE_AGENT),
        learning: clone(options.learning ?? NOT_AVAILABLE_LEARNING),
        mcp: clone(options.mcp ?? NOT_AVAILABLE_MCP),
        i18n: clone(options.i18n ?? NOT_AVAILABLE_I18N),
        webStudio: clone(options.webStudio ?? NOT_AVAILABLE_WEB_STUDIO),
        security: clone(options.security ?? NOT_AVAILABLE_SECURITY),
        benchmarks: clone(options.benchmarks ?? NOT_AVAILABLE_BENCHMARKS),
        ...(options.releaseReadiness === undefined ? {} : { releaseReadiness: options.releaseReadiness }),
      });
    },
  };
}
