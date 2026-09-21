import { describe, expect, it, vi } from 'vitest';

import {
  createCodingSandbox,
} from '../src/coding-runtime.js';
import {
  FuryAcpExternalClientError,
  createFuryAcpExternalAgentRegistry,
  createFuryAcpExternalClientRuntime,
  isGeneratedFuryAcpExternalAgentDescriptor,
  isGeneratedFuryAcpExternalAgentRegistry,
  isGeneratedFuryAcpExternalSession,
} from '../src/acp-external-client-runtime-node.js';

function fixtureScript(agentName = 'fixture-external-agent'): string {
  return [
    "const acp = await import('@agentclientprotocol/sdk');",
    "const { Readable, Writable } = await import('node:stream');",
    `const app = acp.agent({ name: ${JSON.stringify(agentName)} })`,
    "  .onRequest(acp.methods.agent.initialize, () => ({",
    "    protocolVersion: acp.PROTOCOL_VERSION,",
    "    agentCapabilities: { loadSession: false, promptCapabilities: {} },",
    "    authMethods: [],",
    `    agentInfo: { name: ${JSON.stringify(agentName)}, version: '1.0.0' },`,
    "  }))",
    "  .onRequest(acp.methods.agent.session.new, () => ({",
    "    sessionId: 'fixture-session',",
    "  }));",
    "const connection = app.connect(acp.ndJsonStream(",
    "  Writable.toWeb(process.stdout),",
    "  Readable.toWeb(process.stdin),",
    "));",
    "await connection.closed;",
  ].join('\n');
}

async function sandbox(allowedCommands: readonly string[] = ['node']) {
  return await createCodingSandbox({
    policyId: 'acp-external-agent-test',
    rootPath: process.cwd(),
    readRoots: ['.'],
    writeRoots: ['.'],
    environmentAllowlist: [
      'PATH',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'NODE_ENV',
      'EXTERNAL_TEST_SECRET',
    ],
    allowedCommands,
    maxOutputBytes: 128 * 1024,
    maxProcesses: 2,
    maxTimeoutMs: 15_000,
  });
}

function registry(
  expectedAgentName = 'fixture-external-agent',
  environment?: Readonly<Record<string, string>>,
) {
  return createFuryAcpExternalAgentRegistry([{
    agentId: 'fixture',
    command: 'node',
    args: [
      '--input-type=module',
      '-e',
      fixtureScript(),
    ],
    cwd: '.',
    ...(environment === undefined ? {} : { environment }),
    expectedAgentName,
    startupTimeoutMs: 10_000,
  }]);
}

