import { createHash } from 'node:crypto';

import type { DoctorCheck } from './doctor.js';
import {
  isGeneratedFuryBetaReadinessSnapshot,
  type FuryBetaReadinessSnapshot,
  type FuryBetaReadinessState,
} from './beta-readiness.js';

export const FURY_BETA_ONBOARDING_FORMAT = 'furypipe-beta-onboarding/v1' as const;
export const FURY_BETA_ONBOARDING_DOMAINS = Object.freeze([
  'models',
  'providers',
  'skills',
  'plugins',
  'mcp',
  'channels',
  'automations',
  'browser',
  'coding',
  'devices',
  'memory',
  'gateway',
  'approvals',
  'policy',
  'recovery',
] as const);

export type FuryBetaOnboardingDomain = (typeof FURY_BETA_ONBOARDING_DOMAINS)[number];
export type FuryBetaOnboardingState = 'yes' | 'no' | 'unknown' | 'not-applicable';

export interface FuryBetaOnboardingItem {
  readonly domain: FuryBetaOnboardingDomain;
  readonly source: string;
  readonly configured: FuryBetaOnboardingState;
  readonly available: FuryBetaOnboardingState;
  readonly authenticated: FuryBetaOnboardingState;
  readonly authorized: FuryBetaOnboardingState;
  readonly selected: FuryBetaOnboardingState;
  readonly executed: FuryBetaOnboardingState;
  readonly inventoryCount?: number;
  readonly reasonCodes: readonly string[];
}

export interface FuryBetaOnboardingSnapshot {
  readonly format: typeof FURY_BETA_ONBOARDING_FORMAT;
  readonly observedAt: number;
  readonly items: readonly FuryBetaOnboardingItem[];
  readonly configuredCount: number;
  readonly availableCount: number;
  readonly authenticatedCount: number;
  readonly authorizedCount: number;
  readonly selectedCount: number;
  readonly executedCount: number;
  readonly authority: 'readiness-observation-only';
  readonly installationAuthority: false;
  readonly grantAuthority: false;
  readonly credentialValuesIncluded: false;
  readonly digestSha256: string;
}

export interface FuryBetaOnboardingRuntimeInput {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly observedAt?: number;
  readonly readiness?: FuryBetaReadinessSnapshot;
  readonly tools?: Readonly<Partial<Record<'browser' | 'claude' | 'codex', DoctorCheck>>>;
  readonly modelScopeMode?: 'automatic' | 'explicit' | 'off';
  /** Counts are host observations, never a promise that a capability executed. */
  readonly inventoryCounts?: Readonly<Partial<Record<FuryBetaOnboardingDomain, number>>>;
  readonly selectedDomains?: readonly FuryBetaOnboardingDomain[];
  readonly executedDomains?: readonly FuryBetaOnboardingDomain[];
}

