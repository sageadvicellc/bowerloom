# Private CLI distribution proof

This tool stages and packs the current Bowerloom CLI and MCP entrypoint as an installable npm tarball. It does not publish, authenticate to a registry, install software, rebuild the repository, or run a model. The default package identity is `bowerloom`, chosen by Hanna; `--name` can override it. Every generated manifest remains `private: true`. Naming availability is a separate registry check, not a reservation.

## Preparation and use

Use the existing Node 24.11/npm environment and installed repository dependencies. The tool uses the already installed `rolldown/parseAst` parser through the landing workspace dependency; no parser is shipped with the artifact. Coordinate one fresh root `npm run build` before packaging. Source and compiled hashes are recorded, but the tool does not prove they correspond through a fresh compilation; that is the caller's build prerequisite.

Run the campaign disk guard before staging or installing. Packaging itself needs at least 12 GiB free plus a 0.05 GiB staging allowance; reserve **0.6 GiB** for the full two-pack/offline-install proof. All destinations must be new, absolute paths with real existing parents. On macOS resolve `/tmp` to `/private/tmp` first.

```sh
node tools/cli-distribution/pack.mjs \
  --repo /absolute/bowerloom-checkout \
  --stage /absolute/new-staging-directory \
  --output /absolute/new-tarball-directory
```

The result prints the tarball path, SHA256, compressed/uncompressed sizes and file count. Nothing is installed by this command. `DISTRIBUTION.json` inside the artifact inventories byte hashes, source hashes, dependency pins, and proof limitations. An `npm-shrinkwrap.json` is derived from the repository lock's reachable runtime closure, including required peer dependencies and available optional dependencies. Entries must have npm registry URLs and integrity hashes. Source workspace links, nonregistry dependencies and unpinned direct dependencies are rejected.

To reproduce the bounded proof after the fresh build and disk check:

```sh
node --test tools/cli-distribution/test/*.test.mjs
BOWERLOOM_PACK_INSTALL_PROOF=1 node --test tools/cli-distribution/test/*.test.mjs
```

The second command creates two tarballs, compares SHA256, and invokes **offline** `npm install --ignore-scripts --no-audit --no-fund` in a temporary directory outside the checkout. Existing npm cache is required. A cache miss fails; there is no online retry. Temporary proof directories are removed on test completion. HOME is retained only to locate the existing cache; user/global npm config is replaced by empty configs, token environment variables are not forwarded, and no registry authentication occurs.

## Included and excluded

The initial roots are `dist/apps/cli/src/main.js` and `dist/apps/mcp/src/main.js`. AST traversal follows static imports, exports, literal dynamic imports, literal `require` calls and the Codex guardian's `new URL('./guardian.js', import.meta.url)` reference. Nonliteral module selectors fail. Reachable compiled files must live in the explicit approved app/package list and have a corresponding current TypeScript source file. Symlinks, nonregular/oversized source files, missing dependencies and escaping imports fail before staging. This is a packaging boundary, not a secret-content scanner: reviewed source code remains a prerequisite.

Explicit runtime assets are the Linux browser runner, seccomp profile, runtime manifest and craft-shop acceptance contract. These are execution assets used by the existing browser executor, not test-suite fixtures. Their existing Playwright license and import provenance are preserved. The root MIT license, historical-source boundary and Supabase notice are included. No old module source under licensing hold is imported. Registry dependencies retain their own licenses in their normal npm packages.

No repository checkout, `.git`, test suites, examples, `.env`, source maps, TypeScript declarations, campaign records, private media, browser binaries, Docker images, workspace symlinks, or full `node_modules` tree is copied. The artifact preserves the compiled `dist/` layout so relative imports and the explicit runtime asset location resolve. Only `bowerloom` and `bowerloom-mcp` bins are exposed; historical executable aliases are not included. There are no first-party install hooks. The tarball needs its normal npm dependencies installed; it is not an all-dependencies offline bundle.

## Acceptance and limits

The artifact proof verifies installed-bin help, standalone startup plan/apply/status, exact approval rejection, no runtime authorization, and the MCP entrypoint's missing-installation guard. Installation of the tarball itself requires no source checkout. The proof does not demonstrate a running MCP session, database operations, recipe execution, Docker/browser prerequisites, global installation, Windows/Linux portability, an online registry installation, or beta release readiness. The existing executable still reports its alpha version; this proof does not relabel it as a beta release.

Repeated packing of the same input snapshot is byte-deterministic under the recorded Node/npm toolchain. Cross-npm-version reproducibility is not claimed. Dependency integrity comes from the shrinkwrap, not a vendored dependency copy. Future dynamic resource patterns need explicit review and asset entries. The packer operates on a trusted same-user filesystem; concurrent hostile replacement by that same user is outside its guarantee. It never overwrites destinations, and removes only its newly created staging directory if a write fails. After npm errors, staged files/output are retained for diagnosis; no broad cleanup runs.
