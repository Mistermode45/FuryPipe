import { createHash } from 'node:crypto';

import {
  inspectFuryPluginBundle,
  validateFuryPluginBundle,
  type FuryPluginAuthMode,
  type FuryPluginBundle,
  type FuryPluginBundleInspection,
  type FuryPluginPermission,
} from './plugin-bundles.js';

export const FURY_PLUGIN_SDK_ARTIFACT_FORMAT = 'furypipe-plugin-sdk-artifact/v1' as const;
export const FURY_PLUGIN_SDK_COMPATIBILITY_FORMAT = 'furypipe-plugin-sdk-compatibility/v1' as const;

export interface FuryPluginSdkArtifact {
  readonly format: typeof FURY_PLUGIN_SDK_ARTIFACT_FORMAT;
  readonly bundle: FuryPluginBundle;
  readonly inspection: FuryPluginBundleInspection;
  readonly bundleDigestSha256: string;
  readonly profileCount: {
    readonly mcp: number;
    readonly cli: number;
    readonly provider: number;
    readonly healthChecks: number;
  };
  readonly requiredSecretEnvironmentVariables: readonly string[];
  readonly authority: 'validated-plugin-metadata-only';
  readonly executionAuthorized: false;
}

export interface FuryPluginSdkHost {
  readonly pluginFormats: readonly string[];
  readonly permissions: readonly FuryPluginPermission[];
  readonly mcpTransports: readonly ('remote-http' | 'stdio')[];
  readonly authModes: readonly FuryPluginAuthMode[];
  readonly providerAdapters?: readonly string[];
  readonly cliExecutables?: readonly string[];
}

export interface FuryPluginSdkCompatibility {
  readonly format: typeof FURY_PLUGIN_SDK_COMPATIBILITY_FORMAT;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly compatible: boolean;
  readonly missingPermissions: readonly FuryPluginPermission[];
  readonly unsupportedMcpTransports: readonly string[];
  readonly unsupportedAuthModes: readonly string[];
  readonly missingProviderAdapters: readonly string[];
  readonly missingCliExecutables: readonly string[];
  readonly reasons: readonly string[];
  readonly authority: 'compatibility-observation-only';
  readonly executionAuthorized: false;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalBundle(bundle: FuryPluginBundle): string {
  return JSON.stringify({
    format: bundle.format,
    id: bundle.id,
    name: bundle.name,
    version: bundle.version,
    mode: bundle.mode,
    source: bundle.source,
    skills: [...bundle.skills],
    mcpProfiles: bundle.mcpProfiles.map((profile) => ({
      id: profile.id,
      transport: profile.transport,
      ...(profile.url === undefined ? {} : { url: profile.url }),
      ...(profile.command === undefined ? {} : { command: profile.command }),
      ...(profile.args === undefined ? {} : { args: [...profile.args] }),
      authentication: profile.authentication,
      ...(profile.bearerEnv === undefined ? {} : { bearerEnv: profile.bearerEnv }),
      readOnlyPreferred: profile.readOnlyPreferred,
      projectScoped: profile.projectScoped,
      permissions: [...profile.permissions],
    })),
    cliProfiles: bundle.cliProfiles.map((profile) => ({
      id: profile.id,
      packageName: profile.packageName,
      packageVersion: profile.packageVersion,
      executable: profile.executable,
      permissions: [...profile.permissions],
      autoInstall: profile.autoInstall,
    })),
    providerProfiles: bundle.providerProfiles.map((profile) => ({
      id: profile.id,
      adapter: profile.adapter,
      permissions: [...profile.permissions],
    })),
    permissions: [...bundle.permissions],
    secrets: bundle.secrets.map((secret) => ({
      env: secret.env,
      required: secret.required,
      purpose: secret.purpose,
    })),
    healthChecks: bundle.healthChecks.map((check) => ({
      id: check.id,
      kind: check.kind,
      targetProfileId: check.targetProfileId,
      required: check.required,
    })),
  });
}

/**
 * Public authoring entry point. It deliberately delegates all normalization and
 * security validation to the existing plugin-bundle contract instead of
 * creating a second plugin manifest format.
 */
export function defineFuryPlugin(bundle: FuryPluginBundle): FuryPluginBundle {
  return validateFuryPluginBundle(bundle);
}

/**
 * Compile validated plugin metadata into a deterministic, non-executing SDK
 * artifact suitable for inspection, review and later signed distribution.
 */
export function compileFuryPluginSdkArtifact(bundle: FuryPluginBundle): FuryPluginSdkArtifact {
  const valid = validateFuryPluginBundle(bundle);
  const inspection = inspectFuryPluginBundle(valid);
  return Object.freeze({
    format: FURY_PLUGIN_SDK_ARTIFACT_FORMAT,
    bundle: valid,
    inspection,
    bundleDigestSha256: sha256(canonicalBundle(valid)),
    profileCount: Object.freeze({
      mcp: valid.mcpProfiles.length,
      cli: valid.cliProfiles.length,
      provider: valid.providerProfiles.length,
      healthChecks: valid.healthChecks.length,
    }),
    requiredSecretEnvironmentVariables: Object.freeze(
      valid.secrets.filter((secret) => secret.required).map((secret) => secret.env).sort(),
    ),
    authority: 'validated-plugin-metadata-only',
    executionAuthorized: false,
  });
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort((a, b) => a.localeCompare(b)));
}

