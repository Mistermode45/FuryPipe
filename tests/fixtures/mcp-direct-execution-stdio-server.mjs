import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const inputSchema = fromJsonSchema({
  type: 'object',
  properties: {
    message: { type: 'string', minLength: 1 },
  },
  required: ['message'],
  additionalProperties: false,
});

const outputSchema = fromJsonSchema({
  type: 'object',
  properties: {
    echo: { type: 'string' },
    calls: { type: 'integer', minimum: 1 },
  },
  required: ['echo', 'calls'],
  additionalProperties: false,
});

let calls = 0;

const handle = serveStdio(() => {
  const server = new McpServer({
    name: 'furypipe-direct-mcp-execution-fixture',
    version: '1.0.0',
  });

  server.registerTool(
    'governed-echo',
    {
      description: 'Read-only governed execution proof fixture.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ message }) => {
      calls += 1;
      const output = { echo: message, calls };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  return server;
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try {
    await handle.close();
  } finally {
    process.exit(0);
  }
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
