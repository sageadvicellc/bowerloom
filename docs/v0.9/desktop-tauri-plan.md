# Bowerloom desktop: a staged move from Electron to Tauri

Status: draft for the maintainer. Date: 2026-11-09 (UTC).

This is a plan and a spec. It builds nothing and deletes nothing. The desktop app stays on Electron until each gate below passes.

## What the maintainer chose

- The desktop app moves to a Tauri shell. The existing Node core runs beside it as a sidecar (a separate process that the shell starts).
- No measured trial comes first. So this plan treats the three untested risks as early gates with pass and fail criteria.
- The maintainer made the choice in chat and on GitHub on 2026-11-09. The weighting of the goals (performance, size, cross-platform reach) is not answered. It is an open question here, and this plan does not decide it.

## Facts about the app today

These facts come from git, at commit `d4c8a478` of `release/0.8.0-beta.2`. That branch is the base of the 0.9 work.

Size, in files and lines of TypeScript, CSS, and HTML under `apps/desktop`:
- `main`: 32 files, 5,584 lines.
- `preload`: 1 file, 34 lines.
- `shared`: 50 files, 9,076 lines.
- `renderer`: 157 files, 15,001 lines.

Tools: Electron 44.10.2, electron-builder 26.17.0, esbuild 0.28.2, React 19.3.0, TypeScript 7.0.2. The repository needs Node `>=24.11.0 <25`.

How the process split works now:
- The main process imports the Node core in the same process. It imports `project-sync`, `adoption`, `harness-definition`, `harness-bundle`, `contracts`, `diagnostics`, `notes-source`, `project-context`, and `skill-manifest`.
- One worker thread exists. `engine-bundle-host.ts` starts a `Worker` for bundle work.
- The preload file (`preload/real-preload.ts`, 34 lines) exposes two frozen objects with `contextBridge`. They are `bowerloomReal` and `bowerloomEngine`.
- The page makes 42 calls: 3 reader calls and 39 engine calls. The names are in `shared/real/types.ts` and `shared/engine/types.ts`. Each engine call has a fixed argument count (`ENGINE_ARITY`). Calls refuse with short codes. The engine calls use `NOT_ALLOWED`, `BAD_ARGUMENT`, `UNKNOWN_FOLDER`, `UNKNOWN_BUNDLE`, and `FAILED`. The reader calls use `NOT_ALLOWED`, `BAD_ARGUMENT`, `UNKNOWN_PLACE`, `TOO_MANY`, `BUSY`, `NO_HOME`, and `FAILED`.
- The main process keeps state across calls. It refuses a write that is not the plan it showed last (`NOT_THE_PLAN_SHOWN`).
- The renderer imports nothing from `electron` or Node. A search found 0 such files.

Electron features in use:
- Dialogs: message boxes, error boxes, and open and save dialogs.
- A close guard that handles `will-prevent-unload`.
- A custom page scheme, registered with `protocol.registerSchemesAsPrivileged` and served with `protocol.handle`.
- A request filter (`webRequest.onBeforeRequest`) and a permission handler that refuses every request.
- A content security policy in `renderer/index.html` that allows only the app's own scripts, styles, fonts, and data images.
- The clipboard, `shell.openExternal`, and the dock icon.
- Hidden windows for tests, through a `--e2e-hidden` switch.

The Electron surface to port is small to find. `main/main.ts` is the only file in `main` and `shared` that imports `electron`, and `preload/real-preload.ts` is the only other. The dialog, clipboard, and link calls are made in `main.ts`. Other files get them as injected parts, so 10 to 13 files in `main` touch dialogs by name, depending on the search words. The port starts at `main.ts` and its injection points.

Not in use: an auto-updater, `safeStorage`, the power monitor, and notifications.

Packaging today (`apps/desktop/package.json`):
- macOS: dmg and zip for arm64 and x64, with ad-hoc signing (`identity: "-"`) and no hardened runtime.
- Windows: NSIS.
- Linux: AppImage.
- Electron fuses are set, and asar integrity is on. `tools/check-fuses.mjs` checks them.
- Extra resources: the `kits` folder and the dock images.

