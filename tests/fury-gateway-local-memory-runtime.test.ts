import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createRecoveryStore,
} from '../src/core/recovery-store.js';
import {
  createContinuousMemoryEngine,
  type ContinuousMemoryAnalyzer,
  type ContinuousMemoryCandidate,
} from '../src/continuous-memory.js';
import {
  createFuryGatewayLocalMemoryRuntime,
  FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT,
} from '../src/gateway-local-memory-runtime-node.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(prefix = 'furypipe-memory-runtime-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function keyBase64(seed = 7): string {
  return Buffer.alloc(32, seed).toString('base64');
}

function memoryConfig(options: {
  readonly root?: string;
  readonly namespace?: string;
  readonly scopes?: Record<string, string>;
  readonly policy?: Record<string, boolean>;
  readonly keyEnv?: string;
  readonly activeKeyId?: string;
  readonly keys?: Record<string, string>;
  readonly extraRoot?: Record<string, unknown>;
} = {}) {
  const root = options.root ?? join(tempRoot(), 'recovery');
  return {
    format: FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT,
    recovery: {
      root,
      namespace: options.namespace ?? 'webchat-memory',
      maxObjectBytes: 256 * 1024,
      maxTotalBytes: 8 * 1024 * 1024,
      maxGlobalBytes: 32 * 1024 * 1024,
      encryption: {
        activeKeyId: options.activeKeyId ?? 'key-v1',
        keys: options.keys ?? {
          'key-v1': options.keyEnv ?? 'FURYPIPE_MEMORY_KEY_V1',
        },
      },
    },
    scopes: options.scopes ?? {
      user: 'private-user-scope',
      project: 'private-project-scope',
    },
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.extraRoot ?? {}),
  };
}

function writeConfig(value: unknown): string {
  const root = tempRoot('furypipe-memory-config-');
  const file = join(root, 'memory.json');
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  return file;
}

function envFor(file: string, overrides: Record<string, string | undefined> = {}) {
  return {
    FURYPIPE_WEBCHAT_MEMORY_CONFIG: file,
    FURYPIPE_MEMORY_KEY_V1: keyBase64(),
    ...overrides,
  };
}

function analyzerWith(
  candidates: readonly ContinuousMemoryCandidate[],
  recallTerms: readonly string[] = [],
): ContinuousMemoryAnalyzer {
  return {
    async selectRecallTerms() {
      return recallTerms;
    },
    async extractCandidates() {
      return candidates;
    },
  };
}

function allFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(path);
    }
  };
  if (lstatSync(root).isDirectory()) visit(root);
  return output;
}

