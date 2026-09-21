import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable, Transform, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

import {
  isGeneratedCodingSandbox,
  type CodingSandbox,
} from './coding-runtime.js';

export const FURY_ACP_EXTERNAL_AGENT_DESCRIPTOR_FORMAT =
  'furypipe-acp-external-agent-descriptor/v1' as const;
export const FURY_ACP_EXTERNAL_AGENT_REGISTRY_FORMAT =
  'furypipe-acp-external-agent-registry/v1' as const;
export const FURY_ACP_EXTERNAL_SESSION_FORMAT =
  'furypipe-acp-external-session/v1' as const;
export const FURY_ACP_EXTERNAL_SESSION_SNAPSHOT_FORMAT =
  'furypipe-acp-external-session-snapshot/v1' as const;

const MAX_AGENTS = 64;
const MAX_ARGS = 64;
const MAX_ARG_BYTES = 8 * 1024;
const MAX_TEXT_BYTES = 4 * 1024;
const MAX_ENV = 64;
const MAX_ENV_VALUE_BYTES = 8 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_COMMAND = /^[A-Za-z0-9._-]{1,128}$/u;
const SAFE_ENV = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function boundedText(
  value: unknown,
  label: string,
  maxBytes = MAX_TEXT_BYTES,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim().length === 0
    || value.includes('\0')
    || bytes(value) > maxBytes
  ) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      label + ' is invalid or exceeds its bound',
    );
  }
  return value;
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      label + ' must be a plain data object',
    );
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !allowed.has(key)) {
      throw new FuryAcpExternalClientError(
        'invalid-config',
        label + ' contains unsupported fields',
      );
    }
  }
  return record;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (
    typeof resolved !== 'number'
    || !Number.isSafeInteger(resolved)
    || resolved < min
    || resolved > max
  ) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      label + ' is outside its bound',
    );
  }
  return resolved;
}

function finiteNow(now: () => number): number {
  const value = Math.floor(now());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      'external ACP clock must return a safe non-negative timestamp',
    );
  }
  return value;
}

export interface FuryAcpExternalAgentConfig {
  readonly agentId: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly expectedAgentName?: string;
  readonly startupTimeoutMs?: number;
}

export interface FuryAcpExternalAgentDescriptor {
  readonly format: typeof FURY_ACP_EXTERNAL_AGENT_DESCRIPTOR_FORMAT;
  readonly agentId: string;
  readonly identitySha256: string;
  readonly commandSha256: string;
  readonly cwdSha256: string;
  readonly protocolVersion: 1;
  readonly authority: 'configured-agent-evidence-only';
  readonly executionAuthority: false;
  readonly delegationAuthority: false;
}

export interface FuryAcpExternalAgentRegistry {
  readonly format: typeof FURY_ACP_EXTERNAL_AGENT_REGISTRY_FORMAT;
  resolve(agentId: string): FuryAcpExternalAgentDescriptor | undefined;
  list(): readonly FuryAcpExternalAgentDescriptor[];
  readonly authority: 'configured-agent-registry-only';
  readonly executionAuthority: false;
}

export interface FuryAcpExternalSession {
  readonly format: typeof FURY_ACP_EXTERNAL_SESSION_FORMAT;
  readonly sessionHandleId: string;
  readonly agentId: string;
  readonly agentIdentitySha256: string;
  readonly protocolVersion: 1;
  readonly authority: 'external-session-handle-only';
  readonly delegationAuthority: false;
  readonly executionAuthority: false;
}

export interface FuryAcpExternalSessionSnapshot {
  readonly format: typeof FURY_ACP_EXTERNAL_SESSION_SNAPSHOT_FORMAT;
  readonly sessionHandleIdSha256: string;
  readonly agentId: string;
  readonly agentIdentitySha256: string;
  readonly protocolVersion: 1;
  readonly acpSessionIdSha256: string;
  readonly agentCapabilitiesSha256: string;
  readonly reportedAgentNameSha256?: string;
  readonly createdAt: number;
  readonly state: 'ready' | 'closed' | 'disconnected';
  readonly automaticReplayAllowed: false;
  readonly authority: 'external-session-evidence-only';
  readonly delegationAuthority: false;
  readonly executionAuthority: false;
}

export class FuryAcpExternalClientError extends Error {
  readonly retrySafe = false;

