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

Third, Bowerloom must tell a person that a project cannot be shared. In a shared project, `use` refuses a store item that nobody else can fetch. It says how to make the item fetchable (decisions 19 and 22).

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

For each config entry with `source: "project"`, look up the project definition: the entry in `.bowerloom/skills.json`, the item in `.bowerloom/authoring/receipt.json` (prompts and teams), or the folder `.bowerloom/teams/first-team`. If the definition is missing, the item is held with the code `CONFIG_ITEM_MISSING`. The next step is `Define it with bowerloom <kind> create <id>, or run bowerloom unuse <kind> <id>.`

For each config entry with `source: "store"`, in a normal run (not frozen):

1. If the store is a valid store and holds the item, install from the live store. Suppose a lock item for this id differs from the live item. Then the plan carries this note: `The lock is out of date for <ids>. Run bowerloom lock update.` The run is not refused.
2. If a lock item exists for this id, install from the lock. A pinned item uses the machine cache. An authored item uses the store cache (3.11).
3. Otherwise, the item is held with the code `STORE_ITEM_MISSING`. The next step is `Create it with bowerloom <kind> create <id> --global, or run bowerloom unuse <kind> <id>.`

In a frozen run, only step 2 applies. The live store is not read.

A config with no store entry never reads the store. A config with a store entry reads it. A store that is `foreign`, unsafe, unreadable, or invalid then refuses the whole plan with its `STORE_*` code in a normal run. A store that is absent is not an error. In a frozen run the store is not read at all.

### 3.4 Config-only projects (decisions 12 and 16)

A project with `bowerloom.json` and no `.bowerloom/` folder works with every command. The managed engine keeps its install records in `.bowerloom/managed/`. The first `skills sync` or `apply` that installs anything creates `.bowerloom/` with mode 0755. So do `skill create`, `prompt create`, `team create`, and `team adopt`. `use` and `unuse` never create it. Every file the engine writes there is git-ignored by `.bowerloom/managed/.gitignore`, which holds one line, `*`. So the repository holds only `bowerloom.json`, `bowerloom.lock.json`, and the files the person writes.

The plan shows this as the first line of the review:

```text
Create .bowerloom (records of the copies). Its contents are git-ignored.
```

The plan field is `bowerloomFolder: "create"`. For an existing folder it is `"present"`. Six commands can create the folder, and `use` and `unuse` never do. They write only `bowerloom.json` and `bowerloom.lock.json`.

- `apply` and `skills sync` create it after phase A and before phase B, under the project lock.
- `skill create`, `prompt create`, and `team create` create it through the authoring path, as their first write.
- `team adopt` creates it through its create part. The field `bowerloomFolder` is `create` only for `op: 'adopt'` (4.5).

Creation calls `mkdir` with mode 0755, then `chmod` 0755, and checks the mode. It checks that the user owns the folder and that it has no group or world write permission. It flushes the project folder. If the folder exists by then, the command refuses `STALE_APPROVAL`. After each creation, call `adoptCreatedMarker(project, 'folder')` and use the returned context for the rest of the run.

After `bowerloom.json` is created, call `adoptCreatedMarker(project, 'config')` (spec 03) and use the returned context for the rest of the run.

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

1. Find the project (`discoverProject`). With no project, refuse `PROJECT_NOT_FOUND`.
2. If `bowerloom.json` is missing, the plan creates it (`created: true`). The new file holds three things. It holds `harnesses` from the project `skills.json`, or `["claude","codex"]` for a project with no `skills.json`. It holds every item the project defines now, with `source: "project"`. Those items are each entry of `skills.json`, each registered prompt, each registered team, and `first-team` with its folder. The list does not include `personal-assistant`. A config entry skill `personal-assistant` (project) is held `CONFIG_ITEM_MISSING`. A list over its limit refuses `CONFIG_LIMIT`.
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
6. In a shared project (3.9), or in a project with a lock, compute the lock items for every added store item (3.8). For an authored item this reads the network and needs the store remote (3.10).
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
Network: reads api.github.com, to check the pushed copy of <n> items, about <r> requests to api.github.com.     (only when authored items are locked)
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

`via` names a team id of the `teams` list whose entry has `source: "store"` (spec 03, 4.2).

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

The `Copies stay` line appears only for an item with a copy on this machine. A catalog file under `.bowerloom/managed/catalog` marks such a copy. A team never has the line, because a team installs nothing.

After `unuse`, the next sync or apply plan lists the item as `kept` (state `orphaned`). This is today's behavior (`plan.ts:339`, `apps/cli/src/apply.ts:55`).

### 3.8 Create commands in a project with a config

`skill create`, `prompt create`, and `team create` in a project that has `bowerloom.json`:

1. The plan adds the new item to `bowerloom.json` with `source: "project"`. The plan field is `config`, section 4.9. The plan line is `bowerloom.json adds: <kind> <id> (project)`.
2. If the config already lists the same kind and id from the store, refuse `CONFIG_DUPLICATE_ID` at plan time.
3. A config over a limit refuses `CONFIG_LIMIT`.
4. If `.bowerloom/` is missing, the plan creates it (3.4). The plan field `bowerloomFolder` is `"create"` and `CreatePlan.bowerloom` is null.
5. `team create` in a project with no `brief.json` uses `storeBrief(profile)` (spec 04, 3.5). If `brief.json` exists but is invalid, it still refuses `PROJECT_BRIEF_INVALID`.
6. The apply order is: the item, the `skills.json` entry (skills), `bowerloom.json`, the receipt, then the removal of the pending record. An interrupted create finishes through the finish path. That path repeats the config step for a missing entry. `manifestStep` follows the same rule (`packages/project-authoring/src/create.ts:159-170`).
7. A project with no `bowerloom.json` is unchanged. Creating an item never creates `bowerloom.json`.
8. The lock is not touched. The lock holds store items only.
9. In a project with `bowerloom.json`, `skills add` (no `--global`) also adds `{ id, source: "project" }` to the config. It does so in the same plan, with the same duplicate and limit refusals. `--replace` does not change the config.

### 3.9 Shared project rule (decision 22)

Two tests decide whether a project is shared. Either test is enough:

1. `bowerloom.lock.json` exists in the project folder.
2. The project folder is inside a git work tree whose `.git/config` has a section `[remote "origin"]` with a `url` key.

Detection reads files only and starts no process. A plain file is a regular file, not a link, owned by the user. Algorithm for test 2:

1. Walk from the project folder up. Stop at the first folder that holds a `.git` entry. Bowerloom does not inspect the home folder or `/`.
2. A `.git` folder must be a real folder owned by the user. A `.git` file is read as a plain file of at most 4096 bytes. Its first line is `gitdir: <path>`. Resolve the path against the folder of the file. The result must be a real folder owned by the user. If that folder holds a plain file `commondir`, resolve its first line against that folder the same way. The config folder is that result. Any other result makes this test fail.
3. Read `<config folder>/config` with `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`. Require a regular file, owned by the user, of at most 65536 bytes. An unreadable file refuses nothing. This test then fails.
4. The test passes for a file with a header line `^\s*\[remote\s+"origin"\]\s*$`, matched case-insensitively on `remote`. A line with the key `^\s*url\s*=\s*\S`, matched case-insensitively, must follow it before the next section header.

The function is `isSharedProject(project): { shared: boolean; reason: 'lock' | 'origin' | null }` in `packages/project-config/src/shared.ts`.

What the rule changes:

- In a shared project, `use`, `use team`, and `store migrate` (spec 08) check that every store item they add is fetchable by a teammate (3.10). If an item is not, they refuse `STORE_ITEM_NOT_SHAREABLE`. The refusal message says how to give the store a remote.
- `use` writes the lock in a shared project and in a project with a lock. `unuse` writes it only in a project with a lock.
- In a project that is not shared and has no lock, `use` writes no lock and needs no network. `status` shows `lock: not-used`.
- Once a lock exists, the project is shared, so the lock is always kept up to date.

A pinned npm or GitHub skill is always fetchable. A project item needs no check.

### 3.10 The git-backed store

The store can be a git repository. Bowerloom never runs git. It reads a few files in `~/.bowerloom/.git` and talks to `api.github.com`.

Reading the store repository (`packages/project-config/src/git.ts`, function `readStoreRepo(storeDir, commit: string | null): StoreRepo`). Bowerloom reads every file below as a plain file. A plain file is a regular file, not a link. The user owns it, and it has no group or world write. Bowerloom opens it with `O_NOFOLLOW|O_NONBLOCK` and reads up to its limit.

1. `~/.bowerloom/.git` must be a real folder, not a link, owned by the user. If it is missing, the result is `{ problem: "none" }`. If it is a file or a link, or a folder named `reftable` exists inside it, the result is `{ problem: "unreadable" }`.
2. Read `.git/config` (at most 65536 bytes). A `.git/config` with `objectformat = sha256` gives `{ problem: "unreadable" }`. Find the `[remote "origin"]` section and its first `url` value. If there is none, `{ problem: "no-origin" }`.
3. Normalize the URL. Accept exactly these forms, with `<o>` an owner and `<r>` a repository name:
   - `https://github.com/<o>/<r>`, `https://github.com/<o>/<r>.git`, `https://github.com/<o>/<r>/`
   - `git@github.com:<o>/<r>`, `git@github.com:<o>/<r>.git`
   - `ssh://git@github.com/<o>/<r>`, `ssh://git@github.com/<o>/<r>.git`

   The host is compared in lower case. `<o>` matches `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`. `<r>` matches `^[A-Za-z0-9._-]{1,100}$` and is not `.` or `..`. A URL with a user name and password, a port, a query, or a fragment, or any other host, gives `{ problem: "unsupported-remote" }`. The normal form is `https://github.com/<o>/<r>` in lower case, the `remote` value. Bowerloom lower-cases `<o>` and `<r>`, because GitHub ignores case in both. Spec 07 uses the same form.
4. Read `.git/HEAD` (at most 256 bytes). It must be `ref: refs/heads/<branch>` plus a newline. A detached HEAD (a bare commit) gives `{ problem: "unpushed" }` unless `commit` is set. A branch name matches `^[A-Za-z0-9._/-]{1,200}$` with no `..` and no leading or trailing slash.
5. Find the pushed commit. First look for the file `.git/refs/remotes/origin/<branch>`: 40 lower-case hex characters and a newline. If it is missing, read `.git/packed-refs` (at most 1 MiB) and find the line `<sha> refs/remotes/origin/<branch>`. If neither exists, `{ problem: "unpushed" }`.
6. The head commit is the 40-hex value in `.git/refs/heads/<branch>`, or in `packed-refs` as `refs/heads/<branch>`. If it is missing, it is null.
7. The result is `{ problem: null, remote, branch, head, pushed }`.

With `commit` set, `pushed` is `commit`. A detached HEAD or a missing remote ref is then not a problem, and `branch` and `head` can be null.

`StoreRepo` fields: `problem`, `remote`, `branch`, `head`, and `pushed`. `problem` is `none`, `no-origin`, `unsupported-remote`, `unreadable`, `unpushed`, or null. `head` can be null. `pushed` is null for the problem `unpushed` with no `commit`.

The commit a lock records (decision: pushed commit):

- With `--commit <sha>`: that value. It must be 40 lower-case hex characters, else `USAGE`.
- Otherwise `repo.pushed`.
- The commit is never `HEAD`. Only a pushed commit can be fetched.

Proof (the rule for dirty or unpushed changes). Before Bowerloom writes an authored lock item, it proves the item at the commit:

1. Fetch the commit and the tree of the item path from `api.github.com`, with the shared public transport (3.11). Compute the item's file list and `hash`.
2. Read the live store item with the guards and compute its file list and `hash` the same way.
3. If the two `hash` values differ, the outcome is `not-pushed`. If the item path does not exist in the tree at the commit, the outcome is `not-pushed` too. `change.ts` maps it to `LOCK_STORE_NOT_PUSHED` (6).
4. Suppose the commit request answers HTTP 404. The commit can be unknown, or the repository can be private. The outcome is `commit-missing`. `change.ts` maps it to `LOCK_COMMIT_UNREACHABLE` for a commit from `--commit`, and to `STORE_REMOTE_PRIVATE` for a commit from the local `origin/<branch>` ref. The ref proves the commit was pushed once.

This one check covers uncommitted edits, committed but unpushed edits, and the wrong branch. Bowerloom does not run `git status`. Unpushed commits that do not change this item do not matter.

Warning (never a refusal). Take a `repo.head` that is not null and differs from `repo.pushed`. Then the plan carries this line: `Your store has commits that are not pushed (HEAD differs from origin/<branch>). The lock records the pushed commit <commit8>.`

An authored item must be locked, and the problem is `none`, `no-origin`, `unsupported-remote`, `unreadable`, or `unpushed`. Then refuse `STORE_ITEM_NOT_SHAREABLE`. The message adds one sentence:

| Problem | Added sentence |
|---|---|
| `none` | The store is not a git repository. |
| `no-origin` | The store repository has no remote named origin. |
| `unsupported-remote` | The store remote is not a github.com repository. |
| `unreadable` | Bowerloom cannot read the git files of the store. |
| `unpushed` | The store has no pushed commit for this branch. |

The `Next:` text in `REFUSALS` for `STORE_ITEM_NOT_SHAREABLE` reads:

```text
Give the store a remote and push it. bowerloom store status shows the commands. Or adopt a team into this project with bowerloom team adopt.
```

Auth. This spec fetches without credentials. A repository that is private, or does not exist, gives HTTP 404, and Bowerloom reports `STORE_REMOTE_PRIVATE`. This spec passes no `githubAuth` key. It changes `public-get.ts` in one place, the status handling at line 134. Before the 404 branch, for host `api.github.com`, three cases settle `GITHUB_RATE_LIMITED`. The first is a status of 429. The second is a status of 403 with an `x-ratelimit-remaining` header whose value is exactly 0. The third is a status of 403 with a `retry-after` header. Read both headers from `incoming.headers`, because `guardedResponseHeaders` returns only the guarded names. Every other status keeps today's result. Add `GITHUB_RATE_LIMITED` to `MESSAGES` in `packages/skill-manifest/src/refusal.ts`. Spec 07 adds the token option.

Hard constraint: the GitHub rate limit. GitHub documents it (verified 2026-10-22 at docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api): "The primary rate limit for unauthenticated requests is 60 requests per hour." With a token the limit is 5,000 requests per hour. The design keeps requests low:

- One transport serves all requests for one item.
- An authored skill or team holds at most 126 files (`LOCK_LIMITS.files`, the `localItemRows` check, and `fetchAuthored`). One item takes 4 requests plus one per distinct blob, so at most 130. That is the request cap of one public transport (`PUBLIC_GET_LIMITS.requests`, `public-get.ts:36`).
- In `lock update`, an authored item whose live hash equals its lock hash keeps its lock item and reads no network, unless `--commit` is given.
- `GITHUB_RATE_LIMITED` from the transport keeps its code. It does not become `SKILLS_ADD_NETWORK`.

Every plan that reads `api.github.com` for authored items shows the line `Network: reads api.github.com, about <r> requests to api.github.com.` Here `<r>` is a sum over the items. Each item adds 4 plus its number of distinct sha256 values. The values come from the lock or from `localItemRows`. If `<r>` is over 60 and no token is set, the plan adds this line: `Without a token GitHub allows about 60 requests an hour. Set BOWERLOOM_GITHUB_TOKEN, or run the command again after an hour to finish.`

Hosts. The plan binds `api.github.com` (the value `HOSTS.git`, `packages/project-sync/src/plan.ts:43`) in `network.hosts` for every plan that reads the network for an authored item. A fetch that the approved plan did not name never starts (the check in `fetchPin`, `packages/project-sync/src/apply.ts:100`).

Offline. `use`, `lock update`, and (spec 08) `store migrate` need the network for authored items. With no network they refuse `SKILLS_OFFLINE`. For `use` and `lock update` the message is `Checking <ids> needs api.github.com. Connect to the network and run the command again.` For frozen apply or sync it is `bowerloom apply --frozen needs api.github.com for <ids>. Connect to the network and run it again.` Pinned store skills need no network.

Error mapping, for `use`, `lock update`, and frozen fetch:

| Error from the transport | Refusal |
|---|---|
| `SKILLS_ADD_NETWORK` | `SKILLS_OFFLINE` |
| `SKILLS_ADD_HOST_REFUSED` | unchanged |
| `SKILLS_ADD_UNSAFE_CONTENT`, or `SKILLS_ADD_NOT_FOUND` after the commit request | `LOCK_STORE_NOT_PUSHED` while proving, `LOCK_HASH_MISMATCH` while fetching |
| `SKILLS_ADD_NOT_FOUND` on the commit request while proving | Step 4 of the proof above |
| `SKILLS_ADD_NOT_FOUND` on the commit request while fetching (frozen apply, sync, up) | `STORE_REMOTE_PRIVATE`. Amendment, 2026-10-22, sageadvicellc/bowerloom#100: one request for `GET /repos/<o>/<r>` follows; 200 gives `LOCK_COMMIT_GONE`, 404 or a refused token keeps this code, and any other answer raises its own code or keeps this one with `Bowerloom could not check the repository: <code>.` |
| abort | `SKILLS_SYNC_INTERRUPTED` |
| `GITHUB_RATE_LIMITED` from the transport | `GITHUB_RATE_LIMITED` |

### 3.11 Fetching authored items: the store cache

New module `packages/skill-manifest/src/resolve-store-git.ts` and new module `packages/project-sync/src/store-git.ts`. Both use `createPublicTransport` (`packages/skill-manifest/src/public-get.ts:55`). They do not change `packages/skill-sources/src/git.ts` or `npm.ts`.

Reason (for the pull request, not for the code): `git.ts` accepts only skills with an MIT or Apache license file (`git.ts:70,79,96`) and only the `owner/repo` shape in lower case (`git.ts:69`). A skill from `skill create` has no license. A prompt or team is not a skill. So the new code has its own, narrower policy.

`fetchAuthored(transport, { remote, commit, kind, id }, signal): Promise<AuthoredFetch>` (one transport serves the whole item) where `AuthoredFetch = { tree: string; files: { path: string; bytes: Buffer }[] }`:

1. `GET https://api.github.com/repos/<o>/<r>/git/commits/<commit>`. At most 524288 bytes (`GIT_LIMITS.metadataBytes`, `git.ts:21`). The JSON `sha` must equal `commit`. Read `tree.sha` as the root tree.
2. The segments are `[skills, <id>]`, `[teams, <id>]`, or `[prompts, <id>.md]`. The variable `current` starts at the root tree. For segment 0, `GET trees/<current>` (at most 524288 bytes), then `listing(bytes, current, false)`, then require `treeId(rows) === current`. Find the row named `skills`, `teams`, or `prompts` (mode `040000`, type tree). Set `current` to its sha. For a skill or team, do the same for segment 1 (`<id>`, a tree). For a prompt, find `<id>.md` in that listing. It must be a blob with mode `100644`. Its sha is `tree`, and it is the only file.
3. For a skill or team, `GET trees/<current>?recursive=1`, then `listing(bytes, current, true)`, then `proveRecursive(rows, current)`. The value `tree` is `current`.

A skill or team takes 4 requests plus one per distinct blob sha. A prompt takes 4 requests. For a missing segment row, `proveAuthored` returns `not-pushed`. `fetchAuthored` throws `SKILLS_ADD_NOT_FOUND`, which `store-git.ts` maps to `LOCK_HASH_MISMATCH`.
4. Every row must pass `unsafeKind` (no symlink `120000`, no submodule `160000`, no `commit` type). Every blob must be mode `100644`. Every path must pass `skillFilePath` (extension `md`, `txt`, `json`, `yaml`, `yml`, or `csv`, or a license name). At most 126 files, 65536 bytes each, and 2097152 bytes in all. In this step, every row means a row of the item. A team also passes this limit. No file is empty, starts with a byte order mark, is not UTF-8, or has an execute bit. These are the same file rules as `localItemRows` (6). The store sources (`store`, `store-prompt`) and the fetch apply them. The project sources (`local`, `prompt`) keep today's rules.
5. A skill needs `SKILL.md`. A team needs `team.yaml`. A prompt is exactly one file.
6. `GET .../git/blobs/<sha>` once for each distinct blob sha (at most 131072 bytes each). Check each with `blob(bytes, id, size)`. The text must be strict UTF-8 with no byte order mark (`text()` in `content.ts`).
7. Return the files sorted by path in byte order. Paths are relative to the item folder. A prompt has the one path `<id>.md`.

The helpers `listing`, `treeId`, `proveRecursive`, `blob`, `unsafeKind`, and the type `Row` already exist in `packages/skill-manifest/src/resolve-git.ts` (lines 33-70). Add `export` to `Row` (`resolve-git.ts:31`), `treeId`, `listing`, `proveRecursive`, `blob`, and `unsafeKind`. Do not change their bodies. All existing tests for `resolve-git.ts` must keep passing.

The inventory and hash of an item:

```ts
rows = files.map(f => ({ path: f.path, sha256: sha256(f.bytes), bytes: f.bytes.length }))   // sorted by path
hash = revisionOf(rows)                                                                      // from packages/skill-sources/src/validation.ts
```

The store cache. Fetched authored bytes go to a content-addressed folder `<stateRoot>/store-cache/<kind>-<id>-<hash>/` (mode 0700). Call that name `<key>`. The `<kind>` is `skill`, `prompt`, or `team`. Inside it the item sits as it does in a store: `skills/<id>/...`, `prompts/<id>.md`, or `teams/<id>/...`. Files are mode 0600, owned by the user. It is never inside `~/.bowerloom` (decision 1) and it is not an `op-` operation of the skills cache. Writing it (function `writeStoreCache(root, kind, id, hash, files)`, with `<key>` built from its arguments):

1. Take the cache lock, `withCacheLock(cacheRoot, signal, ...)`, where `cacheRoot` is `<stateRoot>/cache` (`packages/project-context/src/index.ts:233`). The lock covers the `store-cache` folder too.
2. If `<store-cache>/<key>` exists and re-verifies (3 below), return `present`.
3. Check an existing folder by reading its files with the guards of `readTree` and comparing `revisionOf(rows)` to the `<hash>` part of `<key>`. A folder that fails the check is moved to `.prune-<key>-<8 hex>` and replaced.
4. Write the files into a new folder `.tmp-<key>-<8 hex>` next to the target. Flush each file and each folder. Then `rename` the folder to `<key>` and flush the parent. A crash leaves a `.tmp-` folder. The next write removes any `.tmp-<key>-*` folder it finds under the lock. The `.prune-` and `.tmp-` names follow the same key.
5. If `<stateRoot>/store-cache` is missing, create it first with mode 0700. Check the folders on the way as `cacheLayout` does (`plan.ts:157`, spec 04).

Reading from it: the managed engine reads an authored item from the store cache through the `store` and `store-prompt` sources (3.12). The `storeDir` value is `<store-cache>/<key>`.

### 3.12 Engine sources for store items

A store item installs through two new item sources in the managed engine. They read from a directory laid out like a store. That directory is `~/.bowerloom` for the live store, or `<store-cache>/<key>` for a fetched item.

Changes (exact):

- `packages/managed-skills/src/v2-types.ts:21` (`ItemSource`): add `| { kind: 'store'; path: string; storeDir: string } | { kind: 'store-prompt'; name: string; storeDir: string }`.
- `v2-types.ts:30-32` (`LocalClosure.source`): add `| { kind: 'store'; path: string } | { kind: 'store-prompt'; path: string }`. The closure and the catalog hold no directory.
- `packages/managed-skills/src/local-source.ts:43-46` (`base`) and lines 48 and 65 (`readLocalSkill`, `readLocalPrompt`): add a last parameter `root?: { bowerloom: string; origin: 'project' | 'store' }`. The default is `join(projectDir, '.bowerloom')` and `project`. For `store`, `bowerloom` is `storeDir`. The closure source is `{ kind: 'store', path }` or `{ kind: 'store-prompt', path }` for a store origin.
- `packages/managed-skills/src/v2-observed.ts:47-62` (`requestV2`): accept the two sources. For `store`: `item.kind === 'skill'`, `path === 'skills/' + item.id`, `storeDir` an absolute path. For `store-prompt`: `item.kind === 'prompt'`, `name === item.id`. The key sets are `['kind','path','storeDir']` and `['kind','name','storeDir']`. Add `storeDir` to the `roots` list of the non-nesting check (the non-nesting check, `v2-observed.ts:61`).
- `requestV2` also runs `path(storeDir)`, the absolute path check. The resolver calls `verifyStorePins` (spec 03) before and after its reads of the live store. When sync and apply read the live store, they run `storeStateNested` (spec 04).
- `v2-observed.ts:105-109` (`readClosure`): call `readLocalSkill` or `readLocalPrompt` with the store root for the two new sources.
- `v2-observed.ts:110` (`wrapper`): add a parameter `origin: 'project' | 'store'`. For a store prompt, live or fetched, the description reads `Bowerloom prompt <name>, wrapped as a skill for Codex. It comes from your Bowerloom store. Edit it there, not this file.` For a project prompt it does not change.
- `v2-observed.ts:235-238` (the update check `sameSource`): treat `local` and `store` as one family. Treat `prompt` and `store-prompt` as one family. Equal `path` (or `name`) values make two members of a family the same source. Every other branch stays.
- `apps/cli/src/sync.ts:53`: the `local` case of `itemLine` reads `your skill in .bowerloom/skills/<id>`. For a store origin it reads `your skill in ~/.bowerloom/skills/<id>`. For an item from the lock it reads `a skill from the store at github.com/<o>/<r>`.
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

- `use` and `unuse` (and `use team`, with its expansion) add and remove lock items. `use` does so in a shared project and in a project with a lock. `unuse` does so only in a project with a lock. They keep every other lock item as it is, so they need no network for items already locked.
- `use` and `lock update` also add a lock item for any store entry that has none (self-healing, below).
- `team adopt` removes the team's lock item.
- `bowerloom lock update` re-resolves items from the live store (3.15).
- `store migrate` (spec 08) adds lock items for items it switches to the store in a shared project.
- `receipt clean` (spec 08) does not touch the lock.
- `skills sync`, `apply`, `up`, `ls`, `status`, `skills check`, and `lock verify` never write the lock.

Self-healing. `use`, `unuse`, and `lock update` make the lock agree with the new config. Each drops every lock item whose (kind, id) is not a store entry of the new config. This needs no network. `use` and `lock update` also add a lock item for every store entry that has none. `unuse` never adds a lock item and never reads the network. With no `bowerloom.lock.json`, `unuse` writes no lock. If `use` or `lock update` cannot resolve an item (no network, no store), it refuses and names the item.

The lock without a config: the lock alone marks nothing. If `.bowerloom` exists, `status` reports drift `lock-orphan` (4.6). A frozen run refuses `LOCK_CONFIG_MISSING`. A normal run ignores the lock.

A config without a lock: a normal run works. For a shared project whose config lists store items, `status` reports `lock: absent`. Any other project gets `lock: not-used`. A frozen run refuses `LOCK_MISSING`.

Merge conflicts. The file is serialized the same way every time. It has one item per id, spread over many lines. Branches that change different ids usually merge cleanly. A conflict leaves markers (`<<<<<<<`) in the file. The file is then not valid JSON, so every reader refuses `LOCK_INVALID`, and the next step is the text in 5. To settle a conflict, choose one side for each conflicting item, then run `bowerloom lock verify`. A machine with the store can run `bowerloom lock update` instead. It recomputes the items.

### 3.14 Write order and crash recovery for `use`, `unuse`, `team adopt`

All three run under `withProjectLock(project.dir)`. The order is:

1. Remove leftover scratch files named `.bowerloom.json.<16 hex>.tmp` and `.bowerloom.lock.json.<16 hex>.tmp` in the project folder (regular files owned by the user). The plan lists them in `scratch`.
2. (`use` and `unuse`) Create no `.bowerloom`. If the plan creates `bowerloom.json`, call `adoptCreatedMarker(project, 'config')` right after the write and use the returned context for the rest of the run.
3. (`team adopt` only) run the create path of 3.17. If `.bowerloom` is missing, it creates the folder first. Then it calls `adoptCreatedMarker(project, 'folder')`. The path then runs the pending record, the staged files, the move, the receipt, and the removal of the pending record.
4. Write `bowerloom.json`.
5. Write `bowerloom.lock.json` (when the plan has a lock change).

