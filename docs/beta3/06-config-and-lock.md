# 06. Config, resolver, lock, and frozen installs

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 6. Decisions 2b, 3, 4, 5, 9, 12, 13, 16, 17, 19, 20, 22, 23, and 24. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decisions 12 to 15: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332752507. Decisions 16 to 18: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332968796. Decisions 19 and 20: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333018480. Decisions 21 to 24: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333364163.
- Lane: 2.
- Branch: `beta3/06-config-and-lock`.
- Depends on: spec 04 (store writes, manifest targets, authoring scope, `cacheLayout`, `STORE_BRIEF`). Spec 07 (private store token) builds on this spec. Spec 08 builds on it too.
- Line numbers below are from commit c9730d3. Specs 01 to 04 move some of them. Find each place by its function name.
- Spec 01 (team agents) also changes `apply`. If it merged first, keep its agent projection and add the changes below around it. Do not remove it.

## 2. Problem

A project cannot pick items from the store yet. Three things are missing.

First, a project needs a file that lists what it installs. This is `bowerloom.json` (decision 3). The sync and apply planners must read that file and resolve each listed item to its bytes. They must work in a project that has the file and no `.bowerloom/` folder (decision 12).

Second, the store lives on one machine. A teammate who clones the project has no store. So a second file, `bowerloom.lock.json`, records exactly where each store item's bytes come from and a hash that proves them (decision 19). A pinned skill locks to its existing pin. A skill, prompt, or team that someone wrote in the store locks to a commit of the store's git remote. `apply --frozen` installs only what the lock records, as `npm ci` does.

Third, Bowerloom must tell a person when a project cannot be shared. In a shared project, `use` refuses a store item that nobody else can fetch, and says how to make it fetchable (decisions 19 and 22).

This spec also adds `use`, `unuse`, `lock verify`, `lock update`, and `team adopt`. It makes every command work in a project that has only `bowerloom.json`.

## 3. Behavior

### 3.1 Where each item's bytes come from

| Kind of item | Where it is defined | Where its bytes come from | In the lock |
|---|---|---|---|
| Pinned skill, npm or GitHub, in a project | `.bowerloom/skills.json` | The machine cache, filled from the registry or GitHub at the exact pin | No |
| Skill, prompt, or team written in a project | `.bowerloom/` in the repository | The repository | No |
| Pinned skill, npm or GitHub, in the store | `~/.bowerloom/skills.json` | The machine cache, filled the same way | Yes. The whole pin is copied into the lock. |
| Skill, prompt, or team written in the store | `~/.bowerloom/` on this machine | This machine: the live store. Another machine: a public or token-reachable GitHub copy of the store, fetched into the store cache | Yes. The remote, the commit, the path, and a hash. |

The lock never records project items (decision 23). Git versions them.

### 3.2 Two modes

- Legacy mode: the project has no `bowerloom.json`. Every entry of `.bowerloom/skills.json`, every registered prompt, and every created team installs, exactly as in beta.2. The store and the lock are never read. This is the beta.2 migration guarantee.
- Config mode: the project has `bowerloom.json`. Only the items it lists install. An item that the project defines but the config does not list is unselected. It is reported by `ls` and `status` and never installed.

### 3.3 Resolution order in config mode

For each config entry with `source: "project"`, look up the project definition: the entry in `.bowerloom/skills.json`, the item in `.bowerloom/authoring/receipt.json` (prompts and teams), or the folder `.bowerloom/teams/first-team` and `.bowerloom/skills/personal-assistant`. If the definition is missing, the item is held with the code `CONFIG_ITEM_MISSING`. The next step is `Define it with bowerloom <kind> create <id>, or run bowerloom unuse <kind> <id>.`

For each config entry with `source: "store"`, in a normal run (not frozen):

1. If the store is a valid store and holds the item, install from the live store. If a lock exists and its item for this id differs from the live item, the plan carries the note `The lock is out of date for <ids>. Run bowerloom lock update.` The run is not refused.
2. Otherwise, if a lock item exists for this id, install from the lock. A pinned item uses the machine cache. An authored item uses the store cache (3.11).
3. Otherwise, the item is held with the code `STORE_ITEM_MISSING`. The next step is `Create it with bowerloom <kind> create <id> --global, or run bowerloom unuse <kind> <id>.`

In a frozen run, only step 2 applies. The live store is not read.

The store is read only when the config lists at least one store entry. A store that is `foreign`, unsafe, unreadable, or invalid then refuses the whole plan with its `STORE_*` code in a normal run. A store that is absent is not an error. In a frozen run the store is not read at all.

### 3.4 Config-only projects (decisions 12 and 16)

A project with `bowerloom.json` and no `.bowerloom/` folder works with every command. The managed engine keeps its install records in `.bowerloom/managed/`. The first `skills sync` or `apply` that installs anything, and the first `skill create`, `prompt create`, or `team create` in a project, creates `.bowerloom/` with mode 0755. Every file the engine writes there is git-ignored by `.bowerloom/managed/.gitignore`, which holds one line, `*`. So the repository holds only `bowerloom.json`, `bowerloom.lock.json`, and the files the person writes.

The plan shows this as the first line of the review:

```text
Create .bowerloom (records of the copies). Its contents are git-ignored.
```

The plan field is `bowerloomFolder: "create"`. It is `"present"` when the folder exists. Apply creates the folder under the project lock, before any other write, with `mkdir` mode 0755, then checks it is owned by the user and has no group or world write permission, then flushes the project folder. If the folder exists by then, apply refuses `STALE_APPROVAL`.

### 3.5 `bowerloom use`

```text
bowerloom use skill|prompt|team <id> [--project] [--commit <sha>] [--approve <revision>] [--json]
```

Help text, `TOPICS.use`:

```text
Usage:
  bowerloom use skill|prompt|team <id> [--project] [--commit <sha>] [--approve <revision>] [--json]

Picks an item for this project. By default the item comes from your store, ~/.bowerloom.
--project picks an item that this project defines in .bowerloom and that bowerloom.json does not list yet.
bowerloom.json lists everything this project installs. If it is missing, use creates it and lists the items
this project defines now, with the source project.
use team <id> also picks the store skills and prompts that name that team.
In a shared project the item must be fetchable by your team. bowerloom.lock.json records where. See bowerloom help lock.
--commit <sha> records that commit of the store remote instead of the pushed commit of the current branch.
It changes bowerloom.json and bowerloom.lock.json only. Run bowerloom skills sync and bowerloom apply to put the copies in place.
It shows the plan first. Agents pass --approve <revision> or --json.
```

Steps:

1. Find the project (`discoverProject`). Refuse `PROJECT_NOT_FOUND` if none.
2. If `bowerloom.json` is missing, the plan creates it (`created: true`). The new file holds `harnesses` from the project `skills.json`, or `["claude","codex"]` when there is none, and every item the project defines now with `source: "project"`: each entry of `skills.json`, each registered prompt, `first-team` when its folder exists, and each registered team. If any list would pass its limit, refuse `CONFIG_LIMIT`.
3. Without `--project`, the source is the store.
   - Read the store definitions (3.12). If the store is absent, refuse `STORE_NOT_FOUND`. If the item is not defined in the store, refuse `STORE_ITEM_NOT_FOUND`.
   - If the config already lists the id and kind from the store without `via`, refuse `CONFIG_ITEM_SELECTED`.
   - If the config lists it from the store with `via`, the plan removes the `via` key (the item becomes direct) and says `Picks <kind> <id> directly. It was picked through team <team>.`
   - If the config lists it from the project, refuse `CONFIG_DUPLICATE_ID`. The message names both copies.
4. With `--project`, the source is the project.
   - If the project does not define the item, refuse `CONFIG_ITEM_MISSING`.
   - If the config already lists it from the project, refuse `CONFIG_ITEM_SELECTED`.
   - If the config lists it from the store, refuse `CONFIG_DUPLICATE_ID`.
5. `use team <id>` (store) also expands (3.6).
6. In a shared project (3.9), or when a lock exists, compute the lock items for every added store item (3.8). For an authored item this reads the network and needs the store remote (3.10).
7. The plan shows. After approval, apply writes (3.14).

Plan lines, verbatim. Use the first line that fits. `<kind>` is `skill`, `prompt`, or `team`.

```text
Create bowerloom.json and list <n> items this project defines now, with the source project.        (only when created)
Use <kind> <id> from the store
  Source: <source line>
  Teams: <team list, or every team>                                                              (skills and prompts only)
  Cache: held on this machine | not held yet (skills sync fetches it from <host>)               (pinned skills only)
Use <kind> <id> from this project                                                                 (with --project)
bowerloom.json adds: <kind> <id> (<source>)                                                       (one line per added entry, including team expansion)
bowerloom.json: <kind> <id> is now picked directly                                                (when via is removed)
bowerloom.lock.json: adds <kind> <id> (<lock source>)                                             (one line per added lock item)
bowerloom.lock.json: creates it                                                                   (when new)
Network: reads api.github.com, to check the pushed copy of <n> items.                             (only when authored items are locked)
This changes bowerloom.json and bowerloom.lock.json only. Then run bowerloom skills sync and bowerloom apply.
```

`<source line>` is one of: `store skill (written in ~/.bowerloom/skills/<id>)`, `store prompt (written in ~/.bowerloom/prompts/<id>.md)`, `store team (written in ~/.bowerloom/teams/<id>)`, `npm <package>@<version>:<path>`, or `GitHub <owner>/<repo>@<commit>:<path>`.

`<lock source>` is `npm <package>@<version>`, `GitHub <owner>/<repo>@<commit8>`, or `<owner>/<repo> commit <commit8>, hash <hash8>` for an authored item. `<commit8>` and `<hash8>` are the first eight hex characters.

Result of apply (text): `Picked <kind> <id>.` plus `Created bowerloom.json.` and `Updated bowerloom.lock.json.` as they apply. JSON: format `bowerloom/config-change-result/v1beta1`, section 4.8.

### 3.6 Team expansion

`use team <id>` with a store team adds the team to `teams`, then adds:

- every store skill whose own `teams` tag in the store `skills.json` includes `<id>`,
- every store prompt whose `teams` list in the store authoring receipt includes `<id>`.

Each added entry is `source: "store"` with `via: ["<id>"]`. Items with no team tag (they belong to every team) are not added. Rules for an item that is already listed:

- Listed from the store without `via`: leave it as it is. The plan says nothing.
- Listed from the store with `via`: add `<id>` to its `via` list, sorted.
- Listed from the project: refuse `CONFIG_DUPLICATE_ID` for the whole plan. The message names both copies.

`via` names a team id in the `teams` list. The team may be store-sourced or project-sourced.

### 3.7 `bowerloom unuse`

```text
bowerloom unuse skill|prompt|team <id> [--approve <revision>] [--json]
```

Help text, `TOPICS.unuse`:

```text
Usage:
  bowerloom unuse skill|prompt|team <id> [--approve <revision>] [--json]

Removes an item from bowerloom.json and from bowerloom.lock.json. It removes no copy that sync or apply already made.
unuse team <id> also removes the items that were picked only through that team.
It shows the plan first. Agents pass --approve <revision> or --json.
```

Rules:

1. No `bowerloom.json`: refuse `CONFIG_ITEM_NOT_SELECTED`.
2. The item is not listed: refuse `CONFIG_ITEM_NOT_SELECTED`.
3. `unuse skill <id>` and `unuse prompt <id>` remove the entry, whatever its `via`.
4. `unuse team <id>` removes the team entry. It removes `<id>` from the `via` list of every entry. It removes every entry whose `via` list becomes empty. Entries with no `via` stay.
5. The plan removes the matching lock items for every removed store entry.
6. The copies stay. The plan lists the places, using `itemSurfaces` and `promptSurfaces` (`packages/project-sync/src/plan.ts:179`, `prompts.ts:95`).

Plan lines:

```text
Stop using <kind> <id>
bowerloom.json removes: <kind> <id> (<source>)                                  (one line per removed entry)
bowerloom.lock.json removes: <kind> <id>                                        (one line per removed lock item)
Copies stay in <place list>. Bowerloom removes no copy. Delete them yourself if you want them gone.
This changes bowerloom.json and bowerloom.lock.json only.
```

The `Copies stay` line appears only when a copy exists on this machine (a catalog file exists under `.bowerloom/managed/catalog`). For a team it is left out, because a team installs nothing.

After `unuse`, the next sync or apply plan lists the item as `kept` (state `orphaned`), as it does today (`plan.ts:339`, `apps/cli/src/apply.ts:55`).

### 3.8 Create commands in a project with a config

`skill create`, `prompt create`, and `team create` in a project that has `bowerloom.json`:

1. The plan adds the new item to `bowerloom.json` with `source: "project"`. The plan field is `config`, section 4.9. The plan line is `bowerloom.json adds: <kind> <id> (project)`.
2. If the config already lists the same kind and id from the store, refuse `CONFIG_DUPLICATE_ID` at plan time.
3. If the config would pass a limit, refuse `CONFIG_LIMIT`.
4. If `.bowerloom/` is missing, the plan creates it (3.4). The plan field `bowerloomFolder` is `"create"` and `CreatePlan.bowerloom` is null.
5. `team create` in a project with no `brief.json` uses `storeBrief(profile)` (spec 04, 3.5). If `brief.json` exists but is invalid, it still refuses `PROJECT_BRIEF_INVALID`.
6. The apply order is: the item, the `skills.json` entry (skills), `bowerloom.json`, the receipt, then the removal of the pending record. The finish path of an interrupted create repeats the config step when the entry is missing (the same rule that `manifestStep` follows at `packages/project-authoring/src/create.ts:159-170`).
7. A project with no `bowerloom.json` is unchanged. Creating an item never creates `bowerloom.json`.
8. The lock is not touched. The lock holds store items only.

