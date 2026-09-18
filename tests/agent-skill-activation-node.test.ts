import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { activateSelectedAgentSkillsNode } from '../src/agent-skill-activation-node.js';
import { discoverAgentSkillsNode } from '../src/agent-skills-node.js';
import { selectAgentSkillsForTask } from '../src/agent-skill-selector.js';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'furypipe-activate-'));
  cleanup.push(root);
  const dir = path.join(root, '.agents', 'skills', 'systematic-debugging');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---
name: systematic-debugging
description: Investigate bugs and root causes before changing code.
---

# Systematic debugging

Reproduce the failure, collect evidence, state one hypothesis, then test it.
`, 'utf8');
  await mkdir(path.join(dir, 'scripts'));
  await writeFile(path.join(dir, 'scripts', 'dangerous.sh'), 'echo should-not-run', 'utf8');
  return root;
}

describe('Node Agent Skill instruction activation', () => {
  it('loads only a selected trusted SKILL.md and creates activation proof, not execution proof', async () => {
    const root = await fixture();
    const discovery = await discoverAgentSkillsNode({
      projectRoot: root,
      homeDir: path.join(root, 'home'),
      projectTrustedForInstructions: true,
    });
    const plan = selectAgentSkillsForTask(
      'Debug this failing test and find the root cause.',
      discovery.skills,
    );

    expect(plan.selected, JSON.stringify({ plan, discovery }, null, 2)).toHaveLength(1);

    const result = await activateSelectedAgentSkillsNode(plan, discovery.skills);

    expect(result.activated, JSON.stringify({ plan, result, discovery }, null, 2)).toHaveLength(1);
    expect(result.activated[0]).toMatchObject({
      name: 'systematic-debugging',
      executionAuthorized: false,
      receipt: {
        status: 'activated',
        executionAuthorized: false,
      },
    });
    expect(result.activated[0]?.promptBlock).toContain('Reproduce the failure');
    expect(result.activated[0]?.promptBlock).not.toContain('should-not-run');
  });

  it('does not load project instructions when project trust is absent', async () => {
    const root = await fixture();
    const discovery = await discoverAgentSkillsNode({
      projectRoot: root,
      homeDir: path.join(root, 'home'),
    });
    const plan = selectAgentSkillsForTask(
      'Use $systematic-debugging on this bug.',
      discovery.skills,
    );

    expect(plan.selected).toEqual([]);
    expect(plan.blocked).toContainEqual(expect.objectContaining({
      name: 'systematic-debugging',
      reason: 'activation_not_eligible',
    }));

    const result = await activateSelectedAgentSkillsNode(plan, discovery.skills);
    expect(result.activated).toEqual([]);
  });

  it('fails closed when SKILL.md identity changes after discovery', async () => {
    const root = await fixture();
    const discovery = await discoverAgentSkillsNode({
      projectRoot: root,
      homeDir: path.join(root, 'home'),
      projectTrustedForInstructions: true,
    });
    const plan = selectAgentSkillsForTask(
      'Use $systematic-debugging on this bug.',
      discovery.skills,
    );

    const location = discovery.skills[0]!.location;
    await writeFile(location, `---
name: systematic-debugging
description: Replaced after discovery.
---

Different instructions.
`, 'utf8');

    const result = await activateSelectedAgentSkillsNode(plan, discovery.skills);
    expect(result.activated).toEqual([]);
    expect(result.blocked).toContainEqual({
      name: 'systematic-debugging',
      reason: 'changed_since_discovery',
      detail: 'identity_changed',
    });
  });
});