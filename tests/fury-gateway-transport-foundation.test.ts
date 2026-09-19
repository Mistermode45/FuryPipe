import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_COMMAND_FORMAT,
  createFuryGatewayCommandRegistry,
} from '../src/gateway-command-authorization-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewayScope,
} from '../src/gateway-session-node.js';
import {
  FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
  FuryGatewayTransportError,
  createFuryGatewayTransportCoordinator,
} from '../src/gateway-transport-node.js';

function createOperatorHarness(
  scopes: readonly FuryGatewayScope[] = ['gateway.inspect'],
) {
  let now = 1_000;
  const principalRegistry = createFuryGatewayPrincipalRegistry({
    now: () => now,
  });
  const principal = principalRegistry.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:user-1',
    kind: 'human',
    issuer: 'local',
    subject: 'local-user-1',
    authenticationMethod: 'local-owner',
  });
  const sessionCoordinator = createFuryGatewaySessionCoordinator({
    principalRegistry,
    gatewayInstanceId: 'gateway-test',
    now: () => now,
    defaultTtlMs: 60_000,
    maxTtlMs: 60_000,
  });
  const session = sessionCoordinator.issueSession({
    principal,
    role: 'operator',
    scopes,
    binding: { kind: 'local-operator' },
  });
  return {
    get now() {
      return now;
    },
    set now(value: number) {
      now = value;
    },
    principalRegistry,
    principal,
    sessionCoordinator,
    session,
  };
}

function message(
  connectionId: string,
  sequence: number,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
    messageId: `msg-${sequence}`,
    connectionId,
    sequence,
    type: 'ping',
    sentAt: 1_000,
    payload: { nonce: `nonce-${sequence}` },
    ...overrides,
  });
}

describe('Fury Gateway transport connection policy', () => {
  it('generates parser-safe connection IDs', () => {
    const harness = createOperatorHarness();
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://127.0.0.1:3000'],
    });

    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://127.0.0.1:3000',
    });

    expect(connection.connectionId).toMatch(/^gwc_[A-Za-z0-9_-]+$/u);

    const accepted = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    );
    expect(accepted.message.connectionId).toBe(connection.connectionId);
    accepted.release();
  });

  it('defaults to loopback-only and process-local session evidence', () => {
    const harness = createOperatorHarness();
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://127.0.0.1:3000'],
    });

    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://127.0.0.1:3000',
    });

    expect(connection.authority).toBe('transport-connection');
    expect(connection.executionAuthority).toBe(false);
    expect(connection.role).toBe('operator');
    expect(transport.isOpen(connection)).toBe(true);
    expect(transport.connectionCount()).toBe(1);

    expect(() => transport.openConnection({
      session: { ...harness.session },
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://127.0.0.1:3000',
    })).toThrowError(expect.objectContaining({ code: 'invalid-session' }));
  });

  it('rejects remote connections by default', () => {
    const harness = createOperatorHarness();
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['https://app.example.test'],
    });

    expect(() => transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '203.0.113.10',
      origin: 'https://app.example.test',
    })).toThrowError(expect.objectContaining({ code: 'remote-disabled' }));
  });

  it('requires an exact wildcard-free browser Origin', () => {
    const harness = createOperatorHarness();

    expect(() => createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      allowedOrigins: ['https://*.example.test'],
    })).toThrowError(expect.objectContaining({ code: 'invalid-config' }));

    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['https://app.example.test'],
    });

    expect(() => transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
    })).toThrowError(expect.objectContaining({ code: 'origin-required' }));

    expect(() => transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'https://evil.example.test',
    })).toThrowError(expect.objectContaining({ code: 'origin-denied' }));

    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'https://app.example.test',
    });
    expect(connection.origin).toBe('https://app.example.test');
  });

  it('enforces global and per-principal connection quotas', () => {
    const harness = createOperatorHarness();
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://localhost:3000'],
      maxConnections: 2,
      maxConnectionsPerPrincipal: 1,
    });

    transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '::1',
      origin: 'http://localhost:3000',
    });

    expect(() => transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '::1',
      origin: 'http://localhost:3000',
    })).toThrowError(expect.objectContaining({ code: 'principal-connection-limit' }));
  });

  it('stops accepting work after the session is revoked', () => {
    const harness = createOperatorHarness();
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://localhost:3000'],
    });
    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://localhost:3000',
    });

    harness.sessionCoordinator.revokeSession(harness.session.sessionId);

    expect(() => transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    )).toThrowError(expect.objectContaining({ code: 'invalid-session' }));
  });
});

