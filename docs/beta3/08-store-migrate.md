# 08. Store migrate and receipt clean

## 1. Header

- Source: sageadvicellc/bowerloom#80, phase 7 and decisions 6, 18, 19, 22, 23, and 24. Issue body: https://github.com/sageadvicellc/bowerloom/issues/80. Decision 18: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6332968796. Decisions 22 to 24: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6333364163. The `--all` decision: https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6335218201.
- Lane: 2.
- Branch: `beta3/08-store-migrate`.
- Depends on: spec 06 (config, resolver, lock, shared rule, git-backed store) and spec 04 (store writes). Spec 07 adds the token. This spec reads the token only through the code of spec 06.
- Line numbers below are from commit c9730d3. If a line moved, find the place by its function name.

## 2. Problem

A project that already defines skills, prompts, and teams in its own `.bowerloom` folder cannot move them to the store. Today a person copies files by hand and edits three records. Two commands fix this.

`bowerloom store migrate` copies chosen items from the project to the store. It switches them to `source: "store"` in `bowerloom.json`. It prints the lines that remove the old files from git. It deletes nothing (decision 6).

After the person deletes the old files, `bowerloom status` names each one as missing, because the project's authoring receipt still lists it. `bowerloom receipt clean` removes those entries after a plan and an approval (decision 18).

## 3. Behavior

### 3.1 `store migrate`

```text
bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all] [--commit <sha>] [--approve <revision>] [--json]
```

Spec 08 adds two usage lines at the end of the `Usage:` block of `TOPICS.store`, after the lines of specs 03 to 07. It adds its paragraph after the last paragraph, with one empty line before it. There is no second `Usage:` header. Spec 08 also changes one line of spec 03: `It reads only and writes nothing, and it starts no workers.` becomes `store status reads only and writes nothing. No store command starts workers.` Spec 09 appends its lines after these. The two usage lines:

```text
  bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all] [--commit <sha>] [--approve <revision>] [--json]
  bowerloom receipt clean [--global] [--approve <revision>] [--json]
```

The paragraph:

```text
store migrate copies skills, prompts, and teams from this project to your store, ~/.bowerloom. Then it lists them in bowerloom.json
with the source store. It deletes nothing. It prints the git rm lines so you can delete the old files after you check.
--all picks every skill, prompt, and team that bowerloom.json lists, except first-team and personal-assistant.
If the project has no bowerloom.json, --all picks every skill, prompt, and team of the project.
Naming an item with --skill, --prompt, or --team moves it even when bowerloom.json does not list it.
Slices never move.
A store skill or prompt holds only md, txt, json, yaml, yml, csv, and license files. Each file is UTF-8, not empty, and not executable.
An item holds at most 126 files, 65536 bytes in a file, and 2 MiB in all.
In a shared project, a skill, prompt, or team that you wrote is switched to the store only after the store is
pushed to its git remote. Until then it is copied and nothing else changes. Run the command again after you push.
--commit <sha> records that commit of the store remote instead of the pushed commit of the current branch.
After you delete the old files, run bowerloom receipt clean.
It shows the plan first. Agents pass --approve <revision> or --json.
```

`bowerloom store migrate --help` prints `TOPICS.store`.

Rules:

1. It needs a project (`discoverProject`). Without one, refuse `PROJECT_NOT_FOUND`.
2. It needs at least one of `--skill`, `--prompt`, `--team`, or `--all`. Else `USAGE`. `--all` together with any other selector is `USAGE`. A selector given twice for the same id is `USAGE`. `--commit` must be 40 lower-case hex characters, else `USAGE`. In a project that is not shared, `--commit` is accepted and unused (`commit: null`).
3. `--team first-team` and `--skill personal-assistant` refuse `MIGRATE_RESERVED`. A prompt with either id is an ordinary prompt. `--all` skips `first-team` and `personal-assistant` without a message. Slices are never moved, and `--all` skips them.
3a. If no item remains after rules 3 to 7, print the skip lines and `Nothing to move.` and exit 0 without asking. Apply rule 14 only to a run that keeps at least one item.
4. The project must have a `.bowerloom` folder. If it has none, every selector refuses `MIGRATE_ITEM_NOT_FOUND`, and `--all` prints `Nothing to move.` and exits 0.
4a. Read `readAuthoringState(storeDir)` and `readAuthoringState(<project>/.bowerloom)`. A pending record in either refuses `AUTHORING_PENDING`. Store scratch goes into `scratch` and is removed at step 1. A project `.bowerloom-revision.json` refuses `REVISION_PENDING`.
5. Find each item in the project.
   - A skill: an entry of `.bowerloom/skills.json`. A pinned entry (npm or git) is copied as an entry. A `local` entry needs the folder `.bowerloom/skills/<id>` to exist.
   - A prompt: an item of kind prompt in `.bowerloom/authoring/receipt.json` whose file `.bowerloom/prompts/<id>.md` exists.
   - A team: an item of kind team in the receipt whose folder `.bowerloom/teams/<id>` exists. A team folder is copied whole, `agents/` included. Use `readTree` without skip, and record every file in the receipt.
   - Anything else refuses `MIGRATE_ITEM_NOT_FOUND`. With `--all`, an item whose files are gone is skipped.
   5a. Every local skill, prompt, and team must pass the file rules of the store sources (spec 06, 3.11 step 4). Check this with `localItemRows(<project>/.bowerloom, kind, id)`. The layout is the same as a store. An explicit selector of an item that fails refuses `MIGRATE_ITEM_UNSUPPORTED`, and the message adds the reason (section 5). `--all` skips the item and prints `  <kind> <id>   stays in this project. <reason>.` A team that fails the file rules is skipped the same way, in a shared project too. Take a team whose tree exceeds the `readTree` limits (256 entries, depth 8). An explicit selector refuses `MIGRATE_ITEM_UNSUPPORTED` with the size reason. `--all` skips it with the `stays in this project` line.
