# FuryPipe Skill Registry

## Status

`LOCAL_REGISTRY_IMPLEMENTED_NO_THIRD_PARTY_SKILL_VENDORED`

The V5 skill registry is an execution gate around host-provided `AgentSkillDefinition` callbacks. It does not download, copy or execute skills from the internet.

## Categories

The registry defines 26 bounded categories:

`repository`, `debugging`, `security`, `architecture`, `testing`, `documentation`, `frontend`, `design`, `content`, `marketing`, `seo`, `accessibility`, `performance`, `analytics`, `data`, `automation`, `business`, `sales`, `operations`, `finance`, `minecraft`, `modding`, `game-server`, `research`, `context`, `learning`.

Categories are metadata for routing/inspection, not authorization.

## Registration contract

Every registration binds:

- stable skill ID;
- pinned semantic version;
- Agent Fabric stages;
- read or scoped-write permission from the Agent Runtime definition;
- disabled/required network posture;
- priority;
- health policy;
- source kind;
- source decision;
- repository + commit SHA when external;
- license status and optional SPDX ID.

The metadata ID must exactly match the executable definition ID.

## Provenance and execution

External sources are never executable from URL alone.

`external-reference` and `vendored` sources require a credential-free HTTPS repository and a pinned lowercase 40-character commit SHA. An external skill is eligible only when its source decision is executable (`ADOPT`, `ADAPT` or `WRAP`) and its license status is `VERIFIED`.

`REFERENCE_ONLY` and `REJECT` can stay visible in inspection output but are never returned as executable definitions.

FuryPipe currently vendors **zero** third-party skills.

## Health and priority

`resolveForStage()` evaluates matching skills in descending priority order with a stable ID tie-breaker.

The registry keeps the following states visible:

- unhealthy -> blocked;
- required health with no health evidence -> blocked;
- external provenance not verified -> blocked;
- ambient network required -> blocked by the current local Agent Runtime policy;
- reference-only/rejected -> blocked;
- healthy/degraded, provenance-safe and local-network-safe -> eligible.

The Agent Runtime still re-applies its own permission, network, health and budget gates when an eligible definition is invoked. The registry is not a bypass.

## Security

`inspect()` is metadata-only. It does not serialize executor callbacks, health callback bodies, evidence output, credentials or arbitrary source file contents.

Third-party skill acquisition, scanning and licensing remain a separate maintainer operation. Adding an entry to the registry does not itself vendor code.


## Execution evidence

The registry decides eligibility; it does not claim execution.

Capability Router may select an eligible Skill and schedule it for an Agent Fabric stage. Agent Runtime is the authority that invokes the actual callback. After a successful callback it emits a plaintext-free `AgentCapabilityExecutionReceipt` containing the Skill ID, stage, automatic/manual origin, token count and evidence digest.

A registered or selected Skill that never runs has no execution receipt. This is intentional:

`registered != selected != executable != executed != verified`.

`runPreparedFuryTask()` is the end-to-end orchestrator bridge that forwards the exact prepared Skill schedule into Agent Runtime without turning planning into execution.
