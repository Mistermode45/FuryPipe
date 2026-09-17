# Claude Opus 5 runtime eligibility incident

## Scope

This document records the `unsupported_model` investigation for the observed
`claude-opus-5` requests. It is an evidence record, not a claim that a live
Anthropic account or a production deployment was validated.

## Incident summary

Four persisted FuryPipe events for `claude-opus-5` were observed with HTTP 200
and top-level `reason: unsupported_model`:

- 2026-09-16 18:43:20
- 2026-09-16 18:43:23
- 2026-09-17 00:15:40
- 2026-09-17 00:15:42

The local aggregate also reported five `unsupported_model` skip reasons across
the inspected history. The event evidence is source-bound to the local
`~/.furypipe/events.jsonl` file; it does not prove the value of an historical
shell environment that is no longer available.

The current redacted configuration was:

```text
path=C:\Users\loicd\.config\furypipe\config.json
sha256=41617302376CCD8096DB34B39C11BE0910D01AB32BFAAD58CD7A073C96896D34
models=["claude-opus-5"]
modelScopeExplicit=true
```

No credential, authorization header, cookie, API key or secret-bearing field
is included here.

## Exact source and branch

- integration branch: `v5-production-hardening`
- verified base SHA before edits: `b25e47c086153aad0cdfc0a3c14a081445259ac7`
- investigation branch: `v5-codex-opus5-runtime-eligibility`
- Draft PR: recorded in the final report after publication of the dedicated
  branch

## Reproduction matrix

The direct resolver was exercised with the following source states:

| State | Result for `claude-opus-5` | Evidence source |
| --- | --- | --- |
| no `FURYPIPE_MODELS`, no runtime override | `eligible=true`, `source=automatic_model_fabric`, calibrated | direct resolver test |
| `FURYPIPE_MODELS=claude-fable-5,gemini` | `eligible=false`, `reason=unsupported_model`, `source=operator_scope` | direct resolver test |
| persisted legacy default without explicit marker | automatic migration | `resolvePersistedModelScope` |
| persisted `models=["claude-opus-5"]`, explicit marker | explicit Opus scope | `resolvePersistedModelScope` |
| runtime override `[]` | `unsupported_model`, explicit off | direct resolver test |
| runtime override excluding Opus | `unsupported_model`, explicit operator scope | direct resolver test |

The local and global CLI both resolved to version `0.15.0`; the active local
process was `node bin/cli.js start` under Node `26.8.2`. The active runtime
reported `claude-opus-5` as its current explicit scope and used port `48721`.
The historical process environment cannot be reconstructed from current OS
state, so no stronger claim is made about which shell or launcher supplied the
earlier scope.

## Root cause classification

Primary classification: `CONFIGURATION_DEFECT`.

The historical request was evaluated while an explicit operator scope did not
match `claude-opus-5`. The resolver correctly treated an explicit scope as an
authorization boundary and returned `unsupported_model`. The product issue was
made harder to diagnose because the dashboard had no explicit, persistent way
to return to automatic Model Fabric discovery. This is recorded as secondary
`DASHBOARD_STATE_DEFECT` hardening.

The available evidence does not support `MODEL_FABRIC_DEFECT`,
`APPLICABILITY_DEFECT`, `CLI_VERSION_SKEW` or `STALE_RUNTIME` as the root cause.
The current automatic resolver already admits calibrated Opus 5.

## Actual runtime path

```text
HTTP request
  -> src/core/proxy.ts createProxy request path
  -> resolveFuryPipeModelEligibility(model)
  -> explicit scope mismatch
  -> modelOk=false, modelSkipReason=unsupported_model
  -> transform options use compress=false
  -> r.info.reason=unsupported_model
  -> tracker event top-level reason
  -> stats aggregation and /api/models.json runtime activity
  -> Control Plane / dashboard fragment
```

In automatic mode the same path resolves Opus 5 through Model Fabric as
Anthropic, image-capable and calibrated. No resolver relaxation was made.

## Changes

- `src/model-config.ts`: accepts the persisted `modelScopeMode=automatic`
  marker without exporting an allowlist.
- `src/core/applicability.ts`: exposes the effective scope as `automatic`,
  `explicit` or `off`, while retaining the existing fail-closed resolver.
- `src/node.ts`: persists automatic mode by removing the old static scope
  keys, preserves explicit/off writes, and accepts the bounded dashboard
  `{mode:"automatic"}` request.
- `src/dashboard.ts`: propagates scope mode to Control Plane and Model Fabric,
  and adds the automatic-mode action through the existing protected route.
- `src/dashboard/fragments.ts` and `src/i18n/catalogs.ts`: display the
  evidence-backed effective scope and translated recovery action.
- `src/control-plane.ts`: validates and serializes `modelScopeMode` as part of
  the source-bound runtime contract.
