# FuryPipe VNext — Phase 5 Automations + Webhooks

**Status:** implementation in progress — Gates 5.0–5.3 validated; Gate 5.4 implemented and awaiting exact-head validation  
**Stack base:** exact validated Phase 4 HEAD `c145e561d5e12e3cf7cc8ae02dced5bfb461b443`  
**Branch:** `vnext-phase5-automations-webhooks`

## 1. Goal

Implement VNext Phase 5:

```text
Automations + webhooks
```

Phase 5 adds persistent scheduled/event-triggered work to Fury Gateway while preserving the existing identity, session, command, capability and evidence boundaries.

It does not create a second agent runtime, a permanent super-session, or a second durability subsystem.

## 2. Source-of-truth invariants

Phase 0 requires:

```text
scheduled != authorized forever
```

At every wake-up, current policy, capability availability and credential state must be re-evaluated.

Durable execution additionally requires:

```text
every external side effect has a stable execution identity
```

and:

```text
process restart != permission to replay an uncertain side effect
```

## 3. Lifecycle distinctions

Automation lifecycle:

```text
defined
!= enabled
!= trigger eligible
!= trigger observed
!= due
!= claimed
!= policy revalidated
!= execution admitted
!= execution started
!= side effect attempted
!= outcome known
!= succeeded
!= verified
!= notification delivered
```

Webhook lifecycle:

```text
request received
!= source authenticated
!= payload accepted
!= replay checked
!= trigger matched
!= automation claimed
!= execution authorized
```

Recovery lifecycle:

```text
durable record exists
!= run is executable
!= claim is current
!= side effect is replay-safe
```

## 4. Durable identities

Stable canonical identities:

- `automationId`: long-lived automation definition identity;
- `triggerId`: deterministic or persisted identity for one trigger occurrence;
- `runId`: stable identity for one logical automation run;
- `claimId`: short-lived process claim used only to coordinate workers;
- `executionIdentity`: stable run-scoped identity attached to external side effects.

A process restart may create a new claim but must not create a new logical run for the same trigger occurrence.

## 5. Authority model

Automation definitions store **requested policy scope**, never eternal authority.

Definitions may persist:

- requested Fury Gateway scopes;
- requested plugin/capability permissions;
- target workflow identifier;
- schedule/event policy;
- notification policy reference;
- bounded budgets.

They must not persist:

- live Gateway session leases;
- process-local execution permits;
- plaintext API credentials;
- browser cookies/session authority;
- provider/tool permits;
- a historical authorization decision as future authority.

At each run:

1. load durable definition and trigger evidence;
2. verify automation is enabled and current;
3. establish current authenticated principal/automation policy context;
4. re-resolve current capability availability;
5. re-run command/policy admission;
6. mint fresh bounded execution permits only after current admission;
7. record side-effect attempt before or atomically with invocation where supported;
8. record known outcome or `outcome-unknown`.

## 6. Claim semantics

A due run may be claimed by one process at a time.

Claims require:

- bounded lease TTL;
- stable `runId`;
- unique `claimId`;
- claimant instance digest;
- claimed/expires timestamps;
- generation/version fencing.

An expired claim is coordination evidence only.

Reclaim is permitted only to continue pre-side-effect work or to inspect recovery state.

If durable evidence says an external side effect may already have been invoked and its outcome is unknown:

```text
automatic replay = forbidden
```

Recovery must surface the run as blocked / outcome-unknown until explicit reconciliation or provider-specific idempotent evidence proves safe continuation.

## 7. Trigger classes

Phase 5 target trigger types:

- one-shot timestamp;
- interval;
- cron;
- webhook;
- message/event;
- file/repository event;
- external connector event;
- condition watch.

Implementation order:

1. one-shot + interval;
2. authenticated webhook;
3. cron;
4. connector/event adapters;
5. condition watch.

Trigger parsing is data validation only. It never grants execution authority.

## 8. Schedule semantics

All persisted timestamps use UTC epoch milliseconds.

Definitions may optionally retain a named IANA time zone for calendar/cron interpretation.

Required behavior:

- no implicit server-local timezone;
- bounded catch-up;
- no unbounded backlog after downtime;
- deterministic next-due computation;
- explicit misfire policy;
- DST behavior must be specified and tested for cron;
- clock rollback/forward must not duplicate a logical trigger occurrence.

Initial misfire policies:

```text
skip
run-once
```

No `run-all-missed` policy in the first implementation.

## 9. Webhook ingress

Webhook ingress belongs to Fury Gateway.

Requirements:

- exact route ownership;
- bounded body size;
- content-type allowlist;
- source-specific authentication before trigger creation;
- replay window / nonce or provider event-ID protection where available;
- constant-time secret comparison where symmetric secrets are used;
- raw secret values remain host-owned and are never returned by observability;
- body/payload digest may be retained as evidence;
- payload content is untrusted data, never authority;
- one external event ID maps to at most one logical trigger occurrence for an automation.

