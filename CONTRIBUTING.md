# Contributing to FuryPipe

Thank you for contributing to FuryPipe.

FuryPipe is an evidence-first, fail-closed AI workflow runtime. Contributions are expected to preserve that model: a capability being present, configured or connected must never be reported as executed or verified without evidence.

## Before you start

For substantial changes, open or reference an issue before investing in a large implementation. Small, well-scoped fixes can go directly to a pull request.

Read the relevant project documents first:

- [README.md](README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [SECURITY.md](SECURITY.md)
- [TESTING.md](TESTING.md)
- [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md)

Security vulnerabilities must **not** be reported in public issues. Follow [SECURITY.md](SECURITY.md).

## Development requirements

The repository currently expects:

- Node.js **>= 22.14**
- pnpm **10.21.0**

Install dependencies with the lockfile frozen:

```bash
pnpm install --frozen-lockfile
```

Run the standard local gates:

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run audit
pnpm run package:smoke
```

Some changes require additional targeted workflows or browser/provider/MCP evidence. A local pass does not replace required GitHub Actions checks.

## Branch and pull-request workflow

1. Start from the repository's **current default branch**.
2. Create a focused branch for one root cause or one cohesive feature.
3. Keep unrelated refactors out of the same PR.
4. Rebase or merge the current default branch before final review when the branch is stale.
5. Open a PR with reproducible evidence and explicit limitations.

Do not assume the default branch is named `main`; use the repository's configured default branch.

A useful PR title states the user-visible or architectural outcome, for example:

```text
Provider runtime: fail closed on stale health evidence
Docs: align public release status with v0.13.2
```

## Required pull-request content

Every non-trivial PR should explain:

### Problem

What is incorrect, missing or unsafe today?

### Root cause

What underlying behavior causes the problem?

### Change

What was changed, and what was deliberately left unchanged?

### Evidence

Include the exact commands, tests, workflow runs or fixtures used to validate the change.

### Risk and compatibility

Call out:

- public API changes;
- environment-variable changes;
- provider/MCP behavior changes;
- persistence or migration impact;
- security-boundary changes;
- legacy compatibility impact.

### Truth-state impact

If a change touches capabilities, agents, MCP, providers, release evidence or Control Room, state which lifecycle transitions are actually proven.

FuryPipe keeps these concepts distinct:

```text
recommended != installed != connected != approved
approved != executable != executed != verified
wired != executed != verified
verified != released
released != deployed
```

Do not collapse those states in code, tests, documentation or PR descriptions.

## Scope discipline

Prefer one root cause per PR.

Good:

- one bug plus its regression test;
- one capability contract plus its docs and tests;
- one security boundary plus targeted evidence;
- one documentation consistency pass.

Avoid:

- drive-by formatting across unrelated files;
- dependency upgrades mixed with feature work;
- unrelated renames;
- speculative abstractions without a caller;
- broad rewrites that make review provenance difficult.

A small PR with strong evidence is preferable to a large PR with weak evidence.

## Testing expectations

### Bug fixes

Where practical:

1. reproduce the failure;
2. add a regression test;
3. implement the fix;
4. prove the regression test passes;
5. run the relevant broader gates.

### Runtime or provider changes

Use injected/fake transports for deterministic unit coverage, but label that evidence correctly. A fake transport does **not** prove a real provider, account, network or credential path.

### MCP changes

Distinguish local protocol tests from hosted conformance. A local handler test does not prove external interoperability or OAuth deployment.

### Browser/UI changes

Run the browser QA relevant to the changed surface. Structural accessibility checks do not automatically imply a complete manual WCAG audit.

### Performance claims

Do not claim a performance improvement from implementation intuition alone. Record the workload, environment, model/provider, sample size, date and comparison method.

If the benchmark was not executed, say `NOT_EXECUTED`.

## Security and sensitive data

Never commit or paste into public issues/PRs:

- API keys or tokens;
- raw credentials;
- private prompts or user transcripts;
- production request bodies;
- session files;
- private recovery objects;
- hostnames/usernames when unnecessary;
- absolute personal home paths;
- secrets embedded in screenshots or logs.

Use synthetic data for reproductions.

Any change to routing, authentication, persistence, logs, request capture, provider credentials, MCP authorization or release workflows should be reviewed against [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Compatibility policy

`furypipe` and `FURYPIPE_*` are the public names for new integrations.

The `pxpipe` CLI alias and selected `PXPIPE_*` variables exist only as legacy compatibility fallbacks. Do not introduce new public surfaces under the legacy prefix.

If a compatibility fallback is removed, the PR must include:

- migration documentation;
- tests;
- release-note impact;
- a clear breaking-change decision.

## Documentation standards

Public documentation must describe the current product state, not an aspirational state.

Use these labels when they are the most accurate:

- `IMPLEMENTED`
- `WIRED`
- `EXECUTED`
- `VERIFIED`
- `PARTIAL`
- `NOT_EXECUTED`
- `UNKNOWN`
- `BLOCKED`

Historical evidence documents may describe older states, but they should not be presented as the current release status.

## Dependencies and third-party code

Before adding or vendoring third-party code:

- verify the source and exact version/commit;
- record provenance when required;
- review license compatibility;
- update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) or [SOURCE_LEDGER.md](SOURCE_LEDGER.md) when applicable;
- avoid copying code when an API-level integration is sufficient.

## Release changes

Do not manually weaken release, provenance, security or supply-chain gates to make a release pass.

Changes to release workflows should preserve:

- least-privilege permissions;
- pinned/reviewed actions and publishing clients;
- source/tag/version binding;
- frozen installs in privileged jobs;
- Trusted Publishing/OIDC where configured;
- evidence that distinguishes package publication from deployment.

A package version being published does not prove production deployment.

## Review criteria

A PR is easier to review when it has:

- a narrow diff;
- a reproducible root cause;
- targeted tests;
- exact commands/results;
- explicit limitations;
- no unsupported capability claims;
- no sensitive data;
- no unrelated cleanup.

Review may request additional evidence when the affected boundary is security-sensitive or externally observable.

## Becoming a maintainer

Maintainer access is based on sustained, reviewable contributions rather than a fixed number of PRs.

Useful signals include:

- repeated high-quality fixes with tests;
- accurate issue triage;
- security-aware reviews;
- documentation that preserves evidence semantics;
- dependable ownership of a subsystem.

Repository write access is a trust decision and is not automatically granted by contribution count.
