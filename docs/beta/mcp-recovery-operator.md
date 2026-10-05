# Handling a held container discovery

The supported beta recovery endpoint is a durable hold. Bowerloom does not automatically clean up, clear or retry an uncertain operation.

## Collect a private receipt

Use the reviewed internal `collectMcpGuardianOperatorReceipt()` function with the existing authority store, private journal directory and selected scope.

It performs fresh read-only inspection itself. It accepts no supplied exit assertion, trusted journal digest or replacement clock.

The format is `bowerloom/mcp-recovery-operator/v1beta1`. It includes the operation and scope, proposal and binding revisions, observation time and evidence revisions.

The proposal revision binds the reviewed launch inputs. Keep the implementation source manifest alongside the private receipt as separate release evidence.

The receipt contains a private journal hash. It contains no credentials, private keys, raw database errors or unrelated host inventory.

Its `cleanupAuthorized`, `retryAuthorized` and `executionAuthorized` fields are always false. The nested inspection has the same restrictions.

Unavailable or inconsistent observations return a fixed uncertainty error. Record that collection limitation separately and retain the hold.

Do not fabricate missing receipt fields. The collector does not repair journals or clear authority rows.

## Follow the hold procedure

1. Stop automated work for this operation. Preserve its original intent, approval, journal and durable records.
2. Collect the private receipt through the reviewed internal path. If collection fails, record the limitation and preserve the hold.
3. Give the responsible operator the unresolved reason and evidence. Distinguish historical cleanup from current resource observations.
4. If intervention is necessary, independently establish the target using the platform's administrative tools.
5. Record human intervention separately with its time and author. Label these notes as unverified operator reports.
6. A later read-only observation can document changed state. It still cannot clear or retry this uncertain operation.

Do not edit signed evidence or delete records to unblock execution. Bowerloom supplies no PID-based kill recipe or automatic Docker cleanup through this receipt.

Do not create a nominally new operation to evade the hold. A genuinely new task requires its own reviewed plan and approval.

That new task cannot repeat the uncertain effect through this procedure.

## Read the result accurately

`final-snapshot-verified` confirms the original guardian's final recorded snapshot under the trusted runtime contract. It is historical lifecycle evidence.

`matches-checkpoint` confirms only a durable lower bound. `newer-unanchored` does not establish latest state.

Rollback, conflicting bytes, terminal mismatch and missing observations remain unresolved. The receipt preserves the specific classification.

A current exact-container observation is different from a past signed cleanup result. Neither proves absence of escaped work or safe repetition.

A PID seen later does not recreate the original owned process handle. Never treat boot equality or a matching PID as action authority.

Human notes cannot become framework-verified reconciliation. Future automated reconciliation needs separate design, implementation and review.
