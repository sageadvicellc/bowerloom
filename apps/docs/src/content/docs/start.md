---
title: "Start here"
description: "Prepare a pinned source checkout or use a separately supplied private artifact."
---
## Choose the delivery you actually have

| Delivery | What it establishes |
| --- | --- |
| Published alpha source prerelease | Source archives for `v0.7.0-alpha.0`; not a compiled npm installer. |
| Reviewed private artifact | A specifically supplied and verified archive for a bounded local trial. |
| Beta development branch | Ongoing engineering; not a released or fully accepted beta. |

Do not run `npm install -g bowerloom` based on these pages. No public npm delivery is documented here.

## Prepare a development checkout

Use `git`, Node 24.11 or a later Node 24 version, and `npm` 11. Keep the source checkout separate from the project receiving `.bowerloom/`.

```sh
git clone --branch feature/bowerloom-beta https://github.com/sageadvicellc/bowerloom.git
cd bowerloom
git checkout --detach cd62b530644dae0fca1cef9e11e287b24356c250
npm ci --ignore-scripts
npm run build
node dist/apps/cli/src/main.js --help
node dist/apps/cli/src/main.js --version
node dist/apps/cli/src/main.js init --help
```

The version output is `Bowerloom 0.7.0-alpha.0`. The pin deliberately names the reviewed setup candidate, not whichever commit the branch reaches later.

If you have the private artifact, use the executable and installation procedure supplied with its review packet. Verify its hash before use. These pages do not offer that archive for download.

## Ask your personal agent

```text
Help me choose a new workspace or an existing project.
Prepare a Bowerloom setup plan from my goal.
Explain the roles, working agreement, file changes, and review points.
Wait for my approval of the exact plan revision before installation.
After installation, read .bowerloom/START-HERE.md in the target project and stop for my review.
Do not start workers or import Claude or Codex settings.
```

Then follow [Plan and install](/docs/setup/).

## Evidence and limits

The independent installed trial exercised 117 CLI invocations with package `0.7.0-alpha.0`, Node `24.11.0`, and Darwin arm64. Six new/existing × Engineer/Founder/Research setups passed. This does not establish other platforms or complete framework acceptance.

[Read the exact evidence identity and boundaries](/docs/status/#reviewed-setup-identity).
