# 09. Cache list and cache prune

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 8 and decisions 1, 9, 10, 15, and 24. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decisions 12 to 15: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332752507. Decision 24 (the store cache): https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333364163.
- Lane: 2.
- Branch: `beta3/09-cache-admin`.
- Depends on: spec 06 (the store cache, `writeStoreCache`, `readStoreCache`, the resolver, the lock). Spec 04 supplies `cacheLayout`.
- Line numbers below are from commit c9730d3. If a line moved, find the place by its function name.

## 2. Problem

The machine keeps downloaded skill bytes in a cache under the private state folder. Today the cache only grows. A person cannot see what is in it. A person cannot clear it without deleting folders by hand.

Beta.3 adds a second cache, the store cache, for items that come from a store remote (spec 06). It grows too.

Decision 10 says eviction is manual only. Two commands do it. `bowerloom cache list` shows what the cache holds. `bowerloom cache prune` shows a plan, and deletes only after approval.

Deleting cached bytes is safe for a project. Installed copies are separate files. A deleted pin is fetched again the next time a command needs it.

## 3. Behavior

### 3.1 The three places

All paths are under the private state folder. When `XDG_STATE_HOME` is an absolute path, the folder is `$XDG_STATE_HOME/bowerloom`. Otherwise it is `~/.local/state/bowerloom` (`privateStateRoot`, `packages/project-context/src/index.ts:25-30`). Call it `<stateRoot>`.

1. The skills cache, `<stateRoot>/cache`. It holds one folder `op-<operationId>` for each fetched npm or GitHub pin. `<operationId>` is 32 lower-case hex characters. Each operation can hold up to 8 attempts per pin (`packages/project-sync/src/cache-index.ts:66`, `CACHE_ATTEMPTS` is 8).
2. The store cache, `<stateRoot>/store-cache` (spec 06, 3.11). It holds one folder `<kind>-<id>-<hash>` for each fetched store item (spec 06, 3.11). `<kind>` is `skill`, `prompt`, or `team`. `<hash>` is 64 hex characters.
3. The old per-project caches of earlier betas, `<stateRoot>/<projectId>/cache`. Each holds `op-<operationId>` folders. `<projectId>` is 32 hex characters. Bowerloom still reads them as a fallback and never writes them (`packages/project-sync/src/cache-index.ts:104-116`).

### 3.2 No index file

This spec writes no index of the cache. Something that Bowerloom can read must refer to an entry before Bowerloom knows its content key. The key of a pinned skill is `entryRequest(entry).digest` (`cache-index.ts:55`). Its eight operation ids are `cacheOperationId(digest, 0..7)` (`cache-index.ts:66`). The key of a store item is its `hash`.

`cache list` builds an in-memory map from these sources:

- With a valid store, the store `skills.json`: every pinned entry gives a key and eight operation ids. Source tag: `store`.
- Inside a project, the current project: every pinned entry of `.bowerloom/skills.json`, every `pin` of `bowerloom.lock.json`, and every `authored.hash` of the lock. Source tag: `project`.
- The live store items: for each store skill, prompt, and team that is written in the store, the item `hash` (spec 06, 3.11) gives a store-cache key. The key is `<kind>-<id>-<hash>`. Source tag: `store`.

When an entry's id is in a source's set, that source references the entry. An entry that no source refers to has `key: null`.

A source that fails to read gives `null` ("unknown") for every entry. The command goes on. These rules decide what is unknown:

- `discoverProject` throwing `PROJECT_NOT_FOUND` means no project (`references.project: null`, `projectChecked: false`).
- Any other discovery refusal, a refusing `.bowerloom/skills.json`, an invalid `bowerloom.json`, or a refusing lock makes the project source unknown.
- A throwing `inspectStore`, a refusing store `skills.json`, or a `localItemRows` refusal for any live store item makes the store source unknown.
- An unknown source is added to `unreadableSources`, and `--unreferenced` then picks nothing.

### 3.3 `bowerloom cache list`

```text
bowerloom cache list [--json]
```

It needs no project and no store. It reads only and writes nothing. It takes no lock.

Before listing, run `storeStateNested` (spec 04, 3.8) and, inside a project, the nesting check of `stateLayout` (`plan.ts:173`). Check `<stateRoot>` and each existing cache root with the rules of `cacheLayout`. A failure refuses `STORE_STATE_NESTED` or `SKILLS_STATE_UNSAFE` and exits 1.

Help text, `TOPICS.cache`:

```text
Usage:
  bowerloom cache list [--json]
  bowerloom cache prune [--unreferenced] [--partial] [--legacy] [--all] [--entry <id-prefix>]... [--approve <revision>] [--json]

Bowerloom keeps the skill bytes it downloads in a cache on this machine, outside your projects and your store.
cache list shows what is there. It reads only.
cache prune deletes entries after you approve a plan. Nothing is deleted by itself.
--unreferenced picks entries that your store and this project do not list. Other projects are not checked.
--partial picks unfinished fetches. --legacy picks the per-project caches of earlier betas. --all picks everything.
--entry <id-prefix> picks one entry by the first 8 or more characters of its id from cache list, or by its full store folder name.
An entry whose owner lock is older than a day counts as not in use.
A deleted pin is fetched again when bowerloom skills sync or apply --frozen needs it.
It deletes no project file and no installed copy.
It shows the plan first. Agents pass --approve <revision> or --json.
```

Algorithm:

1. Find `<stateRoot>`. If it does not exist, the cache is empty.
First `lstat` each name in every folder below. A name that is not a real folder owned by the user counts under `unlisted` and is never an entry. Sort each folder's names in byte order before they count toward the 4096 limit.

2. List `<stateRoot>/cache`. For each name that matches `^op-[a-f0-9]{32}$`, run `inspectSkillCache({ root, operationId })` (`packages/skill-sources/src/cache.ts:281`). Names that do not match `op-<32 hex>` and are not `.prune-*` count under `unlisted`. A name that starts with `.prune-` is a partial entry (a leftover of a crashed prune).
3. List `<stateRoot>/store-cache`. For each name that matches `^(skill|prompt|team)-[a-z0-9-]+-[a-f0-9]{64}$`, read the folder with `readStoreCache` and recompute the hash. A match is `completed`. A mismatch is `partial`. Names `.tmp-<key>-*` and `.prune-*` are `partial`. Other names count under `unlisted`. `readStoreCache` returns `{ rows, valid }` and throws only on a guard failure. A throw makes the entry `partial` with `label` null.
4. List each folder of `<stateRoot>` that matches `^[a-f0-9]{32}$` and has a `cache` folder. For each `op-<32 hex>` inside, inspect it the same way as step 2. List `.prune-*` folders inside legacy caches as partial entries. Skip a `<projectId>` folder, or its cache, that fails the checks of 4.4 (step 0a) and count it under `unlisted`. Scope: `project-legacy`.
5. Bound the work: at most 4096 entries in all. Past that, stop listing and set `truncated: true`.
6. Build the reference sets (3.2). Fill `key` and `references`.
7. Sort entries by scope (`machine`, `store`, `project-legacy`), then by `projectId`, then by id (4.1).
8. Print.

Entry fields:

- `name`: the folder name under its root. `removeCacheEntry` deletes this name. The plan carries it too.
- A machine or legacy entry: if the inspection is `COMPLETED`, has a receipt, and has no active owner, `status` is `completed`. Otherwise `status` is `partial`. If the inspection throws, the entry is `partial` with no label. `active` is `inspection.activeOwner`. Mark `stale` true for an `<op>/owner.lock` with an `lstat` mtime older than 24 hours (see 3.4). A legacy entry has `key: null` and `references` of `{ store: null, project: null }`.
- `kind`: `npm` or `git` from `receipt.source.kind` (`cache.ts:29`). `store-git` for a store entry. Null for an unknown entry.
- `label`: for npm, `<package>@<version>:<sourceRoot>`. For git, `<repository>@<commit first 8>:<sourceRoot>`. The `<sourceRoot>` comes from `receipt.skill.sourceRoot`. For a store entry, `<item kind> <item id>` (for example `skill house-style`), read from the folder layout. Null for an unreadable partial entry.
- `skillName`: `receipt.skill.name`, or null.
- `files` and `bytes`: the count and the byte sum of `receipt.inventory`. For a store entry, the count and sum of the folder's files. Null for a partial entry.

Text output, verbatim shape:

```text
Skills cache: <cache path>
  <id8>  completed  <label>  (<n> files, <size>)  [store] [project]
  <id8>  partial    unfinished fetch
Store cache: <store-cache path>
  <hash8>  completed  <label>  (<n> files, <size>)  [store] [project]
Earlier per-project caches: <n> entries in <m> projects
  <projectId8>/<id8>  <status>  <label>  (<n> files, <size>)
Total: <n> entries, <size>
```

- `<id8>` is the first 8 characters of the id. For a legacy entry the line starts with `<projectId8>/<id8>`.
- When `references.store` is true, `[store]` shows. When `references.project` is true, `[project]` shows.
- `<size>` is `<n> B` below 1024, else `<x.y> KiB` or `<x.y> MiB` with one decimal. Use the helper `humanBytes(n)` in `apps/cli/src/cache.ts`.
- Print a section line (`Skills cache`, `Store cache`) only for a place that has entries. When the whole cache is empty, print `The cache is empty.` and nothing else.
- When `truncated`, add `More entries exist. Only the first 4096 are shown.`
- When a source failed to read, add `Some references were not checked: <store | project>.`

