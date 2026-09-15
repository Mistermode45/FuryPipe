# Provider Attempt Context Runtime Receipts

## Purpose

createProviderAttemptContextReceipt() creates a compact, plaintext-free audit record for one FuryProviderAttemptContextRuntimeResult.

This receipt describes the state **after** local Context Optimizer execution and safe FuryPrompt context injection, but **before** any provider transport or provider request.

It records the exact provider/model/workload scope, final prompt identity, optimized context-plan identity, profile disposition, secret-policy authority, estimate state, and execution flags without persisting prompt text or selected context plaintext.

## Public package surface

~~~ts
import {
  createProviderAttemptContextReceipt,
  verifyProviderAttemptContextReceipt,
} from 'furypipe/provider-attempt-context-receipt';
~~~

The package smoke installs a freshly packed FuryPipe tarball and imports this subpath.

## Boundary

~~~text
Provider Attempt Plan
        ↓
Provider Attempt Context Runtime
        ↓
Context Optimizer executed locally
        ↓
safe data-only context injection
        ↓
FuryProviderAttemptContextRuntimeResult
        ↓
structural receipt validation
        ↓
plaintext-free receipt
~~~

The receipt does not call a provider, call a network transport, execute a tool/MCP/skill/subagent, authorize a future provider request, prove provider acceptance, or prove the current optimized context was benchmark-verified.

## Plaintext-free design

The receipt never serializes FuryPrompt section contents, optimized context contents, context item IDs, or deferred context item IDs.

The final FuryPrompt is represented by promptDigest, sourceDigest, compileInputDigest, prompt byte count, and FuryPrompt level.

The optimized Context Plan is represented by planDigest, included/deferred counts, byte summaries, budgets, stable-prefix bytes, cache-ordering state, kind counts, deferred-reason counts, and optional token-estimate metadata.

The Context Plan digest commits to each included item's hashed ID, kind, selected level, content SHA-256, byte/character metrics, cache class, exactness, and inclusion reason. Deferred entries use a hashed ID plus kind and reason. Those values are processed locally but plaintext is not copied into the receipt.

## Prompt identity

Receipt creation recompiles the final runtime FuryPrompt through the existing FuryPrompt compiler. Changing the final injected context changes the prompt identity.

## Context Plan structural checks

The receipt revalidates the returned Context Optimizer Plan instead of blindly copying its summary fields. It checks supported kinds/levels, unique IDs, disjoint included/deferred sets, content byte/character metrics, aggregate bytes, stable-prefix bytes, budgets, saved-byte arithmetic, and optional token-estimate arithmetic.

It intentionally does not impose a monotonic byte-size relationship between representation levels. FuryPipe permits host-provided representations whose semantic levels are not necessarily ordered by byte size.

## Safe injection consistency

The receipt re-renders the existing FuryPipe untrusted-data boundary from the returned Context Plan. When context was injected, the final FuryPrompt context section must end with those exact generated blocks. contextInjected, injectedContextBytes, and tokenEstimateStatus must agree with the plan.

## Profile semantics

The receipt preserves QUALIFIED, IDENTITY, and BLOCKED as distinct states, with QUALIFIED_PROFILE_APPLIED, BASELINE_IDENTITY, and BLOCKED_PROFILE_FALLBACK dispositions.

For a qualified profile it may record profile ID, profile SHA-256 digest, and qualificationEvidence=verified. For identity/baseline or blocked fallback it does not invent applied profile identity or benchmark evidence. Blocker reasons may be retained, but blocker IDs are not copied.

## Benchmark evidence is historical

A qualified profile is historical evidence about the profile definition for its exact scope. It does not verify the current host inventory. The receipt therefore keeps profile.qualificationEvidence and verification.currentContextResult as separate facts.

## Secret policy

Secret authority is recorded separately as allowSecret plus authority=host or authority=default-deny. Default-deny cannot claim allowSecret=true. No secret content is exposed.

## Token estimates

If no charsPerTokenEstimate was supplied, tokenEstimate.status is unknown. If supplied, the receipt records character-ratio-estimate with before/after/saved and the ratio. These are estimates, not provider-reported usage.

## Execution semantics

A valid receipt requires optimizerExecuted=true, networkCallExecuted=false, providerRequestExecuted=false, and executionAuthorized=false.

## Verification semantics

~~~text
structuralConsistency = verified
runtimeProvenance     = not-verified
currentContextResult  = not-verified
providerResult        = not-executed
~~~

structuralConsistency means the supplied result passed this module's structural, prompt, context-plan, injection, profile, and execution-state checks.

runtimeProvenance remains not-verified. This format does not claim persistent or signed provenance for the supplied runtime-result object. A structurally valid copied object may be receipted, but that does not upgrade provenance.

currentContextResult remains not-verified because no benchmark or provider independently verifies the current inventory and selection.

providerResult is not-executed because no provider call occurs at this boundary.

## Receipt digest

The receipt SHA-256 covers a canonical key-sorted JSON representation of every receipt field except receiptDigest. Equivalent property ordering does not change verification; adding/removing/changing a field does.

## Relationship to the Governed Provider Executor

This receipt belongs before the executor:

~~~text
Context Runtime Result
        ↓
Context Runtime Receipt
        ↓
future request preparation / execution gate
        ↓
future provider transport
~~~

Future transport/executor evidence must use separate receipt formats.

## Current limitations

V1 does not provide signed runtime provenance, cross-process attestation, provider transport evidence, provider response evidence, provider-reported usage, billing evidence, remote timestamp authority, or automatic persistence.
