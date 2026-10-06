---
title: "Install Bowerloom"
description: "Install the beta CLI, read its version, and choose your first setup task."
section: "Start here"
order: 1
---

Normal setup uses the installed `bowerloom` command. It does not require a repository checkout.

<a id="ask-your-personal-agent"></a>

## Ask your agent

```text
Read the Bowerloom installation guide for 0.7.0-beta.0. Review the requirements and installation command with me. After installation, read the version and help, then help me choose my first setup task.
```

## Agent procedure

<a id="prerequisites-and-availability"></a>

### Prerequisites and installation

<!-- release:install:start -->
Install the beta CLI with Node `>=24.11.0 <25` and npm `11`.

```sh
npm install --global bowerloom@0.7.0-beta.0
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

The version output identifies `Bowerloom 0.7.0-beta.0`. Use the documentation that matches your installed version.

Help describes command syntax. Read each task's prerequisites before using that command.

<a id="if-installation-cannot-proceed"></a>

### If installation fails

Read the npm error before trying another command. Make sure that your Node and npm versions meet the requirements above.

If the installed version differs, use its matching documentation. Keep the original error for a sanitized [bug report](/docs/feedback/#report-a-bug).

Do not use an unknown archive or different package name to bypass an installation failure.

## Choose the first task

[Prepare a new workspace](/docs/learn/first-team/) or [use an existing project](/docs/guides/existing-project/).

Source development follows [Contribute from source](/docs/contributors/). [Installation troubleshooting](/docs/troubleshooting/#installation) covers failed or mismatched installations.

[Bug reports and feedback](/docs/feedback/) explains where to ask questions and report problems.
