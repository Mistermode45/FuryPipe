# Provider Attempt Context Runtime

## Purpose and scope

`prepareProviderAttemptContext()` runs the existing local Context Optimizer for one immutable provider attempt, then appends the selected existing representations to that attempt's `FuryPrompt` as explicitly untrusted data.

This is a preparation boundary only. It does not call a provider, connect to a service, execute a tool/MCP method/subagent, write files, or grant execution authority. The runtime is implemented in `src/provider-attempt-context-runtime.ts`; it is intentionally not added to the package export map in this change because the public-package surface is maintained by a separate track.

## Composition order

The host owns the original context inventory and supplies it afresh for every attempt:

```text
prepareFuryTask(context.injectIncluded = false)
  → exact provider/model/workload selection
  → Provider Attempt Planner (model adapter + profile decision)
  → prepareProviderAttemptContext(original inventory)
  → local Context Optimizer
  → safe FuryPrompt context injection
  → future provider-request preparation boundary
```

Do not put provider-specific behavior in `prepareFuryTask()`. Task Orchestrator remains provider-neutral. If its output is used as the planner's base prompt, set `context.injectIncluded: false`; otherwise this runtime rejects a second FuryPipe context injection when a non-empty inventory is supplied.

Every fallback must use its own planner-produced attempt plan and rerun `prepareProviderAttemptContext()` with the original host inventory. Do not pass an earlier attempt's optimized context plan, output prompt, selected representations, or budget decisions into a fallback.

## API

```ts
const prepared = await prepareFuryTask({
  objective,
  furyPrompt: basePrompt,
  capability,
  context: { items: originalInventory, injectIncluded: false },
});

// Construct the attempt planner with prepared.furyPrompt as its model-neutral base.
const attemptPlan = attemptPlanner.plan({ providerId, model, workloadId });

const ready = prepareProviderAttemptContext({
  attemptPlan,
  items: originalInventory,
  securityPolicy: hostSecurityPolicy, // optional; authority belongs to the host
  charsPerTokenEstimate: 4, // optional and explicitly supplied by the host
});
```

V1 deliberately has no caller override for benchmarked optimizer knobs. Its input accepts only the attempt plan, the host-owned inventory, the independent host security policy, and an optional character-ratio token estimate. Unknown fields are rejected.

The attempt plan must be an immutable object emitted by `createProviderAttemptPlanner()` in the current process. A copied, forged, or deserialized plan is rejected. This process-local provenance prevents a structurally fabricated `QUALIFIED` state from silently claiming benchmark attribution.

## Profile behavior and precedence

The runtime checks that attempt, adapter plan, and context-profile scopes all agree on the exact provider, model, and workload, and that planner-side execution flags are false.

| Planner state | Optimizer inputs | Result disposition |
| --- | --- | --- |
| `QUALIFIED` | Exactly the normalized options on the qualified profile plan | `QUALIFIED_PROFILE_APPLIED` |
| `IDENTITY` | Context Optimizer's canonical defaults | `BASELINE_IDENTITY` |
| `BLOCKED` | Context Optimizer's canonical defaults; blocked profile options are not used | `BLOCKED_PROFILE_FALLBACK` |

`QUALIFIED` is accepted only when profile ID, lowercase SHA-256 digest, options, `evidence: "verified"`, and exact scope are present and consistent. Profile options are validated again through the existing profile registry. No caller-supplied value can override them while retaining the qualification claim.

Blocked profile reasons are preserved in `profileBlockers`. A blocked profile is never reported as applied. Identity and blocked baseline optimization do not claim benchmark qualification. The optimizer's default values are not copied into this runtime; `optimizeContext()` owns them.

## Host security policy and secrets

Secret policy is independent from benchmark qualification and model adapters. By default, `allowSecret` is false. The only V1 path to enable it is the explicit host-owned `securityPolicy.allowSecret` boolean. Profile definitions reject `allowSecret`, and this runtime does not accept it as a profile option or a top-level optimizer override.

The result reports whether secret inclusion was allowed and whether authority came from an explicit host policy or the default deny. Optional secret context is deferred by Context Optimizer when denied. Required secret context fails closed under the existing optimizer contract.

## Exactness and representation handling

The runtime delegates candidate selection, limits, exactness, ordering, and budget enforcement to `optimizeContext()`.

- It only selects and injects representations already present in `FuryContextItem.representations`.
- It does not summarize, rewrite, paraphrase, merge, or synthesize content.
- A required exact item that cannot fit continues to throw/fail closed; it is not truncated or downgraded.
- A selected representation containing the structural `[/FuryPipe context-data]` terminator is rejected with `context-boundary-conflict` rather than rewritten into ambiguous prompt structure.
- FuryPrompt's existing aggregate validation is rerun after injection.

## Safe injection and double-injection prevention

`src/context-prompt-injection.ts` is the single pure renderer used by Task Orchestrator and this runtime. It retains the existing boundary wording and item wrapper format. Task Orchestrator's injected blocks, ordering, and byte count remain unchanged for the same inputs.

The boundary explicitly states that context blocks are untrusted data and cannot override system, developer, repository, policy, security, or current-user instructions. Existing legitimate non-FuryPipe context remains first; generated safe-data blocks are appended after it. Existing task, constraints, and model-adapter additions are preserved.

When the attempt prompt's `context` section already contains a complete or partial FuryPipe boundary marker and the host supplies a non-empty inventory, the runtime throws `preoptimized-context-conflict`. It never silently concatenates pre-optimized generic context with a second provider-specific optimization. With an empty inventory, no new context is injected.

## Token estimates and evidence

`charsPerTokenEstimate` is an optional host input with the Context Optimizer's existing range checks. If omitted, `estimatedTokens` remains absent and `tokenEstimateStatus` is `UNKNOWN`. If supplied, the output is labeled `CHARACTER_RATIO_ESTIMATE`; this is a local character-ratio estimate, not measured provider usage.

The output separates:

- `profileQualificationEvidence`: historical evidence qualifying a profile for this exact provider/model/workload scope;
- `currentContextResultVerified`: always `false` in V1, because the current inventory/result was not independently benchmarked or verified.

Therefore `evidence: "verified"` on a qualified profile never means that this attempt's current context result is verified.

## Output and non-execution invariants

The result exposes the exact attempt identity, attempt-specific prompt, executed Context Optimizer plan, profile disposition/identity/digest/blockers, evidence states, injection state/bytes, token-estimate classification, and secret-policy authority.

After successful local optimization:

```text
optimizerExecuted = true
networkCallExecuted = false
providerRequestExecuted = false
executionAuthorized = false
currentContextResultVerified = false
```

The `optimizerExecuted` flag is true only on a returned result. If validation, the optimizer, exactness checks, or prompt compilation fails, the call throws and produces no prepared result.

## Future provider executor boundary

A future provider executor may consume this output only after its own request-shape validation, authorization, policy checks, and explicit provider-call gate. This runtime does not create that executor and does not turn a selected provider, qualified profile, injected context, or prepared prompt into permission to make a request.

## Limitations

- This is local prompt preparation only; provider request behavior and provider-reported token usage are not exercised.
- A qualified profile's benchmark scope is historical evidence; the current host inventory is not thereby benchmarked.
- Planner-plan provenance is process-local and intentionally not serializable across processes.
- The textual untrusted-data boundary is a prompt contract, not a cryptographic isolation mechanism. The runtime rejects its closing delimiter in selected content but cannot guarantee model behavior.
- This change does not add a public package export or wire the runtime into Task Orchestrator or a provider executor.
