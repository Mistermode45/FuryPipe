# FuryPipe CLI

The documented public binary is **`furypipe`**.

The package is published on npm as `furypipe`.

## Install

```bash
npm install --global furypipe
furypipe doctor
```

Or run it without a global install:

```bash
npx furypipe doctor
```

## Commands

```text
furypipe setup [--lang=fr|en] [--plain] [--no-color] [--yes]
furypipe start
furypipe doctor [--json] [--locale=<BCP-47>]
furypipe stats [--json] [--file <path>]
furypipe export [...]
furypipe gateway config [--json]
furypipe gateway start [--json]
furypipe link [--route PATTERN=TARGET]... [--] <agent> [args...]
```

Use `furypipe --help` and command-specific help as the runtime source of truth for options available in the installed version.

## Setup

`furypipe setup` launches the FuryPipe first-run terminal experience.

The rich TUI is dependency-free and uses the terminal directly. It presents the FuryPipe Control Plane identity, a horizontal runtime-domain rail, bilingual language selection, keyboard navigation and a completion screen.

```bash
furypipe setup
furypipe setup --lang=fr
furypipe setup --lang=en --yes
```

Interactive controls:

```text
← / → or ↑ / ↓   select language
1 / F             Français
2 / E             English
Enter             confirm
Esc / Q           cancel
```

Options:

```text
--lang=fr|en   preselect a language
-y, --yes      apply without interaction
--plain        force the text fallback
--no-color     disable ANSI colors
-h, --help     show setup help
```

In CI, pipes, non-TTY sessions, or `TERM=dumb`, FuryPipe automatically uses the plain-text fallback instead of attempting a full-screen TUI.

Setup writes only FuryPipe-owned preference metadata to the configured JSON file and preserves unrelated existing keys. An invalid existing config is never overwritten.

The setup command is explicit by design: installing an npm package must not unexpectedly block on an interactive lifecycle script. After installation, run `furypipe setup` when you want the guided experience.

## Start

`furypipe start` starts the Node runtime.

The default deployment is loopback-oriented. Non-loopback exposure requires an explicit operator security boundary; see [../SECURITY.md](../SECURITY.md).

## Gateway and local WebChat

`furypipe gateway start` starts the dedicated VNext local Gateway. It is separate from the historical FuryPipe proxy listener and remains loopback-only in this phase.

Default local endpoints:

```text
Gateway origin:  http://127.0.0.1:48722
WebChat:         http://127.0.0.1:48722/gateway/webchat/
WebSocket:       ws://127.0.0.1:48722/gateway/v1
```

The start command prints one short-lived, one-time browser bootstrap code. Open the printed WebChat URL and enter that code in the local page. The browser submits it with a JSON `POST` to `/gateway/local-bootstrap/v1`; the code is never placed in a query string, fragment, WebSocket protocol, or cookie.

On successful redemption, the Gateway returns an `HttpOnly`, `SameSite=Strict` cookie scoped to `/gateway/`. The cookie authenticates the local browser session only. It is not a command scope, provider permit, tool permit, MCP permit, or execution authority.

The WebChat assets are served by the same loopback Gateway and use a restrictive Content Security Policy with self-hosted scripts/styles only. The browser talks to the Fury Kernel through registered conversation commands and narrow `conversations.inspect` / `conversations.write` session scopes.

In the current Phase 2A local WebChat:

- conversation state is process-local and bounded;
- reconnect performs bounded conversation resynchronization;
- transcripts are not persisted in browser storage;
- message submission is displayed as accepted only after a Kernel state receipt;
- provider inference is not implied by conversation acceptance;
- tool eligibility/execution/evidence remain distinct lifecycle states.

Provider inference is **disabled by default**. To enable the local model bridge, configure one exact route:

```text
FURYPIPE_WEBCHAT_PROVIDER=openai|anthropic|google
FURYPIPE_WEBCHAT_MODEL=<exact model id>
FURYPIPE_WEBCHAT_MAX_OUTPUT_TOKENS=<optional 1..65536>

OPENAI_API_KEY=<credential>       # when provider=openai
ANTHROPIC_API_KEY=<credential>    # when provider=anthropic
GOOGLE_API_KEY=<credential>       # when provider=google
```

Partial configuration fails startup instead of silently falling back. Credentials are resolved inside the provider transport and are not returned by the WebChat configuration endpoint or CLI model status.

When enabled, the browser receives the `capability.provider-inference` session scope and may submit only the registered `conversation.model.execute` command with declared `provider-inference` permission. Command admission still has `executionAuthority:false`; the Fury Kernel model bridge rebuilds the provider attempt from a model-neutral BASE prompt, creates a fresh provider execution policy/permit, runs the existing governed provider executor, decodes only bounded text responses, and only then completes the Kernel turn.

