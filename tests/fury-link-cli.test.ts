import { describe, expect, it } from 'vitest';
import {
  FuryLinkUsageError,
  furyLinkHelp,
  parseFuryLinkInvocation,
} from '../src/fury-link-cli.js';

describe('FuryLink CLI', () => {
  it('accepts the Windows-friendly separator-free form', () => {
    expect(parseFuryLinkInvocation(['codex'])).toEqual({
      routes: [],
      command: ['codex'],
    });
    expect(parseFuryLinkInvocation(['cursor-agent', '--profile', 'work'])).toEqual({
      routes: [],
      command: ['cursor-agent', '--profile', 'work'],
    });
  });

  it('keeps the explicit separator form for complex commands', () => {
    expect(parseFuryLinkInvocation(['--', 'codex', '--model', 'gpt-5.6-sol'])).toEqual({
      routes: [],
      command: ['codex', '--model', 'gpt-5.6-sol'],
    });
  });

  it('parses routes before the command and never consumes command arguments', () => {
    expect(parseFuryLinkInvocation([
      '--route',
      'localhost:9090/v1/*=http://127.0.0.1:48721',
      '--route=example.test/*=http://127.0.0.1:48721',
      'codex',
      '--dangerously-bypass-approvals-and-sandbox',
    ])).toEqual({
      routes: [
        'localhost:9090/v1/*=http://127.0.0.1:48721',
        'example.test/*=http://127.0.0.1:48721',
      ],
      command: ['codex', '--dangerously-bypass-approvals-and-sandbox'],
    });
  });

  it('rejects malformed FuryLink options', () => {
    expect(() => parseFuryLinkInvocation(['--route'])).toThrow(FuryLinkUsageError);
    expect(() => parseFuryLinkInvocation(['--route='])).toThrow(/PATTERN=TARGET/);
    expect(() => parseFuryLinkInvocation(['--wat'])).toThrow(/unknown FuryLink option/);
  });

  it('publishes FuryLink—not warp—as the user-facing help', () => {
    const help = furyLinkHelp();
    expect(help).toContain('FuryLink');
    expect(help).toContain('furypipe link codex');
    expect(help).not.toContain('furypipe warp');
  });
});
