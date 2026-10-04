# Read-only recovery evidence collector

`collectMcpContainerRecovery({ store, stateRoot, trustedDockerDesktop: true }, scope)` is an internal trusted-host API. It reads real local evidence for an existing synthetic container-discovery operation. It is not a cleanup executor, public MCP tool or CLI. The dependency object accepts no clock, executable, environment, PID, container, journal-text or observation override.

The injected `DiscoveryAuthorityStore` is a trusted host dependency, not agent input. An initial transaction validates and snapshots the full authority record and requires `NEEDS_RECONCILIATION`, a committed intent and a container launch. A final transaction compares the entire canonical record to the initial snapshot and leaves its logical content unchanged. Database failures, changed records and lost acknowledgements return a fixed uncertainty error. Existing PostgreSQL store transactions may write an identical row as part of their normal contract; the collector does not clear or advance authority.

## Actual observations

The collector derives the operation directory from the validated authority key. Under the configured canonical state root it reads only `<operation-key-hex>/journal.json`:

- The state root and operation directory must be owned by the current user and have exactly mode `0700`. Every ancestor must be a real directory owned by that user or root, without group/other write permission. Symlinks and noncanonical roots are refused.
- The journal must be a regular file, owned by the current user, mode `0600`, a single hard link, and at most 8,192 bytes. Special permission bits are refused. The final open uses `O_NOFOLLOW` and `O_NONBLOCK`, then checks the opened file against the named file.
- Device, inode, owner, group, mode, link count, size, and nanosecond modification/change times are pinned before and after the bounded read. Ancestor identities and permissions are checked again. The entire snapshot is re-read after host observations and again after the final authority transaction. Missing files are also rechecked: a later appearance invalidates the result.
- Canonical JSON, strict journal fields, exact operation/launch/name binding, allowed lifecycle state, PIDs, full CID and the deadline within the original intent are validated before host queries. The name is a consistency check, never ownership authority.

Presence is collected with fixed `/bin/ps -p <recorded-pids> -o pid=`. Only a successful, clean-stderr result (or clean-stderr exit 1 with empty output) can establish process absence. An operational error is unknown even if `ps` returns exit 1 and no stdout. No signal-zero probe, signal, adoption or termination is sent to recorded PIDs. A present PID could be reused; it is not proven to be the original guardian or attach process. Unknown or unrecorded PIDs remain explicit observations.

A recorded full 64-character CID is queried using fixed `/usr/local/bin/docker --context desktop-linux container ls --all --no-trunc --filter id=<exact-cid> --format '{{.ID}}'`. Only an exact returned CID means present; a successful empty response without stderr means absent at that observation. Errors, unexpected IDs, invalid output, a flood or timeout mean unknown. A missing CID triggers no Docker query. These reads never start, stop, create, remove, pull, inspect unrelated objects, or retry a container.

Read-command subprocesses receive only the local account's home directory, a fixed PATH and suppressed Node coverage environment. No inherited Docker host/context, credentials or arbitrary environment overrides are passed. The explicitly trusted Desktop configuration and local user account remain dependencies. Each command has a two-second deadline, 64 KiB combined output bound and a 250 ms reap-observation fallback. Only the newly spawned read-command child may receive `SIGKILL` on its own error or timeout. The collector never addresses an existing recorded PID with a signal. Only a private stderr-present boolean is retained while classifying the command; raw stderr and unvalidated output are not included in the report. Metadata-only ctime changes also invalidate the journal snapshot even when bytes and mode stay unchanged.

The collection API returns uncertainty after 15 seconds. A late trusted-store callback is prevented from starting later host queries. The store interface cannot cancel an already pending database operation, and Node does not provide cancellation of every pending filesystem read; trusted pool and local filesystem bounds remain necessary. Already-started read-command children retain their own deadline and cleanup path.

## Reports remain held

The result separates actual `observations.guardian`, `observations.attach`, and `observations.container` from `planner`. It includes the stable local journal's digest and byte count, the authority revision, final unchanged-check flags, and an overall report revision. A digest computed beside local bytes is not independent provenance.

`journalOrigin` is always `unverified-local-user-file`, and `localUserTrustRequired` is true. A hand-written synthetic journal and a genuine old guardian journal cannot be distinguished merely by these file checks. Root's proof uses explicitly synthetic fixture journals; it is not a recovery of a real guardian journal.

The existing journal has no trusted host-boot or process-start binding. The collector therefore always passes an unknown host session and untrusted journal provenance to the planner, which remains `HOLD_HOST_SESSION`. Actual exact-ID absence is visible as an observation, not as permission to clear authority or retry. Cleanup, retry, execution and host-restart-safety flags remain false. Existing recorded processes may still be alive even when Docker reports absence.

The before/after filesystem checks detect ordinary changes but do not provide an atomic database/filesystem/process snapshot or defend against a malicious local account swapping paths and restoring them between checks. POSIX mode checks are not a complete ACL audit. Privileged or same-user writers remain trusted. The final authority check is a point-in-time comparison, not a persisted reconciliation operation or an ongoing lock over host state. Any later effect needs a separate reviewed authority boundary.

## Validation scope

Tests use actual private files for normal, missing, symlink, hardlink, unsafe-mode, oversized and changed snapshots. They test file/ancestor replacement, changed durable authority, failed database acknowledgements, and bounded/invalid Docker results. One test runs real read-only `ps` against the test process. Docker behavior is substituted only by private Node test instrumentation; the production API exposes no observation override. Root separately owns real PostgreSQL/read-only Docker proof. No live container cleanup, restart recovery or completed beta is established by these tests.

## Optional durable observation receipt

The separate internal `collectAndPersistMcpContainerRecovery` path records fresh collection evidence with an atomic full-authority comparison, then rechecks the journal. See [durable recovery observation receipts](mcp-container-recovery-receipt.md) for explicit schema initialization, idempotent evidence writes and uncertain commit handling. The original collection-only API remains unchanged. Neither path clears reconciliation or proves journal provenance.
