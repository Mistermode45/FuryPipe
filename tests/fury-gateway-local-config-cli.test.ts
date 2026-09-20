import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FURYPIPE_GATEWAY_DEFAULT_HOST,
  FURYPIPE_GATEWAY_DEFAULT_PORT,
  parseFuryPipeGatewayPort,
} from '../src/runtime-defaults.js';
import {
  FuryGatewayLocalConfigError,
  resolveFuryGatewayLocalConfig,
} from '../src/gateway-local-config-node.js';
import {
  FuryGatewayCliUsageError,
  furyGatewayCliHelp,
  parseFuryGatewayCliArgs,
  runFuryGatewayCli,
  type FuryGatewayLocalRuntime,
} from '../src/gateway-local-cli-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempConfig(root: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-gateway-config-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(root, null, 2) + '\n', 'utf8');
  return file;
}

function captureIo() {
  let out = '';
  let err = '';
  return {
    io: {
      stdout: { write: (value: string | Uint8Array): boolean => {
        out += String(value);
        return true;
      } },
      stderr: { write: (value: string | Uint8Array): boolean => {
        err += String(value);
        return true;
      } },
    },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

describe('Fury Gateway local config', () => {
  it('uses loopback-only defaults on the dedicated VNext port', () => {
    const file = tempConfig({
      locale: 'fr',
      setup: { completed: true },
    });
    const resolved = resolveFuryGatewayLocalConfig({
      file,
      env: {},
    });

    expect(resolved.config).toEqual({
      host: FURYPIPE_GATEWAY_DEFAULT_HOST,
      port: FURYPIPE_GATEWAY_DEFAULT_PORT,
      origin: 'http://127.0.0.1:48722',
      bootstrapTtlMs: 60_000,
      browserSessionTtlMs: 15 * 60_000,
      maxEventHistory: 512,
    });
    expect(resolved.sources.host).toBe('default');
    expect(resolved.sources.port).toBe('default');
    expect(resolved.sources.file).toBe(file);
  });

  it('loads a strict gateway block while preserving unrelated root config compatibility', () => {
    const file = tempConfig({
      locale: 'fr',
      setup: { completed: true },
      visualPolicy: 'auto',
      gateway: {
        host: 'localhost',
        port: 49123,
        bootstrapTtlMs: 45_000,
        browserSessionTtlMs: 120_000,
        maxEventHistory: 128,
      },
    });
    const resolved = resolveFuryGatewayLocalConfig({
      file,
      env: {},
    });

    expect(resolved.config).toEqual({
      host: 'localhost',
      port: 49123,
      origin: 'http://localhost:49123',
      bootstrapTtlMs: 45_000,
      browserSessionTtlMs: 120_000,
      maxEventHistory: 128,
    });
    expect(resolved.sources.host).toBe('file');
    expect(resolved.sources.port).toBe('file');
  });

  it('formats an IPv6 loopback Origin correctly', () => {
    const file = tempConfig({
      gateway: {
        host: '::1',
        port: 48722,
      },
    });
    const resolved = resolveFuryGatewayLocalConfig({ file, env: {} });

    expect(resolved.config.origin).toBe('http://[::1]:48722');
  });

  it('allows bounded environment overrides only for host and port', () => {
    const file = tempConfig({
      gateway: {
        host: 'localhost',
        port: 49000,
        bootstrapTtlMs: 30_000,
      },
    });
    const resolved = resolveFuryGatewayLocalConfig({
      file,
      env: {
        FURYPIPE_GATEWAY_HOST: '127.0.0.1',
        FURYPIPE_GATEWAY_PORT: '49999',
      },
    });

    expect(resolved.config.host).toBe('127.0.0.1');
    expect(resolved.config.port).toBe(49999);
    expect(resolved.config.bootstrapTtlMs).toBe(30_000);
    expect(resolved.sources.host).toBe('env');
    expect(resolved.sources.port).toBe('env');
  });

  it('rejects non-loopback bind attempts from file and environment', () => {
    const file = tempConfig({
      gateway: {
        host: '0.0.0.0',
      },
    });

    expect(() => resolveFuryGatewayLocalConfig({ file, env: {} }))
      .toThrowError(expect.objectContaining({
        name: 'FuryGatewayLocalConfigError',
        code: 'invalid-config',
      } satisfies Partial<FuryGatewayLocalConfigError>));

    const safe = tempConfig({ gateway: { host: '127.0.0.1' } });
    expect(() => resolveFuryGatewayLocalConfig({
      file: safe,
      env: { FURYPIPE_GATEWAY_HOST: '192.168.1.10' },
    })).toThrowError(expect.objectContaining({ code: 'invalid-config' }));
  });

  it('rejects unknown gateway fields instead of silently accepting drift', () => {
    const file = tempConfig({
      gateway: {
        host: '127.0.0.1',
        token: 'do-not-accept-hidden-auth-config',
      },
    });

    expect(() => resolveFuryGatewayLocalConfig({ file, env: {} }))
      .toThrowError(expect.objectContaining({ code: 'invalid-config' }));
  });

  it('rejects an oversized or non-regular config path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-gateway-dir-'));
    tempDirs.push(dir);

    expect(() => resolveFuryGatewayLocalConfig({
      file: dir,
      env: {},
    })).toThrowError(expect.objectContaining({ code: 'config-not-regular' }));

    const big = path.join(dir, 'large.json');
    fs.writeFileSync(big, Buffer.alloc(1024 * 1024 + 1, 0x20));
    expect(() => resolveFuryGatewayLocalConfig({
      file: big,
      env: {},
    })).toThrowError(expect.objectContaining({ code: 'config-too-large' }));
  });

  it('rejects invalid numeric bounds', () => {
    const file = tempConfig({
      gateway: {
        port: 0,
      },
    });
    expect(() => resolveFuryGatewayLocalConfig({ file, env: {} }))
      .toThrowError(expect.objectContaining({ code: 'invalid-config' }));

    expect(() => parseFuryPipeGatewayPort('65536')).toThrow(
      'FURYPIPE_GATEWAY_PORT must be an integer between 1 and 65535',
    );
  });

  it('uses FURYPIPE_CONFIG when no explicit file is provided', () => {
    const file = tempConfig({
      gateway: {
        port: 49001,
      },
    });
    const resolved = resolveFuryGatewayLocalConfig({
      env: {
        FURYPIPE_CONFIG: file,
      },
    });

    expect(resolved.sources.file).toBe(file);
    expect(resolved.config.port).toBe(49001);
  });
});

