---
title: Local backend boundaries
description: A separate Supabase installation with its own plan and approval.
---

<!-- release:status:start -->
**Open beta · unreleased** · `0.7.0-beta.0`

**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

Setup does not start workers, grant runtime access, or authorize connected actions.

- Full runtime acceptance remains incomplete.
- The initial beta needs founder acceptance and publication approval.
- Unattended support requires an independently accepted installed security configuration.
<!-- release:status:end -->

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

## Support boundary

[Current support](/docs/status/) records the tested systems and release limits. This page does not establish full runtime acceptance.
