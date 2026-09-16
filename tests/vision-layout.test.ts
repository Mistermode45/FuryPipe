import { describe, expect, it } from 'vitest';
import { planFuryVisionLayout } from '../src/core/vision-layout.js';

describe('FuryVision adaptive layout planner', () => {
  it('preserves code structure instead of densely reflowing it', () => {
    const plan = planFuryVisionLayout(
      'function run() {\n  const answer = 42;\n  return answer;\n}\n',
      true,
    );
    expect(plan.kind).toBe('code');
    expect(plan.mode).toBe('structured');
    expect(plan.reflow).toBe(false);
  });

  it('preserves formatted JSON structure', () => {
    const plan = planFuryVisionLayout('{\n  "name": "FuryPipe",\n  "enabled": true\n}', true);
    expect(plan.kind).toBe('json');
    expect(plan.reflow).toBe(false);
  });

  it('keeps dense log output eligible for reflow', () => {
    const plan = planFuryVisionLayout(
      '[INFO] boot complete\n[INFO] request accepted\n[WARN] retry scheduled\n',
      true,
    );
    expect(plan.kind).toBe('log');
    expect(plan.mode).toBe('dense');
    expect(plan.reflow).toBe(true);
  });

  it('honours an explicit caller reflow opt-out for every content kind', () => {
    const plan = planFuryVisionLayout('plain prose that can otherwise be packed', false);
    expect(plan.reflow).toBe(false);
    expect(plan.reason).toBe('reflow-disabled-by-caller');
  });
});
