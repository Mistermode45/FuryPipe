import { createHash } from 'node:crypto';

import {
  validateFuryPluginBundle,
  type FuryPluginBundle,
  type FuryPluginPermission,
} from './plugin-bundles.js';

export const FURY_PLUGIN_RUNTIME_ADMISSION_FORMAT = 'furypipe-plugin-runtime-admission/v1' as const;
export const FURY_PLUGIN_UI_EXTENSION_FORMAT = 'furypipe-plugin-ui-extension/v1' as const;

export type FuryPluginUiSlot =
  | 'sidebar-panel'
  | 'composer-toolbar'
  | 'inspector-panel'
  | 'artifact-preview'
  | 'settings-panel';

export interface FuryPluginUiExtension {
  readonly format: typeof FURY_PLUGIN_UI_EXTENSION_FORMAT;
  readonly id: string;
  readonly slot: FuryPluginUiSlot;
  readonly title: string;
  readonly entrypoint: string;
}

export interface FuryPluginRuntimeAdmission {
  readonly format: typeof FURY_PLUGIN_RUNTIME_ADMISSION_FORMAT;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly state: 'ADMITTED_METADATA_ONLY' | 'REJECTED';
  readonly bundleDigestSha256: string;
  readonly grantedPermissions: readonly FuryPluginPermission[];
  readonly uiExtensions: readonly FuryPluginUiExtension[];
  readonly isolation: {
    readonly processIsolation: 'required';
    readonly hostDomAccess: false;
    readonly credentialAccess: false;
    readonly filesystemAccess: 'none';
    readonly networkAccess: 'none';
    readonly contentSecurityPolicy: string;
  };
  readonly reasons: readonly string[];
  readonly requiresOperatorApproval: true;
  readonly mountAuthorized: false;
  readonly filesystemAuthorized: false;
  readonly networkAuthorized: false;
  readonly executionAuthorized: false;
}

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const ENTRYPOINT = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:html|js|mjs)$/u;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Readonly<Record<string, unknown>>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonical(record[key])).join(',') + '}';
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value),'utf8').digest('hex');
}

function bounded(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) throw new Error(`${label} is invalid`);
  return trimmed;
}

export function defineFuryPluginUiExtension(input: FuryPluginUiExtension): FuryPluginUiExtension {
  if (input.format !== FURY_PLUGIN_UI_EXTENSION_FORMAT) throw new Error('UI extension format is invalid');
  if (!ID.test(input.id)) throw new Error('UI extension id is invalid');
  if (!['sidebar-panel','composer-toolbar','inspector-panel','artifact-preview','settings-panel'].includes(input.slot)) {
    throw new Error('UI extension slot is invalid');
  }
  const entrypoint = bounded(input.entrypoint,'UI extension entrypoint',256);
  if (!ENTRYPOINT.test(entrypoint) || entrypoint.startsWith('/') || entrypoint.includes('..') || entrypoint.includes('\\')) {
    throw new Error('UI extension entrypoint must be a package-relative html/js module');
  }
  return Object.freeze({
    format: FURY_PLUGIN_UI_EXTENSION_FORMAT,
    id: input.id,
    slot: input.slot,
    title: bounded(input.title,'UI extension title',128),
    entrypoint,
  });
}

export function planFuryPluginRuntimeAdmission(input: {
  readonly bundle: FuryPluginBundle;
  readonly uiExtensions?: readonly FuryPluginUiExtension[];
  readonly grantedPermissions?: readonly FuryPluginPermission[];
  readonly operatorApproved: boolean;
}): FuryPluginRuntimeAdmission {
  const bundle = validateFuryPluginBundle(input.bundle);
  const extensions = Object.freeze((input.uiExtensions ?? []).map(defineFuryPluginUiExtension));
  if (extensions.length > 32) throw new Error('UI extension bound exceeded');
  if (new Set(extensions.map((extension) => extension.id)).size !== extensions.length) {
    throw new Error('UI extension ids must be unique');
  }

  const requested = new Set(bundle.permissions);
  const granted = Object.freeze([...(input.grantedPermissions ?? [])]);
  if (new Set(granted).size !== granted.length) throw new Error('granted permissions contain duplicates');
  for (const permission of granted) {
    if (!requested.has(permission)) throw new Error(`permission escalation rejected: ${permission}`);
  }

  const reasons: string[] = [];
  if (!input.operatorApproved) reasons.push('operator approval is required');
  if (granted.length < bundle.permissions.length) reasons.push('runtime permissions are narrower than the bundle declaration');

  const bundleDigestSha256 = digest({
    id: bundle.id,
    version: bundle.version,
    source: bundle.source,
    permissions: bundle.permissions,
    uiExtensions: extensions,
  });

  return Object.freeze({
    format: FURY_PLUGIN_RUNTIME_ADMISSION_FORMAT,
    pluginId: bundle.id,
    pluginVersion: bundle.version,
    state: input.operatorApproved ? 'ADMITTED_METADATA_ONLY' : 'REJECTED',
    bundleDigestSha256,
    grantedPermissions: granted,
    uiExtensions: extensions,
    isolation: Object.freeze({
      processIsolation: 'required' as const,
      hostDomAccess: false as const,
      credentialAccess: false as const,
      filesystemAccess: 'none' as const,
      networkAccess: 'none' as const,
      contentSecurityPolicy: CSP,
    }),
    reasons: Object.freeze(reasons),
    requiresOperatorApproval: true,
    mountAuthorized: false,
    filesystemAuthorized: false,
    networkAuthorized: false,
    executionAuthorized: false,
  });
}

export function projectFuryPluginUiExtensions(
  admission: FuryPluginRuntimeAdmission,
): readonly Readonly<{
  pluginId: string;
  extensionId: string;
  slot: FuryPluginUiSlot;
  title: string;
  entrypoint: string;
  renderMode: 'sandboxed-iframe';
  mountAuthorized: false;
}>[] {
  if (admission.format !== FURY_PLUGIN_RUNTIME_ADMISSION_FORMAT || admission.state !== 'ADMITTED_METADATA_ONLY') {
    return Object.freeze([]);
  }
  return Object.freeze(admission.uiExtensions.map((extension) => Object.freeze({
    pluginId: admission.pluginId,
    extensionId: extension.id,
    slot: extension.slot,
    title: extension.title,
    entrypoint: extension.entrypoint,
    renderMode: 'sandboxed-iframe' as const,
    mountAuthorized: false as const,
  })));
}
