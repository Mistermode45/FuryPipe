import { createHash } from 'node:crypto';
import type { RecoveryStore } from './core/recovery-store.js';

export type McpDirectDagRiskClass = 'closed_world_read' | 'mutation' | 'open_world';
export type McpDirectDagNodeState =
  | 'planned' | 'blocked' | 'ready' | 'approved' | 'executable'
  | 'executing' | 'executed' | 'succeeded' | 'failed' | 'unknown'
  | 'verification_failed' | 'cancelled' | 'expired';

export interface McpDirectDagInputReference {
  readonly name: string;
  readonly nodeId: string;
  readonly output: 'result';
}

export interface McpDirectDagNode {
  readonly id: string;
  readonly capability: string;
  readonly toolName: string;
  readonly riskClass: McpDirectDagRiskClass;
  readonly dependencies: readonly string[];
  readonly inputRefs: readonly McpDirectDagInputReference[];
  readonly inputBytes?: number;
  readonly outputBytes?: number;
  /** Ambient input is forbidden; this field exists only to fail closed at runtime. */
  readonly ambientInput?: never;
}

export interface McpDirectDagQuotas {
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly maxDepth: number;
  readonly maxFanIn: number;
  readonly maxFanOut: number;
  readonly maxPlanBytes: number;
  readonly maxNodeInputBytes: number;
  readonly maxAggregateOutputBytes: number;
  readonly maxWallClockMs: number;
  readonly maxConcurrentNodes: number;
  readonly maxRecoveryEvidence: number;
}

export interface McpDirectDagPlanInput {
  readonly formatVersion: 1;
  readonly nodes: readonly McpDirectDagNode[];
  readonly quotas: McpDirectDagQuotas;
}

export interface McpDirectDagNodeDefinition extends McpDirectDagNode {
  readonly nodeId: string;
}

