import { randomBytes } from 'node:crypto';
import * as os from 'node:os';

import { createFuryGatewayCommandRegistry } from './gateway-command-authorization-node.js';
import {
  FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
  createFuryGatewayConversationAdapter,
  type FuryGatewayConversationCommandName,
} from './gateway-conversation-adapter-node.js';
import { createFuryKernelConversationStore } from './fury-kernel.js';
import {
  FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS,
  FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES,
} from './gateway-model-command-node.js';
import {
  createFuryGatewayLocalModelRuntime,
  type FuryGatewayLocalModelConfig,
} from './gateway-local-model-runtime-node.js';
import {
  FURY_GATEWAY_WEBCHAT_PATH,
  createFuryGatewayWebChatHandler,
} from './gateway-webchat-node.js';
import {
  createFuryGatewayLocalBootstrapManager,
  type FuryGatewayLocalBootstrapTicket,
} from './gateway-local-operator-bootstrap-node.js';
import {
  resolveFuryGatewayLocalConfig,
  type FuryGatewayLocalConfigOptions,
  type FuryGatewayLocalConfigResolution,
} from './gateway-local-config-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from './gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewayScope,
} from './gateway-session-node.js';
import {
  startFuryGatewayDaemon,
  type FuryGatewayDaemonHandle,
} from './gateway-runtime-daemon-node.js';

export interface FuryGatewayLocalRuntime {
  readonly daemon: FuryGatewayDaemonHandle;
  readonly ticket: FuryGatewayLocalBootstrapTicket;
  readonly config: FuryGatewayLocalConfigResolution;
  readonly model: FuryGatewayLocalModelConfig;
  stop(): Promise<void>;
}

export interface FuryGatewayLocalRuntimeOptions extends FuryGatewayLocalConfigOptions {
  readonly now?: () => number;
  readonly localSubject?: string;
}

export interface FuryGatewayCliWriter {
  write(value: string): unknown;
}

export interface FuryGatewayCliIo {
  readonly stdout: FuryGatewayCliWriter;
  readonly stderr: FuryGatewayCliWriter;
}

export interface FuryGatewayCliDependencies {
  readonly startRuntime?: (
    options?: FuryGatewayLocalRuntimeOptions,
  ) => Promise<FuryGatewayLocalRuntime>;
  readonly resolveConfig?: (
    options?: FuryGatewayLocalConfigOptions,
  ) => FuryGatewayLocalConfigResolution;
  readonly waitForShutdown?: () => Promise<void>;
  readonly io?: FuryGatewayCliIo;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export type FuryGatewayCliCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'config'; readonly json: boolean }
  | { readonly kind: 'start'; readonly json: boolean };

export class FuryGatewayCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FuryGatewayCliUsageError';
  }
}

const LOCAL_OPERATOR_SCOPES = Object.freeze([
  'gateway.inspect',
  'conversations.inspect',
  'conversations.write',
] as const);

function localSubject(): string {
  const user = os.userInfo();
  const username = user.username?.trim() || 'unknown';
  const uid = Number.isSafeInteger(user.uid) ? String(user.uid) : 'unknown';
  const home = os.homedir();
  return `local-os-user:${process.platform}:${uid}:${username}:${home}`;
}

function validateLocalSubject(subject: string): string {
  const normalized = subject.trim();
  if (
    normalized.length === 0
    || Buffer.byteLength(normalized, 'utf8') > 512
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error('local Gateway OS subject must be bounded printable text');
  }
  return normalized;
}

