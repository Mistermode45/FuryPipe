import { randomBytes } from 'node:crypto';

import {
  isGeneratedFuryGatewayChannelInboundEvent,
  type FuryGatewayChannelConversationKind,
  type FuryGatewayChannelInboundEvent,
} from './gateway-channel-adapter-node.js';
import {
  isGeneratedFuryGatewayAuthenticatedPrincipal,
  type FuryGatewayAuthenticatedPrincipal,
  type FuryGatewayPrincipalRegistry,
} from './gateway-principal-node.js';
import type { FuryGatewayScope } from './gateway-session-node.js';

export const FURY_GATEWAY_CHANNEL_PRINCIPAL_BINDING_FORMAT =
  'furypipe-gateway-channel-principal-binding/v1' as const;

export const FURY_GATEWAY_CHANNEL_DIRECT_SCOPES = Object.freeze([
  'gateway.inspect',
  'conversations.inspect',
  'conversations.write',
  'channels.inspect',
  'memory.read',
  'plugins.inspect',
  'skills.inspect',
  'mcp.inspect',
  'models.inspect',
  'evidence.read',
  'capability.provider-inference',
] as const satisfies readonly FuryGatewayScope[]);

export const FURY_GATEWAY_CHANNEL_SHARED_SCOPES = Object.freeze([
  'gateway.inspect',
  'conversations.inspect',
  'conversations.write',
  'channels.inspect',
  'models.inspect',
  'capability.provider-inference',
] as const satisfies readonly FuryGatewayScope[]);

export interface FuryGatewayChannelPrincipalBindingInput {
  /** Current process-local authenticated Fury principal selected by trusted host mapping. */
  readonly principal: FuryGatewayAuthenticatedPrincipal;
  /** Current process-local normalized event. The caller must authenticate the channel transport before binding. */
  readonly event: FuryGatewayChannelInboundEvent;
  readonly policyProfileId: string;
  readonly scopes: readonly FuryGatewayScope[];
  readonly expiresInMs?: number;
}

export interface FuryGatewayChannelPrincipalBinding {
  readonly format: typeof FURY_GATEWAY_CHANNEL_PRINCIPAL_BINDING_FORMAT;
  readonly bindingId: string;
  readonly principalId: string;
  readonly principalGeneration: number;
  readonly principalAuthenticatedAt: number;
  readonly adapterId: string;
  readonly channelKind: string;
  readonly accountDigestSha256: string;
  readonly senderDigestSha256: string;
  readonly conversationDigestSha256: string;
  readonly conversationKind: FuryGatewayChannelConversationKind;
  readonly threadDigestSha256?: string;
  readonly eventReplayKeySha256: string;
  readonly policyProfileId: string;
  readonly scopes: readonly FuryGatewayScope[];
  readonly boundAt: number;
  readonly expiresAt: number;
  readonly transportAuthentication: 'host-verified';
  readonly authority: 'channel-principal-binding';
  readonly executionAuthority: false;
}

export type FuryGatewayChannelPrincipalBindingStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'principal-revoked';

export interface FuryGatewayChannelPrincipalBindingInspection {
  readonly bindingId: string;
  readonly principalId: string;
  readonly adapterId: string;
  readonly channelKind: string;
  readonly accountDigestSha256: string;
  readonly senderDigestSha256: string;
  readonly conversationDigestSha256: string;
  readonly conversationKind: FuryGatewayChannelConversationKind;
  readonly threadDigestSha256?: string;
  readonly policyProfileId: string;
  readonly scopes: readonly FuryGatewayScope[];
  readonly boundAt: number;
  readonly expiresAt: number;
  readonly status: FuryGatewayChannelPrincipalBindingStatus;
  readonly executionAuthority: false;
}

export interface FuryGatewayChannelPrincipalBindingCoordinatorOptions {
  readonly principalRegistry: FuryGatewayPrincipalRegistry;
  readonly now?: () => number;
  readonly defaultTtlMs?: number;
  readonly maxTtlMs?: number;
  readonly terminalRetentionMs?: number;
  readonly maxBindings?: number;
}

export interface FuryGatewayChannelPrincipalBindingCoordinator {
  /**
   * Trusted-host boundary. The caller must authenticate the channel service/transport
   * and decide the external-sender -> Fury-principal mapping before invoking this.
   * This function validates and binds process-local evidence; it does not validate bot tokens.
   */
  recordAuthenticatedSenderBinding(
    input: FuryGatewayChannelPrincipalBindingInput,
  ): FuryGatewayChannelPrincipalBinding;
  revokeBinding(bindingId: string): boolean;
  inspectBinding(
    binding: FuryGatewayChannelPrincipalBinding,
  ): FuryGatewayChannelPrincipalBindingInspection;
  isCurrentBinding(binding: FuryGatewayChannelPrincipalBinding): boolean;
  activeCount(): number;
}