export interface McpDirectDagPlan {
  readonly formatVersion: 1;
  readonly digest: string;
  readonly nodes: readonly McpDirectDagNodeDefinition[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  readonly quotas: McpDirectDagQuotas;
  readonly topologicalOrder: readonly string[];
  readonly byteLength: number;
}

export interface McpDirectDagAuthority {
  readonly approvalId: string;
  readonly permitId: string;
  readonly expiresAt: number;
}

export interface McpDirectDagAuthorityContext {
  readonly planDigest: string;
  readonly nodeId: string;
  readonly inputs: Readonly<Record<string, string>>;
}

export interface McpDirectDagExecutionContext extends McpDirectDagAuthorityContext {
  readonly attempt: 1;
}

export interface McpDirectDagNodeExecution {
  readonly outcome: 'succeeded' | 'tool_error' | 'unknown' | 'verification_failed';
  readonly outputDigest?: string;
  readonly verified: boolean;
  readonly wireCallStarted?: boolean;
}

export interface McpDirectDagNodeResult {
  readonly nodeId: string;
  readonly state: McpDirectDagNodeState;
  readonly outputDigest?: string;
  readonly verified: boolean;
  readonly wireCallStarted: boolean;
  readonly errorCode?: string;
}

export interface McpDirectDagExecutionResult {
  readonly planDigest: string;
  readonly state: 'succeeded' | 'failed' | 'unknown' | 'cancelled' | 'expired';
  readonly retryable: false;
  readonly nodes: Readonly<Record<string, McpDirectDagNodeResult>>;
}

export interface McpDirectDagExecutionOptions {
  readonly authorizeNode: (
    node: McpDirectDagNodeDefinition,
    context: McpDirectDagAuthorityContext,
  ) => Promise<McpDirectDagAuthority>;
  readonly executeNode: (
    node: McpDirectDagNodeDefinition,
    authority: McpDirectDagAuthority,
    context: McpDirectDagExecutionContext,
  ) => Promise<McpDirectDagNodeExecution>;
  readonly persistEvidence?: (evidence: McpDirectDagEvidence) => Promise<void>;
  readonly recoveryStore?: RecoveryStore;
  /** Opaque pre-hashed scope. Plain tenant/principal identities are rejected by API design. */
  readonly scopeSha256?: string;
  /** Opaque run identity. Default is the plan digest; no implicit resume is supported. */
  readonly runIdSha256?: string;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

export interface McpDirectDagEvidence {
  readonly format: 'furypipe-mcp-direct-dag-evidence/v1';
  readonly planDigest: string;
  readonly nodeId: string;
  readonly state: McpDirectDagNodeState;
  readonly attempt: 1;
  readonly outputDigest?: string;
  readonly verified: boolean;
  readonly wireCallStarted: boolean;
  readonly timestamp: number;
}

export class McpDirectDagValidationError extends Error {
  readonly code = 'MCP_DIRECT_DAG_INVALID_PLAN';
  readonly retrySafe = false;
}

const HEX64 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonicalNode(node: McpDirectDagNode): Record<string, unknown> {
  return {
    id: node.id,
    capability: node.capability,
    toolName: node.toolName,
    riskClass: node.riskClass,
    dependencies: [...node.dependencies].sort(),
    inputRefs: [...node.inputRefs]
      .map((ref) => ({ name: ref.name, nodeId: ref.nodeId, output: ref.output }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.nodeId.localeCompare(b.nodeId)),
    ...(node.inputBytes === undefined ? {} : { inputBytes: node.inputBytes }),
    ...(node.outputBytes === undefined ? {} : { outputBytes: node.outputBytes }),
  };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

function assertQuota(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new McpDirectDagValidationError(`invalid ${name} quota`);
}

function validateQuotas(quotas: McpDirectDagQuotas): void {
  for (const [name, value] of Object.entries(quotas)) assertQuota(value, name);
}

function validateNodeShape(node: McpDirectDagNode): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new McpDirectDagValidationError('node must be an object');
  }
  if (!IDENTIFIER.test(node.id) || !node.capability || !node.toolName) {
    throw new McpDirectDagValidationError('node identity and capability are required');
  }
  if (!['closed_world_read', 'mutation', 'open_world'].includes(node.riskClass)) {
    throw new McpDirectDagValidationError('node risk class is invalid');
  }
  if (node.riskClass === 'open_world') {
    throw new McpDirectDagValidationError('open-world nodes are not executable in M6');
  }
  if ('ambientInput' in node && node.ambientInput !== undefined) {
    throw new McpDirectDagValidationError('ambient inputs are forbidden');
  }
  if (!Array.isArray(node.dependencies) || !Array.isArray(node.inputRefs)) {
    throw new McpDirectDagValidationError('node dependencies and input references must be arrays');
  }
  for (const dependency of node.dependencies) {
    if (!IDENTIFIER.test(dependency)) throw new McpDirectDagValidationError('dependency id is invalid');
  }
  const seenRefs = new Set<string>();
  for (const ref of node.inputRefs) {
    if (!ref || !IDENTIFIER.test(ref.name) || !IDENTIFIER.test(ref.nodeId) || ref.output !== 'result') {
      throw new McpDirectDagValidationError('output reference is invalid');
    }
    if (seenRefs.has(ref.name)) throw new McpDirectDagValidationError('duplicate input reference');
    seenRefs.add(ref.name);
  }
  for (const [name, value] of [['input', node.inputBytes], ['output', node.outputBytes] ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new McpDirectDagValidationError(`invalid ${name} byte bound`);
    }
  }
}

export function createMcpDirectDagPlan(input: McpDirectDagPlanInput): McpDirectDagPlan {
  if (!input || input.formatVersion !== 1 || !Array.isArray(input.nodes)) {
    throw new McpDirectDagValidationError('unsupported DAG format');
  }
  validateQuotas(input.quotas);
  if (input.nodes.length > input.quotas.maxNodes) throw new McpDirectDagValidationError('node quota exceeded');
  const byId = new Map<string, McpDirectDagNode>();
  for (const node of input.nodes) {
    validateNodeShape(node);
    if (byId.has(node.id)) throw new McpDirectDagValidationError('duplicate node id');
    byId.set(node.id, node);
  }
  let edgeCount = 0;
  const edges: Array<{ from: string; to: string }> = [];
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const node of input.nodes) {
    const seen = new Set<string>();
    for (const dependency of node.dependencies) {
      if (seen.has(dependency)) throw new McpDirectDagValidationError('duplicate edge');
      seen.add(dependency);
      if (!byId.has(dependency)) throw new McpDirectDagValidationError('dependency references missing node');
      edgeCount += 1;
      if (edgeCount > input.quotas.maxEdges) throw new McpDirectDagValidationError('edge quota exceeded');
      fanIn.set(node.id, (fanIn.get(node.id) ?? 0) + 1);
      fanOut.set(dependency, (fanOut.get(dependency) ?? 0) + 1);
      if ((fanIn.get(node.id) ?? 0) > input.quotas.maxFanIn) throw new McpDirectDagValidationError('fan-in quota exceeded');
      if ((fanOut.get(dependency) ?? 0) > input.quotas.maxFanOut) throw new McpDirectDagValidationError('fan-out quota exceeded');
      edges.push({ from: dependency, to: node.id });
    }
    for (const ref of node.inputRefs) {
      if (!node.dependencies.includes(ref.nodeId)) {
        throw new McpDirectDagValidationError('output reference requires an explicit dependency');
      }
    }
    if ((node.inputBytes ?? 0) > input.quotas.maxNodeInputBytes) {
      throw new McpDirectDagValidationError('node input quota exceeded');
    }
  }
  const indegree = new Map<string, number>([...byId.keys()].map((id) => [id, 0]));
  for (const edge of edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const ready = [...byId.keys()].filter((id) => indegree.get(id) === 0).sort();
  const topologicalOrder: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    topologicalOrder.push(current);
    for (const edge of edges.filter((item) => item.from === current).sort((a, b) => a.to.localeCompare(b.to))) {
      const next = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, next);
      if (next === 0) {
        ready.push(edge.to);
        ready.sort();
      }
    }
  }
  if (topologicalOrder.length !== byId.size) throw new McpDirectDagValidationError('cycle detected');
  const depths = new Map<string, number>();
  for (const id of topologicalOrder) {
    const node = byId.get(id)!;
    const depth = node.dependencies.length === 0
      ? 1
      : Math.max(...node.dependencies.map((dependency) => depths.get(dependency)! + 1));
    depths.set(id, depth);
    if (depth > input.quotas.maxDepth) throw new McpDirectDagValidationError('depth quota exceeded');
  }
  const nodes = input.nodes
    .map((node) => ({ ...canonicalNode(node), nodeId: digest(canonicalNode(node)) }) as McpDirectDagNodeDefinition)
    .sort((a, b) => a.id.localeCompare(b.id));
  const serial = {
    formatVersion: 1,
    nodes,
    edges: [...edges].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    quotas: input.quotas,
  };
  const serialized = JSON.stringify(serial);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > input.quotas.maxPlanBytes) throw new McpDirectDagValidationError('plan byte quota exceeded');
  return freezeDeep({
    formatVersion: 1,
    digest: digest(serial),
    nodes: freezeDeep(nodes),
    edges: freezeDeep(serial.edges),
    quotas: freezeDeep({ ...input.quotas }),
    topologicalOrder: freezeDeep([...topologicalOrder]),
    byteLength,
  });
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 96) : 'MCP_DIRECT_DAG_NODE_FAILED';
}

