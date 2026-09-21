import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCodeGraphIndexer } from '../src/codegraph.js';

describe('Phase 6 CodeGraph V1', () => {
  it('indexes files, symbols, imports, test relationships, and confidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-codegraph-'));
    try {
      await mkdir(join(root, '.git'));
      await mkdir(join(root, 'src'));
      await mkdir(join(root, 'tests'));
      await mkdir(join(root, 'packages', 'sample'), { recursive: true });
      await writeFile(join(root, 'package.json'), '{"name":"root","workspaces":["packages/*"]}\n');
      await writeFile(join(root, 'packages', 'sample', 'package.json'), '{"name":"sample"}\n');
      await writeFile(join(root, 'src', 'value.ts'), 'export function value(): number { return 1; }\n');
      await writeFile(join(root, 'tests', 'value.test.ts'), 'import { value } from "../src/value.js"; test("value", () => value());\n');
      await writeFile(join(root, 'ignored.txt'), Buffer.from([0, 1, 2]));
      const graph = await createCodeGraphIndexer(root, { maxFiles: 32 }).build();
      expect(graph.format).toBe('furypipe-codegraph/v1');
      expect(graph.files.some((file) => file.path === 'src/value.ts')).toBe(true);
      expect(graph.symbols).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'value', kind: 'function', exported: true, confidence: 'heuristic' }),
      ]));
      expect(graph.imports).toEqual(expect.arrayContaining([
        expect.objectContaining({ filePath: 'tests/value.test.ts', specifier: '../src/value.js', confidence: 'structural' }),
      ]));
      expect(graph.tests).toEqual(expect.arrayContaining([
        expect.objectContaining({ testFile: 'tests/value.test.ts', relation: 'imports' }),
      ]));
      expect(graph.packages).toEqual(expect.arrayContaining([
        expect.objectContaining({ packagePath: 'packages/sample', name: 'sample', relation: 'workspace-member', workspaceRoot: '' }),
      ]));
      expect(graph.ownership[0]?.confidence).toBe('structural');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reuses unchanged files during incremental update without claiming semantic certainty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'furypipe-codegraph-incremental-'));
    try {
      await mkdir(join(root, '.git'));
      await mkdir(join(root, 'src'));
      await writeFile(join(root, 'src', 'one.ts'), 'export const one = 1;\n');
      await writeFile(join(root, 'src', 'two.ts'), 'export const two = 2;\n');
      const indexer = createCodeGraphIndexer(root);
      const first = await indexer.build();
      await writeFile(join(root, 'src', 'one.ts'), 'export const one = 3;\n');
      const second = await indexer.update(first, ['src/one.ts']);
      expect(second.mode).toBe('incremental');
      expect(second.reusedFiles).toBeGreaterThanOrEqual(1);
      expect(second.symbols.every((symbol) => symbol.confidence !== 'unknown')).toBe(true);
      expect(second.executionAuthority).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