export type FuryGatewayChannelPrincipalBindingErrorCode =
  | 'invalid-input'
  | 'invalid-principal-evidence'
  | 'invalid-event-evidence'
  | 'invalid-scope'
  | 'invalid-binding'
  | 'binding-expired'
  | 'binding-revoked'
  | 'principal-revoked'
  | 'limit-exceeded';

export class FuryGatewayChannelPrincipalBindingError extends Error {
  readonly code: FuryGatewayChannelPrincipalBindingErrorCode;

  constructor(code: FuryGatewayChannelPrincipalBindingErrorCode, message: string) {
    super(message);
    this.name = 'FuryGatewayChannelPrincipalBindingError';
    this.code = code;
  }
}

interface BindingState {
  readonly binding: FuryGatewayChannelPrincipalBinding;
  status: FuryGatewayChannelPrincipalBindingStatus;
  terminalAt?: number;
}

const BINDING_EVIDENCE = new WeakSet<object>();
const BINDING_COORDINATOR_EVIDENCE = new WeakSet<object>();
const BINDING_ID_RE = /^[A-Za-z0-9_-]{32}$/u;
const POLICY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/u;
const DEFAULT_TTL_MS = 10 * 60_000;
const MIN_TTL_MS = 30_000;
const HARD_MAX_TTL_MS = 60 * 60_000;
const DEFAULT_TERMINAL_RETENTION_MS = 5 * 60_000;
const MIN_TERMINAL_RETENTION_MS = 30_000;
const HARD_MAX_TERMINAL_RETENTION_MS = 60 * 60_000;
const DEFAULT_MAX_BINDINGS = 16_384;
const HARD_MAX_BINDINGS = 200_000;

const DIRECT_SCOPE_SET = new Set<string>(FURY_GATEWAY_CHANNEL_DIRECT_SCOPES);
const SHARED_SCOPE_SET = new Set<string>(FURY_GATEWAY_CHANNEL_SHARED_SCOPES);

function exactPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-input',
      label + ' must be a plain data object',
    );
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !allowed.has(key)
    ) {
      throw new FuryGatewayChannelPrincipalBindingError(
        'invalid-input',
        label + ' contains unsupported or unsafe fields',
      );
    }
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new FuryGatewayChannelPrincipalBindingError(
        'invalid-input',
        label + ' is missing required field: ' + key,
      );
    }
  }
  return record;
}

function dataArrayValues(value: unknown, label: string, maxItems: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-scope',
      label + ' must contain 1-' + maxItems + ' entries',
    );
  }
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-scope',
      label + ' must be a plain data array',
    );
  }
  const own = Object.getOwnPropertyNames(value);
  if (own.some((name) => name !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(name))) {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-scope',
      label + ' contains unsupported array properties',
    );
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new FuryGatewayChannelPrincipalBindingError(
        'invalid-scope',
        label + ' contains sparse, hidden, or accessor entries',
      );
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-input',
      label + ' must be an integer from ' + min + ' to ' + max,
    );
  }
  return resolved;
}

function finiteNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-input',
      'channel binding clock must return a safe non-negative timestamp',
    );
  }
  return value;
}

function policyProfileId(value: unknown): string {
  if (typeof value !== 'string' || !POLICY_ID_RE.test(value)) {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-input',
      'channel policy profile ID is invalid',
    );
  }
  return value;
}

function normalizeScopes(
  value: unknown,
  conversationKind: FuryGatewayChannelConversationKind,
): readonly FuryGatewayScope[] {
  const values = dataArrayValues(value, 'channel binding scopes', 32);
  const allowed = conversationKind === 'direct' ? DIRECT_SCOPE_SET : SHARED_SCOPE_SET;
  const output: FuryGatewayScope[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== 'string' || !allowed.has(raw) || seen.has(raw)) {
      throw new FuryGatewayChannelPrincipalBindingError(
        'invalid-scope',
        conversationKind === 'direct'
          ? 'channel binding contains an unsupported or duplicate direct-message scope'
          : 'shared channel binding contains an unsupported or duplicate scope',
      );
    }
    seen.add(raw);
    output.push(raw as FuryGatewayScope);
  }
  return Object.freeze([...output].sort((a, b) => a.localeCompare(b)));
}

function nextBindingId(states: Map<string, BindingState>): string {
  let id: string;
  do {
    id = randomBytes(24).toString('base64url');
  } while (states.has(id));
  return id;
}

