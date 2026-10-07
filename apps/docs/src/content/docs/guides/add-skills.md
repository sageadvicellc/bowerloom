---
title: "Add a third-party skill to an existing project"
description: "Review a pinned source, approve its files, and inspect installation or updates in your selected harness."
section: "Guides"
order: 7.5
---

Bowerloom governs every file that a third-party skill adds to your project. You review the pinned source first. You approve the exact plan for each step. Bowerloom then records what it installed so that you can detect drift and recover from interruption.

If you already work by hand or with one agent, use this guide to add a skill that someone else published. Add the skill with `bowerloom skills`. Acquisition stores the approved source in a private cache. Installation stores its definition and projects its files for your selected harness. Neither step invokes the skill or grants runtime permissions.

This guide uses the `collections` skill from `@tanstack/db-skills@0.0.1`. Its native name is `tanstack-db-collections`. <!-- BIND: pending installed evidence --> The example includes `SKILL.md`, five reference files, and the package MIT notice. <!-- BIND: pending installed evidence --> The reviewed selection totals seven files and 37,953 bytes. <!-- BIND: pending installed evidence --> The notice names Kyle Mathews.

## Before you start

Use a public skill. This beta reads only public sources. The npm route reads `registry.npmjs.org`. The Git route reads the public GitHub API without credentials. Private registries and private repositories are not supported. See [Current beta limits](#current-beta-limits).

Expect a hand-written request. Today one skill installs per project, and you write each request file yourself. `bowerloom up --team`, `bowerloom ls`, a `skills.json` file, `bowerloom skills sync`, one-command apply, and commands that create teams, skills, and prompts are not available in this beta release.

Keep the project in a folder that iCloud Drive does not sync. This beta does not support projects inside iCloud Drive. That includes `~/Documents` and `~/Desktop` when "Desktop & Documents Folders" sync is on. <!-- BIND: pending installed evidence --> iCloud Drive changes file metadata, such as change time and extended attributes, while Bowerloom checks file integrity. Installs and updates in a synced folder are then refused or need recovery. Move the project to an unsynced folder before you plan an install.

## What stays under your control

- You choose the exact package version or Git commit. Bowerloom does not accept `latest`, a version range, a branch, or a tag.
- You read the whole skill, its references, and its license before any download.
- You approve the source plan, then the installation plan, as two separate decisions.
- Your existing governance, permissions, and agent settings stay in place. Bowerloom does not replace destination files without a plan that shows them.
- Adding a skill does not run it. You review runtime permissions before you ask your harness to use it.

## Ask your agent

```text
Add the reviewed collections skill from @tanstack/db-skills@0.0.1 to Bowerloom in my existing project. Read the complete skill, references, license, dependencies, and requested effects. Keep my existing governance and permissions. Show the pinned source plan before acquisition, then the exact file plan before installation. Wait for my approval of each plan. Inspect the installed revision and report a reviewed update or an up-to-date result. Do not run package scripts, invoke the skill, or start agents.
```

## Agent procedure

### Prepare the project and private records

Read [Install Bowerloom](/docs/start/) for the matching release and installation requirements.

<!-- BIND: pending installed evidence -->
```sh
bowerloom --version
```

Select the existing project and its harness with the human. Use `codex` or `claude` in the installation request.

Create separate private directories for request records, acquisition cache, and installation state. Keep the cache and state outside the project. Keep all three roots separate without nested paths. Place installation state on the same filesystem as the project.

Use absolute paths without symlinks. A project or state path may not hold a folder named `.git`, `.ssh`, `.config`, `.codex`, `.claude`, `.agents`, `node_modules`, or `library`, in any letter case. That refuses paths under `~/.config` and `~/Library`. Own the private directories with mode `0700`. Store request and plan files with mode `0600`. Their ancestors must deny group and other writes.

Set these example paths to your approved directories:

<!-- BIND: pending installed evidence -->
```sh
PROJECT=/absolute/projects/my-project
RECORDS=/absolute/private/bowerloom-collections/records
CACHE=/absolute/private/bowerloom-collections/cache
STATE=/absolute/private/bowerloom-collections/state
SOURCE_OPERATION=REPLACE_WITH_32_LOWERCASE_HEX_CHARACTERS
MIN_FREE_BYTES=12884901888
umask 077
```

`SOURCE_OPERATION` identifies one acquisition attempt. Use a fresh 32-character lowercase hexadecimal value. <!-- BIND: pending installed evidence --> This example preserves 12 GiB of free space. Set `MIN_FREE_BYTES` to your required reserve before planning. <!-- BIND: pending installed evidence --> The cache needs a `minFreeBytes` of at least 12,582,912. The install request needs at least 33,554,432. <!-- BIND: pending installed evidence --> Each `skills` command stops after 35 seconds. Run it again if it stops.

### Review the pinned source

Read the complete skill, its five references, and the MIT notice. Record the publisher, exact package version, source hashes, dependencies, and requested effects.

The selected references are `custom-collections.md`, `electric-collection.md`, `local-collections.md`, `query-collection.md`, and `sync-modes.md` under `references/`. The source root is `package/skills/tanstack-db/collections`. Preserve the included `package/LICENSE` as `LICENSE` in the selected files.

The examples describe API calls, database synchronization, browser storage, and data changes. Adding the skill does not approve those actions or install its library dependencies. Retain the personal agent permissions and governance.

Prepare `npm-source-request.json` with the reviewed acquisition record. Use the exact version, metadata digest, npm integrity value, publisher, file inventory, local references, and included license. Do not use `latest` or a version range.

### Plan and approve acquisition

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills source plan --request "$RECORDS/npm-source-request.json" --state "$CACHE" --operation "$SOURCE_OPERATION" --min-free-bytes "$MIN_FREE_BYTES" > "$RECORDS/source-plan.json"
```

Read the source identity, metadata and archive URLs, file hashes, license, cache destination, limits, and complete `revision`. Planning does not download the source.

Show the human the exact plan before acquisition. <!-- BIND: pending installed evidence --> Wait for approval of its complete 64-character lowercase hexadecimal revision.

Set `ACQUISITION_REVISION` to that approved revision.

<!-- BIND: pending installed evidence -->
```sh
ACQUISITION_REVISION=REPLACE_WITH_APPROVED_SOURCE_PLAN_REVISION
```

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills source acquire --plan "$RECORDS/source-plan.json" --approve "$ACQUISITION_REVISION" > "$RECORDS/source-result.json"
```

Prepare `cache-inspect-request.json` with `root` set to `CACHE` and `operationId` set to `SOURCE_OPERATION`.

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills source inspect --request "$RECORDS/cache-inspect-request.json" > "$RECORDS/cache-inspection.json"
```

<!-- BIND: pending installed evidence -->
If the cache status is not `COMPLETED`, inspect or recover it before installation.

Read the completed cache result and its receipt. Compare the recorded source, inventory, and license with the reviewed request. Use `snapshotRevision` and `receipt.revision` in the installation request. Acquisition approval does not approve project writes.

### Plan the project files

Prepare `install-request.json` with the existing project path, private state path, selected harness, and exact cache revisions. Set `operation` to `install` and `expectedPreviousRevision` to `null`.

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills plan --request "$RECORDS/install-request.json" > "$RECORDS/install-plan.json"
```

Read `material`, `core.before`, `core.closure.receipt.source`, `core.closure.receipt.license`, and `revision`. Show every proposed file and its hash to the human.

<!-- BIND: pending installed evidence -->
The canonical definition uses `.bowerloom-skills/skills/collections/`. The catalog uses `.bowerloom-skills/catalog.json`. The harness projection uses `.agents/skills/tanstack-db-collections/` for Codex or `.claude/skills/tanstack-db-collections/` for Claude Code.

<!-- BIND: pending installed evidence -->
The plan includes the skill, all five references, and `LICENSE` in both file copies. Existing destination files cannot be silently replaced during installation.

### Approve and install

Wait for human approval of the complete installation plan revision. Set `INSTALL_REVISION` to that approved revision.

<!-- BIND: pending installed evidence -->
```sh
INSTALL_REVISION=REPLACE_WITH_APPROVED_INSTALL_PLAN_REVISION
```

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills apply --plan "$RECORDS/install-plan.json" --approve "$INSTALL_REVISION" --previous none > "$RECORDS/install-result.json"
```

Prepare `installed-inspect-request.json` with `projectDir` and `stateDir` from the installation request.

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills inspect --request "$RECORDS/installed-inspect-request.json" > "$RECORDS/installed-inspection.json"
```

Read the committed receipt, installed paths, hashes, plan revision, and receipt revision. Compare them with the approved plan. Keep private receipts and absolute paths outside shared skill definitions.

The harness projection installs files for discovery. Successful installation does not prove native discovery or invocation. Review runtime permissions before you separately ask the harness to use the skill.

### Inspect an update

Keep the same source kind, package or repository, skill identity, project, and harness. Read the installed receipt before preparing an update request.

Prepare `update-request.json` with `operation` set to `update`. Set `expectedPreviousRevision` to the `revision` of the installed receipt. Use the exact inspected cache snapshot and receipt revisions.

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills update plan --request "$RECORDS/update-request.json" > "$RECORDS/update-result.json"
```

<!-- BIND: pending installed evidence -->
Only one version of `@tanstack/db-skills` is published, which is `0.0.1`. The unchanged reviewed bytes produce `status: "up-to-date"`. Read `previousRevision`, `writesAuthorized`, and `executionAuthorized`. An up-to-date result requires no installation approval or apply command. It does not search for a newer release.

Do not apply an up-to-date result as a file plan.

<!-- BIND: pending installed evidence -->
A changed update works today. Publish a new exact version, or review a newer commit. Review its complete selected content first. Prepare a new pinned acquisition request with a fresh operation identifier. Obtain acquisition approval before you download it. Inspect that completed cache before you prepare the update request.

If update planning returns a file plan, compare the previous and proposed source records. Show every file change, license change, and requested effect. Wait for approval of the new plan and its exact previous receipt revision. Set these values to the approved revisions:

<!-- BIND: pending installed evidence -->
```sh
UPDATE_REVISION=REPLACE_WITH_APPROVED_UPDATE_PLAN_REVISION
PREVIOUS_REVISION=REPLACE_WITH_APPROVED_INSTALLED_RECEIPT_REVISION
```

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills apply --plan "$RECORDS/update-result.json" --approve "$UPDATE_REVISION" --previous "$PREVIOUS_REVISION" > "$RECORDS/update-apply-result.json"
bowerloom skills inspect --request "$RECORDS/installed-inspect-request.json" > "$RECORDS/update-inspection.json"
```

Read the resulting receipt and files before you report the update. No update searches for a newer release by itself. This guide shows no changed Git update example.

### Use a pinned Git source

For Git, prepare `git-source-request.json` with the exact GitHub repository, commit, tree, path trees, metadata digest, selected inventory, references, and included license. Use full lowercase 40-character commit and tree identifiers. Do not use a branch or tag.

Use the Git plan form instead of the npm plan form:

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills source git plan --request "$RECORDS/git-source-request.json" --state "$CACHE" --operation "$SOURCE_OPERATION" --min-free-bytes "$MIN_FREE_BYTES" > "$RECORDS/source-plan.json"
```

Read the Git plan and obtain its exact approval. Set `ACQUISITION_REVISION` from that approved Git plan.

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills source git acquire --plan "$RECORDS/source-plan.json" --approve "$ACQUISITION_REVISION" > "$RECORDS/source-result.json"
```

Use the shared cache inspection and installation commands afterward. An npm installation cannot switch to Git through the update workflow.

The npm example does not establish an equivalent Git commit. Pin and review a Git selection separately. Acquisition records bind selected bytes to the reviewed source. They do not authenticate a publisher or prove safe instructions.

### If a command refuses or stops

If local installed files change, preserve those edits. Inspect the operation and resolve the changes with the human before planning again. Do not use an update to overwrite them.

If approval is stale or incorrect, obtain a new plan and exact approval. Do not reuse approval for changed source, records, destinations, or prior revisions.

<!-- BIND: pending installed evidence -->
If `SKILLS_CHANGED` appears, inspect the request or plan record and its directory state.

Every refusal is one line of JSON on standard error. Standard output is empty. A refusal exits 1. A usage error, code `USAGE`, exits 2.

<!-- BIND: pending installed evidence -->
`SKILLS_REFUSED (<CODE>)` means the command stopped for a known reason. The code in parentheses names the reason, such as `NPM_CACHE_DIRECTORY` or `GIT_TREE_BOUND`. Keep the error, then inspect the cache and installation records before another action.

```text
{"error":{"code":"SKILLS_REFUSED","message":"The skills command stopped (NPM_CACHE_DIRECTORY). Inspect the exact local cache and operation records before another action; no native execution authority is granted."}}
```

<!-- BIND: pending installed evidence -->
`SKILLS_RECORD` means a request or plan record is not valid. `SKILLS_CHANGED` means the record or its folder changed. `SKILLS_OUTPUT` means the command could not write its result. Read the record, fix it, and plan again.

<!-- BIND: pending installed evidence -->
`SKILLS_UNCERTAIN` means the cache state is not certain. Its message names two codes. Run `bowerloom skills source inspect`, then `bowerloom skills source recover plan`, before another action.

```text
{"error":{"code":"SKILLS_UNCERTAIN","message":"The skills cache state is uncertain (<CODE>, <SECONDARY>). Run bowerloom skills source inspect, then bowerloom skills source recover plan, before another action; no native execution authority is granted."}}
```

<!-- BIND: pending installed evidence -->
If the second code ends in `_CACHE_OPEN_PARTIAL`, recovery cannot read the operation folder. Start again with a new `SOURCE_OPERATION`. Do not try to recover that folder.

```text
{"error":{"code":"SKILLS_UNCERTAIN","message":"The skills cache operation folder is partial (<CODE>, <..._CACHE_OPEN_PARTIAL>). Recovery cannot read this folder. Start again with a new SOURCE_OPERATION; no native execution authority is granted."}}
```

<!-- BIND: pending installed evidence -->
Installation commands refuse with these codes in the parentheses:

- `MANAGED_SKILL_STALE_APPROVAL` means the approved revision no longer matches the plan. Make a new plan and ask for a new approval.
- `MANAGED_SKILL_LOCAL_DRIFT` means someone edited an installed file. Keep the edit. Inspect the installation and resolve the change with the human before you plan again. Do not use an update to overwrite it.
- `MANAGED_SKILL_RECOVERY_REQUIRED` means an earlier installation stopped partway. Run `bowerloom skills recover plan`.
- `MANAGED_SKILL_LOCKED` means another command holds the installation. Wait, then plan again.
- `MANAGED_SKILL_TIMEOUT` and `MANAGED_SKILL_ABORTED` mean the command ran past 35 seconds or stopped early. Inspect the installation before you plan again.
- `MANAGED_SKILL_REFUSED` also covers drift in the cache snapshot or the receipt. It is the general installation refusal, so it does not tell drift apart from other causes. Inspect the cache and the installation before you plan again.

<!-- BIND: pending installed evidence -->
If interruption leaves an uncertain result, the command refuses with `SKILLS_INTERRUPTED_UNCERTAIN`. Inspect before another write. A `completed-after-interruption` result requires inspection. It does not grant execution authority.

For cache recovery, prepare `source-recovery-request.json` with the cache root, acquisition operation identifier, and reviewed action `finalize` or `hold`.

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills source recover plan --request "$RECORDS/source-recovery-request.json" > "$RECORDS/source-recovery-plan.json"
```

Show the cache recovery plan and wait for exact approval. Set `SOURCE_RECOVERY_REVISION` to the approved revision.

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills source recover apply --plan "$RECORDS/source-recovery-plan.json" --approve "$SOURCE_RECOVERY_REVISION"
```

For installation recovery, prepare `recovery-request.json` with the project, state, operation key, and reviewed action `resume` or `rollback`.

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills recover plan --request "$RECORDS/recovery-request.json" > "$RECORDS/recovery-plan.json"
```

Show the installation recovery plan and wait for exact approval. Set `RECOVERY_REVISION` to the approved revision.

<!-- BIND: pending installed evidence -->
```sh
bowerloom skills recover apply --plan "$RECORDS/recovery-plan.json" --approve "$RECOVERY_REVISION"
```

Inspect the cache or installation after recovery. Preserve retained state until the supported recovery result resolves the outcome.

## Package your own skills

Keep your own skills in one versioned source. Every project then installs them the same way. Bowerloom pins an exact package version or an exact Git commit, so each install is repeatable and reviewable.

Bowerloom reads two kinds of source. Use the npm route for a package. Use the Git route for a repository you already have.

### Rules for both routes

- Do not use symlinks. The npm reader refuses a link entry in the archive. The Git reader accepts only regular files and folders.
- Use relative links only, and only to files inside the same skill folder.
- Use the MIT or the Apache-2.0 license, and no other. <!-- BIND: pending installed evidence --> Include a license file named `LICENSE` or `NOTICE`. Its text must contain "MIT License" or "Apache License". Declare the same license in your metadata.
- <!-- BIND: pending installed evidence --> Write every other file as `.md`, `.txt`, `.json`, `.yaml`, `.yml`, or `.csv`.
- <!-- BIND: pending installed evidence --> Start `SKILL.md` with frontmatter. It may use only the keys `name`, `description`, `license`, `compatibility`, and `metadata`. The `name` must equal the skill name.
- <!-- BIND: pending installed evidence --> For Git, set every file to mode 100644, with no executable files. Select every file in the skill folder. A file you leave out refuses with `GIT_SELECTED_INVENTORY`.
- Name the skill with lowercase letters, digits, and single hyphens, up to 64 characters.
- Keep the package working folder out of iCloud Drive. The limit in "Before you start" applies to it too.

### Ask your agent to package the skills

```text
Package my skills so that every project can install them from one pinned source. Use the npm route with a skills/<name>/SKILL.md folder for each skill. Add no symlinks. Keep links relative and inside each skill folder. Include a license. Show me the package contents before you publish. Wait for my approval. Do not publish, install, or invoke anything until I approve.
```

### The npm route

Create this layout in a folder that iCloud Drive does not sync:

```text
my-skills/
  package.json
  LICENSE
  skills/
    my-skill/
      SKILL.md
      references/
```

The `package.json` needs `name`, `version`, `files`, and `license`. List `skills` and `LICENSE` in `files`.

<!-- BIND: pending installed evidence -->
```json
{
  "name": "@my-team/skills",
  "version": "1.0.0",
  "license": "MIT",
  "files": ["skills", "LICENSE"]
}
```

Publish to the registry. <!-- BIND: pending installed evidence --> The Bowerloom npm source reads from `https://registry.npmjs.org` in this beta. The package name must be lowercase, with an optional lowercase scope. <!-- BIND: pending installed evidence --> The version must be an exact version such as `1.0.0`. A range, `latest`, or a tag does not work.

Ask your agent to pack the folder and show the file list before you publish.

<!-- BIND: pending installed evidence -->
```sh
npm pack --dry-run
```

Install by exact version. Prepare the npm acquisition record for `@my-team/skills@1.0.0`, then follow "Plan and approve acquisition" above. Use the `source plan` command with that record.

To update, publish a new exact version. Review its complete selected content. Prepare a new acquisition record with a fresh operation identifier. Approve the new plan before Bowerloom downloads it. Then follow "Inspect an update".

These limits come from the npm source code. <!-- BIND: pending installed evidence --> A selection holds at most 128 files. <!-- BIND: pending installed evidence --> Each file is at most 65,536 bytes. <!-- BIND: pending installed evidence --> The whole selection is at most 2,097,152 bytes. <!-- BIND: pending installed evidence --> The archive holds at most 1,024 entries. <!-- BIND: pending installed evidence --> A selection uses at most 128 directories.

### The Git route

Add a `skills/` folder to a repository you already have. Put each skill at `skills/<name>/SKILL.md`. Add a license file.

Use a public GitHub repository. Write the repository as `owner/repo` in lowercase. <!-- BIND: pending installed evidence --> Do not end the name with `.git`. Pin a full commit. The commit must be 40 lowercase hexadecimal characters. A short commit, a branch, or a tag does not work.

Ask your agent to read the commit and tree identifiers, then prepare the Git acquisition record. Follow "Use a pinned Git source" above.

<!-- BIND: pending installed evidence -->
```sh
git rev-parse HEAD
```

To update, review a newer commit in the same repository. Prepare a new acquisition record. Approve the new plan before download. Then follow "Inspect an update".

The Git reader applies the same selection limits as the npm reader. <!-- BIND: pending installed evidence --> That means at most 128 files, at most 65,536 bytes per file, and at most 2,097,152 bytes in total.

Git reads only the selected skill folder. It does not read the rest of the repository, so a large repository works. <!-- BIND: pending installed evidence --> The path to the skill folder may be at most 8 folders deep. <!-- BIND: pending installed evidence --> A skill folder at depth 8 may hold up to 120 files. <!-- BIND: pending installed evidence --> A single folder listing may hold at most 1,024 entries. A longer listing refuses with `GIT_TREE_BOUND`.

<!-- BIND: pending installed evidence -->
GitHub limits requests that carry no credentials. A skill makes up to 2 plus its folder depth plus its number of files requests. A large skill can reach the GitHub limit. If GitHub refuses, wait before you run the plan again.

## Request records

Prepare these JSON records with the existing file editor. Replace the example paths and revision markers with the exact reviewed values. Do not add unlisted fields.

<!-- BIND: pending installed evidence -->
The npm acquisition record requires these fields:

`package`, `version`, `integrity`, `metadataSha256`, `publisher`, `declaredLicense`, `skill`, `files`, `references`, and `license`.

The `skill` field contains `id`, `name`, and `sourceRoot`. Each file contains `path`, `sourcePath`, `sha256`, `bytes`, and numeric `mode: 420`. Each reference contains `from` and `to`. `license` contains `spdx`, `origin: "included"`, and `files`.

For this example, use `skill.id: "collections"` and `skill.name: "tanstack-db-collections"`. Keep file hashes and metadata values from the reviewed source record. The published package version is separate from any version declared inside a skill.

<!-- BIND: pending installed evidence -->
A Git acquisition record replaces npm package fields with `repository`, `commit`, `tree`, `pathTrees`, and `metadataSha256`. `pathTrees` lists one tree identifier for each folder on the path to the skill, from the first folder to the skill folder. Each identifier is 40 lowercase hexadecimal characters. The last one is the skill folder. The path may have at most 8 folders. It retains `declaredLicense`, `skill`, `files`, `references`, and `license`. Use reviewed Git paths and hashes. Do not infer them from npm repository metadata.

The installation request uses this shape:

<!-- BIND: pending installed evidence -->
```json
{
  "operation": "install",
  "projectDir": "/absolute/projects/my-project",
  "stateDir": "/absolute/private/bowerloom-collections/state",
  "harness": "codex",
  "cache": {
    "root": "/absolute/private/bowerloom-collections/cache",
    "operationId": "EXACT_ACQUISITION_OPERATION_ID",
    "expectedSnapshotRevision": "EXACT_CACHE_SNAPSHOT_REVISION",
    "expectedReceiptRevision": "EXACT_CACHE_RECEIPT_REVISION"
  },
  "expectedPreviousRevision": null,
  "minFreeBytes": 12884901888
}
```

For an update request, change `operation` to `update`. Set `expectedPreviousRevision` to the complete installed receipt revision. Set the cache selector to the exact proposed acquisition. Preserve the project, state, harness, and skill identity.

<!-- BIND: pending installed evidence -->
Cache inspection accepts only `root` and `operationId`. Installed inspection accepts `projectDir`, `stateDir`, and an optional `operationKey`.

<!-- BIND: pending installed evidence -->
Cache recovery adds `action` to the cache inspection fields. Installation recovery requires `projectDir`, `stateDir`, `operationKey`, and `action`. The recovery commands accept their generated plans after exact approval.

## Bug reports, feedback, and feature discussions

The beta is open. Tell the team what works and what does not.

- Report a reproducible bug in [Issues](https://github.com/sageadvicellc/bowerloom/issues). Name the command, the exact error code, and the Bowerloom version.
- Ask a setup or usage question in [Q&A](https://github.com/sageadvicellc/bowerloom/discussions/categories/q-a).
- Share general feedback in [General](https://github.com/sageadvicellc/bowerloom/discussions/categories/general).
- Propose a feature in [Ideas](https://github.com/sageadvicellc/bowerloom/discussions/categories/ideas). Describe the task, the problem, the result you want, and your current workaround.

Search open and closed reports before you write a new one. Use synthetic inputs in your reproduction. Keep credentials, private paths, raw receipts, and customer data out of public posts. Read [Bug reports and feedback](/docs/feedback/) for a report outline and privacy guidance.

A report or proposal does not guarantee a fix, a response time, or a release date.

## Current beta limits

- Public skills only. The npm route reads only `registry.npmjs.org`. The Git route reads only the public GitHub API, without credentials. Bowerloom cannot read a private registry or a private repository in this beta.
- Only the MIT and Apache-2.0 licenses are accepted.
- One skill installs per project. Each install needs a request file that you write by hand. <!-- BIND: pending installed evidence --> A second skill in the same project is not supported.
- This beta does not support projects inside iCloud Drive. Keep the project, and keep the cache and state directories, in folders that iCloud Drive does not sync. Bowerloom keeps its strict integrity checks and does not relax them for synced folders. <!-- BIND: pending installed evidence --> A synced folder can make an install or update refuse or need recovery.

## Future versions

This section describes work that this guide does not yet prove. Do not treat it as a current beta instruction.

- Private npm registries and private Git repositories are not part of this beta. They are not available in this beta release.
- Not available in this beta release: `bowerloom up --team`, `bowerloom ls`, a `skills.json` file, `bowerloom skills sync`, one-command apply, and commands that create teams, skills, and prompts.

## Continue

[Codex and Claude Code](/docs/harnesses/) explains harness boundaries. [Files and configuration](/docs/configuration/) describes project files.

[Current support](/docs/status/) describes release support. Installation approval authorizes the planned files. It does not approve agents, teams, hooks, or skill execution.
