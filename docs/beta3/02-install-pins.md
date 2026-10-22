# Spec 02: install pins and the social preview test

## 1. Header

- Source: found in the 0.7.0-beta.2 install proof. It is Track B and Track C of the beta.3 plan. There is no GitHub issue yet. The builder opens one and links it in the pull request.
- Decisions: Hanna's decision 5 is in https://github.com/sageadvicellc/bowerloom/issues/84#issuecomment-6332928335. The owner's decision on the social preview text came with the beta.3 task brief. Section 2.2 repeats it so this spec stands alone.
- Lane: 2. This is the first spec of lane 2. Specs 03, 04, 06, 07, 08, and 09 follow it.
- Branch: `beta3/02-install-pins`, from `release/0.7.0-beta.3`.
- Dependencies: none.

Terms used below:

- A **shrinkwrap** is the file `npm-shrinkwrap.json`. It is a lockfile that a package can publish.
- A **pin** is an exact version in `dependencies`, such as `"express": "5.2.1"`, with no range.
- A **top-level entry** is a lockfile path of the form `node_modules/<name>` or `node_modules/@scope/<name>`. A **nested entry** has a second `node_modules/` in the path.
- A **registry install** is `npm install bowerloom@beta`. A **tarball install** is `npm install <file>.tgz`, local or global.
- A **proof test** is a test that runs only when the environment variable `BOWERLOOM_PACK_INSTALL_PROOF=1` is set.

## 2. Problem

### 2.1 Track B: tarball installs ignore the shrinkwrap

`tools/cli-distribution/pack.mjs` packs `bowerloom` with an `npm-shrinkwrap.json` that holds the tested versions (`tools/cli-distribution/pack.mjs:150`). A registry install of `bowerloom@beta` honors it. A tarball install does not. The beta.2 proof saw these differences:

| Package | Shrinkwrap | Tarball install |
|---|---|---|
| `express` | 5.2.1 | 5.3.0 |
| `@langchain/core` | 1.2.14 | 1.2.20 |
| `@langchain/langgraph-checkpoint` | 1.1.5 | 1.2.1 |
| `@langchain/langgraph-sdk` | 1.12.0 | 1.12.6 |

The cause is in npm 11.6.1, read from its source on this machine at `/Users/hannamacintosh/.nvm/versions/node/v24.11.0/lib/node_modules/npm`:

- `node_modules/@npmcli/arborist/lib/arborist/build-ideal-tree.js:787-796`: a node whose `hasShrinkwrap` is true skips dependency resolution, because "it's going to get its deps satisfied by whatever's in that file".
- `node_modules/@npmcli/arborist/lib/node.js:174`: `hasShrinkwrap` comes from `package._hasShrinkwrap`.
- The string `_hasShrinkwrap` appears in npm's source only in `arborist/lib/node.js` and `arborist/lib/shrinkwrap.js`. It does not appear in `pacote`, the package that reads tarballs. Registry package data carries the flag. A tarball does not.
- The npm manual page `docs/content/configuring-npm/npm-shrinkwrap-json.md` says only that a shrinkwrap may be published. It does not describe tarball installs.

So a tarball install ignores the whole packed shrinkwrap. It resolves every dependency from the ranges in the packed `package.json`. That also explains why `@langchain/langgraph-sdk` moved, although it is not a peer dependency. This reading comes from source, not from a run. Section 12 says how the install proof settles it.

