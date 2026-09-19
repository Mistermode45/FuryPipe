import { request as httpRequest } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';

import {
  createFuryGatewayCommandRegistry,
} from '../src/gateway-command-authorization-node.js';
import {
  FURY_GATEWAY_LOCAL_BOOTSTRAP_FORMAT,
  FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
  FURY_GATEWAY_LOCAL_COOKIE_NAME,
  FURY_GATEWAY_LOCAL_LOGOUT_PATH,
  createFuryGatewayLocalBootstrapManager,
  type FuryGatewayLocalBootstrapManager,
} from '../src/gateway-local-operator-bootstrap-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
} from '../src/gateway-session-node.js';
import {
  startFuryGatewayDaemon,
  type FuryGatewayDaemonHandle,
} from '../src/gateway-runtime-daemon-node.js';
import {
  FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL,
  listenFuryGatewayWebSocketHost,
  type FuryGatewayWebSocketHostHandle,
} from '../src/gateway-websocket-host-node.js';

const handles: FuryGatewayWebSocketHostHandle[] = [];
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
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
  await Promise.all(daemons.splice(0).map((daemon) => daemon.stop()));
});

function createHarness() {
  let now = 100_000;
  const principalRegistry = createFuryGatewayPrincipalRegistry({
    now: () => now,
    evidenceTtlMs: 15 * 60_000,
  });
  const principal = principalRegistry.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:local-owner',
    kind: 'human',
    issuer: 'local',
    subject: 'local-owner-test',
    authenticationMethod: 'local-owner',
  });
  const sessionCoordinator = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-bootstrap-test',
    now: () => now,
    defaultTtlMs: 60 * 60_000,
    maxTtlMs: 60 * 60_000,
  });
  const session = sessionCoordinator.issueSession({
    principal,
    role: 'operator',
    scopes: ['gateway.inspect'],
    binding: { kind: 'local-operator' },
    expiresInMs: 60 * 60_000,
  });
  return {
    get now() {
      return now;
    },
    set now(value: number) {
      now = value;
    },
    principalRegistry,
    sessionCoordinator,
    session,
  };
}

interface HttpResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

function post(
  port: number,
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
        ...headers,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
    req.end(body);
  });
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

