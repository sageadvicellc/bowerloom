# notes-source

The wiki folder source of Bowerloom 0.8: the starter wiki, version history for a linked folder, and the summary the Notes panel shows.

A knowledge source is a pointer. This package never opens a page. It reads names and file states, writes the starter template it is given, and runs git.

## What it does

- `planStarter(dir, templateFiles)` and `applyStarter(dir, revision, templateFiles)` write a starter wiki into a new or empty folder, then make one first commit. A folder that holds anything is refused (`NOTES_NOT_EMPTY`). The template is a list of `{ path, bytes }`.
- `planGitInit(dir)` and `applyGitInit(dir, revision)` start version history in a linked folder with no `.git`. The plan lists every file the first commit adds.
- `readNotesSummary(dir)` returns the page count, the last commit time, and the date of the latest refinement report.
- `findRepository(dir)` says where the folder keeps its history: its own `.git`, a larger repository above it, or none.

## A wiki inside a larger repository

A wiki folder may sit inside a larger repository, such as a `knowledge-base/` folder in a clone of a hosted repository.

- Bowerloom finds that repository without git's own discovery. It walks up from the wiki folder to the nearest `.git`, and stops before the home folder and before `/`. The walk, the home stop, and the wiki's place in the repository use the letter case the disk keeps, so a folder chosen as `KB` on a case-insensitive disk still matches the `kb` that git tracks. Only a real folder of yours counts. A `.git` file or link is not followed: the summary then shows the history as `unreadable`.
- Every command runs with `GIT_DIR` and `GIT_WORK_TREE` at that repository's root, and the wiki folder's place in it is the pathspec. The summary's last commit time is `log -1 --format=%ct -- <prefix>`, so a newer commit outside the wiki does not count. Its history is `parent`.
- Bowerloom never starts a repository there. `planGitInit` and `planStarter` refuse a folder inside a larger repository (`NOTES_PARENT_REPOSITORY`) and write nothing. The person commits the wiki in the larger repository by hand.

Every plan reads only. Every apply plans again and refuses `NOTES_STALE` unless the revision is the one approved.

## Git

`src/git.ts` is the only module that runs git.

- Git is found by fixed path, never through `PATH`. On macOS, `/usr/bin/git` is a shim that can open an installer dialog, so only the Command Line Tools and Xcode gits count. When none is there, the refusal is `NOTES_GIT_MISSING`.
- Each call is one of five forms, behind fixed options that switch off hooks, fsmonitor, signing, signature checks, the mailmap (`log.mailmap=false`), and every transport (`protocol.allow=never`):
  - `init -q`
  - `add -- <listed relative paths>`
  - `commit -q -m <fixed message>`
  - `log -1 --format=%ct`, or `log -1 --format=%ct -- <prefix>` for a wiki inside a larger repository
  - `status --porcelain`
- The environment holds nothing of the caller's: no `HOME`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_NO_LAZY_FETCH=1`, `GIT_PROTOCOL_FROM_USER=0`, literal pathspecs, and a minimal `PATH`. Every form but init pins `GIT_DIR` and `GIT_WORK_TREE` to the folder.
- Before every form but init, git lists the key names of the repository's own config, with includes off (`config --local --no-includes --name-only --list -z`). When that config sets `extensions.worktreeConfig` and the worktree config file is there, its key names are listed and checked too (`config --worktree ...`).
- The check is an allowlist of key families. Every key outside it is refused `NOTES_GIT_CONFIG`, and no other command runs. The summary then shows the history as `refused`. The allowed families:
  - `core.*`, except `sshCommand`, `gitProxy`, `fsmonitor`, `hooksPath`, `pager`, `askPass`, `alternateRefsCommand`, `editor`, `worktree`, `excludesFile`, and `attributesFile`
  - a remote's `url`, `pushurl`, `fetch`, and `tagOpt`
  - `branch.*`, `user.*`, `index.*`, `init.*`, `pack.*`, `pull.*`, `push.*`, `fetch.*`, `color.*`, `advice.*`, and `rerere.*`
  - `extensions.worktreeConfig` and `extensions.objectFormat`
  - `gc.*` but not `gc.recentObjectsHook`; `merge.*` but not a merge driver; `status.*` but not `status.submoduleSummary`; `log.*` but not `log.mailmap` or `log.showSignature`; `submodule.*` but not a submodule's `update`
- So a filter or diff driver, a credential helper, an alias, a gpg program, a mailmap file or blob, a promisor remote, a `protocol.*` rule, an `include` or `includeIf`, and any other extension are refused. Such a key can make git start a program or read a file outside the repository: for example, `filter.<driver>.process` runs for `status`, and a partial clone fetches a missing object through `core.sshCommand`. A key in no family, including one a later git adds, is refused until it is on the list.
- A clone of a hosted repository passes: its default `core.*` keys, its remote, and its `branch.*` keys are all on the list, and with every transport off a remote reaches nothing. The command line also sets `core.sshCommand=false`, which outranks the repository's own value.
- A git folder with a non-empty `objects/info/alternates` file, an alternates entry that is not a plain file, or any `commondir` file is refused `NOTES_GIT_CONFIG` before any git runs. Each points git at another folder. Bowerloom checks them by lstat and size only, and never opens them.
- The summary's history is `git`, `parent` (the history of a larger repository, for the wiki folder only), `no-commit` (a `.git` with no commit, or one git cannot read), `none`, `git-missing`, `refused`, or `unreadable`.
- A timeout and an output cap stop a call, and the whole process group is killed.

The first commit writes `.git/info/exclude` with `.*`, so hidden files, such as a note app's settings, never make the tree unclean.

## Tests

`npm run test:notes-source`. The tests run real git in temporary folders. If git is not installed, the git tests skip and give the reason.
