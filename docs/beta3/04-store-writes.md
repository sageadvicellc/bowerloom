# 04. Store writes

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 5. Decisions 1, 4 (`ls` tags), 7, 8, 9, 11, 13, and 14. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decisions 12 to 15: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332752507. Defaults: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332968796.
- Lane: 2.
- Branch: `beta3/04-store-writes`.
- Depends on: spec 03 (store rules, `StoreContext`, `inspectStore`, `openStore`, `verifyStorePins`, `pathInsideStore`).
- Line numbers below are from commit c9730d3. If a line moved, find the place by its function name.

## 2. Problem

The store at `~/.bowerloom` has no way to receive anything. A person cannot put a skill, a prompt, a team, or a pinned skill into it. `ls` cannot show it. The create commands and `skills add` only write inside a project.

This spec adds the flag `--global`. With it, `skill create`, `prompt create`, `team create`, `skills add`, `skills check`, and `ls` work on the store. It also changes the format of `ls` so that each item names its source, `store` or `project`. It adds the store limits, and it lets `skills add --global` fill the machine cache without a project.

This spec does not select store items for a project. Spec 06 does that.

## 3. Behavior

### 3.1 Commands and flags

All usage lines below are verbatim.

```text
bowerloom team create <name> [--profile engineer|founder|research] [--global] [--approve <revision>] [--json]
bowerloom skill create <name> [--team <team>]... [--global] [--approve <revision>] [--json]
bowerloom prompt create <name> [--team <team>]... [--global] [--approve <revision>] [--json]
bowerloom skills add npm:<package>@<version>:<path> [--id <id>] [--team <team>]... [--replace] [--global] [--approve <revision>] [--json]
bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path> [--id <id>] [--team <team>]... [--replace] [--global] [--approve <revision>] [--json]
bowerloom skills check [--global] [--json]
bowerloom ls [teams|skills|prompts] [--global] [--json]
```

Rules for `--global`:

1. It is a switch with no value. Giving it twice refuses `USAGE` with `Use --global once.` Add `'--global'` to the `NO_VALUE` set in `apps/cli/src/confirm.ts:31`.
2. With `--global`, the command does not look for a project. It works from any folder. It uses the store at `~/.bowerloom`.
3. With `--global`, `--team <team>` on `skill create`, `prompt create`, and `skills add` names a team in the store. A team in the store is a folder `teams/<id>` that the store's authoring record lists.
4. `team create <name> --global` takes `--profile` and nothing else. It never reads a project brief. It uses the fixed store brief in 3.5. `--team` on `team create` is already a usage error.
5. The usage error texts are exact. For `team create`: `Use bowerloom team create <name> [--profile engineer|founder|research], with optional --global, --approve <revision> and --json.` For `skill create`: `Use bowerloom skill create <name> [--team <team>]..., with optional --global, --approve <revision> and --json.` For `prompt create`: `Use bowerloom prompt create <name> [--team <team>]..., with optional --global, --approve <revision> and --json.` For `skills add` (`ADD_USAGE`, `apps/cli/src/manifest.ts:40`): `Use bowerloom skills add npm:<package>@<version>:<path> or github:<owner>/<repo>@<40-character-commit>:<path>, with optional --id <id>, --team <team>, --replace, --global, --approve <revision> and --json.` For `skills check`: `Use bowerloom skills check [--global] [--json].` For `ls`: `Use bowerloom ls [teams|skills|prompts] [--global] [--json].`
6. `ls --global` and `skills check --global` work on a store that exists. A foreign store refuses `STORE_INVALID`. A refused store refuses its `STORE_*` code. The exit code is 1. In the `ls --global` JSON, `storeState` stays `ready` or `absent`.

### 3.2 Help text

The final printed text of each topic follows. Lines marked with `+` are new in this spec. Lines marked with `~` changed. Lines with no mark stay as they are.

`TOPICS.team`:

```text
Usage:
~  bowerloom team create <name> [--profile engineer|founder|research] [--global] [--approve <revision>] [--json]

Creates a team in .bowerloom/teams/<name>, from the project brief, with a lead, a maker and a reviewer.
The name is the team id: lower-case words joined by hyphens, such as research-desk. first-team is taken by setup.
The profile defaults to the one in the project brief.
+--global creates the team in your store, ~/.bowerloom, and not in this project. The store holds definitions only.
+A project picks store items with bowerloom use. The first --global write makes the store.
+With --global a team is built from a fixed store brief and the profile you choose. It does not read a project brief.
It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the files it makes.
~It writes inside .bowerloom only, or inside your store with --global. It starts no workers and runs nothing.
```

`TOPICS.skill`:

```text
Usage:
~  bowerloom skill create <name> [--team <team>]... [--global] [--approve <revision>] [--json]

Creates a skill of your own in .bowerloom/skills/<name>/SKILL.md, and lists it in .bowerloom/skills.json as a local skill.
The name is the skill id, such as house-style. personal-assistant and ids that start with prompt- are reserved.
--team limits the skill to a team that exists; without it, every team gets it.
+--global creates the skill in your store, ~/.bowerloom, and not in this project. The store holds definitions only.
+A project picks store items with bowerloom use. The first --global write makes the store.
It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the file it makes.
~It writes inside .bowerloom only, or inside your store with --global. It starts no workers and runs nothing.
To pin a skill from npm or GitHub instead, see bowerloom help skills.
```

`TOPICS.prompt`:

```text
Usage:
~  bowerloom prompt create <name> [--team <team>]... [--global] [--approve <revision>] [--json]

Creates a reusable prompt in .bowerloom/prompts/<name>.md.
When the file of a prompt you created is gone, the same command puts it back with the text it was created with.
The name is the prompt id, such as weekly-update, at most 57 characters.
--team limits the prompt to a team that exists; without it, every team gets it.
+--global creates the prompt in your store, ~/.bowerloom, and not in this project. The store holds definitions only.
+A project picks store items with bowerloom use. The first --global write makes the store.
It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the file it makes.
~It writes inside .bowerloom only, or inside your store with --global. It starts no workers and runs nothing.
```

`TOPICS.skills` (the lines of the `skills sync`, `recover`, and `migrate` blocks stay as in the source, `human.ts:61-91`):

