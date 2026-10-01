# Alpha subscription admission

`packages/admission` implements a strict capacity policy and a PostgreSQL account reservation ledger. This is a controller library with synthetic integration evidence. The production observation reader, process supervisor, crew scheduler, and live-model acceptance remain unconnected.

Every crew and role using one provider account must share one canonical account row in the same database and schema. The trusted controller registers aliases for that account. Separate schemas or databases do not coordinate capacity. A worker cannot choose an account binding, role, allowance, observation, or reconciliation proof and must receive neither database credentials nor launch permits.

## Explicit policy and observation contract

There are no subscription-tier defaults or calibrated token estimates. A controller supplies all of these inputs:

| Input | Behavior |
| --- | --- |
| `thresholdPercent` | Greater than zero and at most 95. Reaching the threshold refuses work. |
| `maxWorkers` | One or two active workers across all account aliases and crews. |
| `headroomPercent` | Capacity reserved for other activity. Leads, reviewers, support work, and retries also need their own explicit reservations. |
| `maxObservationAgeMs` | Maximum accepted sample age; there is no default freshness claim. |
| `admittedRoutes` | Exact model-route allowlist. The selected route must also have known window applicability. |
| `completedResetPolicy` | `hold`, or explicit `release-covered` after a nonoverlapping reset and fresh coverage evidence. |
| Per-job allowances | Positive percentages for every applicable reported window. No implicit allowance for an absent window. |

`AccountObservation` binds an authenticated account identity, subscription authentication state, ordinary-use permission, observation identity and timestamp, applicable route windows, and each reported percentage/reset/duration. The caller must authenticate and normalize these facts. This library validates their shape and ordering; it cannot establish the truth of a caller-supplied observation.

Missing, malformed, stale, future, expired, conflicting, and out-of-order observations fail closed. Window durations cannot change in this schema version. Required windows must be present. Optional windows must be explicitly reported or explicitly `null`; a missing key means unknown. `null` is an absence claim, never zero usage. If any existing reservation retains a window that disappears or becomes `null`, new admissions and launches are held as unresolved.

For each window, admission uses the highest reported percentage in its current reset interval, all retained allowances, headroom, and the proposed allowance. It refuses totals greater than or equal to the threshold. Percentage charges round upward to hundredths; the threshold rounds downward. These conservative arithmetic rules are not token calibration. Valid observations persist even when the request is refused, including an invalid paid-fallback request, so lower later reports cannot erase a previously observed high-water mark.

A new nonoverlapping reset can establish a new usage baseline. It does not erase reservations. A known absent optional window that has never been reserved stays absent and creates no synthetic zero-percent window.

`ObservationReader` is an interface only. No reader implementation or historical research helper is imported. In particular, an installed provider report must not acquire an invented `accountedThroughMs`: use `null` when the observer cannot attest that all usage through that instant is included. Report arrival time alone is not coverage evidence.

## Reservation and launch lifecycle

Create `PostgresAdmission(pool, { schema, launcherId, now })` in a trusted controller. The schema is explicit and begins with `trellis_`; `now` is optional and otherwise uses `Date.now`. `launcherId` must uniquely identify this controller process lifetime and must not be reused after restart. `createSchema` creates a new version-1 schema and registers canonical accounts and aliases. It does not modify an existing schema or perform an automatic migration. The caller owns its PostgreSQL pool and credentials.

`reserve(request, observation)` pins the account alias, job identity, candidate revision, model route, role, attempt kind, and window allowances. Paid fallback must be exactly `false`. All account mutations take a PostgreSQL row lock, validate versioned state and checksum, and commit with synchronous commit enabled before returning. Aliases resolve to that same row. Callbacks and returned views are detached from the stored request. A changed request under an existing job conflicts, including an alias or allowance change.

A newly accepted reservation returns one random launch permit after commit acknowledgement. Only its hash is stored. An exact retry returns `existing` without a permit, and lookup never exposes a permit or its hash. An existing result is a receipt, not permission to start another process. New authorized retry work needs a new job identity and explicit allowance.

`launchOnce(alias, job, permit, observation, start)` consumes that permit in a committed `LAUNCHING` record bound to `launcherId` before invoking the injected controller callback. The callback receives the pinned request and returns a bounded process reference. It must launch at most one process and must not schedule additional launches in the background. Successful recording changes the state to `RUNNING`. A racing or later call sees the consumed claim and cannot invoke another callback. Evidence that ages out during commit acknowledgement also prevents the callback and leaves the claim held.

| State | Worker slot, if role is worker | Allowance |
| --- | --- | --- |
| `RESERVED` | Held | Held |
| `LAUNCHING`, `UNKNOWN` | Held | Held; requires trusted reconciliation |
| `RUNNING` | Held | Held |
| `COMPLETED` | Released | Held until coverage requirements below pass |
| `CANCELLED` | Released | Released after trusted not-started reconciliation |

No time-to-live refunds a reservation. A failed commit acknowledgement raises `COMMIT_UNKNOWN`, discards the connection, and performs no automatic retry. The caller must not launch from that exception. Lookup can reveal committed state, but it cannot reissue a lost permit. A callback error or uncertain running-result acknowledgement raises `LAUNCH_UNKNOWN`; both `LAUNCHING` and `UNKNOWN` hold the slot. A durable `RUNNING` result also keeps the slot if its acknowledgement was lost.

