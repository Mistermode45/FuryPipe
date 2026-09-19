import { randomBytes } from 'node:crypto';

import {
  deriveMcpDirectEndpointFingerprint,
  probeMcpDirectInventory,
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

export const FURY_KERNEL_MCP_TOOL_BRIDGE_FORMAT =
  'furypipe-kernel-mcp-tool-bridge/v1' as const;

export type FuryKernelMcpToolProposalStatus =
  | 'denied'
  | 'approval_required'
  | 'approved'
  | 'executing'
  | 'executed'
  | 'failed';

export type FuryKernelMcpToolExecutionStatus =
  | 'not-executed'
  | 'executed'
  | 'unknown';

export interface FuryKernelMcpToolProposalInput {
  readonly sourceId: string;
  readonly toolName: string;
  readonly arguments?: unknown;
}

export interface FuryKernelMcpToolSnapshot {
  readonly format: typeof FURY_KERNEL_MCP_TOOL_BRIDGE_FORMAT;
  readonly proposalId: string;
  readonly sourceId: string;
  readonly transport: 'stdio' | 'streamable_http';
  readonly endpointFingerprint: string;
  readonly toolName: string;
  readonly inputSchemaSha256: string;
  readonly inputSha256: string;
  readonly riskClass: string;
  readonly policyOutcome: 'deny' | 'require_operator' | 'allow_governed_policy';
  readonly status: FuryKernelMcpToolProposalStatus;
  readonly approvalKind?: 'operator' | 'governed_policy';
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly executionStatus: FuryKernelMcpToolExecutionStatus;
  readonly succeeded?: boolean;
  readonly verified?: boolean;
  readonly resultSha256?: string;
  readonly verificationKind?: 'schema';
  readonly failureCode?: FuryKernelMcpToolBridgeFailureCode;
  readonly executionAuthority: false;
}

export type FuryKernelMcpToolBridgeFailureCode =
  | 'proposal-expired'
  | 'execution-outcome-unknown'
  | 'execution-evidence-failed'
  | 'execution-verification-failed'
  | 'execution-durability-failed'
  | 'execution-blocked';

export type FuryKernelMcpToolBridgeErrorCode =
  | 'invalid-config'
  | 'invalid-input'
  | 'unknown-source'
  | 'proposal-limit'
  | 'proposal-not-found'
  | 'proposal-expired'
  | 'approval-not-required'
  | 'proposal-not-approved'
  | 'proposal-terminal'
  | 'proposal-blocked'
  | 'approval-blocked';

export class FuryKernelMcpToolBridgeError extends Error {
  constructor(readonly code: FuryKernelMcpToolBridgeErrorCode) {
    super(code);
    this.name = 'FuryKernelMcpToolBridgeError';
  }
}

export interface FuryKernelMcpToolBridgeOptions {
  readonly sources: readonly McpDirectRuntimeConfig[];
  readonly policy: McpDirectPolicy;
  readonly now?: () => number;
  readonly maxProposals?: number;
  readonly proposalTtlMs?: number;
  readonly maxConcurrentProbes?: number;
  readonly maxConcurrentExecutions?: number;
  readonly maxResultBytes?: number;
}

export interface FuryKernelMcpToolBridge {
  propose(input: FuryKernelMcpToolProposalInput): Promise<FuryKernelMcpToolSnapshot>;
  approve(proposalId: string): FuryKernelMcpToolSnapshot;
  execute(proposalId: string): Promise<FuryKernelMcpToolSnapshot>;
  inspect(proposalId: string): FuryKernelMcpToolSnapshot;
  proposalCount(): number;
  activeProbeCount(): number;
  activeExecutionCount(): number;
}

interface SourceSnapshot {
  readonly config: McpDirectRuntimeConfig;
  readonly sourceId: string;
  readonly transport: 'stdio' | 'streamable_http';
  readonly endpointFingerprint: string;
}

interface ProposalState {
  readonly proposalId: string;
  readonly source: SourceSnapshot;
  lifecycle?: McpDirectLifecycleState;
  proposal?: McpDirectToolProposal;
  decision?: McpDirectPolicyDecision;
  readonly createdAt: number;
  expiresAt: number;
  status: FuryKernelMcpToolProposalStatus;
  approvalKind?: 'operator' | 'governed_policy';
  executionReceipt?: McpDirectExecutionReceipt;
  executionStatus: FuryKernelMcpToolExecutionStatus;
  succeeded?: boolean;
  verified?: boolean;
  resultSha256?: string;
  verificationKind?: 'schema';
  failureCode?: FuryKernelMcpToolBridgeFailureCode;
  sourceId: string;
  transport: 'stdio' | 'streamable_http';
  endpointFingerprint: string;
  toolName: string;
  inputSchemaSha256: string;
  inputSha256: string;
  riskClass: string;
  policyOutcome: McpDirectPolicyDecision['outcome'];
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROPOSAL_ID = /^fkmcp_[A-Za-z0-9_-]{24}$/u;
const DEFAULT_MAX_PROPOSALS = 32;
const HARD_MAX_PROPOSALS = 256;
const DEFAULT_PROPOSAL_TTL_MS = 30_000;
const HARD_PROPOSAL_TTL_MS = 60_000;
const DEFAULT_MAX_CONCURRENT_PROBES = 4;
const HARD_MAX_CONCURRENT_PROBES = 16;
const DEFAULT_MAX_CONCURRENT_EXECUTIONS = 4;
const HARD_MAX_CONCURRENT_EXECUTIONS = 16;
const DEFAULT_MAX_RESULT_BYTES = 1024 * 1024;
const HARD_MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_SOURCES = 32;

function fail(code: FuryKernelMcpToolBridgeErrorCode): never {
  throw new FuryKernelMcpToolBridgeError(code);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new FuryKernelMcpToolBridgeError('invalid-config');
  }
  return resolved;
}

function safeNow(source: () => number): number {
  let value: number;
  try {
    value = source();
  } catch {
    fail('invalid-config');
  }
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid-config');
  return value;
}

function plainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryKernelMcpToolBridgeError(
      label === 'configuration' ? 'invalid-config' : 'invalid-input',
    );
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryKernelMcpToolBridgeError(
        label === 'configuration' ? 'invalid-config' : 'invalid-input',
      );
    }
  }
  return record;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  code: FuryKernelMcpToolBridgeErrorCode,
): void {
  const set = new Set(allowed);
  if (Object.keys(record).some((key) => !set.has(key))) {
    throw new FuryKernelMcpToolBridgeError(code);
  }
}