A provider tool/function call is not converted into assistant text. It is rejected by the Phase 2A.4 text decoder and remains reserved for the separately governed tool bridge in Phase 2A.5.

`furypipe gateway config --json` reports the resolved loopback Gateway configuration without starting the daemon. `furypipe gateway start --json` includes `websocketUrl`, `webChatUrl`, the exact local origin, redacted model status and the one-time bootstrap object for machine-oriented launchers.

Remote Gateway/WebChat exposure is out of scope for this phase and must not be created by binding this listener to a non-loopback address.

### Optional local model inference

Model inference in WebChat is **off by default**. To enable it, configure one explicit provider/model pair in the host environment before `furypipe gateway start`:

```text
FURYPIPE_WEBCHAT_PROVIDER=openai|anthropic|google
FURYPIPE_WEBCHAT_MODEL=<exact provider model id>
FURYPIPE_WEBCHAT_MAX_OUTPUT_TOKENS=<optional positive integer; default 4096>
```

The matching credential must also exist:

```text
openai     -> OPENAI_API_KEY
anthropic  -> ANTHROPIC_API_KEY
google     -> GOOGLE_API_KEY
```

Partial configuration fails closed. FuryPipe does not infer a provider, model, credential, endpoint or cross-provider fallback from browser input. The WebChat configuration endpoint exposes only whether the bridge is enabled plus the configured provider/model; credentials, permits and raw provider responses are never returned there.

When enabled, user-message acceptance and provider inference remain distinct operations. `conversation.model.execute` requires the dedicated `capability.provider-inference` session scope and declared `provider-inference` permission. Provider output is treated as unverified application data until separate evidence verification says otherwise.

### Optional governed MCP tools

WebChat MCP tools are also **off by default**. Enable them with a separate strict host-owned configuration file:

```text
FURYPIPE_WEBCHAT_MCP_CONFIG=/absolute/path/to/webchat-mcp.json
```

The file uses `furypipe-gateway-local-tool-config/v1`. Raw MCP application results are **not browser-visible by default**; `allowDisplayResult` must be explicitly set to `true` if the operator wants bounded JSON results rendered in the local WebChat.

Example stdio source:

```json
{
  "format": "furypipe-gateway-local-tool-config/v1",
  "allowDisplayResult": false,
  "sources": [
    {
      "sourceId": "local-tools",
      "transport": "stdio",
      "trust": "trusted",
      "command": "node",
      "args": ["/absolute/path/to/mcp-server.mjs"],
      "principalId": "local-tools-service",
      "env": {
        "SERVICE_TOKEN": "FURYPIPE_LOCAL_TOOLS_TOKEN"
      },
      "policy": {
        "governedReadTools": ["search"],
        "operatorApprovalTools": ["create-item"]
      }
    }
  ]
}
```

The values inside `env` are **host environment variable names**, not credentials. In the example above, FuryPipe resolves the value of `FURYPIPE_LOCAL_TOOLS_TOKEN` process-locally and passes it to the MCP process as `SERVICE_TOKEN`. The secret value is not copied into WebChat configuration, lifecycle summaries or Gateway results.

Example Streamable HTTP source:

```json
{
  "format": "furypipe-gateway-local-tool-config/v1",
  "sources": [
    {
      "sourceId": "remote-tools",
      "transport": "streamable_http",
      "trust": "untrusted",
      "url": "https://mcp.example.com/v1",
      "allowedHosts": ["mcp.example.com"],
      "principalId": "remote-tools-service",
      "headers": {
        "Authorization": "FURYPIPE_REMOTE_MCP_AUTH"
      },
      "policy": {
        "governedReadTools": [],
        "operatorApprovalTools": ["search"]
      }
    }
  ]
}
```

Header values are likewise environment-variable references. For example, `FURYPIPE_REMOTE_MCP_AUTH` may contain the complete runtime Authorization value.

The two policy lists are exact allowlists and must not overlap. `governedReadTools` does not bypass MCP Direct risk classification: automatic governed approval is still restricted to tools that FuryPipe independently proves are trusted, read-only and closed-world. Other permitted tools require an explicit local operator approval action.

WebChat preserves the tool lifecycle instead of collapsing it:

```text
configured
!= connected
!= healthy
!= listed
!= selected
!= proposed
!= approved
!= permitted
!= executed
!= succeeded
!= verified
```