Tests and CI:
- 142 unit test files and 48 end-to-end specs under `apps/desktop`.
- The end-to-end tests use Playwright with one worker. Two specs call the Electron launch API (`_electron`) directly. The helper `e2e/hidden.ts` wraps the launch and answers the close question in the main process. All 48 specs reach the Electron launch, directly or through the 9 helper files in `e2e`.
- The only workflow in `.github/workflows` is `pr-preview.yml`. No workflow builds or tests the desktop app.

Web features the renderer uses (counted in files under `apps/desktop/renderer`):
- CSS `@container`: 4 files. `:has()`: 6 files. `color-mix`: 4 files. `backdrop-filter`: 1 file. `text-wrap`: 2 files.
- `ResizeObserver`: 4 files. `.animate()` (Web Animations): 1 file.
- Not used: `view-transition`, `animation-timeline`, `@property`, `@starting-style`, `IntersectionObserver`.

## What the Tauri documents say

These facts come from the official Tauri 2 pages. Each page shows its own last-updated date. The pages were read on 2026-11-09.

Sidecar (`https://v2.tauri.app/develop/sidecar/`, updated 2026-06-15):
- A sidecar is declared in `tauri.conf.json` under `bundle.externalBin`.
- A file named with the target triple must exist for each target, for example `...-x86_64-unknown-linux-gnu`.
- The shell starts it with `app.shell().sidecar(...).spawn()`. Output arrives as events. The app can write to its input.
- The shell plugin and a capability with `"sidecar": true` are required. Arguments are limited by the capability.
- The page says nothing about stopping a sidecar, restarting it, or watching it.

Node as a sidecar (`https://v2.tauri.app/learn/sidecar-nodejs/`, updated 2026-09-21):
- The page packs Node into one binary with `pkg` (`@yao-pkg/pkg`). It says any tool that compiles JavaScript to a binary also works.
- The other way is to ship the Node runtime and the JavaScript as a resource. The page says this exposes readable code and is usually larger.
- Its example is short-lived. For a long-lived app it points to other ways to talk: a local server, standard input and output, or sockets. It says each has trade-offs and security concerns.

End-to-end tests (`https://v2.tauri.app/develop/tests/webdriver/`, updated 2026-06-29):
- The recommended route is WebdriverIO with `@wdio/tauri-service`. It lists Windows, Linux, and macOS. On macOS it uses a WebDriver server embedded in the app.
- `tauri-driver` supports only Windows and Linux. The page says macOS has no WKWebView driver tool. A fork by another vendor covers macOS and needs a paid key.
- The Linux driver is `WebKitWebDriver`. The Windows driver is `msedgedriver`, and its version must match the installed Edge.
- Playwright is not mentioned.

Updater (`https://v2.tauri.app/plugin/updater/`, updated 2025-11-28):
- Signatures are mandatory and cannot be turned off. The private key is read from the environment at build time.
- Set `createUpdaterArtifacts` to get update files. On Linux the build makes an AppImage and a signature. On macOS it makes an app archive and a signature. On Windows it makes the NSIS setup and the MSI, each with a signature.
- Update endpoints are a list of URLs. TLS is enforced in production.

Signing:
- macOS (`https://v2.tauri.app/distribute/sign/macos/`, updated 2026-05-17): a `Developer ID Application` certificate and notarization. The page says the paid Apple program is needed to notarize. Ad-hoc signing does not avoid the user having to allow the app.
- Windows (`https://v2.tauri.app/distribute/sign/windows/`, updated 2026-10-27): signing is not required to run. It avoids SmartScreen warnings. Smart App Control blocks unsigned unknown apps. Newer certificates use a custom `signCommand`. Cross-signing from Linux or macOS needs that command.
- Linux (`https://v2.tauri.app/distribute/sign/linux/`, updated 2025-02-22): signing is not required. Only AppImage signing is documented.

