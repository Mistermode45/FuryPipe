import { describe, expect, it, afterEach } from 'vitest';
import { WebSocket, type RawData } from 'ws';

import {
  createFuryGatewayCommandRegistry,
} from '../src/gateway-command-authorization-node.js';
import {
  FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
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
import {
  FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
} from '../src/gateway-transport-node.js';
import {
  FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL,
  listenFuryGatewayWebSocketHost,
  type FuryGatewayWebSocketHostHandle,
} from '../src/gateway-websocket-host-node.js';
import { createFuryKernelConversationStore } from '../src/fury-kernel.js';

const handles: FuryGatewayWebSocketHostHandle[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.terminate();
      } catch {
        // already closed
      }
    }
  }
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
});

function operatorHarness(scopes: readonly FuryGatewayScope[]) {
  const now = () => 10_000;
  const principalRegistry = createFuryGatewayPrincipalRegistry({ now });
  const principal = principalRegistry.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:conversation-websocket',
    kind: 'human',
    issuer: 'local',
    subject: 'conversation-websocket-user',
    authenticationMethod: 'local-owner',
  });
  const sessionCoordinator = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-conversation-websocket-test',
    now,
    defaultTtlMs: 60_000,
    maxTtlMs: 60_000,
  });
  const session = sessionCoordinator.issueSession({
    principal,
    role: 'operator',
    scopes,
    binding: { kind: 'local-operator' },
  });
  return { sessionCoordinator, session };
}

