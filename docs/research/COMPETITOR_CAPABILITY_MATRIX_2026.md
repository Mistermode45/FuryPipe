# Competitor capability matrix 2026

Scope: capabilities that decide FuryPipe's design. Verification level per the
legend in `AI_MARKET_2026.md`. "✓" = supported as of the level shown, "~" =
partial or via third-party, "–" = not a product goal, "?" = not verified.

| Product | Category | Level | Local models | Multi-agent | Skills | MCP | Memory | Workflows | Protocols | What to learn | What not to copy |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code | coding harness | OFFICIAL FACT (local via Ollama) / PRIOR | ✓ via Anthropic-compatible base URL | ✓ subagents | ✓ `.claude/skills` | ✓ | ~ project memory files | ~ hooks | MCP | skills-as-files, hooks, permission modes | single-vendor routing as default |
| Codex CLI | coding harness | COMMUNITY (`--oss`) / PRIOR | ✓ `--oss` Ollama/LM Studio | ~ | ✓ `.agents/skills` | ✓ | ~ | – | MCP | OSS provider switch per run | – |
| Gemini CLI | coding harness | PRIOR | ? | ~ | ~ | ✓ | ~ | – | MCP | – | – |
| OpenCode | coding harness | PRIOR | ✓ many providers | ~ | ✓ `.opencode/skills` | ✓ | ~ | – | MCP, ACP | provider-agnostic harness | – |
| OpenClaw | agent runtime | OFFICIAL FACT (ACP) | ✓ | ✓ specialist teams | ✓ | ✓ | ✓ | ✓ tasks ledger | ACP, gateway WS | gateway + channels + ACP bridge | broad ambient authority by default |
| OpenHands | agent runtime | PRIOR | ✓ | ✓ | ~ | ✓ | ~ | ~ | – | sandboxed execution | – |
| Goose | agent runtime | PRIOR | ✓ | ~ | ✓ recipes | ✓ | ~ | ~ | MCP | recipes | – |
| Open WebUI / LibreChat / AnythingLLM / Jan | workspaces | PRIOR | ✓ | ~ | ~ | ~ | ✓ | ~ | OpenAI-compat | model picker UX, RAG UX | admin-dashboard-as-home |
| Dify / n8n | workflow builders | PRIOR | ✓ / ~ | ~ | – | ✓ / ~ | ~ | ✓ visual DAG | OpenAPI, webhooks | deterministic vs LLM nodes, integration breadth via connectors | 1 500 connectors in the kernel |
| CrewAI / LangGraph / MS Agent Framework | orchestration libs | PRIOR | ✓ | ✓ | – | ✓ | ✓ | ✓ durable graphs | A2A (some) | durable checkpoints, typed state | framework lock-in |
| LiveKit Agents | voice | PRIOR | ~ | ~ | – | ~ | – | – | WebRTC, SIP | turn detection, barge-in | – |
| Firecrawl | web | PRIOR | – | – | – | ✓ | – | – | REST, MCP | search/scrape/crawl/map split | – |
| Graphify | code graph | OFFICIAL FACT | ✓ (no LLM for code) | – | ✓ as skill | – | ~ | – | CLI | confidence-tagged edges, `affected` | making it the only graph backend |

Known limitations common to the market (PRIOR, to validate with FuryBench):
dispatch across different harnesses is manual; agent "tests pass" claims are
rarely backed by machine-checked receipts; harness × model choices are hidden
in per-tool config; local-model fit is guessed rather than measured.
