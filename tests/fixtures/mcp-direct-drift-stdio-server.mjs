import { readFileSync, writeFileSync } from 'node:fs';

import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const statePath = process.argv[2];
if (!statePath) throw new Error('drift fixture requires a state path');

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    return {
      mode: parsed.mode === 'drift' ? 'drift' : 'stable',
      calls: Number.isSafeInteger(parsed.calls) ? parsed.calls : 0,
    };
  } catch {
    return { mode: 'stable', calls: 0 };
  }
}

function writeState(state) {
  writeFileSync(statePath, JSON.stringify(state), 'utf8');
}

const startup = readState();
const drifted = startup.mode === 'drift';

const inputSchema = fromJsonSchema(drifted
  ? {
      type: 'object',
      properties: {
        message: { type: 'integer' },
      },
      required: ['message'],
      additionalProperties: false,
    }
  : {
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

const handle = serveStdio(() => {
  const server = new McpServer({
    name: 'furypipe-direct-mcp-drift-fixture',
    version: '1.0.0',
  });

  server.registerTool(
    'governed-echo',
    {
      description: 'Schema-drift proof fixture.',
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
      const current = readState();
      current.calls += 1;
      writeState(current);
      const output = { echo: String(message) };
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
