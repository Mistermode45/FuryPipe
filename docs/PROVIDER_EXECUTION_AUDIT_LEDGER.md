# Provider Execution Audit Ledger

## Purpose

`createProviderExecutionAuditLedger()` creates a deterministic append-only ledger over multiple `FuryProviderExecutionAuditChain` objects.

The ledger tracks chronological integrity across provider executions while remaining plaintext-free. It does not execute providers, persist data, sign records, or create trusted provenance by itself.

## Entries

Each entry stores only its index, source chain digest, previous entry digest, exact provider/model/workload scope, execution protocol, request digest, outcome kind, provider evidence classification, source-chain provenance classification, and entry digest.

Each entry after index 0 references the previous `entryDigest`. Removing or reordering entries therefore invalidates continuity unless a complete replacement ledger is produced.

Duplicate source-chain digests are rejected so the same execution chain cannot be appended twice inside one ledger snapshot.

## Source-chain semantics

At creation or append time FuryPipe recomputes the supplied audit-chain digest and validates its critical scope, execution, provenance, and verification semantics.

~~~text
sourceChainDigestIntegrity = verified-at-append
sourceChainProvenance      = not-verified
~~~

Digest integrity remains distinct from source provenance.

## Ledger provenance

The ledger is not signed and has no remote timestamp authority, so `ledgerProvenance` remains `not-verified`.

For stronger continuity checking across process boundaries, a caller can store the expected ledger digest in an independent system and provide it later to verification.

## External anchor check

`verifyProviderExecutionAuditLedger(ledger, expectedLedgerDigest)` optionally verifies that the current ledger matches an independently retained digest.

This distinguishes an internally consistent ledger from the exact ledger state previously anchored elsewhere.

## Replay protection

The same `chainDigest` cannot appear twice in one ledger. This is ledger-local duplicate protection and is not a distributed coordination protocol.

## Bounds and immutability

V1 supports at most 10,000 entries per in-memory snapshot.

Append returns a new frozen ledger and leaves the previous ledger unchanged.

## Plaintext-free design

The ledger does not contain task text, prompt text, context text, response bodies, credentials, provider request IDs, permit IDs, policy IDs, or pricing-source text.

## Public API

~~~ts
import {
  createProviderExecutionAuditLedger,
  appendProviderExecutionAuditLedger,
  verifyProviderExecutionAuditLedger,
} from 'furypipe/provider-execution-audit-ledger';
~~~

## Security semantics

~~~text
digest integrity != trusted provenance
append-only linkage != cryptographic signature
duplicate rejection != distributed replay prevention
internal verification != external anchoring
transport-reported != verified provider evidence
~~~

## Current limitations

V1 is an in-memory immutable ledger contract. It does not provide durable storage, remote timestamps, signatures, Merkle proofs, cross-process locks, distributed consensus, or automatic upload to an external audit system.
