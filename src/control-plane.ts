import type { ControlRoomEvidenceStatus, ControlRoomSnapshot } from './control-room/index.js';

export const CONTROL_PLANE_LIFECYCLE = Object.freeze([
  'AVAILABLE',
  'RECOMMENDED',
  'INSTALLED',
  'CONNECTED',
  'APPROVED',
  'EXECUTABLE',
  'EXECUTED',
  'VERIFIED',
  'UNKNOWN',
  'STALE',
  'FAILED',
  'DISABLED',
] as const);

export type ControlPlaneLifecycle = typeof CONTROL_PLANE_LIFECYCLE[number];

export type ControlPlaneEvidenceStatus = ControlPlaneLifecycle
  | 'NOT_AVAILABLE'
  | 'NOT_EXECUTED'
  | 'PARTIAL';

export type ControlPlaneDomainId =
  | 'capabilities'
  | 'skills'
  | 'mcp'
  | 'agents'
  | 'providers'
  | 'visual-engine'
  | 'fury-link'
  | 'context-fabric'
  | 'memory'
  | 'knowledge'
  | 'learning'
  | 'recovery'
  | 'security'
  | 'evidence'
  | 'sessions'
  | 'settings';

export interface ControlPlaneRuntimeInput {
  readonly port: number;
  readonly uptimeSec: number;
  readonly requests: number;
  readonly compressedRequests: number;
  readonly passthroughRequests: number;
  readonly savedInputTokens: number;
  readonly savedUsd: number;
  readonly compressionEnabled: boolean;
  readonly activeModels: readonly string[];
  readonly modelScopeMode: 'automatic' | 'explicit' | 'off';
}

export interface ControlPlaneRuntime {
  readonly status: ControlPlaneEvidenceStatus;
  readonly port: number;
  readonly uptimeSec: number;
  readonly requests: number;
  readonly compressedRequests: number;
  readonly passthroughRequests: number;
  readonly savedInputTokens: number;
  readonly savedUsd: number;
  readonly compressionEnabled: boolean;
  readonly activeModels: readonly string[];
  readonly modelScopeMode: 'automatic' | 'explicit' | 'off';
}

export interface ControlPlaneDomain {
  readonly id: ControlPlaneDomainId;
  readonly status: ControlPlaneEvidenceStatus;
  readonly lifecycle: readonly ControlPlaneLifecycle[];
  readonly source: string;
  readonly warnings: readonly string[];
}

export interface ControlPlaneEvidenceReference {
  readonly id: string;
  readonly status: ControlPlaneEvidenceStatus;
  readonly sourceSha: string | null;
  readonly evidenceSha: string | null;
  readonly runId: number | null;
  readonly generatedAt: number | null;
}

/** Input retained by an evidence source that can expose its own CI metadata. */
export interface ControlPlaneEvidenceInput {
  readonly id: string;
  readonly status: ControlPlaneEvidenceStatus;
  readonly sourceSha: string | null;
  readonly evidenceSha: string | null;
  readonly runId: number | null;
  readonly generatedAt: number | null;
}

export interface ControlPlaneSnapshot {
  readonly format: 'furypipe-control-plane/v2';
  readonly generatedAt: number;
  readonly sourceCommit: string | null;
  readonly runtime: ControlPlaneRuntime;
  readonly domains: readonly ControlPlaneDomain[];
  readonly evidence: readonly ControlPlaneEvidenceReference[];
  readonly warnings: readonly string[];
}

export interface CreateControlPlaneSnapshotInput {
  readonly generatedAt: number;
  readonly runtime: ControlPlaneRuntimeInput;
  readonly controlRoom: ControlRoomSnapshot | null;
  readonly evidence?: readonly ControlPlaneEvidenceInput[];
}

const SHA40 = /^[0-9a-f]{40}$/u;
const MAX_MODELS = 64;
const MAX_WARNINGS = 32;
const MAX_EVIDENCE = 32;
const MODEL_SCOPE_MODES = new Set(['automatic', 'explicit', 'off']);

function boundedNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} must be a bounded non-negative number`);
  }
  return Math.floor(value);
}

function boundedModels(models: readonly string[]): readonly string[] {
  if (models.length > MAX_MODELS) throw new RangeError(`activeModels exceeds ${MAX_MODELS}`);
  return Object.freeze(models.map((model) => {
    const normalized = model.trim();
    if (!normalized || normalized.length > 160) throw new RangeError('activeModels contains an invalid model');
    return normalized;
  }));
}

function fromControlRoom(status: ControlRoomEvidenceStatus | undefined): ControlPlaneEvidenceStatus {
  switch (status) {
    case 'VERIFIED': return 'VERIFIED';
    case 'PARTIAL': return 'PARTIAL';
    case 'BLOCKED': return 'FAILED';
    case 'NOT_EXECUTED': return 'NOT_EXECUTED';
    case 'NOT_AVAILABLE': return 'NOT_AVAILABLE';
    default: return 'UNKNOWN';
  }
}

function lifecycleFor(status: ControlPlaneEvidenceStatus): readonly ControlPlaneLifecycle[] {
  switch (status) {
    case 'VERIFIED': return Object.freeze(['AVAILABLE', 'EXECUTABLE', 'EXECUTED', 'VERIFIED']);
    case 'EXECUTED': return Object.freeze(['AVAILABLE', 'EXECUTABLE', 'EXECUTED']);
    case 'EXECUTABLE': return Object.freeze(['AVAILABLE', 'EXECUTABLE']);
    case 'AVAILABLE': return Object.freeze(['AVAILABLE']);
    case 'DISABLED': return Object.freeze(['AVAILABLE', 'DISABLED']);
    case 'FAILED': return Object.freeze(['FAILED']);
    case 'STALE': return Object.freeze(['STALE']);
    default: return Object.freeze(['UNKNOWN']);
  }
}

function sectionDomain(
  id: ControlPlaneDomainId,
  source: string,
  status: ControlPlaneEvidenceStatus,
  warnings: readonly string[] = [],
): ControlPlaneDomain {
  return Object.freeze({
    id,
    status,
    lifecycle: lifecycleFor(status),
    source,
    warnings: Object.freeze(warnings.slice(0, MAX_WARNINGS)),
  });
}

function controlRoomSection(
  snapshot: ControlRoomSnapshot | null,
  key: keyof ControlRoomSnapshot['sections'],
): { status: ControlPlaneEvidenceStatus; warnings: readonly string[] } {
  if (!snapshot) return { status: 'NOT_AVAILABLE', warnings: ['control-room-unavailable'] };
  const section = snapshot.sections[key];
  return {
    status: fromControlRoom(section.status),
    warnings: section.warnings.slice(0, MAX_WARNINGS),
  };
}

function sourceCommit(snapshot: ControlRoomSnapshot | null): string | null {
  if (!snapshot) return null;
  return SHA40.test(snapshot.sourceCommit) ? snapshot.sourceCommit : null;
}

function boundedEvidence(
  value: readonly ControlPlaneEvidenceInput[],
  sourceCommit: string | null,
): readonly ControlPlaneEvidenceReference[] {
  if (value.length > MAX_EVIDENCE) throw new RangeError(`evidence exceeds ${MAX_EVIDENCE}`);
  return Object.freeze(value.map((entry) => {
    const id = entry.id.trim();
    if (!id || id.length > 96) throw new RangeError('evidence contains an invalid id');
    const sourceSha = entry.sourceSha === null ? null : (SHA40.test(entry.sourceSha) ? entry.sourceSha : null);
    const evidenceSha = entry.evidenceSha === null ? null : (SHA40.test(entry.evidenceSha) ? entry.evidenceSha : null);
    const mismatchedSource = sourceCommit !== null && sourceSha !== null && sourceSha !== sourceCommit;
    const mismatchedEvidence = sourceCommit !== null && evidenceSha !== null && evidenceSha !== sourceCommit;
    const unboundPositive = sourceCommit === null
      && (entry.status === 'VERIFIED' || entry.status === 'EXECUTED')
      && (sourceSha !== null || evidenceSha !== null);
    const runId = entry.runId === null ? null : boundedNumber(entry.runId, `evidence.${id}.runId`);
    const generatedAt = entry.generatedAt === null ? null : boundedNumber(entry.generatedAt, `evidence.${id}.generatedAt`);
    return Object.freeze({
      id,
      status: mismatchedSource || mismatchedEvidence || unboundPositive ? 'STALE' : entry.status,
      sourceSha,
      evidenceSha,
      runId,
      generatedAt,
    });
  }));
}

function boundedModelScopeMode(value: unknown): 'automatic' | 'explicit' | 'off' {
  if (typeof value === 'string' && MODEL_SCOPE_MODES.has(value)) {
    return value as 'automatic' | 'explicit' | 'off';
  }
  throw new RangeError('runtime.modelScopeMode is invalid');
}

/**
 * Builds a bounded, observation-only projection for dashboard consumers.
 * Missing runtime wiring remains explicit instead of being promoted to a
 * positive lifecycle state.
 */
export function createControlPlaneSnapshot(input: CreateControlPlaneSnapshotInput): ControlPlaneSnapshot {
  const generatedAt = boundedNumber(input.generatedAt, 'generatedAt');
  const runtime: ControlPlaneRuntime = Object.freeze({
    status: 'AVAILABLE',
    port: boundedNumber(input.runtime.port, 'runtime.port'),
    uptimeSec: boundedNumber(input.runtime.uptimeSec, 'runtime.uptimeSec'),
    requests: boundedNumber(input.runtime.requests, 'runtime.requests'),
    compressedRequests: boundedNumber(input.runtime.compressedRequests, 'runtime.compressedRequests'),
    passthroughRequests: boundedNumber(input.runtime.passthroughRequests, 'runtime.passthroughRequests'),
    savedInputTokens: boundedNumber(input.runtime.savedInputTokens, 'runtime.savedInputTokens'),
    savedUsd: Number.isFinite(input.runtime.savedUsd) ? input.runtime.savedUsd : 0,
    compressionEnabled: input.runtime.compressionEnabled,
    activeModels: boundedModels(input.runtime.activeModels),
    modelScopeMode: boundedModelScopeMode(input.runtime.modelScopeMode),
  });
  const controlRoom = input.controlRoom;
  const receipts = controlRoomSection(controlRoom, 'receipts');
  const recovery = controlRoomSection(controlRoom, 'recovery');
  const agent = controlRoomSection(controlRoom, 'agent');
  const learning = controlRoomSection(controlRoom, 'learning');
  const provider = controlRoomSection(controlRoom, 'provider');
  const mcp = controlRoomSection(controlRoom, 'mcp');
  const security = controlRoomSection(controlRoom, 'security');
  const i18n = controlRoomSection(controlRoom, 'i18n');
  const evidenceStatus = controlRoom
    ? controlRoom.overall === 'HEALTHY'
      ? 'VERIFIED'
      : controlRoom.overall === 'BLOCKED'
        ? 'FAILED'
        : 'PARTIAL'
    : 'NOT_AVAILABLE';
  const visualStatus: ControlPlaneEvidenceStatus = runtime.compressionEnabled
    ? (runtime.compressedRequests > 0 ? 'EXECUTED' : 'EXECUTABLE')
    : 'DISABLED';
  const source = sourceCommit(controlRoom);
  const domains: readonly ControlPlaneDomain[] = Object.freeze([
    sectionDomain('capabilities', 'runtime/dashboard', 'AVAILABLE'),
    sectionDomain('skills', 'agent-skill-registry', 'NOT_AVAILABLE', ['no-runtime-skill-registry-observation']),
    sectionDomain('mcp', 'control-room/mcp', mcp.status, mcp.warnings),
    sectionDomain('agents', 'control-room/agent', agent.status, agent.warnings),
    sectionDomain('providers', 'control-room/provider', provider.status, provider.warnings),
    sectionDomain('visual-engine', 'dashboard/runtime', visualStatus),
    sectionDomain('fury-link', 'fury-link-cli', 'AVAILABLE'),
    sectionDomain('context-fabric', 'control-room/receipts', receipts.status, receipts.warnings),
    sectionDomain('memory', 'control-room/recovery', recovery.status, recovery.warnings),
    sectionDomain('knowledge', 'control-room/learning', learning.status, learning.warnings),
    sectionDomain('learning', 'control-room/learning', learning.status, learning.warnings),
    sectionDomain('recovery', 'control-room/recovery', recovery.status, recovery.warnings),
    sectionDomain('security', 'control-room/security', security.status, security.warnings),
    sectionDomain('evidence', 'control-room', evidenceStatus),
    sectionDomain('sessions', 'dashboard/runtime', runtime.requests > 0 ? 'EXECUTED' : 'NOT_EXECUTED'),
    sectionDomain('settings', 'dashboard/read-only', 'AVAILABLE'),
  ]);
  const defaultEvidence: readonly ControlPlaneEvidenceInput[] = Object.freeze([
    Object.freeze({
      id: 'control-room',
      status: evidenceStatus,
      sourceSha: source,
      evidenceSha: source,
      runId: null,
      generatedAt: controlRoom?.generatedAt ?? null,
    }),
    Object.freeze({
      id: 'security',
      status: security.status,
      sourceSha: source,
      evidenceSha: source,
      runId: null,
      generatedAt: controlRoom?.generatedAt ?? null,
    }),
  ]);
  const evidence = boundedEvidence(input.evidence ?? defaultEvidence, source);
  const warnings = controlRoom
    ? Object.freeze(Object.values(controlRoom.sections).flatMap((section) => section.warnings).slice(0, MAX_WARNINGS))
    : Object.freeze(['control-room-unavailable']);
  return Object.freeze({
    format: 'furypipe-control-plane/v2',
    generatedAt,
    sourceCommit: source,
    runtime,
    domains,
    evidence,
    warnings,
  });
}
