// Packs the current build with npm and records a platform-independent content
// digest of the tarball: one sha256 per packed file plus its mode, sorted by
// path. The CI matrix runs this on Linux, macOS and Windows across every
// supported Node line; identical contentDigest values prove the packaged bytes
// do not depend on the build OS. The gzip/tar container digest is reported
// too, but it also depends on the npm version that performed the pack, so the
// canonical release tarball is the one produced by the RC Preparation job.
//
// The pack fails closed if any packed file contains a CR byte: the canonical
// package is LF-only, and a CR means a line-ending conversion leaked in.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

const execFileAsync = promisify(execFile);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function npmInvocation(args) {
  if (process.platform !== 'win32') return { file: 'npm', args };
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(npmCli)) throw new Error(`bundled npm CLI not found: ${npmCli}`);
  return { file: process.execPath, args: [npmCli, ...args] };
}

async function npm(args, cwd) {
  const invocation = npmInvocation(args);
  const { stdout } = await execFileAsync(invocation.file, invocation.args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    shell: false,
  });
  return stdout;
}

function field(block, offset, length) {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

function paxPath(data) {
  let offset = 0;
  let found;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(data.subarray(offset, space).toString('utf8'));
    if (!Number.isSafeInteger(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq !== -1 && record.slice(0, eq) === 'path') found = record.slice(eq + 1);
    offset += length;
  }
  return found;
}

function readTarEntries(tar) {
  const entries = [];
  let offset = 0;
  let pendingPath;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = field(header, 0, 100);
    const mode = Number.parseInt(field(header, 100, 8).trim() || '0', 8);
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 0x30);
    const prefix = field(header, 345, 155);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      pendingPath = paxPath(data);
      continue;
    }
    if (type === 'g') continue;
    const entryPath = pendingPath ?? (prefix ? `${prefix}/${name}` : name);
    pendingPath = undefined;
    if (type !== '0' && type !== '\0') {
      throw new Error(`unexpected non-file tar entry ${entryPath} (type ${JSON.stringify(type)})`);
    }
    entries.push({ path: entryPath, mode: mode & 0o777, bytes: Buffer.from(data) });
  }
  return entries;
}

async function main() {
  const root = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'furypipe-package-repro-'));
  try {
    const packed = JSON.parse(await npm(['pack', '--json', '--ignore-scripts', '--quiet', '--pack-destination', workspace], root))[0];
    if (!packed?.filename) throw new Error('npm pack returned no tarball');
    const tarball = await readFile(path.join(workspace, packed.filename));
    const entries = readTarEntries(gunzipSync(tarball)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    if (entries.length !== packed.entryCount) {
      throw new Error(`tar entry count ${entries.length} does not match npm entryCount ${packed.entryCount}`);
    }
    const withCarriageReturn = entries.filter((entry) => entry.bytes.includes(0x0d)).map((entry) => entry.path);
    if (withCarriageReturn.length > 0) {
      throw new Error(`packed files contain CR bytes (line-ending conversion leaked into the package): ${withCarriageReturn.slice(0, 20).join(', ')}${withCarriageReturn.length > 20 ? ` (+${withCarriageReturn.length - 20} more)` : ''}`);
    }
    const manifest = entries.map((entry) => `${entry.path}\t${entry.mode.toString(8)}\t${sha256(entry.bytes)}\n`).join('');
    const evidence = {
      format: 'furypipe-package-reproducibility/v1',
      status: 'PASS',
      sourceCommit: process.env.FURYPIPE_SOURCE_COMMIT?.trim() || 'not-bound',
      platform: { os: process.platform, arch: process.arch, node: process.version, npm: (await npm(['--version'], root)).trim() },
      package: { name: packed.name, version: packed.version, fileCount: entries.length, unpackedSize: packed.unpackedSize },
      contentDigest: sha256(Buffer.from(manifest, 'utf8')),
      carriageReturnFiles: 0,
      tarballSha256: sha256(tarball),
      tarballBytes: tarball.length,
      note: 'contentDigest is the cross-platform identity; tarballSha256 also depends on the npm version that packed it',
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    process.stdout.write(serialized);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Package reproducibility\n\n\`\`\`json\n${serialized}\`\`\`\n`);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
