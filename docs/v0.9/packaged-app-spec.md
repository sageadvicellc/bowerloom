# Packaged-app spec

Status: written for the v0.9 acceptance item 5 and item 8 of `carry-over-scope.md`. Read at commit `328dd90b` of `release/0.8.0-beta.2`. The pull request PR 171 (extension loader wiring) is open and changes the extension items. Each item that depends on it says "after PR 171". This page changes no code.

This page lists what the packaged Electron app must hold. Each item has a statement, a check, where the check runs, and a status.

Status words:

- exists: a test or a spec at the release head holds the check today.
- pending PR 171: the test is in PR 171, which is open, and is not at the release head.
- pending PR 173: the test is in PR 173, which is open, and is not at the release head.
- proposed: the check is new. No file holds it yet.
- unknown: a fact is missing. The item says which one.

## Terms

- Packaged build: the output of `npm run desktop:build` from the repository root. That script runs `npm --prefix apps/desktop run build`. The desktop script runs `npm run bundle` and then `electron-builder --mac --publish never`. The output goes to `apps/desktop/release/`.
- Bundle: the app folder in the output. It is `release/mac-arm64/Bowerloom.app` on an arm64 machine and `release/mac/Bowerloom.app` on an x64 machine.
- Archive: `Contents/Resources/app.asar` inside the bundle. It holds the app code. An asar is a single file that holds a folder tree.
- Fuse: a switch inside the Electron binary. The packaging step sets it. A running app cannot change it.
- Sandbox: the Linux container that `npm run sandbox:test` starts. See `docs/v0.9/sandbox-tests.md`.
- Gate machine: the machine that runs the acceptance gate. The scope lists what it has: git, the Electron binary and macOS. It has a user that is not root and a file system that can lock. It also has a `release/` build.

## Where each check runs

- Sandbox: unit tests of `apps/desktop`. Also end-to-end specs, with a Linux Electron.
- macOS only: anything that reads or starts the `.app` bundle, builds the disk image, or reads a code signature. The sandbox doc lists three of these as not run in the container: the packaged-app spec, the fuse check of a built app, and the launch of a macOS build.
- Count warning: the sandbox doc reports 17 failures in the desktop unit suite, from the first full run on 2026-11-10. It says 4 of them are root effects and 13 are not yet sorted by cause. Compare a run with the base by test name, not by count.
- The `CI` variable: if `CI` is set, the packaged-app spec throws on a missing build. If `CI` is not set, it skips. Nothing in the repository sets `CI`, and `tools/sandbox/in-container.sh` sets none. So in the sandbox the spec skips on Linux. The scope says the gate runs `e2e` with `CI=1`. No script in the repository does that. Who sets it on the gate machine is unknown.

## A. Build and identity

P1. The build finishes.

- Statement: `npm run desktop:build` exits 0 and writes a bundle for the arch of the machine.
- Check: run the command, then test that the bundle folder exists.
- Runs: macOS only. Whether `electron-builder --mac` can make the bundle on Linux is unknown. Nobody tried it.
- Status: no test holds it.

P2. The build is newer than the source.

- Statement: `Contents/Resources/app.asar` is newer than the newest source file. The source files are the folders `main`, `preload`, `renderer` and `shared`, the root `kits` folder, and the `src` folder of every package. They also include `tools/bundle.mjs` and `package.json`.
- Check: `e2e/packaged-app.spec.ts`, with `newestSourceOf` from `e2e/packaged-support.ts`. The unit test `newestSourceOf counts the shipped kits, the packages, and the desktop sources` in `tests/packaged-support.test.ts` holds the function.
- Runs: the spec on macOS only. The unit test in the sandbox.
- Status: exists. Gap: the function does not watch `build/dock`, which ships through `extraResources`. It also does not watch an `apps/desktop/extensions` folder. That folder does not exist yet, and PR 171 does not add it.

P3. Identity.

- Statement: the app id is `com.sageadvice.bowerloom`, the product name is `Bowerloom`, and the version in `package.json` and `package-lock.json` is the release version.
- Check: `tests/packaging.test.ts`, test `the package carries the 0.8 identity`.
- Runs: sandbox.
- Status: exists. The test pins `0.8.0-beta.1`. A 0.9 build must change the test in the same commit as the version.

P4. No updater and no publishing.

- Statement: `electron-updater` is not a dependency, `build.publish` is not set, no script publishes, and the `build` script holds `--publish never`.
- Check: `tests/packaging.test.ts`, tests `every dependency is pinned to an exact version` and `the build targets are macOS...`. Also `tests/no-network.test.ts`, which counts zero uses of `electron-updater` in the bundled main code.
- Runs: sandbox.
- Status: exists.

