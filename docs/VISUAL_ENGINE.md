# FuryPipe Visual Engine

The **FuryPipe Visual Engine** is the context-optimization layer that decides when eligible text should stay native and when a provider-priced visual representation is cheaper without violating the runtime's fidelity rules.

It is not an unconditional text-to-image converter. A transformation must pass the same policy, exactness, provider-cap and profitability checks as the rest of FuryPipe.

## Pipeline

1. **Context classification**
   - identify tool output, structured data, code, logs, markdown and ordinary text;
   - preserve sensitivity / exactness evidence without retaining extracted secret values.

2. **Exactness protection**
   - ExactGuard and caller `keepSharp` rules run before lossy representation changes;
   - protected identifiers, paths, hashes, versions and numbers can stay native or be represented by the adjacent exact-value factsheet / recovery path.

3. **Lossless text compaction**
   - remove trailing horizontal whitespace;
   - collapse redundant blank-line runs while keeping indentation and content order.

4. **Provider-priced Visual Planner**
   - start from the model profile's validated font, maximum width and maximum page height;
   - evaluate a bounded set of alternative column widths;
   - price each candidate with that provider/model's image-token regime;
   - keep the incumbent natural width as a candidate, so the planner never deliberately selects a plan with a higher estimated image-token cost;
   - on equal cost, prefer fewer pages, then the wider layout for readability.

5. **Profitability gate**
   - compare the candidate image path against the text path;
   - include cache warm-state penalties where evidence exists;
   - pass through as text when the visual path is not profitable.

6. **Deterministic rendering**
   - model profiles select the measured font/geometry;
   - Unicode misses are surfaced or escaped rather than silently invented;
   - original hard line breaks remain represented by the visible reflow marker when reflow is active.

7. **Fast adaptive lossless PNG encoding**
   - detect whether every grayscale sample is exactly representable at PNG bit depth 1, 2, 4 or 8;
   - pack exact black/white pages at 1-bit instead of always shipping an 8-bit grayscale scanline surface;
   - use 2-bit/4-bit only when every sample round-trips exactly; anti-aliased or otherwise non-representable pages remain 8-bit;
   - keep the measured Average predictor as the default for glyph-bearing rows;
   - switch byte-identical repeated rows to PNG Up, producing zero residuals without an exhaustive predictor search;
   - RGB pages whose channels are exactly equal are collapsed to native grayscale PNG before palette encoding, preserving every pixel while removing RGB/PLTE overhead;
   - remaining RGB pages with at most 256 exact colors use indexed-color PNG (PLTE) at the smallest legal index depth instead of unconditional 24-bit truecolor;
   - decoded pixels remain byte-identical to the renderer framebuffer; no quantization is permitted.

8. **Wire safety**
   - account for caller-owned images before FuryPipe adds any;
   - enforce provider image-count headroom and the configured decoded-image byte budget;
   - admit semantic image groups atomically; if a group does not fit, keep its source text.

9. **Evidence**
   - emit gate, image-count, image-byte, cache-prefix and recovery telemetry;
   - measured savings remain distinct from estimates and from unverified claims.

## Model Fabric and profiles

Model discovery, image-input capability, visual quality state and render pricing are separate facts.

The runtime can refresh configured provider catalogs (Anthropic, OpenAI, Gemini, xAI, Mistral and OpenRouter) outside the request hot path. A newly discovered model does not become quality-verified merely because it exists or accepts images.

`FURYPIPE_VISUAL_POLICY=auto` is evidence-first but practical: automatic transformation accepts quality-verified and calibrated reader profiles. `safe_exact` accepts only quality-verified profiles. `max_savings` broadens eligibility only when image-input capability is positively proven **and** FuryPipe has provider-appropriate image-pricing evidence (built-in/provider profile or an explicit operator profile). A dynamically discovered Mistral/OpenRouter/custom vision model with unknown visual economics stays native instead of inheriting OpenAI tile math. ExactGuard, profitability, image-count and byte-budget gates remain mandatory. `text_only` is a hard visual bypass. An explicit `FURYPIPE_MODELS` scope remains authoritative but cannot force a model that is positively known to be text-only into an image request.

Geometry and image-token pricing are model data, not hard-coded assumptions shared across providers.

Examples already represented in the runtime include:

- Claude / Anthropic patch-28 pricing and tier-specific resize limits;
- Gemini measured flat image-token profiles;
- OpenAI patch/tile profiles, including the dedicated GPT-5.6 Sol geometry;
- additional provider profiles only where FuryPipe has an explicit cost/geometry basis.

An unknown or misresolved provider family must not inherit another provider's optimistic pricing.

## Fidelity modes

The Visual Engine deliberately separates **density** from **legibility**.

Some model profiles can read the dense Spleen geometry accurately; others use a larger JetBrains Mono profile where measured exact-recall evidence requires it. FuryPipe does not assume that one renderer is best for every model.

The Visual Planner changes page width, not glyph scale. A narrower candidate wraps into more rows; it does not make glyphs smaller. The profitability calculation includes the resulting page count.

## Safety invariants

The following invariants are release blockers:

- `ExactGuard` cannot be weakened to improve a benchmark.
- Provider count/byte caps cannot be bypassed to force compression.
- A Visual Planner candidate cannot be accepted on an invented provider cost.
- PNG optimization must remain pixel-lossless; adaptive bit depth may reduce representation size but may never quantize a sample.
- `recommended != installed != connected != approved != executable != executed != verified`.
- `released != deployed`.

## Public surfaces

The Visual Engine is controlled and inspected through:

- `furypipe setup`
- `furypipe doctor`
- `furypipe start`
- the FuryPipe Control Plane dashboard
- FuryLink (`furypipe link <agent>`) for child-agent connectivity

The runtime bypass switch disables visual transformation for comparison/debugging without changing the rest of FuryPipe's identity or provider routing.