```text
Usage:
~  bowerloom skills add npm:<package>@<version>:<path> [--id <id>] [--team <team>]... [--replace] [--global] [--approve <revision>] [--json]
~  bowerloom skills add github:<owner>/<repo>@<40-char-commit>:<path> [--id <id>] [--team <team>]... [--replace] [--global] [--approve <revision>] [--json]
~  bowerloom skills check [--global] [--json]

skills add pins one skill in .bowerloom/skills.json, the file you commit so every machine gets the same skills.
The pin must be exact: an npm version such as 1.2.3, or a full 40-character lower-case Git commit.
Ranges, tags, branches and short commits are refused before anything is fetched.
<path> is the skill folder inside the package or repository, for example:
  bowerloom skills add npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections
It reads only registry.npmjs.org or api.github.com, without credentials, and takes MIT or Apache-2.0 skills only.
It shows the plan first. Agents pass --approve <revision> or --json. It records the pin only: nothing is installed or run.
--id sets the entry id; the default is the skill name. --team limits the skill to a team; without it, every team gets it.
--replace moves an existing id to another version or commit of the same package or repository. The plan shows the
old pin and the new pin, and the entry keeps its teams unless you pass --team. Then skills sync updates the copies:
  bowerloom skills add npm:@tanstack/db-skills@0.0.2:skills/tanstack-db/collections --id <id> --replace
+--global pins the skill in ~/.bowerloom/skills.json, your store, and keeps the checked bytes in the machine cache.
+The store holds up to 256 skills. A project holds up to 128.

skills check reads .bowerloom/skills.json and checks every pin, offline. It writes nothing.
+skills check --global checks the pins in the store.
```

`TOPICS.ls`:

```text
Usage:
~  bowerloom ls [teams|skills|prompts] [--global] [--json]

~Lists the teams, skills, and prompts of this project. Each item shows where it comes from: project or store.
~--global lists your store, ~/.bowerloom, from any folder.
It reads only and writes nothing.
The project is the nearest parent folder that holds .bowerloom or bowerloom.json, found the way git finds .git.
It stops at your home folder and refuses cloud-synced folders.
Add --json for one machine-readable object.
```

### 3.3 First write makes the store

If the store is absent, or is a leftover folder (spec 03, rule 6), the first `--global` write creates it. An empty folder is a leftover. Discovery treats it as no store (spec 03, 3.4). The plan says so with this line, placed first among the plan lines:

```text
Create the store at ~/.bowerloom (store.json). It holds definitions only.
```

If `~/.bowerloom` exists and is `foreign`, the command refuses `STORE_INVALID` at plan time. Bowerloom never takes over a folder it did not make. If any safety rule of spec 03 refuses, the command refuses with that `STORE_*` code at plan time. `inspectStore` also applies the cloud-folder rule to an absent store (spec 03, rule 2). So an iCloud home refuses `STORE_IN_CLOUD_FOLDER` at plan time, before any write.

No read-only `--global` command (`ls --global`, `skills check --global`) creates anything. Without a store, they print the messages in 3.9 and 3.7.

The function `withStoreForWrite<T>(home, signal, work: (store: StoreContext, held: HeldProjectLock, created: boolean) => Promise<T>): Promise<T>` lives in `packages/project-context/src/store.ts`. The value `created` is true after step 3 writes `store.json` in this run. Every store write runs inside it. Its steps:

1. If the store folder does not exist, create it with mode 0700. If the create fails with `EEXIST`, continue. This is the only write that happens before the plan revision is checked. An empty folder is harmless, because it is a leftover.
2. Take the store lock: `withProjectLock(storeDir, signal, ...)` from `packages/project-context/src/index.ts:168`. The lock slot follows the inode of the store folder (`lockSlot`, line 59). The lock never waits (`index.ts:176-184`). A `PROJECT_LOCKED` refusal here becomes `STORE_LOCKED`. The function maps `PROJECT_LOCKED` to `STORE_LOCKED` in every place. That includes a throw from `held.assertHeld` inside `work`. `PROJECT_LOCK_SLOT_COLLISION` and `PROJECT_LOCK_UNAVAILABLE` pass through.
3. Under the lock, inspect the store again.
   - A valid store: remove each name that matches `^\.store\.json\.[a-f0-9]{16}\.tmp$`, `fsync` the folder after a removal, and continue with `created` false.
   - A `foreign` folder: refuse `STORE_INVALID`.
   - An `absent` state or a leftover: write `store.json`. First remove each name that matches `^\.store\.json\.[a-f0-9]{16}\.tmp$`. Then write `.store.json.<16 hex>.tmp` with `O_CREAT | O_EXCL | O_NOFOLLOW`, call `fchmod` to 0644, write the bytes, `fsync`, and close. Then `rename` it to `store.json` and `fsync` the folder. A rename never leaves a second link. Set `created` to true.
4. Pin the store with `openStore(home)` and keep that context for the rest of the run. Call `verifyStorePins(store)` before each later write.
5. Run `work(store, held, created)` before the lock is released. The item write (3.4 or 3.6) is the work.

After `withStoreForWrite` returns, `skills add --global` seeds the cache (3.6). The seed runs outside the store lock.

Crash recovery. A crash after step 1 leaves an empty folder. A crash during step 3 leaves a folder with a leftover temporary file. Both states are valid starting points. The next `--global` command plans `Create the store ...` again, or finds a valid store. Nothing needs manual repair.

### 3.4 `skill create`, `prompt create`, `team create` with `--global`

The command parses its words, then plans, then asks for approval, then applies. The sequence in apply is the same as for a project (see `applyCreate`, `packages/project-authoring/src/create.ts:274-372`). The steps are: remove scratch, clear or finish a pending record, and make folders. Then write the pending record, stage the files, and move them in place. Last, write `skills.json` for a skill, write the receipt, and remove the pending record. The folder that holds all of this is the store folder itself. In the store, `skills/`, `prompts/`, `teams/`, `authoring/`, and `skills.json` sit directly in the store folder. They do not sit in a `.bowerloom` folder.

`applyCreate` never creates the store. For the store scope it takes a fourth parameter, `store: { context: StoreContext; created: boolean }`. Its `live()` check calls `held.assertHeld(dir)` and then `verifyStorePins(store.context)`, in place of `sameBowerloom`. Its `writeManifest` calls `planManifestChange(storeTarget(dir), ..., { storeCreate: false })`. `createStoreChange.plan` calls `verifyStorePins` before and after its reads, as `createChange` (`apps/cli/src/create.ts:98`) does for a project. The CLI function `createStoreChange(home, input)` runs `withStoreForWrite(home, signal, (context, held, created) => applyCreate(input, revision, held, { context, created }))`.

Differences from a project create:

1. No check for `.bowerloom-revision.json`.
2. The plan field `bowerloom` is `null`. Spec 03's `verifyStorePins` replaces the `sameBowerloom` check.
3. `--team` is checked against the store: the name must be a team that the store's receipt lists and whose folder `teams/<name>` is a real folder. The name `first-team` is not special in the store. It is not a store team, so it refuses `TEAM_NOT_FOUND`.
4. A team is built with `scaffoldTeam(storeBrief(input.profile), name, name)`. See 3.5. The check `TEAM_NAME_TAKEN` is skipped for the store.
5. The skill limit is 256 in `skills.json`. At the limit, refuse `MANIFEST_LIMIT`.
6. Names follow the same rules as a project: `checkName` at `create.ts:101-107`.
7. A new skill gets `SKILL_TEXT(id)` as written (`create.ts:137`).

Plan lines, verbatim. `<id>` is the name given, `<n>` a count, `<p>` the profile.

```text
Create the store at ~/.bowerloom (store.json). It holds definitions only.        (only when the store is absent)
Create team <id> in the store at ~/.bowerloom/teams/<id>
  Profile: <p>
  Built from a fixed store brief, with the lead, maker and reviewer templates.
  Files: <n>
Create skill <id> in the store at ~/.bowerloom/skills/<id>
  Teams: <team list, or every team>
  Files: <n>
  skills.json: adds a local entry for <id>
Create prompt <id> in the store at ~/.bowerloom/prompts/<id>.md
  Teams: <team list, or every team>
  Files: <n>
You and your agents own these files and can edit them.
This writes the store only. It changes no project, and it installs nothing.
```

Keep the wording of `renderCreateReview` (`apps/cli/src/create.ts:56-82`) for the lines about restore, finish, discard, and scratch. Use the store paths. The last two lines of a project create (`You and your agents ...` and `This writes inside .bowerloom only ...`) become the two lines above.

A store pending record works as in a project. The next `--global` create of any name first plans `Finish ...` or `Clear the record ...`, and then its own item. A record whose item landed with other bytes refuses `AUTHORING_PENDING` (`create.ts:187-197`).

The result of a store create is the same `AuthoringReceipt` JSON as a project create.

### 3.5 The fixed store brief

New file `packages/project-config/src/brief.ts`. It exports:

```ts
export const STORE_BRIEF = Object.freeze({
  projectName: 'Store team',
  goal: 'A team kept in the Bowerloom store. A project that selects it sets its own goal.',
  assistantName: 'Personal assistant',
  teamName: 'Store team',
  reviewMode: 'milestones' as const,
});
export function storeBrief(profile: StartupProfile | undefined): NormalizedBrief   // { ...STORE_BRIEF, profile: profile ?? 'engineer' }
```

Use `storeBrief(input.profile)` everywhere. The plan never holds `"profile": null` for the store.

Do not pass the brief through `startupInternals.normalize`. That function refuses a target path that holds `.bowerloom` (`packages/startup/src/index.ts:101-107`). A test proves that `normalize` accepts the same fields with a safe target and returns them unchanged (`index.ts:98`).

`scaffoldTeam` (`packages/startup/src/scaffold.ts:37`) reads only the brief fields, the team id, and the display name. It reads no path. The team name in the files is the display name, which is the team id given on the command line. The files carry the line `Brief <digest>` in the team description. The digest depends on the profile and the team id. So two stores that build the same team id from the same profile hold equal files.

Spec 06 reuses `STORE_BRIEF` for a project that has a config and no `brief.json`.

### 3.6 `skills add --global`

The sequence is the one in `runAdd` (`apps/cli/src/manifest.ts:137-180`), with these changes:

1. Line 140 (`discoverProject`) becomes: call `inspectStore(home)`. A `foreign` or refused store refuses with its `STORE_*` code. An `absent` store makes the plan carry `storeCreate: true`.
2. Line 141 (`requireTeams`) checks the store teams, as in 3.4 rule 3.
3. Line 142 (`readManifestState`) reads the store `skills.json` with the store limits (256 skills, 4 MiB). An absent store returns no file.
4. Line 146 (`verifyProjectPins`) becomes `verifyStorePins(store)` for an existing store.
5. Line 148 keeps the cache at `join(privateStateRoot(env, home), 'cache')`. The cache is never inside the store.
6. The plan is `planManifestChange(storeTarget(dir), add, { cacheRoot, storeCreate })`. The CLI plan passes `storeCreate` as `inspectStore(home).state === 'absent'`.
7. Apply: run `withStoreForWrite`. Inside it, plan again with `planManifestChange(storeTarget(dir), add, { cacheRoot, storeCreate: created })`. The revision must equal the approved one. Then call `applyManifestChange(plan, revision, held)`. It reuses `plan.storeCreate` for its own re-plan, so the revisions agree.
8. After `withStoreForWrite` returns, seed the cache (line 175) with `seedPin({ project: null, stateRoot }, written, bytes, signal)`.
9. If the state root is inside the store, or the store is inside the state root, refuse `STORE_STATE_NESTED`. The check is `storeStateNested(store, storeDir, stateRoot, statePins)` (3.8). Run it in the CLI plan, and again under the store lock.

Plan lines. The existing review (`renderAddReview`, `manifest.ts:100-116`) prints `Add skill <id> to <plan.manifest>`. For the store scope, `plan.manifest` is the text `~/.bowerloom/skills.json`. If `storeCreate` is true, add one line before `Add skill`: `Create the store at ~/.bowerloom (store.json). It holds definitions only.` Add this line after the `Cache:` line:

```text
  Scope: store. A project picks this skill with bowerloom use.
```

The cache line stays: `Cache: <root> keeps the bytes checked here, so skills sync need not fetch them again.`

### 3.7 `skills check --global`

It reads the store `skills.json` with the store limits and prints the same report as `skills check`. The first line reads `skills.json (store) is valid: <n> skills, for Claude Code and Codex.` instead of `skills.json is valid: ...`. The JSON format is `bowerloom/skills-manifest-check/v1beta2`. It adds the field `scope` (`project` or `store`) and the field `source` on each skill (equal to `scope` in this spec). Every other field of v1beta1 stays. With no store, or a store with no `skills.json`, it refuses `MANIFEST_NOT_FOUND`.

### 3.8 Machine cache without a project

`seedPin` (`packages/project-sync/src/seed.ts:49-66`) calls `stateLayout(input)`, which needs a project (`plan.ts:157-176`). Add `cacheLayout(stateRoot)` to `plan.ts`. It runs `managedPath` on `stateRoot` and `cacheRoot`. It walks `[...chain, cacheRoot]` with the rules of `plan.ts:164-170`, where only `cacheRoot` is private. It returns `{ root: null, cacheRoot, pins, missing }`. `stateLayout` stays as it is. For a null `root`, `sharedFolders` (`seed.ts:37`) skips nothing.

