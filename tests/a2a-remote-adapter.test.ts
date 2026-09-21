import { describe, expect, it } from 'vitest';

import {
  FuryA2aRemoteAdapterError,
  createFuryA2aRemoteAdapter,
  type FuryA2aRemoteAgentConfig,
  isGeneratedFuryA2aRemoteAgentDescriptor,
  isGeneratedFuryA2aRemoteMessagePlan,
} from '../src/a2a-remote-adapter-node.js';

function agentCard(
  overrides: Record<string, unknown> = {},
): Readonly<Record<string, unknown>> {
  return {
    name: 'Fixture Remote Agent',
    description: 'A bounded remote A2A fixture agent.',
    supportedInterfaces: [{
      url: 'https://agents.example.com/a2a',
      protocolBinding: 'HTTP+JSON',
      protocolVersion: '1.0',
      tenant: 'tenant-fixture',
    }],
    version: '1.2.3',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    securitySchemes: {
      bearer: {
        type: 'http',
        scheme: 'bearer',
      },
    },
    securityRequirements: [{
      schemes: {
        bearer: { list: [] },
      },
    }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{
      id: 'bounded-task',
      name: 'Bounded Task',
      description: 'Processes one bounded text task.',
      tags: ['fixture'],
    }],
    ...overrides,
  };
}

function config(
  overrides: Partial<FuryA2aRemoteAgentConfig> = {},
): FuryA2aRemoteAgentConfig {
  return {
    remoteId: 'fixture-remote',
    agentCardUrl: 'https://agents.example.com/.well-known/agent-card.json',
    agentCard: agentCard(),
    allowedOrigins: ['https://agents.example.com'],
    expectedAgentName: 'Fixture Remote Agent',
    expectedAgentVersion: '1.2.3',
    authProfileId: 'a2a-auth-profile',
    allowedProtocolBindings: ['HTTP+JSON'] as const,
    requestTimeoutMs: 10_000,
    maxRequestBytes: 64 * 1024,
    maxResponseBytes: 256 * 1024,
    replayWindowMs: 30_000,
    ...overrides,
  };
}

