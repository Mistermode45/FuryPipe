# FuryPipe Phase 10 Beta — Operator Runbook

This runbook documents the implemented local beta boundary. It is intentionally
evidence-first: a configured value is not treated as an authenticated,
authorized, selected, executed or verified capability.

## Installation and first start

English quick path:

```bash
npm install --global furypipe
furypipe setup --lang=en
furypipe doctor --json
furypipe beta status --json
furypipe task --plan "inspect the local runtime" --json
```

Parcours français équivalent :

```text
npm install --global furypipe
furypipe setup --lang=fr
furypipe doctor --json
furypipe beta status --json
furypipe task --plan "inspecter le runtime local" --json
```

Use `npx furypipe ...` when a global installation is not wanted. Setup is
explicit and does not run as an npm lifecycle side effect. The documented
runtime defaults to loopback; set `FURYPIPE_HOST` and `FURYPIPE_PORT` only when
the host security boundary has been reviewed.

## Entry modes and reversibility

```bash
furypipe beta status --json
furypipe beta opt-in --json
furypipe beta opt-out --json
furypipe beta legacy --json
```

`opt-in` writes FuryPipe's versioned `recommended` marker. `opt-out` writes
`opted-out`; `legacy` explicitly restores the legacy/expert-compatible mode.
These commands preserve unrelated JSON keys and never copy provider secrets.
The status projection reports `reversible: true` and observation-only
authority. An invalid or future marker is not guessed or overwritten.

The lower-level migration commands are separate:

```bash
furypipe config migrate-beta --json
furypipe config rollback-beta --json
```

Migration is explicit, bounded to `FURYPIPE_CONFIG` (or the default config
path), idempotent and write-then-rename. Rollback removes only the unchanged
FuryPipe-owned legacy marker. A changed, foreign, malformed or future marker
returns a reconciliation error and requires an operator decision.

## Task-first planning boundary

```bash
furypipe task --plan "review provider readiness" --json
furypipe task --plan --task-first "prepare a local diagnostic" --json
furypipe task --plan --legacy "use the expert-compatible route" --json
```

The command is a bounded planning handoff. Its contract is:

```text
selection       = not-run
execution       = not-authorized
authority       = planning-only
executionAuthority = false
```

The objective is represented by a SHA-256 digest and bounded length. The
command does not call a provider, execute a capability, install a plugin,
connect MCP, grant approval or widen policy. Actual governed execution still
requires the existing Gateway/task/policy lifecycle and its own receipts.

## Readiness and onboarding

`furypipe doctor --json` reports required configuration/runtime blockers and
optional degraded evidence. The beta onboarding projection additionally keeps
these states independent:

```text
configured != available != authenticated != authorized
authorized != selected != executed
```

Unknown means “not observed by this bounded surface”; it is not an implicit
yes or no. Credential presence is only a configuration fact. Credential values,
tokens and authorization objects are not emitted in the JSON or dashboard
projection.

The onboarding domains include models, providers, skills, plugins, MCP,
channels, automations, browser/coding, devices, memory, Gateway, approvals,
policy and recovery. An absent inventory remains `unknown`; no automatic
installation, pairing, connection or grant occurs.

## Dashboard and control plane

The existing local dashboard exposes the read-only beta projection through:

```text
GET /api/beta.json
GET /fragments/beta
```

The dashboard displays entry mode, readiness, onboarding states, operations
and unknown/recovery evidence. A dashboard object is display data, not a bearer
permit. There is no beta mutation endpoint in this surface. `503
NOT_AVAILABLE` is returned when the host has not injected a valid observation
provider; the UI renders that state instead of inventing readiness.

## Recovery, restart and unknown outcomes

Process-local readiness, selection and execution authority are not persisted by
the beta entry surface. After a restart, the host must observe readiness again.
An unknown side-effect outcome must remain unknown until independent evidence
resolves it; it must not be blindly replayed.

Before relying on a release candidate, exercise the installed package and the
target host for:

- Gateway/node restart and reconnect;
- interrupted durable work and automation wake;
- migration interruption and leftover temporary files;
- stale provider/channel/device evidence;
- port occupation, malformed/oversized/symlinked config and permission errors;
- upgrade, rollback, uninstall and reinstall.

The repository's local recovery tests and package smoke cover bounded local
contracts. They do not substitute for a production process-kill, provider,
browser or multi-host rehearsal.

## Self-hosting and upgrade discipline

1. Install from the tarball or registry source selected by the operator.
2. Run `furypipe setup` explicitly, then `furypipe doctor --json`.
3. Preserve the config file and record its digest before a migration.
4. Run only the named migration; inspect its terminal status and digest.
5. Keep the previous package available until startup, doctor and task planning
   are checked after restart.
6. If the marker is unchanged and owned by FuryPipe, use the explicit rollback.
7. If reconciliation is required, copy the file for evidence and repair it
   manually under the operator's configuration policy.

Do not put credentials in Git, issue comments, dashboard captures, benchmark
fixtures or evidence JSON. Use environment/secret-store references and rotate
any credential that was accidentally exposed.

## Validation status and limits

`pnpm run benchmark:beta` runs a bounded offline FuryBench envelope for the
installed build boundary (`startup`, `doctor`, `taskPlan`, `betaStatus`). It
records p95 wall time and can compare explicitly to a saved JSON baseline:

```bash
pnpm run benchmark:beta -- --iterations=5 --warmup=1
pnpm run benchmark:beta -- --baseline=baseline.json
```

The default regression threshold is candidate p95 <= baseline p95 × 1.25.
Without `--baseline`, the result is `BASELINE_CAPTURED`, not a regression
pass. This benchmark does not execute a real provider, browser, production
Gateway, multi-platform installation or deployment and must not be used for a
marketing claim.

## Résumé opérateur / Operator summary

```text
doctor        = readiness evidence, no repair authority
beta status   = entry observation, no execution authority
beta opt-in   = explicit recommended marker
beta opt-out  = explicit reversible decline
task --plan   = digest-only planning handoff
dashboard     = observation only
unknown       = not observed, never automatic success
```
