# Controlled action policy in alpha

This slice implements broker policy and effect receipt logic. An action broker authorizes a proposed operation before dispatch. A receipt records an operation that an effect adapter confirms. The included adapters use synthetic memory state. They provide no filesystem, process, network, or durable storage enforcement.

Alpha issue [#11](https://github.com/sageadvicellc/trellis/issues/11) remains open until real adapters and containment pass separate acceptance. No live model session runs in this slice. No command runner, filesystem writer, or shell entry point exists here.

## Implemented boundary

The broker accepts a closed JSON proposal for one `workspace.write` operation. The proposal names a workspace, run, task, request ID, candidate revision, and ownership epoch. An ownership epoch identifies one period of task ownership. The edit includes a relative path, complete UTF-8 text, and the expected prior digest. A null prior digest requires an absent file.

Each edit contains at most 256 KiB of text. Each serialized proposal contains at most 2 MiB. Each task retains at most 128 proposed actions. Paths use the portable source restrictions. Unknown fields, unsupported operations, invalid digests, and malformed Unicode fail before admission.

The broker reads task permissions from the trusted compiled candidate. A path must fit a declared task write effect. A grant for `output/job-board` excludes `output/job-board-other`. The compiled task determines whether the action requires separate approval. The coordinator must accept the source candidate before it creates a task grant.

Task grants name the active owner, epoch, candidate, readiness time, lease expiry, completed dependencies, and authorized approvers. The broker refuses missing readiness evidence, stale ownership, expired leases, expired task deadlines, and cancelled tasks. Grant creation makes sure that the compiled candidate digest matches its content. A content digest does not authenticate the source publisher.

## Identity and exact approval

Every broker method requests an identity through `IdentityProvider`. The provider returns an authenticated subject, proof reference, and expiry. The broker checks authority and expiry again inside the storage transaction. Caller-supplied owner labels and action fields cannot authenticate a subject.

This slice defines the identity interface but supplies no production identity provider. The tests use explicitly synthetic credentials. The future provider must protect credentials and bind its proof to the authenticated session. Workers cannot control this provider or its subject mapping.

An approval binds the workspace, run, task, request ID, candidate revision, action digest, ownership epoch, approver, proof reference, and expiry. The action digest covers all proposal fields, including the new bytes and prior digest. Changed content requires a different action and approval. Reusing a request ID with different content fails.

Approval expires within 15 minutes and within the identity proof, task deadline, and ownership lease. Missing, expired, revoked, or mismatched approval stops a task that requires approval. Removing an authorized approver also invalidates that approval. Revocation cannot undo an effect that already entered dispatch.

The broker recalculates the stored action digest and operation key before use. The operation key identifies the same effect across repeated requests. Returned records are detached from stored state. A caller cannot edit returned bytes to change an approved action.

## Dispatch and outcomes

One transaction makes sure that ownership, scope, readiness, cancellation, time, and required approval permit dispatch. It records `IN_FLIGHT` and the operation key before the effect adapter receives the action. The storage implementation must commit that intent before it resolves the transaction. A failure before confirmed commit prevents the adapter call.

The broker never dispatches an action that is already in flight or needs reconciliation. Repeated completed requests return their recorded result. Reconciliation means resolving an uncertain effect through authoritative evidence. An absent receipt does not establish that an effect failed to occur.

| Status | Meaning |
|---|---|
| `PREPARED` | A scoped proposal exists but has not entered dispatch |
| `IN_FLIGHT` | The store recorded dispatch intent |
| `COMPLETED` | The broker accepted a matching receipt |
| `NOT_APPLIED` | The adapter authoritatively rejected the prior-content precondition |
| `NEEDS_RECONCILIATION` | Dispatch lacks an accepted outcome |
| `CANCELLED` | Cancellation stopped an action before dispatch |

A receipt binds the operation key, action digest, workspace, path, prior digest, resulting digest, byte count, and effect time. Invalid or mismatched receipts cannot prove completion. The broker retains an uncertain outcome when the adapter throws, times out, or returns unusable evidence.

`WorkspaceEffects.lookup` supplies authoritative receipts during reconciliation. The broker does not accept completion evidence directly from worker proposals. Missing or failed lookup keeps the hold. No automatic retry follows an uncertain outcome. `NOT_APPLIED` also remains terminal for that request.

A real adapter must make the prior-content comparison and write indivisible for competing writers. It must retain operation receipts and prevent conflicting reuse of operation keys. A negative result must rule out both existing and future effects for that operation. The memory adapter demonstrates these semantics only within its synthetic state.

The memory adapter retains terminal negative outcomes as well as successful receipts. Repeated delivery returns the retained outcome, even after another writer changes the path. Conflicting reuse of an operation key fails.

## Cancellation and deadlines

Cancellation first records the task request in storage. Prepared actions become `CANCELLED`. Future proposals and dispatch attempts stop. The current broker instance also sends an abort signal to its active adapter calls.

Local interruption includes calls whose records entered reconciliation during recovery. A changed durable status does not remove an active call from cancellation.

Each dispatch deadline is the earliest task deadline, lease expiry, or task attempt timeout. The deadline alarm stops the broker wait and requests interruption through an abort signal. It does not terminate an arbitrary process or undo a write. A real adapter and supervisor must prove those controls separately.

Cancellation after dispatch can coexist with a completed effect. If the call lacks an accepted receipt, the broker retains an uncertain outcome. Later receipt lookup can establish completion while the task cancellation request remains recorded. The broker never labels cancellation as rollback.

An independent broker instance observes stored cancellation before new dispatch. It cannot directly interrupt another process through the local abort map. Cross-process interruption and process-tree cleanup remain adapter requirements.

## Storage and recovery contract

`BrokerStore.transaction` must isolate concurrent updates to one task scope. It must make the update indivisible, commit before success, and roll back callback failures. It must return detached records. Cancellation, approval changes, ownership changes, and dispatch admission use this same authority.

The store must protect pinned action content and trusted task grants from workers. A production store must retain committed intent, approvals, cancellation requests, and receipts across process loss. It must never replace unavailable state with empty state. Cross-process and database behavior remain unproved here.

`InMemoryBrokerStore` serializes synthetic transactions and demonstrates rollback. Two broker objects can share it for concurrency tests. It loses everything when the process exits. Supabase and DBOS integration remains separate from this slice.

An authorized recovery call moves interrupted `IN_FLIGHT` actions into `NEEDS_RECONCILIATION`. The broker does not infer non-execution from a restart. A receipt lookup can restore a completed outcome without another effect call. Missing evidence leaves the action held for operator resolution.

The broker stores action bytes and approval references as operational data. A production store needs access controls and lifecycle rules for those records. The package contains no optional telemetry sender.

## Integration interfaces

The coordinator owns task admission and creates a trusted `TaskState` from a compiled plan. `ActionBroker` uses injected identity, storage, effect, and clock interfaces. This keeps storage adoption and platform containment separate from policy logic.

| Interface or method | Responsibility |
|---|---|
| `createTaskState` | Construct an initial task grant from the trusted candidate |
| `IdentityProvider.authenticate` | Establish the caller identity outside model control |
| `BrokerStore.transaction` | Supply authoritative serialized task state |
| `prepare` | Store a bounded proposal and its digest |
| `approve`, `revokeApproval` | Record or revoke exact action approval |
| `dispatch` | Admit an action once and evaluate its receipt |
| `cancel` | Record cancellation and signal local adapter calls |
| `recover`, `reconcile` | Hold interrupted work and retrieve authoritative receipts |
| `inspect` | Return action records to an authorized owner or approver |
| `WorkspaceEffects.apply`, `lookup` | Apply bounded effects and retrieve their receipts |

This package does not create task grants from worker messages. It does not supply a public network endpoint. The coordinator must keep credentials, policy state, and effect adapters outside worker reach. It must also enforce account admission, task attempt limits, and artifact acceptance.

No existing contract API changed. The broker adds no dependency downloads. Its workspace package and lockfile entry use the existing build.

## Codex evidence and remaining controls

Local inspection on October 1, 2026, reports `codex-cli 0.157.0`. The `codex exec --help` output lists strict configuration, ignored user configuration, ignored rules, structured output, and sandbox modes. These are observed interfaces. They do not prove an effective execution boundary.

The checked harness evidence records configuration precedence and network-proxy hazards. Older sandbox configuration can override permission profiles. Domain restrictions require an active network proxy. The source documents are [Codex permissions](https://learn.chatgpt.com/docs/permissions) and [Codex App Server](https://learn.chatgpt.com/docs/app-server). The transition [evidence index](../transition/evidence-index.md) retains the research scope.

A declared test command cannot establish process or network containment. The broker refuses `command.test` proposals in this slice even when the portable graph declares that capability. A later adapter must provide a reviewed execution path before that capability can run.

Before a live runtime claim, the adapter must pass the following gates:

1. Bind the generated policy to the actual harness and inspect its effective configuration.
2. Deny native write tools, unmanaged subprocesses, and alternate tool paths outside the broker.
3. Deny unmanaged network access and limit any required provider connection.
4. Keep credentials and authoritative broker state outside worker reach.
5. Prove scoped workspace edits, path defenses, and atomic prior-content comparison.
6. Prove process interruption, deadline enforcement, ownership fencing, and cleanup after cancellation.
7. Repeat receipt, restart, stale approval, and storage-failure cases with persistent state.
8. Establish fresh account admission before any model session starts.

The synthetic broker does not satisfy these gates. Issue #11 remains open, and alpha release readiness remains unclaimed.

## Repeat the policy tests

Use Node 24.11.0 and the installed locked dependencies from the monorepo root.

```sh
npm run build
node --test dist/tests/broker-policy.test.js
npm run typecheck
```

The suite uses synthetic data, a deterministic clock, and memory adapters. It covers exact approval, denial, stale grants, concurrent dispatch, competing writes, cancellation, deadline alarms, uncertain outcomes, and storage failures. The broader `npm test` command also runs the portable definition suite. These results establish policy behavior within the tested storage and adapter contract.
