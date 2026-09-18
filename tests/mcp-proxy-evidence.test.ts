import { describe, expect, it } from 'vitest';
import { inspectAnthropicMcpEvidence } from '../src/mcp-proxy-evidence.js';

describe('proxy MCP evidence', () => {
  it('defaults exposed MCP tools to untrusted and never grants authority', async () => {
    const result = await inspectAnthropicMcpEvidence(JSON.stringify({
      tools: [{
        name: 'mcp__Docs__search',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        input_schema: { type: 'object' },
      }],
      messages: [{ role: 'user', content: 'Find docs.' }],
    }));

    expect(result.executedByFuryPipe).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.tools).toEqual([
      expect.objectContaining({
        toolName: 'mcp__Docs__search',
        serverId: 'Docs',
        toolId: 'search',
        assessment: expect.objectContaining({
          trust: 'untrusted',
          riskClass: 'untrusted_unknown',
          closedWorldReadCandidate: false,
          authorizationGranted: false,
          requiresPolicyGate: true,
        }),
      }),
    ]);
  });

  it('classifies trusted closed-world reads without authorizing them', async () => {
    const result = await inspectAnthropicMcpEvidence(JSON.stringify({
      tools: [{
        name: 'mcp__Docs__search',
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
        },
        input_schema: { type: 'object' },
      }],
      messages: [{ role: 'user', content: 'Find docs.' }],
    }), (tool) => tool.serverId === 'Docs' ? 'trusted' : 'untrusted');

    expect(result.tools[0]?.assessment).toMatchObject({
      trust: 'trusted',
      riskClass: 'trusted_read_only_closed_world',
      closedWorldReadCandidate: true,
      authorizationGranted: false,
      requiresPolicyGate: true,
    });
    expect(result.authorizationGranted).toBe(false);
  });

  it('carries observed external results without converting them into FuryPipe execution', async () => {
    const result = await inspectAnthropicMcpEvidence(JSON.stringify({
      tools: [{
        name: 'mcp__GitHub__fetch',
        annotations: { readOnlyHint: true, openWorldHint: true },
        input_schema: { type: 'object' },
      }],
      messages: [
        {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_live',
            name: 'mcp__GitHub__fetch',
            input: { url: 'https://api.github.com/repos/example/repo' },
          }],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'toolu_live',
            content: 'SECRET_RESULT',
          }],
        },
      ],
    }));

    expect(result.observation.observedResults).toHaveLength(1);
    expect(result.observation.observedResults[0]?.executedByFuryPipe).toBe(false);
    expect(result.executedByFuryPipe).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET_RESULT');
    expect(JSON.stringify(result)).not.toContain('api.github.com');
  });
});
