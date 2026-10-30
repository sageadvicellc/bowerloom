/** Electron entry. Opens one window onto the viewer page and answers its named calls. */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS } from '../shared/channels.js';
import type { ChannelName } from '../shared/channels.js';
import type { Mode } from '../shared/types.js';
import { REAL_HASH } from '../shared/real/types.js';
import { createController } from './controller.js';
import type { Controller } from './controller.js';
import { realFolderFollowing } from './real-fs.js';
import { registerRealIpc, usableHome } from './real-ipc.js';
import { registerEngineIpc } from './engine-ipc.js';
import { diagnosticsEnv, enginePreviewSwitch, engineStateRoot } from './engine-state.js';
import { createRecorder } from './engine-events.js';
import { helpMenu } from './help-menu.js';
import { reportProblem, showUsageLog } from './diagnostics-dialogs.js';
import type { DialogDeps } from './diagnostics-dialogs.js';
import { execFileRunner } from '../../../packages/diagnostics/src/index.js';
import { SAMPLE_PREVIEW_FLAG, withSamplePreviewEngines } from '../shared/engine/sample-switch.js';
import { windowOptions } from './window-options.js';
import { APP_HOST, APP_INDEX, APP_SCHEME, allowRequest, chooseUserData, decideNavigation, isAllowedSender, makePrototypeDataDir, removeAndReport, resolveAppFile, userDataArg, webPreferences } from './security.js';

const root = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(root, 'renderer');
const indexUrl = APP_INDEX;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json; charset=utf-8' };
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true } }]);

const argv = process.argv.slice(1);
// The clickable prototype (Bowerloom 0.8): the same page with #prototype added, and no IPC at all.
// The home app prototype (--prototype-v2) is treated the same way: no preload, no IPC, a temporary data folder, and no external links.
const prototypeV2 = argv.includes('--prototype-v2');
// The read-only reader of a real setup (--prototype-real) keeps every prototype lock below and adds one thing: a preload with three named calls (main/real-ipc.ts).
const prototypeReal = argv.includes('--prototype-real');
// The harness-first preview (--prototype-v3) keeps the same locks as --prototype-v2: no preload, no IPC, a temporary data folder, no outside link, and nothing written.
const prototypeV3 = argv.includes('--prototype-v3');
// The harness-first preview on the person's own folders (--prototype-v3-real) has the same locks and the same bridge as --prototype-real, and opens the harness-first page.
// It also answers the adopt and install sheets (main/engine-ipc.ts): those read only until a person approves a plan, and then write through the packages.
const prototypeV3Real = argv.includes('--prototype-v3-real');
// Beta.1: the e2e specs that install to OpenCode start the sample launch with this argument. Never the launch on the person's own folders, never the environment.
const samplePreviewEngines = prototypeV3 && !prototypeV3Real && argv.includes(SAMPLE_PREVIEW_FLAG);
const prototypeMode = argv.includes('--prototype') || prototypeV2 || prototypeReal || prototypeV3 || prototypeV3Real;
// The prototype writes nothing to the real app data, whoever starts it. (The adopt and install sheets of --prototype-v3-real are the one exception, and
// not in app data: after a person approves a plan and says yes in main's own dialog, they write in the folder the person chose and in Bowerloom's private
// state folder, through the packages; see main/engine-service.ts.) It keeps its own temporary data folder (or the one it was given, when that
// is one of its own), and removes it when the app quits. The launcher does the same; this keeps the promise when the app is started without it.
// Not caught: a hard kill (SIGKILL, a crash, a power cut) leaves the folder, and the browser engine writes a few small files (Local State, Preferences)
// after the quit event, so a start without the launcher can leave those four files. The launcher removes the folder again once the app has exited.
// The folder holds only browser settings and cache, never prototype data, and the system clears its temporary folder.
if (prototypeMode) {
  const choice = chooseUserData(userDataArg(argv), tmpdir());
  const dir = choice.action === 'keep' ? choice.dir : makePrototypeDataDir();
  if (choice.action === 'make') app.setPath('userData', dir);
  // Says on stderr when the folder is still there after the attempt, so the person can delete it.
  const cleanUp = (): void => { removeAndReport(dir); };
  app.once('quit', cleanUp);
  process.once('exit', cleanUp);
}
const forcedMode: Mode | null = argv.includes('--sample-data') ? 'sample' : argv.includes('--real-data') ? 'real' : argv.includes('--sandbox') ? 'sandbox' : null;

