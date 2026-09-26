# FuryProof evidence model

Code: `src/fury-proof.ts` · tests: `tests/fury-proof.test.ts`

## States

| State | Meaning | Who can produce it |
|---|---|---|
| OBSERVED | Raw fact seen by a host tool (exit code, file digest, HTTP status) | host tools |
| DERIVED | Computed from observed facts | host code |
| CLAIMED | Statement made by an agent or harness ("tests pass") | anyone |
| VERIFIED | A claim backed by a host-signed receipt that agrees with it, with no signed receipt contradicting it | only the ledger/judge |

An agent can never turn CLAIMED into VERIFIED by itself.

## Receipts

Kinds: `TOOL_RECEIPT`, `AGENT_RECEIPT`, `PATCH_RECEIPT`, `TEST_RECEIPT`, `BROWSER_RECEIPT`, `MODEL_RECEIPT`, `INTEGRATION_RECEIPT`, `APPROVAL_RECEIPT`.

`createFuryProofLedger({ key })` issues receipts HMAC-SHA256-signed over their canonical JSON with a key held only by the host process. A receipt fabricated by an agent, signed with another key, or modified after issue fails `verify()` and is listed in `rejectedReceipts`. Details are limited to 16 KiB. `evidenceDigest` is the sha256 of the raw evidence kept elsewhere (log, diff, screenshot).

## FuryJudge

`ledger.judge({ requirements, receipts, claims, policyViolations })`:

| Condition (checked in order) | Verdict |
|---|---|
| any policy violation | REJECT |
| a MUST requirement has both passing and failing receipts | ESCALATE |
| a MUST requirement has a failing/error receipt | REWORK |
| no MUST requirement, or a MUST requirement lacks a verified passing receipt | UNPROVEN |
| otherwise | ACCEPT |

Each requirement declares an explicit evidence contract (`kind` + `subject`); a requirement without one is rejected. Unmet SHOULD requirements and contradicted claims are reported as risks.

## Proof bundle

`sealFuryProofBundle()` records the judgement, receipts, commands executed, files modified, uncertainty and output digest, with an order-independent sha256 `bundleDigest`.
