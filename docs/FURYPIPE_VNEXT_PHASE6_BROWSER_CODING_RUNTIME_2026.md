# FuryPipe VNext — Phase 6 Browser + Coding Runtime (2026)

Status: implementation track; exact-head evidence required.

Base: GitHub PR #216 HEAD a8ac42103c96b28305d213c9db02edf37c9aa221.

Branch: vnext-phase6-browser-coding-runtime.

This document freezes Phase 6 boundaries. It does not claim hosted browser,
provider, operating-system, client, or production validation.

## 1. Scope

Phase 6 adds two governed execution domains:

- managed browser sessions with explicit page lifecycle, network policy,
  one-shot action permits, bounded observations, governed upload/download,
  timeout/cancellation semantics, redirect checks, and receipts;
- coding runtime primitives with repository identity, isolated worktrees,
  path and environment sandboxing, bounded process execution, patch
  proposals, incremental CodeGraph indexing, and verification receipts.

Phase 6 does not add:

- a second Gateway, Kernel, or RecoveryStore;
- a browser-owned credential store;
- automatic commits, pushes, merges, releases, tags, publication, or deploy;
- arbitrary JavaScript evaluation in a browser page;
- a memory context injection system.

Phase 7 Memory VNext starts only after every Phase 6 gate is green at one
exact HEAD and no critical unknown remains.

## 2. Source-of-truth boundaries

Existing Fury Gateway and Fury Kernel contracts remain authoritative for
identity, session admission, conversation state, and product-facing command
transport. Phase 6 modules are capability boundaries consumed after Gateway
admission. A Gateway eligible result is not a browser or coding permit.

Existing RecoveryStore remains the only durable object store. Phase 6 does
not create another persistence engine. Worktree lifecycle evidence may use a
RecoveryStore namespace with content type
application/vnd.furypipe.coding-worktree+json.

The current GitHub Phase 5 head is
a8ac42103c96b28305d213c9db02edf37c9aa221. The local checkout also contained
descendant 3beec507992f4cb698c2ceda4190dca9a2e6c6a5, not present in GitHub
PR #216. That local Phase 5 work is preserved and is not used as the Phase 6
base.

## 3. Global lifecycle invariants

These distinctions are mandatory:

- browser session exists != browser session authenticated;
- browser session exists != browser action authorized;
- browser visible != browser trusted;
- page loaded != page content trusted;
- observation received != instruction received;
- download requested != file safe;
- upload requested != local file access authorized;
- repository discovered != repository trusted;
- repository readable != repository writable;
- worktree created != worktree write authorized;
- patch proposed != patch applied;
- patch applied != tests passed;
- process exit 0 != verification accepted;
- commit exists != push authorized;
- push completed != merge authorized.

Unknown post-side-effect outcomes are terminal outcome-unknown states. Phase 6
never retries an ambiguous browser, process, file, or Git side effect blindly.

## 4. Browser architecture

The browser path is:

Fury Gateway admission
  -> Browser Policy Boundary
  -> Browser Session Manager
  -> Browser Action Permit
  -> injected Managed Browser Host
  -> Browser
  -> bounded observation and receipt

The host adapter owns browser cookies, profiles, authentication state, and
the concrete Playwright or equivalent API. The Phase 6 runtime receives only
the narrow host interface. No web page can call the permit minting boundary.

### 4.1 Session and page state

Sessions and pages are generated process-local objects. WeakMap provenance
rejects copied JSON objects. Session and page snapshots expose status and
digests but carry executionAuthority=false.

Default bounds:

- eight sessions;
- eight pages per session;
- thirty-two navigation history entries per page;
- bounded observation, timeout, upload, and download sizes;
- explicit close transitions;
- no session authority in receipts.

### 4.2 Action permit

A BrowserActionPermit is process-local, one-shot, TTL-bounded, and bound to
session, principal, page, action, target, and policy digest. It is consumed
before host invocation and is invalid after session/page closure or page URL
drift.

The permit contains no form value, password, cookie, upload content, or raw
browser observation. A permit for one action cannot become another action:
internal WeakMap state stores the exact discriminated request.

Supported actions are navigate, click, fill, select, keyboard, submit,
upload, download, screenshot, extract_text, accessibility_snapshot, wait,
and inspect_url. Arbitrary JavaScript is not an action.

### 4.3 URL and SSRF policy