describe('FuryPipe ACP Gate 8.7 external client foundation', () => {
  it('keeps configured registry evidence bounded, non-authoritative, and non-executing', async () => {
    const configured = registry('fixture-external-agent', {
      EXTERNAL_TEST_SECRET: 'never-observe-me',
    });
    const descriptor = configured.resolve('fixture');
    expect(isGeneratedFuryAcpExternalAgentRegistry(configured)).toBe(true);
    expect(isGeneratedFuryAcpExternalAgentDescriptor(descriptor)).toBe(true);
    expect(configured.list()).toEqual([descriptor]);
    expect(descriptor).toMatchObject({
      agentId: 'fixture',
      protocolVersion: 1,
      authority: 'configured-agent-evidence-only',
      executionAuthority: false,
      delegationAuthority: false,
    });
    expect(JSON.stringify(descriptor)).not.toContain('never-observe-me');
    expect(JSON.stringify(descriptor)).not.toContain(fixtureScript());

    const runtime = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(),
    });
    expect(runtime.activeSessionCount()).toBe(0);
    expect('prompt' in runtime).toBe(false);
    expect('delegate' in runtime).toBe(false);
    expect(runtime).toMatchObject({
      authority: 'explicit-connect-only',
      executionAuthority: false,
      delegationAuthority: false,
    });
  });

  it('spawns a configured ACP agent, negotiates v1, opens a bounded session, and closes it', async () => {
    const configured = registry();
    const descriptor = configured.resolve('fixture');
    if (!descriptor) throw new Error('fixture descriptor missing');
    const runtime = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(),
    });

    const session = await runtime.openSession(descriptor);
    expect(isGeneratedFuryAcpExternalSession(session)).toBe(true);
    expect(runtime.activeSessionCount()).toBe(1);
    expect(session).toMatchObject({
      agentId: 'fixture',
      protocolVersion: 1,
      authority: 'external-session-handle-only',
      executionAuthority: false,
      delegationAuthority: false,
    });

    const snapshot = runtime.inspectSession(session);
    expect(snapshot).toMatchObject({
      agentId: 'fixture',
      protocolVersion: 1,
      state: 'ready',
      automaticReplayAllowed: false,
      authority: 'external-session-evidence-only',
      executionAuthority: false,
      delegationAuthority: false,
    });
    expect(snapshot.acpSessionIdSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.agentCapabilitiesSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.reportedAgentNameSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(snapshot)).not.toContain('fixture-session');

    const closed = await runtime.closeSession(session);
    expect(closed.state).toBe('closed');
    expect(runtime.activeSessionCount()).toBe(0);
  });

  it('rejects copied descriptors and copied session handles', async () => {
    const configured = registry();
    const descriptor = configured.resolve('fixture');
    if (!descriptor) throw new Error('fixture descriptor missing');
    const runtime = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(),
    });

    await expect(runtime.openSession({ ...descriptor })).rejects.toMatchObject({
      code: 'invalid-agent',
    });

    const session = await runtime.openSession(descriptor);
    expect(() => runtime.inspectSession({ ...session })).toThrowError(
      FuryAcpExternalClientError,
    );
    await runtime.closeSession(session);
  });

  it('revalidates the configured command against the current Phase 6 sandbox', async () => {
    const configured = registry();
    const descriptor = configured.resolve('fixture');
    if (!descriptor) throw new Error('fixture descriptor missing');
    const runtime = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(['git']),
    });

    await expect(runtime.openSession(descriptor)).rejects.toMatchObject({
      code: 'policy-denied',
    });
    expect(runtime.activeSessionCount()).toBe(0);
  });

  it('fails closed when the external agent reports an unexpected implementation identity', async () => {
    const configured = registry('different-agent');
    const descriptor = configured.resolve('fixture');
    if (!descriptor) throw new Error('fixture descriptor missing');
    const runtime = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(),
    });

    await expect(runtime.openSession(descriptor)).rejects.toMatchObject({
      code: 'identity-mismatch',
    });
    expect(runtime.activeSessionCount()).toBe(0);
  });

  it('enforces a bounded concurrent external-session process limit', async () => {
    const configured = registry();
    const descriptor = configured.resolve('fixture');
    if (!descriptor) throw new Error('fixture descriptor missing');
    const runtime = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(),
      maxSessions: 1,
    });

    const session = await runtime.openSession(descriptor);
    await expect(runtime.openSession(descriptor)).rejects.toMatchObject({
      code: 'process-limit',
    });
    await runtime.closeSession(session);
    expect(runtime.activeSessionCount()).toBe(0);
  });

  it('does not let a fresh runtime revive a previous process-local session handle', async () => {
    const configured = registry();
    const descriptor = configured.resolve('fixture');
    if (!descriptor) throw new Error('fixture descriptor missing');
    const first = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(),
    });
    const session = await first.openSession(descriptor);
    const second = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(),
    });

    expect(() => second.inspectSession(session)).toThrowError(
      FuryAcpExternalClientError,
    );
    await first.closeSession(session);
  });

  it('rejects malformed registry entries before any process can be started', () => {
    expect(() => createFuryAcpExternalAgentRegistry([{
      agentId: 'bad',
      command: 'node;rm',
      args: [],
      cwd: '.',
    }])).toThrowError(FuryAcpExternalClientError);

    expect(() => createFuryAcpExternalAgentRegistry([
      {
        agentId: 'duplicate',
        command: 'node',
        cwd: '.',
      },
      {
        agentId: 'duplicate',
        command: 'node',
        cwd: '.',
      },
    ])).toThrow(/unique/i);

    expect(() => createFuryAcpExternalAgentRegistry([{
      agentId: 'unsupported',
      command: 'node',
      cwd: '.',
      unsupported: true,
    } as never])).toThrow(/unsupported fields/i);

    const hiddenEnvironment: Record<string, string> = {};
    Object.defineProperty(hiddenEnvironment, 'HIDDEN_SECRET', {
      enumerable: false,
      value: 'must-not-be-accepted',
    });
    expect(() => createFuryAcpExternalAgentRegistry([{
      agentId: 'hidden-env',
      command: 'node',
      cwd: '.',
      environment: hiddenEnvironment,
    }])).toThrow(/environment name/i);
  });

  it('fails closed when an external agent negotiates a non-v1 protocol', async () => {
    const wrongVersionScript = [
      "const acp = await import('@agentclientprotocol/sdk');",
      "const { Readable, Writable } = await import('node:stream');",
      "const app = acp.agent({ name: 'wrong-version-agent' })",
      "  .onRequest(acp.methods.agent.initialize, () => ({",
      "    protocolVersion: 2,",
      "    agentCapabilities: { loadSession: false, promptCapabilities: {} },",
      "    authMethods: [],",
      "    agentInfo: { name: 'wrong-version-agent', version: '1.0.0' },",
      "  }))",
      "  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'wrong-version-session' }));",
      "const connection = app.connect(acp.ndJsonStream(",
      "  Writable.toWeb(process.stdout),",
      "  Readable.toWeb(process.stdin),",
      "));",
      "await connection.closed;",
    ].join('\n');
    const configured = createFuryAcpExternalAgentRegistry([{
      agentId: 'wrong-version',
      command: 'node',
      args: ['--input-type=module', '-e', wrongVersionScript],
      cwd: '.',
      expectedAgentName: 'wrong-version-agent',
      startupTimeoutMs: 10_000,
    }]);
    const descriptor = configured.resolve('wrong-version');
    if (!descriptor) throw new Error('wrong-version descriptor missing');
    const runtime = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(),
    });

    await expect(runtime.openSession(descriptor)).rejects.toMatchObject({
      code: 'protocol-mismatch',
    });
    expect(runtime.activeSessionCount()).toBe(0);
  });

  it('marks unexpected process loss as disconnected rather than successful', async () => {
    const shortLivedScript = [
      "const acp = await import('@agentclientprotocol/sdk');",
      "const { Readable, Writable } = await import('node:stream');",
      "const app = acp.agent({ name: 'short-lived-agent' })",
      "  .onRequest(acp.methods.agent.initialize, () => ({",
      "    protocolVersion: acp.PROTOCOL_VERSION,",
      "    agentCapabilities: { loadSession: false, promptCapabilities: {} },",
      "    authMethods: [],",
      "    agentInfo: { name: 'short-lived-agent', version: '1.0.0' },",
      "  }))",
      "  .onRequest(acp.methods.agent.session.new, () => {",
      "    setTimeout(() => process.exit(0), 100);",
      "    return { sessionId: 'short-lived-session' };",
      "  });",
      "const connection = app.connect(acp.ndJsonStream(",
      "  Writable.toWeb(process.stdout),",
      "  Readable.toWeb(process.stdin),",
      "));",
      "await connection.closed;",
    ].join('\n');
    const configured = createFuryAcpExternalAgentRegistry([{
      agentId: 'short-lived',
      command: 'node',
      args: ['--input-type=module', '-e', shortLivedScript],
      cwd: '.',
      expectedAgentName: 'short-lived-agent',
      startupTimeoutMs: 10_000,
    }]);
    const descriptor = configured.resolve('short-lived');
    if (!descriptor) throw new Error('short-lived descriptor missing');
    const runtime = createFuryAcpExternalClientRuntime({
      registry: configured,
      sandbox: await sandbox(),
    });

    const session = await runtime.openSession(descriptor);
    await vi.waitFor(() => {
      expect(runtime.inspectSession(session).state).toBe('disconnected');
    }, { timeout: 5_000 });
    expect(runtime.inspectSession(session).automaticReplayAllowed).toBe(false);
    expect(runtime.activeSessionCount()).toBe(0);
  });
});
