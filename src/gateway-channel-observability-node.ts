import {
  isGeneratedFuryGatewayChannelAdapterRegistry,
  type FuryGatewayChannelAdapterRegistry,
  type FuryGatewayChannelCapability,
} from './gateway-channel-adapter-node.js';
import {
  isGeneratedFuryGatewayChannelDeliveryCoordinator,
  type FuryGatewayChannelDeliveryCoordinator,
  type FuryGatewayChannelDeliveryStatusSnapshot,
} from './gateway-channel-delivery-node.js';
import {
  FURY_GATEWAY_CHANNEL_OBSERVABILITY_STATE_COMMAND_NAMES,
  type FuryGatewayChannelObservabilityStateCommandName,
} from './gateway-channel-observability-command-node.js';
import {
  isGeneratedFuryGatewayDiscordAdapter,
  type FuryGatewayDiscordAdapter,
} from './gateway-discord-adapter-node.js';
import {
  isGeneratedFuryGatewayNotificationCoordinator,
  type FuryGatewayNotificationCoordinator,
  type FuryGatewayNotificationStatusSnapshot,
} from './gateway-notification-node.js';

export const FURY_GATEWAY_CHANNEL_OBSERVABILITY_FORMAT =
  'furypipe-gateway-channel-observability/v1' as const;
export const FURY_GATEWAY_CHANNEL_OBSERVABILITY_RESULT_FORMAT =
  'furypipe-gateway-channel-observability-result/v1' as const;

export interface FuryGatewayChannelAdapterStatusSummary {
  readonly adapterId: string;
  readonly channelKind: string;
  readonly capabilities: readonly FuryGatewayChannelCapability[];
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayChannelObservabilitySnapshot {
  readonly format: typeof FURY_GATEWAY_CHANNEL_OBSERVABILITY_FORMAT;
  readonly observedAt: number;
  readonly channels: {
    readonly adaptersConfigured: number;
    readonly replayEntries: number;
    readonly adapterSummaries: readonly FuryGatewayChannelAdapterStatusSummary[];
    readonly adapterSummariesTruncated: boolean;
  };
  readonly delivery: FuryGatewayChannelDeliveryStatusSnapshot;
  readonly notifications: FuryGatewayNotificationStatusSnapshot;
  readonly discord?: {
    readonly activeServiceAuthentications: number;
    readonly authority: 'observability-only';
    readonly executionAuthority: false;
  };
  readonly browserAuthority: 'none';
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayChannelObservabilityCommandResult {
  readonly format: typeof FURY_GATEWAY_CHANNEL_OBSERVABILITY_RESULT_FORMAT;
  readonly commandName: FuryGatewayChannelObservabilityStateCommandName;
  readonly status: 'ok' | 'rejected';
  readonly result?: FuryGatewayChannelObservabilitySnapshot;
  readonly error?: {
    readonly code: string;
  };
  readonly authority: 'observability-only';
  readonly executionAuthority: false;
}

export interface FuryGatewayChannelObservabilityOptions {
  readonly channelRegistry: FuryGatewayChannelAdapterRegistry;
  readonly deliveryCoordinator: FuryGatewayChannelDeliveryCoordinator;
  readonly notificationCoordinator: FuryGatewayNotificationCoordinator;
  readonly discordAdapter?: FuryGatewayDiscordAdapter;
  readonly now?: () => number;
  readonly maxAdapterSummaries?: number;
  readonly maxResultBytes?: number;
}

export interface FuryGatewayChannelObservability {
  snapshot(): FuryGatewayChannelObservabilitySnapshot;
  dispatchState(
    commandName: FuryGatewayChannelObservabilityStateCommandName,
    input: unknown,
  ): FuryGatewayChannelObservabilityCommandResult;
}

const GENERATED_OBSERVERS = new WeakSet<object>();
const DEFAULT_MAX_ADAPTER_SUMMARIES = 64;
const HARD_MAX_ADAPTER_SUMMARIES = 256;
const DEFAULT_MAX_RESULT_BYTES = 64 * 1024;
const HARD_MAX_RESULT_BYTES = 256 * 1024;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(label + ' must be an integer from ' + min + ' to ' + max);
  }
  return resolved;
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('channel observability clock must return a safe non-negative timestamp');
  }
  return value;
}

function exactEmptyRecord(value: unknown): void {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new Error('channels.status input must be a plain data object');
  }
  if (Object.getOwnPropertyNames(value).length !== 0) {
    throw new Error('channels.status input contains unsupported fields');
  }
}

function ok(
  snapshot: FuryGatewayChannelObservabilitySnapshot,
): FuryGatewayChannelObservabilityCommandResult {
  return Object.freeze({
    format: FURY_GATEWAY_CHANNEL_OBSERVABILITY_RESULT_FORMAT,
    commandName: 'channels.status' as const,
    status: 'ok' as const,
    result: snapshot,
    authority: 'observability-only' as const,
    executionAuthority: false as const,
  });
}