`complete` requires a matching running process reference and a trusted completion proof. All of a completed job's retained allowances remain until **one later accepted observation covers every retained window** through the completion timestamp. An unknown/lagging coverage timestamp or partially covered set releases nothing. For a crossed reset, `release-covered` must additionally be selected; `hold` preserves completed allowances across that reset. A provider reader unable to attest coverage can leave completed allowances held indefinitely. This is an unresolved runtime input, not a reason to fabricate coverage.

## Explicit policy replacement

The trusted controller can call `replacePolicy(alias, expected, replacement)` after an operator authorizes a policy change. Workers must not receive this API or its database credentials.

The method compares the expected policy under the account lock. A conflicting policy causes `POLICY_CONFLICT`. An already matching replacement returns the current policy without another change.

The method preserves observations, usage history, aliases, reservations, and held allowances. It does not grant launch authority or clear an uncertain outcome.

An uncertain commit causes `COMMIT_UNKNOWN`. Read the current policy before another operation. The library does not retry automatically.

The schema permits an explicit 5 percent reserve. The example retains 25 percent. Hanna authorized 5 percent for this alpha campaign on October 1, 2026.

## Trusted reconciliation and launcher fencing

`reconcile(pinnedRequest, proof)` is a supervisor-only operation. A trusted `not-started` proof cancels a still-unused reservation. If an uncertain initial reservation commit left no row, that proof creates a cancelled tombstone, binding the job permanently. No reconciliation reissues a permit or makes the same job launchable again. A trusted completed proof can resolve a claimed process and retains its allowance for coverage.

A paused launcher is dangerous even if no process is visible yet. Before cancelling `LAUNCHING` or `UNKNOWN`, the proof must include `fencedLauncherId` equal to the persisted launcher identity. The supervisor must first terminate that launcher or enforce a durable fence that prevents it and its children or queued launch mechanisms from dispatching again; it must also establish that the job did not start. The proof timestamp must not be in the future or before the launch claim. A wrong or absent fence is rejected. A known `RUNNING` process cannot be labelled not started.

**The database verifies the identity binding, not the truth of termination.** This package does not stop processes, authenticate supervisors, or implement an operating-system fence. Supplying a false matching attestation while an old launcher can resume is unsupported and can release capacity before that launcher starts work. A past observation of “no process” alone is insufficient. The runtime must keep these methods behind the trusted supervisor boundary and supply actual termination/fencing evidence before integrated live acceptance. Tests kill a synthetic launcher before supplying its matching fence; they also demonstrate that an unfenced or incorrectly fenced paused launcher cannot release its claim.

## Bounds and remaining integration work

The ledger is bounded to 1,024 jobs per account, 32 aliases per account, 32 named windows/routes, and 8 MiB serialized account state. Initial schema creation registers 1–16 canonical accounts. History is retained; this slice has no compaction, garbage collection, migration, or manual high-water reset. Unknown versions, malformed state, inconsistent job bindings, and checksum failures refuse work. Checksums detect accidental changes; they are not authentication against a database administrator.

Remaining runtime work includes the authenticated no-thread observation adapter, provider-specific applicability and coverage semantics, a process supervisor with distinct launcher identities and fencing, controller-only credential/permit boundaries, and a scheduler that reserves all model work through one ledger. There is no DBOS wrapper, command runner, API fallback, telemetry proof, or model execution in this slice.

Provider reports can lag, other clients can consume the same subscription, and running jobs can exceed their explicit allowances. Reservations coordinate this controller's planned work; they do not enforce provider quotas or guarantee that the selected reserve remains in a concurrently used account. Synthetic test allowances and ages must not be presented as Pro, 5x, or 20x subscription calibration.

## Reproduce the bounded tests

Pure tests and TypeScript build:

```sh
npm run test:admission
```

The database tests skip unless the exact proof endpoint marker is supplied. On the existing authorized local proof, use the ignored credentials file path; never put its contents into a command or log:

```sh
TRELLIS_ADMISSION_PROOF='trellis-alpha-proof@127.0.0.1:56582' \
TRELLIS_ADMISSION_CREDENTIALS_FILE='../alpha-backend/.private/credentials.json' \
npm run test:admission
```

This creates and removes only a unique `trellis_admission_test_<random>` database and its `trellis_admission_test` schema. It uses synthetic observations and callback counters, launches bounded synthetic Node test children, and kills only children it created. It does not change Docker lifecycle, existing proof databases, authentication, or protected projects. Local generated evidence is written to ignored `packages/admission/.trellis/test-result.json`.

The tests cover shared-account aliases, concurrent worker reservations, lead/review/retry capacity, all applicable windows, high-water persistence after refusal, freshness after a row-lock wait and commit acknowledgement, reset policies, incomplete coverage, disappearing retained windows, lost reservation/claim/running acknowledgements, two process-crash checkpoints with fresh-process replay refusals, fencing prerequisites, detached inputs, corruption, and zero callback starts on refusal. Independent review and runtime integration remain separate gates.