`seedPin` takes `input: { project: ProjectContext | null; stateRoot: string }`. With a project it behaves as today. With `null` it calls `cacheLayout` and skips `projectFolders` and the nesting check.

New export in `packages/project-sync/src/plan.ts`:

```ts
export function storeStateNested(store: StoreContext | null, storeDir: string, stateRoot: string, statePins: readonly { path: string; identity: Identity }[]): boolean
```

It copies the algorithm of `nested` (`plan.ts:128-136`). It uses the store's identity and ancestry in place of the project's. With `store` null it compares paths only. `statePins` come from `cacheLayout`.

### 3.9 `ls` and `ls --global`

`ls` moves to format `bowerloom/ls/v1beta2`. In this spec both forms list folders. Spec 06 makes a project with a config list the config.

`ls` (no flag) lists the project as today, and tags every item `project`. `ls --global` lists the store and tags every item `store`. `ls --global` works from any folder and needs no project. A project listing never mixes in store items. `ls --global` calls `verifyStorePins` before and after its reads, as `listProject` (`ls.ts:59,62`) does for a project.

Skills are the union of the `skills/<id>` folders and the `skills.json` entries. One item appears for each id. The kind comes from the `skills.json` entry. A skill with no entry has the kind `local`. The `pin` is set for `npm` and `git` entries only.

Text output, with these exact shapes. Pad each id (a team label includes its display name) to the widest label of the section, then add two spaces.

```text
Teams
  first-team (First team)  project
  research                 project

Skills
  house-style         project
  personal-assistant  project
  tanstack-db         project  pinned: npm @tanstack/db-skills@0.0.1:skills/tanstack-db/collections

Prompts
  none yet
```

For `ls --global` the same shapes appear with the source `store`.

- A team label is `<id>` or `<id> (<display name>)`.
- A pinned skill adds two spaces and `pinned: <pin text>`. The pin text is `npm` or `GitHub` followed by `pinOf(entry)` (`packages/skill-manifest/src/check.ts:15`), such as `npm @tanstack/db-skills@0.0.1:skills/tanstack-db/collections`. Today's `ls.ts:36-37` omits `:<path>`. This spec adds it. The JSON `pin` is `pinOf(entry)` without the `npm` or `GitHub` word.
- An empty section shows `  none yet`.
- After the sections, the `Not listed:` note keeps its wording (`ls.ts:77`). The unreadable-pins note (`ls.ts:78`) stays for a project. For the store it reads `Pinned skills are not listed: the store skills.json cannot be read. Run bowerloom store status.`
- With no store, `ls --global` prints `No store yet. Create one with bowerloom skill create <name> --global.` and exits 0. It prints no sections.

JSON, field by field:

| Field | Type | Meaning |
|---|---|---|
| `format` | string | `bowerloom/ls/v1beta2` |
| `scope` | string | `project` or `store` |
| `listedBy` | string | `folders` in this spec |
| `teams` | array | Present unless a section was named. Each item: `{ "id": string, "source": "project"\|"store", "via": [], "locked": null, "resolvedFrom": "project"\|"store", "displayName": string\|null, "state": "ok" }`. |
| `skills` | array | Each item: `{ "id": string, "source": "project"\|"store", "via": [], "locked": null, "resolvedFrom": "project"\|"store", "kind": "local"\|"npm"\|"git", "pin": string\|null, "state": "ok" }`. `pin` is null for `local`. |
| `prompts` | array | Each item: `{ "id": string, "source": "project"\|"store", "via": [], "locked": null, "resolvedFrom": "project"\|"store", "state": "ok" }`. |
| `pinsReadable` | boolean | Present for skills. False means `skills.json` cannot be read. |
| `unselected` | object | `{ "skills": [], "prompts": [], "teams": [] }`. Always empty lists in this spec. |
| `unlisted` | number | The count of entries with an unusual name or type, as today. |
| `storeState` | string | Present only for `scope: store`. Its value is `ready` or `absent`. |

In this spec `resolvedFrom` equals `source`, and `locked` is always null. Spec 06 adds values, not fields.

Item order: sorted by `id` in byte order. When one section is named (`ls skills`), only that array appears. The other fields stay: `format`, `scope`, `listedBy`, `unselected`, `unlisted`, and for skills `pinsReadable`. The names `via` and `state` are fixed here so spec 06 adds values, not fields.

`displayName` is the team name from `.bowerloom/brief.json` for `first-team` only. It is null for every other team and for every store team.

### 3.10 Exit codes

All commands in this spec use the existing exit codes. 0 means done or nothing to do. 1 means a refusal. 2 means `USAGE`. 3 means a plan waits for approval. 130 means an interrupt.

### 3.11 What counts as a definition in the store

- `authoring/receipt.json` is a definition. Spec 06 reads the team tags of each item from it.
- `authoring/pending.json` and the `.stage-*` folders are not definitions. They exist only during a create.
- Spec 06 tells a person to run `git add -A` in the store. That command can commit a pending record. Spec 06's `store status` warns about a pending record.

## 4. Schemas

### 4.1 The store folder

```text
~/.bowerloom/                 mode 0700
  store.json                  {"format":"bowerloom/store/v1beta1"} plus a newline, mode 0644
  skills.json                 format bowerloom/skills/v1beta1, harnesses ["claude","codex"]
  skills/<id>/...             authored skills, files mode 0600, folders mode 0700
  prompts/<id>.md             authored prompts
  teams/<id>/...              authored teams
  authoring/receipt.json      bowerloom/authoring-receipt/v1beta1, as in a project
  authoring/pending.json      bowerloom/authoring-pending/v1beta1, only during a create
```

A store `skills.json` created by `skill create --global` has `harnesses: ["claude","codex"]`.

### 4.2 Manifest limits

In `packages/skill-manifest/src/schema.ts:19`, keep the flat object `MANIFEST_LIMITS` as it is: `{ bytes: 1048576, skills: 128, teams: 32, idLength: 64 }`. `packages/skill-manifest/test/schema.test.mjs:125` reads those keys. Add:

```ts
export interface ManifestLimits { bytes: number; skills: number; teams: number; idLength: number }
export const STORE_MANIFEST_LIMITS: ManifestLimits = Object.freeze({ bytes: 4194304, skills: 256, teams: 32, idLength: 64 });
```

Add a final parameter `limits: ManifestLimits = MANIFEST_LIMITS` to four functions:

- `parseManifest(bytes, limits)` (`schema.ts:158`). Replace the uses at lines 160 and 164 with `limits`.
- `validateManifest(value, limits)` (`schema.ts:144`). Replace the use at line 150.
- `serializeManifest(m, limits)` (`schema.ts:~172`). It passes `limits` to its own `parseManifest` call at line 187.
- `addLocalEntry(m, id, teams, limits)` (`add.ts:46`). It uses `limits` at lines 49, 51, and 53.

Every read or write of a store `skills.json` passes `STORE_MANIFEST_LIMITS`. The places are `add.ts:129,142,143`, `create.ts:161` and `manifestStep` (line 165), `manifest.ts:143,158`, `check.ts:25`, and `ls.ts:36`. A test uses 200 store skills.

Export `STORE_MANIFEST_LIMITS`, `ManifestLimits`, `ManifestTarget`, `projectTarget`, and `storeTarget` from `packages/skill-manifest/src/index.ts:11`.

### 4.3 Manifest target and `storeCreate`

In `packages/skill-manifest/src/add.ts` add:

```ts
export interface ManifestTarget { folder: string; lockDir: string; scope: 'project' | 'store'; limits: ManifestLimits }
export const projectTarget = (projectDir: string): ManifestTarget => ({ folder: join(projectDir, '.bowerloom'), lockDir: projectDir, scope: 'project', limits: MANIFEST_LIMITS });
export const storeTarget = (storeDir: string): ManifestTarget => ({ folder: storeDir, lockDir: storeDir, scope: 'store', limits: STORE_MANIFEST_LIMITS });
```

`readManifestState`, `planManifestChange`, and `applyManifestChange` accept a `string` (a project folder, as today) or a `ManifestTarget`. A string means `projectTarget(string)`. This keeps every existing caller unchanged.

`readManifestState(target, options?)` (line 76): use `target.folder` in place of `join(project, '.bowerloom')` at line 78. Use `target.limits.bytes` in place of `MANIFEST_LIMITS.bytes` at lines 86, 91, and 92. Add the option `allowAbsent`. For a missing folder it returns `{ bowerloom: null, file: null }`. Without the option a missing folder still refuses `MANIFEST_UNSAFE`. The return type `bowerloom` becomes `{ device: string; inode: string } | null`.

`planManifestChange(target, change, options)` (line 122): use `target.limits.skills` at lines 51 and 139. The options gain `storeCreate?: boolean` (default false). The plan never derives `storeCreate` from the disk. The plan format becomes `bowerloom/skills-manifest-change/v1beta2`. Add the fields `scope` and `storeCreate`, and make `bowerloom` `{ device, inode } | null`. For `scope: store` the value is null. Widen the type of `ManifestChangePlan.manifest` to `string`: it is `.bowerloom/skills.json` for a project and `~/.bowerloom/skills.json` for the store. The field `project` is the lock folder (`target.lockDir`). The store's identity is bound by `verifyStorePins`, not by this field. The function calls `readManifestState(target, { allowAbsent: target.scope === 'store' })`. For the store, a missing folder plans as a missing file (`before: null`).

`applyManifestChange(plan, revision, held)` (line 170): build the target from `plan.scope` and `plan.project`. Pass the target to the re-plan at line 178 with `{ cacheRoot, storeCreate: plan.storeCreate }`, and to `readManifestState` at lines 187 and 197. Use `target.folder` for `folder` at line 180. If `plan.bowerloom` is null, skip the identity comparison at line 188. The receipt's `manifest` (line 200) is `plan.manifest`. Widen `ManifestChangeReceipt.manifest` to `string`.

`checkManifest(project)` in `check.ts` takes a string or a target. It adds `scope` to the result and `source` to each skill. Its format becomes `bowerloom/skills-manifest-check/v1beta2`. Widen the type of `ManifestCheck.manifest` to `string`. `MANIFEST_PATH` (`add.ts:18`) stays for the project.

### 4.4 Authoring scope

In `packages/project-authoring/src/create.ts`:

- `CreateInput` (lines 34-36) gains the optional key `scope: 'project' | 'store'`. The default is `project`. For `store`, the `project` key holds the store folder path.
- `normalizeInput` (lines 83-99) lists the allowed keys for each kind. Add `scope` to both lists. Refuse `USAGE` for a `scope` other than the two values.
- Replace `Project` and `openProject` (lines 108-114) with `Scope` and `openScope(input)`:

```ts
interface Scope { kind: 'project' | 'store'; dir: string; bowerloom: string; identity: { device: string; inode: string } | null; exists: boolean }
```

For a project, `openScope` does what `openProject` does. For a store, `bowerloom` equals `dir` and `identity` is always null. For an absent store, `openScope` takes the `realpath` of `dirname(dir)`. `exists` is false for an absent or leftover store folder.
- `plan(normalized, created)` (lines 181-266). For a store scope that does not exist, use an empty state in place of `readAuthoringState`: `{ folder: false, receipt: null, pending: null, scratch: [] }` (the shape is `AuthoringState`, `state.ts:~112`). Skip the revision-pending check for a store. Use `readManifestState(storeTarget(dir), { allowAbsent: true })` for the store manifest (`currentManifest`, line 159). Set `storeCreate = scope.kind === 'store' && (!scope.exists || created)`. Push the folder names `authoring` and the parent folder as `folders`.
- `applyCreate(input, revision, held, store?)` (line 274): the new fourth parameter is `{ context: StoreContext; created: boolean }`. It passes `store.created` to `plan`.
- `CreatePlan` (lines 40-77) gains `scope` and `storeCreate`. `bowerloom` becomes nullable. The plan format becomes `bowerloom/authoring-plan/v1beta2`.
- `requireTeams` (lines 171-179) works from `scope.bowerloom` and the registered items. Add a parameter `allowFirstTeam` that is true for a project and false for the store.
- `readBrief` (line 122) is not called for a store. Use `storeBrief(input.profile)` at line 247.
- The `compileCrew` call (line 353) reads only under `dirname(file)` and needs no project (`packages/crew/src/index.ts:94-116`).
- The `live` check is at line 283.

### 4.5 `CreatePlan` and review text

The plan JSON keeps its shape. The review function prints the lines in 3.4 using `plan.scope`. The `where()` helper (`apps/cli/src/create.ts:58`) returns `.bowerloom/teams/<id>` for a project and `~/.bowerloom/teams/<id>` for the store, with the same for skills and prompts.

## 5. Refusal codes

