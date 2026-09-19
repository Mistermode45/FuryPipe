import * as fs from 'node:fs';
import { isAbsolute } from 'node:path';

import {
  createFuryKernelToolBridge,
  type FuryKernelToolBridge,
  type FuryKernelToolBridgeSource,
} from './fury-kernel-tool-bridge-node.js';
import {
  deriveMcpDirectEndpointFingerprint,
  type McpDirectRuntimeConfig,
} from './mcp-direct-client-node.js';
import type { McpDirectPolicy } from './mcp-direct-policy.js';

export const FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT =
  'furypipe-gateway-local-tool-config/v1' as const;

export interface FuryGatewayLocalToolSourceSummary {
  readonly sourceId: string;
  readonly transport: 'stdio' | 'streamable_http';
  readonly trust: 'trusted' | 'untrusted';
  readonly governedReadToolCount: number;
  readonly operatorApprovalToolCount: number;
  readonly credentialRefs: number;
}

export type FuryGatewayLocalToolConfig =
  | {
      readonly format: typeof FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT;
      readonly enabled: false;
    }
  | {
      readonly format: typeof FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT;
      readonly enabled: true;
      readonly sourceCount: number;
      readonly sources: readonly FuryGatewayLocalToolSourceSummary[];
      readonly displayResults: boolean;
    };

export interface FuryGatewayLocalToolRuntime {
  readonly config: FuryGatewayLocalToolConfig;
  readonly bridge?: FuryKernelToolBridge;
  readonly requiresProcess: boolean;
  readonly requiresNetwork: boolean;
}

export interface FuryGatewayLocalToolRuntimeOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly file?: string;
  readonly now?: () => number;
}

interface FilePolicy {
  readonly governedReadTools: readonly string[];
  readonly operatorApprovalTools: readonly string[];
}

interface StdioFileSource {
  readonly sourceId: string;
  readonly transport: 'stdio';
  readonly trust: 'trusted' | 'untrusted';
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly principalId?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly maxBufferBytes?: number;
  readonly policy: FilePolicy;
}

interface HttpFileSource {
  readonly sourceId: string;
  readonly transport: 'streamable_http';
  readonly trust: 'trusted' | 'untrusted';
  readonly url: string;
  readonly allowedHosts?: readonly string[];
  readonly principalId?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxResponseBytes?: number;
  readonly policy: FilePolicy;
}

