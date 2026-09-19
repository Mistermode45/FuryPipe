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
  McpDirectExecutionOutcomeUnknownError,
  McpDirectExecutionVerificationError,
  type McpDirectExecutionReceipt,
} from './mcp-direct-executor-node.js';
import type { McpDirectLifecycleState } from './mcp-direct-governance.js';
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
  readonly maxConcurrentExecutions?: number;
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
  readonly transport: 'stdio' | 'streamable_http';
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
  readonly reason?: 'non-json-result' | 'result-too-large';
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
  discard(proposalId: string): boolean;
  pendingProposalCount(): number;
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

function exactInput(
  value: FuryKernelToolProposalInput,
): FuryKernelToolProposalInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('tool proposal input must be a plain object');
  }
  const record = value as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some((key) => !['sourceId', 'toolName', 'arguments'].includes(key))
    || keys.length < 2
  ) {
    throw new Error('tool proposal input contains unsupported fields');
  }
  assertSafeId(value.sourceId, 'sourceId');
  assertSafeId(value.toolName, 'toolName');
  return value;
}

function normalizeSources(
  sources: readonly FuryKernelToolBridgeSource[],
): ReadonlyMap<string, SourceState> {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_SOURCES) {
    throw new Error(`tool bridge requires 1-${MAX_SOURCES} host-owned MCP sources`);
  }
  const output = new Map<string, SourceState>();
  for (const entry of sources) {
    if (!entry || typeof entry !== 'object' || !entry.config || !entry.policy) {
      throw new Error('tool bridge source configuration is incomplete');
    }
    const source = entry.config.source;
    assertSafeId(source.sourceId, 'sourceId');
    if (output.has(source.sourceId)) {
      throw new Error('tool bridge source IDs must be unique');
    }
    const expected = deriveMcpDirectEndpointFingerprint(entry.config);
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
      config: entry.config,
      policy: entry.policy,
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
  if (
    !options
    || typeof options !== 'object'
    || !options.clientInfo
    || typeof options.clientInfo.name !== 'string'
    || typeof options.clientInfo.version !== 'string'
  ) {
    throw new Error('Fury Kernel tool bridge configuration is incomplete');
  }
  const sources = normalizeSources(options.sources);
  const now = options.now ?? Date.now;
  safeNow(now);
  const maxPendingProposals = boundedInteger(
    options.maxPendingProposals,
    DEFAULT_MAX_PENDING_PROPOSALS,
    1,
    HARD_MAX_PENDING_PROPOSALS,
    'maxPendingProposals',
  );
  const maxConcurrentExecutions = boundedInteger(
    options.maxConcurrentExecutions,
    DEFAULT_MAX_CONCURRENT_EXECUTIONS,
    1,
    HARD_MAX_CONCURRENT_EXECUTIONS,
    'maxConcurrentExecutions',
  );
  const maxDisplayResultBytes = boundedInteger(
    options.maxDisplayResultBytes,
    DEFAULT_MAX_DISPLAY_RESULT_BYTES,
    1024,
    HARD_MAX_DISPLAY_RESULT_BYTES,
    'maxDisplayResultBytes',
  );

  const pending = new Map<string, PendingProposal>();
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

  const probe = async (source: SourceState) => probeMcpDirectInventory(
    source.config,
    {
      clientInfo: options.clientInfo,
      ...(options.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: options.connectTimeoutMs }),
      ...(options.listTimeoutMs === undefined ? {} : { listTimeoutMs: options.listTimeoutMs }),
      ...(options.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: options.probeTimeoutMs }),
      ...(options.listMaxPages === undefined ? {} : { listMaxPages: options.listMaxPages }),
    },
  );

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
      const at = safeNow(now);
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
      const at = safeNow(now);
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
      const at = safeNow(now);
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
            clientInfo: options.clientInfo,
            ...(options.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: options.connectTimeoutMs }),
            ...(options.listTimeoutMs === undefined ? {} : { listTimeoutMs: options.listTimeoutMs }),
            ...(options.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: options.probeTimeoutMs }),
            ...(options.listMaxPages === undefined ? {} : { listMaxPages: options.listMaxPages }),
            ...(options.callTimeoutMs === undefined ? {} : { callTimeoutMs: options.callTimeoutMs }),
            ...(options.permitTtlMs === undefined ? {} : { permitTtlMs: options.permitTtlMs }),
            ...(options.maxExecutionResultBytes === undefined
              ? {}
              : { maxResultBytes: options.maxExecutionResultBytes }),
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
          displayResult: jsonCloneBounded(execution.result, maxDisplayResultBytes),
          retrySafe: false as const,
          executionAuthority: false as const,
        });
      } catch (error) {
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

    discard(proposalId: string): boolean {
      if (typeof proposalId !== 'string' || !SAFE_ID.test(proposalId)) return false;
      const record = pending.get(proposalId);
      if (!record || record.status === 'executing') return false;
      pending.delete(proposalId);
      return true;
    },

    pendingProposalCount(): number {
      pruneExpired(safeNow(now));
      return pending.size;
    },

    activeExecutionCount(): number {
      return activeExecutions;
    },
  });
}
