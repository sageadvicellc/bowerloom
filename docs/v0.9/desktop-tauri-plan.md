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
- The page makes 3 reader calls and 37 engine calls. The names are in `shared/real/types.ts` and `shared/engine/types.ts`. Each call has a fixed argument count (`ENGINE_ARITY`) and a short list of refusal codes. The refusal codes are `NOT_ALLOWED`, `BAD_ARGUMENT`, `UNKNOWN_FOLDER`, `UNKNOWN_BUNDLE`, and `FAILED`.
- The main process keeps state across calls. It refuses a write that is not the plan it showed last (`NOT_THE_PLAN_SHOWN`).
- The renderer imports nothing from `electron` or Node. A search found 0 such files.

Electron features in use:
- Dialogs, in 7 files of `main`: message boxes, error boxes, open and save dialogs.
- A close guard that handles `will-prevent-unload`.
- A custom page scheme, registered with `protocol.registerSchemesAsPrivileged` and served with `protocol.handle`.
- A request filter (`webRequest.onBeforeRequest`) and a permission handler that refuses every request.
- A content security policy in `renderer/index.html` that allows only the app's own scripts, styles, fonts, and data images.
- The clipboard (3 files), `shell.openExternal` (1 file), and the dock icon.
- Hidden windows for tests, through a `--e2e-hidden` switch.

Not in use: an auto-updater, `safeStorage`, the power monitor, and notifications.

Packaging today (`apps/desktop/package.json`):
- macOS: dmg and zip for arm64 and x64, with ad-hoc signing (`identity: "-"`) and no hardened runtime.
- Windows: NSIS.
- Linux: AppImage.
- Electron fuses are set, and asar integrity is on. `tools/check-fuses.mjs` checks them.
- Extra resources: the `kits` folder and the dock images.

Tests and CI:
- 142 unit test files and 48 end-to-end specs under `apps/desktop`.
- The end-to-end tests use Playwright with one worker. Three spec files use the Electron launch API (`_electron`).
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
- The renderer talks to the shell, and the shell talks to the sidecar. The call set stays the same: the 3 reader calls and the 37 engine calls, with the same argument counts and refusal codes.
- The shell owns windows, dialogs, the clipboard, opening links, the page scheme and security policy, the close guard, the dock icon, and the updater.
- The CLI, the desktop shell, and other hosts all talk to the same Node core through one defined protocol. The core must run with no shell at all.

## The three early gates

Each gate has pass and fail criteria. A gate that fails keeps the desktop app on Electron. Numbers marked "proposal" are not measured. The maintainer approves them in a decision comment.

### Gate 1: a long-lived Node sidecar

Risk: the Tauri documents give no advice on lifecycle, and the Node example is short-lived.

If all of these hold on macOS, Windows, and Linux, the gate passes:
- The Node core builds as one binary for each target triple, or as a runtime plus resource, and the shell starts it.
- A ping call returns, and a large payload returns whole. The largest payload is the biggest scan result that the app handles today. Measure it on Electron first.
- Events stream from the sidecar to the page without loss.
- The shell restarts a killed sidecar. The app recovers in 5 seconds or less (proposal), and no call hangs. This holds across 100 kill-and-restart cycles in a row (proposal).
- No orphan sidecar remains after a normal quit, a forced quit, or a shell crash.
- The sidecar works from an install path with spaces and non-ASCII characters.
- Packaging works inside a signed macOS app, a Windows installer, and a Linux AppImage.

If any criterion fails and has no fix inside the plan, the gate fails.

### Gate 2: the Linux web view

Risk: Linux uses `webkit2gtk`, and Electron bundles its own Chromium.

If all of these hold on at least two named Linux distributions with different `webkit2gtk` versions, the gate passes:
- Every web feature in "Web features the renderer uses" works. The test names each one.
- The custom page scheme, the content security policy, and the permission refusal work.
- Screenshots of the key screens match the Electron screenshots within a tolerance (proposal: a pixel difference limit set with the maintainer).
- Scrolling, animation, and text input work on a reference machine. No frame drops that the test counts as a failure (proposal).
- The gate records the lowest `webkit2gtk` version that passes. The Tauri documents give no minimum, so this gate sets one.

If a blocking feature gap has no workaround, the gate fails. If the lowest passing version is newer than the main Linux distributions ship, the gate fails.

### Gate 3: the end-to-end test path

Risk: the 48 Playwright specs depend on Electron. The Tauri route is WebDriver, and the documents do not mention Playwright.

