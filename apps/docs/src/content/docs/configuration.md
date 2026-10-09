---
title: "Files and configuration"
description: "Locate the full setup inventory and separate definitions from private records."
section: "Reference"
order: 23
---

Bowerloom integrates a team specification with your project through 20 proposed files under `.bowerloom/`. The roles, prompts, agreement, and maps describe the workflow for review. Exact approved application adds a private `installation-receipt.json` as the twenty-first file. Commit `skills.json` and the team, skill, and prompt definitions with your project. Keep the receipt, the setup notes, and credentials on your machine. The specification does not import project contents or start workers.

## Portable setup

Start with `START-HERE.md` and `startup-review.md`. Then read the profile, team roles, agreement, and milestones.

The exact plan supplies every file's content and hash. The table below lists the complete proposed inventory relative to `.bowerloom/`.

| File | Purpose |
| --- | --- |
| `START-HERE.md` | First local reading guide |
| `brief.json` | Normalized project brief |
| `manifest.json` | Managed setup inventory |
| `milestones.md` | Proposed milestones |
| `optional-controls.md` | Separate optional controls |
| `skills/personal-assistant/SKILL.md` | Personal-agent instructions |
| `skills/personal-assistant/profile.json` | Personal-agent profile |
| `startup-review.md` | Human review guide |
| `startup.json` | Setup specification |
| `teams/first-team/assets/brief.json` | Team brief asset |
| `teams/first-team/assets/milestones.md` | Team milestones asset |
| `teams/first-team/assets/working-agreement.md` | Team agreement asset |
| `teams/first-team/maps/relay.json` | Communication declarations |
| `teams/first-team/maps/vines.json` | Logging declarations |
| `teams/first-team/prompts/lead.md` | Lead role prompt |
| `teams/first-team/prompts/maker.md` | Maker role prompt |
| `teams/first-team/prompts/reviewer.md` | Reviewer role prompt |
| `teams/first-team/skills/bounded-draft.md` | Bounded drafting skill |
| `teams/first-team/team.yaml` | Portable team definition |
| `working-agreement.md` | Proposed working agreement |

## Brief fields

The CLI accepts a JSON brief through `--brief`. This sanitized example contains no approval or private installation record.

```json
{
  "projectName": "Clean install trial",
  "goal": "Review a synthetic team setup",
  "profile": "engineer",
  "assistantName": "Personal assistant",
  "teamName": "First team",
  "reviewMode": "milestones"
}
```

| Field | Type and accepted values | Default or requirement |
| --- | --- | --- |
| `projectName` | Nonempty text, at most 120 UTF-8 bytes | Required. Inline flag: `--name`. |
| `goal` | Nonempty text, at most 6000 UTF-8 bytes | Required. Inline flag: `--goal`. |
| `profile` | `engineer`, `founder`, or `research` | `engineer` |
| `assistantName` | Nonempty text, at most 100 UTF-8 bytes | `Personal assistant` |
| `teamName` | Nonempty text, at most 120 UTF-8 bytes | `First team` |
| `reviewMode` | `milestones` or `handoff` | `milestones` |

The inline flags for optional names and review are `--assistant`, `--team`, and `--review`. Do not mix them with `--brief`.

The CLI validates accepted fields and text. The goal remains data in a fixed template, not an instruction that grants execution authority.

## Team definitions and maps

`team.yaml` declares roles, skills, assets, and proposed access. The maps declare communication and logging structure.

The fixed graph connects scope to draft and both outputs to review. Its declarations do not start a model, socket, backend, or retrieval system. [Teams and files](/docs/concepts/teams-and-files/) explains the specification, and [Map your existing workflow](/docs/guides/integrate-workflow/) connects it to your process.

## Skills, prompts, and what to commit

<a id="skills-json"></a>

`.bowerloom/skills.json` is the one file that pins third-party skills. Its format is `bowerloom/skills/v1beta1`. It lists the harnesses, the agent applications that read the skills (`claude` for Claude Code and `codex` for Codex), and one entry for each skill. A pinned entry holds an exact npm version or a full 40-character Git commit, the integrity and tree values that prove the bytes, the license, and the hash of every file. Exact pins only. A range, tag, or branch is not a pin. An entry made by `skill create` is a local entry that points at `skills/<id>`. The file is its own lock. It holds at most 32 skills and 1 MiB. Bowerloom reads it strictly, so a hand edit can break it (`MANIFEST_INVALID`). Use `bowerloom skills add` to change it.

