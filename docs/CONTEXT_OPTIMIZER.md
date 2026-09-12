# FuryPipe Context Optimizer

## Purpose

Context Optimizer reduces context cost without silently rewriting exact source material.

It selects among caller-provided representations of the same context item:

```text
metadata
→ summary
→ full
→ executable
```

The optimizer may defer an item, select a smaller representation, or keep the requested representation. It never executes a capability and never invents a replacement summary.

## Design principles

1. Required context wins over optional context.
2. Exact context is never silently downgraded.
3. Secret context is blocked by default.
4. Selected capabilities outrank discovery-only metadata.
5. Discovery-only capabilities load metadata, not full instructions or schemas.
6. Stable and semi-stable context can be ordered before dynamic context when the provider contract allows reordering.
7. Global and per-kind byte budgets are both enforced.
8. Token estimates are optional approximations and never presented as provider-exact token counts.

## Context levels

### metadata

Short discovery information such as capability identity and one-line purpose.

### summary

A bounded, externally produced summary that has already been validated by the caller.

### full

The full contextual material needed for the task.

### executable

Executable-facing material such as complete tool schemas or runtime instructions. Context Optimizer treats this as text only; execution belongs to the relevant runtime and policy layers.

## Item kinds

V1 recognizes:

- instruction
- skill
- tool
- MCP
- memory
- knowledge
- evidence
- tool output
- task state
- transcript
- other

The type is used for per-kind budgeting and diagnostics.

## Deferred discovery

A discoverable capability that has not been selected can be represented with metadata only.

Example:

```text
Playwright
type: tool
purpose: browser QA
```

The full Playwright instructions and schemas remain deferred until Capability Router selects the capability.

This prevents large tool catalogs from occupying the context window before they are needed.

## Budget downgrade

A selected item can expose several representations:

```text
summary: "PASS: 1516 tests, 0 failures"
full:    <large test log>
```

If the full representation does not fit the configured budget, the optimizer can choose the summary representation.

The summary must have been provided by the caller. Context Optimizer does not synthesize it.

## Exactness

An item marked `exact` cannot be silently downgraded below its preferred level.

If an exact optional item does not fit, it is deferred.

If a required exact item does not fit, planning fails closed.

ExactGuard remains the canonical subsystem for byte/token preservation inside source content.

## Secrets

Items marked `secret` are deferred by default.

A required secret causes planning to fail unless the caller explicitly enables `allowSecret`.

Enabling `allowSecret` only permits the item to enter the plan. It does not grant execution authority, network access, logging permission, or persistence permission.

## Cache-friendly ordering

When `strictOrdering=false`, included items are ordered by:

1. stable;
2. semi-stable;
3. dynamic;
4. not-cacheable.

Original source order is preserved within the same cache class.

When provider semantics require strict ordering, the optimizer leaves source order unchanged.

The existing Context Fabric and cache planner remain authoritative for provider-specific cache behavior.

## Token estimates

Callers can optionally provide a `charsPerTokenEstimate`.

The resulting token counts are explicitly estimates. They are useful for comparative planning, not billing, provider accounting, or benchmark truth.

## Relationship to other FuryPipe systems

```text
Capability Router
        ↓
Instruction Fabric
        ↓
Context representations
        ↓
Context Optimizer
        ↓
Context Fabric / ExactGuard / cache planner
        ↓
Provider / Agent Runtime
```

Continuous Memory, Knowledge, tools, and skills can all provide bounded representations to this layer.

## Non-goals

V1 does not:

- summarize arbitrary raw text;
- run an LLM;
- execute skills, tools, MCP, or scripts;
- alter permissions;
- change provider cache markers;
- persist secret material;
- claim exact provider token counts.

These boundaries are intentional: context reduction must not become an implicit data-corruption or authority-escalation mechanism.