  constructor(
    readonly code:
      | 'invalid-config'
      | 'invalid-registry'
      | 'unknown-agent'
      | 'invalid-agent'
      | 'policy-denied'
      | 'process-limit'
      | 'spawn-failed'
      | 'startup-timeout'
      | 'transport-closed'
      | 'output-limit'
      | 'protocol-mismatch'
      | 'identity-mismatch'
      | 'session-failed'
      | 'invalid-session',
    message: string,
  ) {
    super(message);
    this.name = 'FuryAcpExternalClientError';
  }
}

interface NormalizedAgentConfig {
  readonly agentId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly expectedAgentName?: string;
  readonly startupTimeoutMs: number;
  readonly identitySha256: string;
  readonly commandSha256: string;
  readonly cwdSha256: string;
}

interface DescriptorState {
  readonly registry: FuryAcpExternalAgentRegistry;
  readonly config: NormalizedAgentConfig;
}

interface ExternalSessionState {
  readonly runtime: object;
  readonly descriptor: FuryAcpExternalAgentDescriptor;
  readonly acpSessionId: string;
  readonly agentCapabilitiesSha256: string;
  readonly reportedAgentNameSha256?: string;
  readonly createdAt: number;
  readonly child: ReturnType<typeof spawn>;
  readonly connection: acp.ClientConnection;
  readonly finalize: () => void;
  state: 'ready' | 'closed' | 'disconnected';
}

const REGISTRIES = new WeakSet<object>();
const DESCRIPTORS = new WeakMap<object, DescriptorState>();
const SESSIONS = new WeakMap<object, ExternalSessionState>();

function normalizeEnvironment(
  value: unknown,
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      'external agent environment must be a plain data object',
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.getOwnPropertyNames(record);
  if (keys.length > MAX_ENV) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      'external agent environment exceeds its entry bound',
    );
  }
  const normalized: Record<string, string> = {};
  for (const key of keys.sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !SAFE_ENV.test(key)
      || key === '__proto__'
      || key === 'constructor'
      || key === 'prototype'
    ) {
      throw new FuryAcpExternalClientError(
        'invalid-config',
        'external agent environment name is invalid',
      );
    }
    const raw = descriptor.value;
    if (typeof raw !== 'string' || raw.includes('\0') || bytes(raw) > MAX_ENV_VALUE_BYTES) {
      throw new FuryAcpExternalClientError(
        'invalid-config',
        'external agent environment value is invalid or exceeds its bound',
      );
    }
    normalized[key] = raw;
  }
  return Object.freeze(normalized);
}

function normalizeAgentConfig(value: FuryAcpExternalAgentConfig): NormalizedAgentConfig {
  const record = exactObject(
    value,
    [
      'agentId',
      'command',
      'args',
      'cwd',
      'environment',
      'expectedAgentName',
      'startupTimeoutMs',
    ],
    'external agent config',
  );
  const agentId = boundedText(record.agentId, 'external agent ID', 128);
  if (!SAFE_ID.test(agentId)) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      'external agent ID contains unsupported characters',
    );
  }
  const command = boundedText(record.command, 'external agent command', 128);
  if (!SAFE_COMMAND.test(command)) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      'external agent command must be a bare executable name',
    );
  }
  const argsRaw = record.args ?? [];
  if (
    !Array.isArray(argsRaw)
    || argsRaw.length > MAX_ARGS
    || argsRaw.some((_, index) => !Object.prototype.hasOwnProperty.call(argsRaw, index))
  ) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      'external agent args are invalid',
    );
  }
  const args = Object.freeze(argsRaw.map((arg) => {
    if (typeof arg !== 'string' || arg.includes('\0') || bytes(arg) > MAX_ARG_BYTES) {
      throw new FuryAcpExternalClientError(
        'invalid-config',
        'external agent argument is invalid or exceeds its bound',
      );
    }
    return arg;
  }));
  const cwd = boundedText(record.cwd, 'external agent cwd');
  const environment = normalizeEnvironment(record.environment);
  const expectedAgentName = record.expectedAgentName === undefined
    ? undefined
    : boundedText(record.expectedAgentName, 'expected external agent name', 128);
  const startupTimeoutMs = boundedInteger(
    record.startupTimeoutMs,
    10_000,
    1,
    60_000,
    'external agent startup timeout',
  );
  const identitySha256 = sha256(JSON.stringify({
    agentId,
    command: command.toLowerCase(),
    args,
    cwd,
    environment: Object.entries(environment).map(([name, item]) => [
      name,
      sha256(item),
    ]),
    expectedAgentName,
    protocolVersion: acp.PROTOCOL_VERSION,
  }));
  return Object.freeze({
    agentId,
    command,
    args,
    cwd,
    environment,
    ...(expectedAgentName === undefined ? {} : { expectedAgentName }),
    startupTimeoutMs,
    identitySha256,
    commandSha256: sha256(JSON.stringify({
      command: command.toLowerCase(),
      args,
    })),
    cwdSha256: sha256(cwd),
  });
}