export async function startFuryGatewayLocalRuntime(
  options: FuryGatewayLocalRuntimeOptions = {},
): Promise<FuryGatewayLocalRuntime> {
  const now = options.now ?? Date.now;
  const config = resolveFuryGatewayLocalConfig({
    ...(options.file === undefined ? {} : { file: options.file }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  const modelRuntime = createFuryGatewayLocalModelRuntime({
    kernel,
    ...(options.env === undefined ? {} : { env: options.env }),
    now,
  });
  const operatorScopes: FuryGatewayScope[] = [...LOCAL_OPERATOR_SCOPES];
  if (modelRuntime.bridge) operatorScopes.push('capability.provider-inference');

  const principalRegistry = createFuryGatewayPrincipalRegistry({
    now,
    evidenceTtlMs: 15 * 60_000,
    maxPrincipals: 4,
  });
  const principal = principalRegistry.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'local-owner',
    kind: 'human',
    issuer: 'furypipe-local-os',
    subject: validateLocalSubject(options.localSubject ?? localSubject()),
    authenticationMethod: 'local-owner',
  });

  const gatewayInstanceId = `gateway-local-${randomBytes(12).toString('hex')}`;
  const sessionCoordinator = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId,
    now,
    defaultTtlMs: 60 * 60_000,
    maxTtlMs: 60 * 60_000,
    maxSessions: 32,
  });
  const session = sessionCoordinator.issueSession({
    principal,
    role: 'operator',
    scopes: operatorScopes,
    binding: { kind: 'local-operator' },
    expiresInMs: 60 * 60_000,
  });

  const bootstrap = createFuryGatewayLocalBootstrapManager({
    sessionCoordinator,
    session,
    allowedOrigins: [config.config.origin],
    now,
    bootstrapTtlMs: config.config.bootstrapTtlMs,
    browserSessionTtlMs: config.config.browserSessionTtlMs,
    maxPendingTickets: 8,
    maxBrowserSessions: 16,
  });

  const ticket = bootstrap.issueTicket();
  const webchat = createFuryGatewayWebChatHandler({
    origin: config.config.origin,
    modelBridgeEnabled: modelRuntime.bridge !== undefined,
    ...(modelRuntime.config.enabled
      ? {
          modelProvider: modelRuntime.config.providerId,
          model: modelRuntime.config.model,
        }
      : {}),
  });
  const kernel = createFuryKernelConversationStore({
    maxConversations: 32,
    maxMessagesPerConversation: 256,
    maxTurnsPerConversation: 128,
    maxMessageBytes: 32 * 1024,
    maxConversationBytes: 512 * 1024,
    maxInFlightTurns: 16,
    now,
  });
  const conversationAdapter = createFuryGatewayConversationAdapter({
    kernel,
    maxResultBytes: 48 * 1024,
  });
  const commandRegistry = createFuryGatewayCommandRegistry([
    ...FURY_GATEWAY_CONVERSATION_COMMAND_DEFINITIONS,
    ...(modelRuntime.bridge
      ? FURY_GATEWAY_MODEL_EXECUTION_COMMAND_DEFINITIONS
      : []),
  ]);

  let daemon: FuryGatewayDaemonHandle;
  try {
    daemon = await startFuryGatewayDaemon({
      sessionCoordinator,
      commandRegistry,
      handleHttpRequest: async (request, response) => {
        if (await webchat(request, response)) return true;
        return bootstrap.handleHttpRequest(request, response);
      },
      admittedStateCommandNames: FURY_GATEWAY_CONVERSATION_COMMAND_NAMES,
      handleAdmittedStateCommand: (command) => {
        if (
          !(FURY_GATEWAY_CONVERSATION_COMMAND_NAMES as readonly string[])
            .includes(command.commandName)
        ) {
          throw new Error('local Gateway state command is unsupported');
        }
        const result = conversationAdapter.dispatch(
          command.commandName as FuryGatewayConversationCommandName,
          command.input,
        );
        if (
          command.commandName === 'conversation.cancel'
          && result.status === 'ok'
          && modelRuntime.bridge
        ) {
          const input = command.input as {
            readonly conversationId: string;
            readonly turnId: string;
          };
          modelRuntime.bridge.cancelTurn(input.conversationId, input.turnId);
        }
        return result;
      },
      ...(modelRuntime.bridge
        ? {
            admittedExecutionCommandNames:
              FURY_GATEWAY_MODEL_EXECUTION_COMMAND_NAMES,
            handleAdmittedExecutionCommand: async (command) => {
              if (command.commandName !== 'conversation.model.execute') {
                throw new Error('local Gateway execution command is unsupported');
              }
              return modelRuntime.bridge!.executeTurn(
                command.input as {
                  readonly conversationId: string;
                  readonly turnId: string;
                },
              );
            },
          }
        : {}),
      resolveConnection: ({ request }) => bootstrap.resolveConnection(request),
      config: {
        host: config.config.host,
        port: config.config.port,
        allowedOrigins: [config.config.origin],
        maxEventHistory: config.config.maxEventHistory,
      },
      now,
    });
  } catch (error) {
    sessionCoordinator.revokeSession(session.sessionId);
    principalRegistry.revokePrincipal(principal.principalId);
    throw error;
  }

  let stopped = false;
  return Object.freeze({
    daemon,
    ticket,
    config,
    model: modelRuntime.config,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      bootstrap.revokeAllBrowserSessions();
      await daemon.stop();
      sessionCoordinator.revokeSession(session.sessionId);
      principalRegistry.revokePrincipal(principal.principalId);
    },
  });
}

export function parseFuryGatewayCliArgs(
  argv: readonly string[],
): FuryGatewayCliCommand {
  if (!Array.isArray(argv)) {
    throw new FuryGatewayCliUsageError('Gateway CLI arguments must be an array');
  }
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    if (argv.length > 1) {
      throw new FuryGatewayCliUsageError('Gateway help accepts no extra arguments');
    }
    return Object.freeze({ kind: 'help' as const });
  }

  const command = argv[0];
  if (command !== 'start' && command !== 'config') {
    throw new FuryGatewayCliUsageError(`unknown gateway command: ${command}`);
  }

  let json = false;
  for (const arg of argv.slice(1)) {
    if (arg === '--json') {
      if (json) throw new FuryGatewayCliUsageError('duplicate --json option');
      json = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      throw new FuryGatewayCliUsageError(
        `use \`furypipe gateway --help\` for Gateway usage`,
      );
    }
    throw new FuryGatewayCliUsageError(`unknown gateway option: ${arg}`);
  }

  return Object.freeze({
    kind: command,
    json,
  } as FuryGatewayCliCommand);
}

