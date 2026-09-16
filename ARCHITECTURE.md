# FuryPipe architecture

This document describes the **current public architecture** of FuryPipe.

It is intentionally capability- and boundary-oriented: the presence of a module does not imply that every optional integration is installed, connected, authorized, executed or externally verified.

---

## Architectural goals

FuryPipe is designed to make complex AI workflows easier to govern and audit by keeping five concerns explicit:

1. **what the task needs**;
2. **what context and instructions are allowed into the execution**;
3. **what capabilities may execute**;
4. **what side effects/providers were actually used**;
5. **what evidence proves the resulting state**.

The architecture favors bounded composition over one monolithic agent runtime.

---

## High-level system

```text
┌───────────────────────────────────────────────────────────────┐
│                        Host / caller                          │
│ objective · configuration · registered capabilities · policy │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                      Planning / control                       │
│ Capability Router · Instruction Fabric · Task Orchestrator    │
│ Capability Catalog · Model Adapter Registry · FuryScore       │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                       Context plane                           │
│ Context IR · Context Fabric · Context Optimizer · ExactGuard  │
│ Recovery Store · cache planning · source retrieval            │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                      Execution plane                          │
│ FuryPrompt · Agent Runtime · MCP · Provider Runtime           │
│ governed provider executors · transports · retry/fallback     │
└───────────────────────────────┬───────────────────────────────┘
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
┌──────────────────────────┐     ┌──────────────────────────────┐
│ Memory / learning plane  │     │ Evidence / operations plane │
│ Learning · Knowledge     │     │ receipts · audit chain       │
│ Long-Term Memory         │     │ Control Room · Doctor        │
│ Continuous Memory        │     │ Web Studio · release gates   │
└──────────────────────────┘     └──────────────────────────────┘
```

---

## 1. Planning and capability control

### Capability Router

The Capability Router maps the current task to the subset of capabilities that are relevant to it.

A capability being registered or recommended does not grant execution permission.

### Capability Catalog and FuryScore

Catalog/resolver primitives make capability metadata queryable and rankable while preserving provenance/trust information.

Ranking is advisory. Selection still flows through host policy and runtime availability.

### Instruction Fabric

Instruction Fabric composes task/domain guidance under explicit budgets.

Its core precedence rule is:

```text
explicitly requested rules > automatic task/domain guidance
```

Automatic guidance may be omitted when the instruction budget requires it; caller-mandated rules are not silently discarded.

### Task Orchestrator

The Task Orchestrator provides a composition point for capability planning, instruction assembly and context preparation.

It does not erase the lifecycle state of the underlying capability.

---

## 2. Context plane

### Context IR

Context IR provides typed context blocks and structural identity used by downstream planning/transformation logic.

The architecture avoids treating one flat prompt string as the only representation of context.

### Context Fabric

Context Fabric composes context sources while maintaining source boundaries and metadata required by later policy/optimization decisions.

### Context Optimizer

Context Optimizer chooses the smallest sufficient representation under configured budgets:

```text
metadata → summary → full → executable
```

Promotion through that ladder is deliberate. “Executable” represents a stronger state than merely knowing metadata about a capability or artifact.

### ExactGuard

ExactGuard protects values that must not be silently degraded by lossy transformations.

Examples can include identifiers, exact literals or other protected spans identified by the host/runtime.

### Recovery Store

Recovery provides explicit restoration/persistence primitives with bounded storage behavior.

The host remains responsible for deployment-specific filesystem permissions, key lifecycle and backup policy.

---

## 3. Execution plane

### FuryPrompt

FuryPrompt is the structured prompt/execution-preparation layer used after capability, instruction and context decisions have been made.

It is not treated as proof that a downstream provider call occurred.

### Agent Fabric and Agent Runtime

Agent Fabric defines agent/capability composition. Agent Runtime executes bounded stages with explicit permissions and budgets.

Important defaults:

- execution permissions are explicit;
- network/write access is bounded rather than assumed;
- side effects are distinct from planning;
- successful external execution is not automatically retried because a later memory/telemetry step failed.

### MCP

FuryPipe includes:

- modern MCP primitives;
- an HTTP Node transport;
- compatibility/runtime surfaces for existing integrations;
- hosted-conformance tooling/evidence paths.

Local protocol correctness and hosted interoperability are separate evidence states. OAuth authorization-server behavior is also a separate boundary and must not be inferred from ordinary MCP conformance.

### Provider runtime

The provider stack is intentionally layered:

```text
provider discovery / registry
        ↓
attempt planning
        ↓
authorization / execution gate
        ↓
transport health / eligibility
        ↓
governed request or stream executor
        ↓
execution receipt / audit evidence
        ↓
retry / fallback orchestration
```

FuryPipe keeps provider availability, authorization, health and execution separate to prevent a configured adapter from being reported as a successful call.

### Retry and fallback

Fallback planning reconstructs an attempt from model-neutral/source inputs rather than blindly mutating a failed provider-specific request.

This protects provider boundaries and keeps fallback behavior auditable.

---

## 4. Memory and learning

### Learning and Knowledge

Learning/Knowledge primitives store bounded, structured information instead of treating an entire transcript as durable truth.

### Long-Term Memory

Long-Term Memory supports revision/scoping and keeps logical forgetting distinct from physical purge.

### Continuous Memory

Continuous Memory operates around the host turn boundary:

```text
bounded recall
    ↓
execution
    ↓
governed learning (after successful execution)
```

Recalled memory is explicitly treated as **data**, not as a higher-priority instruction source.

Secrets and sensitive material remain subject to policy before persistence.

---

## 5. Policy and trust

### Policy Engine / Fabric / Runtime

Policy primitives centralize allow/deny/fallback decisions that would otherwise become scattered across transports and agents.

A policy decision can block execution even when a capability is technically available.

### FuryTrust

FuryTrust and ecosystem ingestion track provenance/trust metadata used when evaluating external capabilities and ecosystem sources.

Trust metadata informs decisions; it is not equivalent to execution permission or verification.

---

## 6. Evidence and operations

### Receipts

Receipts are used to record what was planned/executed without promoting unsupported lifecycle states.

Where applicable, receipts avoid storing sensitive plaintext and instead use bounded metadata/hashes/identifiers.

### Provider audit chain / ledger

Provider execution primitives include append-oriented audit evidence so attempts can be reasoned about after execution.

### Doctor

Doctor provides environment/runtime diagnostics. A successful doctor check proves only the checks it actually executes.

### Control Room

Control Room aggregates runtime and CI/security evidence for operational inspection.

It must preserve source identity and evidence state rather than converting missing evidence into “green”.

### Web Studio

Web Studio is a separate UI/runtime surface with its own browser and hosted-conformance evidence.

Structural accessibility and browser execution are not substitutes for every possible external-integration or manual audit.

---

## 7. Truth-state contract

The following distinctions are architectural invariants:

```text
recommended != installed != connected != approved
approved != executable != executed != verified
wired != executed != verified
verified != released
released != deployed
```

When proof is absent, use states such as:

- `UNKNOWN`
- `NOT_EXECUTED`
- `PARTIAL`
- `BLOCKED`

The system should fail closed instead of inventing evidence.

---

## 8. Security boundaries

FuryPipe treats these as explicit trust boundaries:

- external content entering context;
- recalled memory;
- tool/MCP output;
- provider credentials;
- provider request construction;
- Agent Runtime side effects;
- filesystem persistence;
- network exposure;
- release and provenance evidence.

See [SECURITY.md](SECURITY.md) and [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the security model.

---

## 9. Runtime surfaces

### Node

The Node runtime is loopback-oriented by default and should be placed behind appropriate authentication/TLS controls before non-loopback exposure.

### Cloudflare Workers

Worker deployment is a separate runtime surface with its own secret/configuration boundary.

### CLI / offline export

The CLI can perform diagnostics and prepare context artifacts without requiring proxy execution.

### Library entry points

The package exposes focused modules through `package.json#exports`, allowing hosts to compose only the layers they need.

---

## 10. Compatibility and provenance

FuryPipe is the current public product identity.

Historical aliases from the upstream codebase remain only where needed for compatibility or provenance. New APIs/configuration/documentation must use FuryPipe-native naming.

See:

- [COMPATIBILITY.md](COMPATIBILITY.md)
- [UPSTREAM.md](UPSTREAM.md)
- [SOURCE_LEDGER.md](SOURCE_LEDGER.md)
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

---

## 11. Release architecture

Release state is evidence-driven and separate from deployment state.

The repository maintains independent gates for areas such as:

- CI;
- CodeQL/static analysis;
- secret scanning;
- supply-chain checks;
- license compliance;
- benchmark contracts;
- package smoke validation;
- provenance/attestation;
- source/tag/version binding;
- release-readiness evaluation.

The first public `0.13.2` npm publication was bootstrapped manually, after which npm Trusted Publishing was configured for automated releases. This history does not retroactively turn the bootstrap publish into an npm provenance claim.

See [docs/RELEASE_SECURITY.md](docs/RELEASE_SECURITY.md) for the release evidence record.