The packed `package.json` today lists 10 direct dependencies (`tools/cli-distribution/pack.mjs:143,148`): `@dbos-inc/dbos-sdk`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`, `@modelcontextprotocol/sdk`, `ajv`, `jose`, `langsmith`, `pg`, `tar`, and `yaml`. The shrinkwrap holds 148 entries. 142 are top-level and 6 are nested. The six nested entries are:

- `node_modules/@langchain/langgraph-sdk/node_modules/eventemitter3`
- `node_modules/@langchain/langgraph-sdk/node_modules/p-queue`
- `node_modules/@langchain/langgraph-sdk/node_modules/p-timeout`
- `node_modules/body-parser/node_modules/content-type`
- `node_modules/negotiator/node_modules/content-type`
- `node_modules/type-is/node_modules/content-type`

One top-level entry is optional: `node_modules/pg-cloudflare` has `"optional": true`.

### 2.2 Track C: the social preview test checks the wrong text

`apps/landing/test/social-preview.test.mjs:14` requires `release/social-preview.json` `description` to equal the first sentence of the landing hero body. The owner decided that the preview keeps this text:

`Set up the skills, prompts, and teams your agents use, and approve every change.`

The same sentence is the tagline in `apps/docs/src/content/docs/index.md:3`. The hero body (`apps/landing/src/content.ts:15`) starts with a different sentence. The test therefore fails or forces a change to the approved record.

## 3. Behavior

### 3.1 Track B

After this spec, every install path keeps the tested versions:

1. The packed `package.json` lists every top-level lockfile entry as an exact `dependencies` entry, in addition to the direct dependencies.
2. The packed `npm-shrinkwrap.json` root entry lists the same dependencies.
3. A tarball install, local or global, resolves each top-level package to its shrinkwrap version.
4. A registry install keeps working as today.
5. If the install proof shows that a nested entry still drifts, the packages that own the nested entries ship inside the tarball (section 6.4).

The pack command, its arguments, its output, its exit codes, and its write order do not change. `npm pack` still runs with `--ignore-scripts --offline`. Nothing is installed by the pack command.

Pack failures stay thrown errors with the existing text style (`fail(message)` at `tools/cli-distribution/pack.mjs:15`). The new messages are in section 5.

### 3.2 Track C

The test asserts the literal tagline. The record `release/social-preview.json` does not change.

## 4. Schemas and formats

### 4.1 The packed `package.json`

Today (`tools/cli-distribution/pack.mjs:148`):

```
dependencies: <10 direct dependencies, sorted by name>
```

After this spec:

```
dependencies: <direct dependencies plus every pin of section 4.3, one exact version each, sorted by name>
```

Sorting uses `a.localeCompare(b)`, as the code does today. Every value is the `version` field of the lockfile entry, with no range prefix. The key set of the manifest is otherwise unchanged. There is no `bundleDependencies` key unless section 6.4 applies.

### 4.2 The packed `npm-shrinkwrap.json`

The shape does not change (`tools/cli-distribution/pack.mjs:70`). The root entry (`packages[""]`) now uses the full `dependencies` map of section 4.1. The other entries are the reachable entries with `dev`, `devOptional`, and `workspaces` removed, as today (`pack.mjs:64`). The `peer: true` flags stay.

### 4.3 Which entries become pins

The function is `flatDependencies(packages, direct)`. It takes the `packages` map of the finished shrinkwrap and the direct dependency map. It returns a map from name to version.

For each path in `packages`, in sorted order:

1. Skip the root path `""`.
2. Skip the path if it is a nested entry. A nested entry is a path where `node_modules/` appears more than once.
3. Skip the path if the entry has `"optional": true`. An optional package may fail to install on some platforms, and a hard pin would break those installs.
4. Take `name` as the part of the path after `node_modules/`.
5. If the entry has a `name` field that differs from this name, or the entry has a `link` field, throw `Unpinnable dependency: <path>`.
6. If `version` is not a string that matches `^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$`, throw `Unpinnable dependency: <path>`.
7. Add `name: version`.

Then merge `direct` over the result. If a direct dependency has a different version from the lock entry, the existing check at `pack.mjs:55-57` has already thrown `Direct dependency lock mismatch`.

With the current lockfile the result has 142 minus 1 optional entry, so 141 pins, and the 10 direct dependencies are among them.

## 5. Failure messages

These are thrown errors in `pack.mjs`. They are not CLI refusal codes, and they need no `human.ts` entry.

| Message | Cause | Next step |
|---|---|---|
| `Unpinnable dependency: <path>` | A top-level entry is an alias, a link, or has a version that is not exact. | Fix the lockfile entry, then pack again. |
| `Pinned dependency differs from the lock: <name>` | After the merge, a pin differs from its lock entry. | Run `npm install` in the repository to refresh the lock, then pack again. |
| `Nested dependency drift: <path>` | The proof test only. An installed nested entry has a different version from the shrinkwrap. | Apply section 6.4, or report the drift to Hanna. |

## 6. Where to change

All paths are checked against the beta.3 tree. The line numbers are the same as in beta.2.

### 6.1 `tools/cli-distribution/pack.mjs`

- `pack.mjs:41-71`: `lockedDependencies(lock, dependencies, manifest)` keeps its signature and its output. Existing tests call it with this signature (`tools/cli-distribution/test/pack.test.mjs:50-53,163-169`).
- Add `export function flatDependencies(packages, direct)` after `lockedDependencies`. It follows section 4.3.
- `pack.mjs:130-146`: the loop that finds the direct runtime dependencies stays.
- `pack.mjs:148`: build the manifest in two steps.
  1. Compute `shrink = lockedDependencies(lock, dependencies, {name, version, license, bin, engines})`. The lock is the parsed `package-lock.json`. The direct dependencies are the sorted `dependencies` map.
  2. Compute `pins = flatDependencies(shrink.packages, dependencies)`. Set the manifest `dependencies` to `pins` sorted by name.
- `pack.mjs:150`: write the shrinkwrap with the final manifest, so the root entry holds the full map. Do this by building the shrinkwrap again, or by replacing `packages[""].dependencies` in `shrink` with the final map. Either way the root `dependencies` equals the manifest `dependencies`.
- `pack.mjs:158`: `record.dependencies` already holds `manifest.dependencies`. It now holds the full pin map. Check that nothing else in the repository reads `DISTRIBUTION.json` and expects ten entries: search with `grep -rn "DISTRIBUTION.json" --exclude-dir=node_modules .`.
- `pack.mjs:152,155`: the README text says "external pinned npm dependencies must be available from cache or a separately authorized registry connection". It stays true.

### 6.2 `tools/cli-distribution/test/pack.test.mjs`

- Line 10 (the import): add `flatDependencies`.
- Add the new tests of section 10.
- Line 54 (the existing offline install proof): see section 7, edge case 8.

### 6.3 Landing test and docs

- `apps/landing/test/social-preview.test.mjs:14`: replace the line (section 3.2 and section 10.3).
- `apps/docs/src/content/docs/releases.md`: new heading `## 0.7.0-beta.3`. Another spec may add it first. Add the lines below the heading and keep every other spec's lines.
- `tools/cli-distribution/README.md:18`: change the sentence about the shrinkwrap. It now reads: `The packed package.json pins every top-level dependency of the reachable runtime closure to an exact version, because npm ignores a packed shrinkwrap when it installs from a tarball. An npm-shrinkwrap.json with the same versions is also packed, for installs from the registry.`

