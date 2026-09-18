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
  readonly approvalKind: 'operator' | 'governed_policy';
}

export interface McpDirectExecutionPermit {
  readonly format: 'furypipe-mcp-execution-permit/v1';
  readonly sourceId: string;
  readonly toolName: string;
  readonly inputSha256: string;
  readonly policyDecisionIdSha256: string;
  readonly approvalKind: 'operator' | 'governed_policy';
}

export interface McpDirectExecutionEvidence {
  readonly permit: McpDirectExecutionPermit;
  readonly resultSha256?: string;
  readonly isError: boolean;
}

export interface McpDirectVerificationEvidence {
  readonly resultSha256: string;
  readonly verificationKind: 'schema' | 'semantic' | 'operator';
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

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function assertId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${label} must be a bounded safe identifier`);
}

function assertSha(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function freezeState(state: McpDirectLifecycleState): McpDirectLifecycleState {
  return Object.freeze(state);
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
  if (state.connected) throw new Error('MCP source is already connected');
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
  if (!state.connected) throw new Error('MCP source must be connected before health can be recorded');
  if (state.protocolEra === 'modern_2026' && evidence === 'legacy_ping_success') {
    throw new Error('legacy ping cannot prove health for a modern MCP 2026 connection');
  }
  return freezeState({ ...state, healthy: true, healthEvidence: evidence });
}

export function recordMcpDirectInventory(
  state: McpDirectLifecycleState,
  tools: readonly McpDirectInventoryTool[],
): McpDirectLifecycleState {
  if (!state.connected) throw new Error('MCP source must be connected before listing tools');
  if (tools.length > 256) throw new Error('MCP tool inventory exceeds the 256 tool bound');

  const seen = new Set<string>();
  const inventory = tools.map((tool) => {
    assertId(tool.name, 'tool name');
    assertSha(tool.inputSchemaSha256, 'inputSchemaSha256');
    if (seen.has(tool.name)) throw new Error('MCP tool inventory contains duplicate names');
    seen.add(tool.name);
    if (tool.risk.authorizationGranted !== false || tool.risk.requiresPolicyGate !== true) {
      throw new Error('MCP risk evidence must preserve the policy gate');
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
  if (!state.selected || !state.selectedTool) {
    throw new Error('MCP tool must be selected before approval');
  }
  assertSha(evidence.policyDecisionIdSha256, 'policyDecisionIdSha256');
  return freezeState({
    ...state,
    approved: true,
    approval: Object.freeze({ ...evidence }),
  });
}

export function createMcpDirectExecutionPermit(
  state: McpDirectLifecycleState,
  inputSha256: string,
): McpDirectExecutionPermit {
  if (!state.approved || !state.approval || !state.selectedTool) {
    throw new Error('MCP execution permit requires an approved selected tool');
  }
  assertSha(inputSha256, 'inputSha256');
  return Object.freeze({
    format: 'furypipe-mcp-execution-permit/v1',
    sourceId: state.source.sourceId,
    toolName: state.selectedTool,
    inputSha256,
    policyDecisionIdSha256: state.approval.policyDecisionIdSha256,
    approvalKind: state.approval.approvalKind,
  });
}

export function recordMcpDirectExecution(
  state: McpDirectLifecycleState,
  evidence: McpDirectExecutionEvidence,
): McpDirectLifecycleState {
  if (!state.approved || !state.selectedTool || !state.approval) {
    throw new Error('MCP execution requires prior approval');
  }
  const permit = evidence.permit;
  if (
    permit.sourceId !== state.source.sourceId
    || permit.toolName !== state.selectedTool
    || permit.policyDecisionIdSha256 !== state.approval.policyDecisionIdSha256
    || permit.approvalKind !== state.approval.approvalKind
  ) {
    throw new Error('MCP execution permit does not match the approved selection');
  }
  assertSha(permit.inputSha256, 'inputSha256');
  if (evidence.resultSha256 !== undefined) assertSha(evidence.resultSha256, 'resultSha256');

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
  if (!state.executed || !state.succeeded) {
    throw new Error('MCP result must execute successfully before verification');
  }
  assertSha(evidence.resultSha256, 'resultSha256');
  if (state.executionResultSha256 !== undefined && state.executionResultSha256 !== evidence.resultSha256) {
    throw new Error('MCP verification digest does not match execution evidence');
  }
  return freezeState({
    ...state,
    verified: true,
    verification: Object.freeze({ ...evidence }),
  });
}
