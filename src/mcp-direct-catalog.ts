import {
  canonicalizeMcpDirectJson,
  digestMcpDirectJson,
} from './mcp-direct-json.js';
import {
  isGeneratedMcpDirectLifecycleState,
  type McpDirectLifecycleState,
  type McpDirectSourceConfig,
} from './mcp-direct-governance.js';

export interface McpDirectCatalogInputTool {
  readonly name: string;
  readonly inputSchema: unknown;
  readonly inputSchemaSha256: string;
}

export interface McpDirectCatalogHandle {
  readonly format: 'furypipe-mcp-direct-catalog/v1';
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly inventorySha256: string;
  readonly toolCount: number;
}

interface CatalogToolState {
  readonly inputSchemaCanonical: string;
  readonly inputSchemaSha256: string;
}

interface CatalogState {
  readonly sourceId: string;
  readonly endpointFingerprint: string;
  readonly inventorySha256: string;
  readonly tools: ReadonlyMap<string, CatalogToolState>;
}

const CATALOG_STATE = new WeakMap<object, CatalogState>();
const SHA256 = /^[a-f0-9]{64}$/u;
const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function isGeneratedMcpDirectCatalogHandle(
  value: unknown,
): value is McpDirectCatalogHandle {
  return typeof value === 'object' && value !== null && CATALOG_STATE.has(value);
}

export function createMcpDirectCatalogHandle(
  source: McpDirectSourceConfig,
  tools: readonly McpDirectCatalogInputTool[],
): McpDirectCatalogHandle {
  if (!Array.isArray(tools) || tools.length > 256) {
    throw new Error('MCP catalog exceeds the 256 tool bound');
  }

  const entries = new Map<string, CatalogToolState>();
  const digestRows: Array<{ readonly name: string; readonly inputSchemaSha256: string }> = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object' || !TOOL_NAME.test(tool.name)) {
      throw new Error('MCP catalog tool name is invalid');
    }
    if (entries.has(tool.name)) throw new Error('MCP catalog contains duplicate tool names');
    if (!SHA256.test(tool.inputSchemaSha256)) {
      throw new Error('MCP catalog schema digest must be a lowercase SHA-256 digest');
    }

    const canonical = canonicalizeMcpDirectJson(tool.inputSchema, {
      maxBytes: 1024 * 1024,
      maxDepth: 64,
      label: 'MCP tool input schema',
    });
    const derived = digestMcpDirectJson(JSON.parse(canonical), {
      maxBytes: 1024 * 1024,
      maxDepth: 64,
      label: 'MCP tool input schema',
    });
    if (derived !== tool.inputSchemaSha256) {
      throw new Error('MCP catalog schema digest does not match the listed schema');
    }
    entries.set(tool.name, Object.freeze({
      inputSchemaCanonical: canonical,
      inputSchemaSha256: derived,
    }));
    digestRows.push(Object.freeze({ name: tool.name, inputSchemaSha256: derived }));
  }

  digestRows.sort((left, right) => left.name.localeCompare(right.name));
  const inventorySha256 = digestMcpDirectJson(digestRows, {
    maxBytes: 1024 * 1024,
    maxDepth: 16,
    label: 'MCP catalog inventory',
  });
  const handle: McpDirectCatalogHandle = Object.freeze({
    format: 'furypipe-mcp-direct-catalog/v1',
    sourceId: source.sourceId,
    endpointFingerprint: source.endpointFingerprint,
    inventorySha256,
    toolCount: entries.size,
  });
  CATALOG_STATE.set(handle, Object.freeze({
    sourceId: source.sourceId,
    endpointFingerprint: source.endpointFingerprint,
    inventorySha256,
    tools: entries,
  }));
  return handle;
}

export function resolveMcpDirectSelectedToolSchema(
  handle: McpDirectCatalogHandle,
  lifecycle: McpDirectLifecycleState,
): unknown {
  if (!isGeneratedMcpDirectCatalogHandle(handle)) {
    throw new Error('MCP catalog handle must be process-local FuryPipe evidence');
  }
  if (!isGeneratedMcpDirectLifecycleState(lifecycle)) {
    throw new Error('MCP lifecycle state must be process-local FuryPipe evidence');
  }
  if (!lifecycle.listed || !lifecycle.selected || !lifecycle.selectedTool || !lifecycle.inventory) {
    throw new Error('MCP tool must be listed and selected before resolving its schema');
  }

  const internal = CATALOG_STATE.get(handle)!;
  if (
    handle.format !== 'furypipe-mcp-direct-catalog/v1'
    || handle.sourceId !== internal.sourceId
    || handle.endpointFingerprint !== internal.endpointFingerprint
    || handle.inventorySha256 !== internal.inventorySha256
    || handle.toolCount !== internal.tools.size
    || lifecycle.source.sourceId !== internal.sourceId
    || lifecycle.source.endpointFingerprint !== internal.endpointFingerprint
  ) {
    throw new Error('MCP catalog is not bound to the selected lifecycle source');
  }

  const listed = lifecycle.inventory.find((tool) => tool.name === lifecycle.selectedTool);
  const stored = internal.tools.get(lifecycle.selectedTool);
  if (!listed || !stored || listed.inputSchemaSha256 !== stored.inputSchemaSha256) {
    throw new Error('MCP selected tool schema does not match the process-local catalog');
  }

  return JSON.parse(stored.inputSchemaCanonical) as unknown;
}
