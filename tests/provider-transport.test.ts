import { describe, expect, it, vi } from 'vitest';
import {
  createProviderTransportRegistry,
  validateProviderTransportResult,
  type ProviderTransport,
} from '../src/provider-transport.js';
import { makeRequest } from './helpers/provider-executor.js';

const noop = async () => ({ providerId: 'openai', model: 'gpt-5.6-sol' });

describe('provider transport registry and bounded result contract', () => {
  it('creates an empty immutable registry and uses exact lookup only', () => {
    const registry = createProviderTransportRegistry([]);

    expect(Object.isFrozen(registry)).toBe(true);
    expect(registry.get('openai')).toBeUndefined();
    expect(registry.get('OpenAI')).toBeUndefined();
    expect(registry.get('gpt')).toBeUndefined();
  });

  it('rejects duplicate provider registrations', () => {
    expect(() => createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute: noop },
      { providerId: 'openai', protocol: 'openai', execute: noop },
    ])).toThrow(/duplicated/u);
  });

  it.each(['', ' OpenAI', 'openai ', 'open ai', 'openai\n', 'UPPER'])('rejects non-canonical provider ID %j', (providerId) => {
    expect(() => createProviderTransportRegistry([
      { providerId, protocol: 'openai', execute: noop },
    ] as never)).toThrow(/invalid/u);
  });

  it('rejects an unknown protocol and unexpected transport fields', () => {
    expect(() => createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'http' as never, execute: noop },
    ])).toThrow(/invalid/u);
    expect(() => createProviderTransportRegistry([
      { providerId: 'openai', protocol: 'openai', execute: noop, authorization: 'ignored' } as never,
    ])).toThrow(/invalid/u);
  });

  it('snapshots transport identity and callback so source-object mutation has no registry effect', async () => {
    const first = vi.fn(async () => ({ providerId: 'openai', model: 'gpt-5.6-sol' }));
    const second = vi.fn(async () => ({ providerId: 'openai', model: 'gpt-5.6-sol' }));
    const source: ProviderTransport = { providerId: 'openai', protocol: 'openai', execute: first };
    const registry = createProviderTransportRegistry([source]);
    source.providerId = 'anthropic';
    source.protocol = 'anthropic';
    source.execute = second;

    const transport = registry.get('openai')!;
    await transport.execute(makeRequest(), {
      requestDigest: 'd'.repeat(64), providerId: 'openai', model: 'gpt-5.6-sol', workloadId: 'coding',
      maxResponseBytes: 1_048_576,
    });
    expect(transport.providerId).toBe('openai');
    expect(transport.protocol).toBe('openai');
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('bounds registry size', () => {
    const transports = Array.from({ length: 33 }, (_, index) => ({
      providerId: `provider-${index}`,
      protocol: 'openai' as const,
      execute: noop,
    }));

    expect(() => createProviderTransportRegistry(transports)).toThrow(/at most 32/u);
  });

  it('labels absent network and acceptance reports as unknown and not-reported', () => {
    const result = validateProviderTransportResult({
      providerId: 'openai', model: 'gpt-5.6-sol',
    }, makeRequest());

    expect(result.network).toEqual({ status: 'unknown', evidence: 'not-reported' });
    expect(result.providerRequest).toEqual({ status: 'unknown', evidence: 'not-reported' });
    expect(result.usage).toBeUndefined();
  });

  it('labels explicit statuses as transport-reported, never verified', () => {
    const result = validateProviderTransportResult({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      networkStatus: 'executed',
      providerRequestStatus: 'accepted',
    }, makeRequest());

    expect(result.network).toEqual({ status: 'executed', evidence: 'transport-reported' });
    expect(result.providerRequest).toEqual({ status: 'accepted', evidence: 'transport-reported' });
    expect(JSON.stringify(result)).not.toContain('verified');
  });

  it('rejects unknown transport result fields and identity mismatches', () => {
    const request = makeRequest();
    for (const value of [
      { providerId: 'openai', model: 'gpt-5.6-sol', networkEvidence: 'verified' },
      { providerId: 'anthropic', model: 'gpt-5.6-sol' },
      { providerId: 'openai', model: 'gpt-5.6-luna' },
    ]) {
      expect(() => validateProviderTransportResult(value, request))
        .toThrowError(expect.objectContaining({ code: 'transport-result-invalid', transportInvoked: true }));
    }
  });

  it('preserves only explicitly reported safe integer token counts', () => {
    const request = makeRequest();
    const usage = { inputTokens: 100, outputTokens: 20, cacheWriteTokens: 3, cacheReadTokens: 4 };
    expect(validateProviderTransportResult({ providerId: 'openai', model: request.model, usage }, request).usage)
      .toEqual(usage);
    expect(validateProviderTransportResult({ providerId: 'openai', model: request.model, usage: { inputTokens: 0 } }, request).usage)
      .toEqual({ inputTokens: 0 });
    expect(validateProviderTransportResult({ providerId: 'openai', model: request.model }, request).usage)
      .toBeUndefined();
  });

  it('rejects negative, fractional and unsafe token counts', () => {
    const request = makeRequest();
    for (const inputTokens of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => validateProviderTransportResult({
        providerId: 'openai', model: request.model, usage: { inputTokens },
      }, request)).toThrowError(expect.objectContaining({ code: 'transport-result-invalid' }));
    }
  });

  it('rejects response bodies above the explicit 1 MiB bound', () => {
    const request = makeRequest();

    expect(() => validateProviderTransportResult({
      providerId: 'openai', model: request.model, responseBytes: new Uint8Array(1_048_577),
    }, request)).toThrowError(expect.objectContaining({ code: 'response-too-large', transportInvoked: true }));
  });

  it('snapshots response bytes so later transport-buffer writes cannot alter the result', () => {
    const request = makeRequest();
    const buffer = new Uint8Array([1, 2, 3]);
    const result = validateProviderTransportResult({
      providerId: 'openai', model: request.model, responseBytes: buffer,
    }, request);

    buffer[0] = 9;
    expect([...result.responseBytes!]).toEqual([1, 2, 3]);
    expect(result.responseBytes).not.toBe(buffer);
  });
});
