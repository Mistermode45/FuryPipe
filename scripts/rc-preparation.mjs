import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const OUT = join(ROOT, 'artifacts', 'rc-preparation');
const SOURCE_COMMIT = process.env.FURYPIPE_SOURCE_COMMIT || '';
const RUN_ID = process.env.GITHUB_RUN_ID || 'local';
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run(binary, args, cwd = ROOT, options = {}) {
  try {
    return await execFileAsync(binary, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      ...options,
    });
  } catch (error) {
    const stdout = error && error.stdout ? String(error.stdout) : '';
    const stderr = error && error.stderr ? String(error.stderr) : '';
    const detail = [error && error.message, stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    throw new Error(binary + ' ' + args.join(' ') + ' failed:\n' + detail);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseStableSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (!match) return undefined;
  return match.slice(1).map(Number);
}

function compareSemver(a, b) {
  const aa = parseStableSemver(a);
  const bb = parseStableSemver(b);
  if (!aa || !bb) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (aa[index] !== bb[index]) return aa[index] - bb[index];
  }
  return 0;
}

function normalizeRepositoryUrl(value) {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && typeof value.url === 'string'
      ? value.url
      : '';
  return raw
    .toLowerCase()
    .replace(/^git\+/u, '')
    .replace(/^git@github\.com:/u, 'https://github.com/')
    .replace(/\.git$/u, '')
    .replace(/\/$/u, '');
}

async function installedPackage(dir, name) {
  return JSON.parse(await readFile(join(dir, 'node_modules', name, 'package.json'), 'utf8'));
}

async function verifyInstalledCli(dir, name, expectedVersion) {
  const pkg = await installedPackage(dir, name);
  assert(pkg.version === expectedVersion, 'installed package version mismatch');
  const cli = join(dir, 'node_modules', name, 'bin', 'cli.js');
  const version = await run(process.execPath, [cli, '--version'], dir);
  assert(version.stdout.trim() === expectedVersion, 'CLI version mismatch');
  const help = await run(process.execPath, [cli, '--help'], dir);
  assert(/FuryPipe/u.test(help.stdout), 'installed CLI help lost FuryPipe branding');
  return pkg;
}

async function freshInstallSmoke(npm, tarball, name, version) {
  const dir = await mkdtemp(join(tmpdir(), 'furypipe-rc-install-'));
  try {
    await run(npm, ['init', '-y'], dir);
    await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], dir);
    const pkg = await verifyInstalledCli(dir, name, version);
    const exportSmoke = await run(process.execPath, [
      '--input-type=module',
      '-e',
      [
        "const root = await import('furypipe');",
        "const mcp = await import('furypipe/mcp-modern');",
        "const agent = await import('furypipe/agent-runtime');",
        "if (typeof root.transformRequest !== 'function') process.exit(11);",
        "if (typeof mcp.createProductionMcpHandler !== 'function') process.exit(12);",
        "if (typeof agent.runAgent !== 'function') process.exit(13);",
      ].join(' '),
    ], dir);
    assert(exportSmoke.stderr === '', 'fresh install export smoke wrote stderr');
    return {
      packageName: pkg.name,
      packageVersion: pkg.version,
      repository: normalizeRepositoryUrl(pkg.repository),
    };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function findPreviousPublishedVersion(npm, name, currentVersion, expectedRepository) {
  try {
    const response = await run(npm, ['view', name, 'versions', '--json'], ROOT, {
      env: { ...process.env, npm_config_loglevel: 'silent' },
    });
    const parsed = JSON.parse(response.stdout || '[]');
    const versions = (Array.isArray(parsed) ? parsed : [parsed])
      .filter((value) => typeof value === 'string' && parseStableSemver(value))
      .filter((value) => compareSemver(value, currentVersion) < 0)
      .sort(compareSemver);
    const candidate = versions.at(-1);
    if (!candidate) return { state: 'NOT_EXECUTED', reason: 'no earlier stable public version exists' };

    const metadataResponse = await run(npm, ['view', name + '@' + candidate, 'repository', '--json'], ROOT, {
      env: { ...process.env, npm_config_loglevel: 'silent' },
    });
    const repository = normalizeRepositoryUrl(JSON.parse(metadataResponse.stdout || 'null'));
    if (!repository || repository !== expectedRepository) {
      return {
        state: 'BLOCKED',
        reason: 'previous public package repository mismatch: ' + (repository || 'missing'),
        version: candidate,
      };
    }
    return { state: 'VERIFIED', version: candidate, repository };
  } catch (error) {
    return {
      state: 'NOT_EXECUTED',
      reason: 'npm registry lookup unavailable: ' + (error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)),
    };
  }
}

