# Internal window continuity

This is a bounded accounting primitive for trusted controllers. It has no CLI command or default activation.
It does not reset an account, restore capacity, authorize native work, or release retained allowances.
Production registry enrollment and real account transitions require separate approval.

## Supported account states

Existing accounts retain their version1 format and behavior. Ordinary observations never upgrade them.
The database schema metadata stays version1 because the table structure is unchanged.

An explicitly approved transition writes account version2 in two transactions:

1. `HELD` preserves the original live fields and consumes the operation. Legacy clients reject the incompatible row version.
2. `APPLIED` installs the exact approved observation with an additive historical charge.

Only the invocation that received the first commit acknowledgement can attempt the second transaction.
There is no resume, downgrade, automatic retry, or adoption API.
An interrupted `HELD` account remains unavailable until a future reviewed recovery contract exists.
Do not repair it through manual SQL or infer a successful transition from a lost acknowledgement.

## Exact plan and trusted approval

`planWindowContinuity(origin, input, now)` validates a detached version1 snapshot and returns a deterministic plan.
A plan grants no authority. Applying it independently reads and locks the selected database account.

The first slice accepts exactly four completed reservations, each retaining two primary points and one completion proof.
It preserves their requests, proofs, timestamps, and original window identities.
The origin requires a primary-only positive high-water mark and the `hold` retention policy.

The plan binds the original state, aliases, policy, scope, proposed observation, observer receipt, artifact identity, and review identity.
The observation requires authenticated subscription usage, a fresh forward-overlapping primary window, and the same duration.
Secondary usage and coverage remain unknown. Their absence is never interpreted as reset evidence.

A trusted host supplies a constructor-only `ContinuityAuthority`:

- `resolveApproval` looks up the exact approved plan in an independently controlled registry.
- `readObservation` returns exactly `{ observation, evidence }` matching that plan.
- `assertCurrent` synchronously checks the principal, approver, owner epoch, lease, purpose, and revocation state.

Task text, caller receipt JSON, generic effect approvals, and model grants cannot substitute for this capability.
Each asynchronous lookup has a one-second bound with cancellation and late-result refusal.
Approval lasts at most five minutes, shortened by observation freshness, window expiry, and the host lease.
A later observation cannot extend the approved lifetime.

`PostgresAdmission.applyWindowContinuity(plan, approvalId, signal)` performs both transactions with exact checksums and one-row compare-and-swap checks.
It verifies the actual database, schema, account, and complete alias mapping under fixed lock ordering.
No database work starts after a cancelled or expired lookup.
The original admission transaction machinery handles connection faults and uncertain commits.

## Conservative charges

Every version2 reserve, launch, and controlled dispatch check adds:

`historical floor + current segment peak + retained allowances + headroom`

Reservation checks also add the proposed allowance. Percentages round upward to integer basis points.
Totals are never clamped to 100. Equality with the policy threshold refuses work.

The observed example remains `58 + 25 + 8 + 8 = 99`, which refuses against the existing threshold of 95.
This continuity operation cannot make that example eligible for a native qualification.
A lower subsequent observation cannot lower the segment peak or the historical floor.

The new segment retains its original anchor. Existing one-second jitter tolerance cannot chain into a different window.
Further overlap, rollover, duration changes, coverage, new windows, and non-null secondary usage refuse.
Missing applicability for an old retained route still refuses admission independently.
Policy edits and additional continuity transitions also refuse.

All original reservations and the full origin remain immutable across ordinary operations.
An exact old completion proof can be replayed only as a no-op.
New reservations retain the ordinary lifecycle when the additive capacity gate allows them.
Coverage cannot release version2 retention in this slice.

## Inspecting uncertain outcomes

`inspectWindowContinuity(alias)` reads through a separate path that performs no account update.
Ordinary lookup, policy, observation, reserve, launch, completion, and reconciliation all refuse a `HELD` account.

The versioned private inspection includes scope, operation and approval identities, state and origin checksums, and separate charge components.
Its `accountingBasis` distinguishes active accounting from the proposed charge of an unusable `HELD` account.
All three authority flags remain false: effects, launch, and retry.
An inspection never supplies a continuation token or proves a provider reset.

After claim acknowledgement loss, no final transaction runs.
After final acknowledgement loss, inspection can report the durable phase but cannot authorize replay.
Cancellation, revocation, expiry, and final rollback never restore version1 after a committed hold.

## Qualification limits

Unit tests exercise pure accounting and a synthetic transactional protocol fixture.
That fixture is not PostgreSQL lock-order or installed-artifact qualification.
Genuine old-client concurrency, separate-pool PostgreSQL behavior, and installed composition require separately reviewed controlled proofs.
No real ledger, provider observation, account reset, grant, model session, or native process is changed by these tests.

The boundary trusts the host registry, controller, and database custody.
It does not contain arbitrary SQL administrators or launchers that ignore the admission protocol.
Direct provider calls and fabricated completion attestations remain outside this contract.