Unknown, unauthenticated or replayed requests must not create executable runs.

## 10. Durable storage

Phase 5 should reuse FuryPipe `RecoveryStore` primitives rather than inventing a parallel persistence engine.

Separate durable record classes:

- automation definition revisions;
- trigger occurrences;
- run state snapshots;
- claim/fencing evidence;
- side-effect attempt/outcome receipts;
- reconciliation/tombstone records.

Retention and compaction must preserve the minimum evidence needed to prevent unsafe replay.

GC must never erase the only evidence that distinguishes:

```text
not attempted
from
possibly attempted / outcome unknown
```

until the relevant recovery/retention policy explicitly permits terminal compaction.

## 11. Observability

Dashboard/WebChat observability may expose only bounded redacted state such as:

- automation counts by enabled/disabled state;
- runs by lifecycle status;
- due/claimed/blocked/outcome-unknown counts;
- next due timestamp;
- webhook source type and authentication state;
- digests/opaque identifiers where needed.

Observability remains:

```text
authority = observability-only
executionAuthority = false
```

Browser visibility must not become a scheduler, webhook or execution permit.

## 12. Notifications

Phase 4 notification delivery is downstream of automation run state.

```text
automation succeeded
!= notification created
!= delivery attempted
!= delivered
!= acknowledged
```

A notification failure must not rewrite a successful run as a failed execution.

A delivered notification must not turn an unverified or outcome-unknown run into success.

## 13. Initial implementation gates

### Gate 5.0 — architecture contract

Freeze lifecycle, identities, claims, replay and webhook trust boundaries.

### Gate 5.1 — durable automation definition store — VALIDATED

Persist versioned definitions through `RecoveryStore` with strict validation, bounded quotas and no credentials/session permits.

Exact validated Gate 5.1 SHA: `4165308b0aa665bcec799c76d088411b79608d5b`.

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- 9 dedicated definition-store tests;
- package smoke SUCCESS on Windows/macOS/Linux, Node 22/24/26.

### Gate 5.2 — durable trigger/run ledger — VALIDATED

Create stable trigger/run identities, state transitions, fencing and restart recovery.

Exact validated Gate 5.2 SHA: `485c8ebaa3afa9cd38553e0e5ce572b623faba6f`.

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- durable occurrence identity, claim fencing and restart fail-closed semantics;
- armed-without-terminal recovers as `outcome-unknown`;
- automatic replay remains forbidden.

### Gate 5.3 — one-shot + interval scheduler — VALIDATED

Deterministic due computation, bounded catch-up and claim leasing.

Exact validated Gate 5.3 SHA: `3b3c4e70784625576e501f9d9c23c66682232fd8`.

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- deterministic one-shot and interval occurrence selection;
- `run-once` coalesces downtime to one latest logical occurrence;
- `skip` uses an explicit bounded misfire grace;
- durable trigger watermark prevents clock rollback from backfilling older occurrences;
- stable trigger identity deduplicates one occurrence across definition revisions;
- scheduler races converge to one durable run/claim.

### Gate 5.4 — governed run admission — IMPLEMENTED

Revalidate current policy/capabilities and mint fresh bounded execution authority per run.

Implemented boundaries:

- current generated claim required;
- durable trigger must still point at the current exact definition revision/SHA;
- definition must still be enabled;
- current generated Gateway session must match the automation owner;
- existing Gateway command admission is reused for current scopes and plugin/capability permissions;
- admission decisions remain `executionAuthority:false`;
- only a process-local short-lived run permit has `executionAuthority:true`;
- permit lifetime is bounded by permit TTL, claim lease and session expiry;
- permit consumption revalidates run state, current definition and Gateway session again;
- copied/forged permits are rejected;
- consumed permits are one-shot;
- session/principal revocation, definition drift or run-state transition makes an unconsumed permit stale.

Dedicated admission tests prove principal mismatch, missing current capability scope,
definition drift, disabled definitions, bounded permit lifetime, permit one-shot use,
copy/forgery rejection, session revocation and stale-run rejection.

### Gate 5.5 — authenticated webhook ingress — VALIDATED

Bounded request surface, HMAC-SHA256 authentication, durable replay protection and
trigger mapping are implemented.

Exact validated Gate 5.5 SHA:

`f19e1f82446dcb0cc09c5d1687736837d87b4141`

Evidence:

- 7/7 workflows SUCCESS;
- 9/9 CI matrix SUCCESS;
- 15 dedicated webhook tests;
- 16 run-admission tests;
- 13 scheduler tests;
- 246 test files / 2,862 tests SUCCESS on the observed Linux CI job;
- package smoke SUCCESS across Windows/macOS/Linux and Node 22/24/26;
- raw body, raw event ID, webhook signature and webhook secret are not persisted
  by the webhook journal;
