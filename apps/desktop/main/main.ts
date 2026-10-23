/** Electron entry. Opens one window onto the viewer page and answers its named calls. */
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, session, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHANNELS } from '../shared/channels.js';
import type { ChannelName } from '../shared/channels.js';
import type { Mode } from '../shared/types.js';
import { createController } from './controller.js';
import type { Controller } from './controller.js';
import { allowRequest, decideNavigation, webPreferences } from './security.js';

const root = dirname(fileURLToPath(import.meta.url));
const indexFile = join(root, 'renderer', 'index.html');
const indexUrl = pathToFileURL(indexFile).href;

const argv = process.argv.slice(1);
const forcedMode: Mode | null = argv.includes('--sample-data') ? 'sample' : argv.includes('--real-data') ? 'real' : null;

let controller: Controller;
let window: BrowserWindow | null = null;

function hardenContents(contents: Electron.WebContents): void {
  contents.on('will-navigate', (event, url) => {
    const verdict = decideNavigation(url, indexUrl);
    if (verdict === 'allow-app') return;
    event.preventDefault();
    if (verdict === 'open-external') void controller.openLink(url);
  });
  contents.on('will-redirect', event => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, indexUrl) === 'open-external') void controller.openLink(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', event => event.preventDefault());
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1100, height: 760, useContentSize: true, minWidth: 900, minHeight: 600, show: false, title: 'Bowerloom Viewer',
    backgroundColor: '#f6f5f0',
    webPreferences: webPreferences(join(root, 'preload.cjs')),
  });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  void window.loadFile(indexFile);
}

function registerIpc(): void {
  const guarded = <T extends unknown[], R>(name: ChannelName, handler: (...args: T) => Promise<R>): void => {
    ipcMain.handle(CHANNELS[name], (event, ...args) => {
      // Only our own page may ask.
      const frame = event.senderFrame;
      if (frame === null || decideNavigation(frame.url, indexUrl) !== 'allow-app') throw new Error('Not allowed.');
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
  guarded('checkForUpdates', () => controller.checkForUpdates());
  guarded('openLink', (url: string) => controller.openLink(url));
  guarded('copyText', (text: string) => controller.copyText(text));
}

app.on('web-contents-created', (_event, contents) => hardenContents(contents));

void app.whenReady().then(async () => {
  // No request leaves the machine: the session cancels everything that is not one of the app's own files.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowRequest(details.url) }));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
