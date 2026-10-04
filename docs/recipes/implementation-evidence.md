# Recipe implementation evidence

This page preserves historical author and repair records. Read [the later live result](live-acceptance.md) for the completed prepared trial.

Author verification, October 2, 2026. Source parent: `79297aa0ed8ebdeca70032db157f8d01fcf39292`. This is a new recipe slice; earlier craft-shop, DBOS, and consumed live evidence are unchanged.

Pinned direct libraries: `@langchain/langgraph` 1.4.18, `@langchain/langgraph-checkpoint` 1.1.5, `@langchain/langgraph-checkpoint-postgres` 1.0.5, `@langchain/core` 1.2.14, `langsmith` 0.10.7, `pg` 8.16.3, and `@types/pg` 8.15.5. All transitive releases/integrities are in the lockfile. No provider or MCP SDK is added by this slice. Dependencies were installed into this task's own 110 MiB node_modules; canonical dependencies were not modified. The admission before installation reserved 0.8 GiB with 41.06 GiB free and a 12 GiB minimum.

The upstream declarations failed this repository's `exactOptionalPropertyTypes` checks before the change: `AIMessage` and `AIMessageChunk` usage metadata in Core; the Zod description constraint in LangGraph messages annotation; and `RunTree.events` in LangSmith. The lead approved `skipLibCheck:true` for dependency declarations. Strict source checking, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and all other source settings remain enabled. No opaque declaration shim or dependency source patch is used.

Run offline checks:

```sh
npm run build
npm run typecheck
node --test dist/tests/recipes.test.js dist/tests/recipes-github.test.js
```

The 21 offline cases cover scope/path validation; duplicate setup and stable identity; exact source bytes and declared citations; persisted in-memory review/restart composition; fake issuer/stale approval; draft/base drift; ambiguous branch/file/PR acknowledgements with no resend; cancellation; one-PR updates; draft-only checks; simultaneous runners; private installation validation; fixed GitHub API routes and non-force commit updates; Git symlink/submodule refusal; blob hashing; and explicit tracing behavior.

These tests use fake GitHub responses and in-memory control/checkpoint adapters. They prove control logic, not real GitHub permissions or PostgreSQL durability. The transport spy has a positive control. With optional tracing disabled the full synthetic graph has zero optional transport sends. With hostile ambient tracing enabled, the graph refuses before construction with zero sends. An earlier test detected blocked upstream LangSmith requests despite a false tracing context; the production refusal is retained and documented.

Real PostgreSQL proof is **pending independent execution**; the default test skip is not counted as acceptance. It uses the existing proof server, a selected database (default `postgres`), and two uniquely named owned schemas. It never changes the active demo schemas or uses a real GitHub connection:

```sh
TRELLIS_RECIPE_PROOF=trellis-alpha-proof@127.0.0.1:56582 \
TRELLIS_RECIPE_CREDENTIALS_FILE=/PRIVATE/original-proof-credentials.json \
node --test dist/tests/recipes-postgres.test.js
```

The protected credential file accepts the original proof `POSTGRES_PASSWORD` field or a `password` field. Optional `TRELLIS_RECIPE_TEST_DATABASE` names a pre-existing `trellis_*` test database. Six subcases check concurrent setup/claims, real LangGraph PostgreSQL review pause resumed in a fresh process, completion through a fresh store, lost commit acknowledgement, rollback/detachment, and corruption/version refusal. Cleanup drops only the two schemas created by the test and verifies absence. A bounded result is saved to ignored `packages/recipes/.trellis/postgres-result.json`.

Root owns real app-backed GitHub acceptance, CLI/MCP integration, and independent review. No GitHub mutation, model, browser or Docker lifecycle command was run by this author. The narrow alpha limitations remain: same-OS operator authority, exclusive reserved remote namespace, no automatic unknown-claim release, no distributed atomic transaction, no semantic claim verification, and no measured human-time or subscription-efficiency claims.

## Independent-review repair

The initial `18b23c69953b257bcbe6b43ef3effffaf11d3188` evidence above remains historical. Review demonstrated that matching draft bytes could hide an extra remote commit/path, both after a normal file response and after a lost response. The repair requires the exact approved commit parent and operation message, reconstructs the complete expected Git tree with just the approved path changed, and persists a commit/tree/blob receipt in a v2 job. Later PR dispatch, read reconciliation and revision planning check that receipt. PR responses now bind exact head/base SHAs. The old `force:false` comment was corrected: it is not an exact compare-and-swap.

The second finding was regex coercion of one-element arrays in PostgreSQL installation fields. Database, user and both schema fields now require actual strings; the exported schema validator rejects arrays directly. This is input validation evidence, not a demonstrated cross-schema write.

The repaired build, typecheck, diff whitespace check, and all **36 focused offline cases pass with zero skips**. New cases cover the exact normal/lost-response reproductions, a same-parent extra file, unrelated parent/message/tree changes, Git tree hashing against a Git-generated vector, a replacement same-content head after receipt persistence, immediate pre-PR create/update drift, legacy receipt-less job refusal, and coercible arrays. No dependencies or source compiler flags changed in the repair.

The initial six-case real PostgreSQL suite passed when run independently by the lead. The repair adds a seventh opt-in subcase proving both drift holds through fresh real PostgreSQL readers. That seven-case suite remains pending independent execution against this repair; the author did not access PostgreSQL or GitHub. The same command and isolated-schema cleanup procedure above applies. Existing author evidence is preserved; a separate ignored `packages/recipes/.trellis/review-repair/verification.json` records the repaired revision and source hashes.

The final remote race remains outside this adapter's guarantee: a concurrent writer can change the branch after the last read or after completion. The single-writer namespace assumption and the absence of atomic GitHub PR head/draft preconditions remain required. No migration or automatic adoption of v1 jobs is supplied.
