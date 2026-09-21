import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

export const FURY_CODEGRAPH_FORMAT = 'furypipe-codegraph/v1' as const;

export type CodeGraphConfidence = 'structural' | 'heuristic' | 'unknown';
export type CodeGraphBuildMode = 'full' | 'incremental';

export interface CodeGraphFile {
  readonly path: string;
  readonly language: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly binary: boolean;
}

export interface CodeGraphSymbol {
  readonly symbolId: string;
  readonly filePath: string;
  readonly name: string;
  readonly kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum';
  readonly line: number;
  readonly exported: boolean;
  readonly confidence: CodeGraphConfidence;
}

export interface CodeGraphImport {
  readonly filePath: string;
  readonly specifier: string;
  readonly resolvedPath?: string;
  readonly externalPackage?: string;
  readonly confidence: CodeGraphConfidence;
}

export interface CodeGraphReference {
  readonly filePath: string;
  readonly symbolId?: string;
  readonly name: string;
  readonly line: number;
  readonly confidence: CodeGraphConfidence;
}

export interface CodeGraphTestRelation {
  readonly testFile: string;
  readonly targetFile?: string;
  readonly symbolName?: string;
  readonly relation: 'imports' | 'filename' | 'co-located';
  readonly confidence: CodeGraphConfidence;
}

export interface CodeGraphPackageRelation {
  readonly packagePath: string;
  readonly manifestPath: string;
  readonly name?: string;
  readonly workspaceRoot?: string;
  readonly relation: 'package' | 'workspace-member';
  readonly confidence: CodeGraphConfidence;
}

export interface CodeGraphOwnershipLink {
  readonly filePath: string;
  readonly owner: string;
  readonly confidence: CodeGraphConfidence;
}

export interface CodeGraphIndex {
  readonly format: typeof FURY_CODEGRAPH_FORMAT;
  readonly repositoryRoot: string;
  readonly repositoryId: string;
  readonly builtAt: number;
  readonly mode: CodeGraphBuildMode;
  readonly reusedFiles: number;
  readonly files: readonly CodeGraphFile[];
  readonly symbols: readonly CodeGraphSymbol[];
  readonly imports: readonly CodeGraphImport[];
  readonly references: readonly CodeGraphReference[];
  readonly tests: readonly CodeGraphTestRelation[];
  readonly packages: readonly CodeGraphPackageRelation[];
  readonly ownership: readonly CodeGraphOwnershipLink[];
  readonly limits: Readonly<{
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxSymbols: number;
    readonly maxReferences: number;
  }>;
  readonly executionAuthority: false;
}

export interface CodeGraphOptions {
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxSymbols?: number;
  readonly maxReferences?: number;
  readonly now?: () => number;
  readonly ignoredDirectories?: readonly string[];
}

interface CachedFile {
  readonly file: CodeGraphFile;
  readonly text?: string;
}

const DEFAULT_MAX_FILES = 4096;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SYMBOLS = 32_768;
const DEFAULT_MAX_REFERENCES = 131_072;
const DEFAULT_IGNORED = ['.git', 'node_modules', 'dist', 'build', 'coverage', 'artifacts'];
const TEXT_EXTENSIONS = new Map<string, string>([
  ['.ts', 'typescript'], ['.tsx', 'typescript-react'], ['.js', 'javascript'],
  ['.jsx', 'javascript-react'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.json', 'json'], ['.md', 'markdown'], ['.yml', 'yaml'], ['.yaml', 'yaml'],
  ['.css', 'css'], ['.html', 'html'], ['.sql', 'sql'], ['.sh', 'shell'],
  ['.ps1', 'powershell'],
]);
const SYMBOL_RE = /^\s*(export\s+)?(?:(?:async)\s+)?(function|class|interface|type|const|let|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gmu;
const IMPORT_RE = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/gmu;
const WORD_RE = /[A-Za-z_$][A-Za-z0-9_$]*/gu;

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function option(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new RangeError(label + ' must be between ' + min + ' and ' + max);
  return resolved;
}

function languageFor(path: string): string {
  return TEXT_EXTENSIONS.get(extname(path).toLowerCase()) ?? 'unknown';
}

function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

function safeRootPath(root: string): Promise<string> {
  return realpath(resolve(root));
}

async function walk(root: string, ignored: ReadonlySet<string>, maxFiles: number): Promise<readonly string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (output.length >= maxFiles) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (output.length >= maxFiles) return;
      if (ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        output.push(path);
      }
    }
  };
  await visit(root);
  return Object.freeze(output);
}

