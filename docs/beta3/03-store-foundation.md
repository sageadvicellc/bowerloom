# 03. Store foundation

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 4. Decisions 1, 2, 2b, 11, and 12. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decision 12 and the defaults: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332752507 and https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332968796.
- Lane: 2.
- Branch: `beta3/03-store-foundation`.
- Depends on: spec 02 (install pins). It changes no file that spec 02 changes.
- Line numbers below are from commit c9730d3. Specs 01 and 02 may move them. Find each place by its function name.

## 2. Problem

Today the folder `~/.bowerloom` cannot exist. Project discovery walks up from the working folder to the home folder. If it finds `.bowerloom` at home, it refuses with `PROJECT_ROOT_REFUSED`. That stops `up` from starting a project anywhere under home. The beta.3 store lives at `~/.bowerloom`. So discovery must learn to tell a store from a project.

A project also needs a marker that is not a folder. Decision 2b says a file named `bowerloom.json` at the project root marks a project, with or without a `.bowerloom` folder. Discovery, `status`, `ls`, and `up` must know this file. The managed engine still needs `.bowerloom/` for its records. Spec 06 creates it at the first install.

This spec builds the foundation only: the store rules, the marker, the reader of `bowerloom.json`, and the report commands. It writes no store and no config. Spec 04 writes the store. Spec 06 writes the config and resolves items.

## 3. Behavior

### 3.1 Terms

- Store: the folder `~/.bowerloom`. It holds definitions of skills, prompts, and teams. It holds no cache and no installed copy.
- Project: a folder that holds `.bowerloom/`, `bowerloom.json`, or both. The nearest such parent folder of the working folder is the project.
- Config: the file `bowerloom.json` at the project root.
- Config-only project: a project with `bowerloom.json` and no `.bowerloom/` folder.

### 3.2 Where the store is

The store path is `join(realpath(home), '.bowerloom')`. The `home` value is the argument the code receives. The CLI passes `os.homedir()`, which follows the `HOME` variable. There is no other setting that moves the store. Tests pass a temporary folder as `home`. CLI tests set `HOME` to a temporary folder.

### 3.3 Store safety rules

Every store command and every discovery check applies these rules in this order. The first rule that fails decides the result.

1. If `home` is not an absolute path or holds a NUL character, refuse `USAGE`.
2. Run `lstat` on the store path. If the entry is missing (`ENOENT` or `ENOTDIR`), the state is `absent`. If `lstat` fails for another reason, refuse `STORE_UNREADABLE`.
3. If the entry is a symbolic link, is not a folder, is owned by another user, or has group or world write permission, refuse `STORE_UNSAFE`. A store folder with mode 0700 passes. A store folder with mode 0755 also passes.
4. Run `checkProjectPathWith(storeRoot, home, hooks)`. Map the codes. `PROJECT_IN_CLOUD_FOLDER` becomes `STORE_IN_CLOUD_FOLDER`. `PROJECT_UNREADABLE` becomes `STORE_UNREADABLE`. Any other `PROJECT_*` code becomes `STORE_UNSAFE`. This catches iCloud folders and links into them.
5. If `realpath(storeRoot)` differs from `storeRoot`, refuse `STORE_UNSAFE`. A link anywhere on the path fails here.
6. List the names in the store folder. If the folder is empty, or holds only names that match `^\.store\.json\.[a-f0-9]{16}\.tmp$`, the state is `absent` and the result carries `leftover: true`. Spec 04 creates the store in two steps, so a crash can leave such a folder. A leftover folder is not a store, so discovery treats it like any `.bowerloom` without `store.json`.
7. Look for `store.json` in the store. If it is missing, the state is `foreign`. The folder exists but is not a store. If it is present but is a link, has more than one hard link, is owned by another user, has group or world write permission, or is larger than 4096 bytes, refuse `STORE_UNSAFE`. If its content is wrong, refuse `STORE_INVALID`. Section 4.1 defines the content.
8. Pin the store folder and every parent folder with their device, inode, and birth time. This is the same pinning that `build()` does for a project.

Two home folders can exist. `HOME` is one. The account home from the user database is the other. The store lives only at `join(realpath(home), '.bowerloom')`. The other home matters only to discovery. See 3.4.

### 3.4 Discovery rules

Discovery walks from the working folder up. At each folder it lists the names. It looks for `.bowerloom` and `bowerloom.json`. It compares names with case folding, as the code does today.

