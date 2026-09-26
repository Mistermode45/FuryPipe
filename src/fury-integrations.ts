// FuryIntegrations — one registry for MCP servers, OpenAPI services and webhooks.
//
// Every entry states how it authenticates (scheme and credential *names*
// only), what it may do (capabilities derived from the interface: GET is
// READ, other HTTP methods are WRITE plus EXTERNAL_ACTION, MCP follows the
// hub policy) and whether the operator trusts it. The operator manifest
// `.furypipe/integrations.json` declares OpenAPI specs and webhooks; it must
// reference credentials by environment-variable name and is rejected if it
// carries a secret value. Nothing here calls an integration.
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

import type { FuryMcpSourceView } from './fury-mcp-hub.js';

export type FuryIntegrationKind = 'MCP' | 'OPENAPI' | 'WEBHOOK_IN' | 'WEBHOOK_OUT';
export type FuryIntegrationCapability = 'READ' | 'WRITE' | 'EXTERNAL_ACTION' | 'NETWORK';

export class FuryIntegrationError extends Error {
  override readonly name = 'FuryIntegrationError';
}

export interface FuryIntegrationEntry {
  readonly id: string;
  readonly kind: FuryIntegrationKind;
  readonly name: string;
  readonly source: string;
  readonly endpoint?: string;
  readonly auth: { readonly schemes: readonly string[]; readonly credentialNames: readonly string[] };
  readonly capabilities: readonly FuryIntegrationCapability[];
  readonly defaultDecision: 'ALLOW' | 'ASK' | 'DENY' | 'READ_ONLY';
  readonly trust: 'trusted' | 'untrusted';
  readonly operations?: readonly { readonly id: string; readonly method: string; readonly path: string; readonly capability: FuryIntegrationCapability }[];
  readonly status: 'ready' | 'needs-credentials' | 'invalid';
  readonly problems: readonly string[];
}

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const ENV = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const SECRET_KEY = /^(?:token|secret|password|apiKey|api_key|key|bearer|authorization|clientSecret|client_secret)$/iu;
const MAX_SPEC_BYTES = 4 * 1024 * 1024;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function assertNoSecretValues(value: unknown, where: string): void {
  if (Array.isArray(value)) value.forEach((v, i) => assertNoSecretValues(v, `${where}[${i}]`));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) && typeof v === 'string') throw new FuryIntegrationError(`${where}.${k} holds a secret value; reference an environment variable name with "credentialEnv" instead`);
      assertNoSecretValues(v, `${where}.${k}`);
    }
  }
}