type FileSource = StdioFileSource | HttpFileSource;

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_SOURCES = 32;
const MAX_TOOL_NAMES = 256;
const MAX_ENV_REFS = 64;
const MAX_ARGS = 128;
const MAX_TEXT = 4096;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u;
const HOST_NAME = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/u;

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be a plain JSON object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allow = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allow.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`${label} is missing required field: ${key}`);
    }
  }
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${label} must be a bounded safe identifier`);
  }
  return value;
}

function boundedText(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_TEXT
    || value.includes('\0')
    || /[\r\n]/u.test(value)
  ) {
    throw new Error(`${label} must be bounded single-line text`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value as number;
}

function stringList(
  value: unknown,
  label: string,
  maxItems: number,
  item: (value: unknown, label: string) => string,
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${label} must be a bounded array`);
  }
  const normalized = value.map((entry, index) => item(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates`);
  }
  return Object.freeze(normalized);
}

function policyFromFile(value: unknown, label: string): FilePolicy {
  const record = plainRecord(value, label);
  exactKeys(
    record,
    ['governedReadTools', 'operatorApprovalTools'],
    ['governedReadTools', 'operatorApprovalTools'],
    label,
  );
  const governedReadTools = stringList(
    record.governedReadTools,
    `${label}.governedReadTools`,
    MAX_TOOL_NAMES,
    safeId,
  );
  const operatorApprovalTools = stringList(
    record.operatorApprovalTools,
    `${label}.operatorApprovalTools`,
    MAX_TOOL_NAMES,
    safeId,
  );
  const overlap = governedReadTools.find((name) => operatorApprovalTools.includes(name));
  if (overlap) {
    throw new Error(`${label} tool ${overlap} cannot be in both policy lists`);
  }
  return Object.freeze({ governedReadTools, operatorApprovalTools });
}

function envRefMap(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
  label: string,
  keyValidator: (value: string) => boolean,
): {
  readonly resolved?: Readonly<Record<string, string>>;
  readonly count: number;
} {
  if (value === undefined) return Object.freeze({ count: 0 });
  const record = plainRecord(value, label);
  const entries = Object.entries(record);
  if (entries.length > MAX_ENV_REFS) throw new Error(`${label} has too many entries`);
  const output: Record<string, string> = {};
  const seenCaseInsensitive = new Set<string>();

  for (const [targetName, envNameRaw] of entries) {
    if (!keyValidator(targetName)) throw new Error(`${label} target name is invalid`);
    const canonical = targetName.toLowerCase();
    if (seenCaseInsensitive.has(canonical)) {
      throw new Error(`${label} contains duplicate case-insensitive target names`);
    }
    seenCaseInsensitive.add(canonical);
    if (typeof envNameRaw !== 'string' || !ENV_NAME.test(envNameRaw)) {
      throw new Error(`${label} values must be host environment variable names`);
    }
    const secret = env[envNameRaw];
    if (
      secret === undefined
      || secret.length === 0
      || secret.length > 8192
      || secret.includes('\0')
      || /[\r\n]/u.test(secret)
    ) {
      throw new Error(`host environment variable ${envNameRaw} is missing or invalid`);
    }
    output[targetName] = secret;
  }

  return Object.freeze({
    resolved: Object.freeze(output),
    count: entries.length,
  });
}

function sourceFromFile(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
  index: number,
): {
  readonly source: FileSource;
  readonly credentialRefs: number;
} {
  const label = `sources[${index}]`;
  const record = plainRecord(value, label);
  const transport = record.transport;
  if (transport !== 'stdio' && transport !== 'streamable_http') {
    throw new Error(`${label}.transport must be stdio or streamable_http`);
  }
  const sourceId = safeId(record.sourceId, `${label}.sourceId`);
  const trust = record.trust;
  if (trust !== 'trusted' && trust !== 'untrusted') {
    throw new Error(`${label}.trust must be trusted or untrusted`);
  }
  const policy = policyFromFile(record.policy, `${label}.policy`);

  if (transport === 'stdio') {
    exactKeys(
      record,
      [
        'sourceId', 'transport', 'trust', 'command', 'args', 'cwd',
        'principalId', 'env', 'maxBufferBytes', 'policy',
      ],
      ['sourceId', 'transport', 'trust', 'command', 'policy'],
      label,
    );
    const refs = envRefMap(
      record.env,
      env,
      `${label}.env`,
      (name) => ENV_NAME.test(name),
    );
    const principalId = record.principalId === undefined
      ? undefined
      : safeId(record.principalId, `${label}.principalId`);
    if (refs.count > 0 && principalId === undefined) {
      throw new Error(`${label}.principalId is required when env credential references exist`);
    }
    return Object.freeze({
      source: Object.freeze({
        sourceId,
        transport,
        trust,
        command: boundedText(record.command, `${label}.command`),
        args: stringList(
          record.args,
          `${label}.args`,
          MAX_ARGS,
          boundedText,
        ),
        ...(record.cwd === undefined
          ? {}
          : { cwd: boundedText(record.cwd, `${label}.cwd`) }),
        ...(principalId === undefined ? {} : { principalId }),
        ...(refs.resolved === undefined ? {} : { env: refs.resolved }),
        ...(record.maxBufferBytes === undefined
          ? {}
          : {
              maxBufferBytes: boundedInteger(
                record.maxBufferBytes,
                `${label}.maxBufferBytes`,
                1024,
                16 * 1024 * 1024,
              )!,
            }),
        policy,
      } satisfies StdioFileSource),
      credentialRefs: refs.count,
    });
  }

  exactKeys(
    record,
    [
      'sourceId', 'transport', 'trust', 'url', 'allowedHosts',
      'principalId', 'headers', 'maxResponseBytes', 'policy',
    ],
    ['sourceId', 'transport', 'trust', 'url', 'policy'],
    label,
  );
  const refs = envRefMap(
    record.headers,
    env,
    `${label}.headers`,
    (name) => HEADER_NAME.test(name),
  );
  const principalId = record.principalId === undefined
    ? undefined
    : safeId(record.principalId, `${label}.principalId`);
  if (refs.count > 0 && principalId === undefined) {
    throw new Error(`${label}.principalId is required when header credential references exist`);
  }
  return Object.freeze({
    source: Object.freeze({
      sourceId,
      transport,
      trust,
      url: boundedText(record.url, `${label}.url`),
      allowedHosts: stringList(
        record.allowedHosts,
        `${label}.allowedHosts`,
        64,
        (entry, entryLabel) => {
          const host = boundedText(entry, entryLabel);
          if (!HOST_NAME.test(host)) throw new Error(`${entryLabel} is not a valid host`);
          return host;
        },
      ),
      ...(principalId === undefined ? {} : { principalId }),
      ...(refs.resolved === undefined ? {} : { headers: refs.resolved }),
      ...(record.maxResponseBytes === undefined
        ? {}
        : {
            maxResponseBytes: boundedInteger(
              record.maxResponseBytes,
              `${label}.maxResponseBytes`,
              1024,
              16 * 1024 * 1024,
            )!,
          }),
      policy,
    } satisfies HttpFileSource),
    credentialRefs: refs.count,
  });
}

function parseFile(
  file: string,
  env: Readonly<Record<string, string | undefined>>,
): {
  readonly sources: readonly {
    readonly source: FileSource;
    readonly credentialRefs: number;
  }[];
  readonly allowDisplayResult: boolean;
} {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    throw new Error(`WebChat MCP config file is unavailable: ${(error as NodeJS.ErrnoException).code ?? 'read-failed'}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('WebChat MCP config must be a regular non-symlink file');
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    throw new Error(`WebChat MCP config exceeds ${MAX_CONFIG_BYTES} bytes`);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('WebChat MCP config is not valid JSON');
  }
  const root = plainRecord(decoded, 'WebChat MCP config');
  exactKeys(
    root,
    ['format', 'sources', 'allowDisplayResult'],
    ['format', 'sources'],
    'WebChat MCP config',
  );
  const allowDisplayResult = root.allowDisplayResult === undefined
    ? false
    : root.allowDisplayResult;
  if (typeof allowDisplayResult !== 'boolean') {
    throw new Error('WebChat MCP config allowDisplayResult must be a boolean');
  }
  if (root.format !== FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT) {
    throw new Error('WebChat MCP config format is unsupported');
  }
  if (!Array.isArray(root.sources) || root.sources.length < 1 || root.sources.length > MAX_SOURCES) {
    throw new Error(`WebChat MCP config requires 1-${MAX_SOURCES} sources`);
  }
  const sources = root.sources.map((entry, index) => sourceFromFile(entry, env, index));
  const ids = sources.map((entry) => entry.source.sourceId);
  if (new Set(ids).size !== ids.length) {
    throw new Error('WebChat MCP source IDs must be unique');
  }
  return Object.freeze({
    sources: Object.freeze(sources),
    allowDisplayResult,
  });
}

