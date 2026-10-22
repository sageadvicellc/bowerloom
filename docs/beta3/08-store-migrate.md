# 08. Store migrate and receipt clean

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 7 and decisions 6, 18, 19, 22, 23, and 24. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decision 18: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332968796. Decisions 22 to 24: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333364163.
- Lane: 2.
- Branch: `beta3/08-store-migrate`.
- Depends on: spec 06 (config, resolver, lock, shared rule, git-backed store) and spec 04 (store writes). Spec 07 adds the token. This spec reads the token only through the code of spec 06.
- Line numbers below are from commit c9730d3. Find each place by its function name if it moved.

## 2. Problem

A project that already defines skills, prompts, and teams in its own `.bowerloom` folder cannot move them to the store. A person would copy files by hand and edit three records. Two commands fix this.

`bowerloom store migrate` copies chosen items from the project to the store, switches them to `source: "store"` in `bowerloom.json`, and prints the lines that remove the old files from git. It deletes nothing (decision 6).

After the person deletes the old files, `bowerloom status` names each one as missing, because the project's authoring receipt still lists it. `bowerloom receipt clean` removes those entries after a plan and an approval (decision 18).

## 3. Behavior

### 3.1 `store migrate`

```text
bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all] [--commit <sha>] [--approve <revision>] [--json]
```

Help text, add to `TOPICS.store`:

```text
Usage:
  bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all] [--commit <sha>] [--approve <revision>] [--json]

Copies skills, prompts, and teams from this project to your store, ~/.bowerloom. Then it lists them in bowerloom.json
with the source store. It deletes nothing. It prints the git rm lines so you can delete the old files after you check.
--all picks every skill, prompt, and team of the project except first-team and personal-assistant.
In a shared project, a skill, prompt, or team that you wrote is switched to the store only after the store is
pushed to its git remote. Until then it is copied and nothing else changes. Run the command again after you push.
--commit <sha> records that commit of the store remote instead of the pushed commit of the current branch.
After you delete the old files, run bowerloom receipt clean.
It shows the plan first. Agents pass --approve <revision> or --json.
```

Rules:

1. It needs a project (`discoverProject`). Without one, refuse `PROJECT_NOT_FOUND`.
2. It needs at least one of `--skill`, `--prompt`, `--team`, or `--all`. Else `USAGE`. `--all` together with any other selector is `USAGE`. A selector given twice for the same id is `USAGE`.
3. The names `first-team` and `personal-assistant` refuse `MIGRATE_RESERVED` when named. `--all` skips them without a message.
4. The project must have a `.bowerloom` folder. If it has none, every selector refuses `MIGRATE_ITEM_NOT_FOUND`, and `--all` prints `Nothing to move.` and exits 0.
5. Find each item in the project.
   - A skill: an entry of `.bowerloom/skills.json`. A pinned entry (npm or git) is copied as an entry. A `local` entry needs the folder `.bowerloom/skills/<id>` to exist.
   - A prompt: an item of kind prompt in `.bowerloom/authoring/receipt.json` whose file `.bowerloom/prompts/<id>.md` exists.
   - A team: an item of kind team in the receipt whose folder `.bowerloom/teams/<id>` exists.
   - Anything else refuses `MIGRATE_ITEM_NOT_FOUND`. With `--all`, an item whose files are gone is skipped.
6. If `bowerloom.json` exists and lists the item with `source: "store"`, an explicit selector refuses `CONFIG_ITEM_SELECTED`, and `--all` skips the item.
7. Tags. A skill or prompt may be limited to teams (a `teams` tag). The store keeps the tag, so every tagged team must exist in the store after the move. For each tag, the team must be in the store already or be in this run's selection. Else refuse `MIGRATE_TEAM_MISSING`. The message names the team. With `--all` every project team moves, so the tags hold. `first-team` is never in the store, so a tag that names it refuses `MIGRATE_TEAM_MISSING`.
8. For each selected item, compare with the store.
   - Not in the store: state `copy`.
   - In the store with the same bytes: state `present`. For a pinned skill, the store entry equals the project entry when `canonicalJson` of both is equal. For a local skill, a prompt, and a team, the file lists (path, sha256, bytes) are equal. If the item is also registered in the store receipt, nothing needs doing for the copy. If it is not registered, the state is `register` (a leftover from a crash).
   - In the store with other bytes: refuse `MIGRATE_ID_EXISTS`. Bowerloom never overwrites a store item.
9. Decide for each item whether it switches in this run.
   - Not a shared project (spec 06, 3.9): every item switches.
   - Shared project: a pinned skill switches. A skill, prompt, or team written in the project switches only if it is shareable now. It is shareable when `readStoreRepo` has no problem, and the proof of spec 06 (3.10) succeeds for the store item at the pushed commit (or at `--commit`). If it is not shareable, the item is `copy-only`. Its config entry stays as it is. The plan says why.
