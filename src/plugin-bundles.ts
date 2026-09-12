export type FuryPluginPermission =
  | 'network'
  | 'browser'
  | 'process'
  | 'repository-read'
  | 'repository-write'
  | 'database-read'
  | 'database-write'
  | 'provider-inference'
  | 'provider-management';

export type FuryPluginAuthMode =
  | 'none'
  | 'oauth'
  | 'bearer-env'
  | 'oauth-or-bearer-env';

export interface FuryPluginSource {
  readonly url: string;
  readonly commitSha?: string;
  readonly licenseStatus: 'VERIFIED' | 'NOT_APPLICABLE' | 'UNKNOWN';
  readonly licenseSpdx?: string;
}

export interface FuryPluginSecretContract {
  /** Environment variable name only. The value is never stored in the manifest. */
  readonly env: string;
  readonly required: boolean;
  readonly purpose: string;
}

export interface FuryMcpProfile {
  readonly id: string;
  readonly transport: 'remote-http' | 'stdio';
  readonly url?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly authentication: FuryPluginAuthMode;
  readonly bearerEnv?: string;
  readonly readOnlyPreferred: boolean;
  readonly projectScoped: boolean;
  readonly permissions: readonly FuryPluginPermission[];
}

export interface FuryCliProfile {
  readonly id: string;
  readonly packageName: string;
  readonly executable: string;
  readonly permissions: readonly FuryPluginPermission[];
  /** FuryPipe does not install this automatically. */
  readonly autoInstall: false;
}

export interface FuryProviderProfile {
  readonly id: string;
  readonly adapter: string;
  readonly permissions: readonly FuryPluginPermission[];
}

export interface FuryPluginHealthCheck {
  readonly id: string;
  readonly kind: 'mcp-connect' | 'adapter-health';
  readonly targetProfileId: string;
  readonly required: boolean;
}

export interface FuryPluginBundle {
  readonly format: 'furypipe-plugin-bundle/v1';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly mode: 'EXTERNAL_OPT_IN';
  readonly source: FuryPluginSource;
  readonly skills: readonly string[];
  readonly mcpProfiles: readonly FuryMcpProfile[];
  readonly cliProfiles: readonly FuryCliProfile[];
  readonly providerProfiles: readonly FuryProviderProfile[];
  readonly permissions: readonly FuryPluginPermission[];
  readonly secrets: readonly FuryPluginSecretContract[];
  readonly healthChecks: readonly FuryPluginHealthCheck[];
}

export interface FuryPluginBundleInspection {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly mode: 'EXTERNAL_OPT_IN';
  readonly source: FuryPluginSource;
  readonly skills: readonly string[];
  readonly mcpProfiles: readonly Omit<FuryMcpProfile, 'bearerEnv'>[];
  readonly cliProfiles: readonly FuryCliProfile[];
  readonly providerProfiles: readonly FuryProviderProfile[];
  readonly permissions: readonly FuryPluginPermission[];
  readonly secretEnvironmentVariables: readonly string[];
  readonly healthChecks: readonly FuryPluginHealthCheck[];
}