function descriptorFor(
  registry: FuryAcpExternalAgentRegistry,
  config: NormalizedAgentConfig,
): FuryAcpExternalAgentDescriptor {
  const descriptor = Object.freeze({
    format: FURY_ACP_EXTERNAL_AGENT_DESCRIPTOR_FORMAT,
    agentId: config.agentId,
    identitySha256: config.identitySha256,
    commandSha256: config.commandSha256,
    cwdSha256: config.cwdSha256,
    protocolVersion: acp.PROTOCOL_VERSION,
    authority: 'configured-agent-evidence-only' as const,
    executionAuthority: false as const,
    delegationAuthority: false as const,
  });
  DESCRIPTORS.set(descriptor, { registry, config });
  return descriptor;
}

export function createFuryAcpExternalAgentRegistry(
  configs: readonly FuryAcpExternalAgentConfig[],
): FuryAcpExternalAgentRegistry {
  if (!Array.isArray(configs) || configs.length < 1 || configs.length > MAX_AGENTS) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      'external agent registry must contain a bounded non-empty config list',
    );
  }
  const normalized = configs.map(normalizeAgentConfig);
  if (new Set(normalized.map((item) => item.agentId)).size !== normalized.length) {
    throw new FuryAcpExternalClientError(
      'invalid-config',
      'external agent IDs must be unique',
    );
  }

  let registry: FuryAcpExternalAgentRegistry;
  const byId = new Map<string, FuryAcpExternalAgentDescriptor>();
  registry = Object.freeze({
    format: FURY_ACP_EXTERNAL_AGENT_REGISTRY_FORMAT,
    resolve(agentId: string): FuryAcpExternalAgentDescriptor | undefined {
      if (!REGISTRIES.has(registry as object)) {
        throw new FuryAcpExternalClientError(
          'invalid-registry',
          'external agent registry is not process-local evidence',
        );
      }
      if (typeof agentId !== 'string' || !SAFE_ID.test(agentId)) return undefined;
      return byId.get(agentId);
    },
    list(): readonly FuryAcpExternalAgentDescriptor[] {
      if (!REGISTRIES.has(registry as object)) {
        throw new FuryAcpExternalClientError(
          'invalid-registry',
          'external agent registry is not process-local evidence',
        );
      }
      return Object.freeze([...byId.values()]);
    },
    authority: 'configured-agent-registry-only' as const,
    executionAuthority: false as const,
  });
  REGISTRIES.add(registry as object);
  for (const config of normalized) {
    byId.set(config.agentId, descriptorFor(registry, config));
  }
  return registry;
}

export function isGeneratedFuryAcpExternalAgentRegistry(
  value: unknown,
): value is FuryAcpExternalAgentRegistry {
  return typeof value === 'object' && value !== null && REGISTRIES.has(value);
}

export function isGeneratedFuryAcpExternalAgentDescriptor(
  value: unknown,
): value is FuryAcpExternalAgentDescriptor {
  return typeof value === 'object' && value !== null && DESCRIPTORS.has(value);
}

export function isGeneratedFuryAcpExternalSession(
  value: unknown,
): value is FuryAcpExternalSession {
  return typeof value === 'object' && value !== null && SESSIONS.has(value);
}

function sessionSnapshot(
  session: FuryAcpExternalSession,
  state: ExternalSessionState,
): FuryAcpExternalSessionSnapshot {
  return Object.freeze({
    format: FURY_ACP_EXTERNAL_SESSION_SNAPSHOT_FORMAT,
    sessionHandleIdSha256: sha256('session-handle:' + session.sessionHandleId),
    agentId: session.agentId,
    agentIdentitySha256: session.agentIdentitySha256,
    protocolVersion: acp.PROTOCOL_VERSION,
    acpSessionIdSha256: sha256('acp-session:' + state.acpSessionId),
    agentCapabilitiesSha256: state.agentCapabilitiesSha256,
    ...(state.reportedAgentNameSha256 === undefined
      ? {}
      : { reportedAgentNameSha256: state.reportedAgentNameSha256 }),
    createdAt: state.createdAt,
    state: state.state,
    automaticReplayAllowed: false as const,
    authority: 'external-session-evidence-only' as const,
    delegationAuthority: false as const,
    executionAuthority: false as const,
  });
}

