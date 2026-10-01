# Synthetic supervised workflow

`packages/runtime` composes one approved task from a pinned compiled crew with the reviewed admission ledger, action broker, PostgreSQL stores, and registered-file effects. It uses `@dbos-inc/dbos-sdk` **5.2.11**, under its MIT license, without Conductor. This is the synthetic controller composition for the alpha. It does not connect Codex, implement the demo interface, or establish live-worker containment.

## Controller-owned interfaces

`SupervisedRuntime.open(dependencies, options)` receives explicit PostgreSQL and store dependencies, a model adapter, an observation reader, an identity provider, owner and recovery credentials, and a read-only acceptance reader. The caller provisions new schemas through `RuntimeLedger.createSchema` and the existing packages before opening the runtime. There is no automatic migration or adoption of unknown schemas. The pool and credentials remain caller-owned.

The runtime requires a loopback PostgreSQL system database and verifies that its lock connection addresses the same database as DBOS. All account aliases and crews sharing an account still need the same admission schema and canonical account row. `installationId` is stable; each coordinator has a new random `launcherId` for its process lifetime. The DBOS executor ID is stable for recovery and is separate from that lifetime identity.

`submit` pins the compiled plan, trusted task grant, task input, and reservation under the workspace/run/task identity. Changed content under that identity is refused. The existing broker validates the candidate digest, task permissions, owner epoch, lease, deadline, and dependencies. This slice runs one task at a time per workflow; it does not schedule a crew graph, resolve dependencies, or automatically retry model work.

Every model role goes through the existing account admission policy. A supplied role, route, allowance, input, observation, or identity proof comes from the trusted controller, never the worker. Test observations use explicit synthetic percentages and retain `accountedThroughMs: null`. Those values are not calibrated subscription profiles. The production no-thread observation reader remains separate.

The worker receives only a task string, model-route label, and a random process protocol token. It receives no database credential, approval credential, launch permit, or effect-dispatch authority. Its output is parsed as the broker's strict proposal and bound to the pinned scope, candidate, and epoch before preparation.

## Durable steps and replay

The DBOS workflow separates admission, proposal capture, broker preparation, durable approval wait, effect dispatch, and acceptance. Optional OTLP export and tracing are disabled, the admin server is disabled, and `DBOS.launch` receives no Conductor options. Ambient `DBOS__*` and Conductor-key overrides are refused. DBOS is a process-global SDK; this runtime expects a dedicated process. The SDK's published declarations reference an unbundled `@types/ws` dev dependency through Conductor. A local opaque declaration keeps that unused type unavailable without weakening repository-wide TypeScript checking.

An admission step can checkpoint its accepted one-time permit in the trusted DBOS database. That database is part of the credential boundary. Replayed proposal steps always inspect the durable runtime proposal and the admission claim. A stored proposal is reused; a consumed launch permit cannot start another process. If an admission commit or its step acknowledgement is ambiguous and no checkpointed permit exists, an `existing` reservation result supplies no replacement permit and the run stays held.

The runtime records process reference, random ownership-token digest, launcher lifetime, PID, process-group ID, reservation identity, and candidate revision. Reconciliation never operates from the PID alone. A recorded proposal precedes broker preparation. A recorded broker receipt precedes acceptance or a completed run result. The acceptance reader must be a bounded read-only check, without model calls or side effects; an interrupted acceptance step can repeat it.

After interruption during dispatch, the runtime asks the broker to recover and reconcile its existing action through the injected controller recovery identity. A persisted filesystem receipt is reused. An uncertain filesystem intent without a receipt stays held; the runtime does not apply it again. A lost runtime receipt acknowledgement can leave a `HOLD` containing the durable receipt. Status returns that receipt, but this slice does not automatically clear that hold or rerun acceptance.

A caught refusal or uncertain outcome is a durable run stop, not a successful task. DBOS may finish checkpointing that stop normally; use the runtime status and receipt, not the DBOS workflow status alone, to decide whether a task succeeded. Re-submitting the same run does not turn a durable hold into a retry. Operator reconciliation and new explicitly admitted retry identities remain later orchestration work.

## Approval, cancellation, and status

`approve` authenticates through the controller identity provider and forwards the exact candidate, action digest, owner epoch, and expiry to the existing broker. A DBOS wakeup carries no authority by itself. Dispatch rechecks the broker's durable approval. A stale approval or a worker-supplied credential is refused. Pending approval survives a process restart. The durable wait has a one-day upper bound; the broker's task/lease/approval deadlines still govern any attempted dispatch.

