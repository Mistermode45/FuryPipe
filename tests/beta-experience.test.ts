import { describe, expect, it } from 'vitest';

import { inspectBetaConfigValue } from '../src/beta-config.js';
import {
  createFuryBetaTaskPlan,
  resolveFuryBetaEntry,
} from '../src/beta-experience.js';

describe('Phase 10 beta task-first entry', () => {
  it('recommends task-first for a fresh install without writing or granting authority', () => {
    const observation = inspectBetaConfigValue(undefined, 'fresh-config.json');
    const entry = resolveFuryBetaEntry(observation);

    expect(entry).toMatchObject({
      mode: 'recommended',
      entryPath: 'task-first',
      configStatus: 'missing',
      optOutAvailable: true,
      legacyExpertPathAvailable: true,
      reversible: true,
      selectionAuthority: 'selection-only',
      executionAuthority: false,
      grantAuthority: false,
      installationAuthority: false,
    });
  });

  it('preserves legacy/expert entry for existing legacy and opted-out configs', () => {
    const legacy = resolveFuryBetaEntry(inspectBetaConfigValue({ models: ['keep'] }, 'legacy.json'));
    expect(legacy.entryPath).toBe('legacy-expert');
    expect(legacy.mode).toBe('legacy');

    const optedOutObservation = inspectBetaConfigValue({
      beta: {
        format: 'furypipe-beta-config/v1',
        schemaVersion: 1,
        mode: 'opted-out',
        migrationId: 'phase10-beta-config-v1',
      },
    }, 'opted-out.json');
    const optedOut = resolveFuryBetaEntry(optedOutObservation);
    expect(optedOut.entryPath).toBe('legacy-expert');
    expect(optedOut.mode).toBe('opted-out');
    expect(resolveFuryBetaEntry(optedOutObservation, 'task-first').entryPath).toBe('task-first');
  });

  it('supports explicit expert/task-first routing without changing durable configuration', () => {
    const observation = inspectBetaConfigValue({
      beta: {
        format: 'furypipe-beta-config/v1',
        schemaVersion: 1,
        mode: 'recommended',
        migrationId: 'phase10-beta-config-v1',
      },
    }, 'recommended.json');
    expect(resolveFuryBetaEntry(observation, 'expert').entryPath).toBe('legacy-expert');
    expect(resolveFuryBetaEntry(observation, 'task-first').entryPath).toBe('task-first');
    expect(observation.mode).toBe('recommended');
  });

  it('emits a bounded planning handoff and never claims selection or execution', () => {
    const plan = createFuryBetaTaskPlan(
      'Inspect the repository and explain the current recovery boundary.',
      inspectBetaConfigValue(undefined, 'fresh-config.json'),
    );
    expect(plan).toMatchObject({
      format: 'furypipe-beta-task-plan/v1',
      selection: 'not-run',
      execution: 'not-authorized',
      authority: 'planning-only',
      executionAuthority: false,
      selectedCapabilities: [],
    });
    expect(plan.entry.entryPath).toBe('task-first');
    expect(JSON.stringify(plan)).not.toContain('Inspect the repository');
  });

  it('fails closed for invalid configuration and unbounded objectives', () => {
    const invalid = resolveFuryBetaEntry(inspectBetaConfigValue({ beta: [] }, 'invalid.json'));
    expect(invalid).toMatchObject({ mode: 'blocked', entryPath: 'blocked', executionAuthority: false });
    expect(() => createFuryBetaTaskPlan(
      'x'.repeat(64_001),
      inspectBetaConfigValue(undefined, 'fresh-config.json'),
    )).toThrow(/bounded non-empty string/u);
  });
});
