import { describe, expect, it, vi } from 'vitest';

import type {
  ContinuousMemoryAfterTurnInput,
  ContinuousMemoryAfterTurnResult,
  ContinuousMemoryBeforeTurnInput,
  ContinuousMemoryBeforeTurnResult,
  ContinuousMemoryEngine,
  ContinuousMemoryForgetInput,
  ContinuousMemoryForgetResult,
} from '../src/continuous-memory.js';
import {
  createFuryKernelMemoryBridge,
} from '../src/fury-kernel-memory-bridge-node.js';

function recallResult(): ContinuousMemoryBeforeTurnResult {
  return {
    format: 'furypipe-continuous-memory-context/v1',
    conversationDigest: 'conversation-digest',
    turnDigest: 'turn-digest',
    entries: [],
    contextBlock: '',
    queryTermCount: 0,
    truncated: false,
  };
}

function learningResult(): ContinuousMemoryAfterTurnResult {
  return {
    format: 'furypipe-continuous-memory-learning/v1',
    conversationDigest: 'conversation-digest',
    turnDigest: 'turn-digest',
    candidates: 0,
    added: 0,
    updated: 0,
    deleted: 0,
    noops: 0,
    skipped: 0,
    receipts: [],
  };
}

function engineWith(
  forget: (input: ContinuousMemoryForgetInput) => Promise<ContinuousMemoryForgetResult>,
): ContinuousMemoryEngine {
  return {
    beforeTurn: async (_input: ContinuousMemoryBeforeTurnInput) => recallResult(),
    afterTurn: async (_input: ContinuousMemoryAfterTurnInput) => learningResult(),
    forget,
    longTermMemory: {} as ContinuousMemoryEngine['longTermMemory'],
  };
}

