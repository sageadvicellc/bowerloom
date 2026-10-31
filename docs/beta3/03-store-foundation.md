# 03. Store foundation

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 4. Decisions 1, 2, 2b, 11, and 12. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decision 12 and the defaults: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332752507 and https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332968796. The first-screen limit: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6334068412.
- Lane: 2.
- Branch: `beta3/03-store-foundation`.
- Depends on: spec 02 (install pins). It changes no file that spec 02 changes.
- Line numbers below are from commit c9730d3. Specs 01 and 02 can move them. If a line moved, find the place by its function name.

## 2. Problem

Today the folder `~/.bowerloom` cannot exist. Project discovery walks up from the working folder to the home folder. It finds `.bowerloom` at home and refuses with `PROJECT_ROOT_REFUSED`. That stops `up` from starting a project anywhere under home. The beta.3 store lives at `~/.bowerloom`. So discovery must tell a store from a project.

A project also needs a marker that is not a folder. Decision 2b says a file named `bowerloom.json` at the project root marks a project, with or without a `.bowerloom` folder. Discovery, `status`, `ls`, and `up` must know this file. The managed engine still needs `.bowerloom/` for its records. Spec 06 creates it at the first install.

This spec builds the foundation only: the store rules, the marker, the reader of `bowerloom.json`, and the report commands. It writes no store and no config. Spec 04 writes the store. Spec 06 writes the config and resolves items.

## 3. Behavior

### 3.1 Terms

- Store: the folder `~/.bowerloom`. It holds definitions of skills, prompts, and teams. It holds no cache and no installed copy.
- Project: a folder that holds `.bowerloom/`, `bowerloom.json`, or both. The nearest such parent folder of the working folder is the project.
- Config: the file `bowerloom.json` at the project root.
- Config-only project: a project with `bowerloom.json` and no `.bowerloom/` folder.
- Plain file: a regular file, not a link. It has one hard link and belongs to the user. It has no group or world write permission.

### 3.2 Where the store is

The store path is `join(realpath(home), '.bowerloom')`. The `home` value is the argument the code receives. The CLI passes `os.homedir()`, which follows the `HOME` variable. The tilde in `~/.bowerloom` is `$HOME`. Bowerloom adds no other way to move the store (decision 11). The docs say so. Tests pass a temporary folder as `home`. CLI tests set `HOME` to a temporary folder.

For `home` equal to `/`, the path is `/.bowerloom`. Only tests use that case.

### 3.3 Store safety rules

Every store command and every discovery check applies these rules in this order. The first rule that fails decides the result. Only `STORE_*` codes and `USAGE` leave these rules.

1. If `home` is not an absolute path or holds a NUL character, refuse `USAGE`. This rule runs before `realpath(home)`.
2. Run `realpath(home)`. A failure refuses `STORE_UNREADABLE`. Compute the store path. Run `lstat` on it. A missing entry (`ENOENT` or `ENOTDIR`) runs rule 2a and rule 4 on the store path. `checkProjectPathWith` accepts a missing last folder (`discovery.ts:115-125`). If both pass, the state is `absent` with `leftover: false`. Any other failure refuses `STORE_UNREADABLE`.
2a. List the home folder. A failure refuses `STORE_UNREADABLE`. Only one name can fold to `.bowerloom` (the folding of `discovery.ts:32`). That name must be exactly `.bowerloom`. Two names, or a case alias, refuse `STORE_UNSAFE`.
3. Refuse `STORE_UNSAFE` for any of these: a symbolic link, a non-folder, an owner other than the user, or group or world write permission. A store folder with mode 0700 passes. A store folder with mode 0755 also passes.
4. Run `checkProjectPathWith(storeRoot, home, hooks)`. Map the codes. `PROJECT_IN_CLOUD_FOLDER` becomes `STORE_IN_CLOUD_FOLDER`. `PROJECT_UNREADABLE` becomes `STORE_UNREADABLE`. Any other `PROJECT_*` code becomes `STORE_UNSAFE`. This catches iCloud folders and links into them.
5. If `realpath(storeRoot)` differs from `storeRoot`, refuse `STORE_UNSAFE`. A link anywhere on the path fails here. A swap between rule 3 and this rule fails here too.
6. List the store folder. A failure refuses `STORE_UNREADABLE`. A name that matches `^\.store\.json\.[a-f0-9]{16}\.tmp$` is a leftover temporary file. Inspection ignores it. If no other name remains, the state is `absent` with `leftover: true`. Spec 04 creates the store in two steps, so a crash can leave an empty folder or such a file.
7. Only one name can fold to `store.json`. That name must be exactly `store.json`. Two names, or a case alias, refuse `STORE_UNSAFE`. If no name folds to `store.json`, the state is `foreign`: the folder exists but is not a store. Run `lstat` on `store.json`. Refuse `STORE_UNSAFE` for any of these: a link, more than one hard link, not a regular file, another owner, or group or world write permission. Open the file with `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`. An open failure other than `ENOENT` refuses `STORE_UNREADABLE`. Run `fstat` on the open file. If its device or inode differs from the `lstat`, refuse `STORE_UNSAFE`. Read at most 4097 bytes. A size over 4096 bytes, or content that breaks 4.1, refuses `STORE_INVALID`.
8. Pin the store folder and every parent folder with their device, inode, and birth time. Use `pinAncestry(dir)` (4.1). Keep the device and inode of `store.json` as `fileIdentity`. If a leftover temporary file was ignored, the state `store` carries `leftoverTemp: true`. Map `PROJECT_UNREADABLE` from `pinAncestry` to `STORE_UNREADABLE`, and `PROJECT_UNSAFE` to `STORE_UNSAFE`. `verifyStorePins` throws `STORE_UNSAFE` for either.

Two home folders can exist. `HOME` is one. The account home from the user database is the other. The store lives only at `join(realpath(home), '.bowerloom')`. The other home matters only to discovery (3.4) and to `pathInsideStore` (3.8).

### 3.4 Discovery rules

Discovery walks from the working folder up. At each folder it lists the names. It looks for `.bowerloom` and `bowerloom.json`. It compares names with case folding, as the code does today.

| Case | Result |
|---|---|
| A folder with no marker, no marker above it up to home, and no store at home | `PROJECT_NOT_FOUND` |
| The same, and a store at home (state `store`, or state `absent` with `leftover: true`) | `PROJECT_NOT_FOUND` (it was `PROJECT_ROOT_REFUSED`) |
| `.bowerloom` at home that is a non-empty folder with no valid `store.json` | `PROJECT_ROOT_REFUSED` |
| `.bowerloom` at home that is a link, or unsafe, or has a bad `store.json` | `PROJECT_ROOT_REFUSED` |
| At home, names that are not exactly `['.bowerloom']`, such as a case alias, or any `bowerloom.json` | `PROJECT_ROOT_REFUSED` |
| `.bowerloom` or `bowerloom.json` at the disk root | `PROJECT_ROOT_REFUSED` |
| A folder with only `bowerloom.json` | A project with `bowerloomIdentity: null` and `configPresent: true` |
| A folder with only `.bowerloom` | A project as today, with `configPresent: false` |
| A folder with both | A project with both |
| An inner folder with only `bowerloom.json` inside an outer folder with `.bowerloom` | The inner folder is the project. The nearest marker wins. |
| `Bowerloom.json` or any other case alias, or two names that fold to the same name | `PROJECT_UNSAFE` |
| `bowerloom.json` that is not a plain file, belongs to another user, is shared, or is over 1 MiB | `CONFIG_UNSAFE` |
| The working folder is inside the store | `PROJECT_NOT_FOUND` (the walk reaches home and the store is a store) |
| A folder inside the store with its own `.bowerloom` or `bowerloom.json` | `STORE_NOT_A_PROJECT` |