10. The config change is the one `use` makes (spec 06, 3.5 step 2). If `bowerloom.json` is missing, create it with every project item as `source: "project"`, then flip the switched items to `store`. If it exists, flip those items, and add an item that the config did not list. Team tags in `via` do not change.
11. The lock: when a lock exists or the project is shared, add a lock item for each switched store item (spec 06, 3.13). A pinned item copies the entry. A written item uses the proof.
12. Nothing is deleted. No project file changes except `bowerloom.json` and `bowerloom.lock.json`.

Plan lines, verbatim:

```text
Move <n> items from this project to the store at ~/.bowerloom
Create the store at ~/.bowerloom (store.json). It holds definitions only.                         (only when the store is absent)
  skill <id>    copy of .bowerloom/skills/<id> (<n> files)
  skill <id>    pin copied to ~/.bowerloom/skills.json (<npm package@version | GitHub owner/repo@commit8>)
  prompt <id>   copy of .bowerloom/prompts/<id>.md
  team <id>     copy of .bowerloom/teams/<id> (<n> files)
  <kind> <id>   already in the store with the same bytes
  <kind> <id>   already in the store, not yet recorded. This run records it.
Not switched: <kind> <id> cannot be locked yet. <sentence>. Push the store, then run this command again.     (shared project only)
bowerloom.json: creates it, and lists <n> items of this project                                          (only when new)
bowerloom.json: <kind> <id> changes from project to store                                                (one line per switched item)
bowerloom.json: adds <kind> <id> (store)                                                                 (an item the config did not list)
bowerloom.lock.json: adds <kind> <id> (<lock source>)                                                    (one line per added lock item)
Network: reads api.github.com, to check the pushed copy of <n> items.                                    (only when a written item is checked)
Credentials: BOWERLOOM_GITHUB_TOKEN is set. It is sent to api.github.com for github.com/<owner>/<repo> only.   (spec 07, only when used)
Nothing in this project is deleted. When you have checked the result, you can remove the old copies yourself:
  git rm -r .bowerloom/skills/<id>
  git rm .bowerloom/prompts/<id>.md
  git rm -r .bowerloom/teams/<id>
Bowerloom does not edit .bowerloom/skills.json. Remove the line for skill <id> yourself.                 (one line per migrated skill)
After you delete the old files, run bowerloom receipt clean.
```

`<sentence>` is the sentence of the `STORE_ITEM_NOT_SHAREABLE` table in spec 06 (3.10). For a `LOCK_STORE_NOT_PUSHED` result it is `The pushed copy differs from your store`. For `LOCK_COMMIT_UNREACHABLE` it is `The commit is not on the remote`. In the plan, these cases do not refuse. They make the item `copy-only`. A `STORE_REMOTE_PRIVATE` or `STORE_REMOTE_AUTH_FAILED` result still refuses the command, because the person must fix the access first.

The remove lines list only items that switched. An item that is `copy-only` has no line.

The result text: `Moved <n> items to the store.`, then `Copied but not switched: <ids>.` when there are any, then the remove lines again, then `Next: bowerloom receipt clean`. The JSON result format is `bowerloom/store-migrate-result/v1beta1` (4.2).

Exit codes: 0 done or nothing to do, 1 refusal, 2 `USAGE`, 3 plan awaiting approval, 130 interrupt.

### 3.2 `store migrate` write order and crash recovery

The command takes two locks. The store lock comes first (`withStoreForWrite`, spec 04), then the project lock (`withProjectLock(project.dir)`). No other command takes both.

Under both locks, after the plan revision matches:

1. Remove the store's scratch (`authoring/.stage-*` and `authoring/.tmp-*`) that the plan lists.
2. Create the store (spec 04, 3.3) when the plan says so. `withStoreForWrite` does this before the work function runs.
3. For each item in state `copy`, in this order: skills, prompts, teams, each sorted by id:
   1. Stage the files in `<store>/authoring/.stage-<revision>/<item path>`. Use `makeFolder` and `writeNewFile` (`packages/project-authoring/src/files.ts:81-90`): folders have mode 0700 and files mode 0600. Check each file's bytes against the planned sha256 before and after writing.
   2. For a team, compile the staged `team.yaml` with `compileCrew` and require the same `candidateRevision` as the source.
   3. Move the staged item into `<store>/skills/<id>`, `<store>/prompts/<id>.md`, or `<store>/teams/<id>`. A folder moves with `rename`. A prompt moves with `link` then `unlink`, as `applyCreate` does (`packages/project-authoring/src/create.ts:~344-350`). Flush the parent folder.
