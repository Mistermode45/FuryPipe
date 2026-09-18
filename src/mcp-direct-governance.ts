import type { McpToolRiskAssessment, McpToolTrust } from './mcp-tool-risk.js';

export type McpDirectTransport = 'stdio' | 'streamable_http';
export type McpDirectProtocolEra = 'modern_2026' | 'legacy_2025' | 'unknown';
export type McpDirectHandshake = 'discover' | 'initialize' | 'unknown';
export type McpDirectHealthEvidence =
  | 'list_tools_success'
  | 'legacy_ping_success'
  | 'explicit_transport_probe_success';

export interface McpDirectSourceConfig {
  readonly sourceId: string;
  readonly transport: McpDirectTransport;
  /**
   * Stable non-secret identity for the configured endpoint/process definition.
   * Never place bearer tokens, command-line secrets, URL credentials or raw env
   * values here.
   */
  readonly endpointFingerprint: string;
  readonly trust: McpToolTrust;
}

export interface McpDirectInventoryTool {
  readonly name: string;
  readonly inputSchemaSha256: string;
  readonly risk: McpToolRiskAssessment;
}

export interface McpDirectApprovalEvidence {
  readonly policyDecisionIdSha256: string;
  readonly inputSha256: string;
  readonly approvalKind: 'operator' | 'governed_policy';
  readonly approvedAt: number;
  readonly expiresAt: number;
}

export interface McpDirectExecutionPermit {
  readonly format: 'furypipe-mcp-execution-permit/v1';
  readonly permitId: string;
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly toolName: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly policyDecisionIdSha256: string;
  readonly approvalKind: 'operator' | 'governed_policy';
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface McpDirectExecutionEvidence {
  readonly permit: McpDirectExecutionPermit;
  readonly resultSha256?: string;
  readonly isError: boolean;
}

export interface McpDirectVerificationEvidence {
  readonly resultSha256: string;
  readonly verificationKind: 'schema' | 'semantic' | 'operator';
  /** Required exactly when verificationKind is schema. */
  readonly schemaSha256?: string;
}

export interface McpDirectLifecycleState {
  readonly format: 'furypipe-mcp-direct-lifecycle/v1';
  readonly source: McpDirectSourceConfig;
  readonly configured: true;
  readonly connected: boolean;
  readonly healthy: boolean;
  readonly listed: boolean;
  readonly trusted: boolean;
  readonly selected: boolean;
  readonly approved: boolean;
  readonly executed: boolean;
  readonly succeeded: boolean;
  readonly verified: boolean;
  readonly protocolEra?: McpDirectProtocolEra;
  readonly handshake?: McpDirectHandshake;
  readonly healthEvidence?: McpDirectHealthEvidence;
  readonly inventory?: readonly McpDirectInventoryTool[];
  readonly selectedTool?: string;
  readonly approval?: McpDirectApprovalEvidence;
  readonly executionPermit?: McpDirectExecutionPermit;
  readonly executionResultSha256?: string;
  readonly verification?: McpDirectVerificationEvidence;
}

export interface McpDirectPermitOptions {
  readonly now?: number;
  readonly expiresInMs?: number;
}

interface McpDirectPermitState {
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly toolName: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly policyDecisionIdSha256: string;
  readonly approvalKind: 'operator' | 'governed_policy';
  consumed: boolean;
  recorded: boolean;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const GENERATED_STATES = new WeakSet<object>();
const PERMIT_STATE = new WeakMap<object, McpDirectPermitState>();
const DEFAULT_PERMIT_TTL_MS = 30_000;
const MAX_PERMIT_TTL_MS = 60_000;

function assertId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${label} must be a bounded safe identifier`);
}

function assertSha(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer timestamp`);
  }
}

function freezeState(state: McpDirectLifecycleState): McpDirectLifecycleState {
  const frozen = Object.freeze(state);
  GENERATED_STATES.add(frozen);
  return frozen;
}

export function isGeneratedMcpDirectLifecycleState(
  value: unknown,
): value is McpDirectLifecycleState {
  return typeof value === 'object' && value !== null && GENERATED_STATES.has(value);
}

function assertGeneratedState(state: McpDirectLifecycleState): void {
  if (!isGeneratedMcpDirectLifecycleState(state)) {
    throw new Error('MCP lifecycle state must be process-local FuryPipe evidence');
  }
}

