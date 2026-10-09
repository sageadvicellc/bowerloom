# Guardian checkpoints and historical closure

This internal beta capability detects signed journal rollback and records clean lifecycle closure. It does not recover or repeat an operation.

## Checkpoints before effects

The host explicitly calls `initializeGuardianCheckpoints()` after initializing guardian bindings. A missing or future schema refuses a new container launch.

Reads do not create tables. Historical binding, journal and provenance receipt formats retain their earlier conservative meaning.

The original guardian signs and syncs each snapshot before sending it through its original nonce-bound channel.

| Checkpoint | Effect blocked until its acknowledgement |
| --- | --- |
| `CREATING` | Docker create |
| `CREATED` | Attach process launch |
| `STARTED` | Discovery protocol forwarding |

The controller checks the complete original authority snapshot under the same database row lock as registration. This includes grant, owner, approval, stop and expiry checks.

The guardian checks its own stop state, monotonic lease and absolute deadline again after acknowledgement. Waiting never extends either deadline.

Registration and Docker are separate operations. The existing bounded lease defines cross-process revocation timing; the checkpoint does not provide instantaneous termination.

Each record stores the exact signed envelope, its sequence and hash, its binding revision, and the previous checkpoint revision. Records are capped at 32.

Each signed envelope is capped at 12 KiB. The persisted chain rejects duplicate conflicts, lower new sequences, changed scope and incorrect prior revisions.

An exact repeated normal checkpoint is idempotent. This permits duplicate persistence, never duplicate effects.

## Stop-safe cleanup and sealing

Local journal writes run through one serializer. Stop invalidates normal continuations and rejects an outstanding checkpoint wait immediately.

Cleanup waits for already-started local writes and Docker create completion. It does not wait for the pending database request.

The guardian checks exact container ownership before cleanup. It records exact container absence and the close of its owned attach child.

A successful final journal is `REAPED`, or `CANCELLED` when creation was never attempted. Unknown create outcomes remain uncertain.

The guardian signs a separate terminal declaration over the final sequence, envelope hash and outcome. It then irreversibly disables further work.

This disables signing, journal writes, lease renewals, forwarding and Docker calls. It releases its signing-key reference before transmitting the terminal message.

Reference release is not memory zeroization. The guardian's fixed trusted runtime enforces this contract.

The original supervisor requires the valid seal and its owned guardian child's clean close. Exit code must be zero, without a signal.

A numeric PID observation cannot replace that owned close. Missing seals, killed children and attach gaps provide no closed witness.

## Historical persistence and races

After clean close, the host persists the final checkpoint, seal and close witness in one transaction. It leaves every authority byte unchanged.

This audit write can follow stop, revocation or expiry. It grants no new permission to act.

The transaction compares the full current authority snapshot and the last acknowledged checkpoint head. It makes one compare-and-swap attempt.

A pending normal commit can win that race. In that case, the terminal write refuses the unseen head and preserves uncertainty.

If terminal closure wins, later normal checkpoints refuse. An exact repeated closure requires identical envelope, seal and witness bytes.

Persistence has an independent five-second bound. A lost acknowledgement, controller crash or unavailable database can lose closure despite successful local cleanup.

There is no automatic retry of effects or silent rebasing onto a newer head.

## Read-only inspection

`inspectMcpGuardianCheckpoints()` is an internal function in `container-guardian-checkpoint.js`. It is not a public command or index export.

It reads authority, binding and checkpoint records together. It then reads a protected journal snapshot and the actual Darwin boot session.

It repeats database, boot and file checks before returning. Caller-supplied hashes, clocks, process observations and keys are not accepted.

The new result format is `bowerloom/mcp-guardian-provenance/v1beta2`. The existing v1 inspector retains its original fields and meaning.

| Classification | Meaning |
| --- | --- |
| `rollback` | The valid local sequence is below the committed head. |
| `conflict` | Equal sequence has different signed bytes. |
| `matches-checkpoint` | Local bytes match a durable lower bound; latest state remains unknown. |
| `newer-unanchored` | The valid local snapshot has no matching committed checkpoint. |
| `final-snapshot-verified` | Exact final snapshot matches a signed seal and original owned-child clean close. |
| `terminal-mismatch` | Local bytes differ from the final closed snapshot. |
| `unknown` | A required binding, checkpoint or journal is missing, or the journal is legacy. |

Corrupt records, failed fences and unavailable observations return a fixed uncertainty error. No evidence is repaired or synthesized.

Every result keeps cleanup, retry and execution authorization false. Even final closure reports current external state as unverified.

A boot mismatch can coexist with valid historical closure. It never establishes present process identity or safe action after restart.

## Trust and limits

The guardian, supervisor, kernel, local account and database owner remain trusted. Store persistence methods accept trusted internal host assertions.

These records are not hardware attestation or database-owner rollback protection. A modified privileged runtime can fabricate assertions.

This slice adds no process adoption, PID signaling, cleanup executor, public recovery command or authority clearing.

A controller crash can leave a genuine signed final journal without a persisted original-channel witness. That operation remains held.

Real source and installed-artifact qualification are recorded separately. Unit tests alone do not establish platform containment or release readiness.