At a home folder, the store check uses that home folder. The account home can differ from `HOME`. For a `.bowerloom` at the account home, call `isValidStore(thatHome, hooks)`. A result of true makes it a store. Also call `inspectStoreWith(thatHome, hooks)`. A result of `absent` with `leftover: true` also makes it a store. Any other result, or any throw, makes discovery refuse `PROJECT_ROOT_REFUSED`.

The home check never throws a `STORE_*` code. A bad store at home is a `PROJECT_ROOT_REFUSED`. Only the store commands report `STORE_*` codes. The exception is `STORE_NOT_A_PROJECT` from `build` (3.8).

> Erratum after the build, PR #90: a `.bowerloom` at home that is a link, unsafe, or has an invalid `store.json` now refuses with its `STORE_*` code (`STORE_UNSAFE`, `STORE_INVALID`), not `PROJECT_ROOT_REFUSED`. `PROJECT_ROOT_REFUSED` still covers a non-empty home `.bowerloom` with no `store.json`, and any `bowerloom.json` at home. The table row above and the sentence before it are superseded.

The check order in `build` is: the aliases, the configs, the `lstat` of `.bowerloom`, then the `lstat` of the config.

### 3.5 The config file is read, never written, in this spec

The reader checks `bowerloom.json` with the rules in 4.2. `status` reports it. No command in this spec writes it. A writer that creates either marker calls `adoptCreatedMarker` (4.3) right after it.

### 3.6 `bowerloom store status [--json]`

Help text, in `TOPICS.store` in `apps/cli/src/human.ts`:

```text
Usage:
  bowerloom store status [--json]

Shows the state of your store, ~/.bowerloom. The store holds definitions of skills, prompts, and teams.
It holds no cache and no installed copy.
It reads only and writes nothing, and it starts no workers.
The store is always at ~/.bowerloom, and ~ is your HOME folder. Bowerloom refuses a store that is a link,
that sits in an iCloud folder, or that other users can change.
Add --json for one machine-readable object.
```

Output for an absent store:

```text
Store: none yet
  Create one with bowerloom skill create <name> --global.
```

A leftover folder (rule 6 of 3.3) also prints `Store: none yet`, and its JSON state is `absent`. A leftover temporary file next to a valid `store.json` prints the line `  Leftover: <name> (the next --global write removes it)` for each file. The JSON field `leftoverTemps` holds the count.

Output for a valid store:

```text
Store: ready
  Path: <store path>
  Skill folders: <n>
  Pinned skills: <n>
  Prompts: <n>
  Teams: <n>
```

Output for a folder without `store.json`:

```text
Store: not a store
  <store path> exists, but it has no store.json. Bowerloom will not use it.
  Move it somewhere else first. Then run bowerloom skill create <name> --global.
```

Output for a refused safety rule:

```text
Store: refused (<CODE>)
  <fixed message of the code>
```

Counting rules:

- `Skill folders`, `Prompts`, and `Teams` count names that match `^[a-z0-9]+(?:-[a-z0-9]+)*$` (`apps/cli/src/ls.ts:13`). The names are the folders in `skills/`, the files `<name>.md` in `prompts/`, and the folders in `teams/`. No reserved id is filtered out.
- A `skills`, `prompts`, or `teams` entry that is a link or not a folder counts 0. A link, a stray file, or a name that does not match counts nothing.
- More than 256 names count as 256, and the text reads `256 or more`.
- A read failure of one of these folders refuses `STORE_UNREADABLE`.
- `Pinned skills` is the number of entries in the store `skills.json` whose `source.kind` is `npm` or `git`. It is a plain count. Read the file with the plain-file rules, at most 4 MiB, parse it with `strictJson`, and count. Do not check the entries. A missing file counts 0. A file that cannot be read or parsed prints `Pinned skills: unreadable` and gives `null` in JSON. Spec 04 adds `skills check --global`, which checks the entries.

`store status` reports every `STORE_*` throw as state `refused` and exits 0. Any other throw passes through: `USAGE` exits 2, and anything else exits 1. `bowerloom store` with no word refuses `USAGE`. `store status` with any other word or flag refuses `USAGE` with `Use bowerloom store status [--json].`. `runStoreCommand` returns `Promise<number>`, and the number is always 0.

Spec 06 adds a `Git:` line and a `git` object. In this spec the JSON key `git` is always `null` and the text has no `Git:` line.

### 3.7 `status`, `ls`, and the other commands in a config-only project

- `status` works. Section 4.4 defines the output.
- `ls` works. `entries()` returns an empty list for a missing folder. `pinnedSkills` in `apps/cli/src/ls.ts:32` returns `[]` without reading, because `bowerloomIdentity` is null. The text output is exactly `Teams\n  none yet\n\nSkills\n  none yet\n\nPrompts\n  none yet\n`. The JSON field `pinned` is `[]`. Spec 04 changes the `ls` format.
- `up` finds the project, so it never runs the `init` step there.
- Spec 06 implements the rest. The `harnesses` list of the config is the target set of `skills sync`. The import of `Harness` comes from `packages/skill-manifest/src/schema.ts`.
- Until spec 06 lands, these commands in a config-only project give these codes:
  - `skills add`, `skills check`, `skills sync`, and `apply`: `MANIFEST_UNSAFE` (`packages/skill-manifest/src/add.ts:79`, `packages/project-sync/src/apply-project.ts:131`).
  - `skill create`, `prompt create`, and `team create`: `AUTHORING_UNSAFE_PATH` (`packages/project-authoring/src/create.ts:112`, `files.ts:24`).
  - `up --team`: `PROJECT_BRIEF_INVALID` (`apps/cli/src/up.ts:102-108`).
  - `skills migrate`: `SKILLS_MIGRATE_NOTHING`.

  These interim codes are expected until spec 06 lands. The release does not ship between the two. Do not add a stopgap code. A CLI test pins each code with an unchanged folder snapshot.

### 3.8 Init and `up` inside the store

`init plan` and `init apply` with a `--target` inside the store refuse `STORE_NOT_A_PROJECT`. This check stops `up` from creating `~/.bowerloom/.bowerloom`. The check sits in `apps/cli/src/startup.ts`, which `up`'s `initStep` also calls. `build` in discovery refuses the same code for a nested marker (3.4).

`pathInsideStore(path, home, hooks?)` returns true for a path at or below `join(h, '.bowerloom')`. The test covers every `h` from `homesOf(home, hooks)`. It compares by device and inode up the chain. The state of that folder does not matter. For a home with no such folder it returns false. `assertNotInStore(path, home)` calls it and throws `STORE_NOT_A_PROJECT` for a true result.

### 3.9 The first screen

`bowerloom --help` gains one line, after `  bowerloom help <command>   bowerloom help advanced`:

```text
  bowerloom help store       Your store, ~/.bowerloom, and how a project uses it.
```

In `apps/cli/src/human.ts`, add the line to `OUTRO` (lines 33-37), after the `help <command>` line. `SECTIONS` does not change. Spec 05 adds the line `bowerloom help context`. No other spec adds a first-screen line.