Webviews (`https://v2.tauri.app/reference/webview-versions/`, updated 2026-05-17):
- Windows uses WebView2 (Chromium). macOS uses the system WKWebView, which updates with the OS. Linux uses `webkit2gtk`.
- The page says per-distribution Linux information is hard to collect, and its table is incomplete. It gives no minimum `webkit2gtk` version.

Bundles (`https://v2.tauri.app/distribute/`, updated 2026-11-05): Debian package, Snap, AppImage, Flatpak, RPM, and AUR on Linux. App bundle and DMG on macOS. Windows Installer on Windows.

Gaps in the documents:
- No stop, restart, or watch advice for a sidecar.
- No statement about Playwright.
- No minimum Linux webview version.
- No current stable version and no general cross-compilation table.

## The shape of the move

- A Tauri shell, written in Rust, hosts the webview. The React renderer moves over with as few changes as possible.
- The Node core runs as a sidecar. The sidecar owns everything that is in the main process today and is not a window or a dialog.
- The renderer talks to the shell, and the shell talks to the sidecar. The call set stays the same: the 3 reader calls and the 39 engine calls, with the same argument counts and refusal codes.
- The shell owns windows, dialogs, the clipboard, opening links, the page scheme and security policy, the close guard, the dock icon, and the updater.
- The CLI, the desktop shell, and other hosts all talk to the same Node core through one defined protocol. The core must run with no shell at all.

## The three early gates

Each gate has pass and fail criteria. Each gate reports a result for each of macOS, Windows, and Linux. A gate that fails on a system keeps that system on Electron. Numbers marked "proposal" are not measured. The maintainer approves them in a decision comment. If a criterion needs a fix, the maintainer approves the fix. Then a rerun passes before the gate counts as passed. For Gate 1, the rerun covers the whole part that holds the criterion, on the affected system. For Gates 2 and 3, it covers the whole gate on the affected system. A fix to a number that all systems share reruns the gate on every system.

### Gate 1: a long-lived Node sidecar

Risk: the Tauri documents give no advice on lifecycle, and the Node example is short-lived.

Gate 1 has three parts. Part A tests the sidecar process: protocol, events, restart, and cleanup. Part B tests Tauri packaging. Part C tests the Electron child process that Stage 3 uses. Each part has its own written result. On each system, if all criteria of all three parts hold, Gate 1 passes for that system. Stage 3 waits only for Part C.

Part A, the process:
- The Node core builds as one binary for each target triple, or as a runtime plus resource, and the shell starts it.
- A ping call returns. A large payload returns whole. The largest payload is the biggest scan result that the app handles today. Measure it on Electron first.
- Events reach the page in order and once each. The test sends 10,000 numbered events (proposal) and checks the count and the order.
- Every call returns or fails within 30 seconds (proposal). No call waits forever.
- The shell restarts a killed sidecar. The app recovers in 5 seconds or less (proposal). This holds across 100 kill-and-restart cycles in a row (proposal).
- A call in flight when the sidecar dies fails with the refusal `FAILED`. The shell never replays it.
- A kill during an in-flight write leaves the folder in a state that the existing recovery calls can repair. After a restart, the state "the plan shown last" is cleared, wherever it lives (open question 3). If it lives in the shell, the shell clears it when it restarts the sidecar. A write then returns the refusal `NOT_THE_PLAN_SHOWN`. It never runs a write that the page did not see planned.
- No orphan sidecar remains after three tests: a normal quit, a forced end of the shell, and a shell crash. The forced end uses `kill -9` on macOS and Linux, and `taskkill /F` on Windows. The crash test makes the shell fault. In each test, the sidecar ends too. On Windows the shell puts the sidecar in a job object, or an equivalent that Stage 1 picks, so that it ends with the shell.
- The core and the CLI tests run with no shell at all.

