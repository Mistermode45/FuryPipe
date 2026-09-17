import { describe, expect, it } from 'vitest';
import { createControlPlaneSnapshot } from '../src/control-plane.js';
import type { ControlRoomSnapshot } from '../src/control-room/index.js';
import { renderControlPlaneFragment } from '../src/dashboard/fragments.js';

const runtime = {
  port: 48721,
  uptimeSec: 12,
  requests: 3,
  compressedRequests: 2,
  passthroughRequests: 1,
  savedInputTokens: 99,
  savedUsd: 0.12,
  compressionEnabled: true,
  activeModels: ['claude-fable-5'],
  modelScopeMode: 'automatic',
} as const;

function snapshot(status: 'VERIFIED' | 'NOT_EXECUTED' = 'VERIFIED'): ControlRoomSnapshot {
  const section = { status, evidence: {}, warnings: [] };
  return {
    format: 'furypipe-control-room/v1',
    generatedAt: 123,
    sourceCommit: 'a'.repeat(40),
    overall: status === 'VERIFIED' ? 'HEALTHY' : 'PARTIAL',
    sections: {
      receipts: section,
      recovery: section,
      agent: section,
      learning: section,
      provider: section,
      mcp: section,
      i18n: section,
      webStudio: section,
      security: section,
      benchmarks: section,
      release: section,
    },
  } as unknown as ControlRoomSnapshot;
}

function snapshotWithOverall(overall: 'BLOCKED' | 'DEGRADED'): ControlRoomSnapshot {
  return { ...snapshot(), overall };
}

describe('Control Plane V2 snapshot', () => {
  it('keeps unwired capability domains explicit instead of promoting them to green', () => {
    const value = createControlPlaneSnapshot({ generatedAt: 1, runtime, controlRoom: null });
    expect(value.sourceCommit).toBeNull();
    expect(value.domains.find((domain) => domain.id === 'skills')).toMatchObject({
      status: 'NOT_AVAILABLE',
      lifecycle: ['UNKNOWN'],
    });
    expect(value.evidence[0]).toMatchObject({ status: 'NOT_AVAILABLE', sourceSha: null, evidenceSha: null });
  });

  it('projects exact-source Control Room evidence without inventing an action run id', () => {
    const value = createControlPlaneSnapshot({ generatedAt: 1, runtime, controlRoom: snapshot() });
    expect(value.sourceCommit).toBe('a'.repeat(40));
    expect(value.domains.find((domain) => domain.id === 'security')).toMatchObject({
      status: 'VERIFIED',
      lifecycle: ['AVAILABLE', 'EXECUTABLE', 'EXECUTED', 'VERIFIED'],
    });
    expect(value.evidence[0]).toMatchObject({
      sourceSha: 'a'.repeat(40),
      evidenceSha: 'a'.repeat(40),
      runId: null,
    });
  });

  it('does not call a non-executed Control Room section verified', () => {
    const value = createControlPlaneSnapshot({ generatedAt: 1, runtime, controlRoom: snapshot('NOT_EXECUTED') });
    expect(value.domains.find((domain) => domain.id === 'mcp')).toMatchObject({
      status: 'NOT_EXECUTED',
      lifecycle: ['UNKNOWN'],
    });
  });

  it('marks evidence from another source SHA stale instead of preserving a verified claim', () => {
    const value = createControlPlaneSnapshot({
      generatedAt: 1,
      runtime,
      controlRoom: snapshot(),
      evidence: [{
        id: 'codeql',
        status: 'VERIFIED',
        sourceSha: 'a'.repeat(40),
        evidenceSha: 'b'.repeat(40),
        runId: 42,
        generatedAt: 2,
      }],
    });
    expect(value.evidence).toEqual([expect.objectContaining({
      id: 'codeql',
      status: 'STALE',
      sourceSha: 'a'.repeat(40),
      evidenceSha: 'b'.repeat(40),
      runId: 42,
    })]);
  });

  it('marks a source SHA mismatch stale even when the evidence SHA matches', () => {
    const value = createControlPlaneSnapshot({
      generatedAt: 1,
      runtime,
      controlRoom: snapshot(),
      evidence: [{
        id: 'codeql',
        status: 'VERIFIED',
        sourceSha: 'b'.repeat(40),
        evidenceSha: 'a'.repeat(40),
        runId: 42,
        generatedAt: 2,
      }],
    });
    expect(value.evidence[0]?.status).toBe('STALE');
  });

  it('does not call positive evidence source-bound when no source commit exists', () => {
    const value = createControlPlaneSnapshot({
      generatedAt: 1,
      runtime,
      controlRoom: null,
      evidence: [{
        id: 'codeql',
        status: 'VERIFIED',
        sourceSha: 'a'.repeat(40),
        evidenceSha: 'a'.repeat(40),
        runId: 42,
        generatedAt: 2,
      }],
    });
    expect(value.evidence[0]?.status).toBe('STALE');
  });

  it('preserves a blocked Control Room as a failed top-level evidence state', () => {
    const value = createControlPlaneSnapshot({ generatedAt: 1, runtime, controlRoom: snapshotWithOverall('BLOCKED') });
    expect(value.domains.find((domain) => domain.id === 'evidence')).toMatchObject({ status: 'FAILED' });
    expect(value.evidence[0]).toMatchObject({ status: 'FAILED' });
  });

  it('bounds invalid runtime payloads', () => {
    expect(() => createControlPlaneSnapshot({
      generatedAt: 1,
      runtime: { ...runtime, activeModels: Array.from({ length: 65 }, () => 'model') },
      controlRoom: null,
    })).toThrow('activeModels exceeds 64');
  });

  it('validates the effective model scope mode instead of serializing an unknown state', () => {
    expect(() => createControlPlaneSnapshot({
      generatedAt: 1,
      runtime: { ...runtime, modelScopeMode: 'future' as never },
      controlRoom: null,
    })).toThrow('runtime.modelScopeMode is invalid');
  });

  it('escapes hostile observations in the rendered Control Plane', () => {
    const value = createControlPlaneSnapshot({
      generatedAt: 1,
      runtime: { ...runtime, activeModels: ['<img src=x onerror=alert(1)>'] },
      controlRoom: null,
    });
    const html = renderControlPlaneFragment(value, 'en');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('renders source-bound topology and an inert metadata inspector instead of status cards', () => {
    const value = createControlPlaneSnapshot({ generatedAt: 1, runtime, controlRoom: null });
    const html = renderControlPlaneFragment(value, 'en');
    expect(html).toContain('Fury Graph — observed source bindings');
    expect(html).toContain('data-cp-row');
    expect(html).toContain('data-cp-inspector');
    expect(html).toContain('data-cp-inspector-json');
    expect(html).not.toContain('cp-card');
    expect(html).toContain('control-room-unavailable');
    expect(renderControlPlaneFragment(value, 'fr')).toContain('Panneau d’instrumentation Fury');
  });

  it('splits the shell surfaces without widening the observation contract', () => {
    const value = createControlPlaneSnapshot({ generatedAt: 1, runtime, controlRoom: null });
    const overview = renderControlPlaneFragment(value, 'en', 'overview');
    const capabilities = renderControlPlaneFragment(value, 'en', 'capabilities');
    const evidence = renderControlPlaneFragment(value, 'en', 'evidence');

    expect(overview).toContain('cp-runtime-lane');
    expect(overview).not.toContain('data-cp-row');
    expect(capabilities).toContain('data-cp-root');
    expect(capabilities).toContain('data-cp-inspector');
    expect(evidence).toContain('Source SHA');
    expect(evidence).not.toContain('data-cp-row');
  });
});
