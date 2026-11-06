/** Electron entry. Opens one window onto the app's page. The launch (main/launch.ts) decides which bridge the window gets and which calls main answers. */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVER_NAME } from './approver.js';
import { launchOf } from './launch.js';
import { realFolderFollowing } from './real-fs.js';
import { registerRealIpc, usableHome } from './real-ipc.js';
import { registerEngineIpc } from './engine-ipc.js';
import { diagnosticsEnv, enginePreviewSwitch, engineStateRoot } from './engine-state.js';
import { createRecorder } from './engine-events.js';
import { shippedKits } from './kit.js';
import { NOTES_DIALOG } from './notes-dialog.js';
import { helpMenu } from './help-menu.js';
import { reportProblem, showUsageLog } from './diagnostics-dialogs.js';
import type { DialogDeps } from './diagnostics-dialogs.js';
import { execFileRunner } from '../../../packages/diagnostics/src/index.js';
import { withSamplePreviewEngines } from '../shared/engine/sample-switch.js';
import { e2eHidden, leaveDock, quietDialogs, revealWindow, windowOptions } from './window-options.js';
import { windowFailure } from './window-failure.js';
import { bringForBox, closeGuard } from './close-guard.js';
import { quitHold } from './quit-hold.js';
import { stderrErrorHandler } from './stderr-guard.js';
import type { EngineService } from './engine-service.js';
import { APP_HOST, APP_INDEX, APP_SCHEME, allowRequest, chooseUserData, decideNavigation, makeTempDataDir, removeAndReport, resolveAppFile, userDataArg, webPreferences } from './security.js';

const root = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(root, 'renderer');
const indexUrl = APP_INDEX;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json; charset=utf-8', '.ttf': 'font/ttf' };
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true } }]);

const argv = process.argv.slice(1);
// What this start is: the app on the person's own folders (no flag), or the sample (--sample). A flag that looks like a mode flag and is not exactly known refuses the start: it never falls
// through to the app on the person's own folders. See main/launch.ts.
const launch = launchOf(argv);
// A write to a closed stderr (a parent that went away) is an async EPIPE; without a listener it would crash main. EPIPE is ignored; any other code is tried once on the console, then ignored.
process.stderr.on('error', stderrErrorHandler());
// A test start with --e2e-hidden shows no window and no Dock icon (main/window-options.ts). It changes nothing else. It comes first so that a refused test start shows no icon either.
leaveDock(app, argv);
// A hidden start shows no native box: every box writes to stderr and answers with the choice that keeps data (main/window-options.ts). It comes before any box can show.
quietDialogs(dialog, argv, text => { process.stderr.write(text); });
// app.exit does not stop this script, so process.exit(2) ends it on the spot: nothing below runs for a refused start.
if (launch.refusal !== null) { process.stderr.write(`${launch.refusal}\n`); app.exit(2); process.exit(2); }
// The app on the person's own folders keeps Electron's normal data folder, which lasts between starts. The made-up launch (the sample) writes nothing to the real app data,
// whoever starts it: it keeps its own temporary data folder (or the one it was given, when that is one of its own), and removes it when the app quits. The launcher does the same;
// this keeps the promise when the app is started without it. Not caught: a hard kill (SIGKILL, a crash, a power cut) leaves the folder, and the browser engine writes a few small
// files (Local State, Preferences) after the quit event. The folder holds only browser settings and cache, and the system clears its temporary folder.
if (launch.temporaryData) {
  try {
    const choice = chooseUserData(userDataArg(argv), tmpdir());
    const dir = choice.action === 'keep' ? choice.dir : makeTempDataDir();
    if (choice.action === 'make') app.setPath('userData', dir);
    // Says on stderr when the folder is still there after the attempt, so the person can delete it.
    const cleanUp = (): void => { removeAndReport(dir); };
    app.once('quit', cleanUp);
    process.once('exit', cleanUp);
  } catch (error) { startupFailed(error); }
}

let window: BrowserWindow | null = null;

