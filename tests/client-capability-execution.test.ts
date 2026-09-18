import { describe, expect, it } from 'vitest';

import {
  observeClientCapabilityExecutions,
} from '../src/core/client-capability-execution.js';

const enc = new TextEncoder();

function body(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}

describe('client capability execution observation', () => {
  it('observes a completed Anthropic MCP tool result without storing result plaintext', async () => {
    const result = await observeClientCapabilityExecutions(body({
      messages: [
        {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_123',
            name: 'mcp__github__get_issue',
            input: { owner: 'example', repo: 'private', issue: 42 },
          }],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'toolu_123',
            content: 'SECRET RESULT TEXT',
          }],
        },
      ],
    }), 'anthropic-messages');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      kind: 'mcp',
      capabilityId: 'github/get_issue',
      mcpServerId: 'github',
      mcpMethod: 'get_issue',
      outcome: 'success',
      executionState: 'OBSERVED_EXECUTED',
      verified: false,
    }));
    expect(result[0]?.callDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result[0]?.resultDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result[0])).not.toContain('SECRET RESULT TEXT');
    expect(JSON.stringify(result[0])).not.toContain('toolu_123');
  });

  it('classifies an explicit Skill tool result as a skill execution observation', async () => {
    const result = await observeClientCapabilityExecutions(body({
      messages: [
        {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'skill_call_1',
            name: 'Skill',
            input: { skill: 'systematic-debugging' },
          }],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'skill_call_1',
            content: 'loaded',
          }],
        },
      ],
    }), 'anthropic-messages');

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'skill',
        capabilityId: 'systematic-debugging',
        outcome: 'success',
      }),
    ]);
  });

  it('does not convert tool_use selection into execution without a result', async () => {
    const result = await observeClientCapabilityExecutions(body({
      messages: [{
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_pending',
          name: 'mcp__exa__search',
          input: { q: 'latest docs' },
        }],
      }],
    }), 'anthropic-messages');

    expect(result).toEqual([]);
  });

  it('observes OpenAI Chat tool result correlation', async () => {
    const result = await observeClientCapabilityExecutions(body({
      messages: [
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: { name: 'repo_read', arguments: '{"path":"README.md"}' },
          }],
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          content: 'result',
        },
      ],
    }), 'openai-chat');

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'tool',
        capabilityId: 'repo_read',
        outcome: 'success',
      }),
    ]);
  });

  it('observes OpenAI Responses function_call_output', async () => {
    const result = await observeClientCapabilityExecutions(body({
      input: [
        {
          type: 'function_call',
          call_id: 'call_resp_1',
          name: 'mcp__context7__resolve_library',
          arguments: '{"library":"react"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_resp_1',
          output: { ok: true },
        },
      ],
    }), 'openai-responses');

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'mcp',
        capabilityId: 'context7/resolve_library',
        mcpServerId: 'context7',
        mcpMethod: 'resolve_library',
      }),
    ]);
  });

  it('records error outcome without upgrading it to verified execution', async () => {
    const result = await observeClientCapabilityExecutions(body({
      messages: [
        {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_error',
            name: 'Read',
            input: { file_path: '/tmp/x' },
          }],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'toolu_error',
            is_error: true,
            content: 'permission denied',
          }],
        },
      ],
    }), 'anthropic-messages');

    expect(result[0]).toEqual(expect.objectContaining({
      kind: 'tool',
      capabilityId: 'Read',
      outcome: 'error',
      verified: false,
    }));
  });
});
