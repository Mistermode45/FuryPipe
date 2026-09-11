import { createInterface } from 'node:readline';
import { createRecoveryStore, type RecoveryMetadata, type RecoveryStore } from './core/recovery-store.js';

const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_QUERY_CHARS = 256;
const PROTOCOL_VERSION = '2025-11-25';
declare const __FURYPIPE_VERSION__: string | undefined;

interface JsonRpcRequest {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export interface McpService {
  handle(message: unknown): Promise<JsonRpcResponse | null>;
}

const TOOLS = [
  {
    name: 'index_text',
    description: 'Store text in the local byte-exact recovery store and return a verifiable handle.',
    inputSchema: {
      type: 'object', required: ['text'], additionalProperties: false,
      properties: { text: { type: 'string', maxLength: MAX_TEXT_BYTES }, metadata: { type: 'object' } },
    },
  },
  {
    name: 'fetch_exact',
    description: 'Fetch exact bytes from a recovery handle.',
    inputSchema: { type: 'object', required: ['handle'], additionalProperties: false, properties: { handle: { type: 'string' } } },
  },
  {
    name: 'fetch_lines',
    description: 'Fetch a bounded inclusive 1-based line range from a recovery handle.',
    inputSchema: {
      type: 'object', required: ['handle', 'from_line'], additionalProperties: false,
      properties: { handle: { type: 'string' }, from_line: { type: 'integer', minimum: 1 }, to_line: { type: 'integer', minimum: 1 } },
    },
  },
  {
    name: 'verify_handle',
    description: 'Verify the SHA-256 content integrity of a recovery handle.',
    inputSchema: { type: 'object', required: ['handle'], additionalProperties: false, properties: { handle: { type: 'string' } } },
  },
] as const;

function response(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function error(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function requestId(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function objectParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('params must be an object');
  return value as Record<string, unknown>;
}

function handleParam(params: Record<string, unknown>): string {
  if (typeof params.handle !== 'string' || params.handle.length > 160) throw new Error('handle must be a bounded string');
  return params.handle;
}

function metadataParam(value: unknown): RecoveryMetadata | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('metadata must be an object');
  const source = value as Record<string, unknown>;
  const entries = Object.entries(source);
  if (entries.length > 16) throw new Error('metadata has too many fields');
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new Error('metadata key is invalid');
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean' && item !== null) {
      throw new Error('metadata values must be scalar');
    }
    if (typeof item === 'string' && item.length > 512) throw new Error('metadata value is too long');
    safe[key] = item;
  }
  return safe;
}

function textResult(value: unknown): { content: [{ type: 'text'; text: string }] } {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { content: [{ type: 'text', text }] };
}

/** Pure request dispatcher used by the stdio entrypoint and contract tests. */
export function createMcpService(store: RecoveryStore): McpService {
  return {
    async handle(message) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return error(null, -32600, 'invalid request');
      const request = message as JsonRpcRequest;
      const id = requestId(request.id);
      if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') return error(id, -32600, 'invalid request');
      if (request.method.startsWith('notifications/')) return null;
      try {
        if (request.method === 'initialize') {
          return response(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: {
              name: 'furypipe-recovery',
              version: typeof __FURYPIPE_VERSION__ === 'string' ? __FURYPIPE_VERSION__ : 'dev',
            },
          });
        }
        if (request.method === 'ping') return response(id, {});
        if (request.method === 'tools/list') return response(id, { tools: TOOLS });
        if (request.method !== 'tools/call') return error(id, -32601, 'method not found');
        const params = objectParams(request.params);
        if (typeof params.name !== 'string') throw new Error('tool name is required');
        const args = objectParams(params.arguments ?? {});
        if (params.name === 'index_text') {
          if (typeof args.text !== 'string' || new TextEncoder().encode(args.text).byteLength > MAX_TEXT_BYTES) throw new Error('text exceeds the 1 MiB limit');
          const handle = await store.put(new TextEncoder().encode(args.text), metadataParam(args.metadata));
          return response(id, textResult({ handle }));
        }
        if (params.name === 'fetch_exact') {
          const bytes = await store.get(handleParam(args));
          if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error('stored object exceeds MCP output limit');
          return response(id, textResult(new TextDecoder().decode(bytes)));
        }
        if (params.name === 'fetch_lines') {
          const from = args.from_line;
          const to = args.to_line;
          if (typeof from !== 'number' || !Number.isSafeInteger(from) || from < 1 || (to !== undefined && (typeof to !== 'number' || !Number.isSafeInteger(to) || to < from || to - from > 10_000))) throw new Error('line range is invalid or too large');
          const value = await store.fetchLines(handleParam(args), from, to);
          if (value.length > MAX_QUERY_CHARS * 4096) throw new Error('line output exceeds MCP limit');
          return response(id, textResult(value));
        }
        if (params.name === 'verify_handle') {
          return response(id, textResult(await store.verify(handleParam(args))));
        }
        throw new Error('unknown tool');
      } catch (caught) {
        const messageText = caught instanceof Error ? caught.message : 'tool failed';
        return error(id, -32602, messageText.slice(0, MAX_QUERY_CHARS));
      }
    },
  };
}

/** Run the local MCP transport. Only JSON-RPC messages are written to stdout. */
export async function runMcpStdio(store: RecoveryStore): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const service = createMcpService(store);
  for await (const line of input) {
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) {
      process.stdout.write(JSON.stringify(error(null, -32600, 'message exceeds limit')) + '\n');
      continue;
    }
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify(error(null, -32700, 'invalid JSON')) + '\n');
      continue;
    }
    const result = await service.handle(message);
    if (result) process.stdout.write(JSON.stringify(result) + '\n');
  }
}

if (process.argv[1]?.endsWith('mcp.js')) {
  const root = process.env.FURYPIPE_RECOVERY_ROOT?.trim() || `${process.cwd()}/.furypipe/recovery`;
  const store = createRecoveryStore(root, { namespace: process.env.FURYPIPE_TENANT?.trim() || 'default' });
  runMcpStdio(store).catch((caught) => {
    process.stderr.write(`[furypipe-mcp] fatal: ${caught instanceof Error ? caught.message : 'startup failed'}\n`);
    process.exitCode = 1;
  });
}
