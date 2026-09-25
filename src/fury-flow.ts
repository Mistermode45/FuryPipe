// FuryFlow — workflow model with explicit deterministic and agentic zones.
//
// A flow is a validated graph of typed nodes. Every node type has a fixed
// determinism class: the workflow decides in DETERMINISTIC nodes, an agent
// decides (within bounds) in AGENTIC ones. The flow declares, per node, a
// criticality; a critical node must be deterministic (master §46.15), and
// the flow reports its stochastic surface area so users can see where
// non-determinism lives. Execution here is a dry-run/test-mode engine:
// deterministic nodes run registered pure handlers, agentic nodes return
// fixtures, and state is checkpointed after every node so a run can resume.
// Real triggers stay with the Gateway automation scheduler (same trigger
// kinds: one-shot, interval, cron, webhook).
import { createHash } from 'node:crypto';

export const FURY_FLOW_FORMAT = 'furypipe-flow/v1' as const;

export const FURY_FLOW_NODE_TYPES = Object.freeze({
  TRIGGER: 'deterministic', INPUT: 'deterministic', LLM: 'agentic', AGENT: 'agentic', DISPATCH: 'agentic',
  TOOL: 'deterministic', MCP: 'deterministic', HTTP: 'deterministic', CODE: 'deterministic', CONDITION: 'deterministic',
  SWITCH: 'deterministic', LOOP: 'deterministic', PARALLEL: 'deterministic', JOIN: 'deterministic',
  HUMAN_APPROVAL: 'deterministic', WAIT: 'deterministic', EVENT: 'deterministic', MEMORY: 'deterministic',
  RAG: 'deterministic', BROWSER: 'agentic', ARTIFACT: 'deterministic', NOTIFICATION: 'deterministic', SUBWORKFLOW: 'deterministic',
} as const);
export type FuryFlowNodeType = keyof typeof FURY_FLOW_NODE_TYPES;
export type FuryFlowZone = 'deterministic' | 'agentic';

export interface FuryFlowNode {
  readonly id: string;
  readonly type: FuryFlowNodeType;
  readonly label: string;
  readonly critical?: boolean;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface FuryFlowEdge {
  readonly from: string;
  readonly to: string;
  /** For CONDITION/SWITCH outputs. */
  readonly when?: string;
}

export interface FuryFlowInput {
  readonly format: typeof FURY_FLOW_FORMAT;
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly nodes: readonly FuryFlowNode[];
  readonly edges: readonly FuryFlowEdge[];
}

export interface FuryFlowDocument extends FuryFlowInput {
  readonly digest: string;
  readonly order: readonly string[];
  readonly zones: Readonly<Record<string, FuryFlowZone>>;
  /** Share of nodes (and of critical nodes) that are agentic. */
  readonly stochasticSurface: { readonly nodes: number; readonly agentic: number; readonly ratio: number; readonly criticalAgentic: number };
}

export class FuryFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryFlowError';
  }
}

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const TRIGGER_KINDS = new Set(['one-shot', 'interval', 'cron', 'webhook', 'manual']);

function fail(message: string): never {
  throw new FuryFlowError(message);
}