async function readCachedFile(
  root: string,
  path: string,
  maxFileBytes: number,
  previous: ReadonlyMap<string, CachedFile>,
): Promise<{ readonly cached: CachedFile; readonly reused: boolean }> {
  const bytes = new Uint8Array(await readFile(path));
  const relative = relativePath(root, path);
  const file: CodeGraphFile = Object.freeze({
    path: relative,
    language: languageFor(relative),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    binary: bytes.includes(0),
  });
  const old = previous.get(relative);
  if (old && old.file.sha256 === file.sha256 && old.file.bytes === file.bytes) return Object.freeze({ cached: old, reused: true });
  if (bytes.byteLength > maxFileBytes || file.binary || file.language === 'unknown') return Object.freeze({ cached: Object.freeze({ file }), reused: false });
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return Object.freeze({ cached: Object.freeze({ file, text }), reused: false });
}

function resolveImport(root: string, fromFile: string, specifier: string, files: ReadonlySet<string>): { readonly resolvedPath?: string; readonly externalPackage?: string } {
  if (!specifier.startsWith('.')) return Object.freeze({ externalPackage: specifier.split('/')[0] });
  const importedPath = resolve(root, dirname(fromFile), specifier);
  const base = importedPath.replace(/\.(?:[cm]?js|jsx)$/iu, '');
  const candidates = [
    importedPath, base, base + '.ts', base + '.tsx', base + '.js', base + '.jsx',
    join(base, 'index.ts'), join(base, 'index.js'),
  ];
  const resolved = candidates.map((candidate) => relativePath(root, candidate)).find((candidate) => files.has(candidate));
  return resolved === undefined ? Object.freeze({}) : Object.freeze({ resolvedPath: resolved });
}

function symbolId(repositoryId: string, filePath: string, name: string, line: number): string {
  return 'cgs_' + sha256(repositoryId + '\0' + filePath + '\0' + name + '\0' + line).slice(0, 32);
}

function packageManifest(text: string): { readonly name?: string; readonly workspaces: readonly string[] } | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const name = typeof record.name === 'string' && record.name.length > 0 && record.name.length <= 256 ? record.name : undefined;
    const raw = Array.isArray(record.workspaces)
      ? record.workspaces
      : record.workspaces && typeof record.workspaces === 'object' && !Array.isArray(record.workspaces)
        ? (record.workspaces as Record<string, unknown>).packages
        : undefined;
    const workspaces = Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512)
      : [];
    return Object.freeze({ ...(name === undefined ? {} : { name }), workspaces: Object.freeze(workspaces) });
  } catch {
    return undefined;
  }
}

function workspacePattern(pattern: string, packagePath: string): boolean {
  const normalizedPattern = pattern.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '') || '.';
  const normalizedPath = packagePath || '.';
  let source = '^';
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    if (character === '*' && normalizedPattern[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character?.replace(/[\\^$+?.()|[\]{}]/gu, '\\$&') ?? '';
    }
  }
  source += '$';
  return new RegExp(source, 'u').test(normalizedPath);
}

