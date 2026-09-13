import { createHash, randomUUID } from 'node:crypto';
import {
  AGENT_FABRIC_STAGE_ORDER,
  type AgentFabricPermission,
  type AgentFabricStageId,
} from './agent-fabric.js';
import type { RecoveryStore } from './core/recovery-store.js';
import { compileFuryPrompt, type FuryPromptCompileInput } from './fury-prompt.js';

export type AgentRuntimeStatus = 'completed' | 'failed' | 'handoff_required';
export type AgentSkillHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface AgentSkillHealth {
  readonly status: AgentSkillHealthStatus;
  readonly reason?: string;
}

export interface AgentSkillExecutionContext {
  readonly runId: string;
  readonly stage: AgentFabricStageId;
  readonly objectiveDigest: string;
  readonly permission: AgentFabricPermission;
  readonly allowedWritePaths: readonly string[];
  readonly network: 'disabled';
  readonly secrets: 'never_requested';
}

export interface AgentSkillExecution {
  readonly evidence: readonly string[];
  readonly consumedTokens: number;
}

export interface AgentSkillBatchItem extends AgentSkillExecution {
  readonly id: string;
}

export interface AgentSkillDefinition {
  readonly id: string;
  readonly version: string;
  readonly stages: readonly AgentFabricStageId[];
  readonly permission?: AgentFabricPermission;
  readonly network?: 'disabled' | 'required';
  readonly health?: () => Promise<AgentSkillHealth>;
  readonly execute: (context: AgentSkillExecutionContext) => Promise<AgentSkillExecution>;
}

export interface AgentMcpExecutionContext {
  readonly runId: string;
  readonly stage: AgentFabricStageId;
  readonly objectiveDigest: string;
  readonly network: 'disabled';
  readonly secrets: 'never_requested';
}

export interface AgentMcpServerDefinition {
  readonly id: string;
  readonly allowedMethods: readonly string[];
  readonly network?: 'disabled' | 'required';
  readonly execute: (method: string, params: unknown, context: AgentMcpExecutionContext) => Promise<unknown>;
}

export interface AgentMcpPlannedCall {
  readonly serverId: string;
  readonly method: string;
  readonly params?: unknown;
}

export interface AgentMcpBatchItem extends AgentMcpPlannedCall {
  readonly result: unknown;
}

export interface AgentSubagentExecutionContext {
  readonly runId: string;
  readonly parentStage: AgentFabricStageId;
  readonly objectiveDigest: string;
  readonly permission: AgentFabricPermission;
  readonly allowedWritePaths: readonly string[];
  readonly network: 'disabled';
  readonly secrets: 'never_requested';
}

export interface AgentSubagentExecution {
  readonly evidence: readonly string[];
  readonly consumedTokens: number;
}

export interface AgentSubagentBatchItem extends AgentSubagentExecution {
  readonly id: string;
}

export interface AgentSubagentDefinition {
  readonly id: string;
  readonly stages: readonly AgentFabricStageId[];
  readonly permission?: AgentFabricPermission;
  readonly network?: 'disabled' | 'required';
  readonly execute: (context: AgentSubagentExecutionContext) => Promise<AgentSubagentExecution>;
}

export interface AgentMemoryRecord {
  readonly format: 'furypipe-agent-memory-record/v1';
  readonly runId: string;
  readonly stage: AgentFabricStageId;
  readonly resultDigest: string;
  readonly status: 'completed' | 'handoff_required';
  /** Cumulative budget validation for trustworthy cross-process resume. */
  readonly consumedTokens?: number;
}

export interface AgentMemoryStore {
  append(record: AgentMemoryRecord): Promise<void>;
  list(runId: string): Promise<readonly AgentMemoryRecord[]>;
  /** Atomically claims a one-time run/resume identity across callers. */
  claimExecution?(runId: string, claimId: string): Promise<boolean>;
}

export interface AgentStageExecutionContext {
  readonly runId: string;
  readonly stage: AgentFabricStageId;
  readonly objective: string;
  /** Compiled FuryPrompt when explicitly supplied; objective otherwise. */
  readonly prompt: string;
  readonly objectiveDigest: string;
  readonly permission: AgentFabricPermission;
  readonly allowedWritePaths: readonly string[];
  readonly contextBudgetTokens: number;
  readonly contextUsedTokens: number;
  readonly remainingContextTokens: number;
  readonly network: 'disabled';
  readonly secrets: 'never_requested';
  readonly completedStages: readonly AgentFabricStageId[];
  /** Skills selected by FuryPipe's capability router and executed before this stage. */
  readonly autoSkillExecutions: readonly AgentSkillBatchItem[];
  /** MCP calls selected by FuryPipe and executed before this stage. */
  readonly autoMcpExecutions: readonly AgentMcpBatchItem[];
  readonly invokeSkill: (skillId: string) => Promise<AgentSkillExecution>;
  readonly invokeMcp: (serverId: string, method: string, params?: unknown) => Promise<unknown>;
  readonly invokeSubagent: (subagentId: string) => Promise<AgentSubagentExecution>;
  readonly invokeSubagents: (subagentIds: readonly string[]) => Promise<readonly AgentSubagentBatchItem[]>;
}

export interface AgentStageResult {
  readonly status?: 'completed' | 'failed' | 'handoff_required';
  readonly evidence: readonly string[];
  readonly consumedTokens: number;
  readonly summary?: string;
}