4. Write the store `skills.json`: one change per skill, in id order. A pinned skill is `{ add: entry }`. A local skill is `{ add: localEntry }` with its `teams` tag. Each change goes through `planManifestChange(storeTarget(dir), change)` and `applyManifestChange` (spec 04). The plan binds the chain of hashes, like `CreatePlan.manifest.steps` (`create.ts:159-170`). A step whose hash does not match refuses `STALE_APPROVAL`.
5. Write the store authoring receipt once. Add every item in state `copy` or `register`. Each record has the file pins of the copied bytes, the project tag list, and `planRevision` set to this plan's revision. Use `writeReceiptRecord` (4.4).
6. Remove the staging folder.
7. Write `bowerloom.json` (spec 06, 3.14, with `writeGuardedFile`).
8. Write `bowerloom.lock.json` when the plan has lock changes.

Crash recovery. Every step is safe to repeat.

- A crash before step 3 changes nothing.
- A crash during step 3, 4, or 5 leaves some items in the store. The next `store migrate` for the same items finds each in state `present` (equal bytes, registered), `register` (equal bytes, not in the receipt), or `copy`. It does the missing steps. A store folder with other bytes refuses `MIGRATE_ID_EXISTS`.
- A crash after step 5 and before step 7 leaves the items in the store and the project unchanged. The next run finds all items `present` and only writes the config and lock.
- A crash after step 7 and before step 8 leaves a config newer than the lock. The next `use`, `unuse`, `lock update`, or `store migrate` heals it (spec 06, 3.13). A frozen run refuses `LOCK_CONFIG_MISMATCH`, which is safe.
- A leftover staging folder is removed at step 1 of the next run. The next `skill create --global` plan removes it too, because it is a scratch name (`packages/project-authoring/src/state.ts:20`).

### 3.3 Shared projects: copy now, switch after the push

This is decision 24. A person in a shared project runs `store migrate --all`. Pinned skills switch at once and get lock items. Skills, prompts, and teams the person wrote are copied to the store and stay `source: "project"` in `bowerloom.json`. The plan prints `Not switched: ...` for each. The person then commits and pushes the store (the commands are in `bowerloom store status`). They run the same command again. Every item is now `present` and shareable, so it switches and gets a lock item. The second plan has no copy lines.

If the person never pushes, the project stays correct and shareable. It still uses its own copies.

### 3.4 `receipt clean`

```text
bowerloom receipt clean [--global] [--approve <revision>] [--json]
```

Help text, `TOPICS.receipt`:

```text
Usage:
  bowerloom receipt clean [--global] [--approve <revision>] [--json]

Removes entries from the record of created items when the files of those items are gone. Run it after you delete
old files, for example after bowerloom store migrate. Then bowerloom status no longer names them as missing.
--global cleans the record of your store, ~/.bowerloom.
It also removes the local entry of a gone skill from skills.json, and the project entry from bowerloom.json.
It deletes no file and no installed copy. Copies that sync or apply made stay where they are.
It shows the plan first. Agents pass --approve <revision> or --json.
```

Rules:

1. Scope: the project (default) or the store (`--global`). The project scope needs a project. The store scope needs a valid store, else `STORE_NOT_FOUND`.
2. Read the authoring state (`readAuthoringState`, `packages/project-authoring/src/state.ts:~112`). If a pending record or scratch exists, refuse `AUTHORING_PENDING`. For the project, if `.bowerloom-revision.json` exists, refuse `REVISION_PENDING`.
3. Select every receipt item whose path is gone. The path is `itemPath(kind, id)` under the scope's base folder (`.bowerloom` or the store). "Gone" means `lstat` fails with `ENOENT`, the test of `gone` in `apps/cli/src/held.ts:20`. An item whose path exists is never selected, whether it is edited or not. Any other `lstat` failure refuses `AUTHORING_UNSAFE_PATH`.
4. For each selected skill, also remove its `local` entry from `skills.json` (project: `.bowerloom/skills.json`, store: `skills.json`), if that entry exists. A pinned entry (npm or git) with the same id is never removed.
5. For the project scope with a `bowerloom.json`, also remove the config entry for each selected item when it has `source: "project"`. Remove the id of a gone team from the `via` lists of other entries. Entries whose `via` list becomes empty are removed too.
6. The store scope changes no config and no lock.
7. Neither scope touches the lock.
8. If nothing is selected, print `Nothing to clean.` and exit 0. No approval is asked.
9. Nothing else is deleted. The catalogs and installed copies of these items stay. The next sync plan lists them as `kept`.

Plan lines, verbatim:

```text
Remove <n> entries from the record of created items (<.bowerloom/authoring/receipt.json | ~/.bowerloom/authoring/receipt.json>)
  <kind> <id>   its files are gone
skills.json: removes the local entry for skill <id>                  (one line per removed entry)
bowerloom.json: removes <kind> <id> (project)                        (one line per removed config entry)
This deletes no file and no installed copy. Copies of these items stay where they are.
```

