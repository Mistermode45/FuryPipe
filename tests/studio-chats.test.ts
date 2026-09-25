import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { StudioChatError, createStudioChats } from '../src/studio/studio-chats.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function store() {
  const root = mkdtempSync(join(tmpdir(), 'furypipe-chats-'));
  roots.push(root);
  let t = 100;
  return { root, chats: createStudioChats({ stateDir: root, now: () => t++ }) };
}

describe('Studio conversations', () => {
  it('persists conversations with the model of every answer and titles them from the first question', async () => {
    const { root, chats } = store();
    const c = await chats.save({ messages: [{ role: 'user', content: 'How do I rotate keys?' }, { role: 'assistant', content: 'Use kms.', model: { kind: 'ollama', model: 'qwen', locality: 'local' } }] });
    expect(c.title).toBe('How do I rotate keys?');
    expect(c.messages[1]!.model).toEqual({ kind: 'ollama', model: 'qwen', locality: 'local' });
    const reopened = createStudioChats({ stateDir: root });
    expect(await reopened.list()).toMatchObject([{ id: c.id, messages: 2, models: ['ollama:qwen'] }]);
    const updated = await reopened.save({ id: c.id, messages: [...c.messages, { role: 'user', content: 'thanks' }] });
    expect(updated.messages).toHaveLength(3);
    expect(updated.messages[0]!.id).toBe(c.messages[0]!.id);
  });

  it('titles from the typed question, never from attached context, and honours an explicit rename', async () => {
    const { chats } = store();
    const c = await chats.save({ messages: [{ role: 'user', content: 'Summarise this\n\n<<furypipe-context>>\n[File: notes.md]\nsecret-ish body' }] });
    expect(c.title).toBe('Summarise this');
    expect((await chats.save({ id: c.id, title: '  Renamed  ', messages: c.messages })).title).toBe('Renamed');
  });

  it('branches without touching the original and supports delete', async () => {
    const { chats } = store();
    const c = await chats.save({ messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' }] });
    const b = await chats.branch(c.id, c.messages[1]!.id);
    expect(b).toMatchObject({ parentId: c.id, forkedAtMessage: c.messages[1]!.id, title: 'q1 (branch)' });
    expect(b.messages.map((m) => m.content)).toEqual(['q1', 'a1']);
    expect((await chats.get(c.id)).messages).toHaveLength(4);
    await chats.remove(b.id);
    await expect(chats.get(b.id)).rejects.toMatchObject({ status: 404 });
  });

  it('serialises concurrent saves and validates input', async () => {
    const { chats } = store();
    await Promise.all(Array.from({ length: 10 }, (_, i) => chats.save({ messages: [{ role: 'user', content: `q${i}` }] })));
    expect(await chats.list()).toHaveLength(10);
    await expect(chats.save({ messages: [{ role: 'tool', content: 'x' }] })).rejects.toThrow(StudioChatError);
    await expect(chats.save({ messages: [{ role: 'user', content: 'x'.repeat(70_000) }] })).rejects.toThrow(/64 KiB/u);
    await expect(chats.save({ id: 'nope', messages: [] })).rejects.toMatchObject({ status: 404 });
    await expect(chats.branch('nope', 'x')).rejects.toMatchObject({ status: 404 });
  });
});