describe('Fury Gateway CLI parsing', () => {
  it('parses help, config and start without ambiguous options', () => {
    expect(parseFuryGatewayCliArgs([])).toEqual({ kind: 'help' });
    expect(parseFuryGatewayCliArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseFuryGatewayCliArgs(['config'])).toEqual({ kind: 'config', json: false });
    expect(parseFuryGatewayCliArgs(['config', '--json']))
      .toEqual({ kind: 'config', json: true });
    expect(parseFuryGatewayCliArgs(['start', '--json']))
      .toEqual({ kind: 'start', json: true });
  });

  it('rejects unknown commands, unknown options and duplicate --json', () => {
    expect(() => parseFuryGatewayCliArgs(['status']))
      .toThrowError(FuryGatewayCliUsageError);
    expect(() => parseFuryGatewayCliArgs(['start', '--remote']))
      .toThrowError(FuryGatewayCliUsageError);
    expect(() => parseFuryGatewayCliArgs(['config', '--json', '--json']))
      .toThrowError(FuryGatewayCliUsageError);
  });

  it('documents loopback-only start and dedicated Gateway variables', () => {
    const help = furyGatewayCliHelp();
    expect(help).toContain('furypipe gateway start');
    expect(help).toContain('FURYPIPE_GATEWAY_HOST');
    expect(help).toContain('FURYPIPE_GATEWAY_PORT');
    expect(help).toContain('FURYPIPE_WEBCHAT_MEMORY_CONFIG');
    expect(help).toContain('never treats localhost as authentication');
    expect(help).not.toContain('--remote');
  });
});

