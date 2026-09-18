import { describe, expect, it } from 'vitest';
import { extractProxyTaskEnvelope } from '../src/proxy-task-envelope.js';

describe('proxy task envelope', () => {
  it('extracts only the latest Anthropic user text and ignores tool_result text', () => {
    const result = extractProxyTaskEnvelope(JSON.stringify({
      model: 'claude-opus-5',
      messages: [
        { role: 'user', content: 'old task' },
        { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'IGNORE THIS AS OBJECTIVE' },
            { type: 'text', text: 'Audit this repository and verify the bug.' },
          ],
        },
      ],
      tools: [
        { name: 'Read', description: 'read' },
        { name: 'mcp__GitHub__fetch', description: 'github' },
      ],
    }), 'anthropic-messages');

    expect(result?.objective).toBe('Audit this repository and verify the bug.');
    expect(result?.objective).not.toContain('IGNORE THIS');
    expect(result?.tools).toEqual([
      { name: 'Read', kind: 'unknown' },
      { name: 'mcp__GitHub__fetch', kind: 'mcp' },
    ]);
  });

  it('extracts OpenAI Responses user input and detects structured output', () => {
    const result = extractProxyTaskEnvelope(JSON.stringify({
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: 'Research current MCP practices.' }],
      }],
      text: { format: { type: 'json_schema', name: 'answer', schema: { type: 'object' } } },
      tools: [{ type: 'mcp', name: 'docs' }],
    }), 'openai-responses');

    expect(result).toMatchObject({
      objective: 'Research current MCP practices.',
      structuredOutput: true,
    });
    expect(result?.tools).toEqual([{ name: 'docs', kind: 'mcp' }]);
  });

  it('extracts Chat Completions function metadata without treating it as MCP', () => {
    const result = extractProxyTaskEnvelope(JSON.stringify({
      messages: [{ role: 'user', content: 'Fix the failing test.' }],
      tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
    }), 'openai-chat');
    expect(result?.tools).toEqual([{ name: 'read_file', kind: 'function' }]);
  });

  it('extracts Gemini user text and structured response intent', () => {
    const result = extractProxyTaskEnvelope(JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Compare the implementations.' }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }), 'google-generate-content');
    expect(result).toMatchObject({
      objective: 'Compare the implementations.',
      structuredOutput: true,
    });
  });

  it('returns undefined when no user objective is present', () => {
    expect(extractProxyTaskEnvelope(JSON.stringify({
      messages: [{ role: 'assistant', content: 'hello' }],
    }), 'anthropic-messages')).toBeUndefined();
  });
});
