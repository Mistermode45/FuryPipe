import { describe, expect, it } from 'vitest';
import { parseAgentLaunchArgs } from '../src/warp/cli.js';

describe('FuryPipe agent launcher CLI', () => {
  it('accepts the native no-separator syntax', () => {
    expect(parseAgentLaunchArgs(['codex', '--model', 'gpt-5.6-sol'])).toEqual({
      routes: [],
      command: ['codex', '--model', 'gpt-5.6-sol'],
    });
  });

  it('accepts the explicit separator syntax used by older releases', () => {
    expect(parseAgentLaunchArgs(['--', 'codex'])).toEqual({
      routes: [],
      command: ['codex'],
    });
  });

  it('parses routes before the command and preserves command flags', () => {
    expect(parseAgentLaunchArgs([
      '--route',
      'api.openai.com/v1/responses*=http://127.0.0.1:48721',
      'codex',
      '--full-auto',
    ])).toEqual({
      routes: ['api.openai.com/v1/responses*=http://127.0.0.1:48721'],
      command: ['codex', '--full-auto'],
    });
  });

  it('fails closed on malformed launcher options', () => {
    expect(() => parseAgentLaunchArgs(['--route'])).toThrow(/needs PATTERN=TARGET/);
    expect(() => parseAgentLaunchArgs(['--unknown', 'codex'])).toThrow(/unknown launcher option/);
  });
});