Write each file with the pattern of `applyManifestChange` (`packages/skill-manifest/src/add.ts:170-201`). Write a temporary file with `O_EXCL | O_NOFOLLOW` mode 0644 and flush it. Check that the target still has the planned `before` hash. Under the project lock, for a new file, `lstat` the target and require `ENOENT`, then `rename` the temporary file onto it. For an existing file, `rename`. A file that another program creates between the `lstat` and the `rename` is replaced. The project lock serializes Bowerloom writers. Bowerloom accepts this race because a link write can leave a second link after a crash, and that locks the project out (`CONFIG_UNSAFE`). Flush the folder. Read the file back. A read back that does not match gives `CONFIG_WRITE_UNCONFIRMED` for the config or `LOCK_WRITE_UNCONFIRMED` for the lock. A `before` hash that changed gives `STALE_APPROVAL`.

Crash recovery:

- A crash after step 4 and before step 5 leaves a config newer than the lock. The next `use` or `lock update` heals it (3.13). `unuse` drops an extra lock item but adds none. A frozen run refuses `LOCK_CONFIG_MISMATCH`, which is safe.
- A crash during step 3 follows the pending-record rules of `team adopt` (3.17).
- A leftover temporary file is removed at step 1 of the next run.

`applyConfigChange` reads no network. Under the project lock it re-reads `bowerloom.json`, the lock, `store.skills` and `store.authoring`, and the `localItemRows` hash of each added authored item. Any difference from the plan is `STALE_APPROVAL`. It writes `config.text` and `lock.text` from the approved plan after it parses each one again.

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
Without a token, GitHub allows about 60 requests an hour. Each item takes about 4 plus one per file.
To raise the limit, set BOWERLOOM_GITHUB_TOKEN (see bowerloom help store).
--commit <sha> records that commit of the store remote instead of the pushed commit of the current branch.
```

`lock verify`:

1. Read the lock (4.1 rules). Refuse `LOCK_MISSING`, `LOCK_UNSAFE`, `LOCK_INVALID`, `LOCK_LIMIT` as they apply.
2. Check that each `pin` passes `validateEntry` (`packages/skill-manifest/src/schema.ts:115`) and that its `id` equals the item `id`.
3. Check that each `authored.hash` equals `revisionOf(authored.files)`.
4. Read the config. If it is missing, refuse `LOCK_CONFIG_MISSING`. If the pairs differ, refuse `LOCK_CONFIG_MISMATCH`.
5. Print `bowerloom.lock.json is valid: <n> items.` and one line per item: `  <kind> <id>  <lock source>`. JSON format `bowerloom/lock-verify/v1beta1`: `{ format, valid: true, sha256, bytes, items: [{ kind, id, from, source: "pin"|"authored", label }] }`. `label` is the `<lock source>` text.

`lock update`:

1. Needs a config, else `CONFIG_ITEM_NOT_SELECTED`. With no store entry and no lock file, print `Nothing to lock.` and exit 0. With no store entry and a lock file, the plan writes a lock with empty lists.
2. The store must be valid. If it is absent: `STORE_NOT_FOUND`.
3. Select the items: each `--item <kind>:<id>` (it must be a store entry of the config, else `CONFIG_ITEM_NOT_SELECTED`), or all store entries.
4. Re-resolve each selected item from the live store. A pinned item copies the store entry. An authored item reads the live item with `localItemRows`. If its live hash equals its lock hash and `--commit` is not given, it keeps its lock item and reads no network. Otherwise, prove it (3.10) with `readStoreRepo(storeDir, commit)`. An item missing from the store refuses `STORE_ITEM_MISSING`. A lock item that has no counterpart in the config is handled in step 5.
5. Drop every lock item whose (kind, id) is not a store entry of the config (plan line `  <kind> <id>  removed`, result change `removed`). Keep every other unselected lock item. A lock that reads `LOCK_INVALID` is rebuilt from the config without `--item`. With `--item` it refuses `LOCK_INVALID`. `LOCK_UNSAFE` and `LOCK_LIMIT` refuse. Build the new lock text. Compare with the old.
6. Plan lines:

```text
Update bowerloom.lock.json from your store
  <kind> <id>  unchanged
  <kind> <id>  pin changed: <old> to <new>
  <kind> <id>  commit changed: <commit8> to <commit8>
  <kind> <id>  teams changed: <old> to <new>
  <kind> <id>  removed
  <kind> <id>  added
Network: reads api.github.com, to check the pushed copy of <n> items, about <r> requests to api.github.com.  (only when authored items are checked)
This changes bowerloom.lock.json only.
```

A change of the `teams` tag of a pinned or authored item counts as a change, and the item counts as stale (4.6). If nothing changes, print the plan with `Nothing to change.` and exit 0 without asking. The result format is `bowerloom/lock-update-result/v1beta1`.

Apply: under the project lock, write the lock (3.14 steps 1 and 5). A missing lock does not stop `lock update`. It creates the lock. It also brings a project that became shared later up to date.

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
5. Apply: Phase A fetches what is missing. For pinned items it is `fetchPin` (`packages/project-sync/src/apply.ts:97`) with the real acquirer. For authored items it is `fetchStoreGit` (new, in `store-git.ts`). Each item gets one transport. Each fetch checks the bound content key and that the host is in the approved list. Each runs under the cache lock for that item only. A fetched authored item whose `hash` differs from the lock refuses `LOCK_HASH_MISMATCH`. A fetched pin that differs refuses `SKILLS_SYNC_CONTENT_MISMATCH` (`apply.ts:115`). A network failure refuses `SKILLS_OFFLINE`. Then phases B and C run as today.
6. Project items install as usual. Holds (drift, a place taken) stay holds.
7. Teams install nothing. Frozen apply fetches each locked team that the store cache lacks into the store cache, so that `team adopt` can read it. In config mode, the agent projection of spec 01a lists only the project teams that `bowerloom.json` selects. The config must select `first-team` for it to appear. A store team projects no agents in beta.3. `team adopt` copies `agents/` with the team, and the next apply projects them.

How the code changes. `apply` stays network-free without `--frozen`:

- `packages/project-sync/src/apply-project.ts:132`: `offline: true` becomes `offline: !frozen`. `ApplyInput` gets `frozen?: boolean`.
- `apply-project.ts:172-175` and `:193`: for `frozen: true`, use the real acquirer (`productionAcquirer`, `packages/project-sync/src/deps.ts`). `NO_FETCH` stays for every other run.
- `ApplyPlan` and `SyncPlan` gain `frozen: boolean` (4.4).
- `apps/cli/src/apply.ts:71`: a plain apply keeps this line: `Network: none. Apply never fetches. A pin that is not cached yet needs bowerloom skills sync first.`. A frozen apply that fetches reads this line: `Network: reads <hosts> for <n> items, public and without credentials. Bytes must match their pins or bowerloom.lock.json.`. A frozen apply with nothing to fetch reads this line: `Network: none now. Every item is on this machine.`. Spec 07 changes `without credentials` for a run that uses a token.
- `apps/cli/src/apply.ts:21,88` (`APPLY_USAGE`, `parseHarness`): accept `--frozen` once. Giving it twice refuses `USAGE`.
- The sync review uses the same `Network:` line as the frozen apply: `Network: reads <hosts> for <n> items, public and without credentials. Bytes must match their pins or bowerloom.lock.json.`
- `apps/cli/src/sync.ts:~30` (`takeFlags`, `SYNC_USAGE`): accept `--frozen`. The pair `--frozen --offline` is allowed. If something needs fetching, the plan refuses `SKILLS_OFFLINE`.
- Plain `apply` and `up` never use `--frozen`. `tests/no-spawn.test.ts` must stay green.

In config mode, plain apply holds each uncached item with `resolvedFrom: 'lock'` (pinned or authored) with `SKILLS_OFFLINE`. The next step is `Run bowerloom apply --frozen, or bowerloom skills sync.` The check at `plan.ts:408` excludes such an item. Other uncached pins keep today's refusal.

Network binding. `ApplyPlan` gains `network: { hosts: string[] }`. It lists the hosts of the skills sub-plan. If a locked authored prompt installs or updates in a frozen apply, it adds `api.github.com`. In a frozen apply, phase A also runs `fetchStoreGit` for each such prompt before prompt phase B. In `apply-project.ts:150`, the filter becomes `create.push(...layout.missing.filter(p => (p !== layout.cacheRoot && p !== layout.storeCacheRoot) || needsFetch))`. The value `needsFetch` is true for any run where a pin or an authored item needs fetching. Any authored fetch also creates `cacheRoot`, which `withCacheLock` needs.

Locked authored items (pending decision, section 13, variant A built). A locked authored skill or prompt that the store cache lacks at plan time has `notices: null`. A skill also has no `allowed-tools` to show yet. Its plan line reads `install <kind>: <places> (not on this machine yet; Bowerloom shows what it can do after the fetch)`. Apply fetches it in phase A. The rule is the same for skills and prompts: hold only on a notice. A fetched `SKILL.md` that declares `allowed-tools` gives a notice. If the fetched bytes give any notice, apply installs nothing of that item and holds it with `ITEM_REVIEW_REQUIRED`. A skill without `allowed-tools` installs in the same run. The next step is `Run bowerloom apply --frozen again to review it.` The next plan reads the item from the cache and shows its `allowed-tools` or its notice.

`skills sync` (not `--offline`) also fetches every locked authored prompt that the store cache lacks into the store cache. It binds `api.github.com` and prints `  <id>  fetch prompt into the store cache [store, from the lock: github.com/<o>/<r>]`. It installs no prompt.

Error mapping. The table in 3.10 applies to every fetch in a frozen run. The step that fetches uses `LOCK_HASH_MISMATCH` for content errors, `SKILLS_OFFLINE` for network errors, `GITHUB_RATE_LIMITED` from the transport, and `SKILLS_SYNC_INTERRUPTED` for an abort.

### 3.17 `team adopt`

```text
bowerloom team adopt <id> [--approve <revision>] [--json]
```

Help text. The merged `TOPICS.team` is below. It holds the text of spec 04 with the lines of this spec. `team adopt --help` prints it (the branch at `main.ts:153`).

```text
Usage:
  bowerloom team create <name> [--profile engineer|founder|research] [--global] [--approve <revision>] [--json]
  bowerloom team adopt <id> [--approve <revision>] [--json]

Creates a team in .bowerloom/teams/<name>, from the project brief, with a lead, a maker and a reviewer.
The name is the team id: lower-case words joined by hyphens, such as research-desk. first-team is taken by setup.
The profile defaults to the one in the project brief.
--global creates the team in your store, ~/.bowerloom, and not in this project. The store holds definitions only.
A project picks store items with bowerloom use. The first --global write makes the store.
With --global a team is built from a fixed store brief and the profile you choose. It does not read a project brief.
team adopt copies a team from your store into this project, at .bowerloom/teams/<id>, and switches bowerloom.json to the project copy.
The project then owns the copy. Later changes in the store do not reach it. Edit the copy to fit the project.
team adopt also changes bowerloom.json and bowerloom.lock.json.
It shows the plan first. Agents pass --approve <revision> or --json. You and your agents own the files it makes.
It writes inside .bowerloom only, or inside your store with --global, except for team adopt. It starts no workers and runs nothing.
```

Recovery check. Run it before rules 1 and 2. Three facts make the check pass. The receipt registers team `<id>`. The folder `.bowerloom/teams/<id>` matches its receipt pins. The config still lists team `<id>` from the store. Then the plan has `create: null` and only steps (ii) and (iii) of the write order. Its first line is `Finish adopting team <id>.` A pending record is finished by the create path as today. The create finish path never adds a config entry for an id that the config lists from the store.

Rules:

1. Needs a config that lists the team `<id>` with `source: "store"`. Else `CONFIG_ITEM_NOT_SELECTED`.

   **Amendment, 2026-10-22, sageadvicellc/bowerloom#100:** decision 1 on #80 (https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6351449744, variant A). A store team that the config does not list, or a project with no config, is adopted too: one plan copies the team from the live store and adds `{ id, source: "project" }`, creating `bowerloom.json` as `use` does. With no store it refuses `STORE_NOT_FOUND`; a store that does not define the team refuses `STORE_ITEM_NOT_FOUND`. Store skills and prompts tagged to the team stay store items; the plan names them in one line, and names tagged items the store cannot use with a reason. A team the config lists from the project keeps `CONFIG_ITEM_NOT_SELECTED`, with the message `bowerloom.json already lists team <id> from the project.` A failure after the copy says `The team was copied. Run bowerloom team adopt <id> again to finish.`, and the next run finishes from the copy that matches its receipt pins. Each area folder of the store (`skills`, `prompts`, `teams`) must be a real folder inside the store. `readStoreDefinitions` checks it, so `use`, `lock update`, `team adopt`, and the resolver behind `skills sync`, `apply`, and `up` refuse `STORE_UNSAFE` and name the folder. Some readers list the store anyway. `ls --global` reads the store without these definitions. The tolerant resolver behind `ls` and `status` shows each store item as missing and names the code. `cache list` and `cache prune` treat the store as unread. The step of `up` that looks for a store team skips the store.
2. `.bowerloom/teams/<id>` must not exist, else `TEAM_EXISTS`. One exception applies. The pending record names team `<id>` and `pendingState` is `landed`. Then the create part is the finish of that record (`finish` set, `item` null), plus the config and lock change. `first-team` refuses `TEAM_ID_RESERVED`.
3. Bowerloom reads the source of the bytes only. It uses no network. The source is the live store folder `teams/<id>` for a valid store that holds the team. Otherwise it is `<store-cache>/<key>` (3.11) of the lock item of the team. With neither, refuse `STORE_ITEM_MISSING`. The next step is `Run bowerloom apply --frozen, then bowerloom team adopt <id> again.`
4. The `create` plan reads the source tree with `readTree` (`packages/project-authoring/src/files.ts:64`). The paths relative to the team folder become the planned files `teams/<id>/<path>`. It compiles the source `team.yaml` with `compileCrew(file)` (`packages/crew/src/index.ts:94`) to get `compiledCandidate`.
5. The plan is `AdoptPlan { format: 'bowerloom/team-adopt-plan/v1beta1'; create: CreatePlan | null; config: ConfigChangePlan; revision }`. The revision is `sha256(canonicalJson({ create: create?.revision ?? null, config: config.revision }))`. The value `create` is `planCreate({ kind: 'team', project, name, copyFrom: { root } })`, with `CreatePlan.config` null. The value `config` is `planConfigChange` with op `adopt`. `normalizeInput` (`create.ts:83-99`) allows the key `copyFrom` for teams only. The plan reads the tree from `copyFrom.root` and does not call `scaffoldTeam` (`create.ts:245`). The staged copy is compiled again and must give the same `compiledCandidate`, as `applyCreate` already requires.
6. The receipt entry has `teams: []` and the file pins of the copied bytes.
7. Config change: the team entry changes from `source: "store"` to `source: "project"`. Bowerloom removes `<id>` from the `via` list of every entry. An entry whose `via` becomes empty loses the `via` key and stays listed, as a direct pick. The plan has one line for each such entry: `bowerloom.json: <kind> <x> is now picked directly`.
8. Lock change: the lock item of the team is removed.

Result: `bowerloom/team-adopt-result/v1beta1 { format, planRevision, receipt: AuthoringReceipt | null, config: ConfigChangeResult, executionAuthorized: false }`.

CLI. `apps/cli/src/adopt.ts` runs both parts under one `withProjectLock`.

Write order:

1. The create path, unchanged: the pending record, the staging, the move into `.bowerloom/teams/<id>`, the receipt, and the removal of the pending record.
2. `bowerloom.json`.
3. `bowerloom.lock.json`.

A missing `.bowerloom` is created first (3.4). A crash after the files move and before the receipt leaves the pending record. The next `team adopt <id>` finds it and finishes it, as `create` does. A crash after the receipt and before step 2 or 3 is caught by the recovery check. A pending record does not block another create command. The code at `create.ts:187-198` settles, finishes, or discards the record. If the record and the receipt or the files on disk disagree, the refusal is `AUTHORING_PENDING`.

Plan lines:

```text
Finish adopting team <id>.                                                          (only for a recovery plan, as the first line)
Create .bowerloom (records of the copies). Its contents are git-ignored.            (only when missing)
Adopt team <id> from the store
  Copies teams/<id> (<n> files) to .bowerloom/teams/<id>
  Registers it in .bowerloom/authoring/receipt.json
