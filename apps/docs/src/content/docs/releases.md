---
title: "Release notes"
description: "Read the beta changes, compatibility notes, and routes for feedback."
section: "Help"
order: 27
---

Release notes describe user-visible changes by version. [Current support](/docs/status/) describes supported tasks and limits.

<!-- release:status:start -->
Open beta · 0.7.0-beta.2

Setup does not start workers, grant runtime access, or authorize connected actions.
<!-- release:status:end -->

## 0.7.0-beta.3

**New commands**

- `bowerloom use` and `bowerloom unuse` pick and drop items, and change only `bowerloom.json` and `bowerloom.lock.json`.
- `bowerloom lock verify` checks the lock with no network. `bowerloom lock update` rewrites it from your store.
- `bowerloom team adopt` copies a store team into the project, and the project owns the copy.
- `bowerloom store migrate` copies skills, prompts, and teams from a project to your store and lists them in `bowerloom.json`. It deletes nothing. `bowerloom receipt clean` removes the records of items whose files you deleted.
- `bowerloom cache list` shows the skill bytes that Bowerloom keeps on your machine. `bowerloom cache prune` deletes them after you approve a plan. Bowerloom never deletes the cache by itself.

**Projects and the store**

- `bowerloom.json` lists what a project installs, from the project or from your store. A project without it installs everything it defines, as before.
- A project with only `bowerloom.json` works with every command. Its first install makes `.bowerloom`, whose engine files git ignores.
- A project can be marked by a file named `bowerloom.json`. `~/.bowerloom` is now your store, and it no longer stops project discovery. `bowerloom store status` shows it. `bowerloom status --json` has a new format, `bowerloom/project-status/v1beta2`.
- `--global` on `team create`, `skill create`, `prompt create`, `skills add`, `skills check`, and `ls` works on your store, `~/.bowerloom`. `ls` shows where each item comes from. `ls --json` has a new format, `bowerloom/ls/v1beta2`. The store holds up to 256 skills and a project up to 128.
- The project folder, `bowerloom.json`, and `bowerloom.lock.json` must be yours and closed to group and other writes. Otherwise Bowerloom refuses with `PROJECT_FOLDER_UNSAFE`, `CONFIG_UNSAFE`, or `LOCK_UNSAFE`. A clone made under `umask 002` refuses until you run `chmod -R go-w .`.
- `bowerloom store status` shows the `Git:` line of the store, the commands that fix a store with no remote, and the `GitHub token:` line. Its JSON format is `bowerloom/store-status/v1beta1`.
- `bowerloom status` prints a `Config:` line, one of seven `Lock:` states, and the notes for a stale lock and for a shared project with no lock.
- `bowerloom up` reads `bowerloom.json`. Only a team that the project or your store defines, and that the file does not list, refuses `TEAM_NOT_SELECTED`. `up --team <unknown>` goes to the team create step. On a clone, `up` works for a listed team.
- The store keeps a `.gitignore` that leaves out `folders/` and other files of this machine, so `git add -A` in a store you push does not publish registered-folder records or grants. Each machine runs `bowerloom folder add` itself. Bowerloom adds the lines on every store write and keeps every line you added. `bowerloom store status` warns when the lines are missing, when git already tracks something under `folders/`, and when it cannot tell, for example with a split index.

**Sharing**

