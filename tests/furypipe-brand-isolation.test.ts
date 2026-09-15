import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

describe('FuryPipe runtime identity isolation', () => {
  it('contains no legacy product namespace in runtime or public CLI surfaces', () => {
    const targets = [
      ...walk(path.join(root, 'src')).filter((file) => /\.(?:ts|js)$/u.test(file)),
      path.join(root, 'package.json'),
      path.join(root, 'scripts', 'build.mjs'),
      path.join(root, 'bin', 'cli.js'),
      path.join(root, 'README.md'),
      path.join(root, 'docs', 'CLI.md'),
    ];

    const forbiddenName = ['p', 'x', 'p', 'i', 'p', 'e'].join('');
    const forbiddenEnv = forbiddenName.toUpperCase() + '_';
    const offenders: string[] = [];

    for (const file of targets) {
      const text = fs.readFileSync(file, 'utf8');
      const relative = path.relative(root, file).replaceAll('\\', '/');
      if (text.toLowerCase().includes(forbiddenName)) offenders.push(relative + ': legacy product name');
      if (text.includes(forbiddenEnv)) offenders.push(relative + ': legacy environment namespace');
      if (text.includes('47821')) offenders.push(relative + ': legacy default port');
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
