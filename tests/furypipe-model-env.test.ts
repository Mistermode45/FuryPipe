import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_BASES,
  getConfiguredModelBases,
  setAllowedModelBases,
} from '../src/core/applicability.js';

const originalFury = process.env.FURYPIPE_MODELS;

function restore(value: string | undefined): void {
  if (value === undefined) delete process.env.FURYPIPE_MODELS;
  else process.env.FURYPIPE_MODELS = value;
}

afterEach(() => {
  restore(originalFury);
  setAllowedModelBases(null);
});

describe('FuryPipe model environment', () => {
  it('uses FURYPIPE_MODELS as the public model scope', () => {
    process.env.FURYPIPE_MODELS = 'gpt-5.6-sol';
    expect(getConfiguredModelBases()).toEqual(['gpt-5.6-sol']);
  });

  it('uses the built-in model scope when FURYPIPE_MODELS is absent', () => {
    delete process.env.FURYPIPE_MODELS;
    expect(getConfiguredModelBases()).toEqual([...DEFAULT_MODEL_BASES]);
  });

  it('treats an explicitly empty FURYPIPE_MODELS as the built-in default', () => {
    process.env.FURYPIPE_MODELS = '';
    expect(getConfiguredModelBases()).toEqual([...DEFAULT_MODEL_BASES]);
  });
});