### 3.9 Shared project rule (decision 22)

A project is shared when either test is true:

1. `bowerloom.lock.json` exists in the project folder.
2. The project folder is inside a git work tree whose `.git/config` has a section `[remote "origin"]` with a `url` key.

Detection reads files only and starts no process. Algorithm for test 2:

1. Start at the project folder. Look for an entry named `.git` with `lstat`. Move up one folder at a time. Stop at the home folder or the disk root (the same stops as discovery, `packages/project-context/src/discovery.ts:152`).
2. If the entry is a folder, it is the git folder. If it is a file whose first line is `gitdir: <path>`, treat the path as the git folder only when it is an absolute path or a path relative to the file's folder, and the result is a real folder owned by the user. Otherwise the project is not shared by this test.
3. Read `<git folder>/config` with a limit of 65536 bytes. Refuse nothing when it is unreadable. A project is then not shared by this test.
4. The project is shared if the file has a line `[remote "origin"]` and, before the next section header, a line with the key `url` and a non-empty value. Match the header with `^\s*\[remote\s+"origin"\]\s*$` and the key with `^\s*url\s*=\s*\S+`.

The function is `isSharedProject(project): { shared: boolean; reason: 'lock' | 'origin' | null }` in `packages/project-config/src/shared.ts`.

What the rule changes:

- In a shared project, `use`, `use team`, and `store migrate` (spec 08) check that every store item they add is fetchable by a teammate (3.10). If an item is not, they refuse `STORE_ITEM_NOT_SHAREABLE`. The refusal message says how to give the store a remote.
- In a shared project with store items in the config, `use` and `unuse` write the lock.
- In a project that is not shared and has no lock, `use` writes no lock and needs no network. `status` shows `lock: not-used`.
- Once a lock exists, the project is shared, so the lock is always kept up to date.

A pinned npm or GitHub skill is always fetchable. A project item needs no check.

### 3.10 The git-backed store

The store may be a git repository. Bowerloom never runs git. It reads a few files in `~/.bowerloom/.git` and talks to `api.github.com`.

Reading the store repository (`packages/project-config/src/git.ts`, function `readStoreRepo(storeDir): StoreRepo`):

1. `~/.bowerloom/.git` must be a real folder, not a link, owned by the user. If it is missing, the result is `{ problem: "none" }`. If it is a file or a link, or a folder named `reftable` exists inside it, the result is `{ problem: "unreadable" }`.
2. Read `.git/config` (at most 65536 bytes, regular file). Find the `[remote "origin"]` section and its first `url` value. If there is none, `{ problem: "no-origin" }`.
3. Normalize the URL. Accept exactly these forms, with `<o>` an owner and `<r>` a repository name:
   - `https://github.com/<o>/<r>`, `https://github.com/<o>/<r>.git`, `https://github.com/<o>/<r>/`
   - `git@github.com:<o>/<r>`, `git@github.com:<o>/<r>.git`
   - `ssh://git@github.com/<o>/<r>`, `ssh://git@github.com/<o>/<r>.git`

   The host is compared in lower case. `<o>` matches `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`. `<r>` matches `^[A-Za-z0-9._-]{1,100}$` and is not `.` or `..`. A URL with a user name and password, a port, a query, or a fragment, or any other host, gives `{ problem: "unsupported-remote" }`. The normal form is `https://github.com/<o>/<r>`, the `remote` value.
4. Read `.git/HEAD` (at most 256 bytes). It must be `ref: refs/heads/<branch>` plus a newline. A detached HEAD (a bare commit) gives `{ problem: "unpushed" }` unless `--commit` is given. A branch name matches `^[A-Za-z0-9._/-]{1,200}$` with no `..` and no leading or trailing slash.
5. Find the pushed commit. First look for the file `.git/refs/remotes/origin/<branch>`: 40 lower-case hex characters and a newline. If it is missing, read `.git/packed-refs` (at most 1 MiB) and find the line `<sha> refs/remotes/origin/<branch>`. If neither exists, `{ problem: "unpushed" }`.
6. The head commit is the 40-hex value in `.git/refs/heads/<branch>`, or in `packed-refs` as `refs/heads/<branch>`. If it is missing, it is null.
7. The result is `{ problem: null, remote, branch, head, pushed }`.

`StoreRepo` fields: `problem` (`none`, `no-origin`, `unsupported-remote`, `unreadable`, `unpushed`, or null), `remote`, `branch`, `head` (null possible), and `pushed` (null when the problem is `unpushed` and there is no `--commit`).

The commit a lock records (decision: pushed commit):

- With `--commit <sha>`: that value. It must be 40 lower-case hex characters, else `USAGE`.
- Otherwise `repo.pushed`.
- The commit is never `HEAD`. Only a pushed commit can be fetched.

Proof (the rule for dirty or unpushed changes). Before Bowerloom writes an authored lock item, it proves the item at the commit:

1. Fetch the commit and the tree of the item path from `api.github.com`, with the shared public transport (3.11). Compute the item's file list and `hash`.
2. Read the live store item with the guards and compute its file list and `hash` the same way.
3. If the two `hash` values differ, refuse `LOCK_STORE_NOT_PUSHED`. If the item path does not exist in the tree at the commit, refuse `LOCK_STORE_NOT_PUSHED` too.
4. If the commit request answers HTTP 404, the commit may be unknown or the repository may be private. When the commit came from `--commit`, refuse `LOCK_COMMIT_UNREACHABLE`. When it came from the local `origin/<branch>` ref, refuse `STORE_REMOTE_PRIVATE`, because the ref proves the commit was pushed once.

This one check covers uncommitted edits, committed but unpushed edits, and the wrong branch. Bowerloom does not run `git status`. Unpushed commits that do not change this item do not matter.

Warning (never a refusal): if `repo.head` is not null and differs from `repo.pushed`, the plan carries the line `Your store has commits that are not pushed (HEAD differs from origin/<branch>). The lock records the pushed commit <commit8>.`

If a problem is `none`, `no-origin`, `unsupported-remote`, `unreadable`, or `unpushed` when an authored item must be locked, refuse `STORE_ITEM_NOT_SHAREABLE`. The message adds one sentence:

| Problem | Added sentence |
|---|---|
| `none` | The store is not a git repository. |
| `no-origin` | The store repository has no remote named origin. |
| `unsupported-remote` | The store remote is not a github.com repository. |
| `unreadable` | Bowerloom cannot read the git files of the store. |
| `unpushed` | The store has no pushed commit for this branch. |

The `Next:` text in `REFUSALS` for `STORE_ITEM_NOT_SHAREABLE` reads:

```text
Give the store a remote and push it. bowerloom store status shows the commands. Or copy the item into this project with bowerloom skill create or bowerloom team adopt.
```

Auth. This spec fetches without credentials. A repository that is private, or does not exist, gives HTTP 404, and Bowerloom reports `STORE_REMOTE_PRIVATE`. Spec 07 adds an opt-in token. This spec leaves one hook for it: the public transport factory takes an option `githubAuth: { token: string; repository: string } | null`, and this spec always passes `null`.

Hosts. The plan binds `api.github.com` (the value `HOSTS.git`, `packages/project-sync/src/plan.ts:43`) in `network.hosts` for every plan that reads the network for an authored item. A fetch that the approved plan did not name never starts (the check in `fetchPin`, `packages/project-sync/src/apply.ts:100`).

Offline. `use`, `lock update`, and (spec 08) `store migrate` need the network for authored items. With no network they refuse `SKILLS_OFFLINE` and the next step says `Check the network, then run the command again.` Pinned store skills need no network.

### 3.11 Fetching authored items: the store cache

New module `packages/skill-manifest/src/resolve-store-git.ts` and new module `packages/project-sync/src/store-git.ts`. Both use `createPublicTransport` (`packages/skill-manifest/src/public-get.ts:55`). They do not change `packages/skill-sources/src/git.ts` or `npm.ts`.

Reason (for the pull request, not for the code): `git.ts` accepts only skills with an MIT or Apache license file (`git.ts:70,79,96`) and only the `owner/repo` shape in lower case (`git.ts:69`). A skill from `skill create` has no license. A prompt or team is not a skill. So the new code has its own, narrower policy.

`fetchAuthored(transport, { remote, commit, kind, id }, signal): Promise<AuthoredFetch>` where `AuthoredFetch = { tree: string; files: { path: string; bytes: Buffer }[] }`:

1. `GET https://api.github.com/repos/<o>/<r>/git/commits/<commit>`. At most 524288 bytes (`GIT_LIMITS.metadataBytes`, `git.ts:21`). The JSON `sha` must equal `commit`. Read `tree.sha` as the root tree.
2. The item path is `skills/<id>`, `prompts/<id>.md`, or `teams/<id>`. Split it into segments. For each segment except the last, `GET .../git/trees/<current>` (at most 524288 bytes), parse it with `listing(bytes, current, false)`, prove it with `treeId`, find the entry with that name, require a tree entry with mode `040000`, and move to its sha.
3. For `skills/<id>` and `teams/<id>`, `GET .../git/trees/<current>?recursive=1` and parse with `listing(bytes, current, true)` and `proveRecursive(rows, current)`. For `prompts/<id>.md`, the last segment is a blob entry (mode `100644`) in the `prompts` tree. The item `tree` value is that blob sha.
4. Every row must pass `unsafeKind` (no symlink `120000`, no submodule `160000`, no `commit` type). Every blob must be mode `100644`. Every path must pass `skillFilePath` (extension `md`, `txt`, `json`, `yaml`, `yml`, or `csv`, or a license name). At most 128 files, 65536 bytes each, 2097152 bytes in all (`CONTENT_LIMITS`, `packages/skill-manifest/src/content.ts:~20`). A team also passes this limit.
5. A skill needs `SKILL.md`. A team needs `team.yaml`. A prompt is exactly one file.
6. `GET .../git/blobs/<sha>` for each blob (at most 131072 bytes each). Check each with `blob(bytes, id, size)`. The text must be strict UTF-8 with no byte order mark (`text()` in `content.ts`).
7. Return the files sorted by path in byte order. Paths are relative to the item folder. A prompt has the one path `<id>.md`.

The helpers `listing`, `proveRecursive`, `blob`, `unsafeKind`, and the type `Row` already exist in `packages/skill-manifest/src/resolve-git.ts` (lines 33-70). Add the word `export` before each. Do not change their bodies. All existing tests for `resolve-git.ts` must keep passing.

The inventory and hash of an item:

```ts
rows = files.map(f => ({ path: f.path, sha256: sha256(f.bytes), bytes: f.bytes.length }))   // sorted by path
hash = revisionOf(rows)                                                                      // from packages/skill-sources/src/validation.ts
```

The store cache. Fetched authored bytes go to a content-addressed folder `<stateRoot>/store-cache/<hash>/` (mode 0700). Inside it the item sits as it does in a store: `skills/<id>/...`, `prompts/<id>.md`, or `teams/<id>/...`. Files are mode 0600, owned by the user. It is never inside `~/.bowerloom` (decision 1) and it is not an `op-` operation of the skills cache. Writing it (function `writeStoreCache(root, hash, kind, id, files)`):

1. Take the cache lock, `withCacheLock(cacheRoot, signal, ...)`, where `cacheRoot` is `<stateRoot>/cache` (`packages/project-context/src/index.ts:233`). The lock covers the `store-cache` folder too.
2. If `<store-cache>/<hash>` exists and re-verifies (3 below), return `present`.
3. Verify an existing folder by reading its files with the guards of `readTree` and comparing `revisionOf(rows)` to `<hash>`. A folder that fails the check is moved to `.prune-<hash>-<8 hex>` and replaced.
4. Write the files into a new folder `.tmp-<hash>-<8 hex>` next to the target, flush each file and each folder, then `rename` the folder to `<hash>`, and flush the parent. A crash leaves a `.tmp-` folder. The next write removes any `.tmp-<hash>-*` folder it finds under the lock.
5. Create `<stateRoot>/store-cache` (mode 0700) first if it is missing. Check the folders on the way as `cacheLayout` does (`plan.ts:157`, spec 04).

Reading from it: the managed engine reads an authored item from the store cache through the `store` and `store-prompt` sources (3.12). The `storeDir` value is `<store-cache>/<hash>`.

### 3.12 Engine sources for store items

A store item installs through two new item sources in the managed engine. They read from a directory laid out like a store. That directory is `~/.bowerloom` for the live store, or `<store-cache>/<hash>` for a fetched item.

Changes (exact):

