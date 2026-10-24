/** Electron entry. Opens one window onto the viewer page and answers its named calls. */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNELS } from '../shared/channels.js';
import type { ChannelName } from '../shared/channels.js';
import type { Mode } from '../shared/types.js';
import { createController } from './controller.js';
import type { Controller } from './controller.js';
import { APP_HOST, APP_INDEX, APP_SCHEME, allowRequest, chooseUserData, decideNavigation, isAllowedSender, makePrototypeDataDir, removePrototypeDataDir, resolveAppFile, userDataArg, webPreferences } from './security.js';

const root = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(root, 'renderer');
const indexUrl = APP_INDEX;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json; charset=utf-8' };
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true } }]);

const argv = process.argv.slice(1);
// The clickable prototype (Bowerloom 0.8): the same page with #prototype added, and no IPC at all.
const prototypeMode = argv.includes('--prototype');
// The prototype writes nothing to the real app data, whoever starts it. It keeps its own temporary data folder (or the one it was given, when that
// is one of its own), and removes it when the app quits. The launcher does the same; this keeps the promise when the app is started without it.
// Not caught: a hard kill (SIGKILL, a crash, a power cut) leaves the folder, and the browser engine writes a few small files (Local State, Preferences)
// after the quit event, so a start without the launcher can leave those four files. The launcher removes the folder again once the app has exited.
// The folder holds only browser settings and cache, never prototype data, and the system clears its temporary folder.
if (prototypeMode) {
  const choice = chooseUserData(userDataArg(argv), tmpdir());
  const dir = choice.action === 'keep' ? choice.dir : makePrototypeDataDir();
  if (choice.action === 'make') app.setPath('userData', dir);
  const cleanUp = (): void => { removePrototypeDataDir(dir); };
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

function createWindow(): void {
  window = new BrowserWindow({
    width: 1100, height: 760, useContentSize: true, minWidth: 900, minHeight: 600, show: false, title: 'Bowerloom Viewer',
    backgroundColor: '#f6f5f0',
    // The prototype page gets no bridge at all: no preload, so no `window.bowerloom`, and nothing to call even if a channel were open.
    webPreferences: webPreferences(prototypeMode ? undefined : join(root, 'preload.cjs'), app.isPackaged),
  });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  if (prototypeMode) void window.loadURL(`${indexUrl}#prototype`);
  else void window.loadURL(indexUrl);
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

app.on('web-contents-created', (_event, contents) => hardenContents(contents));

void app.whenReady().then(async () => {
  // The page is served by the app itself, from its own renderer folder only.
  protocol.handle(APP_SCHEME, async request => {
    const url = new URL(request.url), file = url.host === APP_HOST ? resolveAppFile(rendererDir, url.pathname) : null;
    const type = file === null ? undefined : TYPES[file.slice(file.lastIndexOf('.'))];
    if (file === null || type === undefined) return new Response('Not found', { status: 404 });
    try { return new Response(await readFile(file), { headers: { 'content-type': type } }); } catch { return new Response('Not found', { status: 404 }); }
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
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
