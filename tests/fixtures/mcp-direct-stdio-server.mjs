import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const handle = serveStdio(() => {
  const server = new McpServer({
    name: 'furypipe-direct-mcp-stdio-fixture',
    version: '1.0.0',
  });

  server.registerTool(
    'inventory-proof',
    {
      description: 'Read-only inventory proof fixture. The handler must not be called by M1.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [{ type: 'text', text: 'unexpected execution' }],
    }),
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