- `packages/managed-skills/src/v2-types.ts:21` (`ItemSource`): add `| { kind: 'store'; path: string; storeDir: string } | { kind: 'store-prompt'; name: string; storeDir: string }`.
- `v2-types.ts:30-32` (`LocalClosure.source`): add `| { kind: 'store'; path: string } | { kind: 'store-prompt'; path: string }`. The closure and the catalog hold no directory.
- `packages/managed-skills/src/local-source.ts:43-46` (`base`) and lines 48 and 65 (`readLocalSkill`, `readLocalPrompt`): add a last parameter `root?: { bowerloom: string; origin: 'project' | 'store' }`. The default is `join(projectDir, '.bowerloom')` and `project`. For `store`, `bowerloom` is `storeDir`. The closure source is `{ kind: 'store', path }` or `{ kind: 'store-prompt', path }` for a store origin.
- `packages/managed-skills/src/v2-observed.ts:47-62` (`requestV2`): accept the two sources. For `store`: `item.kind === 'skill'`, `path === 'skills/' + item.id`, `storeDir` an absolute path. For `store-prompt`: `item.kind === 'prompt'`, `name === item.id`. The key sets are `['kind','path','storeDir']` and `['kind','name','storeDir']`. Add `storeDir` to the `roots` list of the non-nesting check (lines 51 and 60).
- `v2-observed.ts:105-109` (`readClosure`): call `readLocalSkill` or `readLocalPrompt` with the store root for the two new sources.
- `v2-observed.ts:110` (`wrapper`): add a parameter `origin`. For a store prompt the Codex wrapper description reads `Bowerloom prompt <name>, wrapped as a skill for Codex. Edit ~/.bowerloom/prompts/<name>.md, not this file.` For a project prompt it does not change.
- `v2-observed.ts:235-238` (the update check `sameSource`): treat `local` and `store` as one family, and `prompt` and `store-prompt` as one family, when `path` (or `name`) is equal. Every other branch stays.
- `packages/project-sync/src/plan.ts:195-200` (`sameOrigin`): the same family rule for the catalog comparison.
- `packages/project-sync/src/apply.ts:157` (`checkChild`) and `apply.ts:213` (`prepareSkillChildren`): for an item whose origin is store, the source is `{ kind: 'store', path: 'skills/' + id, storeDir }` and the expected closure source is `{ kind: 'store', path }`.
- `packages/project-sync/src/prompts.ts:186-192` (`promptRequest`) and `prompts.ts:196-205` (`checkPromptChild`): the same for prompts.

Do not edit `packages/managed-skills/src/transaction.ts`. `tests/guard-map.test.ts` pins its line numbers.

### 3.13 The lock file

Name and place: `bowerloom.lock.json` in the project folder, next to `bowerloom.json`. Both files are committed. Section 4.1 gives the schema.

Rules for what the lock holds:

- One item for each config entry with `source: "store"` (a skill, a prompt, or a team). Nothing for `source: "project"` (decision 23).
- A pinned store skill (kind `npm` or `git` in the store `skills.json`): the whole store entry, unchanged, in the field `pin`.
- A skill with a `local` entry in the store, a prompt, or a team: the field `authored`.

Agreement with the config: the set of `(kind, id)` pairs in the lock equals the set of `(kind, id)` pairs of config entries with `source: "store"`. The `via` keys and `harnesses` are not compared.

When the lock changes:

- `use` and `unuse` (and `use team`, with its expansion) add and remove lock items when a lock exists, or when the project is shared. They keep every other lock item as it is, so they need no network for items already locked.
- `team adopt` removes the team's lock item.
- `bowerloom lock update` re-resolves items from the live store (3.15).
- `store migrate` (spec 08) adds lock items for items it switches to the store in a shared project.
- `receipt clean` (spec 08) does not touch the lock.
- `skills sync`, `apply`, `up`, `ls`, `status`, `skills check`, and `lock verify` never write the lock.

Self-healing: when `use` or `unuse` runs and a store entry of the config has no lock item (for example after a crash between the two writes, or after a merge), the plan resolves and adds that item too. If it cannot (no network, no store), it refuses and names the item.

The lock without a config: the lock alone marks nothing. If `.bowerloom` exists, `status` reports drift `lock-orphan` (4.6). A frozen run refuses `LOCK_CONFIG_MISSING`. A normal run ignores the lock.

A config without a lock: a normal run works. `status` reports `lock: absent` when the project is shared and the config lists store items, and `lock: not-used` otherwise. A frozen run refuses `LOCK_MISSING`.

Merge conflicts: the file is serialized the same way every time, with one item per id spread over many lines, so branches that change different ids merge cleanly. A real conflict leaves markers (`<<<<<<<`) in the file. It is then not valid JSON, so every reader refuses `LOCK_INVALID` and the next step is the text in 5. The way to settle a conflict: choose one side for each conflicting item, then run `bowerloom lock verify`. If the store is on the machine, `bowerloom lock update` recomputes the items instead.

### 3.14 Write order and crash recovery for `use`, `unuse`, `team adopt`

All three run under `withProjectLock(project.dir)`. The order is:

1. Remove leftover scratch files named `.bowerloom.json.<16 hex>.tmp` and `.bowerloom.lock.json.<16 hex>.tmp` in the project folder (regular files owned by the user). The plan lists them in `scratch`.
2. Create `.bowerloom/` when the plan says so (3.4).
3. (`team adopt` only) copy the team files (3.17).
4. Write `bowerloom.json`.
5. Write `bowerloom.lock.json` (when the plan has a lock change).

Each file is written with the pattern of `applyManifestChange` (`packages/skill-manifest/src/add.ts:170-201`): a temporary file with `O_EXCL | O_NOFOLLOW` mode 0644, flushed, a check that the target still has the planned `before` hash, then `link` for a new file or `rename` for an existing one, then a flush of the folder, then a read back. A read back that does not match gives `CONFIG_WRITE_UNCONFIRMED` for the config or `LOCK_WRITE_UNCONFIRMED` for the lock. A `before` hash that changed gives `STALE_APPROVAL`.

Crash recovery:

- A crash after step 4 and before step 5 leaves a config newer than the lock. The next `use`, `unuse`, or `lock update` heals it (3.13). A frozen run refuses `LOCK_CONFIG_MISMATCH`, which is safe.
- A crash during step 3 follows the pending-record rules of `team adopt` (3.17).
- A leftover temporary file is removed at step 1 of the next run.

### 3.15 `bowerloom lock`

```text
bowerloom lock verify [--json]
bowerloom lock update [--item <kind>:<id>]... [--commit <sha>] [--approve <revision>] [--json]
```

Help text, `TOPICS.lock`:

```text
Usage:
  bowerloom lock verify [--json]
  bowerloom lock update [--item <kind>:<id>]... [--commit <sha>] [--approve <revision>] [--json]

bowerloom.lock.json records where each store item of this project comes from and a hash that proves its bytes.
Commit it with bowerloom.json. A teammate then runs bowerloom apply --frozen to get the same items.
Project items are not in the lock. Git versions them.
lock verify reads only. It checks the file, its hashes, and that it agrees with bowerloom.json. It uses no network.
lock update looks at your store again and rewrites the lock items. Use --item to refresh some. <kind> is skill, prompt, or team.
A pinned skill needs no network. A skill, prompt, or team written in the store is checked against its pushed copy on github.com.
--commit <sha> records that commit of the store remote instead of the pushed commit of the current branch.
```

`lock verify`:

1. Read the lock (4.1 rules). Refuse `LOCK_MISSING`, `LOCK_UNSAFE`, `LOCK_INVALID`, `LOCK_LIMIT` as they apply.
2. Check that each `pin` passes `validateEntry` (`packages/skill-manifest/src/schema.ts:~92`) and that its `id` equals the item `id`.
3. Check that each `authored.hash` equals `revisionOf(authored.files)`.
4. Read the config. If it is missing, refuse `LOCK_CONFIG_MISSING`. If the pairs differ, refuse `LOCK_CONFIG_MISMATCH`.
5. Print `bowerloom.lock.json is valid: <n> items.` and one line per item: `  <kind> <id>  <lock source>`. JSON format `bowerloom/lock-verify/v1beta1`: `{ format, valid: true, sha256, bytes, items: [{ kind, id, from, source: "pin"|"authored", label }] }`. `label` is the `<lock source>` text.

`lock update`:

1. Needs a project with a config. Without it: `CONFIG_ITEM_NOT_SELECTED`. A project with no store items: print `Nothing to lock.` and exit 0.
2. The store must be valid. If it is absent: `STORE_NOT_FOUND`.
3. Select the items: each `--item <kind>:<id>` (it must be a store entry of the config, else `CONFIG_ITEM_NOT_SELECTED`), or all store entries.
4. Re-resolve each selected item from the live store (pinned: copy the store entry. Authored: prove it, 3.10). An item missing from the store refuses `STORE_ITEM_MISSING`.
5. Keep every other lock item. Build the new lock text. Compare with the old.
6. Plan lines:

```text
Update bowerloom.lock.json from your store
  <kind> <id>  unchanged
  <kind> <id>  pin changed: <old> to <new>
  <kind> <id>  commit changed: <commit8> to <commit8>
  <kind> <id>  added
Network: reads api.github.com, to check the pushed copy of <n> items.                  (only when authored items are checked)
This changes bowerloom.lock.json only.
```

If nothing changes, print the plan with `Nothing to change.` and exit 0 without asking. The result format is `bowerloom/lock-update-result/v1beta1`.

Apply: under the project lock, write the lock (3.14 steps 1 and 5). `lock update` creates the lock when it is missing. It is also the way to bring a project that became shared later up to date.

### 3.16 `apply --frozen` and `skills sync --frozen`

```text
bowerloom apply [--harness claude|codex|both] [--frozen] [--approve <revision>] [--json]
bowerloom skills sync [--offline] [--team <team>] [--frozen] [--approve <revision>] [--json]
```

Add to `TOPICS.apply`:

```text
--frozen installs only what bowerloom.lock.json records, as npm ci does. It refuses if the lock file and bowerloom.json
disagree. It ignores your store. It fetches what this machine does not hold yet, from the hosts the plan names.
Plain apply never fetches.
```

Add to `TOPICS.skills` under `skills sync`:

```text
--frozen installs only what bowerloom.lock.json records. It ignores your store and refuses if the lock and bowerloom.json
disagree. It cannot be combined with --offline unless every item is already on this machine.
```

Frozen run, step by step:

1. Needs a config. Without one, refuse `LOCK_CONFIG_MISSING`. A project with a config and no store items works: nothing is locked, and it installs the project items.
2. Read the lock. If the config lists store items and there is no lock file, refuse `LOCK_MISSING`. If the lock exists, apply the rules of `lock verify` without network: `LOCK_INVALID`, `LOCK_UNSAFE`, `LOCK_LIMIT`, `LOCK_CONFIG_MISMATCH`. A lock file with no config refuses `LOCK_CONFIG_MISSING`. This happens before any network call and before any write.
3. Resolve every store item from the lock. Pinned items become ordinary pinned entries. Authored items become items with `resolvedFrom: "lock"`.
4. Plan, with `offline: false`. The plan binds each item's content key (`requestDigest`), each authored item's `lockPin`, and `network.hosts`.
5. Apply: Phase A fetches what is missing. For pinned items it is `fetchPin` (`packages/project-sync/src/apply.ts:97`) with the real acquirer. For authored items it is `fetchStoreGit` (new, same file). Each fetch checks the bound content key and that the host is in the approved list. Each runs under the cache lock for that item only. A fetched authored item whose `hash` differs from the lock refuses `LOCK_HASH_MISMATCH`. A fetched pin that differs refuses `SKILLS_SYNC_CONTENT_MISMATCH` (`apply.ts:115`). A network failure refuses `SKILLS_OFFLINE`. Then phases B and C run as today.
6. Project items install as usual. Holds (drift, a place taken) stay holds.
7. Teams are in the lock but install nothing. Frozen apply does not fetch team bytes.

How the code changes. `apply` stays network-free without `--frozen`:

- `packages/project-sync/src/apply-project.ts:132`: `offline: true` becomes `offline: !frozen`. `ApplyInput` gets `frozen?: boolean`.
- `apply-project.ts:172-175` and `:193`: use the real acquirer (`productionAcquirer`, `packages/project-sync/src/deps.ts`) when `frozen` is true. `NO_FETCH` stays for the other case.
- `ApplyPlan` and `SyncPlan` gain `frozen: boolean` (4.4).
- `apps/cli/src/apply.ts:71`: the line `Network: none. Apply never fetches. A pin that is not cached yet needs bowerloom skills sync first.` stays for a plain apply. For a frozen apply it reads `Network: reads <hosts> for <n> items, without credentials. Frozen apply fetches only what bowerloom.lock.json records.` when something needs fetching, and `Network: none now. Every item is on this machine.` otherwise. Spec 07 changes `without credentials` when a token is used.
- `apps/cli/src/apply.ts:21,88` (`APPLY_USAGE`, `parseHarness`): accept `--frozen` once. Giving it twice refuses `USAGE`.
- `apps/cli/src/sync.ts:~30` (`takeFlags`, `SYNC_USAGE`): accept `--frozen`. `--frozen` with `--offline` is allowed. It refuses with `SKILLS_OFFLINE` at plan time when something needs fetching.
- Plain `apply` and `up` never use `--frozen`. `tests/no-spawn.test.ts` must stay green.

Plain `apply` for an item resolved from the lock but not cached: the item is held with `SKILLS_OFFLINE`, next step `Run bowerloom apply --frozen, or bowerloom skills sync.`

### 3.17 `team adopt`

```text
bowerloom team adopt <id> [--approve <revision>] [--json]
```