function cloneInspection(
  binding: FuryGatewayChannelPrincipalBinding,
  status: FuryGatewayChannelPrincipalBindingStatus,
): FuryGatewayChannelPrincipalBindingInspection {
  return Object.freeze({
    bindingId: binding.bindingId,
    principalId: binding.principalId,
    adapterId: binding.adapterId,
    channelKind: binding.channelKind,
    accountDigestSha256: binding.accountDigestSha256,
    senderDigestSha256: binding.senderDigestSha256,
    conversationDigestSha256: binding.conversationDigestSha256,
    conversationKind: binding.conversationKind,
    ...(binding.threadDigestSha256 === undefined ? {} : { threadDigestSha256: binding.threadDigestSha256 }),
    policyProfileId: binding.policyProfileId,
    scopes: Object.freeze([...binding.scopes]),
    boundAt: binding.boundAt,
    expiresAt: binding.expiresAt,
    status,
    executionAuthority: false as const,
  });
}

export function isGeneratedFuryGatewayChannelPrincipalBinding(
  value: unknown,
): value is FuryGatewayChannelPrincipalBinding {
  return typeof value === 'object'
    && value !== null
    && BINDING_EVIDENCE.has(value);
}

export function isGeneratedFuryGatewayChannelPrincipalBindingCoordinator(
  value: unknown,
): value is FuryGatewayChannelPrincipalBindingCoordinator {
  return typeof value === 'object'
    && value !== null
    && BINDING_COORDINATOR_EVIDENCE.has(value);
}

