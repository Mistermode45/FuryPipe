import { describe, expect, it } from 'vitest';

import {
  FURY_GATEWAY_CONNECT_FORMAT,
  FURY_GATEWAY_MAX_MESSAGE_BYTES,
  FURY_GATEWAY_MESSAGE_FORMAT,
  FURY_GATEWAY_PROTOCOL_VERSION,
  parseFuryGatewayMessageText,
  serializeFuryGatewayMessage,
} from '../src/gateway.js';
import {
  FuryGatewayTransportError,
  createFuryGatewayTransportCoordinator,
  resolveFuryGatewayBindPolicy,
} from '../src/gateway-transport-node.js';

function connect(role: 'operator' | 'node' | 'channel' | 'worker' = 'node') {
  return {
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role,
    client: {
      clientId: role === 'operator' ? 'web-console' : 'fury-node',
      instanceId: `${role}-instance-1`,
      platform: role === 'operator' ? 'web' : 'linux',
      deviceFamily: role === 'operator' ? 'browser' : 'server',
    },
    capabilities: role === 'operator' ? [] : ['filesystem.read'],
    commands: role === 'node' || role === 'worker' ? ['shell.run'] : [],
  };
}

function message(
  sequence: number,
  messageId = `msg-${sequence}`,
  type = 'transport.test',
  payload: unknown = { ok: true },
): string {
  return JSON.stringify({
    format: FURY_GATEWAY_MESSAGE_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    messageId,
    sequence,
    kind: 'event',
    type,
    sentAt: 1_000,
    payload,
  });
}

describe('Fury Gateway transport message contract', () => {
  it('round-trips bounded data while granting no authority', () => {
    const text = serializeFuryGatewayMessage({
      format: FURY_GATEWAY_MESSAGE_FORMAT,
      protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
      messageId: 'msg-1',
      sequence: 1,
      kind: 'request',
      type: 'gateway.inspect',
      sentAt: 1_000,
      payload: { section: 'health' },
    });
    const parsed = parseFuryGatewayMessageText(text);

    expect(parsed.messageId).toBe('msg-1');
    expect(parsed.sequence).toBe(1);
    expect(parsed.kind).toBe('request');
    expect(parsed.type).toBe('gateway.inspect');
    expect(parsed.authority).toBe('transport-data-only');
    expect('executionAuthority' in parsed).toBe(false);
  });

  it('rejects oversized messages before accepting transport data', () => {
    const oversized = message(1, 'msg-1', 'transport.test', {
      value: 'x'.repeat(FURY_GATEWAY_MAX_MESSAGE_BYTES),
    });
    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(FURY_GATEWAY_MAX_MESSAGE_BYTES);
    expect(() => parseFuryGatewayMessageText(oversized)).toThrowError(
      expect.objectContaining({ code: 'limit-exceeded' }),
    );
  });

  it('rejects malformed JSON, schema drift and invalid sequencing metadata', () => {
    expect(() => parseFuryGatewayMessageText('{')).toThrowError(
      expect.objectContaining({ code: 'invalid-message' }),
    );

    expect(() => parseFuryGatewayMessageText(JSON.stringify({
      ...JSON.parse(message(1)),
      hiddenAuthority: true,
    }))).toThrowError(expect.objectContaining({ code: 'invalid-message' }));

    expect(() => parseFuryGatewayMessageText(message(0))).toThrowError(
      expect.objectContaining({ code: 'invalid-sequence' }),
    );
  });

  it('bounds JSON depth, arrays and dangerous object keys', () => {
    let deep: unknown = 'leaf';
    for (let index = 0; index < 18; index += 1) deep = { next: deep };
    expect(() => parseFuryGatewayMessageText(message(1, 'deep', 'transport.test', deep))).toThrowError(
      expect.objectContaining({ code: 'limit-exceeded' }),
    );

    expect(() => parseFuryGatewayMessageText(
      message(1, 'array', 'transport.test', Array.from({ length: 257 }, () => 1)),
    )).toThrowError(expect.objectContaining({ code: 'limit-exceeded' }));

    const unsafe = `{"format":"${FURY_GATEWAY_MESSAGE_FORMAT}","protocolVersion":"${FURY_GATEWAY_PROTOCOL_VERSION}","messageId":"unsafe","sequence":1,"kind":"event","type":"transport.test","sentAt":1000,"payload":{"__proto__":"blocked"}}`;
    expect(() => parseFuryGatewayMessageText(unsafe)).toThrowError(
      expect.objectContaining({ code: 'invalid-payload' }),
    );
  });
});