function hardenContents(contents: Electron.WebContents): void {
  // Navigation is never allowed: only the app's own page stays. The page opens no outside link; the Help menu opens its few links through the allowlist of main/diagnostics-dialogs.ts.
  contents.on('will-navigate', (event, url) => {
    if (decideNavigation(url, indexUrl) !== 'allow-app') event.preventDefault();
  });
  contents.on('will-frame-navigate', (event) => {
    const verdict = decideNavigation(event.url, indexUrl);
    if (verdict !== 'allow-app') event.preventDefault();
  });
  contents.on('will-redirect', event => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', event => event.preventDefault());
}

/** A start that failed, or a page that did not load, must not leave a process with no window and no word. Say so on stderr and in a box, then exit with an error. */
function startupFailed(error: unknown, title = 'Bowerloom could not start'): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${title}: ${message}\n`);
  try { dialog.showErrorBox(title, message); } catch { /* no box could be shown; stderr has the message */ }
  app.exit(1);
}

/** The engine calls of this launch, once registered; null for a launch with none. A window that dies waits for this to be idle (main/window-failure.ts). */
let engineForExit: EngineService | null = null;

/** True once a failed window has started the quit of the app. The close guard then lets the unload go on without a box (main/close-guard.ts). */
let closeEnding = false;

/**
 * A window that died, or a page that did not load, once the app is running. A write may be in progress, so this never ends the process at once: it waits for the
 * engine to be idle, shows the box, and quits through app.quit(), so before-quit and quit run. app.exit is for start-up failures only (startupFailed).
 */
const windowEnded = windowFailure({
  get engine() { return engineForExit; },
  say: text => { process.stderr.write(text); },
  showBox: (title, message) => { dialog.showErrorBox(title, message); },
  setExitCode: code => { process.exitCode = code; },
  markEnding: () => { closeEnding = true; },
  quit: () => app.quit(),
});
function windowFailed(error: Error, title: string): Promise<void> { return windowEnded(error, title); }

// A quit while the engine works (an import or an export writing) waits for it, up to a bound, with a box (main/quit-hold.ts).
const quitHeld = quitHold({
  get engine() { return engineForExit; },
  ending: () => closeEnding,
  showBox: words => {
    const options: Electron.MessageBoxOptions = { type: 'info', title: words.title, message: words.message, detail: words.detail, buttons: [words.button], defaultId: 0, noLink: true };
    void (window === null ? dialog.showMessageBox(options) : dialog.showMessageBox(window, options)).catch((error: unknown) => { console.error('Bowerloom: the box about a save that is finishing failed.', error instanceof Error ? error.message : String(error)); });
  },
  quit: () => app.quit(),
  // The backstop: a quit that the hold started and that never reached will-quit ends here with code 1. app.exit skips will-quit and quit, so the clean-up of the quit event runs first.
  exit: code => {
    try {
      if (engineForExit === null) process.stderr.write('Bowerloom: no engine to clean up before the backstop exit.\n');
      else engineForExit.clearReportCopies();
    } catch (error) { process.stderr.write(`Bowerloom: the clean-up before the backstop exit failed: ${error instanceof Error ? error.message : String(error)}\n`); }
    app.exit(code);
  },
});
app.on('before-quit', quitHeld);
app.on('will-quit', quitHeld.reachedWillQuit);
app.on('window-all-closed', quitHeld.windowsClosed);

function createWindow(): void {
  window = new BrowserWindow({
    ...windowOptions(), useContentSize: true, show: false,
    backgroundColor: '#f6f5f0',
    // A made-up launch gets no bridge at all: no preload, so nothing to call even if a channel were open. The others get the one bridge of the launch (preload-real.cjs).
    webPreferences: webPreferences(launch.preload === 'real' ? join(root, 'preload-real.cjs') : undefined, app.isPackaged),
  });
  // A bridge that does not load must stop here, not open as a window that looks as if it could read: a failed preload ends in the same box as any other failed start.
  if (launch.preload === 'real') window.webContents.on('preload-error', (_event, _path, error) => startupFailed(error));
  // A window whose page process died, or whose page did not load, must not stay open and blank: it ends in a box too, but only after any write in progress has finished (windowFailed). A clean exit and a cancelled load (code -3) are not failures.
  window.webContents.on('render-process-gone', (_event, details) => { if (details.reason !== 'clean-exit') void windowFailed(new Error(`The window stopped (${details.reason}). Open Bowerloom again.`), 'Bowerloom stopped'); });
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => { if (isMainFrame && code !== -3) void windowFailed(new Error(`The window could not load its page (${description}).`), 'Bowerloom could not start'); });
  window.once('ready-to-show', () => { if (window !== null) revealWindow(window, argv); });
  // Unsaved Builder changes: the window holds its own unload, and Electron cancels that unload without a word unless main handles this event. Main asks "Discard N changes?" in its own
  // box, at once (this event is answered when the handler returns, so the box is the synchronous one). Closing the window, a reload and Cmd+Q (app.quit closes each window through
  // the same unload) all come here. The window has no channel to skip the box or answer it; it only names a count in its page title (main/close-guard.ts).
  const win = window;
  win.webContents.on('will-prevent-unload', closeGuard({ title: () => win.webContents.getTitle(), ending: () => closeEnding, kept: () => { quitHeld.cancelled(); process.stderr.write('Bowerloom: a window kept its unsaved changes, so the close or quit stopped.\n'); }, reveal: () => bringForBox(win, !e2eHidden(argv)), ask: options => dialog.showMessageBoxSync(win, { ...options, buttons: [...options.buttons] }) }));
  // The app is called "Bowerloom" from the first moment: the page title it loads with never reaches the title bar.
  window.on('page-title-updated', event => event.preventDefault());
  window.on('closed', () => { window = null; });
  window.loadURL(`${indexUrl}${launch.hash}`).catch(startupFailed);
}

/** The tools of the two Help dialogs. Links go through the same allowlist as every other link of the app (main/diagnostics-dialogs.ts). */
function diagnosticsDeps(): DialogDeps {
  const home = homedir();
  return {
    stateRoot: engineStateRoot(home), home, env: diagnosticsEnv(), appVersion: app.getVersion(), platform: process.platform, run: execFileRunner, now: () => new Date(),
    showMessage: options => { const o = { ...options, buttons: [...options.buttons] }; return window === null ? dialog.showMessageBox(o) : dialog.showMessageBox(window, o); },
    showSave: options => (window === null ? dialog.showSaveDialog(options) : dialog.showSaveDialog(window, options)),
    openExternal: url => shell.openExternal(url),
    copyText: text => clipboard.writeText(text),
  };
}

app.on('web-contents-created', (_event, contents) => hardenContents(contents));

app.whenReady().then(async () => {
  // The page is served by the app itself, from its own renderer folder only.
  protocol.handle(APP_SCHEME, async request => {
    // Every launch serves the same page, index.html, with the same policy. A launch differs only in the address and in the bridge its window gets.
    const url = new URL(request.url), file = url.host === APP_HOST ? resolveAppFile(rendererDir, url.pathname) : null;
    const type = file === null ? undefined : TYPES[file.slice(file.lastIndexOf('.'))];
    if (file === null || type === undefined) return new Response('Not found', { status: 404 });
    try {
      const bytes = await readFile(file);
      const body = launch.samplePreviewEngines && url.pathname === '/index.html' ? withSamplePreviewEngines(bytes.toString('utf8'), true) : bytes;
      return new Response(body, { headers: { 'content-type': type } });
    } catch (error) {
      console.error(`Bowerloom: a file of the app could not be read (${typeof (error as { code?: unknown } | null)?.code === 'string' ? String((error as { code: string }).code) : 'no code'}).`);
      return new Response('Not found', { status: 404 });
    }
  });
  // No request leaves the machine: the session cancels everything that is not one of the app's own files.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowRequest(details.url, root) }));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler(() => false);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    // The File menu holds Close Window (Cmd+W) on a Mac and Quit elsewhere. Closing goes through the same unsaved-changes question as Cmd+Q.
    { role: 'fileMenu' as const },
    { role: 'editMenu' as const },
    { label: 'View', submenu: [{ role: 'zoomIn' as const }, { role: 'zoomOut' as const }, { role: 'resetZoom' as const }, { type: 'separator' as const }, { role: 'togglefullscreen' as const }] },
    { role: 'windowMenu' as const },
    helpMenu({ report: () => { void reportProblem(diagnosticsDeps()).catch(error => console.error('Report a problem failed.', error)); }, usage: () => { void showUsageLog(diagnosticsDeps()).catch(error => console.error('Usage log failed.', error)); } }),
  ]));
  if (launch.realReader) {
    const home = usableHome(homedir(), path => realFolderFollowing(path) !== null);
    if (home === null) throw new Error('Bowerloom needs a home folder to look in. HOME is not set to a folder that exists.');
    registerRealIpc({
      ipc: ipcMain, appIndexUrl: indexUrl, home,
      chooseFolder: async () => {
        const options: Electron.OpenDialogOptions = { title: 'Choose a folder to look in', buttonLabel: 'Look in this folder', properties: ['openDirectory'] };
        const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
        return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
      },
    });
    // The adopt and install sheets of the harness-first window. They plan read-only, and write only through the packages, with the revision of a plan the person approved.
    if (launch.engineCalls) {
      const engine = registerEngineIpc({
        ipc: ipcMain, appIndexUrl: indexUrl, home, stateRoot: engineStateRoot(home), who: APPROVER_NAME,
        // Beta.1: OpenCode, Pi, and DeepSeek Harness install only when the app starts with BOWERLOOM_PREVIEW_ENGINES=1. The window gets one yes or no, never the environment.
        previewEngines: enginePreviewSwitch(),
        // A share write that comes back from its dialog after a quit began is refused (main/engine-bundle.ts).
        quitBegun: () => quitHeld.begun(),
        // The local usage log: lines about what was done, never a name or a path. BOWERLOOM_EVENT_LOG=off turns it off.
        record: createRecorder({ stateRoot: engineStateRoot(home), env: diagnosticsEnv(), home }),
        // Main's own question before every write (U16): words main builds from its record of the plan; the window cannot word or skip it.
        confirm: async ask => {
          const options: Electron.MessageBoxOptions = { type: 'question', title: ask.title, message: ask.message, detail: ask.detail, buttons: ['Cancel', ask.button ?? 'Write'], defaultId: 0, cancelId: 0, noLink: true };
          const result = window === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(window, options);
          return result.response === 1;
        },
        chooseFolder: async () => {
          const options: Electron.OpenDialogOptions = { title: 'Choose a project folder', buttonLabel: 'Choose this folder', properties: ['openDirectory'] };
          const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
          return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
        },
        // Main's own dialogs for export and import (journey 4). Each answers a path to main only. A bundle file is a .json; the save dialog suggests <harness id>.bowerloom.json.
        chooseBundleOpen: async () => {
          const options: Electron.OpenDialogOptions = { title: 'Choose a harness file', buttonLabel: 'Read this file', properties: ['openFile'], filters: [{ name: 'Harness file', extensions: ['json'] }] };
          const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
          return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
        },
        chooseBundleSave: async suggested => {
          const options: Electron.SaveDialogOptions = { title: 'Save the harness file', buttonLabel: 'Save', defaultPath: suggested, showsTagField: false, filters: [{ name: 'Harness file', extensions: ['json'] }] };
          const result = window === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options);
          return result.canceled || result.filePath === undefined || result.filePath === '' ? null : result.filePath;
        },
        // Main's own notes chooser: its words come from main, never from the window. "Start fresh" lets the person make a new folder in it.
        chooseNotesFolder: async purpose => {
          const words = NOTES_DIALOG[purpose];
          const options: Electron.OpenDialogOptions = { title: words.title, message: words.message, buttonLabel: words.button, properties: purpose === 'start' ? ['openDirectory', 'createDirectory'] : ['openDirectory'] };
          const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
          return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
        },
        // The ready-made kits ship read-only: from the repository in development, from the app's resources in a packaged build. A broken kit is told on
        // the console now, and every call that needs it refuses with words; it is never replaced by an empty kit.
        kitsDir: shippedKits({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appRoot: root }),
        // The tidy-up report of a notes folder, which main found and checked itself, opens in the app the computer uses for it. The window never names a path.
        // Main passes its own private copy of the report here, never the report itself (main/notes-report.ts).
        openPath: path => shell.openPath(path),
      });
      engineForExit = engine;
      // Main's private copies of tidy-up reports go when the app quits. A copy left by a hard kill stays in the person's own temporary folder.
      app.once('quit', () => { try { engine.clearReportCopies(); } finally { void engine.close(); } });
    }
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(startupFailed);

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