export type AgentStageExecutor = (context: AgentStageExecutionContext) => Promise<AgentStageResult>;

export interface AgentRuntimeRequest {
  readonly objective: string;
  /** Optional structured prompt compiled once for this run. */
  readonly furyPrompt?: FuryPromptCompileInput;
  readonly contextBudgetTokens?: number;
  readonly allowWrites?: boolean;
  readonly allowedWritePaths?: readonly string[];
  readonly runId?: string;
  readonly executors: Partial<Record<AgentFabricStageId, AgentStageExecutor>>;
  readonly skills?: readonly AgentSkillDefinition[];
  /**
   * Optional deterministic skill schedule produced by the capability router.
   * Scheduled skills execute once before the owning stage executor.
   */
  readonly autoInvokeSkillsByStage?: Readonly<Partial<Record<AgentFabricStageId, readonly string[]>>>;
  /** Planned MCP calls. Each call still passes the runtime server/method allowlist. */
  readonly autoInvokeMcpByStage?: Readonly<Partial<Record<AgentFabricStageId, readonly AgentMcpPlannedCall[]>>>;
  readonly mcpServers?: readonly AgentMcpServerDefinition[];
  readonly subagents?: readonly AgentSubagentDefinition[];
  /** Maximum simultaneous subagent callbacks within one stage. Default 4, hard max 8. */
  readonly maxSubagentConcurrency?: number;
  readonly memory?: AgentMemoryStore;
}

export interface AgentRunSnapshot {
  readonly format: 'furypipe-agent-run-snapshot/v1';
  readonly runId: string;
  readonly objectiveDigest: string;
  readonly nextStageIndex: number;
  readonly completedStages: readonly AgentFabricStageId[];
  readonly contextUsedTokens: number;
  /** Digest of the explicit FuryPrompt used by the suspended run. */
  readonly furyPromptDigest?: string;
}

export interface AgentRunFailure {
  readonly stage?: AgentFabricStageId;
  readonly code:
    | 'INVALID_REQUEST'
    | 'MISSING_EXECUTOR'
    | 'MISSING_EVIDENCE'
    | 'CONTEXT_BUDGET_EXCEEDED'
    | 'SKILL_BLOCKED'
    | 'MCP_BLOCKED'
    | 'SUBAGENT_BLOCKED'
    | 'STAGE_FAILED'
    | 'MEMORY_FAILED'
    | 'INVALID_SNAPSHOT';
  readonly reason: string;
}

export interface AgentRunResult {
  readonly format: 'furypipe-agent-run/v1';
  readonly status: AgentRuntimeStatus;
  readonly runId: string;
  readonly objectiveDigest: string;
  readonly completedStages: readonly AgentFabricStageId[];
  readonly contextUsedTokens: number;
  readonly skillHealth: Readonly<Record<string, AgentSkillHealthStatus>>;
  readonly snapshot?: AgentRunSnapshot;
  readonly failure?: AgentRunFailure;
}

const DEFAULT_CONTEXT_BUDGET = 16_000;
const MIN_CONTEXT_BUDGET = 256;
const MAX_CONTEXT_BUDGET = 200_000;
const MAX_EVIDENCE_ITEMS = 64;
const MAX_EVIDENCE_LENGTH = 512;
const DEFAULT_SUBAGENT_CONCURRENCY = 4;
const MAX_SUBAGENT_CONCURRENCY = 8;
const MAX_SUBAGENT_BATCH = 16;

function digest(value: string): string {
  return `afrun_${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24)}`;
}

function validSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateEvidence(evidence: unknown): evidence is readonly string[] {
  return Array.isArray(evidence) && evidence.length > 0 && evidence.length <= MAX_EVIDENCE_ITEMS && evidence.every((item) =>
    typeof item === 'string' && item.length > 0 && item.length <= MAX_EVIDENCE_LENGTH && !item.includes('\0'));
}


function jsonBounded(value: unknown, maxBytes = 65_536): boolean {
  try {
    const encoded = JSON.stringify(value ?? null);
    return typeof encoded === 'string' && Buffer.byteLength(encoded, 'utf8') <= maxBytes;
  } catch {
    return false;
  }
}

function validatePlannedMcpCall(value: unknown): value is AgentMcpPlannedCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const call = value as Partial<AgentMcpPlannedCall>;
  return typeof call.serverId === 'string'
    && call.serverId.length > 0
    && call.serverId.length <= 256
    && !call.serverId.includes('\0')
    && typeof call.method === 'string'
    && call.method.length > 0
    && call.method.length <= 256
    && !call.method.includes('\0')
    && jsonBounded(call.params);
}

function mcpCallKey(call: AgentMcpPlannedCall): string {
  return call.serverId + '\0' + call.method + '\0' + JSON.stringify(call.params ?? null);
}

