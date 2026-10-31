# notes-source

The wiki folder source of Bowerloom 0.8: the starter wiki, version history for a linked folder, and the summary the Notes panel shows.

A knowledge source is a pointer. This package never opens a page. It reads names and file states, writes the starter template it is given, and runs git.

## What it does

- `planStarter(dir, templateFiles)` and `applyStarter(dir, revision, templateFiles)` write a starter wiki into a new or empty folder, then make one first commit. A folder that holds anything is refused (`NOTES_NOT_EMPTY`). The template is a list of `{ path, bytes }`.
- `planGitInit(dir)` and `applyGitInit(dir, revision)` start version history in a linked folder with no `.git`. The plan lists every file the first commit adds.
- `readNotesSummary(dir)` returns the page count, the last commit time, and the date of the latest refinement report.

Every plan reads only. Every apply plans again and refuses `NOTES_STALE` unless the revision is the one approved.

## Git

`src/git.ts` is the only module that runs git.

- Git is found by fixed path, never through `PATH`. On macOS, `/usr/bin/git` is a shim that can open an installer dialog, so only the Command Line Tools and Xcode gits count. When none is there, the refusal is `NOTES_GIT_MISSING`.
- Each call is one of five forms, behind fixed options that switch off hooks, fsmonitor, signing, and signature checks:
  - `init -q`
  - `add -- <listed relative paths>`
  - `commit -q -m <fixed message>`
  - `log -1 --format=%ct`
  - `status --porcelain`
- The environment holds nothing of the caller's: no `HOME`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, literal pathspecs, and a minimal `PATH`. Every form but init pins `GIT_DIR` and `GIT_WORK_TREE` to the folder.
- A timeout and an output cap stop a call, and the whole process group is killed.

The first commit writes `.git/info/exclude` with `.*`, so hidden files, such as a note app's settings, never make the tree unclean.

## Tests

`npm run test:notes-source`. The tests run real git in temporary folders. If git is not installed, the git tests skip and give the reason.