function cloneStringArray(value: readonly string[] | undefined): readonly string[] | undefined {
  return value === undefined ? undefined : Object.freeze([...value]);
}

function cloneStringRecord(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  return value === undefined ? undefined : Object.freeze({ ...value });
}

function snapshotRuntimeConfig(config: McpDirectRuntimeConfig): McpDirectRuntimeConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('invalid-config');
  const source = Object.freeze({ ...config.source });

  if (config.source.transport === 'stdio') {
    if (!('command' in config)) fail('invalid-config');
    return Object.freeze({
      source,
      command: config.command,
      ...(config.args === undefined ? {} : { args: cloneStringArray(config.args)! }),
      ...(config.env === undefined ? {} : { env: cloneStringRecord(config.env)! }),
      ...(config.principalId === undefined ? {} : { principalId: config.principalId }),
      ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
      ...(config.maxBufferBytes === undefined ? {} : { maxBufferBytes: config.maxBufferBytes }),
    }) as McpDirectRuntimeConfig;
  }

  if (!('url' in config)) fail('invalid-config');
  return Object.freeze({
    source,
    url: config.url,
    ...(config.allowedHosts === undefined
      ? {}
      : { allowedHosts: cloneStringArray(config.allowedHosts)! }),
    ...(config.headers === undefined ? {} : { headers: cloneStringRecord(config.headers)! }),
    ...(config.principalId === undefined ? {} : { principalId: config.principalId }),
    ...(config.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: config.maxResponseBytes }),
  }) as McpDirectRuntimeConfig;
}