JSON: format `bowerloom/cache-list/v1beta1`, section 4.1.

Exit code 0 in every case except `USAGE` (2) and the refusals `STORE_STATE_NESTED` and `SKILLS_STATE_UNSAFE` (1).

Usage error text: `Use bowerloom cache list [--json] or bowerloom cache prune with a selector. See bowerloom help cache.` `cache list --help` and `cache prune --help` print `TOPICS.cache`.

### 3.4 `bowerloom cache prune`

Selectors. Give at least one. Without a selector, the command refuses `USAGE`. Selectors combine as a union. Each entry appears once.

- `--unreferenced`: every `completed` entry in the skills cache and the store cache that no readable source lists. The test is `references.store === false`, `references.project !== true`, and an inactive owner. Such an entry has `key: null`. If the store source is unknown (`null`), this selector picks nothing. If the project source is unknown, it picks nothing. Outside a project the project source is not checked, and the plan says so.
- `--partial`: every entry with `status: partial` and `active: false`, in the skills cache, the store cache, and legacy caches.
- `--legacy`: every entry with scope `project-legacy` that is not active.
- `--all`: every entry that is not active, in all three places. Giving `--all` with another selector is `USAGE`.
- `--entry <id-prefix>` (repeatable): one entry whose id starts with the prefix. The prefix is 8 to 64 lower-case hex characters that start a machine or legacy operation id or a store hash. It can also be a full store folder name `<kind>-<id>-<hash>`. A shorter prefix, a non-hex prefix, or a repeat is `USAGE`. A prefix that matches nothing refuses `CACHE_ENTRY_NOT_FOUND`. A prefix that matches more than one entry is `USAGE` with the message `The prefix matches more than one entry. Use more characters.` A prefix that matches an active entry refuses `CACHE_ENTRY_BUSY`.

Group selectors skip an active entry. The plan lists it as skipped. An entry whose `<op>/owner.lock` has an `lstat` mtime older than 24 hours counts as not active for `--partial`, `--all`, and `--entry`. `cache list` shows `active: true, stale: true` for it. Its plan line ends `(its owner lock is older than a day)`. The command `skills source acquire --state` writes without the cache lock (`apps/cli/src/skills.ts:116,123`), so the owner lock cannot cover that write.

Plan lines, verbatim:

```text
Prune the skills cache
  delete  <label>  (<n> files, <size>)  <place> <id8>  [store] [project]
  delete  unfinished fetch  <place> <id8>
  skip    <label or unfinished fetch>  <place> <id8>  (another command is using it)
Frees about <size>.
When a command needs an entry that this project or your store still lists, Bowerloom fetches it again.        (only when a picked entry is referenced)
Other projects on this machine are not checked.                                                         (always)
This deletes cached skill bytes only. It deletes no project file and no installed copy.
```

`<place>` is `cache`, `store-cache`, or `legacy <projectId8>`.

If a source was unknown, print `Some references were not checked: <store | project>. --unreferenced picks nothing.` before the next line. If nothing is picked, print `Nothing to prune.` and exit 0 without asking.

Apply steps, under `withCacheLock(cacheRoot, signal, ..., { waitMs: 60000 })` (`packages/project-context/src/index.ts:233`):

1. Re-list and re-inspect every picked entry. Compare with the bound values (4.2). Any difference refuses `STALE_APPROVAL` before anything is deleted. For `--unreferenced`, rebuild the reference sets under the cache lock. A picked entry that a source now lists refuses `STALE_APPROVAL`. A throwing inspection binds `snapshotRevision` null, and apply requires the re-inspection to throw too.
2. For each picked entry, in plan order, call `removeCacheEntry` (4.4) with the place and the `name` of the entry. A failure stops the loop and refuses `CACHE_PRUNE_FAILED` with the text `Deleted <n> of <m> entries.`
3. Return the result.

One cache lock covers all three places. `cacheLockSlot(cacheRoot)` keys the lock on the `<stateRoot>/cache` folder (`packages/project-context/src/index.ts:209`). The store cache and the legacy caches sit outside that folder, but they use the same lock. If `<stateRoot>/cache` does not exist, create it first. Use the rules of `cacheLayout` (spec 04, mode 0700). This is the only folder that `prune` creates.

Crash recovery. `removeCacheEntry` renames the entry to `.prune-<name>-<8 hex>` before it deletes anything. A name that already starts with `.prune-` skips the rename. The `.prune-` helper of spec 06 calls `removeCacheEntry`, so one delete path exists. A crash during the delete leaves a `.prune-*` folder. `cache list` shows it as `partial` and not active. `cache prune --partial` deletes it. A crash before the rename changes nothing.

