import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as acp from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { createRecoveryStore } from '../src/core/recovery-store.js';
import {
  createFuryGatewayConversationAdapter,
} from '../src/gateway-conversation-adapter-node.js';
import {
  FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
  createFuryGatewayPrincipalRegistry,
} from '../src/gateway-principal-node.js';
import {
  createFuryGatewaySessionCoordinator,
  type FuryGatewayScope,
} from '../src/gateway-session-node.js';
import { createFuryKernelConversationStore } from '../src/fury-kernel.js';
import {
  createFuryAcpGatewaySessionBridge,
} from '../src/acp-gateway-session-bridge-node.js';
import {
  FURY_ACP_PERMISSION_OPERATION_FORMAT,
  FuryAcpPermissionBridgeError,
  createFuryAcpPermissionBridge,
  isGeneratedFuryAcpPermissionPermit,
  type FuryAcpPermissionAdmissionResult,
  type FuryAcpPermissionOperation,
} from '../src/acp-permission-bridge-node.js';
import {
  createFuryAcpV1Server,
} from '../src/acp-v1-server-node.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function recoveryRoot(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'furypipe-acp-permission-'),
  );
  tempDirs.push(dir);
  return dir;
}

function harness(
  scopes: readonly FuryGatewayScope[] = [
    'conversations.write',
    'capability.process',
  ],
  permitTtlMs = 30_000,
) {
  let now = 100_000;
  const principals = createFuryGatewayPrincipalRegistry({
    now: () => now,
  });
  const principal = principals.recordAuthenticatedPrincipal({
    format: FURY_GATEWAY_PRINCIPAL_ASSERTION_FORMAT,
    principalId: 'principal:user-1',
    kind: 'human',
    issuer: 'local',
    subject: 'acp-permission-user',
    authenticationMethod: 'local-owner',
  });
  const sessions = createFuryGatewaySessionCoordinator({
    principalRegistry: principals,
    gatewayInstanceId: 'gateway-acp-permission-test',
    now: () => now,
  });
  const gatewaySession = sessions.issueSession({
    principal,
    role: 'operator',
    scopes,
    binding: { kind: 'local-operator' },
  });
  const recovery = createRecoveryStore(recoveryRoot(), {
    namespace: 'acp_permission',
    maxObjectBytes: 64 * 1024,
    maxTotalBytes: 8 * 1024 * 1024,
  });
  const kernel = createFuryKernelConversationStore({
    now: () => now,
  });
  const conversations = createFuryGatewayConversationAdapter({ kernel });
  const bridge = createFuryAcpGatewaySessionBridge({
    recovery,
    gatewaySessionCoordinator: sessions,
    gatewaySession,
    conversationAdapter: conversations,
    now: () => now,
  });
  const permissions = createFuryAcpPermissionBridge({
    bridge,
    gatewaySessionCoordinator: sessions,
    gatewaySession,
    now: () => now,
    permitTtlMs,
  });
  return {
    principals,
    principal,
    sessions,
    gatewaySession,
    bridge,
    permissions,
    get now() { return now; },
    set now(value: number) { now = value; },
  };
}

function processOperation(): FuryAcpPermissionOperation {
  return {
    format: FURY_ACP_PERMISSION_OPERATION_FORMAT,
    operationId: 'terminal.execute',
    title: 'Run bounded build command',
    toolKind: 'execute',
    riskClass: 'process',
    requiredScopes: [],
    requiredPluginPermissions: ['process'],
  };
}

async function runPrompt(
  h: ReturnType<typeof harness>,
  permissionHandler: (
    params: acp.RequestPermissionRequest,
  ) => Promise<acp.RequestPermissionResponse> | acp.RequestPermissionResponse,
  promptHandler: Parameters<typeof createFuryAcpV1Server>[0]['promptHandler'],
) {
  const requests: acp.RequestPermissionRequest[] = [];
  const server = createFuryAcpV1Server({
    now: () => h.now,
    sessionHooks: h.bridge.sessionHooks,
    promptHandler,
  });
  const result = await acp
    .client({ name: 'permission-test-client' })
    .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
      requests.push(ctx.params);
      return permissionHandler(ctx.params);
    })
    .connectWith(server.app, async (agent) => {
      const session = await agent.request(acp.methods.agent.session.new, {
        cwd: '/workspace/project',
        mcpServers: [],
      });
      const response = await agent.request(acp.methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'perform governed operation' }],
      });
      return { session, response };
    });
  return { ...result, requests, server };
}

