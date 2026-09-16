import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FuryLinkUsageError,
  furyLinkHelp,
  parseFuryLinkInvocation,
} from '../src/fury-link-cli.js';
import {
  furyLinkEnvValue,
  furyLinkPathCandidates,
  furyLinkWindowsLaunchPlan,
} from '../src/fury-link/index.js';

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

  it('preserves Windows Path/PATHEXT discovery after process.env is cloned', () => {
    const copiedWindowsEnv = {
      Path: 'C:\\Program Files\\nodejs;C:\\Users\\runner\\AppData\\Roaming\\npm',
      Pathext: '.COM;.EXE;.BAT;.CMD',
    } as NodeJS.ProcessEnv;

    expect(furyLinkEnvValue(copiedWindowsEnv, 'PATH')).toBe(copiedWindowsEnv.Path);
    expect(furyLinkEnvValue(copiedWindowsEnv, 'PATHEXT')).toBe(copiedWindowsEnv.Pathext);
    expect(furyLinkPathCandidates('npm', copiedWindowsEnv, 'win32')).toEqual([
      'npm.COM',
      'npm.EXE',
      'npm.BAT',
      'npm.CMD',
    ]);
    expect(furyLinkPathCandidates('npm.cmd', copiedWindowsEnv, 'win32')).toEqual(['npm.cmd']);
    expect(furyLinkPathCandidates('npm', copiedWindowsEnv, 'linux')).toEqual(['npm']);
  });

  it('routes Windows batch launchers through an explicit hardened cmd boundary', () => {
    const env = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } as NodeJS.ProcessEnv;
    const args = ['--profile', 'révision sûre'];
    const plan = furyLinkWindowsLaunchPlan('C:\\Program Files\\nodejs\\npm.cmd', args, env);

    expect(plan).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', '""C:\\Program Files\\nodejs\\npm.cmd" "--profile" "révision sûre""'],
      usesCommandInterpreter: true,
      windowsVerbatimArguments: true,
    });
    // The boundary retains argv values instead of interpolating a `shell: true`
    // command string. This is also what preserves ordinary Unicode arguments.
    expect(plan.args).toHaveLength(5);
  });

  it('keeps native Windows executables direct and rejects command-line controls', () => {
    expect(furyLinkWindowsLaunchPlan('C:\\Tools\\agent.exe', ['--version'], {})).toEqual({
      file: 'C:\\Tools\\agent.exe',
      args: ['--version'],
      usesCommandInterpreter: false,
      windowsVerbatimArguments: false,
    });
    expect(() => furyLinkWindowsLaunchPlan('C:\\Tools\\agent.cmd', ['bad\nvalue'], {}))
      .toThrow('NUL or a line break');
  });

  it.runIf(process.platform === 'win32')('runs a spaced batch path with a Unicode argument and rejects batch metacharacters', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'furypipe-link-argv-'));
    const batch = join(fixtureDir, 'capture argv.cmd');
    const capture = join(fixtureDir, 'capture.mjs');
    const unicode = 'révision sûre';
    try {
      writeFileSync(capture, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n', 'utf8');
      writeFileSync(
        batch,
        `@echo off\r\n"${process.execPath}" "%~dp0capture.mjs" %*\r\n`,
        'utf8',
      );
      const plan = furyLinkWindowsLaunchPlan(batch, [unicode], { ComSpec: process.env.ComSpec ?? 'cmd.exe' });
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(plan.file, plan.args, {
          shell: false,
          windowsHide: true,
          windowsVerbatimArguments: plan.windowsVerbatimArguments,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code, stdout, stderr }));
      });

      expect(result).toEqual({ code: 0, stdout: JSON.stringify([unicode]), stderr: '' });
      for (const unsafe of ['"', '&', '|', '(', ')', '^', '%', '!']) {
        expect(() => furyLinkWindowsLaunchPlan(batch, [`value${unsafe}value`], {}))
          .toThrow('shell-significant values');
      }
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('publishes FuryLink—not warp—as the user-facing help', () => {
    const help = furyLinkHelp();
    expect(help).toContain('FuryLink');
    expect(help).toContain('furypipe link codex');
    expect(help).not.toContain('furypipe warp');
  });
});