export function createFuryGatewayChannelPrincipalBindingCoordinator(
  options: FuryGatewayChannelPrincipalBindingCoordinatorOptions,
): FuryGatewayChannelPrincipalBindingCoordinator {
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || !options.principalRegistry
  ) {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-input',
      'channel binding coordinator requires a principal registry',
    );
  }

  const principalRegistry = options.principalRegistry;
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-input',
      'channel binding now must be a function',
    );
  }
  finiteNow(now);

  const defaultTtlMs = boundedInteger(
    options.defaultTtlMs,
    DEFAULT_TTL_MS,
    MIN_TTL_MS,
    HARD_MAX_TTL_MS,
    'defaultTtlMs',
  );
  const maxTtlMs = boundedInteger(
    options.maxTtlMs,
    HARD_MAX_TTL_MS,
    MIN_TTL_MS,
    HARD_MAX_TTL_MS,
    'maxTtlMs',
  );
  if (defaultTtlMs > maxTtlMs) {
    throw new FuryGatewayChannelPrincipalBindingError(
      'invalid-input',
      'defaultTtlMs must not exceed maxTtlMs',
    );
  }
  const terminalRetentionMs = boundedInteger(
    options.terminalRetentionMs,
    DEFAULT_TERMINAL_RETENTION_MS,
    MIN_TERMINAL_RETENTION_MS,
    HARD_MAX_TERMINAL_RETENTION_MS,
    'terminalRetentionMs',
  );
  const maxBindings = boundedInteger(
    options.maxBindings,
    DEFAULT_MAX_BINDINGS,
    1,
    HARD_MAX_BINDINGS,
    'maxBindings',
  );

  const states = new Map<string, BindingState>();

  const refresh = (
    state: BindingState,
    at: number,
  ): FuryGatewayChannelPrincipalBindingStatus => {
    if (state.status !== 'active') return state.status;
    if (state.binding.expiresAt < at) {
      state.status = 'expired';
      state.terminalAt = state.binding.expiresAt;
      return state.status;
    }
    if (!principalRegistry.isActiveGeneration(
      state.binding.principalId,
      state.binding.principalGeneration,
    )) {
      state.status = 'principal-revoked';
      state.terminalAt = at;
      return state.status;
    }
    return 'active';
  };

  const gc = (at: number): void => {
    for (const [bindingId, state] of states) {
      const status = refresh(state, at);
      if (
        status !== 'active'
        && state.terminalAt !== undefined
        && at - state.terminalAt > terminalRetentionMs
      ) {
        states.delete(bindingId);
      }
    }
  };

  const resolveState = (
    binding: FuryGatewayChannelPrincipalBinding,
  ): BindingState => {
    if (!isGeneratedFuryGatewayChannelPrincipalBinding(binding)) {
      throw new FuryGatewayChannelPrincipalBindingError(
        'invalid-binding',
        'channel principal binding must be process-local FuryPipe evidence',
      );
    }
    const state = states.get(binding.bindingId);
    if (!state || state.binding !== binding) {
      throw new FuryGatewayChannelPrincipalBindingError(
        'invalid-binding',
        'channel principal binding is not owned by this coordinator',
      );
    }
    return state;
  };

  const api: FuryGatewayChannelPrincipalBindingCoordinator = Object.freeze({
    recordAuthenticatedSenderBinding(
      input: FuryGatewayChannelPrincipalBindingInput,
    ): FuryGatewayChannelPrincipalBinding {
      const boundAt = finiteNow(now);
      gc(boundAt);
      const record = exactPlainRecord(
        input,
        ['principal', 'event', 'policyProfileId', 'scopes', 'expiresInMs'],
        ['principal', 'event', 'policyProfileId', 'scopes'],
        'channel principal binding input',
      );

      const principal = record.principal as FuryGatewayAuthenticatedPrincipal;
      if (
        !isGeneratedFuryGatewayAuthenticatedPrincipal(principal)
        || !principalRegistry.isCurrentEvidence(principal)
      ) {
        throw new FuryGatewayChannelPrincipalBindingError(
          'invalid-principal-evidence',
          'channel binding requires current process-local principal evidence',
        );
      }

      const event = record.event as FuryGatewayChannelInboundEvent;
      if (!isGeneratedFuryGatewayChannelInboundEvent(event)) {
        throw new FuryGatewayChannelPrincipalBindingError(
          'invalid-event-evidence',
          'channel binding requires process-local normalized channel event evidence',
        );
      }
      if (event.receivedAt > boundAt) {
        throw new FuryGatewayChannelPrincipalBindingError(
          'invalid-event-evidence',
          'channel event evidence cannot originate in the future',
        );
      }

      if (states.size >= maxBindings) {
        throw new FuryGatewayChannelPrincipalBindingError(
          'limit-exceeded',
          'channel principal binding registry is full',
        );
      }

      const scopes = normalizeScopes(record.scopes, event.conversationKind);
      const ttlMs = boundedInteger(
        record.expiresInMs as number | undefined,
        defaultTtlMs,
        MIN_TTL_MS,
        maxTtlMs,
        'expiresInMs',
      );
      const expiresAt = boundAt + ttlMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new FuryGatewayChannelPrincipalBindingError(
          'invalid-input',
          'channel binding expiry must be a safe integer',
        );
      }

      const binding = Object.freeze({
        format: FURY_GATEWAY_CHANNEL_PRINCIPAL_BINDING_FORMAT,
        bindingId: nextBindingId(states),
        principalId: principal.principalId,
        principalGeneration: principal.generation,
        principalAuthenticatedAt: principal.authenticatedAt,
        adapterId: event.adapterId,
        channelKind: event.channelKind,
        accountDigestSha256: event.accountDigestSha256,
        senderDigestSha256: event.senderDigestSha256,
        conversationDigestSha256: event.conversationDigestSha256,
        conversationKind: event.conversationKind,
        ...(event.threadDigestSha256 === undefined ? {} : { threadDigestSha256: event.threadDigestSha256 }),
        eventReplayKeySha256: event.replayKeySha256,
        policyProfileId: policyProfileId(record.policyProfileId),
        scopes,
        boundAt,
        expiresAt,
        transportAuthentication: 'host-verified' as const,
        authority: 'channel-principal-binding' as const,
        executionAuthority: false as const,
      });
      BINDING_EVIDENCE.add(binding);
      states.set(binding.bindingId, { binding, status: 'active' });
      return binding;
    },

    revokeBinding(bindingId: string): boolean {
      if (typeof bindingId !== 'string' || !BINDING_ID_RE.test(bindingId)) {
        throw new FuryGatewayChannelPrincipalBindingError(
          'invalid-binding',
          'channel principal binding ID is invalid',
        );
      }
      const at = finiteNow(now);
      gc(at);
      const state = states.get(bindingId);
      if (!state || refresh(state, at) !== 'active') return false;
      state.status = 'revoked';
      state.terminalAt = at;
      return true;
    },

    inspectBinding(
      binding: FuryGatewayChannelPrincipalBinding,
    ): FuryGatewayChannelPrincipalBindingInspection {
      const at = finiteNow(now);
      gc(at);
      const state = resolveState(binding);
      return cloneInspection(binding, refresh(state, at));
    },

    isCurrentBinding(binding: FuryGatewayChannelPrincipalBinding): boolean {
      const at = finiteNow(now);
      try {
        gc(at);
        const state = resolveState(binding);
        return refresh(state, at) === 'active';
      } catch {
        return false;
      }
    },

    activeCount(): number {
      const at = finiteNow(now);
      gc(at);
      let count = 0;
      for (const state of states.values()) {
        if (refresh(state, at) === 'active') count += 1;
      }
      return count;
    },
  });
  BINDING_COORDINATOR_EVIDENCE.add(api);
  return api;
}