function assertOpaqueHash(value: string | undefined, name: string): void {
  if (value !== undefined && !HEX64.test(value)) throw new McpDirectDagValidationError(`${name} must be a SHA-256 digest`);
}

async function persist(
  options: McpDirectDagExecutionOptions,
  evidence: McpDirectDagEvidence,
): Promise<void> {
  if (options.persistEvidence) await options.persistEvidence(Object.freeze({ ...evidence }));
  if (!options.recoveryStore) return;
  assertOpaqueHash(options.scopeSha256, 'scopeSha256');
  const runIdSha256 = options.runIdSha256 ?? evidence.planDigest;
  assertOpaqueHash(runIdSha256, 'runIdSha256');
  const metadata = {
    system: 'mcp-direct-dag',
    scopeSha256: options.scopeSha256,
    runIdSha256,
    planDigest: evidence.planDigest,
    nodeId: evidence.nodeId,
    recordType: 'node-evidence',
    attempt: 1,
  } as const;
  const bytes = new TextEncoder().encode(JSON.stringify({
    format: evidence.format,
    planDigest: evidence.planDigest,
    nodeId: evidence.nodeId,
    state: evidence.state,
    attempt: 1,
    ...(evidence.outputDigest ? { outputDigest: evidence.outputDigest } : {}),
    verified: evidence.verified,
    wireCallStarted: evidence.wireCallStarted,
    timestamp: evidence.timestamp,
  }));
  const bound = {
    metadata: { ...metadata, recordType: 'node-evidence' },
    maxMatches: options.planDigestEvidenceQuota ?? 1,
  };
  const store = options.recoveryStore;
  if (!store.putBounded) throw new McpDirectDagValidationError('RecoveryStore atomic bounded put is required');
  await store.putBounded(bytes, metadata, {
    metadata: { ...metadata, recordType: 'node-evidence' },
    maxMatches: 1,
    additionalBounds: [{
      metadata: {
        system: 'mcp-direct-dag',
        scopeSha256: options.scopeSha256,
        runIdSha256,
        planDigest: evidence.planDigest,
        recordType: 'node-evidence',
      },
      maxMatches: options.planDigestEvidenceQuota ?? 64,
    }],
  });
}

