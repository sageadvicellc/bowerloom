# Startup from an explicit brief

This package prepares an assistant profile and a first team for the user's existing personal agent. It does not create a hosted assistant.

The scaffold uses deterministic templates. No model tailors a solution or checks the feasibility of the user's goal. The user reviews the result before use.

## API

```ts
planStartup(input: StartupInput): Promise<StartupPlan>
applyStartup(input: StartupInput, exactRevision: string): Promise<StartupReceipt>
inspectStartup(targetDir: string): Promise<StartupInspection>
renderStartupReview(plan: StartupPlan): string
```

```ts
interface StartupInput {
  mode: 'new' | 'existing';
  targetDir: string;
  brief: {
    projectName: string;
    goal: string;
    assistantName?: string;
    teamName?: string;
    reviewMode?: 'milestones' | 'handoff';
    profile?: 'engineer' | 'founder' | 'research';
  };
}
```

`targetDir` must be an absolute canonical path. Project names support normal spaces and punctuation. The goal supports ordinary line breaks and tabs.

Project names have a 120-byte limit. Goals have a 6,000-byte limit. Assistant names have a 100-byte limit, and team names have a 120-byte limit.

Names must use one line. Other control characters, formatting controls, unknown fields, prototype keys, nonplain objects, and accessors are rejected.

The default profile is `engineer`. The other profiles are `founder` and `research`. Unknown profiles are rejected. An explicit `engineer` and an omitted profile produce the same new plan.

The default assistant name is “Personal assistant.” The default team name is “First team.” The default review mode is `milestones`.

## Plan

Planning reads directory identities and entry names. It writes no files and reads no project-file contents.

The plan contains the normalized brief, target mode, directory identities, full generated text, byte counts, content hashes, and compiler output.

The plan revision binds all those fields. A changed profile, goal, target, template, or directory identity invalidates the earlier approval.

`init plan` shows a concise plain-language review by default. It explains the roles, proposed access, limits, target, and exact file-only approval effect. Add `--json` to receive the complete machine plan with every generated file and hash. `apply` and `status` retain JSON output. The renderer does not change the plan or approval revision.

Select a profile with `--profile engineer|founder|research` when using inline `--name` and `--goal`. When using `--brief`, put `profile` in that JSON document; mixing inline brief fields with a brief file is rejected.

The plan validates YAML through the existing crew parser and contracts. It pins generated assets in memory because planning cannot create temporary files.

Application compiles the actual staged files with `compileCrew`. Its result must exactly match the planned compiler result before installation.

## Generated files

The generated `.bowerloom` directory includes these portable definitions:

- `brief.json` retains the explicit user brief and its version.
- `skills/personal-assistant/` contains the existing-agent profile and prompt.
- `teams/first-team/` contains readable YAML, prompts, skills, assets, and maps.
- `working-agreement.md` records boundaries and responsibilities.
- `milestones.md` describes review points and the selected review cadence.
- `startup-review.md` gives the roles, proposed permissions, limits, and file-only approval effect. Its `<details>` block includes all other generated files and compiler evidence. The review cannot recursively contain itself; its own bytes are pinned by the exact plan and installation receipt.
- `START-HERE.md` gives the user a short prompt for their personal agent.
- `manifest.json` declares selectable parts in the portable bundle format.
- `startup.json` identifies the startup template and its main documents.

The machine-specific `installation-receipt.json` contains the target path, directory identities, approved plan, compiler evidence, and file hashes. Exclude it from shared portable definitions.

Generated definitions contain no machine-derived absolute paths. The user controls the text of the explicit brief.

The manifest passes the existing portable bundle validator. The first team depends on the personal-assistant skill. No old installer behavior changes.

The team uses the current `trellis/crew/v0.7-alpha` technical contract. Historical contract identifiers remain valid despite the Bowerloom product name.

## Team specification

The three deterministic profiles have different roles and instructions:

| Profile | Lead | Maker | Reviewer | Proposed draft |
| --- | --- | --- | --- | --- |
| Engineer | Engineering lead | Implementation maker | Code reviewer | Implementation scope, change proposal, and meaningful checks |
| Founder | Startup lead | Operations maker | Claims reviewer | Business scope, operating draft, and decisions |
| Research | Experiment lead | Protocol maker | Methods reviewer | Hypothesis, baseline, repeatable A/B protocol, and methods review |

Each reviewer receives both accepted scope and draft. Research setup does not run comparisons or claim improvement. Engineering setup does not inspect source files or claim passing tests. Founder setup does not contact customers or publish a launch.

Each task declares one bounded Markdown output and requires exact approval. Relay maps connect accepted scope and draft outputs to their consumers.

Vines maps declare future logging channels. Startup does not open connections, collect events, or create a logging service.

The budget declares at most two active workers, a 25 percent reserve, and no paid fallback. A runtime must enforce those declarations separately.

The chosen review cadence never removes exact action approvals. A startup approval authorizes scaffold creation only.

## New workspaces

New mode requires an absent target. The parent must exist, belong to the current user, and deny group or other writes.

Application writes a private sibling staging directory. After compiler and approval checks, it renames the whole staged workspace into the new target.

The new workspace contains only `.bowerloom`. Application does not create agent settings, a repository, dependencies, or runtime state.

## Existing projects

Existing mode requires an existing owned directory with no `.bowerloom` entry. Case variants such as `.Bowerloom` also block adoption.

The new directory is staged outside the project. Application installs only `.bowerloom` into the existing project. The target and parent must share a filesystem.

Existing `AGENTS.md`, `.codex`, `.claude`, `.agents`, source files, and sensitive files remain unread and unchanged. No context or settings are imported.

The parent and target directory identities bind approval. Replacing either directory before application invalidates that approval.

## Safety boundaries

Protected system directories, global settings paths, the home directory itself, and every `nmaahc-sm` path are refused. Symlink ancestors are refused.

Application takes a cooperative sibling lock. Concurrent installers cannot share it. Failure removes only that attempt's staging directory and lock.

A crash can leave a stage or lock. Inspect ownership before manual cleanup. Startup never cleans up another attempt's state.

Node does not offer a portable exclusive directory rename. A hostile same-user process can race the final observations or modify files during installation.

Use a trusted local filesystem without hostile concurrent writers. These checks do not create isolation from another process with equal operating-system authority.

No network call, model session, Docker operation, software installation, worker start, or paid service runs during startup.

## Inspection

Inspection reads only the managed `.bowerloom` files. It compares installed bytes with the receipt and recompiles an unchanged team.

It reports changed, missing, unsafe, unexpected, and corrupted files. It never repairs, replaces, or reapproves them.

Repeated inspection is read-only. `specReady: true` means the specification matches its approved installation and passes compilation. It does not mean that the team can execute.

`runtimeReady` and `executionAuthorized` remain false. Review remains required. The current generic scaffold has no provisioned execution installation or registered acceptance environment.

Portable definitions still compile after a move. Installation inspection reports the changed location because the machine-specific receipt binds the original installation.

## Historical compatibility

New plans use `bowerloom/startup-template/v1alpha2`. The public plan and receipt envelopes remain `v1alpha1`. Inspection dispatches by the exact template version and reconstructs old receipts with the preserved `scaffold-v1alpha1.ts` implementation. It does not inject a default profile into a historical normalized brief, add new review files, rewrite an old receipt, or relax drift checks. Unknown template versions are rejected.

An uninstalled historical approval does not authorize the new template. Request a fresh plan and approval. The frozen historical fixture contains its original normalized brief, complete file bytes, and compiler result.

## Tests

From the repository root, run the build and package tests:

```sh
npm run build
node --test packages/startup/test/startup.test.mjs
```

The tests exercise frozen historical receipt compatibility, all three profiles, profile-bound approval, readable review output, maximum-size escaped review contents, new workspaces, existing-project preservation, the actual compiler, portable validation, stale approval, directory replacement, case collisions, locks, rollback, and drift.

The preservation test intercepts reads of existing project files and refuses them. The tests make no network or model calls.
