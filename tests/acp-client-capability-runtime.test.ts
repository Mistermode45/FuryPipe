import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as acp from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createCodingSandbox,
} from '../src/coding-runtime.js';
import {
  createFuryGatewayConversationAdapter,
} from '../src/gateway-conversation-adapter-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewayScope,
} from '../src/gateway-session-node.js';
import { createFuryKernelConversationStore } from '../src/fury-kernel.js';
import {
  createFuryAcpGatewaySessionBridge,
} from '../src/acp-gateway-session-bridge-node.js';
import {
  FuryAcpPermissionBridgeError,
  createFuryAcpPermissionBridge,
  type FuryAcpPermissionPermit,
} from '../src/acp-permission-bridge-node.js';
import {
  createFuryAcpClientCapabilityRuntime,
  FuryAcpClientCapabilityError,
  type FuryAcpClientCapabilityRuntime,
  type FuryAcpClientOperationPlan,
} from '../src/acp-client-capability-runtime-node.js';
import {
  FuryAcpV1ClientTransportError,
} from '../src/acp-client-transport-node.js';
import {
  createFuryAcpV1Server,
  type FuryAcpV1PromptContext,
  type FuryAcpV1SessionSnapshot,
} from '../src/acp-v1-server-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return fs.realpathSync(dir);
}

