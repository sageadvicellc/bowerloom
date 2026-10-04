# Alpha graph execution

`packages/graph` is a bounded sequential graph driver with a PostgreSQL store. It connects a compiled portable crew to an injected task-runtime interface. It launches no process, invokes no model, reads no source files, grants no approval, and dispatches no effect.

## Supported execution profile

Each task must declare exactly one `workspace.write` effect, exactly one output, and at most one registered test effect. The declared write path is treated as the exact destination file, not a directory grant. Every task requires exact-revision approval and one attempt with no backoff. The supported capabilities are `workspace.write`, `approval.exact-revision`, and the optional registered `command.test`. A test effect requires HTML output and the exact `craft-shop-ui-v1` manifest. Arbitrary commands, read effects, unapproved tasks, multiple writes/outputs, implicit retries, and nested artifact types are rejected before submission.

The driver accepts the existing `CompiledPlan`, verifies its exact format and compiler version, checks its candidate digest, validates its definition, recomputes its graph order and layers, and checks every compiled asset entry against the definition. A trusted caller supplies the UTF-8 content of every asset, including prompts and skills, and runtime owner bindings. Asset content must match its pinned digest and byte count. Owner subjects and epochs are runtime inputs, outside the authoritative portable crew definition. A candidate digest proves content consistency; it is not an authorization signature.

The older `examples/endor` remains an offline compiler example outside this execution profile. `examples/endor-alpha` supplies the prepared two-task demo. Its live Emery-to-Coda handoff passed exact approvals and real browser acceptance; see [current evidence](acceptance-status.md).

Limits are 32 tasks, 1 MiB for the complete graph submission, 512 KiB of source asset content, 64 KiB per output artifact, and 8 MiB of stored graph state. JSON snapshots are additionally capped at 100,000 nodes and 40 structural levels. Values must be bounded ordinary JSON without accessors, cycles, reserved object keys, invalid UTF-8, or NUL characters. Arrays have at most 256 values; typed values are at most eight levels deep. These conservative limits can be changed only with corresponding validation and acceptance tests.

## Typed handoff

Every task input comes from a pinned asset or the single output of a declared dependency. No task runs until all of its dependencies have completed with accepted evidence. A deterministic topological order chooses one task at a time, including when multiple tasks are ready. An unrelated ready task does not bypass a preceding hold or failure.

The executor returns the existing broker proposal, accepted effect receipt, and an acceptance evidence reference. The graph checks the execution identity, request digest, candidate revision, workspace/run/task scope, owner epoch, exact output path, action and operation digests, before/after digests, and byte count. The executor must obtain these facts from the trusted runtime's durable state, not worker claims. A structurally valid receipt is not independently authenticated by this library.

For an `artifact` output, the proposed UTF-8 file content is the value. The handoff includes its declared media type, exact path, content digest, byte count, and content. For a string, number, integer, boolean, array, or record output, that same approved file must contain the value as canonical JSON, without extra whitespace or duplicate fields. The driver parses it, checks the complete declared type, and preserves both the value digest and the written artifact's digest. Record fields must match exactly; there are no implicit conversions or optional fields.

An invalid or conflicting observation produces a durable hold and publishes no new downstream output. Completed observations and their validated handoffs are immutable. Stale status readers cannot replace them with a running state. The original receipt is retained when conflicting completion evidence holds the graph.

## API and durable store

```ts
const store = new PostgresGraphStore(pool, 'trellis_graph');
await store.createSchema(); // Once, for a new schema only.
const graph = new GraphDriver(store, taskExecutor);

const submitted = await graph.submit({
  workspaceId, runId, plan,
  assets: verifiedSourceContents,
  owners: { coda: { subject: 'agent:coda', epoch: 1 },
            emery: { subject: 'agent:emery', epoch: 1 } },
});
const id = submitted.state.id;
await graph.advance(id);
const current = await graph.status(id);
```

`submit` only stores a pinned graph. An exact duplicate returns that graph. Changed content under the same workspace/run identity is refused. `advance` performs at most one new task submission or one inspection of an already claimed task. A separate call is needed to claim the next task. `status` reads the stored graph; it does not poll or launch a runtime. Every returned view is detached from storage.