function selectedInventoryTool(state: McpDirectLifecycleState): McpDirectInventoryTool {
  assertGeneratedState(state);
  if (!state.selected || !state.selectedTool || !state.inventory) {
    throw new Error('MCP tool must be selected first');
  }
  const tool = state.inventory.find((item) => item.name === state.selectedTool);
  if (!tool) throw new Error('selected MCP tool is not present in the current inventory');
  return tool;
}

export function isGeneratedMcpDirectExecutionPermit(
  value: unknown,
): value is McpDirectExecutionPermit {
  return typeof value === 'object' && value !== null && PERMIT_STATE.has(value);
}

export function createMcpDirectLifecycle(
  source: McpDirectSourceConfig,
): McpDirectLifecycleState {
  assertId(source.sourceId, 'sourceId');
  assertSha(source.endpointFingerprint, 'endpointFingerprint');
  if (source.transport !== 'stdio' && source.transport !== 'streamable_http') {
    throw new Error('unsupported MCP transport');
  }
  if (source.trust !== 'trusted' && source.trust !== 'untrusted') {
    throw new Error('MCP source trust must be trusted or untrusted');
  }

  const frozenSource = Object.freeze({ ...source });
  return freezeState({
    format: 'furypipe-mcp-direct-lifecycle/v1',
    source: frozenSource,
    configured: true,
    connected: false,
    healthy: false,
    listed: false,
    trusted: source.trust === 'trusted',
    selected: false,
    approved: false,
    executed: false,
    succeeded: false,
    verified: false,
  });
}

export function recordMcpDirectConnection(
  state: McpDirectLifecycleState,
  evidence: {
    readonly protocolEra: McpDirectProtocolEra;
    readonly handshake: McpDirectHandshake;
  },
): McpDirectLifecycleState {
  assertGeneratedState(state);
  if (state.connected) throw new Error('MCP source is already connected');
  if (!['modern_2026', 'legacy_2025', 'unknown'].includes(evidence.protocolEra)) {
    throw new Error('unsupported MCP protocol era');
  }
  if (!['discover', 'initialize', 'unknown'].includes(evidence.handshake)) {
    throw new Error('unsupported MCP handshake');
  }
  if (evidence.protocolEra === 'modern_2026' && evidence.handshake === 'initialize') {
    throw new Error('modern MCP 2026 connection must not be represented as an initialize handshake');
  }

  return freezeState({
    ...state,
    connected: true,
    protocolEra: evidence.protocolEra,
    handshake: evidence.handshake,
  });
}

export function recordMcpDirectHealth(
  state: McpDirectLifecycleState,
  evidence: McpDirectHealthEvidence,
): McpDirectLifecycleState {
  assertGeneratedState(state);
  if (!state.connected) throw new Error('MCP source must be connected before health can be recorded');
  if (!['list_tools_success', 'legacy_ping_success', 'explicit_transport_probe_success'].includes(evidence)) {
    throw new Error('unsupported MCP health evidence');
  }
  if (state.protocolEra === 'modern_2026' && evidence === 'legacy_ping_success') {
    throw new Error('legacy ping cannot prove health for a modern MCP 2026 connection');
  }
  return freezeState({ ...state, healthy: true, healthEvidence: evidence });
}

export function recordMcpDirectInventory(
  state: McpDirectLifecycleState,
  tools: readonly McpDirectInventoryTool[],
): McpDirectLifecycleState {
  assertGeneratedState(state);
  if (!state.connected) throw new Error('MCP source must be connected before listing tools');
  if (!Array.isArray(tools) || tools.length > 256) {
    throw new Error('MCP tool inventory exceeds the 256 tool bound');
  }

  const seen = new Set<string>();
  const inventory = tools.map((tool) => {
    if (!tool || typeof tool !== 'object') throw new Error('MCP inventory tool must be an object');
    assertId(tool.name, 'tool name');
    assertSha(tool.inputSchemaSha256, 'inputSchemaSha256');
    if (seen.has(tool.name)) throw new Error('MCP tool inventory contains duplicate names');
    seen.add(tool.name);

    if (
      !tool.risk
      || typeof tool.risk !== 'object'
      || tool.risk.trust !== state.source.trust
      || tool.risk.authorizationGranted !== false
      || tool.risk.requiresPolicyGate !== true
    ) {
      throw new Error('MCP risk evidence must be source-bound and preserve the policy gate');
    }
    if (state.source.trust === 'untrusted' && tool.risk.riskClass !== 'untrusted_unknown') {
      throw new Error('untrusted MCP source cannot carry a trusted risk class');
    }

    return Object.freeze({ ...tool });
  });

  return freezeState({
    ...state,
    listed: true,
    healthy: true,
    healthEvidence: 'list_tools_success',
    inventory: Object.freeze(inventory),
  });
}