function packageRelations(root: string, files: readonly CodeGraphFile[], cache: ReadonlyMap<string, CachedFile>): readonly CodeGraphPackageRelation[] {
  const manifests = files
    .filter((file) => file.path === 'package.json' || file.path.endsWith('/package.json'))
    .map((file) => {
      const entry = cache.get(file.path);
      const parsed = entry?.text === undefined ? undefined : packageManifest(entry.text);
      return Object.freeze({ file, parsed });
    });
  const output: CodeGraphPackageRelation[] = [];
  for (const manifest of manifests) {
    const packagePath = dirname(manifest.file.path).replace(/\\/gu, '/');
    const packageDir = packagePath === '.' ? '' : packagePath;
    output.push(Object.freeze({
      packagePath: packageDir,
      manifestPath: manifest.file.path,
      ...(manifest.parsed?.name === undefined ? {} : { name: manifest.parsed.name }),
      relation: 'package' as const,
      confidence: manifest.parsed === undefined ? 'unknown' as const : 'structural' as const,
    }));
  }
  const workspaceRoots = manifests.filter((manifest) => (manifest.parsed?.workspaces.length ?? 0) > 0);
  for (const manifest of manifests) {
    const packagePath = dirname(manifest.file.path).replace(/\\/gu, '/');
    const packageDir = packagePath === '.' ? '' : packagePath;
    for (const workspaceRoot of workspaceRoots) {
      const rootPath = dirname(workspaceRoot.file.path).replace(/\\/gu, '/');
      const rootDir = rootPath === '.' ? '' : rootPath;
      if (packageDir === rootDir) continue;
      const relativePackagePath = rootDir === ''
        ? packageDir
        : packageDir.startsWith(rootDir + '/') ? packageDir.slice(rootDir.length + 1) : undefined;
      if (relativePackagePath === undefined) continue;
      if (!workspaceRoot.parsed?.workspaces.some((pattern) => workspacePattern(pattern, relativePackagePath))) continue;
      output.push(Object.freeze({
        packagePath: packageDir,
        manifestPath: manifest.file.path,
        ...(manifest.parsed?.name === undefined ? {} : { name: manifest.parsed.name }),
        workspaceRoot: rootDir,
        relation: 'workspace-member' as const,
        confidence: 'structural' as const,
      }));
    }
  }
  return Object.freeze(output.sort((left, right) => (left.manifestPath + left.relation).localeCompare(right.manifestPath + right.relation)));
}

