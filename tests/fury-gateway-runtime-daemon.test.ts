import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';

import {
  createFuryGatewayCommandRegistry,
} from '../src/gateway-command-authorization-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
} from '../src/gateway-session-node.js';
import {
  FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL,
} from '../src/gateway-websocket-host-node.js';
import {
  FURY_GATEWAY_DAEMON_EVENT_FORMAT,
  FuryGatewayDaemonError,
  startFuryGatewayDaemon,
  type FuryGatewayDaemonHandle,
} from '../src/gateway-runtime-daemon-node.js';

const daemons: FuryGatewayDaemonHandle[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.terminate();
      } catch {
        // Already unusable.
      }
    }
  }
  await Promise.all(daemons.splice(0).map((daemon) => daemon.stop()));
});

function createHarness() {
  let now = 100_000;
  const principalRegistry = createFuryGatewayPrincipalRegistry({ now: () => now });
  const principal = principalRegistry.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:daemon-user',
    kind: 'human',
    issuer: 'local',
    subject: 'daemon-user',
    authenticationMethod: 'local-owner',
  });
  const sessionCoordinator = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-daemon-test',
    now: () => now,
    defaultTtlMs: 60_000,
    maxTtlMs: 60_000,
  });
  const session = sessionCoordinator.issueSession({
    principal,
    role: 'operator',
    scopes: ['gateway.inspect'],
    binding: { kind: 'local-operator' },
  });
  return {
    get now() {
      return now;
    },
    set now(value: number) {
      now = value;
    },
    sessionCoordinator,
    session,
  };
}

function nextJson(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData, isBinary: boolean): void => {
      cleanup();
      if (isBinary) {
        reject(new Error('expected text response'));
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

async function connect(url: string): Promise<{ ws: WebSocket; hello: Record<string, unknown> }> {
  const ws = new WebSocket(url, FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL, {
    headers: { Origin: 'http://localhost:3000' },
  });
  sockets.push(ws);
  const helloPromise = nextJson(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return { ws, hello: await helloPromise };
}

function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('close', (code) => resolve(code));
  });
}

