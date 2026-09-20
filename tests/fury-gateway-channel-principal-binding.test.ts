import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
  createFuryGatewayChannelAdapterRegistry,
} from '../src/gateway-channel-adapter-node.js';
import {
  FURY_GATEWAY_CHANNEL_PRINCIPAL_BINDING_FORMAT,
  createFuryGatewayChannelPrincipalBindingCoordinator,
  isGeneratedFuryGatewayChannelPrincipalBinding,
  isGeneratedFuryGatewayChannelPrincipalBindingCoordinator,
} from '../src/gateway-channel-principal-binding-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewayScope,
} from '../src/gateway-session-node.js';

function principalAssertion() {
  return {
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:channel-user-1',
    kind: 'human',
    issuer: 'channel-mapping-host',
    subject: 'mapped-user-1',
    authenticationMethod: 'oidc',
  } as const;
}

function harness(conversationKind: 'direct' | 'group' | 'channel' = 'direct') {
  let now = 100_000;
  const principalRegistry = createFuryGatewayPrincipalRegistry({
    now: () => now,
    evidenceTtlMs: 5 * 60_000,
  });
  const principal = principalRegistry.recordAuthenticatedPrincipal(principalAssertion());

  const adapters = createFuryGatewayChannelAdapterRegistry({
    now: () => now,
    replayWindowMs: 60_000,
  });
  adapters.register({
    format: FURY_GATEWAY_CHANNEL_ADAPTER_FORMAT,
    adapterId: 'discord-main',
    channelKind: 'discord',
    accountId: 'discord-app-account-1',
    policyProfileId: 'discord-default',
    capabilities: ['inbound-message', 'outbound-message'],
  });
  const event = adapters.normalizeInbound('discord-main', {
    accountId: 'discord-app-account-1',
    eventId: 'evt-1',
    senderId: 'external-user-42',
    conversationId: conversationKind === 'direct' ? 'dm-42' : 'guild-channel-7',
    conversationKind,
    ...(conversationKind === 'direct' ? {} : { threadId: 'thread-1' }),
    type: 'message',
    text: 'hello FuryPipe',
    observedAt: now,
  });

  const bindingCoordinator = createFuryGatewayChannelPrincipalBindingCoordinator({
    principalRegistry,
    now: () => now,
    defaultTtlMs: 30_000,
    maxTtlMs: 60_000,
    terminalRetentionMs: 30_000,
  });

  const sessionCoordinator = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-channel-test',
    now: () => now,
    defaultTtlMs: 30_000,
    maxTtlMs: 60_000,
    terminalRetentionMs: 30_000,
  });

  return {
    get now() { return now; },
    set now(value: number) { now = value; },
    principalRegistry,
    principal,
    adapters,
    event,
    bindingCoordinator,
    sessionCoordinator,
  };
}

