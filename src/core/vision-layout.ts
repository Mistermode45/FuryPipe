import { classifyContent, type ClassifiedContentKind } from './content-classifier.js';

export type FuryVisionLayoutMode = 'dense' | 'structured';

export interface FuryVisionLayoutPlan {
  readonly format: 'furypipe-vision-layout/v1';
  readonly mode: FuryVisionLayoutMode;
  readonly kind: ClassifiedContentKind;
  readonly reflow: boolean;
  readonly reason: string;
}

/**
 * FuryVision content-aware layout policy.
 *
 * Reflow is a token-density optimization, not a universal readability win.
 * Code, formatted JSON and Markdown carry meaning in line/indent structure, so
 * FuryVision preserves their hard lines and lets the existing profitability
 * gate decide whether imaging is still worthwhile. Logs and ordinary prose can
 * keep the dense reflow path.
 */
export function planFuryVisionLayout(
  text: string,
  requestedReflow: boolean,
): FuryVisionLayoutPlan {
  const classified = classifyContent(text);
  if (!requestedReflow) {
    return {
      format: 'furypipe-vision-layout/v1',
      mode: 'structured',
      kind: classified.kind,
      reflow: false,
      reason: 'reflow-disabled-by-caller',
    };
  }

  const structureSensitive =
    classified.kind === 'code'
    || classified.kind === 'json'
    || classified.kind === 'markdown';

  if (structureSensitive) {
    return {
      format: 'furypipe-vision-layout/v1',
      mode: 'structured',
      kind: classified.kind,
      reflow: false,
      reason: 'preserve-structural-lines',
    };
  }

  return {
    format: 'furypipe-vision-layout/v1',
    mode: 'dense',
    kind: classified.kind,
    reflow: true,
    reason: 'dense-content-safe-to-reflow',
  };
}