describe('Fury Gateway transport message framing', () => {
  function createTransportHarness(
    overrides: Record<string, unknown> = {},
  ) {
    const harness = createOperatorHarness([
      'gateway.inspect',
      'capability.repository-read',
    ]);
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://localhost:3000'],
      ...overrides,
    });
    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://localhost:3000',
    });
    return { harness, transport, connection };
  }

  it('accepts bounded text JSON and returns receipt-only evidence', () => {
    const { transport, connection } = createTransportHarness();
    const accepted = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    );

    expect(accepted.message.sequence).toBe(1);
    expect(accepted.message.type).toBe('ping');
    expect(accepted.receipt.status).toBe('transport-received');
    expect(accepted.receipt.executionAuthority).toBe(false);
    accepted.release();
    accepted.release();
  });

  it('rejects non-text input before parsing', () => {
    const { transport, connection } = createTransportHarness();

    expect(() => transport.acceptTextMessage(
      connection,
      Buffer.from('abc') as unknown as string,
    )).toThrowError(expect.objectContaining({ code: 'invalid-message' }));
  });

  it('rejects oversized frames before JSON parsing', () => {
    const { transport, connection } = createTransportHarness({
      maxPayloadBytes: 1024,
    });

    expect(() => transport.acceptTextMessage(
      connection,
      'x'.repeat(1025),
    )).toThrowError(expect.objectContaining({ code: 'payload-too-large' }));
  });

  it('rejects schema drift and unsafe object keys', () => {
    const { transport, connection } = createTransportHarness();

    expect(() => transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1, { token: 'secret' }),
    )).toThrowError(expect.objectContaining({ code: 'invalid-message' }));

    const unsafe = `{"format":"${FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT}","messageId":"m1","connectionId":"${connection.connectionId}","sequence":1,"type":"command","sentAt":1000,"payload":{"commandName":"repository.read","declaredPluginPermissions":["repository-read"],"input":{"__proto__":{"polluted":true}}}}`;
    expect(() => transport.acceptTextMessage(
      connection,
      unsafe,
    )).toThrowError(expect.objectContaining({ code: 'invalid-message' }));
  });

  it('deep-freezes accepted command input', () => {
    const { transport, connection } = createTransportHarness();
    const raw = JSON.stringify({
      format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
      messageId: 'cmd-1',
      connectionId: connection.connectionId,
      sequence: 1,
      type: 'command',
      sentAt: 1_000,
      payload: {
        commandName: 'repository.read',
        declaredPluginPermissions: ['repository-read'],
        input: {
          path: 'README.md',
          nested: { value: 1 },
          list: [{ x: true }],
        },
      },
    });

    const accepted = transport.acceptTextMessage(connection, raw);
    const payload = accepted.message.payload as {
      input: { nested: { value: number }; list: Array<{ x: boolean }> };
    };

    expect(Object.isFrozen(payload.input)).toBe(true);
    expect(Object.isFrozen(payload.input.nested)).toBe(true);
    expect(Object.isFrozen(payload.input.list)).toBe(true);
    expect(Object.isFrozen(payload.input.list[0])).toBe(true);
    accepted.release();
  });

  it('rejects replay and sequence gaps', () => {
    const { transport, connection } = createTransportHarness();

    const first = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    );
    first.release();

    expect(() => transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    )).toThrowError(expect.objectContaining({ code: 'sequence-replay' }));

    expect(() => transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 3),
    )).toThrowError(expect.objectContaining({ code: 'sequence-gap' }));

    const second = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 2),
    );
    second.release();
  });

  it('consumes a denied message sequence instead of allowing replay', () => {
    const { transport, connection } = createTransportHarness();

    const first = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    );
    first.release();

    expect(() => transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    )).toThrowError(expect.objectContaining({ code: 'sequence-replay' }));
  });

  it('enforces per-window rate limits', () => {
    const { harness, transport, connection } = createTransportHarness({
      rateWindowMs: 1000,
      maxMessagesPerWindow: 1,
    });

    const first = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    );
    first.release();

    expect(() => transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 2),
    )).toThrowError(expect.objectContaining({ code: 'rate-limited' }));

    harness.now += 1000;
    const second = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 2),
    );
    second.release();
  });

  it('enforces in-flight message backpressure until release', () => {
    const { transport, connection } = createTransportHarness({
      maxInFlightMessages: 1,
      maxInFlightBytes: 64 * 1024,
    });

    const first = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    );

    expect(() => transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 2),
    )).toThrowError(expect.objectContaining({ code: 'backpressure' }));

    first.release();
    const second = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 2),
    );
    second.release();
  });
});

