---
title: "Install the private beta candidate"
description: "Use the supplied candidate archive in an isolated local directory."
---
The reviewed private candidate is `0.7.0-beta.0`. Its normal interface is the installed `bowerloom` executable; no source checkout is required.

:::caution[Private trial, not a public installer]
This site does not distribute the archive. Use these instructions only if you have received the exact candidate and its review packet. Public npm delivery, global installation, upgrades, removal, and complete beta acceptance remain open under [CLI issue #61](https://github.com/sageadvicellc/bowerloom/issues/61).
:::

## Check the trial prerequisites

The installed proof used macOS on Apple silicon (Darwin arm64), Node `24.11.0`, and `npm` with all required dependencies already cached. It ran outside the source checkout in a fresh isolated directory. Other platforms and clean machines without that cache are not qualified by this trial.

Use a new private installation directory, separate from the project receiving `.bowerloom/`. Keep your existing installations intact. If the offline install reports a cache miss, stop; these instructions do not authorize a network fallback.

Verify the supplied `bowerloom-0.7.0-beta.0.tgz` archive before installation:

```sh
shasum -a 256 /absolute/private/bowerloom-0.7.0-beta.0.tgz
```

Expected SHA-256: `f7d32c4334f3373f76316664de2de9c0618e3fb686d474e431845e3a2e328fc9`.

## Install into an isolated directory

Replace the absolute paths below with the supplied archive and a new private installation directory. The review used empty npm configuration and disabled lifecycle scripts, audit, funding prompts, and network access. Use a private, nonexistent `empty-npmrc` path for the global configuration override.

```sh
npm_config_userconfig=/dev/null npm_config_globalconfig=/absolute/private/empty-npmrc npm install --prefix /absolute/private/bowerloom-trial --offline --ignore-scripts --no-audit --no-fund --no-save /absolute/private/bowerloom-0.7.0-beta.0.tgz
/absolute/private/bowerloom-trial/node_modules/.bin/bowerloom --version
/absolute/private/bowerloom-trial/node_modules/.bin/bowerloom --help
/absolute/private/bowerloom-trial/node_modules/.bin/bowerloom init --help
```

The version must report `Bowerloom 0.7.0-beta.0`. An alpha version is a different artifact. The installation procedure is private and cache-dependent; it is not a general-purpose beta installer.

For the remaining examples, use that full executable path wherever you see `bowerloom`. Alternatively, add only this installation's executable directory to the current shell session:

```sh
export PATH="/absolute/private/bowerloom-trial/node_modules/.bin:$PATH"
```

This changes command lookup for this shell; it does not install globally.

## What this candidate proved

The reviewed run recorded 18 commands, including the offline install, help/version checks, and two Engineer-profile trials. Both new and existing projects completed setup and successful revision. Wrong approvals refused; existing notes stayed unchanged. All 121 installed inventory files matched the distribution record.

The trial did not exercise other profiles, interrupted recovery, registered stop, native agents, backend installation, or full framework execution. [Exact candidate identity and limits](/docs/status/#private-beta-candidate).

## Ask your personal agent

```text
Help me choose a new workspace or an existing project.
Prepare a Bowerloom setup plan from my goal.
Explain the roles, working agreement, file changes, and review points.
Wait for my approval of the exact plan revision before installation.
After installation, read .bowerloom/START-HERE.md in the target project and stop for my review.
Do not start workers or import Claude or Codex settings.
```

[Plan your first team](/docs/setup/) or [check support and evidence](/docs/status/).

Contributor source work belongs in the separate [contributor guide](/docs/contributors/).