P5. Targets.

- Statement: the macOS targets are dmg and zip for arm64 and x64. Windows is nsis. Linux is AppImage.
- Check: `tests/packaging.test.ts`, test `the build targets are macOS...`.
- Runs: sandbox, for the settings only.
- Status: exists for the settings. The app README says the Windows and Linux installers were never built or tried. A real Windows or Linux build is unknown.

## B. Fuses

F1. The seven fuses are as promised.

- Statement: `RunAsNode` off. `EnableNodeOptionsEnvironmentVariable` off. `EnableNodeCliInspectArguments` off. `GrantFileProtocolExtraPrivileges` off. `EnableCookieEncryption` on. `EnableEmbeddedAsarIntegrityValidation` on. `OnlyLoadAppFromAsar` on.
- Check: `cd apps/desktop && npm run verify:fuses`. It prints `Fuses are as promised.` and exits 0. It exits 1 and lists each wrong fuse. If no build exists, it exits 2. An optional first argument names another binary.
- Runs: macOS only. The default path is the macOS arm64 build. Whether the tool reads a Linux or Windows binary is unknown.
- Status: exists. The spec `e2e/packaged-app.spec.ts` runs it too. Test `the built binary has those fuses` in `tests/packaging.test.ts` runs it too. The test looks only at `release/mac-arm64`. If only an x64 build exists, the test skips. With no build at all, it skips as well. The test inventory lists that skip as one that must not happen on the gate machine.

F2. The package settings and the fuse tool agree.

- Statement: the `electronFuses` block of `package.json` and the list in `tools/check-fuses.mjs` name the same seven fuses with the same state.
- Check: `tests/packaging.test.ts`, test `the fuse check expects every fuse that the build sets...`.
- Runs: sandbox.
- Status: exists.

F3. The debugging port.

- Statement: the inspect switch is off in the build, so the packaged spec starts the binary itself. It attaches over the remote debugging port of Chromium.
- Check: `e2e/packaged-app.spec.ts`.
- Runs: macOS only.
- Status: exists. Decision for the maintainer: the spec depends on the packaged app accepting `--remote-debugging-port`. Nobody decided whether a release build must refuse it.

## C. Resources and the archive

R1. The archive exists.

- Statement: `Contents/Resources/app.asar` exists. The build sets `asar: true`.
- Check: `e2e/packaged-app.spec.ts` reads its time and lists it.
- Runs: macOS only.
- Status: exists.

R2. The kits ship and the old sample data does not.

- Statement: `Contents/Resources/kits` exists. `Contents/Resources/sample-data` does not exist. `apps/desktop/sample-data` does not exist.
- Check: the spec checks the two bundle folders. `tests/packaging.test.ts`, test `the build targets are macOS...`, checks the source folder and the `extraResources` pair.
- Runs: bundle part macOS only. Source part sandbox.
- Status: exists.

R3. The Dock icons ship.

- Statement: `Contents/Resources/dock/icon-light.png` and `icon-dark.png` exist.
- Check: proposed, in `e2e/packaged-app.spec.ts`. The `extraResources` pair copies `build/dock`. No spec reads the copied files.
- Runs: macOS only.
- Status: proposed.

R4. The archive holds the app files and none of the old files.

- Statement: the archive lists `/dist/renderer/app.js` and `/dist/preload-real.cjs`. It lists no file that matches `sample-data`, `preload.cjs`, `force-graph` or `/screenshots/`, except `preload-real.cjs`.
- Check: `e2e/packaged-app.spec.ts`, with `listPackage` from `@electron/asar`.
- Runs: macOS only.
- Status: exists.

R5. The archive holds the other build files.

- Statement: the archive lists `dist/main.mjs`, `dist/bundle-worker.mjs` and `dist/renderer/index.html`. It lists the four style files `brand.css`, `tokens.css`, `styles.css` and `app.css`. It also lists the font files of `newsreader` and `manrope`, with their `OFL.txt` licence files.
- Check: proposed, in `e2e/packaged-app.spec.ts`. Today the test `the one-command launcher works from another folder...` in `tests/packaging.test.ts` checks seven files in `dist/` before packing: `main.mjs`, `bundle-worker.mjs`, `preload-real.cjs`, `renderer/app.js`, `renderer/index.html`, `renderer/tokens.css` and `renderer/styles.css`. No test checks `brand.css`, `app.css` or the fonts in the archive. `e2e/brand-fonts.spec.ts` checks that both faces load in a real window, and `tests/brand-parity.test.ts` checks the font sources and the build script. Neither reads the archive.
- Runs: archive part macOS only. The `dist/` part runs in the sandbox.
- Status: proposed for the archive. The worker file must load from inside the archive. `e2e/bundle-worker-asar.spec.ts` proves that in the development Electron and not in the packaged app.