function validateRequest(request: AgentRuntimeRequest): AgentRunFailure | undefined {
  if (!request || typeof request !== 'object' || typeof request.objective !== 'string' || !request.objective.trim()) {
    return { code: 'INVALID_REQUEST', reason: 'agent objective must not be empty' };
  }
  if (request.runId !== undefined && (typeof request.runId !== 'string' || request.runId.length === 0
    || request.runId.length > MAX_AGENT_MEMORY_RUN_ID || request.runId.includes('\0'))) {
    return { code: 'INVALID_REQUEST', reason: 'agent run ID is invalid or exceeds its bound' };
  }
  const budget = request.contextBudgetTokens ?? DEFAULT_CONTEXT_BUDGET;
  if (!Number.isSafeInteger(budget) || budget < MIN_CONTEXT_BUDGET || budget > MAX_CONTEXT_BUDGET) {
    return { code: 'INVALID_REQUEST', reason: `agent context budget must be between ${MIN_CONTEXT_BUDGET} and ${MAX_CONTEXT_BUDGET}` };
  }
  if (request.allowWrites === true && (!request.allowedWritePaths || request.allowedWritePaths.length === 0)) {
    return { code: 'INVALID_REQUEST', reason: 'scoped write mode requires at least one allowed path' };
  }
  if (request.allowedWritePaths !== undefined && (!Array.isArray(request.allowedWritePaths)
    || request.allowedWritePaths.some((path) => typeof path !== 'string' || !path || path.length > 1024 || path.includes('\0')))) {
    return { code: 'INVALID_REQUEST', reason: 'allowed write paths must be bounded non-empty strings' };
  }
  if (!request.executors || typeof request.executors !== 'object') {
    return { code: 'INVALID_REQUEST', reason: 'agent stage executors are required' };
  }
  if (request.skills !== undefined && !Array.isArray(request.skills)) return { code: 'INVALID_REQUEST', reason: 'agent skills must be an array' };
  if (request.autoInvokeSkillsByStage !== undefined) {
    if (!request.autoInvokeSkillsByStage || typeof request.autoInvokeSkillsByStage !== 'object' || Array.isArray(request.autoInvokeSkillsByStage)) {
      return { code: 'INVALID_REQUEST', reason: 'autoInvokeSkillsByStage must be a stage map' };
    }
    for (const [rawStage, rawIds] of Object.entries(request.autoInvokeSkillsByStage)) {
      if (!AGENT_FABRIC_STAGE_ORDER.includes(rawStage as AgentFabricStageId)
        || !Array.isArray(rawIds)
        || rawIds.length > 32
        || rawIds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 256 || id.includes('\0'))
        || new Set(rawIds).size !== rawIds.length) {
        return { code: 'INVALID_REQUEST', reason: 'autoInvokeSkillsByStage contains an invalid stage or skill list' };
      }
    }
  }
  if (request.autoInvokeMcpByStage !== undefined) {
    if (!request.autoInvokeMcpByStage || typeof request.autoInvokeMcpByStage !== 'object' || Array.isArray(request.autoInvokeMcpByStage)) {
      return { code: 'INVALID_REQUEST', reason: 'autoInvokeMcpByStage must be a stage map' };
    }
    for (const [rawStage, rawCalls] of Object.entries(request.autoInvokeMcpByStage)) {
      if (!AGENT_FABRIC_STAGE_ORDER.includes(rawStage as AgentFabricStageId)
        || !Array.isArray(rawCalls)
        || rawCalls.length > 32
        || rawCalls.some((call) => !validatePlannedMcpCall(call))) {
        return { code: 'INVALID_REQUEST', reason: 'autoInvokeMcpByStage contains an invalid stage or MCP call list' };
      }
      const keys = rawCalls.map((call) => mcpCallKey(call));
      if (new Set(keys).size !== keys.length) {
        return { code: 'INVALID_REQUEST', reason: 'autoInvokeMcpByStage contains duplicate calls' };
      }
    }
  }
  if (request.mcpServers !== undefined && !Array.isArray(request.mcpServers)) return { code: 'INVALID_REQUEST', reason: 'agent MCP servers must be an array' };
  if (request.subagents !== undefined && !Array.isArray(request.subagents)) return { code: 'INVALID_REQUEST', reason: 'agent subagents must be an array' };
  const subagentConcurrency = request.maxSubagentConcurrency ?? DEFAULT_SUBAGENT_CONCURRENCY;
  if (!Number.isSafeInteger(subagentConcurrency) || subagentConcurrency < 1 || subagentConcurrency > MAX_SUBAGENT_CONCURRENCY) {
    return { code: 'INVALID_REQUEST', reason: `maxSubagentConcurrency must be between 1 and ${MAX_SUBAGENT_CONCURRENCY}` };
  }
  return undefined;
}

async function mapBoundedOrdered<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failure: unknown;

  const runWorker = async (): Promise<void> => {
    while (failure === undefined) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]!, index);
      } catch (caught) {
        failure = caught;
        return;
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  if (failure !== undefined) throw failure;
  return Object.freeze(results);
}

function snapshotFor(
  runId: string,
  objectiveDigest: string,
  nextStageIndex: number,
  completedStages: readonly AgentFabricStageId[],
  contextUsedTokens: number,
  furyPromptDigest?: string,
): AgentRunSnapshot {
  return {
    format: 'furypipe-agent-run-snapshot/v1',
    runId,
    objectiveDigest,
    nextStageIndex,
    completedStages: [...completedStages],
    contextUsedTokens,
    ...(furyPromptDigest === undefined ? {} : { furyPromptDigest }),
  };
}

