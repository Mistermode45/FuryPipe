# Contributing to pxpipe

Small PRs with receipts merge fast.

I built pxpipe over a weekend and maintain it part-time. Review may be
slow. I need help maintaining it; see
[Becoming a maintainer](#becoming-a-maintainer).

## Rules

- One root cause per PR. Split unrelated fixes.
- Rebase on current `main` before opening. A few files churn constantly;
  stale branches conflict with them almost immediately.
- Redaction: no raw prompts, credentials, session files, API keys, or machine
  identifiers (hostnames, usernames, absolute home paths) in PR descriptions,
  issues, test fixtures, or committed logs. Use made-up repro data instead.
- CI green. `pnpm test` and `pnpm typecheck` pass locally.

## Required only when applicable

- Claims about model behaviour (readability, savings, guard flags, refusals)
  include: model id, date, client version, render geometry, sample size, and
  failure categories. The same standard I hold the README to.
- Provider pricing carries a source URL and a date.
- Security reports go through [SECURITY.md](SECURITY.md), not the public
  issue tracker.

## Nice to have

- A failing test first, then the fix.
- Exact commands and their output in the description, so a reviewer can
  re-run instead of re-derive.

A three-line fix with a clear repro is a good PR. Do not bulk it up to look
more serious.

## What tends to stall

- Claims about model behaviour that would need testing on every model to
  verify. Ship what a test can check; leave the judgment call to me.
- PRs that touch files unrelated to the stated root cause.
- New opt-in flags with no caller.

## Becoming a maintainer

First disbelieved, then called a temp hack. I want to find out if context
as images becomes the new normal, and this repo is where that gets tested.

Help I want most:

- Eval results: per-model readability and savings runs on your hardware
  and providers, with the evidence fields above. This is the work that
  stalls PRs today.
- Issue triage: repro, label, close duplicates.
- Review: a second pair of eyes on render and transform PRs.

If you want to help maintain this, tell me. I grant commit access on
track record: a few good PRs plus useful issue triage. No formal process.
