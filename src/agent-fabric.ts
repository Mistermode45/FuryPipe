import { createHash } from 'node:crypto';
import { compileFuryPrompt, type FuryPromptCompileInput } from './fury-prompt.js';

export type AgentFabricDecision = 'ADOPT' | 'PORT' | 'ADAPT' | 'WRAP' | 'REFERENCE_ONLY' | 'REJECT';
export const AGENT_FABRIC_STAGE_ORDER = ['research', 'plan', 'implement', 'review', 'verify'] as const;
export type AgentFabricStageId = typeof AGENT_FABRIC_STAGE_ORDER[number];
export type AgentFabricPermission = 'read' | 'scoped-write';

export interface AgentFabricConceptDecision {
  readonly id: string;
  readonly concept: string;
  readonly source: string;
  readonly reference: string;
  readonly license: string;
  readonly decision: AgentFabricDecision;
  readonly reason: string;
  readonly security: string;
  readonly maintenance: string;
}

/**
 * FuryPipe-native decision ledger. It records what was learned without
 * vendoring external agent code or pretending that a workflow plan executed.
 */
export const AGENT_FABRIC_DECISIONS: readonly AgentFabricConceptDecision[] = [
  {
    id: 'AF-001',
    concept: 'research-first engineering',
    source: 'ECC',
    reference: 'c9148d0bb239ed01a95724a5928b98cdf9c30658',
    license: 'source repository license not vendored; attribution review required',
    decision: 'ADAPT',
    reason: 'require bounded evidence before planning or implementation',
    security: 'read-only research stage cannot mutate the target repository',
    maintenance: 'keep as a small gate; do not copy source workflows',
  },
  {
    id: 'AF-002',
    concept: 'planner/explorer/implementer/reviewer/verifier roles',
    source: 'ECC + Matt Pocock skills',
    reference: 'ECC c9148d0bb239ed01a95724a5928b98cdf9c30658; skills 3cca18b368ae95cdbdebbff572ccafa662551015',
    license: 'references only; no external code copied',
    decision: 'ADAPT',
    reason: 'separate evidence collection, scoped mutation and adversarial verification',
    security: 'implementer is the only write-capable stage and receives scoped permission',
    maintenance: 'stage contracts remain FuryPipe-owned and versioned',
  },
  {
    id: 'AF-003',
    concept: 'verification loop and fresh-context review',
    source: 'ECC',
    reference: 'c9148d0bb239ed01a95724a5928b98cdf9c30658',
    license: 'reference only; no vendoring',
    decision: 'ADAPT',
    reason: 'review must inspect diff and evidence independently of implementation intent',
    security: 'prevents self-approved claims and keeps failed gates visible',
    maintenance: 'reuse existing project test/typecheck/build gates instead of new framework',
  },
  {
    id: 'AF-004',
    concept: 'tracer bullets and wayfinder',
    source: 'Matt Pocock skills',
    reference: '3cca18b368ae95cdbdebbff572ccafa662551015',
    license: 'reference only; no vendoring',
    decision: 'REFERENCE_ONLY',
    reason: 'use as planning vocabulary until a real multi-step harness needs an implementation',
    security: 'no runtime effect and no extra tool authority',
    maintenance: 'avoid duplicating project tracking systems prematurely',
  },
  {
    id: 'AF-005',
    concept: 'handoff/resume and memory',
    source: 'ECC + local Codex workflow',
    reference: 'ECC c9148d0bb239ed01a95724a5928b98cdf9c30658; local workflow contract',
    license: 'reference only; no external code or private memory copied',
    decision: 'WRAP',
    reason: 'represent resumable metadata and evidence handles without persisting prompts',
    security: 'snapshots contain IDs/statuses only; no plaintext context or credentials',
    maintenance: 'integrate with existing receipts/recovery handles when a runtime exists',
  },
  {
    id: 'AF-006',
    concept: 'least agency, safe hooks and MCP permissions',
    source: 'ECC + MCP project conventions',
    reference: 'ECC c9148d0bb239ed01a95724a5928b98cdf9c30658; local MCP boundary tests',
    license: 'reference only; no external code copied',
    decision: 'ADAPT',
    reason: 'default plans are read-only and write authority is explicit and scoped',
    security: 'deny-by-default stage permissions; no implicit shell/network escalation',
    maintenance: 'keep permissions as a small union, not a general capability system',
  },
  {
    id: 'AF-007',
    concept: 'autonomous hooks and broad agent cloning',
    source: 'external patterns reviewed for FuryPipe V5',
    reference: 'no code import approved',
    license: 'not applicable; rejected before integration',
    decision: 'REJECT',
    reason: 'would expand authority and maintenance surface beyond the current proxy library',
    security: 'avoids ambient credentials, unbounded execution and hidden mutation paths',
    maintenance: 'no dependency or compatibility burden introduced',
  },
];