### 6.4 Fallback: bundle the owners of nested entries

Take this step only if the install proof (section 10.2) shows drift in a nested entry. The owners of the six nested entries are `@langchain/langgraph-sdk`, `body-parser`, `negotiator`, and `type-is`.

1. Add `bundleDependencies` to the manifest with those four names.
2. The stage directory needs a `node_modules` folder with exact copies of the four packages and their production dependencies, taken from the repository's `node_modules` and checked against the lock integrity values. Today `regular()` (`pack.mjs:16-24`) refuses links and files over 1 MiB, and the stage holds no `node_modules`. The bundling code needs its own reader with the same refusals for links and for any file whose package integrity differs from the lock.
3. The `npm pack` inventory check (`pack.mjs:184-185`) compares the tarball files with an explicit list. Add the bundled files to the list.
4. The tarball grows. Record the new size in the pull request.
5. The proof in section 10.2 must pass with all 148 entries, nested ones included.

This fallback is a design sketch and has not been run. If the bundled copies cannot be made to match the lock, stop and report to Hanna.

## 7. Edge cases

1. The lock has an optional top-level entry (`pg-cloudflare`). Result: it is not a pin. The proof test accepts its absence and, if present, checks its version.
2. A top-level entry is an npm alias (its `name` differs from the path). Result: pack throws `Unpinnable dependency`.
3. A direct dependency and a pin have the same name. Result: one entry, with the direct version, which equals the lock version.
4. The lock changes a version. Result: the next pack uses the new version, and the tarball hash changes. This is correct.
5. A user already has `express` 5.3.0 in their own project and runs a local tarball install in it. Result: npm reports a conflict or uses its own placement rules. This spec does not change what npm does with a project that has its own dependencies. The proof test uses a fresh prefix.
6. A global tarball install. Result: the dependencies sit under `<prefix>/lib/node_modules/bowerloom/node_modules/`. The proof test checks both local and global installs.
7. A registry install. Result: unchanged. Section 12 explains why this is not tested here.
8. The existing offline install test at `pack.test.mjs:54-129` runs with `npm_config_offline` and a cache. The set of packages it needs is the same as before, because the closure is the same. If the test fails offline after this change, run it online with the same assertions. Do not delete it.
9. `peer` entries (`express`, `@langchain/core`, `zod`, `react`, `hono`, and others) are top-level entries and are now pins. This covers the four packages in the problem table.
10. A pin changes the installed tree for a user who also installs one of these packages in the same project at a different version. npm places the second copy nested. This is the normal npm rule.

