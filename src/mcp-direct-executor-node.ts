import {
  executeMcpDirectApprovedToolInternal,
  McpDirectExecutionOutcomeUnknownError,
  McpDirectExecutionVerificationError,
  type McpDirectExecutionReceipt,
  type McpDirectGovernedExecutionInternalOptions,
  type McpDirectGovernedExecutionResult,
} from './mcp-direct-executor-node-internal.js';
import type { McpDirectRuntimeConfig } from './mcp-direct-client-node.js';
import type { McpDirectLifecycleState } from './mcp-direct-governance.js';
import type { McpDirectToolProposal } from './mcp-direct-policy.js';

export {
  McpDirectExecutionOutcomeUnknownError,
  McpDirectExecutionVerificationError,
};
export type {
  McpDirectExecutionReceipt,
  McpDirectGovernedExecutionResult,
};

export type McpDirectGovernedExecutionOptions = Omit<
  McpDirectGovernedExecutionInternalOptions,
  'factory' | 'now'
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

  return Object.freeze({
    clientInfo: value.clientInfo,
    ...(value.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: value.connectTimeoutMs }),
    ...(value.listTimeoutMs === undefined ? {} : { listTimeoutMs: value.listTimeoutMs }),
    ...(value.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: value.probeTimeoutMs }),
    ...(value.listMaxPages === undefined ? {} : { listMaxPages: value.listMaxPages }),
    ...(value.callTimeoutMs === undefined ? {} : { callTimeoutMs: value.callTimeoutMs }),
    ...(value.permitTtlMs === undefined ? {} : { permitTtlMs: value.permitTtlMs }),
    ...(value.maxResultBytes === undefined ? {} : { maxResultBytes: value.maxResultBytes }),
  });
}

export async function executeMcpDirectApprovedTool(
  config: McpDirectRuntimeConfig,
  approvedLifecycle: McpDirectLifecycleState,
  proposal: McpDirectToolProposal,
  options: McpDirectGovernedExecutionOptions,
): Promise<McpDirectGovernedExecutionResult> {
  return executeMcpDirectApprovedToolInternal(
    config,
    approvedLifecycle,
    proposal,
    sanitizedOptions(options),
  );
}
