# Control Room V5

## Status

`DASHBOARD_WIRED_HOST_PROVIDER_NOT_CONFIGURED`

The Control Room V5 kernel provides a fail-visible metadata snapshot for FuryPipe V5 and is wired into the loopback dashboard through:

- `GET /api/control-room.json`;
- `GET /fragments/control-room`;
- the server-rendered Control Room panel.

The Node host currently constructs `DashboardState` without a Control Room evidence provider. The production panel therefore remains `NOT_AVAILABLE` until the host explicitly supplies a metadata-only snapshot. The dashboard does not infer green states from unrelated counters.

## Evidence sections

The snapshot covers:

- receipts / ExactGuard;
- Recovery and `BACKUP_EXISTS` vs `RESTORE_VERIFIED`;
- Agent runtime;
- Human/Agent Learning;
- MCP transport/auth/conformance;
- i18n runtime/wiring;
- Web/Figma Studio;
- security/supply-chain;
- benchmark harness/provider-run distinction;
- M19 Release Readiness.

Release Readiness is bound to the exact Control Room `sourceCommit`. Evidence from another commit is rejected as stale.

The release section shows:

- technical state: `NOT_AVAILABLE`, `BLOCKED` or `READY_FOR_RELEASE_DECISION`;
- verified required gates / total required gates;
- blocker count;
- warning count;
- number of separately authorized release actions;
- `releaseActionsExecuted: false`.

`READY_FOR_RELEASE_DECISION` is not a release authorization and does not cause merge, tag, npm publish, GitHub Release creation or deployment.

## Status semantics

- `VERIFIED`: evidence exists and the gate is verified;
- `PARTIAL`: implementation/evidence exists but is incomplete;
- `NOT_EXECUTED`: validation has not run;
- `NOT_AVAILABLE`: no current evidence provider/report exists;
- `BLOCKED`: a required or external blocker prevents completion.

The dashboard must display these states as-is.

## Host integration boundary

The existing dashboard accepts an optional Control Room provider. The next host-level integration must build the snapshot from bounded runtime evidence; it must not inspect or expose raw secrets, prompts or recovered object plaintext.

Until that provider is configured, `/api/control-room.json` correctly returns `503 {"status":"NOT_AVAILABLE"}`.

## Security

The Control Room model is metadata-only. It must never become a channel for:

- API keys, bearer tokens or OAuth codes;
- prompt or agent-objective plaintext;
- recovered object plaintext;
- learner identifiers;
- secret values;
- raw protected ExactGuard spans.

Counts, statuses, digests, commit IDs and bounded evidence metadata are permitted.