Help text, add to `TOPICS.team`:

```text
Usage:
  bowerloom team adopt <id> [--approve <revision>] [--json]

Copies a team from your store into this project, at .bowerloom/teams/<id>, and switches bowerloom.json to the project copy.
The project then owns the copy. Later changes in the store do not reach it. Edit the copy to fit the project.
It shows the plan first.
```

Rules:

1. Needs a config that lists the team `<id>` with `source: "store"`. Else `CONFIG_ITEM_NOT_SELECTED`.
2. `.bowerloom/teams/<id>` must not exist. Else `TEAM_EXISTS`. `first-team` refuses `TEAM_ID_RESERVED`.
3. Source of the bytes: the live store folder `teams/<id>` when the store is valid and holds the team. Otherwise the lock item and the store cache. If the cache lacks it, apply fetches it (hosts bound, as 3.16 step 5). Else `STORE_ITEM_MISSING`.
4. Plan: read the source tree with `readTree` (`packages/project-authoring/src/files.ts:64`). The paths relative to the team folder become the planned files `teams/<id>/<path>`. Compile the source `team.yaml` with `compileCrew(file)` (`packages/crew/src/index.ts:94`) to get `compiledCandidate`.
5. Apply uses the create path with a new input: `CreateInput` `{ kind: 'team', project, name, copyFrom: { root } }`. The plan reads the tree from `copyFrom.root` instead of calling `scaffoldTeam` (`create.ts:245`). `normalizeInput` (`create.ts:83-99`) allows the key `copyFrom` for teams only. The staged copy is compiled again and must give the same `compiledCandidate`, as `applyCreate` already requires.
6. The receipt entry has `teams: []` and the file pins of the copied bytes.
7. Config change: the team entry changes from `source: "store"` to `source: "project"` and loses `via` (a team has none). Entries with `via` that names this team keep it.
8. Lock change: the team's lock item is removed.

Write order: `.bowerloom` if needed, the pending record, the staged files, the move into `.bowerloom/teams/<id>`, `bowerloom.json`, `bowerloom.lock.json`, the receipt, removal of the pending record. A crash after the files move and before the receipt leaves the pending record. The next `team adopt <id>` finds it and finishes it, as `create` does. The finish path repeats the config and lock steps when they are missing. Any other create command refuses `AUTHORING_PENDING` until then.

Plan lines:

```text
Create .bowerloom (records of the copies). Its contents are git-ignored.            (only when missing)
Adopt team <id> from the store
  Copies teams/<id> (<n> files) to .bowerloom/teams/<id>
  Registers it in .bowerloom/authoring/receipt.json
bowerloom.json: team <id> changes from store to project
bowerloom.lock.json: removes team <id>                                              (only when the lock lists it)
Network: reads api.github.com, to fetch the team.                                    (only when the cache lacks it)
The project now owns this copy. Later store changes do not reach it.
```

### 3.18 `sync` and `apply` plans and results

Plan lines and result lines gain a source tag. `itemLine` (`apps/cli/src/sync.ts:42-58`) and `promptLine` (`apps/cli/src/apply.ts:45-58`) append two spaces and `[store]` or `[project]` to the first line of each item. Examples:

```text
  house-style  install pinned npm @tanstack/db-skills@0.0.1:skills/tanstack-db/collections  [store]
  weekly-update  install prompt: .claude/commands/weekly-update.md and .agents/skills/prompt-weekly-update  [store]
  local-tool  up to date  [project]
```

When an item installs from the lock, the line ends `[store, from the lock]`. When an item is held for `STORE_ITEM_MISSING`, the usual `held (<code>)` line shows the tag too.

Other lines:

- The first line of `renderSyncReview` reads `Sync skills for <harnesses>` in config mode (it reads `Sync skills from .bowerloom/skills.json for ...` in legacy mode). The empty case reads `Nothing is selected to sync yet.` in config mode.
- `renderApplyReview` replaces `Nothing in .bowerloom/skills.json or .bowerloom/prompts to apply yet.` with `Nothing is selected to apply yet.` in config mode.
- If a lock exists but disagrees with the live store, add `The lock is out of date for <ids>. Run bowerloom lock update.`
- If the project is shared, has store items, and has no lock, add `This project is shared but has no bowerloom.lock.json. Run bowerloom lock update.`
- In a frozen run, add `Frozen: installing only what bowerloom.lock.json records.`
- The note `Review .bowerloom/prompts/<id>.md` for a prompt notice names `~/.bowerloom/prompts/<id>.md` for a store prompt.
- `SYNC_PLAN_FORMAT` becomes `bowerloom/skills-sync-plan/v1beta2`, `APPLY_PLAN_FORMAT` becomes `bowerloom/project-apply-plan/v1beta2`, `APPLY_RESULT_FORMAT` becomes `bowerloom/project-apply-result/v1beta2`. `SYNC_RESULT_FORMAT` becomes `bowerloom/skills-sync-result/v1beta2` and its entries gain `origin`.

### 3.19 `up`

`up` keeps its steps. Changes:

- `resolveTeam` (`apps/cli/src/up.ts:110-115`) and `firstTeamName` (`:102-108`): with no `.bowerloom/brief.json`, do not call `firstTeamName`. Teams come from the config and the authoring receipt.
- In config mode a team must be listed in the config. If `--team <name>` names a team that is not listed but is defined in the store, refuse `TEAM_NOT_SELECTED` with the next step `bowerloom use team <name>`. If it names a project team that is not listed, refuse `TEAM_NOT_SELECTED` with `bowerloom use team <name> --project`. If it names no team, the `team` step creates a project team (`team create`), which uses `storeBrief` when `brief.json` is missing.
- `up.ts:130` (`readManifestState(project.dir).file !== null`): replace with "the effective skill list is not empty", from the resolver. In config mode the sync step is planned when any selected skill exists.
- `planSync` and `planProjectApply` inputs get `home`.
- On a fresh clone with a lock and no store, the sync step fetches lock-resolved items (it is a sync plan, with hosts bound). `up` prints one note when the lock is missing or disagrees: `bowerloom.lock.json is missing` or `bowerloom.lock.json does not match bowerloom.json`.
- `up` never uses `--frozen`.

### 3.20 `ls`, `status`, and `skills check` in config mode

`ls` (format `bowerloom/ls/v1beta2`, defined in spec 04):

- In config mode, `listedBy` is `config`. The lists come from the config entries, in id order. Each item has `source`, `via`, and `state`: `ok`, `missing` (the definition is not found), or `duplicate` (not produced by a valid config, reserved for the pair named by `CONFIG_DUPLICATE_ID`).
- Add to skills, prompts, and teams: `locked` (boolean or null: null for project items and when there is no lock) and `resolvedFrom` (`store`, `lock`, or `project`).
- `unselected` lists ids that the project defines and the config does not list.
- If the config lists store entries and the store is refused (a `STORE_*` code), `ls` does not refuse. Every store item gets state `missing`, and `ls` prints `The store cannot be used (<CODE>). Run bowerloom store status.` after the sections. The exit code is 0.
- Text output keeps the shape of spec 04. Add `  (missing)` after the source for a missing item. After the sections, when `unselected` is not empty, add `Defined here but not listed in bowerloom.json: <ids>`.
- In legacy mode nothing changes from spec 04, except that `locked` is null and `resolvedFrom` is `project` for every item.

`status` (format `bowerloom/project-status/v1beta2`, spec 03): the `config` object gains:

| Field | Type | Meaning |
|---|---|---|
| `store` | string | `not-needed` (no store entries), `ok` (valid store), `absent`, or `refused` |
| `storeCode` | string or null | The `STORE_*` code when `store` is `refused`. Otherwise null. |
| `items` | array | `{ kind, id, source, via, state }`, state `ok`, `missing`, or `duplicate` |
| `unselected` | object | `{ skills, prompts, teams }`, lists of ids |
| `lock` | object | `{ state, code, sha256, bytes, items, shared }` (4.6) |

New drift kinds: `lock-invalid` (the lock is present and fails reading) and `lock-orphan`. Both go in `Drift.kind` (`packages/startup/src/index.ts:58`).

`skills check` in config mode checks the project `skills.json` (if any) and the store pinned entries that the config selects (offline). Each row ends with `  [store]` or `  [project]`. The format is `bowerloom/skills-manifest-check/v1beta2` with `source` on each skill. With no `skills.json` and no selected store pins in a config project, print `skills.json is valid: 0 skills` instead of refusing `MANIFEST_NOT_FOUND`. In legacy mode `MANIFEST_NOT_FOUND` stays.

### 3.21 `store status` (extends spec 03)

Add a `Git:` block to the text output and fill the `git` object in the JSON.

Text, after `Teams:`:

```text
  Git: none
```

or

```text
  Git: origin github.com/<owner>/<repo>, branch <branch>, HEAD <head8>, pushed <pushed8>
```

or, with a problem:

```text
  Git: <sentence of the problem>
```

When there is a problem or no repository, add the lines:

```text
  To give the store a remote, run these commands yourself:
    cd ~/.bowerloom
    git init
    git add -A
    git commit -m "Store"
    git remote add origin https://github.com/<owner>/<repo>.git
    git push -u origin main
```

JSON `git`: `null` only when the store state is not `store`. Otherwise `{ present: boolean, problem: string|null, remote: string|null, branch: string|null, head: string|null, pushed: string|null, ahead: "unknown"|"yes"|"no" }`. `ahead` is `no` when `head === pushed`, `yes` when both are set and differ, `unknown` otherwise.

### 3.22 Concurrency and locks

- Project writes: `withProjectLock(project.dir)`.
- Store writes: `withStoreForWrite` (spec 04).
- Readers take no lock. Guarded reads and bound hashes detect change: `STALE_APPROVAL` for a plan, `SKILLS_SYNC_CONTENT_MISMATCH` for bytes.
- Cache lock (`withCacheLock`): innermost. It is never held while waiting for a project lock or a store lock.
- Only `store migrate` (spec 08) holds both a store lock and a project lock. It takes the store lock first.
- `lock update` and `use` read the store without a store lock and write only the project.

## 4. Schemas

### 4.1 `bowerloom.lock.json`

```json
{
  "format": "bowerloom/lock/v1beta1",
  "skills": [
    {
      "id": "tanstack-db",
      "from": "store",
      "pin": { "id": "tanstack-db", "source": { "kind": "npm", "...": "a skills.json entry" }, "...": "..." }
    },
    {
      "id": "house-style",
      "from": "store",
      "authored": {
        "remote": "https://github.com/sageadvicellc/store",
        "commit": "0123456789abcdef0123456789abcdef01234567",
        "path": "skills/house-style",
        "tree": "89abcdef0123456789abcdef0123456789abcdef",
        "files": [ { "path": "SKILL.md", "sha256": "<64 hex>", "bytes": 412 } ],
        "hash": "<64 hex>",
        "teams": ["research"]
      }
    }
  ],
  "prompts": [
    { "id": "weekly-update", "from": "store", "authored": { "remote": "...", "commit": "...", "path": "prompts/weekly-update.md", "tree": "...", "files": [ { "path": "weekly-update.md", "sha256": "...", "bytes": 120 } ], "hash": "..." } }
  ],
  "teams": [
    { "id": "research", "from": "store", "authored": { "remote": "...", "commit": "...", "path": "teams/research", "tree": "...", "files": [ ], "hash": "..." } }
  ]
}
```

(The `...` marks and the empty `files` list are shortcuts in this example only. A real file holds full values and at least one file per item.)

Field rules:

- `format`: exactly `bowerloom/lock/v1beta1`.
- `skills`, `prompts`, `teams`: lists, each sorted by `id` in byte order, one item per `id`. Limits: 128, 128, 32. Over a limit, `LOCK_LIMIT`.
- Item keys: `id`, `from`, and exactly one of `pin` or `authored`. No other key. `pin` is allowed in `skills` only.
- `id`: the same id rules as the config for a store entry (spec 03, 4.2).
- `from`: the exact string `store`.
- `pin`: a complete `skills.json` entry of kind `npm` or `git`. It is validated by `validateEntry` (`packages/skill-manifest/src/schema.ts:~92`), and its `id` equals the item `id`. It carries its own `teams` tag and its own integrity: `integrity` (npm) or `tree` and `pathTrees` (git), `metadataSha256`, and the `sha256` of each file (`schema.ts:26-28`). The cache key derives from it with `entryRequest(entry).digest` (`packages/project-sync/src/cache-index.ts:55`). The lock stores no key.
- `authored.remote`: `https://github.com/<owner>/<repo>`, the normal form of 3.10. No `.git`, no credentials, no port.
- `authored.commit`: 40 lower-case hex characters.
- `authored.path`: `skills/<id>`, `prompts/<id>.md`, or `teams/<id>`, with the same `<id>` as the item. It is relative to the repository root. The store folder is the repository root.
- `authored.tree`: 40 lower-case hex characters, the git object id at `path` in `commit` (a tree for a folder, a blob for a prompt).
- `authored.files`: a sorted list of `{ path, sha256, bytes }`. `path` is relative to the item folder (for a prompt, `<id>.md`). Sorted by `path` in byte order. At least 1 and at most 128 rows. `bytes` is at most 65536 per file and 2097152 in all. `sha256` is 64 lower-case hex characters.
- `authored.hash`: 64 hex characters. It must equal `revisionOf(files)`. A different value gives `LOCK_INVALID`.
- `authored.teams`: optional. A sorted list of team ids. It is the item's team tag in the store. It is not allowed on a team item. Missing means every team.
- The file is at most 4 MiB (4194304 bytes). Over that, `LOCK_LIMIT`.

