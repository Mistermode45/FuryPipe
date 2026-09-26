import { createHash } from 'node:crypto';

import { validateFuryPluginBundle, type FuryPluginBundle, type FuryPluginPermission } from './plugin-bundles.js';

export const FURY_PLUGIN_RUNTIME_FORMAT = 'furypipe-plugin-runtime/v1' as const;
export const FURY_PLUGIN_ACTIVATION_PLAN_FORMAT = 'furypipe-plugin-activation-plan/v1' as const;

export type FuryPluginIsolationMode = 'worker-thread' | 'subprocess' | 'browser-frame';
export type FuryPluginUiSurface = 'sidebar' | 'panel' | 'command-palette' | 'settings' | 'artifact-viewer';

export interface FuryPluginUiExtension {
  readonly id: string;
  readonly surface: FuryPluginUiSurface;
  readonly entrypoint: string;
  readonly title: string;
  readonly permissions: readonly FuryPluginPermission[];
}

export interface FuryPluginRuntimeDescriptor {
  readonly format: typeof FURY_PLUGIN_RUNTIME_FORMAT;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly hostApiVersion: string;
  readonly isolation: FuryPluginIsolationMode;
  readonly uiExtensions: readonly FuryPluginUiExtension[];
  readonly memoryLimitMiB: number;
  readonly cpuTimeLimitMs: number;
  readonly networkDefault: 'DENY';
  readonly filesystemDefault: 'DENY';
  readonly secretInjection: 'ENV_NAMES_ONLY';
}