const DOMAIN_SET = new Set<string>(FURY_BETA_ONBOARDING_DOMAINS);
const STATES = new Set<string>(['yes', 'no', 'unknown', 'not-applicable']);
const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const SOURCE = /^[a-z0-9][a-z0-9._:/-]{0,127}$/u;
const REASON = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_ITEMS = 64;
const MAX_REASONS = 24;
const SNAPSHOTS = new WeakSet<object>();
const ITEM_KEYS = new Set([
  'domain', 'source', 'configured', 'available', 'authenticated', 'authorized',
  'selected', 'executed', 'inventoryCount', 'reasonCodes',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function state(value: unknown, label: string): FuryBetaOnboardingState {
  if (typeof value !== 'string' || !STATES.has(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as FuryBetaOnboardingState;
}

function boundedReasons(value: readonly string[] | undefined, label: string): readonly string[] {
  const values = value ?? [];
  if (!Array.isArray(values) || values.length > MAX_REASONS) {
    throw new RangeError(`${label} must contain at most ${MAX_REASONS} reason codes`);
  }
  const output = values.map((reason) => {
    if (typeof reason !== 'string' || !REASON.test(reason)) {
      throw new TypeError(`${label} contains an invalid reason code`);
    }
    return reason;
  });
  if (new Set(output).size !== output.length) throw new Error(`${label} contains duplicates`);
  return Object.freeze([...output].sort((a, b) => a.localeCompare(b)));
}

function boundedCount(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100_000) {
    throw new RangeError(`${label} must be an integer from 0 to 100000`);
  }
  return value as number;
}

function boundedDomainSet(
  value: readonly FuryBetaOnboardingDomain[] | undefined,
  label: string,
): ReadonlySet<FuryBetaOnboardingDomain> {
  const values = value ?? [];
  if (!Array.isArray(values) || values.length > MAX_ITEMS) {
    throw new RangeError(`${label} must contain at most ${MAX_ITEMS} domains`);
  }
  const output = new Set<FuryBetaOnboardingDomain>();
  for (const domain of values) {
    if (typeof domain !== 'string' || !DOMAIN_SET.has(domain)) {
      throw new TypeError(`${label} contains an invalid domain`);
    }
    if (output.has(domain as FuryBetaOnboardingDomain)) {
      throw new Error(`${label} contains duplicate domains`);
    }
    output.add(domain as FuryBetaOnboardingDomain);
  }
  return output;
}

function exactItems(value: readonly FuryBetaOnboardingItem[]): readonly FuryBetaOnboardingItem[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || Object.getOwnPropertySymbols(value).length !== 0) {
    throw new RangeError(`beta onboarding accepts at most ${MAX_ITEMS} items`);
  }
  if (Object.getOwnPropertyNames(value).some((name) =>
    name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name))) {
    throw new TypeError('beta onboarding items contain unsupported array properties');
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('beta onboarding items contain sparse or accessor entries');
    }
  }
  const ids = new Set<string>();
  return Object.freeze(value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`beta onboarding item ${index} is invalid`);
    }
    if (Object.getPrototypeOf(item) !== Object.prototype || Object.getOwnPropertySymbols(item).length > 0) {
      throw new TypeError(`beta onboarding item ${index} must be a plain data object`);
    }
    for (const key of Object.getOwnPropertyNames(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !ITEM_KEYS.has(key)) {
        throw new TypeError(`beta onboarding item ${index} contains unsupported or unsafe fields`);
      }
    }
    if (typeof item.domain !== 'string' || !DOMAIN_SET.has(item.domain) || !ID.test(item.domain)) {
      throw new TypeError(`beta onboarding item ${index} domain is invalid`);
    }
    if (ids.has(item.domain)) throw new Error(`duplicate beta onboarding domain: ${item.domain}`);
    ids.add(item.domain);
    if (typeof item.source !== 'string' || !SOURCE.test(item.source.trim())) {
      throw new TypeError(`beta onboarding item ${index} source is invalid`);
    }
    const normalized = Object.freeze({
      domain: item.domain as FuryBetaOnboardingDomain,
      source: item.source.trim(),
      configured: state(item.configured, `${item.domain}.configured`),
      available: state(item.available, `${item.domain}.available`),
      authenticated: state(item.authenticated, `${item.domain}.authenticated`),
      authorized: state(item.authorized, `${item.domain}.authorized`),
      selected: state(item.selected, `${item.domain}.selected`),
      executed: state(item.executed, `${item.domain}.executed`),
      ...(boundedCount(item.inventoryCount, `${item.domain}.inventoryCount`) === undefined
        ? {}
        : { inventoryCount: boundedCount(item.inventoryCount, `${item.domain}.inventoryCount`) }),
      reasonCodes: boundedReasons(item.reasonCodes, `${item.domain}.reasonCodes`),
    });
    return normalized;
  }).sort((a, b) => a.domain.localeCompare(b.domain)));
}

function yesCount(items: readonly FuryBetaOnboardingItem[], key: keyof FuryBetaOnboardingItem): number {
  return items.filter((item) => item[key] === 'yes').length;
}

export function createFuryBetaOnboardingSnapshot(input: {
  readonly observedAt: number;
  readonly items: readonly FuryBetaOnboardingItem[];
}): FuryBetaOnboardingSnapshot {
  if (!input || typeof input !== 'object') {
    throw new TypeError('beta onboarding input must be an object');
  }
  if (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0) {
    throw new RangeError('beta onboarding observedAt must be a non-negative safe integer timestamp');
  }
  const items = exactItems(input.items);
  const canonical = {
    format: FURY_BETA_ONBOARDING_FORMAT,
    observedAt: input.observedAt,
    items,
  };
  const snapshot = Object.freeze({
    ...canonical,
    configuredCount: yesCount(items, 'configured'),
    availableCount: yesCount(items, 'available'),
    authenticatedCount: yesCount(items, 'authenticated'),
    authorizedCount: yesCount(items, 'authorized'),
    selectedCount: yesCount(items, 'selected'),
    executedCount: yesCount(items, 'executed'),
    authority: 'readiness-observation-only',
    installationAuthority: false,
    grantAuthority: false,
    credentialValuesIncluded: false,
    digestSha256: sha256(JSON.stringify(canonical)),
  });
  SNAPSHOTS.add(snapshot);
  return snapshot;
}

