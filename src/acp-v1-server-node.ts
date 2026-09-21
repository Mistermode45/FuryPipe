import { randomBytes } from 'node:crypto';
import { isAbsolute, win32 } from 'node:path';
import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

export const FURY_ACP_V1_SERVER_FORMAT = 'furypipe-acp-v1-server/v1' as const;
export const FURY_ACP_V1_SESSION_FORMAT = 'furypipe-acp-v1-session/v1' as const;
export const FURY_ACP_V1_PROTOCOL_VERSION = acp.PROTOCOL_VERSION;

export type FuryAcpV1PromptPart =
  | Readonly<{
      type: 'text';
      text: string;
      authority: 'untrusted-content';
    }>
  | Readonly<{
      type: 'resource_link';
      name: string;
      uri: string;
      mimeType?: string;
      authority: 'untrusted-content';
    }>;

export interface FuryAcpV1PromptInput {
  readonly format: 'furypipe-acp-v1-prompt/v1';
  readonly sessionId: string;
  readonly cwd: string;
  readonly additionalDirectories: readonly string[];
  readonly parts: readonly FuryAcpV1PromptPart[];
  readonly executionAuthority: false;
}

export interface FuryAcpV1PromptContext {
  readonly prompt: FuryAcpV1PromptInput;
  readonly signal: AbortSignal;
  emitText(text: string): Promise<void>;
}

export interface FuryAcpV1PromptResult {
  readonly stopReason: acp.StopReason;
}

export type FuryAcpV1PromptHandler = (
  context: FuryAcpV1PromptContext,
) => Promise<FuryAcpV1PromptResult>;

export interface FuryAcpV1ServerOptions {
  readonly promptHandler: FuryAcpV1PromptHandler;
  readonly agentName?: string;
  readonly agentVersion?: string;
  readonly now?: () => number;
  readonly maxSessions?: number;
  readonly maxPromptBlocks?: number;
  readonly maxPromptBytes?: number;
  readonly maxUpdateBytes?: number;
  readonly maxUpdatesPerPrompt?: number;
}

export interface FuryAcpV1SessionSnapshot {
  readonly format: typeof FURY_ACP_V1_SESSION_FORMAT;
  readonly sessionId: string;
  readonly cwd: string;
  readonly additionalDirectories: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly promptActive: boolean;
  readonly authority: 'protocol-session-only';
  readonly executionAuthority: false;
}

type MutableSession = {
  readonly sessionId: string;
  readonly cwd: string;
  readonly additionalDirectories: readonly string[];
  readonly createdAt: number;
  updatedAt: number;
  activePrompt?: AbortController;
};

const DEFAULT_MAX_SESSIONS = 32;
const HARD_MAX_SESSIONS = 1024;
const DEFAULT_MAX_PROMPT_BLOCKS = 64;
const HARD_MAX_PROMPT_BLOCKS = 512;
const DEFAULT_MAX_PROMPT_BYTES = 256 * 1024;
const HARD_MAX_PROMPT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_UPDATE_BYTES = 64 * 1024;
const HARD_MAX_UPDATE_BYTES = 1024 * 1024;
const DEFAULT_MAX_UPDATES_PER_PROMPT = 256;
const HARD_MAX_UPDATES_PER_PROMPT = 4096;
const MAX_PATH_BYTES = 4096;
const MAX_RESOURCE_URI_BYTES = 8192;
const MAX_RESOURCE_NAME_BYTES = 512;
const MAX_MIME_BYTES = 256;
const MAX_ADDITIONAL_DIRECTORIES = 32;
const SESSION_ID_RE = /^facp_[A-Za-z0-9_-]{24}$/u;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function finiteNow(now: () => number): number {
  const value = now();
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(normalized)) {
    throw new TypeError('ACP server clock must return a safe non-negative timestamp');
  }
  return normalized;
}

function boundedText(
  value: unknown,
  maxBytes: number,
  label: string,
  allowEmpty = false,
): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw acp.RequestError.invalidParams(undefined, `${label} must be text without NUL bytes`);
  }
  if (!allowEmpty && (value.length === 0 || value.trim().length === 0)) {
    throw acp.RequestError.invalidParams(undefined, `${label} must be non-empty`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw acp.RequestError.invalidParams(undefined, `${label} exceeds its UTF-8 byte limit`);
  }
  return value;
}

function protocolPath(value: unknown, label: string): string {
  const path = boundedText(value, MAX_PATH_BYTES, label);
  const portableAbsolute =
    isAbsolute(path)
    || win32.isAbsolute(path)
    || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(path);
  if (!portableAbsolute) {
    throw acp.RequestError.invalidParams(undefined, `${label} must be an absolute path`);
  }
  return path;
}

function sessionId(): string {
  return `facp_${randomBytes(18).toString('base64url')}`;
}

