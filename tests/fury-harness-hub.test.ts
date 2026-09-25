import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FURY_HARNESS_REGISTRY,
  discoverFuryHarnesses,
  resolveFuryExecutable,
  type FuryVersionRunner,
} from '../src/fury-harness-hub.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function binDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'furypipe-harness-'));
  dirs.push(dir);
  return dir;
}

describe('Harness Hub', () => {
  it('registers the priority harnesses with an integration path and a local-model mechanism', () => {
    const ids = FURY_HARNESS_REGISTRY.map((h) => h.id);
    for (const id of ['furypipe-native', 'claude-code', 'codex', 'gemini-cli', 'opencode', 'openclaw', 'openhands', 'goose', 'kilo']) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of FURY_HARNESS_REGISTRY) {
      expect(h.integrations.length).toBeGreaterThan(0);
      if (h.evidence === 'OFFICIAL_FACT' || h.evidence === 'COMMUNITY') expect(h.source).toMatch(/^https:\/\//u);
    }
  });

  it('reports missing harnesses as not installed without running anything', async () => {
    let calls = 0;
    const runner: FuryVersionRunner = async () => {
      calls += 1;
      return { stdout: '', stderr: '' };
    };
    const result = await discoverFuryHarnesses({ env: { PATH: binDir() }, platform: 'linux', runner });
    expect(calls).toBe(0);
    expect(result.harnesses.find((h) => h.id === 'claude-code')).toMatchObject({ installed: false, versionStatus: 'not-installed', authentication: 'not-probed' });
    expect(result.harnesses.find((h) => h.id === 'furypipe-native')).toMatchObject({ installed: true, versionStatus: 'builtin' });
  });

  it.skipIf(process.platform === 'win32')('executes the real binary with --version, no shell and a minimal environment', async () => {
    const dir = binDir();
    const marker = join(dir, 'env.txt');
    const script = join(dir, 'codex');
    writeFileSync(script, `#!/bin/sh\n/usr/bin/env > "${marker}"\necho "codex-cli 0.77.1"\n`);
    chmodSync(script, 0o755);
    const result = await discoverFuryHarnesses({ env: { PATH: dir, OPENAI_API_KEY: 'sk-never-forwarded', HOME: dir }, platform: 'linux' });
    const codex = result.harnesses.find((h) => h.id === 'codex')!;
    expect(codex).toMatchObject({ installed: true, version: '0.77.1', versionStatus: 'ok', executable: script });
    const { readFileSync } = await import('node:fs');
    const seenEnv = readFileSync(marker, 'utf8');
    expect(seenEnv).not.toContain('sk-never-forwarded');
    expect(seenEnv).toContain('NO_COLOR=1');
  });

  it.skipIf(process.platform === 'win32')('ignores relative PATH entries and non-executable files', () => {
    const dir = binDir();
    writeFileSync(join(dir, 'gemini'), 'not executable');
    chmodSync(join(dir, 'gemini'), 0o644);
    expect(resolveFuryExecutable('gemini', { PATH: dir }, 'linux')).toBeUndefined();
    expect(resolveFuryExecutable('gemini', { PATH: `.${':'}relative` }, 'linux')).toBeUndefined();
    expect(resolveFuryExecutable('../evil', { PATH: dir }, 'linux')).toBeUndefined();
  });

  it('routes Windows .cmd shims through the hardened cmd.exe boundary', async () => {
    const dir = binDir();
    writeFileSync(join(dir, 'opencode.cmd'), '@echo off');
    const seen: { file: string; args: readonly string[]; verbatim?: boolean }[] = [];
    const runner: FuryVersionRunner = async (file, args, options) => {
      seen.push({ file, args, verbatim: options.windowsVerbatimArguments });
      return { stdout: 'opencode 1.2.3', stderr: '' };
    };
    const result = await discoverFuryHarnesses({
      env: { PATH: dir, PATHEXT: '.cmd', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      platform: 'win32',
      runner,
      registry: FURY_HARNESS_REGISTRY.filter((h) => h.id === 'opencode'),
    });
    expect(result.harnesses[0]).toMatchObject({ installed: true, version: '1.2.3' });
    expect(seen[0]?.file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(seen[0]?.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(seen[0]?.verbatim).toBe(true);
  });

  it('classifies timeouts and unparseable output without throwing', async () => {
    const dir = binDir();
    writeFileSync(join(dir, 'goose'), '');
    chmodSync(join(dir, 'goose'), 0o755);
    writeFileSync(join(dir, 'openhands'), '');
    chmodSync(join(dir, 'openhands'), 0o755);
    const runner: FuryVersionRunner = async (file) => {
      if (file.endsWith('goose')) throw Object.assign(new Error('timeout'), { killed: true });
      return { stdout: 'no version here', stderr: '' };
    };
    const result = await discoverFuryHarnesses({ env: { PATH: dir }, platform: 'linux', runner });
    expect(result.harnesses.find((h) => h.id === 'goose')?.versionStatus).toBe('timeout');
    expect(result.harnesses.find((h) => h.id === 'openhands')?.versionStatus).toBe('failed');
  });
});
