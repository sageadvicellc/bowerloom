# Experimental backend proof

The [local backend experiment](../../experiments/alpha-backend/PACKAGE.md) packages the reviewed macOS suitability prototype. It supports a bounded PostgreSQL, Studio, and DBOS recovery path. It is not the production CLI, the full Supabase stack, or a shared-company deployment.

The scripts target the fixed `trellis-alpha-proof` project in Docker context `desktop-linux`. They publish only `127.0.0.1:56581` and `127.0.0.1:56582`. Every checkout addresses the same proof resources. Read the target-ownership instructions before setting the required lifecycle acknowledgment.

The package retains pinned image digests, npm dependencies, licenses, and source provenance. It excludes credentials, installed dependencies, private evidence, and runtime records. Its relocation tests resolve configuration and mock lifecycle operations without changing services.

The original proof passed Studio access, process recovery, duplicate prevention, and database persistence tests. Outbound isolation and complete zero-telemetry transmission remain unproved. The [import manifest](../../experiments/alpha-backend/import-manifest.json) identifies reviewed bytes and packaging changes.