Result text: `Deleted <n> entries, about <size>.` Skipped entries add a second line: `Skipped <n> entries that another command is using.` The JSON result format is `bowerloom/cache-prune-result/v1beta1` (4.3).

Exit codes: 0 done or nothing to prune, 1 refusal, 2 `USAGE`, 3 plan awaiting approval, 130 interrupt.

### 3.5 What prune never touches

- Project files, installed copies, `.bowerloom/managed`, the project's private state folders `<stateRoot>/<projectId>/items`, and the store.
- A folder it did not list in the plan.
- Any link: a link inside an entry is removed as a name and never followed.

### 3.6 Interaction with other commands

- `skills sync`, `apply --frozen`, and `skills add` hold the cache lock only while they fetch or seed one pin (`packages/project-sync/src/apply.ts:102`, `seed.ts:55`). `prune` waits for the lock for up to 60 seconds, then refuses `PROJECT_LOCK_UNAVAILABLE`.
- A sync fetches a pin, and a prune can delete it before the sync reads it back. The sync then fails with `SKILLS_CACHE_RECOVERY_REQUIRED`, and a rerun fetches again. Nothing in the project changes.
- `cache list` takes no lock, so it can show an entry that a prune deletes a moment later.

## 4. Schemas

### 4.1 `cache list --json`, format `bowerloom/cache-list/v1beta1`

| Field | Type | Meaning |
|---|---|---|
| `format` | string | `bowerloom/cache-list/v1beta1` |
| `stateRoot` | string | The private state folder |
| `entries` | array | See the entry fields below |
| `totals` | object | `{ "entries": n, "bytes": n }`. Bytes sum the known `bytes` of completed entries. |
| `unlisted` | number | Names in the cache folders that are not entries |
| `truncated` | boolean | True means more than 4096 entries exist |
| `unreadableSources` | array | Zero or more of `"store"` and `"project"` |

Entry fields:

| Field | Type | Meaning |
|---|---|---|
| `scope` | string | `machine`, `store`, or `project-legacy` |
| `id` | string | 32 hex (`machine`, `project-legacy`) or 64 hex (`store`) |
| `projectId` | string or null | 32 hex for `project-legacy`, else null |
| `status` | string | `completed` or `partial` |
| `name` | string | The folder name under its root |
| `active` | boolean | An owner holds the entry (machine and legacy only, else false) |
| `stale` | boolean | The owner lock is older than 24 hours |
| `kind` | string or null | `npm`, `git`, `store-git`, or null |
| `label` | string or null | As in 3.3 |
| `skillName` | string or null | The skill name |
| `files` | number or null | File count |
| `bytes` | number or null | Byte sum of the files |
| `key` | string or null | The content key (64 hex) of an entry that a source lists. Null for any other entry, and for every legacy entry. |
| `references` | object | `{ "store": boolean or null, "project": boolean or null }`. Null means the source cannot be read or was not checked (no project). A legacy entry has both null. |

Sorted by `scope` in the order `machine`, `store`, `project-legacy`, then by `projectId`, then by `id`. Keys are in the order shown.

### 4.2 Prune plan, `bowerloom/cache-prune-plan/v1beta1`

```ts
export interface CachePrunePlan {
  format: 'bowerloom/cache-prune-plan/v1beta1';
  stateRoot: string;
  selectors: { unreferenced: boolean; partial: boolean; legacy: boolean; all: boolean; entries: string[] };
  picked: {
    scope: 'machine' | 'store' | 'project-legacy'; id: string; name: string; projectId: string | null;
    status: 'completed' | 'partial'; label: string | null; files: number | null; bytes: number | null;
    references: { store: boolean | null; project: boolean | null };
    bound: { snapshotRevision: string | null; receiptRevision: string | null; contentHash: string | null };
  }[];
  skipped: { scope: string; id: string; projectId: string | null; reason: 'active' }[];
  freed: number;
  projectChecked: boolean;                       // false outside a project
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
```

`bound` for a machine or legacy entry holds `snapshotRevision` and `receiptRevision` from the inspection (`receiptRevision` null for a partial entry). For a throwing inspection, `snapshotRevision` is null. `contentHash` is null. For a store entry, `snapshotRevision` and `receiptRevision` are null and `contentHash` is the recomputed hash. For a `.prune-*` or `.tmp-*` leftover, `bound` is all null and the id is the folder name.

The revision is `sha256(canonicalJson(body))` (`packages/contracts/src/index.ts:137`). `picked` is sorted like the list.

### 4.3 Prune result, `bowerloom/cache-prune-result/v1beta1`

