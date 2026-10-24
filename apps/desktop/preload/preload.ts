/**
 * The only bridge between the page and the app. It hands the page a fixed set of named calls. Each call sends one
 * message on one channel. The page gets no Node, no file path, and no way to send any other message.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/channels.js';
import type { ViewerApi } from '../shared/types.js';

const api: ViewerApi = {
  getInfo: () => ipcRenderer.invoke(CHANNELS.getInfo),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.getSnapshot),
  getItemContent: request => ipcRenderer.invoke(CHANNELS.getItemContent, { kind: request.kind, id: request.id, projectKey: request.projectKey }),
  getFileText: request => ipcRenderer.invoke(CHANNELS.getFileText, { projectKey: request.projectKey, file: request.file }),
  chooseMode: mode => ipcRenderer.invoke(CHANNELS.chooseMode, mode),
  addRoot: () => ipcRenderer.invoke(CHANNELS.addRoot),
  removeRoot: path => ipcRenderer.invoke(CHANNELS.removeRoot, path),
  setTheme: theme => ipcRenderer.invoke(CHANNELS.setTheme, theme),
  setIncludeExamples: on => ipcRenderer.invoke(CHANNELS.setIncludeExamples, on),
  checkForUpdates: () => ipcRenderer.invoke(CHANNELS.checkForUpdates),
  openLink: url => ipcRenderer.invoke(CHANNELS.openLink, url),
  copyText: text => ipcRenderer.invoke(CHANNELS.copyText, text),
};

contextBridge.exposeInMainWorld('bowerloom', Object.freeze(api));
