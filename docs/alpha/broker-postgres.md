# PostgreSQL broker state adapter

`packages/broker-postgres` implements the existing `BrokerStore` contract with PostgreSQL. This bounded alpha slice persists broker state; it does not connect the production CLI, DBOS, or a real filesystem effect adapter. It was built from integration revision `6481373489ce69775c9844858edd3c43bfa0660d`.

## Use

Create a `pg` pool with explicit connection settings and bounded connections. Pass it to `new PostgresBrokerStore(pool, { schema: 'trellis_broker' })`. The caller owns authentication, TLS policy, pool error handling, and `pool.end()`. The adapter does not read environment variables or credentials.

Call `createSchema()` once to provision a new namespace. It refuses an existing schema and performs no automatic migration. Open an existing namespace by constructing another store with the same schema. Schema names must start with `trellis_` and contain only the bounded lowercase identifier characters accepted by the adapter.

`seed(state)` inserts a trusted `createTaskState(...)` result and rejects an existing scope. `read(scope)` returns detached state. `transaction(scope, callback)` locks the matching workspace/run/task row, passes a detached draft to a synchronous callback, validates and serializes the modified state, then commits before resolving with a detached result. A callback can return plain JSON or `undefined`. Functions, shared memory, getters, cycles, lossy values, and asynchronous results are refused. Callbacks must only change the supplied draft; rejecting an async callback cannot undo unrelated JavaScript side effects it already started.

## Transaction and validation boundaries

Each operation checks schema version 1. Each row carries state version 1 and a checksum. Unknown versions, missing metadata, malformed fields, unknown action statuses, invalid scopes, and checksum mismatches are refused. Validation reuses the exported task schema and checks proposal digests, request and scope links, approval bindings, receipt contents, and action-state consistency. JSON state and callback results are capped at 40 MiB, with bounded structure depth and width. The broker's smaller per-action limits still apply.

An empty persisted approver list is valid after the last approver is revoked. Existing approval records remain auditable, but cannot authorize dispatch once their subject is absent from that list. The initial task factory still requires an approver; persistence does not reapply that creation requirement to later revocation states. Identifier validation and positive lease intervals remain required.

All statements for an operation use one checked-out client. Mutations use `FOR UPDATE`; reads use `FOR SHARE`. The adapter requests `READ COMMITTED`, synchronous commit, a 5-second lock timeout, and 10-second statement and idle-transaction timeouts. A thrown callback, unsupported asynchronous result, serialization error, or pre-commit SQL failure rolls the transaction back. A failed rollback discards the connection. There is no automatic transaction retry.

Any exception after issuing `COMMIT` produces `COMMIT_UNKNOWN` and discards that connection. The transaction may already be durable. The caller must inspect the scoped durable record and reconcile the operation; it must not automatically rerun the callback or external effect. A lost acknowledgement is not proof that rollback occurred.

Database permissions remain part of deployment. This adapter trusts its caller and database, and supplies no tenant authentication or RLS policy. Checksums detect corruption; they are not signatures against a privileged writer who can recompute them. Full compiled-plan provenance remains the trusted coordinator's responsibility. Synchronous callbacks are trusted code, not an OS containment boundary.

## Reproduce the local proof

The dependency is pinned to `pg` 8.16.3. The measured host used Node 24.11.0 and PostgreSQL 17.6 in the existing `trellis-alpha-proof` installation. The test does not start, stop, or reconfigure that installation.

From the monorepo root, run `npm ci --ignore-scripts --no-audit --no-fund` after disk admission, then `npm test`. Without the explicit proof target, the PostgreSQL integration case is skipped and cannot count as database verification.

To run against the existing local proof, supply the path to its private JSON credentials file, containing `POSTGRES_PASSWORD`:

```sh
TRELLIS_BROKER_PROOF=trellis-alpha-proof@127.0.0.1:56582 \
TRELLIS_BROKER_CREDENTIALS_FILE=/absolute/private/credentials.json \
npm run test:broker-postgres
```

The fixed test target is loopback port 56582. The test requires an account capable of creating a database and uses the proof's existing `postgres` account. It creates a unique `trellis_broker_test_<16 hex digits>` database and the exact `trellis_broker_test` schema inside it. It drops only that database, and only after successful creation during this run. No proof tables, containers, volumes, or other databases are changed. Process-restart checks kill only children created by the test. Credentials stay in memory and travel to those children through private IPC, not arguments or logs. Test results contain no credentials and are written to ignored `packages/broker-postgres/.trellis/test-result.json`.

## Observed result and remaining gates

On October 1, 2026, the full test command with the target enabled passed 148 tests with no skips after the PG1 repair. The PostgreSQL parent case and its 11 subcases completed in about 1.18 seconds; the whole Node test run took about 1.35 seconds, excluding TypeScript compilation. These are single-run observations, not throughput or latency guarantees.

Two distinct database clients performed 40 same-scope increments without lost updates. A held row lock blocked the matching callback while another scope progressed. Callback throws, async rejection, malformed state, non-detachable results, and an injected PostgreSQL serialization failure rolled back. An injected lost acknowledgement after a real commit produced one callback and one commit attempt; durable state was visible afterward. Fresh processes retained a committed ownership epoch of 7 and discarded a killed uncommitted change to 99. The synthetic approval and receipt lifecycle also persisted successfully. The temporary database occupied about 7.5 MiB and was removed.

The revocation regression removed the final approver from an already approved action. Another client and a fresh process read the empty list. Dispatch in that fresh process returned `APPROVAL_REQUIRED`, left the action prepared, and called no effect adapter. Invalid approver types, malformed subjects, and an invalid lease interval still rolled back. The pre-repair reports are retained under the ignored `.trellis/history/10f217c5b7a856de8707ff3f8f06cf3a4c9570bd/` directory within this package.

Real side-effect replay, complete broker enforcement, live Codex operation, server restart/failover, production credentials and role provisioning, and complete alpha acceptance remain open. This slice adds no DBOS wrapper and no filesystem adapter.

The transaction and locking choices follow the official [node-postgres transaction guidance](https://node-postgres.com/features/transactions) and [PostgreSQL 17 locking documentation](https://www.postgresql.org/docs/17/explicit-locking.html).