The browser can inspect sanitized source metadata, request a fresh inventory, create a proposal, explicitly approve an operator-gated proposal and request execution. It never receives the process-local MCP lifecycle, operator intent or execution permit objects that carry authority. Tool output is shown only in the Tools panel and is never inserted automatically into the assistant transcript.

## Doctor

`furypipe doctor` inspects runtime configuration without intentionally reading or printing provider credentials. It reports the effective model-scope mode/source and visual policy. In automatic mode the diagnostic leaves `effectiveModels` empty because Model Fabric discovery is dynamic rather than a static catalog.

Upstream URLs are normalized before display so userinfo, query strings and fragments are not exposed in the report.

Missing tools are reported as unavailable. `doctor` does not automatically install third-party tooling.

Model scope diagnostics use this precedence: dashboard runtime override, then
an explicit non-empty `FURYPIPE_MODELS` environment value, then persisted
config, then automatic Model Fabric discovery. An empty or whitespace-only
`FURYPIPE_MODELS` value is treated as absent, so a persisted `off` or explicit
scope remains effective. `modelScopeMode` accepts `automatic`, `explicit`, or
`off`; legacy `models` arrays remain supported and are never silently
broadened when they contain a custom operator scope. A malformed persisted
mode/list is rejected fail-closed as `off`, rather than being promoted to
automatic discovery. `off` is a fail-closed visual-transformation kill switch.

The protected dashboard mutation validates the complete mode/list payload
before changing the visual policy or writing the model scope. `automatic` and
`off` reject contradictory model lists; `explicit` requires a non-empty list.
Operator scopes are bounded to 64 entries, with a maximum of 160 characters
per model entry and no control characters. Oversized or malformed environment,
config, or dashboard scope input fails closed as `off` rather than being
truncated or broadened.

Human-readable output supports locale selection, including:

```text
--locale=fr
--locale=en
--locale=<BCP-47 value resolved to a supported catalog>
```

The `--json` contract remains machine-oriented and is not localized.

## Stats

`furypipe stats` reads the configured event log and produces an offline summary without requiring the dashboard to remain open.

Treat event logs as potentially sensitive operational data.

## Export

`furypipe export` can prepare context artifacts without starting the proxy.

Examples:

```bash
furypipe export --stdin < prompt.txt
furypipe export --git
```

Depending on the input and runtime path, exports can include context pages, factsheets and prompt artifacts.

## Visual Engine

The Visual Engine is FuryPipe's guarded context-optimization layer. It keeps text native when visual transformation is not profitable or would violate exactness/provider limits, and otherwise uses provider-priced geometry planning plus deterministic lossless rendering.

See [VISUAL_ENGINE.md](VISUAL_ENGINE.md) for the pipeline, fidelity constraints and release-blocking invariants.

## FuryLink

`furypipe link <agent> [args...]` connects a child CLI to the already-running local FuryPipe runtime without requiring a permanent base-URL edit. The explicit separator form (`furypipe link -- <agent>`) is also accepted, but it is optional so Windows PowerShell and cmd.exe are first-class launch environments.

Examples:

```bash
furypipe link claude
furypipe link codex
furypipe link cursor-agent
furypipe link --route '127.0.0.1:9090/v1/*=http://127.0.0.1:48721' codex
```

FuryLink does not grant permissions, credentials or capabilities that the target process did not already have through the configured host environment. The local FuryPipe runtime remains the transformation, tracking and dashboard authority.

## Runtime identity

FuryPipe exposes a single CLI identity:

```text
furypipe
```

Runtime configuration is FuryPipe-native only. Public environment variables use the `FURYPIPE_*` prefix; no legacy runtime environment fallback is consulted.

The Node runtime listens on loopback by default:

```text
FURYPIPE_HOST=127.0.0.1
FURYPIPE_PORT=48721
```

If the selected listener port is already occupied, `furypipe start` fails closed with a FuryPipe-owned diagnostic and instructs the operator to select a free `FURYPIPE_PORT`; it does not reuse or attach to the process that already owns the port.

`furypipe setup`, `furypipe doctor`, `furypipe export` and `furypipe stats` are offline commands and do not bind the runtime port.

## Distribution and release status

Current public package: the version published under the npm `latest` dist-tag.

Current GitHub release: the latest non-draft release in `Mistermode45/FuryPipe`.

Do not infer either state from source metadata alone; publication and release status require registry/GitHub evidence.

Package publication, GitHub release and production deployment are distinct lifecycle states.

The release pipeline includes CI/security/supply-chain/provenance gates, but a green gate must not be used as evidence for an unrelated capability or external integration.

See [RELEASE_SECURITY.md](RELEASE_SECURITY.md).