describe('Fury Gateway transport command admission', () => {
  it('routes commands through Phase 1.2 and never returns execution authority', () => {
    const harness = createOperatorHarness(['capability.repository-read']);
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://localhost:3000'],
    });
    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://localhost:3000',
    });
    const registry = createFuryGatewayCommandRegistry([{
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'repository.read',
      allowedRoles: ['operator'],
      requiredScopes: ['capability.repository-read'],
      requiredPluginPermissions: ['repository-read'],
      riskClass: 'read',
      requiresFreshApproval: false,
    }]);

    const accepted = transport.acceptTextMessage(
      connection,
      JSON.stringify({
        format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
        messageId: 'cmd-1',
        connectionId: connection.connectionId,
        sequence: 1,
        type: 'command',
        sentAt: 1_000,
        payload: {
          commandName: 'repository.read',
          declaredPluginPermissions: ['repository-read'],
          input: { path: 'README.md' },
        },
      }),
    );

    const evaluated = transport.evaluateCommand({
      connection,
      accepted,
      commandRegistry: registry,
    });

    expect(evaluated.admission.outcome).toBe('eligible');
    expect(evaluated.admission.executionAuthority).toBe(false);
    expect(evaluated.executionAuthority).toBe(false);
    expect(evaluated.transportReceipt.status).toBe('transport-received');
    accepted.release();
  });

  it('denies missing capability/plugin permission at the command boundary', () => {
    const harness = createOperatorHarness(['gateway.inspect']);
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://localhost:3000'],
    });
    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://localhost:3000',
    });
    const registry = createFuryGatewayCommandRegistry([{
      format: FURY_GATEWAY_COMMAND_FORMAT,
      name: 'repository.read',
      allowedRoles: ['operator'],
      requiredScopes: ['capability.repository-read'],
      requiredPluginPermissions: ['repository-read'],
      riskClass: 'read',
      requiresFreshApproval: false,
    }]);

    const accepted = transport.acceptTextMessage(
      connection,
      JSON.stringify({
        format: FURY_GATEWAY_TRANSPORT_MESSAGE_FORMAT,
        messageId: 'cmd-1',
        connectionId: connection.connectionId,
        sequence: 1,
        type: 'command',
        sentAt: 1_000,
        payload: {
          commandName: 'repository.read',
          declaredPluginPermissions: ['repository-read'],
          input: { path: 'README.md' },
        },
      }),
    );

    const evaluated = transport.evaluateCommand({
      connection,
      accepted,
      commandRegistry: registry,
    });

    expect(evaluated.admission.outcome).toBe('deny');
    expect(evaluated.admission.reason).toBe('missing-scope');
    expect(evaluated.executionAuthority).toBe(false);
    accepted.release();
  });

  it('rejects copied accepted-message evidence and non-command messages', () => {
    const harness = createOperatorHarness(['gateway.inspect']);
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://localhost:3000'],
    });
    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://localhost:3000',
    });
    const registry = createFuryGatewayCommandRegistry([]);

    const accepted = transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    );

    expect(() => transport.evaluateCommand({
      connection,
      accepted: { ...accepted },
      commandRegistry: registry,
    })).toThrowError(expect.objectContaining({ code: 'invalid-message' }));

    expect(() => transport.evaluateCommand({
      connection,
      accepted,
      commandRegistry: registry,
    })).toThrowError(expect.objectContaining({ code: 'command-required' }));
    accepted.release();
  });
});

describe('Fury Gateway transport closure', () => {
  it('closes process-local connection evidence exactly once', () => {
    const harness = createOperatorHarness();
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://localhost:3000'],
    });
    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://localhost:3000',
    });

    expect(transport.closeConnection(connection)).toBe(true);
    expect(transport.closeConnection(connection)).toBe(false);
    expect(transport.isOpen(connection)).toBe(false);
    expect(transport.connectionCount()).toBe(0);
    expect(() => transport.acceptTextMessage(
      connection,
      message(connection.connectionId, 1),
    )).toThrowError(expect.objectContaining({ code: 'invalid-connection' }));
  });

  it('rejects copied connection evidence', () => {
    const harness = createOperatorHarness();
    const transport = createFuryGatewayTransportCoordinator({
      sessionCoordinator: harness.sessionCoordinator,
      now: () => harness.now,
      allowedOrigins: ['http://localhost:3000'],
    });
    const connection = transport.openConnection({
      session: harness.session,
      clientKind: 'browser',
      remoteAddress: '127.0.0.1',
      origin: 'http://localhost:3000',
    });

    expect(() => transport.acceptTextMessage(
      { ...connection },
      message(connection.connectionId, 1),
    )).toThrowError(expect.objectContaining({ code: 'invalid-connection' }));
  });
});