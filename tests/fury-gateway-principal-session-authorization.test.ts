import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_CONNECT_FORMAT,
  FURY_GATEWAY_PROTOCOL_VERSION,
  parseFuryGatewayConnectEnvelope,
} from '../src/gateway.js';
import {
  createFuryGatewayDeviceAuthCoordinator,
  createFuryGatewayDeviceProof,
} from '../src/gateway-auth-node.js';
import { createFuryGatewayPairingCoordinator } from '../src/gateway-pairing-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
  isGeneratedFuryGatewayAuthenticatedPrincipal,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  isGeneratedFuryGatewaySessionLease,
  type FuryGatewayScope,
} from '../src/gateway-session-node.js';
import {
  FURY_GATEWAY_COMMAND_FORMAT,
  createFuryGatewayCommandRegistry,
  evaluateFuryGatewayCommandAdmission,
  validateFuryGatewayCommandDefinition,
} from '../src/gateway-command-authorization-node.js';

function principalAssertion(overrides: Record<string, unknown> = {}) {
  return {
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:user-1',
    kind: 'human',
    issuer: 'local',
    subject: 'user-1-local-account',
    authenticationMethod: 'local-owner',
    ...overrides,
  } as const;
}

function nodeEnvelope(instanceId = 'node-instance-1') {
  return parseFuryGatewayConnectEnvelope({
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role: 'node',
    client: {
      clientId: 'fury-node',
      instanceId,
      platform: 'linux',
      deviceFamily: 'server',
    },
    capabilities: ['filesystem.read'],
    commands: ['shell.run'],
  });
}

function authenticatedNode(
  now: () => number,
  privateKey = generateKeyPairSync('ed25519').privateKey,
  instanceId = 'node-instance-1',
) {
  const auth = createFuryGatewayDeviceAuthCoordinator({ now });
  const envelope = nodeEnvelope(instanceId);
  const challenge = auth.issueChallenge();
  const device = auth.verifyProof(
    envelope,
    createFuryGatewayDeviceProof(envelope, challenge, privateKey),
  );
  return { auth, device, privateKey, envelope };
}