export function isGeneratedFuryBetaOnboardingSnapshot(value: unknown): value is FuryBetaOnboardingSnapshot {
  return typeof value === 'object' && value !== null && SNAPSHOTS.has(value);
}

function present(env: Readonly<Record<string, string | undefined>>, keys: readonly string[]): boolean {
  return keys.some((key) => Boolean(env[key]?.trim()));
}

function readinessState(
  readiness: FuryBetaReadinessSnapshot | undefined,
  id: string,
): FuryBetaReadinessState | undefined {
  return readiness?.subsystems.find((item) => item.id === id)?.status;
}

function availabilityFromReadiness(
  readiness: FuryBetaReadinessSnapshot | undefined,
  id: string,
): FuryBetaOnboardingState {
  const status = readinessState(readiness, id);
  if (status === 'ready') return 'yes';
  if (status === 'blocked' || status === 'unsupported' || status === 'unavailable') return 'no';
  return 'unknown';
}

function reasonForReadiness(
  readiness: FuryBetaReadinessSnapshot | undefined,
  id: string,
): string[] {
  const item = readiness?.subsystems.find((entry) => entry.id === id);
  return item ? [...item.reasonCodes] : ['not-observed'];
}

function item(
  domain: FuryBetaOnboardingDomain,
  source: string,
  values: Omit<FuryBetaOnboardingItem, 'domain' | 'source' | 'reasonCodes'>,
  reasonCodes: readonly string[],
): FuryBetaOnboardingItem {
  return { domain, source, ...values, reasonCodes };
}

/**
 * Collect a conservative onboarding view from host-visible facts. Presence of
 * a credential/config flag is never promoted to authentication, authorization,
 * selection, execution or capability availability.
 */
