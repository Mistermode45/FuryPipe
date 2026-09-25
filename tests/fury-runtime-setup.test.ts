import { describe, expect, it } from 'vitest';
import { installFuryLocalRuntime } from '../src/fury-runtime-setup.js';

describe('Fury local runtime setup', () => {
  it('uses a fixed winget package id and no user supplied command', async () => {
    const calls: Array<{ executable:string; args:readonly string[] }> = [];
    const result = await installFuryLocalRuntime('ollama', {
      platform: 'win32',
      runner: async (executable, args) => {
        calls.push({ executable, args });
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });
    expect(result.status).toBe('installed');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.executable).toBe('winget');
    expect(calls[0]?.args).toContain('Ollama.Ollama');
    expect(calls[0]?.args).toContain('--disable-interactivity');
  });

  it('uses the verified LM Studio winget package id', async () => {
    let args: readonly string[] = [];
    await installFuryLocalRuntime('lmstudio', {
      platform: 'win32',
      runner: async (_executable, nextArgs) => {
        args = nextArgs;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    expect(args).toContain('ElementLabs.LMStudio');
  });

  it('does not execute package installation on unsupported platforms', async () => {
    let called = false;
    const result = await installFuryLocalRuntime('ollama', {
      platform: 'linux',
      runner: async () => {
        called = true;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    expect(result.status).toBe('unsupported');
    expect(called).toBe(false);
  });

  it('surfaces package-manager failures', async () => {
    await expect(installFuryLocalRuntime('ollama', {
      platform: 'win32',
      runner: async () => ({ exitCode: 1, stdout: '', stderr: 'package failed' }),
    })).rejects.toThrow(/package failed/u);
  });
});
