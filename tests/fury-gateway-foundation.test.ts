import { describe, expect, it } from 'vitest';
import {
  FURY_GATEWAY_CONNECT_FORMAT,
  FURY_GATEWAY_PROTOCOL_VERSION,
  FuryGatewayProtocolError,
  createFuryGatewayHealthSnapshot,
  deriveFuryGatewayConnectFingerprint,
  parseFuryGatewayConnectEnvelope,
} from '../src/gateway.js';

function nodeEnvelope() {
  return {
    format: FURY_GATEWAY_CONNECT_FORMAT,
    protocolVersion: FURY_GATEWAY_PROTOCOL_VERSION,
    role: 'node',
    client: {
      clientId: 'desktop-main',
      instanceId: 'instance-01',
      platform: 'windows',
      deviceFamily: 'desktop',
    },
    capabilities: ['filesystem.read', 'browser.capture'],
    commands: ['screen.capture', 'shell.run'],
  };
}

describe('Fury Gateway foundation', () => {
  it('parses and canonicalizes a credential-free node handshake', () => {
    const parsed = parseFuryGatewayConnectEnvelope(nodeEnvelope());
    expect(parsed.authority).toBe('unverified');
    expect(parsed.capabilities).toEqual(['browser.capture', 'filesystem.read']);
    expect(parsed.commands).toEqual(['screen.capture', 'shell.run']);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.client)).toBe(true);
  });

  it('derives the same fingerprint for semantically identical list ordering', () => {
    const first = parseFuryGatewayConnectEnvelope(nodeEnvelope());
    const second = parseFuryGatewayConnectEnvelope({
      ...nodeEnvelope(),
      capabilities: ['browser.capture', 'filesystem.read'],
      commands: ['shell.run', 'screen.capture'],
    });
    expect(deriveFuryGatewayConnectFingerprint(first)).toBe(
      deriveFuryGatewayConnectFingerprint(second),
    );
  });

  it('rejects secret-bearing or unknown handshake fields instead of accepting hidden authority', () => {
    expect(() => parseFuryGatewayConnectEnvelope({
      ...nodeEnvelope(),
      token: 'super-secret',
    })).toThrowError(FuryGatewayProtocolError);
    expect(() => parseFuryGatewayConnectEnvelope({
      ...nodeEnvelope(),
      client: {
        ...nodeEnvelope().client,
        apiKey: 'super-secret',
      },
    })).toThrowError(FuryGatewayProtocolError);
  });

  it('rejects duplicate and unbounded capability declarations', () => {
    expect(() => parseFuryGatewayConnectEnvelope({
      ...nodeEnvelope(),
      capabilities: ['browser.capture', 'browser.capture'],
    })).toThrowError(/duplicate/u);

    expect(() => parseFuryGatewayConnectEnvelope({
      ...nodeEnvelope(),
      capabilities: Array.from({ length: 65 }, (_, index) => `capability.${index}`),
    })).toThrowError(/64/u);
  });

  it('does not let operator/channel connections advertise executable commands', () => {
    for (const role of ['operator', 'channel'] as const) {
      expect(() => parseFuryGatewayConnectEnvelope({
        ...nodeEnvelope(),
        role,
      })).toThrowError(/may not advertise executable commands/u);
    }
  });

  it('rejects unsupported protocol versions and malformed identities', () => {
    expect(() => parseFuryGatewayConnectEnvelope({
      ...nodeEnvelope(),
      protocolVersion: 'furypipe-gateway/v999',
    })).toThrowError(/unsupported Fury Gateway protocol/u);

    expect(() => parseFuryGatewayConnectEnvelope({
      ...nodeEnvelope(),
      client: { ...nodeEnvelope().client, clientId: '../escape' },
    })).toThrowError(/unsupported characters/u);
  });

  it('creates bounded observability-only health snapshots', () => {
    const health = createFuryGatewayHealthSnapshot({
      status: 'ready',
      startedAt: 1_000,
      observedAt: 1_250,
      connections: { operator: 1, node: 2 },
      sessions: 3,
      automations: 4,
      workers: 2,
    });

    expect(health.uptimeMs).toBe(250);
    expect(health.connections).toEqual({
      operator: 1,
      node: 2,
      channel: 0,
      worker: 0,
    });
    expect(health.sessions).toBe(3);
    expect(Object.isFrozen(health)).toBe(true);
  });

  it('rejects impossible health clocks and counters', () => {
    expect(() => createFuryGatewayHealthSnapshot({
      status: 'ready',
      startedAt: 200,
      observedAt: 100,
    })).toThrowError(/observedAt/u);

    expect(() => createFuryGatewayHealthSnapshot({
      status: 'ready',
      startedAt: 0,
      observedAt: 1,
      workers: -1,
    })).toThrowError(/workers/u);
  });
});
