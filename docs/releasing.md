# Releasing the Bowerloom CLI beta

This page explains how to release a new beta of the Bowerloom command line to npm. A script does most of the work. A person does the steps that publish, push, or retire.

The script is `scripts/release.mjs`. Its config is the file `release.config.json`. Run it with Node `>=24.11.0 <25`. It has no packages of its own. Only `dry-run` loads one, the `tar` package of this repository, to list the tarball. `npm ci` installs it, and the gates run `npm ci`.

```sh
node scripts/release.mjs <subcommand> [flags]
```

## Ground rules

- The release version comes from the `version` field of `release/beta.json`. Edit that file before you start. The script never changes it.
- The script prints the exact command before it runs it. These lines go to stderr.
- Add `--json` to any subcommand to get one JSON object on stdout. Even a wrong form such as `--json=1` prints one JSON object with exit 2.
- The exit code is 0 for a pass, 1 for a failed check, and 2 for wrong use of the script.
- A step that already finished for the same commit prints `already done` and exits 0. This holds for `gates`, `dry-run`, `hashes`, and `tag` only. Add `--force` to run `gates`, `dry-run`, or `hashes` again. `--force` works with those three only. Any other subcommand with `--force` is wrong use and exits 2.
- A failed step prints the first failing line. The full log goes to `.trellis/release/logs/`. Log files are private (mode 0600).
- A receipt is a small JSON file in `.trellis/release/receipts/`. It records that a step passed for one commit and one version. Git ignores the whole `.trellis` folder. Receipts have a schema version, now `v2`. A receipt of an older schema, or one without a `seams` list, counts as absent. Run the step again.
- The script never stores, reads, or prints a token, a one-time code, or a password. Every child process starts with a clean environment. The clean environment drops `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, `VERCEL_TOKEN`, every name that ends in `_TOKEN`, `_KEY`, `_SECRET`, `_PASSWORD`, or `_OTP`, and every name that holds `authtoken`, `_auth` (not followed by a letter), or `_password`. The list lives in `tools/lib/safe-env.mjs`.
- Every npm child process gets an empty `userconfig` and an empty `globalconfig`. So npm never reads your `~/.npmrc`, which can hold a registry token.
- The script blanks token-shaped text before it writes a log and before it prints a line, including the command line it echoes.
- On Ctrl-C, `SIGTERM`, or `SIGHUP`, the script stops every child process group, removes the temporary folders it made, and exits 130.
- Each child process runs in its own process group. A process group is the set of processes that one command starts. When a time limit or an output limit passes, the script stops the whole group.
- The only `npm publish` that the script ever runs is `npm publish --dry-run`. A dry run lists what a publish does and publishes nothing. The script refuses every other form.

## The three classes of subcommand

- Read-only subcommands change no tracked file, no remote, and no registry. They may update the remote-tracking refs (`preflight` runs `git fetch origin`), and they may write logs and receipts under `.trellis`.
- Local-write subcommands write files on this computer. They never contact the registry with a write.
- Human-only subcommands only print commands. A person runs those commands. Without a terminal on both stdin and stdout, the script still prints the commands, runs nothing, and exits 2. This is on purpose: an agent can hand the printed commands to a person. With a terminal, it prints them and exits 0.

## Test seams

Three environment variables, and a `--repo` that names another repository, are test seams. They replace the npm program, the pack script, the free disk space, or the repository. When one is active, the script prints one line that starts with `WARNING: test seams active` on stderr. It records the seams in every receipt it writes. A receipt counts only in a run that has exactly the same seams as the run that wrote it. So a real run never counts a test receipt, and a test run never counts a real one or one made under other seams. `status` shows a receipt of any seams, and marks one made under seams as `done (with test seams)`. It does not count it as done. Do not set a seam in a real release.

## The phases

Run the phases in this order.

1. Preflight. Check the branch, the sync with origin, and the working tree.
2. Gates. Run the typecheck and test commands.
3. Dry run. Pack the tarball and run `npm publish --dry-run` on it.
4. Publish. A person publishes the tarball.
5. Desktop hashes. Build the desktop app, then record a SHA-256 hash for each download.
6. Verify. Run the checks that follow a publish.
7. Tag. Create the git tag.
8. Push the tag. A person pushes it.
9. Check the claims. Look for wording that says the package is not on npm.

Run `status` at any point to see which phases are done. A phase is `done`, `todo`, or `unknown`. A phase that rests on a receipt from a test run is `done (with test seams)`. When the script cannot find out, the phase is `unknown`. For example, an unreachable registry makes the publish phase `unknown`. It never makes it `todo`.

A SHA-256 hash is a fingerprint of a file. Two files with the same hash are the same bytes. An integrity value is the same idea in the form that npm uses. It is the word `sha512-` followed by a base64 hash.

The hash file `release/desktop-sha256.json` is a tracked file. After `hashes` writes it, commit and push it. That makes a new commit. Receipts belong to one commit each, so the gates and dry-run receipts stay with the earlier commit, and the tarball you published came from that earlier commit. Then you have two choices for the tag. Tag the published commit with `tag --commit <full hash>`, which needs the gates receipt of that commit. Or run `preflight`, `gates`, and `tag` again on the new commit. `verify` works on the new commit either way: it looks for the dry-run receipt of the new commit first, then for the newest one on an ancestor of it.

## Subcommands

### `status`

Class: read-only.

Shows each phase as `done`, `todo`, `unknown`, or `done (with test seams)`, with a reason. It reads the version, the release record, local tags, the registry (`npm view`), the desktop `package.json` version, the hash file, and the receipts.

- `gates` and `dry-run` are `done` only when a receipt exists for the current commit, the working tree is clean, and (for the dry run) the tarball still exists with the same SHA-256.
- `hashes` is `done` only when the recorded hashes equal the files on disk, with no unrecorded and no missing file.
- `verify` is `done` only when the stored receipt has no skipped or failed check.
- `tag` is `done` only when the local tag points at the release commit. That is HEAD, or the commit of the newest dry-run receipt that counts in this run and sits on HEAD or an ancestor of HEAD (`git merge-base --is-ancestor`). A dry run on another branch does not count.
- `push-tag` is `done` only when `git ls-remote` shows the tag on origin at the same commit as the local tag.
- If the registry answers 404 but the release record says `npm.published` is true, the `publish` and `dist-tag` phases are `unknown`, not `todo`.

### `preflight`

Class: read-only.

Runs `git fetch origin`. Then it runs three tests. HEAD must be on a branch that matches the `branchPattern` key (the default is `^release/`). HEAD must equal `origin/<branch>`. `git status --porcelain` must print nothing. It reports how many commits HEAD is ahead and behind. It prints the commit hash. It never pulls and never checks out. Use `--branch NAME` to name a different branch.

### `gates`

Class: local-write.

Runs the gate list from the config in order and stops at the first failure. The list must hold at least one gate. The default list is `npm ci`, `npm run typecheck`, and `npm test` in the repository root, then the same three in `apps/desktop`. Add `--e2e` to also run `npm run e2e` in `apps/desktop`. If the config has no end-to-end gate, `--e2e` is an error (exit 2) and records nothing.

A gate may only be `npm ci`, `npm test`, or `npm run NAME`. The config check refuses `node` gates, extra arguments, and the flags `-e`, `-p`, `--eval`, and `--print`.

A gate that runs tests must also report counts. That is `npm test`, or `npm run` of a script named `test`, `test:*`, `e2e`, or `e2e:*` (a dot, underscore, or hyphen works as the separator too). If its output has no test counts, reports a failed test, or reports no passing test, the gate fails even when the command exited 0. The receipt records the counts. A gates receipt without passing counts for every test gate of the config counts as absent, and so does one without a gate that the config lists. If free disk space is under 12 GiB, the script refuses to start. Use `--min-free-gib N` to raise that floor. You cannot lower it.

Before the gates start, the working tree must be clean. When they end, it must be clean again. A passing run writes a receipt for the commit.

### `dry-run`

Class: local-write.

Needs a passing gates receipt for the current commit. Checks for 12.05 GiB of free disk. Makes new stage and output folders in the system temp folder. Runs `tools/cli-distribution/pack.mjs` with `--release-candidate`, then runs `npm publish --dry-run <tarball> --tag beta --access public`. Reports the package name, version, file count, entry count, size, tag, SHA-256, and integrity of the tarball.

The pack must report more than zero files, a SHA-256 that equals the one the script computes from the tarball, and a byte size that equals the real file size. Any difference fails the dry run.

The script then lists the tarball itself, with the `tar` package, and checks it:

- The number of file entries must equal what the pack reported. The pack reports `files`, which counts the package's own files and leaves out the bundled `node_modules/` entries, and `bundle.files`, the bundled ones. The script counts both groups in the tarball and compares each with its report.
- Every entry must be a plain file or a folder. A link or any other kind of entry fails the dry run.
- No file of the package may match a never-ship pattern from `tools/cli-distribution/README.md`: `.env` (and `.env.*`), a `.git` folder, `*.map`, `*.d.ts` (and `.d.mts`, `.d.cts`), a `test` or `tests` folder, or a `.trellis` folder. Bundled third-party code under `node_modules/` is not held to this list, because those packages ship their own declarations and maps.

The receipt records the real entry count as `entries`, and the pack's own-file count as `files`.

The config must set `expectedFileCount`. It means the number of files **excluding bundled `node_modules/` entries**, the pack's `files` value. Without it the dry run fails after the pack and says how many files the pack reported. To record it:

1. Run `dry-run` once. It fails and prints the count. Check that the number is right.
2. Put the number in `release.config.json`. This dirties the tree.
3. Commit the change. Receipts are keyed by commit, so the earlier gates receipt no longer applies.
4. Run `gates` again on the new commit.
5. Run `dry-run` again.

The tarball path and hashes are in the dry-run receipt. The `publish` and `verify` subcommands read them from there.

The temporary folder that holds the tarball is kept on purpose, because the tarball is what a person publishes. Only the stage folder is removed. A failed dry run removes everything it made. `dry-run --force` packs again into a new folder and writes a new receipt for the same commit. The old folder is orphaned: nothing points at it any more. Delete it by hand when you are done. The folders are named `bowerloom-release-*` in the system temp folder.

### `publish`

Class: human-only.

Prints the commands for a person to run. The commands are `shasum -a 256 <tarball>`, `npm whoami`, `npm login`, and `npm publish <tarball> --tag beta --access public`. Run `npm login` only when `whoami` fails or shows the wrong account. It never runs them and never handles a password or one-time code. Check that the account is the one named in the release record. The `shasum` line must print the same SHA-256 that the script prints above it.

Before it prints, the script needs the dry-run receipt for the current commit. With none, it exits 1 with a message that says to run `dry-run` first, at a terminal or not, and it prints no command. Then it checks the receipt. The SHA-256 and the integrity must have the right form. The tarball path must be absolute plain text. The tarball must exist, and its hashes must equal the receipt. If any check fails, the script prints nothing and exits 1. Run `dry-run` again then.

### `hashes`

Class: local-write.

Computes the SHA-256 of each desktop download in `apps/desktop/release` that matches `*.dmg` or `*.zip`. At least one file name must contain the release version, such as `Bowerloom-0.8.0-beta.2-arm64.dmg`. If none does, the step fails and names the mismatch, even with `--force`. That catches installers left from an older build.

It writes the hash file fresh from the files on disk, with the names in plain code-point order. It never merges with the old file. An entry of an earlier run, for a file that is gone, is dropped. It refuses to replace a different hash for a name that is already recorded, and a hash file for another version. Use `--force` to replace them.

Run `hashes` before you delete the installers. `node tools/gates.mjs --clean` does not remove `apps/desktop/release`. Only `--clean-installers` does. Run that after `verify` passes, not after `hashes`, because `verify` compares the installers with the hash file.

### `verify`

Class: read-only.

Runs these checks after publishing. It runs all of them and reports each one.

- The `beta` dist-tag on the registry points at the release version. A dist-tag is a name that points at one published version.
- The registry integrity for the version equals the integrity of the local tarball. With `--tarball PATH` the local tarball is that file. Without it, the script takes the dry-run receipt of the current commit (HEAD) first. If HEAD has none, it takes the newest dry-run receipt that counts in this run and sits on an ancestor of HEAD. A receipt on a commit that HEAD does not contain is not used. If that file is gone, the integrity stored in the receipt is used. If there is no `--tarball` and no receipt, the check fails. The check is never skipped.
- A clean install works. The script makes a temporary project, runs `npm install bowerloom@beta`, and runs `bowerloom --version` and `bowerloom --help`. Both must exit 0.
- Each desktop download matches the hash file, and the hash file is for the release version. A hash file for another version fails the check. A missing hash file fails the check as `unrecorded`. So does a download with no recorded hash. A differing hash fails it too.

An unreachable registry fails the check with the reason `registry unreachable`. It never passes. The command exits 0 only when every check passes, and only then does it write the verify receipt.

### `tag`

Class: local-write.

Creates the annotated tag `v<version>` on the commit that `preflight` checked. It runs `git tag -a`. In both forms `gates` must have passed for the tagged commit, and the step fails with no tag if it has not. Use `--commit HASH` to tag another commit. The hash must be all 40 characters. If the tag already exists at that commit, the step is already done. If it exists at another commit, the step fails. It does not push.

### `push-tag`

Class: human-only.

Prints `git push origin v<version>` for a person to run. It never runs it.

### `retire`

Class: human-only.

Prints the `npm deprecate` and `npm dist-tag` commands for the versions listed under `retire` in the config. Each entry has a `version` and a `message`. It never runs them. With an empty list it prints `nothing configured`.

### `claims`

Class: read-only.

Scans the files and folders listed under `claims.paths` in the config for the phrases listed under `claims.patterns`. The config needs at least one path and one phrase. A phrase matches without regard to case, and it matches across line breaks and runs of spaces: the script folds every run of white space in the file to one space before it looks. So a phrase that wraps onto the next line still matches, and so does one at the start of a sentence. For each hit it prints one `file:line`, where the line is the line on which the match starts. It skips `node_modules`, `dist`, and `.git`.

A file that it cannot read is a file that it did not check, so that is a failure. It skips a symlink (also when the configured path itself is a symlink), a file over 2 MiB, and a binary file. It lists each one with the reason and exits 1. It also exits 1 on any hit, on a configured path that is missing, and when it scanned no file. Run it after you publish and update the docs. A hit means a page still says the package is not on npm.

## Cleaning up

- The dry-run folder in the system temp folder holds the tarball, and stays until you delete it. See `dry-run`.
- `node tools/lane-tree.mjs remove` refuses a lane whose branch was squash-merged and deleted on origin, because that lane has commits that origin lacks. It cannot tell a squash merge from lost work. Delete such a lane by hand, after you check that nothing is lost.

## Configuration

`release.config.json` holds every release value. The script checks it strictly. An unknown key or a value of the wrong type stops the script with exit code 2.

- `package`, `binName`, `registry`, `distTag`, and `tagPrefix` name the npm package and the git tag.
- `releaseRecord` is the path of the release record. Its `version` field sets the version.
- `branchPattern` is a regular expression that the release branch name must match.
- `packScript` is the pack tool.
- `tagPrefix` is empty or starts with a letter or digit.
- `gates` and `e2eGates` are lists of commands. `gates` must hold at least one. Each has a `name`, a `cwd`, a `command` (`npm ci`, `npm test`, or `npm run NAME`), and an optional `timeoutSeconds`.
- `desktop` names the desktop `package.json`, the artifact folder, the file patterns, and the hash file.
- `claims` lists the paths and phrases for the `claims` subcommand. Each list needs at least one item.
- `retire` lists versions to deprecate.
- `expectedFileCount` is the number of files the tarball must hold, **excluding bundled `node_modules/` entries**. That is the `files` value the pack reports. The config check accepts a config without it, but `dry-run` fails until you set it. See `dry-run` for the steps to record it.

## Test settings

Tests use three environment variables. `BOWERLOOM_RELEASE_NPM` replaces the npm program with a fake. `BOWERLOOM_RELEASE_PACK` replaces the pack script. `BOWERLOOM_RELEASE_FREE_GIB` replaces the measured free disk space. Do not set them in a real release. See "Test seams" above.