In `tests/help-human.test.ts`:

- The constant `short` (lines 20-43) gets the line after the `help <command>` line.
- Line 71, the comment, reads: `// sageadvicellc/bowerloom#80, decision of 2026-10-22: two help lines, store and context, make 26 entries, the last one the empty string after the final newline.`
- Line 72: change the limit `<= 24` to `<= 26`.
- Line 78 does not change.
- Lines 79 and 84: add `'store'` to both help loops.

### 3.10 What is written

This spec writes nothing. Every command here reads only. There is no crash recovery to design.

## 4. Schemas

### 4.1 `store.json` and the store module

The file holds exactly one key. It ends with one newline.

```json
{"format":"bowerloom/store/v1beta1"}
```

- `format`: the exact string `bowerloom/store/v1beta1`.
- Unknown keys, duplicate keys, a byte order mark, text that is not valid UTF-8, and content larger than 4096 bytes all refuse `STORE_INVALID`.
- Spec 04 writes this file. Its serialization is the text above on one line with no spaces, plus `\n`.

New file `packages/project-context/src/store.ts`:

```ts
export const STORE_DIRNAME = '.bowerloom';
export const STORE_FILE = 'store.json';
export const STORE_FORMAT = 'bowerloom/store/v1beta1';
export interface StoreContext {
  readonly dir: string;
  readonly identity: DirectoryIdentity;
  readonly ancestry: readonly PinnedDirectory[];
  readonly fileIdentity: { readonly device: string; readonly inode: string };
}
export type StoreInspection =
  | { state: 'absent'; leftover: boolean }
  | { state: 'foreign' }
  | { state: 'store'; context: StoreContext; leftoverTemp: boolean };
export function storeRootOf(home: string): string
export function inspectStoreWith(home: string, hooks?: DiscoveryHooks): StoreInspection   // throws only STORE_* or USAGE
export function openStoreWith(home: string, hooks?: DiscoveryHooks): StoreContext          // absent: STORE_NOT_FOUND. foreign: STORE_INVALID.
export function isValidStore(home: string, hooks?: DiscoveryHooks): boolean                // true only for state store. Any throw gives false.
export function verifyStorePins(store: StoreContext): void
export function pathInsideStore(path: string, home: string, hooks?: DiscoveryHooks): boolean
export function assertNotInStore(path: string, home: string): void
```

- `verifyStorePins(store)` refuses `STORE_UNSAFE` unless every entry of `ancestry` and `dir` still match by device, inode, and birth time, and each is a real folder. `store.json` must still have `fileIdentity.device` and `fileIdentity.inode`, one hard link, and be a regular file.
- `isValidStore` is not exported from `index.ts`.
- `packages/project-context/src/index.ts` exports `inspectStore(home = homedir())`, `openStore(home = homedir())`, `verifyStorePins`, `pathInsideStore`, `assertNotInStore`, `storeRootOf`, and the types. The `...With` forms and `isValidStore` stay internal, as discovery's hooks do.
- `pinAncestry(dir)`: factor it out of `build` (`discovery.ts:177-180`) and export it for `store.ts`.

Layout of a store (spec 04 writes it):

```text
~/.bowerloom/            mode 0700
  store.json
  skills.json            format bowerloom/skills/v1beta1
  skills/<id>/...
  prompts/<id>.md
  teams/<id>/...
  authoring/receipt.json
  authoring/pending.json     only during a create
```

### 4.2 `bowerloom.json`

```json
{
  "format": "bowerloom/project/v1beta1",
  "harnesses": ["claude", "codex"],
  "skills": [
    { "id": "house-style", "source": "store" },
    { "id": "team-notes", "source": "store", "via": ["research"] },
    { "id": "local-tool", "source": "project" }
  ],
  "prompts": [
    { "id": "weekly-update", "source": "store" }
  ],
  "teams": [
    { "id": "research", "source": "store" },
    { "id": "first-team", "source": "project" }
  ]
}
```

Field rules:

- All five top-level keys are required: `format`, `harnesses`, `skills`, `prompts`, and `teams`. No other key is allowed.
- `format`: the exact string `bowerloom/project/v1beta1`.
- `harnesses`: a list of one or two values. Each value is `claude` or `codex`. The list is sorted in ascending order and has no repeats. When a config exists, it is the target set of `skills sync`. `apply --harness` still overrides it for one run. When a config exists, `skills sync` ignores the `harnesses` key in `skills.json` for targets. That key must still parse.
- `skills`, `prompts`, `teams`: lists of entries. A list can be empty. Each list is sorted by `id` in byte order.
- Entry keys: `id`, `source`, and optionally `via`. No other key is allowed.
- `id`: lower-case letters and digits in words joined by single hyphens, at most 64 characters. The pattern is `^[a-z0-9]+(?:-[a-z0-9]+)*$`. For `source: "store"` the id must also pass the stricter test of its kind. The tests are `isStoreSkillId` (not `personal-assistant`, and no `prompt-` prefix), `isStorePromptId` (at most 57 characters), and `isStoreTeamId` (not `first-team`). They are copies of `isSkillId`, `isPromptId`, and `isTeamId` in `packages/project-authoring/src/state.ts:27-31`. Copy them into `packages/project-config/src/schema.ts` so that `project-config` does not import `project-authoring`. In spec 06 that package imports `project-config`. A cycle breaks the build. A project-sourced entry can use `personal-assistant` or `first-team`.
- `source`: `store` or `project`.
- `via`: only an entry with `source: "store"` has this key. It is a non-empty list of team ids, sorted, with no repeats. Each id must name an entry of `teams` that has `source: "store"`. It means the entry is selected only because of those teams. An entry with no `via` is selected directly.
- No id repeats inside one list. The same id with two sources inside one list refuses `CONFIG_DUPLICATE_ID`. A skill and a prompt can share an id.
- Limits: at most 128 skills, 128 prompts, and 32 teams, or `CONFIG_LIMIT`.
- Size: a file over 1048576 bytes (1 MiB) refuses `CONFIG_UNSAFE` in `build`, in `verifyProjectPins`, and in `readConfig`. A direct call of `parseConfig(bytes)` with more than 1048576 bytes refuses `CONFIG_LIMIT`.
- Reading accepts any whitespace.

Validation order. The first failure decides.

0. The size: more than 1048576 bytes gives `CONFIG_LIMIT`.
1. The top-level keys.
2. `format`.
3. `harnesses`.
4. The list lengths (`CONFIG_LIMIT`).
5. For each entry, in the order `skills`, `prompts`, `teams`: the keys, the id pattern, `source`, the kind test for a store id, and the shape of `via`.
6. The sort order of each list.
7. Duplicates.
8. Membership of each `via` id.

Every failure except 4 and 7 gives `CONFIG_INVALID`. Failure 4 gives `CONFIG_LIMIT`. Failure 7 gives `CONFIG_DUPLICATE_ID`.

The parser mirrors `parseManifest` (`packages/skill-manifest/src/schema.ts:158-166`). It refuses a byte order mark, runs `strictUtf8` (`packages/skill-sources/src/cache.ts:126`) and `strictJson(text, 1048576)` (`packages/codex-adapter/src/safe.ts:19`), then `captureSkillData`. An `AdapterError` or `SkillSourceError` becomes `CONFIG_INVALID`. `strictJson` rejects duplicate keys.

Writing (spec 06) always emits `JSON.stringify(value, null, 2) + '\n'` with the key order above. The writer parses its own output before it writes.