Write order, under the project lock (project scope) or `withStoreForWrite` (store scope):

1. The config (project scope with a config).
2. `skills.json`: one `{ remove: id }` change for each entry, in id order. Each goes through `planManifestChange` and `applyManifestChange`. The plan binds the chain of hashes.
3. The receipt, once, last, with `writeReceiptRecord` (4.4).

Crash recovery. Run the command again. The plan finds the same gone items, because the receipt is still unchanged. It also finds that some config and `skills.json` entries are already removed. Those steps are no-ops and drop out of the plan lines. After step 3 the receipt no longer lists the items, so the next run says `Nothing to clean.`

Result text: `Removed <n> entries from the record of created items.` The JSON format is `bowerloom/receipt-clean-result/v1beta1` (4.3).

Exit codes: 0 done or nothing to clean, 1 refusal, 2 `USAGE`, 3 plan awaiting approval, 130 interrupt.

### 3.5 What `status` shows after a migrate

After `store migrate` and before the person deletes files, `status` is unchanged. After they delete the old files, `status` names each item as `held (AUTHORING_ITEM_MISSING)` (`apps/cli/src/held.ts:26-39`). After `receipt clean` those lines are gone.

## 4. Schemas

### 4.1 Migrate plan, `bowerloom/store-migrate-plan/v1beta1`

```ts
export interface StoreMigratePlan {
  format: 'bowerloom/store-migrate-plan/v1beta1';
  project: { dir: string; identity: DirectoryIdentity; ancestry: readonly PinnedDirectory[]; bowerloomIdentity: DirectoryIdentity };
  store: { create: boolean; dir: string; skills: Read | null; authoring: Read | null };
  shared: boolean;
  items: {
    kind: 'skill' | 'prompt' | 'team'; id: string;
    how: 'pinned' | 'local';                         // pinned only for a skill with an npm or git entry
    state: 'copy' | 'register' | 'present';
    switch: boolean;                                  // true when the config entry changes to store in this run
    notSwitched: { code: string; sentence: string } | null;
    teams: string[];                                  // the item's team tag
    files: { path: string; sha256: string; bytes: number }[];   // empty for a pinned skill
    entry: Entry | null;                              // the skills.json entry, for a skill
    candidate: string | null;                         // compiledCandidate of a team
    lock: string | null;                              // the lock source label, when a lock item is added
  }[];
  manifest: { steps: { id: string; before: Read | null; after: Read }[] } | null;
  config: { before: Read | null; after: Read; text: string; created: boolean } | null;
  lock: { before: Read | null; after: Read; text: string } | null;
  scratch: string[];
  network: { hosts: string[]; credentials: null | { variable: string; host: string; repositories: string[] } };
  commit: string | null;                              // the commit the lock items use
  removeLines: string[];                              // the lines printed after the plan
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface Read { sha256: string; bytes: number }
```

The revision is `sha256(canonicalJson(body))` (`packages/contracts/src/index.ts:137`). Items are sorted by kind (skill, prompt, team) and then by id.

### 4.2 Migrate result, `bowerloom/store-migrate-result/v1beta1`

```ts
{ format, planRevision, moved: [{ kind, id, state }], notSwitched: [{ kind, id, code }], configSha256, configBytes,
  lockSha256: string | null, lockBytes: number | null, removeLines: string[], executionAuthorized: false }
```

### 4.3 Receipt clean plan and result

Plan, `bowerloom/receipt-clean-plan/v1beta1`:

```ts
export interface ReceiptCleanPlan {
  format: 'bowerloom/receipt-clean-plan/v1beta1';
  scope: 'project' | 'store';
  project: { dir: string; identity: DirectoryIdentity | null };     // for the store scope, dir is the store folder and identity is null
  items: { kind: 'skill' | 'prompt' | 'team'; id: string; path: string }[];   // sorted by kind then id
  manifest: { steps: { id: string; before: Read | null; after: Read }[] } | null;
  config: { before: Read; after: Read; text: string; removes: { kind: string; id: string }[] } | null;
  receipt: { before: Read; after: Read; text: string };
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
```

Result, `bowerloom/receipt-clean-result/v1beta1`: `{ format, planRevision, scope, removed: [{ kind, id }], executionAuthorized: false }`.

### 4.4 Shared receipt writer

New file `packages/project-authoring/src/receipt-write.ts`:

```ts
export function writeReceiptRecord(auth: string, planRevision: string, before: Read | null, next: readonly AuthoredItem[],
  live: () => void, readNow: () => Read | null): Read
```

