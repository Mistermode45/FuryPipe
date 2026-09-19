import { readFileSync, writeFileSync } from 'node:fs';

import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const counterPath = process.argv[2];
if (!counterPath) throw new Error('outcome fixture requires a counter path');

function incrementCalls() {
  let calls = 0;
  try {
    calls = Number.parseInt(readFileSync(counterPath, 'utf8').trim(), 10);
  } catch {
    calls = 0;
  }
  if (!Number.isSafeInteger(calls) || calls < 0) calls = 0;
  calls += 1;
  writeFileSync(counterPath, String(calls), 'utf8');
}

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
  },
  required: ['echo'],
  additionalProperties: false,
});

serveStdio(() => {
  const server = new McpServer({
    name: 'furypipe-direct-mcp-outcome-unknown-fixture',
    version: '1.0.0',
  });

  server.registerTool(
    'governed-echo',
    {
      description: 'Transport-loss-after-call proof fixture.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      incrementCalls();
      process.exit(17);
    },
  );

  return server;
});
