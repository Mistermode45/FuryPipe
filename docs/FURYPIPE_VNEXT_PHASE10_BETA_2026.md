# FuryPipe VNext Phase 10 — Beta / Task-First Agent OS (2026)

> Status: Gate 10.0 architecture — VALIDATED.
>
> Branch: `vnext-phase10-vnext-beta`
>
> Exact stacked base: validated Phase 9 closure
> `c3c3f5370c10ee414e685b9f422cd4fd8a022e55`.
>
> Phase 10 does not merge Phase 9. PRs remain stacked, OPEN + DRAFT until
> explicitly authorized.

## 1. Phase 10 objective

Phase 10 turns the already-governed VNext architecture into a coherent beta
experience.

The beta is not "more runtime features". The core runtime already has the
Gateway, sessions, channels, Capability Autopilot, automations/webhooks,
browser/coding runtime, Memory VNext, ACP interoperability and governed
device/voice/multimodal foundations.

Phase 10 makes that system usable as the recommended FuryPipe experience:

```text
user task
  -> Fury Gateway
  -> current principal/session
  -> capability discovery/minimization
  -> policy / approvals
  -> governed execution
  -> evidence / recovery
  -> result
```

The beta must remain local-first/self-hostable, evidence-first and fail-closed.

## 2. Beta product promise

A beta user should be able to:

1. install/start FuryPipe with one documented supported path;
2. run `furypipe doctor` and receive an actionable readiness result;
3. enter the task-first experience without manually designing runtime topology;
4. see which capabilities are available, selected, unavailable or blocked;
5. understand when an approval/permission is required;
6. resume durable sessions/memory where supported;
7. use configured channels, automations, browser/coding, ACP and paired devices
   without each subsystem inventing a separate authority model;
8. inspect evidence for meaningful side effects;
9. recover from restart/reconnect without stale ephemeral authority being
   silently restored;
10. opt out or revert beta defaults without data loss.

Beta does not mean "security relaxed".

## 3. Beta invariants

The following are non-negotiable:

```text
available != selected
selected != authorized
authorized != dispatched
dispatched != succeeded
observed != independently verified
```

And:

- pairing is not permission;
- capability advertisement is not execution authority;
- dashboard/display state is not execution authority;
- Capability Autopilot remains selection-only;
- device/media content is not trusted instruction authority;
- unknown side-effect outcomes are not automatically retried;
- restart/reconnect never restores process-local permits/leases/consents;
- secrets remain references or protected runtime material, never evidence text;
- beta UX must not bypass existing policy/approval boundaries for convenience.

## 4. Recommended experience boundary

Phase 10 may make the VNext task-first experience recommended, but must not
silently delete or irreversibly rewrite legacy configuration.

A recommended beta default must satisfy all of:

- explicit schema/version marker;
- deterministic migration;
- idempotent re-run;
- rollback/opt-out path;
- no secret duplication;
- no loss of current provider/channel/plugin/device configuration;
- no elevation of permissions;
- no hidden network exposure;
- no automatic release/deploy/publish.

## 5. Startup and readiness contract

A beta startup contract should distinguish:

- process started;
- Gateway healthy;
- configuration valid;
- storage/migrations valid;
- current principal/session ready;
- provider/model availability;
- capability index readiness;
- optional subsystem readiness;
- degraded but usable;
- blocked.

`furypipe doctor --json` remains machine-readable evidence, not a repair
authority.

Any future auto-repair must be separately governed and explicit.

## 6. Task-first UX contract

The recommended entry path should optimize for a task, not subsystem setup.

The UX may derive an execution plan, but must expose enough evidence to answer:

- what capability was selected;
- why it was selected;
- what permissions it requires;
- what runtime/provider/device will execute it;
- whether approval is required;
- what happened after dispatch;
- whether the result is observed, claimed or verified.

Normal users should not need to manually pick MCP vs plugin vs native tool when
the capability index can safely minimize that decision.

Experts retain explicit override/debug surfaces.

## 7. Capability and subsystem readiness

Beta readiness is not equivalent to every optional subsystem being installed.

Each subsystem must report one of a bounded set such as:

```text
ready
degraded
unconfigured
unavailable
blocked
unsupported
```