bowerloom.json: team <id> changes from store to project
bowerloom.json: <kind> <x> is now picked directly                                  (one line per entry that loses its last via)
bowerloom.lock.json: removes team <id>                                              (only when the lock lists it)
The project now owns this copy. Later store changes do not reach it.
```

The plan reads no network.

### 3.18 `sync` and `apply` plans and results

Plan lines and result lines gain a source tag. `itemLine` (`apps/cli/src/sync.ts:42-58`) and `promptLine` (`apps/cli/src/apply.ts:45-58`) append two spaces and `[store]` or `[project]` to the first line of each item. Examples:

```text
  house-style  install pinned npm @tanstack/db-skills@0.0.1:skills/tanstack-db/collections  [store]
  weekly-update  install prompt: .claude/commands/weekly-update.md and .agents/skills/prompt-weekly-update  [store]
  local-tool  up to date  [project]
```

A pinned store skill line ends `[store]` for `resolvedFrom: store`. For `resolvedFrom: lock`, it ends `[store, from the lock: npm <package>@<version>]` or `[store, from the lock: github.com/<o>/<r>]`. An authored item uses `[store, from the lock: github.com/<o>/<r>]`, with the store remote. When an item is held for `STORE_ITEM_MISSING`, the usual `held (<code>)` line shows the tag too.

Other lines:

- The first line of `renderSyncReview` reads `Sync skills for <harnesses>` in config mode (it reads `Sync skills from .bowerloom/skills.json for ...` in legacy mode). The empty case reads `Nothing is selected to sync yet.` in config mode.
- `renderApplyReview` replaces `Nothing in .bowerloom/skills.json or .bowerloom/prompts to apply yet.` with `Nothing is selected to apply yet.` in config mode.
- If a lock exists but disagrees with the live store, add `The lock is out of date for <ids>. Run bowerloom lock update.`
- If the project is shared, has store items, and has no lock, add `This project is shared but has no bowerloom.lock.json. Run bowerloom lock update.`
- In a frozen run, add `Frozen: installing only what bowerloom.lock.json records.`
- The note `Review .bowerloom/prompts/<id>.md` for a prompt notice names `~/.bowerloom/prompts/<id>.md` for a store prompt. For a prompt that a lock fetch supplied, it names the store remote `github.com/<o>/<r>`.
- `SYNC_PLAN_FORMAT` becomes `bowerloom/skills-sync-plan/v1beta2`, `APPLY_PLAN_FORMAT` becomes `bowerloom/project-apply-plan/v1beta2`, `APPLY_RESULT_FORMAT` becomes `bowerloom/project-apply-result/v1beta2`. `SYNC_RESULT_FORMAT` becomes `bowerloom/skills-sync-result/v1beta2` and its entries gain `origin`.

### 3.19 `up`

`up` keeps its steps. Changes:

- `resolveTeam` (`apps/cli/src/up.ts:110-115`) and `firstTeamName` (`:102-108`): with no `.bowerloom/brief.json`, do not call `firstTeamName`. Teams come from the config and the authoring receipt.
- In config mode a team must be listed in the config. If `--team <name>` names a team that is not listed but is defined in the store, refuse `TEAM_NOT_SELECTED` with the next step `bowerloom use team <name>`. If it names a project team that is not listed, refuse `TEAM_NOT_SELECTED` with `bowerloom use team <name> --project`. If it names no team, the `team` step creates a project team (`team create`), which uses `storeBrief` when `brief.json` is missing.
- `up.ts:130` (`readManifestState(project.dir).file !== null`): replace it with "the effective skill list is not empty", from the resolver. In config mode, any selected skill makes `up` plan the sync step.
- `planSync` and `planProjectApply` inputs get `home`.
- On a fresh clone with a lock and no store, the sync step fetches lock-resolved items. It is a sync plan, with hosts bound. For a missing or disagreeing lock, `up` prints one note: `bowerloom.lock.json is missing` or `bowerloom.lock.json does not match bowerloom.json`.
- `up` never uses `--frozen`.

### 3.20 `ls`, `status`, and `skills check` in config mode

`ls` (format `bowerloom/ls/v1beta2`, defined in spec 04):

- In config mode, `listedBy` is `config`. The lists come from the config entries, in id order. Each item has `source`, `via`, and `state`: `ok`, `missing` (the definition is not found), or `duplicate` (not produced by a valid config, reserved for the pair named by `CONFIG_DUPLICATE_ID`).
- Spec 04 already gives every item the fields `locked` and `resolvedFrom`. This spec adds values only. `locked` is a boolean or null. It is null for project items and for a project with no lock. `resolvedFrom` is `store`, `lock`, or `project`.
- `unselected` lists ids that the project defines and the config does not list.
- If the config lists store entries and the store is refused (a `STORE_*` code), `ls` does not refuse. Every store item gets state `missing`, and `ls` prints `The store cannot be used (<CODE>). Run bowerloom store status.` after the sections. The exit code is 0.
- Text output keeps the shape of spec 04. Add `  (missing)` after the source of a missing item. After the sections, add a line for a non-empty `unselected`: `Defined here but not listed in bowerloom.json: <ids>`.
- In legacy mode nothing changes from spec 04, except that `locked` is null and `resolvedFrom` is `project` for every item.

`status` (format `bowerloom/project-status/v1beta2`, spec 03): the `config` object gains:

| Field | Type | Meaning |
|---|---|---|
| `store` | string | `not-needed` (no store entries), `ok` (valid store), `absent`, or `refused` |
| `storeCode` | string or null | The `STORE_*` code for `store: refused`. Otherwise null. |
| `items` | array | `{ kind, id, source, via, state }`, state `ok`, `missing`, or `duplicate` |
| `unselected` | object | `{ skills, prompts, teams }`, lists of ids |
| `lock` | object | `{ state, code, sha256, bytes, items, shared }` (4.6) |

New drift kinds: `lock-invalid` (the lock is present and fails reading) and `lock-orphan`. Both go in `Drift.kind` (`packages/startup/src/index.ts:58`).

`skills check` in config mode checks the project `skills.json` (if any) and the store pinned entries that the config selects (offline). Each row ends with `  [store]` or `  [project]`. The format stays `bowerloom/skills-manifest-check/v1beta2`. Spec 04 already gives each skill the field `source`. This spec adds the value `store` for a selected store entry. With no `skills.json` and no selected store pins in a config project, print `skills.json is valid: 0 skills` instead of refusing `MANIFEST_NOT_FOUND`. In legacy mode `MANIFEST_NOT_FOUND` stays.

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

When there is a problem or no repository, add a line `To fix this, run these commands yourself:` and only the commands for that problem. Here `<branch>` is the current branch name from `.git/HEAD`. If the store has none, print `<branch>`.

```text
none:
    cd ~/.bowerloom
    git init
    git add -A
    git commit -m "Store"
    git remote add origin https://github.com/<owner>/<repo>.git
    git push -u origin <branch>
no-origin:
    cd ~/.bowerloom
    git remote add origin https://github.com/<owner>/<repo>.git
    git push -u origin <branch>
unsupported-remote:
    cd ~/.bowerloom
    git remote set-url origin https://github.com/<owner>/<repo>.git
unpushed:
    cd ~/.bowerloom
    git push -u origin <branch>
unreadable: no commands
```

**Amendment, 2026-10-22, sageadvicellc/bowerloom#100:** after `git add -A` the `none` block prints `git rm -r -q --cached --ignore-unmatch folders`, so the records never enter the first commit. When the store's `.gitignore` misses lines, every block prints a `printf ... >> .gitignore` step right after `cd ~/.bowerloom`. When the file is a link or not a plain file the person owns, a line before the block names it to fix first.

The block ends with the line `A private repository needs BOWERLOOM_GITHUB_TOKEN on each machine that fetches.`

JSON `git`: `null` for a store state other than `store`. Otherwise `{ present: boolean, problem: string|null, remote: string|null, branch: string|null, head: string|null, pushed: string|null, ahead: "unknown"|"yes"|"no" }`. `ahead` has three values. `no` means `head === pushed`. `yes` means both are set and differ. `unknown` is every other case.

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
- `pin`: a complete `skills.json` entry of kind `npm` or `git`. `validateEntry` checks it (`packages/skill-manifest/src/schema.ts:115`), and its `id` equals the item `id`. The writer serializes it with `serializeEntry`, which spec 06 exports from `schema.ts:169`. It carries its own `teams` tag and its own integrity: `integrity` (npm) or `tree` and `pathTrees` (git), `metadataSha256`, and the `sha256` of each file (`schema.ts:26-28`). The cache key derives from it with `entryRequest(entry).digest` (`packages/project-sync/src/cache-index.ts:55`). The lock stores no key.
- `authored.remote`: `https://github.com/<owner>/<repo>`, the normal form of 3.10. No `.git`, no credentials, no port.
- `authored.commit`: 40 lower-case hex characters.
- At most 8 distinct `authored.remote` values in one lock. More gives `LOCK_LIMIT`.
- `authored.path`: `skills/<id>`, `prompts/<id>.md`, or `teams/<id>`, with the same `<id>` as the item. It is relative to the repository root. The store folder is the repository root.
- `authored.tree`: 40 lower-case hex characters, the git object id at `path` in `commit` (a tree for a folder, a blob for a prompt).
- `authored.files`: a sorted list of `{ path, sha256, bytes }`. `path` is relative to the item folder (for a prompt, `<id>.md`). Sorted by `path` in byte order. An empty list or an unsorted list gives `LOCK_INVALID`. More than 126 rows, a file over 65536 bytes, or a total over 2097152 bytes gives `LOCK_LIMIT`. `sha256` is 64 lower-case hex characters.
- `authored.hash`: 64 hex characters. It must equal `revisionOf(files)`. A different value gives `LOCK_INVALID`.
- `authored.teams`: optional. A sorted list of team ids. It is the item's team tag in the store. It is not allowed on a team item. Missing means every team.
- The file is at most 4 MiB (4194304 bytes). Over that, `LOCK_LIMIT`.

`parseLock` runs `strictJson(text, 4194304)` (`packages/codex-adapter/src/safe.ts:19`) on the file, then `captureSkillData` on each item separately. No byte order mark, valid UTF-8, no duplicate keys, no unknown keys. Any failure is `LOCK_INVALID`, except size, which is `LOCK_LIMIT`, and an unsafe file, which is `LOCK_UNSAFE`.

Reading the file uses the same guards as the config reader (spec 03, 4.2). The file must be a regular file, not a link. It has one hard link and the user owns it. It has no group or world write permission. It is at most 4 MiB. Open it with `O_NOFOLLOW` and check the size after the read. Any guard failure is `LOCK_UNSAFE`.

Writing: `JSON.stringify(value, null, 2) + '\n'`, keys in the order shown, lists sorted. The writer parses its own output before it writes.

TypeScript types (`packages/project-config/src/lock.ts`):

