# License compliance

## Status

`AUTOMATED_REPORT_CONFIGURED`

FuryPipe generates a dependency-license inventory in CI from the frozen pnpm dependency graph.

## Evidence

Workflow:

`.github/workflows/license-compliance.yml`

Commands:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm licenses list --json > licenses.raw.json
node scripts/security/license-report.mjs licenses.raw.json licenses.summary.json
```

Artifacts:

- `licenses.raw.json` — pnpm's source report;
- `licenses.summary.json` — normalized FuryPipe count/status report.

The job fails when the report is empty or contains an explicit unknown/unlicensed group.

## Policy boundary

This gate is an inventory/completeness gate, not legal advice and not a simplistic allowlist.

The current dependency graph contains permissive licenses and also license expressions that require explicit distribution review. FuryPipe therefore does not silently reject every copyleft expression or silently declare every discovered license acceptable.

Before a public release:

1. compare the CI report with `THIRD_PARTY_NOTICES.md`;
2. review bundled/runtime dependencies separately from development-only packages;
3. preserve required notices;
4. verify asset/font licenses;
5. review combined expressions such as `Apache-2.0 AND LGPL-3.0-or-later`;
6. record the reviewed report with the release evidence;
7. update notices when the lockfile changes materially.

A green report means `LICENSE_INVENTORY_GENERATED`, not `LEGAL_APPROVAL_GRANTED`.