/**
 * Compare a plugin bundle with facts supplied by the host. This does not probe
 * the machine, install packages, read secrets or grant capabilities.
 */
export function assessFuryPluginCompatibility(
  bundle: FuryPluginBundle,
  host: FuryPluginSdkHost,
): FuryPluginSdkCompatibility {
  const valid = validateFuryPluginBundle(bundle);
  if (!host || typeof host !== 'object') throw new Error('plugin SDK host facts are required');
  const pluginFormats = unique(host.pluginFormats);
  const permissions = unique(host.permissions);
  const transports = unique(host.mcpTransports);
  const authModes = unique(host.authModes);
  const providerAdapters = unique(host.providerAdapters ?? []);
  const cliExecutables = unique(host.cliExecutables ?? []);

  const missingPermissions = unique(valid.permissions.filter((permission) => !permissions.includes(permission)));
  const unsupportedMcpTransports = unique(
    valid.mcpProfiles.map((profile) => profile.transport).filter((transport) => !transports.includes(transport)),
  );
  const unsupportedAuthModes = unique(
    valid.mcpProfiles.map((profile) => profile.authentication).filter((mode) => !authModes.includes(mode)),
  );
  const missingProviderAdapters = unique(
    valid.providerProfiles.map((profile) => profile.adapter).filter((adapter) => !providerAdapters.includes(adapter)),
  );
  const missingCliExecutables = unique(
    valid.cliProfiles.map((profile) => profile.executable).filter((executable) => !cliExecutables.includes(executable)),
  );

  const reasons: string[] = [];
  if (!pluginFormats.includes(valid.format)) reasons.push(`host does not support plugin format ${valid.format}`);
  if (missingPermissions.length) reasons.push(`host lacks permissions: ${missingPermissions.join(', ')}`);
  if (unsupportedMcpTransports.length) reasons.push(`unsupported MCP transports: ${unsupportedMcpTransports.join(', ')}`);
  if (unsupportedAuthModes.length) reasons.push(`unsupported auth modes: ${unsupportedAuthModes.join(', ')}`);
  if (missingProviderAdapters.length) reasons.push(`missing provider adapters: ${missingProviderAdapters.join(', ')}`);
  if (missingCliExecutables.length) reasons.push(`missing CLI executables: ${missingCliExecutables.join(', ')}`);

  return Object.freeze({
    format: FURY_PLUGIN_SDK_COMPATIBILITY_FORMAT,
    pluginId: valid.id,
    pluginVersion: valid.version,
    compatible: reasons.length === 0,
    missingPermissions,
    unsupportedMcpTransports,
    unsupportedAuthModes,
    missingProviderAdapters,
    missingCliExecutables,
    reasons: Object.freeze(reasons),
    authority: 'compatibility-observation-only',
    executionAuthorized: false,
  });
}
