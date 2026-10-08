---
title: "Install Bowerloom"
description: "Install the beta CLI, read its version, and choose your first setup task."
section: "Start here"
order: 1
---

Install the `bowerloom` CLI to add a reviewed team specification to your existing project. Start with the workflow you perform manually or with one agent, then [map its roles and handoffs](/docs/guides/integrate-workflow/). Normal setup uses the installed command and needs no repository checkout. Installation gives you the CLI, while each later project-file write still needs its own exact plan approval.

<a id="ask-your-personal-agent"></a>

## Ask your agent

```text
Read the Bowerloom installation guide for 0.7.0-beta.1. Review the requirements and installation command with me. After installation, read the version and help, then help me integrate our reviewed workflow specification with my existing project.
```

## Agent procedure

<a id="prerequisites-and-availability"></a>

### Prerequisites and installation

<!-- release:install:start -->
Install the beta CLI with Node `>=24.11.0 <25` and npm `11`.

```sh
npm install -g ./bowerloom-0.7.0-beta.1.tgz
bowerloom --version
bowerloom --help
```

First-team setup does not need Docker. The separate local backend requires Docker Desktop and its own plan and approval.

These guides use macOS arm64 and Node 24.11.0. Other host systems are outside this documented installation path.
<!-- release:install:end -->

Review the command and local installation effect with the human before running it.

<a id="check-the-installed-command"></a>

### Read the installed identity

After installation, read the version and help:

```sh
bowerloom --version
bowerloom --help
bowerloom init --help
```

The version output identifies `Bowerloom 0.7.0-beta.1`. Use the documentation that matches your installed version.

Help describes command syntax. Read each task's prerequisites before using that command.

<a id="if-installation-cannot-proceed"></a>

### If installation fails

Read the npm error before trying another command. Make sure that your Node and npm versions meet the requirements above.

If the installed version differs, use its matching documentation. Keep the original error for a sanitized [bug report](/docs/feedback/#report-a-bug).

Do not use an unknown archive or different package name to bypass an installation failure.

## Choose the first task

Use [Integrate your first team](/docs/learn/first-team/) for your current project. If `.bowerloom/` already exists, use [revision](/docs/revision/). A [separate new workspace](/docs/guides/new-workspace/) is optional.

Source development follows [Contribute from source](/docs/contributors/). [Installation troubleshooting](/docs/troubleshooting/#installation) covers failed or mismatched installations.

[Bug reports and feedback](/docs/feedback/) explains where to ask questions and report problems.