It does what the `writeReceipt` closure of `applyCreate` does (`packages/project-authoring/src/create.ts:~286-298`). It writes a temporary record named by `tempName(planRevision, 'receipt')`, runs `live()`, rechecks that the receipt's hash still equals `before` (`STALE_APPROVAL` if not), links the temporary file when `before` is null or renames it when not, flushes the folder, and returns the new `Read`. `applyCreate` calls it in place of its closure. The create tests must pass unchanged.

### 4.5 Manifest change kind `remove`

In `packages/skill-manifest/src/add.ts`:

- `ManifestChange` (line 42) becomes `{ add: Entry } | { replace: Entry } | { remove: string }`. The string is the entry id.
- `planManifestChange` (line 122): accept the key `remove` in the check at line 126. For `remove`, the entry must exist (`SKILLS_ADD_REPLACE_MISSING` if not) and must be of kind `local` (`MANIFEST_INVALID` if not). The new manifest drops it. The plan's `change` is `{ remove: <the removed entry> }`.
- `ManifestChangePlan.change` (line 21-40) gains `{ remove: Entry }`.
- `changeOf(plan)` (line 154) returns `{ remove: entry.id }` for a `remove` plan.
- `applyManifestChange` (line 170): the result key for a remove is `removed: <id>`. `ManifestChangeReceipt` (line 43) gains `{ removed: string }`.
- If the manifest has no skills after the removal, the file stays with `skills: []`. That is valid.

## 5. Refusal codes

| Code | Cause | Next step |
|---|---|---|
| `MIGRATE_ITEM_NOT_FOUND` | A selected item is not defined in the project, or its files are gone. | `bowerloom ls` |
| `MIGRATE_ID_EXISTS` | The store already holds an item with that kind and id but other bytes. | Rename the project item, or remove the store item yourself. |
| `MIGRATE_RESERVED` | `first-team` or `personal-assistant` was named. Setup owns them. | `bowerloom store migrate --all` skips them. |
| `MIGRATE_TEAM_MISSING` | A skill or prompt is limited to a team that is not in the store and not in this run. The message names the team. | Add `--team <name>` to move that team too. |
| `CONFIG_ITEM_SELECTED` | A selected item is already listed from the store. | `bowerloom ls` |
| `STORE_REMOTE_PRIVATE`, `STORE_REMOTE_AUTH_FAILED` | The store remote cannot be read. | As in specs 06 and 07. |
| `AUTHORING_PENDING` | `receipt clean` found a pending record or scratch. | Run the create command of the pending item again to finish it. |
| `REVISION_PENDING` | A revise of this project is unfinished. | `bowerloom help advanced` |
| `AUTHORING_UNSAFE_PATH` | `receipt clean` found an item path it cannot read. | `ls -la .bowerloom` |
| `STORE_NOT_FOUND` | `receipt clean --global` needs a store and there is none. | `bowerloom skill create <name> --global` |

Add the four `MIGRATE_*` codes to `packages/project-config/src/refusal.ts` with fixed messages, and to `REFUSALS` in `apps/cli/src/human.ts:224`. The other codes exist already.

## 6. Where to change

Create:

- `packages/project-sync/src/migrate-store.ts`: `planStoreMigrate(input)` and `applyStoreMigrate(input, revision, deps)`. The existing `packages/project-sync/src/migrate.ts` is `skills migrate` for the older install format. Do not touch it.
- `packages/project-sync/src/receipt-clean.ts`: `planReceiptClean(input)` and `applyReceiptClean(input, revision, held)`.
- `packages/project-authoring/src/receipt-write.ts` (4.4).
- `apps/cli/src/receipt.ts`: `runReceiptCommand(args, cwd, home, write, io, env)` for `receipt clean`.
- Test files in section 10.

Change:

- `packages/project-authoring/src/create.ts:~286-298` (the `writeReceipt` closure in `applyCreate`): call `writeReceiptRecord`. Export `pinsOf` (line 140) and `planned` (line 139).
- `packages/project-authoring/src/index.ts:5-11`: export `writeReceiptRecord`, `pinsOf`, `planned`, `readTree`, `itemPath`, and `receiptOf`.
- `packages/skill-manifest/src/add.ts:21-44, 122-160, 154-161, 170-201`: the `remove` change (4.5).
- `apps/cli/src/store.ts` (spec 03): add the `migrate` word. `runStoreCommand` parses the flags above. An unknown flag refuses `USAGE` with `Use bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all], with optional --commit <sha>, --approve <revision> and --json.`
- `apps/cli/src/main.ts:132`: add `'receipt'` to `COMMANDS`. Add a branch for `receipt` after the `store` branch that imports `./receipt.js`. `help receipt` and `receipt --help` print `TOPICS.receipt`.
- `apps/cli/src/human.ts`: `SECTIONS` (line 13) gets a new section `Store` with the lines `bowerloom store migrate --all   Move this project's items to your store.` and `bowerloom receipt clean   Forget created items whose files you deleted.` Add `TOPICS.receipt` and extend `TOPICS.store`. Add the refusal words (line 224). `tests/help-human.test.ts:20-45` holds the first screen.
- `apps/cli/src/held.ts:26-39` (`missingItems`): no code change. Add a comment that `receipt clean` clears these lines.
- Reuse from spec 06: `resolveProject`, `readStoreDefinitions`, `localItemRows`, `proveAuthored`, `readStoreRepo`, `isSharedProject`, the config text builders in `change.ts`, `writeGuardedFile`, and the lock builders. Export what migrate needs from `packages/project-sync/src/index.ts`.
- `package.json:30`: no change. The new tests sit in folders that the glob lists.