describe('Fury Kernel governed memory bridge', () => {
  it('turns a soft forget command into one exact process-local mutation without exposing raw key/scope data', async () => {
    const rawScope = 'PRIVATE_USER_SCOPE_CANARY';
    const rawKey = 'user.preference.private-canary';
    const forget = vi.fn(async (input: ContinuousMemoryForgetInput) => {
      expect(input).toMatchObject({
        key: rawKey,
        scopeKind: 'user',
        scopes: { user: rawScope },
        hard: false,
      });
      return {
        memoryId: 'cm-memory-id',
        keyDigest: 'key-digest',
        scopeKind: 'user' as const,
        hard: false,
        deletedRevisions: 1,
        deletedPayloads: 0,
      };
    });
    const bridge = createFuryKernelMemoryBridge({
      engine: engineWith(forget),
      scopes: { user: rawScope },
      now: () => 1_000,
    });

    const result = await bridge.forget({
      key: rawKey,
      scopeKind: 'user',
    });

    expect(forget).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      format: 'furypipe-kernel-memory-bridge/v1',
      operation: 'forget',
      status: 'completed',
      memoryId: 'cm-memory-id',
      keyDigest: 'key-digest',
      scopeKind: 'user',
      hard: false,
      deletedRevisions: 1,
      deletedPayloads: 0,
      authority: 'memory-governance',
      executionAuthority: false,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(rawKey);
    expect(serialized).not.toContain(rawScope);
    expect(bridge.activeOperationCount()).toBe(0);
  });

  it('keeps hard purge distinct from soft forget', async () => {
    const forget = vi.fn(async (input: ContinuousMemoryForgetInput) => ({
      memoryId: 'cm-memory-id',
      keyDigest: 'key-digest',
      scopeKind: input.scopeKind,
      hard: input.hard === true,
      deletedRevisions: 4,
      deletedPayloads: input.hard === true ? 2 : 0,
    }));
    const bridge = createFuryKernelMemoryBridge({
      engine: engineWith(forget),
      scopes: { project: 'private-project' },
      now: () => 2_000,
    });

    const result = await bridge.purge({
      key: 'project.architecture.choice',
      scopeKind: 'project',
    });

    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget.mock.calls[0]?.[0]).toMatchObject({
      hard: true,
      scopeKind: 'project',
    });
    expect(result).toMatchObject({
      operation: 'purge',
      hard: true,
      deletedRevisions: 4,
      deletedPayloads: 2,
      executionAuthority: false,
    });
  });

  it('rejects unknown scopes and malformed inputs before calling Continuous Memory', async () => {
    const forget = vi.fn(async (_input: ContinuousMemoryForgetInput) => ({
      memoryId: 'never',
      keyDigest: 'never',
      scopeKind: 'user' as const,
      hard: false,
      deletedRevisions: 0,
      deletedPayloads: 0,
    }));
    const bridge = createFuryKernelMemoryBridge({
      engine: engineWith(forget),
      scopes: { user: 'user-scope' },
      now: () => 3_000,
    });

    await expect(bridge.forget({
      key: 'project.key',
      scopeKind: 'project',
    })).rejects.toThrow(/scope is not configured/u);

    await expect(bridge.forget({
      key: '',
      scopeKind: 'user',
    })).rejects.toThrow(/memory key/u);

    await expect(bridge.forget({
      key: 'user.key',
      scopeKind: 'user',
      extra: true,
    } as never)).rejects.toThrow(/unsupported fields/u);

    expect(forget).not.toHaveBeenCalled();
  });

  it('consumes the exact permit before mutation and fails closed if it expires', async () => {
    const forget = vi.fn(async (_input: ContinuousMemoryForgetInput) => ({
      memoryId: 'never',
      keyDigest: 'never',
      scopeKind: 'user' as const,
      hard: false,
      deletedRevisions: 0,
      deletedPayloads: 0,
    }));
    const times = [0, 100, 111];
    let cursor = 0;
    const bridge = createFuryKernelMemoryBridge({
      engine: engineWith(forget),
      scopes: { user: 'user-scope' },
      now: () => times[Math.min(cursor++, times.length - 1)]!,
      permitTtlMs: 10,
    });

    await expect(bridge.forget({
      key: 'user.preference.theme',
      scopeKind: 'user',
    })).rejects.toThrow(/permit expired/u);
    expect(forget).not.toHaveBeenCalled();
    expect(bridge.activeOperationCount()).toBe(0);
  });

  it('does not automatically retry a failed durable memory mutation', async () => {
    const forget = vi.fn(async () => {
      throw new Error('RECOVERY_SECRET_DETAIL');
    });
    const bridge = createFuryKernelMemoryBridge({
      engine: engineWith(forget),
      scopes: { user: 'user-scope' },
      now: () => 4_000,
    });

    await expect(bridge.forget({
      key: 'user.preference.theme',
      scopeKind: 'user',
    })).rejects.toThrow(/RECOVERY_SECRET_DETAIL/u);
    expect(forget).toHaveBeenCalledTimes(1);
    expect(bridge.activeOperationCount()).toBe(0);
  });

  it('applies bounded concurrency before creating another memory mutation permit', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const forget = vi.fn(async (input: ContinuousMemoryForgetInput) => {
      await pending;
      return {
        memoryId: 'cm-memory-id',
        keyDigest: 'key-digest',
        scopeKind: input.scopeKind,
        hard: input.hard === true,
        deletedRevisions: 1,
        deletedPayloads: 0,
      };
    });
    const bridge = createFuryKernelMemoryBridge({
      engine: engineWith(forget),
      scopes: { user: 'user-scope' },
      now: () => 5_000,
      maxConcurrentOperations: 1,
    });

    const first = bridge.forget({
      key: 'user.preference.one',
      scopeKind: 'user',
    });
    expect(bridge.activeOperationCount()).toBe(1);

    await expect(bridge.forget({
      key: 'user.preference.two',
      scopeKind: 'user',
    })).rejects.toThrow(/concurrency limit/u);
    expect(forget).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toMatchObject({
      operation: 'forget',
      status: 'completed',
    });
    expect(bridge.activeOperationCount()).toBe(0);
  });
});