function snapshotSources(
  sources: readonly McpDirectRuntimeConfig[],
): ReadonlyMap<string, SourceSnapshot> {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_SOURCES) {
    fail('invalid-config');
  }
  const output = new Map<string, SourceSnapshot>();
  for (const candidate of sources) {
    const config = snapshotRuntimeConfig(candidate);
    const sourceId = config.source.sourceId;
    if (
      typeof sourceId !== 'string'
      || !SAFE_ID.test(sourceId)
      || output.has(sourceId)
      || !SHA256.test(config.source.endpointFingerprint)
      || (config.source.trust !== 'trusted' && config.source.trust !== 'untrusted')
      || (config.source.transport !== 'stdio'
        && config.source.transport !== 'streamable_http')
    ) {
      fail('invalid-config');
    }
    let derived: string;
    try {
      derived = deriveMcpDirectEndpointFingerprint(config);
    } catch {
      fail('invalid-config');
    }
    if (derived !== config.source.endpointFingerprint) fail('invalid-config');
    output.set(sourceId, Object.freeze({
      config,
      sourceId,
      transport: config.source.transport,
      endpointFingerprint: config.source.endpointFingerprint,
    }));
  }
  return output;
}

function snapshotPolicy(policy: McpDirectPolicy): McpDirectPolicy {
  const record = plainRecord(policy, 'configuration');
  assertExactKeys(
    record,
    ['format', 'policyId', 'governedPolicyAllowlist', 'operatorApprovalAllowlist'],
    'invalid-config',
  );
  const pairs = (
    value: unknown,
  ): readonly {
    readonly sourceId: string;
    readonly endpointFingerprint: string;
    readonly toolName: string;
  }[] => {
    if (!Array.isArray(value) || value.length > 256) fail('invalid-config');
    return Object.freeze(value.map((entry) => {
      const item = plainRecord(entry, 'configuration');
      assertExactKeys(
        item,
        ['sourceId', 'endpointFingerprint', 'toolName'],
        'invalid-config',
      );
      if (
        typeof item.sourceId !== 'string'
        || typeof item.endpointFingerprint !== 'string'
        || typeof item.toolName !== 'string'
      ) fail('invalid-config');
      return Object.freeze({
        sourceId: item.sourceId,
        endpointFingerprint: item.endpointFingerprint,
        toolName: item.toolName,
      });
    }));
  };
  if (
    policy.format !== 'furypipe-mcp-direct-policy/v1'
    || typeof policy.policyId !== 'string'
    || !SAFE_ID.test(policy.policyId)
  ) fail('invalid-config');
  const validatePairs = (
    entries: readonly {
      readonly sourceId: string;
      readonly endpointFingerprint: string;
      readonly toolName: string;
    }[],
  ) => {
    for (const entry of entries) {
      if (
        !SAFE_ID.test(entry.sourceId)
        || !SHA256.test(entry.endpointFingerprint)
        || !SAFE_ID.test(entry.toolName)
      ) fail('invalid-config');
    }
    return entries;
  };
  return Object.freeze({
    format: policy.format,
    policyId: policy.policyId,
    governedPolicyAllowlist: validatePairs(pairs(policy.governedPolicyAllowlist)),
    operatorApprovalAllowlist: validatePairs(pairs(policy.operatorApprovalAllowlist)),
  });
}