| Case | Result |
|---|---|
| A folder with no marker, no marker above it up to home, and no store at home | `PROJECT_NOT_FOUND` |
| The same, and a valid store at home | `PROJECT_NOT_FOUND` (it was `PROJECT_ROOT_REFUSED`) |
| `.bowerloom` at home with no valid `store.json` | `PROJECT_ROOT_REFUSED` |
| `.bowerloom` at home that is a link, or unsafe, or has a bad `store.json` | `PROJECT_ROOT_REFUSED` |
| `bowerloom.json` at home | `PROJECT_ROOT_REFUSED` |
| `.bowerloom` or `bowerloom.json` at the disk root | `PROJECT_ROOT_REFUSED` |
| A folder with only `bowerloom.json` | A project with `bowerloomIdentity: null` and `configPresent: true` |
| A folder with only `.bowerloom` | A project as today, with `configPresent: false` |
| A folder with both | A project with both |
| An inner folder with only `bowerloom.json` inside an outer folder with `.bowerloom` | The inner folder is the project. The nearest marker wins. |
| `Bowerloom.json` or any other case alias, or two names that fold to the same name | `PROJECT_UNSAFE` |
| `bowerloom.json` that is a folder, a link, has more than one hard link, belongs to another user, has group or world write permission, or is larger than 1 MiB | `CONFIG_UNSAFE` |
| The working folder is inside the store | `PROJECT_NOT_FOUND` (the walk reaches home and the store is valid) |

At a home folder, the store check uses that home folder. The account home may differ from `HOME`. A `.bowerloom` at the account home counts as a store only when `inspectStoreWith(thatHome)` returns `store`. Otherwise discovery refuses `PROJECT_ROOT_REFUSED`.

The home check never throws a `STORE_*` code. A bad store at home is a `PROJECT_ROOT_REFUSED`. Only the store commands report `STORE_*` codes.

### 3.5 The config file is read, never written, in this spec

The reader checks `bowerloom.json` with the rules in 4.2. `status` reports it. No command in this spec writes it.

### 3.6 `bowerloom store status [--json]`

Help text, in `TOPICS.store` in `apps/cli/src/human.ts`:

```text
Usage:
  bowerloom store status [--json]

Shows the state of your store, ~/.bowerloom. The store holds definitions of skills, prompts, and teams.
It holds no cache and no installed copy.
It reads only and writes nothing, and it starts no workers.
The store is always at ~/.bowerloom. Bowerloom refuses a store that is a link, that sits in an iCloud folder,
or that other users can change.
Add --json for one machine-readable object.
```

Output when the store is absent:

```text
Store: none yet
  Create one with bowerloom skill create <name> --global.
```

A leftover folder (rule 6 of 3.3) also prints `Store: none yet`, and its JSON state is `absent`.

Output when the store is valid:

```text
Store: ready
  Path: <store path>
  Skills: <n>
  Prompts: <n>
  Teams: <n>
```

Output when the folder exists without `store.json`:

```text
Store: not a store
  <store path> exists, but it has no store.json. Bowerloom will not use it.
  Move it somewhere else first. Then run bowerloom skill create <name> --global.
```

Output when a safety rule refuses:

```text
Store: refused (<CODE>)
  <fixed message of the code>
```

`store status` exits 0 in every state above. It exits 2 for wrong usage. Counts come from folder names only: the number of `skills/<id>` folders, the number of `prompts/<id>.md` files, and the number of `teams/<id>` folders whose names are valid ids. A link, a stray file, or a name that is not a plain id is not counted. The count limit is 256 entries per folder, the same limit `ls` uses. Over the limit, the count is the number `256` and the line reads `Skills: 256 or more`.

Spec 06 adds a `Git:` line and a `git` object. In this spec the JSON key `git` is always `null` and the text has no `Git:` line.

### 3.7 `bowerloom status` and `bowerloom ls` in a config-only project

- `status` works. Section 4.4 defines the output.
- `ls` works. A missing `.bowerloom/teams`, `.bowerloom/skills`, or `.bowerloom/prompts` folder lists as `none yet`, which is what `entries()` does today when `lstat` fails. Spec 04 changes the `ls` format.
- `up` finds the project, so it never runs the `init` step there. Spec 06 completes the other steps.
- Every other command (`apply`, `skills sync`, `skills check`, `skills add`, the `create` commands) keeps its current behavior. In a config-only project they refuse with the code they already use when `.bowerloom` is missing. Spec 06 completes them. Do not add a stopgap code for this.

### 3.8 `up` inside the store

`bowerloom up --team <name> --goal <goal>` run inside the store or in a folder below it refuses `STORE_NOT_A_PROJECT`. Without this check, `up` would create `~/.bowerloom/.bowerloom`.

### 3.9 What is written

This spec writes nothing. Every command here reads only. There is no crash recovery to design.

## 4. Schemas

### 4.1 `store.json`

The file holds exactly one key. It ends with one newline.

```json
{"format":"bowerloom/store/v1beta1"}
```

