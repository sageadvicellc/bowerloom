# 04. Store writes

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 5. Decisions 1, 4 (`ls` tags), 7, 8, 9, 11, 13, and 14. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decisions 12 to 15: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332752507. Defaults: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332968796.
- Lane: 2.
- Branch: `beta3/04-store-writes`.
- Depends on: spec 03 (store rules, `StoreContext`, `inspectStoreWith`, `openStoreWith`, `verifyStorePins`).
- Line numbers below are from commit c9730d3. Find each place by its function name if it moved.

## 2. Problem

The store at `~/.bowerloom` has no way to receive anything. A person cannot put a skill, a prompt, a team, or a pinned skill into it. `ls` cannot show it. The create commands and `skills add` only write inside a project.

This spec adds the flag `--global`. With it, `skill create`, `prompt create`, `team create`, `skills add`, `skills check`, and `ls` work on the store. It also changes the format of `ls` so that each item names its source, `store` or `project`. It adds the store limits, and it lets `skills add --global` fill the machine cache without a project.

This spec does not select store items for a project. Spec 06 does that.

## 3. Behavior

### 3.1 Commands and flags

All usage lines below are verbatim. Add `[--global]` where shown.

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

1. It is a switch with no value. Giving it twice refuses `USAGE`.
2. With `--global`, the command does not look for a project. It works from any folder. It uses the store at `~/.bowerloom`.
3. With `--global`, `--team <team>` on `skill create`, `prompt create`, and `skills add` names a team in the store. A team in the store is a folder `teams/<id>` that the store's authoring record lists.
4. `team create <name> --global` takes `--profile` and nothing else. It never reads a project brief. It uses the fixed store brief in 3.5. `--team` on `team create` is already a usage error.
5. The usage error text for each command is the usage line above with the words `Use` before it, as `apps/cli/src/create.ts:21-25` and `apps/cli/src/manifest.ts:~40` do today.

### 3.2 Help text

Add these lines to the topics in `apps/cli/src/human.ts`.

In `TOPICS.team`, `TOPICS.skill`, and `TOPICS.prompt`, after the existing usage block:

```text
--global creates the item in your store, ~/.bowerloom, and not in this project. The store holds definitions only.
A project picks store items with bowerloom use. The first --global write makes the store.
```

In `TOPICS.team` add:

```text
With --global a team is built from a fixed store brief and the profile you choose. It does not read a project brief.
```

In `TOPICS.skills`, after the `skills add` paragraph:

```text
skills add --global pins the skill in ~/.bowerloom/skills.json, your store, and keeps the checked bytes in the
machine cache. The store holds up to 256 skills. A project holds up to 128.
skills check --global checks the pins in the store.
```

In `TOPICS.ls`:

```text
Usage:
  bowerloom ls [teams|skills|prompts] [--global] [--json]

Lists the teams, skills, and prompts of this project. Each item shows where it comes from: project or store.
--global lists your store, ~/.bowerloom, from any folder.
It reads only and writes nothing.
The project is the nearest parent folder that holds .bowerloom or bowerloom.json, found the way git finds .git.
It stops at your home folder and refuses cloud-synced folders.
Add --json for one machine-readable object.
```

### 3.3 First write makes the store

If the store is absent, or is a leftover folder (spec 03, rule 6), the first `--global` write creates it. The plan says so with this line, placed first among the plan lines:

```text
Create the store at ~/.bowerloom (store.json). It holds definitions only.
```

If `~/.bowerloom` exists and is `foreign`, the command refuses `STORE_INVALID` at plan time. Bowerloom never takes over a folder it did not make. If any safety rule of spec 03 refuses, the command refuses with that `STORE_*` code at plan time. No read-only `--global` command (`ls --global`, `skills check --global`) creates anything. Without a store, they print the messages in 3.9 and 3.10.

Creation steps, in order, inside apply:

1. If the store folder does not exist, create it with mode 0700. If the create fails with `EEXIST`, continue. This is the only write that happens before the plan revision is checked. An empty folder is harmless, because spec 03 treats it as a leftover.
2. Take the store lock: `withProjectLock(storeDir, signal, ...)` from `packages/project-context/src/index.ts:168`. The lock slot follows the inode of the store folder (`lockSlot`, line 59). A `PROJECT_LOCKED` refusal here becomes `STORE_LOCKED`.
3. Under the lock, inspect the store again. If it is a valid store, continue. If it is `foreign`, refuse `STORE_INVALID`. If it is `absent` or a leftover, write `store.json`. Write a temporary file `.store.json.<16 hex>.tmp` with `O_EXCL | O_NOFOLLOW`, mode 0644, flush it, `link` it to `store.json`, remove the temporary name, and flush the folder. Remove any leftover temporary file first.
4. Pin the store with `openStore(home)` and keep that context for the rest of the run. Call `verifyStorePins(store)` before each later write.
5. Run the item write (3.4 or 3.6) before the lock is released.