export function collectFuryBetaOnboarding(
  options: FuryBetaOnboardingRuntimeInput = {},
): FuryBetaOnboardingSnapshot {
  const env = options.env ?? process.env;
  const observedAt = options.observedAt ?? Date.now();
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    throw new RangeError('beta onboarding observedAt must be a non-negative safe integer timestamp');
  }
  if (options.readiness !== undefined && !isGeneratedFuryBetaReadinessSnapshot(options.readiness)) {
    throw new TypeError('beta onboarding requires generated readiness evidence');
  }
  const counts = options.inventoryCounts ?? {};
  const selected = boundedDomainSet(options.selectedDomains, 'selectedDomains');
  const executed = boundedDomainSet(options.executedDomains, 'executedDomains');
  const countFor = (domain: FuryBetaOnboardingDomain): number | undefined => counts[domain];
  const availableFor = (domain: FuryBetaOnboardingDomain): FuryBetaOnboardingState => {
    const count = countFor(domain);
    if (count !== undefined) return count > 0 ? 'yes' : 'no';
    return 'unknown';
  };
  const common = (domain: FuryBetaOnboardingDomain, source: string, values: Omit<FuryBetaOnboardingItem, 'domain' | 'source' | 'reasonCodes'>, reasons: string[]) => item(
    domain,
    source,
    {
      ...values,
      ...(countFor(domain) === undefined ? {} : { inventoryCount: countFor(domain) }),
      selected: selected.has(domain) ? 'yes' : values.selected,
      executed: executed.has(domain) ? 'yes' : values.executed,
    },
    reasons,
  );

  const providerConfigured = present(env, [
    'FURYPIPE_PROVIDER', 'FURYPIPE_GATEWAY_BASE_URL', 'FURYPIPE_UPSTREAM',
    'ANTHROPIC_UPSTREAM', 'OPENAI_UPSTREAM', 'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN_FILE', 'OPENAI_API_KEY',
    'CLOUDFLARE_API_TOKEN', 'OMNIROUTE_API_KEY',
  ]);
  const modelConfigured = options.modelScopeMode !== undefined
    ? options.modelScopeMode !== 'off'
    : present(env, ['FURYPIPE_MODELS', 'OPENAI_MODELS', 'CLOUDFLARE_MODELS']);
  const browserAvailable = options.tools?.browser?.status === 'available'
    ? 'yes' : options.tools?.browser?.status === 'unavailable' ? 'no' : 'unknown';
  const codingAvailable = options.tools?.claude?.status === 'available'
    || options.tools?.codex?.status === 'available'
    ? 'yes'
    : options.tools?.claude?.status === 'unavailable' && options.tools?.codex?.status === 'unavailable'
      ? 'no' : 'unknown';
  const gatewayAvailability = availabilityFromReadiness(options.readiness, 'gateway');
  const runtimeAvailability = availabilityFromReadiness(options.readiness, 'runtime');
  const readinessReasons = (id: string): string[] => reasonForReadiness(options.readiness, id);
  const items: FuryBetaOnboardingItem[] = [
    common('models', 'model-scope-and-catalog', {
      configured: modelConfigured ? 'yes' : 'no', available: availableFor('models'), authenticated: 'not-applicable',
      authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, modelConfigured ? ['catalog-availability-not-probed'] : ['model-scope-not-configured']),
    common('providers', 'provider-environment-presence', {
      configured: providerConfigured ? 'yes' : 'no', available: availabilityFromReadiness(options.readiness, 'provider'),
      authenticated: 'unknown', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, providerConfigured ? ['credentials-present-not-validated', ...readinessReasons('provider')] : ['provider-not-configured']),
    common('skills', 'agent-skill-discovery-boundary', {
      configured: /^(?:0|false|no|off)$/iu.test(env.FURYPIPE_AGENT_SKILLS?.trim() ?? '') ? 'no' : 'yes',
      available: availableFor('skills'), authenticated: 'not-applicable', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['inventory-not-wired']),
    common('plugins', 'plugin-registry-boundary', {
      configured: present(env, ['FURYPIPE_PLUGIN_IDS', 'FURYPIPE_PLUGINS']) ? 'yes' : 'unknown',
      available: availableFor('plugins'), authenticated: 'unknown', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['no-automatic-install', 'inventory-not-wired']),
    common('mcp', 'mcp-runtime-inventory', {
      configured: present(env, ['FURYPIPE_MCP_SERVERS', 'FURYPIPE_MCP_CONFIG']) ? 'yes' : 'unknown',
      available: availableFor('mcp'), authenticated: 'unknown', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['no-automatic-connect', 'inventory-not-wired']),
    common('channels', 'gateway-channel-registry', {
      configured: present(env, ['FURYPIPE_CHANNELS', 'FURYPIPE_DISCORD_TOKEN']) ? 'yes' : 'unknown',
      available: availableFor('channels'), authenticated: 'unknown', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['connection-not-probed', 'inventory-not-wired']),
    common('automations', 'gateway-automation-registry', {
      configured: present(env, ['FURYPIPE_AUTOMATIONS', 'FURYPIPE_AUTOMATION_CONFIG']) ? 'yes' : 'unknown',
      available: availableFor('automations'), authenticated: 'not-applicable', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['scheduler-not-probed', 'inventory-not-wired']),
    common('browser', 'doctor-browser-tool', {
      configured: 'not-applicable', available: browserAvailable, authenticated: 'not-applicable', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, browserAvailable === 'unknown' ? ['browser-tool-not-observed'] : []),
    common('coding', 'doctor-coding-tools', {
      configured: 'not-applicable', available: codingAvailable, authenticated: 'unknown', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, codingAvailable === 'unknown' ? ['coding-tool-not-observed'] : []),
    common('devices', 'phase9-device-registry', {
      configured: present(env, ['FURYPIPE_DEVICES', 'FURYPIPE_DEVICE_CONFIG']) ? 'yes' : 'unknown',
      available: availableFor('devices'), authenticated: 'unknown', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['pairing-is-not-permission', 'inventory-not-wired']),
    common('memory', 'local-memory-runtime', {
      configured: 'yes', available: availableFor('memory'), authenticated: 'not-applicable', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['memory-execution-not-observed']),
    common('gateway', 'beta-readiness-runtime', {
      configured: 'yes', available: gatewayAvailability, authenticated: 'not-applicable', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, readinessReasons('gateway')),
    common('approvals', 'governed-policy-boundary', {
      configured: 'unknown', available: 'unknown', authenticated: 'not-applicable', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['approval-state-not-observed']),
    common('policy', 'governed-policy-boundary', {
      configured: 'yes', available: runtimeAvailability, authenticated: 'not-applicable', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['policy-authorization-not-observed']),
    common('recovery', 'recovery-ledger-and-restart-evidence', {
      configured: 'yes', available: availableFor('recovery'), authenticated: 'not-applicable', authorized: 'unknown', selected: 'unknown', executed: 'unknown',
    }, ['recovery-outcomes-not-observed']),
  ];
  return createFuryBetaOnboardingSnapshot({ observedAt, items });
}

export function isFuryBetaOnboardingDigest(value: string): boolean {
  return SHA256.test(value);
}