async function harness(
  scopes: readonly FuryGatewayScope[] = [
    'conversations.write',
    'capability.repository-read',
    'capability.repository-write',
    'capability.process',
  ],
) {
  let now = 100_000;
  const rootInput = tempRoot('furypipe-acp-client-runtime-');
  const principals = createFuryGatewayPrincipalRegistry({ now: () => now });
  const principal = principals.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:acp-client-runtime',
    kind: 'human',
    issuer: 'local',
    subject: 'acp-client-runtime-user',
    authenticationMethod: 'local-owner',
  });
  const sessions = createFuryGatewaySessionCoordinator({
    principalRegistry: principals,
    gatewayInstanceId: 'gateway-acp-client-runtime',
    now: () => now,
  });
  const gatewaySession = sessions.issueSession({
    principal,
    role: 'operator',
    scopes,
    binding: { kind: 'local-operator' },
  });
  const recovery = createRecoveryStore(
    tempRoot('furypipe-acp-client-runtime-recovery-'),
    {
      namespace: 'acp_client_runtime',
      maxObjectBytes: 64 * 1024,
      maxTotalBytes: 8 * 1024 * 1024,
    },
  );
  const kernel = createFuryKernelConversationStore({ now: () => now });
  const conversations = createFuryGatewayConversationAdapter({ kernel });
  const bridge = createFuryAcpGatewaySessionBridge({
    recovery,
    gatewaySessionCoordinator: sessions,
    gatewaySession,
    conversationAdapter: conversations,
    now: () => now,
  });
  const permissions = createFuryAcpPermissionBridge({
    bridge,
    gatewaySessionCoordinator: sessions,
    gatewaySession,
    now: () => now,
  });
  const sandbox = await createCodingSandbox({
    policyId: 'acp-client-runtime-test',
    rootPath: rootInput,
    readRoots: ['.'],
    writeRoots: ['.'],
    environmentAllowlist: ['SAFE_VALUE'],
    allowedCommands: ['node'],
    maxFileBytes: 1024 * 1024,
    maxOutputBytes: 64 * 1024,
    maxProcesses: 1,
    maxTimeoutMs: 2_000,
  });
  const root = sandbox.rootPath;
  const runtime = createFuryAcpClientCapabilityRuntime({
    sandbox,
    permissionBridge: permissions,
    now: () => now,
  });
  return {
    root,
    sessions,
    bridge,
    permissions,
    sandbox,
    runtime,
    get now() { return now; },
    set now(value: number) { now = value; },
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

interface ClientBehavior {
  readonly capabilities?: acp.ClientCapabilities;
  readonly read?: (
    params: acp.ReadTextFileRequest,
  ) => Promise<acp.ReadTextFileResponse> | acp.ReadTextFileResponse;
  readonly write?: (
    params: acp.WriteTextFileRequest,
  ) => Promise<acp.WriteTextFileResponse> | acp.WriteTextFileResponse;
  readonly terminalCreate?: (
    params: acp.CreateTerminalRequest,
  ) => Promise<acp.CreateTerminalResponse> | acp.CreateTerminalResponse;
  readonly terminalWait?: (
    params: acp.WaitForTerminalExitRequest,
  ) => Promise<acp.WaitForTerminalExitResponse> | acp.WaitForTerminalExitResponse;
  readonly terminalOutput?: (
    params: acp.TerminalOutputRequest,
  ) => Promise<acp.TerminalOutputResponse> | acp.TerminalOutputResponse;
  readonly terminalKill?: (
    params: acp.KillTerminalRequest,
  ) => Promise<acp.KillTerminalResponse> | acp.KillTerminalResponse;
  readonly terminalRelease?: (
    params: acp.ReleaseTerminalRequest,
  ) => Promise<acp.ReleaseTerminalResponse> | acp.ReleaseTerminalResponse;
}

async function runPrompt<T>(
  h: Harness,
  behavior: ClientBehavior,
  promptHandler: (
    context: FuryAcpV1PromptContext,
  ) => Promise<{ stopReason: acp.StopReason; value: T }>,
): Promise<T> {
  let value: T | undefined;
  const server = createFuryAcpV1Server({
    now: () => h.now,
    sessionHooks: h.bridge.sessionHooks,
    promptHandler: async (context) => {
      const result = await promptHandler(context);
      value = result.value;
      return { stopReason: result.stopReason };
    },
  });

  const client = acp
    .client({ name: 'acp-client-runtime-test' })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
      const allow = ctx.params.options.find(
        (option) => option.kind === 'allow_once',
      );
      if (!allow) throw new Error('allow_once missing');
      return {
        outcome: {
          outcome: 'selected' as const,
          optionId: allow.optionId,
        },
      };
    })
    .onRequest(acp.methods.client.fs.readTextFile, async (ctx) => {
      if (behavior.read) return await behavior.read(ctx.params);
      return { content: fs.readFileSync(ctx.params.path, 'utf8') };
    })
    .onRequest(acp.methods.client.fs.writeTextFile, async (ctx) => {
      if (behavior.write) return await behavior.write(ctx.params);
      fs.writeFileSync(ctx.params.path, ctx.params.content, 'utf8');
      return {};
    })
    .onRequest(acp.methods.client.terminal.create, async (ctx) => {
      if (behavior.terminalCreate) return await behavior.terminalCreate(ctx.params);
      return { terminalId: 'terminal_test_1' };
    })
    .onRequest(acp.methods.client.terminal.waitForExit, async (ctx) => {
      if (behavior.terminalWait) return await behavior.terminalWait(ctx.params);
      return { exitCode: 0 };
    })
    .onRequest(acp.methods.client.terminal.output, async (ctx) => {
      if (behavior.terminalOutput) return await behavior.terminalOutput(ctx.params);
      return {
        output: 'terminal output',
        truncated: false,
        exitStatus: { exitCode: 0 },
      };
    })
    .onRequest(acp.methods.client.terminal.kill, async (ctx) => {
      if (behavior.terminalKill) return await behavior.terminalKill(ctx.params);
      return {};
    })
    .onRequest(acp.methods.client.terminal.release, async (ctx) => {
      if (behavior.terminalRelease) return await behavior.terminalRelease(ctx.params);
      return {};
    });

  await client.connectWith(server.app, async (agent) => {
    await agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: behavior.capabilities ?? {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    const session = await agent.request(acp.methods.agent.session.new, {
      cwd: h.root,
      mcpServers: [],
    });
    await agent.request(acp.methods.agent.session.prompt, {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'run governed client operation' }],
    });
  });

  if (value === undefined) throw new Error('prompt handler returned no value');
  return value;
}

