# Local Supabase backend

This alpha installer creates a separate local Supabase profile for Bowerloom. It does not change the older proof stack or portable skill installation.

The profile includes Supabase PostgreSQL, Studio, postgres-meta, PostgREST, and Kong. All images use exact upstream registry digests from the reviewed backend proof.

The installer starts no models, workers, DBOS coordinator, or recipe. It does not provision admission accounts, runtime schemas, GitHub credentials, or employee access.

## Current support

The first adapter supports macOS with Docker Desktop, a local `desktop-linux` context, an ARM64 Linux daemon, and Docker Compose v2.

Install Docker Desktop through its [official instructions](https://docs.docker.com/desktop/setup/install/mac-install/) before backend setup. The installer never installs privileged host software.

Docker daemon access permits powerful host operations. This package uses that existing local authority only for its named backend profile.

Cloud setup and other Docker platforms are not supported by this adapter. PostgreSQL and Studio are upstream [Supabase components](https://supabase.com/docs/guides/self-hosting/docker).

## Prepare a plan

Use the compiled CLI from the repository root. Run the prerequisite inspection:

```sh
node dist/apps/cli/src/main.js backend doctor
```

The result reports readiness or a concrete prerequisite failure. It also supplies the official Docker installation link.

Choose a new absolute directory beneath a private parent directory. The parent must exist, belong to you, and deny group or other writes.

The path must use its canonical spelling without symlinks, a trailing slash, or `..`. Do not use a global configuration directory.

Generate a plan with unused loopback ports:

```sh
node dist/apps/cli/src/main.js backend plan \
  --root /absolute/private-parent/bowerloom-local \
  --studio-port 57581 \
  --database-port 57582
```

The plan names its new directory, unique Compose project, local daemon, ports, five pinned images, missing downloads, and generated files.

The plan requires at least 16 GiB free. This includes a 12 GiB reserve and a conservative 4 GiB growth allowance.

The growth allowance is an estimate, not a Docker storage quota. Host free space is observed before each pull, after pulls, and after startup.

Docker Desktop also has a separate disk image. This installer does not measure its remaining capacity or promise that the host reserve prevents every Docker failure.

No directory, credentials, image download, or container is created during planning. Docker inspection and temporary loopback-port availability probes are read-only preparation.

## Approve installation

Read the exact plan before installation. Pass its 64-character revision with the same directory and ports:

```sh
node dist/apps/cli/src/main.js backend install \
  --root /absolute/private-parent/bowerloom-local \
  --studio-port 57581 \
  --database-port 57582 \
  --approve REPLACE_WITH_EXACT_PLAN_REVISION
```

A different daemon, image-cache state, target, port, or profile invalidates the old approval. Generate and review a new plan after a change.

The installer creates private files with mode `0600` inside a directory with mode `0700`. It refuses an existing installation directory.

The approved downloads contain only exact pinned image digests. Compose uses `pull_policy: never` after those explicit pulls.

The installer rejects existing project-labelled resources and collisions with expected resource names. It never adopts another project, database volume, or proof installation.

After startup, it inspects ownership labels on the five containers, two volumes, and network. It then tests authenticated PostgreSQL, Studio, and metadata access. It requires unauthenticated Studio requests to return 401 and the REST endpoint to return 200.

A successful result includes the Studio URL and the local credentials-file path. It never prints the credentials.

Read `credentials.json` locally to obtain the Studio administrator username and password. Keep this private directory outside source control and shared folders.

## Observe status

Use the same private directory for a fresh observation:

```sh
node dist/apps/cli/src/main.js backend status \
  --root /absolute/private-parent/bowerloom-local
```

Status compares file hashes, daemon identity, and resource ownership before health probes. Stored readiness never substitutes for the current observation.

`recordedState` describes the last installation phase. `ready` describes the fresh health result. An unavailable service does not erase prior evidence.

## Failure and data preservation

A failed pull or startup leaves private files and any created resources for inspection. It does not claim rollback of Docker changes.

The installer never prunes, deletes a volume, stops another project, or removes a partial installation. It has no automatic cleanup or repair command.

Do not rerun installation into that directory. Inspect `installation.json` and the named Compose project first. Resolve the recorded failure before another installation.

A crash can leave a partial record. A malformed record fails closed. Retain its files and Docker volumes until an operator resolves ownership.

The private parent must have no hostile concurrent writer with the same operating-system authority. Filesystem observations do not create a security boundary against that process.

## Backend boundaries

Only PostgreSQL and the gateway publish ports. Both bind to `127.0.0.1`. Studio is protected by generated local administrator credentials.

The bridge configuration is not an outbound network sandbox. The earlier Docker Desktop proof permitted outbound connections despite disabled IP masquerading.

Auth, Storage, Realtime, Edge Functions, analytics, and pooling are excluded. Studio administrator access does not establish company access controls.

Generated JWT credentials expire after 30 days. This alpha has no credential-rotation command. Rotation and long-term maintenance need separate work.

This PostgreSQL profile follows the earlier MIT DBOS 5.2.11 compatibility proof. This installer does not rerun DBOS recovery tests or establish new runtime acceptance.

The Labs-to-blog recipe uses PostgreSQL and LangGraph checkpoints. Its database, private installation, and exact action approvals remain separate requirements.

Vines currently declares logging maps. Backend installation does not create a new Vines collection service or add self-improvement.

## Verification status

Source tests use an injected Docker runner and synthetic readiness results. They cover approval, tampering, ownership, reserved paths, disk gates, and failure preservation.

These source tests do not start Docker. A separate isolated installation passed on October 2, 2026, against implementation `dcdd3a103b90ec7b3de4287bd6715717884732c2`.

The live run used five cached images and a new private project. Fresh status reported authenticated PostgreSQL, protected Studio, metadata access, and REST availability.

A wrong PostgreSQL password was rejected. This one local run does not establish fresh-download behavior, other platforms, cloud setup, or agent execution.

From the repository root, run:

```sh
npm run build
node --test packages/local-backend/test/backend.test.mjs
```

The package exports `doctorBackend`, `planBackend`, `installBackend`, and `statusBackend`. The CLI uses the same implementation.