Part B, Tauri packaging:
- The sidecar works from an install path with spaces and non-ASCII characters.
- Packaging works inside a notarized macOS app, a Windows installer, and a Linux AppImage. The Electron build today has no hardened runtime. The pages read do not say whether a Node sidecar needs extra entitlements under the hardened runtime. This criterion tests a notarized build to find out. The notarized test starts only after the maintainer approves the Apple spend (open question 8).

Part C, the Electron child process, on macOS, Windows, and Linux:
- An Electron child process (`utilityProcess` or a bundled Node runtime) starts the core. It passes the ping, large payload, event, 30-second, kill-and-restart, in-flight, and plan-state tests of Part A. For Part C, the Electron main process stands in for the shell. Open question 3 covers where the plan state lives.
- It ends with the app after a normal quit, a forced end, and an Electron crash.
- The Electron fuses `runAsNode` and `enableNodeOptionsEnvironmentVariable` stay off.
- The packaged Electron installers start the child: the macOS dmg and zip, the Windows installer, and the Linux AppImage. The test uses an install path with spaces and non-ASCII characters. It needs no Apple spend, because the macOS Electron build is ad-hoc signed.

If any criterion fails on a system and the maintainer does not approve a fix, Gate 1 fails for that system. If the maintainer does not approve the Apple spend, Part B fails for macOS.

### Gate 2: the Linux web view

Risk: Linux uses `webkit2gtk`, and Electron bundles its own Chromium.

If all of these hold on at least two named Linux distributions with different `webkit2gtk` versions (proposal), the gate passes for Linux. The maintainer names the test distributions, the reference machine, the key screens, and the screenshot viewport in a decision (open questions 7 and 10).
- Each web feature in "Web features the renderer uses" has a test. "Works" means its test passes.
- The custom page scheme, the content security policy, and the permission refusal work. These checks also run on macOS and Windows.
- Before the gate runs, a baseline run compares Electron screenshots from two machines. A trial run compares Electron with Tauri on the reference machine, to check that the limit is feasible. The maintainer sets the pixel limit below from the baseline run (open question 7). The baseline needs two named machines.
- Screenshots of the key screens match the Electron screenshots. If more than 1% of the pixels in a screenshot differ, that screenshot fails (proposal).
- Scrolling, animation, and text input work on the reference machine. If more than 5% of the frames in a scroll test of 10 seconds (proposal) take longer than 33 ms, that test fails (proposal). The reference machine must run Linux. So macOS and Windows get no visual or performance check in Gate 2, unless the maintainer adds one (open question 7).
- The gate records the `webkit2gtk` version of each named distribution, and whether each one passes. It also records the vendor patch state of each version. The Tauri documents give no minimum. Two samples cannot set one, so the gate sets none. The supported minimum is a decision (open question 10). It is the lowest version in the supported set, and it is only as strong as the samples.
- The same feature tests also run on macOS (WKWebView) and Windows (WebView2). The gate records each macOS version and each WebView2 version that the tests ran on, with the patch state and whether it passes. The maintainer sets the supported macOS and Windows versions in a decision, in the same way. On macOS and on Windows, Gate 2 passes for that system when its feature tests pass. Its page scheme, content security policy, and permission checks must pass too.

If a blocking feature gap on a named distribution has no workaround, Gate 2 fails for Linux. The maintainer can drop that distribution from the supported set in a decision. Then the gate is judged on the distributions that remain, and at least two with different `webkit2gtk` versions must remain (proposal). After a macOS or Windows version is dropped, at least one tested version of that system must remain (proposal). A feature, page scheme, content security policy, or permission check that fails only on macOS or Windows fails Gate 2 for that system.

### Gate 3: the end-to-end test path

Risk: all 48 Playwright specs reach the Electron launch, and the Tauri route is WebDriver. The documents do not mention Playwright.

