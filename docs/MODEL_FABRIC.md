# FuryPipe Model Fabric

FuryPipe's **Model Fabric** separates model discovery, capability evidence, visual-reader quality, pricing evidence and runtime execution.

It exists to avoid a release-time allowlist becoming the source of truth for every model FuryPipe can observe.

## Core lifecycle

These states are intentionally different:

```text
DISCOVERED != ROUTABLE
ROUTABLE != VISION_CAPABLE
VISION_CAPABLE != CALIBRATED
CALIBRATED != QUALITY_VERIFIED
QUALITY_VERIFIED != PROFITABILITY_VERIFIED
EXECUTED != VERIFIED
```

A provider catalog may prove that a model exists and accepts images. That alone does **not** prove that:

- the current FuryPipe renderer is readable enough for exact-value recovery;
- FuryPipe knows the provider's image-token economics;
- a visual representation is cheaper for a particular request;
- the model was actually used on a request.

## Sources

FuryPipe can combine bounded, provenance-tagged evidence from:

- runtime-observed model IDs;
- built-in provider/family capability rules;
- provider model APIs;
- OpenRouter catalog metadata when OpenRouter is configured;
- explicit operator profile overrides;
- local calibrated renderer profiles.

The Node host refreshes only catalogs whose explicit provider credentials are configured. Catalog refresh is off the request hot path and failure does not disable proxying.

Current catalog adapters cover:

- Anthropic;
- OpenAI;
- Google Gemini;
- xAI;
- Mistral;
- OpenRouter.

A missing credential is represented as **not configured**, not as an empty-success catalog.

## Automatic policy

When `FURYPIPE_MODELS` is unset or empty, FuryPipe uses the Model Fabric rather than an exact release-time model list.

`FURYPIPE_VISUAL_POLICY` controls how broad that automatic policy is:

| Policy | Behaviour |
| --- | --- |
| `auto` | Accept quality-verified and calibrated readers. Discovery or pricing evidence alone cannot promote an unprofiled reader. |
| `safe_exact` | Accept only quality-verified visual readers. |
| `max_savings` | Broaden to positively proven vision readers for which provider-appropriate image economics are known; ExactGuard and profitability/budget gates still apply. |
| `text_only` | Hard visual bypass. |

`FURYPIPE_MODELS` remains an explicit operator scope override and can narrow the model bases. A positively proven text-only model cannot be forced into an image request by a stale CSV.

## Why `unsupported_model` is not the normal future-model answer

A newly released model can be:

```text
DISCOVERED
VISION_CAPABLE
UNPROFILED
CANARY
```

without being called unsupported.

FuryPipe keeps the reasons distinct:

- `vision_capability_unknown`;
- `visual_profile_unverified`;
- `visual_pricing_unknown`;
- `text_only_model`;
- `visual_profile_blocked`;
- explicit operator-scope exclusion.

This prevents both false support claims and permanent under-utilization of new multimodal models.

## Provider discovery

### Anthropic

FuryPipe can normalize the Anthropic models catalog when an Anthropic API key is explicitly configured. Runtime-observed Claude IDs remain useful when Claude Code is connected through subscription/OAuth and no API-key catalog is available.

Catalog discovery does not promote an arbitrary `claude-*` string to a vision model. Family inference is deliberately bounded to known release shapes; unknown Claude families remain unknown until provider or operator evidence proves capability.

### OpenAI

`GET /v1/models` discovers accessible model IDs. The endpoint is treated as existence/catalog evidence, not as a complete modality contract. Current GPT family capability rules and explicit profiles provide the additional image-reader evidence FuryPipe needs.

### Google Gemini

The Node catalog adapter follows `models.list` pagination and keeps API credentials in headers/server-side state rather than exposing them in dashboard data.

### xAI

The `/v1/language-models` catalog can provide input/output modalities and aliases. FuryPipe uses those fields rather than assuming every `grok-*` model accepts images.

### Mistral

The Mistral models API exposes `capabilities.vision`; FuryPipe uses that value directly. Vision capability does not fabricate OpenAI/Anthropic image pricing.

### OpenRouter

OpenRouter's catalog can provide `architecture.input_modalities` and `output_modalities`. FuryPipe can therefore discover arbitrary future image-input models routed through OpenRouter without adding each ID to source code.

OpenRouter remains optional.

## Visual-profile evidence

Visual capability and visual quality are different.

Examples:

- a provider API may prove `imageInput=yes`;
- a FuryPipe evaluation battery may prove a 14 px reader profile is calibrated;
- exact-recall testing may promote that profile to `quality_verified`;
- pricing evidence may still be unknown and therefore keep automatic transformation native.

Current profiles deliberately keep low-confidence models in `calibrated` or `unprofiled` instead of calling them verified.

## Pricing evidence

FuryPipe will not apply another provider's optimistic image-token formula merely because a model can see images.

Pricing evidence is resolved independently:

```text
operator_profile
provider_profile
conservative_openai
unknown
```

Unknown pricing keeps automatic visual transformation native until a provider-appropriate cost model or explicit operator profile exists.

The profitability gate remains request-specific even after a model becomes eligible.

## Control Plane

The dashboard's Model Fabric surface is catalog-driven rather than a set of fixed compatibility chips.

For each observed/discovered model it can expose:

- provider;
- model ID / aliases;
- lifecycle;
- text/image modality evidence;
- visual profile state;
- runtime policy;
- catalog freshness/provenance;
- observed request count;
- compressed vs pass-through count;
- recent skip reasons.

Runtime activity is evidence. A catalog entry with zero observed requests is not displayed as executed.

## Skills / MCP / subagents

Model Fabric does not alter capability lifecycle semantics.

Agent execution receipts preserve:

```text
registered != selected != scheduled != executed != verified
```

`AgentRunResult.capabilityExecutions` is populated only after a Skill, MCP method or subagent callback actually completes.

Receipts contain bounded identifiers, stage/origin and digests; they do not copy Skill evidence plaintext, MCP parameters or secrets into the dashboard.

The one-call governed task orchestrator forwards the capability router's deterministic schedule into the Agent Runtime and returns the execution receipts produced by the actual callbacks.

## Safety invariants

Release-blocking invariants:

- provider discovery never sends credentials to the browser;
- provider catalog responses are size/time bounded;
- catalog refresh never runs on each proxy request;
- a text-only model cannot be forced into visual context;
- provider-declared modality/capability facts outrank weaker runtime/name inference; a later provider refresh may update them;
- image capability does not imply quality verification;
- quality verification does not imply profitability;
- an unknown provider does not inherit another provider's image pricing;
- ExactGuard remains active under `max_savings`;
- image-count and byte budgets remain active;
- capability selection never becomes an execution claim without an actual callback receipt.

## Future model workflow

For a model released after the installed FuryPipe build:

```text
provider/runtime discovery
        ↓
normalized catalog entry
        ↓
capability evidence
        ↓
visual profile state
        ↓
pricing evidence
        ↓
policy decision
        ↓
ExactGuard + Visual Planner
        ↓
profitability + image/byte budgets
        ↓
execution telemetry
```

This is the mechanism that lets FuryPipe evolve with new providers/models without turning the source tree into a permanent list of compatibility chips.
