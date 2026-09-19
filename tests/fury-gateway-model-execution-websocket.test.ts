import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';

import { createFuryGatewayCommandRegistry } from '../src/gateway-command-authorization-node.js';
import {
  FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES,
} from '../src/gateway-model-command-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewayScope,
} from '../src/gateway-session-node.js';
import { FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT } from '../src/gateway-transport-node.js';
import {
  FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL,
  listenFuryGatewayWebSocketHost,
  type FuryGatewayWebSocketHostHandle,
} from '../src/gateway-websocket-host-node.js';

const handles: FuryGatewayWebSocketHostHandle[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    try {
      ws.terminate();
    } catch {
      // already closed
    }
  }
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
});

function harness(scopes: readonly FuryGatewayScope[]) {
  const now = () => 10_000;
  const principalRegistry = createFuryGatewayPrincipalRegistry({ now });
  const principal = principalRegistry.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:model-exec-test',
    kind: 'human',
    issuer: 'local',
    subject: 'model-exec-test',
    authenticationMethod: 'local-owner',
  });
  const sessionCoordinator = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-model-exec-test',
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

function json(data: RawData): Record<string, unknown> {
  return JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as Record<string, unknown>;
}

async function connect(url: string): Promise<{
  readonly ws: WebSocket;
  readonly hello: Record<string, unknown>;
}> {
  const ws = new WebSocket(url, FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL, {
    headers: { Origin: 'http://localhost:3000' },
  });
  sockets.push(ws);
  const helloPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
    ws.once('message', (data, isBinary) => {
      if (isBinary) {
        reject(new Error('expected text message'));
        return;
      }
      resolve(json(data));
    });
    ws.once('error', reject);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, hello: await helloPromise };
}

function collect(
  ws: WebSocket,
  count: number,
): Promise<readonly Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const output: Record<string, unknown>[] = [];
    const onMessage = (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        cleanup();
        reject(new Error('expected text message'));
        return;
      }
      output.push(json(data));
      if (output.length === count) {
        cleanup();
        resolve(Object.freeze([...output]));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.once('error', onError);
  });
}

function frame(
  connectionId: string,
  sequence: number,
  permissions: readonly string[] = ['provider-inference'],
): string {
  return JSON.stringify({
    format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
    messageId: `model-exec-${sequence}`,
    connectionId,
    sequence,
    type: 'command',
    sentAt: 10_000,
    payload: {
      commandName: 'conversation.model.execute',
      declaredPluginPermissions: permissions,
      input: {
        conversationId: 'fkc_abcdefghijklmnopqrstuvwx',
        turnId: 'fkt_abcdefghijklmnopqrstuvwx',
      },
    },
  });
}

describe('Gateway governed model execution WebSocket boundary', () => {
  it('keeps admission separate from async provider execution result', async () => {
    const h = harness([
      'conversations.write',
      'capability.provider-inference',
    ]);
    let calls = 0;
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: h.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(
        FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS,
      ),
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: h.session,
        clientKind: 'browser',
      }),
      admittedExecutionCommandNames: FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES,
      handleAdmittedExecutionCommand: async (command) => {
        calls += 1;
        expect(command.executionAuthority).toBe(false);
        return Object.freeze({
          status: 'completed',
          provider: Object.freeze({
            providerId: 'openai',
            model: 'gpt-5.6-sol',
            verification: 'unverified',
          }),
          executionAuthority: false,
        });
      },
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    const responses = collect(ws, 2);
    ws.send(frame(String(hello.connectionId), 1));
    const [admission, execution] = await responses;

    expect(admission).toMatchObject({
      type: 'command-admission',
      executionAuthority: false,
      admission: {
        commandName: 'conversation.model.execute',
        outcome: 'eligible',
        executionAuthority: false,
      },
    });
    expect(execution).toMatchObject({
      type: 'execution-command-result',
      commandName: 'conversation.model.execute',
      executionAuthority: false,
      result: {
        status: 'completed',
        provider: {
          providerId: 'openai',
          model: 'gpt-5.6-sol',
          verification: 'unverified',
        },
        executionAuthority: false,
      },
    });
    expect(calls).toBe(1);
  });

  it('does not invoke the execution handler when provider-inference scope is missing', async () => {
    const h = harness(['conversations.write']);
    let calls = 0;
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: h.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(
        FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS,
      ),
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: h.session,
        clientKind: 'browser',
      }),
      admittedExecutionCommandNames: FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES,
      handleAdmittedExecutionCommand: async () => {
        calls += 1;
        return {};
      },
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    const response = collect(ws, 1);
    ws.send(frame(String(hello.connectionId), 1));
    const [admission] = await response;

    expect(admission).toMatchObject({
      type: 'command-admission',
      admission: {
        outcome: 'deny',
        reason: 'missing-scope',
        executionAuthority: false,
      },
      executionAuthority: false,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(calls).toBe(0);
  });

  it('fails configuration when state and execution allowlists overlap', async () => {
    const h = harness([
      'conversations.write',
      'capability.provider-inference',
    ]);
    await expect(listenFuryGatewayWebSocketHost({
      sessionCoordinator: h.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(
        FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS,
      ),
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: h.session,
        clientKind: 'browser',
      }),
      admittedStateCommandNames: ['conversation.model.execute'],
      handleAdmittedStateCommand: () => ({}),
      admittedExecutionCommandNames: ['conversation.model.execute'],
      handleAdmittedExecutionCommand: async () => ({}),
    })).rejects.toThrow(/disjoint/u);
  });

  it('redacts async handler failures into a bounded safe result', async () => {
    const h = harness([
      'conversations.write',
      'capability.provider-inference',
    ]);
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: h.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(
        FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS,
      ),
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: h.session,
        clientKind: 'browser',
      }),
      admittedExecutionCommandNames: FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES,
      handleAdmittedExecutionCommand: async () => {
        throw new Error('OPENAI_API_KEY=RAW_SECRET_SENTINEL');
      },
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    const responses = collect(ws, 2);
    ws.send(frame(String(hello.connectionId), 1));
    const [, execution] = await responses;

    expect(execution).toMatchObject({
      type: 'execution-command-result',
      result: {
        status: 'rejected',
        error: { code: 'execution-command-handler-error' },
        executionAuthority: false,
      },
      executionAuthority: false,
    });
    expect(JSON.stringify(execution)).not.toContain('RAW_SECRET_SENTINEL');
  });
});
