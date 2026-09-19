import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from 'ws';

import type { FuryGatewayAuthenticatedDevice } from './gateway-auth-node.js';
import type {
  FuryGatewayCommandAdmissionDecision,
  FuryGatewayCommandRegistry,
} from './gateway-command-authorization-node.js';
import type { FuryGatewayPairingCoordinator } from './gateway-pairing-node.js';
import type { FuryGatewayRole } from './gateway.js';
import type {
  FuryGatewaySessionCoordinator,
  FuryGatewaySessionLease,
} from './gateway-session-node.js';
import {
  createFuryGatewayTransportCoordinator,
  FuryGatewayTransportError,
  type FuryGatewayTransportCommandPayload,
  type FuryGatewayTransportConnection,
  type FuryGatewayTransportCoordinator,
  type FuryGatewayTransportCoordinatorOptions,
  type FuryGatewayTransportReceipt,
} from './gateway-transport-node.js';

export const FURY_GATEWAY_WEBSOCKET_PATH = '/gateway/v1' as const;
export const FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL = 'furypipe.gateway.v1' as const;
export const FURY_GATEWAY_SERVER_MESSAGE_FORMAT = 'furypipe-gateway-server-message/v1' as const;

export type FuryGatewayWebSocketClientKind = 'browser' | 'device';

export interface FuryGatewayWebSocketResolvedConnection {
  readonly session: FuryGatewaySessionLease;
  readonly clientKind: FuryGatewayWebSocketClientKind;
  readonly currentDevice?: FuryGatewayAuthenticatedDevice;
  readonly pairing?: FuryGatewayPairingCoordinator;
}

export interface FuryGatewayWebSocketResolveContext {
  readonly request: IncomingMessage;
  readonly path: typeof FURY_GATEWAY_WEBSOCKET_PATH;
  readonly remoteAddress: string;
  readonly origin?: string;
}

export type FuryGatewayWebSocketConnectionResolver = (
  context: FuryGatewayWebSocketResolveContext,
) => FuryGatewayWebSocketResolvedConnection | undefined;

export type FuryGatewayWebSocketHttpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => boolean | Promise<boolean>;

export interface FuryGatewayWebSocketAdmittedStateCommand {
  readonly connectionId: string;
  readonly messageId: string;
  readonly sequence: number;
  readonly commandName: string;
  readonly input: unknown;
  readonly transportReceipt: FuryGatewayTransportReceipt;
  readonly admission: FuryGatewayCommandAdmissionDecision;
  readonly executionAuthority: false;
}

/**
 * State-only dispatch boundary.
 *
 * This callback is scheduled after command admission and MUST NOT perform
 * provider inference, tool/MCP execution, process execution, network access,
 * repository writes, or any other capability execution.
 */
export type FuryGatewayWebSocketStateCommandHandler = (
  command: FuryGatewayWebSocketAdmittedStateCommand,
) => unknown;

export type FuryGatewayWebSocketSafeEvent =
  | {
      readonly type: 'listening';
      readonly host: string;
      readonly port: number;
    }
  | {
      readonly type: 'connection-open';
      readonly connectionId: string;
      readonly clientKind: FuryGatewayWebSocketClientKind;
      readonly role: FuryGatewayRole;
    }
  | {
      readonly type: 'connection-close';
      readonly connectionId: string;
      readonly code: number;
    }
  | {
      readonly type: 'upgrade-denied';
      readonly reason:
        | 'route'
        | 'query'
        | 'protocol'
        | 'resolution'
        | 'transport-policy'
        | 'limit';
    }
  | {
      readonly type: 'protocol-error';
      readonly connectionId: string;
      readonly code: string;
    };

export interface FuryGatewayWebSocketHostOptions {
  readonly sessionCoordinator: FuryGatewaySessionCoordinator;
  readonly commandRegistry: FuryGatewayCommandRegistry;
  readonly resolveConnection: FuryGatewayWebSocketConnectionResolver;
  /**
   * Internal local HTTP surface used by bounded bootstrap/control routes.
   * Returning false delegates to the host's default 404.
   */
  readonly handleHttpRequest?: FuryGatewayWebSocketHttpRequestHandler;
  readonly handleAdmittedStateCommand?: FuryGatewayWebSocketStateCommandHandler;
  readonly host?: string;
  readonly port?: number;
  readonly allowedOrigins?: readonly string[];
  readonly maxPayloadBytes?: number;
  readonly maxConnections?: number;
  readonly maxConnectionsPerPrincipal?: number;
  readonly rateWindowMs?: number;
  readonly maxMessagesPerWindow?: number;
  readonly maxInFlightMessages?: number;
  readonly maxInFlightBytes?: number;
  readonly maxBufferedAmountBytes?: number;
  readonly heartbeatIntervalMs?: number;
  readonly maxPendingUpgrades?: number;
  readonly maxInFlightStateCommands?: number;
  readonly onEvent?: (event: FuryGatewayWebSocketSafeEvent) => void;
}

