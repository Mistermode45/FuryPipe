import { fromJsonSchema } from '@modelcontextprotocol/client';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';

import {
  resolveMcpDirectSelectedToolSchema,
  type McpDirectCatalogHandle,
} from './mcp-direct-catalog.js';
import {
  canonicalizeMcpDirectJson,
  digestMcpDirectJson,
} from './mcp-direct-json.js';
import {
  isGeneratedMcpDirectLifecycleState,
  recordMcpDirectApproval,
  recordMcpDirectSelection,
  type McpDirectLifecycleState,
} from './mcp-direct-governance.js';
import type { McpToolRiskClass } from './mcp-tool-risk.js';

export type McpDirectPolicyOutcome =
  | 'deny'
  | 'require_operator'
  | 'allow_governed_policy';

export interface McpDirectPolicyPair {
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly toolName: string;
}

export interface McpDirectOperatorApprovalIntent {
  readonly format: 'furypipe-mcp-direct-operator-intent/v1';
  readonly intentId: string;
  readonly proposalSha256: string;
  readonly policyDecisionIdSha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface McpDirectOperatorIntentOptions {
  readonly now?: number;
  readonly expiresInMs?: number;
}

export interface McpDirectPolicy {
  readonly format: 'furypipe-mcp-direct-policy/v1';
  readonly policyId: string;
  /**
   * Exact source/tool pairs for which a trusted closed-world read may be
   * approved by policy. Risk classification still wins over this allowlist.
   */
  readonly governedPolicyAllowlist: readonly McpDirectPolicyPair[];
  /**
   * Exact source/tool pairs on which an operator may explicitly approve the
   * validated proposal. This never auto-approves anything.
   */
  readonly operatorApprovalAllowlist: readonly McpDirectPolicyPair[];
}

export interface McpDirectToolProposal {
  readonly format: 'furypipe-mcp-direct-tool-proposal/v1';
  readonly proposalSha256: string;
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly toolName: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly riskClass: McpToolRiskClass;
  readonly argumentsValidated: true;
}

export interface McpDirectPolicyEvaluationOptions {
  readonly now?: number;
  readonly expiresInMs?: number;
}

export interface McpDirectPolicyDecision {
  readonly format: 'furypipe-mcp-direct-policy-decision/v1';
  readonly policyDecisionIdSha256: string;
  readonly policyId: string;
  readonly policySha256: string;
  readonly proposalSha256: string;
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly toolName: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly riskClass: McpToolRiskClass;
  readonly policyEvaluated: true;
  readonly evaluatedAt: number;
  readonly expiresAt: number;
  readonly outcome: McpDirectPolicyOutcome;
  readonly reason:
    | 'trusted_closed_world_exact_allowlist'
    | 'operator_exact_allowlist'
    | 'governed_policy_risk_ineligible'
    | 'not_allowlisted';
}

interface ProposalState {
  readonly canonicalArguments: string;
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly toolName: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly riskClass: McpToolRiskClass;
}

interface DecisionState {
  readonly proposal: McpDirectToolProposal;
  readonly policyId: string;
  readonly policySha256: string;
  readonly evaluatedAt: number;
  readonly expiresAt: number;
  readonly outcome: McpDirectPolicyOutcome;
  approved: boolean;
}

interface OperatorIntentState {
  readonly proposal: McpDirectToolProposal;
  readonly decision: McpDirectPolicyDecision;
  consumed: boolean;
}

const PROPOSAL_STATE = new WeakMap<object, ProposalState>();
const DECISION_STATE = new WeakMap<object, DecisionState>();
const OPERATOR_INTENT_STATE = new WeakMap<object, OperatorIntentState>();
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_POLICY_PAIRS = 256;
const MAX_ARGUMENT_BYTES = 1024 * 1024;
const MAX_ARGUMENT_DEPTH = 64;
const DEFAULT_OPERATOR_INTENT_TTL_MS = 30_000;
const MAX_OPERATOR_INTENT_TTL_MS = 60_000;
const GOVERNED_APPROVAL_TTL_MS = 30_000;
const DEFAULT_POLICY_DECISION_TTL_MS = 30_000;
const MAX_POLICY_DECISION_TTL_MS = 60_000;

/**
 * Supported M2 selection transition. Selection identifies one listed tool but
 * grants no approval, permit or execution authority.
 */
export function selectMcpDirectTool(
  lifecycle: McpDirectLifecycleState,
  toolName: string,
): McpDirectLifecycleState {
  if (!isGeneratedMcpDirectLifecycleState(lifecycle)) {
    throw new Error('MCP lifecycle state must be process-local FuryPipe evidence');
  }
  if (!lifecycle.connected || !lifecycle.healthy || !lifecycle.listed || !lifecycle.inventory) {
    throw new Error('MCP source must be connected, healthy and listed before tool selection');
  }
  return recordMcpDirectSelection(lifecycle, toolName);
}

function assertLifecycleSelected(
  lifecycle: McpDirectLifecycleState,
): NonNullable<McpDirectLifecycleState['inventory']>[number] {
  if (!isGeneratedMcpDirectLifecycleState(lifecycle)) {
    throw new Error('MCP lifecycle state must be process-local FuryPipe evidence');
  }
  if (
    !lifecycle.connected
    || !lifecycle.healthy
    || !lifecycle.listed
    || !lifecycle.selected
    || !lifecycle.selectedTool
    || !lifecycle.inventory
  ) {
    throw new Error('MCP tool must be connected, healthy, listed and selected before proposal validation');
  }
  const tool = lifecycle.inventory.find((candidate) => candidate.name === lifecycle.selectedTool);
  if (!tool) throw new Error('selected MCP tool is missing from lifecycle inventory');
  return tool;
}

function ownRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${label} must not contain symbol keys`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error(`${label} must contain enumerable data properties only`);
    }
  }
  return record;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const allow = new Set(allowed);
  if (Object.keys(record).some((key) => !allow.has(key))) {
    throw new Error(`${label} contains unsupported fields`);
  }
}

function normalizedPairs(value: unknown, label: string): readonly McpDirectPolicyPair[] {
  if (!Array.isArray(value) || value.length > MAX_POLICY_PAIRS) {
    throw new Error(`${label} must be an array with at most 256 entries`);
  }
  const seen = new Set<string>();
  const pairs = value.map((entry) => {
    const record = ownRecord(entry, label);
    assertExactKeys(record, ['sourceId', 'endpointFingerprint', 'toolName'], label);
    if (
      typeof record.sourceId !== 'string'
      || !SAFE_ID.test(record.sourceId)
      || typeof record.endpointFingerprint !== 'string'
      || !SHA256.test(record.endpointFingerprint)
      || typeof record.toolName !== 'string'
      || !SAFE_ID.test(record.toolName)
    ) {
      throw new Error(`${label} contains an invalid source/endpoint/tool identity`);
    }
    const key = `${record.sourceId}\u0000${record.endpointFingerprint}\u0000${record.toolName}`;
    if (seen.has(key)) throw new Error(`${label} contains duplicate source/endpoint/tool pairs`);
    seen.add(key);
    return Object.freeze({
      sourceId: record.sourceId,
      endpointFingerprint: record.endpointFingerprint,
      toolName: record.toolName,
    });
  });
  pairs.sort((left, right) => {
    const leftKey = `${left.sourceId}\u0000${left.endpointFingerprint}\u0000${left.toolName}`;
    const rightKey = `${right.sourceId}\u0000${right.endpointFingerprint}\u0000${right.toolName}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return Object.freeze(pairs);
}

