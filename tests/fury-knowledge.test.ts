import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FuryKnowledgeError, chunkFuryDocument, createFuryKnowledgeBase, furyGroundedPrompt, furyKnowledgeTerms, type FuryEmbedder } from '../src/fury-knowledge.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function corpus() {
  const root = mkdtempSync(join(tmpdir(), 'furypipe-kb-'));
  roots.push(root);
  const docs = join(root, 'docs');
  mkdirSync(join(docs, 'guides'), { recursive: true });
  mkdirSync(join(docs, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(docs, 'auth.md'), '# Authentication\n\nIntro.\n\n## Token refresh\n\nAccess tokens expire after 15 minutes. The client calls refreshToken before expiry.\n\n## Logout\n\nLogout revokes the refresh token server side.\n');
  writeFileSync(join(docs, 'guides', 'deploy.md'), '# Deploy\n\nRun the release pipeline. Rollback uses the previous artifact.\n');
  writeFileSync(join(docs, 'session.ts'), 'export function refreshToken(session: Session) {\n  return rotate(session);\n}\n');
  writeFileSync(join(docs, 'node_modules', 'x', 'noise.md'), '# token token token\n');
  writeFileSync(join(docs, 'logo.png'), 'binary');
  return { root, docs };
}

// Deterministic toy embedder: bag of concept dimensions.
const CONCEPTS = [['token', 'expiry', 'expire', 'refresh', 'session', 'credential'], ['deploy', 'release', 'rollback', 'ship'], ['logout', 'revoke', 'sign']];
const embed: FuryEmbedder = async (texts) => texts.map((t) => CONCEPTS.map((words) => words.filter((w) => t.toLowerCase().includes(w)).length + 0.01));

describe('FuryKnowledge chunking and terms', () => {
  it('chunks Markdown by heading with 1-based line citations and splits identifiers', () => {
    const chunks = chunkFuryDocument('docs/auth.md', '# A\n\ntext\n\n## B\n\nmore\n');
    expect(chunks.map((c) => [c.heading, c.startLine, c.endLine])).toEqual([['A', 1, 3], ['B', 5, 7]]);
    expect(furyKnowledgeTerms('refreshToken user_id')).toEqual(expect.arrayContaining(['refreshtoken', 'refresh', 'token', 'user_id', 'user', 'id']));
    const code = chunkFuryDocument('a.ts', Array.from({ length: 130 }, (_, i) => `const v${i} = ${i};`).join('\n'));
    expect(code.map((c) => [c.startLine, c.endLine])).toEqual([[1, 60], [51, 110], [101, 130]]);
  });
});

describe('FuryKnowledge base', () => {
  it('ingests incrementally, skips vendor/binary/symlinks and cites lexical hits', async () => {
    const { root, docs } = corpus();
    if (process.platform !== 'win32') symlinkSync('/etc', join(docs, 'etc-link'));
    const kb = createFuryKnowledgeBase({ stateDir: join(root, 'state') });
    const first = await kb.ingest(docs, { label: 'docs' });
    expect(first).toMatchObject({ filesIndexed: 3, filesUnchanged: 0, embedded: 0 });
    if (process.platform !== 'win32') expect(first.skipped).toContainEqual({ path: 'etc-link', reason: 'symlink' });
    const { mode, hits } = await kb.search('when do access tokens expire?');
    expect(mode).toBe('lexical');
    expect(hits[0]).toMatchObject({ citation: 'docs/auth.md:5-7', heading: 'Token refresh' });
    expect(hits[0]!.why).toMatch(/terms: .*token/u);
    expect(hits.some((h) => h.path.includes('node_modules'))).toBe(false);

    const again = await kb.ingest(docs, { label: 'docs' });
    expect(again).toMatchObject({ filesIndexed: 0, filesUnchanged: 3 });
    writeFileSync(join(docs, 'guides', 'deploy.md'), '# Deploy\n\nShip with canary first.\n');
    rmSync(join(docs, 'session.ts'));
    expect(await kb.ingest(docs, { label: 'docs' })).toMatchObject({ filesIndexed: 1, filesUnchanged: 1, filesRemoved: 1 });
    expect((await kb.search('canary')).hits[0]?.citation).toBe('docs/guides/deploy.md:1-3');
    expect(await kb.stats()).toMatchObject({ files: 2, sources: { docs: 2 } });
    expect(await kb.forget('docs')).toMatchObject({ files: 2 });
    expect((await kb.search('canary')).hits).toEqual([]);
  });

  it('fuses lexical and semantic ranks and finds paraphrases lexical search misses', async () => {
    const { root, docs } = corpus();
    const kb = createFuryKnowledgeBase({ stateDir: join(root, 'state'), embed, embeddingModel: 'toy-v1' });
    expect((await kb.ingest(docs, { label: 'docs' })).embedded).toBeGreaterThan(0);
    const lexical = await kb.search('how do we ship', { mode: 'lexical' });
    expect(lexical.hits).toEqual([]);
    const hybrid = await kb.search('how do we ship', { mode: 'hybrid' });
    expect(hybrid.mode).toBe('hybrid');
    expect(hybrid.hits[0]?.path).toBe('docs/guides/deploy.md');
    expect(hybrid.hits[0]?.why).toMatch(/semantic rank 1/u);
    // Another embedding model invalidates stored vectors instead of mixing spaces.
    const other = createFuryKnowledgeBase({ stateDir: join(root, 'state'), embed, embeddingModel: 'toy-v2' });
    await expect(other.search('ship', { mode: 'semantic' })).rejects.toThrow(FuryKnowledgeError);
    expect((await other.ingest(docs, { label: 'docs' })).embedded).toBe((await other.stats()).chunks);
  });

  it('builds grounded prompts and rejects bad inputs', async () => {
    const { root } = corpus();
    const kb = createFuryKnowledgeBase({ stateDir: join(root, 'state') });
    await expect(kb.ingest(join(root, 'missing'))).rejects.toThrow(/existing directory/u);
    await expect(kb.search('  ')).rejects.toThrow(/query/u);
    await expect(kb.ingest(root, { label: '../x' })).rejects.toThrow(/label/u);
    const prompt = furyGroundedPrompt('q?', [{ citation: 'a.md:1-2', path: 'a.md', startLine: 1, endLine: 2, heading: 'H', snippet: 'body', score: 1, scores: {}, why: '' }]);
    expect(prompt).toContain('[1] a.md:1-2 — H');
    expect(prompt).toContain('say so');
  });
});
