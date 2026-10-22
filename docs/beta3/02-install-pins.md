# Spec 02: install pins, the bundled runtime, and the social preview test

## 1. Header

- Source: found in the 0.7.0-beta.2 install proof. It is Track B and Track C of the beta.3 plan. There is no GitHub issue yet. The builder opens one and links it in the pull request.
- Decisions:
  - Hanna's decision 5 is in https://github.com/sageadvicellc/bowerloom/issues/84#issuecomment-6332928335. It chose pins first and bundling only if nested packages still drift.
  - Hanna's decision 7 is in https://github.com/sageadvicellc/bowerloom/issues/84#issuecomment-6333675636. It replaces the "only if" part of decision 5. The tarball bundles the whole runtime closure. Section 6.4 carries it out.
  - The owner's decision on the social preview text came with the beta.3 task brief. Section 2.2 repeats it so this spec stands alone.
- Lane: 2. This is the first spec of lane 2. Specs 03, 04, 06, 07, 08, and 09 follow it.
- Branch: `beta3/02-install-pins`, from `release/0.7.0-beta.3`.
- Dependencies: none.

Terms used below:

- A **shrinkwrap** is the file `npm-shrinkwrap.json`. It is a lockfile that a package can publish.
- A **pin** is an exact version in `dependencies`, such as `"express": "5.2.1"`, with no range.
- A **top-level entry** is a lockfile path of the form `node_modules/<name>` or `node_modules/@scope/<name>`. A **nested entry** has a second `node_modules/` in the path.
- A **bundled dependency** is a package that `npm pack` copies into the tarball under `node_modules`. The package.json key `bundleDependencies` names them.
- A **registry install** is `npm install bowerloom@beta`. A **tarball install** is `npm install <file>.tgz`, local or global.
- **The npm cache** is the folder `_cacache` that npm fills when it downloads packages. It stores each package tarball under its integrity hash.
- A **proof test** is a test that runs only when an environment variable gates it. `BOWERLOOM_PACK_INSTALL_PROOF=1` gates the offline proofs. `BOWERLOOM_PACK_ONLINE_PROOF=1` gates the new online proofs.

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

- `node_modules/@npmcli/arborist/lib/arborist/build-ideal-tree.js:787-796`: a node whose `hasShrinkwrap` is true skips dependency resolution.
- `node_modules/@npmcli/arborist/lib/node.js:174`: `hasShrinkwrap` comes from `package._hasShrinkwrap`.
- The string `_hasShrinkwrap` appears in npm's source only in `arborist/lib/node.js` and `arborist/lib/shrinkwrap.js`. It does not appear in `pacote`, the package that reads tarballs. Registry package data carries the flag. A tarball does not.
- The npm manual page `docs/content/configuring-npm/npm-shrinkwrap-json.md` says only that a shrinkwrap may be published.

So a tarball install ignores the whole packed shrinkwrap. It resolves every dependency from the ranges in the packed `package.json`. That also explains why `@langchain/langgraph-sdk`, which is not a peer dependency, moved. This reading comes from source, not from a run. The proof tests in section 10.2 settle it.