function runtimeSource(
  entry: {
    readonly source: FileSource;
    readonly credentialRefs: number;
  },
): {
  readonly bridgeSource: FuryKernelToolBridgeSource;
  readonly summary: FuryGatewayLocalToolSourceSummary;
} {
  const raw = entry.source;
  const provisional: McpDirectRuntimeConfig = raw.transport === 'stdio'
    ? {
        source: {
          sourceId: raw.sourceId,
          transport: 'stdio',
          endpointFingerprint: '0'.repeat(64),
          trust: raw.trust,
        },
        command: raw.command,
        ...(raw.args === undefined ? {} : { args: raw.args }),
        ...(raw.cwd === undefined ? {} : { cwd: raw.cwd }),
        ...(raw.env === undefined ? {} : { env: raw.env }),
        ...(raw.principalId === undefined ? {} : { principalId: raw.principalId }),
        ...(raw.maxBufferBytes === undefined ? {} : { maxBufferBytes: raw.maxBufferBytes }),
      }
    : {
        source: {
          sourceId: raw.sourceId,
          transport: 'streamable_http',
          endpointFingerprint: '0'.repeat(64),
          trust: raw.trust,
        },
        url: raw.url,
        ...(raw.allowedHosts === undefined ? {} : { allowedHosts: raw.allowedHosts }),
        ...(raw.headers === undefined ? {} : { headers: raw.headers }),
        ...(raw.principalId === undefined ? {} : { principalId: raw.principalId }),
        ...(raw.maxResponseBytes === undefined ? {} : { maxResponseBytes: raw.maxResponseBytes }),
      };

  const fingerprint = deriveMcpDirectEndpointFingerprint(provisional);
  const config: McpDirectRuntimeConfig = {
    ...provisional,
    source: {
      ...provisional.source,
      endpointFingerprint: fingerprint,
    },
  } as McpDirectRuntimeConfig;

  const pairs = (toolNames: readonly string[]) =>
    Object.freeze(toolNames.map((toolName) => Object.freeze({
      sourceId: raw.sourceId,
      endpointFingerprint: fingerprint,
      toolName,
    })));

  const policy: McpDirectPolicy = Object.freeze({
    format: 'furypipe-mcp-direct-policy/v1',
    policyId: `webchat-${raw.sourceId}`,
    governedPolicyAllowlist: pairs(raw.policy.governedReadTools),
    operatorApprovalAllowlist: pairs(raw.policy.operatorApprovalTools),
  });

  return Object.freeze({
    bridgeSource: Object.freeze({ config, policy }),
    summary: Object.freeze({
      sourceId: raw.sourceId,
      transport: raw.transport,
      trust: raw.trust,
      governedReadToolCount: raw.policy.governedReadTools.length,
      operatorApprovalToolCount: raw.policy.operatorApprovalTools.length,
      credentialRefs: entry.credentialRefs,
    }),
  });
}

