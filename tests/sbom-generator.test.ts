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
  it('includes pnpm dependency objects whose package name exists only in the map key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-sbom-'));
    roots.push(root);
    const input = join(root, 'pnpm-list.json');
    const output = join(root, 'sbom.spdx.json');
    await writeFile(input, JSON.stringify([{
      name: 'furypipe',
      version: '0.13.2',
      dependencies: {
        json5: {
          from: 'json5',
          version: '2.2.3',
          dependencies: {
            minimist: { from: 'minimist', version: '1.2.8' },
          },
        },
      },
      devDependencies: {
        vitest: { from: 'vitest', version: '4.0.18' },
      },
    }]), 'utf8');

    await execFileAsync(process.execPath, [
      'scripts/security/generate-sbom.mjs',
      input,
      output,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, GITHUB_SHA: 'a'.repeat(40) },
    });

    const document = JSON.parse(await readFile(output, 'utf8')) as {
      spdxVersion: string;
      packages: Array<{ name: string; versionInfo: string; SPDXID: string }>;
      relationships: Array<{ spdxElementId: string; relatedSpdxElement: string; relationshipType: string }>;
    };

    expect(document.spdxVersion).toBe('SPDX-2.3');
    expect(document.packages.map((pkg) => [pkg.name, pkg.versionInfo])).toEqual(expect.arrayContaining([
      ['furypipe', '0.13.2'],
      ['json5', '2.2.3'],
      ['minimist', '1.2.8'],
      ['vitest', '4.0.18'],
    ]));
    expect(document.packages).toHaveLength(4);

    const byName = new Map(document.packages.map((pkg) => [pkg.name, pkg.SPDXID]));
    expect(document.relationships).toEqual(expect.arrayContaining([
      {
        spdxElementId: byName.get('furypipe'),
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: byName.get('json5'),
      },
      {
        spdxElementId: byName.get('json5'),
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: byName.get('minimist'),
      },
      {
        spdxElementId: byName.get('furypipe'),
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: byName.get('vitest'),
      },
    ]));
  });
});
