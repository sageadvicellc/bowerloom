# Bounded real workspace effects

`packages/workspace-effects` implements the existing `WorkspaceEffects` interface for trusted controller-owned synthetic workspaces. It writes real files and records operation identity and outcomes in PostgreSQL. This alpha slice was built from integration revision `36bbe6b2d80242732619cef0356491f7a38ec7c2` and does not change the broker or contract interfaces.

## Registered file scope

The controller supplies a `pg` pool and calls `PostgresWorkspaceEffects.open(pool, { schema, workspaces })`. Each workspace has a `workspaceId`, an absolute canonical `root`, and an explicit `writablePaths` array. The caller owns the pool, credentials, connection settings, and error handling. The adapter reads no environment variables or credentials itself.

The controller must pre-create the root and parent directories with private permissions, such as `0700`. Register only lowercase portable relative file paths, for example `output/job-board/index.html`. This slice creates or replaces bounded UTF-8 files at those exact paths. It creates no directories and runs no commands. Uppercase paths are excluded to avoid case aliases on common macOS filesystems. Roots cannot overlap. There can be at most 16 workspaces and 128 registered paths per workspace.

Registration checks directory ownership, private POSIX mode bits, canonical paths, and device/inode identity. Existing targets must be owned regular files with one link and at most 256 KiB. Symlinks, hard-linked targets, unregistered paths, unknown workspace IDs, unsafe paths, and invalid request bindings are rejected. Filesystem identities and the registered path set contribute to a persisted workspace binding. Moving a workspace, replacing its directories, or changing its registration requires a separate migration; this adapter does not silently rebind existing records.

Workers must receive neither these roots as writable capabilities nor database credentials. Only the trusted controller should hold this adapter. Filesystem denial in the worker harness remains a mandatory independent gate. This package is not an authorization service or an OS sandbox.

## Intent, publication, and outcomes

Call `createSchema()` once to create a new explicit `trellis_...` namespace and pin its workspace registrations. Existing schemas are refused. Opening an existing installation checks schema and record version 1 on use. No automatic schema migration or workspace registration change is implemented.

Every request pins the proposal, action digest, operation key, and deadline. A database transaction locks the registered file row, checks prior records, and reads the current file precondition. A stale digest commits `NOT_APPLIED` with `PRECONDITION_FAILED`; that negative outcome remains terminal even if the file later matches the old precondition.

For an admitted write, the transaction commits `INTENT` before any staging or publication. A partial unique index permits only one unfinished intent per registered file. Other keys cannot bypass that hold. After intent commits, the adapter rechecks cancellation, deadline, directories, and the target snapshot, then writes and syncs a private exclusive staging file in the target directory. A final check precedes publication. Creation uses an exclusive hard link followed by staging-name removal; replacement uses a same-directory rename. The containing directory is synced before the receipt is committed as `APPLIED`.

| Last durable observation | Behavior after restart |
| --- | --- |
| No operation record | A new request may undergo normal admission. |
| `NOT_APPLIED` | Return the saved negative result without attempting a write. |
| `INTENT`, whether the target changed or not | Refuse replay and hold that file for reconciliation. `lookup` returns no receipt. |
| `APPLIED` | Return the bound saved receipt without writing again. |

The adapter does not infer success from matching file contents after a crash. It supplies no automatic hold-clearing procedure. Interrupted staging can leave an owned temporary file that requires inspection. A crash after publication but before the outcome commit leaves a visible file and an unfinished intent. That is an explicit unresolved outcome, not an invitation to rerun the write.

A failed commit acknowledgement produces `COMMIT_UNKNOWN`; no automatic transaction or filesystem replay follows it. If the terminal commit actually succeeded, a fresh instance can recover the saved receipt. A completion clock earlier than the recorded intent also leaves a hold instead of storing an invalid receipt.

## Limits and required assumptions

PostgreSQL and the filesystem do not form one atomic transaction. The ledger records the crash window and stops automatic replay; it does not remove the window. A completed receipt describes the historical operation, not a guarantee that the file still contains those bytes after a later controller edit. Returning that receipt must not overwrite a later edit.

The controller must be the sole writer of the registered directory trees, and each tree must belong to one ledger. Directory checks and `O_NOFOLLOW` reject observed unsafe states, but Node's path-based operations do not close every race against a hostile same-user process swapping directories or changing files between checks. Private mode and ownership checks do not replace that assumption or a deployment review of ACLs. Workers must be denied filesystem authority before integrated live acceptance.

Cancellation and deadlines are checked before admission, staging, and publication. A filesystem call already issued cannot be recalled, and a later cancellation cannot undo published bytes. Failed or interrupted work after intent remains held. Completed and negative cached results can be returned after cancellation because they perform no new file effect.

The PostgreSQL pool and ledger are trusted. Database role provisioning, protection from privileged record tampering, hold resolution, retention, relocation, server failure recovery, and production deployment remain separate work. This slice adds no command runner, DBOS wrapper, live model integration, or claim of complete alpha readiness. The POSIX implementation was tested on the existing Mac; Linux behavior has not been independently established here.

## Reproduce the synthetic proof

Run `npm ci --ignore-scripts --no-audit --no-fund` after disk admission, then `npm test` for default checks. Real database suites are explicitly skipped unless their proof markers are supplied; a default run is not PostgreSQL verification. Dependencies pin `pg` 8.16.3 and use the existing test installation at loopback port 56582.

```sh
TRELLIS_WORKSPACE_PROOF=trellis-alpha-proof@127.0.0.1:56582 \
TRELLIS_WORKSPACE_CREDENTIALS_FILE=/absolute/private/credentials.json \
npm run test:workspace-effects
```

The private JSON file must contain the existing proof's `POSTGRES_PASSWORD`. The test creates a unique `trellis_effects_test_<16 hex digits>` database with the exact `trellis_workspace_test` schema, plus `trellis_effects_broker` for integration. It creates a fresh private scratch tree and a sibling outside canary. It deletes only that newly created database and scratch tree. Child processes receive configuration over private IPC; credentials are excluded from arguments, reports, and logs. No Docker lifecycle command is used. Results live in ignored `packages/workspace-effects/.trellis/`.

On October 1, 2026, both enabled database suites and the existing tests passed 166 tests with no skips. The workspace parent case and its 16 subcases took about 1.35 seconds; the complete Node run took about 1.53 seconds, excluding compilation. Its temporary database used about 7.6 MiB and was removed. These are single-run observations, not performance guarantees.

The evidence covers real creation and replacement, stable receipts and negative results across fresh processes, same-file competition, stale preconditions, cancellation, deadlines, backward clocks, unsafe paths, target and parent symlinks, hard links, directory replacement, corrupted ledger records, two process-crash windows, and a lost terminal commit acknowledgement. Outside canary bytes, inode, and modification time remained unchanged. The existing action broker and PostgreSQL store also completed one approved real synthetic file write and retained its receipt. Temporary databases and scratch trees were removed.

The implementation uses the documented [Node 24.11 filesystem APIs](https://nodejs.org/download/release/v24.11.0/docs/api/fs.html) and [PostgreSQL 17 row locks](https://www.postgresql.org/docs/17/explicit-locking.html). Neither source supplies an atomic transaction across both systems.