| Code | Message | Sentence | Next step |
|---|---|---|---|
| `STORE_STATE_NESTED` | The private state folder and the store must not be inside one another. | Bowerloom keeps the cache outside the store, so a store inside the state folder, or the reverse, is refused. | Set `XDG_STATE_HOME` to a folder outside `~/.bowerloom`. |
| `STORE_LOCKED` | Another Bowerloom command is changing the store. | Two commands must not change the store at the same time, so nothing was changed. | When the other command is done, run this one again. |
| `MANIFEST_LIMIT` | (unchanged) | This beta keeps a project skills.json small: 128 skills and 1 MiB at most. The store holds 256 skills and 4 MiB. | `bowerloom skills check` |

The existing entries for `TEAM_NOT_FOUND` and `MANIFEST_NOT_FOUND` stay (`human.ts:255,236`). Spec 03 owns `STORE_INVALID`. Only the `MANIFEST_LIMIT` sentence changes. Its current text is `This beta keeps skills.json small: 128 skills and 1 MiB at most.` Use the sentence of the table as the cause.

Add `STORE_STATE_NESTED` and `STORE_LOCKED` to `packages/project-context/src/refusal.ts:7-17` and to `REFUSALS` in `apps/cli/src/human.ts:224`.

## 6. Where to change

Create:

- `packages/project-config/src/brief.ts` (3.5).
- Test files in section 10.

Change:

- `packages/project-context/src/store.ts` (from spec 03): add `withStoreForWrite` (3.3). It is the only function that creates the store.
- `packages/project-context/src/refusal.ts:7-17`: the two new codes.
- `packages/skill-manifest/src/schema.ts:19,144,158,172,187`: limits (4.2).
- `packages/skill-manifest/src/add.ts:17-18,21-40,46-53,76-102,122-160,170-201`: target, plan fields (4.3).
- `packages/skill-manifest/src/check.ts:25`: target, scope field, format.
- `packages/skill-manifest/src/index.ts:11`: the new exports.
- `packages/project-authoring/src/create.ts:34-36,40-77,83-99,108-120,159-179,181-266,274-372`: scope (4.4).
- `packages/project-authoring/src/verifiers.ts:92`: the call to `readManifestState` stays a project call. No change.
- `packages/project-authoring/src/index.ts:5-6`: export the changed types.
- `packages/project-sync/src/plan.ts:157`: add `cacheLayout` and `storeStateNested`.
- `packages/project-sync/src/seed.ts:37,49-66`: accept a null project.
- `packages/project-sync/src/index.ts`: export `cacheLayout` for the tests.
- `apps/cli/src/create.ts:21-25,30-53,56-82,85-92,95-105`: the flag, the usage text, the review, the store branch in `runCreateCommand`, and `createStoreChange` (3.4).
- `apps/cli/src/manifest.ts:39-61,100-131,137-207`: the flag, `requireTeams` for the store, `runAdd`, `runCheck`.
- `apps/cli/src/ls.ts:16-90`: format, `--global`, source tags, per-item pins. Replace `Listing.pinned` with per-skill `pin` and `kind`. `runLsCommand` (line 83) accepts `--global`. Line 36 passes the store limits for the store.
- `apps/cli/src/confirm.ts:31`: add `'--global'` to `NO_VALUE`.
- `apps/cli/src/main.ts:145`: `runLsCommand` already receives all `args`. Lines 152-164 already pass `args` to the create and manifest runners. No new dispatch is needed.
- `apps/cli/src/human.ts:46-147`: the help topics of 3.2. Extend `TOPICS.store` (spec 03) with the line `--global on skill create, prompt create, team create, skills add, skills check and ls works on the store. See bowerloom help skill.` `human.ts:224`: the refusal words.
- Other callers that pass a string to `readManifestState` stay as they are: `plan.ts:374`, `apply-project.ts:131`, `up.ts:130`, `ls.ts:34`, `held.ts`, `verifiers.ts:92`. Do not change them in this spec.
- `package.json:30` and `package.json:53`: no change. `packages/skill-manifest/test`, `packages/project-authoring/test`, and `packages/project-sync/test` are already in the globs. Add the new CLI test `dist/tests/store-write-cli.test.js` to `test:project` (line 53).

## 7. Edge cases

| Case | Expected result |
|---|---|
| `skill create x --global` and the store is absent | The plan starts with the `Create the store` line. Apply makes the folder, `store.json`, `skills/x/SKILL.md`, `skills.json` with one local entry, and `authoring/receipt.json`. |
| The store does not exist at plan time | Apply succeeds without `STALE_APPROVAL`, because `created` reaches the re-plan (C1). |
| Another process creates the store between plan and apply | `created` is false and the store exists, so `storeCreate` is false. The revision differs. `STALE_APPROVAL`. |
| `skill create x --global` and the store has a skill `x` | `SKILL_EXISTS`. |
| `skill create x --global --team research` and the store has no team `research` | `TEAM_NOT_FOUND`. |
| `skill create x --global --team first-team` | `TEAM_NOT_FOUND`. |
| `team create first-team --global` | `TEAM_ID_RESERVED`. |
| `team create t --global --team a` | `USAGE`. |
| `team create t --global --profile founder` | The files hold the founder templates and the fixed brief. |
| The same `team create` in two stores | The files are identical, including the digest in `team.yaml`. |
| The 257th skill in the store | `MANIFEST_LIMIT`. |
| 200 skills in the store | Accepted. |
| The 129th skill in a project | `MANIFEST_LIMIT`. |
| `skills add --global` and the cache already holds the pin | The result says `Cache: <root> already held this pin.` |
| `skills add --global` and the seed fails | The pin stays in the store `skills.json`. The result reports the cache failure in words and JSON, as a project add does (`manifest.ts:131-135`). |
| `XDG_STATE_HOME` points inside `~/.bowerloom` | `STORE_STATE_NESTED` at plan time. |
| A second apply runs while the first holds the store lock | The second refuses `STORE_LOCKED` and writes nothing. After the first finished, the second plan is stale: `STALE_APPROVAL`. |
| A crash after the store folder is made and before `store.json` | The next command plans `Create the store ...` again and succeeds. |
| A crash after the temporary file is written | The next write removes the file, then writes the store. |
| A crash during a store create (pending record present) | The next `--global` create of any name first plans `Finish ...` or `Clear the record ...`, then its own item. |
| `ls --global` and the store has a link inside `skills/` | The link counts under `unlisted`. `ls` does not follow it. |
| `ls --global` outside any project | Works. Exit 0. |
| `ls` outside any project and no `--global` | `PROJECT_NOT_FOUND`, as today. |
| `ls --global --json` with no store | `storeState: "absent"` and empty arrays. |
| `ls --global` and a foreign store | `STORE_INVALID`, exit 1. |
| `--global` together with a project that has a different skill of the same id | No interaction. The project is not read. |
| The home folder is under iCloud | `STORE_IN_CLOUD_FOLDER` at plan time. |
| `skills add --global --replace` | Works on the store entry. The id must exist (`SKILLS_ADD_REPLACE_MISSING`). |
| `--global` given twice | `USAGE` with `Use --global once.` |