function snapshot(session: MutableSession): FuryAcpV1SessionSnapshot {
  return Object.freeze({
    format: FURY_ACP_V1_SESSION_FORMAT,
    sessionId: session.sessionId,
    cwd: session.cwd,
    additionalDirectories: Object.freeze([...session.additionalDirectories]),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    promptActive: session.activePrompt !== undefined,
    authority: 'protocol-session-only' as const,
    executionAuthority: false as const,
  });
}

function normalizePrompt(
  params: acp.PromptRequest,
  session: MutableSession,
  maxBlocks: number,
  maxBytes: number,
): FuryAcpV1PromptInput {
  if (!Array.isArray(params.prompt) || params.prompt.length < 1 || params.prompt.length > maxBlocks) {
    throw acp.RequestError.invalidParams(
      undefined,
      `prompt must contain between 1 and ${maxBlocks} content blocks`,
    );
  }

  let totalBytes = 0;
  const parts: FuryAcpV1PromptPart[] = [];

  for (const [index, block] of params.prompt.entries()) {
    if (block.type === 'text') {
      const text = boundedText(block.text, maxBytes, `prompt[${index}].text`);
      totalBytes += Buffer.byteLength(text, 'utf8');
      parts.push(Object.freeze({
        type: 'text' as const,
        text,
        authority: 'untrusted-content' as const,
      }));
    } else if (block.type === 'resource_link') {
      const name = boundedText(block.name, MAX_RESOURCE_NAME_BYTES, `prompt[${index}].name`);
      const uri = boundedText(block.uri, MAX_RESOURCE_URI_BYTES, `prompt[${index}].uri`);
      const mimeType = block.mimeType == null
        ? undefined
        : boundedText(block.mimeType, MAX_MIME_BYTES, `prompt[${index}].mimeType`);
      totalBytes += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(uri, 'utf8');
      if (mimeType !== undefined) totalBytes += Buffer.byteLength(mimeType, 'utf8');
      parts.push(Object.freeze({
        type: 'resource_link' as const,
        name,
        uri,
        ...(mimeType === undefined ? {} : { mimeType }),
        authority: 'untrusted-content' as const,
      }));
    } else {
      throw acp.RequestError.invalidParams(
        undefined,
        `prompt[${index}] content type is not enabled in Gate 8.1`,
      );
    }

    if (totalBytes > maxBytes) {
      throw acp.RequestError.invalidParams(undefined, 'prompt exceeds its total UTF-8 byte limit');
    }
  }

  return Object.freeze({
    format: 'furypipe-acp-v1-prompt/v1' as const,
    sessionId: session.sessionId,
    cwd: session.cwd,
    additionalDirectories: Object.freeze([...session.additionalDirectories]),
    parts: Object.freeze(parts),
    executionAuthority: false as const,
  });
}

