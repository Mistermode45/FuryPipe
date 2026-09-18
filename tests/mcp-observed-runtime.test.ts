import { describe, expect, it } from 'vitest';
import { observeAnthropicMcpRuntime } from '../src/mcp-observed-runtime.js';

describe('Anthropic MCP observed runtime', () => {
  it('separates connected, selected and observed-result lifecycle states', async () => {
    const body = JSON.stringify({
      model: 'claude-opus-5',
      tools: [
        {
          name: 'mcp__GitHub__fetch',
          description: 'Fetch GitHub data',
          input_schema: { type: 'object' },
        },
        {
          name: 'Read',
          description: 'Local read',
          input_schema: { type: 'object' },
        },
      ],
      messages: [
        { role: 'user', content: 'Inspect the pull request.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'mcp__GitHub__fetch',
              input: { url: 'https://api.github.com/repos/example/repo' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: 'SECRET_RESULT_BODY',
            },
          ],
        },
      ],
    });

    const result = await observeAnthropicMcpRuntime(body);

    expect(result.connectedTools).toEqual([{
      name: 'mcp__GitHub__fetch',
      serverId: 'GitHub',
      toolId: 'fetch',
      connectionEvidence: 'declared_current_request',
    }]);
    expect(result.pendingUses).toEqual([]);
    expect(result.observedResults).toHaveLength(1);
    expect(result.observedResults[0]).toMatchObject({
      toolName: 'mcp__GitHub__fetch',
      serverId: 'GitHub',
      toolId: 'fetch',
      status: 'observed_result',
      isError: false,
      executedByFuryPipe: false,
    });
    expect(result.observedResults[0]?.toolUseIdSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.observedResults[0]?.inputSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.observedResults[0]?.resultSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(result)).not.toContain('SECRET_RESULT_BODY');
    expect(JSON.stringify(result)).not.toContain('api.github.com');
  });

  it('keeps tool_use pending until a correlated tool_result is actually present', async () => {
    const result = await observeAnthropicMcpRuntime(JSON.stringify({
      tools: [{ name: 'mcp__Context7__query-docs', input_schema: { type: 'object' } }],
      messages: [{
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_pending',
          name: 'mcp__Context7__query-docs',
          input: { library: 'react' },
        }],
      }],
    }));

    expect(result.pendingUses).toHaveLength(1);
    expect(result.pendingUses[0]).toMatchObject({
      toolName: 'mcp__Context7__query-docs',
      status: 'selected_no_result_observed',
    });
    expect(result.observedResults).toEqual([]);
  });

  it('does not claim non-MCP client tools or undeclared historical tools', async () => {
    const result = await observeAnthropicMcpRuntime(JSON.stringify({
      tools: [{ name: 'Read', input_schema: { type: 'object' } }],
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file: 'a.txt' } },
            { type: 'tool_use', id: 'toolu_old', name: 'mcp__Old__tool', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_read', content: 'local' },
            { type: 'tool_result', tool_use_id: 'toolu_old', content: 'old' },
          ],
        },
      ],
    }));

    expect(result.connectedTools).toEqual([]);
    expect(result.pendingUses).toEqual([]);
    expect(result.observedResults).toEqual([]);
  });

  it('records MCP error results without exposing result plaintext', async () => {
    const result = await observeAnthropicMcpRuntime(JSON.stringify({
      tools: [{ type: 'mcp', name: 'remote-search', input_schema: { type: 'object' } }],
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_err', name: 'remote-search', input: { q: 'x' } }],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'toolu_err',
            content: 'TOP SECRET FAILURE',
            is_error: true,
          }],
        },
      ],
    }));

    expect(result.observedResults).toHaveLength(1);
    expect(result.observedResults[0]?.isError).toBe(true);
    expect(result.observedResults[0]?.executedByFuryPipe).toBe(false);
    expect(JSON.stringify(result)).not.toContain('TOP SECRET FAILURE');
  });

  it('canonicalizes tool input object key order before hashing', async () => {
    const one = await observeAnthropicMcpRuntime(JSON.stringify({
      tools: [{ name: 'mcp__A__tool', input_schema: { type: 'object' } }],
      messages: [{ role: 'assistant', content: [{
        type: 'tool_use', id: 'same', name: 'mcp__A__tool', input: { b: 2, a: 1 },
      }] }],
    }));
    const two = await observeAnthropicMcpRuntime(JSON.stringify({
      tools: [{ name: 'mcp__A__tool', input_schema: { type: 'object' } }],
      messages: [{ role: 'assistant', content: [{
        type: 'tool_use', id: 'same', name: 'mcp__A__tool', input: { a: 1, b: 2 },
      }] }],
    }));

    expect(one.pendingUses[0]?.inputSha256).toBe(two.pendingUses[0]?.inputSha256);
  });
});