export interface FuryGatewayWebSocketHostAddress {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly path: typeof FURY_GATEWAY_WEBSOCKET_PATH;
  readonly subprotocol: typeof FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL;
}

export interface FuryGatewayWebSocketHostHandle {
  readonly address: FuryGatewayWebSocketHostAddress;
  readonly stop: () => Promise<void>;
}

export type FuryGatewayWebSocketHostErrorCode =
  | 'invalid-config'
  | 'remote-bind-forbidden'
  | 'listen-failed';

export class FuryGatewayWebSocketHostError extends Error {
  readonly code: FuryGatewayWebSocketHostErrorCode;

  constructor(code: FuryGatewayWebSocketHostErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayWebSocketHostError';
    this.code = code;
  }
}

interface ActiveSocketState {
  readonly ws: WebSocket;
  readonly connection: FuryGatewayTransportConnection;
  readonly resolved: FuryGatewayWebSocketResolvedConnection;
  alive: boolean;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 0;
const DEFAULT_MAX_BUFFERED_AMOUNT_BYTES = 512 * 1024;
const MAX_BUFFERED_AMOUNT_BYTES = 8 * 1024 * 1024;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const MIN_HEARTBEAT_INTERVAL_MS = 1_000;
const MAX_HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_MAX_PENDING_UPGRADES = 64;
const MAX_PENDING_UPGRADES = 1024;
const DEFAULT_MAX_IN_FLIGHT_STATE_COMMANDS = 32;
const MAX_IN_FLIGHT_STATE_COMMANDS = 256;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const MIN_MAX_PAYLOAD_BYTES = 1024;
const HARD_MAX_PAYLOAD_BYTES = 1024 * 1024;
const HTTP_HEADER_TIMEOUT_MS = 5_000;
const HTTP_REQUEST_TIMEOUT_MS = 5_000;
const MAX_HTTP_HEADERS = 64;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new FuryGatewayWebSocketHostError(
      'invalid-config',
      `${label} must be an integer between ${min} and ${max}`,
    );
  }
  return resolved;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === 'localhost';
}

function singleHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return undefined;
  return value;
}

function parseRequestedProtocols(request: IncomingMessage): readonly string[] {
  const header = singleHeader(request, 'sec-websocket-protocol');
  if (!header) return Object.freeze([]);
  const protocols = header
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Object.freeze(protocols);
}

function safeEmit(
  handler: FuryGatewayWebSocketHostOptions['onEvent'],
  event: FuryGatewayWebSocketSafeEvent,
): void {
  if (!handler) return;
  try {
    handler(event);
  } catch {
    // Observability callbacks are never transport authority.
  }
}

function rejectUpgrade(
  socket: Duplex,
  status: 400 | 401 | 404 | 429,
): void {
  const statusText = status === 400
    ? 'Bad Request'
    : status === 401
      ? 'Unauthorized'
      : status === 404
        ? 'Not Found'
        : 'Too Many Requests';
  try {
    socket.end(
      `HTTP/1.1 ${status} ${statusText}\r\n`
      + 'Connection: close\r\n'
      + 'Cache-Control: no-store\r\n'
      + 'Content-Length: 0\r\n'
      + '\r\n',
    );
  } catch {
    socket.destroy();
  }
}

function safeServerMessage(value: Record<string, unknown>): string {
  return JSON.stringify(Object.freeze({
    format: FURY_GATEWAY_SERVER_MESSAGE_FORMAT,
    ...value,
    executionAuthority: false,
  }));
}