6. If `bowerloom.json` lists the item with `source: "store"`, an explicit selector refuses `CONFIG_ITEM_SELECTED`, and `--all` skips the item. If `bowerloom.json` exists and lists the item in no way, `--all` moves nothing of it. The plan prints `  <kind> <id>   not listed in bowerloom.json, so it stays as it is.` Naming the item still moves it. This is the `--all` decision (variant B built, variant A recorded in section 13).
7. Tags. A team tag (`teams`) can limit a skill or prompt to some teams. The store keeps the tag, so every tagged team must exist in the store after the move. For each tag, the team must be in the store already or be in this run's selection. Else refuse `MIGRATE_TEAM_MISSING`. The message names the team. Take an item whose tag names `first-team` or a team that does not move. `--all` leaves it in the project. The line is `  <kind> <id>   stays in this project. Its team <team> is not in the store.` The team `first-team` is never in the store. An explicit selector of an item tagged `first-team` refuses `MIGRATE_TEAM_MISSING`.
8. For each selected item, compare with the store.
   - Not in the store: state `copy`.
   - In the store with the same bytes: state `present`. For a pinned skill, `canonicalJson` of the store entry and of the project entry must be equal. For a local skill, a prompt, and a team, the file lists (path, sha256, bytes) are equal. If the item is also registered in the store receipt, nothing needs doing for the copy. If it is not registered, the state is `register` (a leftover from a crash).
   - In the store with other bytes: refuse `MIGRATE_ID_EXISTS`. Bowerloom never overwrites a store item.
   - A pinned skill is `copy` or `present`, never `register`.
   - A store receipt record of the item whose path is gone refuses `MIGRATE_ID_EXISTS`. The next step names `bowerloom receipt clean --global`.
   - Take a registered item in state `present`. Its record's `teams` must equal the project tag, or else `MIGRATE_ID_EXISTS`. The tag is the `skills.json` tag for a skill, the receipt tag for a prompt, and `[]` for a team.
   - For a pinned project skill, a store folder `skills/<id>` refuses `MIGRATE_ID_EXISTS`.
   - For a local skill, the store `skills.json` entry is part of the state. A folder with equal bytes and no entry is `register`, and step 4 adds the entry. An existing entry must be `{ id, teams?, source: { kind: 'local', path: 'skills/<id>' } }` with the project tag, else `MIGRATE_ID_EXISTS`. Step 4 adds only missing entries.
   - A pinned project entry whose pin another store id already holds refuses `SKILLS_ADD_EXISTS` at plan time.
9. Decide for each item whether it switches in this run.
   - Not a shared project (spec 06, 3.9): every item switches.
   - Shared project: a pinned skill switches. A written item in state `present` switches after the check passes. A written item in state `copy` or `register` is copy-only. It reads no network, and its sentence is `It is new in your store and not pushed yet.` For a `present` item the check needs two results. `readStoreRepo(storeDir, commit)` reports no problem. `proveAuthored` returns `proved`, with `localHash` from `localItemRows(storeDir, kind, id)`, at `repo.pushed` or at the `--commit` value. An item that fails the check is copy-only. Its config entry stays as it is. The plan says why.
10. The config change is the one `use` makes (spec 06, 3.5 step 2). When no item switches, create no `bowerloom.json`. If `bowerloom.json` is missing, create it with every project item as `source: "project"`, then flip the switched items to `store`. If it exists, flip those items, and add an explicitly named item that the config did not list. Team tags in `via` do not change.
11. The lock. When a lock exists or the project is shared, build the new lock from the old lock as follows. Add one lock item for each switched item. A pinned item copies the store entry, and a written item uses the proof of rule 9. Keep every other existing lock item. Drop each lock item whose (kind, id) is not a store entry of the new config. Suppose the plan writes the lock, and the new config has a store entry that no switch in this run adds and the lock lacks. Then refuse `LOCK_CONFIG_MISMATCH`, with the next step `bowerloom lock update`. A plan that writes no lock runs no such check. A shared project can have a lock that disagrees with its config. Every plan for it prints `The lock is out of date for <ids>. Run bowerloom lock update.` That includes `Nothing to move.` The command `store migrate` reads no network for items it does not switch.
12. Nothing is deleted. No project file changes except `bowerloom.json` and `bowerloom.lock.json`.
13. Count the store receipt items after this run: the existing items plus each local skill, prompt, and team in state `copy` or `register`. Refuse `MIGRATE_LIMIT` at plan time in two cases. The first is a count over 512 (`LIMITS.items`). The second is a `recordText` of the new receipt over 1048576 bytes (`LIMITS.recordBytes`). `--all` refuses too. It does not skip items.
14. Take a run where no item is `copy` or `register`, and no config or lock entry changes. Print the plan lines and `Nothing to change.` Exit 0 without asking.

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
  <kind> <id>   not listed in bowerloom.json, so it stays as it is.
  <kind> <id>   stays in this project. <reason>.
  team <id>     its agents stop being projected. A store team projects no agents in this beta. Copies in .claude/agents stay.
Not switched: <kind> <id> cannot be locked yet. <sentence>. Push the store, then run this command again.     (shared project only)
bowerloom.json: creates it, and lists <n> items of this project                                          (only when new)
bowerloom.json: <kind> <id> changes from project to store                                                (one line per switched item)
bowerloom.json: adds <kind> <id> (store)                                                                 (an explicitly named item the config did not list)
bowerloom.lock.json: adds <kind> <id> (<lock source>)                                                    (one line per added lock item)
Network: reads api.github.com, to check the pushed copy of <n> items, about <r> requests to api.github.com.   (only when a written item is checked)
Your store has commits that are not pushed (HEAD differs from origin/<branch>). The lock records the pushed commit <commit8>.   (spec 06, for a checked item, when HEAD differs)
Credentials: BOWERLOOM_GITHUB_TOKEN is set. It is sent to api.github.com for github.com/<owner>/<repo> only.   (spec 07, only when used)
```

**Amendment, 2026-10-22, sageadvicellc/bowerloom#100:** the store-create line now reads `Create the store at ~/.bowerloom (store.json, and a .gitignore that leaves out the files of this machine). It holds definitions only.`

The `Network:` line follows spec 06. If <r> is over 60 and no token is set, the plan adds the line of spec 06 for that case. With a token, the line is the variant of spec 07, section 3.5. Without network, the command refuses `SKILLS_OFFLINE` with the message `Checking <ids> needs api.github.com. Connect to the network and run the command again.` `GITHUB_RATE_LIMITED` and `GITHUB_TOKEN_INVALID` refuse as in specs 06 and 07.

```text
Nothing in this project is deleted. When you have checked the result, you can remove the old copies yourself:
  git rm -r .bowerloom/skills/<id>
  git rm .bowerloom/prompts/<id>.md
  git rm -r .bowerloom/teams/<id>
