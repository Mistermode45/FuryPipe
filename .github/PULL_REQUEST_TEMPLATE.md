## Summary

<!-- What changes for users, contributors or maintainers? Keep this concrete. -->

## Problem / root cause

<!-- What is wrong or missing today, and what causes it? -->

## Change

<!-- What did you change? What did you deliberately leave unchanged? -->

## Evidence

<!-- Exact commands, tests, workflow runs, fixtures or external checks. -->

```text
# Example:
# pnpm test -- <target>
# pnpm run typecheck
# GitHub Actions run: <id/url>
```

## Risk / compatibility

- [ ] No public API/configuration impact
- [ ] Public API/configuration impact is documented
- [ ] Compatibility/migration impact was reviewed where applicable
- [ ] Security-boundary impact was reviewed
- [ ] Persistence/data migration impact was reviewed
- [ ] Release-note impact is documented where applicable

## Truth-state check

<!-- Do not promote configured/wired/present state into executed/verified state. -->

- [ ] Claims match evidence that was actually executed
- [ ] `UNKNOWN`, `NOT_EXECUTED`, `PARTIAL` or `BLOCKED` are preserved when appropriate
- [ ] `wired != executed != verified`
- [ ] Package publication is not presented as production deployment

## Verification checklist

- [ ] Based on the current repository default branch
- [ ] `pnpm run typecheck`
- [ ] `pnpm test`
- [ ] `pnpm run build`
- [ ] Relevant targeted tests/workflows executed
- [ ] Documentation updated for public behavior changes
- [ ] No unrelated cleanup or drive-by refactor
- [ ] No credentials, private prompts, session files or personal machine identifiers

## Security

<!-- Required when touching credentials, routing, MCP auth, persistence, logs, dependencies, provider execution, agent permissions or release workflows. -->

Security impact: `none / reviewed / requires follow-up`

## Release / deployment impact

<!-- Keep these separate. Use NOT_EXECUTED when applicable. -->

- Package/release impact: `none / ...`
- Production deployment impact: `none / NOT_EXECUTED / ...`