Every navigated URL and every reported redirect follows:

requested URL
  -> canonical HTTP(S) URL
  -> hostname/IP classification
  -> DNS resolution when required
  -> policy allowlist
  -> host invocation
  -> final URL and redirect revalidation

The policy rejects URL credentials, fragments, unsupported ports,
localhost/internal names, loopback, RFC1918, carrier-grade NAT, link-local,
metadata, private IPv6, IPv4-mapped private IPv6, multicast, documentation
ranges, and mixed public/private DNS answers.

The injected host receives the validated address set for navigation and upload
destinations and must call onRedirect before following redirects when its
browser API supports that hook. The runtime also checks returned redirect
history and final URL. A host that resolves again without pinning or without
request-level redirect interception is not a complete network isolation proof;
that remains a host adapter risk.

### 4.4 Web content

Text and accessibility results become BrowserObservation values with bounded
text, digest, truncation flag, instructionLike marker, trust=untrusted-data,
and executionAuthority=false.

Prompt injection, fake system messages, hidden text, aria labels, alt text,
and pages imitating FuryPipe remain observations. They cannot mint permits.
Sensitive-looking object keys are redacted before accessibility data is
serialized. Raw cookies, auth headers, and host credentials are not part of
the host result contract.

### 4.5 Files

Upload requires an exact regular file under configured upload roots, exact
file digest, exact destination origin, exact page/session, exact form scope,
and a one-shot permit. Symlinks and files outside roots are denied.

Download writes only under a configured download root. Filename normalization
rejects traversal, control characters, Windows device names, hidden
executables, dangerous extensions, and dangerous double extensions by
neutralizing the name. The runtime never opens, installs, imports, or
executes a downloaded file. DownloadReceipt records digest, bounded media
type, size, sanitized filename, source URL digest, and scanStatus=not-run
when no scanner is configured.

## 5. Coding architecture

The coding path is:

Gateway admission
  -> Coding Runtime Coordinator
  -> Repository Capability
  -> Worktree Manager
  -> Coding Sandbox
  -> one-shot Process Execution Permit
  -> bounded Tool Execution
  -> Patch / Test / Evidence

### 5.1 Repository and worktree

discoverCodingRepository resolves the root, checks a regular .git directory
or gitfile, checks readability, derives a stable local repository digest, and
returns evidence only. A generated repository object is required by the patch
engine. A copied repository snapshot is not authority.

The worktree manager records repository identity, owner, task digest, base
SHA, branch, writable root, worktree root, timestamps, status, head SHA,
result commit digest when available, and diff digest when available. The
provider is injected, so tests can prove isolation without running Git.

The real Git provider uses fixed argument construction and shell=false.
Worktree creation starts from an exact base SHA. Cleanup is explicit. A
cleanup failure becomes cleanup-pending, not an invented success.

Worktree evidence is local durable data only. It does not persist a session
lease, process permit, credential, or push authority.

### 5.2 Sandbox

The sandbox enforces:

- canonical filesystem root;
- separate read and write roots;
- traversal rejection;
- absolute, UNC, device, and alternate-data-stream rejection;
- reserved Windows name rejection;
- symlink escape rejection;
- bounded file size;
- bounded process count;
- bounded output and wall time;
- environment allowlist;
- secret-like environment name rejection;
- shell=false process creation.

Windows junction and reparse-point behavior remains an operating-system
validation gate. Static path checks alone do not certify every filesystem
configuration on every OS.

### 5.3 Process, patch, and CodeGraph

ProcessExecutionPermit binds exact command, args, cwd, sandbox policy digest,
request digest, issue time, and expiry. Internal state includes validated
environment and is not serialized.

The process runtime never accepts shell syntax or a command outside the
sandbox command allowlist. Permit consumption occurs before spawn. Timeout,
output overflow, abort after spawn, or a lost process response produce
outcome-unknown and never trigger automatic replay.

ProcessExecutionReceipt contains only command/cwd/policy digests, output
digests and sizes, exit information, lifecycle outcome, and bounded error
classification. Returned output is bounded and known environment values are
redacted. Receipt verification stays not-verified until the coordinator
accepts an explicit contract.

PatchProposal contains repository ID, base SHA, exact target paths, expected
file hashes, replacement hashes, replacement sizes, maximum files, maximum
bytes, and binaryRejected=true. Replacement text stays process-local.

