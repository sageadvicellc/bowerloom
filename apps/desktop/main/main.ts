/** Electron entry. Opens one window onto the app's page. The launch (main/launch.ts) decides which bridge the window gets and which calls main answers. */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { windowOptions } from './window-options.js';
import { APP_HOST, APP_INDEX, APP_SCHEME, allowRequest, chooseUserData, decideNavigation, makeTempDataDir, removeAndReport, resolveAppFile, userDataArg, webPreferences } from './security.js';

const root = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(root, 'renderer');
const indexUrl = APP_INDEX;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json; charset=utf-8' };
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true } }]);

const argv = process.argv.slice(1);
// What this start is: the app on the person's own folders (no flag), or the sample (--sample). A flag that looks like a mode flag and is not exactly known refuses the start: it never falls
// through to the app on the person's own folders. See main/launch.ts.
const launch = launchOf(argv);
if (launch.refusal !== null) { process.stderr.write(`${launch.refusal}\n`); app.exit(2); }
// The app on the person's own folders keeps Electron's normal data folder, which lasts between starts. The made-up launch (the sample) writes nothing to the real app data,
// whoever starts it: it keeps its own temporary data folder (or the one it was given, when that is one of its own), and removes it when the app quits. The launcher does the same;
// this keeps the promise when the app is started without it. Not caught: a hard kill (SIGKILL, a crash, a power cut) leaves the folder, and the browser engine writes a few small
// files (Local State, Preferences) after the quit event. The folder holds only browser settings and cache, and the system clears its temporary folder.
if (launch.temporaryData) {
  const choice = chooseUserData(userDataArg(argv), tmpdir());
  const dir = choice.action === 'keep' ? choice.dir : makeTempDataDir();
  if (choice.action === 'make') app.setPath('userData', dir);
  // Says on stderr when the folder is still there after the attempt, so the person can delete it.
  const cleanUp = (): void => { removeAndReport(dir); };
  app.once('quit', cleanUp);
  process.once('exit', cleanUp);
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
function startupFailed(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Bowerloom could not start: ${message}\n`);
  try { dialog.showErrorBox('Bowerloom could not start', message); } catch { /* no box could be shown; stderr has the message */ }
  app.exit(1);
}

function createWindow(): void {
  window = new BrowserWindow({
    ...windowOptions(), useContentSize: true, show: false,
    backgroundColor: '#f6f5f0',
    // A made-up launch gets no bridge at all: no preload, so nothing to call even if a channel were open. The others get the one bridge of the launch (preload-real.cjs).
    webPreferences: webPreferences(launch.preload === 'real' ? join(root, 'preload-real.cjs') : undefined, app.isPackaged),
  });
  // A bridge that does not load must stop here, not open as a window that looks as if it could read: a failed preload ends in the same box as any other failed start.
  if (launch.preload === 'real') window.webContents.on('preload-error', (_event, _path, error) => startupFailed(error));
  window.once('ready-to-show', () => window?.show());
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
    } catch { return new Response('Not found', { status: 404 }); }
  });
  // No request leaves the machine: the session cancels everything that is not one of the app's own files.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowRequest(details.url, root) }));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler(() => false);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' as const },
    { label: 'View', submenu: [{ role: 'zoomIn' as const }, { role: 'zoomOut' as const }, { role: 'resetZoom' as const }, { type: 'separator' as const }, { role: 'togglefullscreen' as const }] },
    { role: 'windowMenu' as const },
    helpMenu({ report: () => { void reportProblem(diagnosticsDeps()).catch(error => console.error('Report a problem failed.', error)); }, usage: () => { void showUsageLog(diagnosticsDeps()).catch(error => console.error('Usage log failed.', error)); } }),
  ]));
  if (launch.realReader) {
    const home = usableHome(homedir(), path => realFolderFollowing(path) !== null);
    if (home === null) throw new Error('The real setup reader needs a home folder. HOME is not set to a folder that exists.');
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
        ipc: ipcMain, appIndexUrl: indexUrl, home, stateRoot: engineStateRoot(home), who: userInfo().username || 'this Mac',
        // Beta.1: OpenCode, Pi, and DeepSeek Harness install only when the app starts with BOWERLOOM_PREVIEW_ENGINES=1. The window gets one yes or no, never the environment.
        previewEngines: enginePreviewSwitch(),
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
      // Main's private copies of tidy-up reports go when the app quits. A copy left by a hard kill stays in the person's own temporary folder.
      app.once('quit', () => engine.clearReportCopies());
    }
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(startupFailed);

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
