import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  selectFuryCapabilitiesForTask,
} from '../src/capability-autopilot.js';
import {
  projectHarnessesIntoCapabilityIndex,
  projectMcpHubIntoCapabilityIndex,
  projectMcpIntoCapabilityIndex,
  projectModelsIntoCapabilityIndex,
  projectProvidersIntoCapabilityIndex,
  projectPluginsIntoCapabilityIndex,
  projectSkillHubIntoCapabilityIndex,
  projectSkillsIntoCapabilityIndex,
  revalidateFuryCapabilitySelection,
} from '../src/capability-index-adapters.js';
import {
  createFuryCapabilityIndex,
  FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
} from '../src/capability-index.js';
import {
  normalizeOpenAIModelsPayload,
  createModelFabricRegistry,
} from '../src/core/model-fabric.js';
import { createProviderRegistry } from '../src/core/provider-fabric.js';
import type {
  FuryKernelToolBridge,
  FuryKernelToolSourceInspection,
} from '../src/fury-kernel-tool-bridge-node.js';
import {
  CONTEXT7_PLUGIN_BUNDLE,
  createFuryPluginBundleRegistry,
} from '../src/plugin-bundles.js';
import {
  createAgentSkillRegistry,
} from '../src/skill-registry.js';
import { createFurySkillHub } from '../src/fury-skill-hub.js';
import { createFuryMcpHub } from '../src/fury-mcp-hub.js';