let controller: Controller;
let window: BrowserWindow | null = null;

function hardenContents(contents: Electron.WebContents): void {
  contents.on('will-navigate', (event, url) => {
    const verdict = decideNavigation(url, indexUrl);
    if (verdict === 'allow-app') return;
    event.preventDefault();
    if (verdict === 'open-external' && !prototypeMode) void controller.openLink(url);
  });
  contents.on('will-frame-navigate', (event) => {
    const verdict = decideNavigation(event.url, indexUrl);
    if (verdict !== 'allow-app') event.preventDefault();
  });
  contents.on('will-redirect', event => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, indexUrl) === 'open-external' && !prototypeMode) void controller.openLink(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', event => event.preventDefault());
}

/** A start that failed, or a page that did not load, must not leave a process with no window and no word. Say so on stderr and in a box, then exit with an error. */
function startupFailed(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${prototypeMode ? 'Bowerloom prototype' : 'Bowerloom'} could not start: ${message}\n`);
  try { dialog.showErrorBox(prototypeMode ? 'Bowerloom prototype could not start' : 'Bowerloom could not start', message); } catch { /* no box could be shown; stderr has the message */ }
  app.exit(1);
}

function createWindow(): void {
  window = new BrowserWindow({
    ...windowOptions(prototypeV2 || prototypeReal || prototypeV3 || prototypeV3Real), useContentSize: true, show: false,
    backgroundColor: '#f6f5f0',
    // The prototype page gets no bridge at all: no preload, so no `window.bowerloom`, and nothing to call even if a channel were open.
    webPreferences: prototypeReal || prototypeV3Real ? webPreferences(join(root, 'preload-real.cjs'), app.isPackaged) : webPreferences(prototypeMode ? undefined : join(root, 'preload.cjs'), app.isPackaged),
  });
  // A real mode without its bridge must stop here, not open as the sample with a window that looks as if it could read: a failed preload ends in the same box as any other failed start.
  if (prototypeReal || prototypeV3Real) window.webContents.on('preload-error', (_event, _path, error) => startupFailed(error));
  window.once('ready-to-show', () => window?.show());
  // The home app prototype is called "Bowerloom" from the first moment: the page title it loads with never reaches the title bar.
  if (prototypeV2 || prototypeReal || prototypeV3 || prototypeV3Real) window.on('page-title-updated', event => event.preventDefault());
  window.on('closed', () => { window = null; });
  if (prototypeReal) window.webContents.loadURL(`${indexUrl}${REAL_HASH}`).catch(startupFailed);
  else if (prototypeV3 || prototypeV3Real) window.loadURL(`${indexUrl}${prototypeV3Real ? '#prototype-v3-real' : '#prototype-v3'}`).catch(startupFailed);
  else if (prototypeV2) window.loadURL(`${indexUrl}#prototype-v2`).catch(startupFailed);
  else if (prototypeMode) window.loadURL(`${indexUrl}#prototype`).catch(startupFailed);
  else window.loadURL(indexUrl).catch(startupFailed);
}