function normalizePolicy(value: McpDirectPolicy): McpDirectPolicy {
  const record = ownRecord(value, 'MCP direct policy');
  assertExactKeys(
    record,
    ['format', 'policyId', 'governedPolicyAllowlist', 'operatorApprovalAllowlist'],
    'MCP direct policy',
  );
  if (
    record.format !== 'furypipe-mcp-direct-policy/v1'
    || typeof record.policyId !== 'string'
    || !SAFE_ID.test(record.policyId)
  ) {
    throw new Error('MCP direct policy identity is invalid');
  }
  return Object.freeze({
    format: 'furypipe-mcp-direct-policy/v1',
    policyId: record.policyId,
    governedPolicyAllowlist: normalizedPairs(
      record.governedPolicyAllowlist,
      'MCP governed policy allowlist',
    ),
    operatorApprovalAllowlist: normalizedPairs(
      record.operatorApprovalAllowlist,
      'MCP operator approval allowlist',
    ),
  });
}

function includesPair(
  pairs: readonly McpDirectPolicyPair[],
  sourceId: string,
  endpointFingerprint: string,
  toolName: string,
): boolean {
  return pairs.some((pair) =>
    pair.sourceId === sourceId
    && pair.endpointFingerprint === endpointFingerprint
    && pair.toolName === toolName
  );
}