- `bowerloom.lock.json` records where each store item comes from and a hash of its bytes, so a teammate gets the same items.
- `apply --frozen` and `skills sync --frozen` install only what the lock records, as `npm ci` does.
- A store in a private GitHub repository works after you set `BOWERLOOM_GITHUB_TOKEN`. Bowerloom sends the token only to `api.github.com`, for that repository. It never stores or prints the token. A token that an organization's single sign-on has not authorized refuses with `GITHUB_TOKEN_SSO_REQUIRED`.
- A project is shared in two cases. It has `bowerloom.lock.json`, or its git repository has a remote named `origin`. If Bowerloom cannot read one of those files, it treats the project as shared and says so.
- `apply`, `skills sync`, and `use` take `--max-github-requests <n>`, up to 5000. One run makes at most 1000 GitHub requests by default. A larger run refuses `GITHUB_REQUEST_BUDGET`.
- `use`, `lock update`, and `store migrate` take `--commit <sha>` to record a chosen pushed commit of the store repository.
- Bowerloom holds some store skills and prompts fetched from the lock with `ITEM_REVIEW_REQUIRED`, until a plan shows them. Those are the items that set `allowed-tools`, register hooks, or run shell lines.
- Plain `apply` never fetches. It holds a lock item that this machine lacks with `SKILLS_OFFLINE`. `skills sync` and `up` fetch lock items into the store cache.
- `bowerloom team adopt` also takes a store team that `bowerloom.json` does not list yet. One plan copies the team and lists it as a project item, so it works in a shared project whose store is not pushed. Store skills and prompts tagged to the team stay store items, and the plan names them.
- `apply --frozen` and `skills sync` refuse with `LOCK_COMMIT_GONE` when the locked commit is gone from a store repository that GitHub still shows, for example after a force-push or a deleted branch. After a 404 on the commit, one extra request to the repository tells this apart from a private repository, which keeps `STORE_REMOTE_PRIVATE`, or `STORE_REMOTE_AUTH_FAILED` with a token.
- A store item that holds a file a lock cannot record, such as `.DS_Store`, refuses `STORE_ITEM_NOT_SHAREABLE` before any network call. Its `Next:` line names the file or folder and its fix. Each other cause of the code has a `Next:` line of its own too.
- `SKILLS_OFFLINE` names its real cause, and each cause has its own next step: the network, a wrong answer of the registry, a pin that needs too many requests, an address that is not public, another fetch failure, `--offline`, plain `apply`, and an approved plan that names no host for the fetch.
- `apply`, `skills sync`, and `use` given `--max-github-requests` when they make no GitHub request for a store item print `This run makes no GitHub request for a store item, so --max-github-requests has no effect.`
- The new page [Where your items come from](/docs/guides/item-sources/) explains where each item's bytes come from, what the lock records, and what a teammate needs.

**Agents and context slices**

- `bowerloom slice create` makes a context slice. `apply` turns it into the skill `slice-<id>`, a list of paths that an agent loads at start. Only titles are copied.
- An agent whose copy names a guarded slice gets the read guard, `bowerloom context guard`, as a `PreToolUse` hook. It checks Read, Grep, and Glob. It does not check shell, MCP, or LSP tools, nested agents, or claude -p runs. The copy names this machine's project folder.
- `bowerloom context measure` compares each agent's context at start with a full load of the knowledge base. Bytes are exact. Tokens are an estimate.
- `bowerloom context show` previews a slice.
- `bowerloom folder add` registers a folder outside the project for slices. A slice names it with `root: { registered: <folder-name> }`, and `slice create --registered` writes that. `folder list` and `folder remove` list and remove the records. Bowerloom reads a registered folder and never writes it. A registered folder is shared with a project only after `bowerloom folder allow <name>` runs in it. `folder deny` takes the grant back.
- Ids that start with `slice-` are reserved for new skills and prompts.
- In a project with `bowerloom.json`, a context slice stays a project item. `bowerloom.json`, the store, and the lock never hold it.
- `apply` copies the agents of a team, first-team included, to `.claude/agents` for Claude Code.
- A bad agent file holds only that agent. A hand-made agent file that equals the copy is adopted. One that differs holds that agent with `AGENT_TARGET_OCCUPIED`.
- `bowerloom status` no longer reports a team's `agents/` files as edited.
- An agent that sets `bypassPermissions`, `hooks`, or `mcpServers` is held until `apply --allow-agent <role>:<hash>` names the hash of its file.
- Hidden files and editor backups in `agents/` are ignored. An agent in a team that is not registered is held with `AGENT_TEAM_UNREGISTERED`.
- The package has a second command, `bowerloom-guard`. Claude Code runs it as the read guard.