describe('Fury Gateway principal evidence', () => {
  it('creates process-local principal evidence without retaining the raw subject', () => {
    const registry = createFuryGatewayPrincipalRegistry({ now: () => 1_000 });
    const principal = registry.recordAuthenticatedPrincipal(principalAssertion());

    expect(principal.authority).toBe('authenticated-principal');
    expect(principal.principalId).toBe('principal:user-1');
    expect(principal.subjectSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect('subject' in principal).toBe(false);
    expect(isGeneratedFuryGatewayAuthenticatedPrincipal(principal)).toBe(true);
    expect(isGeneratedFuryGatewayAuthenticatedPrincipal({ ...principal })).toBe(false);
    expect(registry.isCurrentEvidence(principal)).toBe(true);
  });

  it('pins the external subject digest to an existing principal ID', () => {
    const registry = createFuryGatewayPrincipalRegistry({ now: () => 2_000 });
    registry.recordAuthenticatedPrincipal(principalAssertion());

    expect(() => registry.recordAuthenticatedPrincipal(principalAssertion({
      subject: 'different-external-subject',
    }))).toThrowError(/identity metadata changed/u);
  });

  it('rejects assertion schema drift and accessors', () => {
    const registry = createFuryGatewayPrincipalRegistry({ now: () => 3_000 });
    expect(() => registry.recordAuthenticatedPrincipal({
      ...principalAssertion(),
      password: 'must-not-enter-principal-evidence',
    } as ReturnType<typeof principalAssertion>)).toThrowError(/unsupported field/u);

    const accessor = { ...principalAssertion() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'subject', {
      enumerable: true,
      get: () => 'user-1-local-account',
    });
    expect(() => registry.recordAuthenticatedPrincipal(
      accessor as unknown as ReturnType<typeof principalAssertion>,
    )).toThrowError(/data properties only/u);
  });

  it('expires evidence without silently revoking the principal identity', () => {
    let now = 10_000;
    const registry = createFuryGatewayPrincipalRegistry({
      now: () => now,
      evidenceTtlMs: 30_000,
    });
    const principal = registry.recordAuthenticatedPrincipal(principalAssertion());
    now = 40_001;

    expect(registry.isCurrentEvidence(principal)).toBe(false);
    expect(registry.inspect(principal.principalId)?.status).toBe('active');
  });

  it('revocation invalidates the current generation and blocks silent reactivation', () => {
    const registry = createFuryGatewayPrincipalRegistry({ now: () => 50_000 });
    const principal = registry.recordAuthenticatedPrincipal(principalAssertion());

    expect(registry.revokePrincipal(principal.principalId)).toBe(true);
    expect(registry.isCurrentEvidence(principal)).toBe(false);
    expect(registry.isActiveGeneration(principal.principalId, principal.generation)).toBe(false);
    expect(registry.inspect(principal.principalId)?.status).toBe('revoked');
    expect(() => registry.recordAuthenticatedPrincipal(principalAssertion())).toThrowError(
      /cannot be silently reactivated/u,
    );
  });

  it('enforces the principal registry quota', () => {
    const registry = createFuryGatewayPrincipalRegistry({
      now: () => 60_000,
      maxPrincipals: 1,
    });
    registry.recordAuthenticatedPrincipal(principalAssertion());
    expect(() => registry.recordAuthenticatedPrincipal(principalAssertion({
      principalId: 'principal:user-2',
      subject: 'user-2-local-account',
    }))).toThrowError(/registry is full/u);
  });
});

describe('Fury Gateway sessions', () => {
  function localSessionHarness() {
    let now = 100_000;
    const principalRegistry = createFuryGatewayPrincipalRegistry({
      now: () => now,
      evidenceTtlMs: 5 * 60_000,
    });
    const principal = principalRegistry.recordAuthenticatedPrincipal(principalAssertion());
    const sessionCoordinator = createFuryGatewaySessionCoordinator({
      principalRegistry,
      gatewayInstanceId: 'gateway-test',
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
      sessionCoordinator,
    };
  }

  it('issues a sorted, process-local, short-lived local operator session', () => {
    const harness = localSessionHarness();
    const session = harness.sessionCoordinator.issueSession({
      principal: harness.principal,
      role: 'operator',
      scopes: ['settings.inspect', 'gateway.inspect'],
      binding: { kind: 'local-operator' },
    });

    expect(session.authority).toBe('session-lease');
    expect(session.audience).toBe('gateway-test');
    expect(session.scopes).toEqual(['gateway.inspect', 'settings.inspect']);
    expect(session.binding).toEqual({ kind: 'local-operator' });
    expect(isGeneratedFuryGatewaySessionLease(session)).toBe(true);
    expect(isGeneratedFuryGatewaySessionLease({ ...session })).toBe(false);
    expect(harness.sessionCoordinator.isActiveSession(session)).toBe(true);
  });

  it('rejects copied principal evidence, invalid roles, duplicate scopes and wildcard scopes', () => {
    const harness = localSessionHarness();

    expect(() => harness.sessionCoordinator.issueSession({
      principal: { ...harness.principal },
      role: 'operator',
      scopes: ['gateway.inspect'],
      binding: { kind: 'local-operator' },
    })).toThrowError(/process-local principal evidence/u);

    expect(() => harness.sessionCoordinator.issueSession({
      principal: harness.principal,
      role: 'invalid-role' as 'operator',
      scopes: ['gateway.inspect'],
      binding: { kind: 'local-operator' },
    })).toThrowError(/role is unsupported/u);

    expect(() => harness.sessionCoordinator.issueSession({
      principal: harness.principal,
      role: 'operator',
      scopes: ['gateway.inspect', 'gateway.inspect'],
      binding: { kind: 'local-operator' },
    })).toThrowError(/duplicate scopes/u);

    expect(() => harness.sessionCoordinator.issueSession({
      principal: harness.principal,
      role: 'operator',
      scopes: ['capability.*' as FuryGatewayScope],
      binding: { kind: 'local-operator' },
    })).toThrowError(/unknown scope|wildcard/u);
  });

  it('retains explicit expired/revoked status for a bounded terminal window', () => {
    const harness = localSessionHarness();
    const expired = harness.sessionCoordinator.issueSession({
      principal: harness.principal,
      role: 'operator',
      scopes: ['gateway.inspect'],
      binding: { kind: 'local-operator' },
      expiresInMs: 30_000,
    });

    harness.now = expired.expiresAt + 1;
    expect(harness.sessionCoordinator.inspectSession(expired).status).toBe('expired');
    expect(harness.sessionCoordinator.isActiveSession(expired)).toBe(false);

    harness.now = expired.expiresAt + 29_999;
    expect(harness.sessionCoordinator.inspectSession(expired).status).toBe('expired');

    harness.now = expired.expiresAt + 30_001;
    expect(harness.sessionCoordinator.activeCount()).toBe(0);
    expect(() => harness.sessionCoordinator.inspectSession(expired)).toThrowError(
      /not owned by this coordinator/u,
    );

    const fresh = harness.principalRegistry.recordAuthenticatedPrincipal(principalAssertion());
    const revoked = harness.sessionCoordinator.issueSession({
      principal: fresh,
      role: 'operator',
      scopes: ['gateway.inspect'],
      binding: { kind: 'local-operator' },
    });
    expect(harness.sessionCoordinator.revokeSession(revoked.sessionId)).toBe(true);
    expect(harness.sessionCoordinator.inspectSession(revoked).status).toBe('revoked');
  });

  it('principal revocation invalidates existing sessions', () => {
    const harness = localSessionHarness();
    const session = harness.sessionCoordinator.issueSession({
      principal: harness.principal,
      role: 'operator',
      scopes: ['gateway.inspect'],
      binding: { kind: 'local-operator' },
    });

    harness.principalRegistry.revokePrincipal(harness.principal.principalId);
    expect(harness.sessionCoordinator.inspectSession(session).status).toBe('principal-revoked');
    expect(harness.sessionCoordinator.isActiveSession(session)).toBe(false);
  });

  it('binds a paired-device session to the exact authenticated connection evidence', () => {
    let now = 200_000;
    const clock = () => now;
    const keys = generateKeyPairSync('ed25519');
    const first = authenticatedNode(clock, keys.privateKey);

    const pairing = createFuryGatewayPairingCoordinator({ now: clock });
    const request = pairing.requestPairing(first.device);
    pairing.approvePairing(request.requestId, 'principal:owner');

    const principalRegistry = createFuryGatewayPrincipalRegistry({ now: clock });
    const principal = principalRegistry.recordAuthenticatedPrincipal(principalAssertion({
      principalId: 'principal:node-service',
      kind: 'service',
      issuer: 'gateway-service-auth',
      subject: 'node-service',
      authenticationMethod: 'service-credential',
    }));
    const sessions = createFuryGatewaySessionCoordinator({
      principalRegistry,
      gatewayInstanceId: 'gateway-test',
      now: clock,
      defaultTtlMs: 30_000,
      maxTtlMs: 60_000,
    });

    const session = sessions.issueSession({
      principal,
      role: 'node',
      scopes: ['capability.process'],
      binding: { kind: 'paired-device', device: first.device, pairing },
    });

    expect(session.binding.kind).toBe('paired-device');
    expect(session.binding.deviceId).toBe(first.device.deviceId);
    expect(session.binding.connectFingerprint).toBe(first.device.connectFingerprint);
    expect(session.binding.deviceAuthenticatedAt).toBe(first.device.authenticatedAt);
  });
});

describe('Fury Gateway command admission', () => {
  function operatorHarness(scopes: readonly FuryGatewayScope[]) {
    let now = 300_000;
    const principalRegistry = createFuryGatewayPrincipalRegistry({ now: () => now });
    const principal = principalRegistry.recordAuthenticatedPrincipal(principalAssertion());
    const sessions = createFuryGatewaySessionCoordinator({
      principalRegistry,
      gatewayInstanceId: 'gateway-test',
      now: () => now,
      defaultTtlMs: 30_000,
      maxTtlMs: 60_000,
    });
    const session = sessions.issueSession({
      principal,
      role: 'operator',
      scopes,
      binding: { kind: 'local-operator' },
    });
    return {
      get now() { return now; },
      set now(value: number) { now = value; },
      principalRegistry,
      sessions,
      session,
    };
  }

  it('requires plugin permissions to have matching capability scopes at registration', () => {
    expect(() => validateFuryGatewayCommandDefinition({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'repository.read',
      allowedRoles: ['operator'],
      requiredScopes: [],
      requiredPluginPermissions: ['repository-read'],
      riskClass: 'read',
      requiresFreshApproval: false,
    })).toThrowError(/requires session scope capability.repository-read/u);
  });

  it('rejects command-definition schema drift', () => {
    expect(() => validateFuryGatewayCommandDefinition({
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'gateway.inspect',
      allowedRoles: ['operator'],
      requiredScopes: ['gateway.inspect'],
      requiredPluginPermissions: [],
      riskClass: 'inspect',
      requiresFreshApproval: false,
      hiddenAuthority: true,
    } as never)).toThrowError(/unsupported fields/u);
  });

  it('marks an exact read action eligible without turning the decision into execution authority', () => {
    const harness = operatorHarness(['capability.repository-read']);
    const registry = createFuryGatewayCommandRegistry([{
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'repository.read',
      allowedRoles: ['operator'],
      requiredScopes: ['capability.repository-read'],
      requiredPluginPermissions: ['repository-read'],
      riskClass: 'read',
      requiresFreshApproval: false,
    }]);

    const result = evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: harness.sessions,
      session: harness.session,
      commandRegistry: registry,
      commandName: 'repository.read',
      declaredPluginPermissions: ['repository-read'],
    });

    expect(result.outcome).toBe('eligible');
    expect(result.reason).toBe('eligible');
    expect(result.executionAuthority).toBe(false);
    expect(result.requiredPluginPermissions).toEqual(['repository-read']);
  });

  it('denies missing scopes and plugin permission mismatches independently', () => {
    const missingScopeHarness = operatorHarness(['gateway.inspect']);
    const registry = createFuryGatewayCommandRegistry([{
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'repository.read',
      allowedRoles: ['operator'],
      requiredScopes: ['capability.repository-read'],
      requiredPluginPermissions: ['repository-read'],
      riskClass: 'read',
      requiresFreshApproval: false,
    }]);

    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: missingScopeHarness.sessions,
      session: missingScopeHarness.session,
      commandRegistry: registry,
      commandName: 'repository.read',
      declaredPluginPermissions: ['repository-read'],
    }).reason).toBe('missing-scope');

    const permissionHarness = operatorHarness(['capability.repository-read']);
    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: permissionHarness.sessions,
      session: permissionHarness.session,
      commandRegistry: registry,
      commandName: 'repository.read',
      declaredPluginPermissions: [],
    }).reason).toBe('plugin-permission-mismatch');
  });

  it('denies forged sessions, role mismatch, unknown commands and approval-gated commands', () => {
    const harness = operatorHarness(['gateway.inspect']);
    const registry = createFuryGatewayCommandRegistry([
      {
        format: FURY_GATEWAY_COMMAND_FORMAT,
        name: 'gateway.inspect',
        allowedRoles: ['operator'],
        requiredScopes: ['gateway.inspect'],
        requiredPluginPermissions: [],
        riskClass: 'inspect',
        requiresFreshApproval: false,
      },
      {
        format: FURY_GATEWAY_COMMAND_FORMAT,
        name: 'node.inspect',
        allowedRoles: ['node'],
        requiredScopes: ['gateway.inspect'],
        requiredPluginPermissions: [],
        riskClass: 'inspect',
        requiresFreshApproval: false,
      },
      {
        format: FURY_GATEWAY_COMMAND_FORMAT,
        name: 'settings.change',
        allowedRoles: ['operator'],
        requiredScopes: ['gateway.inspect'],
        requiredPluginPermissions: [],
        riskClass: 'admin',
        requiresFreshApproval: true,
      },
    ]);

    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: harness.sessions,
      session: { ...harness.session },
      commandRegistry: registry,
      commandName: 'gateway.inspect',
    }).reason).toBe('invalid-session');

    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: harness.sessions,
      session: harness.session,
      commandRegistry: registry,
      commandName: 'node.inspect',
    }).reason).toBe('role-not-allowed');

    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: harness.sessions,
      session: harness.session,
      commandRegistry: registry,
      commandName: 'does.not.exist',
    }).reason).toBe('command-not-registered');

    const approval = evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: harness.sessions,
      session: harness.session,
      commandRegistry: registry,
      commandName: 'settings.change',
    });
    expect(approval.reason).toBe('fresh-approval-required');
    expect(approval.executionAuthority).toBe(false);
  });

  it('denies revoked or expired sessions at the action boundary', () => {
    const harness = operatorHarness(['gateway.inspect']);
    const registry = createFuryGatewayCommandRegistry([{
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'gateway.inspect',
      allowedRoles: ['operator'],
      requiredScopes: ['gateway.inspect'],
      requiredPluginPermissions: [],
      riskClass: 'inspect',
      requiresFreshApproval: false,
    }]);

    harness.sessions.revokeSession(harness.session.sessionId);
    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: harness.sessions,
      session: harness.session,
      commandRegistry: registry,
      commandName: 'gateway.inspect',
    }).reason).toBe('session-not-active');

    const second = operatorHarness(['gateway.inspect']);
    second.now = second.session.expiresAt + 1;
    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: second.sessions,
      session: second.session,
      commandRegistry: registry,
      commandName: 'gateway.inspect',
    }).reason).toBe('session-not-active');
  });

  it('requires the exact paired-device auth evidence and a still-active pairing', () => {
    let now = 400_000;
    const clock = () => now;
    const keys = generateKeyPairSync('ed25519');
    const first = authenticatedNode(clock, keys.privateKey);

    const pairing = createFuryGatewayPairingCoordinator({ now: clock });
    const request = pairing.requestPairing(first.device);
    pairing.approvePairing(request.requestId, 'principal:owner');

    const principalRegistry = createFuryGatewayPrincipalRegistry({ now: clock });
    const principal = principalRegistry.recordAuthenticatedPrincipal(principalAssertion({
      principalId: 'principal:node-service',
      kind: 'service',
      issuer: 'gateway-service-auth',
      subject: 'node-service',
      authenticationMethod: 'service-credential',
    }));
    const sessions = createFuryGatewaySessionCoordinator({
      principalRegistry,
      gatewayInstanceId: 'gateway-test',
      now: clock,
      defaultTtlMs: 30_000,
      maxTtlMs: 60_000,
    });
    const session = sessions.issueSession({
      principal,
      role: 'node',
      scopes: ['capability.process'],
      binding: { kind: 'paired-device', device: first.device, pairing },
    });
    const registry = createFuryGatewayCommandRegistry([{
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'shell.run',
      allowedRoles: ['node'],
      requiredScopes: ['capability.process'],
      requiredPluginPermissions: ['process'],
      riskClass: 'process',
      requiresFreshApproval: false,
    }]);

    const eligible = evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: sessions,
      session,
      commandRegistry: registry,
      commandName: 'shell.run',
      declaredPluginPermissions: ['process'],
      currentDevice: first.device,
      pairing,
    });
    expect(eligible.outcome).toBe('eligible');
    expect(eligible.executionAuthority).toBe(false);

    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: sessions,
      session,
      commandRegistry: registry,
      commandName: 'shell.run',
      declaredPluginPermissions: ['process'],
      currentDevice: { ...first.device },
      pairing,
    }).reason).toBe('device-proof-required');

    now += 1_000;
    const second = authenticatedNode(clock, keys.privateKey, 'node-instance-2');
    expect(second.device.deviceId).toBe(first.device.deviceId);
    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: sessions,
      session,
      commandRegistry: registry,
      commandName: 'shell.run',
      declaredPluginPermissions: ['process'],
      currentDevice: second.device,
      pairing,
    }).reason).toBe('device-binding-mismatch');

    pairing.revokePairing(first.device.deviceId, first.device.role);
    expect(evaluateFuryGatewayCommandAdmission({
      sessionCoordinator: sessions,
      session,
      commandRegistry: registry,
      commandName: 'shell.run',
      declaredPluginPermissions: ['process'],
      currentDevice: first.device,
      pairing,
    }).reason).toBe('pairing-not-active');
  });
});