Bowerloom does not edit .bowerloom/skills.json. Remove the line for skill <id> yourself.                 (one line per switched skill whose project entry is pinned or is not in the project receipt)
After you delete the old files, run bowerloom receipt clean.
```

`<sentence>` is the sentence of the `STORE_ITEM_NOT_SHAREABLE` table in spec 06 (3.10), stored without its final period. The template supplies the period. For a `LOCK_STORE_NOT_PUSHED` result it is `The pushed copy differs from your store`. For `LOCK_COMMIT_UNREACHABLE` it is `The commit is not on the remote. Fix this, then run this command again`. The same closing words, `Fix this, then run this command again`, follow the sentences for `unsupported-remote` and `unreadable`. In the plan, these cases do not refuse. They make the item copy-only. A `STORE_REMOTE_PRIVATE` or `STORE_REMOTE_AUTH_FAILED` result still refuses the command, because the person must fix the access first.

The remove lines list only items that switched. A copy-only item has no line.

For each switched team that has an `agents/` folder, the plan prints the agents line shown above. The agents stop being projected because a store team projects no agents in this beta.

The result text has four parts. First: `Moved <n> items to the store.` Second, for any copy-only items: `Copied but not switched: <ids>.` Third: the remove lines again. Fourth: `Next: bowerloom receipt clean`. The JSON result format is `bowerloom/store-migrate-result/v1beta1` (4.2).

Exit codes: 0 done or nothing to do, 1 refusal, 2 `USAGE`, 3 plan awaiting approval, 130 interrupt.

### 3.2 `store migrate` write order and crash recovery

The command takes two locks. The store lock comes first (`withStoreForWrite`, spec 04). The project lock (`withProjectLock(project.dir)`) comes second, inside its work function. No other command takes both. Spec 04 maps every `PROJECT_LOCKED` thrown inside the work function to `STORE_LOCKED`. So the work function catches a `PROJECT_LOCKED` from the project lock, including one from that lock's `assertHeld`, and returns it as a value. `applyStoreMigrate` throws it again as `PROJECT_LOCKED` after `withStoreForWrite` returns. `PROJECT_LOCK_SLOT_COLLISION` and `PROJECT_LOCK_UNAVAILABLE` pass through.

Apply reads no network. Under both locks it re-reads these: every selected project item, the store `skills.json`, the store receipt, `bowerloom.json`, and the lock. It also re-reads `localItemRows` of each switched written item. It compares each with the plan. Any difference refuses `STALE_APPROVAL`. It writes `config.text` and `lock.text` from the approved plan. A token that was set or removed after the plan refuses `STALE_APPROVAL` (spec 07, 3.5).

Under both locks, after the plan revision matches: if `created` differs from `plan.store.create`, refuse `STALE_APPROVAL` before step 0. Before each write, `live()` runs the store `assertHeld`, `verifyStorePins` (spec 04, 3.3 step 4), the project `assertHeld`, and `verifyProjectPins`.

0. Remove the project scratch `.bowerloom.json.<16 hex>.tmp` and `.bowerloom.lock.json.<16 hex>.tmp` that the plan lists in `projectScratch`.
1. Remove the store's scratch (`authoring/.stage-*` and `authoring/.tmp-*`) that the plan lists in `scratch`.
2. If the plan says so, create the store (spec 04, 3.3). `withStoreForWrite` does this before the work function runs.
   Create each missing folder that the plan lists in `folders` with `makeFolder`, in the order `authoring`, `skills`, `prompts`, `teams`. Then flush the store.
3. For each item in state `copy`, in this order: skills, prompts, teams, each sorted by id:
   1. Stage the files in `<store>/authoring/.stage-<revision>/<item path>`. Use `makeFolder` and `writeNewFile` (`packages/project-authoring/src/files.ts:81-90`) with Buffers. Do not use `planned()` (`create.ts:139`). Folders have mode 0700 and files mode 0600. Check each file's bytes against the planned sha256 before and after writing.
   2. For a team, compile the staged `team.yaml` with `compileCrew` (`create.ts:353`) and require the same `candidateRevision` as the source.
   3. Move the staged item into `<store>/skills/<id>`, `<store>/prompts/<id>.md`, or `<store>/teams/<id>`. A folder moves with `rename` after `lstat` of the target gives `ENOENT`. A prompt moves with `rename` after `lstat` of the target gives `ENOENT`, under the store lock. Flush the parent folder.
4. Write the store `skills.json`: one change per missing skill entry, in id order. A pinned skill is `{ add: entry }`. A local skill is `{ add: localEntry }` with its `teams` tag. The plan builds each manifest step in memory: `validateEntry`, the `SKILLS_ADD_EXISTS` and limit checks of `planManifestChange`, and `serializeManifest` with `STORE_MANIFEST_LIMITS`. Apply calls `planManifestChange(storeTarget(dir), change, { storeCreate: false })` and compares before and after with each step. The plan binds the chain of hashes, like `CreatePlan.manifest.steps` (`create.ts:159-170`). A step whose hash does not match refuses `STALE_APPROVAL`.
5. Write the store authoring receipt once. Add every local skill, prompt, and team in state `copy` or `register`. Never add a pinned skill. It lives only in the store `skills.json`. Each record is `{ kind, id, teams, files, planRevision }`. For a skill, `teams` is the tag of the project `skills.json` entry. For a prompt, it is the `teams` of the project receipt. For a team, it is `[]`. The value `files` holds the pins of the copied bytes, with paths relative to the store (`skills/<id>/...`, `prompts/<id>.md`, `teams/<id>/...`). The value `planRevision` is this plan's revision. Use `writeReceiptRecord` (4.4).
6. Remove the staging folder.
7. Write `bowerloom.json` with `writeGuardedFile`. If the plan creates it, call `adoptCreatedMarker(project, 'config', expected)` right after. In the build, the signature is `adoptCreatedMarker(project, marker, expected, hooks?)`. The value `expected` is `{ device, inode, birthtimeNs }` from the creation itself: the `fstat` of the opened temporary file before the rename, or of the new folder opened with `O_NOFOLLOW`. `writeGuardedFile` returns it. Use the returned context for the rest of the run.
8. If the plan has lock changes, write `bowerloom.lock.json`.

Crash recovery. Every step is safe to repeat.

- A crash before step 3 changes nothing.
- A crash during step 3, 4, or 5 leaves some items in the store. The next `store migrate` for the same items finds each in state `present` (equal bytes, registered), `register` (equal bytes, not in the receipt), or `copy`. It does the missing steps. A store folder with other bytes refuses `MIGRATE_ID_EXISTS`.
- A crash after step 5 and before step 7 leaves the items in the store and the project unchanged. The next run finds all items `present` and only writes the config and lock.
- A crash after step 7 and before step 8 leaves a config newer than the lock. A rerun of `store migrate` does not heal it, because rule 6 skips or refuses the switched items. `bowerloom lock update` heals it (spec 06, 3.13). A frozen run refuses `LOCK_CONFIG_MISMATCH`, which is safe.
- A leftover staging folder is removed at step 1 of the next run. The next `skill create --global` plan removes it too, because it is a scratch name (`packages/project-authoring/src/state.ts:18`).

### 3.3 Shared projects: copy now, switch after the push

This is decision 24. A person in a shared project runs `store migrate --all`. Pinned skills switch at once and get lock items. Skills, prompts, and teams the person wrote are copied to the store and stay `source: "project"` in `bowerloom.json`. The plan prints `Not switched: ...` for each. The person then commits and pushes the store (the commands are in `bowerloom store status`). They run the same command again. Every item is now `present` and shareable, so it switches and gets a lock item. The second plan has no copy lines.

This spec overrides spec 06, 3.9 for `store migrate` only. An item that a teammate cannot fetch is copied and not switched (copy-only). It is not refused. `use` and `use team` keep the refusal. This is decision 24.

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

1. Scope: the project (default) or the store (`--global`). The project scope needs a project. The store scope needs a valid store, else `STORE_NOT_FOUND`. Before `withStoreForWrite`, check that `inspectStore(home)` is a valid store, else `STORE_NOT_FOUND`. If `created` is true, refuse `STALE_APPROVAL` before any write of this command.
2. Read the authoring state (`readAuthoringState`, `packages/project-authoring/src/state.ts:121`). If a pending record exists, refuse `AUTHORING_PENDING`. Scratch does not refuse. The plan lists it in `scratch`, and apply removes it first with `removeScratch`. For the project, a `.bowerloom-revision.json` file makes the command refuse `REVISION_PENDING`.
3. Select every receipt item whose path is gone. A receipt item of kind `slice` is selected like the others. Its path is `itemPath('slice', id)`, and it has no `skills.json` or config entry. The path is `itemPath(kind, id)` under the scope's base folder (`.bowerloom` or the store). "Gone" means `lstat` fails with `ENOENT`, the test of `gone` in `apps/cli/src/held.ts:20`. An item whose path exists is never selected, whether it is edited or not. Any other `lstat` failure refuses `AUTHORING_UNSAFE_PATH`.
4. For each selected skill, also remove its `local` entry from `skills.json` (project: `.bowerloom/skills.json`, store: `skills.json`). Skip this step for a skill with no such entry. A pinned entry (npm or git) with the same id is never removed.
5. For the project scope with a `bowerloom.json`, also remove the config entry of each selected item whose entry has `source: "project"`. A `skills.json` entry that stays means the project still defines the item. Keep that config entry. No `via` list changes.
6. The store scope changes no config and no lock. If `created` is true for the store scope, refuse `STALE_APPROVAL` before any write. In the store scope, `project.identity` is the store identity.
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

0. Remove the scratch that the plan lists in `scratch` and `projectScratch`, with `removeScratch`.
1. The config (project scope with a config).
2. `skills.json`: one `{ remove: id }` change for each entry, in id order. Each goes through `planManifestChange` and `applyManifestChange`. The plan binds the chain of hashes.
3. The receipt, once, last, with `writeReceiptRecord` (4.4).

Crash recovery. Run the command again. The plan finds the same gone items, because the receipt is still unchanged. It also finds that some config and `skills.json` entries are already removed. Those steps are no-ops and drop out of the plan lines. After step 3 the receipt no longer lists the items, so the next run says `Nothing to clean.`

Result text: `Removed <n> entries from the record of created items.` The JSON format is `bowerloom/receipt-clean-result/v1beta1` (4.3).

Exit codes: 0 done or nothing to clean, 1 refusal, 2 `USAGE`, 3 plan awaiting approval, 130 interrupt.

### 3.5 What `status` shows after a migrate

After `store migrate` and before the person deletes files, `status` is unchanged. After they delete the old files, `status` names each item as `held (AUTHORING_ITEM_MISSING)` (`apps/cli/src/held.ts:26-39`). After `receipt clean`, `status` names no item as missing.

## 4. Schemas

### 4.1 Migrate plan, `bowerloom/store-migrate-plan/v1beta1`

```ts
export interface StoreMigratePlan {
  format: 'bowerloom/store-migrate-plan/v1beta1';
  project: { dir: string; identity: DirectoryIdentity; ancestry: readonly PinnedDirectory[]; bowerloomIdentity: DirectoryIdentity | null };
  store: { create: boolean; dir: string; identity: DirectoryIdentity | null; skills: Read | null; authoring: Read | null };
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
  folders: string[];                                  // store folders to create, in order
  manifest: { steps: { id: string; before: Read | null; after: Read }[] } | null;
  config: { before: Read | null; after: Read; text: string; created: boolean } | null;
  lock: { before: Read | null; after: Read; text: string } | null;
  scratch: string[];                                  // store scratch
  projectScratch: string[];                           // project config and lock scratch
  network: { hosts: string[]; credentials: null | { variable: string; host: string; repositories: string[] } };
  commit: string | null;                              // the commit the lock items use
  removeLines: string[];                              // the lines printed after the plan
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface Read { sha256: string; bytes: number }
```

The revision is `sha256(canonicalJson(body))` (`packages/contracts/src/index.ts:137`). Items are sorted by kind (skill, prompt, team) and then by id. The field `project.bowerloomIdentity` is null for a project with no `.bowerloom` folder. Rule 4 of 3.1 stops such a project before any plan exists, so the plan carries a non-null value in practice. The type allows null so that it matches `ProjectContext` (spec 03).

The deps of `applyStoreMigrate`: `{ signal; githubToken: GithubToken | null; hooks?: { afterStep?(n: 3|4|5|7): void; afterItem?(kind: string, id: string): void; locked?(name: 'store'|'project'): void } }`. The value `githubToken` serves only the check of spec 07, 3.5. When `plan.network.credentials` is non-null, a token must be set. When the plan checked an item with credentials null, the variable must be unset.

### 4.2 Migrate result, `bowerloom/store-migrate-result/v1beta1`

```ts
{ format, planRevision, moved: [{ kind, id, state }], notSwitched: [{ kind, id, code }], configSha256: string | null, configBytes: number | null,
  lockSha256: string | null, lockBytes: number | null, removeLines: string[], executionAuthorized: false }
```

`Move <n> items` counts the items with a copy, register, or switch. `moved` lists the same items.

### 4.3 Receipt clean plan and result

Plan, `bowerloom/receipt-clean-plan/v1beta1`:

```ts
export interface ReceiptCleanPlan {
  format: 'bowerloom/receipt-clean-plan/v1beta1';
  scope: 'project' | 'store';
  project: { dir: string; identity: DirectoryIdentity };     // for the store scope, dir is the store folder and identity is the store identity
  items: { kind: 'skill' | 'prompt' | 'team' | 'slice'; id: string; path: string }[];   // sorted by kind then id
  manifest: { steps: { id: string; before: Read | null; after: Read }[] } | null;
  config: { before: Read; after: Read; text: string; removes: { kind: 'skill' | 'prompt' | 'team'; id: string }[] } | null;
  receipt: { before: Read; after: Read; text: string };
  scratch: string[];
  projectScratch: string[];                           // project config and lock scratch
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

It does what the `writeReceipt` closure of `applyCreate` does (`packages/project-authoring/src/create.ts:~286-298`). It writes a temporary record named by `tempName(planRevision, 'receipt')`. It runs `live()`. It rechecks that the receipt's hash still equals `before`, and a change gives `STALE_APPROVAL`. A null `before` makes it link the temporary file. Any other `before` makes it rename the file. It parses its own text with `parseReceipt` before it writes, and refuses `AUTHORING_RECEIPT_INVALID` on a failure. It flushes the folder and returns the new `Read`. `applyCreate` calls it in place of its closure. The create tests must pass unchanged. The link and unlink calls in `applyCreate` sit at `create.ts:359-361`.

### 4.5 Manifest change kind `remove`

In `packages/skill-manifest/src/add.ts`:

- `ManifestChange` (line 42) becomes `{ add: Entry } | { replace: Entry } | { remove: string }`. The string is the entry id.
- `planManifestChange` (line 122): accept the key `remove` in the check at line 126. For `remove`, the entry must exist, and a missing entry gives `SKILLS_ADD_REPLACE_MISSING`. The entry must be of kind `local`, and another kind gives `MANIFEST_INVALID`. The new manifest drops it. The plan's `change` is `{ remove: <the removed entry> }`.
- `ManifestChangePlan.change` (line 21-40) gains `{ remove: Entry }`.
- `changeOf(plan)` (line 154) returns `{ remove: entry.id }` for a `remove` plan.
- `applyManifestChange` (line 170): the result key for a remove is `removed: <id>`. `ManifestChangeReceipt` (line 43) gains `{ removed: string }`.
- If the manifest has no skills after the removal, the file stays with `skills: []`. That is valid.

## 5. Refusal codes

| Code | Cause | Next step |
|---|---|---|
| `MIGRATE_ITEM_NOT_FOUND` | A selected item is not defined in the project, or its files are gone. | `bowerloom ls` |
| `MIGRATE_ITEM_UNSUPPORTED` | A selected skill or prompt cannot be a store item. The message adds the reason. | `bowerloom help store` |
| `MIGRATE_ID_EXISTS` | The store already holds an item with that kind and id but other bytes. | Rename the project item, or remove the store item yourself. |
| `MIGRATE_RESERVED` | `first-team` or `personal-assistant` was named. Setup owns them. | `bowerloom store migrate --all` skips them. |
| `MIGRATE_TEAM_MISSING` | A skill or prompt is limited to a team that is not in the store and not in this run. The message names the team. | Add `--team <name>` to move that team too. |
| `MIGRATE_LIMIT` | The store record of created items holds 512 items at most. | Remove items from the store, or move fewer items. |
| `CONFIG_ITEM_SELECTED` | A selected item is already listed from the store. | `bowerloom ls` |
| `STORE_REMOTE_PRIVATE`, `STORE_REMOTE_AUTH_FAILED` | The store remote cannot be read. | As in specs 06 and 07. |

| `REVISION_PENDING` | A revise of this project is unfinished. | `bowerloom help advanced` |
| `AUTHORING_UNSAFE_PATH` | `receipt clean` found an item path it cannot read. | `ls -la .bowerloom` |
| `STORE_NOT_FOUND` | `receipt clean --global` needs a store and there is none. | `bowerloom skill create <name> --global` |

Message rule. The fixed message of a code is its Cause cell, written as plain sentences. It names no path. It names an id only where the table says so. In `REFUSALS` (`apps/cli/src/human.ts:224`) the `sentence` is the Cause cell and the `next` text is the Next step cell. `MIGRATE_ITEM_UNSUPPORTED` adds one reason. For a file fault: `It holds a file that a store item cannot hold.` For a size over a limit: `It is larger than a store item can be.` Map the two sentences of `localItemRows` (spec 06, section 5) to these. The `--all` line uses the same reason.

Add the six `MIGRATE_*` codes of the table to `packages/project-config/src/refusal.ts` with fixed messages, and to `REFUSALS` in `apps/cli/src/human.ts:224`. `MIGRATE_RESERVED` and `MIGRATE_TEAM_MISSING` count among them. The other codes exist already. `AUTHORING_PENDING` and `REVISION_PENDING` keep their `REFUSALS` text.

The other codes that `store migrate` raises: `CONFIG_LIMIT`, `LOCK_LIMIT`, `LOCK_CONFIG_MISMATCH`, `SKILLS_ADD_EXISTS`, `MANIFEST_LIMIT`, `SKILLS_OFFLINE`, `GITHUB_RATE_LIMITED`, `GITHUB_TOKEN_INVALID`, the `STORE_*` codes, `STORE_LOCKED`, and `PROJECT_LOCKED`.

## 6. Where to change

Create:

- `packages/project-sync/src/migrate-store.ts`: `planStoreMigrate(input: { project: ProjectContext; home: string; selectors: { skills: string[]; prompts: string[]; teams: string[] }; all: boolean; commit: string | null; githubToken: GithubToken | null; storeTransport?: () => PublicTransport & { close(): void }; signal: AbortSignal }): Promise<StoreMigratePlan>` and `applyStoreMigrate(plan: StoreMigratePlan, revision: string, deps): Promise<StoreMigrateResult>`. Apply requires `revision === plan.revision === sha256(canonicalJson(body))`, else `STALE_APPROVAL`. The CLI makes the plan again with `--approve` and compares revisions before it calls apply, as `use` does (spec 06, 3.14). The existing `packages/project-sync/src/migrate.ts` is `skills migrate` for the older install format. Do not touch it.
- `packages/project-sync/src/receipt-clean.ts`: `planReceiptClean(input)` and `applyReceiptClean(input, revision, held, store?: { context: StoreContext; created: boolean })`.
- `packages/project-authoring/src/receipt-write.ts` (4.4).
- `apps/cli/src/receipt.ts`: `runReceiptCommand(args, cwd, home, write, io, env)` for `receipt clean`.
- Test files in section 10.

Change:

- `packages/project-authoring/src/create.ts:~286-298` (the `writeReceipt` closure in `applyCreate`): call `writeReceiptRecord`. Export `pinsOf` (line 140).
- `packages/project-authoring/src/index.ts:5-11`: export `writeReceiptRecord` and `pinsOf`. `project-sync` imports `readTree`, `itemPath`, and `receiptOf` from `files.ts` and `state.ts` directly, as `held.ts:9-10` does.
- `packages/skill-manifest/src/add.ts:21-44, 122-160, 154-161, 170-201`: the `remove` change (4.5).
- `apps/cli/src/store.ts` (spec 03): `runStoreCommand(args, cwd, home, write, io = terminalIo(), env = process.env): Promise<number>`. The build of spec 03 takes `(args, home, write)` plus the `env` of spec 07. This spec adds `cwd` and `io` for `migrate`. Keep any parameter spec 07 added. `store status` keeps returning 0. The `main.ts` branch passes `process.cwd()` and sets `process.exitCode`. `bowerloom store` with no word or an unknown word refuses `USAGE`: `Use bowerloom store status [--json] or bowerloom store migrate. See bowerloom help store.` `store migrate --help` prints `TOPICS.store`. An unknown flag of `migrate` refuses `USAGE` with `Use bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all], with optional --commit <sha>, --approve <revision> and --json.`
- `apps/cli/src/main.ts:132`: add `'receipt'` to `COMMANDS`. Add a branch for `receipt` after the `store` branch that imports `./receipt.js`. `help receipt`, `receipt --help`, and `receipt clean --help` print `TOPICS.receipt`. A bare `bowerloom receipt` refuses `USAGE`: `Use bowerloom receipt clean [--global] [--approve <revision>] [--json].`
- `package.json:53` (`test:project`): add `dist/tests/store-migrate-cli.test.js`.
- `apps/cli/src/human.ts`: `SECTIONS` does not change. Add `TOPICS.receipt` and extend `TOPICS.store` with the merged text of 3.1. Add the refusal words (line 224). `tests/help-human.test.ts:20-45` holds the first screen, which this spec does not change. Add `'receipt'` to the help loops at lines 79 and 84.
- `apps/cli/src/held.ts:26-39` (`missingItems`): no code change. Add a comment that `receipt clean` clears these lines.
- Reuse from spec 06: `resolveProject`, `readStoreDefinitions`, `localItemRows`, `proveAuthored`, `readStoreRepo`, `isSharedProject`, the config text builders in `change.ts`, `writeGuardedFile`, and the lock builders. Export what migrate needs from `packages/project-sync/src/index.ts`.
- `package.json:30`: no change. The new tests sit in folders that the glob lists.

## 7. Edge cases

| Case | Expected result |
|---|---|
| `store migrate` with no selector | `USAGE`. |
| `store migrate --all --skill x` | `USAGE`. |
| `store migrate --skill personal-assistant` | `MIGRATE_RESERVED`. |
| `store migrate --skill first-team` | An ordinary skill id. |
| `store migrate --team first-team` | `MIGRATE_RESERVED`. |
| `store migrate --prompt first-team` | An ordinary prompt id. No `MIGRATE_RESERVED`. |
| `store migrate --all` in a project with only `first-team` and `personal-assistant` | `Nothing to move.` Exit 0. |
| `store migrate --skill nope` | `MIGRATE_ITEM_NOT_FOUND`. |
| A prompt registered in the receipt whose file is gone | `MIGRATE_ITEM_NOT_FOUND` for an explicit selector. `--all` skips it. |
| A local skill with an empty file | Explicit selector: `MIGRATE_ITEM_UNSUPPORTED`. `--all`: `  skill <id>   stays in this project. <sentence>` |
| `bowerloom.json` exists and omits a skill, then `--all` | The plan prints `  skill <id>   not listed in bowerloom.json, so it stays as it is.` |
| The same skill named with `--skill` | It moves and the config gains `skill <id> (store)`. |
| The store has a skill `x` with the same bytes, registered | State `present`. No copy. The config flips. |
| The store has a skill `x` with other bytes | `MIGRATE_ID_EXISTS`. Nothing is written. |
| The store has folder `skills/x` with the same bytes but no receipt entry | State `register`. The receipt gets the entry. |
| The store has folder `skills/x` with the same bytes and no `skills.json` entry | State `register`. Step 4 adds the entry. |
| The store entry of a local skill has a different tag | `MIGRATE_ID_EXISTS`. |
| A pinned project entry whose pin another store id holds | `SKILLS_ADD_EXISTS` at plan time. |
| A skill tagged `research`, the store has no team `research`, and `--team research` is not given | `MIGRATE_TEAM_MISSING`. |
| A skill tagged `first-team` | Explicit selector: `MIGRATE_TEAM_MISSING`. `--all`: it stays with the line about its team. |
| `--all` with tagged items and their teams | Teams move too. Tags hold. |
| A pinned skill whose store entry is identical | `present`. |
| A pinned skill whose store entry differs in version | `MIGRATE_ID_EXISTS`. |
| The 257th store skill | `MANIFEST_LIMIT`. |
| A run passes 512 items in the store record | `MIGRATE_LIMIT` at plan time. |
| The project config lists `x` from the store already | Explicit selector: `CONFIG_ITEM_SELECTED`. `--all`: skipped. |
| The project has no `bowerloom.json` | The plan creates it with all project items, then flips the chosen ones. |
| Nothing to copy and no config or lock change | The plan prints `Nothing to change.` Exit 0. No approval. |
| Not a shared project (no lock, no origin) | Every item switches. No lock. No network. |
| Shared project, pinned skill | Switches. Lock item added. No network. |
| Shared project, written skill, state `copy` | Copy-only. Sentence `It is new in your store and not pushed yet.` No network read. |
| Shared project, written skill, state `present`, store has no `.git` | Copy-only with the sentence `The store is not a git repository.` The config entry stays `project`. |
| Shared project, written skill, store pushed and equal | Switches. Lock item added after the proof. |
| Shared project, written skill, store edited after the push | `Not switched: ... The pushed copy differs from your store.` |
| Shared project, rerun after the push | All items `present`. They switch and lock. No copy lines. |
| Shared project, the remote is private and no token | `STORE_REMOTE_PRIVATE`. Nothing is written. |
| A new config store entry that is neither switched nor in the lock | `LOCK_CONFIG_MISMATCH`. The next step is `bowerloom lock update`. |
| A crash after the store receipt write | Rerun finishes the config and lock. |
| A crash after the config write and before the lock write | In a shared project, `store migrate --all` prints the stale-lock line and `Nothing to move.` `bowerloom lock update` writes the lock. |
| A crash during the copy of the second item (the `afterItem` hook) | Rerun finds the first `register` and copies the second. |
| A pending record in the store or project | `AUTHORING_PENDING`. |
| `receipt clean` with no gone items | `Nothing to clean.` Exit 0. |
| `receipt clean` while a pending record exists | `AUTHORING_PENDING`. |
| `receipt clean` with scratch and no pending record | The plan lists the scratch. Apply removes it first. |
| `receipt clean` where a skill's folder is gone and the `skills.json` entry is `local` | Both are removed. |
| `receipt clean` removes a project prompt that the config lists | The config entry is removed. |
| `receipt clean` removes a gone team that other entries use in `via` | The `via` lists stay as they are. |
| `receipt clean` twice | The second says `Nothing to clean.` |
| `receipt clean --global` with no store | `STORE_NOT_FOUND`. |
| `receipt clean` and an installed copy of a removed item exists | The copy stays. The next sync plan says it is kept. |
| `store migrate` while another command holds the project lock | `PROJECT_LOCKED`. Nothing in the project changes. |
| Two `store migrate` at once | The second refuses `STORE_LOCKED`. After the first finishes, the second plan is stale: `STALE_APPROVAL`. |

## 8. Migration from beta.2 projects

- This spec is the migration path. A beta.2 project has no `bowerloom.json`. `store migrate` creates it.
- The steps for a person: run `bowerloom store migrate --all`, review the plan, and approve. Check the result with `bowerloom ls`. Run `bowerloom skills sync` and `bowerloom apply`. The copies are up to date, because the bytes are equal. Delete the old files with the printed lines. Remove the `skills.json` lines that the result names. `receipt clean` removes the rest.
- For a shared project: after the first run, commit and push the store (the commands are in `bowerloom store status`). Run `bowerloom store migrate --all` again. Commit `bowerloom.json` and `bowerloom.lock.json`.
- Installed copies do not change. A local skill that moves to the store keeps its catalog until the next update. The update check treats `local` and `store` as one family (spec 06, 3.12).
- No state migrates by itself. No file is deleted.

## 9. Docs changes for this track

- `apps/docs/src/content/docs/cli.md`: add `bowerloom store migrate ...` and `bowerloom receipt clean ...` with a paragraph each, built from the help text in 3.1 and 3.4.
- `apps/docs/src/content/docs/guides/existing-project.md`: a section "Move your items to the store" with the steps of section 8.
- `apps/docs/src/content/docs/guides/create-items.md`: a sentence that `store migrate` moves existing items.
- `apps/docs/src/content/docs/reference/errors.md`: rows for the six `MIGRATE_*` codes.
- `apps/docs/src/content/docs/releases.md`, `## 0.7.0-beta.3`: "`bowerloom store migrate` copies skills, prompts, and teams from a project to your store and lists them in `bowerloom.json`. It deletes nothing. `bowerloom receipt clean` removes the records of items whose files you deleted."
- Spec 10 covers the shared-project flow in the page "Where your items come from".

## 10. Acceptance tests

Every CLI test spawns the CLI with `HOME` and `XDG_STATE_HOME` set to temporary folders and imports `tests/support/isolate-home.js`. Tests that need GitHub use `tests/support/fake-github-repo.ts` (spec 06).

`packages/project-sync/test/migrate-store.test.mjs`:

1. A project with a pinned npm skill, a local skill, a prompt, and a team: `--all` plans one line each, with state `copy`, and the plan JSON matches 4.1.
2. Apply copies each item. The store has the same file bytes. The store receipt lists each local skill, prompt, and team with the right pins and tags, and no pinned skill. The store `skills.json` has the pinned entry and the local entry.
3. The project files are unchanged. Compare the whole `.bowerloom` tree byte for byte before and after. `bowerloom.json` and `bowerloom.lock.json` sit outside that tree.
4. `bowerloom.json` is created with the project items and the chosen ones as `store`. Its text is the exact serialization of spec 03. No item switches means no new file.
5. An existing `bowerloom.json` is edited: the chosen items flip, an explicitly named unlisted item is added, other entries stay. With `--all`, an unlisted item stays and the plan prints the `not listed in bowerloom.json` line.
6. A tag whose team is missing refuses `MIGRATE_TEAM_MISSING`. With the team selected it passes. A `first-team` tag refuses for an explicit selector. With `--all` the item stays with the team line.
7. `MIGRATE_RESERVED` (for `--team first-team` and `--skill personal-assistant`), `MIGRATE_ITEM_NOT_FOUND`, `MIGRATE_ITEM_UNSUPPORTED`, `MIGRATE_ID_EXISTS` (each kind), `MIGRATE_LIMIT`, and `CONFIG_ITEM_SELECTED`. A prompt named `first-team` is an ordinary prompt.
8. States `present` and `register`, by seeding the store first. A local skill folder with no `skills.json` entry is `register`. A pinned skill is never `register`.
9. A team's compile candidate equals the source candidate. A mutated staged file refuses `STALE_APPROVAL`. A team with `agents/` is copied whole and prints the agents line.
10. Not shared (no lock and no origin): every item switches, no lock is written, and nothing reads the network. `--commit` is accepted and unused.
11. Shared (a `.git/config` with an origin in the test project): a pinned skill switches and locks. A written item in state `copy` is copy-only with the sentence `It is new in your store and not pushed yet.` and no network read. A `present` item with no store `.git` is copy-only with the right sentence. With the fake repo pushed and equal, it switches and locks. With the store edited after the build, it is copy-only with the pushed-copy sentence.
11a. A project with a lock and no origin is shared (reason `lock`). Written items in state `copy` are copy-only, and pinned items lock.
12. Rerun after the push: all items `present`, no copy, items switch and lock.
13. Crash points: a test hook throws after each of steps 3, 4, 5, and 7. After steps 3, 4, and 5, a rerun of `store migrate` reaches the final state. Take a shared project where every item had switched (the fake repo pushed and equal). After step 7, `store migrate --all` prints the stale-lock line and `Nothing to move.` Then `lock update` writes the expected lock.
14. Stale plan: change a project file, then apply with the old revision: `STALE_APPROVAL`. Change the store `skills.json`, the store receipt, `bowerloom.json`, the lock, or a switched item: the same. Set or remove the token after the plan: the same.
15. The printed remove lines list only switched items and match the plan text exactly. The `skills.json` reminder line appears only for a switched skill whose project entry is pinned or is not in the project receipt.
16. The 257th skill refuses `MANIFEST_LIMIT`. Nothing is written.
17. Lock order: the test records that the store lock is taken before the project lock (the `locked` hook).
18. The staging folder is gone after a run and after a rerun of a crash.
19. Lock rules: an old lock item that is not a store entry of the new config is dropped. A store entry that is neither switched nor locked refuses `LOCK_CONFIG_MISMATCH`.
20. A pending record in the store or the project refuses `AUTHORING_PENDING`. A project `.bowerloom-revision.json` refuses `REVISION_PENDING`. Store scratch is removed at step 1.
21. Nothing to copy and no config or lock change prints `Nothing to change.` and exits 0 with no approval.

`packages/project-sync/test/receipt-clean.test.mjs`:

1. Project scope: a gone skill, prompt, team, and slice are selected. Present items are not.
2. The `skills.json` local entry of the gone skill is removed. A pinned entry stays.
3. The config entries with `source: "project"` are removed. No `via` list changes.
4. The receipt no longer lists the items. Its bytes are the exact serialization (`recordText`).
5. Nothing is deleted from disk (snapshot).
6. A pending record refuses `AUTHORING_PENDING`. Scratch does not refuse, and apply removes it first. A revision file refuses `REVISION_PENDING`.
7. Store scope: the store receipt and store `skills.json` change. No config and no lock change. If `created` is true, the command refuses `STALE_APPROVAL` before any write.
8. When nothing is gone, both scopes print `Nothing to clean.`
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
4. The test runs `git init` itself, then `git add -A` and `git -c user.name=t -c user.email=t@example.invalid commit -m base`. Then it runs the printed removal lines to delete the old files. It edits `skills.json` and runs `status`. Each removed item is `held (AUTHORING_ITEM_MISSING)`.
5. `receipt clean` shows its plan and exits 3, applies with `--approve`, and `status` no longer names the items.
6. Shared project flow with the fake repo: the first run copies written items and prints `Not switched`. After the test adds `.git` files and routes for the store and runs again, items switch and `bowerloom.lock.json` has the expected bytes.
7. `help store` and `help receipt` print the topics. `store migrate --help` prints `TOPICS.store`.
8. Error paths: no selector exits 2. `--all` with a selector exits 2. A bare `bowerloom store` exits 2 with the `USAGE` text of section 6. Reserved names and missing items refuse.
9. `receipt clean --global` outside a project works. With no store it refuses `STORE_NOT_FOUND`.
10. Two `store migrate` runs at once: the second refuses `STORE_LOCKED`.
11. A test holds `withProjectLock(projectDir)`. `store migrate --approve` refuses `PROJECT_LOCKED`, not `STORE_LOCKED`.

Update `tests/help-human.test.ts` (the help loops at lines 79 and 84 gain `'receipt'`), `tests/human-refusal.test.ts` (six new codes), and `tests/store-foundation-cli.test.ts` (the `store` usage words).

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

1. `compileCrew` on a staged team folder inside `authoring/.stage-<revision>`. `applyCreate` does the same for a project (`create.ts:353`). Run the team case of `migrate-store.test.mjs` first. Stage the team under `<store>/authoring/.stage-<revision>/teams/<id>/`, exactly as `applyCreate` stages it. If `compileCrew` still refuses, pass `{ root: <stage folder> }` as its second argument (`packages/crew/src/index.ts:94`).
2. `changeOf` and the plan type in `add.ts` are read at lines 154-161 and 21-44. Hidden callers of `plan.change` (the CLI review at `apps/cli/src/manifest.ts:~105`) assume `add` or `replace`. Search for each use of `.change`. Make each handle `remove` by showing `Remove skill <id> from <manifest>`.
3. Whether `status` shows one line per item after the old files are deleted and the `skills.json` local entry remains. The sync planner can hold the local skill first (`plan.ts:253`). Run case 4 of `store-migrate-cli.test.ts` early. `uniqueHolds` (`held.ts:50`) collapses lines by kind and id, so expect one line.

## 13. New decisions for Hanna

Decision 1: a tag that names a team missing from the store.

A skill or prompt can be limited to a team. A move to the store keeps that tag, so the team must exist in the store.

- A. (Default) Refuse with `MIGRATE_TEAM_MISSING`. The person adds `--team <name>` to move the team too. Rule 7 of section 3.1 assumes option A.
- B. Drop the tag from the stored copy and print a line that says so. The skill then belongs to every team in the store.

Build variant A. The pull request records the decision.

Decision 2: the items that `store migrate --all` moves in a project with a `bowerloom.json`. The record is https://github.com/sageadvicellc/bowerloom/issues/80#issuecomment-6335218201. The rule is an 8-hour default.

- A. `--all` moves every skill, prompt, and team of the project, and adds the ones that the config leaves out as `source: "store"`.
- B. (Default) `--all` moves nothing that `bowerloom.json` leaves out. The plan prints `  <kind> <id>   not listed in bowerloom.json, so it stays as it is.` Naming the item still moves it. Rule 6 of section 3.1 assumes option B.

Build variant B. The pull request records the decision.