describe('Capability Autopilot source-of-truth adapters', () => {
  it('projects skill inspection metadata without executing or health-checking the skill', () => {
    const execute = vi.fn(async () => ({
      evidence: ['never-called'],
      consumedTokens: 1,
    }));
    const health = vi.fn(async () => ({ status: 'healthy' as const }));
    const registry = createAgentSkillRegistry();
    registry.register({
      id: 'repo-review',
      category: 'repository',
      priority: 50,
      provenance: {
        sourceKind: 'local',
        licenseStatus: 'NOT_APPLICABLE',
        decision: 'ADOPT',
      },
      healthPolicy: 'required',
    }, {
      id: 'repo-review',
      version: '1.2.3',
      stages: ['research', 'review'],
      health,
      execute,
    });

    const index = createFuryCapabilityIndex();
    const report = projectSkillsIntoCapabilityIndex(index, registry, {
      'repo-review': 'ready',
    });

    expect(report).toEqual({
      indexed: 1,
      skipped: 0,
      source: 'skill-registry',
      authority: 'projection-only',
      executionAuthority: false,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(health).not.toHaveBeenCalled();

    expect(index.get('skill', 'repo-review')).toMatchObject({
      kind: 'skill',
      id: 'repo-review',
      trust: 'verified',
      license: 'not-applicable',
      health: 'ready',
      riskClass: 'read',
      requiredPermissions: ['read'],
      source: {
        system: 'skill-registry',
        sourceId: 'repo-review',
        sourceRevision: '1.2.3',
      },
      executionAuthority: false,
    });
  });

  it('projects Studio Skill Hub metadata without loading skill instructions into the capability index', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-capability-skill-hub-'));
    try {
      const project = join(root, 'project');
      const home = join(root, 'home');
      mkdirSync(join(project, '.furypipe'), { recursive: true });
      mkdirSync(join(home, '.claude', 'skills', 'repo-review'), { recursive: true });
      writeFileSync(
        join(home, '.claude', 'skills', 'repo-review', 'SKILL.md'),
        '---\nname: repo-review\ndescription: Review repository code, tests and security.\n---\nPRIVATE-INSTRUCTION-BODY-MUST-NOT-BE-INDEXED\n',
      );

      const hub = createFurySkillHub({
        projectRoot: project,
        homeDir: home,
        stateDir: join(root, 'skill-state'),
      });
      const index = createFuryCapabilityIndex();
      const report = await projectSkillHubIntoCapabilityIndex(index, hub);

      expect(report).toEqual({
        indexed: 1,
        skipped: 0,
        source: 'skill-hub',
        authority: 'projection-only',
        executionAuthority: false,
      });
      expect(index.get('skill', 'repo-review')).toMatchObject({
        kind: 'skill',
        id: 'repo-review',
        trust: 'verified',
        license: 'not-applicable',
        health: 'ready',
        riskClass: 'none',
        requiredPermissions: [],
        source: {
          system: 'skill-registry',
          sourceId: 'repo-review',
        },
        executionAuthority: false,
      });
      expect(JSON.stringify(index.snapshot())).not.toContain('PRIVATE-INSTRUCTION-BODY-MUST-NOT-BE-INDEXED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('projects Studio MCP Hub configuration without starting or probing the configured server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'furypipe-capability-mcp-hub-'));
    try {
      const project = join(root, 'project');
      const home = join(root, 'home');
      mkdirSync(join(project, '.furypipe'), { recursive: true });
      mkdirSync(home, { recursive: true });
      writeFileSync(
        join(project, '.furypipe', 'mcp.json'),
        JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['server-github'] } } }),
      );
      const probe = vi.fn(async () => {
        throw new Error('PROJECTION_MUST_NOT_PROBE');
      });
      const hub = createFuryMcpHub({
        projectRoot: project,
        homeDir: home,
        stateDir: join(root, 'mcp-state'),
        probe,
      });
      const index = createFuryCapabilityIndex();
      const report = await projectMcpHubIntoCapabilityIndex(index, hub);

      expect(probe).not.toHaveBeenCalled();
      expect(report).toEqual({
        indexed: 1,
        skipped: 0,
        source: 'mcp-hub',
        authority: 'projection-only',
        executionAuthority: false,
      });
      const source = index.list('mcp-server')[0];
      expect(source).toMatchObject({
        kind: 'mcp-server',
        trust: 'unverified',
        health: 'unknown',
        riskClass: 'process',
        requiredPermissions: ['process'],
        source: { system: 'mcp-host' },
        executionAuthority: false,
      });
      expect(index.list('mcp-tool')).toHaveLength(0);
      expect(JSON.stringify(index.snapshot())).not.toContain('server-github');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps reference-only skills blocked even when a host says health is ready', () => {
    const registry = createAgentSkillRegistry();
    registry.register({
      id: 'reference-only',
      category: 'research',
      priority: 10,
      provenance: {
        sourceKind: 'external-reference',
        repository: 'https://github.com/example/reference-only',
        commitSha: 'a'.repeat(40),
        licenseStatus: 'VERIFIED',
        licenseSpdx: 'MIT',
        decision: 'REFERENCE_ONLY',
      },
    }, {
      id: 'reference-only',
      version: '1.0.0',
      stages: ['research'],
      execute: async () => ({ evidence: [], consumedTokens: 0 }),
    });

    const index = createFuryCapabilityIndex();
    projectSkillsIntoCapabilityIndex(index, registry, {
      'reference-only': 'ready',
    });

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Use reference-only research.',
      index,
      explicitRequests: [{ kind: 'skill', id: 'reference-only' }],
      availablePermissions: ['read'],
    });

    expect(plan.selected).toHaveLength(0);
    expect(plan.blocked).toContainEqual(expect.objectContaining({
      id: 'reference-only',
      reason: 'trust-blocked',
      requestedExplicitly: true,
    }));
  });

  it('projects plugin inspection without indexing secret environment variable names or enabling the plugin', () => {
    const registry = createFuryPluginBundleRegistry([
      CONTEXT7_PLUGIN_BUNDLE,
    ]);
    const index = createFuryCapabilityIndex();

    projectPluginsIntoCapabilityIndex(index, registry, {
      context7: 'ready',
    });

    const record = index.get('plugin', 'context7');
    expect(record).toMatchObject({
      kind: 'plugin',
      id: 'context7',
      health: 'ready',
      requiredPermissions: ['network'],
      source: {
        system: 'plugin-registry',
        sourceId: 'context7',
      },
      executionAuthority: false,
    });
    const serialized = JSON.stringify(index.snapshot());
    expect(serialized).not.toContain('CONTEXT7_API_KEY');
    expect(serialized).not.toContain('bearerEnv');
    expect(serialized).not.toContain('enabled":true');
  });

  it('projects harness discovery as agent capabilities without executing discovery', () => {
    const index = createFuryCapabilityIndex();
    const report = projectHarnessesIntoCapabilityIndex(index, {
      format: 'furypipe-harness-discovery/v1',
      platform: 'linux',
      harnesses: [{
        id: 'furypipe-native',
        displayName: 'FuryPipe Native',
        installed: true,
        versionStatus: 'builtin',
        authentication: 'not-probed',
        definition: {
          id: 'furypipe-native',
          displayName: 'FuryPipe Native',
          executables: [],
          versionArgs: [],
          integrations: ['native'],
          protocols: ['mcp','acp','a2a'],
          skillsDirectories: ['.furypipe/skills'],
          localModel: { mechanism: 'native', note: 'native' },
          capabilities: { streaming: true, resume: true, subagents: true },
          evidence: 'BUILTIN',
        },
      },{
        id: 'claude-code',
        displayName: 'Claude Code',
        installed: true,
        executable: '/usr/bin/claude',
        version: '2.1.282',
        versionStatus: 'ok',
        authentication: 'not-probed',
        definition: {
          id: 'claude-code',
          displayName: 'Claude Code',
          executables: ['claude'],
          versionArgs: ['--version'],
          integrations: ['official-sdk','structured-cli'],
          protocols: ['mcp'],
          skillsDirectories: ['.claude/skills'],
          localModel: { mechanism: 'anthropic-compatible-base-url', note: 'local compatible' },
          capabilities: { streaming: true, resume: true, subagents: true },
          evidence: 'OFFICIAL_FACT',
        },
      }],
    });

    expect(report).toEqual({
      indexed: 2,
      skipped: 0,
      source: 'harness-hub',
      authority: 'projection-only',
      executionAuthority: false,
    });
    expect(index.get('agent','furypipe-native')).toMatchObject({
      trust: 'verified',
      health: 'ready',
      requiredPermissions: [],
      executionAuthority: false,
    });
    expect(index.get('agent','claude-code')).toMatchObject({
      trust: 'verified',
      health: 'ready',
      requiredPermissions: ['process'],
      source: { sourceRevision: '2.1.282' },
      executionAuthority: false,
    });
    expect(JSON.stringify(index.snapshot())).not.toContain('/usr/bin/claude');
  });

  it('projects Provider Fabric metadata without probing or inventing availability', () => {
    const registry = createProviderRegistry([{
      id: 'example',
      protocol: 'openai',
      aliases: ['example-ai'],
      routePrefix: '/providers/example',
      status: 'registered',
      availability: 'unknown',
      evidence: [{ kind: 'local-contract', source: 'test registration' }],
      cache: {
        status: 'unknown',
        cost: { status: 'COST_UNKNOWN' },
      },
    }]);
    const index = createFuryCapabilityIndex();

    const report = projectProvidersIntoCapabilityIndex(index, registry);
    expect(report).toEqual({
      indexed: 1,
      skipped: 0,
      source: 'provider-fabric',
      authority: 'projection-only',
      executionAuthority: false,
    });
    expect(index.get('provider', 'example')).toMatchObject({
      kind: 'provider',
      trust: 'verified',
      health: 'unknown',
      requiredPermissions: ['provider-inference'],
      executionAuthority: false,
    });

    const selected = selectFuryCapabilitiesForTask({
      objective: 'Use the example provider.',
      index,
      explicitRequests: [{ kind: 'provider', id: 'example' }],
      availablePermissions: ['provider-inference'],
      options: { maxSelectedByKind: { provider: 1 } },
    });
    expect(selected.selected).toHaveLength(0);
    expect(selected.blockedCounts).toMatchObject({ 'health-unknown': 1 });

    const healthyIndex = createFuryCapabilityIndex();
    projectProvidersIntoCapabilityIndex(healthyIndex, registry, { example: 'ready' });
    expect(selectFuryCapabilitiesForTask({
      objective: 'Use the example provider.',
      index: healthyIndex,
      explicitRequests: [{ kind: 'provider', id: 'example' }],
      availablePermissions: ['provider-inference'],
      options: { maxSelectedByKind: { provider: 1 } },
    }).selected).toHaveLength(1);
  });

  it('projects Model Fabric metadata without making a provider request or claiming route health', () => {
    const registry = createModelFabricRegistry();
    registry.upsertMany(normalizeOpenAIModelsPayload({
      data: [{
        id: 'gpt-5.6-sol',
        owned_by: 'openai',
      }],
    }, '2026-09-20T10:00:00.000Z'));

    const index = createFuryCapabilityIndex();
    projectModelsIntoCapabilityIndex(index, registry);

    expect(index.get('model', 'openai/gpt-5.6-sol')).toMatchObject({
      kind: 'model',
      id: 'openai/gpt-5.6-sol',
      trust: 'verified',
      license: 'not-applicable',
      health: 'unknown',
      riskClass: 'process',
      requiredPermissions: ['provider-inference'],
      source: {
        system: 'model-fabric',
        sourceId: 'openai/gpt-5.6-sol',
        observedAt: '2026-09-20T10:00:00.000Z',
      },
      executionAuthority: false,
    });

    const blocked = selectFuryCapabilitiesForTask({
      objective: 'Use gpt 5.6 sol for reasoning.',
      index,
      explicitRequests: [{ kind: 'model', id: 'openai/gpt-5.6-sol' }],
      availablePermissions: ['provider-inference'],
    });
    expect(blocked.selected).toHaveLength(0);
    expect(blocked.blockedCounts).toMatchObject({
      'health-unknown': 1,
    });

    const healthyIndex = createFuryCapabilityIndex();
    projectModelsIntoCapabilityIndex(healthyIndex, registry, {
      'openai/gpt-5.6-sol': 'ready',
    });
    expect(selectFuryCapabilitiesForTask({
      objective: 'Use gpt 5.6 sol for reasoning.',
      index: healthyIndex,
      explicitRequests: [{ kind: 'model', id: 'openai/gpt-5.6-sol' }],
      availablePermissions: ['provider-inference'],
    }).selected).toHaveLength(1);
  });

  it('rejects accessor-backed health overrides before they can affect eligibility', () => {
    const registry = createAgentSkillRegistry();
    registry.register({
      id: 'safe-skill',
      category: 'testing',
      priority: 1,
      provenance: {
        sourceKind: 'local',
        licenseStatus: 'NOT_APPLICABLE',
        decision: 'ADOPT',
      },
    }, {
      id: 'safe-skill',
      version: '1.0.0',
      stages: ['verify'],
      execute: async () => ({ evidence: [], consumedTokens: 0 }),
    });

    const health = {} as Record<string, 'ready'>;
    Object.defineProperty(health, 'safe-skill', {
      enumerable: true,
      get() {
        throw new Error('HEALTH_GETTER_MUST_NOT_RUN');
      },
    });

    expect(() => projectSkillsIntoCapabilityIndex(
      createFuryCapabilityIndex(),
      registry,
      health,
    )).toThrow(/unsafe or invalid health state/u);
  });

  it('skips a valid Model Fabric identity that exceeds the stricter index identity bound instead of truncating it', () => {
    const registry = createModelFabricRegistry();
    const longId = 'm'.repeat(300);
    registry.upsertMany(normalizeOpenAIModelsPayload({
      data: [{ id: longId, owned_by: 'openai' }],
    }, '2026-09-20T10:00:00.000Z'));

    const index = createFuryCapabilityIndex();
    const report = projectModelsIntoCapabilityIndex(index, registry);

    expect(report).toMatchObject({
      indexed: 0,
      skipped: 1,
      source: 'model-fabric',
      executionAuthority: false,
    });
    expect(index.size()).toBe(0);
  });

  it('indexes MCP source metadata without probing, and tools only from already-supplied inventory evidence', () => {
    const inspectSource = vi.fn(async () => {
      throw new Error('AUTOPILOT_MUST_NOT_PROBE');
    });
    const inspectSources = vi.fn(() => Object.freeze([{
      sourceId: 'local-tools',
      transport: 'stdio' as const,
      endpointFingerprint: 'b'.repeat(64),
      trust: 'trusted' as const,
      executionAuthority: false as const,
    }]));
    const bridge: FuryKernelToolBridge = {
      inspectSources,
      inspectSource,
      propose: async () => { throw new Error('not used'); },
      approve: () => { throw new Error('not used'); },
      execute: async () => { throw new Error('not used'); },
      proposalTransport: () => undefined,
      discard: () => false,
      pendingProposalCount: () => 0,
      activeProbeCount: () => 0,
      activeExecutionCount: () => 0,
    };

    const index = createFuryCapabilityIndex();
    projectMcpIntoCapabilityIndex(index, bridge, {
      health: { 'local-tools': 'ready' },
    });

    expect(inspectSources).toHaveBeenCalledTimes(1);
    expect(inspectSource).not.toHaveBeenCalled();
    expect(index.list('mcp-tool')).toHaveLength(0);
    expect(index.get('mcp-server', 'local-tools')).toMatchObject({
      health: 'ready',
      requiredPermissions: ['process'],
      source: {
        sourceRevision: 'b'.repeat(64),
      },
    });

    const inspection: FuryKernelToolSourceInspection = {
      format: 'furypipe-kernel-tool-bridge/v1',
      source: {
        sourceId: 'local-tools',
        transport: 'stdio',
        endpointFingerprint: 'b'.repeat(64),
        trust: 'trusted',
        executionAuthority: false,
      },
      connected: true,
      healthy: true,
      listed: true,
      protocolEra: '2026-07-28',
      tools: [{
        name: 'repo-read',
        inputSchemaSha256: 'c'.repeat(64),
        riskClass: 'trusted_read_only_closed_world',
        closedWorldReadCandidate: true,
        authorizationGranted: false,
      }],
      executionAuthority: false,
    };

    projectMcpIntoCapabilityIndex(index, bridge, {
      inspections: [inspection],
    });
    expect(inspectSource).not.toHaveBeenCalled();

    const tool = index.get('mcp-tool', 'local-tools/repo-read');
    expect(tool).toMatchObject({
      kind: 'mcp-tool',
      health: 'ready',
      riskClass: 'read',
      requiredPermissions: ['process'],
      source: {
        sourceRevision: `${'b'.repeat(64)}:${'c'.repeat(64)}`,
      },
      executionAuthority: false,
    });
    expect(JSON.stringify(tool)).not.toContain('inputSchema');
  });

  it('rejects supplied MCP inventory evidence that no longer matches current source identity', () => {
    const bridge: FuryKernelToolBridge = {
      inspectSources: () => Object.freeze([{
        sourceId: 'remote-tools',
        transport: 'streamable_http',
        endpointFingerprint: 'd'.repeat(64),
        trust: 'trusted',
        executionAuthority: false,
      }]),
      inspectSource: async () => { throw new Error('not used'); },
      propose: async () => { throw new Error('not used'); },
      approve: () => { throw new Error('not used'); },
      execute: async () => { throw new Error('not used'); },
      proposalTransport: () => undefined,
      discard: () => false,
      pendingProposalCount: () => 0,
      activeProbeCount: () => 0,
      activeExecutionCount: () => 0,
    };

    const stale: FuryKernelToolSourceInspection = {
      format: 'furypipe-kernel-tool-bridge/v1',
      source: {
        sourceId: 'remote-tools',
        transport: 'streamable_http',
        endpointFingerprint: 'e'.repeat(64),
        trust: 'trusted',
        executionAuthority: false,
      },
      connected: true,
      healthy: true,
      listed: true,
      tools: [],
      executionAuthority: false,
    };

    expect(() => projectMcpIntoCapabilityIndex(
      createFuryCapabilityIndex(),
      bridge,
      { inspections: [stale] },
    )).toThrow(/does not match current source metadata/u);
  });

  it('requires re-selection when a selected fingerprint changes or disappears', () => {
    const index = createFuryCapabilityIndex();
    index.upsert({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      name: 'Repository review',
      description: 'Review repository security.',
      families: ['repository'],
      tags: ['review'],
      keywords: ['repository', 'security'],
      trust: 'verified',
      license: 'not-applicable',
      health: 'ready',
      riskClass: 'read',
      requiredPermissions: ['read'],
      compatibility: [],
      source: {
        system: 'skill-registry',
        sourceId: 'repo-review',
        sourceRevision: '1.0.0',
      },
    });

    const plan = selectFuryCapabilitiesForTask({
      objective: 'Review repository security.',
      index,
      availablePermissions: ['read'],
    });
    expect(plan.selected).toHaveLength(1);

    const current = revalidateFuryCapabilitySelection(plan, index);
    expect(current).toMatchObject({
      indexDigestMatches: true,
      reselectionRequired: false,
      validForExposure: true,
      current: 1,
      stale: 0,
      missing: 0,
      executionAuthority: false,
    });

    index.upsert({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: 'repo-review',
      name: 'Repository review',
      description: 'Changed current source metadata.',
      families: ['repository'],
      tags: ['review'],
      keywords: ['repository', 'security'],
      trust: 'verified',
      license: 'not-applicable',
      health: 'ready',
      riskClass: 'read',
      requiredPermissions: ['read'],
      compatibility: [],
      source: {
        system: 'skill-registry',
        sourceId: 'repo-review',
        sourceRevision: '2.0.0',
      },
    });

    const stale = revalidateFuryCapabilitySelection(plan, index);
    expect(stale).toMatchObject({
      indexDigestMatches: false,
      reselectionRequired: true,
      validForExposure: false,
      current: 0,
      stale: 1,
      missing: 0,
    });
    expect(stale.items[0]).toMatchObject({
      id: 'repo-review',
      status: 'stale',
    });

    index.remove('skill', 'repo-review');
    const missing = revalidateFuryCapabilitySelection(plan, index);
    expect(missing).toMatchObject({
      reselectionRequired: true,
      validForExposure: false,
      current: 0,
      stale: 0,
      missing: 1,
    });
  });

  it('requires re-selection when the global index changes even if selected fingerprints stay current', () => {
    const index = createFuryCapabilityIndex();
    index.upsert({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: 'selected',
      name: 'Selected capability',
      description: 'Repository security review.',
      families: ['repository'],
      tags: [],
      keywords: ['repository', 'security'],
      trust: 'verified',
      license: 'not-applicable',
      health: 'ready',
      riskClass: 'read',
      requiredPermissions: [],
      compatibility: [],
      source: { system: 'skill-registry', sourceId: 'selected' },
    });
    const plan = selectFuryCapabilitiesForTask({
      objective: 'Repository security review.',
      index,
    });
    expect(plan.selected.map((item) => item.id)).toEqual(['selected']);

    index.upsert({
      format: FURY_CAPABILITY_INDEX_ENTRY_FORMAT,
      kind: 'skill',
      id: 'new-candidate',
      name: 'New candidate',
      description: 'Repository security review.',
      families: ['repository'],
      tags: [],
      keywords: ['repository', 'security'],
      trust: 'verified',
      license: 'not-applicable',
      health: 'ready',
      riskClass: 'read',
      requiredPermissions: [],
      compatibility: [],
      source: { system: 'skill-registry', sourceId: 'new-candidate' },
    });

    const result = revalidateFuryCapabilitySelection(plan, index);
    expect(result).toMatchObject({
      indexDigestMatches: false,
      reselectionRequired: true,
      validForExposure: false,
      current: 1,
      stale: 0,
      missing: 0,
    });
  });
});