TypeScript types and functions, in `packages/project-config/src/schema.ts` and `config.ts`:

```ts
export const CONFIG_FILE = 'bowerloom.json' as const;
export const CONFIG_FORMAT = 'bowerloom/project/v1beta1' as const;
export const CONFIG_LIMITS = Object.freeze({ bytes: 1048576, skills: 128, prompts: 128, teams: 32, idLength: 64 });
export type ConfigKind = 'skill' | 'prompt' | 'team';
export type ConfigSource = 'store' | 'project';
export interface ConfigEntry { id: string; source: ConfigSource; via?: string[] }
export interface ProjectConfig { format: typeof CONFIG_FORMAT; harnesses: Harness[]; skills: ConfigEntry[]; prompts: ConfigEntry[]; teams: ConfigEntry[] }
export type ConfigRead =
  | { state: 'absent' }
  | { state: 'valid'; config: ProjectConfig; sha256: string; bytes: number }
  | { state: 'invalid'; code: 'CONFIG_INVALID' | 'CONFIG_LIMIT' | 'CONFIG_DUPLICATE_ID'; sha256: string; bytes: number };
export function readConfig(project: ProjectContext): ConfigRead
export function parseConfig(bytes: Buffer): ProjectConfig
export function serializeConfig(config: ProjectConfig): string
```

`Harness` comes from `packages/skill-manifest/src/schema.ts`.

`readConfig(project)` works like this:

1. Call `verifyProjectPins(project)`.
2. Call `checkConfigFile(project.dir)` (4.3). A null result returns `{ state: 'absent' }`.
3. Open the file with `O_RDONLY | O_NONBLOCK | O_NOFOLLOW`. Run `fstat`. If the device or inode differs from the `lstat`, refuse `CONFIG_UNSAFE`. Read at most 1048577 bytes.
4. Call `verifyProjectPins(project)` again.
5. Compute the hash. Parse. A parse failure of the three kinds above returns `{ state: 'invalid', code, sha256, bytes }`.

It throws `CONFIG_UNSAFE` or `PROJECT_UNSAFE` only. The refusal codes `CONFIG_INVALID`, `CONFIG_LIMIT`, and `CONFIG_DUPLICATE_ID` live in `packages/project-config/src/refusal.ts`.

### 4.3 `ProjectContext`, `checkConfigFile`, and `adoptCreatedMarker`

Change `packages/project-context/src/types.ts:21-30`:

```ts
export interface ProjectContext {
  readonly dir: string;
  readonly identity: DirectoryIdentity;
  readonly ancestry: readonly PinnedDirectory[];
  readonly bowerloomIdentity: DirectoryIdentity | null;   // null when there is no .bowerloom folder
  readonly configPresent: boolean;                        // new
  readonly projectId: string;
}
```

The key order of the frozen object is `dir, identity, ancestry, bowerloomIdentity, configPresent, projectId`. The `projectId` does not change. It is still `projectId(dir, identity)`.

`checkConfigFile(dir, uid?)` in `discovery.ts`, exported from `index.ts`, returns `BigIntStats | null`:

- It runs `lstat` on `join(dir, 'bowerloom.json')`.
- `ENOENT` returns null.
- Any other `lstat` error throws `CONFIG_UNSAFE`. So does a file that is not a plain file, or is over 1048576 bytes. A plain file is a regular file, not a link, with `nlink` 1. It is owned by `uid ?? process.getuid()` and has no `& 0o022` mode bits.
- `build`, `verifyProjectPins`, and `readConfig` all use it.

`CONFIG_UNSAFE` lives in `packages/project-context/src/refusal.ts`, with the `STORE_*` codes.

`adoptCreatedMarker(project, marker)` in `discovery.ts`, exported from `index.ts`:

- `marker` is `'folder'` or `'config'`.
- The matching field must be null (`bowerloomIdentity`) or false (`configPresent`). Else refuse `USAGE`.
- It runs `verifyProjectPins` with that one absence check skipped.
- It runs one `lstat` of the new entry with the `build` rules. A bad `.bowerloom` refuses `PROJECT_UNSAFE`. A bad config refuses `CONFIG_UNSAFE`.
- It returns a new frozen context with the same key order and `projectId`, and with `bowerloomIdentity` or `configPresent` set.
- A writer that creates either marker calls it right after and uses the returned context. Spec 06 does this.

### 4.4 `status --json`, format `bowerloom/project-status/v1beta2`

| Field | Type | Meaning |
|---|---|---|
| `format` | string | `bowerloom/project-status/v1beta2` |
| `project` | string | The project folder path |
| `projectId` | string | 32 hex characters |
| `markers` | object | `{ "folder": boolean, "config": boolean }` |
| `setup` | string | `startup` after `inspectStartup`. `none` after `inspectOwnedOnly` or after no inspection. |
| `status` | string | `ready`, `drifted`, or `revision-pending` |
| `specReady` | boolean | As in v1beta1. False for `setup: none`. |
| `runtimeReady` | boolean | Always false |
| `executionAuthorized` | boolean | Always false |
| `revision` | string or null | As in v1beta1. Null for `setup: none`. |
| `drift` | array | As in v1beta1, plus the kind `config-invalid` |
| `owned` | array | As in v1beta1 |
| `legacy` | object | Optional, as in v1beta1 |
| `config` | object or null | Null for a project with no `bowerloom.json`. Otherwise the object below. |

The `config` object in this spec:

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Always `bowerloom.json` |
| `sha256` | string | sha256 of the file bytes, 64 hex characters |
| `bytes` | number | File size |
| `state` | string | `valid` or `invalid` |
| `code` | string or null | `null` for a valid config. Otherwise `CONFIG_INVALID`, `CONFIG_LIMIT`, or `CONFIG_DUPLICATE_ID`. |
| `harnesses` | array | The targets. Empty for an invalid config. |
| `counts` | object | `{ "skills": n, "prompts": n, "teams": n }`. All zero for an invalid config. |

Spec 06 adds the fields `store`, `storeCode`, `items`, `unselected`, and `lock` to this object. In this spec they are absent.

New drift kind. Add `config-invalid` to `Drift.kind` in `packages/startup/src/index.ts:58`. The entry is `{ "path": "bowerloom.json", "kind": "config-invalid", "code": "<CODE>" }`.

A config-only project has these values. `drift` holds only `config-invalid`, and only for an invalid config. `owned` is `[]`. `revision` is null. `specReady` is false. Any drift entry makes `status` `drifted`. A config-only project with a valid config and no drift is `ready`. If `readConfig` returns `absent` while `configPresent` is true, `status` refuses `PROJECT_UNSAFE`.

Text output, in this order:

```text
Project: <dir>
Config: bowerloom.json (<n> skills, <n> prompts, <n> teams)        (only for a project with a config)
Setup: <ready|drifted|revision-pending>                            (for setup none, add " (no startup setup, this project uses bowerloom.json)")
Revision: <revision>                                               (only for a revision that is not null)
  <kind>: <path> (<code>)                                          (one line per drift entry)
  edited: <path>                                                   (as today)
  <kind> <id>: held (<code>). Next: <next>                         (as today)
Workers: none started (this beta starts none)
```

An invalid config prints `Config: bowerloom.json (invalid, <CODE>)`.

### 4.5 `store status --json`, format `bowerloom/store-status/v1beta1`

