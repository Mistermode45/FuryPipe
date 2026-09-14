# FuryPipe V5 — Final Independent Audit

Date: 2026-09-14  
Repository: `Mistermode45/FuryPipe`  
Audit branch: `v5-codex-final-independent-audit`

## Executive summary

The independent pass found and corrected several concrete issues: an RTL
Dashboard tooltip could overflow at desktop widths; a successful Web Studio
subset could be reported as `VERIFIED`; the SPDX verifier did not bind the root
version/source namespace or reject disconnected package records; and required
security workflows would not trigger for a Draft PR whose base is the current
PR #128 head branch. Recovery child-process tests now have a timeout, LTM has
an explicit `UPDATE`/`DELETE` race regression test, and SBOM subprocess fixtures
now isolate their source SHA from CI environment variables.

Real local browser execution passed 48 Dashboard cases and all 120 Web Studio
fixture cases across Chromium, Firefox and WebKit. This is not a live Figma or
arbitrary customer-site audit, and it is not a substitute for the exact-head
GitHub workflow results recorded on the audit Draft PR.

This candidate is **not release-ready**. Repository branch protections/rulesets
are absent; signed npm attestation is not produced on a pull request;
provider/OAuth/hosted MCP/Figma validation has no supplied external
environment; and no public earlier FuryPipe npm version exists for package
upgrade/rollback.

## Exact source identity

- Repository: `https://github.com/Mistermode45/FuryPipe`.
- The audit checkout was created from PR #128's exact verified head
  `cb2216105b8196fed2a89915187288199feff235`.
- PR #128's base production branch was verified as
  `v5-production-hardening` at `8299f74439bf74a208431e2106b6ff5c9781ed93`.
- The audit Draft PR must target
  `v5-chatgpt-post-codex-integrity-final-validation`; its current remote head
  SHA, not a historical SHA in a document, is the authority for hosted evidence.
- The final Codex branch is separate. PR #128 and the production/default branch
  are not modified by this audit.

## Architecture reviewed

Context compilation/ExactGuard; Recovery storage and encryption; Agent Fabric
sequencing, permissions, budget and handoff; Long-Term Memory versioned writes;
provider/model registry and transport health; retry/fallback orchestration;
policy/cache/retrieval; MCP local HTTP/stdio contracts; OpenClaw discovery/probe;
Web/Figma Studio; SPDX generation and verification; Control Room and
Release-Readiness/RC evidence; GitHub workflow triggers and test/report hygiene.

## Status by domain

| Domain | Status | Evidence and boundary |
| --- | --- | --- |
| Supplied source, repository access and PR #128 invariants | `VERIFIED` | Remote head/base, PR state and required historical workflows were independently read before editing. Re-check the live PR before handoff. |
| Dashboard cross-browser matrix | `PARTIAL` | 48 real browser cases pass locally: 3 engines × LTR/RTL × 8 widths. GitHub evidence must pass on the exact final PR head. |
| Web Studio cross-browser matrix | `PARTIAL` | 120 real browser cases pass locally: 5 browser projects × 6 viewports × 4 locales, against the deterministic static-page fixture. Not a live Figma project or a general-purpose site audit. |
| Recovery durability | `PARTIAL` | Real child processes, stale-lock recovery, atomic residue cleanup, backup/restore, encryption and rekey are exercised. Process kill is not physical power-loss proof; every filesystem crash phase and concurrent operation permutation is not simulated. |
| Agent Fabric | `PARTIAL` | Ordered callbacks, bounded budgets, claims, concurrent resume and a separate-process Recovery resume are tested. No distributed/multi-host guarantee is inferred. |
| Long-Term Memory | `PARTIAL` | Version/history, saturation and concurrent UPDATE writers are covered; a deterministic independent-adapter UPDATE/DELETE conflict case was added. Physical multi-process race and storage crash claims remain unverified. |
| Provider, policy, cache and retrieval | `PARTIAL` | Local registry/TTL/unknown-cost/bounds and governed fallback tests cover BASE reconstruction, allowlisted statuses, Retry-After and ambiguous-stop behavior. No real provider account, billing, model availability or business result was tested. |
| External harness readiness | `PARTIAL` | A fail-closed opt-in live OpenClaw health probe is available. Provider live, Authorization Server, hosted MCP and Figma harnesses/evidence remain unavailable or unexecuted. |
| Supply chain and SBOM | `VERIFIED` | On final PR #129 head, Workflow action pinning, SPDX SBOM, Frozen dependency audit, and GitHub dependency review child jobs all completed successfully. The repository variable condition was true for this run. Local frozen install/audit and adversarial SBOM tests also pass. Signed npm artifact attestation is a separate provenance job and was `SKIPPED`. |
| GitHub branch/release policy | `BLOCKED_BY_REPO_SETTING` | GitHub API returned `Branch not protected` for `v5-production-hardening`; repository ruleset query returned no rulesets. No setting was changed. |
| RC/release readiness | `BLOCKED` | Exact-source evidence and explicit maintainer authorization are still required. npm package upgrade/rollback is `NOT_EXECUTED` because the registry has no prior public FuryPipe version. |
| Documentation/status hygiene | `PARTIAL` | Durable task, Web Studio, i18n, migration and RC docs were updated. Old WORKLOG entries dated 2026-09-12 are retained as historical records, not current state. |
| Test false-green audit | `PARTIAL` | Targeted searches found no skipped tests or literal always-true assertions; child Recovery workers now have a 30-second bound. This is not a manual proof of every assertion in the full suite. |