- `format`: the exact string `bowerloom/store/v1beta1`.
- Unknown keys, duplicate keys, a byte order mark, text that is not valid UTF-8, and content larger than 4096 bytes all refuse `STORE_INVALID`.
- Spec 04 writes this file. Its serialization is `{"format":"bowerloom/store/v1beta1"}` plus `\n`, on one line, with no spaces.

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

- `format`: the exact string `bowerloom/project/v1beta1`.
- `harnesses`: a list of one or two values. Each value is `claude` or `codex`. The list is sorted in ascending order and has no repeats. It is the set of harnesses that `skills sync` targets when a config exists. `apply --harness` still overrides it for one run. The `harnesses` key in `skills.json` is ignored for targets when a config exists. It must still parse.
- `skills`, `prompts`, `teams`: lists of entries. Each list may be empty. Each list is sorted by `id` in byte order.
- Entry keys: `id`, `source`, and optionally `via`. No other key is allowed.
- `id`: lower-case letters and digits in words joined by single hyphens, at most 64 characters. The pattern is `^[a-z0-9]+(?:-[a-z0-9]+)*$`. For `source: "store"` the id must also pass the stricter test of its kind. The tests are `isStoreSkillId` (not `personal-assistant`, and no `prompt-` prefix), `isStorePromptId` (at most 57 characters), and `isStoreTeamId` (not `first-team`). They are copies of `isSkillId`, `isPromptId`, and `isTeamId` in `packages/project-authoring/src/state.ts:30-33`. Copy them into `packages/project-config/src/schema.ts` so that `project-config` does not import `project-authoring`. That package imports `project-config` in spec 06, and a cycle would break the build. A project-sourced entry may use `personal-assistant` or `first-team`.
- `source`: `store` or `project`.
- `via`: allowed only when `source` is `store`. A non-empty list of team ids, sorted, no repeats, each an id that appears in `teams`. It means the entry is selected only because of those teams. An entry with no `via` is selected directly.
- No id repeats inside one list. The same id with two sources inside one list refuses `CONFIG_DUPLICATE_ID`. A skill and a prompt may share an id.
- Limits: at most 128 skills, 128 prompts, 32 teams. The file is at most 1 MiB (1048576 bytes). Over a limit, refuse `CONFIG_LIMIT`.
- Reading accepts any whitespace. The parser is strict: no byte order mark, valid UTF-8 only, no duplicate keys, no unknown keys. Use `strictJson(text, 1048576)` from `packages/codex-adapter/src/safe.ts:19`, then `captureSkillData` as `packages/skill-manifest/src/schema.ts:164` does.
- Writing (spec 06) always emits `JSON.stringify(value, null, 2) + '\n'` with the key order above. The writer parses its own output before it writes.

TypeScript types, in `packages/project-config/src/schema.ts`:

```ts
export const CONFIG_FILE = 'bowerloom.json' as const;
export const CONFIG_FORMAT = 'bowerloom/project/v1beta1' as const;
export const CONFIG_LIMITS = Object.freeze({ bytes: 1048576, skills: 128, prompts: 128, teams: 32, idLength: 64 });
export type ConfigKind = 'skill' | 'prompt' | 'team';
export type ConfigSource = 'store' | 'project';
export interface ConfigEntry { id: string; source: ConfigSource; via?: string[] }
export interface ProjectConfig { format: typeof CONFIG_FORMAT; harnesses: Harness[]; skills: ConfigEntry[]; prompts: ConfigEntry[]; teams: ConfigEntry[] }
```

### 4.3 `ProjectContext`

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

### 4.4 `status --json`, format `bowerloom/project-status/v1beta2`

Field by field:

| Field | Type | Meaning |
|---|---|---|
| `format` | string | `bowerloom/project-status/v1beta2` |
| `project` | string | The project folder path |
| `projectId` | string | 32 hex characters |
| `markers` | object | `{ "folder": boolean, "config": boolean }` |
| `setup` | string | `startup` when `.bowerloom/installation-receipt.json` exists, `none` otherwise |
| `status` | string | `ready`, `drifted`, or `revision-pending` |
| `specReady` | boolean | As in v1beta1. False when `setup` is `none`. |
| `runtimeReady` | boolean | Always false |
| `executionAuthorized` | boolean | Always false |
| `revision` | string or null | As in v1beta1. Null when `setup` is `none`. |
| `drift` | array | As in v1beta1, plus the kinds below |
| `owned` | array | As in v1beta1 |
| `legacy` | object | Optional, as in v1beta1 |
| `config` | object or null | Null when there is no `bowerloom.json`. Otherwise the object below. |

