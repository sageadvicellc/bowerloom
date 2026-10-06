---
title: "Local backend"
description: "Read the separate Supabase prerequisites before planning local services."
section: "Guides: Connections and shared work"
order: 14
---

First-team setup writes files. It does not install Docker or start a database. Backend installation requires a separate plan and exact approval.

<!-- release:status:start -->
Open beta · 0.7.0-beta.0

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

## Ask your agent

```text
Explain the current Bowerloom local backend prerequisites. Show what a separate plan can change before installing or starting any service.
```

## Agent procedure

### Supported environment

Install the matching CLI version through [Install Bowerloom](/docs/start/).

The current adapter targets macOS, Docker Desktop's local `desktop-linux` context, an ARM64 Linux daemon, and Compose v2.

Install Docker Desktop separately through its official installer. Bowerloom does not install privileged host software.

The installer requires at least 16 GiB free. This includes a 12 GiB reserve and an estimated 4 GiB growth allowance.

The estimate is not a storage quota. Cloud configuration and other Docker platforms are unsupported by this adapter.

### Inspect before planning

With the separately prepared Docker environment, read the actual prerequisite report:

```sh
bowerloom backend doctor
```

Use its readiness report to decide whether a separate plan can proceed. This page does not supply installation approval.

### Plan, approve, and inspect separately

[CLI reference](/docs/cli/#backend) records the `backend plan`, `backend install`, and `backend status` shapes.

The plan names the private directory, Docker context, ports, pinned images, downloads, and files. Review that complete effect before exact approval.

Approved installation downloads images, writes separate files, and starts the named services. These effects are outside first-team setup.

The selected profile includes Supabase PostgreSQL, Studio, postgres-meta, PostgREST, and Kong. It starts no models, workers, DBOS coordinator, or recipe.

### If the prerequisites fail

If the platform, context, storage, or approval differs, stop before installation. Preserve partial state and other Docker projects.

There is no automatic prune, volume deletion, or cleanup command. Use the actual retained status for inspection.

## Keep the boundaries clear

Studio administrator access does not establish company identity or employee permissions. Auth, Storage, Realtime, Edge Functions, analytics, and pooling are outside this profile.

## Support boundary

[Current support](/docs/status/#connections) records the backend limit. [Backend troubleshooting](/docs/troubleshooting/#backend) covers prerequisites.
