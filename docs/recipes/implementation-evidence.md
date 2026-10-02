# Recipe implementation evidence

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
