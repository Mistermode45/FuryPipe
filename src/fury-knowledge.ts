// FuryKnowledge — local document knowledge base with cited retrieval.
//
// Ingestion walks a directory (no symlinks, bounded files and sizes, vendor
// and build folders skipped), re-reads only files whose content changed, and
// chunks Markdown by heading and code/text by overlapping line windows.
// Retrieval is lexical (BM25), semantic (cosine over embeddings from an
// injected embedder, typically a loopback Ollama/LM Studio model) or hybrid
// (reciprocal rank fusion). Every hit carries a citation (path:lines),
// the heading it sits under and why it was retrieved.
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export type FuryEmbedder = (texts: readonly string[]) => Promise<readonly (readonly number[])[]>;
export type FuryRetrievalMode = 'lexical' | 'semantic' | 'hybrid';

export class FuryKnowledgeError extends Error {
  override readonly name = 'FuryKnowledgeError';
}

export interface FuryKnowledgeChunk {
  readonly id: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly heading: string;
  readonly text: string;
  readonly terms: readonly string[];
  vector?: readonly number[];
}

export interface FuryKnowledgeHit {
  readonly citation: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly heading: string;
  readonly snippet: string;
  readonly score: number;
  readonly scores: { readonly bm25?: number; readonly cosine?: number };
  readonly why: string;
}

interface IndexFile {
  format: 'furypipe-knowledge-base/v1';
  embeddingModel?: string;
  files: Record<string, { sha256: string; root: string }>;
  chunks: FuryKnowledgeChunk[];
}

const TEXT_EXT = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc', '.html', '.htm', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.c', '.h', '.cpp', '.hpp', '.swift', '.sh', '.sql', '.json', '.yaml', '.yml', '.toml', '.css']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', 'vendor', 'target', '__pycache__', '.venv', 'venv', 'artifacts', 'graphify-out']);
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_CHUNKS = 50_000;
const MAX_CHUNK_CHARS = 1_600;
const CODE_WINDOW = 60;
const CODE_OVERLAP = 10;
const RRF_K = 60;

const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with not no but if then else de la le les des du un une et est en pour par sur que qui dans au aux ce ces'.split(' '));

