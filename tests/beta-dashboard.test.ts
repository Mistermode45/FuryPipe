import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { inspectBetaConfigValue } from '../src/beta-config.js';
import { createFuryBetaControlPlaneSnapshot } from '../src/beta-control-plane.js';
import { collectFuryBetaOnboarding } from '../src/beta-onboarding.js';
import { DashboardState, dashboardPath } from '../src/dashboard.js';
import { collectFuryBetaReadiness } from '../src/beta-readiness-runtime.js';
import type { SessionsPaths } from '../src/sessions.js';

function paths(): SessionsPaths {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'furypipe-beta-dashboard-'));
  return { eventsFile: path.join(root, 'events.jsonl'), sidecarDir: path.join(root, '4xx-bodies') };
}

function snapshot() {
  const readiness = collectFuryBetaReadiness({
    configText: JSON.stringify({ models: ['keep'] }),
    configFile: 'beta-dashboard.json',
    observedAt: 2_000,
    nodeVersion: '26.8.2',
    gatewayRunning: true,
    env: {},
  }).snapshot;
  return createFuryBetaControlPlaneSnapshot({
    generatedAt: 2_000,
    config: inspectBetaConfigValue({ models: ['keep'] }, 'beta-dashboard.json'),
    readiness,
    onboarding: collectFuryBetaOnboarding({ observedAt: 2_000, readiness }),
  });
}

describe('Phase 10 beta dashboard surface', () => {
  it('exposes the same bounded observation through JSON and HTML', async () => {
    const provider = () => snapshot();
    const dashboard = new DashboardState(paths(), async () => new Map(), undefined, undefined, undefined, provider);

    expect(dashboardPath('/api/beta.json')).toEqual({ kind: 'api-beta' });
    const response = await dashboard.serveBetaJson();
    expect(response.status).toBe(200);
    const body = await response.json() as { format: string; authority: string; mutationAuthority: boolean };
    expect(body).toMatchObject({
      format: 'furypipe-beta-control-plane/v1',
      authority: 'dashboard-observation-only',
      mutationAuthority: false,
    });

    const html = await (await dashboard.serveFragment(
      'beta',
      new URL('http://localhost/fragments/beta?locale=fr'),
      48_721,
    )).text();
    expect(html).toContain('Entrée effective');
    expect(html).toContain('observation uniquement');
    expect(html).toContain('not-observed');
  });

  it('returns a visible unavailable state when the host did not inject evidence', async () => {
    const dashboard = new DashboardState(paths(), async () => new Map());
    const response = await dashboard.serveBetaJson();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'NOT_AVAILABLE' });
    const html = await (await dashboard.serveFragment(
      'beta',
      new URL('http://localhost/fragments/beta'),
      48_721,
    )).text();
    expect(html).toContain('Beta projection unavailable');
  });
});