export function createCodeGraphIndexer(rootPath: string, options: CodeGraphOptions = {}): {
  build(previous?: CodeGraphIndex): Promise<CodeGraphIndex>;
  update(previous: CodeGraphIndex, changedPaths: readonly string[]): Promise<CodeGraphIndex>;
} {
  const maxFiles = option(options.maxFiles, DEFAULT_MAX_FILES, 1, 100_000, 'maxFiles');
  const maxFileBytes = option(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, 1, 64 * 1024 * 1024, 'maxFileBytes');
  const maxSymbols = option(options.maxSymbols, DEFAULT_MAX_SYMBOLS, 1, 1_000_000, 'maxSymbols');
  const maxReferences = option(options.maxReferences, DEFAULT_MAX_REFERENCES, 1, 2_000_000, 'maxReferences');
  const now = options.now ?? Date.now;
  const ignored = new Set(options.ignoredDirectories ?? DEFAULT_IGNORED);
  let canonicalRootPromise: Promise<string> | undefined;
  let cache = new Map<string, CachedFile>();
  const build = async (previous?: CodeGraphIndex, incremental = false): Promise<CodeGraphIndex> => {
    const root = canonicalRootPromise ?? (canonicalRootPromise = safeRootPath(rootPath));
    const canonical = await root;
    const repositoryId = 'repo_' + sha256(canonical).slice(0, 32);
    const paths = await walk(canonical, ignored, maxFiles);
    const nextCache = new Map<string, CachedFile>();
    let reusedFiles = 0;
    for (const path of paths) {
      const result = await readCachedFile(canonical, path, maxFileBytes, cache);
      nextCache.set(result.cached.file.path, result.cached);
      if (result.reused) reusedFiles += 1;
    }
    cache = nextCache;
    const files = Object.freeze([...cache.values()].map((entry) => entry.file).sort((left, right) => left.path.localeCompare(right.path)));
    const fileSet = new Set(files.map((file) => file.path));
    const symbols: CodeGraphSymbol[] = [];
    const imports: CodeGraphImport[] = [];
    for (const entry of [...cache.values()].sort((left, right) => left.file.path.localeCompare(right.file.path))) {
      if (!entry.text) continue;
      SYMBOL_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SYMBOL_RE.exec(entry.text)) !== null && symbols.length < maxSymbols) {
        const exported = match[1] !== undefined;
        const kind = match[2];
        const name = match[3];
        if (!kind || !name) continue;
        symbols.push(Object.freeze({
          symbolId: symbolId(repositoryId, entry.file.path, name, lineAt(entry.text, match.index)),
          filePath: entry.file.path,
          name,
          kind: kind === 'const' || kind === 'let' ? 'variable' : kind as CodeGraphSymbol['kind'],
          line: lineAt(entry.text, match.index),
          exported,
          confidence: 'heuristic',
        }));
      }
      IMPORT_RE.lastIndex = 0;
      let importMatch: RegExpExecArray | null;
      while ((importMatch = IMPORT_RE.exec(entry.text)) !== null && imports.length < maxReferences) {
        const specifier = importMatch[1];
        if (!specifier) continue;
        const resolved = resolveImport(canonical, entry.file.path, specifier, fileSet);
        imports.push(Object.freeze({
          filePath: entry.file.path,
          specifier,
          ...(resolved.resolvedPath === undefined ? {} : { resolvedPath: resolved.resolvedPath }),
          ...(resolved.externalPackage === undefined ? {} : { externalPackage: resolved.externalPackage }),
          confidence: resolved.resolvedPath === undefined && resolved.externalPackage === undefined ? 'unknown' : 'structural',
        }));
      }
    }
    const symbolByName = new Map<string, CodeGraphSymbol[]>();
    for (const symbol of symbols) {
      const values = symbolByName.get(symbol.name) ?? [];
      values.push(symbol);
      symbolByName.set(symbol.name, values);
    }
    const references: CodeGraphReference[] = [];
    for (const entry of [...cache.values()]) {
      if (!entry.text || references.length >= maxReferences) continue;
      WORD_RE.lastIndex = 0;
      let word: RegExpExecArray | null;
      while ((word = WORD_RE.exec(entry.text)) !== null && references.length < maxReferences) {
        const candidates = symbolByName.get(word[0]);
        if (!candidates || candidates.length !== 1) continue;
        const candidate = candidates[0];
        if (!candidate) continue;
        if (candidate.filePath === entry.file.path && candidate.line === lineAt(entry.text, word.index)) continue;
        references.push(Object.freeze({
          filePath: entry.file.path,
          symbolId: candidate.symbolId,
          name: word[0],
          line: lineAt(entry.text, word.index),
          confidence: 'heuristic',
        }));
      }
    }
    const tests: CodeGraphTestRelation[] = [];
    const testFiles = files.filter((file) => /(?:^|\/)(?:tests?|__tests__)\/|(?:test|spec)\./iu.test(file.path));
    for (const test of testFiles) {
      const relatedImports = imports.filter((item) => item.filePath === test.path && item.resolvedPath !== undefined);
      if (relatedImports.length > 0) {
        for (const item of relatedImports) tests.push(Object.freeze({ testFile: test.path, targetFile: item.resolvedPath, relation: 'imports', confidence: 'structural' }));
      } else {
        const stem = basename(test.path).replace(/\.(?:test|spec)\.[^.]+$/iu, '').toLowerCase();
        const target = files.find((file) => basename(file.path).toLowerCase().startsWith(stem) && file.path !== test.path);
        tests.push(Object.freeze({ testFile: test.path, ...(target === undefined ? {} : { targetFile: target.path }), relation: 'filename', confidence: target === undefined ? 'unknown' : 'heuristic' }));
      }
    }
    const packages = packageRelations(canonical, files, cache);
    const ownership = Object.freeze(files.map((file) => Object.freeze({ filePath: file.path, owner: 'repository:' + repositoryId, confidence: 'structural' as const })));
    return Object.freeze({
      format: FURY_CODEGRAPH_FORMAT,
      repositoryRoot: canonical,
      repositoryId,
      builtAt: Number.isSafeInteger(now()) ? now() : Date.now(),
      mode: incremental ? 'incremental' as const : 'full' as const,
      reusedFiles,
      files,
      symbols: Object.freeze(symbols),
      imports: Object.freeze(imports),
      references: Object.freeze(references),
      tests: Object.freeze(tests),
      packages,
      ownership,
      limits: Object.freeze({ maxFiles, maxFileBytes, maxSymbols, maxReferences }),
      executionAuthority: false as const,
    });
  };
  return Object.freeze({
    build(previous?: CodeGraphIndex): Promise<CodeGraphIndex> {
      return build(previous, previous !== undefined);
    },
    update(previous: CodeGraphIndex, _changedPaths: readonly string[]): Promise<CodeGraphIndex> {
      if (!previous || previous.format !== FURY_CODEGRAPH_FORMAT) return Promise.reject(new Error('code graph previous index is invalid'));
      return build(previous, true);
    },
  });
}

export async function buildCodeGraph(rootPath: string, options: CodeGraphOptions = {}): Promise<CodeGraphIndex> {
  return createCodeGraphIndexer(rootPath, options).build();
}
