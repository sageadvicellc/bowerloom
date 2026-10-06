---
title: Local backend boundaries
description: A separate Supabase installation with its own plan and approval.
---

:::note[Private beta command scope]
Use the [isolated installed executable](/docs/start/). This command reference is not exercised by the private beta candidate trial. Historical evidence stays separate; it does not establish beta acceptance for this operation.
:::

First-team setup writes files. It does not install Docker or start a database. Local backend installation is a separate operation.

## Supported environment

The current backend adapter targets macOS, Docker Desktop's local `desktop-linux` context, an ARM64 Linux daemon, and Compose v2. Install Docker Desktop separately through its official installer.

The profile uses pinned Supabase PostgreSQL, Studio, postgres-meta, PostgREST, and Kong images. It does not start models, workers, a DBOS coordinator, or a recipe.

## Inspect before planning

The prerequisite command for the installed interface is:

```sh
bowerloom backend doctor
```

This page documents the command; the documentation build did not run it or start a backend. Review its actual readiness report before planning.

The backend plan names its private directory, exact Docker context, ports, images, downloads, and files. Installation requires a separate exact approval.

The existing installer requires at least 16 GiB free, including a 12 GiB reserve and an estimated 4 GiB growth allowance. That estimate is not a storage quota.

## Keep the boundaries clear

Local Studio administrator access does not establish company identity or employee permissions. Auth, Storage, Realtime, Edge Functions, analytics, and pooling are outside this profile.

A failed or partial installation retains state for inspection. There is no automatic prune, volume deletion, or cleanup command. Preserve other Docker projects.

Cloud configuration and other Docker platforms remain unsupported by this adapter. A new team does not require backend installation just to inspect its specification.

## Historical evidence and limits

Source reference: [local-backend documentation](https://github.com/sageadvicellc/bowerloom/blob/cd62b530644dae0fca1cef9e11e287b24356c250/packages/local-backend/README.md). The independent installed CLI UX trial did not qualify backend installation. This page supplies boundaries, not a new backend acceptance result.