describe('FuryPipe ACP Gate 8.9 remote A2A adapter contract', () => {
  it('registers a stable A2A v1.0 HTTPS descriptor as evidence only', () => {
    const adapter = createFuryA2aRemoteAdapter([config()]);
    const descriptor = adapter.resolve('fixture-remote');

    expect(descriptor).toBeDefined();
    expect(isGeneratedFuryA2aRemoteAgentDescriptor(descriptor)).toBe(true);
    expect(descriptor).toMatchObject({
      remoteId: 'fixture-remote',
      protocolVersion: '1.0',
      protocolBinding: 'HTTP+JSON',
      redirectPolicy: 'error',
      requiresPublicResolutionVerification: true,
      authority: 'configured-a2a-adapter-evidence-only',
      authenticated: false,
      networkAuthority: false,
      executionAuthority: false,
      delegationAuthority: false,
    });
    expect(descriptor?.agentCardSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(descriptor?.agentIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(descriptor?.destinationOriginSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(descriptor?.authProfileIdSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(descriptor)).not.toContain('agents.example.com');
    expect(JSON.stringify(descriptor)).not.toContain('a2a-auth-profile');
    expect(adapter).toMatchObject({
      authority: 'a2a-adapter-contract-only',
      authenticated: false,
      networkAuthority: false,
      executionAuthority: false,
      delegationAuthority: false,
    });
    expect('send' in adapter).toBe(false);
    expect('fetch' in adapter).toBe(false);
    expect('execute' in adapter).toBe(false);
  });

  it('prepares one bounded non-authoritative message plan without exposing raw task or network data', () => {
    const adapter = createFuryA2aRemoteAdapter([config()]);
    const descriptor = adapter.resolve('fixture-remote');
    if (!descriptor) throw new Error('fixture descriptor missing');

    const plan = adapter.prepareMessage({
      descriptor,
      principalId: 'principal:test',
      task: 'perform the bounded remote task',
      now: 10_000,
    });

    expect(isGeneratedFuryA2aRemoteMessagePlan(plan)).toBe(true);
    expect(plan).toMatchObject({
      remoteId: 'fixture-remote',
      protocolVersion: '1.0',
      operation: 'SendMessage',
      agentIdentitySha256: descriptor.agentIdentitySha256,
      agentCardSha256: descriptor.agentCardSha256,
      interfaceSha256: descriptor.interfaceSha256,
      destinationOriginSha256: descriptor.destinationOriginSha256,
      issuedAt: 10_000,
      expiresAt: 40_000,
      requestTimeoutMs: 10_000,
      maxRequestBytes: 64 * 1024,
      maxResponseBytes: 256 * 1024,
      redirectPolicy: 'error',
      requiresPublicResolutionVerification: true,
      automaticReplayAllowed: false,
      authenticated: false,
      networkAuthority: false,
      executionAuthority: false,
      delegationAuthority: false,
    });
    expect(plan.taskSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.messageIdSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.replayNonceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(plan)).not.toContain('perform the bounded remote task');
    expect(JSON.stringify(plan)).not.toContain('agents.example.com');
    expect(JSON.stringify(plan)).not.toContain('tenant-fixture');
    expect(adapter.inspectPlan(plan)).toBe(plan);
  });

  it('produces unique replay evidence for identical logical messages and never marks replay safe', () => {
    const adapter = createFuryA2aRemoteAdapter([config()]);
    const descriptor = adapter.resolve('fixture-remote');
    if (!descriptor) throw new Error('fixture descriptor missing');

    const first = adapter.prepareMessage({
      descriptor,
      principalId: 'principal:test',
      task: 'same task',
      now: 1_000,
    });
    const second = adapter.prepareMessage({
      descriptor,
      principalId: 'principal:test',
      task: 'same task',
      now: 1_000,
    });

    expect(first.taskSha256).toBe(second.taskSha256);
    expect(first.messageIdSha256).not.toBe(second.messageIdSha256);
    expect(first.replayNonceSha256).not.toBe(second.replayNonceSha256);
    expect(first.payloadSha256).not.toBe(second.payloadSha256);
    expect(first.automaticReplayAllowed).toBe(false);
    expect(second.automaticReplayAllowed).toBe(false);
  });

  it('rejects copied descriptors, copied plans, and cross-adapter plan reuse', () => {
    const first = createFuryA2aRemoteAdapter([config()]);
    const descriptor = first.resolve('fixture-remote');
    if (!descriptor) throw new Error('fixture descriptor missing');

    expect(() => first.prepareMessage({
      descriptor: { ...descriptor },
      principalId: 'principal:test',
      task: 'copied descriptor',
    })).toThrowError(FuryA2aRemoteAdapterError);

    const plan = first.prepareMessage({
      descriptor,
      principalId: 'principal:test',
      task: 'owned plan',
    });
    expect(() => first.inspectPlan({ ...plan })).toThrowError(
      FuryA2aRemoteAdapterError,
    );

    const second = createFuryA2aRemoteAdapter([config()]);
    expect(() => second.inspectPlan(plan)).toThrowError(
      FuryA2aRemoteAdapterError,
    );
  });

  it('requires scoped auth evidence when the Agent Card declares security requirements', () => {
    expect(() => createFuryA2aRemoteAdapter([config({
      authProfileId: undefined,
    })])).toThrowError(FuryA2aRemoteAdapterError);

    const publicCard = agentCard({
      securityRequirements: [],
      securitySchemes: {},
    });
    expect(() => createFuryA2aRemoteAdapter([config({
      agentCard: publicCard,
      authProfileId: undefined,
    })])).not.toThrow();
  });

  it('rejects protocol downgrade, identity mismatch, and trusted-card digest mismatch', () => {
    expect(() => createFuryA2aRemoteAdapter([config({
      agentCard: agentCard({
        supportedInterfaces: [{
          url: 'https://agents.example.com/a2a',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '0.3',
        }],
      }),
    })])).toThrowError(FuryA2aRemoteAdapterError);

    expect(() => createFuryA2aRemoteAdapter([config({
      expectedAgentName: 'Different Agent',
    })])).toThrowError(FuryA2aRemoteAdapterError);

    expect(() => createFuryA2aRemoteAdapter([config({
      trustedAgentCardSha256: '0'.repeat(64),
    })])).toThrowError(FuryA2aRemoteAdapterError);
  });

  it('rejects unsafe network destinations before any transport exists', () => {
    for (const unsafe of [
      'http://agents.example.com',
      'https://localhost',
      'https://service.internal',
      'https://127.0.0.1',
      'https://10.0.0.1',
      'https://192.168.1.10',
      'https://169.254.1.1',
      'https://100.64.0.1',
      'https://198.18.0.1',
      'https://198.51.100.10',
      'https://203.0.113.10',
      'https://[::1]',
      'https://[::ffff:127.0.0.1]',
      'https://[2001:db8::1]',
    ]) {
      expect(() => createFuryA2aRemoteAdapter([config({
        agentCardUrl: unsafe + '/.well-known/agent-card.json',
        allowedOrigins: [unsafe],
        agentCard: agentCard({
          supportedInterfaces: [{
            url: unsafe + '/a2a',
            protocolBinding: 'HTTP+JSON',
            protocolVersion: '1.0',
          }],
        }),
      })])).toThrowError(FuryA2aRemoteAdapterError);
    }

    expect(() => createFuryA2aRemoteAdapter([config({
      agentCard: agentCard({
        supportedInterfaces: [{
          url: 'https://other.example.com/a2a',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        }],
      }),
    })])).toThrowError(FuryA2aRemoteAdapterError);
  });

  it('enforces request/response/time/replay bounds and payload size before execution', () => {
    expect(() => createFuryA2aRemoteAdapter([config({
      requestTimeoutMs: 120_001,
    })])).toThrowError(FuryA2aRemoteAdapterError);

    expect(() => createFuryA2aRemoteAdapter([config({
      replayWindowMs: 999,
    })])).toThrowError(FuryA2aRemoteAdapterError);

    const adapter = createFuryA2aRemoteAdapter([config({
      maxRequestBytes: 1024,
    })]);
    const descriptor = adapter.resolve('fixture-remote');
    if (!descriptor) throw new Error('fixture descriptor missing');

    expect(() => adapter.prepareMessage({
      descriptor,
      principalId: 'principal:test',
      task: 'x'.repeat(4_096),
    })).toThrowError(FuryA2aRemoteAdapterError);
  });

  it('rejects malformed v1.0 Agent Cards instead of silently filling missing fields', () => {
    expect(() => createFuryA2aRemoteAdapter([config({
      agentCard: {
        name: 'Incomplete',
        version: '1.0.0',
        supportedInterfaces: [{
          url: 'https://agents.example.com/a2a',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        }],
      },
    })])).toThrowError(FuryA2aRemoteAdapterError);
  });
});