The `config` object in this spec:

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Always `bowerloom.json` |
| `sha256` | string | sha256 of the file bytes, 64 hex characters |
| `bytes` | number | File size |
| `state` | string | `valid` or `invalid` |
| `code` | string or null | `null` when valid. Otherwise `CONFIG_INVALID`, `CONFIG_LIMIT`, or `CONFIG_DUPLICATE_ID`. |
| `harnesses` | array | The harnesses. Empty when invalid. |
| `counts` | object | `{ "skills": n, "prompts": n, "teams": n }`. All zero when invalid. |

Spec 06 adds the fields `store`, `items`, `unselected`, and `lock` to this object. In this spec they are absent.

New drift kinds. Add them to `Drift.kind` in `packages/startup/src/index.ts:58`:

- `config-invalid`: the config is present and its `state` is `invalid`. The drift entry is `{ "path": "bowerloom.json", "kind": "config-invalid", "code": "<CODE>" }`.
- `config-unsafe`: not used. An unsafe config stops discovery, so `status` never sees it.

The `status` value is `drifted` when any drift entry exists. A config-only project with a valid config and no drift is `ready`.

Text output, in this order:

```text
Project: <dir>
Config: bowerloom.json (<n> skills, <n> prompts, <n> teams)        (only when a config exists)
Setup: <ready|drifted|revision-pending>                            (add " (no startup setup, this project uses bowerloom.json)" when setup is none)
Revision: <revision>                                               (only when not null)
  <kind>: <path> (<code>)                                          (one line per drift entry)
  edited: <path>                                                   (as today)
  <kind> <id>: held (<code>). Next: <next>                         (as today)
Workers: none started (this beta starts none)
```

When the config is invalid, the `Config:` line reads `Config: bowerloom.json (invalid, <CODE>)`.

### 4.5 `store status --json`, format `bowerloom/store-status/v1beta1`

| Field | Type | Meaning |
|---|---|---|
| `format` | string | `bowerloom/store-status/v1beta1` |
| `state` | string | `absent`, `store`, `foreign`, or `refused` |
| `path` | string | The store path |
| `code` | string or null | The `STORE_*` code when `state` is `refused`. Otherwise null. |
| `counts` | object or null | `{ "skills": n, "prompts": n, "teams": n }` when `state` is `store`. Otherwise null. |
| `git` | null | Always null in this spec |

### 4.6 `inspectOwnedOnly`

New export in `packages/startup/src/index.ts`:

```ts
export async function inspectOwnedOnly(targetDir: string, owners: readonly OwnerVerifier[]): Promise<{ drift: Drift[]; owned: OwnedEntry[] }>
```

It runs the same walk as `inspectStartup` at lines 323-345. It treats every entry in `.bowerloom` as unaccounted for, so each one goes to the owners. An entry that no owner claims becomes drift `unexpected`. It stops at 256 entries with `INSPECTION_LIMIT`. It does not read or require the startup receipt.

## 5. Refusal codes

Add each code to the `MESSAGES` object of its package and to `REFUSALS` in `apps/cli/src/human.ts:224`. Messages never carry a path or a name.

| Code | Cause | Next step |
|---|---|---|
| `STORE_NOT_FOUND` | A command needs the store and `~/.bowerloom` does not exist. | `bowerloom skill create <name> --global` |
| `STORE_INVALID` | `~/.bowerloom` exists with no usable `store.json`, or `store.json` has wrong content. | `bowerloom store status` |
| `STORE_UNSAFE` | The store is a link, belongs to another user, can be changed by others, or a path folder is a link. | `ls -ld ~/.bowerloom` |
| `STORE_UNREADABLE` | A folder on the way to the store cannot be read. | `ls -ld ~` |
| `STORE_IN_CLOUD_FOLDER` | The store path is in an iCloud folder or a cloud-synced folder. | Move the home folder setup out of iCloud. The store must stay at `~/.bowerloom`. |
| `STORE_NOT_A_PROJECT` | `up` ran inside the store. | `cd <project-folder>` |
| `CONFIG_INVALID` | `bowerloom.json` has wrong content. | `git diff bowerloom.json` |
| `CONFIG_UNSAFE` | `bowerloom.json` is a link, a folder, shared, or too large. | `ls -l bowerloom.json` |
| `CONFIG_LIMIT` | `bowerloom.json` lists more than 128 skills, 128 prompts, or 32 teams, or is over 1 MiB. | `bowerloom status` |
| `CONFIG_DUPLICATE_ID` | One id is listed twice in one list, or with two sources. The message names both entries. | `git diff bowerloom.json` |

Existing codes keep their meaning: `PROJECT_NOT_FOUND`, `PROJECT_ROOT_REFUSED`, `PROJECT_UNSAFE`, `USAGE`.

`CONFIG_INVALID`, `CONFIG_LIMIT`, and `CONFIG_DUPLICATE_ID` raised by `status` become the `code` field of the `config` object. They do not stop `status`. `CONFIG_UNSAFE` stops discovery and so stops every command.

