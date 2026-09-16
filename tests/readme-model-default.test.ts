/**
 * README/runtime contract for FuryPipe's automatic model policy.
 *
 * The model catalog is dynamic; FURYPIPE_MODELS is an operator override, not
 * the release-time source of truth for every model that can enter Visual Engine.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL_BASES } from '../src/core/applicability.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

describe('README model policy', () => {
  it('documents automatic vision-capable discovery as the zero-config policy', () => {
    expect(readme).toContain('Default model policy: **automatic vision-capable discovery**.');
    expect(readme).toContain('Model Fabric');
  });

  it('documents every built-in family seed without presenting it as the complete catalog', () => {
    for (const modelBase of DEFAULT_MODEL_BASES) {
      expect(readme).toContain('`' + modelBase + '`');
    }
    expect(readme).toContain('configured provider catalogs can add newly released vision models');
  });

  it('keeps FURYPIPE_MODELS as an explicit override and documents the kill switch', () => {
    expect(readme).toContain('`FURYPIPE_MODELS` remains an explicit operator override');
    expect(readme).toContain('`off` disables visual compression');
  });

  it('does not claim discovery is equivalent to verification', () => {
    expect(readme).toContain('Discovered does not mean verified');
  });
});