| Path | Holds | Commit it |
| --- | --- | --- |
| `.bowerloom/skills.json` | Exact pins and local skill entries | Yes |
| `.bowerloom/skills/<name>/SKILL.md` | A skill you authored with `skill create` | Yes |
| `.bowerloom/prompts/<name>.md` | A prompt you created with `prompt create` | Yes |
| `.bowerloom/teams/<team id>/` | A team: `first-team` from setup, or one you created with `team create`. Its `assets/brief.json` holds the goal text, the team's shared purpose, so read it before you commit it | Yes |
| `.bowerloom/skills/personal-assistant/` | The assistant skill that setup makes. Its `profile.json` holds the project name | Yes |
| `.bowerloom/authoring/receipt.json` | The record of the teams, skills, and prompts you created | Yes |
| `.bowerloom/installation-receipt.json` | The private setup receipt. It holds absolute paths on your machine | No |
| `.bowerloom/brief.json`, `manifest.json`, `startup.json`, `startup-review.md`, `START-HERE.md`, `working-agreement.md`, `milestones.md`, `optional-controls.md` | Setup files that `bowerloom up` writes. `brief.json` holds your goal text | No |
| `.bowerloom-revision.json`, `.bowerloom-revision-<revision>/` | Revision marker and private revision history, next to `.bowerloom`. The `previous` folder holds the earlier installation receipt | No |
| `.bowerloom/managed/` | Managed copies of pinned skills. Bowerloom writes a `.gitignore` inside it | No |
| `.claude/skills/`, `.claude/commands/`, `.agents/skills/` | Projections: the copies of skills and prompts that Claude Code and Codex read | No |

Managed copies and the `.claude` and `.agents` projections stay on each machine. Each machine rebuilds them with `bowerloom skills sync` and `bowerloom apply`. On a clone, `bowerloom up --team <name>` and `team create` refuse with `PROJECT_BRIEF_INVALID` in this beta, because they read `.bowerloom/brief.json`, which stays on the first machine. The [teammate steps](/docs/guides/add-skills/#get-the-same-skills-on-another-machine) are the supported path. [What to commit](/docs/guides/add-skills/#what-to-commit) gives the exact `.gitignore` lines.

Receipts and the fetch cache live in a private state folder outside the project. That folder is `$XDG_STATE_HOME/bowerloom` when `XDG_STATE_HOME` is set, and `~/.local/state/bowerloom` otherwise. Bowerloom makes new folders there with mode 0700. Keep that folder private.

[Add third-party skills](/docs/guides/add-skills/) explains the commands. [Create teams, skills, and prompts](/docs/guides/create-items/) explains the create commands.

## Portable skill bundles

The `bowerloom portable` forms project selected skill files from a reviewed bundle into a new workspace. See the [CLI reference](/docs/cli/#portable). They do not add files to this managed first-team inventory or install skills into an existing project. For an existing project, use `skills add`, `skills sync`, and `apply`.

## Private local records

`installation-receipt.json` binds the reviewed plan to local installation state. Revision retains separate private history, staging, and transaction records.

Optional connection, runtime, and backend installations add separately approved private records. Do not treat copied receipts as transferred authority.

Inspect definitions for private context before sharing. Keep local paths, logs, tokens, journals, and raw plans private.

## Configuration changes

Use [revision](/docs/revision/) to change the installed goal or profile. Direct edits can produce drift and block readiness.

Preserve a pending revision's original marker and files until [explicit recovery](/docs/guides/recover-revision/) resolves it.

Legacy receipts retain their original identity rules. New Darwin handling does not silently upgrade them or authorize replacement folders.

Keep internal format identifiers unchanged. Do not rename historical schemas or edit identity fields to clear a refusal.

## Support boundary

[Current support](/docs/status/) describes supported tasks and limits. [CLI reference](/docs/cli/#first-setup) records the available input forms.
