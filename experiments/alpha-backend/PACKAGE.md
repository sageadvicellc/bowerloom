# Experimental local backend proof

This directory contains a reviewed macOS backend experiment. It is not the production Trellis CLI or a complete Supabase installation. The original experiment demonstrated local PostgreSQL, authenticated Studio, and DBOS recovery with synthetic data. Packaging does not repeat or expand that result.

## Fixed local target

The scripts always select the local Docker context `desktop-linux`. The original project is `trellis-alpha-proof`. The disposable fresh project is `trellis-alpha-proof-fresh`. These names identify the same Docker resources from every checkout.

Another checkout can therefore address an existing proof installation. Never run two copies as separate installations. Do not copy another checkout's `.private` directory. A different credential file can conflict with the existing database.

The gateway publishes `127.0.0.1:56581`, and PostgreSQL publishes `127.0.0.1:56582`. Existing use of these ports blocks preparation. The scripts do not select replacement ports or project names automatically.

Preparation and lifecycle changes require this explicit acknowledgment:

```sh
export TRELLIS_PROOF_TARGET=trellis-alpha-proof@desktop-linux
```

Set this variable only when you intend to operate that fixed project from this checkout. The variable does not create an independent installation. The guard prevents accidental lifecycle commands. It is not an authorization or isolation boundary for untrusted code.

## Prerequisites

Use macOS, Node 24, Python 3, and Docker Compose. The local Docker context must be `desktop-linux`. Make sure that every exact image digest in `infra/images.json` exists in the cache. The scripts never pull missing images. Preserve at least 14 GiB free before startup, including a 12 GiB reserve.

The package includes no credentials, installed dependencies, runtime records, screenshots, or private campaign files. `package-lock.json` pins the npm dependencies. Run `npm ci --ignore-scripts --no-audit --no-fund` only when you intend to prepare the experiment.

Read [README.md](README.md) for the reviewed workflow after resolving target ownership and prerequisites. The original reviewed commands remain subject to the packaging acknowledgment. Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing the adapted files or dependencies.

## Safe package tests

Run `python3 tests/test_package.py` from this directory. The tests use a temporary relocated copy and synthetic credentials. Real Docker calls only resolve configuration. Lifecycle failures and ownership guards use mocked Docker calls. No container starts, stops, or restarts.

The package test also runs the seven reviewed lifecycle regressions in that temporary copy. It checks that missing acknowledgment refuses preparation before credentials are generated. The test requires Docker Compose for read-only configuration resolution. It requires no cached image, npm installation, or model.

## Boundaries

The five components are PostgreSQL, Studio, postgres-meta, PostgREST, and Kong. Auth, Storage, Realtime, Edge Functions, analytics, and pooling remain outside this profile. Studio supplies local administrator access, not employee authorization.

The original proof demonstrated completed-step recovery, duplicate delivery, database receipts, single-coordinator admission, and database persistence after restart. External effects still need their own receipts or reconciliation. Remote access, company sharing, retention, deletion, and full backup restoration remain unproved.

Docker Desktop permitted outbound TCP during the original test. This network is not an outbound security boundary. DBOS exporters are disabled, but complete zero-telemetry transmission remains unproved. The package does not establish full alpha acceptance.

## Provenance

`import-manifest.json` records all 19 imported source files and their reviewed hashes. It identifies packaging changes separately. The original approved manifest hash is retained as a review reference. The private review material and runtime outputs are excluded.

Three reviewed Python files add an acknowledgment guard. The remaining imported source bytes are unchanged. `PACKAGE.md`, the import manifest, and the package test are new packaging files. Their independent review remains separate from the original backend suitability result.