| Field | Type | Meaning |
|---|---|---|
| `format` | string | `bowerloom/store-status/v1beta1` |
| `state` | string | `absent`, `store`, `foreign`, or `refused` |
| `path` | string | The store path |
| `code` | string or null | The `STORE_*` code for `state: refused`. Otherwise null. |
| `counts` | object or null | `{ "skillFolders": n, "pinnedSkills": n or null, "prompts": n, "teams": n }` for `state: store`. Otherwise null. |
| `leftoverTemps` | number | Count of leftover temporary files. 0 for any other state. |
| `git` | null | Always null in this spec |

### 4.6 `inspectOwnedOnly`

New export in `packages/startup/src/index.ts`:

```ts
export async function inspectOwnedOnly(targetDir: string, owners: readonly OwnerVerifier[]): Promise<{ drift: Drift[]; owned: OwnedEntry[] }>
```

1. It first checks `.bowerloom` with `ownedDirectory(identity(...))`. A failure returns the drift `{ path: '.bowerloom', kind: 'unsafe' }`.
2. It runs the same walk as `inspectStartup` at lines 323-345. Every entry in `.bowerloom` is unaccounted for, so each one goes to the owners. An entry that no owner claims becomes drift `unexpected`.
3. Past 256 entries it stops. It returns the drift `{ path: '.bowerloom', kind: 'unsafe' }`. `inspectStartup` gives the same drift for a throwing `walk` (`index.ts:337,345`).
4. It does not walk into a folder that an owner claimed.
5. It does not read or require the startup receipt.

## 5. Refusal codes

Add each code to the `MESSAGES` object of its package and to `REFUSALS` in `apps/cli/src/human.ts:224`. A message never carries a path. A message names an id only where the table shows `<kind> <id>`. Each row gives the message, the sentence, and the next step.

| Code | Message | Sentence | Next step |
|---|---|---|---|
| `STORE_NOT_FOUND` | There is no store yet. | The first --global create or skills add makes the store. | `bowerloom skill create <name> --global` |
| `STORE_INVALID` | The store folder has no usable store.json. | If ~/.bowerloom holds no store.json that Bowerloom wrote, Bowerloom does not use it and never takes over the folder. | `bowerloom store status` |
| `STORE_UNSAFE` | The store is not safe to use. It must be a real folder that you own, with no write access for others and no link on its path. | Bowerloom will not trust a store that other people or links can change. | `ls -ld ~/.bowerloom` |
| `STORE_UNREADABLE` | Bowerloom cannot read the store or a folder on the way to it. | A folder that cannot be read cannot be checked, so Bowerloom does not use it. | `ls -ld ~ ~/.bowerloom` |
| `STORE_IN_CLOUD_FOLDER` | The store is in a cloud-synced folder. | Cloud sync changes file times and moves files, which breaks the checks that keep the store safe. | Move the home folder setup out of iCloud. The store must stay at ~/.bowerloom. |
| `STORE_NOT_A_PROJECT` | The store holds definitions only, so a folder inside it cannot be a project. | Run this command in a project folder outside ~/.bowerloom. | `cd <project-folder>` |

Amended by #101 (round 1 of its reviews, the maintainer's choice C on #97): the terminal now prints the words of the errors.md row. The sentence of `STORE_NOT_A_PROJECT` is `The store holds definitions only, so a folder inside it cannot be a project.` and its next step is `Run the command in a project folder outside ~/.bowerloom.`
| `CONFIG_INVALID` | bowerloom.json does not match the project config format. | Bowerloom reads bowerloom.json strictly, so a hand edit can break it. | `git diff bowerloom.json` |
| `CONFIG_UNSAFE` | bowerloom.json is not safe to read. It must be a plain file that you own, with one link, no write access for others, and at most 1 MiB. | Bowerloom will not trust a bowerloom.json that other people or links can change. | `ls -l bowerloom.json` |
| `CONFIG_LIMIT` | bowerloom.json lists too many items. | This beta keeps bowerloom.json small: 128 skills, 128 prompts, and 32 teams at most. | `bowerloom status` |
| `CONFIG_DUPLICATE_ID` | `bowerloom.json lists <kind> <id> twice.` Or, for two sources: `bowerloom.json lists <kind> <id> twice: once from store and once from project.` | Each item is listed once, from one source. | `git diff bowerloom.json` |

Update `tests/human-refusal.test.ts` with these ten rows.

The cause of `CONFIG_LIMIT`: the file lists more than 128 skills, 128 prompts, or 32 teams. A direct `parseConfig` of more than 1 MiB also gives it. A file over 1 MiB read from disk gives `CONFIG_UNSAFE`.

Existing codes keep their meaning: `PROJECT_NOT_FOUND`, `PROJECT_ROOT_REFUSED`, `PROJECT_UNSAFE`, `USAGE`.

`CONFIG_INVALID`, `CONFIG_LIMIT`, and `CONFIG_DUPLICATE_ID` raised by `readConfig` become the `code` field of the `config` object. They do not stop `status`. `CONFIG_UNSAFE` stops discovery and so stops every command.

New wording of existing messages:

- `PROJECT_NOT_FOUND` (`packages/project-context/src/refusal.ts:9`): `No Bowerloom project holds this folder. Run the command inside a project folder that has a .bowerloom folder or a bowerloom.json file.`
- `PROJECT_UNSAFE` (`refusal.ts:12`): `The .bowerloom folder or the bowerloom.json file is not safe to use. A .bowerloom folder must be a real folder that you own, with no write access for others. A project folder holds at most one .bowerloom and one bowerloom.json, spelled exactly so.`
- `UP_USAGE` (`apps/cli/src/up.ts:45`): `Use bowerloom up --team <name> [--goal <goal>] [--name <project-name>], with optional --approve <revision> and --json. A folder with no .bowerloom and no bowerloom.json needs --goal.`
- The `initStep` text (`up.ts:78`): `This folder has no .bowerloom and no bowerloom.json yet. Run bowerloom up --team <name> --goal <goal> once to set it up.`
- `TOPICS.up` (`human.ts:96`): the `init` line reads `  init    when no folder above holds .bowerloom or bowerloom.json: sets up this folder. It needs --goal; the project name is the`.
- `TOPICS.status` gains two lines after `'It reads only and writes nothing, and it starts no workers.'`: `'A project with a bowerloom.json also shows its config: the counts, and a config-invalid drift if the file is wrong.'` and `'A project that has only bowerloom.json shows Setup: ready (no startup setup, this project uses bowerloom.json).'`.
- `TOPICS.ls` changes the words `holds .bowerloom` to `holds .bowerloom or bowerloom.json`.

## 6. Where to change

Create:

- `packages/project-context/src/store.ts` (4.1).
- `packages/project-config/src/schema.ts`, `config.ts`, `refusal.ts`, and `index.ts` (4.2). `refusal.ts` holds `CONFIG_INVALID`, `CONFIG_LIMIT`, and `CONFIG_DUPLICATE_ID`.
- `apps/cli/src/store.ts`: `runStoreCommand(args, home, write): Promise<number>`. It handles `status` only (3.6).
- Test files in section 10.

Change:

- `packages/project-context/src/discovery.ts:147-169` (`discoverProjectWith`). At line 162, list `configs = names.filter(n => fold(n) === 'bowerloom.json')` beside `aliases`. Replace the stop check at line 163 and the marker check at line 164 with the rules in 3.4.
- `discovery.ts:171-181` (`build`). Accept `configs`. Order of checks: the aliases, the configs, the `lstat` of `.bowerloom`, the `lstat` of the config. Right after `checkProjectPathWith(dir, ...)`, a true `pathInsideStore(dir, home, hooks)` refuses `STORE_NOT_A_PROJECT`. Refuse `PROJECT_UNSAFE` for `configs.length > 1`, or for one name that is not exactly `bowerloom.json`. If `aliases` is empty, set `bowerloomIdentity` to null and skip the `.bowerloom` pin. Call `checkConfigFile(dir, uid)`. Return the new `configPresent` key.
- Factor `pinAncestry(dir)` out of `build` and export it.
- Add `checkConfigFile` and `adoptCreatedMarker` to `discovery.ts`. Export both from `index.ts`.
- `discovery.ts:187-192` (`verifyProjectPins`). If `project.bowerloomIdentity` is not null, pin `.bowerloom`. If it is null, `.bowerloom` must still be absent. Check the config by `checkConfigFile` only. If `configPresent` is true, it must return a plain file. If `configPresent` is false, it must return null. Do not pin its inode, because spec 06 rewrites it by rename. A `CONFIG_UNSAFE` from `checkConfigFile` passes through unchanged. `PROJECT_UNSAFE` is only for a null result while `configPresent` is true, or a file while `configPresent` is false.
- `packages/project-context/src/types.ts:21-30`: the new `ProjectContext`.
- `packages/project-context/src/index.ts:19-20`: export the names listed in 4.1 and 4.3.
- `packages/project-context/src/refusal.ts:7-17`: add the `STORE_*` messages and `CONFIG_UNSAFE`. Change the `PROJECT_NOT_FOUND` and `PROJECT_UNSAFE` messages (section 5).
- Nullable `bowerloomIdentity` ripples to: `packages/project-sync/src/plan.ts:80,418`, `packages/project-sync/src/apply-project.ts:71,155`, and `packages/project-sync/src/migrate.ts:41,107`. Change each type to `DirectoryIdentity | null` and let the type checker find the rest. The file `packages/startup/src/index.ts:207-215` has a local variable of the same name. It is not a `ProjectContext` field. Leave it.
- `packages/startup/src/index.ts:58`: add the drift kind `config-invalid`. Add `inspectOwnedOnly` after `inspectStartup`.
- `apps/cli/src/project-status.ts:19-23, 26-57`. `runProjectStatus` reads the config with `readConfig`. It builds the `config` object and the drift entry. It chooses the inspection. If `project.bowerloomIdentity === null`, skip every startup inspection and report `setup: none`. If `.bowerloom` exists, `configPresent` is true, and `.bowerloom/installation-receipt.json` is missing (`lstat` returns `ENOENT`), call `inspectOwnedOnly` and report `setup: none`. In every other case call `inspectStartup` as today and report `setup: startup`. A project with `.bowerloom` and no config keeps today's behavior, including drift `invalid-receipt` for a missing receipt. The `planProjectApply` call at line 44 stays in its `try` block.
- `apps/cli/src/ls.ts:32`: `pinnedSkills` reads nothing for `bowerloomIdentity === null`. It returns `[]`.
- `apps/cli/src/startup.ts` (`init plan` and `init apply`, near line 71): call `assertNotInStore(values.get('--target')!, homedir())` before the plan. `up`'s `initStep` reaches it through `runStartupCommand`, so `up.ts` needs no separate call.
- `apps/cli/src/up.ts:45,78`: the new wording (section 5).
- `apps/cli/src/main.ts:132`: add `'store'` to `COMMANDS`. After the `ls` branch at line 145, add a branch for `store` that imports `./store.js` and calls `runStoreCommand`. `help store` and `store --help` reach `TOPICS.store` through the existing `helpText` (`main.ts:121-127`) and the check at line 144.
- `apps/cli/src/human.ts:33-37` (`OUTRO`): add the line of 3.9. Add `TOPICS.store` near line 45. Change `TOPICS.up`, `TOPICS.status`, and `TOPICS.ls` (section 5). Add the refusal words in `REFUSALS` at line 224.
- `package.json:30` (`test`): add `packages/project-config/test/*.test.mjs`. `package.json:53` (`test:project`): add `packages/project-config/test/*.test.mjs`, `packages/startup/test/owned-only.test.mjs`, and `dist/tests/store-foundation-cli.test.js`. The other new files sit in globbed folders.
- Windows is out of scope. The code uses `process.getuid`.

## 7. Edge cases

| Case | Expected result |
|---|---|
| `HOME` is a symbolic link to the real home | `storeRootOf` uses `realpath(home)`. The store is found at the real path. |
| `~/.bowerloom` is a link to another folder | `STORE_UNSAFE`. Discovery at home sees a `.bowerloom` that is not a store and refuses `PROJECT_ROOT_REFUSED` (when no project marker lies below). |
| Erratum after the build, PR #90 | The row above now ends in `STORE_UNSAFE` at home too, not `PROJECT_ROOT_REFUSED`. |
| `~` is a link and the store is real | The store path is built from `realpath(home)`. The state is `store`. |
| The store folder is a link into `~/Library/Mobile Documents` | `STORE_UNSAFE`, because rule 3 fails first. |
| The store is a real folder inside an iCloud folder | `STORE_IN_CLOUD_FOLDER` (rule 4). |
| The account home differs from `HOME` and has a valid store | At that stop discovery returns `PROJECT_NOT_FOUND`. `store status` still reads only the store at `HOME`. |
| The account home has a non-empty `.bowerloom` without `store.json` | `PROJECT_ROOT_REFUSED`. |
| `store.json` has two `format` keys | `STORE_INVALID`. |
| `store.json` is a link | `STORE_UNSAFE`. |
| `store.json` is a FIFO | `STORE_UNSAFE`. The open uses `O_NONBLOCK`, so it does not hang. |
| `store.json` is larger than 4096 bytes | `STORE_INVALID`. |
| A leftover `.store.json.<16 hex>.tmp` beside a valid `store.json` | State `store` with `leftoverTemp: true`. `store status` prints a `Leftover:` line. |
| A project folder inside the store, such as `~/.bowerloom/work`, with its own `.bowerloom` | `STORE_NOT_A_PROJECT` (also for the account home). |
| `init plan --mode existing --target ~/.bowerloom` | `STORE_NOT_A_PROJECT`. |
| `bowerloom.json` is valid JSON with an extra key | `CONFIG_INVALID`. |
| `bowerloom.json` has `"via"` on a project entry | `CONFIG_INVALID`. |
| `bowerloom.json` has a `via` team that is not in `teams`, or is a project team | `CONFIG_INVALID`. |
| `bowerloom.json` has 129 skills | `CONFIG_LIMIT`. |
| `bowerloom.json` is 1048577 bytes | `CONFIG_UNSAFE` from discovery and from `readConfig`. |
| `bowerloom.json` is replaced by a link after discovery | `verifyProjectPins` refuses `CONFIG_UNSAFE`. |
| `bowerloom.json` is deleted after discovery | `verifyProjectPins` refuses `PROJECT_UNSAFE`. |
| `bowerloom.json` is rewritten by rename after discovery | `verifyProjectPins` passes (no inode pin). |
| `.bowerloom` appears after a config-only discovery | `verifyProjectPins` refuses `PROJECT_UNSAFE`, unless the writer called `adoptCreatedMarker`. |
| A config-only project and `status --json` | `markers.folder` false, `markers.config` true, `setup` `none`, `status` `ready`. |
| A project with `.bowerloom` only, started before this change | Same output as beta.2 except the new format and fields. |
| `ls` in a config-only project | Three sections with `none yet`. Exit 0. |
| `store status` with the home folder at mode 0 | State `refused`, code `STORE_UNREADABLE`, exit 0. |

