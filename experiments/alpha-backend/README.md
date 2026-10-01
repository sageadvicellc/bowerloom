# Trellis alpha backend proof

This prototype prepares a local Supabase profile and a DBOS recovery test. The bounded database, Studio, and DBOS recovery tests pass on this Mac.

## Included components

The profile includes Supabase PostgreSQL, Studio, postgres-meta, PostgREST, and Kong. Image references include exact registry digests from the existing cache. The proof uses DBOS SDK 5.2.11 under its MIT license. The dependency lock pins the dependency tree.

The profile omits Auth, Storage, Realtime, Edge Functions, analytics, and connection pooling. This profile does not establish full Supabase suitability. It tests the alpha database, administrator interface, and coordinator path first.

Only the gateway and PostgreSQL publish ports. Both ports bind to `127.0.0.1`. Docker publishes only these loopback ports. The network does not block all outbound traffic. Generated credentials remain in `.private`, which Git ignores. Kong protects Studio with local administrator credentials.

The coordinator connects directly to PostgreSQL. A PostgreSQL advisory lock admits one coordinator for the installation. The test supervisor kills and restarts that process. DBOS stores completed steps in PostgreSQL. A unique receipt prevents duplicate database effects when a process dies before DBOS records completion.

## Prepare the proof

Use Node 24 and Docker Compose on this Mac. Keep at least 14 GiB free before startup. This threshold reserves 12 GiB plus 2 GiB for expected growth.

1. Run `npm ci --ignore-scripts --no-audit --no-fund` in this directory.
2. Run `python3 scripts/prepare.py` to create private credentials and the Compose file.
3. Run `python3 scripts/stack.py start` to start the isolated profile.
4. Run `python3 scripts/stack.py studio` to test authenticated Studio endpoints.
5. Run `npm run proof` to test coordinator recovery and duplicate delivery.
6. Run `node scripts/persistence.mjs` to test database restart persistence.
7. Run `python3 scripts/stack.py stop` to stop only this profile.

The preparation script requires all five pinned images in the local Docker cache. It does not download missing images automatically. Assess disk space before an explicit image download on another machine.

The ports are `56581` for Studio and REST, and `56582` for PostgreSQL. Read the generated administrator credentials from `.private/credentials.json` locally. Open `http://127.0.0.1:56581/project/default` in a browser. Inspect the `proof` and `dbos` schemas after a successful workflow test.

Stopping the profile retains its named volumes. These volumes belong to the `trellis-alpha-proof` project. Do not delete other Docker data.

## Required evidence

The recovery test covers a completed step, a repeated workflow request, and a committed effect without a DBOS completion record. The uncertain-effect case must show two attempts and one stored effect. This result applies to database receipts. It does not prove safe replay for an external service without receipts.

The test writes `proof-result.json` only after all assertions pass. The campaign evidence records whether this test actually ran. A successful container start alone does not establish usable Studio.

DBOS tracing and export remain disabled. The test uses no Conductor key and makes no model calls. The prototype does not prove a complete telemetry policy or all network paths. Company access, customer retention, deletion, and remote encryption remain outside this local proof.

## Fresh installation test

Run `python3 scripts/fresh-start.py` after the ordinary profile passes. The script stops only this proof profile before its test. It creates a separate profile with empty volumes and tests authenticated metadata access. It removes that disposable profile and restores the original proof profile. It retains the original data volumes.

## Network limit

The bridge disables IP masquerading, but Docker Desktop still permits outbound TCP in this test. Do not use this network as a worker isolation boundary. DBOS exporters remain disabled by configuration. Full telemetry transmission capture remains outside this proof.

## Lifecycle isolation

Every Docker command selects the local `desktop-linux` context. Every Compose command names either `trellis-alpha-proof` or `trellis-alpha-proof-fresh` explicitly. The command environment excludes inherited Docker, Compose, and credential overrides. The private environment file supplies credentials.

The fresh test attempts original-profile restoration even when startup or disposable-profile removal fails. The result records each failure separately and exits with failure. Restoration is an attempt, not a guarantee, if Docker remains unavailable or the fresh profile still occupies its ports.

Run `python3 scripts/test_lifecycle.py` to test these boundaries. Its hostile-environment probe resolves Compose configuration without changing resources. Its failure probes mock all Docker lifecycle operations.
