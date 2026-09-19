import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';

import {
  FURY_GATEWAY_COMMAND_FORMAT,
  createFuryGatewayCommandRegistry,
} from '../src/gateway-command-authorization-node.js';
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
  FURY_GATEWAY_SERVER_MESSAGE_FORMAT,
  FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL,
  FuryGatewayWebSocketHostError,
  listenFuryGatewayWebSocketHost,
  type FuryGatewayWebSocketHostHandle,
} from '../src/gateway-websocket-host-node.js';

const handles: FuryGatewayWebSocketHostHandle[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.terminate();
      } catch {
        // Already closed.
      }
    }
  }
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
});

function createOperatorHarness(
  scopes: readonly FuryGatewayScope[] = ['gateway.inspect'],
) {
  let now = 10_000;
  const principalRegistry = createFuryGatewayPrincipalRegistry({
    now: () => now,
  });
  const principal = principalRegistry.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:websocket-user',
    kind: 'human',
    issuer: 'local',
    subject: 'websocket-user',
    authenticationMethod: 'local-owner',
  });
  const sessionCoordinator = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-websocket-test',
    now: () => now,
    defaultTtlMs: 60_000,
    maxTtlMs: 60_000,
  });
  const session = sessionCoordinator.issueSession({
    principal,
    role: 'operator',
    scopes,
    binding: { kind: 'local-operator' },
  });
  return {
    get now() {
      return now;
    },
    set now(value: number) {
      now = value;
    },
    principalRegistry,
    principal,
    sessionCoordinator,
    session,
  };
}

function nextJson(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData, isBinary: boolean): void => {
      cleanup();
      if (isBinary) {
        reject(new Error('expected text WebSocket response'));
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

function nextClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString('utf8') });
    });
  });
}

async function connect(
  url: string,
  origin = 'http://localhost:3000',
): Promise<{ ws: WebSocket; hello: Record<string, unknown> }> {
  const ws = new WebSocket(url, FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL, {
    headers: { Origin: origin },
  });
  sockets.push(ws);

  const helloPromise = nextJson(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const hello = await helloPromise;
  return { ws, hello };
}

function expectUpgradeRejected(
  url: string,
  protocol: string = FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL,
  origin = 'http://localhost:3000',
): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocol, {
      headers: { Origin: origin },
    });
    sockets.push(ws);
    let settled = false;

    ws.once('unexpected-response', (_request, response) => {
      settled = true;
      const status = response.statusCode ?? 0;
      response.resume();
      try {
        ws.terminate();
      } catch {
        // Upgrade never completed.
      }
      resolve(status);
    });
    ws.once('open', () => {
      if (settled) return;
      settled = true;
      reject(new Error('WebSocket upgrade unexpectedly succeeded'));
    });
    ws.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function pingMessage(
  connectionId: string,
  sequence: number,
  nonce = `nonce-${sequence}`,
): string {
  return JSON.stringify({
    format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
    messageId: `ping-${sequence}`,
    connectionId,
    sequence,
    type: 'ping',
    sentAt: 10_000,
    payload: { nonce },
  });
}