## 8. Migration from beta.2 projects

- A project with `.bowerloom` and no `bowerloom.json` behaves as before. Discovery returns it with `configPresent: false`.
- A machine with no `~/.bowerloom` behaves as before.
- A machine with a non-empty `~/.bowerloom` that has no valid `store.json` behaves as before: `PROJECT_ROOT_REFUSED` for any project search that reaches home.
- An empty `~/.bowerloom` now gives `PROJECT_NOT_FOUND` where it gave `PROJECT_ROOT_REFUSED`.
- `status --json` changes format to `bowerloom/project-status/v1beta2`. Scripts that read `format` must accept it. The fields of v1beta1 keep their names and meanings. New fields are `markers`, `setup`, and `config`.
- A config-only project produces sync and apply plans with `bowerloomIdentity` null under the v1beta1 plan formats, until spec 06 moves them to v1beta2.
- No file on disk changes. No state migrates.

## 9. Docs changes for this track

- `apps/docs/src/content/docs/cli.md:59`: in the sentence "The project is the nearest parent folder that holds `.bowerloom`", add `or bowerloom.json`. Add `bowerloom store status [--json]` to the code block after line 61. Add one paragraph that explains the store and `store status`. The paragraph says the store is always `~/.bowerloom` and that `~` is `$HOME`.
- `cli.md:31`: add `store` to the list of commands that have help of their own.
- `cli.md:71`: the `status` paragraph names the fields `markers`, `setup`, and `config`.
- `apps/docs/src/content/docs/reference/errors.md:27`: the status paragraph lists the v1beta2 fields (`format`, `markers`, `setup`, `config`) and the drift kind `config-invalid`.
- `errors.md:74`: the `PROJECT_ROOT_REFUSED` row reads "A whole disk or home folder is too broad to be a project. It also covers ~/.bowerloom that is not a store, and ~/bowerloom.json."
- `errors.md`: a new table `## Store and config refusals` with one row for each code in section 5.
- `apps/docs/src/content/docs/releases.md`, under `## 0.7.0-beta.3`: "A project can be marked by a file named `bowerloom.json`. `~/.bowerloom` is now your store, and it no longer stops project discovery. `bowerloom store status` shows it. `bowerloom status --json` has a new format, `bowerloom/project-status/v1beta2`."
- Spec 10 owns the page "Where your items come from". Do not write it here.

## 10. Acceptance tests

Write each test first. Every file that makes folders under HOME imports `tests/support/isolate-home.js`. Tests in `.mjs` files import `../../../dist/tests/support/isolate-home.js`.

`packages/project-context/test/store.test.mjs` (import `dist/packages/project-context/src/store.js` directly):

1. An absent store returns state `absent`.
2. A valid store returns state `store` with a pinned context that holds `fileIdentity`.
3. A folder with no `store.json` returns `foreign`, and `openStoreWith` throws `STORE_INVALID`.
4. Each of these `store.json` files throws `STORE_INVALID`: invalid JSON, an unknown key, a duplicate key, a wrong format, a byte order mark, and a size over 4096 bytes.
5. These `store.json` cases throw `STORE_UNSAFE`: a link, two hard links, a FIFO, another owner (use the `uid` hook), and group write permission.
6. A store that is a link throws `STORE_UNSAFE`.
7. A store with group write permission throws `STORE_UNSAFE`.
8. A home given through a symbolic link finds the store at the real path. The state is `store` and `context.dir` is the real path.
9. A store inside an iCloud folder throws `STORE_IN_CLOUD_FOLDER`. The fixture: `hooks.accountHome = <base>/account` and `home = <base>/account/Library/Mobile Documents/h`.
10. A store with mode 0700 and one with mode 0755 both pass.
11. `pathInsideStore` is true for four paths: the store, a folder inside it, a link to a folder inside it, and a path under the account home store. It is false for a sibling and for a home with no store folder.
12. `verifyStorePins` throws `STORE_UNSAFE` after the store folder is replaced.
13. An empty store folder returns `absent` with `leftover: true`. A folder with only a leftover temporary file does the same. A folder with that file and any other name returns `foreign`.
14. A valid `store.json` beside a leftover temporary file returns `store` with `leftoverTemp: true`.
15. The `accountHome` hook differs from `home`. The store at `home` is found. A valid store at the other home is not read by `inspectStore(home)`.
16. A `.Bowerloom` alias throws `STORE_UNSAFE`. The test skips this case on a case-sensitive disk and says so.
17. Two names that fold to `store.json` throw `STORE_UNSAFE`. The test skips this case on a case-sensitive disk and says so.
18. A home folder at mode 0 throws `STORE_UNREADABLE`.
19. `isValidStore` returns false for every throwing case above, and true only for state `store`.
20. `verifyStorePins` throws `STORE_UNSAFE` after `store.json` is replaced by a file of the same bytes with a new inode.
21. `assertNotInStore` throws `STORE_NOT_A_PROJECT` for a path inside the store.
22. Use the fixture of test 9 with no store folder. `inspectStoreWith` throws `STORE_IN_CLOUD_FOLDER`.

`packages/project-context/test/discovery.test.mjs` (add cases, update the key-order assertion at line 37):

1. A home with a valid store gives `PROJECT_NOT_FOUND` for a folder under home.
2. A home with an empty `.bowerloom` (a leftover store) gives `PROJECT_NOT_FOUND`.
3. A home with a non-empty `.bowerloom` that has no `store.json` gives `PROJECT_ROOT_REFUSED`. Change the cases at lines 90 and 221: use `mk(path.join(home, '.bowerloom'))` and then `fs.writeFileSync(path.join(home, '.bowerloom', 'x'), 'x')`.
4. A home with a store whose `store.json` is invalid gives `PROJECT_ROOT_REFUSED`.
5. A `bowerloom.json` at home gives `PROJECT_ROOT_REFUSED`.
6. A folder with only `bowerloom.json` is a project. Its `bowerloomIdentity` is null and its `configPresent` is true.
7. A folder with both has both.
8. The nearest marker wins, in both orders of inner and outer.
9. `Bowerloom.json` gives `PROJECT_UNSAFE`.
10. These configs give `CONFIG_UNSAFE`: a link, a folder, two hard links, group write permission, world write permission, another owner, and a size over 1 MiB.
11. `verifyProjectPins` passes after the config is replaced by rename. It throws `PROJECT_UNSAFE` after the config is deleted, and `CONFIG_UNSAFE` after it is turned into a link.
12. The frozen project object has keys in the order `dir, identity, ancestry, bowerloomIdentity, configPresent, projectId`.
13. `adoptCreatedMarker(project, 'folder')` after the test creates `.bowerloom` in a config-only project returns a context with `bowerloomIdentity` set. `verifyProjectPins` passes on it. The old context fails.
14. `adoptCreatedMarker(project, 'config')` does the same for a project that had only `.bowerloom`. A field that is already set refuses `USAGE`.
15. The walk stops at the account home with a valid store there (hook `accountHome`).
16. A project folder inside the store with its own `.bowerloom` or `bowerloom.json` gives `STORE_NOT_A_PROJECT`, for both homes.
17. A working folder inside the store gives `PROJECT_NOT_FOUND`.

