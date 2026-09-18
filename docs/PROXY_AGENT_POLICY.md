# FuryPipe Proxy Agent Policy

## Status

`IMPLEMENTED_DRAFT`

The normal FuryPipe proxy can inject one bounded system-level policy into
supported provider request shapes. The Node host enables it by default;
embedders using `createProxy()` opt in explicitly.

The policy does **not** rewrite the user's prompt and does not post-process
provider responses. It steers two independent behaviors:

1. progressive, evidence-backed use of capabilities already available in the
   host;
2. compact natural-language output for the human, without touching
   machine-sensitive output.

## Why this lives in the proxy path

Capability Router, Task Orchestrator and Agent Runtime already have governed
planning/execution APIs, but a normal Claude Code/Codex/Gemini request through
the reverse proxy does not automatically call those APIs.

This policy is therefore a live-path bridge, not a claim that the full Agent
Runtime now owns every provider turn.

The lifecycle remains:

```text
recommended != available != connected != approved != selected
            != tool_use_requested != executed != verified
```

The policy explicitly tells the model not to collapse those states.

## Progressive disclosure

The capability instruction follows the Agent Skills design principle of keeping
discovery cheap:

```text
capability metadata
  -> relevance decision
  -> full Skill/tool/MCP detail only when needed
  -> real execution under host permission
  -> execution evidence
```

This prevents a large marketplace inventory from being copied wholesale into
every prompt.

Reference:
- Anthropic, "Equipping agents for the real world with Agent Skills"
  (2025-10-16; Agent Skills noted there as an open standard from 2025-12-18).

## MCP authority

The policy never turns MCP discovery into authority. Host permission and
approval remain authoritative.

Current 2026 MCP/client guidance reinforces the same design:
- expose/allow only tools that the agent may use;
- keep credentials outside generated model content and logs;
- require explicit approval where the host policy requires it;
- enforce authorization on the server/tool side rather than trusting the model.

References:
- Model Context Protocol specification / task and authorization guidance;
- OpenAI MCP connection/tool guidance (`allowed_tools`, required initialization,
  approvals, server-side authorization).

FuryPipe's existing plugin truth states and Agent Runtime receipts remain the
source of truth. This proxy policy does not auto-install or auto-connect any
plugin.

## Compact human output ("Caveman" behavior)

The output policy uses a native FuryPipe instruction. It is not copied from a
third-party runtime.

The useful principle is:

```text
keep reasoning/capability rich
keep human prose short
never compress machine/exact output
```

The policy applies only to natural-language prose addressed to the human.

It explicitly excludes:
- code;
- patches and diffs;
- shell commands;
- JSON/YAML/XML;
- schemas and structured-output contracts;
- tool/MCP calls and results;
- URLs and filesystem paths;
- IDs and hashes;
- citations and quoted text;
- literal/exact-response requests.

Exact/machine contracts outrank the style policy.

The public Caveman ecosystem is useful as design research because its own
documentation distinguishes shortening agent output from rewriting user input.
Its repository uses a split licence for different components; FuryPipe therefore
does not import or embed its engine/runtime code here.

## Provider placement

Policy injection occurs **after** Visual Engine transformation.

Reason: system governance/style instructions must stay native text and must not
become pixels inside a rendered context image.

Supported request shapes:
- Anthropic Messages;
- OpenAI Chat Completions;
- OpenAI Responses;
- Gemini `systemInstruction`.

For Anthropic structured system content, FuryPipe inserts the stable policy
before the final existing `cache_control` block so the policy can remain inside
the caller's existing cache prefix without creating a new cache breakpoint.

## Baseline accounting

The outgoing transformed body receives the policy after visual transformation.

Uncompressed count-token baselines use an otherwise identical body with the
same policy injected. Therefore the constant policy cost exists in both sides of
the comparison and cannot fabricate Visual Engine savings.

## Bypass

`x-furypipe-bypass: 1` remains byte-for-byte passthrough. The proxy agent
policy is not injected on a bypassed request.

## Telemetry

JSONL can record only bounded policy metadata:

- `agent_policy_applied`;
- `agent_policy_version`;
- `agent_policy_protocol`;
- `agent_policy_instruction_bytes`;
- bounded reason when application failed/skipped.

No user prompt or policy text is persisted in those fields.

## Runtime control

Node default:

```text
FURYPIPE_AGENT_POLICY=on
```

Emergency compatibility kill switch:

```text
FURYPIPE_AGENT_POLICY=off
```

The switch is intentionally separate from model scope and Visual Engine
eligibility.

## Next execution slice

This policy can cause an agent host to select and call relevant tools/MCP in its
normal agent loop, but FuryPipe must not claim execution merely because it
requested that behavior.

The next slice should add bounded observation/receipts for completed client-side
tool results and then connect host-authorized runtime MCP/Skill adapters where a
real executable adapter exists. Selection alone must never synthesize an
`executed` receipt.