Parsing uses `strictJson(text, 4194304)` (`packages/codex-adapter/src/safe.ts:19`), then `captureSkillData`, as `parseManifest` does (`schema.ts:158-165`). No byte order mark, valid UTF-8, no duplicate keys, no unknown keys. Any failure is `LOCK_INVALID`, except size, which is `LOCK_LIMIT`, and an unsafe file, which is `LOCK_UNSAFE`.

Reading the file uses the same guards as the config reader (spec 03, 4.2): a regular file, not a link, one hard link, owned by the user, no group or world write, at most 4 MiB, opened with `O_NOFOLLOW`, size checked after the read. Any guard failure is `LOCK_UNSAFE`.

Writing: `JSON.stringify(value, null, 2) + '\n'`, keys in the order shown, lists sorted. The writer parses its own output before it writes.

TypeScript types (`packages/project-config/src/lock.ts`):

```ts
export const LOCK_FILE = 'bowerloom.lock.json' as const;
export const LOCK_FORMAT = 'bowerloom/lock/v1beta1' as const;
export const LOCK_LIMITS = Object.freeze({ bytes: 4194304, skills: 128, prompts: 128, teams: 32, files: 128, fileBytes: 65536, totalBytes: 2097152 });
export type { AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';   // the type is defined there, in this shape:
// interface AuthoredPin { remote: string; commit: string; path: string; tree: string; files: { path: string; sha256: string; bytes: number }[]; hash: string; teams?: string[] }
export type LockItem = { id: string; from: 'store'; pin: PinnedEntry } | { id: string; from: 'store'; authored: AuthoredPin };
export interface ProjectLock { format: typeof LOCK_FORMAT; skills: LockItem[]; prompts: LockItem[]; teams: LockItem[] }
export function readLock(project: ProjectContext): { state: 'absent' } | { state: 'present'; lock: ProjectLock; sha256: string; bytes: number }
export function parseLock(bytes: Buffer): ProjectLock
export function serializeLock(lock: ProjectLock): string
export function lockAgrees(lock: ProjectLock, config: ProjectConfig): { agrees: boolean; added: string[]; removed: string[] }   // lists of "<kind> <id>"
```

### 4.2 Relation to `skills.json` and the cache

- A lock `pin` is a `skills.json` entry. The same validation and the same cache key apply. A project that installs a store pin from the lock gets the same cache entry as a project that pinned it in its own `skills.json`.
- An authored item has its own cache, `store-cache`, keyed by `authored.hash`.
- The lock never changes `skills.json`.

### 4.3 The resolver (`packages/project-sync/src/resolve.ts`)

```ts
export interface StoreView { state: 'not-needed' | 'absent' | 'present'; context: StoreContext | null;
  skills: { manifest: Manifest; sha256: string; bytes: number } | null; authoring: { items: AuthoredItem[]; sha256: string | null } | null }
export interface ResolvedItem { kind: 'skill' | 'prompt' | 'team'; id: string; origin: 'store' | 'project'; via: string[];
  resolvedFrom: 'store' | 'lock' | 'project'; entry: Entry | null; teams: string[]; lockPin: AuthoredPin | null;
  hold: { code: string; next: string } | null }
export interface Resolved { mode: 'config' | 'legacy'; frozen: boolean; config: { sha256: string; bytes: number } | null;
  lock: { state: LockState; sha256: string | null; bytes: number | null; code: string | null } ;
  harnesses: Harness[]; manifest: Manifest | null; projectManifest: { sha256: string; bytes: number } | null;
  skills: ResolvedItem[]; prompts: ResolvedItem[]; teams: ResolvedItem[]; store: StoreView;
  unselected: { skills: string[]; prompts: string[]; teams: string[] }; notes: string[] }
export function resolveProject(input: { project: ProjectContext; home: string; frozen: boolean }): Resolved
```

- `mode` is `legacy` when `configPresent` is false.
- `manifest` is the effective manifest for the planner: `{ format: MANIFEST_FORMAT, harnesses, skills: [selected entries] }`, entries sorted by id. For a store local skill the entry is `{ id, teams?, source: { kind: 'local', path: 'skills/<id>' } }`. An entry's `teams` tag is the tag it has in its own definition.
- `LockState` is `not-used`, `absent`, `valid`, `stale`, `invalid`, `mismatch`, or `orphan`.
- `notes` holds the lines of 3.18 about a stale or missing lock.
- A held item has `entry: null` and a `hold`.

### 4.4 Sync plan and apply plan, version `v1beta2`

Add these to `SyncPlan` (`packages/project-sync/src/plan.ts:78-93`) and `ApplyPlan` (`apply-project.ts:69-82`):

- `project.bowerloomIdentity`: `DirectoryIdentity | null`.
- `bowerloomFolder`: `"present"` or `"create"`.
- `frozen`: boolean.
- `config`: `{ sha256: string; bytes: number } | null`.
- `lock`: `{ sha256: string; bytes: number } | null`.
- `store`: `{ dir: string; identity: DirectoryIdentity; skills: { sha256: string; bytes: number } | null; authoring: { sha256: string; bytes: number } | null } | null`. Null in legacy mode, in frozen mode, and when no selected item comes from the live store.
- `privateState.storeCacheRoot`: string.
- `SyncItem` gains `origin: 'store' | 'project' | null` (null for an orphan), `via: string[]`, `resolvedFrom: 'store' | 'lock' | 'project'`, and `lockPin: AuthoredPin | null`. For an authored item, `requestDigest` is its `hash`.
- `StateLayout` (`plan.ts:142`) gains `storeCacheRoot = join(stateRoot, 'store-cache')`. It is created like `cacheRoot` (`plan.ts:411`), only when an authored item needs fetching. It is a shared folder, bound by path only (`bindPrivateState`, `plan.ts:353-355`).
- `PromptItem` (`prompts.ts:64-82`) gains `origin`, `via`, `resolvedFrom`, `lockPin`.
- The revision binds every field above. `syncBinding` (`plan.ts:361-366`) keeps dropping what another run may change: `state: cached`, `cacheOperationId`, `cache`, `network.required`. It also drops whether the store cache holds an authored item now. It keeps the `hash`.
- `network.hosts` is computed from the kinds of items that install or update (`plan.ts:415`) plus `api.github.com` for authored items that need fetching. `--offline` approves no host.
- `SYNC_ITEM_LIMIT` stays 256 (`plan.ts:42`).

### 4.5 Config-change plan and result

```ts
export const CONFIG_CHANGE_FORMAT = 'bowerloom/config-change-plan/v1beta1';
export const CONFIG_CHANGE_RESULT_FORMAT = 'bowerloom/config-change-result/v1beta1';
export interface ConfigChangePlan {
  format: typeof CONFIG_CHANGE_FORMAT;
  project: { dir: string; identity: DirectoryIdentity; ancestry: readonly PinnedDirectory[]; bowerloomIdentity: DirectoryIdentity | null };
  change: { op: 'use' | 'unuse' | 'adopt'; kind: 'skill' | 'prompt' | 'team'; id: string; source: 'store' | 'project' };
  created: boolean;
  bowerloomFolder: 'present' | 'create';
  adds: { kind: string; id: string; source: string; via: string[] }[];
  removes: { kind: string; id: string; source: string }[];
  config: { before: { sha256: string; bytes: number } | null; after: { sha256: string; bytes: number }; text: string };
  lock: { before: { sha256: string; bytes: number } | null; after: { sha256: string; bytes: number }; text: string; adds: string[]; removes: string[] } | null;
  scratch: string[];
  store: { dir: string; identity: DirectoryIdentity; skills: { sha256: string; bytes: number } | null; authoring: { sha256: string; bytes: number } | null } | null;
  projectManifest: { sha256: string; bytes: number } | null;
  network: { hosts: string[] };
  notes: string[];
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface ConfigChangeResult { format: typeof CONFIG_CHANGE_RESULT_FORMAT; planRevision: string; change: ConfigChangePlan['change']; created: boolean; configSha256: string; configBytes: number; lockSha256: string | null; lockBytes: number | null; executionAuthorized: false }
```

The revision is `sha256(canonicalJson(body))` where body is the plan without `revision`. `canonicalJson` is in `packages/contracts/src/index.ts:137`.

### 4.6 Status additions

`config.lock`:

| Field | Type | Meaning |
|---|---|---|
| `state` | string | `not-used`, `absent`, `valid`, `stale`, `invalid`, `mismatch`, `orphan` |
| `code` | string or null | The `LOCK_*` code when `invalid` or `mismatch` |
| `sha256`, `bytes` | string or null, number or null | Of the lock file |
| `items` | number | Number of lock items |
| `shared` | boolean | The result of `isSharedProject` |

State rules:

- `not-used`: no lock file, and the project is not shared or has no store entries.
- `absent`: no lock file, the project is shared, and the config lists store entries.
- `valid`: the lock reads, agrees with the config, and every authored item equals the live store item (or the store is absent).
- `stale`: the lock agrees with the config but a live store item differs from its lock item.
- `invalid`: the lock fails reading. `code` is set.
- `mismatch`: the lock reads but its pairs differ from the config. `code` is `LOCK_CONFIG_MISMATCH`.
- `orphan`: a lock file and no config.

The `stale` test reads the live store item and compares `hash` for authored items, and compares the entry for pinned items. It uses no network.

### 4.7 Engine sources

See 3.12 for the exact types.

### 4.8 Result formats

- `bowerloom/config-change-result/v1beta1`: section 4.5.
- `bowerloom/lock-verify/v1beta1`: section 3.15.
- `bowerloom/lock-update-result/v1beta1`: `{ format, planRevision, updated: [{ kind, id, change: "added"|"pin"|"commit"|"unchanged" }], sha256, bytes, executionAuthorized: false }`.
- `bowerloom/project-apply-result/v1beta2` and `bowerloom/skills-sync-result/v1beta2`: as v1beta1 plus `origin` and `resolvedFrom` on each applied, held, and up-to-date entry.

### 4.9 Create plan

`CreatePlan` (`packages/project-authoring/src/create.ts:40-73`) gains:

- `bowerloomFolder: 'present' | 'create'`,
- `config: { before: Read | null; after: Read; text: string } | null` (null when the project has no config),
- `reads.config: Read | null`.

`CreatePlan.bowerloom` is `{ device, inode } | null` (null when `bowerloomFolder` is `create` or the scope is the store).

## 5. Refusal codes

All messages are fixed and carry no path or name. A message may add the checked ids named in the table.

| Code | Cause | Next step |
|---|---|---|
| `STORE_ITEM_NOT_FOUND` | `use` named an item the store does not define. | `bowerloom ls --global` |
| `STORE_ITEM_MISSING` (held) | A listed store item is not in the live store and not in the lock. | Create it with `bowerloom <kind> create <id> --global`, or run `bowerloom unuse <kind> <id>`. |
| `STORE_ITEM_NOT_SHAREABLE` | A store item must be locked in a shared project, and a teammate cannot fetch it. The message adds the cause (3.10). | Give the store a remote and push it. `bowerloom store status` shows the commands. Or copy the item into this project. |
| `STORE_REMOTE_PRIVATE` | The store repository answered 404. It is private or does not exist. | Check the repository name and that the repository is public. |
| `CONFIG_ITEM_SELECTED` | `use` named an item the config already lists from that source. | `bowerloom ls` |
| `CONFIG_ITEM_NOT_SELECTED` | `unuse`, `lock update --item`, or `team adopt` named an item the config does not list, or there is no config. | `bowerloom ls` |
| `CONFIG_ITEM_MISSING` (held) | A listed project item has no definition in the project. | `bowerloom <kind> create <id>`, or `bowerloom unuse <kind> <id>`. |
| `CONFIG_WRITE_UNCONFIRMED` | `bowerloom.json` was written but changed before it was read back. | `git diff bowerloom.json` |
| `TEAM_NOT_SELECTED` | `up --team` named a team the config does not list. | `bowerloom use team <id>` |
| `LOCK_MISSING` | A frozen run needs a lock and the file is absent. | `bowerloom lock update` on a machine with the store. |
| `LOCK_INVALID` | The lock does not parse, has conflict markers, or a hash does not match its files. | `bowerloom lock verify`. For a merge conflict, take one side for each item, then run it. |
| `LOCK_UNSAFE` | The lock is a link, shared, over one link, or unreadable. | `ls -l bowerloom.lock.json` |
| `LOCK_LIMIT` | The lock lists more than 128 skills, 128 prompts, 32 teams, or is over 4 MiB. | `bowerloom lock verify` |
| `LOCK_CONFIG_MISSING` | A lock exists with no `bowerloom.json`, or a frozen run has no config. | `bowerloom use skill <id>`, or restore `bowerloom.json` from version control. |
| `LOCK_CONFIG_MISMATCH` | The lock and the config list different store items. The message names up to 8 `kind id` pairs. | `bowerloom lock update` |
| `LOCK_HASH_MISMATCH` | Fetched bytes of an authored item do not match the lock hash. | `bowerloom lock verify`, then ask the owner of the store to run `bowerloom lock update`. |
| `LOCK_STORE_NOT_PUSHED` | The pushed copy of an item differs from the item in your store. | Commit and push the store, then run the command again. |
| `LOCK_COMMIT_UNREACHABLE` | The commit is not on the store remote. | Push the store, or pass `--commit <sha>` of a pushed commit. |
| `LOCK_WRITE_UNCONFIRMED` | The lock was written but changed before it was read back. | `git diff bowerloom.lock.json` |
| `SKILLS_OFFLINE` | A step needs the network and cannot reach it. Frozen apply uses it for a fetch that fails. | `bowerloom apply --frozen` when online. |

