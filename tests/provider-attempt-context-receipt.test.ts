import { describe, expect, it } from 'vitest';

import {
  createProviderAttemptContextReceipt,
  verifyProviderAttemptContextReceipt,
} from '../src/provider-attempt-context-receipt.js';
import { prepareProviderAttemptContext } from '../src/provider-attempt-context-runtime.js';
import { createModelAdapterRegistry } from '../src/model-adapter-registry.js';
import {
  createContextOptimizerProfileRegistry,
  qualifyContextOptimizerProfile,
  type FuryContextOptimizerProfileDefinition,
  type FuryContextOptimizerProfileQualification,
} from '../src/context-optimizer-profile.js';
import { createProviderAttemptPlanner } from '../src/provider-attempt-planner.js';

function summary(median: number) {
  return {
    known: 5,
    missing: 0,
    min: median,
    max: median,
    mean: median,
    median,
    p95: median,
  };
}

function metric(raw: number, pxpipe: number, furypipe: number) {
  return {
    raw: summary(raw),
    pxpipe: summary(pxpipe),
    furypipe: summary(furypipe),
  };
}

function benchmarkSuite(provider: string, model: string) {
  const digest = (id: string, value: string) => ({ id, sha256: value.repeat(64) });
  return {
    schema_version: 'furypipe-benchmark-suite/v1',
    comparability: 'VERIFIED',
    repetitions_per_variant: 5,
    minimum_repetitions_for_claims: 5,
    claim_status: 'CLAIM_ELIGIBLE',
    claim_blockers: [],
    provider,
    model,
    fixture: digest('fixture', 'a'),
    prompt: digest('prompt', 'b'),
    toolset: digest('toolset', 'c'),
    context: digest('context', 'd'),
    cache_state: 'cold',
    metrics: {
      input_tokens: metric(1000, 850, 700),
      output_tokens: metric(100, 100, 100),
      cache_read_tokens: metric(0, 0, 0),
      cache_write_tokens: metric(0, 0, 0),
      vision_tokens: metric(0, 0, 0),
      latency_ms: metric(1000, 950, 900),
      ttft_ms: metric(300, 290, 280),
      local_transform_ms: metric(0, 4, 6),
      request_bytes: metric(4000, 3400, 2800),
      response_bytes: metric(500, 500, 500),
      cost_usd: metric(0.02, 0.018, 0.015),
      errors: metric(0, 0, 0),
    },
    quality: {
      raw: summary(0.90),
      pxpipe: summary(0.92),
      furypipe: summary(0.95),
    },
    exactness: {
      checked_runs: 15,
      passing_runs: 15,
      mismatches: 0,
    },
    errors: {
      runs_with_errors: 0,
      total: 0,
    },
  };
}

function qualification(
  profile: FuryContextOptimizerProfileDefinition,
  provider = 'openai',
  model = 'gpt-5.6-sol',
): FuryContextOptimizerProfileQualification {
  const decision = qualifyContextOptimizerProfile({
    profile,
    provider,
    model,
    workloadId: 'coding',
    benchmarkSuite: benchmarkSuite(provider, model),
    benchmarkSuiteSha256: 'e'.repeat(64),
    baseline: 'raw',
    minimumRelativeTokenImprovementRatio: 0.20,
  });
  if (decision.status !== 'QUALIFIED' || decision.qualification === undefined) {
    throw new Error('expected a generated context profile qualification');
  }
  return decision.qualification;
}

function planner(options: {
  readonly profile?: FuryContextOptimizerProfileDefinition;
  readonly qualification?: FuryContextOptimizerProfileQualification;
} = {}) {
  const profiles = options.profile === undefined ? [] : [options.profile];
  const qualifications = options.qualification === undefined ? [] : [options.qualification];
  return createProviderAttemptPlanner({
    basePrompt: {
      level: 'ENGINEERING',
      sections: {
        task: 'PROMPT_SECRET_SENTINEL',
        constraints: 'BASE_CONSTRAINT',
      },
    },
    modelAdapters: {
      registry: createModelAdapterRegistry([]),
      qualifications: [],
    },
    contextProfiles: {
      registry: createContextOptimizerProfileRegistry(profiles),
      qualifications,
    },
  });
}

