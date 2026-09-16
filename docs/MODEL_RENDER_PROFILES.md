# FuryPipe model render profiles

The provider endpoint is a wire protocol, not a rendering profile. A model can
arrive through an Anthropic-shaped, OpenAI-compatible, Google or gateway route;
FuryPipe resolves visual capability and geometry from the model/provider evidence
rather than from the URL alone.

## Model Fabric lifecycle

FuryPipe keeps these questions separate:

1. **Is the model known?** — runtime observation or provider catalog.
2. **Can it accept image input?** — positive provider/family capability evidence.
3. **Does FuryPipe have a calibrated render/cost profile?** — geometry and billing evidence.
4. **Has dense/legible FuryPipe reading quality been verified?** — model-specific evaluation evidence.
5. **Is the operator allowing visual transformation?** — global policy and optional model scope.

A newly released model therefore does not need to wait for a FuryPipe release to
be discovered, but discovery alone never grants a quality claim.

Configured Node runtimes can refresh provider catalogs for Anthropic, OpenAI,
Gemini, xAI, Mistral and OpenRouter. Missing credentials cause no network call.
Catalog failures are diagnostic and do not block ordinary proxying.

## Automatic visual policy

`FURYPIPE_VISUAL_POLICY` supports:

- `auto` — evidence-first; automatic imaging accepts quality-verified or
  calibrated reader profiles, but not unprofiled readers.
- `safe_exact` — stricter than `auto`; only quality-verified readers are admitted.
- `max_savings` — admits positively proven image-capable models only when FuryPipe
  also has provider-appropriate image-pricing evidence. A catalog entry does not
  make OpenAI tile math valid for another provider. Downstream ExactGuard,
  profitability, image-count and decoded-byte gates still apply.
- `text_only` — hard visual bypass.

`FURYPIPE_MODELS` remains an explicit model-scope override. It cannot override
a positive provider statement that a model is text-only.

## Shipped profile classes

| model rule | visual quality state | cell / columns | max height | notes |
|---|---|---|---:|---|
| `claude-fable-5*` | quality-verified | Spleen 5×8 / 312 | 728 px | dense Claude reader with measured exact-recall evidence |
| other current Claude | calibrated | JetBrains Mono 14px / 172 history | 728 px | legible geometry; broader quality evidence remains distinct |
| measured Gemini profiles | quality-verified | provider profile | 728 px | provider/model image-token profile is explicit |
| `gpt-5.6-sol*` | calibrated | JetBrains Mono 14px / 84 | 1954 px | measured geometry; not promoted to quality-verified |
| `grok-4.5/4.6*` | calibrated | JetBrains Mono 14px / 84 | 512 px | measured geometry/economics; exact recall not strong enough for default verification |
| unprofiled proven-vision model | unprofiled | conservative fallback/canary | profile dependent | eligible only under an explicit broad policy/scope |

The profile table is not the model catalog. Provider-discovered models are
represented by Model Fabric even when no dedicated quality profile exists.

## Dynamic provider discovery

Catalog normalization intentionally stores bounded metadata only: IDs, aliases,
modalities/capabilities, lifecycle, limits, optional pricing metadata and
provenance. Credentials are never stored in Model Fabric inspection output.

Discovery and execution remain distinct:

`discovered != image-capable != calibrated != quality-verified != executed`.

OpenRouter can provide a broad cross-provider catalog, but its metadata is still
treated as catalog evidence rather than as proof that FuryPipe's dense text
rendering is readable by a particular model.

## Unmeasured readers

A model that positively supports image input but lacks quality evidence is not
silently treated as verified. Under the default `auto` policy it remains native
text. Under `max_savings`, it may enter the visual pipeline only when visual
pricing is provider-appropriate; otherwise it remains native with
`visual_pricing_unknown`. An explicit `FURYPIPE_GPT_PROFILES` entry can supply
operator-owned geometry/pricing without waiting for a FuryPipe release. ExactGuard,
profitability, image count, decoded image-byte budget and request-size checks still apply.

A model positively known to be text-only always stays native, even if a stale
operator CSV contains its ID. Likewise, `FURYPIPE_MODELS` is only a scope
override: it cannot turn unknown image-token economics into a measured pricing
profile. Future OpenAI families such as GPT-6 remain pricing-unknown until
provider-backed or operator-owned evidence supplies that cost model.

## Fidelity and geometry

Density and legibility are separate axes. Larger glyphs cost more image surface
but can materially improve exact recall for weaker visual readers. FuryPipe
therefore keeps model-specific geometry rather than applying the densest profile
to every vision model.

The Visual Planner changes page width within the profile's geometry; it does not
shrink glyph scale to manufacture a savings result.

## PNG transport optimization

The renderer is pixel-lossless. Grayscale pages are encoded at the smallest PNG
bit depth that exactly represents every pixel:

- black/white only → 1-bit;
- exact four-level grayscale → 2-bit;
- exact sixteen-level grayscale → 4-bit;
- all other grayscale → 8-bit.

The packed scanlines then use FuryPipe's fast Average/Up filtering. This reduces
wire bytes without changing image dimensions or provider vision-token pricing.
Tests decode the PNG through an independent image decoder and compare pixels
byte-for-byte.

## Overrides

`FURYPIPE_GPT_PROFILES` is a JSON map from model-id prefix to a partial render
profile. The longest matching prefix wins. Overrides can provide geometry and
vision-cost information but do not, by themselves, turn a model into a
quality-verified reader.

Any custom cost value must come from provider documentation or measurement.
Incorrect pricing does not change source text, but it can corrupt the
profitability decision and savings telemetry, so unsupported values must not be
presented as measured evidence.