export async function executeMcpDirectDag(
  plan: McpDirectDagPlan,
  options: McpDirectDagExecutionOptions,
): Promise<McpDirectDagExecutionResult> {
  if (!plan || typeof plan.digest !== 'string') throw new McpDirectDagValidationError('plan is required');
  if (!options || typeof options.authorizeNode !== 'function' || typeof options.executeNode !== 'function') {
    throw new McpDirectDagValidationError('fresh node authority and execution callbacks are required');
  }
  assertOpaqueHash(options.scopeSha256, 'scopeSha256');
  assertOpaqueHash(options.runIdSha256, 'runIdSha256');
  const now = options.now ?? (() => Date.now());
  const results = new Map<string, McpDirectDagNodeResult>();
  const nodeById = new Map(plan.nodes.map((node) => [node.id, node]));
  const startedAt = now();
  let overall: McpDirectDagExecutionResult['state'] = 'succeeded';

  const set = (nodeId: string, state: McpDirectDagNodeState, fields: Partial<McpDirectDagNodeResult> = {}) => {
    results.set(nodeId, {
      nodeId, state, verified: fields.verified ?? false,
      wireCallStarted: fields.wireCallStarted ?? false,
      ...(fields.outputDigest ? { outputDigest: fields.outputDigest } : {}),
      ...(fields.errorCode ? { errorCode: fields.errorCode } : {}),
    });
  };

  const inputsFor = (node: McpDirectDagNodeDefinition): Record<string, string> => {
    const inputs: Record<string, string> = {};
    for (const ref of node.inputRefs) {
      const predecessor = results.get(ref.nodeId);
      if (!predecessor?.outputDigest || !predecessor.verified) {
        throw new Error('required dependency output is not verified');
      }
      inputs[ref.name] = predecessor.outputDigest;
    }
    return inputs;
  };

  const runnable = (): McpDirectDagNodeDefinition[] => plan.topologicalOrder
    .map((id) => nodeById.get(id)!)
    .filter((node) => !results.has(node.id))
    .filter((node) => node.dependencies.every((dependency) => results.get(dependency)?.state === 'succeeded'))
    .slice(0, plan.quotas.maxConcurrentNodes);

  const blockUnrunnable = (): void => {
    for (const node of plan.nodes) {
      if (results.has(node.id)) continue;
      const dependency = node.dependencies.map((id) => results.get(id)).find((entry) =>
        entry && !['succeeded'].includes(entry.state));
      if (dependency) set(node.id, 'blocked', { errorCode: `dependency-${dependency.state}` });
    }
  };

  while (results.size < plan.nodes.length) {
    blockUnrunnable();
    const batch = runnable();
    if (batch.length === 0) {
      if (results.size < plan.nodes.length) {
        for (const node of plan.nodes) if (!results.has(node.id)) set(node.id, 'blocked', { errorCode: 'no-runnable-node' });
        overall = overall === 'succeeded' ? 'failed' : overall;
      }
      break;
    }
    const runOne = async (node: McpDirectDagNodeDefinition): Promise<void> => {
      const contextBase = {
        planDigest: plan.digest,
        nodeId: node.id,
        inputs: Object.freeze(inputsFor(node)),
      };
      if (options.signal?.aborted) {
        set(node.id, 'cancelled', { errorCode: 'cancelled-before-authority' });
        return;
      }
      set(node.id, 'ready');
      let authority: McpDirectDagAuthority;
      try {
        authority = await options.authorizeNode(node, contextBase);
      } catch (error) {
        set(node.id, 'failed', { errorCode: errorCode(error) });
        return;
      }
      if (!authority || typeof authority.permitId !== 'string'
        || typeof authority.approvalId !== 'string'
        || !Number.isFinite(authority.expiresAt)) {
        set(node.id, 'failed', { errorCode: 'invalid-fresh-authority' });
        return;
      }
      set(node.id, 'approved');
      if (now() >= authority.expiresAt) {
        set(node.id, 'expired', { errorCode: 'permit-expired-before-admission' });
        return;
      }
      set(node.id, 'executable');
      try {
        await persist(options, {
          format: 'furypipe-mcp-direct-dag-evidence/v1',
          planDigest: plan.digest,
          nodeId: node.id,
          state: 'executing',
          attempt: 1,
          verified: false,
          wireCallStarted: false,
          timestamp: now(),
        });
      } catch (error) {
        set(node.id, 'unknown', { errorCode: 'durability-failed-before-execution' });
        return;
      }
      if (now() >= authority.expiresAt) {
        set(node.id, 'expired', { errorCode: 'permit-expired-before-wire-call' });
        return;
      }
      if (options.signal?.aborted) {
        set(node.id, 'cancelled', { errorCode: 'cancelled-before-wire-call' });
        return;
      }
      set(node.id, 'executing');
      let execution: McpDirectDagNodeExecution;
      try {
        execution = await options.executeNode(node, authority, {
          ...contextBase,
          attempt: 1,
        });
      } catch (error) {
        set(node.id, 'unknown', { errorCode: 'execution-outcome-unknown', wireCallStarted: true });
        overall = 'unknown';
        return;
      }
      const wireCallStarted = execution.wireCallStarted ?? true;
      if (execution.outcome === 'succeeded' && execution.verified && execution.outputDigest) {
        set(node.id, 'succeeded', {
          outputDigest: execution.outputDigest,
          verified: true,
          wireCallStarted,
        });
      } else if (execution.outcome === 'tool_error') {
        set(node.id, 'failed', { verified: false, wireCallStarted });
      } else if (execution.outcome === 'verification_failed') {
        set(node.id, 'verification_failed', { verified: false, wireCallStarted });
      } else {
        set(node.id, 'unknown', { verified: false, wireCallStarted });
      }
      try {
        await persist(options, {
          format: 'furypipe-mcp-direct-dag-evidence/v1',
          planDigest: plan.digest,
          nodeId: node.id,
          state: results.get(node.id)!.state,
          attempt: 1,
          ...(results.get(node.id)?.outputDigest ? { outputDigest: results.get(node.id)!.outputDigest } : {}),
          verified: results.get(node.id)!.verified,
          wireCallStarted,
          timestamp: now(),
        });
      } catch {
        if (results.get(node.id)?.state === 'succeeded') {
          set(node.id, 'unknown', { errorCode: 'durability-failed-after-result', wireCallStarted });
          overall = 'unknown';
        }
      }
    };
    await Promise.all(batch.map((node) => runOne(node)));
    if (results.values().some((entry) => entry.state === 'unknown')) overall = 'unknown';
    if (results.values().some((entry) => ['failed', 'verification_failed', 'blocked', 'cancelled', 'expired'].includes(entry.state))) {
      if (overall === 'succeeded') overall = 'failed';
    }
    if (now() - startedAt > plan.quotas.maxWallClockMs) {
      for (const node of plan.nodes) if (!results.has(node.id)) set(node.id, 'expired', { errorCode: 'wall-clock-quota-exceeded' });
      overall = 'expired';
      break;
    }
  }

  if (options.signal?.aborted && overall === 'succeeded') overall = 'cancelled';
  if (overall === 'succeeded' && [...results.values()].some((entry) => entry.state !== 'succeeded')) overall = 'failed';
  return {
    planDigest: plan.digest,
    state: overall,
    retryable: false,
    nodes: Object.freeze(Object.fromEntries([...results.entries()].map(([key, value]) => [key, Object.freeze(value)]))),
  };
}