function nextJson(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData, isBinary: boolean): void => {
      cleanup();
      if (isBinary) {
        reject(new Error('expected text WebSocket message'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.once('message', onMessage);
    ws.once('error', onError);
  });
}

function collectJson(
  ws: WebSocket,
  count: number,
): Promise<readonly Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const onMessage = (data: RawData, isBinary: boolean): void => {
      if (isBinary) {
        cleanup();
        reject(new Error('expected text WebSocket message'));
        return;
      }
      try {
        messages.push(
          JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>,
        );
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (messages.length === count) {
        cleanup();
        resolve(Object.freeze([...messages]));
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.once('error', onError);
  });
}

async function connect(url: string): Promise<{
  readonly ws: WebSocket;
  readonly hello: Record<string, unknown>;
}> {
  const ws = new WebSocket(url, FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL, {
    headers: { Origin: 'http://localhost:3000' },
  });
  sockets.push(ws);
  // Arm the first-message listener before awaiting "open": the Gateway may emit
  // its connected frame immediately after the handshake.
  const helloPromise = nextJson(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const hello = await helloPromise;
  return { ws, hello };
}

function commandFrame(
  connectionId: string,
  sequence: number,
  commandName: string,
  input: unknown,
): string {
  return JSON.stringify({
    format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
    messageId: `conversation-command-${sequence}`,
    connectionId,
    sequence,
    type: 'command',
    sentAt: 10_000,
    payload: {
      commandName,
      declaredPluginPermissions: [],
      input,
    },
  });
}

describe('Fury Gateway conversation WebSocket integration', () => {
  it('separates command admission from the deferred conversation state result', async () => {
    const harness = operatorHarness([
      'gateway.inspect',
      'conversations.inspect',
      'conversations.write',
    ]);
    const kernel = createFuryKernelConversationStore({ now: () => 10_000 });
    const adapter = createFuryGatewayConversationAdapter({ kernel });
    const commandRegistry = createFuryGatewayCommandRegistry(
      FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
    );
    let dispatchCalls = 0;

    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry,
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      admittedStateCommandNames: FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
      handleAdmittedStateCommand: (command) => {
        dispatchCalls += 1;
        return adapter.dispatch(command.commandName as never, command.input);
      },
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    const connectionId = String(hello.connectionId);
    const responsesPromise = collectJson(ws, 2);
    ws.send(commandFrame(connectionId, 1, 'conversation.open', {}));
    const [admission, stateResult] = await responsesPromise;

    expect(admission).toMatchObject({
      type: 'command-admission',
      connectionId,
      messageId: 'conversation-command-1',
      sequence: 1,
      executionAuthority: false,
      admission: {
        outcome: 'eligible',
        reason: 'eligible',
        executionAuthority: false,
      },
      transportReceipt: {
        status: 'transport-received',
        executionAuthority: false,
      },
    });

    expect(stateResult).toMatchObject({
      type: 'state-command-result',
      connectionId,
      messageId: 'conversation-command-1',
      sequence: 1,
      commandName: 'conversation.open',
      executionAuthority: false,
      result: {
        format: 'furypipe-gateway-conversation-result/v1',
        commandName: 'conversation.open',
        status: 'ok',
        authority: 'conversation-state',
        executionAuthority: false,
      },
    });
    const nested = stateResult.result as {
      result: { conversationId: string };
    };
    expect(nested.result.conversationId).toMatch(/^fkc_[A-Za-z0-9_-]{24}$/u);
    expect(dispatchCalls).toBe(1);
    expect(kernel.activeConversationCount()).toBe(1);
  });

  it('never dispatches a conversation mutation when command admission is denied', async () => {
    const harness = operatorHarness([
      'gateway.inspect',
      'conversations.inspect',
    ]);
    const kernel = createFuryKernelConversationStore();
    const adapter = createFuryGatewayConversationAdapter({ kernel });
    const commandRegistry = createFuryGatewayCommandRegistry(
      FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
    );
    let dispatchCalls = 0;

    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry,
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      admittedStateCommandNames: FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
      handleAdmittedStateCommand: (command) => {
        dispatchCalls += 1;
        return adapter.dispatch(command.commandName as never, command.input);
      },
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    const connectionId = String(hello.connectionId);
    const responsePromise = nextJson(ws);
    ws.send(commandFrame(connectionId, 1, 'conversation.open', {}));
    const admission = await responsePromise;

    expect(admission).toMatchObject({
      type: 'command-admission',
      executionAuthority: false,
      admission: {
        outcome: 'deny',
        reason: 'missing-scope',
        executionAuthority: false,
      },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(dispatchCalls).toBe(0);
    expect(kernel.activeConversationCount()).toBe(0);
  });


  it('rejects a state handler without an explicit command allowlist', async () => {
    const harness = operatorHarness(['conversations.write']);
    const commandRegistry = createFuryGatewayCommandRegistry(
      FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
    );

    await expect(listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry,
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      handleAdmittedStateCommand: () => ({ ok: true }),
    })).rejects.toThrow(/allowlist/u);
  });

  it('does not dispatch an eligible command that is absent from the state-only allowlist', async () => {
    const harness = operatorHarness([
      'conversations.inspect',
      'conversations.write',
      'capability.repository-read',
    ]);
    const commandRegistry = createFuryGatewayCommandRegistry([
      ...FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
      {
        format: 'furypipe-gateway-command-definition/v1',
        name: 'repository.read',
        allowedRoles: ['operator'],
        requiredScopes: ['capability.repository-read'],
        requiredPluginPermissions: ['repository-read'],
        riskClass: 'read',
        requiresFreshApproval: false,
      },
    ]);
    let dispatchCalls = 0;

    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry,
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      admittedStateCommandNames: FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
      handleAdmittedStateCommand: () => {
        dispatchCalls += 1;
        return { status: 'unexpected' };
      },
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    const connectionId = String(hello.connectionId);
    const responsePromise = nextJson(ws);
    ws.send(JSON.stringify({
      format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
      messageId: 'non-state-eligible',
      connectionId,
      sequence: 1,
      type: 'command',
      sentAt: 10_000,
      payload: {
        commandName: 'repository.read',
        declaredPluginPermissions: ['repository-read'],
        input: { path: 'README.md' },
      },
    }));
    const admission = await responsePromise;

    expect(admission).toMatchObject({
      type: 'command-admission',
      admission: {
        outcome: 'eligible',
        executionAuthority: false,
      },
      executionAuthority: false,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(dispatchCalls).toBe(0);
  });

  it('converts synchronous state-handler failures into bounded non-authoritative results', async () => {
    const harness = operatorHarness(['conversations.write']);
    const commandRegistry = createFuryGatewayCommandRegistry(
      FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
    );
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry,
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      admittedStateCommandNames: FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
      handleAdmittedStateCommand: () => {
        throw new Error('sensitive internal failure');
      },
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    const connectionId = String(hello.connectionId);
    const responsesPromise = collectJson(ws, 2);
    ws.send(commandFrame(connectionId, 1, 'conversation.open', {}));
    const [, stateResult] = await responsesPromise;

    expect(stateResult).toMatchObject({
      type: 'state-command-result',
      commandName: 'conversation.open',
      executionAuthority: false,
      result: {
        status: 'rejected',
        error: { code: 'state-command-handler-error' },
        executionAuthority: false,
      },
    });
    expect(JSON.stringify(stateResult)).not.toContain('sensitive internal failure');
  });
});