The report must separate:

- installation/discovery;
- compatibility;
- health;
- policy permission;
- authentication;
- connection/liveness;
- execution authority.

A red optional subsystem must not make the whole beta unusable unless it is
required by the requested task.

## 8. Beta configuration and migrations

Phase 10 migrations must be:

- versioned;
- deterministic;
- atomic where state changes;
- crash-safe;
- observable;
- idempotent;
- bounded;
- tested from supported predecessor states.

Never infer successful migration from a file existing.

Each migration that mutates durable state requires evidence of:

- previous schema/version;
- intended target;
- migration ID/digest;
- terminal result;
- whether rollback is supported;
- whether manual reconciliation is required.

## 9. Failure and recovery model

Beta UX must normalize at least:

- invalid configuration;
- missing credentials;
- unavailable provider/model;
- channel disconnected;
- device offline;
- stale node/session evidence;
- policy denied;
- approval required;
- timeout before dispatch;
- failure before side effect;
- failure after possible side effect;
- unknown outcome;
- restart during work;
- migration interruption.

The UI/CLI must not collapse these into a generic "failed" when recovery
semantics differ.

## 10. Security boundary

Phase 10 introduces no new blanket authority.

Specifically, beta mode must not authorize:

- automatic shell/filesystem access merely because FuryPipe is installed;
- automatic device capture;
- ambient remote execution on paired nodes;
- automatic plugin installation;
- automatic approval of high-risk actions;
- public Gateway exposure;
- automatic OAuth/credential grants;
- automatic replay of uncertain side effects;
- biometric/face-recognition/surveillance behavior;
- release/tag/npm publish/deploy.

## 11. Privacy boundary

The recommended beta experience should minimize durable sensitive data.

Required principles:

- raw media is ephemeral unless a feature explicitly requires persistence;
- evidence is digest/metadata-first;
- transcripts/media remain untrusted content;
- credentials are not copied into dashboard/evidence payloads;
- device/session identifiers are minimized or digested in display surfaces;
- debug mode must not silently weaken evidence redaction.

## 12. Observability and evidence

A beta operator should be able to inspect:

- Gateway health;
- current runtime version/schema;
- active/degraded subsystems;
- current sessions;
- configured channels;
- automations;
- capability index summary;
- plugins/MCP/skills;
- provider/model readiness;
- browser/coding readiness;
- paired/live devices;
- policy/approval state;
- recent governed execution receipts;
- recovery/unknown-outcome items requiring reconciliation.

Inspection remains observation-only.

## 13. Performance / FuryBench beta envelope

Phase 10 should establish measured beta envelopes rather than marketing claims.

At minimum record where practical:

- cold startup;
- warm startup;
- Gateway idle RSS;
- doctor latency;
- task admission latency before provider execution;
- capability-index refresh latency;
- dashboard bootstrap latency;
- session restore latency;
- automation wake overhead.

Performance budgets may evolve, but regressions must be measurable.

## 14. Compatibility

Beta must preserve supported environments already enforced by CI.

The authoritative compatibility claim comes from exact-head CI/package evidence,
not from this architecture document.

Phase 10 must not widen support claims without evidence.

## 15. Public-surface rule

A new public runtime export is allowed only if beta users or integrators require
a stable contract.

Every new public export requires packed-artifact smoke coverage.

Internal orchestration should remain internal when possible.

## 16. Upgrade / opt-out rule

Making VNext beta recommended must remain reversible until a later stable
release explicitly removes the legacy path.

A beta opt-out must not:

- delete memory;
- delete channel credentials;
- unpair devices;
- erase automation state;
- rewrite repositories;
- revoke unrelated user credentials.

## Gate 10.0 validation record

Exact validated Gate 10.0 architecture HEAD:

`7af174f009be1c9b85703a4c15c8e9dc510e6dbc`

Evidence:

- 7/7 workflows SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 277 test files / 3,172 tests SUCCESS on observed Ubuntu/Node 26;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS, including existing Phase 6/7/8 and provider smokes;
- Secret Scan SUCCESS;
- Benchmark Contract SUCCESS;
- RC Preparation Evidence SUCCESS;
- Dashboard Browser QA SUCCESS;
- Web Studio Browser QA SUCCESS;
- Cross-Browser QA SUCCESS;
- the only Gate 10.0 change is this Phase 10 architecture document;
- no Phase 10 runtime dependency, migration, beta default or authority change was
  introduced;
