import { describe, expect, it, vi } from 'vitest';

import type { FuryKernelMemoryBridge } from '../src/fury-kernel-memory-bridge-node.js';
import {
  createFuryGatewayMemoryAdapter,
} from '../src/gateway-memory-adapter-node.js';
import type { FuryGatewayLocalMemoryConfig } from '../src/gateway-local-memory-runtime-node.js';

const config: FuryGatewayLocalMemoryConfig = Object.freeze({
  format: 'furypipe-gateway-local-memory-config/v1',
  enabled: true,
  encrypted: true,
  scopeKinds: Object.freeze(['project', 'user']),
  policy: Object.freeze({
    allowInferred: false,
    allowSensitive: false,
  }),
  learningEnabled: true,
  quotas: Object.freeze({
    maxObjectBytes: 262_144,
    maxTotalBytes: 8_388_608,
    maxGlobalBytes: 33_554_432,
  }),
});

function bridgeFixture(): {
  readonly bridge: FuryKernelMemoryBridge;
  readonly forget: ReturnType<typeof vi.fn>;
  readonly purge: ReturnType<typeof vi.fn>;
} {
  const forget = vi.fn(async (input: { key: string; scopeKind: 'user' | 'project' }) => ({
    format: 'furypipe-kernel-memory-bridge/v1' as const,
    operation: 'forget' as const,
    status: 'completed' as const,
    memoryId: 'cm-memory-id',
    keyDigest: 'digest',
    scopeKind: input.scopeKind,
    hard: false,
    deletedRevisions: 1,
    deletedPayloads: 0,
    authority: 'memory-governance' as const,
    executionAuthority: false as const,
  }));
  const purge = vi.fn(async (input: { key: string; scopeKind: 'user' | 'project' }) => ({
    format: 'furypipe-kernel-memory-bridge/v1' as const,
    operation: 'purge' as const,
    status: 'completed' as const,
    memoryId: 'cm-memory-id',
    keyDigest: 'digest',
    scopeKind: input.scopeKind,
    hard: true,
    deletedRevisions: 3,
    deletedPayloads: 2,
    authority: 'memory-governance' as const,
    executionAuthority: false as const,
  }));
  return {
    bridge: {
      forget: forget as unknown as FuryKernelMemoryBridge['forget'],
      purge: purge as unknown as FuryKernelMemoryBridge['purge'],
      activeOperationCount: () => 0,
    },
    forget,
    purge,
  };
}

describe('Gateway governed memory adapter', () => {
  it('returns only the redacted local memory status on the state-only path', () => {
    const { bridge } = bridgeFixture();
    const adapter = createFuryGatewayMemoryAdapter({ bridge, config });

    const result = adapter.dispatchState('memory.status', {});

    expect(result).toEqual({
      format: 'furypipe-gateway-memory-result/v1',
      commandName: 'memory.status',
      status: 'ok',
      result: config,
      authority: 'memory-governance',
      executionAuthority: false,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('recovery');
    expect(serialized).not.toContain('activeKeyId');
    expect(serialized).not.toContain('scopeId');
  });

  it('rejects state input with extra browser-controlled fields', () => {
    const { bridge } = bridgeFixture();
    const adapter = createFuryGatewayMemoryAdapter({ bridge, config });

    expect(adapter.dispatchState('memory.status', {
      includeRawScopes: true,
    })).toMatchObject({
      status: 'rejected',
      error: { code: 'memory-input-invalid' },
      executionAuthority: false,
    });
  });

  it('dispatches soft forget and hard purge through distinct bridge methods', async () => {
    const { bridge, forget, purge } = bridgeFixture();
    const adapter = createFuryGatewayMemoryAdapter({ bridge, config });

    const soft = await adapter.dispatchExecution('memory.forget', {
      key: 'user.preference.theme',
      scopeKind: 'user',
    });
    expect(forget).toHaveBeenCalledTimes(1);
    expect(purge).not.toHaveBeenCalled();
    expect(soft).toMatchObject({
      status: 'ok',
      result: {
        operation: 'forget',
        hard: false,
        deletedRevisions: 1,
      },
      executionAuthority: false,
    });

    const hard = await adapter.dispatchExecution('memory.purge', {
      key: 'project.architecture.choice',
      scopeKind: 'project',
    });
    expect(purge).toHaveBeenCalledTimes(1);
    expect(hard).toMatchObject({
      status: 'ok',
      result: {
        operation: 'purge',
        hard: true,
        deletedRevisions: 3,
        deletedPayloads: 2,
      },
      executionAuthority: false,
    });
  });

  it('fails closed on malformed keys, scopes and unknown fields before the bridge', async () => {
    const { bridge, forget } = bridgeFixture();
    const adapter = createFuryGatewayMemoryAdapter({ bridge, config });

    for (const input of [
      { key: '', scopeKind: 'user' },
      { key: 'valid', scopeKind: 'other' },
      { key: 'valid', scopeKind: 'user', hard: true },
      { scopeKind: 'user' },
    ]) {
      await expect(adapter.dispatchExecution(
        'memory.forget',
        input,
      )).resolves.toMatchObject({
        status: 'rejected',
        error: { code: 'memory-input-invalid' },
      });
    }
    expect(forget).not.toHaveBeenCalled();
  });

  it('normalizes bridge failures without returning backend error details', async () => {
    const backendSecret = 'RECOVERY_PRIVATE_PATH_AND_KEY_DETAIL';
    const bridge: FuryKernelMemoryBridge = {
      async forget() {
        throw new Error(backendSecret);
      },
      async purge() {
        throw new Error('memory scope is not configured');
      },
      activeOperationCount: () => 0,
    };
    const adapter = createFuryGatewayMemoryAdapter({ bridge, config });

    const failed = await adapter.dispatchExecution('memory.forget', {
      key: 'user.preference.theme',
      scopeKind: 'user',
    });
    expect(failed).toMatchObject({
      status: 'rejected',
      error: { code: 'memory-operation-rejected' },
    });
    expect(JSON.stringify(failed)).not.toContain(backendSecret);

    await expect(adapter.dispatchExecution('memory.purge', {
      key: 'project.choice',
      scopeKind: 'project',
    })).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'memory-scope-not-configured' },
    });
  });
});