```ts
export const LOCK_FILE = 'bowerloom.lock.json' as const;
export const LOCK_FORMAT = 'bowerloom/lock/v1beta1' as const;
export const LOCK_LIMITS = Object.freeze({ bytes: 4194304, skills: 128, prompts: 128, teams: 32, files: 126, fileBytes: 65536, totalBytes: 2097152 });
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

- A lock `pin` is a `skills.json` entry. The same validation and the same cache key apply. Two projects that hold one pin share one cache entry. It does not matter which project took the pin from a lock.
- An authored item has its own cache, `store-cache`, keyed by `<kind>-<id>-<hash>` (3.11).
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

- `mode` is `legacy` for `configPresent: false`.
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
- `store`: `{ dir: string; identity: DirectoryIdentity; skills: { sha256: string; bytes: number } | null; authoring: { sha256: string; bytes: number } | null } | null`. Null in legacy mode and in frozen mode. Null for a plan whose selected items all come from elsewhere.
- `privateState.storeCacheRoot`: string.
- `network: { hosts: string[] }` on `ApplyPlan`. It holds the hosts of the skills sub-plan. A locked authored prompt that installs or updates adds `api.github.com` (3.16).
- `SyncItem` gains `origin: 'store' | 'project' | null` (null for an orphan), `via: string[]`, `resolvedFrom: 'store' | 'lock' | 'project'`, and `lockPin: AuthoredPin | null`. For an authored item, `requestDigest` is its `hash`.
- `StateLayout` (`plan.ts:142`) gains `storeCacheRoot = join(stateRoot, 'store-cache')`. Create it like `cacheRoot` (`plan.ts:411`), and only for an authored item that needs fetching. Apply also creates `cacheRoot` for an authored item that needs fetching. It is a shared folder, bound by path only (`bindPrivateState`, `plan.ts:353-355`).
- `PromptItem` (`prompts.ts:64-82`) gains `origin`, `via`, `resolvedFrom`, `lockPin`.
- The revision binds every field above. `syncBinding` (`plan.ts:361-366`) keeps dropping what another run can change: `state: cached`, `cacheOperationId`, `cache`, `network.required`. It also drops whether the store cache holds an authored item now. It keeps the `hash`.
- `network.hosts` is computed from the kinds of items that install or update (`plan.ts:415`). It adds `api.github.com` for every item with `resolvedFrom: 'lock'` and authored that installs or updates, whether or not the store cache holds it now. A plain apply and `--offline` approve no host.
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
  bowerloomFolder: 'present' | 'create';   // create only for op 'adopt'
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

`bowerloomFolder` is `create` only for `op: 'adopt'`. The revision is `sha256(canonicalJson(body))` where body is the plan without `revision`. `canonicalJson` is in `packages/contracts/src/index.ts:137`.

### 4.6 Status additions

`config.lock`:

| Field | Type | Meaning |
|---|---|---|
| `state` | string | `not-used`, `absent`, `valid`, `stale`, `invalid`, `mismatch`, `orphan` |
| `code` | string or null | The `LOCK_*` code for `invalid` or `mismatch` |
| `sha256`, `bytes` | string or null, number or null | Of the lock file |
| `items` | number | Number of lock items |
| `shared` | boolean | The result of `isSharedProject` |

State rules:

- `not-used`: no lock file, and the project is not shared or has no store entries.
- `absent`: no lock file, the project is shared, and the config lists store entries.
- `valid`: the lock reads, agrees with the config, and every authored item equals the live store item (or the store is absent).
- `stale`: the lock agrees with the config but a live store item differs from its lock item. A different `teams` tag counts as a difference.
- `invalid`: the lock fails reading. `code` is set.
- `mismatch`: the lock reads but its pairs differ from the config. `code` is `LOCK_CONFIG_MISMATCH`.
- `orphan`: a lock file and no config.

The `stale` test reads the live store item and compares `hash` and `teams` for authored items, and compares the entry for pinned items. It uses no network.

### 4.7 Engine sources

See 3.12 for the exact types.

### 4.8 Result formats

- `bowerloom/config-change-result/v1beta1`: section 4.5.
- `bowerloom/lock-verify/v1beta1`: section 3.15.
- `bowerloom/lock-update-result/v1beta1`: `{ format, planRevision, updated: [{ kind, id, change: "added"|"pin"|"commit"|"teams"|"removed"|"unchanged" }], sha256, bytes, executionAuthorized: false }`.
- `bowerloom/project-apply-result/v1beta2` and `bowerloom/skills-sync-result/v1beta2`: as v1beta1 plus `origin` and `resolvedFrom` on each applied, held, and up-to-date entry.

### 4.9 Create plan

`CreatePlan` (`packages/project-authoring/src/create.ts:40-73`) gains:

- `bowerloomFolder: 'present' | 'create'`,
- `config: { before: Read | null; after: Read; text: string } | null` (null for a project with no config),
- `reads.config: Read | null`.

`CreatePlan.bowerloom` is `{ device, inode } | null` (null for `bowerloomFolder: create` and for the store scope).

## 5. Refusal codes

All messages are fixed and carry no path or name. A message can add the checked ids named in the table.

| Code | Cause | Next step |
|---|---|---|
| `STORE_ITEM_NOT_FOUND` | `use` or `team adopt` named an item the store does not define (amendment, 2026-10-22, sageadvicellc/bowerloom#100: the message is `The command named an item that the store does not define.`). | `bowerloom ls --global` |
| `STORE_ITEM_MISSING` (held) | A listed store item is not in the live store and not in the lock. | Create it with `bowerloom <kind> create <id> --global`, or run `bowerloom unuse <kind> <id>`. |
| `STORE_ITEM_NOT_SHAREABLE` | A store item must be locked in a shared project, and a teammate cannot fetch it. The message adds the cause (3.10). It also covers a file that a lock cannot record. | Give the store a remote and push it. `bowerloom store status` shows the commands. Or adopt a team into this project with `bowerloom team adopt`. |
| `STORE_REMOTE_PRIVATE` | The store repository answered 404. It is private or does not exist. | Check the repository name and that the repository is public. |
| `CONFIG_ITEM_SELECTED` | `use` named an item the config already lists from that source. | `bowerloom ls` |
| `CONFIG_ITEM_NOT_SELECTED` | `unuse` or `lock update --item` named an item the config does not list, or there is no config. Amendment, 2026-10-22, sageadvicellc/bowerloom#100: `team adopt` raises it only for a team the config lists from the project. | `bowerloom ls` |
| `CONFIG_ITEM_MISSING` (held) | A listed project item has no definition in the project. | `bowerloom <kind> create <id>`, or `bowerloom unuse <kind> <id>`. |
| `CONFIG_WRITE_UNCONFIRMED` | `bowerloom.json` was written but changed before it was read back. | `git diff bowerloom.json` |
| `TEAM_NOT_SELECTED` | `up --team` named a team the config does not list. | `bowerloom use team <id>` |
| `LOCK_MISSING` | A frozen run needs a lock and the file is absent. | `bowerloom lock update` on a machine with the store. |
| `LOCK_INVALID` | The lock does not parse, has conflict markers, or a hash does not match its files. | `bowerloom lock verify`. For a merge conflict, take one side for each item, then run it. |
| `LOCK_UNSAFE` | The lock is a link, shared, over one link, or unreadable. | `ls -l bowerloom.lock.json` |
| `LOCK_LIMIT` | The lock passes a limit. The limits are 128 skills, 128 prompts, 32 teams, and 126 files in an item. They are also 65536 bytes in a file, 2097152 bytes in an item, and 4 MiB in the lock. | `bowerloom lock verify` |
| `LOCK_CONFIG_MISSING` | A lock exists with no `bowerloom.json`, or a frozen run has no config. | `bowerloom use skill <id>`, or restore `bowerloom.json` from version control. |
| `LOCK_CONFIG_MISMATCH` | The lock and the config list different store items. The message names up to 8 `kind id` pairs. | `bowerloom lock update` |
| `LOCK_HASH_MISMATCH` | Fetched bytes of an authored item do not match the lock hash. | `bowerloom lock verify`, then ask the owner of the store to run `bowerloom lock update`. |
| `LOCK_STORE_NOT_PUSHED` | The pushed copy of an item differs from the item in your store. | Commit and push the store, then run the command again. |
| `LOCK_COMMIT_UNREACHABLE` | The commit is not on the store remote. | Push the store, or pass `--commit <sha>` of a pushed commit. |
| `LOCK_WRITE_UNCONFIRMED` | The lock was written but changed before it was read back. | `git diff bowerloom.lock.json` |
| `GITHUB_RATE_LIMITED` | `api.github.com` answered 429, or 403 with no requests left. | Wait until the limit resets, at most an hour. Without a token, set BOWERLOOM_GITHUB_TOKEN to raise the limit (see bowerloom help store). |
| `ITEM_REVIEW_REQUIRED` (held) | A lock-fetched authored skill declares `allowed-tools`, or a lock-fetched prompt gives a notice. Apply installed nothing of it. | Run bowerloom apply --frozen again to review it. |

`SKILLS_OFFLINE` is not in this table. The next step travels in the refusal message at each call site. The `REFUSALS` entry is unchanged.

Message rule. The fixed message of a code is its Cause cell, written as plain sentences. It names no path. It names an id only where the table says so. In `REFUSALS` (`apps/cli/src/human.ts:224`) the `next` text is the Next step cell. The `sentence` of each code is in the list below.

Fixed messages that differ from the Cause cell:

- `STORE_ITEM_NOT_SHAREABLE`: `This project is shared, and a teammate cannot fetch this store item.` Then one sentence from the table in 3.10. For a file that a lock cannot record, the sentence is `The item holds a file that a lock cannot record.` For a size over a limit, it is `The item is larger than a lock can record.`
- `LOCK_CONFIG_MISMATCH`: `bowerloom.lock.json and bowerloom.json list different store items.` Then up to 8 `kind id` pairs. A longer list ends with `and <n> more`.

The `sentence` of each new code in `REFUSALS`:

- `STORE_ITEM_NOT_FOUND`: `Bowerloom picks only items that your store defines.`
- `STORE_ITEM_MISSING`: `A listed store item is not in your store and not in the lock, so Bowerloom cannot install it.`
- `STORE_ITEM_NOT_SHAREABLE`: `A shared project needs every store item to be fetchable by your team.`
- `STORE_REMOTE_PRIVATE`: `GitHub does not show this repository without a token. It may be private or may not exist.`
- `CONFIG_ITEM_SELECTED`: `This project already picks that item from that source.`
- `CONFIG_ITEM_NOT_SELECTED`: `Bowerloom changes only items that bowerloom.json lists.`
- `CONFIG_ITEM_MISSING`: `bowerloom.json lists a project item that the project does not define.`
- `CONFIG_WRITE_UNCONFIRMED`: `bowerloom.json was written, but it changed again before Bowerloom could read it back.`
- `TEAM_NOT_SELECTED`: `up installs for a team only if bowerloom.json lists it.`
- `LOCK_MISSING`: `A frozen install needs bowerloom.lock.json, and there is none.`
- `LOCK_INVALID`: `Bowerloom reads the lock strictly, so a hand edit or a merge conflict can break it.`
- `LOCK_UNSAFE`: `Bowerloom will not trust a lock file that links or other users can change.`
- `LOCK_LIMIT`: `This beta keeps the lock small: 128 skills, 128 prompts, 32 teams, and 4 MiB at most.`
- `LOCK_CONFIG_MISSING`: `A lock and a config go together, and one of them is missing.`
- `LOCK_CONFIG_MISMATCH`: `A frozen install must match bowerloom.json exactly, as npm ci does.`
- `LOCK_HASH_MISMATCH`: `Bowerloom installs only bytes that match the lock, so it stopped before any change to the project.`
- `LOCK_STORE_NOT_PUSHED`: `A teammate can fetch only what you pushed, and your store differs from the pushed copy.`
- `LOCK_COMMIT_UNREACHABLE`: `The lock needs a commit that GitHub has, and GitHub does not have this one.`
- `LOCK_WRITE_UNCONFIRMED`: `bowerloom.lock.json was written, but it changed again before Bowerloom could read it back.`
- `GITHUB_RATE_LIMITED`: `GitHub allows about 60 requests an hour without a token and about 5,000 with one.`
- `ITEM_REVIEW_REQUIRED`: `Bowerloom shows what an item can do before it installs it.`

Amended by #101 (round 1 of its reviews, Hanna's choice C on #97: an errors.md row uses the words the terminal prints). The docs words were kept and the CLI changed to match them:

- `STORE_REMOTE_PRIVATE`: `GitHub does not show this repository without a token. It is private, or it does not exist.`
- `CONFIG_WRITE_UNCONFIRMED`: `bowerloom.json was written, but it changed again before Bowerloom read it back.`
- `TEAM_NOT_SELECTED`: `up installs only the teams that bowerloom.json lists.` Its next step is `bowerloom use team <id>, or add --project for a team this project defines`.
- `LOCK_WRITE_UNCONFIRMED`: `bowerloom.lock.json was written, but it changed again before Bowerloom read it back.`
- `SKILLS_OFFLINE` (an existing code), amended again in round 4: the fixed message is `This run needs a fetch that did not happen. Nothing in the project changed.` The sentence is `A pin or a lock item needs a fetch, and this run did not fetch it. The message says why.` Each raise site carries the next step of its real cause. A transport failure gets `Connect to the network and run the command again.` A wrong answer of the registry gets `Run the command again later. If it fails again, check that the version or commit of the pin still exists on its registry.` A pin that needs more requests than Bowerloom makes for one pin gets `Check with bowerloom skills check that the pin names the package or commit you expect. If it does, report the code and the output of bowerloom --version.` An address that is not public gets `Check the DNS or proxy configuration of this machine.` Any other fetch code, and an error with no code, get `Run the command again. If it fails again, report the code and the output of bowerloom --version.` The flag --offline gets `Run the command again without --offline.` Plain apply gets `Run bowerloom skills sync, then bowerloom apply.` An approved plan that names no host for the fetch gets `Run the command again without --offline and without --approve, to see a plan that fetches it.` A fetch plan that changed is STALE_APPROVAL. The table step, for an error with none, is `After --offline, run the command again without --offline. After plain apply, run bowerloom skills sync, or bowerloom apply --frozen.`
- Round 2: every cause of `STORE_ITEM_NOT_SHAREABLE` carries its own next step. For `file` and `size`, the step names the file or folder and its fix, such as `Run chmod a-x ~/.bowerloom/<path>.` for an execute bit. A path that is not plain is not named. The step then names the item folder. In a project that is not shared, `lock update` says `A lock records this item, and a teammate cannot fetch it.` in place of `This project is shared, and a teammate cannot fetch this store item.`
- Round 3: the sentence of `STORE_ITEM_NOT_SHAREABLE` is `Each store item that a lock records must be fetchable by your team.` and its table step is `Each cause prints its own next step. bowerloom store status shows the git state of the store.` A store fault keeps its code and its next step through the checks at apply time, in `use` and `store migrate` alike, and in `cache list`. Round 4 (decided): a store fault found at approval time surfaces as it is, never as STALE_APPROVAL, because once the file is fixed the approved plan is unchanged and the same --approve works. STALE_APPROVAL stays for real plan changes.
- Round 2: the sentence of the cause `no-origin` is `The git repository of the store has no remote named origin.`
- Round 2 (decided): `use` takes `--max-github-requests <n>`, 1 to 5000, as `apply` and `skills sync` do. The next step of `GITHUB_REQUEST_BUDGET` names `apply`, `skills sync`, and `use` for the flag, `lock update` for `--item`, and `store migrate` for fewer items.

Existing codes keep their meaning. These are the ones used here: `PROJECT_NOT_FOUND`, `TEAM_EXISTS`, `TEAM_ID_RESERVED`, `AUTHORING_PENDING`, `STALE_APPROVAL`, `USAGE`, `SKILLS_SYNC_CONTENT_MISMATCH`, `MANIFEST_NOT_FOUND`, and `PROJECT_BRIEF_INVALID`. The `STORE_*` and `CONFIG_*` codes of spec 03 keep their meaning too.

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
- `packages/project-config/src/git.ts`: `readStoreRepo(storeDir, commit)` (3.10) and `normalizeRemote(url)`.
- `packages/project-config/src/write.ts`: `writeGuardedFile(folder, name, text, beforeSha256, held, tempPrefix)`. It is the pattern of `applyManifestChange` (`packages/skill-manifest/src/add.ts:170-201`) generalized. It writes a temporary file with `O_EXCL | O_NOFOLLOW` mode 0644, flushes it, and rechecks the target's hash. Under the project lock, for a new file, it runs `lstat` on the target, requires `ENOENT`, and runs `rename`. For an existing file, it runs `rename`. A file that another program creates between the `lstat` and the `rename` is replaced. The project lock serializes Bowerloom writers. Then it flushes the folder and reads back.
- `packages/project-sync/src/resolve.ts`: `resolveProject` and the types (4.3). It also holds `readStoreDefinitions(store)`. That function reads the store skills from the store `skills.json`, with `readManifestState(storeTarget(dir))` and `STORE_MANIFEST_LIMITS` (spec 04). It reads the store prompts and teams from the store authoring receipt, with `readAuthoringState(storeDir)` (`packages/project-authoring/src/state.ts:121`). An item exists only with its folder or file present.
- `packages/project-sync/src/change.ts`: `planConfigChange`, `applyConfigChange`, `planLockUpdate`, `applyLockUpdate`, and `localItemRows(storeDir, kind, id)`. The function `localItemRows` walks the item with `folderNames` and reads each file once with `readGuarded` (`files.ts:40`). It checks the text rules on those bytes and hashes them. It removes the item path prefix from each path. For a prompt the one path becomes `<id>.md`. An `AUTHORING_UNSAFE_PATH` becomes `STORE_ITEM_NOT_SHAREABLE` with `The item holds a file that a lock cannot record.` The sentence also covers these faults. The file fails `skillFilePath`, is empty, starts with a byte order mark, is not UTF-8, or has an execute bit. All of this happens before any network read. Size limits keep the sentence `The item is larger than a lock can record.` The store sources and the fetch apply the same file rules. `change.ts` also maps the outcomes of `proveAuthored`: `not-pushed` becomes `LOCK_STORE_NOT_PUSHED`. The outcome `commit-missing` becomes `STORE_REMOTE_PRIVATE` for a commit from the ref, and `LOCK_COMMIT_UNREACHABLE` for a commit from `--commit`. It maps transport errors with the table in 3.10.
- `packages/skill-manifest/src/resolve-store-git.ts`: `AuthoredPin` (the type of 4.1), `fetchAuthored(transport, { remote, commit, kind, id }, signal)` (3.11), and `proveAuthored(transport, { remote, commit, kind, id }, localHash, signal)`. The function `proveAuthored` returns `{ outcome: 'proved'; pin: AuthoredPin } | { outcome: 'not-pushed' } | { outcome: 'commit-missing' }`. It throws only manifest refusals. `packages/project-sync/src/change.ts` maps the outcomes (see the `change.ts` bullet). It does not read the store. The caller passes `localHash`.
- `packages/project-sync/src/store-git.ts`: `fetchStoreGit(item, roots, approvedHosts, deps)`, `writeStoreCache`, `readStoreCache`, and the `.prune-` helper for spec 09.
- `apps/cli/src/use.ts`: `runUseCommand(args, cwd, home, write, io, env)` for `use` and `unuse`. It also prints the `Copies stay in ...` line of 3.7. The CLI computes the places with `itemSurfaces` and `promptSurfaces`. They are not part of the plan JSON.
- `apps/cli/src/lock.ts`: `runLockCommand(args, cwd, home, write, io, env)` for `lock verify` and `lock update`.
- `tests/support/fake-network.ts`: a route value can be an object `{ "status": <n>, "headers": { "<name>": "<value>" }, "file": <path or null> }`. A string value stays a 200 with that file.
- `tests/support/fake-github-repo.ts`: a helper for tests. `buildFakeRepo(owner, repo, files: Record<string, string>, commit)` computes real git object ids for blobs and trees, as `resolve-git.ts:36-39` does. The blob id is SHA-1 of `blob <len>\0<bytes>`. It returns `{ commit, tree, routes }`. `routes` maps each `https://api.github.com/repos/<o>/<r>/git/...` URL to a fixture file. CLI tests pass it to `tests/support/fake-network.ts` through `TEST_FAKE_NETWORK_PLAN`.
- Test files in section 10.

