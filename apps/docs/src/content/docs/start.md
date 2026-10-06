---
title: "Install Bowerloom"
description: "Read availability and system requirements before installing the CLI."
section: "Start here"
order: 1
---

Normal setup uses the installed `bowerloom` command. It does not require a repository checkout.

<a id="ask-your-personal-agent"></a>

## Ask your agent

```text
Read the current Bowerloom docs and help me install the exact supported version. If it is unpublished, prepare my brief and stop.
```

## Agent procedure

### Prerequisites and availability

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

Read the publication state and qualified installation path before running the planned command above. Today, public installation remains unavailable.

Node `>=24.11.0 <25` and npm `11` are the CLI requirements. Docker belongs to the separate backend path.

<a id="check-the-installed-command"></a>

### Read the installed identity

After publication and installation qualification, read the installed version and help:

```sh
bowerloom --version
bowerloom --help
bowerloom init --help
```

The reviewed candidate reports `Bowerloom 0.7.0-beta.0`. A matching version alone does not prove that the installed artifact matches review.

Help describes syntax. A command in help does not establish runtime readiness.

### If installation cannot proceed

If the package is unpublished or your system lacks qualification, stop before installation. Prepare your project name, goal, and workspace choice instead.

If the installed version differs, read the documentation for that version. Do not apply these examples to an unknown artifact.

Do not use a private candidate archive as a public installation alternative.

## Choose the first task

[Prepare a new workspace](/docs/learn/first-team/) or [use an existing project](/docs/guides/existing-project/).

Source development follows [Contribute from source](/docs/contributors/). [Installation troubleshooting](/docs/troubleshooting/#installation) covers unavailable or mismatched versions.