function registerIpc(): void {
  const guarded = <T extends unknown[], R>(name: ChannelName, handler: (...args: T) => Promise<R>): void => {
    ipcMain.handle(CHANNELS[name], (event, ...args) => {
      // Only our own page may ask, and the prototype page may not ask at all.
      const frame = event.senderFrame;
      if (!isAllowedSender(prototypeMode, frame === null ? null : frame.url, indexUrl)) throw new Error('Not allowed.');
      return handler(...(args as T));
    });
  };
  guarded('getInfo', () => controller.getInfo());
  guarded('getSettings', () => controller.getSettings());
  guarded('getSnapshot', () => controller.getSnapshot());
  guarded('getItemContent', (request: Parameters<Controller['getItemContent']>[0]) => controller.getItemContent(request));
  guarded('getFileText', (request: Parameters<Controller['getFileText']>[0]) => controller.getFileText(request));
  guarded('chooseMode', (mode: Mode) => controller.chooseMode(mode));
  guarded('addRoot', () => controller.addRoot());
  guarded('removeRoot', (path: string) => controller.removeRoot(path));
  guarded('setTheme', async (theme: Parameters<Controller['setTheme']>[0]) => { const s = await controller.setTheme(theme); nativeTheme.themeSource = s.settings.theme; return s; });
  guarded('setIncludeExamples', (on: boolean) => controller.setIncludeExamples(on));
  guarded('setMapLayout', (layout: unknown) => controller.setMapLayout(layout));
  guarded('listSketches', () => controller.listSketches());
  guarded('saveSketch', (sketch: unknown) => controller.saveSketch(sketch));
  guarded('loadSketch', (name: unknown) => controller.loadSketch(name));
  guarded('deleteSketch', (name: unknown) => controller.deleteSketch(name));
  guarded('setRole', (key: string, role: Parameters<Controller['setRole']>[1]) => controller.setRole(key, role));
  guarded('checkForUpdates', () => controller.checkForUpdates());
  guarded('openLink', (url: string) => controller.openLink(url));
  guarded('getKnowledgeGraph', (storeKey: unknown) => controller.getKnowledgeGraph(storeKey));
  guarded('getPageText', (request: Parameters<Controller['getPageText']>[0]) => controller.getPageText(request));
  guarded('copyText', (text: string) => controller.copyText(text));
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
    // Every mode serves the same page, index.html, with the same policy. Real mode differs only in the address (#prototype-v2/real) and in the bridge its window gets.
    const url = new URL(request.url), file = url.host === APP_HOST ? resolveAppFile(rendererDir, url.pathname) : null;
    const type = file === null ? undefined : TYPES[file.slice(file.lastIndexOf('.'))];
    if (file === null || type === undefined) return new Response('Not found', { status: 404 });
    try {
      const bytes = await readFile(file);
      const body = samplePreviewEngines && url.pathname === '/index.html' ? withSamplePreviewEngines(bytes.toString('utf8'), true) : bytes;
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
  const sampleDir = app.isPackaged ? join(process.resourcesPath, 'sample-data') : join(root, '..', 'sample-data');
  controller = createController({
    appDir: app.getPath('userData'), sampleDir, version: app.getVersion(), platform: process.platform, forcedMode,
    pickFolder: async () => {
      const options: Electron.OpenDialogOptions = { title: 'Add a folder where your projects live', buttonLabel: 'Add this folder', properties: ['openDirectory'] };
      const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
      return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
    },
    openExternal: url => shell.openExternal(url),
    copyText: text => clipboard.writeText(text),
  });
  nativeTheme.themeSource = (await controller.getSettings()).theme;
  if (prototypeReal || prototypeV3Real) {
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
    if (prototypeV3Real) {
      registerEngineIpc({
        ipc: ipcMain, appIndexUrl: indexUrl, home, stateRoot: engineStateRoot(home), who: userInfo().username || 'this Mac',
        // Beta.1: OpenCode, Pi, and DeepSeek Harness install only when the app starts with BOWERLOOM_PREVIEW_ENGINES=1. The window gets one yes or no, never the environment.
        previewEngines: enginePreviewSwitch(),
        // The local usage log: lines about what was done, never a name or a path. BOWERLOOM_EVENT_LOG=off turns it off.
        record: createRecorder({ stateRoot: engineStateRoot(home), env: diagnosticsEnv(), home }),
        // Main's own question before every write (U16): words main builds from its record of the plan; the window cannot word or skip it.
        confirm: async ask => {
          const options: Electron.MessageBoxOptions = { type: 'question', title: ask.title, message: ask.message, detail: ask.detail, buttons: ['Cancel', 'Write'], defaultId: 0, cancelId: 0, noLink: true };
          const result = window === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(window, options);
          return result.response === 1;
        },
        chooseFolder: async () => {
          const options: Electron.OpenDialogOptions = { title: 'Choose a project folder', buttonLabel: 'Choose this folder', properties: ['openDirectory'] };
          const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
          return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
        },
      });
    }
  }
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(startupFailed);

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