The packed `package.json` today lists 10 direct dependencies (`tools/cli-distribution/pack.mjs:143,148`): `@dbos-inc/dbos-sdk`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres`, `@modelcontextprotocol/sdk`, `ajv`, `jose`, `langsmith`, `pg`, `tar`, and `yaml`. The shrinkwrap holds 148 entries. 142 are top-level and 6 are nested. The six nested entries are:

- `node_modules/@langchain/langgraph-sdk/node_modules/eventemitter3`
- `node_modules/@langchain/langgraph-sdk/node_modules/p-queue`
- `node_modules/@langchain/langgraph-sdk/node_modules/p-timeout`
- `node_modules/body-parser/node_modules/content-type`
- `node_modules/negotiator/node_modules/content-type`
- `node_modules/type-is/node_modules/content-type`

One top-level entry is optional: `node_modules/pg-cloudflare` has `"optional": true` and version 1.4.1 (`package-lock.json:2596,2607-2612`). It has no `os` or `cpu` field.

Three optional peer packages are in the closure: `react` 19.3.0, `react-dom` 19.3.0 (`package-lock.json:2828-2845`), and `scheduler` 0.28.0 (`package-lock.json:2931`). They enter through the optional peers of `@langchain/langgraph-sdk`. The closure walk keeps an optional peer when the lock holds it (`tools/cli-distribution/pack.mjs:65-68`).

### 2.2 Why pins alone are not enough

Pins cannot reach the six nested entries. A root `dependencies` entry names a top-level package only. A pin also fails for a package that depends on an unpinned nested copy. npm skips resolving only the edges that a package lists in its own `bundleDependencies` (`node_modules/@npmcli/arborist/lib/arborist/build-ideal-tree.js:1137-1146`). A partial bundle of the nested owners would leave packages such as `express` and `@langchain/langgraph`, which depend on those owners, to resolve them from ranges and hoist them to the install prefix. Decision 7 therefore bundles the whole runtime closure.

### 2.3 Track C: the social preview test checks the wrong text

`apps/landing/test/social-preview.test.mjs:14` requires `release/social-preview.json` `description` to equal the first sentence of the landing hero body. The owner decided that the preview keeps this text:

`Set up the skills, prompts, and teams your agents use, and approve every change.`

The same sentence is the tagline in `apps/docs/src/content/docs/index.md:3`. The hero body (`apps/landing/src/content.ts:15`) starts with a different sentence. The test therefore fails or forces a change to the approved record.

## 3. Behavior

### 3.1 Track B

After this spec, every install path gets the tested versions:

1. The packed `package.json` pins every top-level lock entry. Required entries go in `dependencies`. The optional entry `pg-cloudflare` goes in `optionalDependencies`.
2. The packed `package.json` sets `bundleDependencies` to every name in `dependencies` and `optionalDependencies`, sorted.
3. The tarball holds the runtime closure under `node_modules`, laid out exactly as the lock paths, including the six nested paths.
4. The packed `npm-shrinkwrap.json` root entry lists the same `dependencies` and `optionalDependencies`.
5. A tarball install, local or global, finds every package already inside the tarball. It fetches none, and it needs no npm cache.
6. A registry install keeps working. It reads the same bundled tarball.

The pack command changes in these ways:

- New optional argument: `--npm-cache ABS`. It names the npm cache folder (the `_cacache` folder). The default is `<npm_config_cache or ~/.npm>/_cacache`, where `npm_config_cache` is the environment variable of that name.
- The command always bundles. It needs every lock entry in the npm cache.
- The printed result (`tools/cli-distribution/pack.mjs:195`) gains a `bundle` object with `packages`, `files`, and `bytes` (section 4.5).
- The exit code, the new-destination rule, the write order, and `npm pack --ignore-scripts --offline` stay.
- Nothing is installed by the pack command.

A pack failure throws an error, and Node exits with a nonzero code, as today (`tools/cli-distribution/pack.mjs:15`). The messages are in section 5.

Write order inside `stage`:

1. `collect` returns the in-memory files. It reads no cache.
2. `newDestination` checks the new folder and the disk guard (`pack.mjs:162-167`).
3. The stage folder is created and the first-party files are written, as today.
4. The bundle is extracted into `<stage>/node_modules` (section 6.4).
5. `DISTRIBUTION.json` is rewritten with the extracted counts.
6. `pack` runs `npm pack`, then checks the tarball contents (section 6.4).

If a step fails, `stage` removes only its own new stage folder, as it does now (`pack.mjs:172`).

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
dependencies: <direct dependencies plus every required top-level pin of section 4.3, sorted by name>
optionalDependencies: { "pg-cloudflare": "1.4.1" }
bundleDependencies: <every name of dependencies and optionalDependencies, sorted by name>
```

Sorting uses `a.localeCompare(b)`, as the code does today. Every value is the `version` field of the lock entry, with no range prefix. With the current lock, `dependencies` has 141 entries (the 10 direct ones are among them), `optionalDependencies` has 1, and `bundleDependencies` has 142. The other keys of the manifest are unchanged.

### 4.2 The packed `npm-shrinkwrap.json`

The shape does not change (`tools/cli-distribution/pack.mjs:70`). The root entry (`packages[""]`) now uses the full `dependencies` map of section 4.1, and it gains `optionalDependencies` when that map is not empty. The other entries are the reachable entries with `dev`, `devOptional`, and `workspaces` removed, as today (`pack.mjs:64`). The `peer: true` and `optional: true` flags stay.

### 4.3 Which entries become pins

The function is `flatDependencies(packages, direct)`. It takes the `packages` map of the finished shrinkwrap and the direct dependency map. It returns `{ dependencies, optionalDependencies }`, each a map from name to version.

First, for each name in `direct`:

1. Look up `packages['node_modules/' + name]`.
2. If it is missing, or its `version` differs from `direct[name]`, throw `Pinned dependency differs from the lock: <name>`.

(In the real flow `lockedDependencies` throws `Direct dependency lock mismatch` first, at `pack.mjs:56`. The new throw is reachable when a caller uses `flatDependencies` alone, and it keeps section 5 true.)

Then, for each path in `packages`, in sorted order:

1. Skip the root path `""`.
2. Skip the path if it is a nested entry (`node_modules/` appears more than once).
3. Take `name` as the part after `node_modules/`.
4. If the entry has a `name` field that differs from this name, or a `link` field, throw `Unpinnable dependency: <path>`.
5. If `version` is not a string that matches `^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$`, throw `Unpinnable dependency: <path>`. This is the same expression as the first-party check at `pack.mjs:125`.
6. If the entry has `"optional": true`, add `name: version` to `optionalDependencies`. Otherwise add it to `dependencies`.

### 4.4 Bundle layout

For each non-root path `P` in the shrinkwrap, the stage folder gets the files of the package at `<stage>/<P>/`. Paths follow the lock exactly. The six nested paths of section 2.1 get their own folders.

