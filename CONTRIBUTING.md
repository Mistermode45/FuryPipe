# Contributing to FuryPipe

Thank you for contributing to FuryPipe.

FuryPipe is an **evidence-first, fail-closed AI workflow runtime**. Contributions are welcome, but they must preserve the distinction between what exists, what is configured, what is authorized, what actually ran, and what was independently verified.

This guide defines the contribution contract for code, documentation, integrations, benchmarks and release-related changes.

---

## Contribution paths

You can contribute through:

- bug fixes with reproducible evidence;
- runtime or API improvements;
- provider, MCP or agent integrations;
- security hardening;
- documentation corrections;
- test coverage and deterministic fixtures;
- performance work backed by reproducible benchmarks;
- issue triage and high-quality reviews.

For substantial features or architectural changes, open or reference an issue first so scope and evidence requirements are clear before implementation.

Small, focused fixes can go directly to a pull request.

---

## Read before changing code

Start with the documents relevant to your change:

- [README.md](README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [SECURITY.md](SECURITY.md)
- [TESTING.md](TESTING.md)
- [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md)
- [COMPATIBILITY.md](COMPATIBILITY.md) when touching legacy surfaces

Security vulnerabilities must **not** be reported through public issues. Follow [SECURITY.md](SECURITY.md).

---

## Development environment

Current repository requirements:

- Node.js **>= 22.14**
- pnpm **10.21.0**

Install dependencies with the committed lockfile:

```bash
pnpm install --frozen-lockfile
```

Run the normal local gates:

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run audit
pnpm run package:smoke
```

Some surfaces require additional browser, provider, MCP, security or release evidence. A local pass does not replace required GitHub Actions checks.

---

## Branch and PR workflow

1. Start from the repository's **current default branch**.
2. Create a focused branch for one cohesive root cause or feature.
3. Avoid unrelated formatting/refactoring in the same PR.
4. Bring the branch up to date before final review when it becomes stale.
5. Open a PR with exact verification evidence and explicit limitations.

Do not hard-code assumptions that the default branch is named `main`; use the repository's configured default branch.

Good PR titles describe the outcome, for example:

```text
Provider runtime: fail closed on stale health evidence
MCP: preserve request cancellation across reconnect
Docs: align public release status with v0.13.2
```

---

## What every non-trivial PR should contain

### 1. Problem

What is incorrect, unsafe, incomplete or difficult to maintain today?

### 2. Root cause

What underlying behavior produces the problem?

### 3. Change

What changed? What was intentionally left unchanged?

### 4. Evidence

Include exact commands, tests, fixtures, workflow runs or external checks used to validate the change.

### 5. Risk / compatibility

Call out any impact on:

- public APIs;
- configuration/environment variables;
- providers or MCP behavior;
- persistence/migrations;
- security boundaries;
- legacy compatibility;
- package/release behavior.

### 6. Truth-state impact

If the PR touches capabilities, agents, MCP, providers, Control Room, evidence or releases, state exactly which lifecycle transitions are proven.

FuryPipe keeps these states distinct:

```text
recommended != installed != connected != approved
approved != executable != executed != verified
wired != executed != verified
verified != released
released != deployed
```

Do not collapse those states in code, documentation, tests or PR descriptions.

---

## Scope discipline

Prefer one root cause or one cohesive feature per PR.

### Good scope

- one bug + regression test;
- one capability contract + docs/tests;
- one security boundary + targeted evidence;
- one compatibility migration;
- one documentation consistency pass.

### Avoid

- unrelated renames;
- drive-by formatting across many files;
- dependency upgrades mixed with feature work;
- speculative abstractions with no caller;
- broad rewrites that make provenance/review difficult;
- weakening a gate because it currently fails.

A small PR with strong evidence is better than a large PR with weak evidence.

---

## Testing expectations

### Bug fixes

Where practical:

1. reproduce the failure;
2. add a regression test;
3. implement the fix;
4. prove the regression test passes;
5. run the relevant broader gates.

### Provider/runtime changes

Injected or fake transports are useful for deterministic tests, but label the evidence correctly. A fake transport does **not** prove a real account, provider, network path or credential flow.

### MCP changes

Keep local protocol tests separate from hosted conformance. A passing handler test does not prove external interoperability or OAuth deployment.

### Browser / UI changes

Run the browser QA relevant to the changed surface. Structural accessibility tests do not automatically imply a full manual WCAG audit.

### Performance claims

Never claim a performance improvement from intuition alone.

Record at least:

- workload/scenario;
- environment;
- model/provider when applicable;
- sample size;
- date;
- baseline and comparison method;
- failures/outliers.

If the benchmark was not run, use `NOT_EXECUTED`.

---

## Evidence vocabulary

Use the strongest state actually supported by evidence:

- `IMPLEMENTED`
- `WIRED`
- `EXECUTED`
- `VERIFIED`
- `PARTIAL`
- `NOT_EXECUTED`
- `UNKNOWN`
- `BLOCKED`

Examples:

- an API route present in code may be `IMPLEMENTED`;
- a provider registered in a runtime may be `WIRED`;
- a real request observed may be `EXECUTED`;
- an externally validated conformance run may be `VERIFIED`.

Do not promote one state into another without evidence.

---

## Security and sensitive data

Never commit or paste into public issues/PRs:

- API keys or tokens;
- credentials;
- private prompts or user transcripts;
- production request bodies;
- session files;
- private recovery objects;
- unnecessary usernames/hostnames;
- absolute personal home paths;
- secrets visible in screenshots or logs.

Use synthetic data for reproduction.

Changes involving routing, authentication, persistence, credentials, logs, request capture, MCP authorization, dependencies or release workflows should be reviewed against [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

---

## Public naming and compatibility

`FuryPipe`, `furypipe` and `FURYPIPE_*` are the public names for new integrations.

Historical aliases exist only for backward compatibility with the upstream codebase. Do not introduce new APIs, environment variables, documentation headings or user-facing features under legacy branding.

When touching compatibility behavior, read [COMPATIBILITY.md](COMPATIBILITY.md) and [UPSTREAM.md](UPSTREAM.md).

Removing a compatibility fallback requires:

- migration documentation;
- tests;
- release-note impact;
- an explicit breaking-change decision.

---

## Dependencies and third-party code

Before adding or vendoring third-party code:

- identify the exact source/version/commit;
- review the license;
- record provenance where required;
- update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) or [SOURCE_LEDGER.md](SOURCE_LEDGER.md) when applicable;
- prefer API-level integration over copying code when possible.

Supply-chain and provenance evidence must remain reproducible.

---

## Release-related changes

Do not weaken release, provenance, security, license, benchmark-contract or supply-chain gates to make a release pass.

Release-workflow changes should preserve:

- least-privilege permissions;
- source/tag/version binding;
- frozen installs in privileged jobs;
- pinned/reviewed actions and publishing clients;
- Trusted Publishing/OIDC where configured;
- explicit distinction between package publication and production deployment.

A package being published does not prove a deployment happened.

---

## Documentation standards

Public documentation must describe the **current product state**, not an aspirational future state.

Avoid:

- stale release warnings after a release has shipped;
- describing historical compatibility names as current product identity;
- claiming external integrations are verified when they were not executed;
- absolute claims such as “fully secure”, “100% compatible” or “works with every provider” without evidence.

Historical audit/evidence files may preserve older terminology when needed for provenance, but current public-facing docs should be clearly FuryPipe-native.

---

## Review checklist

A strong PR is usually:

- focused;
- reproducible;
- tested;
- evidence-backed;
- explicit about limitations;
- compatible or clearly migration-documented;
- free of sensitive data;
- free of unsupported claims.

Reviewers may request stronger evidence when the affected boundary is security-sensitive or externally observable.

---

## Becoming a maintainer

Maintainer access is based on sustained, reviewable contributions and trust — not on a fixed PR count.

Strong signals include:

- repeated high-quality fixes with regression tests;
- accurate issue triage;
- careful security reviews;
- documentation that preserves evidence semantics;
- dependable ownership of a subsystem;
- respectful, technically grounded collaboration.

Repository write access remains a maintainer trust decision.

---

## Code of conduct

Participation in FuryPipe follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