```ts
{ format, planRevision, deleted: [{ scope, id, projectId }], skipped: [{ scope, id, projectId, reason }], freed: number, executionAuthorized: false }
```

### 4.4 `removeCacheEntry`

New function in `packages/skill-sources/src/cache.ts`, exported:

```ts
export function removeCacheEntry(stateRoot: string, place: { scope: 'machine' | 'store' | 'project-legacy'; projectId: string | null }, name: string, held: { assertHeld(): void }): void
```

The function derives `root` from `stateRoot` and `place`. Steps:

0. The name matches `^op-[a-f0-9]{32}$`, `^(skill|prompt|team)-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{64}$`, `^\.tmp-.{1,200}$`, or `^\.prune-.{1,200}$`, and holds no `/`. Else refuse `CACHE_PRUNE_FAILED`.
   0a. The root is `<stateRoot>/cache`, `<stateRoot>/store-cache`, or `<stateRoot>/<projectId>/cache`, and `realpathSync(root) === root` (as `cache.ts:161,236` already require). The root, and for legacy `<stateRoot>/<projectId>`, are real folders, not links, owned by the user, with mode 0700. Else refuse `CACHE_PRUNE_FAILED`.
1. `held.assertHeld()`.
2. `lstat(join(root, name))`. It must be a real folder (not a link), owned by the user, with mode 0700 and no group or world write. Else refuse `CACHE_PRUNE_FAILED`.
3. If `name` starts with `.prune-`, skip the rename. Otherwise rename it to `join(root, '.prune-' + name + '-' + 8 random hex)`. The new name must not exist. Flush `root`.
4. `held.assertHeld()`.
5. Remove the renamed folder with `fs.rmSync(path, { recursive: true, force: false })`. `rmSync` unlinks links without following them. Then flush `root`.

The skills cache and the legacy caches use `root = <cache folder>`. The store cache uses `root = <stateRoot>/store-cache`. The function does not read the contents of the entry, so a damaged entry can be removed.

## 5. Refusal codes

| Code | Cause | Next step |
|---|---|---|
| `CACHE_ENTRY_NOT_FOUND` | `--entry` matched nothing. | `bowerloom cache list` |
| `CACHE_ENTRY_BUSY` | `--entry` named an entry that another command is using. | When the other command is done, run this one again. |
| `CACHE_PRUNE_FAILED` | A delete step failed. The message says how many entries were deleted. | `bowerloom cache list`, then run the command again. |
| `STALE_APPROVAL` | An entry changed between plan and apply. | Run the command again without `--approve`. |
| `PROJECT_LOCK_UNAVAILABLE` | The cache lock stayed busy for 60 seconds. | Run the command again. |
| `STORE_STATE_NESTED`, `SKILLS_STATE_UNSAFE` | The state folder or a cache root fails the nesting or folder checks. | As in specs 04 and 06. |
| `USAGE` | No selector, `--all` with another selector, a short or non-hex prefix, a repeated prefix, or a prefix that matches two entries. | `bowerloom help cache` |

Add `CACHE_ENTRY_NOT_FOUND`, `CACHE_ENTRY_BUSY`, and `CACHE_PRUNE_FAILED` to `packages/project-sync/src/refusal.ts:11-37` with these fixed messages:

- `CACHE_ENTRY_NOT_FOUND`: `No cache entry starts with that text.`
- `CACHE_ENTRY_BUSY`: `Another Bowerloom command is using that cache entry.`
- `CACHE_PRUNE_FAILED`: `Bowerloom failed to delete a cache entry. Entries it deleted before that stay deleted.`

Add the three to `REFUSALS` in `apps/cli/src/human.ts:224` with the sentences and next steps above. In `REFUSALS` the sentence is the fixed message and the next text is the Next step cell. `removeCacheEntry` throws `DefinitionError` with these codes through a small helper in `cache.ts`. The cache module has its own fixed-code lists (`cache.ts:40-100`). Do not add the codes to those lists. Throw `new DefinitionError(code, message)` from `packages/contracts/src/index.ts:61` instead.

## 6. Where to change

Create:

- `packages/project-sync/src/cache-admin.ts`: `listCache(input)`, `planCachePrune(input)`, `applyCachePrune(input, revision, signal)`, `referenceSets(input)` (3.2). `input` is `{ stateRoot, project: ProjectContext | null, home, env, hooks?: { inspect?(root, id): Promise<CacheInspection>; afterRemove?(index: number): void } }`.
- `apps/cli/src/cache.ts`: `runCacheCommand(args, cwd, home, write, io, env)` with `humanBytes`.
- Test files in section 10.

Change:

- `packages/skill-sources/src/cache.ts`: add and export `removeCacheEntry` (4.4). No other change in that file.
- `packages/project-sync/src/store-git.ts` (spec 06): `readStoreCache(root, key)` returns `{ rows, valid }` and throws only on a guard failure, `storeCacheRoot(stateRoot)` returns the folder. `cache-admin.ts` uses them.
- `packages/project-sync/src/cache-index.ts:55,66`: no change. Import `entryRequest` and `cacheOperationId`.
- `packages/project-sync/src/index.ts`: export `listCache`, `planCachePrune`, `applyCachePrune`.
- `packages/project-sync/src/refusal.ts:11-37`: three codes.
- `apps/cli/src/main.ts:132`: add `'cache'` to `COMMANDS`. After the `ls` branch (line 145), add a branch that imports `./cache.js` and calls `runCacheCommand`. `help cache`, `cache --help`, `cache list --help`, and `cache prune --help` print `TOPICS.cache`.
- `apps/cli/src/human.ts`: `SECTIONS` does not change. Add `TOPICS.cache` near line 45, and extend `TOPICS.store`. Append these two lines to its `Usage:` block, after the lines of spec 08: `  bowerloom cache list [--json]` and `  bowerloom cache prune [--unreferenced] [--partial] [--legacy] [--all] [--entry <id-prefix>]... [--approve <revision>] [--json]`. Add the paragraph `cache list shows the bytes that Bowerloom downloaded and kept on this machine. cache prune deletes them after you approve a plan.` after one empty line, with no second `Usage:` header. Add the refusal words (line 224). `tests/help-human.test.ts:20-45` holds the first screen, which this spec does not change. Add `'cache'` to the help loops at lines 79 and 84.
- `package.json:30`: no change. `packages/project-sync/test` and `packages/skill-sources/test` are already in the glob.

## 7. Edge cases

| Case | Expected result |
|---|---|
| No state folder yet | `cache list` prints `The cache is empty.` Exit 0. `cache prune --all` prints `Nothing to prune.` |
| The cache folder holds a stray file | Counted under `unlisted`. Never deleted. |
| An `op-*` folder whose inspection throws | Listed as `partial` with no label. `--partial` deletes it. |
| An entry with an active owner | Listed with `active: true`. Group selectors skip it. `--entry` refuses `CACHE_ENTRY_BUSY`. |
| `.prune-*` leftover | Listed as `partial`. `--partial` and `--all` delete it. |
| `.tmp-<key>-*` in the store cache | Listed as `partial`. `--partial` and `--all` delete it. |
| A store-cache folder with a changed file | Status `partial` (hash mismatch). `--partial` deletes it. |
| `--unreferenced` outside a project | Picks entries that the store does not list. The plan says `Other projects on this machine are not checked.` and `projectChecked` is false. |
| `--unreferenced` where the store is refused | No entry is picked (the store source is unknown). The plan says so. `Nothing to prune.` |
| `--unreferenced` where the lock is invalid | No entry is picked (the project source is unknown). |
| `--unreferenced` in a project whose `skills.json` pins pin P | The eight operation ids of P are referenced and kept. |
| `--entry` with 7 characters | `USAGE`. |
| `--entry` with a prefix of a store hash | Picks the store entry. |
| `--entry` twice with the same prefix | `USAGE`. |
| `--all` with `--partial` | `USAGE`. |
| The plan is approved and a new fetch lands before apply | The picked entries are unchanged, so apply deletes them. The new entry is not in the plan and stays. |
| An entry changes between plan and apply (a retry replaced it) | `STALE_APPROVAL`. Nothing is deleted. |
| A delete fails on the third of five entries | `CACHE_PRUNE_FAILED`, `Deleted 2 of 5 entries.` The third is a `.prune-*` leftover. Rerun finishes. |
| An entry whose owner lock is older than 24 hours | Listed with `active: true, stale: true`. Group selectors and `--entry` treat it as not active. |
| A `.prune-*` leftover in a legacy cache | Listed as `partial`. `--partial` and `--all` delete it. |
| Two `cache prune` at once | The second waits on the cache lock, then its plan is stale (`STALE_APPROVAL`). |
| `cache prune` while `skills sync` fetches | Prune waits for the lock for up to 60 seconds. |
| The entry folder is a link | `removeCacheEntry` refuses `CACHE_PRUNE_FAILED`. `cache list` shows nothing for it and counts it under `unlisted`. |
| A project that needs a pruned pin | `skills sync` fetches it again. `apply` holds the item with `SKILLS_OFFLINE`. |
| After a prune, `ls`, `status`, and installed copies | Unchanged. |
| 5000 entries | `truncated: true`, 4096 listed. `--all` picks only the listed entries. The plan says `More entries exist.` and the person runs it again. |

## 8. Migration from beta.2 projects

