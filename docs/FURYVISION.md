# FuryVision

FuryVision is FuryPipe's content-aware text-to-image planning layer.

## Goal

Reduce provider input cost without treating every block as the same visual
document. Image conversion is allowed only when the existing cost gate says it
is profitable, and exactness/recovery safeguards remain higher priority than
compression ratio.

## Layout policy

FuryVision classifies a block before reflow:

| Content | Layout | Default behavior |
| --- | --- | --- |
| logs / dense prose | `dense` | keep compact reflow |
| code | `structured` | preserve hard lines |
| formatted JSON | `structured` | preserve hard lines |
| Markdown | `structured` | preserve hard lines |

This policy is deliberately conservative. It changes layout fidelity, not the
provider's billing formula. The renderer, image-count limits, byte limits,
ExactGuard and profitability gate still decide whether the block reaches the
wire as an image.

## Why not simply raise image resolution?

Higher resolution is not a free quality knob: providers can charge more visual
tokens for larger images. FuryPipe therefore optimizes layout before increasing
pixel count. Model-specific higher-resolution candidates require measured
quality/cost evidence before they can become production defaults.

## Evidence contract

FuryVision preserves FuryPipe lifecycle distinctions:

`classified != rendered != executed != verified`

A layout policy can be implemented without being promoted as a measured quality
improvement. Production promotion requires benchmark evidence tied to the exact
source SHA and model profile.

## Next benchmark track

The next evidence track should compare, per content class:

1. current Spleen 5x8 dense render;
2. structure-preserving Spleen 5x8;
3. JetBrains Mono 10 readable candidate;
4. optional high-resolution model profile when provider pricing permits it.

Measure at minimum: visual tokens, PNG bytes, latency, exact-string recall,
code/JSON comprehension, page count, and pass-through rate. A candidate only
wins when quality improves without violating the token/cost contract.