Crash recovery: a crash after step 1 leaves an empty folder. A crash during step 3 leaves a folder with a temporary file or a complete `store.json`. Both states are valid starting points. The next `--global` command plans `Create the store ...` again, or finds a valid store. Nothing needs manual repair.

### 3.4 `skill create`, `prompt create`, `team create` with `--global`

The command parses its words, then plans, then asks for approval, then applies. The sequence in apply is the same as for a project (see `applyCreate`, `packages/project-authoring/src/create.ts:274-372`): remove scratch, clear or finish a pending record, make folders, write the pending record, stage the files, move them in place, write `skills.json` for a skill, write the receipt, remove the pending record. The folder that holds all of this is the store folder itself. In the store, `skills/`, `prompts/`, `teams/`, `authoring/`, and `skills.json` sit directly in the store folder. They do not sit in a `.bowerloom` folder.

Differences from a project create:

1. No check for `.bowerloom-revision.json`.
2. The plan field `bowerloom` is `null`. Spec 03's `verifyStorePins` replaces the `sameBowerloom` check.
3. `--team` is checked against the store: the name must be a team that the store's receipt lists and whose folder `teams/<name>` is a real folder. The name `first-team` is not special in the store. It is not a store team, so it refuses `TEAM_NOT_FOUND`.
4. A team is built with `scaffoldTeam({ ...STORE_BRIEF, profile }, name, name)`. See 3.5.
5. The skill limit is 256 in `skills.json`. At the limit, refuse `MANIFEST_LIMIT`.
6. Names follow the same rules as a project: `checkName` at `create.ts:101-107`.

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

The lines for restore, finish, discard, and scratch keep the wording of `renderCreateReview` (`apps/cli/src/create.ts:56-82`), with the store paths in place of the project paths. The last two lines of a project create (`You and your agents ...` and `This writes inside .bowerloom only ...`) become the two lines above.

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
export function storeBrief(profile: StartupProfile | null): NormalizedBrief   // { ...STORE_BRIEF, profile: profile ?? 'engineer' }
```

Do not pass the brief through `startupInternals.normalize`. That function refuses a target path that holds `.bowerloom` (`packages/startup/src/index.ts:101-107`). A test proves that `normalize` accepts the same fields with a safe target and returns them unchanged. This keeps the text inside the bounds.

`scaffoldTeam` (`packages/startup/src/scaffold.ts:37`) reads only the brief fields, the team id, and the display name. It reads no path. The team name in the files is the display name, which is the team id given on the command line. The files carry the line `Brief <digest>` in the team description. The digest is fixed for a given profile, so two stores built from the same profile hold equal brief files.

Spec 06 reuses `STORE_BRIEF` for a project that has a config and no `brief.json`.

### 3.6 `skills add --global`

The sequence is the one in `runAdd` (`apps/cli/src/manifest.ts:137-180`), with these changes:

1. Line 140 (`discoverProject`) becomes: open the store with `inspectStore(home)`. If the store is `foreign` or refused, refuse with the `STORE_*` code. If it is absent, the plan carries `storeCreate: true`.
2. Line 141 (`requireTeams`) checks the store teams, as in 3.4 rule 3.
3. Line 142 (`readManifestState`) reads the store `skills.json` with the store limits (256 skills, 4 MiB). If the store is absent it returns no file.
4. Line 146 (`verifyProjectPins`) becomes `verifyStorePins(store)` when the store exists.
5. Line 148 keeps the cache at `join(privateStateRoot(env, home), 'cache')`. The cache is never inside the store.
6. The plan is `planManifestChange(target, add, { cacheRoot })` with the store target (4.3).
7. Apply: run the store creation steps of 3.3 first when `storeCreate` is true. Then `applyManifestChange`. Then seed the cache (line 175) with `seedPin({ project: null, stateRoot }, written, bytes, signal)`.
8. If the state root is inside the store, or the store is inside the state root, refuse `STORE_STATE_NESTED` at plan time. The check uses paths when the store is absent. It also compares device and inode when the store exists. Copy the algorithm of `nested` (`packages/project-sync/src/plan.ts:128-136`) and use the store's identity and ancestry in place of the project's.

Plan lines. The existing review (`renderAddReview`, `manifest.ts:~105-130`) prints `Add skill <id> to <plan.manifest>`. For the store scope, `plan.manifest` is the text `~/.bowerloom/skills.json`. Add one line before `Add skill`: `Create the store at ~/.bowerloom (store.json). It holds definitions only.` when `storeCreate` is true. Add this line after the `Cache:` line:

```text
  Scope: store. A project picks this skill with bowerloom use.
