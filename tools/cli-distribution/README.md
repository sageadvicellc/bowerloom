# CLI distribution proof

This tool stages and packs the current Bowerloom CLI and MCP entrypoint as an installable npm tarball. It does not publish, authenticate to a registry, install software, rebuild the repository, or run a model. The package identity and version must match `release/beta.json`. Default proof archives remain private. Add `--release-candidate` to prepare an unpublished artifact with public npm metadata and the beta tag. This command never publishes. Package ownership, clean installation, security review and founder release approval remain separate gates. Naming observations do not reserve a package.

## Preparation and use

Use the existing Node 24.11/npm environment and installed repository dependencies. The tool uses the already installed `rolldown/parseAst` parser through the landing workspace dependency; no parser is shipped with the artifact. Coordinate one fresh root `npm run build` before packaging. Source and compiled hashes are recorded, but the tool does not prove they correspond through a fresh compilation; that is the caller's build prerequisite.

Run the campaign disk guard before staging or installing. Packaging needs 12 GiB free plus twice the bundle cap and 0.1 GiB at the stage parent. It needs 12 GiB plus the bundle cap and 0.05 GiB at the output parent. The bundle cap is 1 GiB. Reserve 4.2 GiB more for the full proofs. Packing also needs every locked package in the local npm cache. Run npm ci in the repository first. Pass --npm-cache ABS if the cache is not in the default place. All destinations must be new, absolute paths with real existing parents. On macOS resolve `/tmp` to `/private/tmp` first.

```sh
node tools/cli-distribution/pack.mjs \
  --repo /absolute/bowerloom-checkout \
  --stage /absolute/new-staging-directory \
  --output /absolute/new-tarball-directory
```

The result prints the tarball path, SHA256, compressed/uncompressed sizes and file count. Nothing is installed by this command. `DISTRIBUTION.json` inside the artifact inventories byte hashes, source hashes, dependency pins, the bundled packages with their integrity values, and proof limitations. The packed `package.json` pins every dependency of the reachable runtime closure to an exact version, because npm ignores a packed shrinkwrap when it installs from a tarball. The closure includes required peer dependencies, the optional peers that the lock holds, and the optional `pg-cloudflare`. Every package of the closure is listed in `bundleDependencies` and ships inside the tarball. An `npm-shrinkwrap.json` with the same versions is packed too. Entries must have npm registry URLs and integrity hashes. Source workspace links, nonregistry dependencies and unpinned direct dependencies are rejected.

To reproduce the bounded proof after the fresh build and disk check:

```sh
node --test tools/cli-distribution/test/*.test.mjs
BOWERLOOM_PACK_INSTALL_PROOF=1 node --test tools/cli-distribution/test/*.test.mjs
BOWERLOOM_PACK_ONLINE_PROOF=1 node --test tools/cli-distribution/test/pack.test.mjs
```

The online proof needs the network and writes to a temporary folder. Run the disk guard first.

The second command creates two tarballs, compares SHA256, and invokes **offline** `npm install --ignore-scripts --no-audit --no-fund` in a temporary directory outside the checkout. Packing needs every locked package in the npm cache; a cache miss fails and there is no online retry. Installing the tarball needs no cache. Temporary proof directories are removed on test completion. HOME is retained only to locate the existing cache; user/global npm config is replaced by empty configs, token environment variables are not forwarded, and no registry authentication occurs.

## Included and excluded

The initial roots are `dist/apps/cli/src/main.js` and `dist/apps/mcp/src/main.js`. AST traversal follows static imports, exports, literal dynamic imports, literal `require` calls and the Codex guardian's `new URL('./guardian.js', import.meta.url)` reference. Nonliteral module selectors fail. Reachable compiled files must live in the explicit approved app/package list and have a corresponding current TypeScript source file. Symlinks, nonregular/oversized source files, missing dependencies and escaping imports fail before staging. This is a packaging boundary, not a secret-content scanner: reviewed source code remains a prerequisite.

Explicit runtime assets are the Linux browser runner, seccomp profile, runtime manifest and craft-shop acceptance contract. These are execution assets used by the existing browser executor, not test-suite fixtures. Their existing Playwright license and import provenance are preserved. The root MIT license, historical-source boundary and Supabase notice are included. No old module source under licensing hold is imported. Bundled registry dependencies keep their own license files inside the tarball.

No repository checkout, `.git`, test suites, examples, `.env`, source maps, TypeScript declarations, campaign records, private media, browser binaries, Docker images, workspace symlinks, or the repository `node_modules` tree is copied. The artifact preserves the compiled `dist/` layout so relative imports and the explicit runtime asset location resolve. Only `bowerloom` and `bowerloom-mcp` bins are exposed; historical executable aliases are not included. There are no first-party install hooks. The runtime dependencies of the reachable closure ship inside the tarball under node_modules through bundleDependencies, so the tarball installs offline with an empty npm cache. Development dependencies, browser binaries, and Docker images are not included.

## Acceptance and limits

The artifact proof verifies installed-bin help, standalone startup plan/apply/status, exact approval rejection, no runtime authorization, and the MCP entrypoint's missing-installation guard. Installation of the tarball itself requires no source checkout. The proof does not demonstrate a running MCP session, database operations, recipe execution, Docker/browser prerequisites, Windows/Linux portability, an online registry installation, or beta release readiness. The executable reads its identity from the matching package and release record. A beta version does not establish release acceptance. The online proof (BOWERLOOM_PACK_ONLINE_PROOF=1) covers a local and a global tarball install on the machine that runs it.

Repeated packing of the same input snapshot and the same npm cache content is byte-deterministic under the recorded Node/npm toolchain. Cross-npm-version reproducibility is not claimed. Dependency integrity comes from the lock: each bundled package is read from the npm cache by its lock integrity value and checked against it before it is staged. Future dynamic resource patterns need explicit review and asset entries. The packer operates on a trusted same-user filesystem; concurrent hostile replacement by that same user is outside its guarantee. It never overwrites destinations, and removes only its newly created staging directory if a write fails. After npm errors, staged files/output are retained for diagnosis; no broad cleanup runs.

The offline installation test also exercises exact setup revision and synthetic harness import/projection through the installed executable. These operations do not start a team. Live harness application and removal remain outside this proof.

The installed executable also plans synthetic MCP connections from three private fixture files supplied by the test.
The artifact excludes those fixtures. The proof rejects missing synthetic acknowledgment and tool invocation, then compares all input bytes.
It records no live discovery, authentication, transport, or tool execution result.
