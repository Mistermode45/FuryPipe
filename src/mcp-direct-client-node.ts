import {
  deriveMcpDirectEndpointFingerprint as deriveEndpointFingerprintInternal,
  probeMcpDirectInventory as probeInventoryInternal,
  type McpDirectClientInfo,
  type McpDirectHttpRuntimeConfig,
  type McpDirectInventoryProbeEvidence,
  type McpDirectInventoryProbeOptions as McpDirectInventoryProbeOptionsInternal,
  type McpDirectRuntimeConfig,
  type McpDirectSseRuntimeConfig,
  type McpDirectStdioRuntimeConfig,
} from './mcp-direct-client-node-internal.js';

export type {
  McpDirectClientInfo,
  McpDirectHttpRuntimeConfig,
  McpDirectInventoryProbeEvidence,
  McpDirectRuntimeConfig,
  McpDirectSseRuntimeConfig,
  McpDirectStdioRuntimeConfig,
};

export type McpDirectInventoryProbeOptions = Omit<
  McpDirectInventoryProbeOptionsInternal,
  'factory'
>;

const OPTION_KEYS = new Set([
  'clientInfo',
  'connectTimeoutMs',
  'listTimeoutMs',
  'probeTimeoutMs',
  'listMaxPages',
]);

function sanitizedProbeOptions(
  value: McpDirectInventoryProbeOptions,
): McpDirectInventoryProbeOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP inventory probe options must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('MCP inventory probe options must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error('MCP inventory probe options must not contain symbol keys');
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
      throw new Error('MCP inventory probe options contain unsupported or unsafe fields');
    }
  }

  return Object.freeze({
    clientInfo: value.clientInfo,
    ...(value.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: value.connectTimeoutMs }),
    ...(value.listTimeoutMs === undefined ? {} : { listTimeoutMs: value.listTimeoutMs }),
    ...(value.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: value.probeTimeoutMs }),
    ...(value.listMaxPages === undefined ? {} : { listMaxPages: value.listMaxPages }),
  });
}

export function deriveMcpDirectEndpointFingerprint(
  config: McpDirectRuntimeConfig,
): string {
  return deriveEndpointFingerprintInternal(config);
}

export async function probeMcpDirectInventory(
  config: McpDirectRuntimeConfig,
  options: McpDirectInventoryProbeOptions,
): Promise<McpDirectInventoryProbeEvidence> {
  return probeInventoryInternal(config, sanitizedProbeOptions(options));
}