async function connectWithCookie(
  url: string,
  cookie: string,
  origin = 'http://localhost:3000',
): Promise<{ ws: WebSocket; hello: Record<string, unknown> }> {
  const ws = new WebSocket(url, FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL, {
    headers: {
      Origin: origin,
      Cookie: cookie,
    },
  });
  sockets.push(ws);
  const helloPromise = nextJson(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return { ws, hello: await helloPromise };
}

function expectUpgradeRejected(
  url: string,
  cookie: string,
  origin = 'http://localhost:3000',
): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL, {
      headers: {
        Origin: origin,
        Cookie: cookie,
      },
    });
    sockets.push(ws);
    let settled = false;
    ws.once('unexpected-response', (_req, res) => {
      settled = true;
      const status = res.statusCode ?? 0;
      res.resume();
      try { ws.terminate(); } catch { /* no upgrade */ }
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

function ticketBody(code: string): string {
  return JSON.stringify({
    format: FURY_GATEWAY_LOCAL_BOOTSTRAP_FORMAT,
    code,
  });
}

async function startHost(
  manager: FuryGatewayLocalBootstrapManager,
  harness: ReturnType<typeof createHarness>,
  origins: readonly string[] = ['http://localhost:3000'],
): Promise<FuryGatewayWebSocketHostHandle> {
  const handle = await listenFuryGatewayWebSocketHost({
    sessionCoordinator: harness.sessionCoordinator,
    commandRegistry: createFuryGatewayCommandRegistry(),
    allowedOrigins: origins,
    handleHttpRequest: (request, response) => manager.handleHttpRequest(request, response),
    resolveConnection: ({ request }) => manager.resolveConnection(request),
  });
  handles.push(handle);
  return handle;
}

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error('expected Set-Cookie header');
  return value.split(';', 1)[0]!;
}

describe('Fury Gateway local operator browser bootstrap', () => {
  it('redeems a one-time local code into a hardened browser cookie and real WebSocket', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
    });
    const ticket = manager.issueTicket();
    const handle = await startHost(manager, harness);

    const redeemed = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );

    expect(redeemed.status).toBe(204);
    expect(redeemed.body).toBe('');
    const setCookie = Array.isArray(redeemed.headers['set-cookie'])
      ? redeemed.headers['set-cookie'][0]!
      : String(redeemed.headers['set-cookie']);
    expect(setCookie).toContain(`${FURY_GATEWAY_LOCAL_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/gateway/');
    expect(setCookie).toContain('Max-Age=');
    expect(setCookie).not.toContain(ticket.code);

    const cookie = cookiePair(redeemed.headers['set-cookie']);
    const { hello } = await connectWithCookie(handle.address.url, cookie);
    expect(hello.type).toBe('connected');
    expect(hello.clientKind).toBe('browser');
    expect(hello.executionAuthority).toBe(false);
    expect(JSON.stringify(hello)).not.toContain(harness.session.sessionId);
    expect(JSON.stringify(hello)).not.toContain(harness.session.principalId);
    expect(manager.inspect().browserSessions).toBe(1);
  });

  it('consumes the bootstrap code exactly once', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
    });
    const ticket = manager.issueTicket();
    const handle = await startHost(manager, harness);

    const first = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    expect(first.status).toBe(204);

    const second = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    expect(second.status).toBe(401);
    expect(second.body).toBe('');
  });

  it('does not consume a ticket when Origin policy rejects the request first', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
    });
    const ticket = manager.issueTicket();
    const handle = await startHost(manager, harness);

    const denied = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://evil.localhost:3000' },
    );
    expect(denied.status).toBe(403);

    const accepted = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    expect(accepted.status).toBe(204);
  });

  it('rejects query strings and never accepts bootstrap secrets in the URL', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
    });
    const ticket = manager.issueTicket();
    const handle = await startHost(manager, harness);

    const denied = await post(
      handle.address.port,
      `${FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH}?code=${ticket.code}`,
      '{}',
      { Origin: 'http://localhost:3000' },
    );
    expect(denied.status).toBe(400);

    const accepted = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    expect(accepted.status).toBe(204);
  });

  it('rejects malformed content type, malformed body and oversized bodies', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
      maxRequestBodyBytes: 256,
    });
    const handle = await startHost(manager, harness);

    const ticket1 = manager.issueTicket();
    const wrongType = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket1.code),
      {
        Origin: 'http://localhost:3000',
        'Content-Type': 'text/plain',
      },
    );
    expect(wrongType.status).toBe(415);

    const malformed = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      '{"format":"wrong","code":"no"}',
      { Origin: 'http://localhost:3000' },
    );
    expect(malformed.status).toBe(401);

    const oversized = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      JSON.stringify({ x: 'x'.repeat(500) }),
      { Origin: 'http://localhost:3000' },
    );
    expect(oversized.status).toBe(413);
  });

  it('expires bootstrap tickets before redemption', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
      bootstrapTtlMs: 10_000,
    });
    const ticket = manager.issueTicket();
    const handle = await startHost(manager, harness);

    harness.now = ticket.expiresAt + 1;
    const denied = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    expect(denied.status).toBe(401);
    expect(manager.inspect().pendingTickets).toBe(0);
  });

  it('expires browser cookies independently and refuses future upgrades', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
      browserSessionTtlMs: 30_000,
    });
    const ticket = manager.issueTicket();
    const handle = await startHost(manager, harness);

    const redeemed = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    const cookie = cookiePair(redeemed.headers['set-cookie']);

    harness.now += 30_001;
    expect(await expectUpgradeRejected(handle.address.url, cookie)).toBe(401);
    expect(manager.inspect().browserSessions).toBe(0);
  });

  it('session revocation invalidates an otherwise unexpired browser cookie', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
    });
    const ticket = manager.issueTicket();
    const handle = await startHost(manager, harness);

    const redeemed = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    const cookie = cookiePair(redeemed.headers['set-cookie']);

    harness.sessionCoordinator.revokeSession(harness.session.sessionId);

    expect(await expectUpgradeRejected(handle.address.url, cookie)).toBe(401);
    expect(manager.inspect().browserSessions).toBe(0);
  });

  it('logout revokes the browser token and clears the cookie', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
    });
    const ticket = manager.issueTicket();
    const handle = await startHost(manager, harness);

    const redeemed = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    const cookie = cookiePair(redeemed.headers['set-cookie']);

    const loggedOut = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_LOGOUT_PATH,
      '',
      {
        Origin: 'http://localhost:3000',
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
    );

    expect(loggedOut.status).toBe(204);
    const clear = Array.isArray(loggedOut.headers['set-cookie'])
      ? loggedOut.headers['set-cookie'][0]!
      : String(loggedOut.headers['set-cookie']);
    expect(clear).toContain('Max-Age=0');
    expect(await expectUpgradeRejected(handle.address.url, cookie)).toBe(401);
  });

  it('rejects duplicate auth cookies instead of selecting one ambiguously', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
    });
    const ticket = manager.issueTicket();
    const handle = await startHost(manager, harness);

    const redeemed = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    const cookie = cookiePair(redeemed.headers['set-cookie']);
    const token = cookie.slice(cookie.indexOf('=') + 1);
    const duplicate = `${FURY_GATEWAY_LOCAL_COOKIE_NAME}=${token}; ${FURY_GATEWAY_LOCAL_COOKIE_NAME}=${token}`;

    expect(await expectUpgradeRejected(handle.address.url, duplicate)).toBe(401);
  });

  it('enforces pending-ticket and browser-session quotas', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
      maxPendingTickets: 1,
      maxBrowserSessions: 1,
    });
    const first = manager.issueTicket();
    expect(() => manager.issueTicket()).toThrowError(
      expect.objectContaining({ code: 'ticket-limit' }),
    );

    const handle = await startHost(manager, harness);
    const redeemed = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(first.code),
      { Origin: 'http://localhost:3000' },
    );
    expect(redeemed.status).toBe(204);

    const second = manager.issueTicket();
    const limited = await post(
      handle.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(second.code),
      { Origin: 'http://localhost:3000' },
    );
    expect(limited.status).toBe(429);
    expect(manager.inspect().browserSessions).toBe(1);
  });

  it('composes the bootstrap through the long-lived Gateway daemon', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
    });

    const daemon = await startFuryGatewayDaemon({
      sessionCoordinator: harness.sessionCoordinator,
      commandRegistry: createFuryGatewayCommandRegistry(),
      handleHttpRequest: (request, response) => manager.handleHttpRequest(request, response),
      resolveConnection: ({ request }) => manager.resolveConnection(request),
      config: {
        allowedOrigins: ['http://localhost:3000'],
      },
      now: () => harness.now,
    });
    daemons.push(daemon);

    const ticket = manager.issueTicket();
    const redeemed = await post(
      daemon.address.port,
      FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
      ticketBody(ticket.code),
      { Origin: 'http://localhost:3000' },
    );
    expect(redeemed.status).toBe(204);

    const cookie = cookiePair(redeemed.headers['set-cookie']);
    const { hello } = await connectWithCookie(daemon.address.url, cookie);
    expect(hello.type).toBe('connected');
    expect(daemon.inspect().activeConnections).toBe(1);
    expect(daemon.inspect().connections.operator).toBe(1);
  });

  it('revokeAllBrowserSessions invalidates every issued browser cookie', async () => {
    const harness = createHarness();
    const manager = createFuryGatewayLocalBootstrapManager({
      sessionCoordinator: harness.sessionCoordinator,
      session: harness.session,
      allowedOrigins: ['http://localhost:3000'],
      now: () => harness.now,
      maxBrowserSessions: 2,
    });
    const handle = await startHost(manager, harness);

    const cookies: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const ticket = manager.issueTicket();
      const redeemed = await post(
        handle.address.port,
        FURY_GATEWAY_LOCAL_BOOTSTRAP_PATH,
        ticketBody(ticket.code),
        { Origin: 'http://localhost:3000' },
      );
      cookies.push(cookiePair(redeemed.headers['set-cookie']));
    }

    expect(manager.revokeAllBrowserSessions()).toBe(2);
    expect(manager.inspect().browserSessions).toBe(0);

    for (const cookie of cookies) {
      expect(await expectUpgradeRejected(handle.address.url, cookie)).toBe(401);
    }
  });
});