function runtimeResult(options: {
  readonly content?: string;
  readonly id?: string;
  readonly profile?: FuryContextOptimizerProfileDefinition;
  readonly qualification?: FuryContextOptimizerProfileQualification;
  readonly charsPerTokenEstimate?: number;
  readonly allowSecret?: boolean;
  readonly exactness?: 'normal' | 'exact' | 'secret';
} = {}) {
  const plan = planner({
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    ...(options.qualification === undefined ? {} : { qualification: options.qualification }),
  }).plan({
    providerId: 'openai',
    model: 'gpt-5.6-sol',
    workloadId: 'coding',
  });

  return prepareProviderAttemptContext({
    attemptPlan: plan,
    items: [{
      id: options.id ?? 'CONTEXT_ID_SENTINEL',
      kind: 'knowledge',
      selected: true,
      exactness: options.exactness ?? 'normal',
      representations: [{
        level: 'summary',
        content: options.content ?? 'CONTEXT_PLAINTEXT_SENTINEL',
      }],
    }],
    ...(options.allowSecret === undefined ? {} : { securityPolicy: { allowSecret: options.allowSecret } }),
    ...(options.charsPerTokenEstimate === undefined
      ? {}
      : { charsPerTokenEstimate: options.charsPerTokenEstimate }),
  });
}

