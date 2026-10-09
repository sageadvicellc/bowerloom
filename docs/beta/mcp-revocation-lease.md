# Short authority lease for synthetic MCP container discovery

This internal beta slice makes a running discovery container respond to a durable stop or grant revocation from another controller process. It remains synthetic discovery only. It grants no tool execution, public connector access, or general container authority.

## Protocol

The independent guardian requests authority before creating any container. It then requests renewal 500 ms after each accepted response. Each request has a random 256-bit challenge, a strictly increasing sequence, the exact authority operation key, and the session nonce already bound to the private parent/child IPC channel. Renewals contain no database credential or controller-selected duration.

The supervisor invokes the controller's `renewAuthority` callback for each challenge. The callback opens a fresh durable transaction and validates the current authority row: original proposal and exact intent, `IN_FLIGHT` status, owner subject and epoch, grant readiness/expiry/revocation, stop flag, exact approval and approver membership, principal expiry, and the original absolute deadline. It acknowledges only after that transaction commits. PostgreSQL already provides the required row lock, synchronous commit, checksum and state validation; no schema migration or cached read is added. A failed or uncertain database acknowledgement cancels the guardian. A stalled database operation cannot renew it.

The guardian sets the response's expiry to the earlier of:

- 2,000 ms after the challenge was issued, measured by the guardian's monotonic clock;
- the original absolute deadline converted once into a guardian-monotonic ceiling.

It also continues checking the original wall-clock deadline. A delayed response does not receive another 2,000 ms from receipt. A response arriving after either the current lease or its own challenge expires is refused. An accepted response cannot resurrect expired authority. Replayed, wrong-session, wrong-operation, out-of-sequence, extra-field, and malformed renewals fail closed.

The expiry timer runs independently of the controller. Before forwarding every protocol request to the container, the guardian checks the monotonic lease, original deadline, session connection, and stop state synchronously. The same check fences creation and attachment. A pending timer does not grant a request a grace period. Cancellation and write frames also carry the private session nonce.

## Stop and cleanup

Loss of renewal stops the owned container through the existing ownership checks. Cleanup still requires the persisted exact CID, immutable launch, exact inspect result, container absence, and attached-process reaping. No container is adopted or deleted merely by matching a name or public label. An unknown create result, corrupt ownership journal, daemon failure, or lost cleanup observation remains uncertain. Durable discovery is held for reconciliation and cannot be blindly redispatched.

A revocation committed just after a successful authority check can leave the previous lease valid for the remaining part of its 2,000 ms challenge window. The interval is a revocation response bound on a responsive guardian, not instantaneous revocation or a two-second container-removal guarantee. Docker cleanup has separate existing command bounds. Simultaneous guardian loss, host suspension/restart, daemon unavailability and unknown create identity remain explicit limits. The trusted supervisor/controller host process can supply authority callbacks; the private IPC nonce is session binding, not a new remote identity service.

## Evidence fields

The existing private ownership journal includes a `lease` snapshot on its ordinary durable stage writes. It is not rewritten for every renewal, so observers must use the final journal for the final accepted sequence and cleanup observations:

| Field | Meaning |
| --- | --- |
| `sequence` | Last accepted challenge sequence. |
| `lastRenewedAtMs` | Guardian wall time when that response was accepted. |
| `expiresMonotonicMs` | Guardian-local monotonic expiry for that lease. Never compare to a wall timestamp or another process clock. |
| `stopRequestedAtMs` | Guardian wall time when cleanup was first requested. |
| `containerAbsentAtMs` | Guardian wall time after exact-ID absence was verified. |
| `attachReapedAtMs` | Guardian wall time when its attach child closed. |

Nullable fields remain null when that event did not occur. The original `deadlineMs` is unchanged. These fields do not claim when a database stop/revocation committed; the controller proof records that separately.

## Validation scope

Focused offline tests exercise durable rechecks after cross-controller stop, revoked grants, owner epoch changes, approval/principal expiry, mismatched intent and database failure; late callback completion; missing, delayed, replayed and wrong-session renewals; monotonic request fencing before the timer runs; and absolute-deadline preservation. Guardian tests fork the real guardian with a mocked Docker process boundary, never a real container. Root-owned live PostgreSQL/Docker and installed-package proofs are separate acceptance evidence and must be revision-bound before this slice is treated as accepted.
