import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SPDX SBOM generator', () => {
  it('preserves pnpm package identities, aliases, graph edges and deterministic source binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-sbom-'));
    roots.push(root);
    const input = join(root, 'pnpm-list.json');
    const output = join(root, 'sbom.spdx.json');
    const secondOutput = join(root, 'sbom-second.spdx.json');
    await writeFile(input, JSON.stringify([{
      name: 'furypipe',
      version: '0.13.2',
      dependencies: {
        json5: {
          from: 'json5',
          version: '2.2.3',
          dependencies: {
            minimist: { from: 'minimist', version: '1.2.8' },
            furypipe: { from: 'furypipe', version: '0.1.0' },
          },
        },
        'json-five': { from: 'json5', version: '2.2.3' },
        '@pkg-alias/core': { from: '@scope/real-core', version: '3.0.1' },
        'another-package': {
          from: 'another-package',
          version: '1.0.0',
          dependencies: { json5: { from: 'json5', version: '1.0.0' } },
        },
        'cycle-a': {
          from: 'cycle-a',
          version: '1.0.0',
          dependencies: {
            'cycle-b': {
              from: 'cycle-b',
              version: '1.0.0',
              dependencies: { 'cycle-a': { from: 'cycle-a', version: '1.0.0' } },
            },
          },
        },
      },
      devDependencies: {
        vitest: { from: 'vitest', version: '4.0.18' },
      },
      optionalDependencies: {
        '@scope/pkg': { from: '@scope/pkg', version: '1.0.0' },
        'scope-pkg': { from: 'scope-pkg', version: '1.0.0' },
        'special-version': { from: 'special-version', version: '4.0.0-beta+build.5' },
      },
      // pnpm lockfile/internal metadata is not part of the list dependency graph.
      packages: { 'ghost@9.9.9': { name: 'ghost', version: '9.9.9' } },
    }]), 'utf8');

    const sourceCommit = 'a'.repeat(40);
    const env = { ...process.env, GITHUB_SHA: 'b'.repeat(40), FURYPIPE_SOURCE_COMMIT: sourceCommit };
    for (const target of [output, secondOutput]) {
      await execFileAsync(process.execPath, [
        'scripts/security/generate-sbom.mjs', input, target,
      ], { cwd: process.cwd(), env });
    }
    expect(await readFile(secondOutput, 'utf8')).toBe(await readFile(output, 'utf8'));

    const document = JSON.parse(await readFile(output, 'utf8')) as {
      spdxVersion: string;
      documentNamespace: string;
      packages: Array<{ name: string; versionInfo: string; SPDXID: string }>;
      relationships: Array<{ spdxElementId: string; relatedSpdxElement: string; relationshipType: string }>;
    };
    expect(document.spdxVersion).toBe('SPDX-2.3');
    expect(document.documentNamespace).toBe(`https://github.com/Mistermode45/FuryPipe/sbom/${sourceCommit}`);
    expect(document.packages.map((pkg) => [pkg.name, pkg.versionInfo])).toEqual(expect.arrayContaining([
      ['furypipe', '0.13.2'],
      ['json5', '2.2.3'],
      ['json5', '1.0.0'],
      ['minimist', '1.2.8'],
      ['vitest', '4.0.18'],
      ['@scope/real-core', '3.0.1'],
      ['@scope/pkg', '1.0.0'],
      ['scope-pkg', '1.0.0'],
      ['special-version', '4.0.0-beta+build.5'],
      ['furypipe', '0.1.0'],
      ['cycle-a', '1.0.0'],
      ['cycle-b', '1.0.0'],
    ]));
    expect(document.packages.some((pkg) => pkg.name === 'ghost')).toBe(false);
    expect(new Set(document.packages.map((pkg) => pkg.SPDXID)).size).toBe(document.packages.length);
    expect(document.packages.every((pkg) => /-[0-9a-f]{64}$/u.test(pkg.SPDXID))).toBe(true);
    const collidingSlugIds = document.packages
      .filter((pkg) => ['@scope/pkg', 'scope-pkg'].includes(pkg.name))
      .map((pkg) => pkg.SPDXID);
    expect(collidingSlugIds).toHaveLength(2);
    expect(new Set(collidingSlugIds).size).toBe(2);

    const packageJson = join(root, 'package.json');
    const manifest = {
      name: 'furypipe',
      version: '0.13.2',
      dependencies: {
        json5: '^2.2.3',
        'json-five': 'npm:json5@^2.2.3',
        '@pkg-alias/core': 'npm:@scope/real-core@^3.0.0',
        'another-package': '^1.0.0',
      },
      devDependencies: { vitest: '^4.0.18' },
      optionalDependencies: {
        '@scope/pkg': '^1.0.0',
        'scope-pkg': '^1.0.0',
        'special-version': '^4.0.0-beta.1',
      },
    };
    await writeFile(packageJson, JSON.stringify(manifest), 'utf8');

    const verify = (sha?: string) => execFileAsync(process.execPath, [
      'scripts/security/verify-sbom.mjs', packageJson, output,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, FURYPIPE_SOURCE_COMMIT: sha ?? sourceCommit },
    });
    await expect(verify(sourceCommit)).resolves.toBeDefined();
    await expect(verify('c'.repeat(40))).rejects.toThrow(/namespace does not match/u);
    await expect(verify('not-a-commit-sha')).rejects.toThrow(/exact lowercase 40-character commit SHA/u);

    await writeFile(packageJson, JSON.stringify({ ...manifest, version: '0.13.3' }), 'utf8');
    await expect(verify()).rejects.toThrow(/root package version/u);
    await writeFile(packageJson, JSON.stringify(manifest), 'utf8');

    const incomplete = join(root, 'incomplete.spdx.json');
    await writeFile(incomplete, JSON.stringify({
      spdxVersion: 'SPDX-2.3',
      packages: [document.packages.find((pkg) => pkg.name === 'furypipe' && pkg.versionInfo === '0.13.2')],
      relationships: [],
    }), 'utf8');
    await expect(execFileAsync(process.execPath, [
      'scripts/security/verify-sbom.mjs', packageJson, incomplete,
    ], { cwd: process.cwd() })).rejects.toThrow();

    const withOrphan = {
      ...document,
      packages: [...document.packages, {
        SPDXID: `SPDXRef-Package-orphan-${'d'.repeat(64)}`,
        name: 'orphan',
        versionInfo: '1.0.0',
      }],
    };
    const orphanPath = join(root, 'orphan.spdx.json');
    await writeFile(orphanPath, JSON.stringify(withOrphan), 'utf8');
    await expect(execFileAsync(process.execPath, [
      'scripts/security/verify-sbom.mjs', packageJson, orphanPath,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, FURYPIPE_SOURCE_COMMIT: sourceCommit },
    })).rejects.toThrow(/unreachable from its root/u);
  });
});