The extraction rules:

- Source: the npm cache file for the entry's `integrity` value (section 6.4 step 2).
- Each tarball entry path starts with `package/`. The extractor strips that prefix.
- Only regular files and folders are written. A link, a hard link, a device, a path with `..`, or an absolute path throws `Bundle tarball unsafe: <path>`.
- At most 8192 entries per package and 1 GiB for the whole bundle (compare `NPM_TAR_BOUND`, which allows 8192 entries). More throws `Bundle tarball unsafe: <path>` or `Bundle exceeds 1 GiB`.
- After extraction, each file mode is normalized: `0o755` if any execute bit is set, else `0o644`. Each folder is `0o755`. This makes the result independent of the user's umask.

### 4.5 `DISTRIBUTION.json` additions

`collect` adds the field `bundle` to the record (`tools/cli-distribution/pack.mjs:158`):

```
bundle: {
  packageCount: <number of non-root lock entries>,
  entries: [ { path, version, integrity } ... sorted by path ],
  extractedFiles: <number>,
  extractedBytes: <number>
}
```

`collect` knows `packageCount` and `entries` from the lock. `stage` fills `extractedFiles` and `extractedBytes` after extraction and rewrites the record file. `extractedFiles` and `extractedBytes` count the extracted files, which is an upper bound for the files that `npm pack` includes (a bundled package's own `files` list and ignore rules can drop some).

`DISTRIBUTION.json` is inside the tarball. It cannot hold the size of its own tarball. The tarball size, unpacked size, and file count stay in the printed result of the pack command (`pack.mjs:186`), and the pull request body records them.

Do not add the bundled files to `record.files`. The container proof guard compares the installed package folder with `record.files`, and its walk skips every folder named `node_modules` (`tools/cli-distribution/installed-container-guard.mjs:19-21`). A bundled file in `record.files` would make that guard fail.

## 5. Failure messages

The first rows are errors thrown by `pack.mjs`. They are not CLI refusal codes and need no `human.ts` entry. The last row is a test assertion message, not a thrown error of the tool.

| Message | Cause | Next step |
|---|---|---|
| `Unpinnable dependency: <path>` | A top-level entry is an alias, a link, or has a version that is not exact. | Fix the lock entry, then pack again. |
| `Pinned dependency differs from the lock: <name>` | A direct dependency differs from the version of its lock entry, or has no entry. | Run `npm install` in the repository to refresh the lock, then pack again. |
| `Bundle cache entry missing: <path>` | The npm cache has no content for the entry's integrity value. | Run `npm ci` in the repository to fill the npm cache, then pack again. |
| `Bundle integrity mismatch: <path>` | The cache content for an entry does not hash to the lock integrity value. | Run `npm cache verify`, then `npm ci`, then pack again. |
| `Bundle tarball unsafe: <path>` | A bundled tarball holds a link, a path that escapes, or more than 8192 entries. | Report the package to Hanna. Do not pack. |
| `Bundle exceeds 1 GiB` | The extracted bundle is larger than 1 GiB. | Report the size to Hanna. |
| `Bundle packed files differ from the staged bundle` | The tarball holds a bundled file that the stage does not, or lacks the `package.json` of a lock entry. | Report to Hanna. Keep the stage folder for diagnosis. |
| `Installed packages differ from the shrinkwrap: <list>` | Proof tests only. The message lists every `name@version` difference. | Read the list, then see section 12. |

## 6. Where to change

All paths are checked against the beta.3 tree. The line numbers are the same as in beta.2.

### 6.1 `tools/cli-distribution/pack.mjs`

- `pack.mjs:3`: add `readdirSync`, `chmodSync`, and `statSync` to the `node:fs` import, and import `UnpackSync` from `tar` (a direct dependency of the repository, version 7.5.20).
- `pack.mjs:41-71`: `lockedDependencies(lock, dependencies, manifest)` keeps its signature and output. Existing tests call it with this signature (`tools/cli-distribution/test/pack.test.mjs:50-53,163-169`).
- After `lockedDependencies`, add `export function flatDependencies(packages, direct)` (section 4.3).
- `pack.mjs:93`: `collect({ repoDir, name, releaseCandidate, bundle })` takes `bundle` (boolean, default false). The pure function `collect` never reads the cache.
- `pack.mjs:148`: build the manifest in two steps.
  1. Compute `shrink = lockedDependencies(lock, dependencies, <identity fields>)`.
  2. Compute `flat = flatDependencies(shrink.packages, dependencies)`. Set `dependencies` and `optionalDependencies` from `flat`. When `bundle` is true, set `bundleDependencies` (section 4.1). When `bundle` is false, the manifest has the pins and no `bundleDependencies`.
- `pack.mjs:150`: write the shrinkwrap with the final manifest, so the root entry holds the full maps.
- `pack.mjs:158`: add `bundle` to the record (section 4.5) when `bundle` is true. `record.dependencies` already holds `manifest.dependencies`.
- `pack.mjs:152`: the README text says "external pinned npm dependencies must be available from cache or a separately authorized registry connection". When `bundle` is true, this sentence becomes: `The runtime dependencies ship inside the tarball.` The line at `pack.mjs:155` has no such sentence and does not change.
- `pack.mjs:162-167`: export the disk check as `requireFreeSpace(parent)` so the online proof tests call it before they install. `newDestination` keeps calling it. The 12.05 GiB guard stays, because it already exceeds the bundle size. The bundle adds the limit of 1 GiB (section 4.4).
- `pack.mjs:168`: `stage(options)` takes `options.bundle` (boolean) and `options.npmCache` (absolute path). After the first-party files are written (line 171), call `extractBundle(...)` (section 6.4), then rewrite `DISTRIBUTION.json`.
- `pack.mjs:175-187`: `pack(options)` passes the options on and extends the inventory check (section 6.4 step 6).
- `pack.mjs:188-196`: the command line accepts `--npm-cache ABS`. The allowed list at line 192 gains it, and the usage message names it: `Use --repo ABS --stage NEW_ABS --output NEW_ABS [--name IDENTITY] [--npm-cache ABS]`. The command line always sets `bundle: true`.

### 6.2 `tools/cli-distribution/test/pack.test.mjs`

- Line 10 (the import): add `flatDependencies` and `requireFreeSpace`.
- Add the new tests of section 10.
- Lines 54-115 (the existing offline install proof): see section 6.5.

### 6.3 Landing test and docs

- `apps/landing/test/social-preview.test.mjs:14`: replace the line (section 10.3).
- `apps/docs/src/content/docs/releases.md`: new heading `## 0.7.0-beta.3`. Another spec may add it first. Add the lines of section 9 below the heading and keep every other spec's lines.
- `tools/cli-distribution/README.md`: the replacement sentences are in section 9.

### 6.4 The bundle (decision 7)

New function `extractBundle({ stageDir, packages, npmCache })` in `pack.mjs`. It is synchronous, because `stage` and `pack` are synchronous and many tests call them that way.

The method, verified on this machine:

1. For each non-root lock path `P`, in sorted order, take `integrity` (`sha512-<base64>`).
2. Convert the base64 digest to hex. The cache file is `<npmCache>/content-v2/sha512/<hex 0-1>/<hex 2-3>/<hex 4-end>`. I checked this layout against `cacache/lib/content/path.js` in npm 11.6.1 and against the real cache: a read of the entry for `node_modules/body-parser/node_modules/content-type` gave bytes whose sha512 equals the lock value. I also read all 148 lock entries from `~/.npm/_cacache` on this machine, and none was missing.
3. If the file is missing, throw `Bundle cache entry missing: <P>`. Read it with `readFileSync`. Hash it with `node:crypto` sha512. If it differs from the lock value, throw `Bundle integrity mismatch: <P>`. The lock `integrity` value is the hash of the package tarball (`pack.mjs:61` requires it), not of installed files. So this check proves the tarball, and extraction is the only step that turns it into files.
4. Extract with `new UnpackSync({ cwd: <stage>/<P>, strip: 1, preserveOwner: false, filter })`, then `unpack.end(bytes)`. The filter refuses links and any path escape. I ran `UnpackSync` with these options on the real `content-type` tarball and it wrote the expected files with mode 0644. The `tar` module is already a direct dependency of the repository.
5. Normalize modes (section 4.4). Count files and bytes. Add each written path, prefixed with `node_modules/`, to the set `bundleFiles`.
6. After `npm pack`, the existing inventory check (`pack.mjs:184-185`) compares `info.files` with the explicit list. `info.files` also lists bundled files (`npm/lib/utils/tar.js:48-106` builds `files` from every tarball entry, and `bundled` from the names under `node_modules`). So split `info.files` in two:
   - Own files (paths that do not start with `node_modules/`) must equal the explicit list, as today.
   - Bundled files must each be in `bundleFiles`. The tarball must hold `<P>/package.json` for every lock path. `info.bundled` sorted must equal the sorted names of `bundleDependencies`. Any difference throws `Bundle packed files differ from the staged bundle`.

How peers are still included. `npm-packlist` bundles the names in the root `bundleDependencies`. For each of them it also bundles that package's production and optional dependencies, and it skips edges that are peer edges (`node_modules/npm-packlist/lib/index.js:365-391`). Peers such as `express`, `zod`, `react`, and `@langchain/core` would be skipped through a package that only peers on them. They are still included because they are pinned as root `dependencies` and listed in the root `bundleDependencies`. The root edge to them is a normal dependency edge, not a peer edge.

Why the layout works. The tarball installs as `<prefix>/node_modules/bowerloom`. The bundled packages sit under `<prefix>/node_modules/bowerloom/node_modules` with the same relative paths as the lock. Nothing hoists to the prefix, so the peer and nested edges inside the bundle resolve inside the bundle.

Byte determinism. Repeated packing of the same input must give the same tarball bytes. Keep it this way:

- `npm pack` sets every entry time to 1985-10-26T08:15:00Z and gzip level 9 (`node_modules/pacote/lib/util/tar-create-options.js`). Extraction times therefore do not matter.
- `npm-packlist` sorts entries with a fixed comparator (`npm-packlist/lib/index.js:247-259`).
- Extraction follows sorted lock paths, and modes are normalized (section 4.4). So the umask of the user does not matter.
- The extraction input is fixed by the lock integrity values. A different cache gives either the same bytes or a failure.
- The existing test (line 54) packs twice and compares hashes. It keeps doing that with the bundle.

Disk guard. `newDestination` already requires 12.05 GiB free for the stage parent and for the output (`pack.mjs:166`). The README reserve for the proof is 0.6 GiB (`tools/cli-distribution/README.md:9`). The bundle adds its unpacked size to the stage and to each install in the proofs. I did not measure the size. The builder measures `extractedBytes`, writes it in the pull request, and raises the README reserve to at least four times that figure plus the old 0.6 GiB. The extraction stops at 1 GiB.

Fallback if the cache layout is not available. If `content-v2` is missing, or an npm version changes the layout, step 2 throws `Bundle cache entry missing`. The fallback then is to fill `<stage>/node_modules` with `npm ci --offline --ignore-scripts --omit=dev --prefix <stage>` against the staged `package.json` and `npm-shrinkwrap.json`, which lays packages out as the lock says and checks integrity. Then remove `node_modules/.package-lock.json` and `node_modules/.bin` from the stage. I did not run this fallback.

### 6.5 Other consumers of the packed manifest and install

- `tools/cli-distribution/installed-container-guard.mjs:46-57` reads the installed `package.json` and checks that every manifest dependency resolves to an installed package of the exact version, inside the prefix. It also requires `manifest.dependencies.pg` to equal `8.16.3`. With the bundle, the first resolution candidate is `<bowerloom>/node_modules/<name>`, which is inside the prefix, so the check should pass. Its walk of the installed tree (`dependencyTree`, lines 22-24) refuses a symlink or a file with more than one link. The extractor writes neither.
- `tools/cli-distribution/prepare-installed-container.mjs:25,31` runs a second offline tarball install, with `npm_config_offline=true` (line 25), into the proof folder. With the bundle it needs no cache.
- Run `node --test tools/cli-distribution/test/installed-container.test.mjs` before and after the change. Record both results in the pull request. If it fails on a missing cache entry, stop and report the entry. Do not run it online.
- The existing offline install proof (`pack.test.mjs:54-115`, gated by `BOWERLOOM_PACK_INSTALL_PROOF=1`) keeps `npm_config_offline`. Change it to call `pack` with `bundle: true` and `npmCache`. If it fails after this change, stop and report the missing cache entries. Never run it online.

## 7. Edge cases

1. The lock has an optional top-level entry (`pg-cloudflare`). Result: it is an exact pin in `optionalDependencies` and in the shrinkwrap root entry, and it is bundled. Platform checks do not stop a bundled copy, which is acceptable because `pg-cloudflare` has no `os` or `cpu` field.
2. A top-level entry is an npm alias (its `name` differs from the path). Result: pack throws `Unpinnable dependency`.
3. A direct dependency and a pin have the same name. Result: one entry, with the direct version, which equals the lock version.
4. The lock changes a version. Result: the next pack uses the new version, and the tarball hash changes. This is correct. The bundle test literals (section 10.1, test 7) change with any lock refresh that moves them.
5. A user installs the tarball into a project that has its own `express` at another version. Result: the bundled `express` stays inside `bowerloom/node_modules`. npm does not hoist it. The user's copy is separate.
6. A global tarball install. Result: the packages sit under `<prefix>/lib/node_modules/bowerloom/node_modules/`. The online proof tests both.
7. A registry install. Result: unchanged in effect. Section 12 explains why this is not tested here.
8. `npm update -g bowerloom` resolves from the registry `latest` tag (`node_modules/@npmcli/arborist/lib/arborist/build-ideal-tree.js:446-465`). The pins and the bundle do not change this.
9. Optional peers `react` 19.3.0, `react-dom` 19.3.0, and `scheduler` 0.28.0 are in the lock, because the closure walk keeps optional peers that the lock holds (`pack.mjs:65-68`). Result: they are pins in `dependencies` and are bundled. Test 7 asserts `react` 19.3.0.
10. A cache entry is missing. Result: `Bundle cache entry missing: <path>`, and nothing is packed. The stage folder is removed.
11. A cache entry is corrupt. Result: `Bundle integrity mismatch: <path>`.
12. The output of `npm pack` lacks a lock entry. Result: `Bundle packed files differ from the staged bundle`.
13. A new nested lock path appears after a lock refresh. Result: test 13 of section 10.1 fails, and the builder reviews the new path before the test list changes.
14. A package that is bundled has an install script. Result: the lock check refuses it earlier (`pack.mjs:63`).

## 8. Migration

No project data changes. Users on 0.7.0-beta.2 who install the beta.3 tarball get the bundled tree. Users of the registry install get the same versions as before. The tarball is larger. The builder records its size in the pull request.

## 9. Docs changes

First run this command in the repository:

```
git log --oneline release/0.7.0-beta.2..HEAD -- release/social-preview.json
```

The tag `v0.7.0-beta.2` does not exist in this clone (the tags end at `v0.7.0-beta.1`), so I ran it with the branch name, and it printed nothing. The builder reruns the exact command. If it prints nothing, add no release line for Track C. If it prints a commit, add a line that states the preview text.

`apps/docs/src/content/docs/releases.md`, under `## 0.7.0-beta.3`:

- `Installing from a downloaded .tgz file now gives the same dependency versions as the tested build. The file carries its dependencies, so it installs with no network and no npm cache.`

`tools/cli-distribution/README.md`, exact replacements:

- Line 9, append this sentence: `Packing also needs every locked package in the local npm cache. Run npm ci in the repository first. Pass --npm-cache ABS if the cache is not in the default place.` Raise the reserve figure as section 6.4 says.
- Line 18, replace the sentences from `` `DISTRIBUTION.json` inside the artifact `` to the end with: `` `DISTRIBUTION.json` inside the artifact inventories byte hashes, source hashes, dependency pins, the bundled packages with their integrity values, and proof limitations. The packed `package.json` pins every dependency of the reachable runtime closure to an exact version, because npm ignores a packed shrinkwrap when it installs from a tarball. The closure includes required peer dependencies, the optional peers that the lock holds, and the optional `pg-cloudflare`. Every package of the closure is listed in `bundleDependencies` and ships inside the tarball. An `npm-shrinkwrap.json` with the same versions is packed too. Entries must have npm registry URLs and integrity hashes. Source workspace links, nonregistry dependencies and unpinned direct dependencies are rejected. ``
- Line 24, add this line below the existing command: `BOWERLOOM_PACK_ONLINE_PROOF=1 node --test tools/cli-distribution/test/pack.test.mjs`. Add this sentence after the code block: `The online proof needs the network and writes to a temporary folder. Run the disk guard first.`
- Line 35, replace `or full node_modules tree is copied` with `or the repository node_modules tree is copied`, and replace the last sentence (`The tarball needs its normal npm dependencies installed; it is not an all-dependencies offline bundle.`) with: `The runtime dependencies of the reachable closure ship inside the tarball under node_modules through bundleDependencies, so the tarball installs offline with an empty npm cache. Development dependencies, browser binaries, and Docker images are not included.`
- Line 39, replace `global installation, ` with nothing in the list of things the offline proof does not show, and append: `The online proof (BOWERLOOM_PACK_ONLINE_PROOF=1) covers a local and a global tarball install on the machine that runs it.`
- Line 41, replace `Dependency integrity comes from the shrinkwrap, not a vendored dependency copy.` with: `Dependency integrity comes from the lock: each bundled package is read from the npm cache by its lock integrity value and checked against it before it is staged.` Replace `Repeated packing of the same input snapshot is byte-deterministic` with `Repeated packing of the same input snapshot and the same npm cache content is byte-deterministic`.

No other docs page changes.

## 10. Acceptance tests

Write the tests first. The files are inside the existing globs (`tools/cli-distribution/test/*.test.mjs` is in `package.json` line 30, and the landing tests run with `node tools/run-node-tests.mjs apps/landing/test/*.test.mjs`).

Helper file `tools/cli-distribution/test/bundle-fixture.mjs` (not a test file, so no glob change). It builds a small synthetic lock, writes tiny package tarballs with `tar.create`, and puts them in a temporary cache folder at the `content-v2` path of section 6.4. The unit tests use it, so they do not depend on the machine's npm cache.

### 10.1 `tools/cli-distribution/test/pack.test.mjs` (always run)

1. `flatDependencies` returns every top-level entry and skips nested ones. Use a synthetic map with a scoped package, a nested entry, and an entry with `"optional": true`. The optional one lands in `optionalDependencies`.
2. `flatDependencies` throws `Unpinnable dependency` for an alias entry (`name` differs from the path).
3. `flatDependencies` throws `Unpinnable dependency` for an entry with `link: true`.
4. `flatDependencies` throws `Unpinnable dependency` for versions `^1.0.0`, `1.0`, and `1.0.0+build`.
5. `flatDependencies` returns sorted names. It throws `Pinned dependency differs from the lock: <name>` when `direct[name]` differs from the lock version, and when the entry is missing.
6. On the real repository, `collect({ repoDir, bundle: true })` gives a manifest where every `dependencies[name]` and `optionalDependencies[name]` equals `lock.packages['node_modules/' + name].version`.
7. On the real repository, the manifest `dependencies` holds `@langchain/core` 1.2.14, `@langchain/langgraph-checkpoint` 1.1.5, `@langchain/langgraph-sdk` 1.12.0, `express` 5.2.1, and `react` 19.3.0. (Update these literals with any lock refresh that moves them.)
8. On the real repository, the shrinkwrap root `dependencies` equals the manifest `dependencies`, and the root `optionalDependencies` equals the manifest `optionalDependencies`.
9. On the real repository, `pg-cloudflare` is in `optionalDependencies` at 1.4.1 and not in `dependencies`.
10. On the real repository, `bundleDependencies` equals the sorted union of the names in `dependencies` and `optionalDependencies`, and has 142 names.
11. The existing tests at lines 20-32, 50-53, and 163-169 pass without edits. A call to `collect` without `bundle` gives a manifest without `bundleDependencies`.
12. `collect` is deterministic: two calls give equal results.
13. On the real repository, the nested paths of the shrinkwrap equal exactly the six paths of section 2.1. A new nested path fails the test.
14. `extractBundle` with the synthetic cache lays out a package at a top-level path and at a nested path, strips `package/`, and normalizes modes (an executable gets 0755, a plain file 0644).
15. `extractBundle` throws `Bundle cache entry missing` for an entry that the cache lacks, and the message names the path.
16. `extractBundle` throws `Bundle integrity mismatch` when the cache file's bytes do not hash to the lock value.
17. `extractBundle` throws `Bundle tarball unsafe` for a tarball with a symbolic link, a hard link, and a `../` path (one case each).
18. `stage` with `bundle: true` and the synthetic cache removes its stage folder when extraction fails.
19. `stage` and `pack` without `bundle` behave as before (the existing tests prove this).
20. `pack` with `bundle: true` and a synthetic closure: the tarball holds every `<P>/package.json`, `info.bundled` matches `bundleDependencies`, and two packs give the same hash.
21. `pack` throws `Bundle packed files differ from the staged bundle` when a test stub makes `npm pack` report an extra bundled file (use the same stub style as the existing tests).
22. `DISTRIBUTION.json` from a bundled stage holds `bundle.packageCount`, `entries`, `extractedFiles`, and `extractedBytes`, and `record.files` holds no `node_modules` path.

### 10.2 Proof tests

Run the proof tests against the current `pack.mjs` first and keep the output. Test 3 of the online group must fail then, with the differences of section 2.1. After the change, every shrinkwrap entry must match, nested ones included. The result must not depend on the day the test runs: the expected versions come from the packed shrinkwrap, not from a literal.

**Offline group** (`BOWERLOOM_PACK_INSTALL_PROOF=1`, as at line 54, `npm_config_offline` set). It needs the npm cache only to pack.

1. The existing test (lines 54-115) packs twice with `bundle: true` and `npmCache`, compares the hashes, installs offline, and runs the same CLI checks as today.
2. **Empty-cache install.** Install the first tarball with `npm_config_offline=true` and `npm_config_cache` set to a new empty folder. Assert exit code 0. If npm reports ENOTCACHED for a bundled package, the test fails, and section 12 item 2 applies.
3. After the install in test 2, run `<prefix>/node_modules/.bin/bowerloom --version`. Assert exit code 0.

**Online group** (`BOWERLOOM_PACK_ONLINE_PROOF=1`, timeout 600000 ms). These tests allow the network. Each test calls `requireFreeSpace` on its temporary folder first and skips with a message if the guard fails (`tools/cli-distribution/README.md:9`). The environment is: `npm_config_userconfig` set to `/dev/null`, `npm_config_globalconfig` set to an empty file, `npm_config_cache` set to a new folder, `npm_config_ignore_scripts` set to `true`, no `npm_config_offline`, and `PATH`, `HOME`, and `TMPDIR` passed (compare line 58).

1. **Local install.** `npm install --prefix <prefix> --ignore-scripts --no-audit --no-fund --no-save --loglevel=http <tarball>`. Read `<prefix>/node_modules/.package-lock.json`. Build the multiset of `name@version` for every entry under `node_modules/bowerloom/node_modules/`. Build the same multiset from the packed shrinkwrap (all entries except the root). Assert they are equal, and report every difference in one message (`Installed packages differ from the shrinkwrap: <list>`). Also walk `<prefix>/node_modules/bowerloom/node_modules` and read each `package.json` (nested `node_modules` included) to build a second multiset, and assert it equals the first. This covers a `.package-lock.json` that omits bundled entries. Neither multiset includes `bowerloom` itself.
2. **Global install.** `npm install --global --prefix <prefix2> ...`, with `.package-lock.json` at `<prefix2>/lib/node_modules/.package-lock.json`, and the same assertions with `<prefix2>/lib/node_modules/bowerloom/node_modules` as the walk root.
3. **The four reported packages.** After the local install, assert `express` 5.2.1, `@langchain/core` 1.2.14, `@langchain/langgraph-checkpoint` 1.1.5, and `@langchain/langgraph-sdk` 1.12.0 (read from the packed shrinkwrap, not hard-coded).
4. **No registry fetches.** Assert the combined npm output of test 1 holds no line that names `registry.npmjs.org`. This relies on the `--loglevel=http` output, which I did not verify (section 12 item 3).
5. **The installed CLI starts.** `<prefix>/node_modules/.bin/bowerloom --version` exits 0.

### 10.3 `apps/landing/test/social-preview.test.mjs`

1. Add a constant near the imports: `const TAGLINE = 'Set up the skills, prompts, and teams your agents use, and approve every change.'`
2. Line 14 becomes `assert.equal(social.description, TAGLINE);`.
3. Keep the import of `hero` (line 5), because line 13 uses `hero.H1`.
4. Add a second test in the same file:

   ```
   const index = await read('../../docs/src/content/docs/index.md');
   assert.equal(index.match(/^description:\s*"([^"]*)"\s*$/m)?.[1], TAGLINE);
   ```

5. Optional, in `tools/cli-distribution/test/pack.test.mjs`: assert that the release-candidate description (`pack.mjs:148`) ends with `TAGLINE`.
6. The other tests in the file (line 24 onward) still pass without edits. They use `social.description` and do not use the hero body.
7. `node tools/run-node-tests.mjs apps/landing/test/*.test.mjs` passes.

## 11. Build order

1. Write the tests of section 10 and see them fail. Run the offline and online proof tests against the current code and keep the output. Run `node --test tools/cli-distribution/test/installed-container.test.mjs` and record the result.
2. Change `apps/landing/test/social-preview.test.mjs` (Track C). This is independent of the rest.
3. Add `flatDependencies` and its unit tests (10.1 tests 1 to 5).
4. Change `collect`: pins, `optionalDependencies`, `bundleDependencies`, the shrinkwrap root, and the record (10.1 tests 6 to 13).
5. Add `extractBundle`, the stage and pack changes, and the command-line flag (10.1 tests 14 to 22).
6. Run the offline proofs, then the online proofs (10.2). Keep the output.
7. Run `installed-container.test.mjs` again and compare.
8. Update `tools/cli-distribution/README.md` and `releases.md` (section 9). Measure `extractedBytes` and the tarball size for the pull request.
9. Run the gates: `npm run typecheck`, `npm test`, `node tools/run-node-tests.mjs apps/landing/test/*.test.mjs`, and `npm test` in `apps/docs`.
10. Open the pull request into `release/0.7.0-beta.3`. Put the proof output, the tarball size, and the file count in the body.

## 12. Unverified items

1. **A tarball install ignores the packed shrinkwrap.** I read this from the npm source (section 2.1). I did not run an install. The online proofs settle it. After the change, a bundled tarball does not depend on this reading, because every package is inside it. Fallback: none needed if online test 1 passes. If a bundled tarball still fetches or drifts, stop and report the exact differences to Hanna.
2. **A bundled tarball installs offline with an empty cache.** I did not run it. npm may still ask for metadata of bundled packages. The source skips the edges that a package lists in its own `bundleDependencies` (`build-ideal-tree.js:1137-1146`), which points to no fetch, but that was read, not run. Offline test 2 settles it. Fallback if it fails: keep the bundle, drop offline test 2, and make online test 4 the only no-fetch assertion. Tell Hanna that the tarball needs the network for metadata.
3. **The `--loglevel=http` output.** I did not check what npm prints. If it does not name the registry host, replace online test 4 with a run through a local HTTP proxy that counts requests. Fallback: drop test 4 and rely on offline test 2.
4. **`npm-packlist` includes the bundle regardless of the `files` list.** I read the bundling code (`npm-packlist/lib/index.js:365-391`) but not the code that adds the result. The `info.bundled` check in section 6.4 step 6 settles it at pack time. Fallback: add `node_modules` to the `files` list of the packed manifest.
5. **`.package-lock.json` may omit bundled entries.** Online test 1 builds a second multiset from a directory walk for this reason. If the file omits them, the walk is the only source, and that is fine.
6. **Registry install of a bundled package with a shrinkwrap.** I did not test it, because it needs a published package. Check after the first `beta` publication by installing `bowerloom@beta` into a fresh prefix and comparing versions as in online test 1. This is a release step for Hanna, because the builder never publishes.
7. **The tarball size and `extractedBytes`.** Unmeasured. The 1 GiB cap and the README reserve (section 6.4) are placeholders until the builder measures them.
8. **Whether anything reads the ten-entry `DISTRIBUTION.json` dependency list.** Check with `grep -rn "DISTRIBUTION.json" --exclude-dir=node_modules .`. Fallback: update the reader to accept the longer list.
9. **The `unverified` list in `DISTRIBUTION.json` (`pack.mjs:158`) names `global installation`.** Online test 2 covers it. Leave the list as it is until Hanna accepts a recorded proof run. Do not edit it in this pull request.
10. **The container proof still passes.** `installed-container-guard.mjs:46-57` and `prepare-installed-container.mjs:25,31` were read, not run with a bundle. Section 6.5 and build step 7 settle it. Fallback: report the failing check to Hanna.
11. **The `npm ci` fallback of section 6.4** was not run.

## 13. New decision for Hanna

None open. Decision 7 settled the bundle.
