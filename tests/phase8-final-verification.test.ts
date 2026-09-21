import { describe, expect, it } from 'vitest';

import {
  FURY_ACP_V1_SERVER_FORMAT,
  createFuryAcpV1Server,
} from '../src/acp-v1-server-node.js';
import {
  FURY_ACP_CLIENT_OPERATION_PLAN_FORMAT,
} from '../src/acp-client-capability-runtime-node.js';
import {
  FURY_ACP_EXTERNAL_AGENT_REGISTRY_FORMAT,
  FURY_ACP_EXTERNAL_SESSION_FORMAT,
  createFuryAcpExternalAgentRegistry,
} from '../src/acp-external-client-runtime-node.js';
import {
  FURY_ACP_DELEGATION_PERMIT_FORMAT,
  FURY_ACP_DELEGATION_RECEIPT_FORMAT,
} from '../src/acp-delegation-runtime-node.js';
import {
  FURY_A2A_REMOTE_AGENT_DESCRIPTOR_FORMAT,
  FURY_A2A_REMOTE_MESSAGE_PLAN_FORMAT,
  createFuryA2aRemoteAdapter,
} from '../src/a2a-remote-adapter-node.js';

describe('Phase 8 final interoperability verification', () => {
  it('keeps every reviewed public protocol/evidence format pinned to v1', () => {
    expect(FURY_ACP_V1_SERVER_FORMAT).toBe('furypipe-acp-v1-server/v1');
    expect(FURY_ACP_CLIENT_OPERATION_PLAN_FORMAT).toBe(
      'furypipe-acp-client-operation-plan/v1',
    );
    expect(FURY_ACP_EXTERNAL_AGENT_REGISTRY_FORMAT).toBe(
      'furypipe-acp-external-agent-registry/v1',
    );
    expect(FURY_ACP_EXTERNAL_SESSION_FORMAT).toBe(
      'furypipe-acp-external-session/v1',
    );
    expect(FURY_ACP_DELEGATION_PERMIT_FORMAT).toBe(
      'furypipe-acp-delegation-permit/v1',
    );
    expect(FURY_ACP_DELEGATION_RECEIPT_FORMAT).toBe(
      'furypipe-acp-delegation-receipt/v1',
    );
    expect(FURY_A2A_REMOTE_AGENT_DESCRIPTOR_FORMAT).toBe(
      'furypipe-a2a-remote-agent-descriptor/v1',
    );
    expect(FURY_A2A_REMOTE_MESSAGE_PLAN_FORMAT).toBe(
      'furypipe-a2a-remote-message-plan/v1',
    );
  });

  it('constructs final evidence surfaces without promoting metadata into authority', () => {
    const server = createFuryAcpV1Server({
      promptHandler: async () => ({ stopReason: 'end_turn' }),
    });
    expect(server).toMatchObject({
      format: FURY_ACP_V1_SERVER_FORMAT,
      protocolVersion: 1,
    });
    expect(server.sessionCount()).toBe(0);
    expect('execute' in server).toBe(false);
    expect('delegate' in server).toBe(false);

    const externalRegistry = createFuryAcpExternalAgentRegistry([{
      agentId: 'phase8-final-agent',
      command: 'node',
      cwd: '.',
    }]);
    const externalDescriptor = externalRegistry.resolve('phase8-final-agent');
    expect(externalDescriptor).toMatchObject({
      format: 'furypipe-acp-external-agent-descriptor/v1',
      authority: 'configured-agent-evidence-only',
      executionAuthority: false,
      delegationAuthority: false,
    });
    expect(externalRegistry).toMatchObject({
      format: FURY_ACP_EXTERNAL_AGENT_REGISTRY_FORMAT,
      authority: 'configured-agent-registry-only',
      executionAuthority: false,
    });

    const a2a = createFuryA2aRemoteAdapter([{
      remoteId: 'phase8-final-remote',
      agentCardUrl: 'https://agents.example.com/.well-known/agent-card.json',
      allowedOrigins: ['https://agents.example.com'],
      authProfileId: 'profile-ref-1',
      agentCard: {
        name: 'Phase 8 Final Remote',
        description: 'Final interoperability evidence fixture.',
        supportedInterfaces: [{
          url: 'https://agents.example.com/a2a',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        }],
        version: '1.0.0',
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
        skills: [],
      },
    }]);
    const remote = a2a.resolve('phase8-final-remote');
    if (!remote) throw new Error('final A2A fixture descriptor missing');

    const plan = a2a.prepareMessage({
      descriptor: remote,
      principalId: 'principal:phase8-final',
      task: 'verify final Phase 8 evidence boundaries',
      now: 1_000,
    });

    expect(remote).toMatchObject({
      protocolVersion: '1.0',
      authenticated: false,
      networkAuthority: false,
      executionAuthority: false,
      delegationAuthority: false,
    });
    expect(plan).toMatchObject({
      protocolVersion: '1.0',
      operation: 'SendMessage',
      authenticated: false,
      networkAuthority: false,
      executionAuthority: false,
      delegationAuthority: false,
      automaticReplayAllowed: false,
    });
    expect('send' in a2a).toBe(false);
    expect('fetch' in a2a).toBe(false);
    expect('execute' in a2a).toBe(false);
  });
});