```

The cache line stays: `Cache: <root> keeps the bytes checked here, so skills sync need not fetch them again.`

### 3.7 `skills check --global`

It reads the store `skills.json` with the store limits and prints the same report as `skills check`. The first line reads `skills.json (store) is valid: <n> skills, for Claude Code and Codex.` instead of `skills.json is valid: ...`. The JSON format is `bowerloom/skills-manifest-check/v1beta2`, which adds the field `scope` (`project` or `store`) and keeps every other field of v1beta1. With no store, or a store with no `skills.json`, it refuses `MANIFEST_NOT_FOUND`.

### 3.8 Machine cache without a project

`seedPin` (`packages/project-sync/src/seed.ts:49-66`) calls `stateLayout(input)`, which needs a project (`plan.ts:157-176`). Add `cacheLayout(stateRoot)` to `plan.ts`. It returns `{ cacheRoot, pins, missing }`. It checks the state chain and `<stateRoot>/cache` exactly as `stateLayout` does (the chain from `stateRoot` up, the private-folder check on `cacheRoot` only, the limit of 8 missing folders), and it does not touch a project. `stateLayout` calls `cacheLayout` for that part and keeps its own signature. `seedPin` takes `input: { project: ProjectContext | null; stateRoot: string }`. With a project it behaves as today. With `null` it calls `cacheLayout` and skips `projectFolders` and the nesting check.

### 3.9 `ls` and `ls --global`

`ls` moves to format `bowerloom/ls/v1beta2`. In this spec both forms list folders. Spec 06 makes a project with a config list the config.

`ls` (no flag) lists the project as today, and tags every item `project`. `ls --global` lists the store and tags every item `store`. `ls --global` works from any folder and needs no project.

Text output, with these exact shapes. `<w>` pads the id to the widest id of the section.

```text
Teams
  first-team (First team)  project
  research  store

Skills
  house-style  project
  tanstack-db  project  pinned: npm @tanstack/db-skills@0.0.1:skills/tanstack-db/collections

Prompts
  none yet
