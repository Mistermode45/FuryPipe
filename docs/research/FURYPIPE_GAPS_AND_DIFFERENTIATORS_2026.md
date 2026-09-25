# FuryPipe gaps and differentiators 2026

Classification per mission §95: EXISTING_MARKET_FEATURE, MARKET_GAP,
FRONTIER_BET, FURY_DIFFERENTIATOR. A FRONTIER_BET is never presented as a
proven advantage; a differentiator needs a FuryBench result before any
"better/faster/cheaper" wording.

## What FuryPipe already has (foundation 0.16.0 RC)

Governed provider execution with receipts and an audit ledger, MCP Direct with
policy/approval/durable replay, ACP v1 client+server, A2A remote adapter,
loopback Gateway with device/principal/session authorization, WebChat,
automations (cron, webhooks, run ledger), channels, Continuous Memory and
Memory VNext, knowledge index, code graph, coding runtime with worktree and
process receipts, browser runtime, dashboard/Control Plane, Web Studio,
FuryBench, cross-OS reproducible package.

## Gaps against the 2026 target

| # | Gap | Classification | Why it matters |
|---|---|---|---|
| G1 | No product shell: the home surface is a technical dashboard, not Chat/Cowork/Code/Agents/Automations. | EXISTING_MARKET_FEATURE (missing) | First-run value; mission §12. |
| G2 | Harness, provider and model are not modelled as independent axes; no discovery of installed harnesses. | MARKET_GAP | Facts 1–2 in `AI_MARKET_2026.md` prove the combinations exist but every tool configures them privately. |
| G3 | No local inference discovery (Ollama, LM Studio, llama.cpp, vLLM…) with measured fit. | EXISTING_MARKET_FEATURE (missing) | Private mode and cost. |
| G4 | No cross-harness dispatcher that can also decide *not* to dispatch. | FURY_DIFFERENTIATOR (to prove) | Market dispatch is manual or single-vendor. |
| G5 | Agent claims are not separated from verified evidence at the system level (CLAIMED vs VERIFIED). | FURY_DIFFERENTIATOR (to prove) | Receipts exist per subsystem but there is no judge over them. |
| G6 | No universal task representation (intent contract + DAG + evidence contract). | FRONTIER_BET → needed as MUST core for G4 | Compiles one task to several harnesses. |
| G7 | Code graph not wired to planning/blast radius; Graphify not integrated. | MARKET_GAP | Parallel writers need coupling data. |
| G8 | Context is assembled per subsystem; no task-scoped capsule with reasons and digests. | FRONTIER_BET | Token cost and MUST-constraint preservation. |
| G9 | Visual workflow builder with deterministic vs agentic zones. | EXISTING_MARKET_FEATURE (missing) | Automations exist without a builder. |
| G10 | Replay/fork of a whole task across harnesses. | FRONTIER_BET | Time-machine comparisons. |