describe('Fury Gateway bind policy', () => {
  it('defaults to loopback-only with remote transport disabled', () => {
    expect(resolveFuryGatewayBindPolicy()).toEqual({
      host: '127.0.0.1',
      remoteEnabled: false,
      secureTransport: 'none',
      allowedBrowserOrigins: [],
    });
  });

  it('rejects non-loopback binding unless remote mode and secure transport are explicit', () => {
    expect(() => resolveFuryGatewayBindPolicy({
      host: '0.0.0.0',
    })).toThrowError(expect.objectContaining({ code: 'remote-disabled' }));

    expect(() => resolveFuryGatewayBindPolicy({
      host: '0.0.0.0',
      remoteEnabled: true,
      secureTransport: 'none',
    })).toThrowError(expect.objectContaining({ code: 'secure-transport-required' }));

    expect(resolveFuryGatewayBindPolicy({
      host: '0.0.0.0',
      remoteEnabled: true,
      secureTransport: 'tls',
    }).secureTransport).toBe('tls');
  });

  it('requires exact browser origins and rejects wildcard/path variants', () => {
    expect(() => resolveFuryGatewayBindPolicy({
      allowedBrowserOrigins: ['https://*.example.com'],
    })).toThrowError(expect.objectContaining({ code: 'invalid-origin' }));

    expect(() => resolveFuryGatewayBindPolicy({
      allowedBrowserOrigins: ['https://console.example.com/path'],
    })).toThrowError(expect.objectContaining({ code: 'invalid-origin' }));

    expect(resolveFuryGatewayBindPolicy({
      allowedBrowserOrigins: ['https://console.example.com'],
    }).allowedBrowserOrigins).toEqual(['https://console.example.com']);
  });
});

