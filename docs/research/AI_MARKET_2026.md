# AI market scan 2026 — interoperability facts that shape FuryPipe

Time-boxed scan (2026-09-25). Every row states how it was verified:

- **OFFICIAL FACT (checked 2026-09-25)** — confirmed against official docs or
  the tool itself during this session.
- **COMMUNITY (checked 2026-09-25)** — confirmed only by third-party guides.
- **PRIOR KNOWLEDGE (not re-verified)** — from earlier research in this
  repository (`docs/research/ECOSYSTEM_2026.md`,
  `docs/FURYPIPE_VNEXT_COMPETITIVE_DECISION_MATRIX_2026.md`) and must be
  re-checked before it drives a product claim.

github.com web pages and docs.google.com are blocked by this session's egress
proxy; PyPI and web search are reachable.

## Facts that change the architecture

| # | Fact | Level | Source | Consequence for FuryPipe |
|---|---|---|---|---|
| 1 | Ollama exposes an Anthropic-compatible Messages API on `localhost:11434` (since v0.14.0, Jan 2026); Claude Code can target it with `ANTHROPIC_BASE_URL` + a placeholder `ANTHROPIC_AUTH_TOKEN`. LM Studio and llama.cpp also expose Anthropic-compatible endpoints; streaming/tool-calling edge cases are still being patched. | OFFICIAL FACT | [Ollama docs — Claude Code](https://docs.ollama.com/integrations/claude-code), [Ollama blog](https://ollama.com/blog/claude) | Harness and model are independent: "Claude Code + local model" is a real, configurable combination. FuryPipe must model harness × provider × model separately and record the protocol (anthropic-messages vs openai-chat) per endpoint. |
| 2 | Codex CLI runs local models with `--oss` and `--local-provider ollama|lmstudio` (Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`). | COMMUNITY (multiple consistent guides) | [ynaito.dev](https://ynaito.dev/en/writing/codex-cli-local-models-oss/), [simplified.guide](https://www.simplified.guide/codex/local-models-use) | Same: "Codex + local OSS model" is a first-class harness binding. Local-backend discovery must report the OpenAI-compatible base URL each harness expects. |
| 3 | LM Studio serves OpenAI-compatible `/v1/models`, `/v1/chat/completions`, `/v1/completions`, an Anthropic-compatible surface, and its own REST API (`/api/v0/*`) with loaded/unloaded state, max context, quantization, TTFT and tokens/s. | OFFICIAL FACT | [LM Studio REST API](https://lmstudio.ai/docs/developer/rest/endpoints), [LM Studio server](https://lmstudio.ai/docs/developer/core/server) | Local probe: prefer the backend's native metadata endpoint when present, fall back to OpenAI-compatible `/v1/models`. |
| 4 | OpenClaw ships an ACP bridge (ACP over stdio for IDEs, forwarded to its Gateway over WebSocket); active 2026 releases (2026.9.5/9.6). | OFFICIAL FACT | [OpenClaw ACP](https://docs.openclaw.ai/cli/acp), [v2026.9.5](https://docs.openclaw.ai/releases/2026.9.5) | ACP is the preferred integration path for OpenClaw; FuryPipe already has an ACP v1 client/server to reuse. |
| 5 | Graphify (PyPI `graphifyy`, CLI `graphify`) builds a local tree-sitter code graph with no LLM (`graphify update`), outputs `graphify-out/graph.json` (`nodes`, `links` with `relation` and `confidence` EXTRACTED/INFERRED), `manifest.json`, and after clustering `GRAPH_REPORT.md` and `graph.html`; CLI also offers `query`, `path`, `explain`, `affected`, `god-nodes`. | OFFICIAL FACT (installed 0.9.67 and run on this repo) | PyPI `graphifyy` README; local run | FuryGraph Graphify provider reads these files; `affected` maps to blast radius. |

## Categories and representative products

Level for all rows below: PRIOR KNOWLEDGE unless noted. Capability details
live in `COMPETITOR_CAPABILITY_MATRIX_2026.md`.

| Category | Products |
|---|---|
| Assistant workspaces | Claude (incl. Cowork), ChatGPT, Gemini, Open WebUI, LibreChat, AnythingLLM, Jan |
| Coding harnesses | Claude Code, Codex, Gemini CLI, OpenCode, Kilo, Cline, Roo Code, Aider, Goose, Continue, Factory Droid, Cursor, Windsurf, Zed Agent, Antigravity |
| Agent runtimes | OpenClaw (fact 4), ZeroClaw, PicoClaw, Hermes Agent, OpenHands, DeerFlow, SWE-agent |
| Orchestration | LangGraph, CrewAI, Microsoft Agent Framework, AutoGen, smolagents, Vibe Kanban, OpenHands canvas |
| Workflow automation | n8n, Dify, CrewAI Flows |
| Voice / realtime | LiveKit Agents, OpenAI Realtime, Gemini Live |
| Web intelligence | Firecrawl, Playwright, browser-use style agents |
| Local inference | Ollama (fact 1), LM Studio (fact 3), llama.cpp, vLLM, SGLang, LocalAI, MLX, TGI, LiteLLM |
| Protocols | MCP, ACP, A2A |

Accomplish Coworker: listed for history only; its repository was reported
unsupported by the operator and was not re-checked here.