describe('Fury Gateway channel principal binding', () => {
  it('creates process-local bounded binding evidence without retaining raw external IDs', () => {
    const h = harness();
    const binding = h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-owner-dm',
      scopes: [
        'capability.provider-inference',
        'conversations.write',
        'channels.inspect',
      ],
    });

    expect(binding.format).toBe(FURY_GATEWAY_CHANNEL_PRINCIPAL_BINDING_FORMAT);
    expect(binding.authority).toBe('channel-principal-binding');
    expect(binding.executionAuthority).toBe(false);
    expect(binding.transportAuthentication).toBe('host-verified');
    expect(binding.scopes).toEqual([
      'capability.provider-inference',
      'channels.inspect',
      'conversations.write',
    ]);
    expect(binding.senderDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(binding.conversationDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect('senderId' in binding).toBe(false);
    expect('conversationId' in binding).toBe(false);
    expect('text' in binding).toBe(false);
    expect(isGeneratedFuryGatewayChannelPrincipalBinding(binding)).toBe(true);
    expect(isGeneratedFuryGatewayChannelPrincipalBinding({ ...binding })).toBe(false);
    expect(isGeneratedFuryGatewayChannelPrincipalBindingCoordinator(h.bindingCoordinator)).toBe(true);
    expect(isGeneratedFuryGatewayChannelPrincipalBindingCoordinator({
      ...h.bindingCoordinator,
    })).toBe(false);
    expect(h.bindingCoordinator.isCurrentBinding(binding)).toBe(true);
  });

  it('requires process-local principal and normalized event evidence', () => {
    const h = harness();

    expect(() => h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: { ...h.principal },
      event: h.event,
      policyProfileId: 'discord-owner-dm',
      scopes: ['conversations.write'],
    })).toThrowError(/process-local principal evidence/u);

    expect(() => h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: { ...h.event },
      policyProfileId: 'discord-owner-dm',
      scopes: ['conversations.write'],
    })).toThrowError(/process-local normalized channel event evidence/u);
  });

  it('fails closed on shared/group scopes that exceed the shared policy envelope', () => {
    const h = harness('group');

    expect(() => h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-guild-read-chat',
      scopes: ['conversations.write', 'memory.read'],
    })).toThrowError(/shared channel binding contains an unsupported/u);

    const binding = h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-guild-read-chat',
      scopes: ['conversations.write', 'capability.provider-inference'],
    });
    expect(binding.conversationKind).toBe('group');
    expect(binding.scopes).toEqual([
      'capability.provider-inference',
      'conversations.write',
    ]);
  });

  it('rejects unknown fields, accessors and duplicate scopes', () => {
    const h = harness();

    expect(() => h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-owner-dm',
      scopes: ['conversations.write'],
      secret: 'must-not-enter-binding',
    } as never)).toThrowError(/unsupported or unsafe fields/u);

    const accessor = {
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-owner-dm',
      scopes: ['conversations.write'],
    } as Record<string, unknown>;
    Object.defineProperty(accessor, 'policyProfileId', {
      enumerable: true,
      get: () => 'discord-owner-dm',
    });
    expect(() => h.bindingCoordinator.recordAuthenticatedSenderBinding(accessor as never))
      .toThrowError(/unsupported or unsafe fields/u);

    expect(() => h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-owner-dm',
      scopes: ['conversations.write', 'conversations.write'],
    })).toThrowError(/unsupported or duplicate/u);
  });

  it('expires and revokes bindings independently from the principal identity', () => {
    const h = harness();
    const binding = h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-owner-dm',
      scopes: ['conversations.write'],
      expiresInMs: 30_000,
    });

    h.now = binding.expiresAt + 1;
    expect(h.bindingCoordinator.isCurrentBinding(binding)).toBe(false);
    expect(h.bindingCoordinator.inspectBinding(binding).status).toBe('expired');

    const h2 = harness();
    const revoked = h2.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h2.principal,
      event: h2.event,
      policyProfileId: 'discord-owner-dm',
      scopes: ['conversations.write'],
    });
    expect(h2.bindingCoordinator.revokeBinding(revoked.bindingId)).toBe(true);
    expect(h2.bindingCoordinator.isCurrentBinding(revoked)).toBe(false);
    expect(h2.bindingCoordinator.inspectBinding(revoked).status).toBe('revoked');
    expect(h2.principalRegistry.inspect(h2.principal.principalId)?.status).toBe('active');
  });
});

