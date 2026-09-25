// Studio conversations: persisted locally, branchable, with the model that
// produced every assistant message (so a model switch or a retry with
// another model is part of the record, not lost in the UI).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StudioChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly at: number;
  /** Set on assistant messages: which runtime/provider/model answered. */
  readonly model?: { readonly kind: string; readonly model: string; readonly locality: 'local' | 'cloud' };
}

export interface StudioConversation {
  readonly id: string;
  title: string;
  readonly createdAt: number;
  updatedAt: number;
  messages: StudioChatMessage[];
  readonly parentId?: string;
  readonly forkedAtMessage?: string;
}

const MAX_CONVERSATIONS = 500;
const MAX_MESSAGES = 500;
const MAX_CONTENT = 64 * 1024;
const ID = /^[0-9a-f-]{36}$/u;

export class StudioChatError extends Error {
  override readonly name = 'StudioChatError';
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function validMessage(raw: unknown, now: number): StudioChatMessage {
  const m = raw as Partial<StudioChatMessage>;
  if (!m || (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') || typeof m.content !== 'string' || m.content.length > MAX_CONTENT) throw new StudioChatError(400, 'each message needs a role and at most 64 KiB of content');
  const model = m.model && typeof m.model.kind === 'string' && typeof m.model.model === 'string' ? { kind: m.model.kind.slice(0, 64), model: m.model.model.slice(0, 256), locality: m.model.locality === 'cloud' ? 'cloud' as const : 'local' as const } : undefined;
  return { id: typeof m.id === 'string' && ID.test(m.id) ? m.id : randomUUID(), role: m.role, content: m.content, at: typeof m.at === 'number' && Number.isSafeInteger(m.at) ? m.at : now, ...(m.role === 'assistant' && model ? { model } : {}) };
}

export function createStudioChats(options: { readonly stateDir: string; readonly now?: () => number }) {
  const now = options.now ?? Date.now;
  const file = path.join(options.stateDir, 'conversations.json');
  let queue = Promise.resolve();
  const load = async (): Promise<StudioConversation[]> => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as { format?: string; conversations?: StudioConversation[] };
      if (parsed.format !== 'furypipe-studio-chats/v1' || !Array.isArray(parsed.conversations)) throw new StudioChatError(500, 'conversation store has an unknown format');
      return parsed.conversations;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  };
  const save = async (all: StudioConversation[]) => {
    await mkdir(options.stateDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ format: 'furypipe-studio-chats/v1', conversations: all }), { mode: 0o600 });
    await rename(tmp, file);
  };
  // Serialise writers: two tabs saving at once must not lose a conversation.
  const mutate = <T>(fn: (all: StudioConversation[]) => T | Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const all = await load();
      const out = await fn(all);
      await save(all);
      return out;
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
  const find = (all: StudioConversation[], id: unknown) => {
    const c = typeof id === 'string' ? all.find((x) => x.id === id) : undefined;
    if (!c) throw new StudioChatError(404, 'conversation not found');
    return c;
  };
  const titleOf = (messages: readonly StudioChatMessage[]) => (messages.find((m) => m.role === 'user')?.content ?? 'New chat').replace(/\s+/gu, ' ').trim().slice(0, 80) || 'New chat';

  return Object.freeze({
    async list() {
      return (await load()).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c.messages.length, ...(c.parentId ? { parentId: c.parentId } : {}), models: [...new Set(c.messages.flatMap((m) => (m.model ? [`${m.model.kind}:${m.model.model}`] : [])))] })).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id: unknown) {
      return find(await load(), id);
    },
    /** Create (no id) or replace the messages of a conversation. */
    async save(input: { readonly id?: unknown; readonly title?: unknown; readonly messages: unknown }) {
      if (!Array.isArray(input.messages) || input.messages.length > MAX_MESSAGES) throw new StudioChatError(400, `messages must be an array of at most ${MAX_MESSAGES}`);
      const t = now();
      const messages = input.messages.map((m) => validMessage(m, t));
      return mutate((all) => {
        if (input.id === undefined) {
          if (all.length >= MAX_CONVERSATIONS) throw new StudioChatError(409, `at most ${MAX_CONVERSATIONS} conversations; delete some first`);
          const c: StudioConversation = { id: randomUUID(), title: typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 80) : titleOf(messages), createdAt: t, updatedAt: t, messages };
          all.push(c);
          return c;
        }
        const c = find(all, input.id);
        c.messages = messages;
        c.updatedAt = t;
        if (typeof input.title === 'string' && input.title.trim()) c.title = input.title.trim().slice(0, 80);
        else if (c.title === 'New chat') c.title = titleOf(messages);
        return c;
      });
    },
    /** Branch: a new conversation holding the messages up to and including `atMessage`. */
    async branch(id: unknown, atMessage: unknown) {
      return mutate((all) => {
        const parent = find(all, id);
        const idx = parent.messages.findIndex((m) => m.id === atMessage);
        if (idx < 0) throw new StudioChatError(404, 'message not found in conversation');
        if (all.length >= MAX_CONVERSATIONS) throw new StudioChatError(409, `at most ${MAX_CONVERSATIONS} conversations`);
        const t = now();
        const c: StudioConversation = { id: randomUUID(), title: `${parent.title.slice(0, 70)} (branch)`, createdAt: t, updatedAt: t, messages: parent.messages.slice(0, idx + 1).map((m) => ({ ...m })), parentId: parent.id, forkedAtMessage: parent.messages[idx]!.id };
        all.push(c);
        return c;
      });
    },
    async remove(id: unknown) {
      return mutate((all) => {
        const c = find(all, id);
        all.splice(all.indexOf(c), 1);
        return { deleted: c.id };
      });
    },
  });
}

export type StudioChats = ReturnType<typeof createStudioChats>;
