# Guardian-issued historical journal provenance

New internal container discovery requires a durable guardian binding before any Docker command. The guardian generates an ephemeral Ed25519 key in its own process memory. It sends only the public key, its PID, a random session ID and its observed macOS kernel boot-session UUID over the original parent/child IPC channel. The signing key is never sent in IPC, argv, environment, a file or a database row.

The supervisor verifies the nonce, exact operation and launch, owned child PID, canonical Ed25519 public key and boot UUID. It independently reads the boot UUID before fork and after registration acknowledgement using fixed `/usr/sbin/sysctl -n kern.bootsessionuuid`, with a two-second output-bounded command. Clean stderr, valid output and successful exit are required. Failure cancels rather than substituting a caller identity. A random guardian-session ID is an incarnation marker, not a kernel PID-start identifier.

## Binding before effects

The container-only authority context includes `bindGuardian(descriptor)`. The controller invokes `PostgresDiscoveryAuthorityStore.bindContainerGuardian(expectedAuthority, descriptor, assertLive)` with a closure over the original authenticated principal and intent. The store locks and checks the entire authority row, compares the complete canonical snapshot, and executes the synchronous live check under that lock. The callback validates grant, owner epoch, principal, exact approval, stop/revocation state, original intent and deadline. A callback that changes the state or returns a promise is refused.

The binding includes the exact scope, operation, proposal revision, original intent, launch operation/revision and guardian descriptor. It is immutable for that authority scope. An exact duplicate binding is idempotent; a new key or identity for the same operation is refused. Its checksum is integrity under the trusted database owner, not independent hardware attestation.

Only after binding commit acknowledgement and another matching boot observation does the supervisor acknowledge the child. The child then starts its existing challenge-based authority lease. Registration grants no execution time: all subsequent creates, attachment and request writes remain fenced by the original absolute deadline and guardian's two-second monotonic lease. Stopped, failed, delayed or uncertain registration never reaches create. Binding commit acknowledgement loss can leave a row but no admitted launch; that row cannot authorize a new guardian or a retry.

Call `initializeGuardianBindings()` explicitly once for the existing authority schema. It creates optional guardian metadata/table version 1 without changing authority or receipt versions. Reads perform no DDL. Missing or newer binding schema blocks new signed container launches. There is no unsigned fallback and no retroactive binding of legacy files. HTTP and host-stdio contexts retain their earlier contracts.

## Signed stage envelope

New `journal.json` files use `bowerloom/mcp-container-journal/v1beta2` with exactly `format`, `bindingRevision`, `sequence`, `body`, and `signature`. The body retains the earlier strict journal fields; its nested format remains v1beta1. The signature is canonical base64 Ed25519 over `bowerloom/guardian-journal-signature/v1` followed by a newline and canonical JSON of the other four envelope fields. Public keys use canonical SPKI DER base64. No journal-selected algorithm is supported.

The guardian signs each internally constructed stage, increments its snapshot sequence, and preserves the exclusive-temp write, file fsync, rename and directory fsync procedure. It compares the current persisted envelope to the exact envelope retained in memory before later stage updates and ownership checks. An older signed file substituted while that guardian lives is still refused. The envelope is bounded to 12 KiB and its body to 8 KiB.

The existing exact-owned cleanup remains independent of database access. After controller loss or renewal failure, the guardian can sign its resulting local cleanup or uncertainty stage without another database transaction. Signing does not bypass corrupt-path checks, prove an unknown CID, or grant cleanup to a recovery process. A missing signing/write result remains uncertain.

## Fresh read-only verification

`inspectMcpGuardianProvenance({ store, stateRoot, trustedDarwinHost: true }, scope)` is an internal API, not a package-index export, CLI or agent tool. It accepts no supplied journal, digest, public key, boot identity, observation or command override. It obtains authority and binding together through `readGuardianEvidence`, snapshots the actual private journal with the collector's nofollow/ownership/mode/ancestor/metadata checks, validates the signature against the independently stored key, and reads the current kernel boot UUID itself. It rechecks file pins, boot UUID and the complete authority/binding pair before returning. The overall bound is fifteen seconds; existing trusted pool connection and query bounds remain necessary. Late work cannot return success after expiry.

The result can report `signature: verified-historical` and `bootSession: matches`. These mean that the snapshot was signed by the registered guardian and that the kernel reports the same boot session at inspection. They do not prove newest state, successful cleanup, current process identity or host-restart recovery. Every report retains `snapshotFreshness: unproved`, `processIdentity: unproved`, `finding: HOLD_RECOVERY` and false cleanup/retry/execution/host-restart-safety flags.

A valid older signed snapshot can be replayed after the original guardian is gone. Without a separately committed latest-stage checkpoint, offline verification cannot detect that rollback. Replayed historical snapshots therefore receive exactly the same freshness hold. A matching PID may belong to a later process, even in the same boot. Reboot produces a different boot UUID; unknown/mismatched boot observations never permit adoption. A crash between spawn and recording, unrecorded attach PID or unknown create result remains held. No signal or container mutation occurs during inspection.

Legacy v1 journals and an initialized binding store without a record yield legacy/unavailable origin. Missing or malformed schema, invalid signature, changed file/authority/binding, failed boot query or database acknowledgement yields fixed uncertainty. There is no fallback to a journal-supplied key. The ordinary collector may normalize a structurally valid v2 body for existing observations, but its v1 collection/receipt still labels origin unverified and host session unknown. The richer inspection is not silently stored as trusted receipt v1 provenance.

## Explicit trust and acceptance limits

Trusted components include the original supervisor/guardian code and Node runtime, their private OS IPC channel, kernel boot query, local account, authenticated PostgreSQL pool and database owner. A malicious same-user process or root can inspect memory, replace trusted code or act through its credentials. This does not isolate the system from those actors. A digest beside an editable file is never used as provenance; a public key independently registered by the original launch is used to verify signatures, under these host and database trust assumptions.

Worker tests fork the real guardian and verify its generated signature, while substituting the Docker boundary. Other adversarial tests use explicitly synthetic signing fixtures for file/boot/store cases. Root separately proves real PostgreSQL binding, a real signed guardian journal and fresh-process inspection using the existing cached synthetic container, then repeats installed-package validation. Actual reboot and reliable PID-start identification remain unproved. The next recovery steps require durable latest-stage anchoring and separately reviewed effect authority; this slice implements neither.

## Versioned checkpoint extension

The v1 inspector above remains unchanged. It never upgrades an earlier receipt into fresh evidence.

The internal v2 checkpoint inspector adds rollback detection and original lifecycle closure. See [guardian checkpoints](mcp-guardian-checkpoints.md) for its exact classifications.

Uncertain operations retain their hold. The [operator procedure](mcp-recovery-operator.md) explains private read-only receipt collection without cleanup or retry authority.
