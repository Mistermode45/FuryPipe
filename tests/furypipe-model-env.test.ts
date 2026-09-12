import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_BASES,
  getConfiguredModelBases,
  setAllowedModelBases,
} from '../src/core/applicability.js';

const originalFury = process.env.FURYPIPE_MODELS;
const originalLegacy = process.env.PXPIPE_MODELS;

function restore(name: 'FURYPIPE_MODELS' | 'PXPIPE_MODELS', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('FURYPIPE_MODELS', originalFury);
  restore('PXPIPE_MODELS', originalLegacy);
  setAllowedModelBases(null);
});

describe('FuryPipe model environment', () => {
  it('uses FURYPIPE_MODELS as the primary public model scope', () => {
    process.env.FURYPIPE_MODELS = 'gpt-5.6-sol';
    process.env.PXPIPE_MODELS = 'gemini';

    expect(getConfiguredModelBases()).toEqual(['gpt-5.6-sol']);
  });

  it('keeps the previous environment variable as a compatibility fallback only', () => {
    delete process.env.FURYPIPE_MODELS;
    process.env.PXPIPE_MODELS = 'gemini,claude-fable-5';

    expect(getConfiguredModelBases()).toEqual(['gemini', 'claude-fable-5']);
  });

  it('treats an explicitly empty FURYPIPE_MODELS as the built-in default instead of consulting fallback state', () => {
    process.env.FURYPIPE_MODELS = '';
    process.env.PXPIPE_MODELS = 'gpt-5.6-sol';

    expect(getConfiguredModelBases()).toEqual([...DEFAULT_MODEL_BASES]);
  });
});