export interface FuryPluginBundleRegistry {
  register(bundle: FuryPluginBundle): void;
  get(id: string): FuryPluginBundle | undefined;
  list(): readonly FuryPluginBundle[];
  inspect(): readonly FuryPluginBundleInspection[];
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const ENV = /^[A-Z][A-Z0-9_]{0,127}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const SHA40 = /^[0-9a-f]{40}$/u;
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const PERMISSIONS = new Set<FuryPluginPermission>([
  'network',
  'browser',
  'process',
  'repository-read',
  'repository-write',
  'database-read',
  'database-write',
  'provider-inference',
  'provider-management',
]);

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function bounded(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be bounded printable text`);
  }
  return value;
}

function httpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`${label} must be credential-free HTTPS`);
  }
  return url.toString();
}

function uniqueStrings(values: readonly string[], label: string, max = 64): readonly string[] {
  if (!Array.isArray(values) || values.length > max) throw new Error(`${label} exceeds its item limit`);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = bounded(value, label, 256);
    if (seen.has(normalized)) throw new Error(`${label} contains duplicates`);
    seen.add(normalized);
    result.push(normalized);
  }
  return Object.freeze(result);
}

function permissions(values: readonly FuryPluginPermission[], label: string): readonly FuryPluginPermission[] {
  if (!Array.isArray(values) || values.length > PERMISSIONS.size) throw new Error(`${label} is invalid`);
  const seen = new Set<FuryPluginPermission>();
  for (const value of values) {
    if (!PERMISSIONS.has(value)) throw new Error(`${label} contains an unsupported permission`);
    if (seen.has(value)) throw new Error(`${label} contains duplicate permissions`);
    seen.add(value);
  }
  return Object.freeze([...seen]);
}

function validateSource(source: FuryPluginSource): FuryPluginSource {
  const url = httpsUrl(source.url, 'plugin source URL');
  if (source.commitSha !== undefined && !SHA40.test(source.commitSha)) {
    throw new Error('plugin source commitSha must be a lowercase 40-character SHA');
  }
  if (new URL(url).hostname.toLowerCase() === 'github.com' && source.commitSha === undefined) {
    throw new Error('GitHub-backed plugin sources require a pinned commitSha');
  }
  if (!['VERIFIED', 'NOT_APPLICABLE', 'UNKNOWN'].includes(source.licenseStatus)) {
    throw new Error('plugin source licenseStatus is invalid');
  }
  if (source.licenseSpdx !== undefined && !SPDX.test(source.licenseSpdx)) {
    throw new Error('plugin source SPDX identifier is invalid');
  }
  return Object.freeze({ ...source, url });
}

function validateMcp(profile: FuryMcpProfile): FuryMcpProfile {
  id(profile.id, 'MCP profile id');
  if (!['remote-http', 'stdio'].includes(profile.transport)) throw new Error('MCP transport is invalid');
  if (!['none', 'oauth', 'bearer-env', 'oauth-or-bearer-env'].includes(profile.authentication)) {
    throw new Error('MCP authentication mode is invalid');
  }

  if (profile.transport === 'remote-http') {
    if (!profile.url) throw new Error('remote MCP profile requires url');
    httpsUrl(profile.url, 'remote MCP URL');
    if (profile.command !== undefined || profile.args !== undefined) throw new Error('remote MCP profile must not define command/args');
  } else {
    if (!profile.command) throw new Error('stdio MCP profile requires command');
    bounded(profile.command, 'stdio MCP command', 256);
    if (profile.url !== undefined) throw new Error('stdio MCP profile must not define url');
    uniqueStrings(profile.args ?? [], 'stdio MCP args', 32);
  }

  const needsBearer = profile.authentication === 'bearer-env' || profile.authentication === 'oauth-or-bearer-env';
  if (needsBearer) {
    if (!profile.bearerEnv || !ENV.test(profile.bearerEnv)) throw new Error('MCP bearer auth requires a valid bearerEnv');
  } else if (profile.bearerEnv !== undefined) {
    throw new Error('MCP bearerEnv is only valid for bearer auth modes');
  }

  return Object.freeze({
    ...profile,
    ...(profile.url === undefined ? {} : { url: httpsUrl(profile.url, 'remote MCP URL') }),
    ...(profile.args === undefined ? {} : { args: Object.freeze([...profile.args]) }),
    permissions: permissions(profile.permissions, `MCP profile ${profile.id} permissions`),
  });
}

function validateCli(profile: FuryCliProfile): FuryCliProfile {
  id(profile.id, 'CLI profile id');
  if (!PACKAGE.test(profile.packageName)) throw new Error('CLI packageName is invalid');
  bounded(profile.executable, 'CLI executable', 256);
  if (profile.autoInstall !== false) throw new Error('CLI profiles must never auto-install');
  return Object.freeze({
    ...profile,
    permissions: permissions(profile.permissions, `CLI profile ${profile.id} permissions`),
  });
}

function validateProvider(profile: FuryProviderProfile): FuryProviderProfile {
  id(profile.id, 'provider profile id');
  id(profile.adapter, 'provider adapter id');
  return Object.freeze({
    ...profile,
    permissions: permissions(profile.permissions, `provider profile ${profile.id} permissions`),
  });
}

export function validateFuryPluginBundle(bundle: FuryPluginBundle): FuryPluginBundle {
  if (bundle.format !== 'furypipe-plugin-bundle/v1') throw new Error('plugin bundle format is invalid');
  id(bundle.id, 'plugin bundle id');
  bounded(bundle.name, 'plugin bundle name', 256);
  if (!SEMVER.test(bundle.version)) throw new Error('plugin bundle version must be pinned semver');
  if (bundle.mode !== 'EXTERNAL_OPT_IN') throw new Error('plugin bundle mode must be EXTERNAL_OPT_IN');

  const mcpProfiles = Object.freeze(bundle.mcpProfiles.map(validateMcp));
  const cliProfiles = Object.freeze(bundle.cliProfiles.map(validateCli));
  const providerProfiles = Object.freeze(bundle.providerProfiles.map(validateProvider));
  const profileIds = new Set<string>();
  for (const profile of [...mcpProfiles, ...cliProfiles, ...providerProfiles]) {
    if (profileIds.has(profile.id)) throw new Error(`duplicate plugin profile id: ${profile.id}`);
    profileIds.add(profile.id);
  }

  const secrets = Object.freeze(bundle.secrets.map((secret) => {
    if (!ENV.test(secret.env)) throw new Error('plugin secret env is invalid');
    bounded(secret.purpose, 'plugin secret purpose', 512);
    return Object.freeze({ ...secret });
  }));
  if (new Set(secrets.map((secret) => secret.env)).size !== secrets.length) {
    throw new Error('plugin bundle contains duplicate secret env contracts');
  }

  for (const profile of mcpProfiles) {
    if (profile.bearerEnv && !secrets.some((secret) => secret.env === profile.bearerEnv)) {
      throw new Error(`MCP profile ${profile.id} references undeclared secret env ${profile.bearerEnv}`);
    }
  }

  const healthChecks = Object.freeze(bundle.healthChecks.map((check) => {
    id(check.id, 'health check id');
    id(check.targetProfileId, 'health check targetProfileId');
    if (!['mcp-connect', 'adapter-health'].includes(check.kind)) throw new Error('health check kind is invalid');
    if (!profileIds.has(check.targetProfileId)) throw new Error(`health check target does not exist: ${check.targetProfileId}`);
    return Object.freeze({ ...check });
  }));
  if (new Set(healthChecks.map((check) => check.id)).size !== healthChecks.length) {
    throw new Error('plugin bundle contains duplicate health check ids');
  }

  return Object.freeze({
    ...bundle,
    source: validateSource(bundle.source),
    skills: uniqueStrings(bundle.skills, 'plugin skills'),
    mcpProfiles,
    cliProfiles,
    providerProfiles,
    permissions: permissions(bundle.permissions, 'plugin bundle permissions'),
    secrets,
    healthChecks,
  });
}

export function inspectFuryPluginBundle(bundle: FuryPluginBundle): FuryPluginBundleInspection {
  const valid = validateFuryPluginBundle(bundle);
  return Object.freeze({
    id: valid.id,
    name: valid.name,
    version: valid.version,
    mode: valid.mode,
    source: valid.source,
    skills: valid.skills,
    mcpProfiles: Object.freeze(valid.mcpProfiles.map(({ bearerEnv: _secretEnv, ...profile }) => Object.freeze({ ...profile }))),
    cliProfiles: valid.cliProfiles,
    providerProfiles: valid.providerProfiles,
    permissions: valid.permissions,
    secretEnvironmentVariables: Object.freeze(valid.secrets.map((secret) => secret.env)),
    healthChecks: valid.healthChecks,
  });
}

export function createFuryPluginBundleRegistry(
  initial: readonly FuryPluginBundle[] = [],
): FuryPluginBundleRegistry {
  const bundles = new Map<string, FuryPluginBundle>();
  const registry: FuryPluginBundleRegistry = {
    register(bundle) {
      const valid = validateFuryPluginBundle(bundle);
      if (bundles.has(valid.id)) throw new Error(`plugin bundle already registered: ${valid.id}`);
      bundles.set(valid.id, valid);
    },
    get(bundleId) {
      return bundles.get(bundleId);
    },
    list() {
      return Object.freeze([...bundles.values()].sort((a, b) => a.id.localeCompare(b.id)));
    },
    inspect() {
      return Object.freeze(registry.list().map(inspectFuryPluginBundle));
    },
  };
  for (const bundle of initial) registry.register(bundle);
  return registry;
}

export const CONTEXT7_PLUGIN_BUNDLE: FuryPluginBundle = validateFuryPluginBundle({
  format: 'furypipe-plugin-bundle/v1',
  id: 'context7',
  name: 'Context7 documentation',
  version: '1.0.0',
  mode: 'EXTERNAL_OPT_IN',
  source: {
    url: 'https://github.com/upstash/context7',
    commitSha: '6f42b66f3b6dee20ba870dd6f70f1b565eb62e6e',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
  },
  skills: ['docs-current'],
  mcpProfiles: [{
    id: 'context7-mcp',
    transport: 'remote-http',
    url: 'https://mcp.context7.com/mcp',
    authentication: 'oauth-or-bearer-env',
    bearerEnv: 'CONTEXT7_API_KEY',
    readOnlyPreferred: true,
    projectScoped: false,
    permissions: ['network'],
  }],
  cliProfiles: [],
  providerProfiles: [],
  permissions: ['network'],
  secrets: [{
    env: 'CONTEXT7_API_KEY',
    required: false,
    purpose: 'Optional Context7 bearer API key when MCP OAuth is not used.',
  }],
  healthChecks: [{
    id: 'context7-connect',
    kind: 'mcp-connect',
    targetProfileId: 'context7-mcp',
    required: true,
  }],
});

export const GITHUB_MCP_PLUGIN_BUNDLE: FuryPluginBundle = validateFuryPluginBundle({
  format: 'furypipe-plugin-bundle/v1',
  id: 'github-mcp',
  name: 'GitHub MCP',
  version: '1.0.0',
  mode: 'EXTERNAL_OPT_IN',
  source: {
    url: 'https://github.com/github/github-mcp-server',
    commitSha: '7d13a7ad6f2a17f351a6d77ce280c85ae1821f4d',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'MIT',
  },
  skills: ['repository-investigation', 'ci-evidence'],
  mcpProfiles: [{
    id: 'github-remote-mcp',
    transport: 'remote-http',
    url: 'https://api.githubcopilot.com/mcp/',
    authentication: 'oauth',
    readOnlyPreferred: true,
    projectScoped: false,
    permissions: ['network', 'repository-read'],
  }],
  cliProfiles: [],
  providerProfiles: [],
  permissions: ['network', 'repository-read'],
  secrets: [],
  healthChecks: [{
    id: 'github-mcp-connect',
    kind: 'mcp-connect',
    targetProfileId: 'github-remote-mcp',
    required: true,
  }],
});

export const SUPABASE_PLUGIN_BUNDLE: FuryPluginBundle = validateFuryPluginBundle({
  format: 'furypipe-plugin-bundle/v1',
  id: 'supabase',
  name: 'Supabase app development',
  version: '1.0.0',
  mode: 'EXTERNAL_OPT_IN',
  source: {
    url: 'https://github.com/supabase/supabase',
    commitSha: '26585dd4a4d6db8910a595214c9f6e8fdd206768',
    licenseStatus: 'VERIFIED',
    licenseSpdx: 'Apache-2.0',
  },
  skills: ['supabase-app-development'],
  mcpProfiles: [{
    id: 'supabase-mcp',
    transport: 'remote-http',
    url: 'https://mcp.supabase.com/mcp',
    authentication: 'oauth',
    readOnlyPreferred: true,
    projectScoped: true,
    permissions: ['network', 'database-read'],
  }],
  cliProfiles: [],
  providerProfiles: [],
  permissions: ['network', 'database-read'],
  secrets: [],
  healthChecks: [{
    id: 'supabase-mcp-connect',
    kind: 'mcp-connect',
    targetProfileId: 'supabase-mcp',
    required: true,
  }],
});

export const BUILTIN_FURY_PLUGIN_BUNDLES: readonly FuryPluginBundle[] = Object.freeze([
  CONTEXT7_PLUGIN_BUNDLE,
  GITHUB_MCP_PLUGIN_BUNDLE,
  SUPABASE_PLUGIN_BUNDLE,
]);