## 6. Where to change

Create:

- `packages/project-context/src/store.ts`: `STORE_DIRNAME`, `STORE_FILE`, `STORE_FORMAT`, `StoreContext`, `storeRootOf(home)`, `inspectStoreWith(home, hooks)` (returns `{ state: 'absent', leftover: boolean }`, `{ state: 'foreign' }`, or `{ state: 'store', context }`), `openStoreWith(home, hooks)`, `verifyStorePins(store)`, `pathInsideStore(path, home)`, `isValidStore(home, hooks)`. It imports `checkProjectPathWith` and `DiscoveryHooks` from `discovery.ts` and `pinAncestry` (below). `inspectStoreWith` follows 3.3. `openStoreWith` throws `STORE_NOT_FOUND` when absent and `STORE_INVALID` when `foreign`. `pathInsideStore` compares device and inode up the chain, so a link or alias counts.
- `packages/project-config/src/schema.ts`, `packages/project-config/src/config.ts`, `packages/project-config/src/refusal.ts`, `packages/project-config/src/index.ts`. `config.ts` exports `readConfig(project)`, `parseConfig(bytes)`, and `serializeConfig(config)`. `refusal.ts` holds the `CONFIG_*` messages in the style of `packages/project-context/src/refusal.ts:7-17`.
- `apps/cli/src/store.ts`: `runStoreCommand(args, home, write)`. In this spec it handles `status` only. Any other word refuses `USAGE` with `Use bowerloom store status [--json].`
- Test files in section 10.

Change:

- `packages/project-context/src/discovery.ts:147-169` (`discoverProjectWith`). At line 162, list `configs = names.filter(n => fold(n) === 'bowerloom.json')` beside `aliases`. Replace the stop check at line 163 and the marker check at line 164 with the rules in 3.4. At a home stop call `isValidStore(thatHome, hooks)`.
- `discovery.ts:171-181` (`build`). Accept `configs`. Refuse `PROJECT_UNSAFE` when `configs.length > 1` or the one name is not exactly `bowerloom.json`. When `aliases` is empty, set `bowerloomIdentity` to null and skip the `.bowerloom` pin. When a config exists, run `lstat` on it and refuse `CONFIG_UNSAFE` unless it is a regular file with one hard link, owned by the user, without group or world write permission, and at most 1 MiB. Return the new `configPresent` key.
- Factor `pinAncestry(dir)` out of `build` (lines 177-179) and export it for `store.ts`.
- `discovery.ts:187-192` (`verifyProjectPins`). Pin `.bowerloom` only when `project.bowerloomIdentity !== null`. When it is null, `.bowerloom` must still be absent. A folder created by a Bowerloom command in the same process is not this spec's concern, spec 06 handles it. Check the config by `lstat` only: it must be a regular file, not a link, owned by the user, when `configPresent`, and absent when not. Do not pin its inode, because spec 06 rewrites it by rename.
- `packages/project-context/src/types.ts:21-30`. The new `ProjectContext`.
- `packages/project-context/src/index.ts:19-20`. Export `inspectStore`, `openStore`, `verifyStorePins`, `pathInsideStore`, `storeRootOf`, and the types.
- `packages/project-context/src/refusal.ts:7-17`. Add the `STORE_*` messages here. Keep `STORE_NOT_A_PROJECT` here too.
- Nullable `bowerloomIdentity` ripples to: `packages/project-sync/src/plan.ts:80,418`, `packages/project-sync/src/apply-project.ts:71,155`, and `packages/project-sync/src/migrate.ts:41,107`. Change each type to `DirectoryIdentity | null` and let the type checker find the rest. `skills migrate` already refuses with `SKILLS_MIGRATE_NOTHING` when there is no `.bowerloom-skills` folder, which is always true without `.bowerloom`.
- `packages/startup/src/index.ts:58`. Add the drift kind `config-invalid`. Add `inspectOwnedOnly` after `inspectStartup`.
- `apps/cli/src/project-status.ts:19-23, 26-57`. `runProjectStatus` reads the config with `readConfig`. It builds the `config` object and the drift entry. It chooses the inspection: when `project.bowerloomIdentity === null` skip every startup inspection and report `setup: none`. When `.bowerloom` exists, `configPresent` is true, and `.bowerloom/installation-receipt.json` is missing (`lstat` returns `ENOENT`), call `inspectOwnedOnly` and report `setup: none`. In every other case call `inspectStartup` as today. A project with `.bowerloom` and no config keeps today's behavior, including drift `invalid-receipt` for a missing receipt. The `planProjectApply` call at line 44 stays in its `try` block.
- `apps/cli/src/up.ts:79-80` (`initStep`). After `realpathSync(ctx.cwd)`, call `pathInsideStore(target, ctx.home)` and throw `STORE_NOT_A_PROJECT`.
- `apps/cli/src/main.ts:132` (`COMMANDS`). Add `'store'`. After the `ls` branch at line 145, add a branch for `store` that imports `./store.js` and calls `runStoreCommand`. Handle `help store` and `store --help` through `TOPICS.store`.
- `apps/cli/src/human.ts:13-30` (`SECTIONS`). Add the line `bowerloom store status               Show your store, ~/.bowerloom.` under `Start here`. Add `TOPICS.store` near line 45. Add the refusal words in `REFUSALS` at line 224. `tests/help-human.test.ts:20-45` holds the first-screen text and must change with it.
- `package.json:30`. Add `packages/project-config/test/*.test.mjs` to the `test` glob. The existing `packages/project-context/test/*.test.mjs` entry already covers the new store test.

