import { randomUUID } from 'node:crypto';

import {
  deriveMcpDirectEndpointFingerprint,
  probeMcpDirectInventory,
  type McpDirectClientInfo,
  type McpDirectRuntimeConfig,
} from './mcp-direct-client-node.js';
import {
  executeMcpDirectApprovedTool,
  McpDirectExecutionDurabilityError,
  McpDirectExecutionEvidenceError,
  McpDirectExecutionPreCallRejectedError,
  McpDirectExecutionOutcomeUnknownError,
  McpDirectExecutionVerificationError,
  type McpDirectExecutionReceipt,
} from './mcp-direct-executor-node.js';
import type {
  McpDirectLifecycleState,
  McpDirectSourceConfig,
} from './mcp-direct-governance.js';
import { canonicalizeMcpDirectJson } from './mcp-direct-json.js';
import {
  approveMcpDirectPolicyDecision,
  createMcpDirectOperatorApprovalIntent,
  createMcpDirectToolProposal,
  evaluateMcpDirectPolicy,
  selectMcpDirectTool,
  type McpDirectPolicy,
  type McpDirectPolicyDecision,
  type McpDirectToolProposal,
} from './mcp-direct-policy.js';
import type { McpDirectCatalogHandle } from './mcp-direct-catalog.js';
import type { McpToolRiskClass } from './mcp-tool-risk.js';

export const FURY_KERNEL_TOOL_BRIDGE_FORMAT =
  'furypipe-kernel-tool-bridge/v1' as const;

export interface FuryKernelToolBridgeSource {
  readonly config: McpDirectRuntimeConfig;
  readonly policy: McpDirectPolicy;
}

export interface FuryKernelToolBridgeOptions {
  readonly sources: readonly FuryKernelToolBridgeSource[];
  readonly clientInfo: McpDirectClientInfo;
  readonly now?: () => number;
  readonly maxPendingProposals?: number;
  readonly maxConcurrentProbes?: number;
  readonly maxConcurrentExecutions?: number;
  /**
   * Host-owned disclosure policy. Raw MCP application results are not
   * browser-facing by default even when they are valid bounded JSON.
   */
  readonly allowDisplayResult?: boolean;
  readonly maxDisplayResultBytes?: number;
  readonly connectTimeoutMs?: number;
  readonly listTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  readonly listMaxPages?: number;
  readonly callTimeoutMs?: number;
  readonly permitTtlMs?: number;
  readonly maxExecutionResultBytes?: number;
}

export interface FuryKernelToolSourceSummary {
  readonly sourceId: string;
  readonly transport: 'stdio' | 'streamable_http' | 'sse';
  readonly endpointFingerprint: string;
  readonly trust: 'trusted' | 'untrusted';
  readonly executionAuthority: false;
}

export interface FuryKernelToolInventoryTool {
  readonly name: string;
  readonly inputSchemaSha256: string;
  readonly riskClass: McpToolRiskClass;
  readonly closedWorldReadCandidate: boolean;
  readonly authorizationGranted: false;
}

export interface FuryKernelToolSourceInspection {
  readonly format: typeof FURY_KERNEL_TOOL_BRIDGE_FORMAT;
  readonly source: FuryKernelToolSourceSummary;
  readonly connected: true;
  readonly healthy: true;
  readonly listed: true;
  readonly protocolEra?: string;
  readonly handshake?: string;
  readonly tools: readonly FuryKernelToolInventoryTool[];
  readonly executionAuthority: false;
}

export interface FuryKernelToolProposalInput {
  readonly sourceId: string;
  readonly toolName: string;
  readonly arguments?: unknown;
}

export type FuryKernelToolProposalStatus =
  | 'denied'
  | 'approval-required'
  | 'approved';

export interface FuryKernelToolProposalResult {
  readonly format: typeof FURY_KERNEL_TOOL_BRIDGE_FORMAT;
  readonly status: FuryKernelToolProposalStatus;
  readonly proposalId?: string;
  readonly sourceId: string;
  readonly toolName: string;
  readonly riskClass: McpToolRiskClass;
  readonly proposalSha256: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly policy: {
    readonly policyDecisionIdSha256: string;
    readonly outcome: 'deny' | 'require_operator' | 'allow_governed_policy';
    readonly reason: string;
    readonly expiresAt: number;
  };
  readonly approvalKind?: 'governed_policy';
  readonly executionAuthority: false;
}