## Findings and corrections

### AUDIT-01 — Required workflows filtered out for the mandated PR base

- Severity: **P1** (required evidence could silently never run).
- Root cause: CodeQL, License Compliance, Provenance Attestation, Control Room
  Security Evidence and Supply Chain only listened to PRs targeting
  `v5-production-hardening`, while this audit PR must target PR #128's branch.
- Failure scenario: a correctly created audit Draft PR would show no current
  exact-head result for these mandatory workflows, making a green historical
  run easy to mistake for current evidence.
- Fix: add only `v5-chatgpt-post-codex-integrity-final-validation` to those
  workflows' PR base-branch filters. No protection/ruleset settings changed.
- Proof: workflow trigger diff, action-pinning check, and final PR job results
  on the exact head SHA.

### AUDIT-02 — Partial Web Studio QA could appear fully verified

- Severity: **P1** (incomplete browser evidence could be promoted).
- Root cause: `runStudioBrowserQa()` treated any passing non-empty case subset
  as `VERIFIED`; the Chromium-only workflow supplied 48 of the required 120.
- Fix: accept only canonical matrix cases, require the complete 120-case set
  for `VERIFIED`, and report a passing subset as `PARTIAL`.
- Proof: `tests/web-studio.test.ts` covers both the 8-case partial set and full
  matrix semantics; the real browser harness executes all 120 cases.

### AUDIT-03 — RTL tooltip overflow in Dashboard

- Severity: **P2** (responsive UI defect).
- Root cause: tooltip edge alignment followed LTR DOM tile positions after RTL
  visually reversed the grid; the tooltip could extend beyond the viewport.
- Fix: reverse edge anchoring for RTL desktop and narrow-grid positions in
  `src/dashboard/fragments.ts`.
- Proof: genuine Chromium/Firefox/WebKit run over eight breakpoint-adjacent
  widths in both directions; overflow assertions pass in all 48 cases.

### AUDIT-04 — SPDX SBOM identity and graph gaps

- Severity: **P1** (a malformed or misbound inventory could pass verification).
- Root cause: root version and expected source namespace were not checked,
  disconnected packages were accepted, and package IDs used only 48 bits of
  the SHA-256 identity digest.
- Fix: use the full SHA-256 suffix, reject invalid/mismatched source SHA,
  select the root by exact name and version, and require every package to be
  reachable from the document root.
- Proof: `tests/sbom-generator.test.ts` covers namespace mismatch, invalid SHA,
  exact root version when another FuryPipe version is nested, orphan packages,
  cycles represented as finite JSON trees, and full-length IDs. The SBOM
  remains an inventory, not a signature or legal license opinion.

### AUDIT-05 — Concurrency and test-harness gaps

- Severity: **P2**.
- Root cause: Recovery worker child processes had no test timeout, and the
  LTM UPDATE/DELETE conflict was not explicitly exercised.
- Fix: terminate a Recovery test worker after 30 seconds and add a barrier-based
  independent-adapter UPDATE-versus-DELETE race asserting one visible conflict,
  one version-2 winner and two intact history entries.
- Proof: `tests/recovery-store.test.ts`, `tests/long-term-memory.test.ts`; full
  suite result in the worklog.

### AUDIT-08 — SBOM orphan test inherited the CI source SHA

- Severity: **P2** (a valid orphan rejection was obscured by a fixture
  provenance mismatch on hosted Node matrix jobs).
- Root cause: GitHub Actions provides `GITHUB_SHA`; the final verifier
  subprocess in the SBOM orphan test inherited the checkout SHA while its
  generated fixture was intentionally bound to a test SHA.
- Failure scenario: provenance validation correctly rejected the fixture
  namespace before the test reached its intended disconnected-package check.
- Fix: explicitly set the fixture source SHA for every verifier child process,
  including the orphan-package case; no production check or test expectation
  was weakened.
- Proof: the complete local suite passes with `GITHUB_SHA` set to simulate the
  hosted environment. The final hosted CI matrix must be rechecked on the
  post-fix PR head.

### AUDIT-06 — Repository policy is not configured