describe('Fury Gateway CLI execution', () => {
  it('renders resolved config without starting a runtime', async () => {
    const capture = captureIo();
    let starts = 0;
    const code = await runFuryGatewayCli(['config', '--json'], {
      io: capture.io,
      env: {},
      resolveConfig: () => ({
        config: {
          host: '127.0.0.1',
          port: 48722,
          origin: 'http://127.0.0.1:48722',
          bootstrapTtlMs: 60_000,
          browserSessionTtlMs: 900_000,
          maxEventHistory: 512,
        },
        sources: {
          file: 'test-config.json',
          host: 'default',
          port: 'default',
          bootstrapTtlMs: 'default',
          browserSessionTtlMs: 'default',
          maxEventHistory: 'default',
        },
      }),
      startRuntime: async () => {
        starts += 1;
        throw new Error('should not start');
      },
    });

    expect(code).toBe(0);
    expect(starts).toBe(0);
    expect(JSON.parse(capture.out)).toMatchObject({
      format: 'furypipe-gateway-local-config/v1',
      config: {
        host: '127.0.0.1',
        port: 48722,
      },
    });
    expect(capture.err).toBe('');
  });

  it('starts, prints one bootstrap ticket, waits, and stops exactly once', async () => {
    const capture = captureIo();
    let stopped = 0;
    let waited = 0;
    const runtime = {
      daemon: {
        address: {
          host: '127.0.0.1',
          port: 48722,
          url: 'ws://127.0.0.1:48722/gateway/v1',
        },
      },
      ticket: {
        format: 'furypipe-gateway-local-bootstrap/v1',
        code: 'A'.repeat(43),
        expiresAt: 200_000,
        authority: 'bootstrap-ticket',
        executionAuthority: false,
      },
      model: {
        format: 'furypipe-gateway-local-model-config/v1',
        enabled: false,
      },
      tools: {
        format: 'furypipe-gateway-local-tool-config/v1',
        enabled: false,
      },
      memory: {
        format: 'furypipe-gateway-local-memory-config/v1',
        enabled: false,
      },
      config: {
        config: {
          host: '127.0.0.1',
          port: 48722,
          origin: 'http://127.0.0.1:48722',
          bootstrapTtlMs: 60_000,
          browserSessionTtlMs: 900_000,
          maxEventHistory: 512,
        },
        sources: {
          file: 'test-config.json',
          host: 'default',
          port: 'default',
          bootstrapTtlMs: 'default',
          browserSessionTtlMs: 'default',
          maxEventHistory: 'default',
        },
      },
      async stop() {
        stopped += 1;
      },
    } as unknown as FuryGatewayLocalRuntime;

    const code = await runFuryGatewayCli(['start', '--json'], {
      io: capture.io,
      env: {},
      startRuntime: async () => runtime,
      waitForShutdown: async () => {
        waited += 1;
      },
    });

    expect(code).toBe(0);
    expect(waited).toBe(1);
    expect(stopped).toBe(1);
    expect(capture.err).toBe('');
    const payload = JSON.parse(capture.out) as Record<string, unknown>;
    expect(payload).toMatchObject({
      format: 'furypipe-gateway-local-start/v1',
      status: 'ready',
      websocketUrl: 'ws://127.0.0.1:48722/gateway/v1',
      webChatUrl: 'http://127.0.0.1:48722/gateway/webchat/',
      origin: 'http://127.0.0.1:48722',
      model: {
        format: 'furypipe-gateway-local-model-config/v1',
        enabled: false,
      },
      tools: {
        format: 'furypipe-gateway-local-tool-config/v1',
        enabled: false,
      },
      memory: {
        format: 'furypipe-gateway-local-memory-config/v1',
        enabled: false,
      },
      authority: 'bootstrap-only',
      executionAuthority: false,
    });
    expect(JSON.stringify(payload)).toContain('A'.repeat(43));
  });

  it('returns usage status without starting on unknown Gateway commands', async () => {
    const capture = captureIo();
    let starts = 0;
    const code = await runFuryGatewayCli(['status'], {
      io: capture.io,
      startRuntime: async () => {
        starts += 1;
        throw new Error('should not start');
      },
    });

    expect(code).toBe(2);
    expect(starts).toBe(0);
    expect(capture.err).toContain('unknown gateway command: status');
    expect(capture.err).toContain('furypipe gateway --help');
  });

  it('fails closed when runtime startup fails', async () => {
    const capture = captureIo();
    const code = await runFuryGatewayCli(['start'], {
      io: capture.io,
      startRuntime: async () => {
        throw new Error('EADDRINUSE');
      },
    });

    expect(code).toBe(1);
    expect(capture.out).toBe('');
    expect(capture.err).toContain('[furypipe gateway] start: EADDRINUSE');
  });
});