Existing codes used here keep their meaning: `PROJECT_NOT_FOUND`, `TEAM_EXISTS`, `TEAM_ID_RESERVED`, `AUTHORING_PENDING`, `STALE_APPROVAL`, `USAGE`, `SKILLS_SYNC_CONTENT_MISMATCH`, `MANIFEST_NOT_FOUND`, `PROJECT_BRIEF_INVALID`, `STORE_*` of spec 03, and `CONFIG_*` of spec 03.

## 6. Where to change

Package layers. Keep this direction of imports. A cycle breaks the build.

- `packages/project-config` is low level. It imports `project-context`, `skill-manifest`, `startup` (types only), `contracts`, `codex-adapter` (`strictJson`), and `skill-sources` (`revisionOf`, `captureSkillData`). It does not import `project-authoring`, `project-sync`, or `managed-skills`.
- `packages/project-authoring` imports `project-config`.
- `packages/project-sync` imports `project-config`, `project-authoring`, `skill-manifest`, and `managed-skills`.
- `packages/skill-manifest` imports neither `project-config` nor `project-authoring`.
- `apps/cli` imports all of them.

Create:

- `packages/project-config/src/lock.ts`: `LOCK_FILE`, `LOCK_FORMAT`, `LOCK_LIMITS`, the types, `readLock`, `parseLock`, `serializeLock`, `lockAgrees` (4.1). It imports `AuthoredPin` from `resolve-store-git.ts` (below) and `validateEntry` from `skill-manifest`.
- `packages/project-config/src/shared.ts`: `isSharedProject` (3.9).
- `packages/project-config/src/git.ts`: `readStoreRepo` (3.10) and `normalizeRemote(url)`.
- `packages/project-config/src/write.ts`: `writeGuardedFile(folder, name, text, beforeSha256, held, tempPrefix)`. It is the pattern of `applyManifestChange` (`packages/skill-manifest/src/add.ts:170-201`) generalized. It writes a temporary file with `O_EXCL | O_NOFOLLOW` mode 0644, flushes it, rechecks the target's hash, links or renames, flushes the folder, and reads back.
- `packages/project-sync/src/resolve.ts`: `resolveProject` and the types (4.3). It also holds `readStoreDefinitions(store)`: the store skills (from the store `skills.json`, read with `readManifestState(storeTarget(dir))` and `STORE_MANIFEST_LIMITS`, spec 04), the store prompts and teams (from the store authoring receipt, read with `readAuthoringState(storeDir)`, `packages/project-authoring/src/state.ts:~112`). An item exists only when its folder or file is present.
- `packages/project-sync/src/change.ts`: `planConfigChange`, `applyConfigChange`, `planLockUpdate`, `applyLockUpdate`, `localItemRows(storeDir, kind, id)`. The last reads a store item with `readTree` (`packages/project-authoring/src/files.ts:64`), removes the item path prefix from each path (for a prompt the one path becomes `<id>.md`), and returns the rows. It refuses `STORE_ITEM_NOT_SHAREABLE` with the sentence `The item is larger than a lock can record.` when a file is over 65536 bytes, the total is over 2097152 bytes, or there are more than 128 files.
- `packages/skill-manifest/src/resolve-store-git.ts`: `AuthoredPin` (the type of 4.1), `fetchAuthored(transport, { remote, commit, kind, id }, signal)` (3.11), and `proveAuthored(transport, { remote, commit, kind, id, commitFromLocalRef }, localHash, signal)`. It returns the `AuthoredPin` or throws `LOCK_STORE_NOT_PUSHED`, `LOCK_COMMIT_UNREACHABLE`, or `STORE_REMOTE_PRIVATE`. It does not read the store. The caller passes `localHash`.
- `packages/project-sync/src/store-git.ts`: `fetchStoreGit(item, roots, approvedHosts, deps)`, `writeStoreCache`, `readStoreCache`, and the `.prune-` helper for spec 09.
- `apps/cli/src/use.ts`: `runUseCommand(args, cwd, home, write, io, env)` for `use` and `unuse`. It also prints the `Copies stay in ...` line of 3.7. The CLI computes the places with `itemSurfaces` and `promptSurfaces`. They are not part of the plan JSON.
- `apps/cli/src/lock.ts`: `runLockCommand(args, cwd, home, write, io, env)` for `lock verify` and `lock update`.
- `tests/support/fake-github-repo.ts`: a helper for tests. `buildFakeRepo(files: Record<string, string>, commitMessage)` computes real git object ids for blobs and trees (SHA-1 of `blob <len>\0<bytes>` and of the tree encoding, as `resolve-git.ts:36-39` does), and returns `{ commit, tree, routes }`, where `routes` maps each `https://api.github.com/repos/<o>/<r>/git/...` URL to a fixture file. CLI tests pass it to `tests/support/fake-network.ts` through `TEST_FAKE_NETWORK_PLAN`.
- Test files in section 10.

Change:

- `packages/skill-manifest/src/resolve-git.ts:33-70`: add `export` to `Row`, `listing`, `proveRecursive`, `blob`, `unsafeKind`. No body changes.
- `packages/project-sync/src/plan.ts`:
  - `SyncInput` (line 45): add `home: string` and `frozen?: boolean`.
  - `SyncPlan` (line 78) and `SyncItem` (line 56): the fields of 4.4. `SYNC_PLAN_FORMAT` (line 38): `v1beta2`.
  - `requireTeam` (line 111): in config mode check the config team list.
  - `StateLayout` and `stateLayout` (lines 142 and 157): add `storeCacheRoot`.
  - `sameOrigin` (line 195): the family rule of 3.12.
  - `classify` (line 244): accept the resolved item. Line 253: `readLocalSkill(dir, 'skills/' + id, ...)` uses the store root when the origin is store and the item resolves from the live store. When it resolves from the lock, the expected files come from `lockPin.files`. A held item (no entry) is built without calling `classify`. The drift hint at line 288 names `~/.bowerloom/skills/<id>` for a store item.
  - `observeSync` (line 369): replace lines 374-376 with `resolveProject`. Keep the `MANIFEST_NOT_FOUND` refusal only for legacy mode with no `skills.json`. In config mode with no skills, return a plan with no items. Line 385 filters the effective manifest by team. Line 390 finds orphans from the effective manifest. Lines 409-425 build the body with the new fields and the bound hosts.
- `packages/project-sync/src/apply.ts`:
  - `fetchPin` (line 97) is unchanged. Add `fetchStoreGit` beside it in `store-git.ts` with the same checks (bound content key, approved host, cache lock for that item only).
  - `childRequest` (line 138) and `checkChild` (line 149): the store sources of 3.12.
  - `prepareSkillChildren` (line 206): line 213 handles `local`. Add the store origin and the authored-from-lock fetch before phase B.
  - `applySync` (line 263): create `.bowerloom` first when the plan says `create` (3.4).
- `packages/project-sync/src/apply-project.ts`: as in 3.16 (lines 118-218). Also change line 131, where `readManifestState(dir).file !== null` becomes "the effective skill list is not empty". Lines 136-138 use the resolver's prompts. Add the `ApplyPlan` fields of 4.4 and the formats of 3.18.
- `packages/project-sync/src/prompts.ts`: `registeredPrompts` (line 89) stays for legacy mode. `classifyPrompt` (line 121) takes the origin. Line 123 `readLocalPrompt(project, id, ...)` uses the store root. `promptMissing` (line 106) checks the origin's folder. `promptRequest` (line 186) and `checkPromptChild` (line 196): the store sources.
- `packages/project-sync/src/index.ts`: export `fetchStoreGit`, the new types, and the new format names.
- `packages/project-sync/src/deps.ts:18-30`: leave `Acquirer` as it is. Authored fetches use the public transport directly through `fetchStoreGit`. Add the optional field `storeTransport?: () => PublicTransport & { close(): void }` to `SyncDeps` (`deps.ts:~28`). Tests set it to a fake. The default is `createPublicTransport`.
- `packages/project-config/src/refusal.ts` (spec 03 created it): add every new code of section 5 that begins with `LOCK_`, `CONFIG_ITEM_`, `CONFIG_WRITE_`, `STORE_ITEM_`, or `STORE_REMOTE_`, and `TEAM_NOT_SELECTED`. `packages/project-sync/src/refusal.ts` does not change.
- `packages/managed-skills/src/v2-types.ts`, `local-source.ts`, `v2-observed.ts`: 3.12.
- `packages/project-authoring/src/create.ts`: `CreateInput` (line 34) gains `copyFrom?: { root: string }` for teams. `normalizeInput` (line 83) allows it. `plan()` (line 181): the config step, `bowerloomFolder`, the `copyFrom` branch at line 245. `applyCreate` (line 274): create `.bowerloom` first, write the config and lock steps after `writeManifest` and before `writeReceipt` (line ~358), and repeat them in the finish path (line ~321). `openScope` (spec 04) allows a missing `.bowerloom` when the project has a config.
- `packages/skill-manifest/src/add.ts`: `readManifestState` with `allowAbsent` (spec 04) is used by `resolveProject` when `.bowerloom` is missing.
- `packages/startup/src/index.ts:58`: add `lock-invalid` and `lock-orphan` to `Drift.kind`.
- `apps/cli/src/project-status.ts:26-57`: the `config` additions (4.6, 3.20).
- `apps/cli/src/ls.ts:58-90`: config mode (3.20).
- `apps/cli/src/up.ts:102-130`: 3.19.
- `apps/cli/src/apply.ts:21, 65-76, 88-97, 100-118`: `--frozen`, the review lines, the tags, `ApplyInput.frozen` and `home`.
- `apps/cli/src/sync.ts:42-58, 60-72, 121-122, 126-152`: the tags, the review, `contextOf` passes `home`, `--frozen`.
- `apps/cli/src/create.ts:56-82, 95-105`: the config plan lines.
- `apps/cli/src/manifest.ts:181-196` (`runCheck`): config mode.
- `apps/cli/src/main.ts:132`: add `'use'`, `'unuse'`, `'lock'` to `COMMANDS`. After the create branch (line 152-157), add a branch for `use`/`unuse` that imports `./use.js`, and one for `lock` that imports `./lock.js`. `help use`, `help unuse`, `help lock`, `use --help`, and so on print the topics. `team adopt` is a new word of the `team` command: `parseCreateArgs` (`create.ts:30`) must accept `adopt` as the second word for `team` only and route to the adopt flow. `helpText` (`main.ts:121-127`) maps `team adopt` to `TOPICS.team`.
- `apps/cli/src/human.ts`: `SECTIONS` (line 13): add `bowerloom use <skill|prompt|team> <id>   Pick a store item for this project.` and `bowerloom lock verify | update   Check or refresh bowerloom.lock.json.` under `Skills and setup`. `TOPICS` (line 45): add `use`, `unuse`, `lock`, and extend `apply`, `skills`, `team`, `ls`, `status`, `store`. `REFUSALS` (line 224): every new code with its sentence and next step. `tests/help-human.test.ts:20-45` holds the first screen.
- `package.json:30`: no change. Every new test file sits in a folder that the `test` glob already lists: `packages/project-config/test` (added by spec 03), `packages/project-sync/test`, `packages/skill-manifest/test`, `packages/managed-skills/test`, `packages/project-authoring/test`, `packages/project-context/test`, and `packages/startup/test`.

## 7. Edge cases