export function createInMemoryAgentMemoryStore(): AgentMemoryStore {
  const records = new Map<string, AgentMemoryRecord[]>();
  const claims = new Set<string>();
  let recordCount = 0;
  return {
    async append(record) {
      if (!validatePersistedRecord(record)) throw new Error('agent memory record is invalid');
      const existing = records.get(record.runId) ?? [];
      if (existing.length >= MAX_AGENT_MEMORY_RECORDS || recordCount >= MAX_IN_MEMORY_AGENT_RECORDS) {
        throw new Error('agent memory record limit exceeded');
      }
      existing.push(Object.freeze({ ...record }));
      records.set(record.runId, existing);
      recordCount += 1;
    },
    async list(runId) {
      validateMemoryRunId(runId);
      return [...(records.get(runId) ?? [])];
    },
    async claimExecution(runId, claimId) {
      validateMemoryRunId(runId);
      if (typeof claimId !== 'string' || claimId.length === 0 || claimId.length > 256 || claimId.includes('\0')) {
        throw new Error('agent memory execution claim is invalid');
      }
      const key = `${runId}\0${claimId}`;
      if (claims.has(key)) return false;
      if (claims.size >= MAX_IN_MEMORY_AGENT_CLAIMS) throw new Error('agent memory execution claim limit exceeded');
      claims.add(key);
      return true;
    },
  };
}

const AGENT_MEMORY_SOURCE = 'agent-runtime';
const AGENT_MEMORY_CONTENT_TYPE = 'application/vnd.furypipe.agent-memory-record+json';
const AGENT_MEMORY_CLAIM_SOURCE = 'agent-runtime-claim';
const AGENT_MEMORY_CLAIM_CONTENT_TYPE = 'application/vnd.furypipe.agent-memory-claim+json';
const MAX_AGENT_MEMORY_RUN_ID = 256;
const MAX_AGENT_MEMORY_DIGEST = 256;
const MAX_AGENT_MEMORY_RECORDS = 10_000;
const MAX_IN_MEMORY_AGENT_RECORDS = 10_000;
const MAX_IN_MEMORY_AGENT_CLAIMS = 10_000;

interface AgentMemoryEnvelope {
  readonly format: 'furypipe-agent-memory-envelope/v1';
  readonly sequence?: number;
  readonly record: AgentMemoryRecord;
}

function validatePersistedRecord(value: unknown): value is AgentMemoryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AgentMemoryRecord>;
  return record.format === 'furypipe-agent-memory-record/v1'
    && typeof record.runId === 'string' && record.runId.length > 0 && record.runId.length <= MAX_AGENT_MEMORY_RUN_ID && !record.runId.includes('\0')
    && AGENT_FABRIC_STAGE_ORDER.includes(record.stage as AgentFabricStageId)
    && typeof record.resultDigest === 'string' && record.resultDigest.length > 0 && record.resultDigest.length <= MAX_AGENT_MEMORY_DIGEST && !record.resultDigest.includes('\0')
    && (record.consumedTokens === undefined || validSafeInteger(record.consumedTokens))
    && (record.status === 'completed' || record.status === 'handoff_required');
}

function validateMemoryRunId(runId: string): void {
  if (typeof runId !== 'string' || runId.length === 0 || runId.length > MAX_AGENT_MEMORY_RUN_ID || runId.includes('\0')) {
    throw new Error('agent memory run ID is invalid or exceeds its bound');
  }
}

/**
 * Recovery-backed metadata memory for cross-process agent handoff. Only the
 * opaque stage result record is stored; objectives, prompts and evidence text
 * are intentionally absent from the persisted payload.
 */
export function createRecoveryAgentMemoryStore(store: RecoveryStore): AgentMemoryStore {
  if (typeof store.list !== 'function') throw new Error('Recovery store does not support bounded manifest listing');
  const listManifests = store.list.bind(store);
  return {
    async append(record) {
      validateMemoryRunId(record.runId);
      if (!validatePersistedRecord(record)) throw new Error('agent memory record is invalid');
      const existing = [...await listManifests({
        limit: MAX_AGENT_MEMORY_RECORDS,
        metadata: { source: AGENT_MEMORY_SOURCE, contentType: AGENT_MEMORY_CONTENT_TYPE, runId: record.runId },
      })];
      if (existing.length >= MAX_AGENT_MEMORY_RECORDS) throw new Error('agent memory record limit exceeded');
      existing.sort((left, right) => Number(left.metadata?.sequence) - Number(right.metadata?.sequence));
      if (existing.some((handle, index) => handle.metadata?.sequence !== index)) {
        throw new Error('agent memory record ordering is invalid');
      }
      const sequence = existing.length;
      const envelope: AgentMemoryEnvelope = { format: 'furypipe-agent-memory-envelope/v1', sequence, record: { ...record } };
      await store.put(new TextEncoder().encode(JSON.stringify(envelope)), {
        source: AGENT_MEMORY_SOURCE,
        contentType: AGENT_MEMORY_CONTENT_TYPE,
        runId: record.runId,
        stage: record.stage,
        sequence,
      });
    },
    async list(runId) {
      validateMemoryRunId(runId);
      const handles = [...await listManifests({
        limit: MAX_AGENT_MEMORY_RECORDS,
        metadata: { source: AGENT_MEMORY_SOURCE, contentType: AGENT_MEMORY_CONTENT_TYPE, runId },
      })];
      if (handles.length >= MAX_AGENT_MEMORY_RECORDS) throw new Error('agent memory record listing reached its safety limit');
      handles.sort((left, right) => {
        const a = left.metadata?.sequence;
        const b = right.metadata?.sequence;
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        if (typeof a === 'number') return -1;
        if (typeof b === 'number') return 1;
        return left.digest.localeCompare(right.digest);
      });
      const records: AgentMemoryRecord[] = [];
      for (const handle of handles) {
        let envelope: unknown;
        try {
          envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await store.get(handle)));
        } catch {
          throw new Error('agent memory record cannot be decoded');
        }
        if (!envelope || typeof envelope !== 'object' || (envelope as Partial<AgentMemoryEnvelope>).format !== 'furypipe-agent-memory-envelope/v1'
          || !validatePersistedRecord((envelope as Partial<AgentMemoryEnvelope>).record)
          || (envelope as AgentMemoryEnvelope).record.runId !== runId) {
          throw new Error('agent memory record is invalid');
        }
        const sequence = (envelope as Partial<AgentMemoryEnvelope>).sequence;
        if (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence !== records.length
          || handle.metadata?.sequence !== sequence)) {
          throw new Error('agent memory record ordering is invalid');
        }
        records.push({ ...(envelope as AgentMemoryEnvelope).record });
      }
      return records;
    },
    async claimExecution(runId, claimId) {
      validateMemoryRunId(runId);
      if (typeof claimId !== 'string' || claimId.length === 0 || claimId.length > 256 || claimId.includes('\0')) {
        throw new Error('agent memory execution claim is invalid');
      }
      const identity = createHash('sha256').update(`${runId}\0${claimId}`, 'utf8').digest('hex');
      const claimToken = randomUUID();
      const bytes = new TextEncoder().encode(`furypipe-agent-memory-claim/v1\0${identity}`);
      const handle = await store.put(bytes, {
        source: AGENT_MEMORY_CLAIM_SOURCE,
        contentType: AGENT_MEMORY_CLAIM_CONTENT_TYPE,
        runId,
        claimDigest: identity,
        claimToken,
      });
      return handle.metadata?.claimToken === claimToken;
    },
  };
}

