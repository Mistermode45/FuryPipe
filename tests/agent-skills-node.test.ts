import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { discoverAgentSkillsNode } from '../src/agent-skills-node.js';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'furypipe-skills-'));
  cleanup.push(dir);
  return dir;
}

async function skill(root: string, base: string, name: string, description: string): Promise<string> {
  const dir = path.join(root, base, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---
name: ${name}
description: ${description}
metadata:
  test: "true"
---

# Instructions

Use evidence and verify the result.
`, 'utf8');
  return dir;
}

describe('Node Agent Skills discovery', () => {
  it('discovers metadata without granting execution authority', async () => {
    const root = await tempRoot();
    await skill(root, path.join('.agents', 'skills'), 'repo-audit', 'Audit repositories when code quality needs evidence.');

    const result = await discoverAgentSkillsNode({
      projectRoot: root,
      homeDir: path.join(root, 'empty-home'),
      projectTrustedForInstructions: true,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      name: 'repo-audit',
      scope: 'project',
      activationEligible: true,
      executionAuthorized: false,
    });
    expect(result.skills[0]?.metadata.metadata).toEqual({ test: 'true' });
  });

  it('discovers untrusted project skills but blocks instruction activation', async () => {
    const root = await tempRoot();
    await skill(root, path.join('.agents', 'skills'), 'repo-audit', 'Audit repositories.');

    const result = await discoverAgentSkillsNode({
      projectRoot: root,
      homeDir: path.join(root, 'empty-home'),
    });

    expect(result.skills[0]).toMatchObject({
      name: 'repo-audit',
      activationEligible: false,
      executionAuthorized: false,
    });
  });

  it('gives project skills deterministic precedence over user skills', async () => {
    const root = await tempRoot();
    const project = path.join(root, 'project');
    const home = path.join(root, 'home');
    await skill(project, path.join('.agents', 'skills'), 'shared-skill', 'Project-specific procedure.');
    await skill(home, path.join('.agents', 'skills'), 'shared-skill', 'User fallback procedure.');

    const result = await discoverAgentSkillsNode({
      projectRoot: project,
      homeDir: home,
      projectTrustedForInstructions: true,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.description).toBe('Project-specific procedure.');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'name_collision_shadowed' }),
    ]));
  });

  it('lets an explicit configured root win collisions but not authority unless trusted', async () => {
    const root = await tempRoot();
    const configured = path.join(root, 'configured');
    const project = path.join(root, 'project');
    await skill(configured, '.', 'shared-skill', 'Configured operator skill.');
    await skill(project, path.join('.agents', 'skills'), 'shared-skill', 'Project skill.');

    const result = await discoverAgentSkillsNode({
      projectRoot: project,
      homeDir: path.join(root, 'home'),
      projectTrustedForInstructions: true,
      configuredRoots: [{ path: configured, trustedForInstructions: false }],
    });

    expect(result.skills[0]).toMatchObject({
      description: 'Configured operator skill.',
      scope: 'configured',
      activationEligible: false,
    });
  });

  it('does not recursively treat nested arbitrary directories as skill roots', async () => {
    const root = await tempRoot();
    await skill(root, path.join('.agents', 'skills', 'container'), 'nested-skill', 'Should not be discovered recursively.');

    const result = await discoverAgentSkillsNode({
      projectRoot: root,
      homeDir: path.join(root, 'home'),
      projectTrustedForInstructions: true,
    });

    expect(result.skills).toEqual([]);
  });

  it('bounds the number of selected skills', async () => {
    const root = await tempRoot();
    await skill(root, path.join('.agents', 'skills'), 'skill-one', 'First.');
    await skill(root, path.join('.agents', 'skills'), 'skill-two', 'Second.');

    const result = await discoverAgentSkillsNode({
      projectRoot: root,
      homeDir: path.join(root, 'home'),
      projectTrustedForInstructions: true,
      maxSkills: 1,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'skill_limit_reached' }),
    ]));
  });
});