async function upgradeRollbackSmoke(npm, tarball, name, currentVersion, previous) {
  if (previous.state !== 'VERIFIED' || !previous.version) {
    return {
      upgradeSmoke: previous.state,
      rollbackEvidence: previous.state,
      reason: previous.reason || 'previous version unavailable',
    };
  }

  const dir = await mkdtemp(join(tmpdir(), 'furypipe-rc-upgrade-'));
  try {
    await run(npm, ['init', '-y'], dir);
    await run(npm, ['install', name + '@' + previous.version, '--ignore-scripts', '--no-audit', '--no-fund'], dir);
    const prior = await installedPackage(dir, name);
    assert(prior.version === previous.version, 'previous package install version mismatch');

    await run(npm, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], dir);
    await verifyInstalledCli(dir, name, currentVersion);

    await run(npm, ['install', name + '@' + previous.version, '--ignore-scripts', '--no-audit', '--no-fund'], dir);
    const rolledBack = await installedPackage(dir, name);
    assert(rolledBack.version === previous.version, 'package-level rollback did not restore previous version');

    return {
      upgradeSmoke: 'VERIFIED',
      rollbackEvidence: 'VERIFIED',
      previousVersion: previous.version,
      note: 'package-level pre-publication upgrade/rollback only; no production deployment rollback is claimed',
    };
  } catch (error) {
    return {
      upgradeSmoke: 'BLOCKED',
      rollbackEvidence: 'BLOCKED',
      previousVersion: previous.version,
      reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function verifyDocument(path, requiredPatterns) {
  const content = await readFile(join(ROOT, path), 'utf8');
  assert(content.trim().length > 0, path + ' is empty');
  for (const pattern of requiredPatterns) assert(pattern.test(content), path + ' is missing required content');
  return {
    path,
    sha256: sha256(Buffer.from(content, 'utf8')),
    bytes: Buffer.byteLength(content, 'utf8'),
  };
}

async function generateSbom() {
  const treePath = join(OUT, 'dependency-tree.json');
  const sbomPath = join(OUT, 'sbom.spdx.json');
  const list = await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['list', '--json', '--depth', 'Infinity']);
  await writeFile(treePath, list.stdout, 'utf8');
  await run(process.execPath, ['scripts/security/generate-sbom.mjs', treePath, sbomPath]);
  const sbom = JSON.parse(await readFile(sbomPath, 'utf8'));
  assert(sbom.spdxVersion === 'SPDX-2.3', 'RC SBOM is not SPDX-2.3');
  assert(Array.isArray(sbom.packages) && sbom.packages.length > 0, 'RC SBOM contains no packages');
  return {
    path: 'artifacts/rc-preparation/sbom.spdx.json',
    sha256: sha256(await readFile(sbomPath)),
    packages: sbom.packages.length,
  };
}

async function main() {
  assert(SHA40.test(SOURCE_COMMIT), 'FURYPIPE_SOURCE_COMMIT must be an exact lowercase 40-character SHA');
  await mkdir(OUT, { recursive: true });

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert(typeof pkg.name === 'string' && pkg.name.length > 0, 'package name missing');
  assert(typeof pkg.version === 'string' && parseStableSemver(pkg.version), 'RC preparation requires a stable x.y.z package version');
  const expectedRepository = normalizeRepositoryUrl(pkg.repository);
  assert(expectedRepository === 'https://github.com/mistermode45/furypipe', 'unexpected package repository: ' + expectedRepository);

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packDir = join(OUT, 'package');
  await mkdir(packDir, { recursive: true });
  const packed = await run(npm, ['pack', '--json', '--ignore-scripts', '--quiet', '--pack-destination', packDir]);
  const metadata = JSON.parse(packed.stdout)[0];
  assert(metadata && metadata.filename && metadata.version === pkg.version, 'npm pack metadata identity mismatch');
  const tarball = resolve(packDir, metadata.filename);
  const tarBytes = await readFile(tarball);
  const packageSha256 = sha256(tarBytes);
  assert(SHA256.test(packageSha256), 'package SHA-256 generation failed');

  const freshInstall = await freshInstallSmoke(npm, tarball, pkg.name, pkg.version);
  assert(freshInstall.repository === expectedRepository, 'fresh-installed package repository metadata mismatch');

  const previous = await findPreviousPublishedVersion(npm, pkg.name, pkg.version, expectedRepository);
  const upgradeRollback = await upgradeRollbackSmoke(npm, tarball, pkg.name, pkg.version, previous);
  const sbom = await generateSbom();

  const documents = {
    compatibilityMatrix: await verifyDocument('COMPATIBILITY.md', [/Node\.js/u, /MCP/u, /Recovery/u]),
    migrationNotes: await verifyDocument('docs/release/MIGRATION_V5.md', [/Runtime baseline/u, /Upgrade rule/u]),
    rollbackPlan: await verifyDocument('docs/release/ROLLBACK.md', [/Before publication/u, /Runtime\/deployment rollback/u]),
    releaseNotesTemplate: await verifyDocument('docs/release/RELEASE_NOTES_TEMPLATE.md', [/Source identity/u, /Authorization record/u]),
  };

  const releaseNotesLines = [
    '# FuryPipe RC preparation evidence',
    '',
    '- Source commit: ' + SOURCE_COMMIT,
    '- Package: ' + pkg.name + '@' + pkg.version,
    '- Package SHA-256: ' + packageSha256,
    '- Channel: rc',
    '- Release actions executed: false',
    '- Performance claims: none',
    '',
    '## Locally verified preparation',
    '',
    '- exact npm tarball built from the candidate;',
    '- fresh install from that tarball;',
    '- CLI version/help and core package exports;',
    '- upgrade smoke: ' + upgradeRollback.upgradeSmoke + (upgradeRollback.previousVersion ? ' from ' + upgradeRollback.previousVersion : '') + ';',
    '- package-level rollback smoke: ' + upgradeRollback.rollbackEvidence + ';',
    '- SPDX 2.3 SBOM generated from the frozen dependency graph;',
    '- compatibility, migration and rollback documents present and hashed.',
    '',
    '## Explicit non-claims',
    '',
    '- no merge/tag/npm publish/GitHub Release/deployment was executed;',
    '- package-level rollback is not production deployment rollback;',
    '- provider performance benchmarks remain unclaimed unless separate provider-origin evidence exists;',
    '- hosted MCP/OAuth/provider/OpenClaw/Figma evidence remains separate.',
    '',
  ];
  const releaseNotes = releaseNotesLines.join('\n');
  await writeFile(join(OUT, 'RELEASE_NOTES_RC.md'), releaseNotes, 'utf8');
  const releaseNotesProof = {
    path: 'artifacts/rc-preparation/RELEASE_NOTES_RC.md',
    sha256: sha256(Buffer.from(releaseNotes, 'utf8')),
    bytes: Buffer.byteLength(releaseNotes, 'utf8'),
  };

  const observedAt = Date.now();
  const localRef = (name) => 'github-actions:' + RUN_ID + ':rc-preparation:' + name;
  const artifacts = {
    packageSmoke: 'VERIFIED',
    installationSmoke: 'VERIFIED',
    upgradeSmoke: upgradeRollback.upgradeSmoke,
    rollbackEvidence: upgradeRollback.rollbackEvidence,
    sbom: 'VERIFIED',
    provenance: 'PARTIAL',
    compatibilityMatrix: 'VERIFIED',
    migrationNotes: 'VERIFIED',
    releaseNotes: 'VERIFIED',
    packageSha256,
    proofs: {
      packageSmoke: { sourceCommit: SOURCE_COMMIT, observedAt, origin: 'local', reference: localRef('package-smoke') },
      installationSmoke: { sourceCommit: SOURCE_COMMIT, observedAt, origin: 'local', reference: localRef('fresh-install') },
      ...(upgradeRollback.upgradeSmoke === 'VERIFIED' ? {
        upgradeSmoke: { sourceCommit: SOURCE_COMMIT, observedAt, origin: 'local', reference: localRef('upgrade-from-' + upgradeRollback.previousVersion) },
      } : {}),
      ...(upgradeRollback.rollbackEvidence === 'VERIFIED' ? {
        rollbackEvidence: { sourceCommit: SOURCE_COMMIT, observedAt, origin: 'local', reference: localRef('package-rollback-to-' + upgradeRollback.previousVersion) },
      } : {}),
      sbom: { sourceCommit: SOURCE_COMMIT, observedAt, origin: 'github-actions', reference: localRef('sbom-spdx') },
      compatibilityMatrix: { sourceCommit: SOURCE_COMMIT, observedAt, origin: 'local', reference: localRef('compatibility-matrix') },
      migrationNotes: { sourceCommit: SOURCE_COMMIT, observedAt, origin: 'local', reference: localRef('migration-notes') },
      releaseNotes: { sourceCommit: SOURCE_COMMIT, observedAt, origin: 'local', reference: localRef('release-notes-rc') },
      packageSha256: {
        sourceCommit: SOURCE_COMMIT,
        observedAt,
        origin: 'github-actions',
        reference: localRef('package-sha256'),
        artifactSha256: packageSha256,
      },
    },
  };

  const evidence = {
    format: 'furypipe-rc-preparation-evidence/v1',
    generatedAt: Date.now(),
    sourceCommit: SOURCE_COMMIT,
    packageName: pkg.name,
    packageVersion: pkg.version,
    channel: 'rc',
    releaseActionsExecuted: false,
    tarball: {
      filename: basename(tarball),
      bytes: (await stat(tarball)).size,
      sha256: packageSha256,
    },
    freshInstall,
    previousPublishedVersion: previous,
    upgradeRollback,
    sbom,
    documents,
    releaseNotes: releaseNotesProof,
    artifacts,
    remainingExternalEvidence: [
      'release provenance attestation on an eligible non-PR event',
      'protected integration/release branch policy',
      'hosted MCP/OAuth/provider/OpenClaw/Figma evidence where required',
      'provider-origin benchmark evidence before any performance claim',
      'production deployment rollback evidence',
    ],
  };

  await writeFile(join(OUT, 'rc-preparation-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  await writeFile(join(OUT, 'package.sha256'), packageSha256 + '  ' + basename(tarball) + '\n', 'utf8');

  console.log('RC preparation package: ' + pkg.name + '@' + pkg.version);
  console.log('RC package SHA-256: ' + packageSha256);
  console.log('fresh install: VERIFIED');
  console.log('upgrade smoke: ' + upgradeRollback.upgradeSmoke);
  console.log('package rollback smoke: ' + upgradeRollback.rollbackEvidence);
  console.log('release actions executed: false');
}

await main();