## 8. Migration from beta.2 projects

- No project file changes.
- `ls` and `ls --json` change shape. A script that reads `format: "bowerloom/ls/v1beta1"` must accept `bowerloom/ls/v1beta2`. In v1beta2 each item is an object. The old `pinned` list is gone. Each skill carries its own `pin` and `kind`. The text output gains a source column.
- `skills check --json` changes format to `bowerloom/skills-manifest-check/v1beta2`. The old fields keep their names and meanings. `scope` and `source` are new.
- The `skills add` plan JSON changes format to `bowerloom/skills-manifest-change/v1beta2` and the `create` plan JSON to `bowerloom/authoring-plan/v1beta2`. Both are internal to the approval flow. A revision from beta.2 does not approve a beta.3 plan. This is the normal behavior, because plans are not stored.
- Existing `.bowerloom/authoring/receipt.json` and `skills.json` files stay valid.

## 9. Docs changes for this track

- `apps/docs/src/content/docs/cli.md`, `## Create commands`: add `[--global]` to the three usage lines and one paragraph on the store. In `## Third-party skills`: add `--global` to `skills add` and `skills check`. In `## Project commands`: change the `ls` usage line and its paragraph to the text in 3.9. Describe the source column and the new JSON.
- `apps/docs/src/content/docs/configuration.md:77`: this line documents `ls/v1beta1` and `pinned`. Change it to the v1beta2 fields.
- `apps/docs/src/content/docs/guides/create-items.md`: add a section "Create an item in your store". Give one example for each of the three commands. Add the sentence "A project picks store items with `bowerloom use`." Spec 06 defines `use`. Both specs ship in beta.3.
- `apps/docs/src/content/docs/guides/add-skills.md`: add a short section "Pin a skill in your store" for `skills add --global` and the limits 128 and 256.
- `apps/docs/src/content/docs/reference/errors.md`: rows for `STORE_STATE_NESTED` and `STORE_LOCKED`, and an updated `MANIFEST_LIMIT` row.
- `apps/docs/src/content/docs/releases.md`, `## 0.7.0-beta.3`: "`--global` on `team create`, `skill create`, `prompt create`, `skills add`, `skills check`, and `ls` works on your store, `~/.bowerloom`. `ls` shows where each item comes from. `ls --json` has a new format, `bowerloom/ls/v1beta2`. The store holds up to 256 skills and a project up to 128."
- `apps/docs/tools/check-brand.mjs`: no change.

## 10. Acceptance tests

Every CLI test spawns the CLI with `HOME` set to a temporary folder and `XDG_STATE_HOME` set to another temporary folder. Every file imports `tests/support/isolate-home.js`. Tests in `.mjs` files import `../../../dist/tests/support/isolate-home.js`.

`packages/skill-manifest/test/limits-store.test.mjs`:

1. A manifest with 256 skills passes `parseManifest` with `STORE_MANIFEST_LIMITS`.
2. A manifest with 257 skills gives `MANIFEST_LIMIT` with the store limits.
3. A manifest with 200 skills passes `parseManifest`, `validateManifest`, `serializeManifest`, and `addLocalEntry` with the store limits.
4. A manifest with 129 skills gives `MANIFEST_LIMIT` with the default limits.
5. A 4 MiB file passes with the store limits. 4 MiB plus one byte gives `MANIFEST_LIMIT`.
6. A 1 MiB file passes with the default limits. 1 MiB plus one byte gives `MANIFEST_LIMIT`.
7. `readManifestState` with `storeTarget` reads `<store>/skills.json`. A link, a second hard link, a foreign owner, and group write each give `MANIFEST_UNSAFE`.
8. `readManifestState` with `allowAbsent` and a missing folder returns `{ bowerloom: null, file: null }`. Without the option it refuses `MANIFEST_UNSAFE`.
9. `planManifestChange` with the store target gives `scope: "store"`, `bowerloom: null`, and `manifest: "~/.bowerloom/skills.json"`. Its `storeCreate` is the option, never the disk. Creating the store folder between two plans does not change the revision.
10. `applyManifestChange` writes `<store>/skills.json` and keeps the plan's hash checks. Its re-plan reuses `plan.storeCreate`.
11. The existing `schema.test.mjs` and `add.test.mjs` cases pass with string callers. Two format assertions change, as the next paragraph lists.

Tests that change:

- `packages/project-authoring/test/create.test.mjs:42`: the plan format name becomes `bowerloom/authoring-plan/v1beta2`.
- `packages/skill-manifest/test/add.test.mjs:47`: the change plan format becomes `bowerloom/skills-manifest-change/v1beta2`.
- `packages/skill-manifest/test/add.test.mjs:133`: the check format becomes `bowerloom/skills-manifest-check/v1beta2`.
- `tests/ls-status-cli.test.ts:31`, `:37-38`, and `:106`: the `ls` text and JSON of 3.9.

`packages/project-authoring/test/create-store.test.mjs`:

1. Run `planCreate` with `scope: "store"` for a skill, a prompt, and a team against an absent store. The plan has `storeCreate: true` and `bowerloom: null`. Its folder list holds `authoring` and the parent folder.
2. The team plan does not read `brief.json` and uses `STORE_BRIEF`. Its `compiledCandidate` is equal across two runs.
3. `applyCreate` for each kind writes the expected files, the `skills.json` entry for a skill, and the receipt, in the store folder.
4. The store does not exist at plan time. `withStoreForWrite` creates it, and `applyCreate` succeeds without `STALE_APPROVAL`.
5. A store that another process creates between plan and apply gives `STALE_APPROVAL`.
6. `--team` against a store team passes. Against `first-team` it gives `TEAM_NOT_FOUND`.
7. A store with a pending record finishes or clears it exactly as a project does. A record whose item landed with other bytes gives `AUTHORING_PENDING`.
8. An existing id refuses `TEAM_EXISTS`, `SKILL_EXISTS`, or `PROMPT_EXISTS`.
9. The 257th skill refuses `MANIFEST_LIMIT`.
10. The plan for a store does not check `.bowerloom-revision.json` and skips `TEAM_NAME_TAKEN`.
11. `normalizeInput` accepts `scope` and refuses an unknown `scope` with `USAGE`.
12. Project plans keep their old behavior and produce plan format `bowerloom/authoring-plan/v1beta2`.
13. `live()` for the store calls `verifyStorePins`. A swapped store folder gives `STORE_UNSAFE`.