describe('Fury Gateway transport coordinator', () => {
  it('requires ready lifecycle and process-local connection evidence', () => {
    const transport = createFuryGatewayTransportCoordinator();
    expect(() => transport.openConnection(connect(), { clientKind: 'device' })).toThrowError(
      expect.objectContaining({ code: 'transport-not-ready' }),
    );

    transport.setStatus('ready');
    const connection = transport.openConnection(connect(), { clientKind: 'device' });
    expect(connection.authority).toBe('transport-connection-only');
    expect(transport.connectionCount()).toBe(1);

    expect(() => transport.inspectConnection({ ...connection })).toThrowError(
      expect.objectContaining({ code: 'invalid-connection' }),
    );
  });

  it('enforces exact browser Origin and browser role separation', () => {
    const transport = createFuryGatewayTransportCoordinator({
      bindPolicy: {
        allowedBrowserOrigins: ['https://console.example.com'],
      },
    });
    transport.setStatus('ready');

    expect(() => transport.openConnection(connect('operator'), {
      clientKind: 'browser',
      origin: 'https://console.example.com.evil.test',
    })).toThrowError(expect.objectContaining({ code: 'origin-not-allowed' }));

    expect(() => transport.openConnection(connect('node'), {
      clientKind: 'browser',
      origin: 'https://console.example.com',
    })).toThrowError(expect.objectContaining({ code: 'invalid-client-kind' }));

    const operator = transport.openConnection(connect('operator'), {
      clientKind: 'browser',
      origin: 'https://console.example.com',
    });
    expect(operator.role).toBe('operator');
  });

  it('enforces global and per-role connection quotas', () => {
    const transport = createFuryGatewayTransportCoordinator({
      maxConnections: 2,
      maxConnectionsByRole: {
        node: 1,
      },
    });
    transport.setStatus('ready');
    transport.openConnection(connect('node'), { clientKind: 'device' });

    expect(() => transport.openConnection({
      ...connect('node'),
      client: { ...connect('node').client, instanceId: 'node-instance-2' },
    }, { clientKind: 'device' })).toThrowError(
      expect.objectContaining({ code: 'role-limit-exceeded' }),
    );

    transport.openConnection(connect('worker'), { clientKind: 'device' });
    expect(() => transport.openConnection(connect('channel'), { clientKind: 'device' })).toThrowError(
      expect.objectContaining({ code: 'connection-limit-exceeded' }),
    );
  });

  it('accepts exact sequence order and rejects replay, gaps and duplicate message IDs', () => {
    const transport = createFuryGatewayTransportCoordinator();
    transport.setStatus('ready');
    const connection = transport.openConnection(connect(), { clientKind: 'device' });

    expect(transport.acceptInbound(connection, message(1, 'id-1')).sequence).toBe(1);

    expect(() => transport.acceptInbound(connection, message(1, 'id-replay'))).toThrowError(
      expect.objectContaining({ code: 'stale-sequence' }),
    );
    expect(() => transport.acceptInbound(connection, message(3, 'id-gap'))).toThrowError(
      expect.objectContaining({ code: 'sequence-gap' }),
    );
    expect(() => transport.acceptInbound(connection, message(2, 'id-1'))).toThrowError(
      expect.objectContaining({ code: 'duplicate-message-id' }),
    );

    expect(transport.acceptInbound(connection, message(2, 'id-2')).sequence).toBe(2);
  });

  it('counts invalid sequencing attempts toward the inbound rate limit', () => {
    let now = 10_000;
    const transport = createFuryGatewayTransportCoordinator({
      now: () => now,
      rateWindowMs: 1_000,
      maxInboundMessagesPerWindow: 2,
    });
    transport.setStatus('ready');
    const connection = transport.openConnection(connect(), { clientKind: 'device' });

    transport.acceptInbound(connection, message(1, 'rate-1'));
    expect(() => transport.acceptInbound(connection, message(3, 'rate-gap'))).toThrowError(
      expect.objectContaining({ code: 'sequence-gap' }),
    );
    expect(() => transport.acceptInbound(connection, message(2, 'rate-2'))).toThrowError(
      expect.objectContaining({ code: 'rate-limit-exceeded' }),
    );

    now += 1_001;
    expect(transport.acceptInbound(connection, message(2, 'rate-2')).sequence).toBe(2);
  });

  it('assigns server-side outbound sequence and enforces message-queue backpressure', () => {
    const transport = createFuryGatewayTransportCoordinator({
      maxOutboundMessages: 1,
    });
    transport.setStatus('ready');
    const connection = transport.openConnection(connect(), { clientKind: 'device' });

    const firstText = transport.enqueueOutbound(connection, {
      kind: 'event',
      type: 'transport.ready',
      payload: { ready: true },
    });
    expect(parseFuryGatewayMessageText(firstText).sequence).toBe(1);

    expect(() => transport.enqueueOutbound(connection, {
      kind: 'event',
      type: 'transport.second',
      payload: null,
    })).toThrowError(expect.objectContaining({ code: 'backpressure' }));

    expect(transport.dequeueOutbound(connection)).toBe(firstText);
    const secondText = transport.enqueueOutbound(connection, {
      kind: 'event',
      type: 'transport.second',
      payload: null,
    });
    expect(parseFuryGatewayMessageText(secondText).sequence).toBe(2);
  });

  it('sweeps idle connections and rejects new connections while draining', () => {
    let now = 50_000;
    const transport = createFuryGatewayTransportCoordinator({
      now: () => now,
      idleTimeoutMs: 5_000,
    });
    transport.setStatus('ready');
    const connection = transport.openConnection(connect(), { clientKind: 'device' });

    now += 5_001;
    expect(transport.sweepIdle().map((entry) => entry.connectionId)).toEqual([
      connection.connectionId,
    ]);
    expect(transport.connectionCount()).toBe(0);

    transport.setStatus('draining');
    expect(() => transport.openConnection(connect(), { clientKind: 'device' })).toThrowError(
      expect.objectContaining({ code: 'transport-draining' }),
    );
    transport.setStatus('stopped');
    expect(transport.status()).toBe('stopped');
  });

  it('rejects invalid lifecycle transitions', () => {
    const transport = createFuryGatewayTransportCoordinator();
    transport.setStatus('ready');
    expect(() => transport.setStatus('ready')).toThrowError(
      expect.objectContaining({ code: 'invalid-transition' }),
    );
    transport.setStatus('draining');
    expect(() => transport.setStatus('ready')).toThrowError(
      expect.objectContaining({ code: 'invalid-transition' }),
    );
  });
});
