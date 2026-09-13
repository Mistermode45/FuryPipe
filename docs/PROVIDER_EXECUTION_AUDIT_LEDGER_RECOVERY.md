# Durable Provider Execution Audit Ledger Snapshots

## Purpose

This layer persists the existing plaintext-free
`FuryProviderExecutionAuditLedger` contract through FuryPipe's Recovery Store.

It adds durable, content-addressed snapshots. It does **not** turn the ledger into
trusted provenance, a signed transparency log, a distributed consensus system, or
an automatically linearizable global append log.

The existing distinctions remain mandatory:

```text
digest integrity != trusted provenance
durable storage != signed provenance
one verified lineage != verified global head
transport-reported != provider-verified
```

## Storage model

A snapshot payload contains:

- the complete verified audit-ledger snapshot;
- an optional parent link containing the exact prior `ledgerDigest`;
- the exact prior Recovery object SHA-256 digest;
- explicit `not-verified` provenance classifications.

The payload is encoded as deterministic canonical UTF-8 JSON, then stored through
`RecoveryStore.put()`.

The returned Recovery object is verified after persistence. The Recovery content
address is independently recomputed from the returned bytes when loading.

The Recovery Store may itself be configured by the host with AES-256-GCM encryption.
This adapter does not create, manage, log, or persist encryption keys.

## Root snapshot

`persistProviderExecutionAuditLedgerSnapshot()` stores an already valid ledger as a
new durable root snapshot.

A root snapshot may contain zero or more ledger entries. "Root" describes the
durable snapshot lineage only; it does not rewrite the ledger's internal entry
chain.

## Append snapshot

`appendProviderExecutionAuditLedgerSnapshot()`:

1. reloads the exact parent Recovery object;
2. verifies its Recovery content digest;
3. verifies the exact expected ledger digest;
4. verifies that the supplied durable snapshot reference matches the persisted data;
5. performs the existing immutable ledger append;
6. persists a new snapshot whose payload embeds:
   - parent ledger digest;
   - parent Recovery object digest.

The prior snapshot remains immutable.

## Lineage verification

`verifyProviderExecutionAuditLedgerSnapshotLineage()` walks parent Recovery
objects back to the durable root.

For every edge it verifies:

- parent Recovery content address;
- parent ledger integrity;
- child ledger integrity;
- exact parent ledger digest;
- exact parent Recovery digest;
- child count = parent count + 1;
- every pre-existing ledger entry digest is preserved;
- the newly appended ledger entry links to the parent's previous head.

A successful result reports:

```text
continuity = verified
globalHead = not-verified
ledgerProvenance = not-verified
snapshotProvenance = not-verified
```

The `globalHead` field deliberately remains `not-verified`.

## Why there is no automatic "latest ledger"

Recovery Store is immutable content-addressed storage. It does not expose a
transactional compare-and-swap mutable head pointer.

Two processes can therefore start from the same valid parent and persist two
different valid children.

Both branches are individually verifiable. Neither becomes the globally authoritative
head merely because it was written later.

FuryPipe does not pick one silently.

A deployment requiring one globally ordered append log must provide a separate
transactional/consensus-backed head authority or an independently managed exact
digest anchor.

## Exact discovery

`findProviderExecutionAuditLedgerSnapshot()` can discover a snapshot by an exact
known `ledgerDigest` when `RecoveryStore.list()` is available.

Recovery metadata is used only as a discovery hint. The returned object is always
reloaded and revalidated from its content-addressed payload.

The function does not expose fuzzy lookup or "newest" selection.

## Independent anchors

`loadProviderExecutionAuditLedgerSnapshot()` optionally accepts an exact expected
ledger digest.

If the durable object contains another ledger digest, loading fails.

This lets an operator keep an independent digest in another trust domain without
FuryPipe claiming that the anchor itself is signed or trustworthy.

## Plaintext surface

The durable payload contains the same bounded audit-ledger data already allowed by
the V1 ledger contract:

- provider/model/workload identifiers;
- protocol;
- request digest;
- source chain digest;
- linked entry digests;
- outcome/evidence classifications;
- ledger digest.

It does not add:

- task text;
- prompt text;
- context text;
- response body;
- credentials;
- provider request IDs;
- permit IDs;
- policy IDs;
- pricing-source text.

## Public API

```ts
import {
  persistProviderExecutionAuditLedgerSnapshot,
  loadProviderExecutionAuditLedgerSnapshot,
  appendProviderExecutionAuditLedgerSnapshot,
  findProviderExecutionAuditLedgerSnapshot,
  verifyProviderExecutionAuditLedgerSnapshotLineage,
} from 'furypipe/provider-execution-audit-ledger-recovery';
```

## Recovery and backup

Backup, restore, rekey, quotas, GC and filesystem crash hardening remain properties
of the configured Recovery Store.

This adapter does not duplicate those mechanisms.

A Recovery backup proving `BACKUP_EXISTS` is not automatically proof that the
backup is current, externally replicated, immutable against the host, or signed.

## Security boundaries

The adapter is fail-closed on:

- invalid ledger input;
- invalid Recovery handle;
- Recovery object digest mismatch;
- non-canonical payload encoding;
- payload schema mismatch;
- ledger digest mismatch;
- forged durable snapshot reference;
- broken parent Recovery link;
- broken ledger prefix continuity;
- lineage cycle;
- lineage depth outside the bounded contract.

No provider request, credential lookup, retry, fallback, MCP, tool, subagent or
other hidden network action is performed.

## Current limitations

Not implemented by this layer:

- signed timestamps;
- digital signatures;
- Merkle inclusion proofs;
- external transparency service;
- transactional mutable head;
- distributed lock/consensus over the ledger head;
- automatic fork resolution;
- globally verified "latest" snapshot;
- external archival or cloud replication.

Those capabilities require separate host/external evidence and must not be inferred
from Recovery Store durability alone.