**Install**

- Installing from a downloaded .tgz file now gives the same dependency versions as the tested build. The file carries its dependencies, so it installs with no network and no npm cache.

**Changed formats**

- Files: `bowerloom/project/v1beta1`, `bowerloom/lock/v1beta1`, `bowerloom/store/v1beta1`, `bowerloom/context-slice/v1beta1`, `bowerloom/store-folder/v1beta1`, and `bowerloom/store-folder-grant/v1beta1`.
- Reports: `bowerloom/store-status/v1beta1`, `bowerloom/ls/v1beta2`, `bowerloom/project-status/v1beta2`, `bowerloom/skills-manifest-check/v1beta2`, and `bowerloom/lock-verify/v1beta1`.
- More reports: `bowerloom/cache-list/v1beta1`, `bowerloom/folder-list/v1beta1`, `bowerloom/context-slice-show/v1beta1`, and `bowerloom/context-measure/v1beta1`.
- Plans and results of skills and apply: `bowerloom/skills-manifest-change/v1beta2`, `bowerloom/skills-sync-plan/v1beta2`, `bowerloom/skills-sync-result/v1beta2`, `bowerloom/project-apply-plan/v1beta2`, and `bowerloom/project-apply-result/v1beta2`. Plan items name their source.
- Plans and results of create, use, and the lock: `bowerloom/authoring-plan/v1beta2`, `bowerloom/config-change-plan/v1beta1`, `bowerloom/config-change-result/v1beta1`, `bowerloom/lock-update-plan/v1beta1`, and `bowerloom/lock-update-result/v1beta1`.
- Plans and results of adopt and migrate: `bowerloom/team-adopt-plan/v1beta1`, `bowerloom/team-adopt-result/v1beta1`, `bowerloom/store-migrate-plan/v1beta1`, and `bowerloom/store-migrate-result/v1beta1`.
- Plans and results of clean and prune: `bowerloom/receipt-clean-plan/v1beta1`, `bowerloom/receipt-clean-result/v1beta1`, `bowerloom/cache-prune-plan/v1beta1`, and `bowerloom/cache-prune-result/v1beta1`.
- Plans of registered folders: `bowerloom/folder-add-plan/v1beta1`, `bowerloom/folder-allow-plan/v1beta1`, `bowerloom/folder-deny-plan/v1beta1`, and `bowerloom/folder-remove-plan/v1beta1`.
- Scripts that read `format` must accept the new names.
- A project that holds slices cannot be read by a 0.7.0-beta.2 CLI.
- A project that holds agent catalogs cannot be read by a 0.7.0-beta.2 CLI. The old CLI refuses it.

**Known limits**

- The read guard needs Claude Code 2.1.295 or later. Before 2.1.295, a guard that cannot start, crashes, or runs longer than 10 seconds lets the call through. It runs only in a folder that you trusted, so an untrusted folder skips it.
- Codex gets neither agents nor context slices in this beta.
- `bowerloom revise` refuses while `.bowerloom/teams/first-team/agents` exists. Move the folder out, revise, then move it back.
- The store must be on github.com in this beta.
- A store team projects no agents. Moving a team with agents to the store stops the projection of its agents.
- Store items hold only text files within the size limits, so a store item cannot share a script.
- A lock names at most 8 store repositories.
- A store whose git uses reftable or SHA-256, or whose `.git` files the group can write, counts as unreadable.
- Bowerloom reads the store's local git refs and never runs `git fetch`.
- A rewritten or deleted store branch, or a store repository made private, breaks your teammates' frozen installs. `LOCK_COMMIT_GONE` names the first case.
- `cache prune --unreferenced` checks only this project and your store.
- This beta was tested on macOS with Node 24.11.0 only, the delete steps of `cache prune` included.

## 0.7.0-beta.2

This release changes the package text and how Bowerloom reads skills. It adds no new command.