async function admit(
  h: Harness,
  context: FuryAcpV1PromptContext,
  plan: FuryAcpClientOperationPlan,
): Promise<FuryAcpPermissionPermit> {
  const result = await h.permissions.admit(
    context.session,
    context.permissionRequester,
    plan.permissionOperation,
  );
  if (!result.permit) throw new Error('expected operation permit');
  return result.permit;
}

describe('FuryPipe ACP Gate 8.5 governed client capabilities', () => {
  it('executes bounded FS read/write with exact-operation permits and evidence-only receipts', async () => {
    const h = await harness();
    const readPath = path.join(h.root, 'read.txt');
    const writePath = path.join(h.root, 'write.txt');
    fs.writeFileSync(readPath, 'bounded read payload', 'utf8');

    const result = await runPrompt(
      h,
      {},
      async (context) => {
        const readPlan = await h.runtime.prepareFsRead(
          context.clientTransport,
          context.session,
          { path: readPath },
        );
        const readPermit = await admit(h, context, readPlan);
        const readResult = await h.runtime.execute(
          readPlan,
          readPermit,
          context.session,
        );

        const secret = 'SECRET_VALUE_MUST_NOT_ENTER_RECEIPT';
        const writePlan = await h.runtime.prepareFsWrite(
          context.clientTransport,
          context.session,
          { path: writePath, content: secret },
        );
        const writePermit = await admit(h, context, writePlan);
        const writeResult = await h.runtime.execute(
          writePlan,
          writePermit,
          context.session,
        );
        return {
          stopReason: 'end_turn' as const,
          value: { readResult, writeResult, secret },
        };
      },
    );

    expect(result.readResult.content).toBe('bounded read payload');
    expect(result.readResult.receipt).toMatchObject({
      kind: 'fs.read',
      outcome: 'succeeded',
      automaticReplayAllowed: false,
      authority: 'evidence-only',
      executionAuthority: false,
    });
    expect(result.writeResult.receipt).toMatchObject({
      kind: 'fs.write',
      outcome: 'succeeded',
      automaticReplayAllowed: false,
    });
    expect(fs.readFileSync(writePath, 'utf8')).toBe(result.secret);
    expect(JSON.stringify(result.writeResult.receipt)).not.toContain(result.secret);
    expect(JSON.stringify(result.writeResult.receipt)).not.toContain(writePath);
  });

  it('binds allow-once authority to the concrete request digest', async () => {
    const h = await harness();
    const first = path.join(h.root, 'first.txt');
    const second = path.join(h.root, 'second.txt');
    fs.writeFileSync(first, 'first', 'utf8');
    fs.writeFileSync(second, 'second', 'utf8');

    const sideEffects: string[] = [];
    await runPrompt(
      h,
      {
        read: (params) => {
          sideEffects.push(params.path);
          return { content: fs.readFileSync(params.path, 'utf8') };
        },
      },
      async (context) => {
        const firstPlan = await h.runtime.prepareFsRead(
          context.clientTransport,
          context.session,
          { path: first },
        );
        const secondPlan = await h.runtime.prepareFsRead(
          context.clientTransport,
          context.session,
          { path: second },
        );
        const firstPermit = await admit(h, context, firstPlan);
        await expect(h.runtime.execute(
          secondPlan,
          firstPermit,
          context.session,
        )).rejects.toBeInstanceOf(FuryAcpPermissionBridgeError);
        return { stopReason: 'end_turn' as const, value: true };
      },
    );
    expect(sideEffects).toEqual([]);
  });

  it('rejects outside-root, lexical parent traversal, UNC/device syntax and ADS-like paths before permission', async () => {
    const h = await harness();
    await runPrompt(h, {}, async (context) => {
      const outside = path.join(path.dirname(h.root), 'outside.txt');
      await expect(h.runtime.prepareFsRead(
        context.clientTransport,
        context.session,
        { path: outside },
      )).rejects.toBeInstanceOf(FuryAcpClientCapabilityError);

      const traversal = h.root + path.sep + '..' + path.sep + path.basename(h.root) + path.sep + 'x.txt';
      await expect(h.runtime.prepareFsRead(
        context.clientTransport,
        context.session,
        { path: traversal },
      )).rejects.toBeInstanceOf(FuryAcpClientCapabilityError);

      await expect(h.runtime.prepareFsRead(
        context.clientTransport,
        context.session,
        { path: '\\\\server\\share\\secret.txt' },
      )).rejects.toBeInstanceOf(FuryAcpClientCapabilityError);

      await expect(h.runtime.prepareFsRead(
        context.clientTransport,
        context.session,
        { path: '\\\\?\\C:\\workspace\\device-path.txt' },
      )).rejects.toBeInstanceOf(FuryAcpClientCapabilityError);

      const ads = path.join(h.root, 'file.txt:stream');
      await expect(h.runtime.prepareFsWrite(
        context.clientTransport,
        context.session,
        { path: ads, content: 'x' },
      )).rejects.toBeInstanceOf(FuryAcpClientCapabilityError);

      return { stopReason: 'end_turn' as const, value: true };
    });
  });

  it('rejects symlink or junction escape through the reused Phase 6 sandbox', async () => {
    const h = await harness();
    const outside = tempRoot('furypipe-acp-client-outside-');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside', 'utf8');
    const link = path.join(h.root, 'escape');
    fs.symlinkSync(
      outside,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await runPrompt(h, {}, async (context) => {
      await expect(h.runtime.prepareFsRead(
        context.clientTransport,
        context.session,
        { path: path.join(link, 'secret.txt') },
      )).rejects.toBeInstanceOf(FuryAcpClientCapabilityError);
      return { stopReason: 'end_turn' as const, value: true };
    });
  });

  it('fails closed when the client did not advertise the required capability', async () => {
    const h = await harness();
    const file = path.join(h.root, 'read.txt');
    fs.writeFileSync(file, 'data', 'utf8');
    await runPrompt(
      h,
      {
        capabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
      async (context) => {
        await expect(h.runtime.prepareFsRead(
          context.clientTransport,
          context.session,
          { path: file },
        )).rejects.toBeInstanceOf(FuryAcpV1ClientTransportError);
        return { stopReason: 'end_turn' as const, value: true };
      },
    );
  });

  it('rejects an oversized write before any permission or client side effect', async () => {
    const h = await harness();
    const target = path.join(h.root, 'too-large.txt');
    let writes = 0;
    await runPrompt(
      h,
      {
        write: () => {
          writes += 1;
          return {};
        },
      },
      async (context) => {
        await expect(h.runtime.prepareFsWrite(
          context.clientTransport,
          context.session,
          {
            path: target,
            content: 'x'.repeat(h.sandbox.limits.maxFileBytes + 1),
          },
        )).rejects.toBeInstanceOf(FuryAcpClientCapabilityError);
        return { stopReason: 'end_turn' as const, value: true };
      },
    );
    expect(writes).toBe(0);
  });

  it('marks a post-invocation FS write failure unknown and forbids blind replay', async () => {
    const h = await harness();
    const target = path.join(h.root, 'uncertain.txt');
    const result = await runPrompt(
      h,
      {
        write: (params) => {
          fs.writeFileSync(params.path, params.content, 'utf8');
          throw new Error('simulated lost response after write');
        },
      },
      async (context) => {
        const plan = await h.runtime.prepareFsWrite(
          context.clientTransport,
          context.session,
          { path: target, content: 'may-have-been-written' },
        );
        const permit = await admit(h, context, plan);
        const execution = await h.runtime.execute(
          plan,
          permit,
          context.session,
        );
        return { stopReason: 'end_turn' as const, value: execution };
      },
    );
    expect(result.receipt).toMatchObject({
      outcome: 'unknown',
      automaticReplayAllowed: false,
      errorCode: 'client-request-failed',
    });
    expect(fs.readFileSync(target, 'utf8')).toBe('may-have-been-written');
  });

  it('uses Phase 6 command/env/cwd bounds and redacts explicit environment values from terminal output', async () => {
    const h = await harness();
    const result = await runPrompt(
      h,
      {
        terminalOutput: () => ({
          output: 'prefix TOP_SECRET_123 suffix',
          truncated: false,
          exitStatus: { exitCode: 0 },
        }),
      },
      async (context) => {
        const plan = await h.runtime.prepareTerminalExecution(
          context.clientTransport,
          context.session,
          {
            command: 'node',
            args: ['--version'],
            cwd: h.root,
            environment: { SAFE_VALUE: 'TOP_SECRET_123' },
            outputByteLimit: 4096,
            timeoutMs: 500,
          },
        );
        const permit = await admit(h, context, plan);
        const execution = await h.runtime.execute(
          plan,
          permit,
          context.session,
        );
        return { stopReason: 'end_turn' as const, value: execution };
      },
    );

    expect(result.output).toBe('prefix [redacted] suffix');
    expect(result.receipt).toMatchObject({
      kind: 'terminal.execute',
      outcome: 'succeeded',
      exitCode: 0,
      automaticReplayAllowed: false,
    });
    expect(JSON.stringify(result.receipt)).not.toContain('TOP_SECRET_123');
    expect(JSON.stringify(result.receipt)).not.toContain(h.root);
    expect(JSON.stringify(result.receipt)).not.toContain('--version');
  });

  it('marks terminal/create lost-response uncertainty unknown without replay', async () => {
    const h = await harness();
    const result = await runPrompt(
      h,
      {
        terminalCreate: () => {
          throw new Error('response lost after possible process start');
        },
      },
      async (context) => {
        const plan = await h.runtime.prepareTerminalExecution(
          context.clientTransport,
          context.session,
          {
            command: 'node',
            cwd: h.root,
            timeoutMs: 500,
          },
        );
        const permit = await admit(h, context, plan);
        const execution = await h.runtime.execute(
          plan,
          permit,
          context.session,
        );
        return { stopReason: 'end_turn' as const, value: execution };
      },
    );
    expect(result.receipt).toMatchObject({
      outcome: 'unknown',
      automaticReplayAllowed: false,
      errorCode: 'client-request-failed',
    });
  });

  it('invalidates prompt-scoped client transport after the prompt finishes', async () => {
    const h = await harness();
    const file = path.join(h.root, 'read.txt');
    fs.writeFileSync(file, 'data', 'utf8');
    let runtime: FuryAcpClientCapabilityRuntime | undefined;
    let plan: FuryAcpClientOperationPlan | undefined;
    let permit: FuryAcpPermissionPermit | undefined;
    let session: FuryAcpV1SessionSnapshot | undefined;

    await runPrompt(h, {}, async (context) => {
      runtime = h.runtime;
      session = context.session;
      plan = await h.runtime.prepareFsRead(
        context.clientTransport,
        context.session,
        { path: file },
      );
      permit = await admit(h, context, plan);
      return { stopReason: 'end_turn' as const, value: true };
    });

    await expect(runtime!.execute(
      plan!,
      permit!,
      session!,
    )).rejects.toBeInstanceOf(FuryAcpV1ClientTransportError);
  });

  it('rejects copied operation plans as non-authoritative data', async () => {
    const h = await harness();
    const file = path.join(h.root, 'read.txt');
    fs.writeFileSync(file, 'data', 'utf8');

    await runPrompt(h, {}, async (context) => {
      const plan = await h.runtime.prepareFsRead(
        context.clientTransport,
        context.session,
        { path: file },
      );
      const permit = await admit(h, context, plan);
      const copied = { ...plan };
      await expect(h.runtime.execute(
        copied,
        permit,
        context.session,
      )).rejects.toBeInstanceOf(FuryAcpClientCapabilityError);
      return { stopReason: 'end_turn' as const, value: true };
    });
  });
});