`PostgresGraphStore` uses synchronous commits, row locks, a transaction advisory lock covering missing-row creation, schema versions, and state checksums. Callback exceptions roll back; callbacks are synchronous and are never retried by the store. Inputs and results are detached. Unknown versions, malformed states, and checksum mismatches fail closed. A lost commit acknowledgement raises `COMMIT_UNKNOWN` and discards the connection. The store never substitutes a successful result after an uncertain commit. A transaction or aggregate storage-limit exception returns no successful advance; the caller must stop scheduling and inspect the retained state. It must not treat an exception as permission to launch or clear a claim. Checksums detect accidental changes and do not protect against an authorized database administrator.

`GraphStore` also publishes the equivalent durable transaction contract for other implementations. An in-memory implementation is used only in deterministic tests. The PostgreSQL implementation is usable now; there is no automatic schema adoption, migration, compaction, or deletion interface. The caller owns the database pool and credential boundary.

## Restart and scheduling cancellation

Before calling `TaskExecutor.submit`, the driver commits a permanent task claim bound to the full request and execution identity. A fresh driver or coordinator never submits that consumed claim again. It can inspect the existing runtime through that same identity. A missing status, failed status read, ambiguous submission acknowledgement, invalid result, runtime `HOLD`, cancellation, or failed acceptance blocks all further task claims. There is no automatic hold-clear operation or retry. A separately authorized retry needs a new graph/run identity and new runtime admission.

An interrupted driver can therefore resume a known existing task, but it cannot silently fill a gap by launching another task. If it dies after claiming and before submitting, status inspection finds no runtime and the graph stays held. A failed claim commit acknowledgement invokes no executor callback; a fresh process only inspects the claim if it committed.

`graph.cancel(id)` is a durable **scheduling stop**, not process termination. It prevents later claims, preserves every consumed claim and observed result, and survives restart. A claim that committed before cancellation already authorized its handoff; an in-flight submission can still finish. The caller must separately cancel that runtime task through the runtime controller. The local CLI coordinates graph cancellation and runtime cleanup, retaining errors when termination is uncertain. This package never refunds admission allowance, kills a process, or reissues a consumed claim.

Concurrent coordinators cannot obtain two submissions for one claim. A concurrent inspector can see an absent runtime while the original handoff is still pending; the graph then conservatively holds. Use the existing single supervised coordinator for normal operation. A graph-store lock is not a process fence or proof that a prior controller died.

## Mapping to the supervised runtime

The task bridge is controller-owned. `ExecutionRequest` carries the pinned plan and source snapshots, workspace/run/task identity, owner ID/subject/epoch, completed dependencies, typed inputs, and a content-bound execution ID. The bridge must map these exact fields into the supervised runtime's task grant, bounded task input, and subscription reservation. It must use the execution ID for a stable reservation job identity and keep route, allowance, approvers, leases, observations, and credentials behind the existing controller boundary.

The bridge must check the runtime's own input bounds before submitting; the graph's aggregate source limit is not a promise that all source text fits in one 64 KiB runtime task string. It must not truncate or change typed input values. The runtime bridge checks the stricter 32,768-byte native prompt bound and refuses oversized input without truncation. The bridge must also enforce the pinned crew budget through the existing admission policy; graph ordering is not subscription admission.

`TaskExecutor.submit(request)` hands a task to that durable runtime once. `inspect(request)` reads the corresponding stored run. It returns `COMPLETED` only for runtime completion with a stored proposal, receipt, and accepted evidence. DBOS `SUCCESS` alone is insufficient. Runtime `HOLD`, `CANCELLED`, and `ACCEPTANCE_FAILED` remain those statuses. A noncompleted runtime receipt remains inspectable in the runtime; it is never promoted to a graph output. The bridge must verify the request binding when looking up a run rather than echoing arbitrary worker data.

The runtime bridge and local CLI provide the sequential execution loop and exact approval interface. Runtime adapters retain launch and effect authority. Parallel scheduling, automatic approval, arbitrary test commands, and automatic model-class routing remain unsupported.

## Test the component

```sh
npm run test:graph
```

Without the exact marker, the database test is skipped. On the existing authorized local proof:

```sh
TRELLIS_GRAPH_PROOF='trellis-alpha-proof@127.0.0.1:56582' \
TRELLIS_GRAPH_CREDENTIALS_FILE='../alpha-backend/.private/credentials.json' \
npm run test:graph
```

The real database tests create and remove one unique `trellis_graph_test_<random>` database. They cover competing clients, typed dependency handoff, lost claim acknowledgements, fresh-process refusal to replay, rollback, cancellation, corruption, detached values, void results, and rejection of asynchronous mutation. Credentials are read into memory and passed to the owned recovery fixture through private IPC. They are not printed or placed in command arguments. No model or Docker lifecycle operation occurs.