export function createFuryGatewayLocalToolRuntime(
  options: FuryGatewayLocalToolRuntimeOptions = {},
): FuryGatewayLocalToolRuntime {
  const env = options.env ?? process.env;
  const file = options.file ?? env.FURYPIPE_WEBCHAT_MCP_CONFIG?.trim();
  if (!file) {
    return Object.freeze({
      config: Object.freeze({
        format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
        enabled: false as const,
      }),
      requiresProcess: false,
      requiresNetwork: false,
    });
  }
  if (
    file.length > MAX_TEXT
    || file.includes('\0')
    || !isAbsolute(file)
  ) {
    throw new Error('FURYPIPE_WEBCHAT_MCP_CONFIG path must be an absolute path');
  }

  const parsed = parseFile(file, env);
  const resolved = parsed.sources.map(runtimeSource);
  const summaries = Object.freeze(resolved.map((entry) => entry.summary));
  const bridge = createFuryKernelToolBridge({
    sources: resolved.map((entry) => entry.bridgeSource),
    clientInfo: Object.freeze({
      name: 'furypipe-webchat',
      version: 'vnext',
    }),
    allowDisplayResult: parsed.allowDisplayResult,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return Object.freeze({
    config: Object.freeze({
      format: FURY_GATEWAY_LOCAL_TOOL_CONFIG_FORMAT,
      enabled: true as const,
      sourceCount: summaries.length,
      sources: summaries,
      displayResults: parsed.allowDisplayResult,
    }),
    bridge,
    requiresProcess: summaries.some((source) => source.transport === 'stdio'),
    requiresNetwork: summaries.some((source) => source.transport === 'streamable_http'),
  });
}