export interface FuryPluginActivationPlan {
  readonly format: typeof FURY_PLUGIN_ACTIVATION_PLAN_FORMAT;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly descriptorDigestSha256: string;
  readonly compatible: boolean;
  readonly incompatibilities: readonly string[];
  readonly requestedPermissions: readonly FuryPluginPermission[];
  readonly uiExtensions: readonly FuryPluginUiExtension[];
  readonly requiresApproval: true;
  readonly installAuthorized: false;
  readonly networkAuthorized: false;
  readonly filesystemAuthorized: false;
  readonly executionAuthorized: false;
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const RELATIVE_ENTRY = /^(?![A-Za-z]:)(?![/\\])(?!.*(?:^|[/\\])\.\.(?:[/\\]|$))[A-Za-z0-9._/\\-]{1,256}$/u;
const UI_SURFACES = new Set<FuryPluginUiSurface>(['sidebar', 'panel', 'command-palette', 'settings', 'artifact-viewer']);
const ISOLATION = new Set<FuryPluginIsolationMode>(['worker-thread', 'subprocess', 'browser-frame']);

function printable(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be bounded printable text`);
  }
  return value;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Readonly<Record<string, unknown>>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function major(version: string): number {
  if (!SEMVER.test(version)) throw new Error('host API version must be semver');
  return Number(version.split('.')[0]);
}

function validateUiExtension(extension: FuryPluginUiExtension, bundle: FuryPluginBundle): FuryPluginUiExtension {
  if (!ID.test(extension.id)) throw new Error('UI extension id is invalid');
  if (!UI_SURFACES.has(extension.surface)) throw new Error('UI extension surface is invalid');
  if (!RELATIVE_ENTRY.test(extension.entrypoint) || extension.entrypoint.includes('\\')) {
    throw new Error('UI extension entrypoint must be a normalized project-relative path');
  }
  printable(extension.title, 'UI extension title', 128);
  if (extension.permissions.length > bundle.permissions.length) throw new Error('UI extension permissions exceed plugin permissions');
  const unique = new Set<FuryPluginPermission>();
  for (const permission of extension.permissions) {
    if (!bundle.permissions.includes(permission)) throw new Error(`UI extension requests undeclared permission: ${permission}`);
    if (unique.has(permission)) throw new Error('UI extension permissions contain duplicates');
    unique.add(permission);
  }
  return Object.freeze({ ...extension, permissions: Object.freeze([...unique]) });
}

export function validateFuryPluginRuntimeDescriptor(
  bundleInput: FuryPluginBundle,
  descriptor: FuryPluginRuntimeDescriptor,
): FuryPluginRuntimeDescriptor {
  const bundle = validateFuryPluginBundle(bundleInput);
  if (descriptor.format !== FURY_PLUGIN_RUNTIME_FORMAT) throw new Error('plugin runtime descriptor format is invalid');
  if (descriptor.pluginId !== bundle.id || descriptor.pluginVersion !== bundle.version) {
    throw new Error('plugin runtime descriptor identity does not match bundle');
  }
  if (!SEMVER.test(descriptor.hostApiVersion)) throw new Error('hostApiVersion must be pinned semver');
  if (!ISOLATION.has(descriptor.isolation)) throw new Error('plugin isolation mode is invalid');
  if (!Number.isInteger(descriptor.memoryLimitMiB) || descriptor.memoryLimitMiB < 16 || descriptor.memoryLimitMiB > 1024) {
    throw new Error('plugin memoryLimitMiB must be within 16..1024');
  }
  if (!Number.isInteger(descriptor.cpuTimeLimitMs) || descriptor.cpuTimeLimitMs < 50 || descriptor.cpuTimeLimitMs > 300_000) {
    throw new Error('plugin cpuTimeLimitMs must be within 50..300000');
  }
  if (descriptor.networkDefault !== 'DENY' || descriptor.filesystemDefault !== 'DENY' || descriptor.secretInjection !== 'ENV_NAMES_ONLY') {
    throw new Error('plugin runtime defaults must remain deny-by-default');
  }
  if (descriptor.uiExtensions.length > 32) throw new Error('plugin UI extension limit exceeded');
  const uiExtensions = Object.freeze(descriptor.uiExtensions.map((extension) => validateUiExtension(extension, bundle)));
  if (new Set(uiExtensions.map((extension) => extension.id)).size !== uiExtensions.length) throw new Error('plugin UI extension ids must be unique');
  return Object.freeze({ ...descriptor, uiExtensions });
}

export function planFuryPluginActivation(input: {
  readonly bundle: FuryPluginBundle;
  readonly descriptor: FuryPluginRuntimeDescriptor;
  readonly hostApiVersion: string;
  readonly supportedIsolation?: readonly FuryPluginIsolationMode[];
}): FuryPluginActivationPlan {
  const bundle = validateFuryPluginBundle(input.bundle);
  const descriptor = validateFuryPluginRuntimeDescriptor(bundle, input.descriptor);
  const hostMajor = major(input.hostApiVersion);
  const requiredMajor = major(descriptor.hostApiVersion);
  const supported = new Set(input.supportedIsolation ?? ['worker-thread', 'subprocess', 'browser-frame']);
  const incompatibilities: string[] = [];

  if (hostMajor !== requiredMajor) incompatibilities.push(`host API major mismatch: host=${input.hostApiVersion} plugin=${descriptor.hostApiVersion}`);
  if (!supported.has(descriptor.isolation)) incompatibilities.push(`unsupported isolation mode: ${descriptor.isolation}`);

  const requestedPermissions = Object.freeze([...bundle.permissions].sort());
  const payload = Object.freeze({
    bundle: { id: bundle.id, version: bundle.version, permissions: requestedPermissions },
    descriptor,
    hostApiVersion: input.hostApiVersion,
    supportedIsolation: Object.freeze([...supported].sort()),
  });

  return Object.freeze({
    format: FURY_PLUGIN_ACTIVATION_PLAN_FORMAT,
    pluginId: bundle.id,
    pluginVersion: bundle.version,
    descriptorDigestSha256: digest(payload),
    compatible: incompatibilities.length === 0,
    incompatibilities: Object.freeze(incompatibilities),
    requestedPermissions,
    uiExtensions: descriptor.uiExtensions,
    requiresApproval: true,
    installAuthorized: false,
    networkAuthorized: false,
    filesystemAuthorized: false,
    executionAuthorized: false,
  });
}
