# FuryLocal model fabric and Harness Hub

Code: `src/fury-local-fabric.ts`, `src/fury-harness-hub.ts` · tests: `tests/fury-local-fabric.test.ts`, `tests/fury-harness-hub.test.ts`

## Local inference discovery

Default endpoints (loopback): Ollama `:11434` (native `/api/tags`, `/api/version`; OpenAI-compatible; Anthropic-compatible from 0.14), LM Studio `:1234` (native `/api/v0/models` with modality, context, quantization, loaded state), llama.cpp `:8080`, vLLM `:8000`, SGLang `:30000`, Jan `:1337` (OpenAI-compatible `/v1/models`). Configured `openai-compatible` and `anthropic-compatible` endpoints are also supported.

Boundary: loopback only by default. LAN only when explicitly allowed, and only private IP literals (RFC 1918, CGNAT, ULA/link-local IPv6); DNS names, public IPs and metadata addresses are refused. GET only, redirects never followed, 1 MiB body cap, timeouts.

Hardware (`discoverFuryHardware`): CPU, RAM, unified memory (Apple silicon) and NVIDIA GPUs via `nvidia-smi` (no shell, 3 s timeout). It stays in-process.

Fit (`classifyFuryModelFit`): FITS if weights × 1.2 fit in 80 % of the fastest memory pool; MAY_BE_SLOW if they fit in 90 % of RAM + VRAM; DOES_NOT_FIT otherwise; UNKNOWN when the size is not reported. This is a heuristic, labelled as such.

Measurement (`measureFuryLocalModel`): streams one short completion from a local endpoint and reports TTFT and streamed chunks/s. Chunks are not claimed to be exact tokens.

## Harness Hub

The registry covers FuryPipe Native, Claude Code, Codex, Gemini CLI, OpenCode, OpenClaw, OpenHands, Goose and Kilo. Each entry records its integration path (ACP/official protocol > official SDK/API > A2A > structured CLI > PTY, per master §15), its protocols, its skills directories, and how it reaches a local model (e.g. Claude Code via an Anthropic-compatible base URL, Codex via `--oss`). Each entry also carries an evidence level and source.

Discovery resolves executables on absolute PATH entries only and runs `--version` with a timeout, no shell and a minimal environment; provider keys are not forwarded. Windows `.cmd` shims go through the hardened FuryLink `cmd.exe` boundary. Authentication is never probed.
