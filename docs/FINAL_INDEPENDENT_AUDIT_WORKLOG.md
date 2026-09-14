# Final Independent Audit — Worklog

Date: 2026-09-14  
Repository: `Mistermode45/FuryPipe`  
Branch: `v5-codex-final-independent-audit`  
Audit source: exact PR #128 head `cb2216105b8196fed2a89915187288199feff235`  
Production base: `v5-production-hardening` at `8299f74439bf74a208431e2106b6ff5c9781ed93`

## Local environment

- Node.js `v26.8.2`
- pnpm `10.21.0`
- Playwright `1.63.0` (exact development dependency)
- Chromium, Firefox and WebKit installed by the pinned Playwright version.

## Final local gates

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS — lockfile up to date, no resolution change. |
| `pnpm audit` | PASS — no known vulnerabilities found. |
| `pnpm run typecheck` | PASS. |
| `pnpm test` | PASS — 170 files, 2,078 tests. |
| `pnpm run build` | PASS — library/declarations, Node and MCP outputs; `--version` = `0.13.2`. |
| `pnpm run package:smoke` | PASS — package, benchmark claim, provider attempt and governed-provider smoke. |
| `node scripts/security/check-actions-pinning.mjs` | PASS — 53 references / 13 workflows. |
| `git diff --check` | PASS — only Git's LF/CRLF advisory. |
| Local Playwright cross-browser harness | PASS — Dashboard 48/48; Web Studio 120/120; Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6. |

The first full test attempt found one faulty SBOM test fixture retaining an
intentionally mismatched package version. The fixture was restored before the
orphan-graph assertion; targeted SBOM test and the subsequent full suite passed.
No production validation was weakened to obtain a pass.

The first hosted Node-matrix run on the report-update head exposed a separate
test-isolation issue: the orphan fixture inherited GitHub Actions' `GITHUB_SHA`
and failed provenance validation before reaching its graph assertion. The test
now explicitly binds all child verifiers to the fixture SHA. The full local
suite passed again with `GITHUB_SHA` pre-set, and the post-fix hosted matrix
passed all 9/9 jobs on the audit PR head.

## Exact-head GitHub evidence

Hosted workflows are valid only when their run head matches the current remote
head of `v5-codex-final-independent-audit`. At handoff, all 12 required workflow
runs concluded `success` on the exact PR head. CI's nine Node/OS matrix jobs
passed 9/9; CodeQL, Secret Scan, Benchmark Contract, Control Room Security
Evidence, Dashboard Browser QA, Web Studio Browser QA, Cross-Browser QA, RC
Preparation Evidence, License Compliance (3/3), and Supply Chain (4/4) passed.
Supply Chain's child Dependency Review ran and passed because the read-only
repository variable was `true`. Provenance input validation passed, while the
separate `Attest packed npm artifact` child remained `skipped`; no signed npm
artifact attestation is claimed. Run IDs are intentionally not stored as
durable truth; the current PR #129 check set is authoritative.

Inspect Supply Chain child jobs individually. On the observed PR #129 run,
Dependency Review ran and passed because the read-only repository variable
`FURYPIPE_DEPENDENCY_GRAPH_ENABLED` was `true`; do not call it `SKIPPED` for
that run. The CI-uploaded Cross-Browser QA artifact was downloaded and its
source SHA, browser versions, counts, and statuses were checked. On a pull
request, provenance input validation does not equal an emitted signed npm
attestation; the separate attestation job was skipped.

## Read-only external/repository checks

- `v5-production-hardening` branch-protection API: HTTP 404 `Branch not protected`.
- Repository rulesets API: empty result.
- No protections/rulesets were modified.
- OpenClaw live probe without opt-in/URL: `BLOCKED_EXTERNAL_ENV`,
  `requestExecuted: false`.
- Provider/OAuth/MCP/OpenClaw/Figma environment variable names checked; no
  values were printed. No live provider/Figma/OAuth/hosted MCP request was sent.
- npm registry lookup for `furypipe`: HTTP 404; package upgrade/rollback against
  a prior public version remains `NOT_EXECUTED`.
- No merge, tag, npm publish, GitHub Release or production deployment occurred.
