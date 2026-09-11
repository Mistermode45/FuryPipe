import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type JsonSchemaType,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import {
  executeMcpTool,
  furypipeMcpVersion,
  TOOLS,
} from './mcp.js';
import type { RecoveryStore } from './core/recovery-store.js';

function toolArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

/** Build the same recovery surface for MCP 2026 and the SDK legacy fallback. */
export function createModernMcpServer(store: RecoveryStore): McpServer {
  const server = new McpServer(
    { name: 'furypipe-recovery', version: furypipeMcpVersion() },
    { capabilities: { tools: {} } },
  );

  for (const definition of TOOLS) {
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: fromJsonSchema(definition.inputSchema as JsonSchemaType),
      },
      async (rawArgs) => executeMcpTool(store, definition.name, toolArgs(rawArgs)),
    );
  }
  return server;
}

/** Fetch-native handler for modern MCP HTTP exchanges and stateless legacy fallback. */
export function createModernMcpHandler(store: RecoveryStore): McpHttpHandler {
  return createMcpHandler(() => createModernMcpServer(store), { legacy: 'stateless' });
}

/** Official SDK stdio transport; the SDK selects modern or legacy per connection. */
export function runModernMcpStdio(store: RecoveryStore): StdioServerHandle {
  return serveStdio(() => createModernMcpServer(store), { legacy: 'serve' });
}
