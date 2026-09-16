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
  it('documents dynamic discovery plus evidence-first AUTO as the zero-config policy', () => {
    expect(readme).toContain('Default policy: **dynamic discovery + evidence-first AUTO**.');
    expect(readme).toContain('Model Fabric');
  });

  it('documents the backward-compatible default seed without presenting it as the complete catalog', () => {
    expect(readme).toContain(
      'backward-compatible default scope remains `' + DEFAULT_MODEL_BASES.join(',') + '`',
    );
    expect(readme).toContain('Configured provider catalogs can surface newly released models');
  });

  it('keeps FURYPIPE_MODELS as an explicit scope override and documents the kill switch', () => {
    expect(readme).toContain('`FURYPIPE_MODELS` remains an explicit backward-compatible operator scope override');
    expect(readme).toContain('`off` disables visual compression');
  });

  it('does not collapse discovery, capability and quality verification into one state', () => {
    expect(readme).toContain('`discovered != vision-capable != quality-verified`');
  });
});
