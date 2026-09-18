import {
  executeMcpDirectApprovedToolInternal,
  McpDirectExecutionEvidenceError,
  McpDirectExecutionDurabilityError,
  McpDirectExecutionOutcomeUnknownError,
  McpDirectExecutionVerificationError,
  type McpDirectExecutionReceipt,
  type McpDirectGovernedExecutionInternalOptions,
} from './mcp-direct-executor-node-internal.js';
import type { McpDirectRuntimeConfig } from './mcp-direct-client-node.js';
import {
  isGeneratedMcpDirectDurableReplayCoordinator,
  type McpDirectDurableReplayCoordinator,
} from './mcp-direct-durable-replay-internal.js';
import type { McpDirectLifecycleState } from './mcp-direct-governance.js';
import type { McpDirectToolProposal } from './mcp-direct-policy.js';
import {
  createMcpDirectReplayIntentInternal,
  McpDirectReplayGovernanceError,
  type McpDirectReplayIntent,
  type McpDirectReplayReason,
} from './mcp-direct-replay-internal.js';

export {
  McpDirectExecutionEvidenceError,
  McpDirectExecutionDurabilityError,
  McpDirectExecutionOutcomeUnknownError,
  McpDirectExecutionVerificationError,
  McpDirectReplayGovernanceError,
};
export type {
  McpDirectExecutionReceipt,
  McpDirectReplayIntent,
  McpDirectReplayReason,
};

export interface McpDirectGovernedExecutionResult {
  readonly receipt: McpDirectExecutionReceipt;
  /** Raw tool result. Process-local only; do not persist it as FuryPipe evidence. */
  readonly result: unknown;
}

export type McpDirectGovernedExecutionOptions = Omit<
  McpDirectGovernedExecutionInternalOptions,
  'factory' | 'now' | 'replayIntent'
>;

const OPTION_KEYS = new Set([
  'clientInfo',
  'connectTimeoutMs',
  'listTimeoutMs',
  'probeTimeoutMs',
  'listMaxPages',
  'callTimeoutMs',
  'permitTtlMs',
  'maxResultBytes',
  'durableReplay',
]);

function sanitizedOptions(
  value: McpDirectGovernedExecutionOptions,
): McpDirectGovernedExecutionOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP governed execution options must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('MCP governed execution options must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error('MCP governed execution options must not contain symbol keys');
  }

  const record = value as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !OPTION_KEYS.has(key)
    ) {
      throw new Error('MCP governed execution options contain unsupported or unsafe fields');
    }
  }

  if (
    value.durableReplay !== undefined
    && !isGeneratedMcpDirectDurableReplayCoordinator(value.durableReplay)
  ) {
    throw new Error('MCP durable replay coordinator must be process-local FuryPipe evidence');
  }

  return Object.freeze({
    clientInfo: value.clientInfo,
    ...(value.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: value.connectTimeoutMs }),
    ...(value.listTimeoutMs === undefined ? {} : { listTimeoutMs: value.listTimeoutMs }),
    ...(value.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: value.probeTimeoutMs }),
    ...(value.listMaxPages === undefined ? {} : { listMaxPages: value.listMaxPages }),
    ...(value.callTimeoutMs === undefined ? {} : { callTimeoutMs: value.callTimeoutMs }),
    ...(value.permitTtlMs === undefined ? {} : { permitTtlMs: value.permitTtlMs }),
    ...(value.maxResultBytes === undefined ? {} : { maxResultBytes: value.maxResultBytes }),
    ...(value.durableReplay === undefined ? {} : { durableReplay: value.durableReplay }),
  });
}

export async function executeMcpDirectApprovedTool(
  config: McpDirectRuntimeConfig,
  approvedLifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  options: McpDirectGovernedExecutionOptions,
): Promise<McpDirectGovernedExecutionResult> {
  const execution = await executeMcpDirectApprovedToolInternal(
    config,
    approvedLifecycle,
    proposal,
    sanitizedOptions(options),
  );
  return Object.freeze({
    receipt: execution.receipt,
    result: execution.result,
  });
}


export interface McpDirectReplayIntentPublicOptions {
  readonly expiresInMs?: number;
}

function sanitizedReplayIntentOptions(
  value: McpDirectReplayIntentPublicOptions | undefined,
): McpDirectReplayIntentPublicOptions {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP replay intent options must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('MCP replay intent options must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error('MCP replay intent options must not contain symbol keys');
  }
  const record = value as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || key !== 'expiresInMs'
    ) {
      throw new Error('MCP replay intent options contain unsupported or unsafe fields');
    }
  }
  return Object.freeze({
    ...(value.expiresInMs === undefined ? {} : { expiresInMs: value.expiresInMs }),
  });
}

export function createMcpDirectReplayIntent(
  priorReceipt: McpDirectExecutionReceipt,
  approvedLifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  reason: McpDirectReplayReason,
  options?: McpDirectReplayIntentPublicOptions,
): McpDirectReplayIntent {
  const safeOptions = sanitizedReplayIntentOptions(options);
  return createMcpDirectReplayIntentInternal(
    priorReceipt,
    approvedLifecycle,
    proposal,
    reason,
    {
      ...(safeOptions.expiresInMs === undefined
        ? {}
        : { expiresInMs: safeOptions.expiresInMs }),
    },
  );
}

export async function executeMcpDirectReplay(
  config: McpDirectRuntimeConfig,
  approvedLifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  replayIntent: McpDirectReplayIntent,
  options: McpDirectGovernedExecutionOptions,
): Promise<McpDirectGovernedExecutionResult> {
  const execution = await executeMcpDirectApprovedToolInternal(
    config,
    approvedLifecycle,
    proposal,
    {
      ...sanitizedOptions(options),
      replayIntent,
    },
  );
  return Object.freeze({
    receipt: execution.receipt,
    result: execution.result,
  });
}