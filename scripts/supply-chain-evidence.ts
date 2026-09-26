#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  createFuryCycloneDxBom,
  createFurySupplyChainEvidence,
  type FuryResolvedPackageInput,
} from '../src/fury-supply-chain.js';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(
  process.env.FURYPIPE_SUPPLY_CHAIN_OUTPUT_DIR?.trim()
    || process.env.FURYPIPE_VALIDATION_OUTPUT_DIR?.trim()
    || 'artifacts/supply-chain',
);
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_COMPONENTS = 100_000;

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pnpmInvocation(args: readonly string[]): { file: string; args: readonly string[] } {
  const execPath = process.env.npm_execpath?.trim();
  if (execPath && /pnpm(?:\.c?js)?$/iu.test(execPath)) {
    return { file: process.execPath, args: [execPath, ...args] };
  }
  return { file: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args };
}

async function runPnpm(args: readonly string[]): Promise<string> {
  const command = pnpmInvocation(args);
  const { stdout } = await execFileAsync(command.file, [...command.args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: 120_000,
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      NO_COLOR: '1',
      CI: process.env.CI ?? '1',
    },
  });
  if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new Error('pnpm dependency inventory exceeds the output bound');
  }
  return stdout;
}

interface TreeNode {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly path?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly optionalDependencies?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dependencyMap(value: unknown): Readonly<Record<string, TreeNode>> {
  if (!isRecord(value)) return Object.freeze({});
  const out: Record<string, TreeNode> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isRecord(child)) out[key] = child;
  }
  return Object.freeze(out);
}

async function installedLicense(nodePath: unknown): Promise<string | null> {
  if (typeof nodePath !== 'string' || !nodePath || nodePath.length > 4096 || nodePath.includes('\0')) return null;
  try {
    const manifestPath = path.join(nodePath, 'package.json');
    const raw = await readFile(manifestPath, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) return null;
    const manifest = JSON.parse(raw) as { license?: unknown; licenses?: unknown };
    if (typeof manifest.license === 'string') return manifest.license;
    if (Array.isArray(manifest.licenses)) {
      const values = manifest.licenses.flatMap((item) => {
        if (typeof item === 'string') return [item];
        if (isRecord(item) && typeof item.type === 'string') return [item.type];
        return [];
      });
      if (values.length) return [...new Set(values)].sort().join(' OR ');
    }
  } catch {
    // Missing/unreadable manifests remain explicit unknown license evidence.
  }
  return null;
}

async function collectResolvedPackages(raw: unknown): Promise<readonly FuryResolvedPackageInput[]> {
  const roots = Array.isArray(raw) ? raw.filter(isRecord) : isRecord(raw) ? [raw] : [];
  if (roots.length === 0) throw new Error('pnpm list returned no project inventory');

  const output: FuryResolvedPackageInput[] = [];
  let seenNodes = 0;

  async function visitMap(
    map: unknown,
    inherited: { readonly direct: boolean; readonly dev: boolean; readonly optional: boolean },
    ancestry: ReadonlySet<string>,
  ): Promise<readonly string[]> {
    const entries = Object.entries(dependencyMap(map)).sort(([a], [b]) => a.localeCompare(b));
    const childKeys: string[] = [];
    for (const [declaredName, node] of entries) {
      seenNodes += 1;
      if (seenNodes > MAX_COMPONENTS) throw new Error('resolved dependency graph exceeds component bound');
      const name = typeof node.name === 'string' && node.name ? node.name : declaredName;
      const version = typeof node.version === 'string' ? node.version : '';
      if (!version) throw new Error(`resolved dependency ${declaredName} has no version`);
      const key = `${name.toLowerCase()}@${version}`;
      childKeys.push(key);
      if (ancestry.has(key)) continue;

      const nextAncestry = new Set(ancestry);
      nextAncestry.add(key);
      const productionChildren = await visitMap(node.dependencies, {
        direct: false,
        dev: inherited.dev,
        optional: inherited.optional,
      }, nextAncestry);
      const devChildren = await visitMap(node.devDependencies, {
        direct: false,
        dev: true,
        optional: inherited.optional,
      }, nextAncestry);
      const optionalChildren = await visitMap(node.optionalDependencies, {
        direct: false,
        dev: inherited.dev,
        optional: true,
      }, nextAncestry);
      const license = await installedLicense(node.path);
      output.push(Object.freeze({
        name,
        version,
        direct: inherited.direct,
        dev: inherited.dev,
        optional: inherited.optional,
        license,
        dependencies: Object.freeze([...new Set([
          ...productionChildren,
          ...devChildren,
          ...optionalChildren,
        ])].sort()),
      }));
    }
    return Object.freeze(childKeys);
  }

  for (const root of roots) {
    await visitMap(root.dependencies, { direct: true, dev: false, optional: false }, new Set());
    await visitMap(root.devDependencies, { direct: true, dev: true, optional: false }, new Set());
    await visitMap(root.optionalDependencies, { direct: true, dev: false, optional: true }, new Set());
  }

  return Object.freeze(output);
}

async function main(): Promise<void> {
  const [packageBytes, lockBytes, pnpmVersion, treeJson] = await Promise.all([
    readFile(path.join(ROOT, 'package.json')),
    readFile(path.join(ROOT, 'pnpm-lock.yaml')),
    runPnpm(['--version']).then((value) => value.trim()),
    runPnpm(['list', '--json', '--depth', 'Infinity']),
  ]);
  const manifest = JSON.parse(packageBytes.toString('utf8')) as { name?: unknown; version?: unknown };
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('package.json must declare name and version');
  }

  let tree: unknown;
  try {
    tree = JSON.parse(treeJson);
  } catch {
    throw new Error('pnpm list did not return valid JSON');
  }

  const resolvedPackages = await collectResolvedPackages(tree);
  const evidence = createFurySupplyChainEvidence({
    sourceCommit: process.env.FURYPIPE_SOURCE_COMMIT?.trim() || 'not-bound',
    packageName: manifest.name,
    packageVersion: manifest.version,
    packageJsonSha256: sha256(packageBytes),
    lockfileSha256: sha256(lockBytes),
    resolvedPackages,
    resolver: {
      tool: 'pnpm',
      version: pnpmVersion,
      command: ['pnpm', 'list', '--json', '--depth', 'Infinity'],
    },
  });
  const bom = createFuryCycloneDxBom(evidence);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const evidencePath = path.join(OUTPUT_DIR, 'supply-chain-evidence.json');
  const bomPath = path.join(OUTPUT_DIR, 'bom.cdx.json');
  await Promise.all([
    writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'),
    writeFile(bomPath, `${JSON.stringify(bom, null, 2)}\n`, 'utf8'),
  ]);

  process.stdout.write(`${JSON.stringify({
    format: evidence.format,
    sourceCommit: evidence.sourceCommit,
    evidenceDigestSha256: evidence.evidenceDigestSha256,
    summary: evidence.summary,
    signingStatus: evidence.signingStatus,
    cyclonedx: {
      specVersion: bom.specVersion,
      components: bom.components.length,
      dependencies: bom.dependencies.length,
      completeness: 'observed-resolver-tree; not asserted beyond resolver output',
    },
    outputs: {
      evidence: path.relative(ROOT, evidencePath),
      bom: path.relative(ROOT, bomPath),
    },
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
