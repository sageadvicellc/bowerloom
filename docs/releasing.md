# Releasing the Bowerloom CLI beta

This page explains how to release a new beta of the Bowerloom command line to npm. A script does most of the work. A person does the steps that publish or retire, because those need the owner's npm login. An agent or a script may run every other step, including the tag push.

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
- A failed step prints the first failing line. Every URL in that line is replaced with `[url]` (a URL can hold a user and a token in front of the host, and so can an scp-style address, a user, an at sign, a host, and a path), and so is the exact text of the configured registry and of the origin URL once it is read. The full log goes to `.trellis/release/logs/`. Log files are private (mode 0600).
- A receipt is a small JSON file in `.trellis/release/receipts/`. It records that a step passed for one commit and one version. Git ignores the whole `.trellis` folder. Receipts have a schema version, now `v2`. A receipt of an older schema, or one without a `seams` list, counts as absent. Run the step again.
- The script never stores, reads, or prints a token, a one-time code, or a password. Every child process starts with a clean environment. The clean environment drops `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, `VERCEL_TOKEN`, every name that ends in `_TOKEN`, `_KEY`, `_SECRET`, `_PASSWORD`, or `_OTP`, and every name that holds `authtoken`, `_auth` (not followed by a letter), or `_password`. It drops `SSH_AUTH_SOCK` and `SSH_AGENT_PID` too, because the ssh agent can sign with every key it holds. Only the `git` commands the script runs (`fetch`, `ls-remote`, `tag`, `push`, `log`, and the others) get those two names back, so git over ssh works. npm, node, the gates, and pack never see them. The list lives in `tools/lib/safe-env.mjs`.
- Every npm child process gets an empty `userconfig` and an empty `globalconfig`. So npm never reads your `~/.npmrc`, which can hold a registry token.
- The script blanks token-shaped text before it writes a log and before it prints a line, including the command line it echoes.
- Every `git` command the script runs starts with `-c core.fsmonitor=false`. So a `core.fsmonitor` setting in the repository config cannot run a command, with the ssh agent in its environment, when git checks the working tree. See "Residual risk" for what this does not cover.
- On Ctrl-C, `SIGTERM`, or `SIGHUP`, the script stops every child process group, removes the temporary folders it made, and exits 130.
- Each child process runs in its own process group. A process group is the set of processes that one command starts. When a time limit or an output limit passes, the script stops the whole group.
- The only `npm publish` that the script ever runs is `npm publish --dry-run`. A dry run lists what a publish does and publishes nothing. The script refuses every other form.

## The four classes of subcommand

- Read-only subcommands change no tracked file, no remote, and no registry. They may update the remote-tracking refs (`preflight` runs `git fetch --prune origin`), and they may write logs and receipts under `.trellis`.
- Local-write subcommands write files on this computer. They never contact the registry with a write.
- Remote-write subcommands change a git remote. The only one is `tag`. It pushes one tag to origin, and nothing else: the exact command is `git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c push.followTags=false push --no-verify --no-recurse-submodules origin refs/tags/<tag>`, never with `--force` or `--tags`, and never a branch. The push, the local `git tag`, and the fetches of `preflight` and `tag` run with `core.hooksPath=/dev/null`, so no repository hook (such as `pre-push` or `reference-transaction`) runs for them, and the push also runs with `--no-verify`. If origin has more than one fetch URL or more than one push URL, or its push URL differs from its fetch URL, it pushes nothing. It never contacts the registry.
- Human-only subcommands only print commands. A person runs those commands. Without a terminal on both stdin and stdout, the script still prints the commands, runs nothing, and exits 2. This is on purpose: an agent can hand the printed commands to a person. With a terminal, it prints them and exits 0.

## Test seams

Three environment variables, and a `--repo` that names another repository, are test seams. They replace the npm program, the pack script, the free disk space, or the repository. When one is active, the script prints one line that starts with `WARNING: test seams active` on stderr. It records the seams in every receipt it writes. Every JSON result lists them in a `seams` array. A real run has no `seams` key. A receipt counts only in a run that has exactly the same seams as the run that wrote it. Under a seam, `tag` refuses to run unless the URL of origin is a path on this computer. So a test run never pushes to a real remote. So a real run never counts a test receipt, and a test run never counts a real one or one made under other seams. `status` shows a receipt of any seams, and marks one made under seams as `done (with test seams)`. It does not count it as done. Do not set a seam in a real release.

## The phases

Run the phases in this order.

1. Preflight. Check the branch, the sync with origin, and the working tree.
2. Gates. Run the typecheck and test commands.
3. Dry run. Pack the tarball and run `npm publish --dry-run` on it.
4. Publish. A person publishes the tarball.
5. Desktop hashes. Build the desktop app, then record a SHA-256 hash for each download.
6. Verify. Run the checks that follow a publish.
7. Tag. Create the git tag and push it to origin. The tag step needs a passing `verify` receipt, so the package is published and verified before the tag exists.
8. Check the claims. Look for wording that says the package is not on npm.

Run `status` at any point to see which phases are done. A phase is `done`, `todo`, or `unknown`. A phase that rests on a receipt from a test run is `done (with test seams)`. When the script cannot find out, the phase is `unknown`. For example, an unreachable registry makes the publish phase `unknown`. It never makes it `todo`.

A SHA-256 hash is a fingerprint of a file. Two files with the same hash are the same bytes. An integrity value is the same idea in the form that npm uses. It is the word `sha512-` followed by a base64 hash.

The hash file `release/desktop-sha256.json` is a tracked file. After `hashes` writes it, commit and push it. That makes a new commit. Receipts belong to one commit each, so the gates and dry-run receipts stay with the earlier commit, and the tarball you published came from that earlier commit. `verify` works on either commit: it looks for the dry-run receipt of the current commit first, then for the newest one on an ancestor of it. It also reads the hash file from the working tree, so it can run before the hash commit.

The tag needs a gates receipt and a passing verify receipt, each for the tagged commit or (for verify) an ancestor of it. So you have two orders:

1. Run `hashes`, then `verify` on the published commit (the hash file is still uncommitted), then commit and push the hash file. Tag the published commit with `tag --commit <full hash> --branch <release branch>`. Its gates receipt and its verify receipt both belong to it.
2. Commit and push the hash file first. Then run `gates` and `verify` on the new commit, and run `tag` there, or `tag --commit <new hash> --branch <release branch>`. The dry-run receipt stays on the earlier commit, and that is allowed.

A verify receipt on a commit that is later than the tagged commit does not count.

## Subcommands

### `status`

Class: read-only.

Shows each phase as `done`, `todo`, `unknown`, or `done (with test seams)`, with a reason. It reads the version, the release record, local tags, the registry (`npm view`), the desktop `package.json` version, the hash file, and the receipts.

- `gates` and `dry-run` are `done` only when a receipt exists for the current commit, the working tree is clean, and (for the dry run) the receipt agrees with the config and the never-ship rules and the tarball still exists with the same SHA-256.
- `hashes` is `done` only when the recorded hashes equal the files on disk, with no unrecorded and no missing file.
- `verify` is `done` only when the stored receipt has no skipped or failed check.
- `tag` is `done` only when the local tag points at the release commit AND origin has the tag at that same commit (`git ls-remote`). The release commit is HEAD, or the commit of the newest dry-run receipt that counts in this run, agrees with the config (package, registry, dist-tag, file count, never-ship rules), and sits on HEAD or an ancestor of HEAD (`git merge-base --is-ancestor`). A dry-run receipt that no longer agrees with the config names no release commit, in the `tag` and the `tag-on-origin` phase alike. A dry run on another branch does not count. A tag that only this clone holds is `todo`, and the reason says `(local only)`. A tag that origin holds at another commit is `todo`. When origin cannot be reached, the phase is `unknown`. When git cannot read the local tag ref, the phase is `unknown`, not `todo`. Status is a report. It reads the receipts the same way `tag` does, but `tag` checks everything again, and `tag --commit` also needs the commit on a named branch of origin.
- `tag-on-origin` is `done` only when `git ls-remote` shows the tag on origin at the same commit as the local tag. It is `todo` when origin has no such tag, or has it at another commit, and `unknown` when origin cannot be reached. When this clone has no local tag but origin has one at the release commit, the phase is `done` and the reason says the tag exists on origin and to run `git fetch origin tag <tag>`.
- If the registry answers 404 but the release record says `npm.published` is true, the `publish` and `dist-tag` phases are `unknown`, not `todo`.

### `preflight`

Class: read-only.

Runs `git -c core.fsmonitor=false -c core.hooksPath=/dev/null fetch --prune origin`. That disables repository hooks for the fetch, and it drops the remote-tracking refs of branches that origin no longer has. Then it fetches the checked-out branch on its own (`fetch --prune origin +refs/heads/<branch>:refs/remotes/origin/<branch>`, also without hooks), so a narrowed `remote.origin.fetch` setting cannot leave an old tracking ref that equals HEAD. `git ls-remote --heads origin refs/heads/<branch>` gives the tip on origin, and the tracking ref must equal it. The check is the same one `tag --commit` runs (see `tag`). A branch that origin deleted fails with `origin has no branch <branch>; push the branch first`. Then it runs three tests. HEAD must be on a branch that matches the `branchPattern` key (the default is `^release/`). HEAD must equal `origin/<branch>`. `git status --porcelain` must print nothing. It reports how many commits HEAD is ahead and behind. It prints the commit hash. It never pulls and never checks out. Use `--branch NAME` to name a different branch.

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
- No file of the package may match a never-ship pattern from `tools/cli-distribution/README.md`: `.env` (and `.env.*`), a `.git` folder, `*.map`, `*.d.ts` (and `.d.mts`, `.d.cts`), a `test` or `tests` folder, or a `.trellis` folder. Bundled third-party code under `node_modules/` is held to the `.env`, `.git`, and `.trellis` patterns only. It is not held to `*.map`, `*.d.ts`, or the `test` folders, because those packages ship their own declarations, maps, and tests. One more exception: a bundled `.env.example`, `.env.sample`, `.env.template`, or `.env.dist` may ship, because it is a template. Every other `.env*` file is refused, and so are those four names in the package's own files.

The receipt records the real entry count as `entries`, and the pack's own-file count as `files`.

The config must set `expectedFileCount`. It means the number of files **excluding bundled `node_modules/` entries**, the pack's `files` value. Without it the dry run fails after the pack and says how many files the pack reported. To record it:

1. Run `dry-run` once. It fails and prints the count. Check that the number is right.
2. Put the number in `release.config.json`. This dirties the tree.
3. Commit the change. Receipts are keyed by commit, so the earlier gates receipt no longer applies.
4. Run `gates` again on the new commit.
5. Run `dry-run` again.

The tarball path and hashes are in the dry-run receipt. The `publish` and `verify` subcommands read them from there.

A dry run that already passed for this commit prints `already done`. It does so only while the receipt still agrees with the config and the rules: the receipt's file count must equal `expectedFileCount`, its tag must equal `distTag`, its `package` must equal the config `package`, its `registry` must equal the config `registry`, and its `rulesVersion` must equal the `NEVER_SHIP_RULES_VERSION` constant of the script. That constant is raised whenever the never-ship rules change. If any of these differ, the dry run runs again. The same check runs in `publish`, in `verify`, and in `status`: a receipt made under older rules (no `rulesVersion`) or for another package, registry, dist-tag, or file count is treated as absent there too. `publish` fails with `run dry-run again`, `verify` falls back to the next receipt that agrees (or fails), and `status` shows the dry run as `todo`.

The temporary folder that holds the tarball is kept on purpose, because the tarball is what a person publishes. Only the stage folder is removed. A failed dry run removes everything it made. `dry-run --force` packs again into a new folder and writes a new receipt for the same commit. The old folder is orphaned: nothing points at it any more. Delete it by hand when you are done. The folders are named `bowerloom-release-*` in the system temp folder.

### `publish`

Class: human-only.

Prints the commands for a person to run. The commands are `shasum -a 256 <tarball>`, `npm whoami`, `npm login`, and `npm publish <tarball> --tag beta --access public`. Run `npm login` only when `whoami` fails or shows the wrong account. It never runs them and never handles a password or one-time code. Check that the account is the one named in the release record. The `shasum` line must print the same SHA-256 that the script prints above it.

Before it prints, the script needs the dry-run receipt for the current commit. With none, it exits 1 with a message that says to run `dry-run` first, at a terminal or not, and it prints no command. Then it checks the receipt. The SHA-256 and the integrity must have the right form. The tarball path must be absolute plain text. The tarball must exist, and its hashes must equal the receipt. If any check fails, the script prints nothing and exits 1. Run `dry-run` again then. Before these checks, it compares the receipt with the config (package, registry, dist-tag, file count, and the never-ship rules version). A receipt that disagrees fails with `does not match the config` and `run dry-run again`, and nothing is printed.

### `hashes`

Class: local-write.

Computes the SHA-256 of each desktop download in `apps/desktop/release` that matches `*.dmg` or `*.zip`. Every matched file name must contain the release version, such as `Bowerloom-0.8.0-beta.2-arm64.dmg`. The version must stand alone: the character before it is not a letter, digit, or dot, and the text after it does not go on with a letter, a digit, or a dot and a digit. So `0.8.0-beta.21` and `0.8.0-beta.2.1` do not match `0.8.0-beta.2`. A release version with no prerelease part has one more rule: a hyphen plus a letter or digit after it ends the match. So `Bowerloom-0.8.0-beta.2-arm64.dmg` does not match `0.8.0`, and neither does `Bowerloom-0.8.0-arm64.dmg`. For a stable release, name the installers `Bowerloom-0.8.0.dmg` or `Bowerloom-0.8.0_arm64.dmg`. If any name does not match, the step fails and lists those names, even with `--force`. That catches an installer left from an older build next to a new one. Delete the old installers and run `hashes` again.

It writes the hash file fresh from the files on disk, with the names in plain code-point order. It never merges with the old file. An entry of an earlier run, for a file that is gone, is dropped. It refuses to replace a different hash for a name that is already recorded, and a hash file for another version. Use `--force` to replace them.

Run `hashes` before you delete the installers. `node tools/gates.mjs --clean` does not remove `apps/desktop/release`. Only `--clean-installers` does. Run that after `verify` passes, not after `hashes`, because `verify` compares the installers with the hash file.

### `verify`

Class: read-only.

Runs these checks after publishing. It runs all of them and reports each one.

- The `beta` dist-tag on the registry points at the release version. A dist-tag is a name that points at one published version.
- The registry integrity for the version equals the integrity of the local tarball. With `--tarball PATH` the local tarball is that file. Without it, the script takes the dry-run receipt of the current commit (HEAD) first. If HEAD has none, it takes the newest dry-run receipt that counts in this run and sits on an ancestor of HEAD. A receipt on a commit that HEAD does not contain is not used. A dry-run receipt counts only while it agrees with the config (package, registry, dist-tag, file count, never-ship rules version); one that does not is skipped, as if it were absent. If that file is gone, the integrity stored in the receipt is used. If there is no `--tarball` and no receipt, the check fails. The check is never skipped.
- A clean install works. The script makes a temporary project, runs `npm install bowerloom@beta`, and runs `bowerloom --version` and `bowerloom --help`. Both must exit 0.
- Each desktop download matches the hash file, and the hash file is for the release version. A hash file for another version fails the check. A missing hash file fails the check as `unrecorded`. So does a download with no recorded hash. A differing hash fails it too.

An unreachable registry fails the check with the reason `registry unreachable`. It never passes. The command exits 0 only when every check passes, and only then does it write the verify receipt.

### `tag`

Class: remote-write.

Creates the annotated tag `v<version>` on the commit that `preflight` checked, then pushes that one tag to origin. It runs `git -c core.fsmonitor=false -c core.hooksPath=/dev/null tag -a` (no repository hook runs for the local tag), then this exact command:

```sh
git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c push.followTags=false push --no-verify --no-recurse-submodules origin refs/tags/<tag>
```

`push.followTags=false` keeps a `push.followTags` setting from carrying other tags along. `core.hooksPath=/dev/null` and `--no-verify` keep every repository hook from running for the push. `core.fsmonitor=false` keeps a configured fsmonitor command from running. `--no-recurse-submodules` keeps a submodule out of the push. The fetches of `tag` and `preflight` and the local `git tag` also run with `-c core.hooksPath=/dev/null`. The step never pushes a branch and never uses `--force` or `--tags`.

Before it fetches or pushes, the step reads `git remote get-url --all origin` and `git remote get-url --all --push origin`. Each must print exactly one line, and the two lines must be equal. Two push URLs or two fetch URLs fail with `origin must have exactly one push URL` or `origin must have exactly one fetch URL`. A push URL that differs from the fetch URL fails with `push URL differs from fetch URL`. Under a test seam it also fails unless the origin URL is a path on this computer.

The step needs these receipts, for the same version:

- A passing `gates` receipt for the tagged commit. Without it the step fails with no tag.
- A passing `verify` receipt on the tagged commit or on an ancestor of it. Without it the step fails with `run verify first (the package must be published and verified before the tag)`. A tag cannot land before the package is published and verified.

Use `--commit HASH --branch NAME` to tag another commit. The hash must be all 40 characters. `--branch` is required with `--commit`, and its value must match the `branchPattern` of the config. Otherwise the step exits 2. Without `--commit`, `tag` runs `preflight`, which makes the same tip check for the checked-out branch. A `--commit` run skips `preflight`. It runs `git -c core.fsmonitor=false -c core.hooksPath=/dev/null fetch --prune origin` first. The prune drops the tracking ref of a branch that origin deleted. Then it fetches the named branch on its own (`fetch --prune origin +refs/heads/<NAME>:refs/remotes/origin/<NAME>`), so a narrowed `remote.origin.fetch` setting cannot leave a stale tracking ref as proof. Then `git ls-remote --heads origin refs/heads/<NAME>` gives the tip on origin, and the tracking ref must equal it. A tip that differs fails with `is not the tip of the branch on origin`. Then the commit must be an ancestor of exactly `refs/remotes/origin/<NAME>`. A branch of another name does not count, even when its name matches the pattern. If origin has no branch `NAME`, the step fails with `origin has no branch <NAME>; push the branch first`. If the commit is not on it, the step fails with `commit <hash> is not on origin/<NAME>; push the branch first`. If git itself fails in the ancestor check (exit 128), the step reports `git merge-base failed` and the git error, not "not on the branch". Each failure writes nothing. That check stops the tag from carrying an unpublished commit and its history to origin.

The step reads the tag on origin (`git ls-remote origin refs/tags/v<version> refs/tags/v<version>^{}`) before it writes anything:

- The local tag is at the commit and origin has it at the same commit: the step is already done, and it pushes nothing.
- Only the local tag exists, at the commit: the step pushes it.
- Neither exists: the step creates the tag, then pushes it.
- The local tag is at another commit, or origin has the tag at another commit: the step fails and changes nothing. It never overwrites a tag.
- Origin has the tag at the commit but this clone has no such tag: the step fails. Fetch the tag, then run it again.
- Origin cannot be read, or the push fails (authentication, network, or a rejection): the step fails with the first error line. No receipt is written. A tag made before the failed push stays, and the next run pushes it. If HEAD moved after a failed push, the old local tag is at another commit and `tag` fails. Delete it by hand with `git tag -d <tag>` after you check that nothing else needs it.
- A tag appears on origin between the read and the push: git rejects the push, the step fails with the first error line, and the tag on origin is not changed.

The push is the only write to a remote that the script makes, and it never touches the registry.

### `retire`

Class: human-only.

Prints the `npm deprecate` and `npm dist-tag` commands for the versions listed under `retire` in the config. Each entry has a `version` and a `message`. It never runs them. With an empty list it prints `nothing configured`.

### `claims`

Class: read-only.

Scans the files and folders listed under `claims.paths` in the config for the phrases listed under `claims.patterns`. The config needs at least one path and one phrase. A phrase matches without regard to case, and it matches across line breaks and runs of spaces: the script folds every run of white space in the file to one space before it looks. So a phrase that wraps onto the next line still matches, and so does one at the start of a sentence. For each hit it prints one `file:line`, where the line is the line on which the match starts. It skips `node_modules`, `dist`, and `.git`.

A file that it cannot read is a file that it did not check, so that is a failure. It skips a symlink (also when the configured path itself is a symlink), a file over 2 MiB, and a binary file. It lists each one with the reason and exits 1. It also exits 1 on any hit, on a configured path that is missing, and when it scanned no file. Run it after you publish and update the docs. A hit means a page still says the package is not on npm.

## What an agent may run

- Read-only and local-write subcommands: an agent or a script may run any of them.
- `tag`: an agent or a script may run it. It needs a passing gates receipt and a passing verify receipt for the commit, and it pushes only the one release tag to origin.
- `publish` and `retire`: a person runs the printed commands. Publishing needs the owner's npm login and one-time code, and an agent never holds them. The script never runs `npm publish` except as a dry run.

## Cleaning up

- The dry-run folder in the system temp folder holds the tarball, and stays until you delete it. See `dry-run`.
- `node tools/lane-tree.mjs remove` refuses a lane whose branch was squash-merged and deleted on origin, because that lane has commits that origin lacks. It cannot tell a squash merge from lost work. Delete such a lane by hand, after you check that nothing is lost.

## Known limits

- `tools/public-scan.mjs` does not scan branch names or other ref names. It scans added lines, file paths, commit messages, author names, binary content, and the pull request text.
- `tools/public-scan.mjs` reads a binary file as raw bytes. It does not look inside a compressed format: zip, gz, dmg, docx, or the compressed streams of a pdf. Its output says so. A binary file that a commit added and a later commit removed is listed under `binaryIntermediate` as a warning, and the exit is 1 unless `--allow-intermediate-binary` is given. It was never read.
- `tools/public-scan.mjs` scans a binary file only at its final (HEAD) version. A binary file changed A, then B, then C inside the range is read as C. The output's `binaryNote` says so.
- `tools/public-scan.mjs` reads the value of a password or auth-token assignment (the keys `password`, `_auth`, and `_authToken`; the name may carry quotes, and a quote may carry a backslash, as in JSON inside a string). A quoted value is flagged unless it is a placeholder (`${NAME}`, `$NAME`, `%NAME%`, `<your password>`, `{{ x }}`, a row of `*`, `x`, or `.`, or empty). An unquoted value is code, and not a secret, only in one of five strict shapes: (a) a call or an index on an identifier (`f(`, `a.b(`, `config[`), (b) a member chain of identifiers with no digit in it (`opts.password`, `process.env.DB_PASSWORD`), (c) a template `${name}`, (d) a variable `$name` (a name that mixes lowercase letters with a digit, such as a dollar sign followed by `ecret99`, is a secret), (e) `undefined`, `null`, `true`, `false`, `None`, `nil`, or a typed-array name such as `Uint8Array`. Any other unquoted value follows the length rule: it is flagged when it has 8 or more characters and, after a colon, a digit. A member chain with a digit in a segment (`Sup3r.Secret1`, `abc.def.ghi1234567890`) is not code. A value such as `Pass{word}12` or `pa$$w0rd123` is not code either.
- `tools/public-scan.mjs` flags a hardcoded string that follows `??`, `||`, or `or` after a code value on a password line. It reads single quotes, double quotes, and a backslash before the quote. An empty string or a placeholder is allowed. It follows chained fallbacks (`a ?? b ?? "..."`, `a || b || "..."`, `x or y or "..."`), a call (`os.environ.get("X")`), an index (`os.environ["X"]`, `process.env["X"]`), and a cast (`process.env.X as string`) between the value and the literal. It stops at `,`, `;`, `}`, `//`, and `#`, so a literal fallback of a later property or statement on the same line (`{ password: process.env.DB_PASSWORD, host: process.env.HOST ?? "localhost" }`) is not this value's fallback. A fallback literal needs 3 or more characters. It does not look at a default that is passed as an argument, such as the second argument of an environment lookup. Known misses: a backtick literal after the operator, a `?:` fallback (`getenv('X') ?: "..."`), an annotated default (`password: str = "..."`), a ternary with a literal (`cond ? "..." : "..."`), a secret written as a call or an index with a literal inside (`Secret(1)`, `admin[0]`, which count as code), and a dotted word with no digit (`correct.horse.battery`, which counts as a member chain).
- `tools/public-scan.mjs` also reports a password inside a URL (`postgres://`, `redis://`, `https://`, `amqp://`, `mongodb://` and other schemes) when the password is not empty and not a placeholder. The placeholders are the ones above plus `{name}`, `%s`, and `%d`. A URL with only a user name is not reported. An email-shaped part of an allowed URL credential (`postgres://u:$pass@db.example.org`) is not reported as an email.
- Known misses of `tools/public-scan.mjs`. It does not look for any key other than `password`, `_auth`, and `_authToken` (so `passwd`, `secret`, `token`, `api_key`, and similar names are not read). It does not flag a short bare value: an unquoted value of fewer than 8 characters is not reported, and after a colon an unquoted word with no digit is not reported (`Credentials`, `string`, and a long word with no digit). It does not join a value that continues on the next line (a backslash line continuation, or a string split over two lines). It does not see through a zero-width character or another invisible character placed inside the key name. It does not decode a value (base64, an escape sequence). It reads only the fallback forms listed above.
- The marker `public-scan: allow <kind>` skips one kind of finding on its own physical line. The kinds are `secret`, `email`, `home-path`, and `url-credential` (a password inside a URL needs `url-credential`; `secret` does not cover it). The kind is required and is matched as a whole word. A bare marker, an unknown kind, or a kind in a longer word skips nothing. A session link, a scratch folder, and a session id can never be skipped. A line break here is LF, CR, vertical tab, form feed, NEL, or the line and paragraph separators, so a marker on one of several CR-joined parts does not cover the others. The marker is honoured only in an added text line of the diff. It is not honoured in a file path, a binary file, a commit message, an author name, or the pull request text. It never skips the private terms from `--terms-file`. A binary file is read line by line, and every line is checked. The JSON result lists every skipped finding as `allowedLines` (`count`, and `items` with `file`, `line`, and `kind`), and the human output prints them. Use the marker for a test fixture or an example that has to look like a leak, or build the fixture from parts.
- `tools/public-scan.mjs` exits 1 when a binary file was added and removed again inside the range (`binaryIntermediate` is not empty), because it was never read. Pass `--allow-intermediate-binary` to accept that; the files stay listed as a warning.
- `tools/public-scan.mjs` shows a file name as `[path withheld]` in every finding, not only in a path or binary finding, when the name itself matches a leak pattern or a private term.
- `node tools/lane-tree.mjs remove` refuses a lane whose origin is an ssh URL. It cannot reach origin without the ssh agent, so it cannot compare the lane with origin.
- `node tools/gates.mjs --clean-installers` checks the hashes of the `.dmg` and `.zip` installers only. Another file in `apps/desktop/release` is removed with the folder and is not checked.
- `node tools/gates.mjs --clean` and `--clean-installers` delete nothing when the run was interrupted. The summary then prints `gates: cleanup skipped (interrupted)` and `clean.skipped` is `true`.
- `tools/lib/output-parse.mjs` reads the test counts of a gate. It adds up every node summary block and every Playwright summary block of one gate, so a Playwright line such as `3 passed (1s)` printed by a test adds to the totals. A key that repeats inside a block (`pass` twice in a row) starts a new summary. `cancelled`, `interrupted`, and `did not run` count as failures. These counts are read only after the gate exited 0: a gate that exits non-zero fails whatever the counts say.
- `hashes` treats a release version with no prerelease part strictly. An installer named `Bowerloom-0.8.0-arm64.dmg` does not match `0.8.0`. Use `_` before the architecture in a stable release.

## Residual risk

The script's own `git` calls disable hooks where it matters (`core.hooksPath=/dev/null`, `--no-verify`) and `core.fsmonitor`. They do not make a hostile repository safe. The script still trusts `.git/config` and the git config of your user account for the credential helpers, `core.sshCommand`, `core.gitProxy`, `gpg.program`, filter drivers, and `include` files. Those run with the ssh agent in their environment for the git calls that talk to origin. Receipts under `.trellis/release/receipts` are unsigned JSON, so anyone who can write the working tree can forge one. The gates (the receipts, the clean tree, the published branch, the single push URL) are checks against honest mistakes. They are not a barrier against a hostile process that already has shell access to this account. Run the release from a clone whose config you wrote yourself.

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

## Decisions on record

The owner settled these on 2026-11-07.

- Tags: agents and scripts can push the release tag. `release tag` pushes only that tag. It never moves or force-pushes an existing tag, and it refuses unless the commit passed the gates. Only the npm steps need the owner: `publish`, `retire`, and the registry login.
- Hashes: the desktop installer hashes live in the tracked file `release/desktop-sha256.json`. The release pull request commits it. That moves HEAD, so tag with `tag --commit` or run the gates again.
- Dry run: the beta.2 release pull request first sets `release/beta.json` to the next unreleased version. Then one real `dry-run` runs and records `expectedFileCount`.

## Manifest and the MCP server

`tools/manifest.json` lists every tool with its safety class. The shared workbench manifest has the same idea. Two things differ. This manifest names the class `safetyClass`, and the shared one names it `safety_class`. Any server that reads both must map the name.

Each tool carries `destructive` (true or false) and `mcp_exposure` (`expose` or `hidden`). The rules match the shared manifest:

- A missing `mcp_exposure` would mean `hidden`. This manifest states it for every tool.
- A `human-only` tool is `hidden` and destructive.
- A `local-write` or `remote-write` tool is `hidden`.
- An exposed tool is `read-only` and says `destructive: false`.

`release:verify` is read-only but stays `hidden`. It installs the published package in a temporary folder and runs it. `release:preflight` is read-only but stays `hidden` too: it runs `git fetch --prune origin`, which changes remote-tracking refs and talks to the network, and it takes `--repo`, so a server could point it at any repository. `release:status` is read-only but stays `hidden` as well: it takes `--repo` and runs `git ls-remote origin`, which talks to the network with the ssh agent, so a server could point it at any repository. `release:claims` takes `--repo` and reads files below it, so it is `hidden` too. Every release subcommand takes `--repo`, so no release tool is exposed. A test pins this: each release entry takes `--repo` and is `hidden`.