`cancel` records cancellation and signals any pending or active capture before waiting for its owned worker to stop. Pending approval cannot dispatch afterward. A still-unused reservation may be cancelled as not started. Once a process could have run, successful termination/reaping records a completed usage outcome; it does not claim that no usage occurred. Completed allowances remain held because these observations provide no accounting-coverage evidence. An uncertain termination or foreign lifetime's claim is not refunded.

`status` returns the durable run, its admission reservation, and `allowanceHeld`. `COMPLETED` requires a stored receipt and accepted read-only evidence. `WAITING_APPROVAL`, `CANCELLED`, `ACCEPTANCE_FAILED`, and `HOLD` are distinct. `FOREIGN_LAUNCHER_RECONCILIATION_REQUIRED` identifies an interrupted prior lifetime that cannot be relaunched. Accepted proposals can still be inspected if model completion evidence was interrupted; a remaining account hold is visible through the reservation and `allowanceHeld`.

## Coordinator and synthetic process boundary

One dedicated PostgreSQL session holds the installation advisory lock. A second coordinator is refused. Lock connection errors or a missing lock abort the coordinator signal. Operations recheck the lock, including **inside the consumed admission claim immediately before creating a child**. The synthetic adapter checks that signal again synchronously before spawn. Filesystem dispatch combines the broker cancellation signal with the coordinator signal. A 500 ms health poll supplements these checks; the lock session has a bounded statement timeout.

This is fail-closed controller behavior, not an operating-system fence. A stopped event loop, delayed connection-failure notification, or another same-user process can exceed what a PostgreSQL lock proves. A replacement coordinator does not kill or adopt a prior process from stored PIDs and does not release a foreign claim based on a guessed death. Claims remain in the admission ledger. Production takeover requires an external guardian or verifiable termination/fencing mechanism and the live harness's worker restrictions.

`SyntheticProcessAdapter` uses an explicit immutable command array, no shell, an explicit directory, and an empty environment. It owns the child handle and a detached process group. Task input is limited to 64 KiB, captured stdout plus stderr to the explicitly supplied limit (at most 2 MiB), and elapsed time to at most 30 seconds. At most two capture operations may be active in this runtime. A model adapter must create at most one owned group per call and check cancellation immediately before spawn. On timeout, overflow, abort, or cancellation the synthetic adapter signals its owned group, waits for the child to close, and verifies the group is absent before accepting termination. Process identity also includes the random protocol token digest and launcher lifetime; the API has no arbitrary PID-kill operation.

These bounds cover trusted synthetic commands. This is not a general command runner, hostile subprocess sandbox, network filter, or kernel-enforced descendant limit. The fixtures intentionally spawn at most one extra descendant to test group reaping and contain their own orphan guard. That fixture guard is not a production orphan supervisor. A production model adapter must add native tool denial, network restrictions, an orphan guardian, and safe process identity/fencing before live acceptance. No claim here establishes hidden-tool denial, telemetry absence, or live-model containment.

## Reproduce evidence

```sh
npm run test:runtime
```

Without the exact marker, PostgreSQL/DBOS integration tests are skipped. On the existing authorized local proof:

```sh
TRELLIS_RUNTIME_PROOF='trellis-alpha-proof@127.0.0.1:56582' \
TRELLIS_RUNTIME_CREDENTIALS_FILE='../alpha-backend/.private/credentials.json' \
npm run test:runtime
```

The integration suite creates only uniquely named `trellis_runtime_test_<random>` databases on the established loopback endpoint, plus fresh private synthetic directories. It removes each database and directory and closes/reaps only the test processes it created. It does not start Docker, alter existing databases, change authentication, listen on a public port, invoke a model, or call a paid service. Local runtime evidence is ignored under `packages/runtime/.trellis/`.

Evidence includes a second-coordinator refusal, real DBOS fresh-process recovery at proposal/effect/receipt acknowledgement gaps, pending approval persistence, stale and unauthenticated approval refusals, no launch after denied admission, a foreign launch claim held without refund, cancellation of a two-member owned process group, lock-session loss, pending cancellation, an uncertain filesystem intent held across restart, existing receipts without file rewrites, and process timeout/output bounds. Review this exact implementation independently before connecting a live adapter or changing the CLI.