export function furyGatewayCliHelp(): string {
  return [
    'FuryPipe Gateway — local VNext control-plane runtime',
    '',
    'Usage:',
    '  furypipe gateway start [--json]',
    '                        start the loopback-only Gateway in the foreground',
    '  furypipe gateway config [--json]',
    '                        print the resolved local Gateway configuration',
    '  furypipe gateway --help',
    '                        show this help',
    '',
    'Environment:',
    '  FURYPIPE_CONFIG        FuryPipe config JSON path',
    '  FURYPIPE_GATEWAY_HOST  127.0.0.1, ::1, or localhost only',
    '  FURYPIPE_GATEWAY_PORT  local Gateway port (default 48722)',
    '',
    'Security:',
    '  The local Gateway never treats localhost as authentication.',
    '  Start emits one short-lived one-time bootstrap code.',
    '  No command execution authority is granted by this CLI phase.',
  ].join('\n');
}

function renderConfig(
  resolution: FuryGatewayLocalConfigResolution,
  json: boolean,
): string {
  if (json) {
    return JSON.stringify({
      format: 'furypipe-gateway-local-config/v1',
      config: resolution.config,
      sources: resolution.sources,
    }, null, 2);
  }

  return [
    'FuryPipe Gateway config',
    `  listen:      ${resolution.config.host}:${resolution.config.port}`,
    `  origin:      ${resolution.config.origin}`,
    `  bootstrap:   ${resolution.config.bootstrapTtlMs} ms`,
    `  browser TTL: ${resolution.config.browserSessionTtlMs} ms`,
    `  event limit: ${resolution.config.maxEventHistory}`,
    `  config file: ${resolution.sources.file}`,
  ].join('\n');
}

function renderStart(
  runtime: FuryGatewayLocalRuntime,
  json: boolean,
): string {
  if (json) {
    return JSON.stringify({
      format: 'furypipe-gateway-local-start/v1',
      status: 'ready',
      websocketUrl: runtime.daemon.address.url,
      webChatUrl: `${runtime.config.config.origin}${FURY_GATEWAY_WEBCHAT_PATH}`,
      origin: runtime.config.config.origin,
      bootstrap: {
        format: runtime.ticket.format,
        code: runtime.ticket.code,
        expiresAt: runtime.ticket.expiresAt,
      },
      authority: 'bootstrap-only',
      executionAuthority: false,
    }, null, 2);
  }

  return [
    'FuryPipe Gateway ready',
    `  WebSocket: ${runtime.daemon.address.url}`,
    `  WebChat:   ${runtime.config.config.origin}${FURY_GATEWAY_WEBCHAT_PATH}`,
    `  Origin:    ${runtime.config.config.origin}`,
    '',
    'Local browser bootstrap code (one-time, short-lived):',
    `  ${runtime.ticket.code}`,
    '',
    `Expires at: ${new Date(runtime.ticket.expiresAt).toISOString()}`,
    '',
    'This code authenticates a local browser session only.',
    'It is not a command or execution permit.',
    'Press Ctrl+C to stop the Gateway.',
  ].join('\n');
}

function defaultWaitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      process.off('SIGINT', finish);
      process.off('SIGTERM', finish);
      resolve();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

export async function runFuryGatewayCli(
  argv: readonly string[],
  dependencies: FuryGatewayCliDependencies = {},
): Promise<number> {
  const io = dependencies.io ?? {
    stdout: process.stdout,
    stderr: process.stderr,
  };
  const resolveConfig = dependencies.resolveConfig ?? resolveFuryGatewayLocalConfig;
  const startRuntime = dependencies.startRuntime ?? startFuryGatewayLocalRuntime;
  const waitForShutdown = dependencies.waitForShutdown ?? defaultWaitForShutdown;
  const env = dependencies.env ?? process.env;

  let parsed: FuryGatewayCliCommand;
  try {
    parsed = parseFuryGatewayCliArgs(argv);
  } catch (error) {
    io.stderr.write(`[furypipe gateway] ${(error as Error).message}\n`);
    io.stderr.write('Run `furypipe gateway --help` for usage.\n');
    return 2;
  }

  if (parsed.kind === 'help') {
    io.stdout.write(furyGatewayCliHelp() + '\n');
    return 0;
  }

  if (parsed.kind === 'config') {
    try {
      const resolution = resolveConfig({ env });
      io.stdout.write(renderConfig(resolution, parsed.json) + '\n');
      return 0;
    } catch (error) {
      io.stderr.write(`[furypipe gateway] config: ${(error as Error).message}\n`);
      return 1;
    }
  }

  let runtime: FuryGatewayLocalRuntime;
  try {
    runtime = await startRuntime({ env });
  } catch (error) {
    io.stderr.write(`[furypipe gateway] start: ${(error as Error).message}\n`);
    return 1;
  }

  io.stdout.write(renderStart(runtime, parsed.json) + '\n');

  try {
    await waitForShutdown();
  } finally {
    await runtime.stop();
  }
  return 0;
}