describe('Provider Attempt Context Runtime Receipt', () => {
  it('creates a deterministic plaintext-free receipt for a real runtime result', () => {
    const result = runtimeResult();
    const first = createProviderAttemptContextReceipt(result);
    const second = createProviderAttemptContextReceipt(result);

    expect(first).toEqual(second);
    expect(first.receiptDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.prompt.promptDigest).toMatch(/^fp_[0-9a-f]{64}$/u);
    expect(first.prompt.sourceDigest).toMatch(/^fp_src_[0-9a-f]{64}$/u);
    expect(first.prompt.compileInputDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.context.planDigest).toMatch(/^ctx_[0-9a-f]{64}$/u);
    expect(first.context.includedCount).toBe(1);
    expect(first.context.injection.injected).toBe(true);
    expect(first.execution).toEqual({
      optimizerExecuted: true,
      networkCallExecuted: false,
      providerRequestExecuted: false,
      executionAuthorized: false,
    });
    expect(first.verification).toEqual({
      structuralConsistency: 'verified',
      runtimeProvenance: 'not-verified',
      currentContextResult: 'not-verified',
      providerResult: 'not-executed',
    });

    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('PROMPT_SECRET_SENTINEL');
    expect(serialized).not.toContain('CONTEXT_PLAINTEXT_SENTINEL');
    expect(serialized).not.toContain('CONTEXT_ID_SENTINEL');
  });

  it('records baseline identity without inventing benchmark evidence', () => {
    const receipt = createProviderAttemptContextReceipt(runtimeResult());

    expect(receipt.profile).toEqual({
      state: 'IDENTITY',
      disposition: 'BASELINE_IDENTITY',
      applied: false,
      qualificationEvidence: 'none',
      blockerReasons: ['missing-qualification'],
    });
  });

  it('records an exactly qualified profile while keeping current-result verification false', () => {
    const profile: FuryContextOptimizerProfileDefinition = {
      id: 'compact-openai-v1',
      options: {
        maxBytes: 4096,
        maxItems: 8,
        discoveryMinRelevance: 0.7,
      },
    };
    const result = runtimeResult({
      profile,
      qualification: qualification(profile),
    });
    const receipt = createProviderAttemptContextReceipt(result);

    expect(receipt.profile).toEqual(expect.objectContaining({
      state: 'QUALIFIED',
      disposition: 'QUALIFIED_PROFILE_APPLIED',
      applied: true,
      qualificationEvidence: 'verified',
      profileId: 'compact-openai-v1',
      profileDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    }));
    expect(receipt.verification.currentContextResult).toBe('not-verified');
  });

  it('records explicit host secret authority separately from profile qualification', () => {
    const result = runtimeResult({
      allowSecret: true,
      exactness: 'secret',
    });
    const receipt = createProviderAttemptContextReceipt(result);

    expect(receipt.secretPolicy).toEqual({
      allowSecret: true,
      authority: 'host',
    });
    expect(receipt.profile.qualificationEvidence).toBe('none');
  });

  it('does not invent token estimates when the runtime has none', () => {
    const receipt = createProviderAttemptContextReceipt(runtimeResult());
    expect(receipt.context.tokenEstimate).toEqual({ status: 'unknown' });
  });

  it('labels host character-ratio estimates as estimates', () => {
    const receipt = createProviderAttemptContextReceipt(runtimeResult({
      charsPerTokenEstimate: 4,
    }));
    expect(receipt.context.tokenEstimate).toEqual(expect.objectContaining({
      status: 'character-ratio-estimate',
      charsPerToken: 4,
    }));
  });

  it('binds the receipt to the exact final prompt and optimized context', () => {
    const first = createProviderAttemptContextReceipt(runtimeResult({
      content: 'context alpha',
    }));
    const second = createProviderAttemptContextReceipt(runtimeResult({
      content: 'context beta',
    }));

    expect(first.context.planDigest).not.toBe(second.context.planDigest);
    expect(first.prompt.promptDigest).not.toBe(second.prompt.promptDigest);
    expect(first.receiptDigest).not.toBe(second.receiptDigest);
  });

  it('verifies the receipt against the supplied runtime result', () => {
    const result = runtimeResult();
    const receipt = createProviderAttemptContextReceipt(result);

    expect(verifyProviderAttemptContextReceipt(receipt, result)).toBe(true);
  });

  it('accepts equivalent top-level property ordering but rejects added fields', () => {
    const result = runtimeResult();
    const receipt = createProviderAttemptContextReceipt(result);
    const reordered = Object.fromEntries(Object.entries(receipt).reverse());
    const extended = {
      ...receipt,
      unexpected: 'field',
    };

    expect(verifyProviderAttemptContextReceipt(
      reordered as unknown as typeof receipt,
      result,
    )).toBe(true);
    expect(verifyProviderAttemptContextReceipt(
      extended as unknown as typeof receipt,
      result,
    )).toBe(false);
  });

  it('rejects a tampered receipt', () => {
    const result = runtimeResult();
    const receipt = createProviderAttemptContextReceipt(result);
    const tampered = {
      ...receipt,
      model: 'gpt-5.6-luna',
    };

    expect(verifyProviderAttemptContextReceipt(
      tampered as typeof receipt,
      result,
    )).toBe(false);
  });

  it('fails closed when runtime injection byte metadata is contradictory', () => {
    const result = runtimeResult();
    const contradictory = {
      ...result,
      injectedContextBytes: result.injectedContextBytes + 1,
    };

    expect(() => createProviderAttemptContextReceipt(
      contradictory as typeof result,
    )).toThrow(/injectedContextBytes/);
  });

  it('fails closed when context plan content metrics are contradictory', () => {
    const result = runtimeResult();
    const first = result.contextPlan.included[0]!;
    const contradictory = {
      ...result,
      contextPlan: {
        ...result.contextPlan,
        included: [{
          ...first,
          bytes: first.bytes + 1,
        }],
      },
    };

    expect(() => createProviderAttemptContextReceipt(
      contradictory as typeof result,
    )).toThrow(/content metrics/);
  });

  it('fails closed when the final prompt no longer contains the generated context tail', () => {
    const result = runtimeResult();
    const contradictory = {
      ...result,
      prompt: {
        ...result.prompt,
        sections: {
          ...result.prompt.sections,
          context: ['unrelated replacement context'],
        },
      },
    };

    expect(() => createProviderAttemptContextReceipt(
      contradictory as typeof result,
    )).toThrow(/generated context blocks/);
  });

  it('fails closed when a non-qualified profile falsely carries applied evidence', () => {
    const result = runtimeResult();
    const contradictory = {
      ...result,
      profileApplied: true,
      profileQualificationEvidence: 'verified',
      profileId: 'forged-profile',
      profileDigest: 'f'.repeat(64),
    };

    expect(() => createProviderAttemptContextReceipt(
      contradictory as unknown as typeof result,
    )).toThrow(/non-qualified context runtime profile/);
  });

  it('documents structural consistency without claiming process-local runtime provenance', () => {
    const genuine = runtimeResult();
    const shallowCopy = { ...genuine };
    const receipt = createProviderAttemptContextReceipt(
      shallowCopy as typeof genuine,
    );

    expect(receipt.verification.structuralConsistency).toBe('verified');
    expect(receipt.verification.runtimeProvenance).toBe('not-verified');
  });
});