- exact authenticated replay maps to one logical run;
- conflicting reuse of an event ID fails closed.

### Gate 5.6 — cron scheduler — IMPLEMENTED

IANA timezone-aware five-field cron scheduling is implemented without adding a
third-party cron/timezone runtime.

Implemented semantics:

- supported fields: minute, hour, day-of-month, month and day-of-week;
- supported syntax: wildcard, lists, ranges and bounded steps;
- named IANA timezone is mandatory and normalized through the platform
  `Intl.DateTimeFormat` timezone database;
- persisted execution timestamps remain UTC epoch milliseconds;
- no implicit server-local timezone;
- `run-once` coalesces downtime to one latest due cron occurrence;
- `skip` obeys the existing bounded misfire grace;
- definition creation/start bounds prevent pre-definition backfill;
- explicit `endAt` is honored;
- spring-forward nonexistent local minutes are skipped;
- fall-back repeated local minutes map to two distinct UTC occurrences;
- Vixie/POSIX OR semantics are used when both day-of-month and day-of-week are
  restricted;
- durable trigger watermark prevents clock rollback from recreating an older
  logical occurrence.

Dedicated cron tests include DST spring/fall behavior, non-leap-century search,
misfire handling, end bounds and server-local-time independence.

### Gate 5.7 — observability + notification integration — IMPLEMENTED

Automation observability and downstream Phase 4 notification planning are
implemented as data-only surfaces.

Observability:

- `automations.status` is inspect-only;
- definition IDs are represented by digests in summaries;
- output is bounded and reports truncation explicitly;
- run summaries preserve `outcome-unknown` and
  `automaticReplayAllowed:false`;
- observability is always `authority:'observability-only'` with
  `executionAuthority:false`;
- credentials, webhook bodies and delivery payload bodies are not exposed.

Notification integration:

- pending/claimed runs are not notification-eligible;
- known terminal outcomes may create one downstream notification plan;
- `outcome-unknown` creates reconciliation-oriented warning intent and does not
  authorize replay;
- durable notification intent is reserved before downstream notification
  creation;
- concurrent bridges converge on one durable notification intent;
- after restart an existing durable intent requires reconciliation instead of
  silently recreating delivery;
- notification delivery success/failure never rewrites the automation run's
  execution outcome.

### Gate 5.8 — final durability/restart evidence — IMPLEMENTED

The final evidence gate adds cross-component tests for the Phase 5 invariants:

- a crash after durable side-effect arming recovers as `outcome-unknown`;
- recovered `outcome-unknown` cannot be automatically reclaimed/replayed;
- two cron schedulers racing on one occurrence converge on one durable run and
  one claim;
- authenticated webhook payload content cannot self-grant requested scopes or
  plugin permissions;
- automation observability does not expose webhook payload, raw event ID,
  principal ID or webhook source ID;
- exact webhook replay after coordinator restart remains one durable event and
  one logical run.

The pre-documentation Gate 5.8 code SHA
`7a7bd06ac2c3b88d87aababb2dc50e6c8adfa9a6` showed:

- typecheck SUCCESS on observed CI runners;
- 250 test files / 2,893 tests SUCCESS on Ubuntu 24.04 / Node 22;
- package smoke SUCCESS on that runner;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA and Cross-Browser QA SUCCESS.

This documentation commit creates a new final candidate SHA. Phase 5 is considered
fully validated only when that exact final SHA independently passes the complete
7-workflow set and all 9 CI matrix jobs. Evidence from an older SHA is not reused
as final exact-head proof.

## 14. Explicit non-goals for Phase 5

Do not add:

- browser automation implementation — Phase 6;
- CodeGraph/worktree/sandbox implementation — Phase 6;
- Memory VNext redesign — Phase 7;
- ACP/A2A delegation — Phase 8;
- device/voice runtime — Phase 9;
- remote unauthenticated webhook execution;
- arbitrary user JavaScript as scheduler code;
- permanent automation superuser sessions.

## 15. Final Phase 5 gate

The implementation is closed at Gates 5.0 through 5.8.

The final exact-head validation must prove all of the following together:

- definitions and runs survive restart;
- duplicate trigger occurrence does not duplicate a logical run;
- concurrent claim race has one winner;
- armed-without-terminal recovery remains outcome-unknown and non-replayable;
- schedule authority is revalidated at execution time;
- unauthenticated/replayed webhook does not create executable authority;
- webhook payload cannot self-grant scopes/capabilities;
- cron is deterministic across IANA timezone/DST transitions;
- observability contains no credentials or payload bodies;
- notification delivery remains distinct from run execution success;
- package exports pass smoke tests on supported Node/OS matrix;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA, Cross-Browser QA and CI all remain green.

No merge, release, tag, npm publish or deploy is authorized by this track.
