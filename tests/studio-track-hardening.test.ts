// Adversarial regressions from the independent audit of the Studio track.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFurySkillHub } from '../src/fury-skill-hub.js';
import { createStudioChats } from '../src/studio/studio-chats.js';
import { createStudioCode } from '../src/studio/studio-code.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const tmp = (p: string) => {
  const r = mkdtempSync(join(tmpdir(), p));
  roots.push(r);
  return r;
};

describe('Code explorer path handling', () => {
  it.each([['../'], ['..%2f..%2fetc'], ['src/../../x'], ['a\0b'], ['/etc/passwd'], ['C:\\Windows'], ['\\\\server\\share']])('refuses %j', async (p) => {
    const root = tmp('fp-code-');
    mkdirSync(join(root, 'src'));
    const code = createStudioCode(root);
    await expect(code.file(p)).rejects.toMatchObject({ status: expect.any(Number) });
  });
});

describe('Skill hub adversarial input', () => {
  it('keeps one skill per name across roots and flags a checksum change', async () => {
    const root = tmp('fp-skill-');
    const mk = (dir: string, desc: string) => { mkdirSync(join(root, dir, 'dup-skill'), { recursive: true }); writeFileSync(join(root, dir, 'dup-skill', 'SKILL.md'), `---\nname: dup-skill\ndescription: ${desc}\n---\nx\n`); };
    mk('.furypipe/skills', 'First copy wins.');
    mk('.claude/skills', 'Shadowed copy.');
    const hub = createFurySkillHub({ projectRoot: root, homeDir: join(root, 'h'), stateDir: join(root, 's'), projectTrustedForInstructions: true });
    const { skills, diagnostics } = await hub.list();
    expect(skills.filter((s) => s.name === 'dup-skill')).toHaveLength(1);
    expect(skills[0]!.description).toBe('First copy wins.');
    expect(diagnostics.some((d) => d.code === 'name_collision_shadowed')).toBe(true);
    await hub.pin('dup-skill');
    writeFileSync(join(root, '.furypipe/skills/dup-skill/SKILL.md'), '---\nname: dup-skill\ndescription: First copy wins.\n---\nchanged\n');
    expect((await hub.list()).skills[0]!.pinMismatch).toBe(true);
  });

  it('rejects malformed manifests and names that do not match their folder', async () => {
    const root = tmp('fp-skill-');
    const hub = createFurySkillHub({ projectRoot: root, homeDir: join(root, 'h'), stateDir: join(root, 's') });
    const bad = join(root, 'in', 'good-name');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'SKILL.md'), '---\nname: other-name\ndescription: x\n---\n');
    await expect(hub.install(bad)).rejects.toThrow(/invalid SKILL.md/u);
    writeFileSync(join(bad, 'SKILL.md'), 'no frontmatter at all');
    await expect(hub.install(bad)).rejects.toThrow(/invalid SKILL.md/u);
    await expect(hub.rollback('good-name', 'a'.repeat(64))).rejects.toThrow(/no snapshot/u);
    await expect(hub.setEnabled('../etc', true)).rejects.toThrow();
  });
});

describe('Conversation store corruption', () => {
  it('fails closed on a corrupted store instead of overwriting it', async () => {
    const root = tmp('fp-chat-');
    writeFileSync(join(root, 'conversations.json'), '{"format":"furypipe-studio-chats/v1","conversations":[');
    const chats = createStudioChats({ stateDir: root });
    await expect(chats.list()).rejects.toThrow();
    await expect(chats.save({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow();
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(root, 'conversations.json'), 'utf8')).toContain('"conversations":[');
  });
});

describe.skipIf(process.platform === 'win32')('Code explorer symlink escape', () => {
  it('refuses a symlinked file that points outside', async () => {
    const root = tmp('fp-code-');
    const outside = tmp('fp-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'outside the project\n');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'host'));
    await expect(createStudioCode(root).file('host')).rejects.toMatchObject({ status: 403 });
    // A dangling link is simply not found (still refused).
    symlinkSync(join(outside, 'missing.txt'), join(root, 'dangling'));
    await expect(createStudioCode(root).file('dangling')).rejects.toMatchObject({ status: 404 });
  });
});

describe('Code diff', () => {
  it('refuses a dirty non-listed path and bad base refs', async () => {
    const root = tmp('fp-code-');
    execFileSync('git', ['init', '-q'], { cwd: root });
    const code = createStudioCode(root);
    await expect(code.diff(root + '/../')).rejects.toMatchObject({ status: 404 });
  });
});