- The skills cache of beta.2 is the same cache. Entries made by beta.2 appear in `cache list`.
- The per-project caches of beta.0 and beta.1 appear as `project-legacy`. `cache prune --legacy` deletes them. Bowerloom never deletes them by itself.
- No file format changes. No index file is created.

## 9. Docs changes for this track

- `apps/docs/src/content/docs/cli.md`: a new section `## Cache` with the usage lines, the help text of 3.3, and one paragraph on what prune never touches.
- `apps/docs/src/content/docs/guides/add-skills.md`: a short section "See and clear the cache" that links to `cli.md`.
- `apps/docs/src/content/docs/troubleshooting.md`: an entry "My disk is filling up" that points to `cache list` and `cache prune --unreferenced`.
- `apps/docs/src/content/docs/reference/errors.md`: rows for the three `CACHE_*` codes.
- `apps/docs/src/content/docs/releases.md`, `## 0.7.0-beta.3`: "`bowerloom cache list` shows the skill bytes that Bowerloom keeps on your machine. `bowerloom cache prune` deletes them after you approve a plan. Bowerloom never deletes the cache by itself."
- Spec 10 mentions the store cache in the page "Where your items come from".

## 10. Acceptance tests

Unit tests build a state folder with real cache entries. Use the fixtures of `packages/skill-sources/test/cache-seed.test.mjs` to seed skills-cache entries, and `writeStoreCache` (spec 06) for store entries. CLI tests set `HOME` and `XDG_STATE_HOME` to temporary folders and import `tests/support/isolate-home.js`.

`packages/skill-sources/test/remove-cache.test.mjs`:

1. `removeCacheEntry` removes a seeded entry. The folder is gone, no `.prune-*` is left, and the root is unchanged otherwise.
2. A link entry refuses `CACHE_PRUNE_FAILED` and the link target is untouched.
3. An entry with group write permission, or one with mode 0755, refuses `CACHE_PRUNE_FAILED`. An entry owned by another user also refuses. The last case needs a foreign owner. Without one, the test skips that case and says so.
4. A link inside the entry is unlinked and its target survives.
5. A name with `/` or `..` refuses.
6. After a simulated crash between rename and remove (a hook throws after the rename), a `.prune-*` folder remains. A second call on that name removes it.
7. `held.assertHeld` is called before the rename and before the delete.
8. A name that starts with `.prune-` skips the rename. A name that fails step 0 refuses. A root that is a link, has the wrong owner, or has a mode other than 0700 refuses (step 0a).

`packages/project-sync/test/cache-admin.test.mjs`:

1. An empty state folder lists nothing.
2. Three seeded skills-cache entries list with labels, file counts, and byte sums that match the receipt.
3. An entry referenced by the store `skills.json` gets `references.store: true` and a `key`. One referenced by the project `skills.json` gets `references.project: true`. An unreferenced one has `key: null` and both false.
4. Outside a project, `references.project` is null.
5. A refused store gives `references.store: null` and `unreadableSources: ["store"]`.
6. A lock `pin` and a lock `authored.hash` count as project references (skills cache and store cache).
7. A partial entry (a fetch stopped before completion) lists as `partial`. An entry with an active owner lists `active: true`.
8. A store-cache entry lists as `completed`. A changed file makes it `partial`.
9. Legacy caches list with `projectId`.
10. 4097 fake `op-` folders give `truncated: true` and 4096 entries (use empty folders and a hook that skips inspection).
11. Stray names count under `unlisted`.
12. `planCachePrune` for each selector picks the entries in 3.4. When a source is unknown, `--unreferenced` picks nothing.
13. `--entry` prefix rules: 7 characters, non-hex, a repeat, no match, two matches, an active entry.
14. The plan JSON matches 4.2. When a bound value changes, the revision changes.
15. `applyCachePrune` deletes the picked entries and nothing else (snapshot compare of the rest).
16. A changed entry between plan and apply gives `STALE_APPROVAL` and deletes nothing.
17. A failure on the third entry (a hook) gives `CACHE_PRUNE_FAILED` with `Deleted 2 of 5` and a `.prune-*` leftover. A rerun with `--partial` removes it.
18. The cache lock is held during apply (the test tries `withCacheLock` with `waitMs: 0` and expects `PROJECT_LOCK_UNAVAILABLE`).
19. Project files, `.bowerloom/managed`, `<stateRoot>/<projectId>/items`, and the store are byte-identical after a prune (snapshot).
20. Pruning a pin and then running the sync planner shows the item as `needs-fetch` again.
21. Selectors combine as a union, and each entry appears once.
22. `--unreferenced` where a source lists a picked entry between plan and apply refuses `STALE_APPROVAL`.
23. A project folder or cache in `<stateRoot>` that fails the folder checks counts under `unlisted`.
24. An entry whose owner lock is older than 24 hours lists `stale: true` and is picked by `--partial`.
25. Each of the unknown-source rules of 3.2 puts the source in `unreadableSources`.
26. `readStoreCache` throwing makes the entry `partial` with `label` null.