R6. The runtime loads only Electron.

- Statement: `dist/main.mjs` and `dist/preload-real.cjs` load no module from `node_modules` except `electron`. `package.json` has no `dependencies` block, because nothing else loads.
- Check: `tests/packaging.test.ts`, test `the runtime dependencies are exactly what the built main process and bridge load...`.
- Runs: sandbox. It reads `dist/`, which the test script builds first.
- Status: exists.

R7. Every shipped kit loads.

- Statement: for each id in `KIT_IDS`, `loadKit` on the folder `<Resources>/kits` succeeds. A broken kit refuses with `KIT_INVALID`. It never becomes an empty kit. `KIT_IDS` holds one id today, `wiki-keeper`.
- Check: `tests/kit.test.ts` and `tests/engine-kit.test.ts` check the source `kits/` folder. Proposed: one check that runs `loadKit` on the bundle copy.
- Runs: source part sandbox. Bundle part macOS only.
- Status: source part exists. Bundle part proposed.

## D. Extensions folder (after PR 171)

At the head, no `extensions` folder exists in `apps/desktop`, and no `extraResources` entry ships one. The six default extensions are code in the page bundle, not files in a folder. PR 171 adds `main/extension-host.ts`. The host reads `<bundle root>/extensions/<name>/manifest.json`. A bundle root with no `extensions` folder gives no extension and no error.

E1. A bundled extensions folder ships.

- Statement: if `apps/desktop/extensions` holds a file, `package.json` copies it into the app resources.
- Check: in PR 171, test `M2: if apps/desktop/extensions holds anything, package.json extraResources ships it into the app resources` in `tests/extensions-host.test.ts`. The test holds nothing while the folder is empty. Its comment says to add the entry `{ "from": "extensions", "to": "extensions" }` together with the first bundled extension. `tests/packaging.test.ts` pins `extraResources` to exactly the kits and the Dock icons. The first bundled extension must change both tests in one commit.
- Runs: sandbox for the settings. Bundle part macOS only.
- Status: pending PR 171. After PR 171 the test passes vacuously until the first bundled extension exists. Done in the Local models screen PR: `apps/desktop/extensions/local-models/manifest.json` is the first bundled extension, `package.json` ships the folder, and `tests/packaging.test.ts` pins the three entries. The M2 test now checks something.

E2. Where the bundle root sits.

- Statement: after PR 171, `extensionsBundleRoot` returns `process.resourcesPath` in a packaged build, and `apps/desktop` in development. So the loader reads `Contents/Resources/extensions`. That folder is outside `app.asar`, so the loader does not go through the asar layer of Electron. The asar integrity fuse covers only the archive, so it does not cover this folder.
- Check: in PR 171, tests `extensionsBundleRoot: resources in a packaged build, the app folder in development` and `LOW d: extensionsBundleRoot points at the folder the loader reads, in a real layout, packaged or not`.
- Runs: sandbox.
- Status: pending PR 171.

E3. A packaged build loads every bundled extension.

- Statement: after the first bundled extension exists, the loader reports no skip in a packaged build. The count of loaded manifests equals the count of folders in the source `extensions/`. Before that, a bundle with no `extensions` folder is correct and not a failure.
- Check: proposed. Run `loadBundledManifests` against `Contents/Resources` of the build and compare with the source count.
- Runs: macOS only.
- Status: proposed. The sandbox half is done in the Local models screen PR: test `E3: the app's own bundle loads the first bundled extension` in `tests/extensions-host.test.ts` loads the source folder with no skip. The packaged half still needs macOS. The loader hands each skip to stderr, and to the usage log in a launch that keeps one. A Finder-launched app shows no stderr, so a person sees no word about a skipped extension in a launch with no usage log.

E4. The loader refuses hostile input.

- Statement: a link that leaves the bundle gives `OUTSIDE_ROOT`. A name with a separator, a `..` part or an absolute path gives `BAD_NAME`. A manifest that is not valid JSON gives `NOT_JSON`. A manifest over 64 KiB gives `TOO_LARGE`. A second link to one folder or file gives `DUPLICATE`. Nothing throws.
- Check: `tests/extensions-loader.test.ts`.
- Runs: sandbox.
- Status: exists. This covers the path traversal and symlink escape that acceptance item 5 asks for.

