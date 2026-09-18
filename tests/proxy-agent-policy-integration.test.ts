import { afterEach, describe, expect, it } from 'vitest';

import {
  FURY_PROXY_AGENT_POLICY_SENTINEL,
} from '../src/core/proxy-agent-policy.js';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';

function captureEvent(): {
  readonly onRequest: (event: ProxyEvent) => void;
  readonly event: Promise<ProxyEvent>;
} {
  let resolve!: (event: ProxyEvent) => void;
  const event = new Promise<ProxyEvent>((done) => { resolve = done; });
  return { onRequest: resolve, event };
}

const restores: Array<() => void> = [];

function mockFetch(handler: (request: Request) => Promise<Response> | Response): void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(handler(request));
  }) as typeof fetch;
  restores.push(() => { globalThis.fetch = real; });
}

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

describe('proxy agent policy integration', () => {
  it('injects native policy text on Anthropic traffic and emits plaintext-free telemetry', async () => {
    let forwarded = '';
    mockFetch(async (request) => {
      if (new URL(request.url).pathname.endsWith('/count_tokens')) {
        return new Response(JSON.stringify({ input_tokens: 12 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      forwarded = await request.clone().text();
      return new Response(JSON.stringify({
        id: 'msg_policy',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 12, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const captured = captureEvent();
    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      proxyAgentPolicy: true,
      transform: { compress: false },
      onRequest: captured.onRequest,
    });
    const source = {
      model: 'claude-opus-5',
      max_tokens: 64,
      system: 'host authority',
      messages: [{ role: 'user', content: 'keep-user-text-exact' }],
    };

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(source),
    }));
    await response.text();
    const event = await captured.event;
    const outgoing = JSON.parse(forwarded) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(String(outgoing.system)).toContain('host authority');
    expect(String(outgoing.system)).toContain(FURY_PROXY_AGENT_POLICY_SENTINEL);
    expect(outgoing.messages).toEqual(source.messages);
    expect(event.agentPolicy).toEqual(expect.objectContaining({
      applied: true,
      version: '1.0.0',
      protocol: 'anthropic-messages',
    }));
    expect(event.agentPolicy?.instructionBytes).toBeGreaterThan(0);
    expect(JSON.stringify(event.agentPolicy)).not.toContain('keep-user-text-exact');
  });

  it('keeps x-furypipe-bypass byte-for-byte even when the policy is enabled', async () => {
    let forwarded = '';
    mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return new Response(JSON.stringify({
        id: 'msg_bypass',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 2, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const captured = captureEvent();
    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      proxyAgentPolicy: true,
      onRequest: captured.onRequest,
    });
    const source = JSON.stringify({
      model: 'claude-opus-5',
      system: 'unchanged',
      messages: [{ role: 'user', content: 'unchanged' }],
    });

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-furypipe-bypass': '1',
      },
      body: source,
    }));
    await response.text();
    const event = await captured.event;

    expect(forwarded).toBe(source);
    expect(event.agentPolicy).toBeUndefined();
  });

  it('injects the policy after a Messages to OpenAI Responses bridge', async () => {
    let forwarded = '';
    mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return new Response(JSON.stringify({
        id: 'resp_policy_bridge',
        object: 'response',
        status: 'completed',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }],
        }],
        usage: { input_tokens: 5, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const captured = captureEvent();
    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      openAIUpstream: 'http://openai.test',
      openAIModels: ['gpt-5.6-sol'],
      proxyAgentPolicy: true,
      transform: { compress: false },
      onRequest: captured.onRequest,
    });
    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.6-sol',
        max_tokens: 64,
        system: 'host authority',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    }));
    await response.text();
    const event = await captured.event;
    const outgoing = JSON.parse(forwarded) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(String(outgoing.instructions)).toContain(FURY_PROXY_AGENT_POLICY_SENTINEL);
    expect(event.accountingProvider).toBe('openai');
    expect(event.agentPolicy?.protocol).toBe('openai-responses');
    expect(event.agentPolicy?.applied).toBe(true);
  });
});