function assertProposalBound(
  lifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
): ProposalState {
  const selected = assertLifecycleSelected(lifecycle);
  if (!isGeneratedMcpDirectToolProposal(proposal)) {
    throw new Error('MCP tool proposal must be process-local FuryPipe evidence');
  }
  const internal = PROPOSAL_STATE.get(proposal)!;
  if (
    proposal.format !== 'furypipe-mcp-direct-tool-proposal/v1'
    || proposal.sourceId !== internal.sourceId
    || proposal.endpointFingerprint !== internal.endpointFingerprint
    || proposal.toolName !== internal.toolName
    || proposal.inputSchemaSha256 !== internal.inputSchemaSha256
    || proposal.inputSha256 !== internal.inputSha256
    || proposal.riskClass !== internal.riskClass
    || proposal.argumentsValidated !== true
    || lifecycle.source.sourceId !== internal.sourceId
    || lifecycle.source.endpointFingerprint !== internal.endpointFingerprint
    || lifecycle.selectedTool !== internal.toolName
    || selected.inputSchemaSha256 !== internal.inputSchemaSha256
    || selected.risk.riskClass !== internal.riskClass
  ) {
    throw new Error('MCP proposal is not bound to the selected lifecycle evidence');
  }
  const expectedProposalSha256 = digestMcpDirectJson({
    sourceId: internal.sourceId,
    endpointFingerprint: internal.endpointFingerprint,
    toolName: internal.toolName,
    inputSchemaSha256: internal.inputSchemaSha256,
    inputSha256: internal.inputSha256,
    riskClass: internal.riskClass,
    argumentsValidated: true,
  }, {
    maxBytes: 16 * 1024,
    maxDepth: 8,
    label: 'MCP tool proposal evidence',
  });
  if (proposal.proposalSha256 !== expectedProposalSha256) {
    throw new Error('MCP proposal digest does not match its process-local evidence');
  }
  return internal;
}

export function isGeneratedMcpDirectToolProposal(
  value: unknown,
): value is McpDirectToolProposal {
  return typeof value === 'object' && value !== null && PROPOSAL_STATE.has(value);
}

export function isGeneratedMcpDirectPolicyDecision(
  value: unknown,
): value is McpDirectPolicyDecision {
  return typeof value === 'object' && value !== null && DECISION_STATE.has(value);
}

/**
 * Validates an exact argument object against the exact selected schema from the
 * process-local catalog. Public evidence is digest-only; raw arguments remain
 * process-local for the later governed execution track.
 */
export async function createMcpDirectToolProposal(
  lifecycle: McpDirectLifecycleState,
  catalog: McpDirectCatalogHandle,
  args: unknown,
): Promise<McpDirectToolProposal> {
  const selected = assertLifecycleSelected(lifecycle);
  const schema = resolveMcpDirectSelectedToolSchema(catalog, lifecycle);
  const normalizedArgs = args === undefined
    ? Object.freeze({})
    : ownRecord(args, 'MCP tool arguments');
  const canonicalArgs = canonicalizeMcpDirectJson(normalizedArgs, {
    maxBytes: MAX_ARGUMENT_BYTES,
    maxDepth: MAX_ARGUMENT_DEPTH,
    label: 'MCP tool arguments',
  });
  const validatedArgs = JSON.parse(canonicalArgs) as Readonly<Record<string, unknown>>;
  const inputSha256 = digestMcpDirectJson(validatedArgs, {
    maxBytes: MAX_ARGUMENT_BYTES,
    maxDepth: MAX_ARGUMENT_DEPTH,
    label: 'MCP tool arguments',
  });

  let validation: { readonly issues?: readonly unknown[] };
  try {
    // A fresh validator prevents cross-server/cross-proposal $id cache reuse
    // from validating one server's arguments against another server's schema.
    const validator = fromJsonSchema(
      schema as Parameters<typeof fromJsonSchema>[0],
      new AjvJsonSchemaValidator(),
    );
    validation = await validator['~standard'].validate(validatedArgs);
  } catch {
    throw new Error('MCP selected tool input schema could not validate arguments');
  }
  if (validation.issues && validation.issues.length > 0) {
    throw new Error('MCP tool arguments failed input schema validation');
  }

  const proposalCore = Object.freeze({
    sourceId: lifecycle.source.sourceId,
    endpointFingerprint: lifecycle.source.endpointFingerprint,
    toolName: lifecycle.selectedTool!,
    inputSchemaSha256: selected.inputSchemaSha256,
    inputSha256,
    riskClass: selected.risk.riskClass,
    argumentsValidated: true as const,
  });
  const proposalSha256 = digestMcpDirectJson(proposalCore, {
    maxBytes: 16 * 1024,
    maxDepth: 8,
    label: 'MCP tool proposal evidence',
  });
  const proposal: McpDirectToolProposal = Object.freeze({
    format: 'furypipe-mcp-direct-tool-proposal/v1',
    proposalSha256,
    ...proposalCore,
  });
  PROPOSAL_STATE.set(proposal, Object.freeze({
    canonicalArguments: canonicalArgs,
    sourceId: proposal.sourceId,
    endpointFingerprint: proposal.endpointFingerprint,
    toolName: proposal.toolName,
    inputSchemaSha256: proposal.inputSchemaSha256,
    inputSha256: proposal.inputSha256,
    riskClass: proposal.riskClass,
  }));
  return proposal;
}