export function compileFuryFlow(input: unknown): FuryFlowDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('flow must be an object');
  const f = input as Record<string, unknown>;
  for (const k of Object.keys(f)) if (!['format', 'id', 'version', 'name', 'nodes', 'edges'].includes(k)) fail(`unknown key ${k}`);
  if (f.format !== FURY_FLOW_FORMAT) fail('flow format is unsupported');
  if (typeof f.id !== 'string' || !ID.test(f.id)) fail('flow id is invalid');
  if (!Number.isSafeInteger(f.version) || (f.version as number) < 1) fail('flow version must be a positive integer');
  if (typeof f.name !== 'string' || !f.name.trim() || f.name.length > 200) fail('flow name is invalid');
  if (!Array.isArray(f.nodes) || f.nodes.length === 0 || f.nodes.length > 500) fail('flow needs 1..500 nodes');
  if (!Array.isArray(f.edges) || f.edges.length > 2_000) fail('flow edges must be an array of at most 2000');

  const nodes: FuryFlowNode[] = f.nodes.map((raw, i) => {
    const n = raw as Record<string, unknown>;
    for (const k of Object.keys(n)) if (!['id', 'type', 'label', 'critical', 'config'].includes(k)) fail(`node[${i}] has unknown key ${k}`);
    if (typeof n.id !== 'string' || !ID.test(n.id)) fail(`node[${i}] id is invalid`);
    if (typeof n.type !== 'string' || !(n.type in FURY_FLOW_NODE_TYPES)) fail(`node ${n.id} has an unknown type`);
    if (typeof n.label !== 'string' || !n.label.trim() || n.label.length > 200) fail(`node ${n.id} label is invalid`);
    if (n.critical !== undefined && typeof n.critical !== 'boolean') fail(`node ${n.id} critical must be boolean`);
    const config = n.config === undefined ? undefined : (n.config && typeof n.config === 'object' && !Array.isArray(n.config) ? n.config as Record<string, unknown> : fail(`node ${n.id} config must be an object`));
    if (JSON.stringify(config ?? {}).length > 32 * 1024) fail(`node ${n.id} config is too large`);
    return Object.freeze({ id: n.id, type: n.type as FuryFlowNodeType, label: n.label, ...(n.critical ? { critical: true } : {}), ...(config ? { config: Object.freeze({ ...config }) } : {}) });
  });
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) fail(`duplicate node ${n.id}`);
    ids.add(n.id);
  }
  const edges: FuryFlowEdge[] = f.edges.map((raw, i) => {
    const e = raw as Record<string, unknown>;
    if (typeof e.from !== 'string' || typeof e.to !== 'string' || !ids.has(e.from) || !ids.has(e.to)) fail(`edge[${i}] references unknown nodes`);
    if (e.from === e.to) fail(`edge[${i}] is a self loop; use a LOOP node`);
    if (e.when !== undefined && (typeof e.when !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(e.when))) fail(`edge[${i}] when is invalid`);
    return Object.freeze({ from: e.from, to: e.to, ...(e.when ? { when: e.when as string } : {}) });
  });

  // Structural rules.
  const triggers = nodes.filter((n) => n.type === 'TRIGGER');
  if (triggers.length !== 1) fail('a flow needs exactly one TRIGGER');
  const trigger = triggers[0]!;
  if (!TRIGGER_KINDS.has(String(trigger.config?.kind))) fail('TRIGGER config.kind must be one-shot, interval, cron, webhook or manual');
  if (edges.some((e) => e.to === trigger.id)) fail('TRIGGER cannot have incoming edges');
  for (const n of nodes) {
    const outs = edges.filter((e) => e.from === n.id);
    if ((n.type === 'CONDITION' || n.type === 'SWITCH') && (outs.length < 2 || outs.some((e) => !e.when))) fail(`${n.type} ${n.id} needs at least two labelled outgoing edges`);
    if (n.type !== 'CONDITION' && n.type !== 'SWITCH' && outs.some((e) => e.when)) fail(`only CONDITION/SWITCH edges may carry when`);
    if (n.type === 'LOOP') {
      const max = n.config?.maxIterations;
      if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1 || max > 1_000) fail(`LOOP ${n.id} needs config.maxIterations 1..1000`);
    }
    if (n.type === 'JOIN' && edges.filter((e) => e.to === n.id).length < 2) fail(`JOIN ${n.id} needs at least two inputs`);
    if (n.critical && FURY_FLOW_NODE_TYPES[n.type] === 'agentic') fail(`critical node ${n.id} must be deterministic; put the agent before a deterministic, approved step`);
    if (n.type === 'HTTP' || n.type === 'NOTIFICATION' || n.type === 'MCP' || n.type === 'TOOL') {
      const effect = n.config?.sideEffect;
      if (effect === true && !edges.some((e) => e.to === n.id && nodes.find((m) => m.id === e.from)?.type === 'HUMAN_APPROVAL') && !n.config?.approvedByPolicy) {
        fail(`side-effecting ${n.type} ${n.id} needs a HUMAN_APPROVAL predecessor or config.approvedByPolicy`);
      }
    }
  }
  // Acyclic (loops are expressed by LOOP nodes, not back edges) + reachability.
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, indeg.get(e.to)! + 1);
  const order: string[] = [];
  const ready = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id).sort();
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const e of edges.filter((x) => x.from === id)) {
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) { ready.push(e.to); ready.sort(); }
    }
  }
  if (order.length !== nodes.length) fail('flow contains a cycle; use a LOOP node');
  const reachable = new Set([trigger.id]);
  for (const id of order) if (reachable.has(id)) for (const e of edges.filter((x) => x.from === id)) reachable.add(e.to);
  const orphan = nodes.find((n) => !reachable.has(n.id));
  if (orphan) fail(`node ${orphan.id} is not reachable from the trigger`);

  const zones = Object.freeze(Object.fromEntries(nodes.map((n) => [n.id, FURY_FLOW_NODE_TYPES[n.type]]))) as Record<string, FuryFlowZone>;
  const agentic = nodes.filter((n) => zones[n.id] === 'agentic').length;
  const body: FuryFlowInput = { format: FURY_FLOW_FORMAT, id: f.id, version: f.version as number, name: f.name, nodes: Object.freeze(nodes), edges: Object.freeze(edges) };
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return Object.freeze({
    ...body, digest, order: Object.freeze(order), zones,
    stochasticSurface: Object.freeze({ nodes: nodes.length, agentic, ratio: Math.round((agentic / nodes.length) * 1000) / 1000, criticalAgentic: 0 }),
  });
}

export interface FuryFlowCheckpoint {
  readonly flowDigest: string;
  readonly completed: readonly string[];
  readonly skipped: readonly string[];
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly waitingApproval?: string;
  readonly checkpointDigest: string;
}