`packages/project-context/test/store-write.test.mjs` (the file also tests `withStoreForWrite`):

1. `withStoreForWrite` makes the folder and `store.json`, and calls `work` with `created: true`.
2. It removes a leftover temporary file first. The final `store.json` has one link.
3. It refuses a foreign folder with `STORE_INVALID`.
4. It holds the lock while `work` runs (a second `withProjectLock(storeDir)` gets `PROJECT_LOCKED`).
5. A held lock gives `STORE_LOCKED`. `PROJECT_LOCK_SLOT_COLLISION` and `PROJECT_LOCK_UNAVAILABLE` pass through unchanged.
6. A `PROJECT_LOCKED` thrown from `held.assertHeld` inside `work` becomes `STORE_LOCKED`.
7. A valid store gives `created: false`.
8. With the cloud fixture of spec 03 store test 9, `withStoreForWrite` refuses `STORE_IN_CLOUD_FOLDER` at step 3. Step 1 left at most one empty folder.
9. A valid store with a leftover temporary file: the file is gone after the call, and `created` is false.

`packages/project-config/test/brief.test.mjs`:

1. `storeBrief(undefined)` has profile `engineer`. `storeBrief('founder')` has profile `founder`.
2. `startupInternals.normalize` with the same fields and a safe target returns equal fields.
3. `scaffoldTeam(storeBrief('research'), 'x', 'x')` returns files whose paths all start with `teams/x/` and whose `compiled.candidateRevision` equals the value from a second call.
4. The digest changes with the profile and with the team id.

`packages/project-sync/test/seed-store.test.mjs`:

1. `seedPin` with `project: null` seeds an empty cache and returns `seeded`.
2. A second call returns `present`.
3. `cacheLayout` reports the missing folders `stateRoot` and `cache` for a fresh state root and pins the existing ones. Its `root` is null.
4. If `<stateRoot>/cache` has mode 0755, `cacheLayout` refuses `SKILLS_STATE_UNSAFE`.
5. `seedPin` with a project keeps its old result (reuse the cases of `sync-global-cache.test.mjs`).
6. `storeStateNested` is true in three cases: `XDG_STATE_HOME` inside the store, the store inside the state root, and an alias by device and inode. It is false for two siblings.

`tests/store-write-cli.test.ts`:

1. `skill create x --global` in a folder that is not a project prints the plan with the `Create the store` line first and exits 3.
2. The same with `--approve <revision>` creates `store.json`, `skills.json`, `skills/x/SKILL.md`, and `authoring/receipt.json` and exits 0.
3. A second run refuses `SKILL_EXISTS`.
4. `prompt create p --global` and `team create t --global --profile founder` work after the store exists. The plan has no `Create the store` line.
5. `team create t --global --team a` exits 2.
6. `skill create x --global --team nope` refuses `TEAM_NOT_FOUND`.
7. `skills add npm:... --global` (use the fake network of `tests/support/fake-network.ts`, as `tests/skills-add-cli.test.ts` does) writes the store `skills.json` and the cache under `XDG_STATE_HOME`. No cache file exists inside `~/.bowerloom`.
8. `skills add ... --global` with `XDG_STATE_HOME` inside the store refuses `STORE_STATE_NESTED`.
9. `skills check --global` prints `skills.json (store) is valid`. With no store it refuses `MANIFEST_NOT_FOUND`.
10. `ls --global` lists the store items with the source `store`. `ls --global --json` has `scope: "store"` and `storeState: "ready"`.
11. `ls --global` with no store prints `No store yet.` and exits 0. With a foreign store it refuses `STORE_INVALID` and exits 1.
12. `ls` in a project lists items with the source `project` (update `tests/ls-status-cli.test.ts` to the text and JSON of 3.9).
13. `ls teams --global --json` has only the `teams` array plus the fixed fields.
14. A `--global` write leaves the project's `.bowerloom` untouched (folder snapshot compare).
15. A test makes an empty `~/.bowerloom`, then runs `skill create x --global --approve <rev>` and expects success.
16. `--global` twice exits 2 with `Use --global once.`
17. A project `skill create` still works and writes a v1beta2 plan.
18. (Moved to `store-write.test.mjs`.) The plan-time cloud refusal is spec 03's store test 22, through the `accountHome` hook.
19. A test holds `withProjectLock(storeDir)` in the test process. A `--global` apply refuses `STORE_LOCKED` and writes nothing.
20. `ls` text pads team ids and skill ids to the widest label of each section.

Update `tests/create-cli.test.ts`, `tests/authoring.test.ts`, `tests/skills-add-cli.test.ts`, and `tests/skills-replace-cli.test.ts` for the new plan format names. Update `tests/human-refusal.test.ts` for the two new codes and the `MANIFEST_LIMIT` sentence. `tests/help-human.test.ts` does not change in this spec.

## 11. Build order

1. Manifest limits and targets (`schema.ts`, `add.ts`, `check.ts`) with `limits-store.test.mjs`.
2. `cacheLayout`, `storeStateNested`, and `seedPin` with `seed-store.test.mjs`.
3. `STORE_BRIEF` with `brief.test.mjs`.
4. `withStoreForWrite` in `store.ts` with `store-write.test.mjs`.
5. Authoring scope in `create.ts` with `create-store.test.mjs`.
6. CLI: `create.ts`, `manifest.ts`, `ls.ts`, `confirm.ts`.
7. Help text and refusal words.
8. `tests/store-write-cli.test.ts` and the updates to existing tests.
9. Docs: `cli.md`, `configuration.md`, `create-items.md`, `add-skills.md`, `errors.md`, `releases.md`.
10. Run `npm run typecheck` and `npm test`.

## 12. Unverified items

1. `tests/skills-add-cli.test.ts` uses `tests/support/fake-network.ts`. I read the preload header, not every route helper. Reuse its route files. The URLs do not depend on the scope, so the same routes serve `--global`. If a test fails with a 404 from the fake, the route file lacks a URL that the plain `skills add` test also needs. Copy that test's route file.
2. The width rule for padding ids in `ls` text output. The old code padded only pinned ids (`ls.ts:71`). The new rule pads every label in a section to the widest label of that section. If an existing text test fails, update its expected text. Do not keep the old rule.