/**
 * Returns a fresh exact JSON clone for the future M3 executor. The proposal
 * itself remains non-serializable authority because copied objects fail the
 * WeakMap provenance check.
 */
export function resolveMcpDirectProposalArguments(
  proposal: McpDirectToolProposal,
): unknown {
  if (!isGeneratedMcpDirectToolProposal(proposal)) {
    throw new Error('MCP tool proposal must be process-local FuryPipe evidence');
  }
  return JSON.parse(PROPOSAL_STATE.get(proposal)!.canonicalArguments) as unknown;
}

export function evaluateMcpDirectPolicy(
  lifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  policyInput: McpDirectPolicy,
  options: McpDirectPolicyEvaluationOptions = {},
): McpDirectPolicyDecision {
  const selected = assertLifecycleSelected(lifecycle);
  assertProposalBound(lifecycle, proposal);
  const policy = normalizePolicy(policyInput);
  const evaluatedAt = options.now ?? Date.now();
  const expiresInMs = options.expiresInMs ?? DEFAULT_POLICY_DECISION_TTL_MS;
  if (!Number.isSafeInteger(evaluatedAt) || evaluatedAt < 0) {
    throw new Error('MCP policy evaluation timestamp must be a non-negative safe integer');
  }
  if (
    !Number.isSafeInteger(expiresInMs)
    || expiresInMs < 1
    || expiresInMs > MAX_POLICY_DECISION_TTL_MS
  ) {
    throw new Error('MCP policy decision TTL must be between 1 and 60000 ms');
  }
  const expiresAt = evaluatedAt + expiresInMs;
  if (!Number.isSafeInteger(expiresAt)) {
    throw new Error('MCP policy decision expiry must be a safe integer');
  }

  const policySha256 = digestMcpDirectJson(policy, {
    maxBytes: 256 * 1024,
    maxDepth: 16,
    label: 'MCP direct policy',
  });

  const autoAllowlisted = includesPair(
    policy.governedPolicyAllowlist,
    proposal.sourceId,
    proposal.endpointFingerprint,
    proposal.toolName,
  );
  const operatorAllowlisted = includesPair(
    policy.operatorApprovalAllowlist,
    proposal.sourceId,
    proposal.endpointFingerprint,
    proposal.toolName,
  );
  const safePolicyCandidate = lifecycle.source.trust === 'trusted'
    && selected.risk.riskClass === 'trusted_read_only_closed_world'
    && selected.risk.closedWorldReadCandidate === true
    && selected.risk.authorizationGranted === false
    && selected.risk.requiresPolicyGate === true;

  let outcome: McpDirectPolicyOutcome;
  let reason: McpDirectPolicyDecision['reason'];
  if (autoAllowlisted && safePolicyCandidate) {
    outcome = 'allow_governed_policy';
    reason = 'trusted_closed_world_exact_allowlist';
  } else if (operatorAllowlisted) {
    outcome = 'require_operator';
    reason = autoAllowlisted
      ? 'governed_policy_risk_ineligible'
      : 'operator_exact_allowlist';
  } else {
    outcome = 'deny';
    reason = autoAllowlisted
      ? 'governed_policy_risk_ineligible'
      : 'not_allowlisted';
  }

  const decisionCore = Object.freeze({
    policyId: policy.policyId,
    policySha256,
    proposalSha256: proposal.proposalSha256,
    sourceId: proposal.sourceId,
    endpointFingerprint: proposal.endpointFingerprint,
    toolName: proposal.toolName,
    inputSchemaSha256: proposal.inputSchemaSha256,
    inputSha256: proposal.inputSha256,
    riskClass: proposal.riskClass,
    policyEvaluated: true as const,
    evaluatedAt,
    expiresAt,
    outcome,
    reason,
  });
  const policyDecisionIdSha256 = digestMcpDirectJson(decisionCore, {
    maxBytes: 32 * 1024,
    maxDepth: 8,
    label: 'MCP policy decision evidence',
  });
  const decision: McpDirectPolicyDecision = Object.freeze({
    format: 'furypipe-mcp-direct-policy-decision/v1',
    policyDecisionIdSha256,
    ...decisionCore,
  });
  DECISION_STATE.set(decision, Object.freeze({
    proposal,
    policyId: policy.policyId,
    policySha256,
    evaluatedAt,
    expiresAt,
    outcome,
    approved: false,
  }));
  return decision;
}