export interface AgentFabricStage {
  readonly id: AgentFabricStageId;
  readonly owner: 'explorer' | 'planner' | 'implementer' | 'reviewer' | 'verifier';
  readonly permission: AgentFabricPermission;
  readonly requiredEvidence: readonly string[];
}

export interface AgentFabricPlanRequest {
  readonly objective: string;
  /** Optional structured prompt compiled into bounded, non-secret metadata. */
  readonly furyPrompt?: FuryPromptCompileInput;
  readonly contextBudgetTokens?: number;
  readonly allowWrites?: boolean;
  readonly concepts?: readonly AgentFabricConceptDecision[];
}

export interface AgentFabricPlan {
  readonly format: 'furypipe-agent-fabric-plan/v1';
  readonly status: 'plan_only';
  readonly objectiveDigest: string;
  readonly contextBudgetTokens: number;
  readonly output: 'metadata_only';
  readonly stages: readonly AgentFabricStage[];
  readonly gates: readonly ['evidence_before_plan', 'review_before_verify', 'failed_gate_blocks_completion'];
  readonly permissions: {
    readonly default: 'read';
    readonly writeStage: 'implementer' | 'none';
    readonly network: 'disabled';
    readonly secrets: 'never_requested';
  };
  readonly conceptDecisionIds: readonly string[];
  readonly furyPrompt?: {
    readonly level: FuryPromptCompileInput['level'];
    readonly promptBytes: number;
    readonly promptDigest: string;
  };
}

const STAGES: readonly AgentFabricStage[] = [
  { id: 'research', owner: 'explorer', permission: 'read', requiredEvidence: ['source_or_local_fact'] },
  { id: 'plan', owner: 'planner', permission: 'read', requiredEvidence: ['research_evidence'] },
  { id: 'implement', owner: 'implementer', permission: 'scoped-write', requiredEvidence: ['approved_plan'] },
  { id: 'review', owner: 'reviewer', permission: 'read', requiredEvidence: ['diff', 'tests'] },
  { id: 'verify', owner: 'verifier', permission: 'read', requiredEvidence: ['review', 'build_gate'] },
];

function digestObjective(objective: string): string {
  return `af_${createHash('sha256').update(objective, 'utf8').digest('hex').slice(0, 16)}`;
}

/** Build a bounded workflow description; this does not execute any stage. */
export function createAgentFabricPlan(input: AgentFabricPlanRequest): AgentFabricPlan {
  const objective = input.objective.trim();
  if (!objective) throw new Error('agent fabric objective must not be empty');
  const budget = input.contextBudgetTokens ?? 16_000;
  if (!Number.isSafeInteger(budget) || budget < 256 || budget > 200_000) {
    throw new Error('agent fabric context budget must be an integer between 256 and 200000 tokens');
  }
  const furyPrompt = input.furyPrompt === undefined ? undefined : compileFuryPrompt(input.furyPrompt);
  const concepts = input.concepts ?? AGENT_FABRIC_DECISIONS;
  return {
    format: 'furypipe-agent-fabric-plan/v1',
    status: 'plan_only',
    objectiveDigest: digestObjective(objective),
    contextBudgetTokens: budget,
    output: 'metadata_only',
    stages: input.allowWrites === true ? STAGES : STAGES.map((stage) => ({
      ...stage,
      permission: 'read' as const,
    })),
    gates: ['evidence_before_plan', 'review_before_verify', 'failed_gate_blocks_completion'],
    permissions: {
      default: 'read',
      writeStage: input.allowWrites === true ? 'implementer' : 'none',
      network: 'disabled',
      secrets: 'never_requested',
    },
    conceptDecisionIds: concepts.map((concept) => concept.id),
    ...(furyPrompt === undefined ? {} : {
      furyPrompt: {
        level: furyPrompt.level,
        promptBytes: furyPrompt.promptBytes,
        promptDigest: furyPrompt.promptDigest,
      },
    }),
  };
}
