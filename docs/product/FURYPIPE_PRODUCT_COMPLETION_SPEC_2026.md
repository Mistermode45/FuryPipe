# FuryPipe Product Completion Spec 2026

Single definition of done for the `claude/furypipe-studio-universal-ai-workspace` track (mission §20–§21, §119). No numbered phases are added on top of this list; a requirement leaves this file only by reaching DONE with evidence or by an explicit reclassification recorded in `MASTER_DOC_SYNC_LOG.md`.

Source note: the Google Docs master specification could not be read (egress blocked); requirements come from the operator's 2026-09-25 mission prompt and must be re-synchronised.

Status values: NOT_STARTED, PARTIAL (existing primitive, not yet meeting the acceptance criteria), DONE (acceptance met, evidence linked), OPTIONAL_NOT_LIVE_VERIFIED (contract/mocks pass, live service not available).

Release gates (all MUST): P0 = 0, P1 = 0, P2 release-blocking = 0, exact-head CI green on 3 OS × Node 22/24/26, installed-package smoke green, reproducible package, documentation matches code, no PASS without evidence.

| ID | Requirement | Class | Depends on | Acceptance | Test strategy | Status |
|---|---|---|---|---|---|---|
| CORE-01 | FuryProof evidence kernel: receipts (TOOL/AGENT/PATCH/TEST/BROWSER/MODEL/INTEGRATION/APPROVAL), claim states OBSERVED/DERIVED/CLAIMED/VERIFIED, agents cannot self-promote CLAIMED→VERIFIED | MUST | – | A claim without a matching verified receipt stays CLAIMED; bundle digest is deterministic; tampered receipt is rejected | unit + property tests | NOT_STARTED |
| CORE-02 | FuryJudge: ACCEPT/REWORK/REJECT/ESCALATE/UNPROVEN from requirements × receipts | MUST | CORE-01 | Missing evidence for a MUST predicate → UNPROVEN; failing test receipt → REWORK; policy violation → REJECT | unit | NOT_STARTED |
| CORE-03 | FuryIR / Executable Intent Contract (MUST, MUST_NOT, allowed/denied capabilities, budget, success predicates, human gates, task DAG, evidence contract), versioned and strictly validated | MUST | – | Unknown keys, cycles, oversize and unbounded budgets rejected; digest stable | unit | NOT_STARTED |
| CORE-04 | Harness Hub: registry + safe discovery (installed, version) for Claude Code, Codex, Gemini CLI, OpenCode, OpenClaw, OpenHands, Goose, Kilo, FuryPipe Native, ACP/A2A generic; never reads credentials | MUST | – | Discovery uses only PATH lookup + `--version` with timeout, no shell; absent tools reported as not installed | unit with fake binaries | NOT_STARTED |
| CORE-05 | Local model fabric: loopback discovery of Ollama, LM Studio, llama.cpp, vLLM, SGLang, LocalAI, generic OpenAI/Anthropic-compatible; capability probe; hardware discovery kept local; FITS/MAY_BE_SLOW/DOES_NOT_FIT | MUST | – | Probes only allow-listed loopback/LAN targets, bounded bodies, timeouts; classification deterministic | fake HTTP servers | NOT_STARTED |
| CORE-06 | FuryDispatcher: OFF/SINGLE/AUTO/MANUAL/PIPELINE/PARALLEL/COUNCIL/RACE/REVIEW_CHAIN/SPECIALISTS/LOCAL_CLOUD_HYBRID/LOCAL_ONLY/CUSTOM_GRAPH; AUTO may return DISPATCH_BENEFIT=LOW; child authority ≤ parent; privacy boundary enforced | MUST | CORE-03,04,05 | Plans are deterministic for a given registry; LOCAL_ONLY never selects a cloud provider; escalated child authority rejected | unit | NOT_STARTED |
| CORE-07 | Worktree isolation: 1 writer agent = 1 git worktree, cleanup of orphans | MUST | CORE-06 | Two writers never share a worktree; orphan worktrees detected and removed | integration with real git | NOT_STARTED |
| CORE-08 | FuryPlanner: requirements → task DAG with owners, budgets, stop conditions, human gates | MUST | CORE-03,06 | Planner output validates as FuryIR | unit | NOT_STARTED |
| CORE-09 | FuryIntegrator: ordered patch application with conflict detection, never blind merge | MUST | CORE-07 | Conflicting patches stop with a conflict report; clean patches applied in sequence with receipts | integration with real git | NOT_STARTED |
| CORE-10 | FuryGraph provider interface + Graphify provider (real graph.json schema) + native codegraph fallback; blast radius | MUST | – | Graphify fixture parsed; missing Graphify falls back to native; affected set computed by reverse traversal | unit with real Graphify fixture | NOT_STARTED |
| CORE-11 | FuryContext Compiler: task context capsule with source, reason, digest, scope, expiry; never drops MUST constraints | MUST | CORE-03,10 | Over-budget capsule drops lowest-priority items only; MUST constraints always present | unit + FuryBench context case | NOT_STARTED |
| CORE-12 | Mission Control model: per-agent state, budget, receipts; actions PAUSE/STOP/RETRY/CHANGE_MODEL/APPROVE/DENY | MUST | CORE-06 | State transitions validated; illegal transitions rejected | unit | NOT_STARTED |
| CORE-13 | FuryReplay: task record, fork with different runtime/model | MUST | CORE-01,03 | Replay record digest stable; fork preserves inputs and changes only the declared axis | unit | NOT_STARTED |
| UX-01 | FuryPipe Studio shell: Chat/Cowork/Code/Agents/Automations + secondary nav; dashboard under Settings › Advanced › Control Plane | MUST | CORE-04,05 | Served by the runtime; keyboard navigable; no console errors; Chromium/Firefox/WebKit QA | browser QA + a11y | NOT_STARTED |
| UX-02 | Chat: conversations, model/provider/runtime/local-cloud indicators, model switch, retry with another model | MUST | UX-01,CORE-05 | Indicators always visible; switch recorded in replay | browser QA | NOT_STARTED |
| UX-03 | Cowork: file/folder tasks with READ/WRITE/EXECUTE/NETWORK/EXTERNAL_ACTION permissions and ALLOW/ASK/DENY | MUST | UX-01,CORE-06 | Denied capability never executes; ASK surfaces an approval | browser QA + unit | NOT_STARTED |
| UX-04 | Code: repo explorer, diff, tests, worktrees, agents | MUST | UX-01,CORE-07 | Diff and test receipts visible per worktree | browser QA | NOT_STARTED |
| UX-05 | Agents / Mission Control view | MUST | UX-01,CORE-12 | Live state from the runtime API | browser QA | NOT_STARTED |
| UX-06 | Automations / FuryFlow builder with deterministic vs agentic zones | MUST | UX-01 | Flow validates as a DAG; zones rendered | browser QA + unit | NOT_STARTED |
| PLAT-01 | Skills Hub (discovery across .furypipe/.claude/.agents/.opencode skills, metadata, enable/disable/pin) | MUST | – | Existing skill-registry reused; discovery bounded and symlink-safe | unit | PARTIAL (agent-skills-standard, skill-registry exist) |
| PLAT-02 | MCP Hub (installed/local/remote, health, permissions) | MUST | – | Existing MCP Direct reused | unit | PARTIAL (MCP Direct exists) |
| PLAT-03 | Memory (scopes, why-retrieved, source, age, confidence) | MUST | – | Existing Memory VNext reused | unit | PARTIAL (memory-vnext exists) |
| PLAT-04 | Knowledge/RAG (ingestion, chunking, hybrid retrieval, citations) | MUST | – | Existing knowledge index extended | unit | PARTIAL (knowledge index exists) |
| PLAT-05 | FuryWeb (search/fetch/extract/crawl/browser split, adapter-first) | MUST | – | Fetch never launches a browser; SSRF defenses | unit | PARTIAL (browser-runtime exists) |
| PLAT-06 | Integration Fabric registry (MCP/OpenAPI/webhooks) | MUST | PLAT-02 | Registry entries carry auth, permissions, trust | unit | NOT_STARTED |
| QA-01 | Security regressions for new boundaries (SSRF, path traversal, symlink, injection, authority escalation, oversized payloads) | MUST | all CORE | Each new boundary has a negative test | unit | NOT_STARTED |
| QA-02 | Installed-package smoke covers new runtime surfaces | MUST | UX-01 | npm pack → install → CLI → Studio route | package smoke | NOT_STARTED |
| QA-03 | Cross-OS CI 9/9 green on exact head; package reproducible | MUST | all | Hosted checks | CI | INHERITED PASS at 69e2832 |
| QA-04 | FuryBench cases for dispatcher, context compiler, local inference fit | MUST | CORE-06,11,05 | Paired A/B, same fixtures, budget matched | FuryBench | NOT_STARTED |
| SHOULD-01 | Voice/realtime adapter (LiveKit-style) reusing model fabric and permissions | SHOULD | – | Disabled by default; no kernel impact | unit | PARTIAL (media-realtime-voice exists) |
| SHOULD-02 | Marketplace with signed metadata | SHOULD | PLAT-01,02 | Unsigned component shown as untrusted | unit | NOT_STARTED |
| SHOULD-03 | Multichannel continuation without permission widening | SHOULD | – | Channel never widens scopes | unit | PARTIAL (gateway channels) |
| OPT-01 | FuryTeleport, FuryMultiverse, Shadow Twin, Epistemic Graph, Outcome Loop, Self-Science, Agent Market, Compute Mesh, Failure Genome | OPTIONAL (FRONTIER_BET) | CORE | Each needs its own benchmark before any claim | – | NOT_STARTED |
| OOS-01 | Merge, tag, release, publish, deploy, paid provider calls, real external credentials | OUT OF SCOPE without explicit operator authorization | – | Never executed by this track | – | N/A |