export function createFuryAcpExternalClientRuntime(options: {
  readonly registry: FuryAcpExternalAgentRegistry;
  readonly sandbox: CodingSandbox;
  readonly now?: () => number;
  readonly maxSessions?: number;
}) {
  if (!isGeneratedFuryAcpExternalAgentRegistry(options.registry)) {
    throw new FuryAcpExternalClientError(
      'invalid-registry',
      'external ACP runtime requires process-local configured registry evidence',
    );
  }
  if (!isGeneratedCodingSandbox(options.sandbox)) {
    throw new FuryAcpExternalClientError(
      'policy-denied',
      'external ACP runtime requires process-local Phase 6 sandbox evidence',
    );
  }
  const now = options.now ?? Date.now;
  const maxSessions = boundedInteger(
    options.maxSessions,
    Math.min(2, options.sandbox.limits.maxProcesses),
    1,
    options.sandbox.limits.maxProcesses,
    'external ACP session limit',
  );
  let activeSessions = 0;
  const runtimeEvidence = Object.freeze({});
  const ownedSessions = new WeakSet<object>();

  const requireOwned = (
    session: FuryAcpExternalSession,
  ): ExternalSessionState => {
    if (!ownedSessions.has(session as object)) {
      throw new FuryAcpExternalClientError(
        'invalid-session',
        'external ACP session is not owned by this runtime',
      );
    }
    const state = SESSIONS.get(session as object);
    if (!state || state.runtime !== runtimeEvidence) {
      throw new FuryAcpExternalClientError(
        'invalid-session',
        'external ACP session is not current process-local evidence',
      );
    }
    return state;
  };

  return Object.freeze({
    format: 'furypipe-acp-external-client-runtime/v1' as const,
    authority: 'explicit-connect-only' as const,
    delegationAuthority: false as const,
    executionAuthority: false as const,

    async openSession(
      descriptor: FuryAcpExternalAgentDescriptor,
    ): Promise<FuryAcpExternalSession> {
      const descriptorState = DESCRIPTORS.get(descriptor as object);
      if (!descriptorState || descriptorState.registry !== options.registry) {
        throw new FuryAcpExternalClientError(
          'invalid-agent',
          'external ACP agent descriptor is not owned by this registry',
        );
      }
      if (activeSessions >= maxSessions) {
        throw new FuryAcpExternalClientError(
          'process-limit',
          'external ACP session limit reached',
        );
      }
      const config = descriptorState.config;
      if (!options.sandbox.allowedCommands.includes(config.command.toLowerCase())) {
        throw new FuryAcpExternalClientError(
          'policy-denied',
          'external ACP command is outside the Phase 6 sandbox allowlist',
        );
      }
      const cwd = await options.sandbox.resolveReadPath(config.cwd);
      const environment = options.sandbox.environment(config.environment);
      const timeoutMs = Math.min(
        config.startupTimeoutMs,
        options.sandbox.limits.maxTimeoutMs,
      );

      activeSessions += 1;
      let finalized = false;
      let sessionState: ExternalSessionState | undefined;
      let connection: acp.ClientConnection | undefined;
      let timedOut = false;
      let outputExceeded = false;
      const finalize = (): void => {
        if (finalized) return;
        finalized = true;
        activeSessions -= 1;
      };

      const child = spawn(config.command, [...config.args], {
        cwd,
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let protocolBytes = 0;
      let stderrBytes = 0;
      const protocolOutput = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          protocolBytes += chunk.byteLength;
          if (protocolBytes > options.sandbox.limits.maxOutputBytes) {
            outputExceeded = true;
            child.kill();
            callback(new Error('external ACP protocol output exceeded its bound'));
            return;
          }
          callback(null, chunk);
        },
      });
      child.stdout.pipe(protocolOutput);
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > options.sandbox.limits.maxOutputBytes) {
          outputExceeded = true;
          child.kill();
        }
      });

      const startupAbort = new AbortController();
      const timer = setTimeout(() => {
        timedOut = true;
        startupAbort.abort();
        connection?.close(new Error('external ACP startup timeout'));
        child.kill();
      }, timeoutMs);
      timer.unref();

      const spawned = new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve());
        child.once('error', (error) => reject(error));
      });

      child.once('close', () => {
        if (sessionState && sessionState.state === 'ready') {
          sessionState.state = 'disconnected';
        }
        connection?.close(new Error('external ACP process closed'));
        finalize();
      });

      try {
        await spawned;
      } catch {
        clearTimeout(timer);
        finalize();
        throw new FuryAcpExternalClientError(
          'spawn-failed',
          'external ACP process could not be spawned',
        );
      }

      try {
        const client = acp.client({ name: 'furypipe-external-acp-client' });
        connection = client.connect(acp.ndJsonStream(
          Writable.toWeb(child.stdin),
          Readable.toWeb(protocolOutput) as ReadableStream<Uint8Array>,
        ));
        const initialized = await connection.agent.request(
          acp.methods.agent.initialize,
          {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {},
            clientInfo: {
              name: 'furypipe',
              version: '0.15.0',
            },
          },
          { cancellationSignal: startupAbort.signal },
        );
        if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
          throw new FuryAcpExternalClientError(
            'protocol-mismatch',
            'external ACP agent did not negotiate stable protocol v1',
          );
        }
        if (
          config.expectedAgentName !== undefined
          && initialized.agentInfo?.name !== config.expectedAgentName
        ) {
          throw new FuryAcpExternalClientError(
            'identity-mismatch',
            'external ACP agent reported an unexpected implementation name',
          );
        }
        const created = await connection.agent.request(
          acp.methods.agent.session.new,
          {
            cwd,
            mcpServers: [],
          },
          { cancellationSignal: startupAbort.signal },
        );
        clearTimeout(timer);
        if (timedOut) {
          throw new FuryAcpExternalClientError(
            'startup-timeout',
            'external ACP startup exceeded its timeout',
          );
        }
        if (outputExceeded) {
          throw new FuryAcpExternalClientError(
            'output-limit',
            'external ACP startup exceeded its output bound',
          );
        }
        const createdAt = finiteNow(now);
        const agentCapabilitiesSha256 = sha256(JSON.stringify(
          initialized.agentCapabilities ?? {},
        ));
        const reportedAgentNameSha256 = initialized.agentInfo?.name === undefined
          ? undefined
          : sha256(initialized.agentInfo.name);
        const session = Object.freeze({
          format: FURY_ACP_EXTERNAL_SESSION_FORMAT,
          sessionHandleId: 'faes_' + randomUUID(),
          agentId: descriptor.agentId,
          agentIdentitySha256: descriptor.identitySha256,
          protocolVersion: acp.PROTOCOL_VERSION,
          authority: 'external-session-handle-only' as const,
          delegationAuthority: false as const,
          executionAuthority: false as const,
        });
        sessionState = {
          runtime: runtimeEvidence,
          descriptor,
          acpSessionId: created.sessionId,
          agentCapabilitiesSha256,
          ...(reportedAgentNameSha256 === undefined
            ? {}
            : { reportedAgentNameSha256 }),
          createdAt,
          child,
          connection,
          finalize,
          state: 'ready',
        };
        SESSIONS.set(session, sessionState);
        ownedSessions.add(session);
        return session;
      } catch (error) {
        clearTimeout(timer);
        connection?.close(error);
        child.kill();
        finalize();
        if (error instanceof FuryAcpExternalClientError) throw error;
        if (timedOut) {
          throw new FuryAcpExternalClientError(
            'startup-timeout',
            'external ACP startup exceeded its timeout',
          );
        }
        if (outputExceeded) {
          throw new FuryAcpExternalClientError(
            'output-limit',
            'external ACP startup exceeded its output bound',
          );
        }
        throw new FuryAcpExternalClientError(
          'session-failed',
          'external ACP initialize/session creation failed',
        );
      }
    },

    inspectSession(
      session: FuryAcpExternalSession,
    ): FuryAcpExternalSessionSnapshot {
      return sessionSnapshot(session, requireOwned(session));
    },

    async closeSession(
      session: FuryAcpExternalSession,
    ): Promise<FuryAcpExternalSessionSnapshot> {
      const state = requireOwned(session);
      if (state.state === 'ready') {
        state.state = 'closed';
        state.connection.close();
        state.child.kill();
        state.finalize();
      }
      return sessionSnapshot(session, state);
    },

    activeSessionCount(): number {
      return activeSessions;
    },
  });
}