describe('FuryPipe ACP governed permission bridge', () => {
  it('uses allow-once only and mints then consumes one process-local permit', async () => {
    const h = harness();
    let admission: FuryAcpPermissionAdmissionResult | undefined;
    let receipt: unknown;
    const result = await runPrompt(
      h,
      (params) => {
        expect(params.options.map((option) => option.kind))
          .toEqual(['allow_once', 'reject_once']);
        expect(params.toolCall).toMatchObject({
          toolCallId: 'terminal.execute',
          title: 'Run bounded build command',
          kind: 'execute',
          status: 'pending',
        });
        expect(params.toolCall.rawInput).toBeUndefined();
        expect(params.toolCall.rawOutput).toBeUndefined();
        const allow = params.options.find(
          (option) => option.kind === 'allow_once',
        );
        if (!allow) throw new Error('allow_once missing');
        return {
          outcome: {
            outcome: 'selected',
            optionId: allow.optionId,
          },
        };
      },
      async (context) => {
        admission = await h.permissions.admit(
          context.session,
          context.permissionRequester,
          processOperation(),
        );
        expect(admission.permit?.executionAuthority).toBe(true);
        expect(isGeneratedFuryAcpPermissionPermit(admission.permit)).toBe(true);
        receipt = h.permissions.consume(
          admission.permit!,
          context.session,
        );
        expect(() => h.permissions.consume(
          admission!.permit!,
          context.session,
        )).toThrowError(FuryAcpPermissionBridgeError);
        return { stopReason: 'end_turn' };
      },
    );

    expect(result.response.stopReason).toBe('end_turn');
    expect(result.requests).toHaveLength(1);
    expect(admission?.decision).toMatchObject({
      outcome: 'eligible',
      reason: 'eligible',
      selectedOption: 'allow_once',
      executionAuthority: false,
    });
    expect(receipt).toMatchObject({
      authority: 'admitted-operation-data-only',
      executionAuthority: false,
    });
  });

  it('returns a deny decision for explicit reject without minting a permit', async () => {
    const h = harness();
    let admission: FuryAcpPermissionAdmissionResult | undefined;
    await runPrompt(
      h,
      (params) => {
        const reject = params.options.find(
          (option) => option.kind === 'reject_once',
        );
        if (!reject) throw new Error('reject_once missing');
        return {
          outcome: {
            outcome: 'selected',
            optionId: reject.optionId,
          },
        };
      },
      async (context) => {
        admission = await h.permissions.admit(
          context.session,
          context.permissionRequester,
          processOperation(),
        );
        return { stopReason: 'end_turn' };
      },
    );
    expect(admission?.decision).toMatchObject({
      outcome: 'deny',
      reason: 'client-rejected',
      selectedOption: 'reject_once',
    });
    expect(admission?.permit).toBeUndefined();
  });

  it('returns a deny decision for cancelled permission without minting a permit', async () => {
    const h = harness();
    let admission: FuryAcpPermissionAdmissionResult | undefined;
    await runPrompt(
      h,
      () => ({ outcome: { outcome: 'cancelled' } }),
      async (context) => {
        admission = await h.permissions.admit(
          context.session,
          context.permissionRequester,
          processOperation(),
        );
        return { stopReason: 'end_turn' };
      },
    );
    expect(admission?.decision).toMatchObject({
      outcome: 'deny',
      reason: 'client-cancelled',
      selectedOption: 'cancelled',
    });
    expect(admission?.permit).toBeUndefined();
  });

  it('denies missing Gateway capability before asking the ACP client', async () => {
    const h = harness(['conversations.write']);
    let admission: FuryAcpPermissionAdmissionResult | undefined;
    const result = await runPrompt(
      h,
      () => {
        throw new Error('permission request must not be sent');
      },
      async (context) => {
        admission = await h.permissions.admit(
          context.session,
          context.permissionRequester,
          processOperation(),
        );
        return { stopReason: 'end_turn' };
      },
    );
    expect(result.requests).toHaveLength(0);
    expect(admission?.decision).toMatchObject({
      outcome: 'deny',
      reason: 'gateway-admission-denied',
    });
  });

  it('revalidates Gateway authority after allow-once and denies revoked authority', async () => {
    const h = harness();
    let admission: FuryAcpPermissionAdmissionResult | undefined;
    await runPrompt(
      h,
      (params) => {
        expect(h.sessions.revokeSession(h.gatewaySession.sessionId)).toBe(true);
        const allow = params.options.find(
          (option) => option.kind === 'allow_once',
        );
        if (!allow) throw new Error('allow_once missing');
        return {
          outcome: {
            outcome: 'selected',
            optionId: allow.optionId,
          },
        };
      },
      async (context) => {
        admission = await h.permissions.admit(
          context.session,
          context.permissionRequester,
          processOperation(),
        );
        return { stopReason: 'end_turn' };
      },
    );
    expect(admission?.decision).toMatchObject({
      outcome: 'deny',
      reason: 'gateway-admission-denied-after-permission',
      selectedOption: 'allow_once',
    });
    expect(admission?.permit).toBeUndefined();
  });

  it('rejects copied requesters and copied permits at process-local boundaries', async () => {
    const h = harness();
    let copiedRequesterRejected = false;
    let copiedPermitRejected = false;
    await runPrompt(
      h,
      (params) => {
        const allow = params.options.find(
          (option) => option.kind === 'allow_once',
        );
        if (!allow) throw new Error('allow_once missing');
        return {
          outcome: {
            outcome: 'selected',
            optionId: allow.optionId,
          },
        };
      },
      async (context) => {
        await expect(h.permissions.admit(
          context.session,
          { ...context.permissionRequester } as never,
          processOperation(),
        )).rejects.toMatchObject({ code: 'invalid-requester' });
        copiedRequesterRejected = true;

        const admission = await h.permissions.admit(
          context.session,
          context.permissionRequester,
          processOperation(),
        );
        expect(() => h.permissions.consume(
          { ...admission.permit! } as never,
          context.session,
        )).toThrowError(FuryAcpPermissionBridgeError);
        copiedPermitRejected = true;
        return { stopReason: 'end_turn' };
      },
    );
    expect(copiedRequesterRejected).toBe(true);
    expect(copiedPermitRejected).toBe(true);
  });

  it('fails closed on an expired permit before any side-effect execution', async () => {
    const h = harness(undefined, 1_000);
    let observedCode: string | undefined;
    await runPrompt(
      h,
      (params) => {
        const allow = params.options.find(
          (option) => option.kind === 'allow_once',
        );
        if (!allow) throw new Error('allow_once missing');
        return {
          outcome: {
            outcome: 'selected',
            optionId: allow.optionId,
          },
        };
      },
      async (context) => {
        const admission = await h.permissions.admit(
          context.session,
          context.permissionRequester,
          processOperation(),
        );
        h.now += 1_001;
        try {
          h.permissions.consume(admission.permit!, context.session);
        } catch (error) {
          observedCode = (error as FuryAcpPermissionBridgeError).code;
        }
        return { stopReason: 'end_turn' };
      },
    );
    expect(observedCode).toBe('permit-expired');
  });

  it('rejects a client response selecting an option that was never offered', async () => {
    const h = harness();
    await expect(runPrompt(
      h,
      () => ({
        outcome: {
          outcome: 'selected',
          optionId: 'allow_always_not_offered',
        },
      }),
      async (context) => {
        await h.permissions.admit(
          context.session,
          context.permissionRequester,
          processOperation(),
        );
        return { stopReason: 'end_turn' };
      },
    )).rejects.toMatchObject({ code: -32013 });
  });
});