E5. Only default extensions load from the bundle.

- Statement: acceptance item 5 says the loader loads only the default extensions inside the app bundle. After PR 171, the host registers the six defaults in code. It also loads any other manifest from the bundle folder. It refuses a manifest that takes a default id or route. It also refuses one that says it is protected.
- Status: unknown. The maintainer answered that bundled extensions only load in 0.9. That fits the folder reading. It does not fit a reading of "only the six defaults". The maintainer must say which reading holds. Until then, no check is written for it.

## E. Uninstall protection

U1. The six defaults are protected and own all 15 routes.

- Statement: `DEFAULT_EXTENSIONS` holds six manifests: `overview`, `harnesses`, `library`, `projects`, `interfaces-history-help` and `first-run`. Each is protected. Each of the 15 base routes has exactly one owner.
- Check: `tests/extensions-registry.test.ts` and `tests/extensions-register.test.ts`. Also `tests/route-spec-matrix.test.ts`, which compares the route matrix with `BASE_ROUTES`.
- Runs: sandbox.
- Status: exists.

U2. A protected extension cannot be uninstalled in the registry.

- Statement: `registry.uninstall(id)` for a protected extension answers `PROTECTED`. The extension and its routes stay. An unknown id answers `UNKNOWN_EXTENSION`.
- Check: `tests/extensions-registry.test.ts` and `tests/extensions-register.test.ts`, test `defaults cannot be uninstalled, or replaced by an id from a loaded source`.
- Runs: sandbox.
- Status: exists.

U3. An extension loaded from outside cannot claim protection.

- Statement: registration refuses a loaded manifest with `protected: true` and answers `RESERVED`.
- Check: `tests/extensions-register.test.ts`, test `a loaded manifest that says protected: true is RESERVED and registers nothing`.
- Runs: sandbox.
- Status: exists.

U4. The guard in main refuses.

- Statement: after PR 171, `uninstallExtension` in `main/extension-host.ts` answers `PROTECTED` for a default id, whatever the registry holds. If the registry throws, or answers with something that is not an answer, the guard also answers `PROTECTED`.
- Check: in PR 171, the tests named `fail closed: ...` and `LOW c: ...` in `tests/extensions-host.test.ts`.
- Runs: sandbox.
- Status: pending PR 171.

U5. The refusal in the packaged app.

- Statement: acceptance item 8 asks the packaged-app spec to show that the uninstall of a protected extension returns its refusal code in the packaged build.
- Status: unknown, and not testable today. After PR 171, nothing reads `extensionHost`, and no channel lets a person uninstall. The 39-call contract is frozen. A check in a real window needs a call that does not exist. Adding one changes the contract, which is a decision for the maintainer. Until then, the refusal is held at unit level (U2 and U4).

U6. No main code deletes bundle files.

- Statement: a short list names the files that can create, change or remove a file in the source of the app. The extension loader only opens a manifest for reading.
- Check: `tests/writers.test.ts` and `tests/writers-imports.test.ts`.
- Runs: sandbox.
- Status: exists for the list of writers. Whether the list covers a path into the bundle folder is unknown. The test titles were read and the assertions were not.

## F. Launch and behaviour of the packaged app

L1. The app opens on the person's own folders.

- Statement: started with no flag and a made-up home folder, the window opens `app://viewer/index.html#app`. It shows the heading `Bowerloom` and the line `Bowerloom only reads. It writes only after you approve what it will write.` The page has no `window.bowerloom`. `bowerloomReal` has exactly `discoverPlaces`, `pickFolder` and `readSelected`. `bowerloomEngine.mode` is `real`. The page holds no part of the old viewer. The button `Find my files` leads to the heading `Found 4 places`. The page text holds no path of the fixture root.
- Check: `cd apps/desktop && npm run e2e -- e2e/packaged-app.spec.ts`. Take the lock `/tmp/bowerloom-test.lock` around the run, as the README says.
- Runs: macOS only. If the platform is not macOS or no build is in `release/`, the spec skips. If `CI` is set, it throws instead. A build older than the source fails it in both cases. See the `CI` note under "Where each check runs".
- Status: exists.

L2. The app ends cleanly and keeps its data folder.

- Statement: after SIGTERM, the process ends within 30 seconds. The code is 0. Code null with signal SIGTERM also counts, because the spec sent the signal. The data folder still exists and holds `Local State`.
- Check: the same spec.
- Runs: macOS only.
- Status: exists.

L3. An unknown flag refuses the start.