function historyMatchesSnapshot(records: readonly AgentMemoryRecord[], runId: string, snapshot: AgentRunSnapshot): boolean {
  if (!Array.isArray(records) || records.length === 0 || records.length >= MAX_AGENT_MEMORY_RECORDS) return false;
  let nextStageIndex = 0;
  let contextUsedTokens = 0;
  for (const record of records) {
    if (!validatePersistedRecord(record) || record.runId !== runId || record.consumedTokens === undefined
      || AGENT_FABRIC_STAGE_ORDER[nextStageIndex] !== record.stage) return false;
    if (contextUsedTokens + record.consumedTokens > Number.MAX_SAFE_INTEGER) return false;
    contextUsedTokens += record.consumedTokens;
    if (record.status === 'completed') nextStageIndex += 1;
  }
  const last = records.at(-1);
  return last?.status === 'handoff_required'
    && snapshot.nextStageIndex === nextStageIndex
    && snapshot.contextUsedTokens === contextUsedTokens
    && snapshot.completedStages.length === nextStageIndex
    && snapshot.completedStages.every((stage, index) => stage === AGENT_FABRIC_STAGE_ORDER[index]);
}

function snapshotHasExactShape(snapshot: AgentRunSnapshot): boolean {
  const keys = Object.keys(snapshot).sort();
  const expected = [
    'format', 'runId', 'objectiveDigest', 'nextStageIndex', 'completedStages', 'contextUsedTokens',
    ...(snapshot.furyPromptDigest === undefined ? [] : ['furyPromptDigest']),
  ].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function snapshotClaimDigest(snapshot: AgentRunSnapshot): string {
  return createHash('sha256').update(JSON.stringify({
    format: snapshot.format,
    runId: snapshot.runId,
    objectiveDigest: snapshot.objectiveDigest,
    nextStageIndex: snapshot.nextStageIndex,
    completedStages: snapshot.completedStages,
    contextUsedTokens: snapshot.contextUsedTokens,
    ...(snapshot.furyPromptDigest === undefined ? {} : { furyPromptDigest: snapshot.furyPromptDigest }),
  }), 'utf8').digest('hex');
}

/**
 * Execute the Agent Fabric stage contract with host-provided executors.
 * The runtime itself owns sequencing, permissions, budgets and gates; it does
 * not provide a shell, ambient network, credentials, or an implicit model.
 */
export async function runAgent(request: AgentRuntimeRequest, resumeFrom?: AgentRunSnapshot): Promise<AgentRunResult> {
  const invalid = validateRequest(request);
  const skillHealth: Record<string, AgentSkillHealthStatus> = {};
  if (invalid) {
    return {
      format: 'furypipe-agent-run/v1', status: 'failed', runId: request?.runId ?? 'invalid', objectiveDigest: 'invalid',
      completedStages: [], contextUsedTokens: 0, skillHealth, failure: invalid,
    };
  }

  const budget = request.contextBudgetTokens ?? DEFAULT_CONTEXT_BUDGET;
  const objectiveDigest = digest(request.objective);
  const runId = request.runId ?? resumeFrom?.runId ?? randomUUID();
  let furyPrompt: ReturnType<typeof compileFuryPrompt> | undefined;
  try {
    if (request.furyPrompt !== undefined) furyPrompt = compileFuryPrompt(request.furyPrompt);
  } catch (caught) {
    return {
      format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
      completedStages: [], contextUsedTokens: 0, skillHealth,
      failure: { code: 'INVALID_REQUEST', reason: `FuryPrompt compilation failed: ${caught instanceof Error ? caught.message : String(caught)}` },
    };
  }
  const prompt = furyPrompt?.prompt ?? request.objective;
  const furyPromptDigest = furyPrompt?.promptDigest;
  const skills = new Map<string, AgentSkillDefinition>();
  for (const skill of request.skills ?? []) {
    if (!skill || typeof skill !== 'object' || typeof skill.id !== 'string' || !skill.id || typeof skill.execute !== 'function' || skills.has(skill.id)) {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages: [], contextUsedTokens: 0, skillHealth, failure: { code: 'INVALID_REQUEST', reason: 'skill IDs must be unique and non-empty' },
      };
    }
    skills.set(skill.id, skill);
  }
  const mcpServers = new Map<string, AgentMcpServerDefinition>();
  for (const server of request.mcpServers ?? []) {
    if (!server || typeof server !== 'object' || typeof server.id !== 'string' || !server.id || typeof server.execute !== 'function' || mcpServers.has(server.id)) {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages: [], contextUsedTokens: 0, skillHealth, failure: { code: 'INVALID_REQUEST', reason: 'MCP server IDs must be unique and non-empty' },
      };
    }
    mcpServers.set(server.id, server);
  }
  const subagents = new Map<string, AgentSubagentDefinition>();
  for (const subagent of request.subagents ?? []) {
    if (!subagent || typeof subagent !== 'object' || typeof subagent.id !== 'string' || !subagent.id || typeof subagent.execute !== 'function' || subagents.has(subagent.id)) {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages: [], contextUsedTokens: 0, skillHealth, failure: { code: 'INVALID_REQUEST', reason: 'subagent IDs must be unique and non-empty' },
      };
    }
    subagents.set(subagent.id, subagent);
  }

  let nextStageIndex = 0;
  let completedStages: AgentFabricStageId[] = [];
  let contextUsedTokens = 0;
  if (resumeFrom !== undefined) {
    if (!resumeFrom || typeof resumeFrom !== 'object'
      || !snapshotHasExactShape(resumeFrom)
      || resumeFrom.format !== 'furypipe-agent-run-snapshot/v1'
      || typeof resumeFrom.runId !== 'string' || resumeFrom.runId !== runId
      || resumeFrom.objectiveDigest !== objectiveDigest
      || !Number.isSafeInteger(resumeFrom.nextStageIndex)
      || resumeFrom.nextStageIndex < 0
      || resumeFrom.nextStageIndex >= AGENT_FABRIC_STAGE_ORDER.length
      || !validSafeInteger(resumeFrom.contextUsedTokens)
      || resumeFrom.contextUsedTokens > budget
      || resumeFrom.furyPromptDigest !== furyPromptDigest
      || !Array.isArray(resumeFrom.completedStages)
      || resumeFrom.completedStages.length !== resumeFrom.nextStageIndex
      || resumeFrom.completedStages.some((stage, index) => AGENT_FABRIC_STAGE_ORDER[index] !== stage)) {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages: [], contextUsedTokens: 0, skillHealth,
        failure: { code: 'INVALID_SNAPSHOT', reason: 'agent handoff snapshot is invalid for this objective or budget' },
      };
    }
    nextStageIndex = resumeFrom.nextStageIndex;
    completedStages = [...resumeFrom.completedStages];
    contextUsedTokens = resumeFrom.contextUsedTokens;
  }

  const memory = request.memory ?? createInMemoryAgentMemoryStore();
  let memoryRecords: readonly AgentMemoryRecord[];
  try {
    memoryRecords = await memory.list(runId);
    if (!Array.isArray(memoryRecords) || memoryRecords.length >= MAX_AGENT_MEMORY_RECORDS) {
      throw new Error('agent memory listing is invalid or exceeds its safety limit');
    }
  } catch {
    return {
      format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
      completedStages, contextUsedTokens, skillHealth,
      failure: { code: 'MEMORY_FAILED', reason: 'agent memory could not be opened' },
    };
  }
  if (resumeFrom === undefined && memoryRecords.length > 0) {
    return {
      format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
      completedStages: [], contextUsedTokens: 0, skillHealth,
      failure: { code: 'INVALID_REQUEST', reason: 'agent run ID already has stage history; a valid handoff snapshot is required' },
    };
  }
  if (resumeFrom !== undefined && !historyMatchesSnapshot(memoryRecords, runId, resumeFrom)) {
    return {
      format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
      completedStages: [], contextUsedTokens: 0, skillHealth,
      failure: { code: 'INVALID_SNAPSHOT', reason: 'agent handoff snapshot does not match persisted stage history or budget' },
    };
  }
  if (typeof memory.claimExecution !== 'function') {
    return {
      format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
      completedStages, contextUsedTokens, skillHealth,
      failure: { code: 'MEMORY_FAILED', reason: 'agent memory does not support atomic one-time execution claims' },
    };
  }
  let claimed: boolean;
  try {
    const claimId = resumeFrom === undefined ? 'start' : `resume:${snapshotClaimDigest(resumeFrom)}`;
    claimed = await memory.claimExecution(runId, claimId);
    if (typeof claimed !== 'boolean') throw new Error('agent execution claim result is invalid');
  } catch {
    return {
      format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
      completedStages, contextUsedTokens, skillHealth,
      failure: { code: 'MEMORY_FAILED', reason: 'agent execution claim could not be recorded' },
    };
  }
  if (!claimed) {
    return {
      format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
      completedStages: [], contextUsedTokens: 0, skillHealth,
      failure: { code: resumeFrom === undefined ? 'INVALID_REQUEST' : 'INVALID_SNAPSHOT',
        reason: 'agent run or handoff snapshot has already been claimed' },
    };
  }

  const invokeSkill = async (stage: AgentFabricStageId, skillId: string): Promise<AgentSkillExecution> => {
    const skill = skills.get(skillId);
    if (!skill || !skill.stages.includes(stage)) throw new Error(`skill is not available for stage: ${skillId}`);
    if (skill.network === 'required') throw new Error(`skill network access is disabled: ${skillId}`);
    const permission = skill.permission ?? 'read';
    if (permission === 'scoped-write' && (request.allowWrites !== true || stage !== 'implement')) {
      throw new Error(`skill write permission is not allowed at stage: ${skillId}`);
    }
    let health: AgentSkillHealth = { status: 'unknown' };
    if (skill.health) health = await skill.health();
    if (!health || !['healthy', 'degraded', 'unhealthy', 'unknown'].includes(health.status)) {
      throw new Error(`skill health is invalid: ${skillId}`);
    }
    skillHealth[skill.id] = health.status;
    if (health.status === 'unhealthy') throw new Error(`skill health is unhealthy: ${skillId}`);
    const result = await skill.execute({
      runId, stage, objectiveDigest, permission,
      allowedWritePaths: permission === 'scoped-write' ? [...(request.allowedWritePaths ?? [])] : [],
      network: 'disabled', secrets: 'never_requested',
    });
    if (!result || !validateEvidence(result.evidence) || !validSafeInteger(result.consumedTokens)) throw new Error(`skill result is invalid: ${skillId}`);
    return result;
  };

  const invokeMcp = async (stage: AgentFabricStageId, serverId: string, method: string, params?: unknown): Promise<unknown> => {
    const server = mcpServers.get(serverId);
    if (!server || !server.allowedMethods.includes(method)) throw new Error(`MCP method is not permitted: ${serverId}/${method}`);
    if (server.network === 'required') throw new Error(`MCP network access is disabled: ${serverId}`);
    return server.execute(method, params, { runId, stage, objectiveDigest, network: 'disabled', secrets: 'never_requested' });
  };

  const invokeSubagent = async (stage: AgentFabricStageId, subagentId: string): Promise<AgentSubagentExecution> => {
    const subagent = subagents.get(subagentId);
    if (!subagent || !subagent.stages.includes(stage)) throw new Error(`subagent is not available for stage: ${subagentId}`);
    if (subagent.network === 'required') throw new Error(`subagent network access is disabled: ${subagentId}`);
    const permission = subagent.permission ?? 'read';
    if (permission === 'scoped-write' && (request.allowWrites !== true || stage !== 'implement')) {
      throw new Error(`subagent write permission is not allowed at stage: ${subagentId}`);
    }
    const result = await subagent.execute({
      runId, parentStage: stage, objectiveDigest, permission,
      allowedWritePaths: permission === 'scoped-write' ? [...(request.allowedWritePaths ?? [])] : [],
      network: 'disabled', secrets: 'never_requested',
    });
    if (!result || !validateEvidence(result.evidence) || !validSafeInteger(result.consumedTokens)) throw new Error(`subagent result is invalid: ${subagentId}`);
    return result;
  };

  for (; nextStageIndex < AGENT_FABRIC_STAGE_ORDER.length; nextStageIndex += 1) {
    const stage = AGENT_FABRIC_STAGE_ORDER[nextStageIndex]!;
    const executor = request.executors[stage];
    if (!executor) {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages, contextUsedTokens, skillHealth,
        failure: { code: 'MISSING_EXECUTOR', stage, reason: `no executor registered for stage: ${stage}` },
      };
    }
    const permission: AgentFabricPermission = stage === 'implement' && request.allowWrites === true ? 'scoped-write' : 'read';
    let nestedConsumedTokens = 0;
    let result: AgentStageResult;
    try {
      const stageSkillCache = new Map<string, AgentSkillExecution>();
      const stageMcpCache = new Map<string, Promise<unknown>>();
      const invokeSkillForStage = async (skillId: string): Promise<AgentSkillExecution> => {
        const cached = stageSkillCache.get(skillId);
        if (cached) return cached;
        const skillResult = await invokeSkill(stage, skillId);
        nestedConsumedTokens += skillResult.consumedTokens;
        stageSkillCache.set(skillId, skillResult);
        return skillResult;
      };
      const invokeMcpForStage = async (serverId: string, method: string, params?: unknown): Promise<unknown> => {
        const call: AgentMcpPlannedCall = { serverId, method, ...(params === undefined ? {} : { params }) };
        if (!validatePlannedMcpCall(call)) throw new Error('MCP planned call is invalid');
        const key = mcpCallKey(call);
        const cached = stageMcpCache.get(key);
        if (cached) return cached;
        const pending = invokeMcp(stage, serverId, method, params);
        stageMcpCache.set(key, pending);
        try {
          return await pending;
        } catch (caught) {
          if (stageMcpCache.get(key) === pending) stageMcpCache.delete(key);
          throw caught;
        }
      };
      const invokeSubagentForStage = async (subagentId: string): Promise<AgentSubagentExecution> => {
        const subagentResult = await invokeSubagent(stage, subagentId);
        nestedConsumedTokens += subagentResult.consumedTokens;
        return subagentResult;
      };
      const invokeSubagentsForStage = async (subagentIds: readonly string[]): Promise<readonly AgentSubagentBatchItem[]> => {
        if (!Array.isArray(subagentIds) || subagentIds.length < 1 || subagentIds.length > MAX_SUBAGENT_BATCH
          || subagentIds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 256 || id.includes('\0'))) {
          throw new Error(`subagent batch must contain between 1 and ${MAX_SUBAGENT_BATCH} bounded IDs`);
        }
        if (new Set(subagentIds).size !== subagentIds.length) throw new Error('subagent batch IDs must be unique');
        const concurrency = request.maxSubagentConcurrency ?? DEFAULT_SUBAGENT_CONCURRENCY;
        return mapBoundedOrdered(subagentIds, concurrency, async (subagentId) => {
          const execution = await invokeSubagentForStage(subagentId);
          return Object.freeze({ id: subagentId, ...execution });
        });
      };
      const autoSkillExecutions: AgentSkillBatchItem[] = [];
      for (const skillId of request.autoInvokeSkillsByStage?.[stage] ?? []) {
        const execution = await invokeSkillForStage(skillId);
        autoSkillExecutions.push(Object.freeze({ id: skillId, ...execution }));
      }
      const autoMcpExecutions: AgentMcpBatchItem[] = [];
      for (const call of request.autoInvokeMcpByStage?.[stage] ?? []) {
        const mcpResult = await invokeMcpForStage(call.serverId, call.method, call.params);
        autoMcpExecutions.push(Object.freeze({ ...call, result: mcpResult }));
      }
      result = await executor({
        runId, stage, objective: request.objective, prompt, objectiveDigest, permission,
        allowedWritePaths: request.allowWrites === true ? [...(request.allowedWritePaths ?? [])] : [],
        contextBudgetTokens: budget, contextUsedTokens, remainingContextTokens: budget - contextUsedTokens,
        network: 'disabled', secrets: 'never_requested', completedStages: [...completedStages],
        autoSkillExecutions: Object.freeze(autoSkillExecutions),
        autoMcpExecutions: Object.freeze(autoMcpExecutions),
        invokeSkill: invokeSkillForStage,
        invokeMcp: invokeMcpForStage,
        invokeSubagent: invokeSubagentForStage,
        invokeSubagents: invokeSubagentsForStage,
      });
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : 'agent stage execution failed';
      const code = reason.startsWith('skill ')
        ? 'SKILL_BLOCKED'
        : reason.startsWith('MCP ')
          ? 'MCP_BLOCKED'
          : reason.startsWith('subagent ')
            ? 'SUBAGENT_BLOCKED'
            : 'STAGE_FAILED';
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages, contextUsedTokens, skillHealth, failure: { code, stage, reason },
      };
    }
    if (!result || typeof result !== 'object' || !validSafeInteger(result.consumedTokens)
      || !['completed', 'failed', 'handoff_required', undefined].includes(result.status)) {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages, contextUsedTokens, skillHealth,
        failure: { code: 'STAGE_FAILED', stage, reason: 'agent stage returned an invalid result' },
      };
    }
    const consumedTokens = result.consumedTokens + nestedConsumedTokens;
    if (!validSafeInteger(consumedTokens) || contextUsedTokens + consumedTokens > budget) {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages, contextUsedTokens, skillHealth,
        failure: { code: 'CONTEXT_BUDGET_EXCEEDED', stage, reason: 'agent context budget exceeded' },
      };
    }
    contextUsedTokens += consumedTokens;
    if (!validateEvidence(result.evidence)) {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages, contextUsedTokens, skillHealth,
        failure: { code: 'MISSING_EVIDENCE', stage, reason: 'each completed stage requires bounded evidence' },
      };
    }
    if (result.status === 'failed') {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages, contextUsedTokens, skillHealth,
        failure: { code: 'STAGE_FAILED', stage, reason: result.summary ?? 'agent stage reported failure' },
      };
    }
    const resultDigest = digest(JSON.stringify({ stage, status: result.status ?? 'completed', evidence: result.evidence, consumedTokens }));
    const memoryRecord: AgentMemoryRecord = {
      format: 'furypipe-agent-memory-record/v1', runId, stage, resultDigest,
      status: result.status === 'handoff_required' ? 'handoff_required' : 'completed',
      consumedTokens,
    };
    try {
      await memory.append(memoryRecord);
    } catch {
      return {
        format: 'furypipe-agent-run/v1', status: 'failed', runId, objectiveDigest,
        completedStages, contextUsedTokens, skillHealth,
        failure: { code: 'MEMORY_FAILED', stage, reason: 'agent stage result could not be recorded' },
      };
    }
    if (result.status === 'handoff_required') {
      return {
        format: 'furypipe-agent-run/v1', status: 'handoff_required', runId, objectiveDigest,
        completedStages, contextUsedTokens, skillHealth,
        snapshot: snapshotFor(runId, objectiveDigest, nextStageIndex, completedStages, contextUsedTokens, furyPromptDigest),
      };
    }
    completedStages = [...completedStages, stage];
  }

  return {
    format: 'furypipe-agent-run/v1', status: 'completed', runId, objectiveDigest,
    completedStages, contextUsedTokens, skillHealth,
  };
}