`tests/cache-cli.test.ts`:

1. `cache list` in an empty home prints `The cache is empty.` and exits 0.
2. After `skills add npm:... --global` with the fake network, `cache list` shows one entry with `[store]`.
3. `cache list --json` matches 4.1 field by field.
4. `cache prune --unreferenced` after the store pin is removed (the test edits the store `skills.json`) shows the plan with `delete` and exits 3. With `--approve` it deletes, prints `Deleted 1 entries, about ...`, and a second `cache list` is empty.
5. `cache prune` with no selector exits 2.
6. `cache prune --all --partial` exits 2.
7. `cache prune --entry abc` exits 2.
8. `cache prune --entry <id8>` picks that entry.
9. `cache prune --legacy` deletes a hand-made legacy cache entry and leaves the project folder.
10. `cache prune` run twice with the same approval: the second prints `Nothing to prune.` and exits 0.
11. `help cache` and `cache --help` print the topic.
12. `cache list` and `cache prune` without `--approve` write nothing (folder snapshot).
13. `tests/no-spawn.test.ts` still passes.

Update `tests/help-human.test.ts` (the help loops at lines 79 and 84 gain `'cache'`) and `tests/human-refusal.test.ts` (three codes).

## 11. Build order

1. `removeCacheEntry` with `remove-cache.test.mjs`.
2. `cache-admin.ts` list with its tests.
3. The prune plan and apply with their tests.
4. `apps/cli/src/cache.ts`, `main.ts`, `human.ts`.
5. `tests/cache-cli.test.ts` and the updates to existing tests.
6. Docs.
7. `npm run typecheck`, `npm test`.

## 12. Unverified items

1. `inspectSkillCache` on a partial entry. I read its signature (`cache.ts:281`) and the `CacheInspection` type (`cache.ts:37`), not its behavior on a half-written operation. Run test case 7 of `cache-admin.test.mjs` first. If the call throws for a partial entry, the entry is `partial` with no label. This spec already says so, and `scan` does the same (`cache-index.ts:98-101`). If the call hangs, race it against a 10-second timer and treat a timeout as `partial`.
2. The stale-owner rule. The field `activeOwner` comes from the `owner.lock` file inside an operation (`cache.ts:260`). The lock is taken at `cache.ts:313` and released at `cache.ts:308`. After a crash it can stay true. Test with a crashed fetch (a hook that exits after `owner.lock` is made). The rule of 3.4 (older than 24 hours counts as not active) covers it. If `lstat` mtime is not reliable, use the birth time of the folder.
3. The mode check of the entry folder (0700). `directory(path, true)` in `cache.ts:~150` requires mode 0700 for private folders. Entries made by Bowerloom have mode 0700. If a real entry has another mode, accept any mode with no group or world write in `removeCacheEntry`. Keep the owner check.
4. Whether `fs.rmSync` with `recursive` unlinks a link without following it on the Node version the repository targets. The Node documentation says it does. Test case 4 of `remove-cache.test.mjs` proves it. If it fails, walk the folder with `lstat` and unlink each entry yourself.
5. `readStoreCache` and `writeStoreCache` come from spec 06. If their names changed there, use the names in that spec's `store-git.ts`.
6. The cost of reading every live store item for hashes in `referenceSets`. A store has at most 256 skills and 512 items in the receipt (`LIMITS.items`, `files.ts:12`). Reading them is fast. If `cache list` takes more than a second in a test with a full store, compute store item hashes only when a store-cache entry exists.
7. The pin that a sync fetched and a prune removed. Pause sync after phase A with a hook, prune the pin, then resume. Expect `SKILLS_CACHE_RECOVERY_REQUIRED` and no `managed-pending.json`. If a pending record remains, report it in the pull request. Do not change sync in this spec.
8. The cost of `cache list`. Measure it on 64 real entries. If it takes more than a second, report it in the pull request.

## New decision for Hanna

Topic: `cache prune --unreferenced` outside a project.

Outside a project, Bowerloom checks only the store. Other projects on the machine are not checked. A pin that another project needs can be deleted. That project fetches the pin again at its next sync, so no data is lost.

- A. (Default) Allow it. The plan says `Other projects on this machine are not checked.`
- B. Refuse it outside a project, with `USAGE` and the text `Run cache prune --unreferenced inside a project, or name entries with --entry.`

Build variant A. The pull request records the decision. The plan lines of section 3.4 assume option A.