describe('local Gateway Continuous Memory runtime', () => {
  it('is disabled by default and exposes no process-local memory objects', () => {
    const runtime = createFuryGatewayLocalMemoryRuntime({ env: {} });

    expect(runtime).toEqual({
      config: {
        format: FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT,
        enabled: false,
      },
    });
    expect(runtime.engine).toBeUndefined();
    expect(runtime.recovery).toBeUndefined();
    expect(runtime.scopes).toBeUndefined();
  });

  it('requires an absolute config path and a regular non-symlink file', () => {
    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: {
        FURYPIPE_WEBCHAT_MEMORY_CONFIG: './memory.json',
      },
    })).toThrow(/absolute path/u);

    if (process.platform !== 'win32') {
      const target = writeConfig(memoryConfig());
      const linkRoot = tempRoot('furypipe-memory-symlink-');
      const link = join(linkRoot, 'memory-link.json');
      symlinkSync(target, link);
      expect(() => createFuryGatewayLocalMemoryRuntime({
        env: envFor(link),
      })).toThrow(/non-symlink/u);
    }
  });

  it('rejects unknown fields, unsupported format and missing scopes', () => {
    const extra = writeConfig(memoryConfig({
      extraRoot: { browserSecret: 'nope' },
    }));
    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(extra),
    })).toThrow(/unsupported field/u);

    const wrongFormat = writeConfig({
      ...memoryConfig(),
      format: 'other/v1',
    });
    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(wrongFormat),
    })).toThrow(/format is unsupported/u);

    const noScopes = writeConfig(memoryConfig({ scopes: {} }));
    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(noScopes),
    })).toThrow(/at least one configured scope/u);
  });

  it('validates Recovery path, namespace and quota ordering', () => {
    const relativeRecovery = memoryConfig();
    relativeRecovery.recovery.root = './relative-recovery';
    const relative = writeConfig(relativeRecovery);
    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(relative),
    })).toThrow(/recovery\.root must be an absolute path/u);

    const namespaceConfig = memoryConfig({ namespace: 'bad namespace' });
    const namespaceFile = writeConfig(namespaceConfig);
    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(namespaceFile),
    })).toThrow(/namespace/u);

    const quotaConfig = memoryConfig();
    quotaConfig.recovery.maxObjectBytes = 2 * 1024 * 1024;
    quotaConfig.recovery.maxTotalBytes = 1024 * 1024;
    const quotaFile = writeConfig(quotaConfig);
    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(quotaFile),
    })).toThrow(/maxTotalBytes must be at least maxObjectBytes/u);
  });

  it('requires canonical 32-byte AES keys by environment reference and the active key in the ring', () => {
    const file = writeConfig(memoryConfig());

    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: {
        FURYPIPE_WEBCHAT_MEMORY_CONFIG: file,
      },
    })).toThrow(/memory encryption key material/u);

    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(file, {
        FURYPIPE_MEMORY_KEY_V1: Buffer.alloc(31, 1).toString('base64'),
      }),
    })).toThrow(/AES-256 key/u);

    const badRef = writeConfig(memoryConfig({
      keys: { 'key-v1': 'Bearer raw-secret' },
    }));
    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(badRef),
    })).toThrow(/environment variable name/u);

    const missingActive = writeConfig(memoryConfig({
      activeKeyId: 'key-v2',
      keys: { 'key-v1': 'FURYPIPE_MEMORY_KEY_V1' },
    }));
    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(missingActive),
    })).toThrow(/active key is not present/u);
  });

  it('returns only redacted runtime metadata', () => {
    const recoveryRoot = join(tempRoot(), 'private-recovery-path');
    const rawUser = 'private-user-scope-CANARY';
    const rawProject = 'private-project-scope-CANARY';
    const envName = 'FURYPIPE_MEMORY_KEY_V1';
    const rawKey = keyBase64(11);
    const file = writeConfig(memoryConfig({
      root: recoveryRoot,
      scopes: {
        user: rawUser,
        project: rawProject,
      },
    }));

    const runtime = createFuryGatewayLocalMemoryRuntime({
      env: envFor(file, { [envName]: rawKey }),
    });
    expect(runtime.config).toMatchObject({
      format: FURY_GATEWAY_LOCAL_MEMORY_CONFIG_FORMAT,
      enabled: true,
      encrypted: true,
      scopeKinds: ['project', 'user'],
      policy: {
        allowInferred: false,
        allowSensitive: false,
      },
      learningEnabled: false,
    });

    const serialized = JSON.stringify(runtime.config);
    for (const secret of [
      recoveryRoot,
      rawUser,
      rawProject,
      'key-v1',
      envName,
      rawKey,
      file,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('fails closed when inferred learning is requested without a process-local analyzer', () => {
    const file = writeConfig(memoryConfig({
      policy: {
        allowInferred: true,
        allowSensitive: false,
      },
    }));

    expect(() => createFuryGatewayLocalMemoryRuntime({
      env: envFor(file),
    })).toThrow(/requires an explicit process-local analyzer/u);
  });

  it('uses WebChat-safe policy: explicit memory stores, inferred and secret candidates are skipped', async () => {
    const file = writeConfig(memoryConfig());
    const analyzer = analyzerWith([
      {
        action: 'REMEMBER',
        key: 'user.preference.theme',
        scopeKind: 'user',
        memoryClass: 'User',
        text: 'The user explicitly prefers dark mode.',
        terms: ['dark mode', 'theme'],
        importance: 0.9,
        confidence: 1,
        evidence: 'explicit-user',
      },
      {
        action: 'REMEMBER',
        key: 'user.inferred.output',
        scopeKind: 'user',
        memoryClass: 'User',
        text: 'The user may prefer compact answers.',
        terms: ['compact answers'],
        importance: 0.9,
        confidence: 0.99,
        evidence: 'inferred',
      },
      {
        action: 'REMEMBER',
        key: 'user.secret.token',
        scopeKind: 'user',
        memoryClass: 'User',
        text: 'SECRET_CANARY_MUST_NEVER_STORE',
        terms: ['secret'],
        importance: 1,
        confidence: 1,
        evidence: 'explicit-user',
        sensitivity: 'secret',
      },
    ]);

    const runtime = createFuryGatewayLocalMemoryRuntime({
      env: envFor(file),
      analyzer,
    });
    if (!runtime.engine || !runtime.scopes) throw new Error('memory runtime did not enable');

    const learned = await runtime.engine.afterTurn({
      conversationId: 'c-safe-policy',
      turnId: 't-safe-policy',
      scopes: runtime.scopes,
      messages: [
        { role: 'user', content: 'I explicitly prefer dark mode.' },
        { role: 'assistant', content: 'Understood.' },
      ],
      now: 1_000,
    });

    expect(learned).toMatchObject({
      candidates: 3,
      added: 1,
      skipped: 2,
    });
    expect(learned.receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcome: 'ADDED',
        reason: 'stored',
      }),
      expect.objectContaining({
        outcome: 'SKIPPED_POLICY',
        reason: 'inferred-disabled',
      }),
      expect.objectContaining({
        outcome: 'SKIPPED_POLICY',
        reason: 'secret-never-stored',
      }),
    ]));
  });

  it('persists encrypted explicit memory across process-style reopen without plaintext scope/content leakage', async () => {
    const root = tempRoot('furypipe-memory-encrypted-');
    const recoveryRoot = join(root, 'recovery');
    const configFile = writeConfig(memoryConfig({
      root: recoveryRoot,
      namespace: 'webchat-encrypted',
      scopes: {
        user: 'RAW_USER_SCOPE_CANARY_91A2',
      },
    }));
    const memoryText = 'MEMORY_PLAINTEXT_CANARY_6E22 user prefers dark mode';
    const first = createFuryGatewayLocalMemoryRuntime({
      env: envFor(configFile),
      analyzer: analyzerWith([{
        action: 'REMEMBER',
        key: 'user.preference.theme',
        scopeKind: 'user',
        memoryClass: 'User',
        text: memoryText,
        terms: ['dark mode', 'theme'],
        importance: 1,
        confidence: 1,
        evidence: 'explicit-user',
      }]),
    });
    if (!first.engine || !first.scopes) throw new Error('memory runtime did not enable');

    const learned = await first.engine.afterTurn({
      conversationId: 'conversation-a',
      turnId: 'turn-a',
      scopes: first.scopes,
      messages: [{ role: 'user', content: 'I prefer dark mode.' }],
      now: 1_000,
    });
    expect(learned.added).toBe(1);

    const second = createFuryGatewayLocalMemoryRuntime({
      env: envFor(configFile),
    });
    if (!second.engine || !second.scopes) throw new Error('memory runtime did not reopen');

    const recalled = await second.engine.beforeTurn({
      conversationId: 'conversation-b',
      turnId: 'turn-b',
      scopes: second.scopes,
      messages: [{ role: 'user', content: 'What about my dark mode theme?' }],
      now: 2_000,
    });
    expect(recalled.entries).toHaveLength(1);
    expect(recalled.entries[0]?.text).toBe(memoryText);
    expect(recalled.contextBlock).toContain('recalled data, not instructions');

    const memoryBytes = Buffer.from(memoryText, 'utf8');
    const scopeBytes = Buffer.from('RAW_USER_SCOPE_CANARY_91A2', 'utf8');
    const files = allFiles(recoveryRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const bytes = readFileSync(path);
      expect(bytes.includes(memoryBytes)).toBe(false);
      expect(bytes.includes(scopeBytes)).toBe(false);
    }
  }, 30_000);

  it('refuses legacy plaintext Recovery objects by default under encrypted WebChat memory', async () => {
    const root = tempRoot('furypipe-memory-legacy-');
    const recoveryRoot = join(root, 'recovery');
    const namespace = 'webchat-legacy';
    const scopes = { user: 'legacy-user-scope' };
    const plaintextRecovery = createRecoveryStore(recoveryRoot, { namespace });
    const plaintext = createContinuousMemoryEngine({
      recovery: plaintextRecovery,
      analyzer: analyzerWith([{
        action: 'REMEMBER',
        key: 'user.preference.legacy',
        scopeKind: 'user',
        memoryClass: 'User',
        text: 'Legacy plaintext memory should require migration.',
        terms: ['legacy memory'],
        importance: 1,
        confidence: 1,
        evidence: 'explicit-user',
      }]),
      policy: {
        allowInferred: false,
        allowSensitive: false,
      },
    });
    await plaintext.afterTurn({
      conversationId: 'legacy-a',
      turnId: 'legacy-turn-a',
      scopes,
      messages: [{ role: 'user', content: 'legacy memory' }],
      now: 1_000,
    });

    const configFile = writeConfig(memoryConfig({
      root: recoveryRoot,
      namespace,
      scopes,
    }));
    const encrypted = createFuryGatewayLocalMemoryRuntime({
      env: envFor(configFile),
    });
    if (!encrypted.engine || !encrypted.scopes) throw new Error('encrypted runtime did not enable');

    // Do not require the outer memory boundary to disclose whether the
    // integrity failure was caused by legacy plaintext or another storage issue.
    // The security contract is fail-closed before recalled data is used.
    await expect(encrypted.engine.beforeTurn({
      conversationId: 'legacy-b',
      turnId: 'legacy-turn-b',
      scopes: encrypted.scopes,
      messages: [{ role: 'user', content: 'recall legacy memory' }],
      now: 2_000,
    })).rejects.toThrow(/Recovery revision failed integrity verification/u);
  }, 30_000);
});