| Case | Expected result |
|---|---|
| `use skill x` and there is no `bowerloom.json` | The plan creates it with the project items and `x`. |
| `use skill x` twice | The second refuses `CONFIG_ITEM_SELECTED`. |
| `use skill x` and the project already lists `x` from the project | `CONFIG_DUPLICATE_ID`. The message names both copies. |
| `use skill x --project` and the project has no `x` | `CONFIG_ITEM_MISSING`. |
| `use team research` and the store has two skills tagged `research` and one with no tag | The config gains the team and the two skills with `via: ["research"]`. The untagged skill is not added. |
| `use team research` and one tagged skill is already listed directly | It stays direct. The other is added with `via`. |
| `use team research` and one tagged skill id is listed from the project | `CONFIG_DUPLICATE_ID` for the whole plan. Nothing is written. |
| `use skill x` for an item that is listed with `via: ["research"]` | The `via` key is removed. The plan says it is now picked directly. |
| `unuse team research` | The team is removed. Entries with `via: ["research"]` are removed. Entries with `via: ["research","ops"]` keep `via: ["ops"]`. Direct entries stay. |
| `unuse skill x` for an item picked through a team | The entry is removed. The team stays. |
| `use skill x` in a shared project, `x` written in the store, store has no `.git` | `STORE_ITEM_NOT_SHAREABLE`, sentence `The store is not a git repository.` Nothing is written. |
| The same, store has `.git` but no origin | `STORE_ITEM_NOT_SHAREABLE`, sentence about origin. |
| The same, origin is `https://gitlab.com/o/r` | `STORE_ITEM_NOT_SHAREABLE`, sentence about github.com. |
| The same, the repository has no `origin/<branch>` ref | `STORE_ITEM_NOT_SHAREABLE`, sentence about a pushed commit. |
| The store file was edited after the last push | `LOCK_STORE_NOT_PUSHED`. |
| The pushed commit changed another item only | The lock records that commit. The item matches. No refusal. |
| The origin repository is private and no token is set | `STORE_REMOTE_PRIVATE`. |
| `use skill x` for a pinned npm skill in the store, shared project | Works with no network. The lock gets the full entry. |
| `use` in a project that is not shared and has no lock | No lock is written. No network. |
| `use` after the lock exists | The lock is updated even if the project is not shared. |
| A store item file larger than 65536 bytes | `STORE_ITEM_NOT_SHAREABLE`, sentence `The item is larger than a lock can record.` |
| A store item with more than 128 files | The same refusal. |
| `lock update` with the store missing | `STORE_NOT_FOUND`. |
| `lock update --item skill:nope` | `CONFIG_ITEM_NOT_SELECTED`. |
| `lock update` when nothing changed | Prints the plan with `Nothing to change.` and exits 0. |
| `lock verify` on a file with merge markers | `LOCK_INVALID`. |
| `lock verify` where an `authored.hash` is wrong | `LOCK_INVALID`. |
| `lock verify` where the config lists a store skill the lock lacks | `LOCK_CONFIG_MISMATCH`. The message names `skill <id>`. |
| `apply --frozen` with no lock and store entries | `LOCK_MISSING`. No network call. |
| `apply --frozen` with a lock and the same store items present live and different | The lock wins. The live store is not read. |
| `apply --frozen` on a machine with no store | Fetches missing items from the hosts in the plan. Installs. |
| `apply --frozen` and a fetched authored item has another hash | `LOCK_HASH_MISMATCH`. Nothing is installed from it. |
| `apply --frozen` and the network is down | `SKILLS_OFFLINE`. Nothing in the project changes. |
| `apply --frozen` and every item is cached | No network call. Plan says `Network: none now.` |
| Plain `apply` for an item resolved from the lock and not cached | The item is held with `SKILLS_OFFLINE`. Other items install. |
| `skills sync` in config-only project | Creates `.bowerloom/` first. The first plan line says so. |
| A config-only project and `skill create x` | Creates `.bowerloom/`, the skill, the `skills.json` entry, and the config entry. |
| A config lists a project skill with no definition | The item is held `CONFIG_ITEM_MISSING`. Other items install. |
| A config lists a store item and the store is absent | In a normal run, the item resolves from the lock when there is one. Else held `STORE_ITEM_MISSING`. |
| A config lists a store item and the store is unsafe | The plan refuses with the `STORE_*` code in a normal run. A frozen run does not read the store. |
| The lock lists an item the live store changed | The run installs the live item and the plan notes the stale lock. |
| Store skill and project skill share an id and both are in the config | `CONFIG_DUPLICATE_ID` when the config is read. |
| A store skill and a project prompt share an id | Valid. |
| A store item and a project item would install to one place | `APPLY_NAME_COLLISION` (`apply-project.ts:103-114`). |
| `team adopt x` and the store is absent but the lock holds the team | Fetches the team into the store cache, then copies. |
| `team adopt x` and `.bowerloom/teams/x` exists | `TEAM_EXISTS`. |
| `team adopt x` crashes after files move | The next `team adopt x` finishes it. |
| `up --team research` and `research` is a store team the config does not list | `TEAM_NOT_SELECTED`, next step `bowerloom use team research`. |
| A clone with `bowerloom.json`, a lock, no store: `up --team x` | The sync step fetches lock-resolved items. The apply step installs. |
| `bowerloom.json` is edited by hand and no longer sorted | `CONFIG_INVALID`. |
| Two `use` commands at once | The second waits on the project lock or refuses `PROJECT_LOCKED`, then its plan is stale: `STALE_APPROVAL`. |
| The lock is hand-edited to another `remote` | `lock verify` passes if the hash matches. Fetch fails or mismatches: `LOCK_HASH_MISMATCH` or `LOCK_COMMIT_UNREACHABLE`. |
| The remote name has capital letters | Kept as given. The API accepts them. |
| `--commit` with a short sha | `USAGE`. |

## 8. Migration from beta.2 projects

- A project with no `bowerloom.json` is in legacy mode. `ls`, `status`, `skills check`, `skills sync`, `apply`, `up`, and the create commands act as in beta.2, except for the new formats and the source tags. The store and the lock are never read.
- A project gets `bowerloom.json` only through `use`, `unuse` (which needs a config), `team adopt` (which needs a config), or `store migrate` (spec 08). No other command creates it.
- The first `use` writes a config that lists every item the project defines now, with `source: "project"`, so nothing changes for installed items. The plan shows the count.
- A project with `.bowerloom` keeps it. A project with a config and no `.bowerloom` gets one at the first install.
- Sync and apply plan formats are `v1beta2`. A script that reads `format` must accept it. Entries gain `origin`, `via`, and `resolvedFrom`.
- `skills sync --json` and `apply --json` results gain the same fields.
- Catalogs and receipts in `<stateRoot>/<projectId>/items` keep their format. A local skill moved from the project to the store keeps working: the update check treats `local` and `store` as one family (3.12).
- A shared project that wants a lock runs `bowerloom lock update` once on a machine with the store, commits `bowerloom.lock.json`, and teammates run `bowerloom apply --frozen`.

## 9. Docs changes for this track

- `apps/docs/src/content/docs/cli.md`:
  - `## Project commands`: add `bowerloom use`, `bowerloom unuse`, `bowerloom lock verify`, `bowerloom lock update` to the code block. Add a paragraph for each, built from the help text in 3.5, 3.7, and 3.15.
  - `## Create commands`: add `bowerloom team adopt <id>` and a sentence.
  - `## Apply`: add `[--frozen]` to the usage line. Add the paragraph of 3.16.
  - `## Third-party skills`: add `--frozen` to `skills sync`.
  - Change the sentences about the project folder to name both markers.
  - Describe the source tag, `[store]` and `[project]`, in plan output.
- `apps/docs/src/content/docs/guides/create-items.md`: a section "Pick an item from your store" with `bowerloom use`, `bowerloom unuse`, and `team adopt`.
- `apps/docs/src/content/docs/guides/add-skills.md`: a short section "Share a project" that links to the spec 10 page.
- `apps/docs/src/content/docs/reference/errors.md`: a row for each code in section 5, in the table `## Store and config refusals` (created by spec 03), plus a new table `## Lock refusals`.
- `apps/docs/src/content/docs/releases.md`, `## 0.7.0-beta.3`: lines for `bowerloom.json`, `use` and `unuse`, `bowerloom.lock.json`, `lock verify` and `lock update`, `apply --frozen` and `skills sync --frozen`, `team adopt`, the config-only project with its git-ignored `.bowerloom/`, and the new plan and result formats.
- Spec 10 writes the page "Where your items come from".

## 10. Acceptance tests

Every CLI test spawns the CLI with `HOME` and `XDG_STATE_HOME` set to temporary folders and imports `tests/support/isolate-home.js`. Tests that need GitHub use `tests/support/fake-github-repo.ts` with `tests/support/fake-network.ts`, or inject a fake `PublicTransport`.

`packages/project-config/test/lock.test.mjs`:

1. A full example with a `pin` item and an `authored` item parses, and `serializeLock` returns the exact bytes of 4.1.
2. Parse, serialize, parse gives an equal value.
3. An unknown key, a missing key, both `pin` and `authored`, neither, a `pin` in `prompts`, and `from: "project"` each give `LOCK_INVALID`.
4. A `pin` whose `id` differs from the item `id` gives `LOCK_INVALID`.
5. A `pin` that fails `validateEntry` gives `LOCK_INVALID`.
6. An `authored.hash` that is not `revisionOf(files)` gives `LOCK_INVALID`.
7. `authored` with a short commit, an upper-case commit, a path that does not match the kind and id, `.git` in the remote, a port in the remote, or user information in the remote each give `LOCK_INVALID`.
8. `authored.files` empty, unsorted, over 128 rows, a file over 65536 bytes, or a total over 2097152 bytes each give `LOCK_INVALID` or `LOCK_LIMIT` as 4.1 says.
9. `teams` on a team item gives `LOCK_INVALID`.
10. 129 skills, 129 prompts, 33 teams give `LOCK_LIMIT`. A file of 4194304 bytes passes. One byte more gives `LOCK_LIMIT`.
11. Merge conflict markers give `LOCK_INVALID`. A byte order mark gives `LOCK_INVALID`. A duplicate key gives `LOCK_INVALID`.
12. `readLock` returns `absent` when missing. A link, a folder, two hard links, group write, and another owner each give `LOCK_UNSAFE`.
13. `lockAgrees` is true when the pairs match. It reports `added` and `removed` lists with `kind id` text when they differ. It ignores `via`, project entries, and `harnesses`.
14. For a `pin` item, `entryRequest(pin).digest` equals the digest of the store entry it came from.

`packages/project-config/test/shared.test.mjs`:

1. A lock file makes the project shared with reason `lock`.
2. A `.git/config` with `[remote "origin"]` and a `url` makes it shared with reason `origin`, found from a sub folder of the project and from the project folder itself.
3. A `.git/config` with only `[remote "upstream"]` is not shared.
4. A `.git/config` with `[remote "origin"]` and no `url` is not shared.
5. A `.git` file with `gitdir: <path>` is followed when the path is a real folder owned by the user, and ignored otherwise.
6. No `.git` up to home is not shared. The search stops at home.
7. An unreadable `config` is not shared and does not throw.
8. A `config` over 65536 bytes is not shared and does not throw.

`packages/project-config/test/git.test.mjs`:

1. `normalizeRemote` accepts the seven forms of 3.10 and returns `https://github.com/<o>/<r>`. A capital letter in the owner is kept.
2. It rejects `https://gitlab.com/o/r`, `http://github.com/o/r`, a URL with `user:pass@`, a port, a query, a fragment, a repository name `..`, and an owner longer than 39 characters.
3. `readStoreRepo` returns `none` with no `.git`, `unreadable` when `.git` is a file, a link, or has `reftable`, `no-origin` with no origin, `unsupported-remote` for a bad URL.
4. It reads the branch from `HEAD`, the pushed commit from a loose ref, and from `packed-refs`. It ignores comment lines and `^` lines in `packed-refs`.
5. A detached `HEAD` gives `unpushed`. With a commit override the result carries that commit.
6. A missing remote ref gives `unpushed`.
7. `head` is read from `refs/heads/<branch>` or `packed-refs`, and is null when missing.
8. A branch name with `..` is rejected as `unreadable`.
9. Files over their limits are `unreadable`.

`packages/skill-manifest/test/resolve-store-git.test.mjs` (fake `PublicTransport` from `buildFakeRepo`):

1. `fetchAuthored` returns the files of a skill, a prompt, and a team, sorted, with the right `tree`.
2. The `hash` equals `revisionOf` of the rows.
3. A symlink row, a submodule row, a mode `100755` row, a `.png` file, a file over 65536 bytes, 129 files, and a total over 2 MiB each refuse (`SKILLS_ADD_UNSAFE_CONTENT`).
4. A skill without `SKILL.md`, a team without `team.yaml`, and a folder where a prompt should be a file each refuse.
5. A tree listing whose id does not rebuild to its sha refuses.
6. A truncated listing refuses.
7. A blob whose bytes do not match its sha refuses.
8. A 404 on the commit request gives `STORE_REMOTE_PRIVATE` when `commitFromLocalRef` is true, and `LOCK_COMMIT_UNREACHABLE` when it is false.
9. `proveAuthored` returns `LOCK_STORE_NOT_PUSHED` when `localHash` differs by one byte, and when the item path is missing from the tree. It returns the pin when the hashes are equal.
10. Requests use only `api.github.com` URLs, and no `Authorization` header is set.
11. At most 130 requests, and the request count for a team of ten files is the number the walk implies.

`packages/project-sync/test/store-git.test.mjs`:

1. `writeStoreCache` writes `<store-cache>/<hash>/skills/<id>/...` with the modes of 3.11 and returns `written`. A second call returns `present`.
2. A cache folder with a changed file is moved to `.prune-<hash>-*` and rewritten.
3. A leftover `.tmp-<hash>-*` folder is removed on the next write.
4. `readStoreCache` returns the rows and refuses a link, a foreign owner, and group write.
5. `fetchStoreGit` refuses a host that is not in `approvedHosts`, a changed `hash`, and a fetch whose rows differ from the lock (`LOCK_HASH_MISMATCH`).
6. It takes the cache lock for the one item and releases it.

`packages/project-sync/test/resolve-config.test.mjs`:

