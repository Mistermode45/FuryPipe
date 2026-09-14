import { lstatSync, readFileSync, statSync } from 'node:fs';

import {
  getV5RequiredReleaseGateIds,
  isAllowedV5ReleaseGateOrigin,
  isExactReleaseAuthorization,
  V5_RELEASE_GATE_REQUIREDNESS,
} from '../release-readiness/index.js';
import type { ReleaseReadinessReport, ReleaseGateState, ReleaseEvidenceOrigin } from '../release-readiness/index.js';
import {
  createControlRoomSnapshot,
  type AgentEvidence,
  type BenchmarkEvidence,
  type ControlRoomEvidenceStatus,
  type I18nEvidence,
  type LearningEvidence,
  type McpEvidence,
  type RecoveryEvidence,
  type SecurityEvidence,
  type WebStudioEvidence,
} from './index.js';

export const CONTROL_ROOM_EVIDENCE_MAX_BYTES = 256 * 1024;

export interface ControlRoomHostEvidence {
  readonly format: 'furypipe-control-room-host-evidence/v1';
  readonly generatedAt: number;
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
}

const STATUS = new Set<ControlRoomEvidenceStatus>([
  'NOT_AVAILABLE', 'NOT_EXECUTED', 'PARTIAL', 'VERIFIED', 'BLOCKED',
]);
const RELEASE_STATE = new Set<ReleaseGateState>([
  'VERIFIED', 'PARTIAL', 'NOT_EXECUTED', 'BLOCKED', 'BLOCKED_BY_REPO_SETTING', 'NOT_APPLICABLE',
]);
const SHA40 = /^[0-9a-f]{40}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, max = 1024): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.includes('\0')) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function count(value: unknown, label: string, max = 10_000_000_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a bounded non-negative safe integer`);
  }
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function status(value: unknown, label: string): ControlRoomEvidenceStatus {
  if (!STATUS.has(value as ControlRoomEvidenceStatus)) throw new Error(`${label} has an invalid evidence status`);
  return value as ControlRoomEvidenceStatus;
}

function releaseState(value: unknown, label: string): ReleaseGateState {
  if (!RELEASE_STATE.has(value as ReleaseGateState)) throw new Error(`${label} has an invalid release state`);
  return value as ReleaseGateState;
}

function optional<T>(value: unknown, parse: (input: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}

function parseRecovery(value: unknown): RecoveryEvidence {
  const v = object(value, 'recovery');
  const encryption = v.encryption;
  if (!['unknown', 'disabled', 'aes-256-gcm'].includes(String(encryption))) {
    throw new Error('recovery.encryption is invalid');
  }
  const backup = v.backupEvidence;
  if (!['NOT_CHECKED', 'BACKUP_EXISTS', 'RESTORE_VERIFIED'].includes(String(backup))) {
    throw new Error('recovery.backupEvidence is invalid');
  }
  const result: RecoveryEvidence = {
    objects: count(v.objects, 'recovery.objects', 1_000_000_000),
    verifiedObjects: count(v.verifiedObjects, 'recovery.verifiedObjects', 1_000_000_000),
    encryption: encryption as RecoveryEvidence['encryption'],
    ...(v.activeKeyId === undefined ? {} : { activeKeyId: boundedString(v.activeKeyId, 'recovery.activeKeyId', 256) }),
    backupEvidence: backup as RecoveryEvidence['backupEvidence'],
    crashRecovery: status(v.crashRecovery, 'recovery.crashRecovery'),
    multiProcess: status(v.multiProcess, 'recovery.multiProcess'),
  };
  return Object.freeze(result);
}

function parseAgent(value: unknown): AgentEvidence {
  const v = object(value, 'agent');
  return Object.freeze({
    runs: count(v.runs, 'agent.runs', 1_000_000_000),
    completedRuns: count(v.completedRuns, 'agent.completedRuns', 1_000_000_000),
    handoffRuns: count(v.handoffRuns, 'agent.handoffRuns', 1_000_000_000),
    failedRuns: count(v.failedRuns, 'agent.failedRuns', 1_000_000_000),
    contextUsedTokens: count(v.contextUsedTokens, 'agent.contextUsedTokens'),
    persistedMemory: status(v.persistedMemory, 'agent.persistedMemory'),
    distributedHandoff: status(v.distributedHandoff, 'agent.distributedHandoff'),
  });
}

function parseLearning(value: unknown): LearningEvidence {
  const v = object(value, 'learning');
  return Object.freeze({
    humanTopics: count(v.humanTopics, 'learning.humanTopics', 1_000_000_000),
    agentLessons: count(v.agentLessons, 'learning.agentLessons', 1_000_000_000),
    reusedLessons: count(v.reusedLessons, 'learning.reusedLessons', 1_000_000_000),
    durableStore: status(v.durableStore, 'learning.durableStore'),
    semanticRetrieval: status(v.semanticRetrieval, 'learning.semanticRetrieval'),
  });
}

function parseMcp(value: unknown): McpEvidence {
  const v = object(value, 'mcp');
  return Object.freeze({
    stdio: status(v.stdio, 'mcp.stdio'),
    http: status(v.http, 'mcp.http'),
    bearerAuth: status(v.bearerAuth, 'mcp.bearerAuth'),
    oauth: status(v.oauth, 'mcp.oauth'),
    externalConformance: status(v.externalConformance, 'mcp.externalConformance'),
  });
}

function parseI18n(value: unknown): I18nEvidence {
  const v = object(value, 'i18n');
  const direction = boundedString(v.direction, 'i18n.direction', 3);
  if (direction !== 'ltr' && direction !== 'rtl') throw new Error('i18n.direction is invalid');
  return Object.freeze({
    locale: boundedString(v.locale, 'i18n.locale', 128),
    direction,
    runtimeKernel: status(v.runtimeKernel, 'i18n.runtimeKernel'),
    cliWiring: status(v.cliWiring, 'i18n.cliWiring'),
    dashboardWiring: status(v.dashboardWiring, 'i18n.dashboardWiring'),
  });
}

function parseWebStudio(value: unknown): WebStudioEvidence {
  const v = object(value, 'webStudio');
  return Object.freeze({
    kernel: status(v.kernel, 'webStudio.kernel'),
    figma: status(v.figma, 'webStudio.figma'),
    playwright: status(v.playwright, 'webStudio.playwright'),
    accessibility: status(v.accessibility, 'webStudio.accessibility'),
    security: status(v.security, 'webStudio.security'),
    seo: status(v.seo, 'webStudio.seo'),
    deployment: status(v.deployment, 'webStudio.deployment'),
  });
}

function parseSecurity(value: unknown): SecurityEvidence {
  const v = object(value, 'security');
  return Object.freeze({
    codeql: status(v.codeql, 'security.codeql'),
    secretScan: status(v.secretScan, 'security.secretScan'),
    dependencyAudit: status(v.dependencyAudit, 'security.dependencyAudit'),
    sbom: status(v.sbom, 'security.sbom'),
    actionPinning: status(v.actionPinning, 'security.actionPinning'),
    licenseCompliance: status(v.licenseCompliance, 'security.licenseCompliance'),
    dependencyReview: status(v.dependencyReview, 'security.dependencyReview'),
  });
}

function parseBenchmarks(value: unknown): BenchmarkEvidence {
  const v = object(value, 'benchmarks');
  return Object.freeze({
    harness: status(v.harness, 'benchmarks.harness'),
    providerRuns: status(v.providerRuns, 'benchmarks.providerRuns'),
    comparableRuns: count(v.comparableRuns, 'benchmarks.comparableRuns', 1_000_000_000),
  });
}

function parseReleaseReadiness(value: unknown, sourceCommit: string, hostGeneratedAt: number): ReleaseReadinessReport {
  const v = object(value, 'releaseReadiness');
  if (v.format !== 'furypipe-release-readiness/v2') throw new Error('releaseReadiness.format is invalid');
  if (v.sourceCommit !== sourceCommit) throw new Error('releaseReadiness.sourceCommit does not match evidence sourceCommit');
  const packageVersion = boundedString(v.packageVersion, 'releaseReadiness.packageVersion', 128);
  if (!SEMVER.test(packageVersion)) throw new Error('releaseReadiness.packageVersion is invalid');
  if (v.channel !== 'rc' && v.channel !== 'stable') throw new Error('releaseReadiness.channel is invalid');
  if (typeof v.performanceClaims !== 'boolean') throw new Error('releaseReadiness.performanceClaims is invalid');
  if (v.status !== 'BLOCKED' && v.status !== 'READY_FOR_RELEASE_DECISION') throw new Error('releaseReadiness.status is invalid');
  if (v.releaseActionsExecuted !== false) throw new Error('releaseReadiness.releaseActionsExecuted must be false');
  const generatedAt = count(v.generatedAt, 'releaseReadiness.generatedAt');
  if (generatedAt > hostGeneratedAt) throw new Error('releaseReadiness.generatedAt is later than containing evidence');

  const rawBlockers = v.blockers;
  if (!Array.isArray(rawBlockers) || rawBlockers.length > 128) throw new Error('releaseReadiness.blockers is invalid');
  const blockerIds = new Set<string>();
  const blockers = rawBlockers.map((item, index) => {
    const blocker = object(item, `releaseReadiness.blockers[${index}]`);
    const gateId = boundedString(blocker.gateId, `releaseReadiness.blockers[${index}].gateId`, 64);
    if (!Object.hasOwn(V5_RELEASE_GATE_REQUIREDNESS, gateId) || blockerIds.has(gateId)) {
      throw new Error('releaseReadiness blocker gate identity is unknown or duplicated');
    }
    blockerIds.add(gateId);
    return Object.freeze({
      gateId,
      title: boundedString(blocker.title, `releaseReadiness.blockers[${index}].title`, 256),
      state: releaseState(blocker.state, `releaseReadiness.blockers[${index}].state`),
      reason: boundedString(blocker.reason, `releaseReadiness.blockers[${index}].reason`, 1024),
    });
  });

  const rawWarnings = v.warnings;
  if (!Array.isArray(rawWarnings) || rawWarnings.length > 128) throw new Error('releaseReadiness.warnings is invalid');
  const warnings = rawWarnings.map((warning, index) =>
    boundedString(warning, `releaseReadiness.warnings[${index}]`, 1024)
  );

  const rawVerifiedEvidence = v.verifiedGateEvidence;
  if (!Array.isArray(rawVerifiedEvidence) || rawVerifiedEvidence.length > 128) {
    throw new Error('releaseReadiness.verifiedGateEvidence is invalid');
  }
  const verifiedIds = new Set<string>();
  const origins: readonly ReleaseEvidenceOrigin[] = ['local', 'github-actions', 'github', 'hosted', 'provider'];
  const verifiedGateEvidence = rawVerifiedEvidence.map((item, index) => {
    const evidence = object(item, `releaseReadiness.verifiedGateEvidence[${index}]`);
    const gateId = boundedString(evidence.gateId, `releaseReadiness.verifiedGateEvidence[${index}].gateId`, 64);
    if (!Object.hasOwn(V5_RELEASE_GATE_REQUIREDNESS, gateId)) {
      throw new Error('releaseReadiness verified gate identity is unknown');
    }
    if (verifiedIds.has(gateId)) throw new Error('releaseReadiness.verifiedGateEvidence contains duplicate gate IDs');
    verifiedIds.add(gateId);
    const evidenceSourceCommit = boundedString(evidence.sourceCommit,
      `releaseReadiness.verifiedGateEvidence[${index}].sourceCommit`, 40);
    if (evidenceSourceCommit !== sourceCommit) throw new Error('release gate provenance sourceCommit does not match evidence sourceCommit');
    const observedAt = count(evidence.observedAt, `releaseReadiness.verifiedGateEvidence[${index}].observedAt`);
    if (observedAt > generatedAt || observedAt > hostGeneratedAt) {
      throw new Error('release gate provenance is later than its containing report');
    }
    if (typeof evidence.origin !== 'string' || !origins.includes(evidence.origin as ReleaseEvidenceOrigin)) {
      throw new Error('release gate provenance origin is invalid');
    }
    if (!isAllowedV5ReleaseGateOrigin(gateId, evidence.origin as ReleaseEvidenceOrigin)) {
      throw new Error('release gate provenance origin violates the canonical V5 gate policy');
    }
    return Object.freeze({
      gateId,
      sourceCommit: evidenceSourceCommit,
      observedAt,
      origin: evidence.origin as ReleaseEvidenceOrigin,
      reference: boundedString(evidence.reference, `releaseReadiness.verifiedGateEvidence[${index}].reference`, 512),
    });
  });
  const verifiedRequiredGates = count(v.verifiedRequiredGates, 'releaseReadiness.verifiedRequiredGates', 128);
  const requiredGates = count(v.requiredGates, 'releaseReadiness.requiredGates', 128);
  const expectedRequiredGateCount = 17 + (v.performanceClaims ? 1 : 0);
  const requiredGateIds = requiredGates === expectedRequiredGateCount
    ? getV5RequiredReleaseGateIds(requiredGates)
    : undefined;
  if (!requiredGateIds) throw new Error('releaseReadiness required gate count is not canonical for performanceClaims');
  const requiredGateIdSet = new Set(requiredGateIds);
  const verifiedRequiredIds = new Set(requiredGateIds.filter((gateId) => verifiedIds.has(gateId)));
  if (blockers.some((blocker) => !requiredGateIdSet.has(blocker.gateId))
    || [...blockerIds].some((gateId) => verifiedIds.has(gateId))
    || !requiredGateIds.every((gateId) => verifiedIds.has(gateId) !== blockerIds.has(gateId))
    || verifiedRequiredGates !== verifiedRequiredIds.size
    || verifiedRequiredGates > requiredGates || verifiedGateEvidence.length < verifiedRequiredGates) {
    throw new Error('releaseReadiness verified gate counts lack source-bound evidence');
  }
  if (v.status === 'READY_FOR_RELEASE_DECISION'
    && (blockers.length !== 0 || verifiedRequiredGates !== requiredGates
      || !requiredGateIds.every((gateId) => verifiedIds.has(gateId)))) {
    throw new Error('releaseReadiness READY status contradicts blockers or gate counts');
  }
  if (v.status === 'BLOCKED' && blockers.length === 0) {
    throw new Error('releaseReadiness BLOCKED status has no blocker or incomplete required gate');
  }

  const authorizationValue = object(v.authorization, 'releaseReadiness.authorization');
  if (!isExactReleaseAuthorization(authorizationValue)) {
    throw new Error('releaseReadiness.authorization must contain exactly the four boolean authorization fields');
  }
  const authorization = Object.freeze({
    mergeDefaultBranch: bool(authorizationValue.mergeDefaultBranch, 'releaseReadiness.authorization.mergeDefaultBranch'),
    createReleaseTag: bool(authorizationValue.createReleaseTag, 'releaseReadiness.authorization.createReleaseTag'),
    publishNpm: bool(authorizationValue.publishNpm, 'releaseReadiness.authorization.publishNpm'),
    deployProduction: bool(authorizationValue.deployProduction, 'releaseReadiness.authorization.deployProduction'),
  });

  return Object.freeze({
    format: 'furypipe-release-readiness/v2',
    generatedAt,
    sourceCommit,
    packageVersion,
    channel: v.channel,
    performanceClaims: v.performanceClaims,
    status: v.status,
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    verifiedRequiredGates,
    requiredGates,
    verifiedGateEvidence: Object.freeze(verifiedGateEvidence),
    authorization,
    releaseActionsExecuted: false,
  });
}

const DEFAULT_RECOVERY: RecoveryEvidence = Object.freeze({
  objects: 0, verifiedObjects: 0, encryption: 'unknown',
  backupEvidence: 'NOT_CHECKED', crashRecovery: 'NOT_AVAILABLE', multiProcess: 'NOT_AVAILABLE',
});
const DEFAULT_AGENT: AgentEvidence = Object.freeze({
  runs: 0, completedRuns: 0, handoffRuns: 0, failedRuns: 0, contextUsedTokens: 0,
  persistedMemory: 'NOT_AVAILABLE', distributedHandoff: 'NOT_AVAILABLE',
});
const DEFAULT_LEARNING: LearningEvidence = Object.freeze({
  humanTopics: 0, agentLessons: 0, reusedLessons: 0,
  durableStore: 'NOT_AVAILABLE', semanticRetrieval: 'NOT_AVAILABLE',
});
const DEFAULT_MCP: McpEvidence = Object.freeze({
  stdio: 'NOT_AVAILABLE', http: 'NOT_AVAILABLE', bearerAuth: 'NOT_AVAILABLE',
  oauth: 'NOT_AVAILABLE', externalConformance: 'NOT_AVAILABLE',
});
const DEFAULT_I18N: I18nEvidence = Object.freeze({
  locale: 'en', direction: 'ltr', runtimeKernel: 'NOT_AVAILABLE',
  cliWiring: 'NOT_AVAILABLE', dashboardWiring: 'NOT_AVAILABLE',
});
const DEFAULT_WEB_STUDIO: WebStudioEvidence = Object.freeze({
  kernel: 'NOT_AVAILABLE', figma: 'NOT_AVAILABLE', playwright: 'NOT_AVAILABLE',
  accessibility: 'NOT_AVAILABLE', security: 'NOT_AVAILABLE', seo: 'NOT_AVAILABLE', deployment: 'NOT_AVAILABLE',
});
const DEFAULT_SECURITY: SecurityEvidence = Object.freeze({
  codeql: 'NOT_AVAILABLE', secretScan: 'NOT_AVAILABLE', dependencyAudit: 'NOT_AVAILABLE',
  sbom: 'NOT_AVAILABLE', actionPinning: 'NOT_AVAILABLE', licenseCompliance: 'NOT_AVAILABLE',
  dependencyReview: 'NOT_AVAILABLE',
});
const DEFAULT_BENCHMARKS: BenchmarkEvidence = Object.freeze({
  harness: 'NOT_AVAILABLE', providerRuns: 'NOT_AVAILABLE', comparableRuns: 0,
});

export function parseControlRoomHostEvidence(value: unknown, expectedSourceCommit: string): ControlRoomHostEvidence {
  if (!SHA40.test(expectedSourceCommit)) throw new Error('expectedSourceCommit must be a lowercase 40-character SHA');
  const v = object(value, 'Control Room host evidence');
  if (v.format !== 'furypipe-control-room-host-evidence/v1') throw new Error('Control Room host evidence format is invalid');
  const sourceCommit = boundedString(v.sourceCommit, 'sourceCommit', 40);
  if (sourceCommit !== expectedSourceCommit) throw new Error('Control Room host evidence sourceCommit does not match running build');
  const generatedAt = count(v.generatedAt, 'generatedAt');

  const result: ControlRoomHostEvidence = Object.freeze({
    format: 'furypipe-control-room-host-evidence/v1',
    generatedAt,
    sourceCommit,
    ...optional(v.recovery, (input) => ({ recovery: parseRecovery(input) })),
    ...optional(v.agent, (input) => ({ agent: parseAgent(input) })),
    ...optional(v.learning, (input) => ({ learning: parseLearning(input) })),
    ...optional(v.mcp, (input) => ({ mcp: parseMcp(input) })),
    ...optional(v.i18n, (input) => ({ i18n: parseI18n(input) })),
    ...optional(v.webStudio, (input) => ({ webStudio: parseWebStudio(input) })),
    ...optional(v.security, (input) => ({ security: parseSecurity(input) })),
    ...optional(v.benchmarks, (input) => ({ benchmarks: parseBenchmarks(input) })),
    ...optional(v.releaseReadiness, (input) => ({ releaseReadiness: parseReleaseReadiness(input, sourceCommit, generatedAt) })),
  });

  // Reuse the canonical Control Room validator for cross-field invariants.
  createControlRoomSnapshot({
    generatedAt,
    sourceCommit,
    receipts: { receipts: 0, verifiedReceipts: 0, protectedSpans: 0, recoveryHandles: 0, confidence: 'unknown' },
    recovery: result.recovery ?? DEFAULT_RECOVERY,
    agent: result.agent ?? DEFAULT_AGENT,
    learning: result.learning ?? DEFAULT_LEARNING,
    mcp: result.mcp ?? DEFAULT_MCP,
    i18n: result.i18n ?? DEFAULT_I18N,
    webStudio: result.webStudio ?? DEFAULT_WEB_STUDIO,
    security: result.security ?? DEFAULT_SECURITY,
    benchmarks: result.benchmarks ?? DEFAULT_BENCHMARKS,
    ...(result.releaseReadiness === undefined ? {} : { releaseReadiness: result.releaseReadiness }),
  });

  return result;
}

export function loadControlRoomHostEvidence(
  filePath: string,
  expectedSourceCommit: string,
): ControlRoomHostEvidence {
  const path = boundedString(filePath, 'Control Room evidence path', 4096);
  const link = lstatSync(path);
  if (link.isSymbolicLink()) throw new Error('Control Room evidence path must not be a symlink');
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error('Control Room evidence path must be a regular file');
  if (stat.size < 2 || stat.size > CONTROL_ROOM_EVIDENCE_MAX_BYTES) {
    throw new Error('Control Room evidence file exceeds its size boundary');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new Error('Control Room evidence file is not valid JSON');
  }
  return parseControlRoomHostEvidence(parsed, expectedSourceCommit);
}