describe('Fury Gateway real WebSocket host', () => {
  it('binds loopback on an ephemeral port and negotiates only the Fury subprotocol', async () => {
    const harness = createOperatorHarness();
    const commandRegistry = createFuryGatewayCommandRegistry();
    const events: string[] = [];

    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry,
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      onEvent: (event) => events.push(event.type),
    });
    handles.push(handle);

    expect(handle.address.host).toBe('127.0.0.1');
    expect(handle.address.port).toBeGreaterThan(0);
    expect(handle.address.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/gateway\/v1$/u);

    const { ws, hello } = await connect(handle.address.url);
    expect(ws.protocol).toBe(FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL);
    expect(ws.extensions).toBe('');
    expect(hello.format).toBe(FURY_GATEWAY_SERVER_MESSAGE_FORMAT);
    expect(hello.type).toBe('connected');
    expect(hello.executionAuthority).toBe(false);
    expect(typeof hello.connectionId).toBe('string');
    expect('sessionId' in hello).toBe(false);
    expect('principalId' in hello).toBe(false);
    expect(events).toContain('listening');
    expect(events).toContain('connection-open');
  });

  it('refuses any non-loopback bind in Phase 1.3B', async () => {
    const harness = createOperatorHarness();

    await expect(listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      host: '0.0.0.0',
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
    })).rejects.toMatchObject({
      name: 'FuryGatewayWebSocketHostError',
      code: 'remote-bind-forbidden',
    } satisfies Partial<FuryGatewayWebSocketHostError>);
  });

  it('rejects wrong route, query strings and wrong subprotocol before resolution', async () => {
    const harness = createOperatorHarness();
    let resolutions = 0;
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => {
        resolutions += 1;
        return {
          session: harness.session,
          clientKind: 'browser',
        };
      },
    });
    handles.push(handle);

    const base = `ws://127.0.0.1:${handle.address.port}`;

    expect(await expectUpgradeRejected(`${base}/wrong`)).toBe(404);
    expect(await expectUpgradeRejected(`${handle.address.url}?token=must-not-be-accepted`)).toBe(400);
    expect(await expectUpgradeRejected(handle.address.url, 'wrong.protocol')).toBe(400);
    expect(resolutions).toBe(0);
  });

  it('rejects missing or non-allowlisted browser Origin', async () => {
    const harness = createOperatorHarness();
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      allowedOrigins: ['https://app.example.test'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
    });
    handles.push(handle);

    expect(await expectUpgradeRejected(
      handle.address.url,
      FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL,
      'https://evil.example.test',
    )).toBe(401);

    const ws = new WebSocket(handle.address.url, FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL);
    sockets.push(ws);
    const status = await new Promise<number>((resolve, reject) => {
      ws.once('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      ws.once('open', () => reject(new Error('missing-Origin upgrade unexpectedly succeeded')));
      ws.once('error', reject);
    });
    expect(status).toBe(401);
  });

  it('runs ping over a real text WebSocket and returns transport-only evidence', async () => {
    const harness = createOperatorHarness();
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    const connectionId = String(hello.connectionId);
    const responsePromise = nextJson(ws);
    ws.send(pingMessage(connectionId, 1, 'real-ping'));
    const response = await responsePromise;

    expect(response.type).toBe('pong');
    expect(response.connectionId).toBe(connectionId);
    expect(response.nonce).toBe('real-ping');
    expect(response.executionAuthority).toBe(false);
  });

  it('routes a real command frame through Phase 1.2 without executing it', async () => {
    const harness = createOperatorHarness(['capability.repository-read']);
    const commandRegistry = createFuryGatewayCommandRegistry([{
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'repository.read',
      allowedRoles: ['operator'],
      requiredScopes: ['capability.repository-read'],
      requiredPluginPermissions: ['repository-read'],
      riskClass: 'read',
      requiresFreshApproval: false,
    }]);
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry,
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    const connectionId = String(hello.connectionId);
    const responsePromise = nextJson(ws);
    ws.send(JSON.stringify({
      format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
      messageId: 'cmd-1',
      connectionId,
      sequence: 1,
      type: 'command',
      sentAt: 10_000,
      payload: {
        commandName: 'repository.read',
        declaredPluginPermissions: ['repository-read'],
        input: { path: 'README.md', secretNotEchoed: 'value' },
      },
    }));
    const response = await responsePromise;

    expect(response.type).toBe('command-admission');
    expect(response.executionAuthority).toBe(false);
    const admission = response.admission as Record<string, unknown>;
    expect(admission.outcome).toBe('eligible');
    expect(admission.executionAuthority).toBe(false);
    expect(JSON.stringify(response)).not.toContain('secretNotEchoed');
  });

  it('rejects binary control frames with WebSocket code 1003', async () => {
    const harness = createOperatorHarness();
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
    });
    handles.push(handle);

    const { ws } = await connect(handle.address.url);
    const closePromise = nextClose(ws);
    ws.send(Buffer.from([1, 2, 3]), { binary: true });
    const closed = await closePromise;

    expect(closed.code).toBe(1003);
    expect(closed.reason).toBe('binary-not-supported');
  });

  it('enforces ws maxPayload before application parsing', async () => {
    const harness = createOperatorHarness();
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      allowedOrigins: ['http://localhost:3000'],
      maxPayloadBytes: 1024,
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
    });
    handles.push(handle);

    const { ws } = await connect(handle.address.url);
    const closePromise = nextClose(ws);
    ws.send('x'.repeat(2048));
    const closed = await closePromise;

    expect(closed.code).toBe(1009);
  });

  it('revalidates session authority on every real WebSocket message', async () => {
    const harness = createOperatorHarness();
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
    });
    handles.push(handle);

    const { ws, hello } = await connect(handle.address.url);
    harness.sessionCoordinator.revokeSession(harness.session.sessionId);

    const closePromise = nextClose(ws);
    ws.send(pingMessage(String(hello.connectionId), 1));
    const closed = await closePromise;

    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe('policy-violation');
  });

  it('stops cleanly and closes active sockets with code 1001', async () => {
    const harness = createOperatorHarness();
    const handle = await listenFuryGatewayWebSocketHost({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      allowedOrigins: ['http://localhost:3000'],
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
    });
    handles.push(handle);

    const { ws } = await connect(handle.address.url);
    const closePromise = nextClose(ws);
    await handle.stop();
    const closed = await closePromise;

    expect(closed.code).toBe(1001);
    expect(closed.reason).toBe('server-shutdown');
  });
});