export function recordMcpDirectSelection(
  state: McpDirectLifecycleState,
  toolName: string,
): McpDirectLifecycleState {
  assertGeneratedState(state);
  if (!state.listed || !state.inventory) {
    throw new Error('MCP tools must be listed before selection');
  }
  if (!state.inventory.some((tool) => tool.name === toolName)) {
    throw new Error('selected MCP tool is not present in the current inventory');
  }
  return freezeState({
    ...state,
    selected: true,
    selectedTool: toolName,
    approved: false,
    approval: undefined,
    executionPermit: undefined,
    executed: false,
    succeeded: false,
    verified: false,
    executionResultSha256: undefined,
    verification: undefined,
  });
}

export function recordMcpDirectApproval(
  state: McpDirectLifecycleState,
  evidence: McpDirectApprovalEvidence,
): McpDirectLifecycleState {
  assertGeneratedState(state);
  selectedInventoryTool(state);
  assertSha(evidence.policyDecisionIdSha256, 'policyDecisionIdSha256');
  assertSha(evidence.inputSha256, 'inputSha256');
  assertTimestamp(evidence.approvedAt, 'approval approvedAt');
  assertTimestamp(evidence.expiresAt, 'approval expiresAt');
  if (evidence.expiresAt <= evidence.approvedAt) {
    throw new Error('MCP approval expiry must be after approval time');
  }
  if (evidence.approvalKind !== 'operator' && evidence.approvalKind !== 'governed_policy') {
    throw new Error('unsupported MCP approval kind');
  }
  return freezeState({
    ...state,
    approved: true,
    approval: Object.freeze({ ...evidence }),
  });
}

export function createMcpDirectExecutionPermit(
  state: McpDirectLifecycleState,
  inputSha256: string,
  options: McpDirectPermitOptions = {},
): McpDirectExecutionPermit {
  assertGeneratedState(state);
  if (!state.approved || !state.approval || !state.selectedTool) {
    throw new Error('MCP execution permit requires an approved selected tool');
  }
  const tool = selectedInventoryTool(state);
  assertSha(inputSha256, 'inputSha256');
  if (state.approval.inputSha256 !== inputSha256) {
    throw new Error('MCP execution permit input does not match the approved input digest');
  }

  const now = options.now ?? Date.now();
  const expiresInMs = options.expiresInMs ?? DEFAULT_PERMIT_TTL_MS;
  assertTimestamp(now, 'permit now');
  if (now < state.approval.approvedAt || now >= state.approval.expiresAt) {
    throw new Error('MCP approval is expired or not yet valid');
  }
  if (!Number.isSafeInteger(expiresInMs) || expiresInMs < 1 || expiresInMs > MAX_PERMIT_TTL_MS) {
    throw new Error('MCP execution permit TTL must be between 1 and 60000 ms');
  }
  const requestedExpiresAt = now + expiresInMs;
  assertTimestamp(requestedExpiresAt, 'permit expiresAt');
  const expiresAt = Math.min(requestedExpiresAt, state.approval.expiresAt);
  if (expiresAt <= now) {
    throw new Error('MCP execution permit cannot outlive approval freshness');
  }

  const permit: McpDirectExecutionPermit = Object.freeze({
    format: 'furypipe-mcp-execution-permit/v1',
    permitId: `mcpexec_${crypto.randomUUID()}`,
    sourceId: state.source.sourceId,
    endpointFingerprint: state.source.endpointFingerprint,
    toolName: state.selectedTool,
    inputSchemaSha256: tool.inputSchemaSha256,
    inputSha256,
    policyDecisionIdSha256: state.approval.policyDecisionIdSha256,
    approvalKind: state.approval.approvalKind,
    issuedAt: now,
    expiresAt,
  });

  PERMIT_STATE.set(permit, {
    sourceId: permit.sourceId,
    endpointFingerprint: permit.endpointFingerprint,
    toolName: permit.toolName,
    inputSchemaSha256: permit.inputSchemaSha256,
    inputSha256: permit.inputSha256,
    policyDecisionIdSha256: permit.policyDecisionIdSha256,
    approvalKind: permit.approvalKind,
    consumed: false,
    recorded: false,
  });
  return permit;
}

/**
 * Synchronously consumes a process-local permit before a future transport call.
 * This is the point that prevents forged/copy/replayed permits and TOCTOU
 * rebinding across source, endpoint, tool schema, input or policy decision.
 */