function safeSend(
  ws: WebSocket,
  maxBufferedAmountBytes: number,
  payload: string,
): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (
    Buffer.byteLength(payload, 'utf8') > DEFAULT_MAX_PAYLOAD_BYTES
    || ws.bufferedAmount + Buffer.byteLength(payload, 'utf8') > maxBufferedAmountBytes
  ) {
    ws.close(1013, 'backpressure');
    return false;
  }
  try {
    ws.send(payload);
    return true;
  } catch {
    try {
      ws.terminate();
    } catch {
      // Socket is already unusable.
    }
    return false;
  }
}

function closeForTransportError(
  ws: WebSocket,
  connectionId: string,
  error: FuryGatewayTransportError,
  maxBufferedAmountBytes: number,
  onEvent: FuryGatewayWebSocketHostOptions['onEvent'],
): void {
  safeEmit(onEvent, {
    type: 'protocol-error',
    connectionId,
    code: error.code,
  });
  safeSend(
    ws,
    maxBufferedAmountBytes,
    safeServerMessage({
      type: 'error',
      connectionId,
      code: error.code,
    }),
  );
  const overload = error.code === 'rate-limited' || error.code === 'backpressure';
  ws.close(overload ? 1013 : 1008, overload ? 'overloaded' : 'policy-violation');
}

function rawDataToText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.concat(data).toString('utf8');
}

function makeTransportOptions(
  options: FuryGatewayWebSocketHostOptions,
  maxPayloadBytes: number,
): FuryGatewayTransportCoordinatorOptions {
  return {
    sessionCoordinator: options.sessionCoordinator,
    allowRemote: false,
    allowedOrigins: options.allowedOrigins,
    maxPayloadBytes,
    maxConnections: options.maxConnections,
    maxConnectionsPerPrincipal: options.maxConnectionsPerPrincipal,
    rateWindowMs: options.rateWindowMs,
    maxMessagesPerWindow: options.maxMessagesPerWindow,
    maxInFlightMessages: options.maxInFlightMessages,
    maxInFlightBytes: options.maxInFlightBytes,
  };
}

