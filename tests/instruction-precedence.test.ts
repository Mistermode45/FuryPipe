import { describe, expect, it } from 'vitest';

import {
  FURY_INSTRUCTION_LAYERS,
  resolveFuryInstructionPrecedence,
} from '../src/instruction-precedence.js';

describe('Fury instruction precedence', () => {
  it('uses the explicit Base→Runtime precedence order and records overrides', () => {
    const plan = resolveFuryInstructionPrecedence([
      { layer:'base', sourceId:'base', channel:'communication.style', mode:'set', value:'balanced' },
      { layer:'user', sourceId:'user-profile', channel:'communication.style', mode:'set', value:'detailed' },
      { layer:'security', sourceId:'security-policy', channel:'execution.authority', mode:'deny', value:'external-actions' },
      { layer:'runtime', sourceId:'runtime-policy', channel:'communication.style', mode:'set', value:'caveman' },
    ]);
    expect(plan.order).toEqual(FURY_INSTRUCTION_LAYERS);
    expect(plan.status).toBe('resolved');
    expect(plan.effective).toContainEqual(expect.objectContaining({
      channel:'communication.style',
      layer:'runtime',
      sourceId:'runtime-policy',
      value:'caveman',
    }));
    expect(plan.overrides).toContainEqual(expect.objectContaining({
      channel:'communication.style',
      winnerSourceId:'runtime-policy',
      overriddenSourceIds:['base','user-profile'],
    }));
    expect(plan.executionAuthority).toBe(false);
  });

  it('fails closed on incompatible scalar directives at the same precedence', () => {
    const plan = resolveFuryInstructionPrecedence([
      { layer:'project', sourceId:'project-a', channel:'tests.mode', mode:'set', value:'unit' },
      { layer:'project', sourceId:'project-b', channel:'tests.mode', mode:'set', value:'full' },
    ]);
    expect(plan.status).toBe('conflict');
    expect(plan.effective).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        channel:'tests.mode',
        layer:'project',
        sourceIds:['project-a','project-b'],
        reason:'same-precedence-incompatible',
      }),
    ]);
  });

  it('composes append directives deterministically without treating them as scalar conflicts', () => {
    const plan = resolveFuryInstructionPrecedence([
      { layer:'skill', sourceId:'skill-z', channel:'prompt.constraints', mode:'append', value:'Z' },
      { layer:'base', sourceId:'base', channel:'prompt.constraints', mode:'append', value:'Base' },
      { layer:'skill', sourceId:'skill-a', channel:'prompt.constraints', mode:'append', value:'A' },
    ]);
    expect(plan.status).toBe('resolved');
    expect(plan.appended.map((item)=>[item.layer,item.sourceId,item.value])).toEqual([
      ['base','base','Base'],
      ['skill','skill-a','A'],
      ['skill','skill-z','Z'],
    ]);
  });

  it('rejects malformed, oversized and control-character directives', () => {
    expect(()=>resolveFuryInstructionPrecedence(new Array(513).fill({
      layer:'base',sourceId:'base',channel:'x',mode:'set',value:'x',
    }))).toThrow(/bound/u);
    expect(()=>resolveFuryInstructionPrecedence([
      { layer:'base',sourceId:'bad id',channel:'x',mode:'set',value:'x' },
    ])).toThrow(/sourceId/u);
    expect(()=>resolveFuryInstructionPrecedence([
      { layer:'base',sourceId:'base',channel:'x',mode:'set',value:'x\u0000y' },
    ])).toThrow(/value/u);
  });
});