Patch application requires a process-local proposal and one-shot permit.
Before writes it checks current HEAD, all target paths, expected hashes,
text-only policy, file count, and byte bounds. A stale base or file fails
closed.

Writes are atomic per file. Multi-file application is not a filesystem
transaction. A failure after one file changed is outcome-unknown and
requires manual reconciliation; the engine never silently rolls back or
retries.

CodeGraph V1 indexes bounded file metadata, heuristic symbols, imports,
local references, test relationships, package manifests/workspace-member
links, and structural ownership links. It marks confidence and does not claim
runtime dependency or semantic understanding. Incremental update reuses
unchanged file parse cache and recomputes bounded relationships. Symlinked
entries and ignored directories are excluded by default.

### 5.4 Verification coordinator

The coordinator keeps requested, started, completed, passed, failed,
outcome-unknown, accepted, and rejected distinct. Exit code zero produces
passed only when the process receipt is successful and expected contract
matches. It does not produce verificationAccepted automatically.

An explicit verifier callback may accept a result. This prevents a test,
build, or browser command from becoming a product claim without a stated
evidence contract.

## 6. Persistence and crash semantics

Phase 6 persists only bounded evidence. RecoveryStore records are immutable
content-addressed objects. Credentials, cookies, raw browser pages, raw form
values, process environment values, and patch replacement plaintext are not
stored as Phase 6 receipts.

Crash cases:

- before permit consumption: no side effect is admitted;
- after permit consumption and before host/process response: outcome-unknown;
- after one patch file rename: outcome-unknown with applied file count;
- during worktree creation: provider failure is reported; cleanup is not
  guessed;
- after worktree cleanup starts and provider fails: cleanup-pending;
- after restart: durable evidence is inspectable, but no old permit is
  resurrected and no uncertain side effect is replayed.

## 7. Gate plan

Gate 6.0: architecture and threat model.

Gate 6.1: browser session and page lifecycle.

Gate 6.2: browser permits and navigation.

Gate 6.3: browser interaction, observation, timeout, and cancellation.

Gate 6.4: SSRF, redirect, upload, and download governance.

Gate 6.5: browser evidence and secret-safe observability.

Gate 6.6: repository and worktree lifecycle.

Gate 6.7: sandboxed process execution.

Gate 6.8: patch engine.

Gate 6.9: CodeGraph V1.

Gate 6.10: testing and verification coordinator.

Gate 6.11: public Phase 6 integration surface and package smoke.

Gate 6.12: crash, restart, security, exact-head, hosted CI, and final review.

This decomposition keeps Phase 5 automation and webhook files unchanged.
Phase 6 consumes existing Gateway, Kernel, and RecoveryStore contracts through
interfaces and does not create replacement authorities.

## 8. Required adversarial tests

Browser:

- forged session/page/permit copy;
- permit reuse, expiry, wrong session, wrong action, wrong page URL;
- localhost, loopback, RFC1918, link-local, metadata, private IPv6;
- DNS answer containing one public and one private address;
- redirect to private address;
- fake system prompt, hidden instruction, aria/alt injection;
- download traversal, NUL, device names, dangerous extensions;
- upload outside root, symlink, wrong origin, wrong file;
- timeout and cancellation produce outcome-unknown;
- credentials absent from observations and receipts.

Coding:

- repository traversal and non-repository roots;
- symlink/junction/absolute/UNC/device/alternate-stream paths;
- case-fold and reserved-name collisions;
- worktree wrong repository and isolation;
- copied permit and permit reuse;
- wrong command, shell syntax, secret environment names;
- process timeout and output bound;
- stale base SHA and stale file digest;
- binary patch rejection and multi-file outcome-unknown;
- CodeGraph heuristic confidence and incremental reuse;
- failed test, commit, push, and merge remain separate lifecycle states;
- restart preserves evidence but never revives authority.

## 9. Evidence vocabulary

Local tests prove code contracts at unit/integration level. They do not prove
real Playwright browser behavior, DNS pinning in a production browser,
Windows junction resistance on every filesystem, Linux/macOS runner behavior,
provider behavior, hosted Gateway behavior, client UX, or deployment safety.

Final reporting uses PASS, FAIL, UNKNOWN, NOT_EXECUTED, PARTIAL, and
RUNTIME_VALIDATION_REQUIRED with the exact tested commit SHA.