If all of these hold, the gate passes:
- A slice of at least 8 specs (proposal) runs green through WebdriverIO on macOS, Windows, and Linux. The slice covers launch, folder pick with a stubbed dialog, an adoption plan and run, the close guard, and the scan cache.
- Each slice run passes 10 times in a row (proposal).
- A hidden or headless way to run exists for CI.
- The plan lists which specs use the Electron API (`_electron`) and what replaces each use.

If macOS needs a paid vendor key that the maintainer does not approve, the gate fails. If the flake rate stays above the limit, the gate fails.

## Stages

Each stage has an exit rule and a rollback point. Until a gate passes, nothing ships from the Tauri path.

1. **Stage 0: answers.** The maintainer answers the decisions. Rollback: none needed.
2. **Stage 1: the gates.** Run the three gates in a spike branch. Product code does not change. Exit: a written result for each gate. Rollback: delete the spike branch. Electron is untouched.
3. **Stage 2: a call layer that does not depend on Electron.** Put the 40 calls behind one interface in the renderer. Electron still implements it. Exit: all current tests pass. Rollback: revert the change.
4. **Stage 3: the core in its own process, under Electron.** Run the Node core as a child process of the Electron app, behind a switch. Exit: all current tests pass with the switch on. Rollback: turn the switch off. The in-process path stays.
5. **Stage 4: a Tauri shell alpha.** Build the shell in parallel with a subset of calls. Electron stays the default build. Rollback: stop building the shell.
6. **Stage 5: parity.** All 40 calls, dialogs, and the close guard work in Tauri. The end-to-end slice grows to every spec that still applies. Rollback: Electron stays the default.
7. **Stage 6: builds, signing, and the updater.** Produce signed builds on the three systems. Decide on the updater. Rollback: Electron builds stay available.
8. **Stage 7: the default switch, one platform at a time.** Keep an Electron build for one release after each switch. Rollback: restore the Electron build as the default.
9. **Stage 8: retire Electron.** Only the maintainer starts this stage. Nothing is deleted before it.

What stays on Electron: everything, until its gate passes. After a gate passes, only the platforms that passed it move, and only at Stage 7.

## Builds, signing, and the updater

- Today: macOS builds are ad-hoc signed, Windows and Linux builds are unsigned, and the app has no updater.
- Tauri on macOS: the documents require a Developer ID certificate and notarization for distribution. That means the paid Apple program. This is a spend, so it needs the maintainer.
- Tauri on Windows: a code-signing certificate is not required to run, but without one users see SmartScreen warnings. This is also a spend.
- Tauri on Linux: AppImage is today's target. The documents describe signing only for AppImage.
- The Tauri updater is a new feature, not a port. It needs a signing key pair and an endpoint. Whether the first Tauri release ships it is a decision.
- Building for macOS needs an Apple device. Signing a Windows build from another system needs a custom signing command.

## How this fits the 0.9 plan

- The 0.9 plan (pull request 162) rebuilds the interface on a new extensions API and ships the screens as removable default extensions.
- The rebuilt interface needs a transport-neutral call layer. Stage 2 builds that layer, so the rebuild works on both shells.
- Order is a decision: move the shell first, rebuild the interface first, or do both on the same layer.
- The CLI and other hosts stay first-class. The Node core with its defined protocol serves all of them. A criterion in Gate 1 keeps the core runnable with no shell, and the CLI tests keep running on the core alone.

## Risks that are not gated

- Two toolchains (Rust and Node) raise the cost for contributors.
- Security rules move. Electron fuses and the `contextBridge` become Tauri capabilities and sidecar argument rules. A security review is needed at Stage 4.
- WebView2 and WKWebView update on their own schedules, so a user can run a webview version that was never tested.
- Accessibility behavior on `webkit2gtk` is not measured.
- The sidecar adds a binary to each build. Its size is not measured.

## Open questions

Each question becomes its own decision comment on the pull request.

1. Goal weighting: performance, size, and cross-platform reach. Not answered. Not decided here.
2. The protocol between the shell and the sidecar: standard input and output lines, a local socket, or another way.
3. Where the "plan shown last" state lives: in the shell or in the sidecar.
4. How to package Node: one compiled binary, or a runtime plus the JavaScript as a resource.
5. The order against the interface rebuild.
6. Which platform moves first, and whether any platform stays on Electron.
7. The proposed gate thresholds.
8. The updater in the first Tauri release, and the signing spend for Apple and Windows.
9. The end-to-end tool: WebdriverIO with the Tauri service, or another tool.
