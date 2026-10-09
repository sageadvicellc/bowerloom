# Durable recovery observation receipts

The internal `collectAndPersistMcpContainerRecovery({ store, stateRoot, trustedDockerDesktop: true }, scope)` entry point collects fresh local evidence, then records it against the unchanged discovery authority. It accepts no report, digest, observation, clock or host-command override. It returns `{ collection, receipt, persistence: 'commit-acknowledged' }` only after persistence acknowledgement and another journal check. Nothing is exported through the public CLI or connection package index.

A receipt is explicitly a `historical-read-only-observation`, not completed reconciliation. Its `v1beta1` format binds the exact scope, operation, complete authority revision, collection and its revision. `journalOrigin` remains `unverified-local-user-file`, `hostSession` remains `unknown`, and the planner remains `HOLD_HOST_SESSION`. Cleanup, retry and execution remain false. The journal lacks independent host-boot and process-start provenance; storing its digest does not add that provenance.

## Explicit schema installation

A trusted host must invoke `PostgresDiscoveryAuthorityStore.initializeRecoveryReceipts()` once for its existing authority schema. This creates optional `recovery_metadata` version 1 and `recovery_receipts` in one transaction. Authority metadata and discovery-row versions stay at 1; existing authority reads and writes do not require the optional tables. Reinitialization refuses instead of silently replacing data. Failed initialization rolls back; a lost commit acknowledgement is uncertain and must be inspected by the operator before another schema action.

Receipt reads and writes do no DDL. A missing receipt schema or a different receipt metadata version refuses the operation. Future receipt migrations must be explicit; this slice supplies no version upgrade, automatic table repair, downgrade or history replacement. The schema owner, authenticated bounded PostgreSQL pool and same-user host code remain trusted.

## Atomic database boundary

`recordRecoveryReceipt(expectedAuthority, collection, checkActive)` is a trusted internal store method, not an agent-facing ingest endpoint. The collector supplies the expected snapshot and its fresh collection. The method validates exact, bounded receipt structure and hashes, locks the existing discovery row, validates its checksum and complete schema, and compares its entire canonical authority to the captured snapshot. The authority must still be `NEEDS_RECONCILIATION`. A concurrent grant, stop, epoch, proposal, approval or any other authority change refuses the write.

Under that same transaction it inserts the deterministic receipt with uniqueness on scope plus receipt revision, then reads and validates the actual stored bytes, version and checksum. Exact duplicate evidence yields the same receipt, including concurrent exact attempts; it cannot create multiple receipts. A conflicting or corrupted record refuses. No discovery update, cleanup permission, retry transition or execution grant is written. Ordinary later collections have fresh timestamps and may create different historical receipts.

The raw store method accepts trusted host-supplied structured evidence for testing and internal composition. Its validation proves structural consistency, never that a supplied report originated in the collector. Neither a caller-computed hash nor a database checksum is an attestation. Only the collector-owned entry point describes its observations as freshly collected; `readRecoveryReceipt(scope, revision)` returns historical evidence and never refreshes its authority or provenance. Cross-scope lookup and mismatched revisions refuse.

## Time and failure limits

The existing 15-second collection deadline includes persistence. Active checks occur around asynchronous stages, before INSERT, before COMMIT and after its acknowledgement. Expiry before commit causes rollback where possible. An already-sent commit may succeed despite timeout, connection loss, or lost acknowledgement; the caller receives uncertainty, never effect authority. A late completion cannot turn that uncertain return into success. An exact evidence replay is idempotent, but uncertainty is not permission to repeat container discovery.

PostgreSQL transactions use the existing five-second lock timeout, ten-second statement and idle transaction bounds, and synchronous commit. The trusted pool must separately bound connection acquisition; the collector cannot cancel every pending driver or filesystem operation.

Filesystem pins are rechecked after observations, after the authority fence, and after receipt commit. PostgreSQL and the host filesystem cannot share an atomic transaction. A change during or after insertion can leave a durable historical observation even though the collector returns uncertainty. Receipt flags describe checks already performed before recording; they do not assert that files, PIDs or containers stayed unchanged afterward. The final post-acknowledgement journal check is needed for a successful return, but is not itself a second persisted attestation.

A malformed receipt is refused even with a recomputed outer checksum if its fixed unknown-provenance and non-authorizing invariants do not hold. The checks bound JSON to 16 KiB after safe descriptor-based cloning; they validate nested exact fields, PIDs, CIDs, observations, held planner values and nested revisions. A malicious database owner can rewrite mutually consistent data: database and host trust remain explicit.

## Validation scope

Focused tests use real private files with intercepted read-only subprocesses and a transaction-protocol mock. They cover deterministic duplicate evidence, authority drift, wrong scope, checksum/schema/body corruption, permission/provenance forgery, missing or newer optional schema, rollback, lost commit acknowledgement, and collector timeout/late completion. Root runs the separate real PostgreSQL proof with synthetic journals and actual read-only host observations. This is durable evidence collection only; live cleanup, host restart reconciliation and complete beta readiness remain separate gates.