Change:

- `packages/skill-manifest/src/resolve-git.ts:33-70`: add `export` to `Row`, `treeId`, `listing`, `proveRecursive`, `blob`, `unsafeKind`. No body changes.
- `packages/skill-manifest/src/schema.ts:169`: export `serializeEntry`. The lock writer serializes `pin` with it. The function `validateEntry` is at `schema.ts:115`.
- `packages/project-sync/src/plan.ts`:
  - `SyncInput` (line 45): add `home: string` and `frozen?: boolean`.
  - `SyncPlan` (line 78) and `SyncItem` (line 56): the fields of 4.4. `SYNC_PLAN_FORMAT` (line 38): `v1beta2`.
  - `requireTeam` (line 111): in config mode check the config team list.
  - `StateLayout` and `stateLayout` (lines 142 and 157): add `storeCacheRoot`.
  - `sameOrigin` (line 195): the family rule of 3.12.
  - `classify` (line 244): accept the resolved item. At line 253, `readLocalSkill(dir, 'skills/' + id, ...)` uses the store root for an item that resolves from the live store. For an item that resolves from the lock, the expected files come from `lockPin.files`. A held item (no entry) is built without calling `classify`. The drift hint at line 288 names `~/.bowerloom/skills/<id>` for a store item.
  - `observeSync` (line 369): replace lines 374-376 with `resolveProject`. Keep the `MANIFEST_NOT_FOUND` refusal only for legacy mode with no `skills.json`. In config mode with no skills, return a plan with no items. Line 385 filters the effective manifest by team. Line 390 finds orphans from the effective manifest. Lines 409-425 build the body with the new fields and the bound hosts.
- `packages/project-sync/src/apply.ts`:
  - `fetchPin` (line 97) is unchanged. Add `fetchStoreGit` beside it in `store-git.ts` with the same checks (bound content key, approved host, cache lock for that item only).
  - `childRequest` (line 138) and `checkChild` (line 149): the store sources of 3.12.
  - `prepareSkillChildren` (line 206): line 213 handles `local`. Add the store origin and the authored-from-lock fetch before phase B.
  - `applySync` (line 263): if the plan says `create`, create `.bowerloom` after phase A and before phase B (3.4).
- `packages/project-sync/src/apply-project.ts`: as in 3.16 (lines 118-218). Also change line 131, where `readManifestState(dir).file !== null` becomes "the effective skill list is not empty". Lines 136-138 use the resolver's prompts. Add the `ApplyPlan` fields of 4.4 and the formats of 3.18.
- `packages/project-sync/src/prompts.ts`: `registeredPrompts` (line 89) stays for legacy mode. `classifyPrompt` (line 121) takes the origin. Line 123 `readLocalPrompt(project, id, ...)` uses the store root. `promptMissing` (line 106) checks the origin's folder. `promptRequest` (line 186) and `checkPromptChild` (line 196): the store sources.
- `packages/project-sync/src/index.ts`: export `fetchStoreGit`, the new types, and the new format names.
- `packages/project-sync/src/deps.ts:18-30`: leave `Acquirer` as it is. Authored fetches use the public transport directly through `fetchStoreGit`. Add the optional field `storeTransport?: () => PublicTransport & { close(): void }` to `SyncDeps` (`deps.ts:~28`). Tests set it to a fake. The default is `createPublicTransport`.
- `packages/project-config/src/refusal.ts` (spec 03 created it): add every new code of section 5 that begins with `LOCK_`, `CONFIG_ITEM_`, `CONFIG_WRITE_`, `STORE_ITEM_`, or `STORE_REMOTE_`, and `TEAM_NOT_SELECTED`. `ITEM_REVIEW_REQUIRED` is a hold code only: a string in `hold`, with a `REFUSALS` entry and no thrower. `packages/project-sync/src/refusal.ts` does not change.
- `packages/managed-skills/src/v2-types.ts`, `local-source.ts`, `v2-observed.ts`: 3.12.
- `packages/project-authoring/src/create.ts`: `CreateInput` (line 34) gains `copyFrom?: { root: string }` for teams. `normalizeInput` (line 83) allows it. `plan()` (line 181) gains the config step, `bowerloomFolder`, and the `copyFrom` branch at line 245. `applyCreate` (line 274) creates `.bowerloom` first. It writes the config and lock steps after `writeManifest` and before `writeReceipt` (line ~358). The finish path (line ~321) repeats them. `openScope` (spec 04) allows a missing `.bowerloom` for a project with a config.
- `packages/project-sync/src/resolve.ts` calls `readManifestState(dir, { allowAbsent: true })` (spec 04, 4.3) for a project with no `.bowerloom`.
- `packages/startup/src/index.ts:58`: add `lock-invalid` and `lock-orphan` to `Drift.kind`.
- `apps/cli/src/project-status.ts:26-57`: the `config` additions (4.6, 3.20).
- `apps/cli/src/ls.ts:58-90`: config mode (3.20).
- `apps/cli/src/up.ts:102-130`: 3.19.
- `apps/cli/src/apply.ts:21, 65-76, 88-97, 100-118`: `--frozen`, the review lines, the tags, `ApplyInput.frozen` and `home`.
- `apps/cli/src/sync.ts:42-58, 60-72, 121-122, 126-152`: the tags, the review, `contextOf` passes `home`, `--frozen`.
- `apps/cli/src/create.ts:56-82, 95-105`: the config plan lines.
- `apps/cli/src/manifest.ts:184-199` (`runCheck`): config mode.
- `apps/cli/src/adopt.ts`: `runAdoptCommand`, which runs the create plan and the config plan under one `withProjectLock` (3.17).
- `apps/cli/src/main.ts:132`: add `'use'`, `'unuse'`, `'lock'` to `COMMANDS`. After the create branch (line 152-157), add a branch for `use`/`unuse` that imports `./use.js`, and one for `lock` that imports `./lock.js`. `help use`, `help unuse`, `help lock`, `use --help`, and so on print the topics. `team adopt` is a new word of the `team` command: `parseCreateArgs` (`create.ts:30`) must accept `adopt` as the second word for `team` only and route to the adopt flow. `helpText` (`main.ts:121-127`) maps `team adopt` to `TOPICS.team`, and `team adopt --help` reaches the branch at `main.ts:153`.
- `apps/cli/src/human.ts`: `TOPICS` (line 45): add `use`, `unuse`, and `lock`, and extend `apply`, `skills`, `team`, `ls`, `status`, and `store`. Extend `TOPICS.store` to name `use`, `unuse`, and `lock`. `REFUSALS` (line 224): every new code with its sentence and next step. `SECTIONS` does not change. `tests/help-human.test.ts:20-45` holds the first screen. Spec 03 already raised the limit to 26 and added `bowerloom help store`. This spec adds no first-screen line. Add `'lock'`, `'unuse'`, and `'use'` to the help loops at lines 79 and 84. Line 78 does not change.
- `package.json:53` (`test:project`): add the five new CLI tests `tests/use-cli.test.ts`, `tests/lock-cli.test.ts`, `tests/frozen-cli.test.ts`, `tests/config-only-cli.test.ts`, and `tests/team-adopt-cli.test.ts`.
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
| `use` in a project with a lock | The lock is updated, even for a project that is not shared. |
| A store item file larger than 65536 bytes | `STORE_ITEM_NOT_SHAREABLE`, sentence `The item is larger than a lock can record.` |
| A store item file that is empty, has a byte order mark, is not UTF-8, or has an execute bit | `STORE_ITEM_NOT_SHAREABLE`, sentence `The item holds a file that a lock cannot record.` No network read. |
| A store item with more than 126 files | The same refusal. |
| `lock update` with the store missing | `STORE_NOT_FOUND`. |
| `lock update --item skill:nope` | `CONFIG_ITEM_NOT_SELECTED`. |
| `lock update` with nothing to change | Prints the plan with `Nothing to change.` and exits 0. |
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
| `apply --frozen` fetches a locked prompt that gives a notice | Nothing of that prompt installs. It is held `ITEM_REVIEW_REQUIRED`. The next plan shows the notice. |
| `apply --frozen` fetches a locked authored skill that declares `allowed-tools` | The skill is held `ITEM_REVIEW_REQUIRED`. The next plan shows its `allowed-tools`. |
| `apply --frozen` fetches a locked authored skill without `allowed-tools` | The skill installs in the same run. |
| `apply --frozen` and GitHub answers 429, or 403 with no requests left | `GITHUB_RATE_LIMITED`. Nothing in the project changes. |
| `lock update` and an authored item has the same hash as its lock item | The lock item stays. No network call. |
| `lock update` with no store entry and a lock file | The lock is written with empty lists. |
| `lock update` with no store entry and no lock file | Prints `Nothing to lock.` and exits 0. |
| `team adopt x` crashes after the receipt and before the config write | The next `team adopt x` prints `Finish adopting team x.` and writes the config and the lock. |
| `team adopt x` and neither the store nor the store cache holds the team | `STORE_ITEM_MISSING`. The next step is `Run bowerloom apply --frozen, then bowerloom team adopt x again.` |
| A config lists skill `personal-assistant` from the project | Held `CONFIG_ITEM_MISSING`. |
| `skills add` in a project with `bowerloom.json` | The config also gains `{ id, source: "project" }`. |
| `skills sync` in config-only project | Creates `.bowerloom/` first. The first plan line says so. |
| A config-only project and `skill create x` | Creates `.bowerloom/`, the skill, the `skills.json` entry, and the config entry. |
| A config lists a project skill with no definition | The item is held `CONFIG_ITEM_MISSING`. Other items install. |
| A config lists a store item and the store is absent | A normal run resolves the item from the lock. With no lock item, it holds `STORE_ITEM_MISSING`. |
| A config lists a store item and the store is unsafe | The plan refuses with the `STORE_*` code in a normal run. A frozen run does not read the store. |
| The lock lists an item the live store changed | The run installs the live item and the plan notes the stale lock. |
| Store skill and project skill share an id and both are in the config | `CONFIG_DUPLICATE_ID` at the read of the config. |
| A store skill and a project prompt share an id | Valid. |
| A store item and a project item with one install place | `APPLY_NAME_COLLISION` (`apply-project.ts:103-114`). |
| `team adopt x`, the store is absent, and the store cache holds the lock's team | Copies from the store cache. No network. |
| `team adopt x` and `.bowerloom/teams/x` exists | `TEAM_EXISTS`. |
| `team adopt x` crashes after files move | The next `team adopt x` finishes it. |
| `up --team research` and `research` is a store team the config does not list | `TEAM_NOT_SELECTED`, next step `bowerloom use team research`. |
| A clone with `bowerloom.json`, a lock, no store: `up --team x` | The sync step fetches lock-resolved items. The apply step installs. |
| `bowerloom.json` is edited by hand and no longer sorted | `CONFIG_INVALID`. |
| Two `use` commands at once | The second waits on the project lock or refuses `PROJECT_LOCKED`, then its plan is stale: `STALE_APPROVAL`. |
| The lock is hand-edited to another `remote` | `lock verify` passes for a matching hash. A fetch then fails or mismatches: `LOCK_HASH_MISMATCH` or `STORE_REMOTE_PRIVATE`. |
| The remote name has capital letters | Bowerloom lower-cases it. GitHub ignores case in names. |
| `--commit` with a short sha | `USAGE`. |