- Statement: for a misspelled or retired flag, Electron exits with code 2 and prints the words on stderr. It opens no window.
- Check: `tests/launch.test.ts`, test `the built app exits with code 2 and the words on stderr...`. The test starts the development Electron binary from `node_modules` on a private build of `main.ts`. It does not start the packaged app. If that binary is missing, the test skips.
- Runs: the test needs the development Electron binary in `node_modules`, so it can run in the sandbox. It ran and passed once in a container run for PR 174. The sandbox doc does not list its result, so its result in a full sandbox run is unknown. The test inventory lists its skip as one that must not happen on the gate machine.
- Status: exists. A check on the packaged app itself is proposed.

L4. Every real-mode route draws in the packaged app.

- Statement: for each real-mode route of `docs/v0.9/route-spec-matrix.md`, the packaged app opens `#app/<route>` and draws a named screen. The matrix has 15 routes. Thirteen have a real mode. `runs` and `compare` have a sample mode only.
- Check: proposed, a new packaged-app spec. Today the packaged spec visits the Welcome screen and the Choose screen.
- Runs: macOS only.
- Status: proposed. A packaged app can ship with no screens while every gate is green. The matrix also notes that no spec opens Interfaces on the `#app` launch.

L5. Developer tools are off in a packaged build.

- Statement: `webPreferences(preload, true).devTools` is `false`. Context isolation and the sandbox are on. Node integration is off.
- Check: `tests/security.test.ts`, tests `the window has context isolation, no Node, a sandbox, and no webview` and `the packaged window turns the developer tools off, and every frame navigation and device permission is refused`. A check on the real window of a packaged app is proposed. Turning developer tools off does not refuse the remote debugging port. F3 covers that port.
- Runs: unit part sandbox. Window part macOS only.
- Status: unit part exists. Window part proposed.

L6. No request leaves the machine.

- Statement: the session cancels every request that is not a file of the app page. The policy holds `connect-src 'none'`.
- Check: `tests/security.test.ts`, tests `the content security policy is strict and the page carries exactly that policy` and `no request leaves the machine...`. Also `tests/no-network.test.ts`. A packaged-app check is proposed.
- Runs: unit part sandbox.
- Status: unit part exists. Packaged part proposed.

## G. Signing and the disk image

S1. The signature of the local build.

- Statement: the build carries only a self-made local signature (`identity: "-"`). `hardenedRuntime` is false and `gatekeeperAssess` is false. The fuses need that signature to start.
- Check: proposed. Run `codesign -dv --verbose=4` and `codesign --verify --deep --strict` on the bundle.
- Runs: macOS only.
- Status: proposed. The app README says the app is not signed with a Developer ID.

S2. The disk image and the zip exist and open.

- Statement: `release/` holds one dmg and one zip for each arch. `hdiutil verify` passes on each dmg.
- Check: proposed. List the files and run `hdiutil verify`.
- Runs: macOS only.
- Status: proposed. The exact file names that electron-builder writes are unknown.

S3. A signed and notarized build.

- Out of scope. Nobody builds it. It needs an Apple Developer ID. The draft Tauri plan, PR 163, says Apple spend needs the maintainer's approval first.

## H. Which checks need macOS, and which run in the sandbox

macOS only:

- Whole items: P1, F3, R1, R3, R4, E3, L1, L2, L4, S1 and S2.
- Parts of items:
  - The spec part of P2.
  - The binary part of F1.
  - The bundle part of R2, R7 and E1.
  - The archive part of R5.
  - The window part of L5.
  - The packaged part of L6.

The sandbox runs:

- Whole items: P3, P4, P5, F2, R6, E2, E4, U1 to U4, U6 and L3.
- Parts of items:
  - The source part of R2 and R7.
  - The `dist/` part of R5.
  - The unit part of L5 and L6.
  - The unit test of `newestSourceOf`.

The scope says the gate runs `npm run desktop:build` first and `e2e` with `CI=1`. See the `CI` note above. A skip of the fuse test in `tests/packaging.test.ts`, of the exit-code-2 test in `tests/launch.test.ts`, or of the packaged-app spec fails the gate. The test inventory lists these three as the skips that must not happen.

## Unknown

- Whether a Linux or Windows build works, and whether `tools/check-fuses.mjs` reads such a binary.
- Which reading of "only default extensions" holds (E5).
- Whether a call for uninstall exists before the 0.9 gate (U5). This is a decision for the maintainer.
- Whether a release build must refuse the remote debugging port (F3).
- Who sets `CI=1` on the gate machine, and whether the exit-code-2 test (L3) passes in a full sandbox run.
- The file names of the disk image and the zip (S2).
- Whether `tests/writers*.test.ts` cover a write into the bundle folder (U6).
