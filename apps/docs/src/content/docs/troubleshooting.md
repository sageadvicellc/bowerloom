---
title: "Troubleshooting"
description: "Find the supported next inspection without bypassing a refusal."
section: "Help"
order: 25
---

Start with the installed version, actual output, and intended task. Preserve uncertain state before choosing another operation.

Keep your project out of iCloud Drive folders. Project commands such as `bowerloom up`, `ls`, `status`, `apply`, and `skills sync` refuse a project under `~/Documents` or `~/Desktop` when Desktop and Documents sync is on, and under the `~/Library` cloud folders, with `PROJECT_IN_CLOUD_FOLDER`. The older forms that take an explicit path do not run this check. This beta reads pinned skills only from public sources. A store in a private GitHub repository needs `BOWERLOOM_GITHUB_TOKEN`, as [Where your items come from](/docs/guides/item-sources/#private-store) explains. See the [beta limits](/docs/guides/add-skills/#current-beta-limits).

## Ask your agent

```text
Help me understand this Bowerloom refusal. Read the matching version and error guidance. Suggest the next safe inspection without bypassing the boundary.
```

## Agent procedure

### Prerequisites

Use the actual output and matching documentation. Keep raw receipts, private paths, tokens, and customer records private.

### Read the command identity

For an installed CLI, read:

```sh
bowerloom --version
```

Use the documentation that matches this version. Keep the original error before attempting a different installation.

### Inspect an installed setup

For your actual setup target, read:

```sh
bowerloom init status --target /absolute/projects/clean-install-trial
```

Use [Status and error reference](/docs/reference/errors/) to interpret its fields. Report the actual code, intended effect, and one supported next step.

If the outcome remains uncertain, preserve the original evidence. A help request grants no bypass, cleanup, or automatic retry authority.

## Installation

Make sure that Node and npm meet the requirements in [Install Bowerloom](/docs/start/). Read the npm error before retrying. Install with `npm install -g bowerloom@beta`. To update, run the same command again. `npm update -g bowerloom` follows the `latest` tag, not `beta`, and it can downgrade a beta install.

If `npm install -g` refuses with a permission error, do not use `sudo`. Set a user prefix with `npm config set prefix "$HOME/.npm-global"` and add `$HOME/.npm-global/bin` to your `PATH`. [Install Bowerloom](/docs/start/#prerequisites-and-availability) shows the steps.

If the version differs, use matching documentation. A setup command does not grant model execution permission.

## Agent sandboxes

Bowerloom needs two kinds of network access:

- Direct HTTPS to `registry.npmjs.org` and `api.github.com`. `skills add`, `skills sync`, and the sync step of `bowerloom up` fetch from these hosts. Bowerloom does not use a proxy, so it ignores the proxy that a sandbox sets.
- Connections to `localhost`. Bowerloom holds its project lock on a local port and checks the lock by connecting to it. `up`, the create commands, `skills add`, `skills sync`, `apply`, `skills recover`, and `skills migrate` take this lock. When a sandbox blocks that connection, the commands that change skill copies, such as `skills sync` and `apply`, refuse with `MANAGED_SKILL_LOCK_SLOT_COLLISION`. When a sandbox blocks the local port itself, the refusal is `PROJECT_LOCK_UNAVAILABLE`.

Claude Code can run its commands in a sandbox that allows neither. By default, a sandboxed command can also write only inside the project and a temporary folder. `sandbox.filesystem.allowWrite` adds other folders. So when the Claude Code sandbox is on, run the install command, `npm install -g bowerloom@beta`, in your own terminal. Run the `bowerloom` commands outside the sandbox too. There are two ways:

- Run each `bowerloom` command in your own terminal, in the project folder. Then show the output to your agent.
- Add `bowerloom` to the commands that Claude Code runs outside its sandbox. Add both entries to `sandbox.excludedCommands` in `~/.claude/settings.json` for all your projects, or in the project's `.claude/settings.json` for one project:

```json
{
  "sandbox": {
    "excludedCommands": ["bowerloom", "bowerloom *"]
  }
}
```

An excluded command runs with no filesystem limits and no network proxy, and it goes through the regular permission flow. Decide this with the human. Run each `bowerloom` command on its own. A `bowerloom` command joined to another one with `cd`, `&&`, a pipe, a redirect, or a command substitution such as `$(...)` still runs inside the sandbox. [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing) explains these settings.

On macOS, `sandbox.network.allowLocalBinding: true` lets sandboxed commands listen on local ports and connect to any port on `localhost`. That lets the project lock work inside the sandbox. It also opens every other service on `localhost` to sandboxed commands. `skills add` and `skills sync` still need the exclusion, because Bowerloom ignores the sandbox proxy.

If you run Bowerloom inside a sandbox of your own, allow HTTPS on port 443 to the two hosts and TCP connections to `localhost`. A fix for the proxy is planned for 0.7.1.

## Project commands

If a command exits 3, it waits for approval. Read the plan, then run the same command with `--approve <revision>`. If it exits 4 with `prepared, workers held`, the project is prepared and a gate holds the workers.

If `PROJECT_IN_CLOUD_FOLDER` appears, move the project out of `~/Documents`, `~/Desktop`, or a `~/Library` cloud folder. If `PROJECT_NOT_FOUND` appears, change into the project folder, or run `bowerloom up --team <name> --goal <goal>`. [Errors](/docs/reference/errors/#project-and-approval-refusals) lists every code.

If a skill copy is held for local drift, Bowerloom never overwrites it. Follow the `Next:` line. If `MANAGED_SKILL_HISTORY_FULL` appears, move the older `op-<key>` folders out with `mv`, as the `Next:` line says.

## My store is private

If `STORE_REMOTE_PRIVATE` appears, GitHub did not show the store repository without a token.

1. Make a GitHub token that can read the store repository. Read access to that one repository is enough. If a personal account owns the store repository and you are a collaborator, a fine-grained token does not work, and you need a classic token. See [A store in a private repository](/docs/guides/item-sources/#private-store) and [Trust and security boundaries](/docs/security/#the-github-token-for-a-private-store).
2. Set it in the shell that runs Bowerloom, and keep it out of your shell history: run `read -rs BOWERLOOM_GITHUB_TOKEN`, paste the token, press Return, then run `export BOWERLOOM_GITHUB_TOKEN`. Do not put it in a file in the project.
3. If your store has a git remote, `bowerloom store status` prints `GitHub token: BOWERLOOM_GITHUB_TOKEN is set`.
4. Run the command again without `--approve`. The plan shows a `Credentials:` line. Read it, then approve.

If `GITHUB_TOKEN_INVALID` appears, the variable holds something that is not a token, such as a space or a quote. If `STORE_REMOTE_AUTH_FAILED` appears, GitHub refused the token: check that it can read the repository and that the repository name is right. If `GITHUB_TOKEN_SSO_REQUIRED` appears, the organization uses single sign-on: authorize the token for that organization on GitHub, in the token's settings.

## My disk is filling up

Bowerloom keeps the skill bytes it downloads in a cache on this machine, and it never deletes them by itself.

1. Run `bowerloom cache list`. It shows each entry, its size, and whether your store or this project lists it.
2. Run `bowerloom cache prune --unreferenced` in the project. It plans to delete the entries that your store and this project do not list. Other projects on this machine are not checked. A project that needs a deleted pin fetches it again at its next sync.
3. Read the plan, then run the same command with `--approve <revision>`.

If a fetch stopped part way, `bowerloom cache prune --partial` deletes what it left. If `cache prune` cannot delete a folder, run the `chmod` line that it prints, then run it again. If `bowerloom skills sync` refuses with `STALE_APPROVAL` because the cached pin of a skill was deleted after the fetch, run `bowerloom skills sync` again. It fetches the pin again. [CLI reference](/docs/cli/#cache) lists every selector.

## My teammate cannot install my store items

Your teammate runs `bowerloom apply --frozen`, and it refuses. Find the code, then take its step:

- `LOCK_MISSING` or `LOCK_CONFIG_MISMATCH`: the author runs `bowerloom lock update` and commits the lock.
- `STORE_REMOTE_PRIVATE`: the store repository is private. See [My store is private](#my-store-is-private).
- `LOCK_COMMIT_GONE`: the locked commit is gone from GitHub. The author runs `bowerloom lock update`, commits `bowerloom.lock.json`, and pushes. Then the teammate pulls the project.
- `STORE_ITEM_GONE_AT_COMMIT` or `LOCK_HASH_MISMATCH`: run `bowerloom lock verify`. Then ask the author to run `bowerloom lock update`.
- `GITHUB_RATE_LIMITED`: wait up to an hour, or set `BOWERLOOM_GITHUB_TOKEN`.
- A plain `bowerloom apply` holds an item with `SKILLS_OFFLINE`: run `bowerloom apply --frozen`.

[What a teammate does](/docs/guides/item-sources/#teammate-steps) gives every step.

## A clone refuses PROJECT_UNSAFE or PROJECT_FOLDER_UNSAFE

A clone made under `umask 002` has folders and files that the group writes in. Bowerloom refuses them, one code at a time. `bowerloom apply --frozen` checks them in this order:

1. `PROJECT_UNSAFE` for the `.bowerloom` folder.
2. `CONFIG_UNSAFE` for `bowerloom.json`.
3. `PROJECT_FOLDER_UNSAFE` for the project folder.
4. `LOCK_UNSAFE` for `bowerloom.lock.json`. `bowerloom status` shows it as `Lock: invalid (LOCK_UNSAFE)`, and `bowerloom apply --frozen` refuses with it.
5. `MANIFEST_UNSAFE` for `.bowerloom/skills.json`, when the project has that file.
6. `AUTHORING_UNSAFE_PATH` for a folder inside `.bowerloom`, such as `.bowerloom/teams` or `.bowerloom/skills`.

Other commands check the same things in another order. To fix a clone you have, run `chmod -R go-w .` in the project folder. It clears every code above. Git records no write bits, so the change shows no diff. For the next clone, run `umask 022` before `git clone`. See [Before you run](/docs/guides/item-sources/#check-modes).

## Existing setup

If `.bowerloom/` exists, inspect it before any change. Use [revision](/docs/revision/) for an installed goal or profile.

If the new target already exists, choose existing mode only for the intended project. Do not delete it to satisfy new mode.

## Approval

If approval is stale, read the actual changed inputs or binding. Prepare another plan and obtain exact approval.

Do not guess a hash or edit the receipt. [Plans and approval](/docs/permissions/) explains the boundary.

## Drift

If status lists drift, inspect the actual files and identity. Preserve the result before selecting a supported revision or repair.

Direct edits do not create approval. Replacement directories do not inherit the original receipt's identity.

## Revision

If status is `revision-pending`, preserve the marker, stage, backup, and original approval. Follow [Recover an interrupted revision](/docs/guides/recover-revision/).

Do not run fresh installation or delete journals to clear pending state.

## Stop

If a stop is unconfirmed, inspect the original owner in the selected registry. Retain its uncertainty and records.

Do not claim cleanup from a timeout. Do not enroll a replacement owner over unresolved state.

## Backend

If Docker context, platform, or storage fails, stop before installation. Read [Local backend](/docs/backend/) for the separate prerequisites.

Preserve partial backend state. Do not prune unrelated Docker data or delete volumes.

## Help

Provide the exact version, command family, safe code, expected action, and sanitized result. Exclude credentials, private paths, raw receipts, and customer data.

Keep the original failure available privately for scoped review. Use [Bug reports and feedback](/docs/feedback/) to choose the right channel.

[Security boundaries](/docs/security/) explains untrusted reports and tool rights.