## 8. Migration from beta.2 projects

- A project with no `bowerloom.json` is in legacy mode. These commands act as in beta.2: `ls`, `status`, `skills check`, `skills sync`, `apply`, `up`, and the create commands. The new formats and the source tags are the only changes. The store and the lock are never read.
- A project gets `bowerloom.json` only through `use`, `unuse` (which needs a config), `team adopt` (which needs a config), or `store migrate` (spec 08). No other command creates it. **Amendment, 2026-10-22, sageadvicellc/bowerloom#100:** `team adopt` of a store team that is not listed creates it too.
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
- Docs name the GitHub rate limit as a hard constraint: "Without a token, GitHub allows about 60 requests an hour. Each item takes about 4 plus one per file." A git-ignored file or a `.DS_Store` in a store item makes the proof fail. They also name `core.autocrlf` and git filters. These change the bytes that the proof compares, so a proof can fail on such a store.
- `apps/docs/src/content/docs/guides/add-skills.md`: a short section "Share a project" that links to the spec 10 page.
- `apps/docs/src/content/docs/reference/errors.md`: a row for each code in section 5, in the table `## Store and config refusals` (created by spec 03), plus a new table `## Lock refusals`.
- `apps/docs/src/content/docs/releases.md`, `## 0.7.0-beta.3`: add one line for each of these: `bowerloom.json`, `use` and `unuse`, `bowerloom.lock.json`, `lock verify` and `lock update`, `apply --frozen` and `skills sync --frozen`, and `team adopt`. Add a line for the config-only project with its git-ignored `.bowerloom/`. Add a line for the new plan and result formats.
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
7. Six `authored` cases give `LOCK_INVALID`. Case one: a short commit. Case two: an upper-case commit. Case three: a path that does not match the kind and id. Case four: `.git` in the remote. Case five: a port in the remote. Case six: user information in the remote.
8. An empty or unsorted `authored.files` gives `LOCK_INVALID`. More than 126 rows, a file over 65536 bytes, or a total over 2097152 bytes gives `LOCK_LIMIT`.
9. `teams` on a team item gives `LOCK_INVALID`.
10. 129 skills, 129 prompts, 33 teams give `LOCK_LIMIT`. A file of 4194304 bytes passes. One byte more gives `LOCK_LIMIT`.
11. Merge conflict markers give `LOCK_INVALID`. A byte order mark gives `LOCK_INVALID`. A duplicate key gives `LOCK_INVALID`.
12. For a missing file, `readLock` returns `absent`. A link, a folder, two hard links, group write, and another owner each give `LOCK_UNSAFE`.
13. `lockAgrees` is true for matching pairs. For pairs that differ, it reports `added` and `removed` lists with `kind id` text. It ignores `via`, project entries, and `harnesses`.
14. For a `pin` item, `entryRequest(pin).digest` equals the digest of the store entry it came from.
15. `serializeLock` writes `pin` with `serializeEntry`, and the bytes match the store entry.
16. A lock of 128 pinned items with 64 files each parses.
17. A lock with 8 distinct `authored.remote` values parses. A lock with 9 gives `LOCK_LIMIT`.

`packages/project-config/test/shared.test.mjs`:

1. A lock file makes the project shared with reason `lock`.
2. A `.git/config` with `[remote "origin"]` and a `url` makes the project shared, with reason `origin`. The test runs from a sub folder of the project and from the project folder itself.
3. A `.git/config` with only `[remote "upstream"]` is not shared.
4. A `.git/config` with `[remote "origin"]` and no `url` is not shared.
5. Bowerloom follows a `.git` file with `gitdir: <path>` only for a real folder owned by the user. It ignores any other path.
5a. A worktree (a `.git` file plus a `commondir` file) reads the config of the common folder.
5b. A `.git` in the home folder is ignored.
5c. A `config` that is a FIFO is not shared, does not block, and does not throw.
5d. A header such as `[REMOTE "origin"]` and a key such as `URL = x` match.
6. No `.git` up to home is not shared. The search stops at home.
7. An unreadable `config` is not shared and does not throw.
8. A `config` over 65536 bytes is not shared and does not throw.

`packages/project-config/test/git.test.mjs`:

1. `normalizeRemote` accepts the seven forms of 3.10 and returns `https://github.com/<o>/<r>`. Bowerloom lower-cases a capital letter in the owner or the repository.
2. It rejects other hosts: `https://gitlab.com/o/r`. It rejects `http://github.com/o/r`. It rejects a URL with `user:pass@`, a port, a query, or a fragment. It rejects the repository name `..` and an owner longer than 39 characters.
3. `readStoreRepo` returns `none` with no `.git`. It returns `unreadable` for a `.git` file, a link, or a `reftable` folder. It returns `no-origin` with no origin and `unsupported-remote` for a bad URL.
4. It reads the branch from `HEAD`, the pushed commit from a loose ref, and from `packed-refs`. It ignores comment lines and `^` lines in `packed-refs`.
5. With `commit` null, a detached `HEAD` gives `unpushed`. With `commit` set, `pushed` is that commit, and a detached `HEAD` or a missing remote ref gives no problem, with `branch` and `head` possibly null.
6. A missing remote ref gives `unpushed`.
7. `head` comes from `refs/heads/<branch>` or `packed-refs`. A missing value is null.
8. A branch name with `..` is rejected as `unreadable`.
9. Files over their limits are `unreadable`.
10. A `.git/config` with `objectformat = sha256` gives `unreadable`.
11. A file that is a link, a FIFO, another owner's, or group-writable gives `unreadable`.

`packages/skill-manifest/test/resolve-store-git.test.mjs` (fake `PublicTransport` from `buildFakeRepo`):

1. `fetchAuthored` returns the files of a skill, a prompt, and a team, sorted, with the right `tree`.
2. The `hash` equals `revisionOf` of the rows.
3. Seven cases each refuse (`SKILLS_ADD_UNSAFE_CONTENT` from the transport, mapped to `LOCK_HASH_MISMATCH` in a fetch). The first four: a symlink row, a submodule row, a mode `100755` row, and a `.png` file. The last three: a file over 65536 bytes, 127 files, and a total over 2 MiB.
4. Three cases refuse: a skill without `SKILL.md`, a team without `team.yaml`, and a folder in place of a prompt file.
5. A tree listing whose id does not rebuild to its sha refuses.
6. A truncated listing refuses.
7. A blob whose bytes do not match its sha refuses.
8. A 404 on the commit request gives the outcome `commit-missing` from `proveAuthored`. `change.ts` maps it to `STORE_REMOTE_PRIVATE` for a commit from the ref and `LOCK_COMMIT_UNREACHABLE` for a commit from `--commit`.
9. `proveAuthored` returns the outcome `not-pushed` in two cases: `localHash` differs by one byte, or the item path is missing from the tree. For equal hashes it returns `proved` with the pin. It throws only manifest refusals.
10. Requests use only `api.github.com` URLs, and no `Authorization` header is set.
11. A skill or team takes 4 requests plus one per distinct blob sha. A team of ten files with ten distinct blobs takes 14. A prompt takes 4. A skill of 126 files with distinct blobs takes 130 requests.
12. For a missing segment row, `proveAuthored` returns `not-pushed`. `fetchAuthored` throws `SKILLS_ADD_NOT_FOUND`, which `store-git.ts` maps to `LOCK_HASH_MISMATCH`.
13. In the transport, a 429, a 403 with `x-ratelimit-remaining: 0`, and a 403 with `retry-after` each give `GITHUB_RATE_LIMITED`. A 403 with `x-ratelimit-remaining: 5` gives `SKILLS_ADD_NETWORK`. `SKILLS_ADD_NETWORK` gives `SKILLS_OFFLINE` in a command.
14. A listing whose id does not match `treeId(rows)` refuses.

`packages/project-sync/test/store-git.test.mjs`:

1. `writeStoreCache` writes `<store-cache>/<kind>-<id>-<hash>/skills/<id>/...` with the modes of 3.11 and returns `written`. A second call returns `present`.
2. A cache folder with a changed file is moved to `.prune-<key>-*` and rewritten.
3. A leftover `.tmp-<key>-*` folder is removed on the next write.
4. `readStoreCache` returns the rows and refuses a link, a foreign owner, and group write.
5. `fetchStoreGit` refuses three cases: a host outside `approvedHosts`, a changed `hash`, and rows that differ from the lock (`LOCK_HASH_MISMATCH`).
6. It takes the cache lock for the one item and releases it.

`packages/project-sync/test/resolve-config.test.mjs`:

1. Legacy mode returns exactly the beta.2 sets (copy the cases of `tests/skills-sync-cli.test.ts` for expected items).
2. Config mode: project entries resolve to their definitions. A missing definition is held `CONFIG_ITEM_MISSING`.
3. A live store that holds the item supplies the store entry.
4. With no store, store entries resolve from the lock. A pinned item becomes an ordinary entry.
5. Neither: held `STORE_ITEM_MISSING`.
6. Frozen mode never reads the store. A store that refuses has no effect.
7. A refused store in a normal run throws its `STORE_*` code.
8. A config with no store entry never reads the store.
9. `unselected` lists project definitions the config lacks.
10. The effective manifest holds only selected skills, sorted, with the `harnesses` list of the config.
11. For a live item that differs from its lock item, `notes` holds the stale-lock line.
12. A store local skill becomes a `local` entry with path `skills/<id>`.
13. The `teams` tag of an entry comes from its own definition.
14. A config entry skill `personal-assistant` (project) is held `CONFIG_ITEM_MISSING`.
15. `readManifestState(dir, { allowAbsent: true })` serves a project with no `.bowerloom`.

`packages/project-sync/test/config-change.test.mjs`:

1. `use` and `unuse` for each kind produce the exact config text of 4.2 and the plan lines of 3.5 and 3.7.
2. The first `use` lists every project item with `source: "project"`. It sets `harnesses` from `skills.json`. With no `skills.json`, it sets `["claude","codex"]`.
3. Team expansion adds the right items with `via`, merges `via`, promotes a direct pick, and refuses a duplicate with a project item.
4. `unuse team` removes the right entries.
5. Limits give `CONFIG_LIMIT`.
6. A project with a lock, or a shared project, gets a written lock. Any other project gets none.
7. A pinned store skill adds a `pin` item with no network call.
8. An authored item adds an `authored` item after a proof, and the plan names `api.github.com`.
9. Self-healing: a config entry with no lock item gets one.
10. Write order: the config is written before the lock. A crash between them (test hook that throws) leaves the config new and the lock old. The next `use` heals it.
11. Scratch files are listed and removed.
12. A changed config between plan and apply gives `STALE_APPROVAL`.
13. A read back that differs gives `CONFIG_WRITE_UNCONFIRMED` or `LOCK_WRITE_UNCONFIRMED`.
14. `use` and `unuse` never create `.bowerloom`. They write only `bowerloom.json` and `bowerloom.lock.json`. A plan of `apply` or `skills sync` that says `create` makes the command create `.bowerloom` after phase A and before phase B. If the folder exists by then, the command refuses `STALE_APPROVAL`.
15. `adoptCreatedMarker(project, 'config')` runs right after `bowerloom.json` is created. `adoptCreatedMarker(project, 'folder')` runs right after `.bowerloom` is created by any command.
16. For a new file, the writer runs `lstat` and requires `ENOENT`, then `rename`.
17. `applyConfigChange` reads no network. A change to the config, the lock, `store.skills`, `store.authoring`, or an added authored item's `localItemRows` hash gives `STALE_APPROVAL`.
18. `skills add` in a project with `bowerloom.json` adds the config entry in the same plan, with the duplicate and limit refusals. `--replace` leaves the config alone.
19. `unuse` never adds a lock item and never reads the network. `use` and `lock update` add a missing one. `unuse` drops an extra lock item left by an earlier crash.

`packages/project-sync/test/lock-update.test.mjs`:

1. `planLockUpdate` for all items and for `--item` lists `unchanged`, `pin changed`, `commit changed`, and `added`.
2. With no lock, it creates one.
3. An item missing from the store refuses `STORE_ITEM_MISSING`.
4. For pinned items only, it makes no network call.
5. Nothing to change returns a plan with no revision change and `applyLockUpdate` writes nothing.
6. `--commit` records that commit.
7. An authored item whose live hash equals its lock hash keeps its lock item and reads no network, unless `--commit` is given.
8. A lock item with no store entry in the config is dropped with the plan line `removed`. Another unselected lock item stays.
9. A lock with `LOCK_INVALID` is rebuilt without `--item`, and refuses with `--item`. `LOCK_UNSAFE` and `LOCK_LIMIT` refuse.
10. No store entry and no lock prints `Nothing to lock.` and exits 0. No store entry and a lock writes empty lists.
11. A changed `teams` tag shows a `teams changed` line and counts as stale.

`packages/managed-skills/test/store-source.test.mjs`:

1. A skill installs from a store folder, with a catalog source `{ kind: 'store', path }` and no directory in it.
2. A prompt installs from a store folder: the Claude command is the file bytes, the Codex wrapper description reads `Bowerloom prompt <name>, wrapped as a skill for Codex. It comes from your Bowerloom store. Edit it there, not this file.`
3. The same bytes give identical catalogs and receipts from the live store and from a store cache folder. Only the operation key differs. Compare the catalog text.
4. A local skill moved from the project to the store with changed bytes updates, and the catalog source becomes `store`.
5. A store folder inside the project folder, or inside the state folder, is refused by the non-nesting check.
6. A symlink, a second hard link, a foreign owner, group write, and a change during the read are refused.

`packages/project-sync/test/sync-config.test.mjs` and `apply-config.test.mjs`:

1. The plan binds `config`, `lock`, `store`, each item's `requestDigest` (and `hash` for authored), `lockPin`, and `network.hosts`. A change to any of them changes the revision.
2. A pinned store skill already in the cache needs no fetch. The plan names `registry.npmjs.org` only as a possible host (as in `sync-global-cache.test.mjs`).
3. A fake transport fetches an authored lock item that the store cache lacks, in phase A. The host is `api.github.com`.
4. A fetch of an unapproved host never starts.
5. A config-only project: the plan has `bowerloomFolder: "create"` and its first review line is the `Create .bowerloom` line. Apply creates the folder with mode 0755 and installs.
6. A store local skill installs from the live store. Changing a store file after the plan gives `STALE_APPROVAL`.
7. A store prompt installs the Claude command and the Codex wrapper.
8. `checkNames` still refuses two items for one place.
9. Holds for `CONFIG_ITEM_MISSING` and `STORE_ITEM_MISSING` do not stop other items.
10. `unuse`d items show as `orphaned` and are not removed.
11. Legacy mode plans equal beta.2 plans except for the new fields.
12. A plan with a stale lock carries the note.
13. A local skill moved from the project to the store with equal bytes: `classify` gives `up-to-date`, action `none`, and the catalog keeps `local`.
14. In config mode, plain apply holds an uncached item with `resolvedFrom: 'lock'` with `SKILLS_OFFLINE`. The `plan.ts:408` check excludes it. An uncached pin from another source keeps today's refusal.
15. If a locked authored prompt installs or updates, `ApplyPlan.network.hosts` holds `api.github.com`, whether or not the store cache holds it now. The `needsFetch` filter keeps `cacheRoot` and `storeCacheRoot` in `create`.

`packages/project-sync/test/frozen.test.mjs`:

1. Six lock codes refuse at plan time: `LOCK_MISSING`, `LOCK_INVALID`, `LOCK_UNSAFE`, `LOCK_LIMIT`, `LOCK_CONFIG_MISSING`, and `LOCK_CONFIG_MISMATCH`. The fake acquirer gets zero calls and the network gets zero calls.
2. Frozen installs a lock-resolved pin and a lock-resolved authored item on a machine with no store.
3. Frozen ignores a live store that differs.
4. A fetched authored item with another hash gives `LOCK_HASH_MISMATCH` and installs nothing from it.
5. A fetched pin that differs gives `SKILLS_SYNC_CONTENT_MISMATCH`.
6. A failed fetch gives `SKILLS_OFFLINE` with no project change.
7. Cached items cause zero fetches.
8. Plain apply never calls the acquirer (`NO_FETCH`).
9. The apply plan with `frozen: true` has `offline: false` inside its sync part.
10. A locked authored prompt that the store cache lacks has `notices: null` and the plan line `install prompt: <places> (not on this machine yet; Bowerloom shows what it can do after the fetch)`.
11. Apply fetches that prompt in phase A. If the bytes give a notice, nothing installs and the prompt is held `ITEM_REVIEW_REQUIRED`. A lock-fetched authored skill whose `SKILL.md` declares `allowed-tools` is held `ITEM_REVIEW_REQUIRED` the same way. A skill without `allowed-tools` installs in the same run. The next plan reads the cache and shows the notice or the `allowed-tools`.
12. A fetched prompt with no notice installs.
13. A frozen run fetches each locked team that the store cache lacks into the store cache.
14. A `GITHUB_RATE_LIMITED` from the transport surfaces unchanged. An abort
15. `skills sync` (not `--offline`) fetches every locked authored prompt that the store cache lacks, binds `api.github.com`, and installs no prompt.

`packages/project-authoring/test/create-config.test.mjs` and `team-adopt.test.mjs`:

1. A project create with a config adds the entry, in the plan and in the file.
2. A create with a duplicate store entry in the config gives `CONFIG_DUPLICATE_ID`.
3. A create in a config-only project creates `.bowerloom` first.
4. A project `team create` with no `brief.json` and a config uses `storeBrief`.
5. A project `team create` with an invalid `brief.json` gives `PROJECT_BRIEF_INVALID`.
6. The finish path repeats the config step.
7. `team adopt` copies from the live store and from the store cache, registers the receipt, switches the config, and removes the lock item. It reads no network.
7a. With neither source, it refuses `STORE_ITEM_MISSING` with the next step `Run bowerloom apply --frozen, then bowerloom team adopt <id> again.`
7b. An entry whose `via` lists the team loses the team from `via`. An entry whose `via` becomes empty loses the key and stays listed. The plan has the line `bowerloom.json: <kind> <x> is now picked directly`.
8. The compile candidate of the copy equals the candidate of the source.
9. `TEAM_EXISTS`, `TEAM_ID_RESERVED`, and `CONFIG_ITEM_NOT_SELECTED` refuse.
10. An interrupted adopt resumes.
10a. A crash after the move leaves the folder. The next `team adopt` finishes it with no `TEAM_EXISTS`.
11. The recovery check passes. Its three facts are that the receipt registers the team, the folder matches its pins, and the config still lists the team from the store. The plan then has `create: null` and the first line `Finish adopting team <id>.` Apply writes only the config and the lock.
12. The create finish path never adds a config entry for an id that the config lists from the store.
13. The revision equals `sha256(canonicalJson({ create: create?.revision ?? null, config: config.revision }))`.

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

1. The test writes a `.git/config` origin in the project and `.git` files in the store. Then `use skill x` locks an authored skill through the fake GitHub repo. The lock file has the exact bytes expected.
2. The same project with no store `.git`: `STORE_ITEM_NOT_SHAREABLE` with the sentence, and the exact `Next:` text.
3. Editing a store file after the fake repo is built: `LOCK_STORE_NOT_PUSHED`.
4. A project that is not shared writes no lock.
5. `lock verify` passes, then fails after hand edits (hash, set, markers).
6. `lock update` adds, changes, and removes items as the test changes the store.
7. `status --json` shows `config.lock` states: `not-used`, `absent`, `valid`, `stale`, `invalid`, `mismatch`, `orphan`.
8. A private fake repo (404) gives `STORE_REMOTE_PRIVATE`.
9. For a store with no remote, `store status` shows the `Git:` line and the commands. It also shows the `git.ahead` values.

`tests/frozen-cli.test.ts`:

1. Simulate a clone: copy `bowerloom.json`, `bowerloom.lock.json`, and the project files to a new folder with a new `HOME` that has no store. `apply --frozen` shows a plan with `Network: reads api.github.com` and exits 3. With `--approve` it fetches (fake repo), installs, and exits 0.
2. A second `apply --frozen` shows `Network: none now.` and `Nothing to change.`
3. `skills sync --frozen --offline` with an uncached item refuses `SKILLS_OFFLINE`.
4. Plain `apply` in the clone holds the authored item with `SKILLS_OFFLINE`.
5. `up --team x` in the clone fetches and installs through its sync and apply steps.
6. The fake network log shows only `api.github.com` and `registry.npmjs.org`.

`tests/config-only-cli.test.ts`, part 1: in a folder that holds only `bowerloom.json`, each command of the first group must exit 0. The first group is `ls`, `status`, `skills check`, `skills sync`, and `apply`. Part 2, in a fresh folder of the same kind: `skill create house-style --approve`, `skills sync --approve`, and `apply --approve`. Then the test runs `git init` and `git status --porcelain --untracked-files=all`. The list is exactly `bowerloom.json`, `.bowerloom/skills.json`, `.bowerloom/skills/house-style/SKILL.md`, `.bowerloom/authoring/receipt.json`, `.claude/skills/house-style/SKILL.md`, and `.agents/skills/house-style/SKILL.md`. The file `.bowerloom/managed/.gitignore` holds `*`. Part 3: the second group holds `skill create`, `prompt create`, `team create`, `use`, `unuse`, `team adopt`, `lock verify`, and `up --team`. Each has its own expected code, listed in the test.

`tests/team-adopt-cli.test.ts`: the CLI path of `team adopt`, the plan lines, and the result. It covers the recovery plan and the `STORE_ITEM_MISSING` refusal. `tests/lock-cli.test.ts` also covers `GITHUB_RATE_LIMITED`. All five CLI test files are in `test:project` (`package.json:53`).

Update existing tests: `tests/skills-cli.test.ts`, `tests/ls-status-cli.test.ts`, `tests/skills-sync-cli.test.ts`, `tests/apply-cli.test.ts`, `tests/up-team-cli.test.ts`, `tests/freeze-up-cli.test.ts`, `tests/m5-review-fixes.test.ts`, `tests/m6-review-fixes.test.ts` for the new format names and tags. `tests/no-spawn.test.ts` must stay green with no change. The `public-get` module, reached through `apply.js`, is network and not spawn. Add a `skills recover` test for store-sourced items. `tests/guard-map.test.ts` must stay green. `tests/help-human.test.ts` and `tests/human-refusal.test.ts` update for new text and codes.

## 11. Build order

1. Export the helpers in `resolve-git.ts` and `serializeEntry` in `schema.ts`. Write `tests/support/fake-github-repo.ts` and test it against `resolve-git.test` cases.
2. Engine sources (3.12) with `store-source.test.mjs`.
3. `lock.ts`, `shared.ts`, `git.ts` with their tests.
4. `resolve-store-git.ts` and `store-git.ts` with their tests.
5. `resolve.ts` with its test.
6. `plan.ts`, `prompts.ts`, `apply.ts`, `apply-project.ts` with the sync, apply, and frozen tests.
7. `change.ts`, authoring changes (config step, `copyFrom`), with their tests.
8. CLI: `use.ts`, `lock.ts`, `apply.ts`, `sync.ts`, `create.ts`, `up.ts`, `ls.ts`, `project-status.ts`, `manifest.ts`, `main.ts`, `human.ts`.
9. CLI test files and updates to existing tests.
10. Docs.
11. Add the five CLI tests to `test:project`. Run `npm run typecheck`, `npm test`. Both zero.

## 12. Unverified items

1. The managed engine can close the allowed `source.kind` values in a place I did not read. I read the receipt and plan validators only as far as `validatePlanV2` (`packages/managed-skills/src/v2-observed.ts:190-200`). First, run `store-source.test.mjs` cases 1 and 4. For each refusal, search `packages/managed-skills/src` for `'local'`, `closure.source`, and `catalogKeys`. Add the new kinds at each place. Suppose a validator cannot take them without a format change. Then keep the engine source kinds `local` and `prompt` for store items. Pass the store root in a new optional request key `rootDir`, bound in the request. The catalog then does not tell the origin, so add the origin to the plan item only.
2. `compileCrew` on a team folder outside a project (`packages/crew/src/index.ts:94`). Run the `team adopt` plan case first. If it refuses, call `compileCrew(file, { root: <team folder> })`. If it still refuses, copy the team to a temporary folder inside `<stateRoot>` and compile there.
3. `createPublicTransport` against store URLs. Its URL check is `URL_SHAPE` at `packages/skill-manifest/src/public-get.ts:~40`. It allows letters, digits, and the characters `. _ ~ @ % / -`, which covers every URL in 3.11. Run `resolve-store-git.test.mjs` case 1 first. If the transport refuses a valid store URL with `SKILLS_ADD_HOST_REFUSED`, compare the URL with `URL_SHAPE` and fix the URL builder. Do not widen `URL_SHAPE`.
4. `packed-refs` format. Peeled lines start with `^`. Comment lines start with `#`. Test with a real `git pack-refs` output that the test creates by hand. If the test finds another line shape, ignore it and keep the parser strict on the lines it needs.
5. `tests/support/fake-network.ts` serves a file per exact URL (`fake-network.ts:~40`). It does not log request headers. Extend it to log whether an `Authorization` header was set (never the value). Spec 07 needs this too. If spec 07 merged first, it exists already.
6. The static walk in `tests/no-spawn.test.ts` covers modules reachable from `up.js` and `apply.js`. The new modules are reachable from them. Run that test right after step 6 of the build order. If it finds `child_process`, the import came from a helper. Remove that import. Do not weaken the test.
7. Lock size. The figure of about 42 KB per pinned entry comes from the issue, not from a measurement. After step 3 of the build order, measure a real maximum entry. A full 126 files of 65536 bytes is not possible, because the total cap is 2 MiB. Suppose a 128-entry lock passes 4 MiB in a test. Then raise `LOCK_LIMITS.bytes` to the smallest power of two that fits, and update the docs.
8. The `.git` directory inside the store and `readTree`/authoring verifiers. The store has no startup walk, so `.git` does no harm there. Run `store status` counts against a store that has `.git` and `.gitignore`. If the folder counts are wrong, make the counter ignore names that start with a dot.
9. Whether `skills check` in a config project with no `skills.json` can print `0 skills` without breaking `tests/skills-cli.test.ts`. Run it. If a test expects `MANIFEST_NOT_FOUND` in config mode, update the test, because the new behavior is the spec.
10. Archive fetch. Evaluate fetching one archive per commit (`codeload.github.com/<o>/<r>/tar.gz/<commit>`, or the API tarball endpoint). Bowerloom then checks each file against the sha256 rows of the lock, and per-blob requests go away. The rate-limit page (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api, read 2026-10-22) says nothing on whether archives count against the limit. Test it against a real repository first. Fallback: keep the per-blob design. Do not switch designs without that check.
11. Measure one 126-blob fetch against GitHub. If it passes 25 s, fetch blobs with a new transport for each 40 blobs. Each transport gets the same approved host. The 4 metadata requests share the first one.
12. The exact `git status` paths of the `config-only-cli` test. They come from reading the install places, not from a run. Run the test once and compare. Fallback: take the list from that run, and check it by hand against the install places.

## 13. New decision for Hanna

Decision record: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6334887017. Status: pending. This is a security decision with no automatic default. Variant A is built in this spec.

Topic: what apply does with a lock-fetched authored skill or prompt that the store cache does not hold at plan time.

- A (built): apply fetches the item in phase A. If the fetched `SKILL.md` declares `allowed-tools`, or a prompt gives a notice, apply installs nothing of it and holds it with `ITEM_REVIEW_REQUIRED`. The next plan reads it from the cache and shows its `allowed-tools` or notice. A skill without `allowed-tools` installs in the same run. Message: `Bowerloom shows what an item can do before it installs it.` Next step: `Run bowerloom apply --frozen again to review it.`
- B: install it, and state in the docs that a store item fetched from a lock is trusted as your team's own store content.

Blocks: build step 6 of section 11 (the plan, apply, and frozen code). Tests that change with B: frozen test 10 to 12 and edge rows for `ITEM_REVIEW_REQUIRED`.
