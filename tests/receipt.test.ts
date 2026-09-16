import { describe, expect, it } from 'vitest';
import {
  buildPrecisionManifest,
  createCompressionReceipt,
  transformOpenAIChatCompletions,
  transformOpenAIResponses,
  transformAnthropicMessages,
  verifyCompressionReceipt,
} from '../src/core/index.js';

const encoder = new TextEncoder();

describe('compression receipts', () => {
  it('records byte hashes and protected-span hashes without source plaintext', () => {
    const original = encoder.encode('Authorization: Bearer super-secret-token\npath=C:/workspace/FuryPipe');
    const transformed = encoder.encode('Authorization: Bearer super-secret-token\npath=<externalized>');
    const receipt = createCompressionReceipt({
      original,
      transformed,
      requestId: 'req-receipt-test',
      strategy: 'pxpipe-transform',
      precisionManifest: buildPrecisionManifest(new TextDecoder().decode(original)),
    });

    expect(receipt.verificationStatus).toBe('verified');
    expect(receipt.originalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.protectedSpans.length).toBeGreaterThan(0);
    expect(JSON.stringify(receipt)).not.toContain('super-secret-token');
    expect(JSON.stringify(receipt)).not.toContain('C:/workspace/FuryPipe');
    expect(verifyCompressionReceipt(receipt, original, transformed)).toBe(true);
    expect(verifyCompressionReceipt(receipt, original, encoder.encode('tampered'))).toBe(false);
  });

  it('emits an opt-in receipt from the public Anthropic wrapper', async () => {
    const body = encoder.encode(JSON.stringify({
      model: 'claude-mythos-5',
      messages: [{ role: 'user', content: 'hello' }],
    }));
    const result = await transformAnthropicMessages({
      body,
      model: 'claude-mythos-5',
      requestId: 'req-public-receipt',
      options: { emitReceipt: true },
    });

    expect(result.reason).toBe('vision_capability_unknown');
    expect(result.receipt?.requestId).toBe('req-public-receipt');
    expect(result.receipt?.strategy).toBe('passthrough');
    expect(result.receipt?.originalHash).toBe(result.receipt?.transformedHash);
    expect(result.receipt?.verificationStatus).toBe('verified');
  });

  it('does not add a receipt by default', async () => {
    const body = encoder.encode(JSON.stringify({
      model: 'claude-mythos-5',
      messages: [{ role: 'user', content: 'hello' }],
    }));
    const result = await transformAnthropicMessages({ body, model: 'claude-mythos-5' });
    expect(result.receipt).toBeUndefined();
  });

  it('does not claim verified spans for invalid UTF-8 input', async () => {
    const result = await transformAnthropicMessages({
      body: new Uint8Array([0xff, 0xfe, 0xfd]),
      model: 'claude-mythos-5',
      options: { emitReceipt: true },
    });
    expect(result.receipt?.verificationStatus).toBe('unverified');
    expect(result.receipt?.protectedSpans).toEqual([]);
    expect(result.receipt?.originalHash).toBe(result.receipt?.transformedHash);
  });

  it('emits receipts from both OpenAI protocol wrappers', async () => {
    const chatBody = encoder.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
    }));
    const responsesBody = encoder.encode(JSON.stringify({
      model: 'gpt-5.6-sol',
      input: 'hello',
    }));

    const [chat, responses] = await Promise.all([
      transformOpenAIChatCompletions(chatBody, { emitReceipt: true }),
      transformOpenAIResponses(responsesBody, { emitReceipt: true }),
    ]);

    expect(chat.info.receipt?.cacheEffects?.protocol).toBe('chat-completions');
    expect(responses.info.receipt?.cacheEffects?.protocol).toBe('responses');
    expect(chat.info.receipt?.verificationStatus).toBe('verified');
    expect(responses.info.receipt?.verificationStatus).toBe('verified');
    expect(chat.info.receipt?.originalHash).toBe(chat.info.receipt?.transformedHash);
    expect(responses.info.receipt?.originalHash).toBe(responses.info.receipt?.transformedHash);
  });
});
