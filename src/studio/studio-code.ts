// Studio Code: read-only repository explorer, worktree list and diffs.
// Paths are resolved inside the project (realpath, no symlink escape);
// git runs without a shell, with bounded output. Nothing here writes.
import { execFile } from 'node:child_process';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_FILE = 512 * 1024;
const MAX_DIFF = 1024 * 1024;
const HIDDEN = new Set(['.git', 'node_modules']);

export class StudioCodeError extends Error {
  override readonly name = 'StudioCodeError';
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function git(cwd: string, args: string[], maxBuffer = MAX_DIFF): Promise<string> {
  return new Promise((resolve, reject) => execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, shell: false, windowsHide: true, maxBuffer, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } }, (e, out) => (e ? reject(new StudioCodeError(e.message.includes('maxBuffer') ? 413 : 409, e.message.includes('maxBuffer') ? 'output too large' : 'git command failed')) : resolve(String(out)))));
}

async function inside(root: string, rel: unknown): Promise<string> {
  if (typeof rel !== 'string' || rel.length > 1_024 || rel.includes('\0') || path.isAbsolute(rel)) throw new StudioCodeError(400, 'path must be relative to the project');
  const realRoot = await realpath(root);
  const target = path.resolve(realRoot, rel || '.');
  let real: string;
  try {
    real = await realpath(target);
  } catch {
    throw new StudioCodeError(404, 'path not found');
  }
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) throw new StudioCodeError(403, 'path leaves the project');
  return real;
}

export function createStudioCode(projectRoot: string) {
  return Object.freeze({
    async tree(rel: unknown) {
      const dir = await inside(projectRoot, rel ?? '');
      if (!(await lstat(dir)).isDirectory()) throw new StudioCodeError(400, 'not a directory');
      const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => !HIDDEN.has(e.name)).slice(0, 2_000);
      const realRoot = await realpath(projectRoot);
      return {
        path: path.relative(realRoot, dir).split(path.sep).join('/'),
        entries: entries.map((e) => ({ name: e.name, kind: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file' })).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)),
      };
    },
    async file(rel: unknown) {
      const file = await inside(projectRoot, rel);
      const info = await lstat(file);
      if (!info.isFile()) throw new StudioCodeError(400, 'not a file');
      if (info.size > MAX_FILE) throw new StudioCodeError(413, `file larger than ${MAX_FILE} bytes`);
      const buf = await readFile(file);
      if (buf.includes(0)) return { path: rel, binary: true, bytes: info.size };
      return { path: rel, binary: false, bytes: info.size, content: buf.toString('utf8') };
    },
    async worktrees() {
      const out = await git(projectRoot, ['worktree', 'list', '--porcelain'], 256 * 1024);
      const list: { path: string; head?: string; branch?: string; detached?: boolean }[] = [];
      let cur: { path: string; head?: string; branch?: string; detached?: boolean } | undefined;
      for (const line of out.split('\n')) {
        if (line.startsWith('worktree ')) list.push((cur = { path: line.slice(9) }));
        else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5);
        else if (cur && line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//u, '');
        else if (cur && line === 'detached') cur.detached = true;
      }
      return Promise.all(list.slice(0, 64).map(async (w) => {
        const status = await git(w.path, ['status', '--porcelain=v1', '--untracked-files=normal'], 256 * 1024).catch(() => '');
        return { ...w, changedFiles: status.split('\n').filter(Boolean).length };
      }));
    },
    /** Diff of a listed worktree: uncommitted changes, or its commits since `base` when given. */
    async diff(worktree: unknown, base?: unknown) {
      const known = await this.worktrees();
      const w = known.find((x) => x.path === worktree);
      if (!w) throw new StudioCodeError(404, 'not a worktree of this project');
      if (base !== undefined && (typeof base !== 'string' || !/^[0-9a-f]{7,64}$/u.test(base))) throw new StudioCodeError(400, 'base must be a commit id');
      const args = base ? ['diff', '--no-color', '--no-ext-diff', `${base}..HEAD`] : ['diff', '--no-color', '--no-ext-diff', 'HEAD'];
      const [patch, stat] = await Promise.all([git(w.path, args), git(w.path, [...args.slice(0, 3), '--numstat', ...args.slice(3)])]);
      return {
        worktree: w.path, branch: w.branch ?? null, base: base ?? 'HEAD (uncommitted)',
        files: stat.split('\n').filter(Boolean).map((l) => { const [add, del, file] = l.split('\t'); return { file, added: Number(add) || 0, removed: Number(del) || 0 }; }),
        patch,
      };
    },
  });
}