export function consumeMcpDirectExecutionPermit(
  state: McpDirectLifecycleState,
  permit: McpDirectExecutionPermit,
  inputSha256: string,
  now: number = Date.now(),
): void {
  assertGeneratedState(state);
  if (!state.approved || !state.approval || !state.selectedTool) {
    throw new Error('MCP execution requires prior approval');
  }
  const tool = selectedInventoryTool(state);
  assertSha(inputSha256, 'inputSha256');
  assertTimestamp(now, 'permit consume time');

  if (!isGeneratedMcpDirectExecutionPermit(permit)) {
    throw new Error('MCP execution permit is not process-local FuryPipe evidence');
  }
  const internal = PERMIT_STATE.get(permit)!;

  if (
    permit.format !== 'furypipe-mcp-execution-permit/v1'
    || internal.sourceId !== state.source.sourceId
    || internal.endpointFingerprint !== state.source.endpointFingerprint
    || internal.toolName !== state.selectedTool
    || internal.inputSchemaSha256 !== tool.inputSchemaSha256
    || internal.inputSha256 !== inputSha256
    || internal.policyDecisionIdSha256 !== state.approval.policyDecisionIdSha256
    || internal.approvalKind !== state.approval.approvalKind
    || permit.sourceId !== internal.sourceId
    || permit.endpointFingerprint !== internal.endpointFingerprint
    || permit.toolName !== internal.toolName
    || permit.inputSchemaSha256 !== internal.inputSchemaSha256
    || permit.inputSha256 !== internal.inputSha256
    || permit.policyDecisionIdSha256 !== internal.policyDecisionIdSha256
    || permit.approvalKind !== internal.approvalKind
  ) {
    throw new Error('MCP execution permit does not match the approved request');
  }
  if (now < permit.issuedAt || now >= permit.expiresAt) {
    throw new Error('MCP execution permit is expired or not yet valid');
  }
  if (internal.consumed) throw new Error('MCP execution permit was already consumed');

  internal.consumed = true;
}

export function recordMcpDirectExecution(
  state: McpDirectLifecycleState,
  evidence: McpDirectExecutionEvidence,
): McpDirectLifecycleState {
  assertGeneratedState(state);
  if (!state.approved || !state.selectedTool || !state.approval) {
    throw new Error('MCP execution requires prior approval');
  }
  const permit = evidence.permit;
  if (!isGeneratedMcpDirectExecutionPermit(permit)) {
    throw new Error('MCP execution permit is not process-local FuryPipe evidence');
  }
  const internal = PERMIT_STATE.get(permit)!;
  if (!internal.consumed) {
    throw new Error('MCP execution permit must be consumed before execution is recorded');
  }
  if (internal.recorded) {
    throw new Error('MCP execution permit already has an execution record');
  }
  if (
    internal.sourceId !== state.source.sourceId
    || internal.endpointFingerprint !== state.source.endpointFingerprint
    || internal.toolName !== state.selectedTool
    || internal.policyDecisionIdSha256 !== state.approval.policyDecisionIdSha256
  ) {
    throw new Error('MCP consumed permit no longer matches the approved selection');
  }

  if (evidence.resultSha256 !== undefined) assertSha(evidence.resultSha256, 'resultSha256');
  internal.recorded = true;

  return freezeState({
    ...state,
    executed: true,
    succeeded: !evidence.isError,
    verified: false,
    executionPermit: permit,
    executionResultSha256: evidence.resultSha256,
    verification: undefined,
  });
}

export function recordMcpDirectVerification(
  state: McpDirectLifecycleState,
  evidence: McpDirectVerificationEvidence,
): McpDirectLifecycleState {
  assertGeneratedState(state);
  if (!state.executed || !state.succeeded) {
    throw new Error('MCP result must execute successfully before verification');
  }
  assertSha(evidence.resultSha256, 'resultSha256');
  if (state.executionResultSha256 === undefined || state.executionResultSha256 !== evidence.resultSha256) {
    throw new Error('MCP verification digest does not match execution evidence');
  }
  if (!['schema', 'semantic', 'operator'].includes(evidence.verificationKind)) {
    throw new Error('unsupported MCP verification kind');
  }
  if (evidence.verificationKind === 'schema') {
    if (evidence.schemaSha256 === undefined) {
      throw new Error('schema verification requires an exact schema SHA-256 digest');
    }
    assertSha(evidence.schemaSha256, 'verification schemaSha256');
  } else if (evidence.schemaSha256 !== undefined) {
    throw new Error('non-schema verification must not carry a schema digest');
  }
  return freezeState({
    ...state,
    verified: true,
    verification: Object.freeze({ ...evidence }),
  });
}