## 8. Migration

No project data changes. Users on 0.7.0-beta.2 who install the beta.3 tarball get the pinned tree. Users of the registry install get the same versions as before.

## 9. Docs changes

- `apps/docs/src/content/docs/releases.md`, under `## 0.7.0-beta.3`:
  - `Installing from a downloaded .tgz file now uses the same dependency versions as installing from the npm registry. Before, npm picked newer versions of some dependencies.`
  - `The social preview text is now the tagline: Set up the skills, prompts, and teams your agents use, and approve every change.`
- `tools/cli-distribution/README.md:18`: as in section 6.3.
- No other docs page changes.

## 10. Acceptance tests

Write the tests first. The files are inside the existing globs (`tools/cli-distribution/test/*.test.mjs` is in `package.json` line 30, and the landing tests run with `node tools/run-node-tests.mjs apps/landing/test/*.test.mjs`).

### 10.1 `tools/cli-distribution/test/pack.test.mjs` (always run)

1. `flatDependencies` returns every top-level non-optional entry and skips nested ones. Use a synthetic map with a top-level scoped package, a nested entry, and an entry with `"optional": true`.
2. `flatDependencies` throws `Unpinnable dependency` for an alias entry (`name` differs from the path).
3. `flatDependencies` throws `Unpinnable dependency` for an entry with `link: true`.
4. `flatDependencies` throws `Unpinnable dependency` for a version such as `^1.0.0` or `1.0`.
5. `flatDependencies` lets a direct dependency win and returns names in sorted order.
6. On the real repository, `collect({repoDir})` gives a manifest where every `dependencies[name]` equals `lock.packages['node_modules/' + name].version`.
7. On the real repository, the manifest `dependencies` holds `@langchain/core` 1.2.14, `@langchain/langgraph-checkpoint` 1.1.5, `@langchain/langgraph-sdk` 1.12.0, and `express` 5.2.1.
8. On the real repository, the shrinkwrap root `dependencies` equals the manifest `dependencies`.
9. On the real repository, no manifest dependency has an optional lock entry. `pg-cloudflare` is not a dependency.
10. The existing tests at lines 20-31, 50-53, and 163-169 still pass without edits.
11. `collect` is still deterministic: two calls give equal results (the existing test at line 20 covers this).
12. The pack inventory test (line 54) still compares the tarball file list with the explicit list.

### 10.2 `tools/cli-distribution/test/pack.test.mjs` (proof tests, `BOWERLOOM_PACK_INSTALL_PROOF=1`)

These tests need the network. They set `skip: process.env.BOWERLOOM_PACK_INSTALL_PROOF !== '1'`, as line 54 does, with a timeout of 600000 ms.

Common setup for both:

1. Pack the repository with `pack({repoDir, stageDir, outputDir})`.
2. Read `npm-shrinkwrap.json` from the packed files (`collect().files.get('npm-shrinkwrap.json')`).
3. Create a fresh temporary prefix and a fresh npm cache folder inside it.
4. Run npm with these arguments and this environment. Do not set `npm_config_offline`. Set `npm_config_userconfig` to `/dev/null`, `npm_config_globalconfig` to an empty file, `npm_config_cache` to the fresh cache folder, `npm_config_ignore_scripts` to `true`, and pass `PATH`, `HOME`, and `TMPDIR`. The existing test shows the pattern at line 56.

The tests:

