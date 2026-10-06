---
title: "Add a portable skill for Codex"
description: "Store a reviewed skill in a bundle, then approve its projection into a new Codex workspace."
section: "Guides"
order: 7.5
---

Store a skill in a portable bundle before installing it. Storage, harness discovery, and agent execution are separate steps.

A bundle is a versioned collection of selected files. This guide uses the reviewed `report-seed` example and a new Codex workspace.

## Choose the supported route

| Your task | Current route |
| --- | --- |
| Store a portable skill | Add reviewed text and a part entry to a standalone bundle. |
| Project a skill for Codex | `portable plan` and exact approved `portable install` create a new workspace. |
| Add to an existing workspace | This portable installer refuses existing targets, including empty directories. |
| Install a portable skill for Claude Code | Unsupported. The portable installer accepts only `codex`. |
| Change selected synthetic harness configuration | The separate `harness` commands cover model and reasoning fields, not skill files. |
| Start an agent or team | Skill installation provides no execution authority. |

## Ask your agent

```text
Help me prepare the reviewed Bowerloom report-seed skill for Codex. Show its source, destination, and file plan before writing anything. Wait for my exact approval before installation. Do not invoke the skill or start agents.
```

## Agent procedure

### Prerequisites

Read [Install Bowerloom](/docs/start/) for the matching version and installation requirements.

Use a supplied, separately reviewed copy of `examples/portable/report-seed`. The installed CLI does not retrieve that source for you.

Select a new absolute target under an existing private directory that you own. Its parent must deny group and other writes.

Keep the target separate from the source. The target and its ancestors must contain no symlinks or protected harness directories. Use a trusted parent without concurrent writers.

### Review the skill source

Read the complete skill before adding it. For an external skill, record its repository, publisher, exact revision, license, dependencies, and requested effects.

Review referenced text files as part of the same source. Do not copy credentials, private company data, hooks, or executable scripts.

Skill instructions do not enforce their own permissions. Retain your personal agent's existing access controls and review requirements.

### Store the portable definition

Show the proposed source files to the human before writing them. Use the existing file editor only within that approved source scope.

Use this complete standalone source layout from the reviewed example:

```text
/absolute/projects/report-bundle/
└── .bowerloom/
    ├── manifest.json
    ├── skills/
    │   └── report/
    │       ├── SKILL.md
    │       └── sample.csv
    └── teams/
        └── editorial/
            └── team.json
```

The existing example's `.bowerloom/manifest.json` declares these parts:

```json
{
  "schemaVersion": "bowerloom/v1alpha1",
  "parts": [
    { "id": "report", "kind": "skill", "files": ["skills/report/SKILL.md", "skills/report/sample.csv"], "dependsOn": [], "requiredControls": ["installer-local-files-only", "installer-explicit-review"] },
    { "id": "editorial", "kind": "team", "files": ["teams/editorial/team.json"], "dependsOn": ["report"], "requiredControls": ["installer-explicit-review"] }
  ]
}
```

The skill entry lists `skills/report/SKILL.md` and `skills/report/sample.csv`. The editorial team declares a dependency on that skill.

Keep the manifest and all three declared source files, including the unselected team file. Bundle validation reads every declared file.

The example contains synthetic packing data. Read `SKILL.md`, its CSV input, and the team definition before installation.

When the skill runs, its instructions request a new `packing-report.md` in the active workspace. Installation does not create that report.

For another skill, place its reviewed files under `.bowerloom/skills/<part-id>/`. Each skill part requires a declared `SKILL.md` and explicit supporting files.

Review its changed manifest and source bytes before a new plan. The guide's commands below select only the frozen `report` example.

Do not replace the manifest from [first-team setup](/docs/learn/first-team/). Its managed inventory uses a different format.

Adding files directly to that installed managed directory can produce drift. The portable example uses a separate source bundle.

### Inspect the bundle and plan

Replace the example paths with your reviewed source and unused target. Keep the selected part explicit.