## 7. Edge cases

| Case | Expected result |
|---|---|
| `HOME` is a symbolic link to the real home | `storeRootOf` uses `realpath(home)`. The store is found at the real path. |
| `~/.bowerloom` is a link to another folder | `STORE_UNSAFE`. Discovery at home sees a `.bowerloom` that is not a valid store and refuses `PROJECT_ROOT_REFUSED`. |
| `~` is a link and the store is real | The store path is built from `realpath(home)`. The result is a valid store. |
| The store is inside `~/Library/Mobile Documents` through a link | `STORE_IN_CLOUD_FOLDER` or `STORE_UNSAFE`, by the first rule that fails. |
| The account home differs from `HOME` and has a valid store | At that stop discovery returns `PROJECT_NOT_FOUND`. `store status` still reads only the store at `HOME`. |
| The account home has a `.bowerloom` without `store.json` | `PROJECT_ROOT_REFUSED`. |
| `store.json` has two `format` keys | `STORE_INVALID`. |
| `store.json` is a link | `STORE_UNSAFE`. |
| A project folder inside the store, such as `~/.bowerloom/work` with its own `.bowerloom` | The inner marker is nearest, so discovery returns that project. This is allowed. `up` still refuses to init there (`STORE_NOT_A_PROJECT`). |
| `bowerloom.json` is valid JSON with an extra key | `CONFIG_INVALID`. |
| `bowerloom.json` has `"via"` on a project entry | `CONFIG_INVALID`. |
| `bowerloom.json` has a `via` that names a team not in `teams` | `CONFIG_INVALID`. |
| `bowerloom.json` has 129 skills | `CONFIG_LIMIT`. |
| `bowerloom.json` is replaced by a link after discovery | `verifyProjectPins` refuses `PROJECT_UNSAFE`. |
| `bowerloom.json` is deleted after discovery | `verifyProjectPins` refuses `PROJECT_UNSAFE`. |
| `bowerloom.json` is rewritten by rename after discovery | `verifyProjectPins` passes (no inode pin). |
| A config-only project and `status --json` | `markers.folder` false, `markers.config` true, `setup` `none`, `status` `ready`. |
| A project with `.bowerloom` only, started before this change | Same output as beta.2 except the new format and fields. |
| `ls` in a config-only project | Three sections with `none yet`. Exit 0. |

## 8. Migration from beta.2 projects

- A project with `.bowerloom` and no `bowerloom.json` behaves as before. Discovery returns it with `configPresent: false`.
- A machine with no `~/.bowerloom` behaves as before.
- A machine with `~/.bowerloom` that has no valid `store.json` behaves as before: `PROJECT_ROOT_REFUSED` for any project search that reaches home.
- `status --json` changes format to `bowerloom/project-status/v1beta2`. Scripts that read `format` must accept it. The fields of v1beta1 keep their names and meanings. New fields are `markers`, `setup`, and `config`.
- No file on disk changes. No state migrates.

## 9. Docs changes for this track

- `apps/docs/src/content/docs/cli.md`, section `## Project commands`: add `bowerloom store status [--json]` to the code block. Add one paragraph that explains the store and `store status`. Describe the `status` fields `markers`, `setup`, and `config`. Say that the project is the nearest folder with `.bowerloom` or `bowerloom.json`.
- `apps/docs/src/content/docs/reference/errors.md`: add one row for each code in section 5, in a new table `## Store and config refusals`. Use the same three columns as the other tables.
- The text in `errors.md` that says "the nearest parent folder that holds `.bowerloom`" (and the same words in `cli.md`) must now mention `bowerloom.json`.
- `apps/docs/src/content/docs/releases.md`, under `## 0.7.0-beta.3`: "A project can be marked by a file named `bowerloom.json`. `~/.bowerloom` is now your store, and it no longer stops project discovery. `bowerloom store status` shows it. `bowerloom status --json` has a new format, `bowerloom/project-status/v1beta2`."
- Spec 10 owns the page "Where your items come from". Do not write it here.