function rejected(code: string): FuryGatewayChannelObservabilityCommandResult {
  return Object.freeze({
    format: FURY_GATEWAY_CHANNEL_OBSERVABILITY_RESULT_FORMAT,
    commandName: 'channels.status' as const,
    status: 'rejected' as const,
    error: Object.freeze({ code }),
    authority: 'observability-only' as const,
    executionAuthority: false as const,
  });
}

function boundResult(
  result: FuryGatewayChannelObservabilityCommandResult,
  maxResultBytes: number,
): FuryGatewayChannelObservabilityCommandResult {
  let encoded: string;
  try {
    encoded = JSON.stringify(result);
  } catch {
    return rejected('channel-observability-result-not-serializable');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxResultBytes) {
    return rejected('channel-observability-result-too-large');
  }
  return result;
}

export function isGeneratedFuryGatewayChannelObservability(
  value: unknown,
): value is FuryGatewayChannelObservability {
  return typeof value === 'object'
    && value !== null
    && GENERATED_OBSERVERS.has(value);
}

export function createFuryGatewayChannelObservability(
  options: FuryGatewayChannelObservabilityOptions,
): FuryGatewayChannelObservability {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !isGeneratedFuryGatewayChannelAdapterRegistry(options.channelRegistry)
    || !isGeneratedFuryGatewayChannelDeliveryCoordinator(options.deliveryCoordinator)
    || !isGeneratedFuryGatewayNotificationCoordinator(options.notificationCoordinator)
    || (
      options.discordAdapter !== undefined
      && !isGeneratedFuryGatewayDiscordAdapter(options.discordAdapter)
    )
  ) {
    throw new Error(
      'channel observability requires process-local channel, delivery, notification and optional Discord evidence',
    );
  }

  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new Error('channel observability now must be a function');
  }
  safeNow(now);

  const maxAdapterSummaries = boundedInteger(
    options.maxAdapterSummaries,
    DEFAULT_MAX_ADAPTER_SUMMARIES,
    1,
    HARD_MAX_ADAPTER_SUMMARIES,
    'maxAdapterSummaries',
  );
  const maxResultBytes = boundedInteger(
    options.maxResultBytes,
    DEFAULT_MAX_RESULT_BYTES,
    1024,
    HARD_MAX_RESULT_BYTES,
    'maxResultBytes',
  );

  const channelRegistry = options.channelRegistry;
  const deliveryCoordinator = options.deliveryCoordinator;
  const notificationCoordinator = options.notificationCoordinator;
  const discordAdapter = options.discordAdapter;

  const api: FuryGatewayChannelObservability = Object.freeze({
    snapshot(): FuryGatewayChannelObservabilitySnapshot {
      const observedAt = safeNow(now);
      const adapters = channelRegistry.list();
      const adapterSummaries = Object.freeze(
        adapters
          .slice(0, maxAdapterSummaries)
          .map((adapter) => Object.freeze({
            adapterId: adapter.adapterId,
            channelKind: adapter.channelKind,
            capabilities: Object.freeze([...adapter.capabilities]),
            authority: 'observability-only' as const,
            executionAuthority: false as const,
          })),
      );

      return Object.freeze({
        format: FURY_GATEWAY_CHANNEL_OBSERVABILITY_FORMAT,
        observedAt,
        channels: Object.freeze({
          adaptersConfigured: adapters.length,
          replayEntries: channelRegistry.replayEntryCount(),
          adapterSummaries,
          adapterSummariesTruncated: adapters.length > adapterSummaries.length,
        }),
        delivery: deliveryCoordinator.statusSnapshot(),
        notifications: notificationCoordinator.statusSnapshot(),
        ...(discordAdapter === undefined
          ? {}
          : {
              discord: Object.freeze({
                activeServiceAuthentications: discordAdapter.activeAuthenticationCount(),
                authority: 'observability-only' as const,
                executionAuthority: false as const,
              }),
            }),
        browserAuthority: 'none' as const,
        authority: 'observability-only' as const,
        executionAuthority: false as const,
      });
    },

    dispatchState(
      commandName: FuryGatewayChannelObservabilityStateCommandName,
      input: unknown,
    ): FuryGatewayChannelObservabilityCommandResult {
      if (
        typeof commandName !== 'string'
        || !(FURY_GATEWAY_CHANNEL_OBSERVABILITY_STATE_COMMAND_NAMES as readonly string[])
          .includes(commandName)
      ) {
        throw new Error('Gateway channel observability state command is unsupported');
      }
      try {
        exactEmptyRecord(input);
        return boundResult(ok(api.snapshot()), maxResultBytes);
      } catch {
        return rejected('channel-observability-input-invalid');
      }
    },
  });

  GENERATED_OBSERVERS.add(api);
  return api;
}