- Severity: **P1 release blocker**; no local code fix is authorized or claimed.
- Evidence: GitHub branch-protection API returned 404 `Branch not protected`;
  rulesets API returned an empty list.
- Impact: required PR/check/force-push/deletion/conversation-resolution policy
  cannot be verified as enforced.
- Disposition: `BLOCKED_BY_REPO_SETTING`; report to maintainer without changing
  repository settings.

### AUDIT-07 — SBOM alias, optional-dependency and identity edge coverage

- Severity: **P2** (package identity could be mislabeled for npm aliases; edge
  cases were not adequately exercised).
- Root cause: the generator preferred the dependency map key when pnpm's node
  omitted `name`, even though list records expose a canonical `from` field;
  the verifier compared aliases by their declared key rather than the target
  package name. The exact root selector also needed to tolerate a different
  version of the root package in the dependency graph.
- Failure scenario: a manifest entry such as `json-five: npm:json5@...` could
  become an SBOM package named `json-five`, or a valid graph containing another
  `furypipe` version could be rejected as ambiguous.
- Fix: prefer `node.name`, then a package-name reference from `node.from`, then
  the map key; resolve `npm:` aliases when checking direct dependencies; bind
  the root by exact name plus version.
- Proof: adversarial fixtures cover direct/transitive/dev/optional edges,
  scoped names, alias targets, duplicate versions, sanitized-slug collisions,
  special version text, an internal metadata key that must not become a
  package, a finite dependency cycle, deterministic byte-for-byte generation,
  and exact source SHA validation.
- Limit: this repository currently declares no npm aliases. Alias behavior is
  covered by the fixture contract, not by a live alias install. Completeness is
  still bounded by the dependency tree emitted by
  `pnpm list --json --depth Infinity`; this verifier does not independently
  reconstruct the lockfile.

### AUDIT-08 — SBOM orphan test inherited the CI source SHA

- Severity: **P2** (a valid orphan rejection was obscured by a fixture
  provenance mismatch on hosted Node matrix jobs).
- Root cause: the CI workflow injects `FURYPIPE_SOURCE_COMMIT`; the final
  verifier subprocess in the SBOM orphan test inherited that SHA while its
  generated fixture was intentionally bound to a test SHA.
- Failure scenario: provenance validation correctly rejected the fixture
  namespace before the test reached its intended disconnected-package check.
- Fix: explicitly set the fixture source SHA for every verifier child process,
  including the orphan-package case; no production check or test expectation
  was weakened.
- Proof: the complete local suite passes with `FURYPIPE_SOURCE_COMMIT` set. The
  final hosted CI matrix must be rechecked on the post-fix PR head.

## Cross-browser evidence

Playwright is pinned to `1.63.0` in the development dependencies and lockfile.
The package and `playwright-core` both declare Apache-2.0; their notices are in
`THIRD_PARTY_NOTICES.md`. Playwright's browser installation is version-coupled
and is explicit in CI. The locally installed engines were real Chromium,
Firefox and WebKit, not Chromium aliases.

| Surface | Chromium | Firefox | WebKit | Count |
| --- | --- | --- | --- | ---: |
| Dashboard | 16/16 | 16/16 | 16/16 | 48/48 |
| Web Studio static QA fixture | 48/48 | 24/24 | 48/48 | 120/120 |

Dashboard coverage includes French LTR and `ar-XB` RTL, all declared CSS
breakpoint boundaries and adjacent widths, locale persistence/HTMX propagation,
tooltip overflow, theme toggle, modal bounds and runtime exceptions. Web Studio
coverage checks the declared browser-project/viewport/locale set, structure,
direction, overflow, links and browser errors. The Web Studio test does not
complete the broader manual WCAG, real Figma, SEO, field-performance or
deployment checks. Firefox's expected restrictive-CSP favicon diagnostic is
recorded separately; it is not silently treated as a page runtime exception.

## Recovery, Agent and LTM evidence

- Recovery uses a real temporary filesystem and separate Node processes for
  put/get/delete/backup/restore/rekey and agent resume. A process-kill fixture
  proves stale-lock and temporary-residue recovery only; it is not a power-loss
  or hardware durability test. Crash points before/within temp write, fsync,
  rename and manifest publication are not exhaustively injected.
- Agent tests exercise real stage callbacks, ordering, read-only defaults,
  budgets, handoff and atomic claims; another process resumes persisted history.
  This does not establish distributed consensus or multi-host safety.
- LTM keeps immutable revisions and fails visibly on matching-version conflict.
  The new UPDATE/DELETE race is deterministic across independent adapters in a
  shared test process; cross-process mutation races remain untested.

## Provider fallback and policy audit