`tests/project-context-contracts.test.ts` (update lines 15-20): the sample project object includes `configPresent` and the key order matches.

`packages/project-authoring/test/id-parity.test.mjs`:

1. `isStoreSkillId`, `isStorePromptId`, and `isStoreTeamId` give the same answer as `isSkillId`, `isPromptId`, and `isTeamId`. The test uses these ids: a valid id, `personal-assistant`, `first-team`, `prompt-x`, ids of 57, 58, 64, and 65 characters, and four bad ids. The bad ids have an upper-case letter, a leading hyphen, a double hyphen, or no characters.

`packages/project-config/test/config.test.mjs`:

1. A full example parses and `serializeConfig` returns the exact bytes defined in 4.2.
2. A parse then a serialize then a parse returns an equal value.
3. Whitespace variants of the same value parse equal.
4. An unknown key, a missing top-level key, a wrong `format`, a duplicate key, a byte order mark, and invalid UTF-8 each give `CONFIG_INVALID`.
5. `harnesses` empty, unsorted, with a repeat, or with `gemini` gives `CONFIG_INVALID`.
6. A list that is not sorted by id gives `CONFIG_INVALID`.
7. A repeated id in one list gives `CONFIG_DUPLICATE_ID` and the message names both entries.
8. The same id with `store` and `project` in one list gives `CONFIG_DUPLICATE_ID` with the two-source message.
9. A skill and a prompt with the same id is valid.
10. Four cases give `CONFIG_INVALID`. Case one: `via` on a project entry. Case two: an empty `via`. Case three: an unsorted `via`. Case four: a `via` team that is not in `teams`, or is a project team.
11. A store skill with the id `personal-assistant` gives `CONFIG_INVALID`. A project skill with that id is valid.
12. A store prompt id of 58 characters gives `CONFIG_INVALID`. 57 characters is valid.
13. 128 skills is valid. 129 gives `CONFIG_LIMIT`. The same for prompts at 128 and teams at 32.
14. `parseConfig` of 1048576 bytes passes the size check. `parseConfig` of 1048577 bytes gives `CONFIG_LIMIT`. `readConfig` and discovery on a 1048577-byte file give `CONFIG_UNSAFE`.
15. For a missing file, `readConfig` returns `absent`. A parse failure returns `invalid` with its code, `sha256`, and `bytes`. The guard failures of 4.3 give `CONFIG_UNSAFE`.
16. The validation order of 4.2: a file with two faults gives the code of the earlier one.

`packages/startup/test/owned-only.test.mjs`:

1. `inspectOwnedOnly` with a fake owner that claims `skills.json` returns that entry as owned.
2. An entry no owner claims becomes drift `unexpected`.
3. A link becomes drift `unsafe`.
4. More than 256 entries returns the drift `{ path: '.bowerloom', kind: 'unsafe' }`.
5. It succeeds for a project with no `installation-receipt.json`.
6. A `.bowerloom` that is not owned by the user returns the drift `unsafe` before any walk.

`tests/store-foundation-cli.test.ts` (spawn the CLI with `HOME` set to a temporary folder):

1. `store status` on a fresh home prints `Store: none yet` and exits 0.
2. `store status --json` on a fresh home prints `state: "absent"`, `counts: null`, `leftoverTemps: 0`, and `git: null`.
3. After the test writes a valid store by hand, `store status` prints `Store: ready` with `Skill folders`, `Pinned skills`, `Prompts`, and `Teams`. The counts ignore a link and a stray file.
4. A store without `store.json` prints `Store: not a store` and exits 0, with `state: "foreign"` in JSON.
5. A store that is a link prints `Store: refused (STORE_UNSAFE)` and exits 0.
6. `store status` writes nothing (compare a folder snapshot, as `tests/ls-status-cli.test.ts:45-49` does).
7. `store frobnicate`, `store`, and `store status --x` exit 2 with `USAGE`.
8. `up --team x --goal g` in a fresh folder under a home that has a valid store reaches the `init` plan and exits 3.
9. `up --team x --goal g` run inside the store refuses `STORE_NOT_A_PROJECT`. So does `init plan --mode existing --target ~/.bowerloom`.
10. `status --json` in a config-only project prints format `bowerloom/project-status/v1beta2`, `markers`, `setup: "none"`, `status: "ready"`, and a `config` object with exactly the keys of 4.4.
11. `status` in a config-only project with an invalid config prints drift `config-invalid` with its code and exits 0.
12. `status --json` in a project with `.bowerloom` and `bowerloom.json` and a receipt keeps `setup: "startup"`.
13. `status` in a project with `.bowerloom`, a config, and no receipt uses `inspectOwnedOnly` and prints `setup: "none"`.
14. `ls` in a config-only project prints exactly `Teams\n  none yet\n\nSkills\n  none yet\n\nPrompts\n  none yet\n`, and `ls --json` has `pinned: []`.
15. `help store` and `store --help` print `TOPICS.store`.
16. `store status` with the home folder at mode 0 prints `Store: refused (STORE_UNREADABLE)` and exits 0.
17. The interim codes of 3.7. Run each command in a config-only folder: `skills add`, `skills check`, `skills sync`, `apply`, `skill create`, `prompt create`, `team create`, `up --team`, and `skills migrate`. Each gives its code, and the folder snapshot stays the same.
18. A leftover temporary file beside a valid `store.json` prints the `Leftover:` line and `leftoverTemps: 1`.

Update existing tests: `tests/ls-status-cli.test.ts` for the status format and project key order, `tests/help-human.test.ts` (3.9), `tests/human-refusal.test.ts` (the ten rows of section 5).

## 11. Build order

1. `packages/project-context/src/store.ts` and its test file. Factor out `pinAncestry`.
2. `checkConfigFile`, the config schema, refusal, and reader, and their test files.
3. `types.ts`, `discovery.ts`, and `adoptCreatedMarker`. Fix the type errors in `plan.ts`, `apply-project.ts`, and `migrate.ts`. Update the discovery tests.
4. `inspectOwnedOnly` in `packages/startup/src/index.ts` and its test file.
5. `apps/cli/src/project-status.ts`, `ls.ts`, `startup.ts`, and `up.ts`.
6. `apps/cli/src/store.ts`, `main.ts`, and `human.ts`.
7. The CLI test file, the updates to existing tests, and the `package.json` globs.
8. Docs: `cli.md`, `errors.md`, `releases.md`.
9. Run `npm run typecheck` and `npm test`. Both must report zero errors.

## 12. Unverified items

1. Case-insensitive aliases (rules 2a and 7). The tests for them need a case-insensitive disk. Run them on macOS first. If the disk is case-sensitive, the tests skip and say so. The code path stays covered by the unit test of the fold function.
2. The state `setup: none` for a project with `.bowerloom`, a config, and no receipt. `inspectStartup` is unchanged. If `tests/startup-cli.test.ts` fails after the change, restore the call path and report the failing case in the pull request.
3. The account home (`os.userInfo().homedir`) can equal `HOME` in a test. The `accountHome` hook exists for this (`discovery.ts:25-27`). If a test cannot make the two differ, use the hook and skip the CLI-level variant.
4. The `FIFO` case (store test 5). Creating a FIFO needs `mkfifo`. If the test machine has no `mkfifo` call, skip the case and say so.
