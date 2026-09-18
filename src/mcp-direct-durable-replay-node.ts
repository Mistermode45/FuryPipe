import type { RecoveryStore } from './core/recovery-store.js';
import {
  createMcpDirectDurableReplayCoordinatorInternal,
  inspectMcpDirectDurableReplayStatusInternal,
  reclaimMcpDirectDurableExpiredPreCallInternal,
  McpDirectDurableReplayError,
  type McpDirectDurableReplayCoordinator,
  type McpDirectDurableReplayStatus,
} from './mcp-direct-durable-replay-internal.js';

export {
  McpDirectDurableReplayError,
};
export type {
  McpDirectDurableReplayCoordinator,
  McpDirectDurableReplayStatus,
};

export interface McpDirectDurableReplayOptions {
  readonly store: RecoveryStore;
  readonly tenantId: string;
  readonly principalId: string;
}

function plainOptions(value: McpDirectDurableReplayOptions): McpDirectDurableReplayOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP durable replay options must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('MCP durable replay options must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error('MCP durable replay options must not contain symbol keys');
  }
  const record = value as unknown as Record<string, unknown>;
  const allowed = new Set(['store', 'tenantId', 'principalId']);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !allowed.has(key)) {
      throw new Error('MCP durable replay options contain unsupported or unsafe fields');
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'store')
    || !Object.prototype.hasOwnProperty.call(record, 'tenantId')
    || !Object.prototype.hasOwnProperty.call(record, 'principalId')) {
    throw new Error('MCP durable replay options are incomplete');
  }
  return Object.freeze({
    store: value.store,
    tenantId: value.tenantId,
    principalId: value.principalId,
  });
}

export function createMcpDirectDurableReplayCoordinator(
  options: McpDirectDurableReplayOptions,
): McpDirectDurableReplayCoordinator {
  return createMcpDirectDurableReplayCoordinatorInternal(plainOptions(options));
}

export async function inspectMcpDirectDurableReplayStatus(
  coordinator: McpDirectDurableReplayCoordinator,
  replayKeySha256: string,
): Promise<McpDirectDurableReplayStatus> {
  return inspectMcpDirectDurableReplayStatusInternal(
    coordinator,
    replayKeySha256,
  );
}

export async function reclaimMcpDirectDurableExpiredPreCall(
  coordinator: McpDirectDurableReplayCoordinator,
  replayKeySha256: string,
): Promise<McpDirectDurableReplayStatus> {
  return reclaimMcpDirectDurableExpiredPreCallInternal(
    coordinator,
    replayKeySha256,
  );
}
