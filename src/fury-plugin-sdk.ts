import { createHash } from 'node:crypto';

import {
  inspectFuryPluginBundle,
  validateFuryPluginBundle,
  type FuryPluginBundle,
  type FuryPluginBundleInspection,
} from './plugin-bundles.js';

export const FURY_PLUGIN_SDK_MANIFEST_FORMAT = 'furypipe-plugin-sdk-manifest/v1' as const;

export interface FuryPluginSdkManifest {
  readonly format: typeof FURY_PLUGIN_SDK_MANIFEST_FORMAT;
  readonly bundle: FuryPluginBundleInspection;
  readonly manifestDigestSha256: string;
  readonly authority: 'authoring-and-inspection-only';
  readonly installAuthorized: false;
  readonly networkAuthorized: false;
  readonly filesystemAuthorized: false;
  readonly executionAuthorized: false;
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

/**
 * Author-facing helper for declaring FuryPipe plugins.
 *
 * It delegates all validation to the existing Plugin Bundle contract. This SDK
 * does not load code, install packages, connect MCP servers, read secrets or
 * grant permissions.
 */
export function defineFuryPlugin(bundle: FuryPluginBundle): FuryPluginBundle {
  return validateFuryPluginBundle(bundle);
}

/**
 * Compile a validated bundle into deterministic, secret-redacted metadata that
 * can be reviewed, signed or projected into catalog/marketplace tooling.
 */
export function compileFuryPluginManifest(bundle: FuryPluginBundle): FuryPluginSdkManifest {
  const valid = validateFuryPluginBundle(bundle);
  const inspection = inspectFuryPluginBundle(valid);
  const payload = Object.freeze({
    format: FURY_PLUGIN_SDK_MANIFEST_FORMAT,
    bundle: inspection,
  });
  return Object.freeze({
    ...payload,
    manifestDigestSha256: digest(payload),
    authority: 'authoring-and-inspection-only',
    installAuthorized: false,
    networkAuthorized: false,
    filesystemAuthorized: false,
    executionAuthorized: false,
  });
}
