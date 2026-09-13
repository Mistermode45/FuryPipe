# FuryPipe Capability Catalog Resolver

## Purpose

The Capability Catalog Resolver turns the static ecosystem registry into a ranked recommendation surface.

It composes existing FuryPipe primitives:

```text
Capability Registry
      ↓
recorded FuryTrust report
      ↓
task relevance
      ↓
optional qualified performance evidence
      ↓
FuryScore
      ↓
recommendations / blocked / skipped
```

It does not install, connect, execute, or authorize capabilities.

Every resolution returns:

```text
executionAuthorized: false
```

## Inputs

A resolution receives:

- a `CapabilityRegistry`;
- an optional registry query;
- explicit relevance values by candidate ID;
- optional provider/model/workload scope;
- optional qualified FuryScore performance evidence;
- a bounded result limit.

The resolver does not invent relevance.

Semantic task matching belongs to Capability Router or another host-owned analyzer.

## Registry query first

The registry query is applied before scoring.

Example:

```text
domains = ["minecraft"]
types   = ["skill", "mcp"]
```

Only candidates in that resolved registry set are valid for the request.

A relevance or performance entry that references a candidate outside the resolved query fails closed rather than being silently ignored.

This prevents stale ranking data from leaking across scopes.

## Trust requirement

A candidate must have a FuryTrust report already recorded in the registry.

If the candidate exists but has no trust report, it is returned under:

```text
skipped:
  reason = missing-trust-report
```

The resolver never synthesizes or guesses a trust verdict.

## Relevance requirement

A candidate without task relevance is skipped:

```text
missing-relevance
```

This is intentional.

A tool should not receive a non-zero recommendation simply because it exists in the catalog.

## Performance evidence

Qualified performance evidence remains bound to:

- exact candidate ID;
- provider;
- model;
- workload;
- benchmark artifact digest.

The resolver passes this evidence to FuryScore unchanged.

It does not reinterpret, aggregate, or broaden benchmark scope.

## Output classes

### recommendations

Contains non-blocked FuryScore results, ordered by the FuryScore policy.

Possible states include:

- `RANKED`;
- `REVIEW_REQUIRED`;
- `REFERENCE_ONLY`.

A recommendation is not execution authority.

### blocked

Contains scored candidates whose routing state is:

```text
BLOCKED
```

Examples include FuryTrust:

- BLOCKED;
- QUARANTINED;
- UNKNOWN;

or an integration decision of REJECT.

Even relevance = 1.0 cannot move these candidates into recommendations.

### skipped

Candidates that could not be scored because required local evidence is missing:

- missing relevance;
- missing FuryTrust report.

## Result limit

`maxResults` applies only to recommendations.

Blocked candidates remain visible for auditability and skipped candidates remain visible for diagnostics.

The default recommendation limit is 20 and V1 caps it at 100.

## Safety boundary

Capability Catalog Resolver performs no:

- package installation;
- source download;
- MCP connection;
- plugin activation;
- subprocess execution;
- network request;
- filesystem mutation;
- provider invocation;
- credential use;
- deployment;
- external write.

It is a planning/ranking primitive only.

## Relationship to Capability Router

The intended future path is:

```text
user task
   ↓
Capability Router / semantic analyzer
   ↓
candidate relevance
   ↓
Capability Catalog Resolver
   ↓
ranked trusted recommendations
   ↓
host policy / availability / permission checks
   ↓
Capability Router runtime inventory
   ↓
Agent Runtime
```

The catalog must never bypass the runtime inventory.

A highly ranked ecosystem candidate that is not actually installed, connected, authorized, or mounted must remain unavailable to execution.

## Relationship to FuryTrust

FuryTrust answers:

> What does static/local evidence say about this candidate's risk and review state?

Catalog Resolver never upgrades that verdict.

## Relationship to FuryScore

FuryScore answers:

> Given task relevance and available evidence, how should candidates be ordered?

Catalog Resolver supplies registry candidates and their recorded trust reports to that scorer, then separates blocked results from recommendations.

## Current limitations

V1 does not yet:

- infer semantic relevance itself;
- auto-ingest internet sources;
- auto-connect recommended tools;
- benchmark capabilities;
- authorize runtime use;
- map arbitrary ecosystem candidates directly into Agent Skill or MCP runtime definitions.

Those are separate stages and must preserve the same provenance, trust, permission, and evidence boundaries.