`tests/provider-retry-fallback-orchestrator.test.ts` exercises fallback from
captured model-neutral BASE, same-model retry, allowlisted HTTP statuses,
cross-provider opt-in, Retry-After, explicit policy denial, transport ambiguity,
oversized responses, cancellation and plaintext-free attempt metadata. Related
registry/runtime/policy/retrieval suites cover exact TTL expiry, unknown health
and cost, bounded cache/retrieval, and fail-closed invalid costs. These are local
contract tests; they do not prove provider truth, live pricing, provider health,
account authorization or billing behavior.

## External validation harness readiness

| System | Status | Prepared capability | Not proven |
| --- | --- | --- | --- |
| OpenClaw Gateway | `BLOCKED_EXTERNAL_ENV` | `pnpm run openclaw:probe` requires both `FURYPIPE_ALLOW_OPENCLAW_PROBE=1` and an explicit `OPENCLAW_GATEWAY_URL`; remote hosts additionally require `--allow-remote`. It probes only `/healthz`, `/startupz`, `/readyz`, with no model/tool call. | No target URL was provided; the guarded run returned `requestExecuted: false`. |
| OpenAI / Anthropic / Google provider | `NOT_EXECUTED` | Production HTTP transports and local conformance tests exist. | No credentialed live validation runner was available or invoked; no DNS/TLS/auth/model/request/usage/billing/rate-limit result is claimed. |
| OAuth Authorization Server | `NOT_AVAILABLE` | OAuth metadata/contracts are documented at the host/MCP boundary. | No configured issuer or end-to-end token/JWKS verifier harness. |
| Hosted MCP | `NOT_AVAILABLE` | Local stdio and HTTP server contracts are exercised. | No remote client/auth/reconnect/conformance environment was supplied. |
| Figma MCP | `NOT_AVAILABLE` | A read-only plugin/profile contract exists. | No token/workspace or live Figma adapter execution. |

The documented provider, Figma, OAuth, MCP and OpenClaw target variables were
checked by name only and were unset in this execution environment. No credential
value was read into the report, and no external provider or Figma request was
sent. This section is intentionally `PARTIAL`, not “external-ready”.

## Supply-chain / SBOM evidence

- `pnpm install --frozen-lockfile`: PASS.
- `pnpm audit`: PASS, no known vulnerabilities.
- SBOM generation/verifier adversarial fixture: PASS; root/runtime/dev/optional
  and transitive relationships, package identity, namespace, determinism and
  reachability are checked. A completed current-tree SBOM is still validated
  by the Supply Chain workflow on the exact final PR head.
- `node scripts/security/check-actions-pinning.mjs`: PASS, 53 references across
  13 workflows.
- Local license inventory: 82 package entries; Apache-2.0 count is 9, including
  `playwright` and `playwright-core`. This is not legal advice.
- On PR #129, Workflow action pinning, SPDX SBOM, Frozen dependency audit and
  GitHub dependency review child jobs each completed with `success`. The
  read-only repository variable `FURYPIPE_DEPENDENCY_GRAPH_ENABLED` was `true`,
  so Dependency Review ran rather than being skipped. Recheck these job-level
  conclusions on the exact final head after the audit report update.
- Provenance input validation and an emitted signed npm attestation are
  different evidence. The attestation step is conditional on an eligible
  non-PR event and is not claimed from a PR run.

## Release-readiness evidence

`src/release-readiness/index.ts` and `src/release-readiness/evidence.ts` retain
canonical required-gate coverage, source-bound provenance, immutable evidence
snapshots and deny-by-default authorization. `scripts/rc-preparation.mjs` binds
the candidate and package digest and distinguishes package-manager reversibility
from production rollback. The RC workflow uses the exact PR head SHA.

`npm view furypipe` returned HTTP 404 during the registry check. Thus a package
upgrade/rollback against a prior published FuryPipe version is `NOT_EXECUTED`;
no fake version was created. No merge, tag, npm publish, GitHub Release,
production deploy or release authorization is part of this work.

## Documentation and false-green review

`TASKS.md`, Web Studio QA/implementation docs, i18n runtime, migration and RC
checklist no longer state that Firefox/WebKit were never run or cite old
workflow IDs as current evidence. The 2026-09-12 WORKLOG entries remain as
dated history. Targeted test scans found no disabled tests or literal
always-true assertions. The audit is not an exhaustive manual review of every
test assertion; local tests do not promote hosted/external states.

## Explicit non-claims

- No physical power-loss durability, distributed Agent consensus or multi-host
  LTM safety claim.
- No real provider account, billing, model availability or business outcome.
- No hosted OAuth/MCP, live OpenClaw or Figma connectivity.
- No complete WCAG manual audit, OWASP ASVS audit, SEO audit, production Web
  Vitals or deployment verification.
- No branch-protection/ruleset enforcement.
- No signed npm artifact attestation, prior-version npm upgrade/rollback, merge,
  tag, publication, GitHub Release, production deployment or release approval.