## 7. Edge cases

| Case | Expected result |
|---|---|
| `store migrate` with no selector | `USAGE`. |
| `store migrate --all --skill x` | `USAGE`. |
| `store migrate --skill first-team` | `MIGRATE_RESERVED`. |
| `store migrate --all` in a project with only `first-team` and `personal-assistant` | `Nothing to move.` Exit 0. |
| `store migrate --skill nope` | `MIGRATE_ITEM_NOT_FOUND`. |
| A prompt registered in the receipt whose file is gone | `MIGRATE_ITEM_NOT_FOUND` for an explicit selector. `--all` skips it. |
| The store has a skill `x` with the same bytes, registered | State `present`. No copy. The config flips. |
| The store has a skill `x` with other bytes | `MIGRATE_ID_EXISTS`. Nothing is written. |
| The store has folder `skills/x` with the same bytes but no receipt entry | State `register`. The receipt gets the entry. |
| A skill tagged `research`, the store has no team `research`, and `--team research` is not given | `MIGRATE_TEAM_MISSING`. |
| A skill tagged `first-team` | `MIGRATE_TEAM_MISSING`. |
| `--all` with tagged items and their teams | Teams move too. Tags hold. |
| A pinned skill whose store entry is identical | `present`. |
| A pinned skill whose store entry differs in version | `MIGRATE_ID_EXISTS`. |
| The 257th store skill | `MANIFEST_LIMIT`. |
| The project config lists `x` from the store already | Explicit selector: `CONFIG_ITEM_SELECTED`. `--all`: skipped. |
| The project has no `bowerloom.json` | The plan creates it with all project items, then flips the chosen ones. |
| Not a shared project | Every item switches. No lock unless one exists. No network. |
| Shared project, pinned skill | Switches. Lock item added. No network. |
| Shared project, written skill, store has no `.git` | Copied. `Not switched: ... The store is not a git repository.` The config entry stays `project`. |
| Shared project, written skill, store pushed and equal | Switches. Lock item added after the proof. |
| Shared project, written skill, store edited after the push | `Not switched: ... The pushed copy differs from your store.` |
| Shared project, rerun after the push | All items `present`. They switch and lock. No copy lines. |
| Shared project, the remote is private and no token | `STORE_REMOTE_PRIVATE`. Nothing is written. |
| A crash after the store receipt write | Rerun finishes the config and lock. |
| A crash during the copy of the second item | Rerun sees the first `present` and copies the second. |
| `receipt clean` with no gone items | `Nothing to clean.` Exit 0. |
| `receipt clean` while a pending record exists | `AUTHORING_PENDING`. |
| `receipt clean` where a skill's folder is gone and the `skills.json` entry is `local` | Both are removed. |
| `receipt clean` removes a project prompt that the config lists | The config entry is removed. |
| `receipt clean` removes a gone team that other entries use in `via` | The team leaves those `via` lists. Entries left with no `via` are removed. |
| `receipt clean` twice | The second says `Nothing to clean.` |
| `receipt clean --global` with no store | `STORE_NOT_FOUND`. |
| `receipt clean` and an installed copy of a removed item exists | The copy stays. The next sync plan says it is kept. |
| Two `store migrate` at once | The second waits on the store lock or refuses `STORE_LOCKED`. Its plan is stale: `STALE_APPROVAL`. |

## 8. Migration from beta.2 projects

- This spec is the migration path. A beta.2 project has no `bowerloom.json`. `store migrate` creates it.
- The steps for a person: run `bowerloom store migrate --all`, review the plan, and approve. Check the result with `bowerloom ls`. Run `bowerloom skills sync` and `bowerloom apply`. The copies are up to date, because the bytes are equal. Delete the old files with the printed lines. Edit `.bowerloom/skills.json` to remove the migrated lines. Run `bowerloom receipt clean`.
- For a shared project: after the first run, commit and push the store (the commands are in `bowerloom store status`). Run `bowerloom store migrate --all` again. Commit `bowerloom.json` and `bowerloom.lock.json`.
- Installed copies do not change. A local skill that moves to the store keeps its catalog until the next update. The update check treats `local` and `store` as one family (spec 06, 3.12).
- No state migrates by itself. No file is deleted.

