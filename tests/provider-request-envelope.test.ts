import { describe, expect, it } from 'vitest';
import { compileFuryPrompt } from '../src/fury-prompt.js';
import { prepareProviderRequestEnvelope } from '../src/provider-request-envelope.js';
import { FuryGovernedProviderExecutorError } from '../src/provider-execution-errors.js';
import { makeContextResult, makeRequest } from './helpers/provider-executor.js';

describe('governed provider request envelope', () => {
  it('uses the exact final Context Runtime prompt and preserves exact attempt identity', () => {
    const context = makeContextResult({ task: 'Exact final task text.' });
    const compiled = compileFuryPrompt(context.prompt);
    const request = prepareProviderRequestEnvelope(context);

    expect(request).toMatchObject({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      workloadId: 'coding',
      protocol: 'openai',
      prompt: compiled.prompt,
      promptDigest: compiled.promptDigest,
      promptSourceDigest: compiled.source.contentDigest,
      promptBytes: compiled.promptBytes,
    });
    expect(request.prompt).toContain('Exact final task text.');
  });

  it('rejects shallow-copied, serialized, and fabricated Context Runtime results', () => {
    const context = makeContextResult();
    const copied = { ...context };
    const serialized = JSON.parse(JSON.stringify(context));
    const fabricated = { ...context, providerId: 'openai' };

    for (const value of [copied, serialized, fabricated]) {
      expect(() => prepareProviderRequestEnvelope(value as typeof context))
        .toThrowError(expect.objectContaining({ code: 'invalid-prepared-attempt' }));
    }
  });

  it('produces a deterministic digest for the same canonical exact request', () => {
    expect(makeRequest({ task: 'same' }).requestDigest).toBe(makeRequest({ task: 'same' }).requestDigest);
  });

  it('changes the digest when the final prompt changes', () => {
    expect(makeRequest({ task: 'first' }).requestDigest).not.toBe(makeRequest({ task: 'second' }).requestDigest);
  });

  it('changes the digest when the exact model changes', () => {
    expect(makeRequest({ model: 'gpt-5.6-sol' }).requestDigest)
      .not.toBe(makeRequest({ model: 'gpt-5.6-luna' }).requestDigest);
  });

  it('changes the digest when the exact provider changes', () => {
    expect(makeRequest({ providerId: 'openai', model: 'gpt-5.6-sol' }).requestDigest)
      .not.toBe(makeRequest({ providerId: 'anthropic', model: 'claude-opus-5' }).requestDigest);
  });

  it('changes the digest when the exact workload changes', () => {
    expect(makeRequest({ workloadId: 'coding' }).requestDigest)
      .not.toBe(makeRequest({ workloadId: 'research' }).requestDigest);
  });

  it('snapshots a frozen request so mutation attempts cannot change its digest or prompt', () => {
    const request = makeRequest({ task: 'snapshot me' });
    const digest = request.requestDigest;
    const prompt = request.prompt;

    expect(Object.isFrozen(request)).toBe(true);
    expect(Reflect.set(request, 'prompt', 'mutated')).toBe(false);
    expect(request.prompt).toBe(prompt);
    expect(request.requestDigest).toBe(digest);
  });

  it('rejects aliases instead of silently canonicalizing an attempt provider', () => {
    const context = makeContextResult({ providerId: 'claude', model: 'claude-opus-5' });

    expect(() => prepareProviderRequestEnvelope(context))
      .toThrowError(expect.objectContaining({ code: 'provider-not-registered' }));
  });

  it('exposes no credential-bearing envelope fields', () => {
    const request = makeRequest();

    expect(Object.keys(request)).toEqual([
      'format', 'providerId', 'model', 'workloadId', 'protocol', 'prompt', 'promptDigest',
      'promptSourceDigest', 'promptBytes', 'requestDigest',
    ]);
    expect(JSON.stringify(request)).not.toMatch(/api.?key|authorization|bearer|credential|secret/iu);
  });

  it('returns the structured safe error contract for invalid prepared results', () => {
    try {
      prepareProviderRequestEnvelope({} as never);
      expect.fail('expected invalid prepared result');
    } catch (error) {
      expect(error).toBeInstanceOf(FuryGovernedProviderExecutorError);
      expect(error).toMatchObject({ code: 'invalid-prepared-attempt' });
      expect((error as Error).message).not.toContain('secret');
    }
  });
});
