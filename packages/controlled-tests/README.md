# Registered alpha acceptance

This package binds one automatic `craft-shop-ui-v1` test to a completed, exactly approved `workspace.write`. It implements authorization, a permanent dispatch claim, and immutable test evidence. A reviewed browser executor must be injected. This package contains no browser, shell runner, model call, or production fixture fallback.

The task must declare exactly one write and one `command.test` for `craft-shop-ui-v1`, require `approval.exact-revision`, `command.test`, and `workspace.write`, use required approval, and allow only one attempt with no backoff. Existing crew validation enforces declared scope and owner permissions. The model still proposes only the write. The test does not require a second founder approval.

## Manifest and executor

The `test-manifest` compiled asset must be `application/json`, with its digest and byte count matching the registered canonical manifest. Use `serializeTestManifest` to produce those exact bytes and `validateTestManifestPlan` when composing the bridge. `validateRegisteredManifest` rejects unknown fields, altered whitespace, duplicate keys, invalid digests, unknown tests, or excessive limits.

```ts
const manifest = serializeTestManifest({
  format: 'trellis/registered-test/v0.7-alpha',
  testId: 'craft-shop-ui-v1',
  testerDigest,       // Digest of the trusted registered tester.
  environmentDigest, // Digest of its pinned environment and fixed resource policy.
  criteria: ['add-job', 'change-stage', 'reload', 'export'],
  limits: { timeoutMs: 25000, outputBytes: 16384, artifactBytes: 65536 },
});
```

A manifest is registration metadata, not executable code. The controller must register a reviewed executor for those exact tester/environment digests. The executor must independently check that binding before launch. A caller cannot supply a command, shell, argv, URL, selector, executable path, or fallback implementation through this API.

`TestExecutor.execute(request, signal)` receives a frozen `TestExecution`. Its artifact content comes from the stored approved proposal and completed write receipt; it is never reread from a mutable workspace. `artifact.path` is provenance metadata, not permission to read a host path. The executor uses a private snapshot, fixed tester, and its pinned sandbox. It must enforce the deadline and combined output limit, own its child/container identities, retain terminal operation outcomes, measure scratch growth, and clean its private input/scratch. Fixed scratch capacity belongs to `environmentDigest` (the registered Linux browser uses 64 MiB). This package does not impose an OS memory or fork quota.

`reap(operationId)` may act only on that executor's recorded owned operation. It must also fence a pending spawn and resolve only after termination, reaping, and scratch/input cleanup are confirmed. It must reject uncertain cleanup. The broker bounds each cleanup wait to two seconds and quarantines its reader instance while an owned operation remains unresolved.

A `TestReport` must echo all request/artifact/manifest bindings and include four ordered criterion results, export digest/byte metadata, combined bounded stdout/stderr metadata, measured scratch growth, and confirmed scratch removal. The report must come through the trusted executor; model text is not evidence. `PASSED` requires every criterion, matching exit status, and a successful reap. `FAILED` retains the negative report. Invalid reports and uncertain execution become `HOLD`. Only the separately reviewed real browser implementation can establish the four UI behaviors; the package's `test/` executor is a synthetic policy fixture.

## Wiring and durable state

```ts
const store = new PostgresTestStore(pool, {
  schema: 'trellis_tests',
  brokerSchema: 'trellis_broker',
});
// Once, when explicitly provisioning a fresh namespace:
await store.createSchema();
const acceptance = new RegisteredTestAcceptance({
  store, manifest, executor: registeredBrowserExecutor, identity,
});
// Pass acceptance to SupervisedRuntime.open({ ...dependencies, acceptance }, options).
```

The PostgreSQL store shares the current broker task row lock with the test record. It validates broker and test schema markers, checksums, strict JSON state, exact scope, and immutable history. Callbacks are synchronous, invoked once, receive detached values, cannot publish authority mutations, and are never retried. Failed commit acknowledgement returns `TEST_COMMIT_UNKNOWN`, with no dispatch permission returned. Pools and provisioning remain controller-owned. Credentials, raw output, and owner authentication material are not persisted in test state.

The test ID is a digest of task scope and write operation key. The consumed `CLAIMED` record commits before execution. A fresh process seeing `CLAIMED`, `HOLD`, or `CANCELLED` never executes it again. Known terminal evidence is returned without repeating the test, subject to current authority and approval checks. Changing the launcher cannot release a claim. Unknown claims need explicit future reconciliation; no retry/reset API exists here.

Before claiming, immediately before dispatch, and before publishing results, the broker checks current candidate, owner/epoch, readiness/dependencies, cancellation, lease, task deadline, current approver membership, approval expiry and exact binding, completed write receipt, and artifact digest/size. The runtime supplies an additional coordinator guard and cancellation signal. A race after a check can stop an active operation, and prevents positive publication after cancellation or revocation. This is not atomic revocation of an already executing OS instruction.

## Runtime cancellation and evidence reading

The runtime calls `read(input, receipt, context)` with a controller-owned context containing `signal`, `guard`, `launcherId`, and the current owner credential. It registers that active acceptance call before its last guard. Runtime cancellation signals it, persists cancellation, invokes `acceptance.cancel(input, receipt)`, and waits for the hook and active read. Runtime close also signals active acceptance and invokes `acceptance.close()`. Coordinator lock loss reaches the same signal. Optional hooks keep existing read-only acceptance fixtures compatible; executors that can create processes must implement both lifecycle hooks, as `RegisteredTestAcceptance` does.

A result is `{accepted, evidenceRef}`. Retrieve its full immutable evidence with authenticated scope:

```ts
const operationId = testOperationId(scope, writeReceipt);
const evidence = await acceptance.readEvidence(scope, operationId, evidenceRef, ownerCredential);
```

The digest is not an authentication token. The current scoped owner must authenticate even when reading existing evidence. `inspect(scope, operationId, ownerCredential)` returns detached status or null. `close()` retries owned cleanup; it never releases or replays a consumed claim.

## Verification

`npm run test:controlled-tests` runs the policy cases and skips PostgreSQL unless the explicit proof marker is set. To enable the isolated real-store cases, use the already provisioned proof endpoint:

```sh
TRELLIS_TESTS_PROOF=trellis-alpha-proof@127.0.0.1:56582 \
TRELLIS_TESTS_CREDENTIALS_FILE=../alpha-backend/.private/credentials.json \
npm run test:controlled-tests
```

Those tests create and remove only a unique `trellis_registered_test_*` database, reuse no production state, and make no model/browser calls. Runtime acceptance lifecycle regressions use the existing isolated DBOS/PostgreSQL proof suite. The Linux browser package and local CLI now provide executor packaging, provisioning, and receipt presentation. Both live generated artifacts passed the registered craft-shop test. See [current evidence and limits](../../docs/alpha/acceptance-status.md); final independent alpha review remains pending.

A fresh controller uses the persisted write receipt to find an unfinished test. It reaps that exact operation without another execution. Unknown cleanup remains an error.