## 9. Docs changes for this track

- `apps/docs/src/content/docs/cli.md`: add `bowerloom store migrate ...` and `bowerloom receipt clean ...` with a paragraph each, built from the help text in 3.1 and 3.4.
- `apps/docs/src/content/docs/guides/existing-project.md`: a section "Move your items to the store" with the steps of section 8.
- `apps/docs/src/content/docs/guides/create-items.md`: a sentence that `store migrate` moves existing items.
- `apps/docs/src/content/docs/reference/errors.md`: rows for the four `MIGRATE_*` codes.
- `apps/docs/src/content/docs/releases.md`, `## 0.7.0-beta.3`: "`bowerloom store migrate` copies skills, prompts, and teams from a project to your store and lists them in `bowerloom.json`. It deletes nothing. `bowerloom receipt clean` removes the records of items whose files you deleted."
- Spec 10 covers the shared-project flow in the page "Where your items come from".

## 10. Acceptance tests

Every CLI test spawns the CLI with `HOME` and `XDG_STATE_HOME` set to temporary folders and imports `tests/support/isolate-home.js`. Tests that need GitHub use `tests/support/fake-github-repo.ts` (spec 06).

`packages/project-sync/test/migrate-store.test.mjs`:

1. A project with a pinned npm skill, a local skill, a prompt, and a team: `--all` plans one line each, with state `copy`, and the plan JSON matches 4.1.
2. Apply copies each item. The store has the same file bytes. The store receipt lists each with the right pins and tags. The store `skills.json` has the pinned entry and the local entry.
3. The project files are unchanged. Compare the whole `.bowerloom` tree byte for byte before and after. `bowerloom.json` and `bowerloom.lock.json` sit outside that tree.
4. `bowerloom.json` is created with the project items and the chosen ones as `store`. Its text is the exact serialization of spec 03.
5. An existing `bowerloom.json` is edited: the chosen items flip, an unlisted item is added, other entries stay.
6. A tag whose team is missing refuses `MIGRATE_TEAM_MISSING`. With the team selected it passes. A `first-team` tag refuses.
7. `MIGRATE_RESERVED`, `MIGRATE_ITEM_NOT_FOUND`, `MIGRATE_ID_EXISTS` (each kind), and `CONFIG_ITEM_SELECTED`.
8. States `present` and `register`, by seeding the store first.
9. A team's compile candidate equals the source candidate. A mutated staged file refuses `STALE_APPROVAL`.
10. Not shared: every item switches and no lock is written. With a lock already present, lock items are added.
11. Shared (a `.git/config` with an origin in the test project): a pinned skill switches and locks. A written item with no store `.git` is `copy-only` with the right sentence. With the fake repo pushed and equal, it switches and locks. With the store edited after the build, it is `copy-only` with the pushed-copy sentence.
12. Rerun after the push: all items `present`, no copy, items switch and lock.
13. Crash points: a test hook throws after each of steps 3, 4, 5, and 7. Each rerun reaches the final state.
14. Stale plan: change a project file, then apply with the old revision: `STALE_APPROVAL`. Change the store `skills.json`: the same.
15. The printed remove lines list only switched items and match the plan text exactly.
16. The 257th skill refuses `MANIFEST_LIMIT`. Nothing is written.
17. Lock order: the test records that the store lock is taken before the project lock.
18. The staging folder is gone after a run and after a rerun of a crash.

`packages/project-sync/test/receipt-clean.test.mjs`:

1. Project scope: a gone skill, prompt, and team are selected. Present items are not.
2. The `skills.json` local entry of the gone skill is removed. A pinned entry stays.
3. The config entries with `source: "project"` are removed. `via` lists lose a gone team. Entries left with no `via` are removed.
4. The receipt no longer lists the items. Its bytes are the exact serialization (`recordText`).
5. Nothing is deleted from disk (snapshot).
6. A pending record or scratch refuses `AUTHORING_PENDING`. A revision file refuses `REVISION_PENDING`.
7. Store scope: the store receipt and store `skills.json` change. No config and no lock change.
8. `Nothing to clean.` when nothing is gone, for both scopes.
9. Crash points: a hook throws after the config write and after the `skills.json` write. Each rerun finishes and a third run says nothing to clean.
10. A stale plan refuses `STALE_APPROVAL`.
11. Running twice with approval leaves the second run at `Nothing to clean.`

`packages/skill-manifest/test/remove.test.mjs`:

1. `{ remove: id }` on a local entry removes it. The manifest stays valid with zero skills.
2. It refuses a pinned entry (`MANIFEST_INVALID`) and a missing id (`SKILLS_ADD_REPLACE_MISSING`).
3. The plan JSON carries `change.remove` with the removed entry. `changeOf` returns `{ remove: id }`.
4. `applyManifestChange` writes the file and returns `removed`.
5. The old `add.test.mjs` and `replace.test.mjs` cases still pass.

`packages/project-authoring/test/receipt-write.test.mjs`:

1. `writeReceiptRecord` creates a new receipt with `link`, and replaces an existing one with `rename`.
2. A changed receipt hash between plan and write gives `STALE_APPROVAL`.
3. The temporary file is gone after the call, and after a thrown error.
4. `applyCreate` still passes every case of `tests/authoring.test.ts` and `tests/create-cli.test.ts` that touches the receipt.

`tests/store-migrate-cli.test.ts`:

1. A beta.2 style project (made with `up`) plus a pinned skill (fake npm), a local skill, a prompt, and a team: `store migrate --all` shows the plan and exits 3. With `--approve` it exits 0 and prints the remove lines and `Next: bowerloom receipt clean`.
2. `ls` and `ls --global` show the items with the right sources.
3. `skills sync` and `apply` after the migrate show every item `up to date`, because the bytes are equal.
4. The test then deletes the old files with a real git repository (the test runs `git init` itself and runs the printed lines), edits `skills.json`, and runs `status`. Each removed item is `held (AUTHORING_ITEM_MISSING)`.
5. `receipt clean` shows its plan and exits 3, applies with `--approve`, and `status` no longer names the items.
6. Shared project flow with the fake repo: the first run copies written items and prints `Not switched`. After the test adds `.git` files and routes for the store and runs again, items switch and `bowerloom.lock.json` has the expected bytes.
7. `help store` and `help receipt` print the topics.
8. Error paths: no selector exits 2, `--all` with a selector exits 2, reserved names, missing items.
9. `receipt clean --global` outside a project works. With no store it refuses `STORE_NOT_FOUND`.

Update `tests/help-human.test.ts` (first screen), `tests/human-refusal.test.ts` (four new codes), and `tests/store-foundation-cli.test.ts` (the `store` usage words).

## 11. Build order

1. `{ remove }` in `add.ts` with `remove.test.mjs`.
2. `writeReceiptRecord` and the refactor of `applyCreate` with `receipt-write.test.mjs`. Run the existing authoring tests.
3. `receipt-clean.ts` with its tests, then `apps/cli/src/receipt.ts`.
4. `migrate-store.ts` plan with its tests, then apply, then the crash cases.
5. `apps/cli/src/store.ts` `migrate` word, `main.ts`, `human.ts`.
6. CLI tests and updates to existing tests.
7. Docs.
8. `npm run typecheck`, `npm test`.

## 12. Unverified items

1. `compileCrew` on a staged team folder inside `authoring/.stage-<revision>`. `applyCreate` does the same for a project (`create.ts:~340`). Run the team case of `migrate-store.test.mjs` first. Stage the team under `<store>/authoring/.stage-<revision>/teams/<id>/`, exactly as `applyCreate` stages it. If `compileCrew` still refuses, pass `{ root: <stage folder> }` as its second argument (`packages/crew/src/index.ts:94`).
2. `readTree` limits: 256 entries and depth 8 (`packages/project-authoring/src/files.ts:12,64-77`). A team larger than that refuses `AUTHORING_UNSAFE_PATH`. Run a team with ten files first. If `--all` meets a team over the limit, skip it. For an explicit selector refuse `MIGRATE_ITEM_NOT_FOUND` with the extra sentence `The team is larger than a store item can be.` Do not raise the limit.
3. File sizes. `readTree` allows 256 KiB per file (`LIMITS.fileBytes`), and the lock allows 64 KiB. A local skill with a larger file migrates but cannot be locked. In a shared project it is `copy-only` with the sentence `The item is larger than a lock can record.` In a project that is not shared it migrates and switches.
4. `link` for a prompt across the staging and target folders. Both are on the store's device, so `link` works. If a test machine puts `HOME` on a device that refuses hard links, use `copyFile` with `COPYFILE_EXCL` for the prompt and remove the staged file. Keep the byte check.
5. `changeOf` and the plan type in `add.ts` are read at lines 154-161 and 21-44. Hidden callers of `plan.change` (the CLI review at `apps/cli/src/manifest.ts:~105`) assume `add` or `replace`. Search for each use of `.change`. Make each handle `remove` by showing `Remove skill <id> from <manifest>`.
6. Whether `status` shows one line per item after the old files are deleted and the `skills.json` local entry remains. The sync planner may hold the local skill first (`plan.ts:253`). Run case 4 of `store-migrate-cli.test.ts` early. `uniqueHolds` (`held.ts:50`) collapses lines by kind and id, so expect one line.