1. **Local install.** Run `npm install --prefix <prefix> --ignore-scripts --no-audit --no-fund --no-save <tarball>`. For every shrinkwrap path `P` other than the root, read `<prefix>/<P>/package.json`. If the file exists, assert its `version` equals the shrinkwrap `version`. If it does not exist, assert the entry is optional (`"optional": true`). Collect all differences and report them together in one assertion message.
2. **Global install.** Run `npm install --global --prefix <prefix2> --ignore-scripts --no-audit --no-fund <tarball>`. For every shrinkwrap path `P` other than the root, read `<prefix2>/lib/node_modules/bowerloom/<P>/package.json`. Apply the same assertions.
3. **The four reported packages.** After the local install, assert `express` is 5.2.1, `@langchain/core` is 1.2.14, `@langchain/langgraph-checkpoint` is 1.1.5, and `@langchain/langgraph-sdk` is 1.12.0.
4. **The installed CLI starts.** After the local install, run `<prefix>/node_modules/.bin/bowerloom --version`. Assert exit code 0.

Run the proof tests against the current `pack.mjs` first. Test 3 must fail with the four differences of section 2.1. That confirms the problem. Then make the change. If tests 1 to 3 pass for all top-level entries but fail only for the six nested entries, apply section 6.4. If they fail for a top-level entry, stop and report to Hanna, because the reading of the npm source in section 2.1 is wrong.

### 10.3 `apps/landing/test/social-preview.test.mjs`

1. Add a constant near the imports:

   `const TAGLINE = 'Set up the skills, prompts, and teams your agents use, and approve every change.'`

2. Line 14 becomes `assert.equal(social.description, TAGLINE);`.
3. Keep the import of `hero` (line 5), because line 13 uses `hero.H1`.
4. Add a second test in the same file: the description of `apps/docs/src/content/docs/index.md` (read the file, take the `description:` value from the frontmatter, and remove the quotes) equals `TAGLINE`.
5. The other tests in the file (lines 22 onward) still pass without edits. They use `social.description` and do not use the hero body.
6. `node tools/run-node-tests.mjs apps/landing/test/*.test.mjs` passes.

## 11. Build order

1. Write the tests of section 10 and see them fail. Run the proof tests (10.2) against the current code and keep the output.
2. Change `apps/landing/test/social-preview.test.mjs` (Track C). This is independent of the rest.
3. Add `flatDependencies` and its unit tests (10.1 tests 1 to 5).
4. Change `collect` and the shrinkwrap root (10.1 tests 6 to 9).
5. Run the proof tests (10.2). Decide on section 6.4 from the result.
6. Update `tools/cli-distribution/README.md` and `releases.md`.
7. Run the gates: `npm run typecheck`, `npm test`, `node tools/run-node-tests.mjs apps/landing/test/*.test.mjs`, and `npm test` in `apps/docs`. Then run the proof tests once more with `BOWERLOOM_PACK_INSTALL_PROOF=1`.
8. Open the pull request into `release/0.7.0-beta.3`. Put the proof test output in the body.

## 12. Unverified items

1. **A tarball install ignores the packed shrinkwrap.** I read this from the npm source (section 2.1). I did not run an install, because this specification task writes no packages. The proof tests of section 10.2 settle it. Fallback if a top-level entry still drifts after the change: stop, and report the exact differences to Hanna. Do not guess a new mechanism.
2. **Nested entries may still drift.** Pinning top-level entries cannot pin the six nested ones, because a root `dependencies` entry names a top-level package only. Check with the proof tests. Fallback: section 6.4.
3. **`bundleDependencies` in section 6.4 may bundle a whole dependency tree, not only the named package.** I did not read npm's pack code for this. Check with a small trial before relying on the sketch. Fallback: ask Hanna whether to accept the nested drift for the three `content-type` copies and the three `langgraph-sdk` helpers, and record it in the release notes.
4. **A registry install keeps the pins.** The source shows that registry data sets `_hasShrinkwrap`. I did not test a registry install, because it needs a published package. The pack tests cannot test it. Check after the first `beta` publication by installing `bowerloom@beta` into a fresh prefix and comparing versions as in 10.2 test 1. This is a release step for Hanna, because the builder never publishes.
5. **The existing offline install test.** It may need the network after this change if the cache lacks a package. Check by running it. Fallback: section 7, edge case 8.
6. **Whether anything reads the ten-entry `DISTRIBUTION.json` dependency list.** Check by the search in section 6.1. Fallback: update the reader to accept the longer list.
7. **The record field `unverified` in `DISTRIBUTION.json` (`pack.mjs:158`) lists `global installation`.** The global proof test (10.2 test 2) covers it. Leave the list as it is until Hanna accepts the proof run. Do not remove the entry in this pull request.

## 13. New decision for Hanna

None.