function proposalInput(value: FuryKernelMcpToolProposalInput): FuryKernelMcpToolProposalInput {
  const record = plainRecord(value, 'input');
  assertExactKeys(record, ['sourceId', 'toolName', 'arguments'], 'invalid-input');
  if (
    typeof value.sourceId !== 'string'
    || !SAFE_ID.test(value.sourceId)
    || typeof value.toolName !== 'string'
    || !SAFE_ID.test(value.toolName)
  ) fail('invalid-input');
  return value;
}

function proposalId(value: string): string {
  if (typeof value !== 'string' || !PROPOSAL_ID.test(value)) fail('proposal-not-found');
  return value;
}

function allocateProposalId(existing: ReadonlyMap<string, ProposalState>): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = `fkmcp_${randomBytes(18).toString('base64url')}`;
    if (!existing.has(id)) return id;
  }
  fail('invalid-config');
}

function snapshot(state: ProposalState): FuryKernelMcpToolSnapshot {
  return Object.freeze({
    format: FURY_KERNEL_MCP_TOOL_BRIDGE_FORMAT,
    proposalId: state.proposalId,
    sourceId: state.sourceId,
    transport: state.transport,
    endpointFingerprint: state.endpointFingerprint,
    toolName: state.toolName,
    inputSchemaSha256: state.inputSchemaSha256,
    inputSha256: state.inputSha256,
    riskClass: state.riskClass,
    policyOutcome: state.policyOutcome,
    status: state.status,
    ...(state.approvalKind === undefined ? {} : { approvalKind: state.approvalKind }),
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    executionStatus: state.executionStatus,
    ...(state.succeeded === undefined ? {} : { succeeded: state.succeeded }),
    ...(state.verified === undefined ? {} : { verified: state.verified }),
    ...(state.resultSha256 === undefined ? {} : { resultSha256: state.resultSha256 }),
    ...(state.verificationKind === undefined
      ? {}
      : { verificationKind: state.verificationKind }),
    ...(state.failureCode === undefined ? {} : { failureCode: state.failureCode }),
    executionAuthority: false as const,
  });
}

function clearAuthority(state: ProposalState): void {
  delete state.lifecycle;
  delete state.proposal;
  delete state.decision;
}