export async function listenFuryGatewayWebSocketHost(
  options: FuryGatewayWebSocketHostOptions,
): Promise<FuryGatewayWebSocketHostHandle> {
  if (
    !options
    || typeof options !== 'object'
    || !options.sessionCoordinator
    || !options.commandRegistry
    || typeof options.resolveConnection !== 'function'
  ) {
    throw new FuryGatewayWebSocketHostError(
      'invalid-config',
      'Gateway WebSocket host requires session, command and resolver dependencies',
    );
  }

  const host = options.host ?? DEFAULT_HOST;
  if (typeof host !== 'string' || !isLoopbackHost(host)) {
    throw new FuryGatewayWebSocketHostError(
      'remote-bind-forbidden',
      'Phase 1.3B Gateway WebSocket host is loopback-only',
    );
  }
  const port = boundedInteger(options.port, DEFAULT_PORT, 0, 65535, 'port');
  const maxPayloadBytes = boundedInteger(
    options.maxPayloadBytes,
    DEFAULT_MAX_PAYLOAD_BYTES,
    MIN_MAX_PAYLOAD_BYTES,
    HARD_MAX_PAYLOAD_BYTES,
    'maxPayloadBytes',
  );
  const maxBufferedAmountBytes = boundedInteger(
    options.maxBufferedAmountBytes,
    DEFAULT_MAX_BUFFERED_AMOUNT_BYTES,
    maxPayloadBytes,
    MAX_BUFFERED_AMOUNT_BYTES,
    'maxBufferedAmountBytes',
  );
  const heartbeatIntervalMs = boundedInteger(
    options.heartbeatIntervalMs,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    MIN_HEARTBEAT_INTERVAL_MS,
    MAX_HEARTBEAT_INTERVAL_MS,
    'heartbeatIntervalMs',
  );
  const maxPendingUpgrades = boundedInteger(
    options.maxPendingUpgrades,
    DEFAULT_MAX_PENDING_UPGRADES,
    1,
    MAX_PENDING_UPGRADES,
    'maxPendingUpgrades',
  );
  const maxInFlightStateCommands = boundedInteger(
    options.maxInFlightStateCommands,
    DEFAULT_MAX_IN_FLIGHT_STATE_COMMANDS,
    1,
    MAX_IN_FLIGHT_STATE_COMMANDS,
    'maxInFlightStateCommands',
  );

  const transport: FuryGatewayTransportCoordinator =
    createFuryGatewayTransportCoordinator(
      makeTransportOptions(options, maxPayloadBytes),
    );

  const respondNotFound = (response: ServerResponse): void => {
    if (response.writableEnded || response.headersSent) return;
    response.writeHead(404, {
      'cache-control': 'no-store',
      'content-length': '0',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    });
    response.end();
  };

  const server: HttpServer = createServer((request, response) => {
    const handler = options.handleHttpRequest;
    if (!handler) {
      respondNotFound(response);
      return;
    }

    Promise.resolve()
      .then(() => handler(request, response))
      .then((handled) => {
        if (!handled) respondNotFound(response);
      })
      .catch(() => {
        if (response.writableEnded) return;
        if (response.headersSent) {
          response.destroy();
          return;
        }
        response.writeHead(500, {
          'cache-control': 'no-store',
          'content-length': '0',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        });
        response.end();
      });
  });
  server.maxHeadersCount = MAX_HTTP_HEADERS;
  server.headersTimeout = HTTP_HEADER_TIMEOUT_MS;
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;

  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: maxPayloadBytes,
    perMessageDeflate: false,
    handleProtocols(protocols) {
      return protocols.has(FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL)
        ? FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL
        : false;
    },
  });

  const active = new Map<WebSocket, ActiveSocketState>();
  let pendingUpgrades = 0;
  let inFlightStateCommands = 0;
  let stopped = false;

  const cleanupSocket = (
    state: ActiveSocketState,
    code: number,
  ): void => {
    if (active.delete(state.ws)) {
      transport.closeConnection(state.connection);
      safeEmit(options.onEvent, {
        type: 'connection-close',
        connectionId: state.connection.connectionId,
        code,
      });
    }
  };

  wss.on('connection', (ws) => {
    // Connections are installed by the handleUpgrade callback below.
    ws.on('error', () => {
      // Error details are intentionally not emitted to the safe event channel.
    });
  });

  server.on('upgrade', (request, socket, head) => {
    if (stopped) {
      rejectUpgrade(socket, 401);
      return;
    }
    if (pendingUpgrades >= maxPendingUpgrades) {
      safeEmit(options.onEvent, { type: 'upgrade-denied', reason: 'limit' });
      rejectUpgrade(socket, 429);
      return;
    }

    pendingUpgrades += 1;
    let connection: FuryGatewayTransportConnection | undefined;
    try {
      const rawUrl = request.url;
      if (typeof rawUrl !== 'string') {
        safeEmit(options.onEvent, { type: 'upgrade-denied', reason: 'route' });
        rejectUpgrade(socket, 404);
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(rawUrl, 'http://127.0.0.1');
      } catch {
        safeEmit(options.onEvent, { type: 'upgrade-denied', reason: 'route' });
        rejectUpgrade(socket, 400);
        return;
      }
      if (parsed.pathname !== FURY_GATEWAY_WEBSOCKET_PATH) {
        safeEmit(options.onEvent, { type: 'upgrade-denied', reason: 'route' });
        rejectUpgrade(socket, 404);
        return;
      }
      if (parsed.search !== '' || parsed.hash !== '') {
        safeEmit(options.onEvent, { type: 'upgrade-denied', reason: 'query' });
        rejectUpgrade(socket, 400);
        return;
      }

      const protocols = parseRequestedProtocols(request);
      if (
        protocols.length !== 1
        || protocols[0] !== FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL
      ) {
        safeEmit(options.onEvent, { type: 'upgrade-denied', reason: 'protocol' });
        rejectUpgrade(socket, 400);
        return;
      }

      const remoteAddress = request.socket.remoteAddress ?? '';
      const origin = singleHeader(request, 'origin');
      const resolvedInput = options.resolveConnection(Object.freeze({
        request,
        path: FURY_GATEWAY_WEBSOCKET_PATH,
        remoteAddress,
        ...(origin === undefined ? {} : { origin }),
      }));
      if (!resolvedInput) {
        safeEmit(options.onEvent, { type: 'upgrade-denied', reason: 'resolution' });
        rejectUpgrade(socket, 401);
        return;
      }
      const resolved: FuryGatewayWebSocketResolvedConnection = Object.freeze({
        session: resolvedInput.session,
        clientKind: resolvedInput.clientKind,
        ...(resolvedInput.currentDevice === undefined
          ? {}
          : { currentDevice: resolvedInput.currentDevice }),
        ...(resolvedInput.pairing === undefined
          ? {}
          : { pairing: resolvedInput.pairing }),
      });

      try {
        connection = transport.openConnection({
          session: resolved.session,
          clientKind: resolved.clientKind,
          remoteAddress,
          ...(origin === undefined ? {} : { origin }),
        });
      } catch (error) {
        safeEmit(options.onEvent, {
          type: 'upgrade-denied',
          reason: error instanceof FuryGatewayTransportError
            && (
              error.code === 'connection-limit'
              || error.code === 'principal-connection-limit'
            )
            ? 'limit'
            : 'transport-policy',
        });
        rejectUpgrade(
          socket,
          error instanceof FuryGatewayTransportError
            && (
              error.code === 'connection-limit'
              || error.code === 'principal-connection-limit'
            )
            ? 429
            : 401,
        );
        return;
      }

      const boundConnection = connection;
      wss.handleUpgrade(request, socket, head, (ws) => {
        const state: ActiveSocketState = {
          ws,
          connection: boundConnection,
          resolved,
          alive: true,
        };
        active.set(ws, state);
        wss.emit('connection', ws, request);

        ws.on('pong', () => {
          state.alive = true;
        });

        ws.on('message', (data, isBinary) => {
          if (isBinary) {
            ws.close(1003, 'binary-not-supported');
            return;
          }

          let accepted:
            ReturnType<FuryGatewayTransportCoordinator['acceptTextMessage']>
            | undefined;
          try {
            accepted = transport.acceptTextMessage(
              state.connection,
              rawDataToText(data),
            );

            if (accepted.message.type === 'command') {
              const evaluated = transport.evaluateCommand({
                connection: state.connection,
                accepted,
                commandRegistry: options.commandRegistry,
                ...(state.resolved.currentDevice === undefined
                  ? {}
                  : { currentDevice: state.resolved.currentDevice }),
                ...(state.resolved.pairing === undefined
                  ? {}
                  : { pairing: state.resolved.pairing }),
              });
              safeSend(
                ws,
                maxBufferedAmountBytes,
                safeServerMessage({
                  type: 'command-admission',
                  connectionId: state.connection.connectionId,
                  messageId: dispatch.messageId,
                  sequence: dispatch.sequence,
                  transportReceipt: evaluated.transportReceipt,
                  admission: evaluated.admission,
                }),
              );

              if (
                evaluated.admission.outcome === 'eligible'
                && options.handleAdmittedStateCommand
              ) {
                const payload =
                  accepted.message.payload as FuryGatewayTransportCommandPayload;
                if (inFlightStateCommands >= maxInFlightStateCommands) {
                  safeSend(
                    ws,
                    maxBufferedAmountBytes,
                    safeServerMessage({
                      type: 'state-command-result',
                      connectionId: state.connection.connectionId,
                      messageId: dispatch.messageId,
                      sequence: dispatch.sequence,
                      commandName: payload.commandName,
                      result: Object.freeze({
                        status: 'rejected',
                        error: Object.freeze({ code: 'state-command-backpressure' }),
                        executionAuthority: false,
                      }),
                    }),
                  );
                } else {
                  inFlightStateCommands += 1;
                  const dispatch = Object.freeze({
                    connectionId: state.connection.connectionId,
                    messageId: dispatch.messageId,
                    sequence: dispatch.sequence,
                    commandName: payload.commandName,
                    input: payload.input,
                    transportReceipt: evaluated.transportReceipt,
                    admission: evaluated.admission,
                    executionAuthority: false as const,
                  });
                  queueMicrotask(() => {
                    try {
                      const result = options.handleAdmittedStateCommand?.(dispatch);
                      if (
                        result
                        && typeof result === 'object'
                        && typeof (result as { then?: unknown }).then === 'function'
                      ) {
                        throw new Error('state command handlers must be synchronous');
                      }
                      safeSend(
                        ws,
                        maxBufferedAmountBytes,
                        safeServerMessage({
                          type: 'state-command-result',
                          connectionId: state.connection.connectionId,
                          messageId: dispatch.messageId,
                          sequence: dispatch.sequence,
                          commandName: payload.commandName,
                          result,
                        }),
                      );
                    } catch {
                      safeSend(
                        ws,
                        maxBufferedAmountBytes,
                        safeServerMessage({
                          type: 'state-command-result',
                          connectionId: state.connection.connectionId,
                          messageId: dispatch.messageId,
                          sequence: dispatch.sequence,
                          commandName: payload.commandName,
                          result: Object.freeze({
                            status: 'rejected',
                            error: Object.freeze({ code: 'state-command-handler-error' }),
                            executionAuthority: false,
                          }),
                        }),
                      );
                    } finally {
                      inFlightStateCommands = Math.max(0, inFlightStateCommands - 1);
                    }
                  });
                }
              }
            } else if (accepted.message.type === 'ping') {
              const payload = accepted.message.payload as { readonly nonce: string };
              safeSend(
                ws,
                maxBufferedAmountBytes,
                safeServerMessage({
                  type: 'pong',
                  connectionId: state.connection.connectionId,
                  messageId: dispatch.messageId,
                  sequence: dispatch.sequence,
                  nonce: payload.nonce,
                }),
              );
            } else {
              safeSend(
                ws,
                maxBufferedAmountBytes,
                safeServerMessage({
                  type: 'resync-unavailable',
                  connectionId: state.connection.connectionId,
                  messageId: dispatch.messageId,
                  sequence: dispatch.sequence,
                }),
              );
            }
          } catch (error) {
            if (error instanceof FuryGatewayTransportError) {
              closeForTransportError(
                ws,
                state.connection.connectionId,
                error,
                maxBufferedAmountBytes,
                options.onEvent,
              );
            } else {
              ws.close(1011, 'internal-error');
            }
          } finally {
            accepted?.release();
          }
        });

        ws.once('close', (code) => {
          cleanupSocket(state, code);
        });

        safeSend(
          ws,
          maxBufferedAmountBytes,
          safeServerMessage({
            type: 'connected',
            connectionId: state.connection.connectionId,
            role: state.connection.role,
            clientKind: state.connection.clientKind,
            subprotocol: FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL,
          }),
        );
        safeEmit(options.onEvent, {
          type: 'connection-open',
          connectionId: state.connection.connectionId,
          clientKind: state.connection.clientKind,
          role: state.connection.role,
        });
      });
      connection = undefined;
    } catch {
      if (connection) transport.closeConnection(connection);
      socket.destroy();
    } finally {
      pendingUpgrades = Math.max(0, pendingUpgrades - 1);
    }
  });

  const heartbeat = setInterval(() => {
    for (const state of active.values()) {
      if (state.ws.readyState !== WebSocket.OPEN) continue;
      if (!state.alive) {
        state.ws.terminate();
        continue;
      }
      state.alive = false;
      try {
        state.ws.ping();
      } catch {
        state.ws.terminate();
      }
    }
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  } catch {
    clearInterval(heartbeat);
    wss.close();
    throw new FuryGatewayWebSocketHostError(
      'listen-failed',
      'Gateway WebSocket host could not listen on the requested loopback address',
    );
  }

  const address = server.address();
  if (!address || typeof address === 'string') {
    clearInterval(heartbeat);
    wss.close();
    server.close();
    throw new FuryGatewayWebSocketHostError(
      'listen-failed',
      'Gateway WebSocket host returned an unsupported listen address',
    );
  }
  const info = address as AddressInfo;
  const publicAddress = Object.freeze({
    host,
    port: info.port,
    url: `ws://${host === '::1' ? '[::1]' : host}:${info.port}${FURY_GATEWAY_WEBSOCKET_PATH}`,
    path: FURY_GATEWAY_WEBSOCKET_PATH,
    subprotocol: FURY_GATEWAY_WEBSOCKET_SUBPROTOCOL,
  });

  safeEmit(options.onEvent, {
    type: 'listening',
    host,
    port: info.port,
  });

  let stopPromise: Promise<void> | undefined;
  return Object.freeze({
    address: publicAddress,
    stop(): Promise<void> {
      if (stopPromise) return stopPromise;
      stopped = true;
      clearInterval(heartbeat);

      for (const state of [...active.values()]) {
        try {
          state.ws.close(1001, 'server-shutdown');
        } catch {
          state.ws.terminate();
        }
        cleanupSocket(state, 1001);
      }

      stopPromise = new Promise<void>((resolve) => {
        wss.close();
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
        setTimeout(() => {
          server.closeAllConnections?.();
          resolve();
        }, 2_000).unref?.();
      });
      return stopPromise;
    },
  });
}