If all of these hold, the gate passes:
- A slice of at least 8 specs (proposal) runs green through WebdriverIO. Gate 3 reports a result for each of macOS, Windows, and Linux. The slice covers launch, folder pick, an adoption plan and run, the close guard, and the scan cache.
- The dialog answer uses a test-only switch in the shell. The switch answers a dialog request from a test fixture. Stage 1 designs it. It replaces what `answerCloseQuestion` does in `e2e/hidden.ts`, which runs code in the Electron main process.
- A run is one pass of the whole slice. The slice makes 100 runs, and at most 2 runs fail (proposal).
- On macOS the test uses an embedded WebDriver server inside the app. So the slice also runs a smoke check on the shipped build without that server. The smoke check proves launch only. It passes if the shipped build starts, shows its window, and exits with code 0 on a normal quit. It does not prove a call. The slice proves calls on the test build, and the result records that difference. A harness outside the app starts the shipped build. It reads the exit code and probes the window through the operating system. It needs nothing from the app and adds no test hook. The accessibility permission for the probe goes to the harness only, never to the app build. The launch timeout is 30 seconds (proposal). The same smoke check runs once on the Windows and Linux release builds. It is one pass, outside the 100 runs. A failure fails Gate 3 for that system. The macOS check runs after the maintainer approves the Apple spend. If the maintainer does not approve it, Gate 3 fails for macOS.
- A hidden or headless way to run exists for CI.
- Stage 1 writes down what replaces each of the two specs that call `_electron` directly (`bundle-worker-asar.spec.ts` and `quit-menu.spec.ts`) and the helper `hidden.ts`.

If macOS needs a paid vendor key that the maintainer does not approve, Gate 3 fails for macOS. If the slice misses the flake limit on a system, Gate 3 fails for that system.

## Stages

Each stage has an exit rule and a rollback point. Until a gate passes, nothing ships from the Tauri path.

1. **Stage 0: answers.** The maintainer answers the decisions. Questions 7 and 10 are split. Before Stage 1, the maintainer answers these: the test distributions, the reference machine, the key screens, and the viewport. The maintainer also names the two baseline machines, and says whether Gate 2 adds a visual check on macOS or Windows. Last, the maintainer answers every number marked "proposal" except the pixel limit. The 1% pixel limit is a placeholder until the baseline run finishes in Stage 1. The maintainer then sets it before the Gate 2 run. After Gate 2 results, the maintainer answers the supported minimum and the supported macOS and Windows versions. No gate run counts on a number that the maintainer has not approved, and that includes the pixel limit. A written deferral covers the answers that cannot exist before Stage 1. Exit: each open question has an answer from the maintainer, or the maintainer defers it in writing. Rollback: none needed.
2. **Stage 1: the gates.** Run the three gates in a spike branch. Product code does not change. Exit: a written result for each gate on each system. Rollback: delete the spike branch. Electron is untouched.
3. **Stage 2: a call layer that does not depend on Electron.** Put the 42 calls behind one interface in the renderer. Electron still implements it. This is a refactor behind the current tests. It adds no process and no permission. If a gate fails, the layer still helps the 0.9 interface rebuild. This stage changes the shipped Electron app, and it starts before the gates are done. Exit: all current tests pass. Rollback: revert the change.
4. **Stage 3: the core in its own process, under Electron.** This stage changes the shipped Electron app. It is the second change that starts before all gates are done. It starts only after Part C of Gate 1 has a written pass on all three systems, because the Electron app ships on all three. If one system fails, Stage 3 waits for a fix that the maintainer approves. A Tauri-only failure in Part A or B does not block Stage 3. A platform that the maintainer drops from the Tauri set does not change this rule. Run the Node core as a child process of the Electron app. Put it behind a switch that is off by default. The repository sets the Electron fuses `runAsNode` and `enableNodeOptionsEnvironmentVariable` to off, and `tools/check-fuses.mjs` checks them. Stage 3 leaves them off. It starts the child another way, such as `utilityProcess` or a bundled Node runtime. Part C shows which one works. If Part C overturns the answer to open question 4, the maintainer decides again in a new decision comment. The channel to the child is private to the Electron app and opens no listening port. A renderer cannot turn the switch on, and neither can an environment variable, unless a deliberate setting allows it. That setting is a build-time setting or a protected app setting. A renderer cannot reach it, and no other local program can write it. The Stage 3 security review confirms this. Exit, all required: all current tests pass with the switch on. The kill-and-restart tests pass with the switch on. The packaged installers for all three systems start the child (Part C). The fuse check is unchanged. The maintainer signs off the security review of the new process boundary. Rollback: turn the switch off. The in-process path stays.
5. **Stage 4: a Tauri shell alpha.** Build the shell in parallel with a subset of calls. Electron stays the default build. Alpha builds stay in private storage (see "Security"). This stage names the storage and its access control, and the exit rule checks both. Nobody publishes one before Stage 6 meets its exit rule. Deliver the security mapping in "Security" below. Exit: the maintainer signs off the security review, and the storage is named. Rollback: stop building the shell.
6. **Stage 5: parity.** All 42 calls, dialogs, and the close guard work in Tauri. The end-to-end slice grows to every spec that still applies. Alpha builds stay unpublished. Exit: the maintainer signs off a second security review. Rollback: Electron stays the default.
7. **Stage 6: builds, signing, and the updater.** Produce signed builds on the three systems, after the maintainer approves the Apple and Windows spend. Decide on the updater. Write and test the downgrade step: how a user returns from a Tauri build to the Electron build, with their data. Exit, all required: a signed build installs and launches on each system. The updater decision is recorded. The data choice below holds and is tested. The downgrade step passes its test on each system. Rollback: Electron builds stay available.
8. **Stage 7: the default switch, one platform at a time.** Hard exit rules, all required:
   - Gates 1, 2, and 3 each passed on that platform.
   - Signed builds exist (notarized on macOS).
   - The maintainer signed off the security review for that platform.
   - User data is handled and tested (see below).
   - The downgrade step from Stage 6 is tested on that platform.
   - The last Electron release for that platform is marked with a git tag. The maintainer sets up a repository tag rule against moves and deletes. Stage 7 checks that the rule exists and that the tag points at the released commit.

   Keep an Electron build for one release (proposal) after each switch. Rollback: use the downgrade step, and restore the Electron build as the default.
