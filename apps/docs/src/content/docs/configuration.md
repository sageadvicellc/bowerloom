---
title: "Files and configuration"
description: "Locate the full setup inventory and separate definitions from private records."
section: "Reference"
order: 23
---

The reviewed first setup proposes 20 files under `.bowerloom/`. Approved application adds a private `installation-receipt.json` as the twenty-first file.

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

These files do not prove that a model, socket, backend, or retrieval system runs. [Teams and files](/docs/concepts/teams-and-files/) explains the distinction.

## Portable skill bundles

[Add a portable skill for Codex](/docs/guides/add-skills/) explains the separate bundle manifest and project-local projection.

That installer uses a new workspace. It does not add files to this managed first-team inventory or install skills into Claude Code.

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

[Current support](/docs/status/) records qualification. [CLI reference](/docs/cli/#first-setup) records the available input forms.
