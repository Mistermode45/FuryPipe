import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FurySkillHubError, createFurySkillHub } from '../src/fury-skill-hub.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function skill(dir: string, name: string, description: string, extra = ''): string {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n\nDo the thing.\n`);
  return d;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'furypipe-skillhub-'));
  roots.push(root);
  const project = join(root, 'project');
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  skill(join(project, '.claude', 'skills'), 'sql-review', 'Review SQL migrations for locking and data loss.', 'license: MIT\nmetadata:\n  version: 1.2.0\n  author: team-db\n  harnesses: claude-code, codex\n');
  skill(join(project, '.opencode', 'skills'), 'css-audit', 'Audit CSS for contrast and layout regressions.', 'metadata:\n  furypipe-type: evolving\n');
  let t = 1_000;
  const hub = createFurySkillHub({ projectRoot: project, homeDir: home, stateDir: join(root, 'state'), projectTrustedForInstructions: true, now: () => t++ });
  return { root, project, hub };
}

describe('FurySkillHub', () => {
  it('lists skills from every root with checksum, provenance, compatibility and type', async () => {
    const { hub } = setup();
    const { skills } = await hub.list();
    const sql = skills.find((s) => s.name === 'sql-review')!;
    expect(sql).toMatchObject({ version: '1.2.0', author: 'team-db', license: 'MIT', trust: 'trusted-instructions', compatibleHarnesses: ['claude-code', 'codex'], type: 'STATIC', enabled: true, governance: 'ASK_BEFORE_WRITE', executionAuthorized: false });
    expect(sql.checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(skills.find((s) => s.name === 'css-audit')).toMatchObject({ type: 'EVOLVING', compatibleHarnesses: [] });
  });

  it('auto-selects only enabled, pin-consistent, runtime-compatible skills', async () => {
    const { hub, project } = setup();
    expect((await hub.autoSelect('review the SQL migrations for locking', { harnessId: 'claude-code' })).plan.selected.map((s) => s.name)).toEqual(['sql-review']);
    const other = await hub.autoSelect('review the SQL migrations for locking', { harnessId: 'gemini-cli' });
    expect(other.plan.selected).toEqual([]);
    expect(other.excluded).toContainEqual({ name: 'sql-review', reason: 'incompatible-runtime' });

    await hub.pin('sql-review');
    writeFileSync(join(project, '.claude', 'skills', 'sql-review', 'notes.md'), 'tampered\n');
    const pinned = await hub.autoSelect('review the SQL migrations for locking');
    expect(pinned.plan.selected).toEqual([]);
    expect(pinned.excluded).toContainEqual({ name: 'sql-review', reason: 'pin-mismatch' });
    expect((await hub.list()).skills.find((s) => s.name === 'sql-review')?.pinMismatch).toBe(true);
    await hub.pin('sql-review');
    expect((await hub.autoSelect('review the SQL migrations for locking')).plan.selected).toHaveLength(1);

    await hub.setEnabled('sql-review', false);
    expect((await hub.autoSelect('review the SQL migrations')).excluded).toContainEqual({ name: 'sql-review', reason: 'disabled' });
  });

  it('activates selected SKILL.md instructions with receipts but no tool authority', async () => {
    const { hub } = setup();
    const selection = await hub.autoSelect('review the SQL migrations for locking', { harnessId: 'claude-code' });
    const activated = await hub.activateSelection(selection.plan.selected.map((skill) => skill.name), { harnessId: 'claude-code' });
    expect(activated).toHaveLength(1);
    expect(activated[0]).toMatchObject({
      name: 'sql-review',
      executionAuthorized: false,
      receipt: { format: 'furypipe-agent-skill-activation/v1', status: 'activated', executionAuthorized: false },
    });
    expect(activated[0]?.instructions).toContain('Do the thing.');
    expect(activated[0]?.checksum).toMatch(/^[0-9a-f]{64}$/u);

    await hub.setEnabled('sql-review', false);
    await expect(hub.activateSelection(['sql-review'])).rejects.toThrow(/disabled/u);
    await expect(hub.activateSelection(Array.from({ length: 9 }, (_, i) => `skill-${i}`))).rejects.toThrow(/at most 8/u);
  });

  it('records usage stats and persists state across hub instances', async () => {
    const { hub, root, project } = setup();
    await hub.recordUse('css-audit', 'success');
    await hub.recordUse('css-audit', 'failure');
    await hub.setGovernance('css-audit', 'DRAFT_ONLY');
    const again = createFurySkillHub({ projectRoot: project, homeDir: join(root, 'home'), stateDir: join(root, 'state'), projectTrustedForInstructions: true });
    expect((await again.list()).skills.find((s) => s.name === 'css-audit')).toMatchObject({ governance: 'DRAFT_ONLY', stats: { uses: 2, successes: 1, failures: 1, lastUsedAt: 1_001 } });
    await expect(hub.setGovernance('css-audit', 'YOLO' as never)).rejects.toThrow(FurySkillHubError);
    await expect(hub.pin('nope')).rejects.toThrow(/unknown skill/u);
  });

  it('creates a bounded project-local skill without granting tool authority', async () => {
    const { hub, project } = setup();
    const created = await hub.create({
      name:'release-review',
      description:'Review release changes before publishing.',
      instructions:'Inspect the diff, verify tests, and report evidence before completion.',
      version:'1.0.0',
      author:'LégendeUrbaine',
      license:'MIT',
      harnesses:['claude-code','codex'],
      allowedTools:['read_file','git_diff'],
      type:'GENERATED',
      triggers:['release review requested'],
      examples:['Review the next FuryPipe release.'],
      tests:['Must request no execution authority.'],
    });
    expect(created).toMatchObject({
      name:'release-review',
      version:'1.0.0',
      author:'LégendeUrbaine',
      license:'MIT',
      compatibleHarnesses:['claude-code','codex'],
      type:'GENERATED',
      executionAuthorized:false,
    });
    const text=readFileSync(join(project,'.furypipe','skills','release-review','SKILL.md'),'utf8');
    expect(text).toContain('allowed-tools: "read_file, git_diff"');
    expect(text).toContain('## Trigger conditions');
    const activated=await hub.activateSelection(['release-review'],{harnessId:'claude-code'}).catch(()=>[]);
    expect(activated).toEqual([]);
  });

  it('rejects unsafe creator input and unknown harnesses', async () => {
    const { hub } = setup();
    await expect(hub.create({name:'Bad Name',description:'x',instructions:'y'})).rejects.toThrow(/invalid skill name/u);
    await expect(hub.create({name:'safe-name',description:'x',instructions:'y',harnesses:['unknown-runtime']})).rejects.toThrow(/unknown harness/u);
    await expect(hub.create({name:'safe-name',description:'x',instructions:'x'.repeat(30*1024)})).rejects.toThrow(/per-skill activation bound/u);
  });

  it('installs from a local directory with snapshots, compares and rolls back', async () => {
    const { hub, root, project } = setup();
    const src = skill(join(root, 'incoming'), 'release-notes', 'Draft release notes from merged changes.');
    const v1 = await hub.install(src);
    expect(v1.scope).toBe('project');
    expect(readFileSync(join(project, '.furypipe', 'skills', 'release-notes', 'SKILL.md'), 'utf8')).toContain('Draft release notes');
    writeFileSync(join(src, 'template.md'), '## Changes\n');
    const v2 = await hub.install(src);
    expect(v2.checksum).not.toBe(v1.checksum);
    expect(v2.versions).toEqual([v1.checksum, v2.checksum].sort());
    expect(await hub.compare('release-notes', v1.checksum, v2.checksum)).toEqual({ added: ['template.md'], removed: [], changed: [] });
    const back = await hub.rollback('release-notes', v1.checksum);
    expect(back.checksum).toBe(v1.checksum);
    await hub.setGovernance('release-notes', 'LOCKED');
    await expect(hub.rollback('release-notes', v2.checksum)).rejects.toThrow(/LOCKED/u);
    await expect(hub.install(src)).rejects.toThrow(/LOCKED/u);
  });

  it.skipIf(process.platform === 'win32')('refuses symlinks, missing manifests and oversized skills', async () => {
    const { hub, root } = setup();
    const evil = skill(join(root, 'incoming'), 'evil-skill', 'Looks harmless.');
    symlinkSync('/etc/passwd', join(evil, 'passwd'));
    await expect(hub.install(evil)).rejects.toThrow(/symlink refused/u);
    const empty = join(root, 'incoming', 'empty');
    mkdirSync(empty);
    writeFileSync(join(empty, 'README.md'), 'x');
    await expect(hub.install(empty)).rejects.toThrow(/no SKILL.md/u);
    const big = skill(join(root, 'incoming'), 'big-skill', 'Big.');
    for (let i = 0; i < 130; i++) writeFileSync(join(big, `f${i}.txt`), 'x');
    await expect(hub.install(big)).rejects.toThrow(/128 files/u);
  });
});