- regression tests cover persisted mode precedence, invalid snapshot mode,
  dashboard round-trip/persistence callbacks, and the proxy Opus 5 automatic
  path.

## Final scope state contract

The effective scope resolver uses this precedence, without treating a static
list as a complete Model Fabric catalog:

| Precedence | State | Source |
| --- | --- | --- |
| 1 | `automatic`, `explicit`, or `off` | dashboard runtime override |
| 2 | `explicit` or `off` when non-empty/kill-switch input exists | `FURYPIPE_MODELS` environment |
| 3 | `automatic`, `explicit`, or `off` | persisted `modelScopeMode` plus legacy `models` |
| 4 | `automatic` | built-in default when no operator scope exists |

`modelScopeMode: "automatic"` ignores stale legacy list keys. A persisted
`modelScopeMode: "off"` and an explicit empty list both remain `off` after a
restart. An unmarked legacy `models=["claude-fable-5","gemini"]` is migrated
logically to automatic discovery without broadening a custom legacy list.
Environment values remain authoritative over the file. A dashboard request to
restore automatic clears only a scope that FuryPipe injected from the config;
it never removes an operator-owned environment variable.

An empty or whitespace-only `FURYPIPE_MODELS` value is treated as absent at the
configuration boundary. This keeps startup, Doctor and the resolver aligned:
the persisted `automatic`, `explicit` or `off` state is then visible instead
of an empty environment value accidentally forcing the built-in automatic
default. Persisted `explicit` state is fail-closed when its list is missing,
empty, malformed, or contains non-string entries; an unknown persisted mode
also resolves to `off`. This prevents malformed operator state from silently
granting automatic Model Fabric eligibility.

Environment, persisted, and dashboard scopes are bounded to 64 entries and
160 characters per entry, with control characters rejected. Oversized or
malformed input fails closed before the dashboard policy or configuration
writer is reached; the list is never silently truncated.

The mutating model endpoint accepts only `automatic`, `explicit`, or `off` and
rejects unknown modes and contradictory mode/list payloads before applying a
policy or writing the config.

## Operator diagnostics and telemetry

`furypipe doctor --json` reports package version, source commit when supplied,
entrypoint, Node executable, discovered global `furypipe` path, model-scope
mode/source, and visual policy. Automatic mode intentionally reports an empty
`effectiveModels` list because Model Fabric discovery is dynamic; it does not
pretend that the compatibility seed is a complete catalog. Paths and upstream
URLs are metadata-only and credentials are not read or printed.

Runtime startup logs one bounded line such as
`[furypipe] model scope: automatic (source=config)`. Persisted events keep the
backward-compatible `reason: "unsupported_model"` value, while a known model
excluded by an explicit operator scope also receives the bounded
`eligibility_cause: "operator_scope_excluded"` field. Stats expose that cause
separately, so historical compatibility labels do not hide the operator action.

## Request-path evidence map

```text
HTTP request
  -> bounded body + wire/provider route parsing (src/core/proxy.ts)
  -> effective model / alias resolution
  -> resolveFuryPipeModelEligibility (src/core/applicability.ts)
  -> visual profile, provider capability, pricing evidence
  -> transform + ExactGuard + profitability gates (src/core/transform.ts)
  -> upstream request and usage response
  -> ProxyEvent -> DashboardState / Control Room observer
  -> toTrackEvent -> JSONL / Worker log
  -> stats aggregation -> dashboard / Control Plane JSON and fragments
```

The model-scope decision is authorization for visual transformation only. It
does not prove provider routing, pricing, execution, release, or deployment.

## Compatibility and safety

An explicit `FURYPIPE_MODELS` environment variable still wins over file
defaults. The dashboard action changes the in-process override and persisted
file, but it cannot remove an operator-owned environment variable from the
host process. `off` remains explicit and fail-closed. Reading the dashboard
does not call a provider, execute an agent, or trigger Model Fabric discovery.

The config write remains write-then-rename with restrictive file and directory
modes. User-visible strings use the existing FR/EN catalogues. Model IDs remain
escaped at the HTML boundary, and the new mode is an allowlisted union. The
current process performs each synchronous read/modify/write atomically with
respect to its Node event loop; concurrent independent processes sharing one
config path remain an operational constraint and are not represented as a
distributed lock guarantee.

## Validation status

The exact local and CI results are maintained in the final report for the final
Draft PR SHA. Until that report is written, no status in this document should
be interpreted as a completed release, hosted runtime, provider, OAuth,
browser-client or production validation.

## Rollback

The reversible rollback is to close/revert the dedicated Draft PR changes or
select the required explicit scope again. No source reset, force-push, merge,
tag, release, npm publication or deployment is part of this incident work.
