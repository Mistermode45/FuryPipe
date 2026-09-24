import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FURY_BETA_CONFIG_FORMAT,
  FURY_BETA_CONFIG_MIGRATION_ID,
  inspectBetaConfigFile,
  migrateBetaConfigFile,
  rollbackBetaConfigFile,
  setBetaConfigMode,
} from '../src/beta-config.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function configFile(initial?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-beta-config-'));
  tempRoots.push(root);
  const file = path.join(root, 'config.json');
  if (initial !== undefined) fs.writeFileSync(file, initial, { mode: 0o600 });
  return file;
}

describe('Phase 10 beta configuration governance', () => {
  it('distinguishes missing and legacy config without claiming migration', () => {
    const missing = inspectBetaConfigFile(configFile());
    expect(missing).toMatchObject({ status: 'missing', schemaVersion: null, rollback: 'not-required' });

    const legacy = inspectBetaConfigFile(configFile(JSON.stringify({
      models: ['claude-fable-5'],
      secretReference: 'must-not-be-rendered',
    })));
    expect(legacy).toMatchObject({
      format: FURY_BETA_CONFIG_FORMAT,
      status: 'legacy',
      schemaVersion: null,
      rollback: 'not-required',
    });
    expect(JSON.stringify(legacy)).not.toContain('must-not-be-rendered');
  });

  it('rejects malformed and future beta markers fail-closed', () => {
    expect(inspectBetaConfigFile(configFile(JSON.stringify({ beta: { schemaVersion: 1 } })))).toMatchObject({
      status: 'invalid',
      reasonCodes: ['beta-marker-invalid'],
    });
    expect(inspectBetaConfigFile(configFile(JSON.stringify({ beta: {
      format: FURY_BETA_CONFIG_FORMAT,
      schemaVersion: 2,
      mode: 'legacy',
      migrationId: FURY_BETA_CONFIG_MIGRATION_ID,
    } })))).toMatchObject({
      status: 'unsupported',
      reasonCodes: ['beta-schema-unsupported'],
    });
  });

  it('migrates explicitly, preserves unrelated values, and is idempotent', () => {
    const file = configFile(JSON.stringify({
      models: ['claude-fable-5'],
      custom: { keep: true },
      secretReference: 'must-remain-on-disk-only',
    }));

    const first = migrateBetaConfigFile(file);
    expect(first).toMatchObject({ status: 'migrated', migrationId: FURY_BETA_CONFIG_MIGRATION_ID });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
    expect(parsed.models).toEqual(['claude-fable-5']);
    expect(parsed.custom).toEqual({ keep: true });
    expect(parsed.secretReference).toBe('must-remain-on-disk-only');
    expect(parsed.beta).toEqual({
      format: FURY_BETA_CONFIG_FORMAT,
      schemaVersion: 1,
      mode: 'legacy',
      migrationId: FURY_BETA_CONFIG_MIGRATION_ID,
    });
    expect(inspectBetaConfigFile(file)).toMatchObject({ status: 'current', rollback: 'available' });

    const second = migrateBetaConfigFile(file);
    expect(second.status).toBe('already-current');
    expect(second.digestSha256).toBe(first.digestSha256);
    expect(fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('rolls back only its own marker and preserves user data', () => {
    const file = configFile(JSON.stringify({ custom: 42 }));
    migrateBetaConfigFile(file);

    const result = rollbackBetaConfigFile(file);
    expect(result.status).toBe('rolled-back');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ custom: 42 });
    expect(rollbackBetaConfigFile(file).status).toBe('already-rolled-back');
  });

  it('changes beta mode only through an explicit, idempotent mutation', () => {
    const file = configFile(JSON.stringify({ models: ['keep-me'], custom: true }));

    const optIn = setBetaConfigMode(file, 'recommended');
    expect(optIn).toMatchObject({ status: 'mode-updated', mode: 'recommended' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      models: ['keep-me'],
      custom: true,
      beta: {
        mode: 'recommended',
        migrationId: FURY_BETA_CONFIG_MIGRATION_ID,
      },
    });
    expect(setBetaConfigMode(file, 'recommended')).toMatchObject({ status: 'already-mode' });

    const optedOut = setBetaConfigMode(file, 'opted-out');
    expect(optedOut).toMatchObject({ status: 'mode-updated', mode: 'opted-out' });
    expect(inspectBetaConfigFile(file)).toMatchObject({ status: 'current', mode: 'opted-out' });
  });

  it('refuses rollback after the marker has been changed', () => {
    const file = configFile(JSON.stringify({ custom: 42 }));
    migrateBetaConfigFile(file);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
    parsed.beta.mode = 'opted-out';
    fs.writeFileSync(file, JSON.stringify(parsed));

    expect(() => rollbackBetaConfigFile(file)).toThrow(/reconciliation-required/u);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(parsed);
  });

  it('bounds file reads and never treats oversized content as current', () => {
    const file = configFile('{"custom":"' + 'x'.repeat(1024 * 1024) + '"}');
    expect(inspectBetaConfigFile(file)).toMatchObject({ status: 'invalid', reasonCodes: ['config-too-large'] });
  });
});
