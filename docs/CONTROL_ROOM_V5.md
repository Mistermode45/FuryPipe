# Control Room V5

## Status

`KERNEL_IMPLEMENTED_NOT_DASHBOARD_WIRED`

The Control Room V5 kernel provides a single fail-visible snapshot for the current FuryPipe V5 subsystems without requiring the UI to infer status from unrelated counters.

Implemented:

- receipts / ExactGuard evidence;
- Recovery evidence and backup-vs-restore distinction;
- Agent runtime evidence;
- Human/Agent Learning evidence;
- MCP transport/auth/conformance evidence;
- i18n runtime/wiring evidence;
- Web/Figma Studio evidence;
- security/supply-chain evidence;
- benchmark harness/provider-run distinction;
- aggregate overall status;
- impossible-counter validation;
- source commit pinning.

Status semantics:

- `VERIFIED`: evidence exists and the gate is verified;
- `PARTIAL`: implementation/evidence exists but is incomplete;
- `NOT_EXECUTED`: capability or validation has not run;
- `NOT_AVAILABLE`: no applicable evidence exists;
- `BLOCKED`: an external or repository-level blocker prevents completion.

The dashboard must display these statuses as-is. It must not convert `PARTIAL`, `NOT_EXECUTED` or `BLOCKED` to a green state.

## Deliberately not wired yet

The existing dashboard is a large shared surface currently adjacent to Codex runtime work. This track intentionally does not edit:

- `src/dashboard.ts`;
- `src/dashboard/fragments.ts`;
- `src/node.ts`;
- package manifests.

A follow-up integration can consume `createControlRoomSnapshot()` after the parallel runtime tracks stabilize.

## Security

The Control Room model contains counts, statuses, digests/commit IDs and bounded metadata only. It is not a channel for:

- secrets;
- bearer tokens;
- OAuth codes;
- prompt plaintext;
- recovered object plaintext;
- learner identifiers;
- full agent objectives.

The model must remain evidence-oriented and metadata-only.