9. **Stage 8: retire Electron.** Only the maintainer starts this stage. Nothing is deleted before it. It needs Stage 7 done on every supported platform. A platform that stays on Electron (open question 6) blocks this stage. Only a decision to drop that platform from the supported set (open question 10) ends the block. That decision leaves the platform with no app after Stage 8, so the maintainer takes it knowingly. The Stage 2 call layer stays. The Stage 8 pull request removes the Stage 3 switch and child code with the rest of Electron. Exit: the maintainer approves in writing, and the Electron code is removed in its own pull request. Rollback: restore the code from the newest of the per-platform Electron tags.

What stays on Electron: everything, until its gates pass. When Gates 1, 2, and 3 pass on a platform, only that platform can move, and only at Stage 7. Stages 2 and 3 are the only changes to the shipped Electron app before the gates are done. Both are behind the current tests, and Stage 3 is behind a switch.

User data. Electron keeps settings and the scan cache in its own app data folder. The Tauri pages read for this plan do not say where Tauri keeps app data, so Stage 1 finds the path and records it. Before the exit of Stage 6, one of two things must hold. Either both shells find the same data, or a migration and a reverse migration exist and are tested. The Tauri updater page describes no downgrade. So the downgrade step in Stage 6 is a manual step that the plan writes down and tests.

## Security

The move changes the security model. These items are deliverables of Stage 4. Each has a mapping from the Electron rule to the Tauri rule:
- The call guard, the argument-count table, and the refusal codes.
- The state "the plan shown last" and the refusal `NOT_THE_PLAN_SHOWN`.
- The custom page scheme, the content security policy, and the permission refusal.
- The Electron fuses and the `contextBridge` objects, mapped to Tauri capabilities and the sidecar argument rules.
- The test-only dialog switch and the embedded WebDriver server of Gate 3. Neither is compiled into a release build. A check in the release job confirms this against the built binary, in the same way as `tools/check-fuses.mjs`. No workflow builds the desktop app today, so the release job is future work.
- The channel between the shell and the sidecar. It needs a way to stop other local programs from calling the sidecar. Open question 2 covers the choice.