export function furyKnowledgeTerms(text: string): string[] {
  return (text.normalize('NFKD').replace(/\p{M}+/gu, '').match(/[\p{L}\p{N}_]{2,}/gu) ?? [])
    .flatMap((t) => {
      // Identifiers also index their parts: refreshToken → refreshtoken, refresh, token.
      const parts = t.split(/_|(?<=[a-z])(?=[A-Z])/u).filter(Boolean);
      return [t, ...(parts.length > 1 ? parts : [])].map((p) => p.toLowerCase());
    })
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function stripHtml(text: string): string {
  return text.replace(/<(script|style)[\s\S]*?<\/\1>/giu, ' ').replace(/<[^>]+>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>');
}

/** Split a file into citeable chunks (1-based inclusive line ranges). */
export function chunkFuryDocument(relPath: string, content: string): Omit<FuryKnowledgeChunk, 'id' | 'terms'>[] {
  const ext = path.extname(relPath).toLowerCase();
  const lines = (ext === '.html' || ext === '.htm' ? stripHtml(content) : content).split(/\r?\n/u);
  const chunks: Omit<FuryKnowledgeChunk, 'id' | 'terms'>[] = [];
  const push = (start: number, end: number, heading: string) => {
    while (end > start && !lines[end]!.trim()) end--;
    const text = lines.slice(start, end + 1).join('\n').trim();
    if (text) chunks.push({ path: relPath, startLine: start + 1, endLine: end + 1, heading, text: text.slice(0, MAX_CHUNK_CHARS * 2) });
  };
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown' || ext === '.rst' || ext === '.adoc' || ext === '.txt') {
    // Sections by heading, then split long sections by size on paragraph breaks.
    let heading = '';
    let start = 0;
    let size = 0;
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^\s*(```|~~~)/u.test(line)) fence = !fence;
      const h = !fence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line) : null;
      if (h && i > start) {
        push(start, i - 1, heading);
        start = i;
        size = 0;
      }
      if (h) heading = h[2]!;
      size += line.length + 1;
      if (size > MAX_CHUNK_CHARS && !fence && line.trim() === '') {
        push(start, i, heading);
        start = i + 1;
        size = 0;
      }
    }
    if (start < lines.length) push(start, lines.length - 1, heading);
    return chunks;
  }
  for (let start = 0; start < lines.length; start += CODE_WINDOW - CODE_OVERLAP) {
    const end = Math.min(lines.length - 1, start + CODE_WINDOW - 1);
    const decl = lines.slice(start, end + 1).find((l) => /^\s*(export\s+)?(async\s+)?(function|class|interface|def|fn|func|type|const)\s+\w+/u.test(l));
    push(start, end, decl?.trim().slice(0, 120) ?? '');
    if (end === lines.length - 1) break;
  }
  return chunks;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function createFuryKnowledgeBase(options: {
  readonly stateDir: string;
  readonly embed?: FuryEmbedder;
  /** Identity of the embedder; vectors from another model are discarded. */
  readonly embeddingModel?: string;
}) {
  const indexPath = path.join(options.stateDir, 'knowledge.json');
  let cache: IndexFile | undefined;

  const load = async (): Promise<IndexFile> => {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await readFile(indexPath, 'utf8')) as IndexFile;
      if (parsed?.format !== 'furypipe-knowledge-base/v1') throw new FuryKnowledgeError('knowledge index has an unknown format');
      cache = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      cache = { format: 'furypipe-knowledge-base/v1', files: {}, chunks: [] };
    }
    return cache;
  };
  const save = async (index: IndexFile) => {
    await mkdir(options.stateDir, { recursive: true });
    const tmp = `${indexPath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(index), { mode: 0o600 });
    await rename(tmp, indexPath);
  };

  const embedChunks = async (index: IndexFile, chunks: FuryKnowledgeChunk[]) => {
    if (!options.embed) return 0;
    if (index.embeddingModel !== options.embeddingModel) {
      for (const c of index.chunks) delete c.vector;
      index.embeddingModel = options.embeddingModel;
      chunks = index.chunks;
    }
    const todo = chunks.filter((c) => !c.vector);
    for (let i = 0; i < todo.length; i += 32) {
      const batch = todo.slice(i, i + 32);
      const vectors = await options.embed(batch.map((c) => `${c.heading}\n${c.text}`.slice(0, 4_000)));
      if (vectors.length !== batch.length) throw new FuryKnowledgeError('embedder returned a wrong number of vectors');
      batch.forEach((c, j) => { c.vector = vectors[j]; });
    }
    return todo.length;
  };

  return Object.freeze({
    /** Ingest (or refresh) every supported file under `root`; `label` scopes the stored paths. */
    async ingest(root: string, request: { readonly label?: string } = {}) {
      const absRoot = path.resolve(root);
      const label = request.label ?? path.basename(absRoot);
      if (!/^[\w.@-]{1,64}$/u.test(label)) throw new FuryKnowledgeError('invalid source label');
      const index = await load();
      const seen = new Set<string>();
      const files: string[] = [];
      const skipped: { path: string; reason: string }[] = [];
      const walk = async (dir: string, depth: number) => {
        if (depth > 12) return;
        for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          const full = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) { skipped.push({ path: path.relative(absRoot, full), reason: 'symlink' }); continue; }
          if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(full, depth + 1); continue; }
          if (!entry.isFile() || !TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
          if (files.length >= MAX_FILES) { skipped.push({ path: path.relative(absRoot, full), reason: 'file limit' }); continue; }
          files.push(full);
        }
      };
      const rootInfo = await lstat(absRoot).catch(() => undefined);
      if (!rootInfo?.isDirectory()) throw new FuryKnowledgeError('ingestion root must be an existing directory (not a symlink)');
      await walk(absRoot, 0);
      let added = 0;
      let unchanged = 0;
      const fresh: FuryKnowledgeChunk[] = [];
      for (const full of files) {
        const rel = `${label}/${path.relative(absRoot, full).split(path.sep).join('/')}`;
        seen.add(rel);
        const info = await lstat(full);
        if (info.size > MAX_FILE_BYTES) { skipped.push({ path: rel, reason: 'too large' }); continue; }
        const buf = await readFile(full);
        if (buf.includes(0)) { skipped.push({ path: rel, reason: 'binary' }); continue; }
        const sha256 = createHash('sha256').update(buf).digest('hex');
        if (index.files[rel]?.sha256 === sha256) { unchanged++; continue; }
        index.chunks = index.chunks.filter((c) => c.path !== rel);
        for (const c of chunkFuryDocument(rel, buf.toString('utf8'))) {
          const chunk: FuryKnowledgeChunk = { ...c, id: createHash('sha256').update(`${rel}\0${c.startLine}\0${c.text}`).digest('hex').slice(0, 24), terms: furyKnowledgeTerms(`${c.heading} ${c.text}`) };
          fresh.push(chunk);
          index.chunks.push(chunk);
        }
        index.files[rel] = { sha256, root: label };
        added++;
      }
      let removed = 0;
      for (const [rel, meta] of Object.entries(index.files)) {
        if (meta.root === label && !seen.has(rel)) {
          delete index.files[rel];
          index.chunks = index.chunks.filter((c) => c.path !== rel);
          removed++;
        }
      }
      if (index.chunks.length > MAX_CHUNKS) throw new FuryKnowledgeError(`knowledge base exceeds ${MAX_CHUNKS} chunks`);
      const embedded = await embedChunks(index, fresh);
      await save(index);
      return Object.freeze({ label, filesIndexed: added, filesUnchanged: unchanged, filesRemoved: removed, chunks: index.chunks.length, embedded, skipped: skipped.slice(0, 100) });
    },

    async search(query: string, request: { readonly limit?: number; readonly mode?: FuryRetrievalMode } = {}): Promise<{ readonly mode: FuryRetrievalMode; readonly hits: readonly FuryKnowledgeHit[] }> {
      if (typeof query !== 'string' || !query.trim() || query.length > 4_000) throw new FuryKnowledgeError('query is required');
      const index = await load();
      const limit = Math.max(1, Math.min(50, request.limit ?? 8));
      const wantSemantic = (request.mode ?? 'hybrid') !== 'lexical';
      const canSemantic = Boolean(options.embed) && index.embeddingModel === options.embeddingModel && index.chunks.some((c) => c.vector);
      const mode: FuryRetrievalMode = request.mode === 'semantic' && !canSemantic
        ? (() => { throw new FuryKnowledgeError('semantic retrieval needs an embedding model; none is configured or the index was built without one'); })()
        : wantSemantic && canSemantic ? (request.mode ?? 'hybrid') : 'lexical';

      const qTerms = [...new Set(furyKnowledgeTerms(query))];
      const bm25 = new Map<string, { score: number; matched: string[] }>();
      if (mode !== 'semantic' && qTerms.length) {
        const n = index.chunks.length;
        const avg = index.chunks.reduce((s, c) => s + c.terms.length, 0) / Math.max(1, n);
        const df = new Map<string, number>();
        for (const c of index.chunks) for (const t of new Set(c.terms)) if (qTerms.includes(t)) df.set(t, (df.get(t) ?? 0) + 1);
        for (const c of index.chunks) {
          let score = 0;
          const matched: string[] = [];
          const tf = new Map<string, number>();
          for (const t of c.terms) if (df.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
          for (const [t, f] of tf) {
            const idf = Math.log(1 + (n - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
            score += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * c.terms.length / avg));
            matched.push(t);
          }
          if (score > 0) bm25.set(c.id, { score, matched });
        }
      }
      const cos = new Map<string, number>();
      if (mode !== 'lexical') {
        const [qv] = await options.embed!([query]);
        for (const c of index.chunks) if (c.vector) cos.set(c.id, cosine(qv!, c.vector));
      }
      const rank = (m: Map<string, number>) => new Map([...m].sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1]));
      const lexRank = rank(new Map([...bm25].map(([id, v]) => [id, v.score])));
      const semRank = rank(new Map([...cos].filter(([, v]) => v > 0)));
      const fused = new Map<string, number>();
      for (const [id, r] of lexRank) fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + r));
      if (mode !== 'lexical') for (const [id, r] of [...semRank].slice(0, 200)) fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + r));
      const byId = new Map(index.chunks.map((c) => [c.id, c]));
      const hits = [...fused].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([id, score]): FuryKnowledgeHit => {
        const c = byId.get(id)!;
        const lex = bm25.get(id);
        const sem = cos.get(id);
        const why = [lex ? `terms: ${lex.matched.slice(0, 8).join(', ')}` : '', sem !== undefined && semRank.has(id) ? `semantic rank ${semRank.get(id)} (cosine ${sem.toFixed(3)})` : ''].filter(Boolean).join('; ');
        return Object.freeze({
          citation: `${c.path}:${c.startLine}-${c.endLine}`, path: c.path, startLine: c.startLine, endLine: c.endLine, heading: c.heading,
          snippet: c.text.slice(0, 400), score: Number(score.toFixed(6)),
          scores: Object.freeze({ ...(lex ? { bm25: Number(lex.score.toFixed(4)) } : {}), ...(sem !== undefined ? { cosine: Number(sem.toFixed(4)) } : {}) }),
          why,
        });
      });
      return Object.freeze({ mode, hits: Object.freeze(hits) });
    },

    async stats() {
      const index = await load();
      const roots = new Map<string, number>();
      for (const f of Object.values(index.files)) roots.set(f.root, (roots.get(f.root) ?? 0) + 1);
      return Object.freeze({ files: Object.keys(index.files).length, chunks: index.chunks.length, embedded: index.chunks.filter((c) => c.vector).length, embeddingModel: index.embeddingModel ?? null, sources: Object.fromEntries(roots) });
    },

    async forget(label: string) {
      const index = await load();
      const before = index.chunks.length;
      const drop = new Set(Object.entries(index.files).filter(([, m]) => m.root === label).map(([rel]) => rel));
      for (const rel of drop) delete index.files[rel];
      index.chunks = index.chunks.filter((c) => !drop.has(c.path));
      await save(index);
      return { files: drop.size, chunks: before - index.chunks.length };
    },
  });
}

/** Build a grounded prompt: the model must answer from numbered sources and cite them. */
export function furyGroundedPrompt(question: string, hits: readonly FuryKnowledgeHit[]): string {
  const sources = hits.map((h, i) => `[${i + 1}] ${h.citation}${h.heading ? ` — ${h.heading}` : ''}\n${h.snippet}`).join('\n\n');
  return `Answer using only the sources below. Cite them as [n]. If the sources do not contain the answer, say so.\n\nSources:\n${sources}\n\nQuestion: ${question}`;
}

export type FuryKnowledgeBase = ReturnType<typeof createFuryKnowledgeBase>;