```

- A team shows `<id>` or `<id> (<display name>)`, then two spaces, then the source.
- A skill shows `<id padded>`, two spaces, the source. A pinned skill adds two spaces and `pinned: <pin text>`. The pin text is `npm <package>@<version>:<path>` or `GitHub <repo>@<commit>:<path>`, as `apps/cli/src/ls.ts:36-37` builds it today.
- A prompt shows `<id>`, two spaces, the source.
- An empty section shows `  none yet`.
- After the sections, the `Not listed:` note and the note `Pinned skills are not listed: ... cannot be read` keep their wording (`ls.ts:77-78`). For the store, the second note names `skills.json` in the store, so it reads `Pinned skills are not listed: the store skills.json cannot be read. Run bowerloom skills check --global.`
- With no store, `ls --global` prints `No store yet. Create one with bowerloom skill create <name> --global.` and exits 0. It prints no sections.

JSON, field by field:

| Field | Type | Meaning |
|---|---|---|
| `format` | string | `bowerloom/ls/v1beta2` |
| `scope` | string | `project` or `store` |
| `listedBy` | string | `folders` in this spec |
| `teams` | array | Present unless a section was named. Each item: `{ "id": string, "source": "project"\|"store", "via": [], "displayName": string\|null, "state": "ok" }`. |
| `skills` | array | Each item: `{ "id": string, "source": "project"\|"store", "via": [], "kind": "local"\|"npm"\|"git", "pin": string\|null, "state": "ok" }`. `pin` is null for `local`. |
| `prompts` | array | Each item: `{ "id": string, "source": "project"\|"store", "via": [], "state": "ok" }`. |
| `pinsReadable` | boolean | Present when skills are shown. False when `skills.json` cannot be read. |
| `unselected` | object | `{ "skills": [], "prompts": [], "teams": [] }`. Always empty lists in this spec. |
| `unlisted` | number | The count of entries with an unusual name or type, as today. |
| `storeState` | string | Present only when `scope` is `store`. `ready` or `absent`. |

Item order: sorted by `id` in byte order. When one section is named (`ls skills`), only that array appears, with `format`, `scope`, `listedBy`, `unselected`, `unlisted`, and for skills `pinsReadable`. The names `via` and `state` are fixed here so spec 06 adds values, not fields.

`displayName` is the team name from `.bowerloom/brief.json` for `first-team` only. It is null for every other team and for every store team.

### 3.10 Exit codes

All commands in this spec use the existing codes: 0 for done or nothing to do, 1 for a refusal, 2 for `USAGE`, 3 when a plan waits for approval, 130 for an interrupt.

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

Change `parseManifest(bytes, limits = MANIFEST_LIMITS)` (line 158) and `validateManifest(value, limits = MANIFEST_LIMITS)` (line ~140). Replace the uses of `MANIFEST_LIMITS` at lines 150, 160, and 164 with `limits`. Pass the limits through `strictJson(text, limits.bytes)` at line 164.

### 4.3 Manifest target

In `packages/skill-manifest/src/add.ts` add:

```ts
export interface ManifestTarget { folder: string; lockDir: string; scope: 'project' | 'store'; limits: ManifestLimits }
export const projectTarget = (projectDir: string): ManifestTarget => ({ folder: join(projectDir, '.bowerloom'), lockDir: projectDir, scope: 'project', limits: MANIFEST_LIMITS });
export const storeTarget = (storeDir: string): ManifestTarget => ({ folder: storeDir, lockDir: storeDir, scope: 'store', limits: STORE_MANIFEST_LIMITS });
```

`readManifestState`, `planManifestChange`, and `applyManifestChange` accept a `string` (a project folder, as today) or a `ManifestTarget`. A string means `projectTarget(string)`. This keeps every existing caller unchanged.

`readManifestState(target)` (line 76): use `target.folder` in place of `join(project, '.bowerloom')` at line 78. Use `target.limits.bytes` in place of `MANIFEST_LIMITS.bytes` at lines 86, 91, and 92. Add the option `allowAbsent`. When the folder is missing and `allowAbsent` is true, return `{ bowerloom: null, file: null }`. Without the option a missing folder still refuses `MANIFEST_UNSAFE`. The return type `bowerloom` becomes `{ device: string; inode: string } | null`.

`planManifestChange(target, change, options)` (line 122): use `target.limits.skills` at lines 51 and 139. The plan format becomes `bowerloom/skills-manifest-change/v1beta2`. Add the fields `scope`, `storeCreate` (boolean), and make `bowerloom` `{ device, inode } | null`. The value is null when `scope` is `store`. The field `manifest` is `.bowerloom/skills.json` for a project and `~/.bowerloom/skills.json` for the store. The field `project` is the lock folder (`target.lockDir`). The store's identity is bound by `verifyStorePins`, not by this field.

`applyManifestChange(plan, revision, held)` (line 170): build the target from `plan.scope` and `plan.project`. Use `target.folder` for `folder` at line 180. Skip the identity comparison at lines 184-186 when `plan.bowerloom` is null. Keep everything else.

`checkManifest(project)` in `check.ts` takes a string or a target and adds `scope` to the result. Its format becomes `bowerloom/skills-manifest-check/v1beta2`. `MANIFEST_PATH` (`add.ts:18`) stays for the project.

### 4.4 Authoring scope

In `packages/project-authoring/src/create.ts`:

- `CreateInput` (lines 34-36) gains the optional key `scope: 'project' | 'store'`. The default is `project`. For `store`, the `project` key holds the store folder path.
- `normalizeInput` (lines 83-99) lists the allowed keys for each kind. Add `scope` to both lists. Refuse `USAGE` for a `scope` other than the two values.
- Replace `Project` and `openProject` (lines 108-114) with `Scope` and `openScope(input)`:

```ts
interface Scope { kind: 'project' | 'store'; dir: string; bowerloom: string; identity: { device: string; inode: string } | null; exists: boolean }
```

For a project, `openScope` does what `openProject` does. For a store, `bowerloom` equals `dir`. `exists` is false when the store folder is absent or a leftover. Then `identity` is null.
- In `plan()` (lines 181-266): when the scope is a store that does not exist, use an empty state in place of `readAuthoringState`: `{ folder: false, receipt: null, pending: null, scratch: [] }` (the shape is `AuthoringState`, `state.ts:~112`). Skip the revision-pending check for a store. Use `readManifestState(storeTarget(dir), { allowAbsent: true })` for the store manifest (`currentManifest`, line 159). Set `storeCreate` in the plan and push the folder names `authoring` and the parent folder as `folders`.
- `CreatePlan` (lines 40-73) gains `scope` and `storeCreate`. `bowerloom` becomes nullable. The plan format becomes `bowerloom/authoring-plan/v1beta2`.
- `requireTeams` (lines 171-179) works from `scope.bowerloom` and the registered items. For a store it does not accept `first-team` as a special case. Add a parameter `allowFirstTeam` that is true for a project and false for the store.
- `readBrief` (line 122) is not called for a store. Use `storeBrief(profile)` in its place at line 245.
- `applyCreate` (lines 274-372): build the scope from the plan. For a store, run the creation steps of 3.3 first, then use `verifyStorePins` in the `live()` check (line 285) in place of `sameBowerloom`.
- `makeFolder` (`files.ts:87`) is used as is.

### 4.5 `CreatePlan` and review text

The plan JSON keeps its shape. The review function prints the lines in 3.4 using `plan.scope`. The `where()` helper (`apps/cli/src/create.ts:58`) returns `.bowerloom/teams/<id>` for a project and `~/.bowerloom/teams/<id>` for the store, with the same for skills and prompts.

## 5. Refusal codes

| Code | Cause | Next step |
|---|---|---|
| `STORE_STATE_NESTED` | The private state folder is the store or inside it, or the store is inside the state folder. | Set `XDG_STATE_HOME` to a folder outside `~/.bowerloom`. |
| `STORE_LOCKED` | Another command is changing the store. | Run the same command again when the other one is done. |
| `STORE_INVALID` | `~/.bowerloom` exists but is not a store, at the first write. | `bowerloom store status` |
| `TEAM_NOT_FOUND` | `--team` names a team that is not in the store. | `bowerloom ls teams --global` |
| `MANIFEST_LIMIT` | The store `skills.json` is over 256 skills or 4 MiB, or a project one is over 128 or 1 MiB. | `bowerloom skills check` |
| `MANIFEST_NOT_FOUND` | `skills check --global` found no store `skills.json`. | `bowerloom skills add npm:<package>@<version>:<path> --global` |

The other `STORE_*` codes come from spec 03. The sentence for `MANIFEST_LIMIT` in `apps/cli/src/human.ts` reads today `This beta keeps skills.json small: 128 skills and 1 MiB at most.` Change it to `This beta keeps a project skills.json small: 128 skills and 1 MiB at most. The store holds 256 skills and 4 MiB.`

`STORE_STATE_NESTED` and `STORE_LOCKED` need a sentence and a next step in `REFUSALS` (`human.ts:224`). Their fixed messages live in `packages/project-context/src/refusal.ts:7-17`. `STORE_LOCKED` is the store's form of `PROJECT_LOCKED`. Map it where the store lock is taken.

## 6. Where to change

Create:

- `packages/project-config/src/brief.ts` (3.5).
- Test files in section 10.

Change:

- `packages/project-context/src/store.ts` (from spec 03): add `withStoreForWrite(home, signal, work)`. It runs steps 1 to 4 of 3.3 and then calls `work(store, held)` while it still holds the store lock. It releases the lock when `work` ends. It is the only function that creates the store. Every store write runs inside it.
- `packages/skill-manifest/src/schema.ts:19, 53, 69, 140-165`: limits (4.2).
- `packages/skill-manifest/src/add.ts:17-18, 21-40, 51, 76-102, 122-160, 170-201`: target, plan fields (4.3).
- `packages/skill-manifest/src/check.ts`: target, scope field, format.
- `packages/skill-manifest/src/index.ts:2`: export `STORE_MANIFEST_LIMITS`, `ManifestLimits`, `ManifestTarget`, `projectTarget`, `storeTarget`.
- `packages/project-authoring/src/create.ts:34-36, 40-73, 83-99, 108-120, 159-179, 181-266, 274-372`: scope (4.4).
- `packages/project-authoring/src/index.ts:5-6`: export the changed types.
- `packages/project-sync/src/plan.ts:157`: add `cacheLayout`, have `stateLayout` call it.
- `packages/project-sync/src/seed.ts:49-66`: accept a null project.
- `packages/project-sync/src/index.ts`: export `cacheLayout` if a test needs it.
- `apps/cli/src/create.ts:21-25, 30-53, 56-82, 85-92, 95-105`: the flag, the usage text, the review, the store branch in `runCreateCommand`, and `createChange` for the store scope.
- `apps/cli/src/manifest.ts:~20-50, 105-131, 137-207`: the flag, `requireTeams` for the store, `runAdd`, `runCheck`.
- `apps/cli/src/ls.ts:16-90`: format, `--global`, source tags, per-item pins. Replace `Listing.pinned` with per-skill `pin` and `kind`. `runLsCommand` (line 83) accepts `--global`.
- `apps/cli/src/main.ts:145`: pass `--global` through to `runLsCommand` (it receives all `args`). Lines 152-164 already pass `args` to the create and manifest runners. No new dispatch is needed.
- `apps/cli/src/human.ts:45-160`: the help topics. `human.ts:224`: the refusal words.
- Other callers that pass a string to `readManifestState` stay as they are: `plan.ts:374`, `apply-project.ts:131`, `up.ts:130`, `ls.ts:34`, `held.ts`, `verifiers.ts:~85`. Do not change them in this spec.
- `package.json:30`: add the new test files if they sit in a folder not yet listed. `packages/skill-manifest/test/*.test.mjs`, `packages/project-authoring/test/*.test.mjs`, and `packages/project-sync/test/*.test.mjs` are already listed.

## 7. Edge cases

| Case | Expected result |
|---|---|
| `skill create x --global` and the store is absent | The plan starts with the `Create the store ...` line. Apply makes the folder, `store.json`, `skills/x/SKILL.md`, `skills.json` with one local entry, and `authoring/receipt.json`. |
| `skill create x --global` and the store has a skill `x` | `SKILL_EXISTS`. |
| `skill create x --global --team research` and the store has no team `research` | `TEAM_NOT_FOUND`. |
| `skill create x --global --team first-team` | `TEAM_NOT_FOUND`. |
| `team create first-team --global` | `TEAM_ID_RESERVED`. |
| `team create t --global --team a` | `USAGE`. |
| `team create t --global --profile founder` | The files hold the founder templates and the fixed brief. |
| A `team create` with `--global` run twice in two stores gives equal bytes | The files are identical, including the digest in `team.yaml`. |
| The 257th skill in the store | `MANIFEST_LIMIT`. |
| The 129th skill in a project | `MANIFEST_LIMIT`. |
| `skills add --global` and the cache already holds the pin | The result says `Cache: <root> already held this pin.` |
| `skills add --global` and the seed fails | The pin stays in the store `skills.json`. The result reports the cache failure in words and JSON, as a project add does (`manifest.ts:131-135`). |
| `XDG_STATE_HOME` points inside `~/.bowerloom` | `STORE_STATE_NESTED` at plan time. |
| Two `skill create --global` commands at once | The second waits or refuses `STORE_LOCKED`. The first finishes. The second plan is stale and refuses `STALE_APPROVAL`. |
| A crash after the store folder is made and before `store.json` | The next command plans `Create the store ...` again and succeeds. |
| A crash during a store create (pending record present) | The next `--global` create of the same name finishes or clears it, as a project create does. A create of another name refuses `AUTHORING_PENDING` until then, exactly as in a project. |
| `ls --global` and the store has a link inside `skills/` | The link counts under `unlisted`. `ls` does not follow it. |
| `ls --global` outside any project | Works. Exit 0. |
| `ls` outside any project and no `--global` | `PROJECT_NOT_FOUND`, as today. |
| `ls --global --json` with no store | `storeState: "absent"` and empty arrays. |
| `--global` together with a project that has a different skill of the same id | No interaction. The project is not read. |
| The home folder is under iCloud | `STORE_IN_CLOUD_FOLDER` at plan time. |
| A `skills add --global --replace` | Works on the store entry. The id must exist (`SKILLS_ADD_REPLACE_MISSING`). |

## 8. Migration from beta.2 projects

- No project file changes.
- `ls` and `ls --json` change shape. A script that reads `format: "bowerloom/ls/v1beta1"` must accept `bowerloom/ls/v1beta2`. In v1beta2 each item is an object. The old `pinned` list is gone. Each skill carries its own `pin` and `kind`. The text output gains a source column.
- `skills check --json` changes format to `bowerloom/skills-manifest-check/v1beta2`. The old fields keep their names and meanings. `scope` is new.
- The `skills add` plan JSON changes format to `bowerloom/skills-manifest-change/v1beta2` and the `create` plan JSON to `bowerloom/authoring-plan/v1beta2`. Both are internal to the approval flow. A revision from beta.2 does not approve a beta.3 plan. This is the normal behavior, because plans are not stored.
- Existing `.bowerloom/authoring/receipt.json` and `skills.json` files stay valid.

## 9. Docs changes for this track

- `apps/docs/src/content/docs/cli.md`, `## Create commands`: add `[--global]` to the three usage lines and one paragraph on the store. In `## Third-party skills`: add `--global` to `skills add` and `skills check`. In `## Project commands`: change the `ls` usage line and its paragraph to the text in 3.9. Describe the source column and the new JSON.
- `apps/docs/src/content/docs/guides/create-items.md`: add a section "Create an item in your store" with one example for each of the three commands and the sentence "A project picks store items with `bowerloom use`." Spec 06 defines `use`. Both specs ship in beta.3.
- `apps/docs/src/content/docs/guides/add-skills.md`: add a short section "Pin a skill in your store" for `skills add --global` and the limits 128 and 256.
- `apps/docs/src/content/docs/reference/errors.md`: rows for `STORE_STATE_NESTED` and `STORE_LOCKED`, and an updated `MANIFEST_LIMIT` row.
- `apps/docs/src/content/docs/releases.md`, `## 0.7.0-beta.3`: "`--global` on `team create`, `skill create`, `prompt create`, `skills add`, `skills check`, and `ls` works on your store, `~/.bowerloom`. `ls` shows where each item comes from. `ls --json` has a new format, `bowerloom/ls/v1beta2`. The store holds up to 256 skills and a project up to 128."
- `apps/docs/tools/check-brand.mjs`: no change.

## 10. Acceptance tests

Every CLI test spawns the CLI with `HOME` set to a temporary folder and `XDG_STATE_HOME` set to another temporary folder. Every file imports `tests/support/isolate-home.js`.

`packages/skill-manifest/test/limits-store.test.mjs`:

1. A manifest with 256 skills passes `parseManifest` with `STORE_MANIFEST_LIMITS`.
2. A manifest with 257 skills gives `MANIFEST_LIMIT` with the store limits.
3. A manifest with 129 skills gives `MANIFEST_LIMIT` with the default limits.
4. A 4 MiB file passes with the store limits. 4 MiB plus one byte gives `MANIFEST_LIMIT`.
5. A 1 MiB file passes with the default limits. 1 MiB plus one byte gives `MANIFEST_LIMIT`.
6. `readManifestState` with `storeTarget` reads `<store>/skills.json` and refuses a link, a second hard link, a foreign owner, and group write with `MANIFEST_UNSAFE`.
7. `readManifestState` with `allowAbsent` and a missing folder returns `{ bowerloom: null, file: null }`. Without the option it refuses `MANIFEST_UNSAFE`.
8. `planManifestChange` with the store target gives `scope: "store"`, `bowerloom: null`, and `manifest: "~/.bowerloom/skills.json"`. Its revision does not change when the store folder is created between two plans.
9. `applyManifestChange` writes `<store>/skills.json` and keeps the plan's hash checks.
10. The existing `schema.test.mjs` and `add.test.mjs` cases still pass with string callers.

`packages/project-authoring/test/create-store.test.mjs`:

1. `planCreate` with `scope: "store"` for a skill, a prompt, and a team against an absent store gives `storeCreate: true`, `bowerloom: null`, and the folder list `authoring` and the parent folder.
2. The team plan does not read `brief.json` and uses `STORE_BRIEF`. Its `compiledCandidate` is equal across two runs.
3. `applyCreate` for each kind writes the expected files, the `skills.json` entry for a skill, and the receipt, in the store folder.
4. `--team` against a store team passes. Against `first-team` it gives `TEAM_NOT_FOUND`.
5. A store with a pending record resumes or clears it exactly as a project does (copy the cases of `tests/authoring.test.ts` for the pending paths).
6. An existing id refuses `TEAM_EXISTS`, `SKILL_EXISTS`, or `PROMPT_EXISTS`.
7. The 257th skill refuses `MANIFEST_LIMIT`.
8. The plan for a store does not check `.bowerloom-revision.json`.
9. `normalizeInput` accepts `scope` and refuses an unknown `scope` with `USAGE`.
10. Project plans keep their old behavior and produce plan format `bowerloom/authoring-plan/v1beta2`.

`packages/project-config/test/brief.test.mjs`:

1. `storeBrief(null)` has profile `engineer`. `storeBrief('founder')` has profile `founder`.
2. `startupInternals.normalize` with the same fields and a safe target returns equal fields.
3. `scaffoldTeam(storeBrief('research'), 'x', 'x')` returns files whose paths all start with `teams/x/` and whose `compiled.candidateRevision` equals the value from a second call.

`packages/project-sync/test/seed-store.test.mjs`:

1. `seedPin` with `project: null` seeds an empty cache and returns `seeded`.
2. A second call returns `present`.
3. `cacheLayout` reports the missing folders `stateRoot` and `cache` for a fresh state root and pins the existing ones.
4. `cacheLayout` refuses `SKILLS_STATE_UNSAFE` when `<stateRoot>/cache` has mode 0755.
5. `seedPin` with a project keeps its old result (reuse the cases of `sync-global-cache.test.mjs`).

`tests/store-write-cli.test.ts`:

1. `skill create x --global` in a folder that is not a project prints the plan with the `Create the store` line first and exits 3.
2. The same with `--approve <revision>` creates `store.json`, `skills.json`, `skills/x/SKILL.md`, and `authoring/receipt.json` and exits 0.
3. A second run says the skill exists and refuses `SKILL_EXISTS`.
4. `prompt create p --global` and `team create t --global --profile founder` work after the store exists. The plan has no `Create the store` line.
5. `team create t --global --team a` exits 2.
6. `skill create x --global --team nope` refuses `TEAM_NOT_FOUND`.
7. `skills add npm:... --global` (use the fake network of `tests/support/fake-network.ts`, as `tests/skills-add-cli.test.ts` does) writes the store `skills.json` and the cache under `XDG_STATE_HOME`. No cache file exists inside `~/.bowerloom`.
8. `skills add ... --global` with `XDG_STATE_HOME` inside the store refuses `STORE_STATE_NESTED`.
9. `skills check --global` prints `skills.json (store) is valid`. With no store it refuses `MANIFEST_NOT_FOUND`.
10. `ls --global` lists the store items with the source `store`. `ls --global --json` has `scope: "store"` and `storeState: "ready"`.
11. `ls --global` with no store prints `No store yet.` and exits 0.
12. `ls` in a project lists items with the source `project` (update `tests/ls-status-cli.test.ts:27-42` to the text in 3.9 and the JSON in the table).
13. `ls teams --global --json` has only the `teams` array plus the fixed fields.
14. A `--global` write leaves the project's `.bowerloom` untouched (folder snapshot compare).
15. Creating the store with a crash simulated after the folder is made: the test makes an empty `~/.bowerloom`, then runs `skill create x --global --approve <rev>` and expects success.
16. `--global` twice exits 2.
17. A project `skill create` still works and writes a v1beta2 plan.

Update `tests/create-cli.test.ts` and `tests/authoring.test.ts` for the new plan format name. Update `tests/skills-add-cli.test.ts` and `tests/skills-replace-cli.test.ts` for the new plan format name. Update `tests/help-human.test.ts` if the first screen changes (it does not in this spec). Update `tests/human-refusal.test.ts` for the two new codes.

## 11. Build order

1. Manifest limits and targets (`schema.ts`, `add.ts`, `check.ts`) with `limits-store.test.mjs`.
2. `cacheLayout` and `seedPin` with `seed-store.test.mjs`.
3. `STORE_BRIEF` with `brief.test.mjs`.
4. Authoring scope in `create.ts` with `create-store.test.mjs`.
5. `withStoreForWrite(home, signal, work)` in `packages/project-context/src/store.ts` (3.3 steps 1 to 4). Test it in `store.test.mjs` from spec 03: it makes the folder and the file, recovers from a leftover, refuses a foreign folder, and holds the lock while `work` runs.
6. CLI: `create.ts`, `manifest.ts`, `ls.ts`.
7. Help text, refusal words.
8. `tests/store-write-cli.test.ts` and the updates to existing tests.
9. Docs: `cli.md`, `create-items.md`, `add-skills.md`, `errors.md`, `releases.md`.
10. Run `npm run typecheck` and `npm test`.

## 12. Unverified items

1. `applyCreate` in the store scope after the plan holds `bowerloom: null`. I read `applyCreate` (`create.ts:274-372`) and the `live()` check at line 285, not every helper it calls. First, run the project create tests with the new scope type and no store code. If a helper reads `project.identity` as non-null, change it to take the store pin check. If that does not fix it, give the store scope its own `live()` that calls `verifyStorePins` only.
2. `startupInternals.normalize` accepts the `STORE_BRIEF` fields. I read the rules at `packages/startup/src/index.ts:90-100`. Run the `brief.test.mjs` case 2 first. If `normalize` rejects the goal text, shorten the goal until it passes and record the final text in the test.
3. `compileCrew` is called in `applyCreate` for a team (about line 346). It works on the staged file inside the `authoring` folder of the store. It reads only paths inside the staged tree. Run the team case first. If it refuses for a store path, pass `{ root: <stage folder> }` as `compileCrew`'s second argument (`packages/crew/src/index.ts:94`).
4. `tests/skills-add-cli.test.ts` uses `tests/support/fake-network.ts`. I read the preload header, not every route helper. Reuse its route files. The URLs do not depend on the scope, so the same routes serve `--global`. If a test fails with a 404 from the fake, the route file is missing a URL that the plain `skills add` test also needs. Copy that test's route file.
5. The width rule for padding ids in `ls` text output. The old code padded only pinned ids (`ls.ts:71`). The new rule pads every id in a section to the widest id of that section. If an existing text test fails, update its expected text. Do not keep the old rule.
6. `lockSlot` needs an existing folder (`packages/project-context/src/index.ts:60-66`). The creation steps make the folder first. If two processes race on the first `mkdir`, both continue after `EEXIST`, then one waits on the lock. Run the two-process case once by hand before the pull request. If it deadlocks, take the lock only after the first process finishes step 3 by retrying `withProjectLock` once on `PROJECT_LOCKED`.