1. Legacy mode returns exactly the beta.2 sets (copy the cases of `tests/skills-sync-cli.test.ts` for expected items).
2. Config mode: project entries resolve to their definitions. A missing definition is held `CONFIG_ITEM_MISSING`.
3. Store entries resolve from the live store when it holds the item.
4. Store entries resolve from the lock when the store is absent. A pinned item becomes an ordinary entry.
5. Neither: held `STORE_ITEM_MISSING`.
6. Frozen mode never reads the store (a store that would refuse does not matter).
7. A refused store in a normal run throws its `STORE_*` code.
8. The store is not read when the config lists no store entry.
9. `unselected` lists project definitions the config lacks.
10. The effective manifest holds only selected skills, sorted, with the config harnesses.
11. `notes` holds the stale-lock line when a live item differs from its lock item.
12. A store local skill becomes a `local` entry with path `skills/<id>`.
13. The `teams` tag of an entry comes from its own definition.

`packages/project-sync/test/config-change.test.mjs`:

1. `use` and `unuse` for each kind produce the exact config text of 4.2 and the plan lines of 3.5 and 3.7.
2. The first `use` lists every project item with `source: "project"` and sets `harnesses` from `skills.json`, or `["claude","codex"]` when there is none.
3. Team expansion adds the right items with `via`, merges `via`, promotes a direct pick, and refuses a duplicate with a project item.
4. `unuse team` removes the right entries.
5. Limits give `CONFIG_LIMIT`.
6. The lock is written when a lock exists or the project is shared, and not otherwise.
7. A pinned store skill adds a `pin` item with no network call.
8. An authored item adds an `authored` item after a proof, and the plan names `api.github.com`.
9. Self-healing: a config entry with no lock item gets one.
10. Write order: the config is written before the lock. A crash between them (test hook that throws) leaves the config new and the lock old. The next `use` heals it.
11. Scratch files are listed and removed.
12. A changed config between plan and apply gives `STALE_APPROVAL`.
13. A read back that differs gives `CONFIG_WRITE_UNCONFIRMED` or `LOCK_WRITE_UNCONFIRMED`.
14. Apply creates `.bowerloom` when the plan says `create`, and refuses `STALE_APPROVAL` if it exists by then.

`packages/project-sync/test/lock-update.test.mjs`:

1. `planLockUpdate` for all items and for `--item` lists `unchanged`, `pin changed`, `commit changed`, and `added`.
2. It creates the lock when none exists.
3. An item missing from the store refuses `STORE_ITEM_MISSING`.
4. It makes no network call when only pinned items are selected.
5. Nothing to change returns a plan with no revision change and `applyLockUpdate` writes nothing.
6. `--commit` records that commit.

`packages/managed-skills/test/store-source.test.mjs`:

1. A skill installs from a store folder, with a catalog source `{ kind: 'store', path }` and no directory in it.
2. A prompt installs from a store folder: the Claude command is the file bytes, the Codex wrapper description names `~/.bowerloom/prompts/<name>.md`.
3. The same bytes from the live store and from a store cache folder give identical catalogs and receipts apart from the operation key (compare catalog text).
4. A local skill moved from the project to the store with equal bytes is `up-to-date`. With changed bytes it updates and the catalog source becomes `store`.
5. A store folder inside the project folder, or inside the state folder, is refused by the non-nesting check.
6. A symlink, a second hard link, a foreign owner, group write, and a change during the read are refused.

`packages/project-sync/test/sync-config.test.mjs` and `apply-config.test.mjs`:

1. The plan binds `config`, `lock`, `store`, each item's `requestDigest` (and `hash` for authored), `lockPin`, and `network.hosts`. A change to any of them changes the revision.
2. A pinned store skill already in the cache needs no fetch. The plan names `registry.npmjs.org` only as a possible host (as in `sync-global-cache.test.mjs`).
3. An authored item from the lock not in the store cache is fetched in phase A with a fake transport, and the host is `api.github.com`.
4. A fetch of an unapproved host never starts.
5. A config-only project: the plan has `bowerloomFolder: "create"` and its first review line is the `Create .bowerloom` line. Apply creates the folder with mode 0755 and installs.
6. A store local skill installs from the live store. Changing a store file after the plan gives `STALE_APPROVAL`.
7. A store prompt installs the Claude command and the Codex wrapper.
8. `checkNames` still refuses two items for one place.
9. Holds for `CONFIG_ITEM_MISSING` and `STORE_ITEM_MISSING` do not stop other items.
10. `unuse`d items show as `orphaned` and are not removed.
11. Legacy mode plans equal beta.2 plans except for the new fields.
12. A plan with a stale lock carries the note.

`packages/project-sync/test/frozen.test.mjs`:

1. Each of `LOCK_MISSING`, `LOCK_INVALID`, `LOCK_UNSAFE`, `LOCK_LIMIT`, `LOCK_CONFIG_MISSING`, and `LOCK_CONFIG_MISMATCH` refuses at plan time with zero calls to the fake acquirer and zero network calls.
2. Frozen installs a lock-resolved pin and a lock-resolved authored item on a machine with no store.
3. Frozen ignores a live store that differs.
4. A fetched authored item with another hash gives `LOCK_HASH_MISMATCH` and installs nothing from it.
5. A fetched pin that differs gives `SKILLS_SYNC_CONTENT_MISMATCH`.
6. A failed fetch gives `SKILLS_OFFLINE` with no project change.
7. Cached items cause zero fetches.
8. Plain apply never calls the acquirer (`NO_FETCH`).
9. The apply plan with `frozen: true` has `offline: false` inside its sync part.

`packages/project-authoring/test/create-config.test.mjs` and `team-adopt.test.mjs`:

1. A project create with a config adds the entry, in the plan and in the file.
2. A create with a duplicate store entry in the config gives `CONFIG_DUPLICATE_ID`.
3. A create in a config-only project creates `.bowerloom` first.
4. A project `team create` with no `brief.json` and a config uses `storeBrief`.
5. A project `team create` with an invalid `brief.json` gives `PROJECT_BRIEF_INVALID`.
6. The finish path repeats the config step.
7. `team adopt` copies from the live store and from the store cache, registers the receipt, switches the config, and removes the lock item.
8. The compile candidate of the copy equals the candidate of the source.
9. `TEAM_EXISTS`, `TEAM_ID_RESERVED`, and `CONFIG_ITEM_NOT_SELECTED` refuse.
10. An interrupted adopt resumes.

CLI tests:

`tests/use-cli.test.ts`:

1. The full path: `skill create house-style --global`, then in a project `use skill house-style` shows the plan and exits 3, then with `--approve` writes `bowerloom.json`.
2. `ls` shows the item with `[store]` text and `source: "store"` JSON.
3. `skills sync` and `apply` install it. The copy exists in `.claude/skills/house-style`.
4. `unuse skill house-style` removes it. The copy stays.
5. `use team` expansion on a store with tagged skills.
6. `--project` and the duplicate refusals.
7. `use` with no store: `STORE_NOT_FOUND`.
8. `--commit` with a bad value exits 2.

`tests/lock-cli.test.ts`:

1. In a project with a `.git/config` origin (the test writes the file) and a store with `.git` files, `use skill x` locks an authored skill using the fake GitHub repo. The lock file has the exact bytes expected.
2. The same project with no store `.git`: `STORE_ITEM_NOT_SHAREABLE` with the sentence, and the exact `Next:` text.
3. Editing a store file after the fake repo is built: `LOCK_STORE_NOT_PUSHED`.
4. A project that is not shared writes no lock.
5. `lock verify` passes, then fails after hand edits (hash, set, markers).
6. `lock update` adds, changes, and removes items as the test changes the store.
7. `status --json` shows `config.lock` states: `not-used`, `absent`, `valid`, `stale`, `invalid`, `mismatch`, `orphan`.
8. A private fake repo (404) gives `STORE_REMOTE_PRIVATE`.
9. `store status` shows the `Git:` line and the commands when there is no remote, and `git.ahead` values.

`tests/frozen-cli.test.ts`:

1. Simulate a clone: copy `bowerloom.json`, `bowerloom.lock.json`, and the project files to a new folder with a new `HOME` that has no store. `apply --frozen` shows a plan with `Network: reads api.github.com` and exits 3. With `--approve` it fetches (fake repo), installs, and exits 0.
2. A second `apply --frozen` shows `Network: none now.` and `Nothing to change.`
3. `skills sync --frozen --offline` with an uncached item refuses `SKILLS_OFFLINE`.
4. Plain `apply` in the clone holds the authored item with `SKILLS_OFFLINE`.
5. `up --team x` in the clone fetches and installs through its sync and apply steps.
6. The fake network log shows only `api.github.com` and `registry.npmjs.org`.

`tests/config-only-cli.test.ts`: every command in a folder that holds only `bowerloom.json`: `ls`, `status`, `skills check`, `skills sync`, `apply`, `up --team`, `skill create`, `prompt create`, `team create`, `use`, `unuse`, `team adopt`, `lock verify`. Each works or refuses with the code this spec names. `.bowerloom/managed/.gitignore` holds `*` after an install. `git status --porcelain` (the test runs `git init` itself with a spawn) shows only the files the person wrote.

`tests/team-adopt-cli.test.ts`: the CLI path of `team adopt`, the plan lines, and the result.

Update existing tests: `tests/ls-status-cli.test.ts`, `tests/skills-sync-cli.test.ts`, `tests/apply-cli.test.ts`, `tests/up-team-cli.test.ts`, `tests/freeze-up-cli.test.ts`, `tests/m5-review-fixes.test.ts`, `tests/m6-review-fixes.test.ts` for the new format names and tags. `tests/no-spawn.test.ts` must stay green with no change. `tests/guard-map.test.ts` must stay green. `tests/help-human.test.ts` and `tests/human-refusal.test.ts` update for new text and codes.

## 11. Build order

1. Export the helpers in `resolve-git.ts`. Write `tests/support/fake-github-repo.ts` and test it against `resolve-git.test` cases.
2. Engine sources (3.12) with `store-source.test.mjs`.
3. `lock.ts`, `shared.ts`, `git.ts` with their tests.
4. `resolve-store-git.ts` and `store-git.ts` with their tests.
5. `resolve.ts` with its test.
6. `plan.ts`, `prompts.ts`, `apply.ts`, `apply-project.ts` with the sync, apply, and frozen tests.
7. `change.ts`, authoring changes (config step, `copyFrom`), with their tests.
8. CLI: `use.ts`, `lock.ts`, `apply.ts`, `sync.ts`, `create.ts`, `up.ts`, `ls.ts`, `project-status.ts`, `manifest.ts`, `main.ts`, `human.ts`.
9. CLI test files and updates to existing tests.
10. Docs.
11. `npm run typecheck`, `npm test`. Both zero.

## 12. Unverified items

1. The managed engine may close the allowed `source.kind` values in a place I did not read (the receipt and plan validators beyond `validatePlanV2`, `packages/managed-skills/src/v2-observed.ts:190-200`). First, run `store-source.test.mjs` cases 1 and 4. For each refusal, search `packages/managed-skills/src` for `'local'`, `closure.source`, and `catalogKeys`, and add the new kinds at that place. If a validator cannot take them without a format change, use the fallback: keep the engine source kind `local` and `prompt` for store items, and pass the store root in a new optional request key `rootDir` that is bound in the request. The catalog then does not tell the origin, so add the origin to the plan item only.
2. `compileCrew` on a team folder outside a project (`packages/crew/src/index.ts:94`). Run the `team adopt` plan case first. If it refuses, call `compileCrew(file, { root: <team folder> })`. If it still refuses, copy the team to a temporary folder inside `<stateRoot>` and compile there.
3. `createPublicTransport` against store URLs. Its URL check is `URL_SHAPE` at `packages/skill-manifest/src/public-get.ts:~40`. It allows letters, digits, and the characters `. _ ~ @ % / -`, which covers every URL in 3.11. Run `resolve-store-git.test.mjs` case 1 first. If the transport refuses a valid store URL with `SKILLS_ADD_HOST_REFUSED`, compare the URL with `URL_SHAPE` and fix the URL builder. Do not widen `URL_SHAPE`.
4. `packed-refs` format. Peeled lines start with `^`. Comment lines start with `#`. Test with a real `git pack-refs` output that the test creates by hand. If the test finds another line shape, ignore it and keep the parser strict on the lines it needs.
5. `tests/support/fake-network.ts` serves a file per exact URL (`fake-network.ts:~40`). It does not log request headers. Extend it to log whether an `Authorization` header was set (never the value). Spec 07 needs this too. If spec 07 merged first, it exists already.
6. The static walk in `tests/no-spawn.test.ts` covers modules reachable from `up.js` and `apply.js`. The new modules are reachable from them. Run that test right after step 6 of the build order. If it finds `child_process`, the import came from a helper. Remove that import. Do not weaken the test.
7. Lock size. The figure of about 42 KB per pinned entry comes from the issue, not a measurement. After step 3 of the build order, measure a real maximum entry (128 files of 65536 bytes each is not possible, since the total cap is 2 MiB). If a 128-entry lock passes 4 MiB in a test, raise `LOCK_LIMITS.bytes` to the smallest power of two that fits and update the docs.
8. The `.git` directory inside the store and `readTree`/authoring verifiers. The store has no startup walk, so `.git` does no harm there. Run `store status` counts against a store that has `.git` and `.gitignore`. If the folder counts are wrong, make the counter ignore names that start with a dot.
9. Whether `skills check` in a config project with no `skills.json` can print `0 skills` without breaking `tests/skills-cli.test.ts`. Run it. If a test expects `MANIFEST_NOT_FOUND` in config mode, update the test, because the new behavior is the spec.
