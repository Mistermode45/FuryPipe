import { afterEach, describe, expect, it } from 'vitest';

import { createProxy, type ProxyEvent } from '../src/core/proxy.js';
import { toTrackEvent } from '../src/core/tracker.js';

function mockFetch(handler: (request: Request) => Promise<Response> | Response): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(handler(request));
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

function captureEvent(): {
  readonly onRequest: (event: ProxyEvent) => void;
  readonly event: Promise<ProxyEvent>;
} {
  let resolve!: (event: ProxyEvent) => void;
  const event = new Promise<ProxyEvent>((done) => { resolve = done; });
  return { onRequest: resolve, event };
}

function okResponse(): Response {
  return new Response(JSON.stringify({
    id: 'msg_mcp_observation',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 10, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const restore: Array<() => void> = [];
afterEach(() => {
  while (restore.length > 0) restore.pop()?.();
});

describe('live proxy passive MCP observability', () => {
  it('records exposed and observed MCP lifecycle without changing the provider request', async () => {
    let forwarded = '';
    restore.push(mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return okResponse();
    }));
    const captured = captureEvent();

    const source = JSON.stringify({
      model: 'claude-opus-5',
      tools: [{
        name: 'mcp__GitHub__fetch',
        description: 'Fetch repository information.',
        annotations: {
          readOnlyHint: true,
          openWorldHint: true,
        },
        input_schema: { type: 'object' },
      }],
      messages: [
        { role: 'user', content: 'Inspect the pull request.' },
        {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_live_observed',
            name: 'mcp__GitHub__fetch',
            input: { url: 'https://api.github.com/repos/private/example' },
          }],
        },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'toolu_live_observed',
            content: 'SECRET_MCP_RESULT_BODY',
          }],
        },
      ],
    });

    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      mcpObservation: true,
      transform: { compress: false },
      onRequest: captured.onRequest,
    });

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: source,
    }));
    await response.text();
    const event = await captured.event;
    const tracked = toTrackEvent(event);
    const serialized = JSON.stringify(tracked);

    expect(response.status).toBe(200);
    expect(JSON.parse(forwarded)).toEqual(JSON.parse(source));

    expect(event.mcp?.executedByFuryPipe).toBe(false);
    expect(event.mcp?.authorizationGranted).toBe(false);
    expect(event.mcp?.observation.observedResults).toHaveLength(1);
    expect(event.mcp?.tools[0]?.assessment).toMatchObject({
      trust: 'untrusted',
      riskClass: 'untrusted_unknown',
      authorizationGranted: false,
      requiresPolicyGate: true,
    });

    expect(tracked.mcp_exposed_tools).toEqual([
      expect.objectContaining({
        tool_name: 'mcp__GitHub__fetch',
        server_id: 'GitHub',
        tool_id: 'fetch',
        transport_verified: false,
        trust: 'untrusted',
        risk_class: 'untrusted_unknown',
        authorization_granted: false,
        requires_policy_gate: true,
      }),
    ]);
    expect(tracked.mcp_observed_results).toEqual([
      expect.objectContaining({
        tool_name: 'mcp__GitHub__fetch',
        status: 'observed_result',
        is_error: false,
        executed_by_furypipe: false,
      }),
    ]);
    expect(tracked.mcp_executed_by_furypipe).toBe(false);
    expect(tracked.mcp_authorization_granted).toBe(false);
    expect(serialized).not.toContain('SECRET_MCP_RESULT_BODY');
    expect(serialized).not.toContain('api.github.com');
    expect(serialized).not.toContain('private/example');
  });

  it('does nothing when passive MCP observation is disabled', async () => {
    restore.push(mockFetch(() => okResponse()));
    const captured = captureEvent();

    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      mcpObservation: false,
      transform: { compress: false },
      onRequest: captured.onRequest,
    });

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        tools: [{ name: 'mcp__Docs__search', input_schema: { type: 'object' } }],
        messages: [{ role: 'user', content: 'Find docs.' }],
      }),
    }));
    await response.text();
    const event = await captured.event;

    expect(event.mcp).toBeUndefined();
    expect(event.mcpError).toBeUndefined();
  });

  it('fails open when passive MCP observation exceeds its bounded history limit', async () => {
    let forwarded = '';
    restore.push(mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return okResponse();
    }));
    const captured = captureEvent();

    const messages = Array.from({ length: 2_049 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: 'x' }],
    }));
    const source = JSON.stringify({
      model: 'claude-opus-5',
      tools: [{ name: 'mcp__Docs__search', input_schema: { type: 'object' } }],
      messages,
    });

    const proxy = createProxy({
      upstream: 'http://anthropic.test',
      mcpObservation: true,
      transform: { compress: false },
      onRequest: captured.onRequest,
    });

    const response = await proxy(new Request('http://localhost/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: source,
    }));
    await response.text();
    const event = await captured.event;

    expect(response.status).toBe(200);
    expect(JSON.parse(forwarded)).toEqual(JSON.parse(source));
    expect(event.mcp).toBeUndefined();
    expect(event.mcpError).toContain('MCP observation message count exceeds its bound');
  });
});