describe('Fury Gateway runtime daemon', () => {
  it('starts ready with bounded observability-only health', async () => {
    const harness = createHarness();
    const daemon = await startFuryGatewayDaemon({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      config: {
        allowedOrigins: ['http://localhost:3000'],
      },
      now: () => harness.now,
    });
    daemons.push(daemon);

    const inspect = daemon.inspect();
    expect(inspect.status).toBe('ready');
    expect(inspect.authority).toBe('observability-only');
    expect(inspect.address?.url).toBe(daemon.address.url);
    expect(inspect.activeConnections).toBe(0);
    expect(inspect.activeSessions).toBe(1);

    const health = daemon.health();
    expect(health.status).toBe('ready');
    expect(health.connections.operator).toBe(0);
    expect(health.sessions).toBe(1);
    expect(health.automations).toBe(0);
    expect(health.workers).toBe(0);

    const events = daemon.events();
    expect(events.map((event) => event.type)).toEqual(['status', 'websocket', 'status']);
    expect(events[0]?.format).toBe(FURY_GATEWAY_DAEMON_EVENT_FORMAT);
    expect(events[0]?.sequence).toBe(1);
    expect(events[2]?.sequence).toBe(3);
  });

  it('tracks exact operator connection counts from real WebSocket events', async () => {
    const harness = createHarness();
    const daemon = await startFuryGatewayDaemon({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      config: {
        allowedOrigins: ['http://localhost:3000'],
      },
      now: () => harness.now,
    });
    daemons.push(daemon);

    const { ws, hello } = await connect(daemon.address.url);
    expect(hello.type).toBe('connected');

    expect(daemon.inspect().activeConnections).toBe(1);
    expect(daemon.health().connections.operator).toBe(1);
    expect(daemon.health().connections.node).toBe(0);

    const daemonClose = new Promise<void>((resolve) => {
      let unsubscribe = (): void => {};
      unsubscribe = daemon.subscribe((event) => {
        if (event.type === 'websocket' && event.event.type === 'connection-close') {
          unsubscribe();
          resolve();
        }
      });
    });
    const closePromise = nextClose(ws);
    ws.close(1000, 'done');
    expect(await closePromise).toBe(1000);
    await daemonClose;

    expect(daemon.inspect().activeConnections).toBe(0);
    expect(daemon.health().connections.operator).toBe(0);

    const open = daemon.events().find(
      (event) => event.type === 'websocket' && event.event.type === 'connection-open',
    );
    expect(open?.type).toBe('websocket');
    if (open?.type === 'websocket' && open.event.type === 'connection-open') {
      expect(open.event.role).toBe('operator');
      expect(open.event.clientKind).toBe('browser');
    }
  });

  it('keeps event history bounded and supports cursor reads', async () => {
    const harness = createHarness();
    const daemon = await startFuryGatewayDaemon({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      config: {
        allowedOrigins: ['http://localhost:3000'],
        maxEventHistory: 2,
      },
      now: () => harness.now,
    });
    daemons.push(daemon);

    const initial = daemon.events();
    expect(initial).toHaveLength(2);
    expect(initial[0]!.sequence).toBe(2);
    expect(initial[1]!.sequence).toBe(3);

    const afterTwo = daemon.events(2);
    expect(afterTwo).toHaveLength(1);
    expect(afterTwo[0]!.sequence).toBe(3);

    expect(() => daemon.events(-1)).toThrowError(
      expect.objectContaining({ code: 'invalid-config' }),
    );
  });

  it('isolates failing observability subscribers from runtime authority', async () => {
    const harness = createHarness();
    const daemon = await startFuryGatewayDaemon({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      config: {
        allowedOrigins: ['http://localhost:3000'],
      },
      now: () => harness.now,
    });
    daemons.push(daemon);

    let observed = 0;
    const unsubscribeBad = daemon.subscribe(() => {
      throw new Error('observability must not break runtime');
    });
    const unsubscribeGood = daemon.subscribe(() => {
      observed += 1;
    });

    const { ws } = await connect(daemon.address.url);
    expect(observed).toBeGreaterThan(0);
    expect(daemon.inspect().activeConnections).toBe(1);

    unsubscribeBad();
    unsubscribeGood();
    ws.terminate();
  });

  it('transitions through draining to stopped and stop is idempotent', async () => {
    const harness = createHarness();
    const daemon = await startFuryGatewayDaemon({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      config: {
        allowedOrigins: ['http://localhost:3000'],
      },
      now: () => harness.now,
    });
    daemons.push(daemon);

    const { ws } = await connect(daemon.address.url);
    const closePromise = nextClose(ws);

    const first = daemon.stop();
    const second = daemon.stop();
    expect(first).toBe(second);
    await first;

    expect(await closePromise).toBe(1001);
    expect(daemon.inspect().status).toBe('stopped');
    expect(daemon.inspect().activeConnections).toBe(0);

    expect(() => daemon.health()).toThrowError(
      expect.objectContaining({
        name: 'FuryGatewayDaemonError',
        code: 'stopped',
      } satisfies Partial<FuryGatewayDaemonError>),
    );

    const statuses = daemon.events()
      .filter((event) => event.type === 'status')
      .map((event) => event.type === 'status' ? event.status : 'never');
    expect(statuses).toEqual(['starting', 'ready', 'draining', 'stopped']);
  });

  it('rejects invalid event history configuration before listening', async () => {
    const harness = createHarness();

    await expect(startFuryGatewayDaemon({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      config: {
        maxEventHistory: 0,
      },
      now: () => harness.now,
    })).rejects.toMatchObject({
      name: 'FuryGatewayDaemonError',
      code: 'invalid-config',
    } satisfies Partial<FuryGatewayDaemonError>);
  });

  it('rejects unsafe clocks before starting network authority', async () => {
    const harness = createHarness();

    await expect(startFuryGatewayDaemon({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      resolveConnection: () => ({
        session: harness.session,
        clientKind: 'browser',
      }),
      now: () => Number.MAX_SAFE_INTEGER + 1,
    })).rejects.toMatchObject({
      name: 'FuryGatewayDaemonError',
      code: 'invalid-config',
    } satisfies Partial<FuryGatewayDaemonError>);
  });
});