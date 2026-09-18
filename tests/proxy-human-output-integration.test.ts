import { afterEach, describe, expect, it } from 'vitest';

import { createProxy } from '../src/core/proxy.js';

function mockFetch(handler: (request: Request) => Promise<Response> | Response): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(handler(request));
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

const restorers: Array<() => void> = [];
afterEach(() => {
  while (restorers.length > 0) restorers.pop()?.();
});

function okResponse(): Response {
  return new Response(JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('proxy compact-human runtime integration', () => {
  it('injects the FuryPipe runtime guidance for ordinary Claude Code human prose', async () => {
    let forwarded = '';
    restorers.push(mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return okResponse();
    }));

    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      humanOutputPolicy: true,
      transform: { compress: false },
    });

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        system: 'Base system.',
        messages: [{ role: 'user', content: 'Explain the architecture.' }],
      }),
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(forwarded).toContain('<furypipe_runtime_instruction>');
    expect(forwarded).toContain('compact, information-dense wording');
  });

  it('does not inject compact guidance when an exact response is required', async () => {
    let forwarded = '';
    restorers.push(mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return okResponse();
    }));

    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      humanOutputPolicy: true,
      transform: { compress: false },
    });
    const source = JSON.stringify({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'Réponds exactement : FURYPIPE_OK' }],
    });

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: source,
    }));
    await response.text();

    expect(forwarded).not.toContain('furypipe_runtime_instruction');
    expect(JSON.parse(forwarded)).toEqual(JSON.parse(source));
  });

  it('keeps compact guidance native when the Visual Engine compresses a large slab', async () => {
    let forwarded = '';
    restorers.push(mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return okResponse();
    }));

    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      humanOutputPolicy: true,
      transform: { compress: true, charsPerToken: 1, minCompressChars: 1 },
    });

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        system: 'Large stable project context. '.repeat(1500),
        messages: [{ role: 'user', content: 'Summarize the architecture.' }],
      }),
    }));
    await response.text();

    expect(forwarded).toContain('<furypipe_runtime_instruction>');
    expect(forwarded).toContain('human-facing natural-language prose');
  });

  it('allows library hosts to leave the behavior disabled', async () => {
    let forwarded = '';
    restorers.push(mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return okResponse();
    }));

    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      humanOutputPolicy: false,
      transform: { compress: false },
    });

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'Explain this.' }],
      }),
    }));
    await response.text();

    expect(forwarded).not.toContain('furypipe_runtime_instruction');
  });
});
