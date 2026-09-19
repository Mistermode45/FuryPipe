import { describe, expect, it } from 'vitest';

import {
  decodeFuryProviderResponseText,
  FuryProviderResponseTextError,
} from '../src/provider-response-text.js';

const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

describe('strict provider response text decoder', () => {
  it('extracts OpenAI Responses assistant text while ignoring reasoning metadata', () => {
    const decoded = decodeFuryProviderResponseText('openai', bytes({
      id: 'resp_1',
      output: [
        { type: 'reasoning', summary: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'Hello ' },
            { type: 'output_text', text: 'world.' },
          ],
        },
      ],
    }));

    expect(decoded).toEqual({
      format: 'furypipe-provider-response-text/v1',
      providerId: 'openai',
      text: 'Hello world.',
      textBytes: 12,
      sourceShape: 'openai.responses.output_text',
      verification: 'unverified',
      executionAuthority: false,
    });
  });

  it('extracts Anthropic text while allowing thinking blocks but rejecting tool use', () => {
    expect(decodeFuryProviderResponseText('anthropic', bytes({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'not surfaced' },
        { type: 'text', text: 'Safe answer' },
      ],
    }))).toMatchObject({
      text: 'Safe answer',
      sourceShape: 'anthropic.messages.content_text',
      verification: 'unverified',
    });

    expect(() => decodeFuryProviderResponseText('anthropic', bytes({
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will call a tool.' },
        { type: 'tool_use', id: 'tool_1', name: 'shell', input: {} },
      ],
    }))).toThrowError(expect.objectContaining({
      code: 'unsupported-response-content',
    }));
  });

  it('extracts current Gemini Interactions v1 model_output text', () => {
    const decoded = decodeFuryProviderResponseText('google', bytes({
      id: 'interaction_1',
      status: 'completed',
      steps: [{
        type: 'model_output',
        content: [
          { type: 'text', text: 'Gemini answer.' },
        ],
      }],
    }));

    expect(decoded).toMatchObject({
      providerId: 'google',
      text: 'Gemini answer.',
      sourceShape: 'google.interactions.model_output_text',
      verification: 'unverified',
      executionAuthority: false,
    });
  });

  it('rejects provider tool/call content instead of silently dropping it', () => {
    expect(() => decodeFuryProviderResponseText('openai', bytes({
      output: [{
        type: 'function_call',
        name: 'dangerous',
        arguments: '{}',
      }],
    }))).toThrowError(expect.objectContaining({
      code: 'unsupported-response-content',
    }));

    expect(() => decodeFuryProviderResponseText('google', bytes({
      status: 'completed',
      steps: [{
        type: 'model_output',
        content: [{ type: 'image', uri: 'gs://not-text' }],
      }],
    }))).toThrowError(expect.objectContaining({
      code: 'unsupported-response-content',
    }));
  });

  it('rejects invalid JSON, malformed UTF-8, empty text and oversized text', () => {
    expect(() => decodeFuryProviderResponseText(
      'openai',
      new TextEncoder().encode('{not-json'),
    )).toThrowError(expect.objectContaining({
      code: 'invalid-response-json',
    }));

    expect(() => decodeFuryProviderResponseText(
      'openai',
      new Uint8Array([0xc3, 0x28]),
    )).toThrowError(expect.objectContaining({
      code: 'invalid-response-encoding',
    }));

    expect(() => decodeFuryProviderResponseText('anthropic', bytes({
      role: 'assistant',
      content: [{ type: 'text', text: '   ' }],
    }))).toThrowError(expect.objectContaining({
      code: 'empty-response-text',
    }));

    expect(() => decodeFuryProviderResponseText('openai', bytes({
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'x'.repeat(1100) }],
      }],
    }), { maxBytes: 1024 })).toThrowError(expect.objectContaining({
      code: 'response-text-too-large',
    }));
  });

  it('rejects unsupported provider and unsafe maxBytes configuration', () => {
    expect(() => decodeFuryProviderResponseText(
      'other' as never,
      bytes({}),
    )).toThrowError(FuryProviderResponseTextError);

    expect(() => decodeFuryProviderResponseText(
      'openai',
      bytes({ output: [] }),
      { maxBytes: 0 },
    )).toThrow(RangeError);
  });
});
