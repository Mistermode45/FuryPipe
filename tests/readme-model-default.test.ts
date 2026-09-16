/**
 * README/runtime contract for FuryPipe's dynamic model policy.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

describe('README model policy', () => {
  it('documents dynamic discovery plus evidence-first AUTO as the zero-config policy', () => {
    expect(readme).toContain('Default policy: **dynamic discovery + evidence-first AUTO**.');
    expect(readme).toContain('Model Fabric');
    expect(readme).toContain('Configured provider catalogs can surface newly released models');
  });

  it('documents calibrated AUTO separately from strict SAFE_EXACT', () => {
    expect(readme).toContain('quality-verified **and calibrated** visual readers');
    expect(readme).toContain('`safe_exact` is stricter than AUTO and accepts only quality-verified profiles');
  });

  it('keeps FURYPIPE_MODELS as an explicit scope override and documents the kill switch', () => {
    expect(readme).toContain('`FURYPIPE_MODELS` remains an explicit backward-compatible operator scope override');
    expect(readme).toContain('`off` disables visual compression');
  });

  it('does not collapse discovery, capability, calibration and quality verification into one state', () => {
    expect(readme).toContain('`discovered != vision-capable != calibrated != quality-verified`');
  });
});