export function createFuryKernelMcpToolBridge(
  options: FuryKernelMcpToolBridgeOptions,
): FuryKernelMcpToolBridge {
  const config = plainRecord(options, 'configuration');
  assertExactKeys(
    config,
    [
      'sources',
      'policy',
      'now',
      'maxProposals',
      'proposalTtlMs',
      'maxConcurrentProbes',
      'maxConcurrentExecutions',
      'maxResultBytes',
    ],
    'invalid-config',
  );

  const sources = snapshotSources(options.sources);
  const policy = snapshotPolicy(options.policy);
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') fail('invalid-config');
  safeNow(now);

  const maxProposals = boundedInteger(
    options.maxProposals,
    DEFAULT_MAX_PROPOSALS,
    1,
    HARD_MAX_PROPOSALS,
    'maxProposals',
  );
  const proposalTtlMs = boundedInteger(
    options.proposalTtlMs,
    DEFAULT_PROPOSAL_TTL_MS,
    1,
    HARD_PROPOSAL_TTL_MS,
    'proposalTtlMs',
  );
  const maxConcurrentProbes = boundedInteger(
    options.maxConcurrentProbes,
    DEFAULT_MAX_CONCURRENT_PROBES,
    1,
    HARD_MAX_CONCURRENT_PROBES,
    'maxConcurrentProbes',
  );
  const maxConcurrentExecutions = boundedInteger(
    options.maxConcurrentExecutions,
    DEFAULT_MAX_CONCURRENT_EXECUTIONS,
    1,
    HARD_MAX_CONCURRENT_EXECUTIONS,
    'maxConcurrentExecutions',
  );
  const maxResultBytes = boundedInteger(
    options.maxResultBytes,
    DEFAULT_MAX_RESULT_BYTES,
    1024,
    HARD_MAX_RESULT_BYTES,
    'maxResultBytes',
  );

  const proposals = new Map<string, ProposalState>();
  let activeProbes = 0;
  let activeExecutions = 0;

  const gc = (): void => {
    const at = safeNow(now);
    for (const [id, state] of proposals) {
      if (state.status !== 'executing' && at >= state.expiresAt) {
        clearAuthority(state);
        proposals.delete(id);
      }
    }
  };

  const requireState = (id: string): ProposalState => {
    gc();
    const state = proposals.get(proposalId(id));
    if (!state) fail('proposal-not-found');
    const at = safeNow(now);
    if (at >= state.expiresAt) {
      clearAuthority(state);
      proposals.delete(id);
      fail('proposal-expired');
    }
    return state;
  };

  return Object.freeze({
    async propose(input: FuryKernelMcpToolProposalInput): Promise<FuryKernelMcpToolSnapshot> {
      gc();
      if (proposals.size >= maxProposals) fail('proposal-limit');
      if (activeProbes >= maxConcurrentProbes) fail('proposal-limit');

      const request = proposalInput(input);
      const source = sources.get(request.sourceId);
      if (!source) fail('unknown-source');

      activeProbes += 1;
      try {
        const inventory = await probeMcpDirectInventory(source.config, {
          clientInfo: {
            name: 'furypipe-webchat-mcp',
            version: '1.0.0',
          },
          connectTimeoutMs: 15_000,
          listTimeoutMs: 15_000,
          probeTimeoutMs: 3_000,
          listMaxPages: 16,
        });
        const selected = selectMcpDirectTool(inventory.lifecycle, request.toolName);
        const proposal = await createMcpDirectToolProposal(
          selected,
          inventory.catalog,
          request.arguments,
        );
        const at = safeNow(now);
        const decision = evaluateMcpDirectPolicy(
          selected,
          proposal,
          policy,
          { now: at, expiresInMs: proposalTtlMs },
        );
        const id = allocateProposalId(proposals);
        let lifecycle = selected;
        let status: FuryKernelMcpToolProposalStatus;
        let approvalKind: 'governed_policy' | undefined;

        if (decision.outcome === 'allow_governed_policy') {
          lifecycle = approveMcpDirectPolicyDecision(
            selected,
            proposal,
            decision,
            'governed_policy',
            at,
          );
          status = 'approved';
          approvalKind = 'governed_policy';
        } else if (decision.outcome === 'require_operator') {
          status = 'approval_required';
        } else {
          status = 'denied';
        }

        const expiresAt = Math.min(
          at + proposalTtlMs,
          decision.expiresAt,
          lifecycle.approval?.expiresAt ?? Number.MAX_SAFE_INTEGER,
        );
        const state: ProposalState = {
          proposalId: id,
          source,
          lifecycle,
          proposal,
          decision,
          createdAt: at,
          expiresAt,
          status,
          ...(approvalKind === undefined ? {} : { approvalKind }),
          executionStatus: 'not-executed',
          sourceId: proposal.sourceId,
          transport: source.transport,
          endpointFingerprint: proposal.endpointFingerprint,
          toolName: proposal.toolName,
          inputSchemaSha256: proposal.inputSchemaSha256,
          inputSha256: proposal.inputSha256,
          riskClass: proposal.riskClass,
          policyOutcome: decision.outcome,
        };
        if (status === 'denied') clearAuthority(state);
        proposals.set(id, state);
        return snapshot(state);
      } catch (error) {
        if (error instanceof FuryKernelMcpToolBridgeError) throw error;
        fail('proposal-blocked');
      } finally {
        activeProbes = Math.max(0, activeProbes - 1);
      }
    },

    approve(id: string): FuryKernelMcpToolSnapshot {
      const state = requireState(id);
      if (state.status !== 'approval_required') fail('approval-not-required');
      if (!state.lifecycle || !state.proposal || !state.decision) {
        fail('proposal-terminal');
      }

      const at = safeNow(now);
      const remaining = state.expiresAt - at;
      if (remaining <= 0) fail('proposal-expired');
      try {
        const intent = createMcpDirectOperatorApprovalIntent(
          state.proposal,
          state.decision,
          {
            now: at,
            expiresInMs: Math.min(remaining, 30_000),
          },
        );
        state.lifecycle = approveMcpDirectPolicyDecision(
          state.lifecycle,
          state.proposal,
          state.decision,
          intent,
          at,
        );
      } catch {
        fail('approval-blocked');
      }
      state.status = 'approved';
      state.approvalKind = 'operator';
      state.expiresAt = Math.min(
        state.expiresAt,
        state.lifecycle.approval?.expiresAt ?? state.expiresAt,
      );
      return snapshot(state);
    },

    async execute(id: string): Promise<FuryKernelMcpToolSnapshot> {
      const state = requireState(id);
      if (state.status === 'executing' || state.status === 'executed' || state.status === 'failed') {
        fail('proposal-terminal');
      }
      if (state.status !== 'approved') fail('proposal-not-approved');
      if (!state.lifecycle || !state.proposal) fail('proposal-terminal');
      if (activeExecutions >= maxConcurrentExecutions) fail('proposal-limit');

      const lifecycle = state.lifecycle;
      const proposal = state.proposal;
      state.status = 'executing';
      activeExecutions += 1;

      try {
        const execution = await executeMcpDirectApprovedTool(
          state.source.config,
          lifecycle,
          proposal,
          {
            clientInfo: {
              name: 'furypipe-webchat-mcp',
              version: '1.0.0',
            },
            connectTimeoutMs: 15_000,
            listTimeoutMs: 15_000,
            probeTimeoutMs: 3_000,
            listMaxPages: 16,
            callTimeoutMs: 30_000,
            permitTtlMs: 30_000,
            maxResultBytes,
          },
        );

        state.executionReceipt = execution.receipt;
        state.status = 'executed';
        state.executionStatus = 'executed';
        state.succeeded = execution.receipt.succeeded;
        state.verified = execution.receipt.verified;
        state.resultSha256 = execution.receipt.resultSha256;
        state.verificationKind = execution.receipt.verificationKind;
        clearAuthority(state);
        // Deliberately discard execution.result. Raw tool output remains
        // process-local to this call and is not browser-facing evidence.
        return snapshot(state);
      } catch (error) {
        state.status = 'failed';
        if (error instanceof McpDirectExecutionOutcomeUnknownError) {
          state.executionStatus = 'unknown';
          state.failureCode = 'execution-outcome-unknown';
        } else if (error instanceof McpDirectExecutionEvidenceError) {
          state.executionStatus = 'executed';
          state.succeeded = error.succeeded;
          state.verified = false;
          state.failureCode = 'execution-evidence-failed';
        } else if (error instanceof McpDirectExecutionVerificationError) {
          state.executionStatus = 'executed';
          state.succeeded = true;
          state.verified = false;
          state.resultSha256 = error.resultSha256;
          state.failureCode = 'execution-verification-failed';
        } else if (error instanceof McpDirectExecutionDurabilityError) {
          state.executionStatus = 'executed';
          state.succeeded = error.succeeded;
          state.verified = error.verified;
          state.resultSha256 = error.resultSha256;
          state.failureCode = 'execution-durability-failed';
        } else {
          state.executionStatus = 'not-executed';
          state.failureCode = 'execution-blocked';
        }
        clearAuthority(state);
        return snapshot(state);
      } finally {
        activeExecutions = Math.max(0, activeExecutions - 1);
      }
    },

    inspect(id: string): FuryKernelMcpToolSnapshot {
      return snapshot(requireState(id));
    },

    proposalCount(): number {
      gc();
      return proposals.size;
    },

    activeProbeCount(): number {
      return activeProbes;
    },

    activeExecutionCount(): number {
      return activeExecutions;
    },
  });
}