## 10. Acceptance tests

Write each test first. Every file that makes folders under HOME imports `tests/support/isolate-home.js` (see `tests/isolate-home.test.ts`).

`packages/project-context/test/store.test.mjs`:

1. An absent store returns state `absent`.
2. A valid store returns state `store` with a pinned context.
3. A folder with no `store.json` returns `foreign`, and `openStore` throws `STORE_INVALID`.
4. A `store.json` with invalid JSON, an unknown key, a duplicate key, a wrong format, a byte order mark, or more than 4096 bytes throws `STORE_INVALID`.
5. A `store.json` that is a link, has two hard links, or is owned by another user (use the `uid` hook) throws `STORE_UNSAFE`.
6. A store that is a link throws `STORE_UNSAFE`.
7. A store with group write permission throws `STORE_UNSAFE`.
8. A store reached through a linked parent folder throws `STORE_UNSAFE`.
9. A store inside an iCloud folder throws `STORE_IN_CLOUD_FOLDER` (reuse the marker fixtures of `discovery.test.mjs`).
10. A store with mode 0700 and one with mode 0755 both pass.
11. `pathInsideStore` is true for the store, a folder inside it, and a link to a folder inside it, and false for a sibling.
12. `verifyStorePins` throws `STORE_UNSAFE` after the store folder is replaced.
13. An empty store folder returns `absent` with `leftover: true`. A folder with only a `.store.json.<16 hex>.tmp` file does the same. A folder with that file and any other name returns `foreign`.
14. The `accountHome` hook differs from `home`. The store at `home` is found. A valid store at the other home is not read by `inspectStore(home)`.

`packages/project-context/test/discovery.test.mjs` (add cases, update the key-order assertion at line 37):

1. A home with a valid store gives `PROJECT_NOT_FOUND` for a folder under home.
2. A home with a `.bowerloom` that has no `store.json` still gives `PROJECT_ROOT_REFUSED` (the existing case at lines 88-91 stays).
3. A home with a store whose `store.json` is invalid gives `PROJECT_ROOT_REFUSED`.
4. A `bowerloom.json` at home gives `PROJECT_ROOT_REFUSED`.
5. A folder with only `bowerloom.json` is a project with `bowerloomIdentity` null and `configPresent` true.
6. A folder with both has both.
7. The nearest marker wins, in both orders of inner and outer.
8. `Bowerloom.json` gives `PROJECT_UNSAFE`.
9. A config that is a link, a folder, has two hard links, is group-writable, or is over 1 MiB gives `CONFIG_UNSAFE`.
10. `verifyProjectPins` passes after the config is replaced by rename, and throws `PROJECT_UNSAFE` after it is deleted or turned into a link.
11. The frozen project object has keys in the order `dir, identity, ancestry, bowerloomIdentity, configPresent, projectId`.
12. The walk stops at the account home with a valid store there (hook `accountHome`).

`packages/project-authoring/test/id-parity.test.mjs`:

1. `isStoreSkillId`, `isStorePromptId`, and `isStoreTeamId` give the same answer as `isSkillId`, `isPromptId`, and `isTeamId` for each id of a list that holds a valid id, `personal-assistant`, `first-team`, `prompt-x`, a 64-character id, a 65-character id, a 57-character id, a 58-character id, an id with an upper-case letter, a leading hyphen, a double hyphen, and the empty string.

`tests/project-context-contracts.test.ts` (update line 15-20): the sample project object includes `configPresent` and the key order matches.

`packages/project-config/test/config.test.mjs`:

1. A full example parses and `serializeConfig` returns the exact bytes defined in 4.2.
2. A parse then a serialize then a parse returns an equal value.
3. Whitespace variants of the same value parse equal.
4. An unknown key, a missing key, a wrong `format`, a duplicate key, a byte order mark, and invalid UTF-8 each give `CONFIG_INVALID`.
5. `harnesses` empty, unsorted, with a repeat, or with `gemini` gives `CONFIG_INVALID`.
6. A list that is not sorted by id gives `CONFIG_INVALID`.
7. A repeated id in one list gives `CONFIG_DUPLICATE_ID` and the message names both entries.
8. The same id with `store` and `project` in one list gives `CONFIG_DUPLICATE_ID`.
9. A skill and a prompt with the same id is valid.
10. `via` on a project entry, an empty `via`, an unsorted `via`, and a `via` team that is not in `teams` each give `CONFIG_INVALID`.
11. A store skill with the id `personal-assistant` gives `CONFIG_INVALID`. A project skill with that id is valid.
12. A store prompt id of 58 characters gives `CONFIG_INVALID`. 57 characters is valid.
13. 128 skills is valid. 129 gives `CONFIG_LIMIT`. The same for prompts at 128 and teams at 32.
14. A file of 1048576 bytes passes the size check. 1048577 gives `CONFIG_LIMIT`.
15. `readConfig` returns `absent` when the file is missing, and the guard failures of 3.4 give `CONFIG_UNSAFE`.

