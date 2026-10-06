---
title: "Install Bowerloom"
description: "Check release availability, install the CLI, then review your first team."
---
Normal setup uses the installed `bowerloom` command. You do not need a repository checkout.

<!-- release:install:start -->
**Unavailable until publication.** The npm package is not published. Run the installation command only after this exact version is published.

The npm publishing identity is authenticated. This does not grant publication approval. Package ownership is not yet verified. A selected package name does not reserve it.

The planned npm command for `0.7.0-beta.0` is shown for review. Do not run it before this exact version is published.

```sh
npm install --global bowerloom@0.7.0-beta.0
```

Requirements: Node `>=24.11.0 <25` and `npm` 11. Docker Desktop and a separate approved Supabase/PostgreSQL setup for backend operations. Backend setup is separate from installing the CLI.

Tested scope: macOS arm64, Node `24.11.0` — Isolated package installation, setup, revision, upgrade and removal with cached dependencies.

Clean public installation and additional systems remain under review. No operating system is recorded as release-qualified yet.

Cached, isolated package checks do not establish clean public or global installation. Publication and broader delivery remain gated.
<!-- release:install:end -->

## Check the installed command

After this version is published and its installation path is qualified:

```sh
bowerloom --version
bowerloom --help
bowerloom init --help
```

Use `--version` for package identity and `--help` for syntax. A command appearing in help does not establish runtime readiness.

## Ask your personal agent

```text
Help me choose a new workspace or an existing project.
Use my goal to prepare a personal-agent profile and first team.
Explain roles, access, working agreement, and milestones.
Show the full file plan before installation.
Wait for my approval of the exact plan revision.
After installation, inspect init status and read .bowerloom/START-HERE.md.
Stop for my review. Do not start workers or import application settings.
```

Continue with [Plan and install](/docs/setup/). Source development belongs in the [contributor guide](/docs/contributors/).
