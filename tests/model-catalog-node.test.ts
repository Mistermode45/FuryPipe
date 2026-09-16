import { afterEach, describe, expect, it } from 'vitest';

import { inspectRuntimeModels, resetRuntimeModelFabricForTests } from '../src/core/model-fabric.js';
import { refreshRuntimeModelCatalog } from '../src/model-catalog-node.js';

afterEach(() => {
  resetRuntimeModelFabricForTests();
});

describe('Node model catalog refresh', () => {
  it('does no network work for unconfigured providers', async () => {
    let calls = 0;
    const report = await refreshRuntimeModelCatalog({
      env: {},
      fetchImpl: (async () => {
        calls += 1;
        throw new Error('must not be called');
      }) as typeof fetch,
    });

    expect(calls).toBe(0);
    expect(report.registeredModels).toBe(0);
    expect(report.providers.every((provider) => provider.status === 'not_configured')).toBe(true);
  });

  it('refreshes OpenAI without leaking credentials into the report or registry', async () => {
    const secret = 'sk-super-secret-value';
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const report = await refreshRuntimeModelCatalog({
      env: { OPENAI_API_KEY: secret },
      fetchImpl: (async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input), authorization: headers.get('authorization') });
        return new Response(JSON.stringify({
          object: 'list',
          data: [{ id: 'gpt-6-astra', object: 'model', owned_by: 'openai' }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });

    expect(calls).toEqual([{
      url: 'https://api.openai.com/v1/models',
      authorization: `Bearer ${secret}`,
    }]);
    expect(report.providers.find((provider) => provider.provider === 'openai')).toMatchObject({
      status: 'refreshed',
      models: 1,
    });
    expect(inspectRuntimeModels().map((model) => model.id)).toContain('gpt-6-astra');
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(JSON.stringify(inspectRuntimeModels())).not.toContain(secret);
  });

  it('follows bounded Gemini pagination and merges the catalog', async () => {
    const urls: string[] = [];
    const report = await refreshRuntimeModelCatalog({
      env: { GEMINI_API_KEY: 'gemini-secret' },
      fetchImpl: (async (input, init) => {
        const url = new URL(String(input));
        urls.push(url.toString());
        expect(url.searchParams.has('key')).toBe(false);
        expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('gemini-secret');
        const pageToken = url.searchParams.get('pageToken');
        return new Response(JSON.stringify(pageToken === null ? {
          models: [{ name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' }],
          nextPageToken: 'next-page',
        } : {
          models: [{ name: 'models/gemini-future-vision', displayName: 'Gemini Future Vision' }],
        }), { status: 200 });
      }) as typeof fetch,
    });

    expect(urls).toHaveLength(2);
    expect(new URL(urls[1]!).searchParams.get('pageToken')).toBe('next-page');
    expect(report.providers.find((provider) => provider.provider === 'google')).toMatchObject({
      status: 'refreshed',
      models: 2,
    });
    expect(inspectRuntimeModels().map((model) => model.id)).toEqual([
      'gemini-3.8-flash',
      'gemini-future-vision',
    ]);
  });

  it('fails closed on oversized provider metadata without exposing the body', async () => {
    const report = await refreshRuntimeModelCatalog({
      env: { OPENAI_API_KEY: 'secret' },
      maxResponseBytes: 4096,
      fetchImpl: (async () => new Response('x'.repeat(5000), {
        status: 200,
        headers: { 'content-length': '5000' },
      })) as typeof fetch,
    });

    expect(report.providers.find((provider) => provider.provider === 'openai')).toMatchObject({
      status: 'failed',
      reason: 'payload_too_large',
      models: 0,
    });
    expect(inspectRuntimeModels()).toEqual([]);
  });
});
