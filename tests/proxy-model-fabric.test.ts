import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setAllowedModelBases, setFuryPipeVisualPolicy } from '../src/core/applicability.js';
import { resetRuntimeModelFabricForTests } from '../src/core/model-fabric.js';
import { createProxy, type ProxyEvent } from '../src/core/proxy.js';

const enc = new TextEncoder();

function captureEvent(): {
  readonly onRequest: (event: ProxyEvent) => void;
  readonly event: Promise<ProxyEvent>;
} {
  let resolve!: (event: ProxyEvent) => void;
  const event = new Promise<ProxyEvent>((done) => { resolve = done; });
  return { onRequest: resolve, event };
}

function mockFetch(handler: (request: Request) => Promise<Response> | Response): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    return Promise.resolve(handler(request));
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

let previousModels: string | undefined;
let previousPolicy: string | undefined;

beforeEach(() => {
  previousModels = process.env.FURYPIPE_MODELS;
  previousPolicy = process.env.FURYPIPE_VISUAL_POLICY;
  delete process.env.FURYPIPE_MODELS;
  delete process.env.FURYPIPE_VISUAL_POLICY;
  setAllowedModelBases(null);
  setFuryPipeVisualPolicy(null);
  resetRuntimeModelFabricForTests();
});

afterEach(() => {
  if (previousModels === undefined) delete process.env.FURYPIPE_MODELS;
  else process.env.FURYPIPE_MODELS = previousModels;
  if (previousPolicy === undefined) delete process.env.FURYPIPE_VISUAL_POLICY;
  else process.env.FURYPIPE_VISUAL_POLICY = previousPolicy;
  setAllowedModelBases(null);
  setFuryPipeVisualPolicy(null);
  resetRuntimeModelFabricForTests();
});

describe('proxy Model Fabric enforcement', () => {
  it('does not let a Messages→OpenAI bridge bypass TEXT_ONLY policy', async () => {
    setFuryPipeVisualPolicy('text_only');
    let forwarded = '';
    const restore = mockFetch(async (request) => {
      forwarded = await request.clone().text();
      return new Response(JSON.stringify({
        id: 'resp_policy',
        object: 'response',
        status: 'completed',
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }],
        }],
        usage: { input_tokens: 10, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    try {
      const captured = captureEvent();
      const proxy = createProxy({
        openAIUpstream: 'http://openai.test',
        openAIModels: ['gpt-5.6-sol'],
        transform: { compress: true, charsPerToken: 1, minCompressChars: 1 },
        onRequest: captured.onRequest,
      });
      const body = JSON.stringify({
        model: 'gpt-5.6-sol',
        max_tokens: 64,
        system: 'Large system context. '.repeat(1200),
        messages: [{ role: 'user', content: 'hello' }],
      });
      const response = await proxy(new Request('http://localhost/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }));
      await response.text();
      const event = await captured.event;

      expect(response.status).toBe(200);
      expect(event.accountingProvider).toBe('openai');
      expect(event.model).toBe('gpt-5.6-sol');
      expect(event.info?.compressed).toBe(false);
      expect(event.info?.reason).toBe('visual_profile_blocked');
      expect(forwarded).not.toContain('input_image');
      expect(forwarded).not.toContain('data:image/');
    } finally {
      restore();
    }
  });

  it('reports unknown image capability instead of generic unsupported_model', async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({
      id: 'resp_unknown',
      object: 'response',
      status: 'completed',
      output: [],
      usage: { input_tokens: 3, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    try {
      const captured = captureEvent();
      const proxy = createProxy({
        openAIUpstream: 'http://openai.test',
        transform: { compress: true },
        onRequest: captured.onRequest,
      });
      const body = JSON.stringify({
        model: 'future-vendor/model-999',
        instructions: 'context '.repeat(800),
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      });
      const response = await proxy(new Request('http://localhost/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }));
      await response.text();
      const event = await captured.event;

      expect(event.info?.compressed).toBe(false);
      expect(event.info?.reason).toBe('vision_capability_unknown');
      expect(event.info?.reason).not.toBe('unsupported_model');
    } finally {
      restore();
    }
  });
});