describe('Fury Gateway channel sessions', () => {
  function issue(
    h: ReturnType<typeof harness>,
    scopes: readonly FuryGatewayScope[] = [
      'conversations.write',
      'capability.provider-inference',
    ],
  ) {
    const binding = h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-owner-dm',
      scopes,
    });
    const session = h.sessionCoordinator.issueSession({
      principal: h.principal,
      role: 'channel',
      scopes,
      binding: {
        kind: 'channel',
        binding,
        coordinator: h.bindingCoordinator,
      },
      // Keep the session alive longer than the binding so binding expiry can
      // be proven independently from ordinary session expiry.
      expiresInMs: 60_000,
    });
    return { binding, session };
  }

  it('issues a channel session pinned to exact process-local binding evidence', () => {
    const h = harness();
    const { binding, session } = issue(h);

    expect(session.role).toBe('channel');
    expect(session.binding.kind).toBe('channel');
    expect(session.binding.channelBindingId).toBe(binding.bindingId);
    expect(session.binding.channelAdapterId).toBe('discord-main');
    expect(session.binding.channelKind).toBe('discord');
    expect(session.binding.channelSenderDigestSha256).toBe(binding.senderDigestSha256);
    expect(session.binding.channelPolicyProfileId).toBe('discord-owner-dm');
    expect(h.sessionCoordinator.isActiveSession(session)).toBe(true);
  });

  it('rejects a copied binding and scopes outside the binding policy', () => {
    const h = harness();
    const binding = h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-owner-dm',
      scopes: ['conversations.write'],
    });

    expect(() => h.sessionCoordinator.issueSession({
      principal: h.principal,
      role: 'channel',
      scopes: ['conversations.write'],
      binding: {
        kind: 'channel',
        binding: { ...binding },
        coordinator: h.bindingCoordinator,
      },
    })).toThrowError(/process-local channel principal binding evidence/u);

    expect(() => h.sessionCoordinator.issueSession({
      principal: h.principal,
      role: 'channel',
      scopes: ['conversations.write', 'capability.provider-inference'],
      binding: {
        kind: 'channel',
        binding,
        coordinator: h.bindingCoordinator,
      },
    })).toThrowError(/scope exceeds/u);

    expect(() => h.sessionCoordinator.issueSession({
      principal: h.principal,
      role: 'channel',
      scopes: ['conversations.write'],
      binding: {
        kind: 'channel',
        binding,
        coordinator: {
          ...h.bindingCoordinator,
          isCurrentBinding: () => true,
        },
      } as never,
    })).toThrowError(/process-local channel principal binding evidence/u);
  });

  it('does not allow a channel binding to mint an operator session', () => {
    const h = harness();
    const binding = h.bindingCoordinator.recordAuthenticatedSenderBinding({
      principal: h.principal,
      event: h.event,
      policyProfileId: 'discord-owner-dm',
      scopes: ['conversations.write'],
    });

    expect(() => h.sessionCoordinator.issueSession({
      principal: h.principal,
      role: 'operator',
      scopes: ['conversations.write'],
      binding: {
        kind: 'channel',
        binding,
        coordinator: h.bindingCoordinator,
      },
    })).toThrowError(/channel sessions require current matching/u);
  });

  it('invalidates an active session when its channel binding is revoked', () => {
    const h = harness();
    const { binding, session } = issue(h);

    expect(h.bindingCoordinator.revokeBinding(binding.bindingId)).toBe(true);
    expect(h.sessionCoordinator.isActiveSession(session)).toBe(false);
    expect(h.sessionCoordinator.inspectSession(session).status).toBe('binding-stale');
  });

  it('invalidates an active session when its channel binding expires', () => {
    const h = harness();
    const { binding, session } = issue(h, ['conversations.write']);

    h.now = binding.expiresAt + 1;
    expect(h.sessionCoordinator.isActiveSession(session)).toBe(false);
    expect(h.sessionCoordinator.inspectSession(session).status).toBe('binding-stale');
  });

  it('principal revocation remains stronger than channel binding status', () => {
    const h = harness();
    const { binding, session } = issue(h);

    expect(h.principalRegistry.revokePrincipal(h.principal.principalId)).toBe(true);
    expect(h.bindingCoordinator.isCurrentBinding(binding)).toBe(false);
    expect(h.bindingCoordinator.inspectBinding(binding).status).toBe('principal-revoked');
    expect(h.sessionCoordinator.inspectSession(session).status).toBe('principal-revoked');
  });
});