- The npm package text is public. It holds no private or proof wording.
- The package homepage link now points at bowerloom.ai.
- The installed CLI accepts the npm beta-stream release record. The 0.7.0-beta.1 package did not include this check.
- `skills add` and `skills sync` read npm packages packed by npm 11. Those packages leave the owner and group id fields empty, and 0.7.0-beta.1 refused them with `NPM_TAR_NUMBER`.
- An npm package can hold up to 8,192 archive entries. 0.7.0-beta.1 refused a package with more than 1,024 entries with `NPM_TAR_BOUND`.
- A skill can declare `allowed-tools` in `SKILL.md`. The `skills add` and `skills sync` plans print it on an `Allowed tools:` line, and `skills.json` records it. 0.7.0-beta.1 refuses a `skills.json` that records it.
- One skills cache serves every project on the machine. Each project kept its own cache in 0.7.0-beta.1. The cache is keyed by content, so a skill pinned in two projects downloads once.
- `skills add` keeps the bytes it checked in that cache. A later `skills sync` needs no second download and works with `--offline`.
- A skill can declare `argument-hint` in `SKILL.md`, as one line of plain text of at most 256 bytes. A key that changes what an agent does, such as `hooks` or `model`, still refuses.
- `skills add` refuses a frontmatter key that Bowerloom does not accept with `SKILLS_ADD_FRONTMATTER`, which lists the accepted keys. 0.7.0-beta.1 reported it as unsafe content.
- `skills sync` and `apply` refuse a project under a folder that other users can change with `SKILLS_PROJECT_UNSAFE`, at plan time. 0.7.0-beta.1 failed later, after the download.
- Dependency pins are unchanged.

## 0.7.0-beta.1

### Install

This beta ships on npm as `bowerloom`, under the `beta` dist-tag. A dist-tag is a name that points at one published version. There is no stable release yet, so the `latest` tag also points at this beta. Install with `@beta` to stay on the beta stream. Install it globally:

```sh
npm install -g bowerloom@beta
bowerloom --version
```

The second command prints the installed version, `0.7.0-beta.1` for this release. Updates are not automatic. To update, run `npm install -g bowerloom@beta` again. Do not use `npm update -g bowerloom` for this: for a global package, npm updates to the `latest` tag, not to `beta`, and it can downgrade a beta install. A colleague who was given a `bowerloom-0.7.0-beta.1.tgz` file can still install it by its full path, such as `npm install -g ~/Downloads/bowerloom-0.7.0-beta.1.tgz`. [Install Bowerloom](/docs/start/) has the full steps.

### What the tests covered

The tests installed a build of this release globally with npm, from a file, and ran the installed `bowerloom` command. They did not install the package from npm. The npm package differs from the tested build only in `package.json` and `README.md`. A pin is the exact npm version or Git commit that a project records for a skill. The tests covered these tasks:

- Install a skill from an npm package and from a Git repository.
- Update a skill to a new pin.
- Resume a change that stopped part way. Resume finishes the approved change.
- Roll back a change that stopped part way. Rollback puts back what was there before.
- Refusals for npm and Git sources. A refusal stops the command with a code. The tests covered a wrong or old approval, a skill copy that you changed, and private records that no longer match.
- Two real public skills. The first is `collections` from the TanStack npm package `@tanstack/db-skills@0.0.1`. The second is `verification-loop` from ECC, the public GitHub repository `affaan-m/ecc`, first at one commit and then at a later commit.
- A teammate who receives a project with its `skills.json`, checks the pins, and reaches the sync step of `bowerloom up`.
- Help, usage errors, and exit codes.

### Known limits