function assertDecisionBound(
  proposal: McpDirectToolProposal,
  decision: McpDirectPolicyDecision,
): DecisionState {
  if (!isGeneratedMcpDirectPolicyDecision(decision)) {
    throw new Error('MCP policy decision must be process-local FuryPipe evidence');
  }
  const internal = DECISION_STATE.get(decision)!;
  if (
    internal.proposal !== proposal
    || decision.format !== 'furypipe-mcp-direct-policy-decision/v1'
    || decision.policyId !== internal.policyId
    || decision.policySha256 !== internal.policySha256
    || !SHA256.test(decision.policySha256)
    || decision.proposalSha256 !== proposal.proposalSha256
    || decision.sourceId !== proposal.sourceId
    || decision.endpointFingerprint !== proposal.endpointFingerprint
    || decision.toolName !== proposal.toolName
    || decision.inputSchemaSha256 !== proposal.inputSchemaSha256
    || decision.inputSha256 !== proposal.inputSha256
    || decision.riskClass !== proposal.riskClass
    || decision.policyEvaluated !== true
    || decision.evaluatedAt !== internal.evaluatedAt
    || decision.expiresAt !== internal.expiresAt
    || decision.expiresAt <= decision.evaluatedAt
    || decision.outcome !== internal.outcome
    || !SHA256.test(decision.policyDecisionIdSha256)
  ) {
    throw new Error('MCP policy decision is not bound to the exact proposal evidence');
  }

  const expectedDecisionId = digestMcpDirectJson({
    policyId: decision.policyId,
    policySha256: decision.policySha256,
    proposalSha256: decision.proposalSha256,
    sourceId: decision.sourceId,
    endpointFingerprint: decision.endpointFingerprint,
    toolName: decision.toolName,
    inputSchemaSha256: decision.inputSchemaSha256,
    inputSha256: decision.inputSha256,
    riskClass: decision.riskClass,
    policyEvaluated: true,
    evaluatedAt: decision.evaluatedAt,
    expiresAt: decision.expiresAt,
    outcome: decision.outcome,
    reason: decision.reason,
  }, {
    maxBytes: 32 * 1024,
    maxDepth: 8,
    label: 'MCP policy decision evidence',
  });
  if (expectedDecisionId !== decision.policyDecisionIdSha256) {
    throw new Error('MCP policy decision digest does not match its evidence');
  }
  return internal;
}

export function isGeneratedMcpDirectOperatorApprovalIntent(
  value: unknown,
): value is McpDirectOperatorApprovalIntent {
  return typeof value === 'object' && value !== null && OPERATOR_INTENT_STATE.has(value);
}

/**
 * Records a short-lived explicit operator action. The host/UI is responsible
 * for calling this only after fresh human intent; serialized/copied objects
 * are never accepted as operator authority.
 */