```sh
bowerloom portable validate /absolute/projects/report-bundle
```

Read the manifest, source hashes, and `bundleRevision`. Successful validation reports `executionAuthorized: false`.

```sh
bowerloom portable plan /absolute/projects/report-bundle --select report --harness codex --target /absolute/private-projects/report-trial
```

Read `selected`, `dependencies`, `parts`, `files`, `generatedFiles`, `bundleRevision`, `manifestSha256`, and `revision`.

Review every source hash and destination. Selecting a part also includes its declared dependencies.

For `--select report`, the plan contains only the report skill. Its dependency list is empty. The editorial team remains unselected.

The plan reports `controlScope: "installer-only"` and `executionAuthorized: false`. These fields do not restrict future harness behavior.

### Approve the exact file projection

Show the complete plan to the human. Wait for approval of its exact revision.

Replace `EXACT_PORTABLE_PLAN_REVISION` with that plan's complete 64-character `revision`. Keep the source bytes, selection, harness, and target unchanged.

```sh
bowerloom portable install /absolute/projects/report-bundle --select report --harness codex --target /absolute/private-projects/report-trial --approve EXACT_PORTABLE_PLAN_REVISION
```

Installation creates the new workspace. It does not change the source bundle or your home configuration.

### Inspect the installed files

Use the existing file reader for these paths under your selected target:

```text
report-trial/
├── START-HERE.md
├── .agents/
│   └── skills/
│       └── bowerloom-report/
│           ├── SKILL.md
│           └── sample.csv
└── .bowerloom/
    └── installation-receipt.json
```

Portable skill files go to `.agents/skills/bowerloom-<part-id>/`. This example stores the source in `.bowerloom/skills/report/` and projects it separately.

Read the root `START-HERE.md` and private receipt. Compare `plan.revision` and the installed hashes with the approved plan.

This guide uses the portable receipt. Do not use `init status` or edit a first-team receipt to interpret it.

Keep the receipt and absolute paths private. Installed team parts, when selected, remain data under `.bowerloom/teams/<part-id>/`.

The project-local path is intended for Codex skill discovery. Successful file installation does not prove that Codex discovered or ran the skill.

Before invoking the skill, review its requested effects and your agent application's permissions. Installation grants no permission to run it.

### If installation refuses

If `STALE_APPROVAL` or `SOURCE_CHANGED` appears, inspect the actual source. Prepare another plan and obtain new exact approval.

If `TARGET_EXISTS` appears, preserve that workspace. Select another intended new target instead of deleting the current project.

If `UNSUPPORTED_HARNESS` appears, retain the refusal. Do not rename Claude Code as Codex or substitute a configuration projection.

If an I/O outcome is uncertain, inspect the retained files and receipt. Do not repeat installation blindly.

### Removal and recovery limits

If an attempt fails before the final rename, the installer removes only that attempt's staging directory and lock.

A crash can leave staging or a lock. Preserve uncertain state before any separately approved manual cleanup.

The portable CLI exposes `validate`, `plan`, and `install`. It has no public `remove`, `recover`, or installed-status command.

The separate `harness remove` and `harness recover` commands concern recorded synthetic configuration transactions. They do not remove portable skill files.

`revise recover` concerns first-team revision, not this portable installation. Preserve the source, target, and receipt if the outcome is uncertain.

Removing a skill requires a separately reviewed file-removal scope. This guide grants no deletion or cleanup authority.

To review changed skill files, prepare another source plan for a new target. The current installer provides no update into an existing workspace.

## Version and source

These commands describe `0.7.0-beta.0` and its `report-seed` example. Use the matching example files with that version.

The example installs files. It does not demonstrate live skill discovery or execution.

## Continue

[Codex and Claude Code](/docs/harnesses/) explains synthetic configuration limits. [Files and configuration](/docs/configuration/) describes first-team files.

[Current support](/docs/status/) describes supported tasks. A projected file does not establish cross-harness runtime support.
