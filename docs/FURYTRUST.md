# FuryTrust V1

## Status and trust boundary

`STATIC_ANALYSIS_FOUNDATION`

FuryTrust evaluates normalized candidate metadata plus bounded text explicitly
supplied by the caller. It never retrieves upstream code, installs a package,
starts an MCP/CLI, loads a binary, opens a network connection or performs a
runtime health check. Its output is not a sandbox, malware verdict or execution
authorization.

Every report states:

```text
runtimeVerified = false
executionAuthorized = false
evidenceCoverage = CALLER_SUPPLIED_TEXT_ONLY | NO_SOURCE_TEXT_SUPPLIED
```

Even `TRUSTED` means only that the V1 metadata/static policy and a separate
operator approval met its conditions. Runtime behavior remains unverified.

## Inputs and bounded scanner

`evaluateFuryTrust(candidate, evidenceFiles, operatorReview?)` normalizes the
candidate before policy evaluation. Evidence is a list of relative-path labels
and caller-supplied UTF-8 text, limited to 128 files, 64 KiB per file and 512
KiB total. Path traversal, absolute paths, duplicate paths and control
characters are rejected. Text is scanned in memory; reports retain only rule
codes, severities, counts and sanitized path labels, never source snippets.

The deterministic pattern checks include:

- credential-like literal formats and private-key markers;
- remote download piped directly to a shell;
- credential-access plus outbound-network indicators;
- prompt-override instructions;
- dynamic code execution and selected obfuscation patterns;
- external instruction fetch and suspicious temporary-file download patterns;
- unbounded shell/command interpolation patterns.

These deliberately small heuristics can both miss threats and flag benign
examples. A clean result does not establish that all source files were supplied
or that the supplied text corresponds to the pinned source.

Policy also derives findings from declared permissions and metadata: unpinned
or mutable sources, unresolved/conflicting licenses, unknown provenance,
filesystem writes/deletes, arbitrary network/subprocess, credential access,
external writes, financial/deploy/database actions, and mutating or unscoped
MCP permission combinations.

## Verdicts

| Verdict | Meaning in V1 |
|---|---|
| `TRUSTED` | Complete pinned/reviewed source and license metadata, caller-supplied text scanned without high/critical patterns, first-party/official claim, and explicit operator `APPROVE`. Still not runtime-verified or executable. |
| `AUDITED` | Sufficient static metadata and text were reviewed for this policy, but V1 has no operator trust grant or the provenance is not first-party/official. |
| `RESTRICTED` | Source pin, permission, license compatibility or operator policy requires scoped approval before any future integration. |
| `QUARANTINED` | Critical permission combination or high/critical static pattern requires isolation and review. |
| `BLOCKED` | An explicit caller-supplied operator review chose `BLOCK`. The module does not authenticate that reviewer. |
| `UNKNOWN` | Required evidence is absent, unresolved or internally inconsistent. Unknown is never promoted to trusted. |

The integration decision remains an independent field. For example, a source
may be `AUDITED` while its product decision remains `REFERENCE_ONLY`.

## Report and policy

Reports contain a policy version, verdict, bounded findings, a capped heuristic
`riskScore` (not a probability), `confidence`, required approvals, blocking
reason codes and evidence references. Approvals can include source-pin,
provenance, license, security, operator and runtime-sandbox review. A runtime
sandbox approval is always required by the report because no sandbox exists in
this track. The in-memory registry accepts only the original frozen report
object emitted by the policy evaluator; copying or hand-building a report does
not create a valid trust record. This is not a signature or persistence format.

`BLOCKED` requires an explicit `OperatorTrustReview` decision. `TRUSTED`
requires a pinned source, reviewed provenance, verified non-conflicting license,
caller-supplied source text, an `APPROVE` review and a first-party/official
classification. For `OFFICIAL`, V1 checks an HTTPS host-boundary relationship
and, for forge repositories, a matching repository-owner path; this rejects
owner-name matches on unrelated domains but cannot prove control of either
domain or the truth of the claim. Operator review is a data input, not
authenticated authorization.

`analyzeDeclaredCapabilityFlows()` accepts explicit ordered candidate-ID paths
and reports a potential credential-to-arbitrary-network path when permissions
allow it. The output sets `observedFlow: false`: it is a policy graph analysis,
not telemetry and not evidence that data moved.

## Secrets and privacy

Candidate fields do not model raw credentials. Secret names and requirements
belong in later connector contracts; credential values are never an allowed
manifest field. Obvious token/private-key patterns in candidate metadata are
rejected, while matching values in caller-supplied source text produce a
finding without retaining the value. This pattern filter is incomplete and is
not a substitute for a dedicated secret scanner.

The caller owns source text and decides what to submit. FuryTrust stores only
the resulting report in the in-memory registry. Evidence references and path
labels are bounded and checked for credential-like values.

## Limitations / not verified

V1 does not verify signatures, hashes against downloaded bytes, repository
ownership, official publisher identity, license-file contents, dependency
advisories, install hooks, runtime behavior, MCP tool schemas, service-side
permissions, maintenance history or benchmark claims. Static rules are not
proof of safety or maliciousness; a finding is a review signal.

No candidate can be auto-executed from a FuryTrust verdict. Capability Router,
Agent Runtime, npm/CLI installation, network clients, MCP execution, sandboxing
and deployment remain intentionally unwired.