export function createMcpDirectOperatorApprovalIntent(
  proposal: McpDirectToolProposal,
  decision: McpDirectPolicyDecision,
  options: McpDirectOperatorIntentOptions = {},
): McpDirectOperatorApprovalIntent {
  if (!isGeneratedMcpDirectToolProposal(proposal)) {
    throw new Error('MCP tool proposal must be process-local FuryPipe evidence');
  }
  const internalDecision = assertDecisionBound(proposal, decision);
  if (internalDecision.outcome === 'deny') {
    throw new Error('MCP policy denied operator approval for this proposal');
  }
  if (internalDecision.approved) {
    throw new Error('MCP policy decision was already used for approval');
  }

  const now = options.now ?? Date.now();
  const expiresInMs = options.expiresInMs ?? DEFAULT_OPERATOR_INTENT_TTL_MS;
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('MCP operator intent timestamp must be a non-negative safe integer');
  }
  if (now < decision.evaluatedAt || now >= decision.expiresAt) {
    throw new Error('MCP policy decision is expired or not yet valid for operator intent');
  }
  if (
    !Number.isSafeInteger(expiresInMs)
    || expiresInMs < 1
    || expiresInMs > MAX_OPERATOR_INTENT_TTL_MS
  ) {
    throw new Error('MCP operator intent TTL must be between 1 and 60000 ms');
  }
  const requestedExpiresAt = now + expiresInMs;
  if (!Number.isSafeInteger(requestedExpiresAt)) {
    throw new Error('MCP operator intent expiry must be a safe integer');
  }
  const expiresAt = Math.min(requestedExpiresAt, decision.expiresAt);
  if (expiresAt <= now) {
    throw new Error('MCP operator intent cannot outlive policy decision freshness');
  }

  const intent: McpDirectOperatorApprovalIntent = Object.freeze({
    format: 'furypipe-mcp-direct-operator-intent/v1',
    intentId: `mcpop_${crypto.randomUUID()}`,
    proposalSha256: proposal.proposalSha256,
    policyDecisionIdSha256: decision.policyDecisionIdSha256,
    issuedAt: now,
    expiresAt,
  });
  OPERATOR_INTENT_STATE.set(intent, {
    proposal,
    decision,
    consumed: false,
  });
  return intent;
}

export function approveMcpDirectPolicyDecision(
  lifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  decision: McpDirectPolicyDecision,
  authority: 'governed_policy' | McpDirectOperatorApprovalIntent,
  now: number = Date.now(),
): McpDirectLifecycleState {
  assertProposalBound(lifecycle, proposal);
  const internalDecision = assertDecisionBound(proposal, decision);

  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('MCP approval timestamp must be a non-negative safe integer');
  }
  if (now < decision.evaluatedAt || now >= decision.expiresAt) {
    throw new Error('MCP policy decision is expired or not yet valid for approval');
  }
  if (internalDecision.approved) {
    throw new Error('MCP policy decision was already used for approval');
  }
  if (internalDecision.outcome === 'deny') {
    throw new Error('MCP policy denied approval for this proposal');
  }

  let approvalKind: 'operator' | 'governed_policy';
  let approvalExpiresAt: number;
  if (authority === 'governed_policy') {
    if (internalDecision.outcome !== 'allow_governed_policy') {
      throw new Error('MCP governed-policy approval is not authorized by this decision');
    }
    const expiresAt = now + GOVERNED_APPROVAL_TTL_MS;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new Error('MCP governed approval expiry must be a safe integer');
    }
    approvalKind = 'governed_policy';
    approvalExpiresAt = Math.min(expiresAt, decision.expiresAt);
  } else {
    if (!isGeneratedMcpDirectOperatorApprovalIntent(authority)) {
      throw new Error('MCP operator approval requires process-local explicit intent');
    }
    const intentState = OPERATOR_INTENT_STATE.get(authority)!;
    if (
      authority.format !== 'furypipe-mcp-direct-operator-intent/v1'
      || intentState.proposal !== proposal
      || intentState.decision !== decision
      || authority.proposalSha256 !== proposal.proposalSha256
      || authority.policyDecisionIdSha256 !== decision.policyDecisionIdSha256
    ) {
      throw new Error('MCP operator intent is not bound to the exact proposal and policy decision');
    }
    if (now < authority.issuedAt || now >= authority.expiresAt) {
      throw new Error('MCP operator intent is expired or not yet valid');
    }
    if (intentState.consumed) {
      throw new Error('MCP operator intent was already consumed');
    }
    intentState.consumed = true;
    approvalKind = 'operator';
    approvalExpiresAt = Math.min(authority.expiresAt, decision.expiresAt);
  }

  internalDecision.approved = true;
  return recordMcpDirectApproval(lifecycle, {
    policyDecisionIdSha256: decision.policyDecisionIdSha256,
    inputSha256: proposal.inputSha256,
    approvalKind,
    approvedAt: now,
    expiresAt: approvalExpiresAt,
  });
}