`packages/startup/test/owned-only.test.mjs`:

1. `inspectOwnedOnly` with a fake owner that claims `skills.json` returns that entry as owned.
2. An entry no owner claims becomes drift `unexpected`.
3. A link becomes drift `unsafe`.
4. More than 256 entries throws `INSPECTION_LIMIT`.
5. It succeeds when `installation-receipt.json` is absent.

`tests/store-foundation-cli.test.ts` (spawn the CLI with `HOME` set to a temporary folder):

1. `store status` on a fresh home prints `Store: none yet` and exits 0.
2. `store status --json` on a fresh home prints `state: "absent"`, `counts: null`, `git: null`.
3. After the test writes a valid store by hand, `store status` prints `Store: ready` and the counts. The counts ignore a link and a stray file.
4. A store without `store.json` prints `Store: not a store` and exits 0, with `state: "foreign"` in JSON.
5. A store that is a link prints `Store: refused (STORE_UNSAFE)` and exits 0.
6. `store status` writes nothing (compare a folder snapshot, as `tests/ls-status-cli.test.ts:49-53` does).
7. `store frobnicate` exits 2 with `USAGE`.
8. `up --team x --goal g` in a fresh folder under a home that has a valid store reaches the `init` plan and exits 3.
9. `up --team x --goal g` run inside the store refuses `STORE_NOT_A_PROJECT`.
10. `status --json` in a config-only project prints format `bowerloom/project-status/v1beta2`, `markers`, `setup: "none"`, `status: "ready"`, and a `config` object with exactly the keys of 4.4.
11. `status` in a config-only project with an invalid config prints drift `config-invalid` with its code and exits 0.
12. `status --json` in a project with `.bowerloom` and `bowerloom.json` and a receipt keeps `setup: "startup"`.
13. `status` in a legacy project keeps the beta.2 text and has `config: null` in JSON.
14. `ls` in a config-only project prints three sections with `none yet`.
15. `help store` and `store --help` print `TOPICS.store`.

Update existing tests: `tests/ls-status-cli.test.ts` for the status format and project key order, `tests/help-human.test.ts` for the first screen, `tests/human-refusal.test.ts` for the new codes.

## 11. Build order

1. `packages/project-context/src/store.ts` and its test file. Factor out `pinAncestry`.
2. `packages/project-config` schema, refusal, config reader, and its test file.
3. `types.ts` and `discovery.ts`. Fix the type errors in `plan.ts`, `apply-project.ts`, and `migrate.ts`. Update the discovery tests.
4. `inspectOwnedOnly` in `packages/startup/src/index.ts` and its test file.
5. `apps/cli/src/project-status.ts` and `up.ts`.
6. `apps/cli/src/store.ts`, `main.ts`, `human.ts`.
7. The CLI test file, the updates to existing tests, the `package.json` glob.
8. Docs: `cli.md`, `errors.md`, `releases.md`.
9. Run `npm run typecheck` and `npm test`. Both must report zero errors.

## 12. Unverified items

1. `strictJson` rejects duplicate keys. I read its header at `packages/codex-adapter/src/safe.ts:19-27`, not the whole function. Check it first with a two-key JSON string. If it does not reject duplicates, write a small duplicate-key scan in `packages/project-config/src/config.ts` and run it before `JSON.parse`.
2. The state in `status` for a project with `.bowerloom` and an existing `installation-receipt.json` that is also listed in `bowerloom.json`. I did not read `inspectStartup` for any change it needs. The plan keeps `inspectStartup` unchanged for that case. If `tests/startup-cli.test.ts` fails after the change, restore the call path and report the failing case in the pull request.
3. Whether the explicit `test` glob in `package.json:30` already lists `packages/project-context/test/*.test.mjs`. I read it there. Check that the new `store.test.mjs` runs by adding a failing assertion once. If it does not run, add the missing glob.
4. The exact list of files that fail to type check after `bowerloomIdentity` becomes nullable. I found `plan.ts`, `apply-project.ts`, and `migrate.ts`. If the type checker names another file, make the type nullable there too. Do not add a runtime check that hides a null.
5. The macOS account home (`os.userInfo().homedir`) can equal `HOME` in a test. The `accountHome` hook exists for this (`discovery.ts:25-27`). If a test cannot make the two differ, use the hook and skip the CLI-level variant.