export type FuryFlowHandler = (node: FuryFlowNode, inputs: readonly unknown[]) => unknown;

/**
 * Dry-run / test-mode execution. Deterministic nodes call registered pure
 * handlers (default: pass-through of inputs); agentic nodes must be given a
 * fixture; HUMAN_APPROVAL pauses unless pre-approved. Returns a checkpoint
 * after every node so a run resumes exactly where it stopped.
 */
export function dryRunFuryFlow(flow: FuryFlowDocument, options: {
  readonly fixtures: Readonly<Record<string, unknown>>;
  readonly handlers?: Partial<Record<FuryFlowNodeType, FuryFlowHandler>>;
  readonly approvals?: readonly string[];
  readonly resumeFrom?: FuryFlowCheckpoint;
  readonly stopAfter?: number;
}): { readonly status: 'completed' | 'waiting-approval' | 'stopped'; readonly checkpoint: FuryFlowCheckpoint; readonly trace: readonly { readonly node: string; readonly zone: FuryFlowZone; readonly skipped?: boolean }[] } {
  const cp = options.resumeFrom;
  if (cp) {
    if (cp.flowDigest !== flow.digest) throw new FuryFlowError('checkpoint belongs to another flow version');
    if (sealCheckpoint(cp.flowDigest, cp.completed, cp.skipped, cp.outputs, cp.waitingApproval) !== cp.checkpointDigest) throw new FuryFlowError('checkpoint is corrupt');
  }
  const completed = new Set(cp?.completed ?? []);
  const outputs: Record<string, unknown> = { ...(cp?.outputs ?? {}) };
  const skipped = new Set<string>(cp?.skipped ?? []);
  const approvals = new Set(options.approvals ?? []);
  const trace: { node: string; zone: FuryFlowZone; skipped?: boolean }[] = [];
  let steps = 0;
  // Branch pruning: an edge labelled `when` is live only if the CONDITION/SWITCH output equals it.
  const live = (e: FuryFlowEdge) => !e.when || outputs[e.from] === e.when;
  for (const id of flow.order) {
    if (completed.has(id)) continue;
    const node = flow.nodes.find((n) => n.id === id)!;
    const incoming = flow.edges.filter((e) => e.to === id);
    const activeInputs = incoming.filter((e) => (completed.has(e.from) && !skipped.has(e.from)) && live(e));
    if (node.type !== 'TRIGGER' && activeInputs.length === 0) {
      skipped.add(id);
      completed.add(id);
      trace.push({ node: id, zone: flow.zones[id]!, skipped: true });
      continue;
    }
    if (node.type === 'HUMAN_APPROVAL' && !approvals.has(id)) {
      const checkpoint = checkpointOf(flow.digest, completed, skipped, outputs, id);
      return Object.freeze({ status: 'waiting-approval', checkpoint, trace: Object.freeze(trace) });
    }
    const inputs = activeInputs.map((e) => outputs[e.from]);
    let out: unknown;
    if (flow.zones[id] === 'agentic') {
      if (!(id in options.fixtures)) throw new FuryFlowError(`agentic node ${id} has no fixture in test mode`);
      out = options.fixtures[id];
    } else {
      const handler = options.handlers?.[node.type];
      out = handler ? handler(node, inputs) : (id in options.fixtures ? options.fixtures[id] : inputs.length <= 1 ? inputs[0] ?? null : inputs);
    }
    outputs[id] = out;
    completed.add(id);
    trace.push({ node: id, zone: flow.zones[id]! });
    steps += 1;
    if (options.stopAfter !== undefined && steps >= options.stopAfter) {
      return Object.freeze({ status: 'stopped', checkpoint: checkpointOf(flow.digest, completed, skipped, outputs), trace: Object.freeze(trace) });
    }
  }
  return Object.freeze({ status: 'completed', checkpoint: checkpointOf(flow.digest, completed, skipped, outputs), trace: Object.freeze(trace) });
}

function sealCheckpoint(flowDigest: string, completed: readonly string[], skipped: readonly string[], outputs: Readonly<Record<string, unknown>>, waitingApproval?: string): string {
  return createHash('sha256').update(JSON.stringify({ flowDigest, completed: [...completed].sort(), skipped: [...skipped].sort(), outputs, waitingApproval: waitingApproval ?? null })).digest('hex');
}

function checkpointOf(flowDigest: string, completed: Set<string>, skipped: Set<string>, outputs: Record<string, unknown>, waitingApproval?: string): FuryFlowCheckpoint {
  const list = [...completed].sort();
  const skip = [...skipped].sort();
  const snapshot = JSON.parse(JSON.stringify(outputs)) as Record<string, unknown>;
  return Object.freeze({
    flowDigest, completed: Object.freeze(list), skipped: Object.freeze(skip), outputs: Object.freeze(snapshot),
    ...(waitingApproval ? { waitingApproval } : {}),
    checkpointDigest: sealCheckpoint(flowDigest, list, skip, snapshot, waitingApproval),
  });
}