The maintainer signs off the reviews at Stage 3, at Stage 4, before the exit of Stage 5, and before Stage 7 for each platform. No Tauri build becomes the default without them. No alpha build from Stage 4 or Stage 5 is published before Stage 6 meets its exit rule. A public repository keeps CI artifacts readable by anyone signed in to GitHub, so alpha builds are not kept there. They sit in private storage that only the maintainer can reach. Stage 1 builds, including the notarized build of Part B, stay on the maintainer's machine or in the same private storage.

## Builds, signing, and the updater

- Today: macOS builds are ad-hoc signed, Windows and Linux builds are unsigned, and the app has no updater.
- Tauri on macOS: the documents require a Developer ID certificate and notarization for distribution. That means the paid Apple program. This is a spend, so it needs the maintainer. The Gate 1 notarized build waits for that approval. Without it, Part B fails for macOS.
- Tauri on Windows: a code-signing certificate is not required to run, but without one users see SmartScreen warnings. Signing a Windows build from another system needs a custom signing command. This is also a spend.
- Tauri on Linux: AppImage is today's target. The documents describe signing only for AppImage.
- The Tauri updater is a new feature, not a port. It needs a signing key pair and an endpoint. Whether the first Tauri release ships it is a decision.
- Key rules for this plan: the updater private key and the certificates live in the secret storage of the build system and never in the repository. The updater page says the key is read from the environment at build time. Protect the updater key with a passphrase, back it up, plan how to rotate it, and let only the release jobs read it.

## How this fits the 0.9 plan

- The 0.9 plan (pull request 162) rebuilds the interface on a new extensions API and ships the screens as removable default extensions.
- The rebuilt interface needs a transport-neutral call layer. Stage 2 builds that layer, so the rebuild works on both shells.
- Order is a decision: move the shell first, rebuild the interface first, or do both on the same layer.
- The CLI and other hosts stay first-class. The Node core with its defined protocol serves all of them. A criterion in Gate 1 keeps the core and the CLI tests running with no shell.

## Risks that are not gated

- Two toolchains (Rust and Node) raise the cost for contributors.
- WebView2 and WKWebView update on their own schedules, so a user can run a webview version that was never tested.
- Accessibility behavior on `webkit2gtk` is not measured.
- The sidecar adds a binary to each build. Its size is not measured.

## Open questions

Each question becomes its own decision comment on the pull request.

1. Goal weighting: performance, size, and cross-platform reach. Not answered. Not decided here.
2. The protocol between the shell and the sidecar, and how the sidecar knows its caller: standard input and output lines, a local socket, or another way.
3. Where the state "the plan shown last" lives: in the shell or in the sidecar.
4. How to package and start Node: one compiled binary, or a runtime plus the JavaScript as a resource. This also decides how Stage 3 starts the child under Electron. Part C can reopen it.
5. The order against the interface rebuild.
6. Which platform moves first, and whether any platform stays on Electron.
7. The proposed gate thresholds: every number marked "proposal", the key screens, and the screenshot viewport. Also the pixel limit after the baseline and trial runs, and any visual or performance check that Gate 2 adds on macOS or Windows.
8. The updater in the first Tauri release, and the signing spend for Apple and Windows.
9. The end-to-end tool: WebdriverIO with the Tauri service, or another tool.
10. The supported platforms: the named test distributions, the supported macOS, Windows, and Linux versions, the lowest `webkit2gtk` version in that set, and the reference machine. The supported minimum must also be a version that its vendor still patches for security. Gate 2 records the patch state of each tested version, for Linux, macOS, and Windows.