function httpsEndpoint(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new FuryIntegrationError(`${where} must be a URL`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FuryIntegrationError(`${where} is not a URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search) throw new FuryIntegrationError(`${where} must be https without credentials or query string`);
  return url.toString();
}

const entry = (e: FuryIntegrationEntry): FuryIntegrationEntry => Object.freeze(e);

const METHODS = ['get', 'head', 'options', 'post', 'put', 'patch', 'delete'] as const;

/** Summarise an OpenAPI 3 / Swagger 2 JSON document into operations and auth schemes. */
export function summarizeOpenApi(doc: unknown): { title: string; server?: string; operations: FuryIntegrationEntry['operations'] & object; schemes: string[] } {
  if (!isObj(doc) || (typeof doc.openapi !== 'string' && typeof doc.swagger !== 'string') || !isObj(doc.paths)) throw new FuryIntegrationError('not an OpenAPI/Swagger JSON document');
  const info = isObj(doc.info) ? doc.info : {};
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  const server = isObj(servers[0]) && typeof servers[0].url === 'string' ? servers[0].url : typeof doc.host === 'string' ? `https://${doc.host}${typeof doc.basePath === 'string' ? doc.basePath : ''}` : undefined;
  const components = isObj(doc.components) ? doc.components : {};
  const schemesObj = isObj(components.securitySchemes) ? components.securitySchemes : isObj(doc.securityDefinitions) ? doc.securityDefinitions : {};
  const schemes = Object.entries(schemesObj).map(([name, s]) => `${name}:${isObj(s) ? String(s.type ?? 'unknown') + (s.scheme ? `/${String(s.scheme)}` : '') : 'unknown'}`);
  const operations: { id: string; method: string; path: string; capability: FuryIntegrationCapability }[] = [];
  for (const [p, item] of Object.entries(doc.paths)) {
    if (!isObj(item)) continue;
    for (const m of METHODS) {
      const op = item[m];
      if (!isObj(op)) continue;
      operations.push({ id: typeof op.operationId === 'string' ? op.operationId.slice(0, 128) : `${m.toUpperCase()} ${p}`, method: m.toUpperCase(), path: p, capability: m === 'get' || m === 'head' || m === 'options' ? 'READ' : 'WRITE' });
      if (operations.length >= 2_000) break;
    }
  }
  return { title: typeof info.title === 'string' ? info.title : 'untitled API', ...(server ? { server } : {}), operations, schemes };
}

export async function buildFuryIntegrationRegistry(options: {
  readonly projectRoot: string;
  readonly mcp?: readonly FuryMcpSourceView[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<{ readonly entries: readonly FuryIntegrationEntry[]; readonly manifest: 'absent' | 'loaded' | 'invalid'; readonly manifestError?: string }> {
  const env = options.env ?? process.env;
  const entries: FuryIntegrationEntry[] = [];
  for (const s of options.mcp ?? []) {
    const credentialNames = [...s.envNames, ...s.headerNames];
    const readOnly = s.health?.tools.length ? s.health.tools.every((t) => t.readOnly) : false;
    entries.push(entry({
      id: `mcp:${s.sourceId}`, kind: 'MCP', name: s.name, source: s.configPath, ...(s.url ? { endpoint: s.url } : {}),
      auth: { schemes: credentialNames.length ? ['configured-credentials'] : ['none'], credentialNames },
      capabilities: readOnly ? ['READ'] : s.locality === 'remote' ? ['READ', 'WRITE', 'NETWORK', 'EXTERNAL_ACTION'] : ['READ', 'WRITE', 'EXTERNAL_ACTION'],
      defaultDecision: s.enabled ? s.defaultPolicy : 'DENY', trust: s.trusted ? 'trusted' : 'untrusted',
      status: 'ready', problems: s.health && !s.health.ok ? [`last health check failed${s.health.error ? `: ${s.health.error}` : ''}`] : [],
    }));
  }

  const manifestPath = path.join(options.projectRoot, '.furypipe', 'integrations.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze({ entries: Object.freeze(entries), manifest: 'absent' as const });
    return Object.freeze({ entries: Object.freeze(entries), manifest: 'invalid' as const, manifestError: 'integrations.json is not valid JSON' });
  }
  try {
    assertNoSecretValues(manifest, 'integrations');
    if (!isObj(manifest) || manifest.format !== 'furypipe-integrations/v1') throw new FuryIntegrationError('integrations.json must declare format "furypipe-integrations/v1"');
    const list = Array.isArray(manifest.integrations) ? manifest.integrations : [];
    const seen = new Set<string>();
    for (const [i, raw] of list.entries()) {
      if (!isObj(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || seen.has(raw.id)) throw new FuryIntegrationError(`integrations[${i}].id must be a unique lowercase id`);
      seen.add(raw.id);
      const credentialEnv = Array.isArray(raw.credentialEnv) ? raw.credentialEnv : typeof raw.credentialEnv === 'string' ? [raw.credentialEnv] : [];
      if (!credentialEnv.every((n) => typeof n === 'string' && ENV.test(n))) throw new FuryIntegrationError(`integrations[${i}].credentialEnv must be environment variable names`);
      const names = credentialEnv as string[];
      const missing = names.filter((n) => !env[n]);
      const trust = raw.trusted === true ? 'trusted' as const : 'untrusted' as const;
      const problems: string[] = missing.length ? [`credential not set: ${missing.join(', ')}`] : [];
      const base = { id: `${String(raw.kind).toLowerCase()}:${raw.id}`, name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : raw.id, source: manifestPath, trust, problems };
      if (raw.kind === 'OPENAPI') {
        if (typeof raw.spec !== 'string' || path.isAbsolute(raw.spec)) throw new FuryIntegrationError(`integrations[${i}].spec must be a path relative to the project`);
        const specPath = path.resolve(options.projectRoot, raw.spec);
        if (!specPath.startsWith(`${path.resolve(options.projectRoot)}${path.sep}`)) throw new FuryIntegrationError(`integrations[${i}].spec escapes the project`);
        let summary: ReturnType<typeof summarizeOpenApi> | undefined;
        try {
          if ((await stat(specPath)).size > MAX_SPEC_BYTES) throw new FuryIntegrationError('spec is larger than 4 MiB');
          summary = summarizeOpenApi(JSON.parse(await readFile(specPath, 'utf8')));
        } catch (error) {
          problems.push(`spec unreadable: ${(error as Error).message.slice(0, 160)}`);
        }
        const writes = summary?.operations.some((o) => o.capability === 'WRITE') ?? false;
        entries.push(entry({
          ...base, kind: 'OPENAPI', ...(summary?.server ? { endpoint: summary.server } : {}),
          auth: { schemes: summary?.schemes.length ? summary.schemes : ['none'], credentialNames: names },
          capabilities: writes ? ['READ', 'WRITE', 'NETWORK', 'EXTERNAL_ACTION'] : ['READ', 'NETWORK'],
          defaultDecision: writes ? 'ASK' : 'READ_ONLY', operations: summary?.operations.slice(0, 500) ?? [],
          status: !summary ? 'invalid' : missing.length ? 'needs-credentials' : 'ready',
        }));
      } else if (raw.kind === 'WEBHOOK_OUT') {
        entries.push(entry({
          ...base, kind: 'WEBHOOK_OUT', endpoint: httpsEndpoint(raw.url, `integrations[${i}].url`),
          auth: { schemes: [names.length ? 'signed-or-bearer' : 'none'], credentialNames: names },
          capabilities: ['NETWORK', 'EXTERNAL_ACTION'], defaultDecision: 'ASK', status: missing.length ? 'needs-credentials' : 'ready',
        }));
      } else if (raw.kind === 'WEBHOOK_IN') {
        if (!names.length) problems.push('inbound webhook has no signing secret; deliveries cannot be authenticated');
        entries.push(entry({
          ...base, kind: 'WEBHOOK_IN', auth: { schemes: [names.length ? 'hmac-signature' : 'none'], credentialNames: names },
          capabilities: ['READ'], defaultDecision: 'ASK', status: !names.length ? 'invalid' : missing.length ? 'needs-credentials' : 'ready',
        }));
      } else {
        throw new FuryIntegrationError(`integrations[${i}].kind must be OPENAPI, WEBHOOK_IN or WEBHOOK_OUT (MCP servers come from the MCP Hub)`);
      }
    }
  } catch (error) {
    if (!(error instanceof FuryIntegrationError)) throw error;
    return Object.freeze({ entries: Object.freeze(entries), manifest: 'invalid' as const, manifestError: error.message });
  }
  return Object.freeze({ entries: Object.freeze(entries), manifest: 'loaded' as const });
}