export function createFuryAcpV1Server(options: FuryAcpV1ServerOptions) {
  if (!options || typeof options !== 'object' || typeof options.promptHandler !== 'function') {
    throw new TypeError('ACP v1 server requires a promptHandler');
  }

  const now = options.now ?? Date.now;
  const maxSessions = boundedInteger(
    options.maxSessions,
    DEFAULT_MAX_SESSIONS,
    1,
    HARD_MAX_SESSIONS,
    'maxSessions',
  );
  const maxPromptBlocks = boundedInteger(
    options.maxPromptBlocks,
    DEFAULT_MAX_PROMPT_BLOCKS,
    1,
    HARD_MAX_PROMPT_BLOCKS,
    'maxPromptBlocks',
  );
  const maxPromptBytes = boundedInteger(
    options.maxPromptBytes,
    DEFAULT_MAX_PROMPT_BYTES,
    1,
    HARD_MAX_PROMPT_BYTES,
    'maxPromptBytes',
  );
  const maxUpdateBytes = boundedInteger(
    options.maxUpdateBytes,
    DEFAULT_MAX_UPDATE_BYTES,
    1,
    HARD_MAX_UPDATE_BYTES,
    'maxUpdateBytes',
  );
  const maxUpdatesPerPrompt = boundedInteger(
    options.maxUpdatesPerPrompt,
    DEFAULT_MAX_UPDATES_PER_PROMPT,
    1,
    HARD_MAX_UPDATES_PER_PROMPT,
    'maxUpdatesPerPrompt',
  );
  const agentName = boundedText(options.agentName ?? 'furypipe', 128, 'agentName');
  const agentVersion = boundedText(options.agentVersion ?? '0.15.0', 64, 'agentVersion');
  const sessions = new Map<string, MutableSession>();

  const requireSession = (id: unknown): MutableSession => {
    if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) {
      throw acp.RequestError.invalidParams(undefined, 'sessionId is invalid');
    }
    const found = sessions.get(id);
    if (!found) {
      throw acp.RequestError.invalidParams(undefined, 'session does not exist on this ACP connection');
    }
    return found;
  };

  const app = acp
    .agent({ name: agentName })
    .onRequest(acp.methods.agent.initialize, (ctx) => {
      // ACP v1 is the only production protocol enabled in this gate.
      // Returning v1 for another requested version follows ACP negotiation:
      // the client must disconnect when it cannot support the returned version.
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: {},
        },
        authMethods: [],
        agentInfo: {
          name: agentName,
          version: agentVersion,
        },
      };
    })
    .onRequest(acp.methods.agent.session.new, (ctx) => {
      if (sessions.size >= maxSessions) {
        throw new acp.RequestError(-32010, 'ACP session limit reached');
      }
      if (!Array.isArray(ctx.params.mcpServers) || ctx.params.mcpServers.length !== 0) {
        throw acp.RequestError.invalidParams(
          undefined,
          'MCP server attachment is not enabled in Gate 8.1',
        );
      }
      const cwd = protocolPath(ctx.params.cwd, 'cwd');
      const additional = ctx.params.additionalDirectories ?? [];
      if (!Array.isArray(additional) || additional.length > MAX_ADDITIONAL_DIRECTORIES) {
        throw acp.RequestError.invalidParams(
          undefined,
          `additionalDirectories exceeds ${MAX_ADDITIONAL_DIRECTORIES} entries`,
        );
      }
      const additionalDirectories = Object.freeze(
        additional.map((entry, index) => protocolPath(entry, `additionalDirectories[${index}]`)),
      );
      const createdAt = finiteNow(now);
      let id: string;
      do {
        id = sessionId();
      } while (sessions.has(id));
      sessions.set(id, {
        sessionId: id,
        cwd,
        additionalDirectories,
        createdAt,
        updatedAt: createdAt,
      });
      return { sessionId: id };
    })
    .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
      const session = requireSession(ctx.params.sessionId);
      if (session.activePrompt !== undefined) {
        throw new acp.RequestError(-32011, 'ACP session already has an active prompt');
      }

      const prompt = normalizePrompt(ctx.params, session, maxPromptBlocks, maxPromptBytes);
      const localAbort = new AbortController();
      session.activePrompt = localAbort;
      session.updatedAt = finiteNow(now);
      const signal = AbortSignal.any([ctx.signal, localAbort.signal]);
      let updateCount = 0;
      let emittedBytes = 0;
      const messageId = `fam_${randomBytes(18).toString('base64url')}`;

      try {
        const result = await options.promptHandler(Object.freeze({
          prompt,
          signal,
          emitText: async (value: string): Promise<void> => {
            if (signal.aborted) {
              const error = new Error('ACP prompt was cancelled');
              error.name = 'AbortError';
              throw error;
            }
            const text = boundedText(value, maxUpdateBytes, 'agent update');
            const bytes = Buffer.byteLength(text, 'utf8');
            updateCount += 1;
            emittedBytes += bytes;
            if (updateCount > maxUpdatesPerPrompt || emittedBytes > maxPromptBytes) {
              throw new acp.RequestError(-32012, 'ACP prompt update budget exceeded');
            }
            await ctx.client.notify(acp.methods.client.session.update, {
              sessionId: session.sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                messageId,
                content: {
                  type: 'text',
                  text,
                },
              },
            });
          },
        }));

        if (signal.aborted) return { stopReason: 'cancelled' as const };
        if (!result || !['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'].includes(result.stopReason)) {
          throw new TypeError('ACP promptHandler returned an invalid stopReason');
        }
        return { stopReason: result.stopReason };
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return { stopReason: 'cancelled' as const };
        }
        throw error;
      } finally {
        if (session.activePrompt === localAbort) {
          session.activePrompt = undefined;
          session.updatedAt = finiteNow(now);
        }
      }
    })
    .onNotification(acp.methods.agent.session.cancel, (ctx) => {
      const session = sessions.get(ctx.params.sessionId);
      session?.activePrompt?.abort();
    });

  return Object.freeze({
    format: FURY_ACP_V1_SERVER_FORMAT,
    protocolVersion: acp.PROTOCOL_VERSION,
    app,
    inspectSession(id: string): FuryAcpV1SessionSnapshot {
      return snapshot(requireSession(id));
    },
    listSessions(): readonly FuryAcpV1SessionSnapshot[] {
      return Object.freeze([...sessions.values()].map(snapshot));
    },
    sessionCount(): number {
      return sessions.size;
    },
  });
}

export function connectFuryAcpV1Stdio(options: FuryAcpV1ServerOptions): acp.AgentConnection {
  const server = createFuryAcpV1Server(options);
  const output = Writable.toWeb(process.stdout);
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  return server.app.connect(acp.ndJsonStream(output, input));
}
