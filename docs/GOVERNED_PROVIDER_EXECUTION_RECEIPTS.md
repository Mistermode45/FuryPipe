# Governed Provider Execution Receipts

## Purpose

`createGovernedProviderExecutionReceipt()` creates a deterministic, plaintext-free audit record for one governed provider execution outcome.

The receipt binds the exact process-local FuryPipe request envelope, the exact process-local single-use execution permit, the structural execution outcome, transport/provider evidence state, and explicit usage/cost evidence when available.

It does not persist request prompt text, provider response bytes, provider request IDs, finish reasons, permit IDs, policy IDs, credentials, API keys, or provider pricing-source text.

## Boundary

~~~text
Context Runtime
  -> Request Envelope
  -> Provider Runtime eligibility
  -> Host execution policy
  -> Single-use Permit
  -> Governed Provider Executor
  -> execution result/error
  -> Governed Provider Execution Receipt
~~~

It does not execute a provider request itself.

## Process-local provenance

Receipt creation requires both:

~~~text
isGeneratedProviderRequestEnvelope(request) === true
isGeneratedProviderExecutionPermit(permit) === true
~~~

Shallow copies, JSON round-trips, and fabricated request/permit objects are rejected.

The receipt therefore records requestProvenance=process-local-verified and permitProvenance=process-local-verified.

The current executor result/error has no equivalent process-local marker, so V1 deliberately records outcomeProvenance=not-verified. Structural consistency is not upgraded into signed or persistent provenance.

## Request identity

The receipt stores only exact provider ID, model, workload ID, protocol, request digest, FuryPrompt digest, FuryPrompt source digest, and prompt byte count. The final prompt text is not copied.

## Authorization identity

Permit and policy identifiers are SHA-256 hashed before inclusion. The receipt stores permit ID digest, policy ID digest, permit issue time, and permit expiry time. These digests are not signatures or cross-process attestations.

## Success outcome

A success receipt requires an exact furypipe-governed-provider-execution-result/v1 matching the request scope and request digest.

It records transport invocation state, network status + evidence label, provider request status + evidence label, optional provider request ID digest, explicit token usage values when reported, optional response byte count + SHA-256, optional finish-reason digest, and cost state.

No provider response plaintext is stored.

## Provider evidence semantics

Provider/network evidence remains conservative:

~~~text
transport-reported
partially-transport-reported
not-reported
not-executed
~~~

A provider transport report is still a transport report. It is not renamed verified.

Missing network/provider fields remain unknown / not-reported.

## Error outcomes

A governed executor error is stored only as its stable error code and whether the transport callback had been invoked. The original thrown error text and any nested provider error body are not copied.

If the error happened before transport invocation, providerResult=not-executed. If the transport had already been invoked but no validated result exists, providerResult=not-reported.

## Usage and cost

Usage fields are preserved only when explicitly present and must remain non-negative safe integers. Missing usage fields remain absent.

Known cost stores total USD, SHA-256 of the pricing evidence source, and observed timestamp. Unknown cost stores only a digest of the bounded reason string.

The receipt never converts missing usage or pricing into zero.

## Response evidence

When validated response bytes exist, the receipt stores only bytes and sha256. The response body itself is omitted. The existing governed response bound of 1 MiB is enforced again while building the receipt.

## Canonical receipt digest

The final receiptDigest is SHA-256 over a key-sorted canonical JSON representation of the full receipt core. Equivalent object key ordering does not change verification. Added, removed, or modified receipt fields invalidate the digest.

## Verification helper

`verifyGovernedProviderExecutionReceipt(receipt, input)` reconstructs the expected receipt from the exact process-local request and permit plus supplied outcome.

It verifies that this receipt matches those inputs. It does not make the execution result/error a cryptographically authenticated provider statement.

## Public package surface

~~~ts
import {
  createGovernedProviderExecutionReceipt,
  verifyGovernedProviderExecutionReceipt,
} from 'furypipe/governed-provider-execution-receipt';
~~~

Installed-tarball smoke coverage verifies the public subpath and the receipt documentation in the packed npm artifact.

## Security properties

V1 maintains these distinctions:

~~~text
prepared != authorized
authorized != executed
transport invoked != network verified
network executed != provider accepted
transport report != verified provider evidence
process-local provenance != persistent signed provenance
~~~

Credentials remain owned by the provider transport and never enter this receipt.

## Current limitations

V1 does not provide cryptographic provider attestation, signed receipt provenance, cross-process permit provenance, remote timestamp authority, automatic receipt persistence, proof that a transport-reported provider request ID is authentic, or proof that provider-reported token usage is billing-authoritative.
