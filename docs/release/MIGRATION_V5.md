# FuryPipe V5 — migration notes

These notes describe the current V5 hardening branch. They are not a stable-release announcement.

## Runtime baseline

- production baseline: Node.js 24.21.0;
- CI compatibility: Node.js 22.23.2, 24.21.0 and 26.8.2 on Ubuntu, Windows and macOS;
- package engine floor remains defined by `package.json`.

## Exactness and Recovery

ExactGuard is part of the real transform path. Machine-sensitive values such as code, JSON/YAML, URLs, paths, IDs, hashes, signatures, commands, versions and protocol values must not be silently rewritten.

Recovery Store supports SHA-256 CAS, namespaces, quotas, TTL/GC, backup/restore, optional host-keyed AES-256-GCM, rekeying and inter-process locking. Operators using encryption must continue supplying the key ring from the host; keys are not embedded in manifests.

## Provider / Policy runtime

Provider runtime health and pricing are opt-in host evidence. FuryPipe does not probe providers or infer prices automatically.

- stale provider health becomes `unknown`;
- an explicitly unavailable provider reaches the policy layer as unavailable;
- pricing requires an exact provider/model entry;
- unknown prices remain `COST_UNKNOWN`.

The local Policy Runtime cache/retrieval/hybrid primitives do not claim to replace a provider-native prompt-cache contract.

## MCP

MCP stdio and the opt-in Node HTTP listener are available on the hardening branch. Production OAuth Authorization Server/verifier hosting and external multi-client/network conformance remain separate evidence requirements where applicable.

## Agent / Learning / FuryPrompt

Agent, FuryPrompt and Learning kernels are executable locally and persist selected metadata through Recovery where implemented. They do not imply a hosted model worker, distributed orchestrator, fine-tuning or external validation.

## Dashboard and i18n

The i18n core supports bounded BCP-47 resolution, FR/EN, RTL direction and QA pseudo-locales. Dashboard human-copy is wired through the primary shell and fragments while exact machine values remain outside translation. The dedicated cross-browser harness executes real Chromium, Firefox and WebKit against French LTR and `ar-XB` RTL at desktop/mobile reference widths and every declared CSS breakpoint boundary. Hosted evidence is source-bound to the exact candidate SHA; a local run is not promoted to GitHub CI evidence.

## Upgrade rule

Upgrade only from an artifact whose version/source is known. Keep a copy of the prior package artifact and its SHA-256 until the new version passes installation/runtime smoke in the target environment.

No automatic destructive migration should run merely because a new FuryPipe package is installed.