export interface FuryKernelToolApprovalResult {
  readonly format: typeof FURY_KERNEL_TOOL_BRIDGE_FORMAT;
  readonly status: 'approved';
  readonly proposalId: string;
  readonly sourceId: string;
  readonly toolName: string;
  readonly approvalKind: 'operator';
  readonly expiresAt: number;
  readonly executionAuthority: false;
}

export interface FuryKernelToolDisplayResult {
  readonly available: boolean;
  readonly value?: unknown;
  readonly reason?: 'display-disabled' | 'non-json-result' | 'result-too-large';
}

export interface FuryKernelToolExecutionState {
  readonly executed: boolean | 'unknown';
  readonly succeeded: boolean | 'unknown';
  readonly verified: boolean;
}

export type FuryKernelToolExecutionStatus =
  | 'completed'
  | 'failed'
  | 'outcome-unknown';

export interface FuryKernelToolExecutionResult {
  readonly format: typeof FURY_KERNEL_TOOL_BRIDGE_FORMAT;
  readonly status: FuryKernelToolExecutionStatus;
  readonly proposalId: string;
  readonly sourceId: string;
  readonly toolName: string;
  readonly state: FuryKernelToolExecutionState;
  readonly receipt?: McpDirectExecutionReceipt;
  readonly displayResult?: FuryKernelToolDisplayResult;
  readonly failureCode?: string;
  readonly retrySafe: false;
  readonly executionAuthority: false;
}

export interface FuryKernelToolBridge {
  inspectSources(): readonly FuryKernelToolSourceSummary[];
  inspectSource(sourceId: string): Promise<FuryKernelToolSourceInspection>;
  propose(input: FuryKernelToolProposalInput): Promise<FuryKernelToolProposalResult>;
  approve(proposalId: string): FuryKernelToolApprovalResult;
  execute(proposalId: string): Promise<FuryKernelToolExecutionResult>;
  proposalTransport(
    proposalId: string,
  ): 'stdio' | 'streamable_http' | 'sse' | undefined;
  discard(proposalId: string): boolean;
  pendingProposalCount(): number;
  activeProbeCount(): number;
  activeExecutionCount(): number;
}

interface SourceState {
  readonly config: McpDirectRuntimeConfig;
  readonly policy: McpDirectPolicy;
  readonly summary: FuryKernelToolSourceSummary;
}

interface PendingProposal {
  readonly proposalId: string;
  readonly source: SourceState;
  readonly lifecycle: McpDirectLifecycleState;
  readonly catalog: McpDirectCatalogHandle;
  readonly proposal: McpDirectToolProposal;
  readonly decision: McpDirectPolicyDecision;
  readonly createdAt: number;
  readonly expiresAt: number;
  approvedLifecycle?: McpDirectLifecycleState;
  approvalKind?: 'operator' | 'governed_policy';
  status: 'approval-required' | 'approved' | 'executing';
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DEFAULT_MAX_PENDING_PROPOSALS = 128;
const HARD_MAX_PENDING_PROPOSALS = 1024;
const DEFAULT_MAX_CONCURRENT_PROBES = 4;
const HARD_MAX_CONCURRENT_PROBES = 16;
const DEFAULT_MAX_CONCURRENT_EXECUTIONS = 4;
const HARD_MAX_CONCURRENT_EXECUTIONS = 32;
const DEFAULT_MAX_DISPLAY_RESULT_BYTES = 64 * 1024;
const HARD_MAX_DISPLAY_RESULT_BYTES = 1024 * 1024;
const MAX_SOURCES = 32;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_ENTRIES = 4096;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return resolved;
}

function safeNow(source: () => number): number {
  const value = source();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Fury Kernel tool bridge clock is invalid');
  }
  return value;
}

function assertSafeId(value: string, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${label} must be a bounded safe identifier`);
  }
  return value;
}

function plainDataRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new Error(`${label} must be a plain data object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
    ) {
      throw new Error(`${label} must contain enumerable own data properties only`);
    }
  }
  return record;
}

function exactDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  const record = plainDataRecord(value, label);
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} contains unsupported fields`);
    }
  }
  return record;
}

function dataArraySnapshot(
  value: unknown,
  label: string,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be a bounded data array`);
  }
  const own = Object.getOwnPropertyNames(value);
  if (
    own.some((name) =>
      name !== 'length'
      && !/^(?:0|[1-9][0-9]*)$/u.test(name)
    )
  ) {
    throw new Error(`${label} contains unsupported array properties`);
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
    ) {
      throw new Error(`${label} contains sparse, hidden, or accessor entries`);
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function stringArraySnapshot(
  value: unknown,
  label: string,
  maximum: number,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be a bounded string array`);
  }
  const own = Object.getOwnPropertyNames(value);
  if (
    own.some((name) =>
      name !== 'length'
      && !/^(?:0|[1-9][0-9]*)$/u.test(name)
    )
  ) {
    throw new Error(`${label} contains unsupported array properties`);
  }
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || typeof descriptor.value !== 'string'
    ) {
      throw new Error(`${label} contains invalid entries`);
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function stringRecordSnapshot(
  value: unknown,
  label: string,
  maximum: number,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const record = plainDataRecord(value, label);
  const names = Object.getOwnPropertyNames(record);
  if (names.length > maximum) {
    throw new Error(`${label} exceeds its entry bound`);
  }
  const output: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of names) {
    const entry = record[name];
    if (typeof entry !== 'string') {
      throw new Error(`${label} values must be strings`);
    }
    output[name] = entry;
  }
  return Object.freeze(output);
}

function positiveIntegerOrUndefined(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function optionalString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function snapshotSourceConfig(value: unknown): McpDirectSourceConfig {
  const record = exactDataRecord(
    value,
    ['sourceId', 'transport', 'endpointFingerprint', 'trust'],
    'MCP source',
  );
  if (
    typeof record.sourceId !== 'string'
    || typeof record.endpointFingerprint !== 'string'
    || (record.transport !== 'stdio' && record.transport !== 'streamable_http')
    || (record.trust !== 'trusted' && record.trust !== 'untrusted')
  ) {
    throw new Error('MCP source configuration is invalid');
  }
  return Object.freeze({
    sourceId: record.sourceId,
    transport: record.transport,
    endpointFingerprint: record.endpointFingerprint,
    trust: record.trust,
  });
}

function snapshotRuntimeConfig(value: unknown): McpDirectRuntimeConfig {
  const root = plainDataRecord(value, 'MCP runtime configuration');
  const source = snapshotSourceConfig(root.source);

  if (source.transport === 'stdio') {
    const record = exactDataRecord(
      value,
      ['source', 'command', 'args', 'env', 'principalId', 'cwd', 'maxBufferBytes'],
      'MCP stdio runtime configuration',
    );
    if (typeof record.command !== 'string' || record.command.length === 0) {
      throw new Error('MCP stdio command is invalid');
    }
    const args = stringArraySnapshot(record.args, 'MCP stdio args', 128);
    const env = stringRecordSnapshot(record.env, 'MCP stdio env', 128);
    const principalId = optionalString(record.principalId, 'MCP stdio principalId');
    const cwd = optionalString(record.cwd, 'MCP stdio cwd');
    const maxBufferBytes = positiveIntegerOrUndefined(
      record.maxBufferBytes,
      'MCP stdio maxBufferBytes',
    );
    return Object.freeze({
      source: Object.freeze({ ...source, transport: 'stdio' as const }),
      command: record.command,
      ...(args === undefined ? {} : { args }),
      ...(env === undefined ? {} : { env }),
      ...(principalId === undefined ? {} : { principalId }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(maxBufferBytes === undefined ? {} : { maxBufferBytes }),
    });
  }

  const record = exactDataRecord(
    value,
    ['source', 'url', 'allowedHosts', 'headers', 'principalId', 'maxResponseBytes'],
    'MCP HTTP runtime configuration',
  );
  if (typeof record.url !== 'string' || record.url.length === 0) {
    throw new Error('MCP HTTP URL is invalid');
  }
  const allowedHosts = stringArraySnapshot(
    record.allowedHosts,
    'MCP HTTP allowedHosts',
    128,
  );
  const headers = stringRecordSnapshot(record.headers, 'MCP HTTP headers', 64);
  const principalId = optionalString(record.principalId, 'MCP HTTP principalId');
  const maxResponseBytes = positiveIntegerOrUndefined(
    record.maxResponseBytes,
    'MCP HTTP maxResponseBytes',
  );
  return Object.freeze({
    source: Object.freeze({ ...source, transport: 'streamable_http' as const }),
    url: record.url,
    ...(allowedHosts === undefined ? {} : { allowedHosts }),
    ...(headers === undefined ? {} : { headers }),
    ...(principalId === undefined ? {} : { principalId }),
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
  });
}

function snapshotPolicyPair(value: unknown): {
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly toolName: string;
} {
  const record = exactDataRecord(
    value,
    ['sourceId', 'endpointFingerprint', 'toolName'],
    'MCP policy pair',
  );
  if (
    typeof record.sourceId !== 'string'
    || typeof record.endpointFingerprint !== 'string'
    || typeof record.toolName !== 'string'
  ) {
    throw new Error('MCP policy pair is invalid');
  }
  return Object.freeze({
    sourceId: record.sourceId,
    endpointFingerprint: record.endpointFingerprint,
    toolName: record.toolName,
  });
}

function snapshotPolicy(value: unknown): McpDirectPolicy {
  const record = exactDataRecord(
    value,
    ['format', 'policyId', 'governedPolicyAllowlist', 'operatorApprovalAllowlist'],
    'MCP policy',
  );
  if (
    record.format !== 'furypipe-mcp-direct-policy/v1'
    || typeof record.policyId !== 'string'
    || !SAFE_ID.test(record.policyId)
  ) {
    throw new Error('MCP policy configuration is invalid');
  }
  const governedPolicyAllowlist = dataArraySnapshot(
    record.governedPolicyAllowlist,
    'MCP governed policy allowlist',
    256,
  );
  const operatorApprovalAllowlist = dataArraySnapshot(
    record.operatorApprovalAllowlist,
    'MCP operator approval allowlist',
    256,
  );
  return Object.freeze({
    format: 'furypipe-mcp-direct-policy/v1' as const,
    policyId: record.policyId,
    governedPolicyAllowlist: Object.freeze(
      governedPolicyAllowlist.map(snapshotPolicyPair),
    ),
    operatorApprovalAllowlist: Object.freeze(
      operatorApprovalAllowlist.map(snapshotPolicyPair),
    ),
  });
}

function snapshotJsonArgument(value: unknown): unknown {
  if (value === undefined) return undefined;
  const canonical = canonicalizeMcpDirectJson(value, {
    maxBytes: 1024 * 1024,
    maxDepth: 64,
    label: 'tool proposal arguments',
  });
  return JSON.parse(canonical) as unknown;
}

function exactInput(
  value: FuryKernelToolProposalInput,
): FuryKernelToolProposalInput {
  const record = exactDataRecord(
    value,
    ['sourceId', 'toolName', 'arguments'],
    'tool proposal input',
  );
  if (
    typeof record.sourceId !== 'string'
    || typeof record.toolName !== 'string'
  ) {
    throw new Error('tool proposal input is invalid');
  }
  const sourceId = assertSafeId(record.sourceId, 'sourceId');
  const toolName = assertSafeId(record.toolName, 'toolName');
  const args = snapshotJsonArgument(record.arguments);
  return Object.freeze({
    sourceId,
    toolName,
    ...(record.arguments === undefined ? {} : { arguments: args }),
  });
}

function normalizeSources(
  sources: readonly FuryKernelToolBridgeSource[],
): ReadonlyMap<string, SourceState> {
  const candidates = dataArraySnapshot(
    sources,
    'tool bridge sources',
    MAX_SOURCES,
  );
  if (candidates.length < 1) {
    throw new Error(`tool bridge requires 1-${MAX_SOURCES} host-owned MCP sources`);
  }
  const output = new Map<string, SourceState>();
  for (const candidate of candidates) {
    const entry = exactDataRecord(
      candidate,
      ['config', 'policy'],
      'tool bridge source',
    );
    const config = snapshotRuntimeConfig(entry.config);
    const policy = snapshotPolicy(entry.policy);
    const source = config.source;
    assertSafeId(source.sourceId, 'sourceId');
    if (output.has(source.sourceId)) {
      throw new Error('tool bridge source IDs must be unique');
    }
    const expected = deriveMcpDirectEndpointFingerprint(config);
    if (expected !== source.endpointFingerprint) {
      throw new Error(`MCP source ${source.sourceId} endpoint fingerprint does not match runtime configuration`);
    }
    const summary = Object.freeze({
      sourceId: source.sourceId,
      transport: source.transport,
      endpointFingerprint: source.endpointFingerprint,
      trust: source.trust,
      executionAuthority: false as const,
    });
    output.set(source.sourceId, Object.freeze({
      config,
      policy,
      summary,
    }));
  }
  return output;
}

function jsonCloneBounded(
  value: unknown,
  maxBytes: number,
): FuryKernelToolDisplayResult {
  let entries = 0;

  const walk = (input: unknown, depth: number): unknown => {
    if (depth > MAX_JSON_DEPTH) throw new Error('non-json');
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('non-json');
      return input;
    }
    if (Array.isArray(input)) {
      entries += input.length;
      if (entries > MAX_JSON_ENTRIES) throw new Error('non-json');
      return input.map((item) => walk(item, depth + 1));
    }
    if (!input || typeof input !== 'object') throw new Error('non-json');
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('non-json');
    if (Object.getOwnPropertySymbols(input).length > 0) throw new Error('non-json');

    const output: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(input)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('non-json');
      }
      entries += 1;
      if (entries > MAX_JSON_ENTRIES) throw new Error('non-json');
      output[key] = walk(descriptor.value, depth + 1);
    }
    return output;
  };

  let clone: unknown;
  try {
    clone = walk(value, 0);
  } catch {
    return Object.freeze({
      available: false,
      reason: 'non-json-result' as const,
    });
  }

  let encoded: string;
  try {
    encoded = JSON.stringify(clone);
  } catch {
    return Object.freeze({
      available: false,
      reason: 'non-json-result' as const,
    });
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    return Object.freeze({
      available: false,
      reason: 'result-too-large' as const,
    });
  }
  return Object.freeze({
    available: true,
    value: JSON.parse(encoded) as unknown,
  });
}

function lifecycleTools(
  lifecycle: McpDirectLifecycleState,
): readonly FuryKernelToolInventoryTool[] {
  return Object.freeze((lifecycle.inventory ?? []).map((tool) => Object.freeze({
    name: tool.name,
    inputSchemaSha256: tool.inputSchemaSha256,
    riskClass: tool.risk.riskClass,
    closedWorldReadCandidate: tool.risk.closedWorldReadCandidate,
    authorizationGranted: false as const,
  })));
}

function proposalSummary(
  status: FuryKernelToolProposalStatus,
  proposalId: string | undefined,
  proposal: McpDirectToolProposal,
  decision: McpDirectPolicyDecision,
  approvalKind?: 'governed_policy',
): FuryKernelToolProposalResult {
  return Object.freeze({
    format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
    status,
    ...(proposalId === undefined ? {} : { proposalId }),
    sourceId: proposal.sourceId,
    toolName: proposal.toolName,
    riskClass: proposal.riskClass,
    proposalSha256: proposal.proposalSha256,
    inputSchemaSha256: proposal.inputSchemaSha256,
    inputSha256: proposal.inputSha256,
    policy: Object.freeze({
      policyDecisionIdSha256: decision.policyDecisionIdSha256,
      outcome: decision.outcome,
      reason: decision.reason,
      expiresAt: decision.expiresAt,
    }),
    ...(approvalKind === undefined ? {} : { approvalKind }),
    executionAuthority: false as const,
  });
}

function receiptState(
  receipt: McpDirectExecutionReceipt,
): FuryKernelToolExecutionState {
  return Object.freeze({
    executed: receipt.executed,
    succeeded: receipt.succeeded,
    verified: receipt.verified,
  });
}

export function createFuryKernelToolBridge(
  options: FuryKernelToolBridgeOptions,
): FuryKernelToolBridge {
  const config = exactDataRecord(
    options,
    [
      'sources',
      'clientInfo',
      'now',
      'maxPendingProposals',
      'maxConcurrentProbes',
      'maxConcurrentExecutions',
      'allowDisplayResult',
      'maxDisplayResultBytes',
      'connectTimeoutMs',
      'listTimeoutMs',
      'probeTimeoutMs',
      'listMaxPages',
      'callTimeoutMs',
      'permitTtlMs',
      'maxExecutionResultBytes',
    ],
    'Fury Kernel tool bridge configuration',
  );
  const clientInfoRecord = exactDataRecord(
    config.clientInfo,
    ['name', 'version'],
    'MCP clientInfo',
  );
  if (
    typeof clientInfoRecord.name !== 'string'
    || clientInfoRecord.name.length === 0
    || typeof clientInfoRecord.version !== 'string'
    || clientInfoRecord.version.length === 0
  ) {
    throw new Error('Fury Kernel tool bridge clientInfo is invalid');
  }
  const clientInfo: McpDirectClientInfo = Object.freeze({
    name: clientInfoRecord.name,
    version: clientInfoRecord.version,
  });
  const sources = normalizeSources(
    config.sources as readonly FuryKernelToolBridgeSource[],
  );
  const now = config.now === undefined ? Date.now : config.now;
  if (typeof now !== 'function') {
    throw new Error('Fury Kernel tool bridge clock is invalid');
  }
  safeNow(now as () => number);
  const clock = now as () => number;
  const maxPendingProposals = boundedInteger(
    config.maxPendingProposals as number | undefined,
    DEFAULT_MAX_PENDING_PROPOSALS,
    1,
    HARD_MAX_PENDING_PROPOSALS,
    'maxPendingProposals',
  );
  const maxConcurrentProbes = boundedInteger(
    config.maxConcurrentProbes as number | undefined,
    DEFAULT_MAX_CONCURRENT_PROBES,
    1,
    HARD_MAX_CONCURRENT_PROBES,
    'maxConcurrentProbes',
  );
  const maxConcurrentExecutions = boundedInteger(
    config.maxConcurrentExecutions as number | undefined,
    DEFAULT_MAX_CONCURRENT_EXECUTIONS,
    1,
    HARD_MAX_CONCURRENT_EXECUTIONS,
    'maxConcurrentExecutions',
  );
  const allowDisplayResult = config.allowDisplayResult === undefined
    ? false
    : config.allowDisplayResult;
  if (typeof allowDisplayResult !== 'boolean') {
    throw new Error('allowDisplayResult must be a boolean');
  }
  const maxDisplayResultBytes = boundedInteger(
    config.maxDisplayResultBytes as number | undefined,
    DEFAULT_MAX_DISPLAY_RESULT_BYTES,
    1024,
    HARD_MAX_DISPLAY_RESULT_BYTES,
    'maxDisplayResultBytes',
  );
  const connectTimeoutMs = positiveIntegerOrUndefined(
    config.connectTimeoutMs,
    'connectTimeoutMs',
  );
  const listTimeoutMs = positiveIntegerOrUndefined(
    config.listTimeoutMs,
    'listTimeoutMs',
  );
  const probeTimeoutMs = positiveIntegerOrUndefined(
    config.probeTimeoutMs,
    'probeTimeoutMs',
  );
  const listMaxPages = positiveIntegerOrUndefined(
    config.listMaxPages,
    'listMaxPages',
  );
  const callTimeoutMs = positiveIntegerOrUndefined(
    config.callTimeoutMs,
    'callTimeoutMs',
  );
  const permitTtlMs = positiveIntegerOrUndefined(
    config.permitTtlMs,
    'permitTtlMs',
  );
  const maxExecutionResultBytes = positiveIntegerOrUndefined(
    config.maxExecutionResultBytes,
    'maxExecutionResultBytes',
  );

  const pending = new Map<string, PendingProposal>();
  let activeProbes = 0;
  let activeExecutions = 0;

  const pruneExpired = (at: number): void => {
    for (const [proposalId, record] of pending) {
      if (record.status !== 'executing' && record.expiresAt <= at) {
        pending.delete(proposalId);
      }
    }
  };

  const sourceFor = (sourceId: string): SourceState => {
    const source = sources.get(assertSafeId(sourceId, 'sourceId'));
    if (!source) throw new Error('MCP source is not configured');
    return source;
  };

  const probe = async (source: SourceState) => {
    if (activeProbes >= maxConcurrentProbes) {
      throw new Error('tool probe concurrency limit is reached');
    }
    activeProbes += 1;
    try {
      return await probeMcpDirectInventory(
        source.config,
        {
          clientInfo,
          ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
          ...(listTimeoutMs === undefined ? {} : { listTimeoutMs }),
          ...(probeTimeoutMs === undefined ? {} : { probeTimeoutMs }),
          ...(listMaxPages === undefined ? {} : { listMaxPages }),
        },
      );
    } finally {
      activeProbes = Math.max(0, activeProbes - 1);
    }
  };

  return Object.freeze({
    inspectSources(): readonly FuryKernelToolSourceSummary[] {
      return Object.freeze([...sources.values()]
        .map((entry) => entry.summary)
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId)));
    },

    async inspectSource(sourceId: string): Promise<FuryKernelToolSourceInspection> {
      const source = sourceFor(sourceId);
      const evidence = await probe(source);
      return Object.freeze({
        format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
        source: source.summary,
        connected: true as const,
        healthy: true as const,
        listed: true as const,
        ...(evidence.lifecycle.protocolEra === undefined
          ? {}
          : { protocolEra: evidence.lifecycle.protocolEra }),
        ...(evidence.lifecycle.handshake === undefined
          ? {}
          : { handshake: evidence.lifecycle.handshake }),
        tools: lifecycleTools(evidence.lifecycle),
        executionAuthority: false as const,
      });
    },

    async propose(input: FuryKernelToolProposalInput): Promise<FuryKernelToolProposalResult> {
      const valid = exactInput(input);
      const at = safeNow(clock);
      pruneExpired(at);
      if (pending.size >= maxPendingProposals) {
        throw new Error('tool proposal capacity is exhausted');
      }
      const source = sourceFor(valid.sourceId);
      const evidence = await probe(source);
      const selected = selectMcpDirectTool(evidence.lifecycle, valid.toolName);
      const proposal = await createMcpDirectToolProposal(
        selected,
        evidence.catalog,
        valid.arguments,
      );
      const decision = evaluateMcpDirectPolicy(
        selected,
        proposal,
        source.policy,
        { now: at },
      );

      if (decision.outcome === 'deny') {
        return proposalSummary('denied', undefined, proposal, decision);
      }

      const proposalId = `ftb_${randomUUID()}`;
      const record: PendingProposal = {
        proposalId,
        source,
        lifecycle: selected,
        catalog: evidence.catalog,
        proposal,
        decision,
        createdAt: at,
        expiresAt: decision.expiresAt,
        status: decision.outcome === 'require_operator'
          ? 'approval-required'
          : 'approved',
      };

      if (decision.outcome === 'allow_governed_policy') {
        record.approvedLifecycle = approveMcpDirectPolicyDecision(
          selected,
          proposal,
          decision,
          'governed_policy',
          at,
        );
        record.approvalKind = 'governed_policy';
      }

      pending.set(proposalId, record);
      return proposalSummary(
        record.status === 'approved' ? 'approved' : 'approval-required',
        proposalId,
        proposal,
        decision,
        record.approvalKind === 'governed_policy' ? 'governed_policy' : undefined,
      );
    },

    approve(proposalId: string): FuryKernelToolApprovalResult {
      assertSafeId(proposalId, 'proposalId');
      const at = safeNow(clock);
      pruneExpired(at);
      const record = pending.get(proposalId);
      if (!record) throw new Error('tool proposal is missing or expired');
      if (record.status !== 'approval-required') {
        throw new Error('tool proposal is not awaiting operator approval');
      }
      if (record.decision.outcome !== 'require_operator') {
        throw new Error('tool proposal policy does not require operator approval');
      }
      const intent = createMcpDirectOperatorApprovalIntent(
        record.proposal,
        record.decision,
        { now: at },
      );
      record.approvedLifecycle = approveMcpDirectPolicyDecision(
        record.lifecycle,
        record.proposal,
        record.decision,
        intent,
        at,
      );
      record.approvalKind = 'operator';
      record.status = 'approved';
      const expiresAt = record.approvedLifecycle.approval?.expiresAt;
      if (expiresAt === undefined) {
        throw new Error('MCP operator approval did not produce freshness evidence');
      }
      return Object.freeze({
        format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
        status: 'approved' as const,
        proposalId,
        sourceId: record.proposal.sourceId,
        toolName: record.proposal.toolName,
        approvalKind: 'operator' as const,
        expiresAt,
        executionAuthority: false as const,
      });
    },

    async execute(proposalId: string): Promise<FuryKernelToolExecutionResult> {
      assertSafeId(proposalId, 'proposalId');
      const at = safeNow(clock);
      pruneExpired(at);
      const record = pending.get(proposalId);
      if (!record) throw new Error('tool proposal is missing or expired');
      if (record.status !== 'approved' || !record.approvedLifecycle) {
        throw new Error('tool proposal is not approved for execution');
      }
      if (activeExecutions >= maxConcurrentExecutions) {
        throw new Error('tool execution concurrency limit is reached');
      }

      record.status = 'executing';
      activeExecutions += 1;
      try {
        const execution = await executeMcpDirectApprovedTool(
          record.source.config,
          record.approvedLifecycle,
          record.proposal,
          {
            clientInfo,
            ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
            ...(listTimeoutMs === undefined ? {} : { listTimeoutMs }),
            ...(probeTimeoutMs === undefined ? {} : { probeTimeoutMs }),
            ...(listMaxPages === undefined ? {} : { listMaxPages }),
            ...(callTimeoutMs === undefined ? {} : { callTimeoutMs }),
            ...(permitTtlMs === undefined ? {} : { permitTtlMs }),
            ...(maxExecutionResultBytes === undefined
              ? {}
              : { maxResultBytes: maxExecutionResultBytes }),
          },
        );
        return Object.freeze({
          format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
          status: 'completed' as const,
          proposalId,
          sourceId: execution.receipt.sourceId,
          toolName: execution.receipt.toolName,
          state: receiptState(execution.receipt),
          receipt: execution.receipt,
          displayResult: allowDisplayResult
            ? jsonCloneBounded(execution.result, maxDisplayResultBytes)
            : Object.freeze({
                available: false,
                reason: 'display-disabled' as const,
              }),
          retrySafe: false as const,
          executionAuthority: false as const,
        });
      } catch (error) {
        if (error instanceof McpDirectExecutionPreCallRejectedError) {
          return Object.freeze({
            format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
            status: 'failed' as const,
            proposalId,
            sourceId: error.sourceId,
            toolName: error.toolName,
            state: Object.freeze({
              executed: false,
              succeeded: false,
              verified: false,
            }),
            failureCode: error.code,
            retrySafe: false as const,
            executionAuthority: false as const,
          });
        }
        if (error instanceof McpDirectExecutionOutcomeUnknownError) {
          return Object.freeze({
            format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
            status: 'outcome-unknown' as const,
            proposalId,
            sourceId: error.sourceId,
            toolName: error.toolName,
            state: Object.freeze({
              executed: 'unknown' as const,
              succeeded: 'unknown' as const,
              verified: false,
            }),
            failureCode: error.code,
            retrySafe: false as const,
            executionAuthority: false as const,
          });
        }
        if (error instanceof McpDirectExecutionVerificationError) {
          return Object.freeze({
            format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
            status: 'failed' as const,
            proposalId,
            sourceId: error.sourceId,
            toolName: error.toolName,
            state: Object.freeze({
              executed: true,
              succeeded: true,
              verified: false,
            }),
            failureCode: error.code,
            retrySafe: false as const,
            executionAuthority: false as const,
          });
        }
        if (error instanceof McpDirectExecutionEvidenceError) {
          return Object.freeze({
            format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
            status: 'failed' as const,
            proposalId,
            sourceId: error.sourceId,
            toolName: error.toolName,
            state: Object.freeze({
              executed: true,
              succeeded: error.succeeded,
              verified: false,
            }),
            failureCode: error.code,
            retrySafe: false as const,
            executionAuthority: false as const,
          });
        }
        if (error instanceof McpDirectExecutionDurabilityError) {
          return Object.freeze({
            format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
            status: 'failed' as const,
            proposalId,
            sourceId: error.sourceId,
            toolName: error.toolName,
            state: Object.freeze({
              executed: true,
              succeeded: error.succeeded,
              verified: error.verified,
            }),
            failureCode: error.code,
            retrySafe: false as const,
            executionAuthority: false as const,
          });
        }
        return Object.freeze({
          format: FURY_KERNEL_TOOL_BRIDGE_FORMAT,
          status: 'failed' as const,
          proposalId,
          sourceId: record.proposal.sourceId,
          toolName: record.proposal.toolName,
          state: Object.freeze({
            executed: 'unknown' as const,
            succeeded: 'unknown' as const,
            verified: false,
          }),
          failureCode: 'MCP_DIRECT_EXECUTION_FAILED',
          retrySafe: false as const,
          executionAuthority: false as const,
        });
      } finally {
        activeExecutions = Math.max(0, activeExecutions - 1);
        pending.delete(proposalId);
      }
    },

    proposalTransport(
      proposalId: string,
    ): 'stdio' | 'streamable_http' | 'sse' | undefined {
      if (typeof proposalId !== 'string' || !SAFE_ID.test(proposalId)) return undefined;
      pruneExpired(safeNow(clock));
      return pending.get(proposalId)?.source.config.source.transport;
    },

    discard(proposalId: string): boolean {
      if (typeof proposalId !== 'string' || !SAFE_ID.test(proposalId)) return false;
      const record = pending.get(proposalId);
      if (!record || record.status === 'executing') return false;
      pending.delete(proposalId);
      return true;
    },

    pendingProposalCount(): number {
      pruneExpired(safeNow(clock));
      return pending.size;
    },

    activeProbeCount(): number {
      return activeProbes;
    },

    activeExecutionCount(): number {
      return activeExecutions;
    },
  });
}
