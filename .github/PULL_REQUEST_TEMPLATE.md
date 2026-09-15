## Summary

<!-- What changes for users or maintainers? Keep this short and concrete. -->

## Problem / root cause

<!-- What is wrong today, and why? -->

## Change

<!-- What did you change? What did you deliberately leave unchanged? -->

## Evidence

```text
# Exact commands, targeted tests, workflow runs, or reproducible evidence.
```

## Risk / compatibility

- [ ] No public API or configuration impact
- [ ] Public API/configuration impact documented
- [ ] Legacy `pxpipe` / `PXPIPE_*` compatibility considered
- [ ] Security boundary impact reviewed
- [ ] Migration/release-note impact documented when applicable

## Truth-state check

<!-- For providers/MCP/agents/releases: do not promote configured/wired to executed/verified. -->

- [ ] Claims match the evidence actually executed
- [ ] `NOT_EXECUTED`, `UNKNOWN`, `PARTIAL` or `BLOCKED` states are preserved where appropriate
- [ ] No release/deployment claim is inferred from unrelated green CI

## Verification checklist

- [ ] Based on the current repository default branch
- [ ] `pnpm run typecheck`
- [ ] `pnpm test`
- [ ] `pnpm run build`
- [ ] Relevant targeted tests/workflows
- [ ] No raw prompts, credentials, session files or private machine identifiers
- [ ] Documentation updated for public behavior changes

## Security

<!-- If this changes credentials, routing, MCP auth, persistence, logs, dependencies or release workflows, summarize the security review. -->