- PR #223 remained OPEN + DRAFT and unmerged;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 10.0 closure commit itself must receive the same
exact-head 7/7 workflow and CI 9/9 proof before Gate 10.1 begins.

## 17. Gate 10.1 — beta readiness model — VALIDATED

Implementation surface:

- `src/beta-readiness.ts` adds one bounded, deterministic beta-readiness
  snapshot contract;
- `tests/beta-readiness.test.ts` adds dedicated required/optional, stale,
  degraded, blocked, schema-hardening, digest and anti-authority coverage.

Contract:

- readiness composes observation evidence only and never creates repair,
  selection or execution authority;
- subsystem dimensions remain separate for discovery, compatibility, health,
  policy, authentication, connection and execution-authority readiness;
- required and optional subsystems have different blocking semantics;
- required `unconfigured`, `unavailable`, `blocked` or `unsupported`
  states block task readiness;
- required degraded/unknown evidence remains visible but task-ready;
- optional failures degrade the beta view without globally blocking unrelated
  tasks;
- stale evidence becomes unavailable instead of being silently accepted;
- future timestamps, impossible expiry ordering, duplicate IDs/reasons,
  malformed digests, schema drift, accessors and sparse arrays fail closed;
- subsystem order and reason codes are canonicalized for deterministic digest
  evidence;
- generated snapshot authenticity is process-local;
- even an `executionAuthority:'ready'` readiness dimension never becomes
  actual authority; the snapshot remains
  `executionAuthority:false`, `repairAuthority:false` and
  `selectionAuthority:false`;
- Gate 10.1 adds no new public package export, dependency, migration or beta
  default.

Exact validated Gate 10.1 implementation HEAD:

`b857d55de419d869a223961ca78424187e3ff0a6`

Evidence:

- 7/7 workflows SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- 278 test files / 3,196 tests SUCCESS on observed Windows/Node 22 rerun;
- 24 effective beta-readiness test cases SUCCESS, including parameterized
  required-blocking coverage;
- strict TypeScript typecheck SUCCESS;
- build SUCCESS;
- package smoke SUCCESS;
- Phase 6 package smoke SUCCESS;
- Phase 7 package smoke SUCCESS;
- Phase 8 ACP package smoke SUCCESS;
- benchmark-claim package smoke SUCCESS;
- provider-attempt package smoke SUCCESS;
- governed-provider package smoke SUCCESS;
- Secret Scan, Benchmark Contract, RC Preparation Evidence, Dashboard Browser
  QA, Web Studio Browser QA and Cross-Browser QA SUCCESS;
- the original Windows/Node 22 job was cancelled late in package smoke after
  tests/build and early packed-artifact smokes had passed; only that exact job
  was rerun, and the rerun completed SUCCESS;
- PR #223 remained OPEN + DRAFT and unmerged;
- no merge, release, tag, npm publish or deploy occurred.

The documentation-only Gate 10.1 closure commit itself requires the same
exact-head 7/7 workflow and CI 9/9 proof before Gate 10.2 begins.

## 18. Gate 10.2 — startup / doctor / migration governance

Connect startup and doctor to the beta readiness contract.

Add explicit versioned beta configuration/migration governance where necessary.

Required:

- idempotency;
- crash/restart safety;
- no secret duplication;
- rollback/reconciliation semantics;
- adversarial migration tests.

## 19. Gate 10.3 — task-first recommended entry

Make the VNext task-first experience the recommended beta entry path.

Required:

- clear opt-out;
- no authority widening;
- existing explicit expert/legacy paths remain reachable;
- capability selection remains explainable and selection-only.

## 20. Gate 10.4 — beta capability onboarding

Expose actionable setup/readiness for models/providers, skills, plugins, MCP,
channels, automations, browser/coding and devices.

Required:

- configured vs available vs authorized separation;
- bounded diagnostics;
- no automatic installation or credential grants.

## 21. Gate 10.5 — beta control-plane / dashboard evidence

