import { describe, expect, it } from 'vitest';
import { extractEnvFields } from '../src/core/transform.js';
import { resolveUpstreams } from '../src/core/proxy.js';
import { chatCompletionsUrl } from '../src/core/messages-chat-bridge.js';
import { resolveGptProfile } from '../src/core/gpt-model-profiles.js';
import { isPxpipeSupportedModel } from '../src/core/applicability.js';
import { stripBracketedSegments, stripTrailingSlashes } from '../src/core/safe-string.js';

describe('linear-time string hardening', () => {
  it('removes trailing slashes without changing interior URL content', () => {
    expect(stripTrailingSlashes('https://example.test///')).toBe('https://example.test');
    expect(stripTrailingSlashes('https://example.test/a/b')).toBe('https://example.test/a/b');
    expect(stripTrailingSlashes('////')).toBe('');
  });

  it('strips complete bracketed transport tags and preserves unmatched brackets', () => {
    expect(stripBracketedSegments('gpt-5.6-sol[1m]')).toBe('gpt-5.6-sol');
    expect(stripBracketedSegments('model[a][b]-suffix')).toBe('model-suffix');
    expect(stripBracketedSegments('model[unfinished')).toBe('model[unfinished');
  });

  it('preserves upstream URL normalization semantics', () => {
    expect(resolveUpstreams({
      upstream: '  https://anthropic.example///  ',
      openAIUpstream: '  https://openai.example////  ',
    })).toEqual({
      anthropic: 'https://anthropic.example',
      openai: 'https://openai.example',
      stripOpenAIV1: false,
    });

    expect(resolveUpstreams({
      provider: 'cloudflare-ai-gateway',
      gatewayBaseUrl: '  https://gateway.example///  ',
    })).toEqual({
      anthropic: 'https://gateway.example/anthropic',
      openai: 'https://gateway.example/openai',
      stripOpenAIV1: true,
    });
  });

  it('preserves Chat Completions endpoint normalization', () => {
    expect(chatCompletionsUrl('https://example.test////')).toBe(
      'https://example.test/v1/chat/completions',
    );
    expect(chatCompletionsUrl('https://example.test/v1////')).toBe(
      'https://example.test/v1/chat/completions',
    );
  });

  it('keeps bracketed model variants equivalent to their base model', () => {
    expect(resolveGptProfile('gpt-5.6-sol[1m]')).toEqual(resolveGptProfile('gpt-5.6-sol'));
    expect(isPxpipeSupportedModel('claude-fable-5[1m]')).toBe(true);
  });

  it('extracts branch metadata without regex backtracking', () => {
    expect(extractEnvFields('noise\nOn branch feature/security extra')).toMatchObject({
      gitBranch: 'feature/security',
    });
    expect(extractEnvFields('noise\n  Branch: release/v5  ')).toMatchObject({
      gitBranch: 'release/v5',
    });
    expect(extractEnvFields('noise\nCurrent branch: hotfix/test\tignored')).toMatchObject({
      gitBranch: 'hotfix/test',
    });
  });

  it('handles long uncontrolled inputs with the same deterministic semantics', () => {
    const long = 'x'.repeat(100_000);
    expect(stripTrailingSlashes(long + '////').length).toBe(long.length);
    expect(stripBracketedSegments(long + '[variant]')).toBe(long);
    expect(extractEnvFields(long + '\nBranch: safe-branch')).toMatchObject({
      gitBranch: 'safe-branch',
    });
  });
});