- Two refusals have no test yet: `SKILLS_SYNC_LIMIT` and `SKILLS_CACHE_RECOVERY_REQUIRED`. Tests for both are planned for 0.7.1.
- Claude Code can run its commands in a sandbox. The sandbox limits what those commands can reach, and it sends web requests through a proxy. A proxy is a server that passes requests on. Bowerloom ignores that proxy and sends its HTTPS requests directly. It also needs connections to `localhost` for its project lock. So when the sandbox is on, Bowerloom cannot reach npm or GitHub from inside Claude Code, and its lock check can fail. Bowerloom has no setting that changes this. Run the `bowerloom` commands outside the sandbox: in your own terminal, or as an excluded command in the Claude Code settings. [Agent sandboxes](/docs/troubleshooting/#agent-sandboxes) shows both ways. A fix for the proxy is planned for 0.7.1.
- When the lock check fails, the refusal `MANAGED_SKILL_LOCK_SLOT_COLLISION` does not name the port. Its `Next:` line shows `<port>` as written. A fix is planned for 0.7.1.
- Bowerloom does not add `.claude/skills`, `.claude/commands`, `.agents/skills`, or its setup files to your `.gitignore`. Add them yourself, as [What to commit](/docs/guides/add-skills/#what-to-commit) says. A fix is planned for 0.7.1.
- A copy in `.claude/skills` or `.agents/skills` does not prove that Claude Code or Codex finds it. The tests did not check that.
- The tests used Node 24.11.0 and npm 11.6.1 on macOS only. They cover no other version or system.
- Bowerloom checks every byte of a skill against its pin, and it checks the skill license. It does not prove that a skill is safe. Read a skill before you approve its plan.
- Workers stay held in this beta. `bowerloom up` ends at `prepared, workers held` and exits 4 with the code `WORKERS_HELD`. No worker starts.

<a id="070-beta0-unreleased"></a>

## 0.7.0-beta.0

Integrate a team specification with an existing project through a fixed Engineer, Founder, or Research profile. A separate unused workspace is optional.

Review the full plan before approval. Exact approval installs 20 setup files and one private receipt.

Plan changes to an installed goal or profile before replacing managed files. Interrupted revisions support recorded resume and rollback actions.

Status reports specification readiness, runtime readiness, execution authority, review requirements, and drift. Setup remains ready for human review without starting workers.

Run `bowerloom up --team <name> --goal <goal>` in a project folder to prepare it one approved step at a time. The run ends at `prepared, workers held`. No worker starts. Install the private archive with `npm install -g ~/Downloads/bowerloom-0.7.0-beta.0.tgz`. Use the full path where you saved the file.

List a project with `bowerloom ls` and read its state with `bowerloom status`. Create a team, a skill, or a prompt inside `.bowerloom` with `team create`, `skill create`, and `prompt create`.

Pin skills from npm or GitHub in `.bowerloom/skills.json` with `skills add`. Check the pins with `skills check`. Install them with `skills sync`, and put them in place for Claude Code and Codex with `apply`. Only exact pins and MIT or Apache-2.0 skills are accepted. Commit `skills.json` and your authored skills. Managed copies and the `.claude` and `.agents` projections stay on each machine.

Every change shows a plan and needs `--approve <revision>`. Exit codes are 0 done, 1 refused, 2 usage, 3 approval required, and 4 held by a gate. There is no `--yes`. Project commands refuse a project in a cloud-synced folder with `PROJECT_IN_CLOUD_FOLDER`. `bowerloom help` and `bowerloom help advanced` list the commands.

Project selected portable skill files into a new Codex or Claude Code workspace. MCP planning reads selected synthetic inputs without connecting a server.

## Compatibility

Older installations keep their original format and identity rules. The current Darwin identity policy does not silently rewrite their receipts.

Use the matching installed version for setup changes. Inspect pending transactions and private receipts before any recovery.

The `trellis` and `trellis-mcp` names remain compatibility aliases. They grant no different permissions.

## Historical records

Earlier source releases and test records remain in the repository. Their results apply to their original version and task.

The `v0.7-workbench` Labs label does not identify the framework package. [Workbench](/docs/workbench/) explains comparison records.

<a id="publication-and-support"></a>

## Feedback

Report problems through [Bug reports and feedback](/docs/feedback/). Use Q&A for questions, General for feedback, and Ideas for features. [Roadmap](/docs/roadmap/) separates estimated future stages from these shipped changes.