Present the beta readiness and execution evidence in existing control-plane
surfaces.

Required:

- observation-only dashboard;
- no dashboard object becomes bearer authority;
- unknown outcomes/recovery work are visible;
- sensitive identifiers/redaction rules remain enforced.

## 22. Gate 10.6 — resilience / restart / upgrade rehearsal

Exercise beta recovery across:

- Gateway restart;
- node reconnect;
- interrupted durable work;
- automation wake;
- migration interruption;
- stale provider/channel/device state.

No stale process-local authority may survive restart.

## 23. Gate 10.7 — packaging / install / self-host beta proof

Validate the actual installable packed artifact and documented self-host path.

If Phase 10 adds public runtime exports, add exact packed-artifact smokes.

No npm publish/release/deploy is required or authorized by this gate.

## 24. Gate 10.8 — FuryBench beta baseline

Capture reproducible beta performance evidence and regression thresholds for
the metrics that are stable enough to measure in CI.

Do not optimize by weakening isolation, evidence or security gates.

## 25. Gate 10.9 — beta documentation / operator acceptance

Close the user/operator documentation gap:

- install/start;
- doctor/readiness;
- task-first usage;
- optional subsystem setup;
- approvals/policy;
- recovery;
- devices/voice/media boundaries;
- beta opt-out;
- known limitations.

Documentation must match exact implemented behavior.

## 26. Gate 10.10 — final VNext beta evidence

Final acceptance requires, on the exact beta closure HEAD:

- Secret Scan SUCCESS;
- CI 9/9 SUCCESS across Ubuntu/macOS/Windows and Node 22/24/26;
- Benchmark Contract SUCCESS;
- RC Preparation Evidence SUCCESS;
- Dashboard Browser QA SUCCESS;
- Web Studio Browser QA SUCCESS;
- Cross-Browser QA SUCCESS;
- package smoke SUCCESS;
- any new Phase 10 packed-public-surface smoke SUCCESS;
- beta readiness tests;
- migration/idempotency/restart proof;
- opt-out/reversibility proof;
- unknown-outcome/no-blind-replay invariants preserved;
- no unresolved critical security regression introduced by Phase 10;
- PR remains OPEN + DRAFT;
- no merge, release, tag, npm publish or deploy.

## 27. Gate 10.0 exit criteria

Gate 10.0 is complete only when:

- this architecture document is committed on a branch stacked exactly on
  validated Phase 9 closure
  `c3c3f5370c10ee414e685b9f422cd4fd8a022e55`;
- the Phase 10 PR is OPEN + DRAFT with Phase 9 as its base;
- Gate 10.0 changes architecture/documentation only;
- no Phase 10 runtime dependency is introduced;
- no beta default is changed yet;
- no migration runs;
- no authority is widened;
- exact-head Secret Scan is green;
- exact-head CI 9/9 is green;
- exact-head Benchmark Contract is green;
- exact-head RC Preparation Evidence is green;
- exact-head Dashboard Browser QA is green;
- exact-head Web Studio Browser QA is green;
- exact-head Cross-Browser QA is green;
- no merge/release/tag/npm publish/deploy occurred.

Until all criteria are true, Gate 10.1 must not begin.

## 28. Caveman beta checklist

Before accepting a Phase 10 change:

1. What user-visible beta problem does it solve?
2. What exact durable state changes?
3. Is the change reversible?
4. Does it create or restore authority?
5. What happens after Gateway restart?
6. What happens with stale provider/channel/device state?
7. What happens if migration crashes halfway?
8. What evidence proves completion?
9. Is the subsystem required or optional for this task?
10. Could a display/readiness object be mistaken for authority?
11. Could a copied object forge readiness or execution?
12. Does unknown outcome remain non-retryable where required?
13. Are secrets/raw media exposed in diagnostics?
14. Does packed-artifact behavior match source-tree behavior?
15. Can a beta opt-out preserve user state?

Priority:

```text
security
> correctness
> reversibility
> evidence
> privacy
> recoverability
> usability
> interoperability
> performance
> convenience
```

No magic beta flag. No silent authority. No irreversible migration. No fake
health. No blind retry. No auto-install. No auto-merge.
