/**
 * The brain of the main process, without Electron: it answers the window's named calls. Every answer is plain data.
 * It reads the store and the project folders the person chose, and writes only the app's own settings file.
 */
import { realpathSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FOLDER_ROLES } from '../shared/types.js';
import type { AppInfo, AppSettings, FolderRole, GraphResult, PageResult, ItemContent, ItemKind, Mode, SettingsResult, Sketch, SketchResult, SketchSummary, Snapshot } from '../shared/types.js';
import { safeText } from '../shared/text.js';
import { readGuarded } from '../../../packages/project-authoring/src/files.js';
import { storeRootOf } from '../../../packages/project-context/src/index.js';
import { MAX_ROOTS, loadSettings, parseLayout, saveSettings } from './config.js';
import { SketchError, deleteSketch, listSketches, loadSketch, saveSketch } from './sketches.js';
import { discoverNearby } from './discover.js';
import { readItemContent } from './content.js';
import { buildGraph, readPage } from './graph.js';
import { storeChoices } from '../shared/viewmodel.js';
import { readSnapshot } from './reader.js';
import type { ReadContext } from './reader.js';
import { seedSample } from './sample.js';
import type { SampleWorld } from './sample.js';
import { isAllowedExternal } from './security.js';
import { resolveInside, isId } from './safe.js';
import { UPDATES_ENABLED, checkForUpdates, initialUpdateState } from './updates.js';
import type { UpdateState } from './updates.js';

export interface Host {
  /** The app's own folder for settings and the sample copy (Electron userData). */
  appDir: string;
  /** Where apps/desktop/sample-data is. */
  sampleDir: string;
  version: string;
  platform: string;
  /** Asks the person for a folder with the native picker. Null when they cancel. */
  pickFolder(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  /** Puts text on the clipboard. */
  copyText?(text: string): void;
  /** A launch flag that fixes the mode for this run. */
  forcedMode: Mode | null;
  /** The real home folder and the environment names the viewer is allowed to pass on. */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export interface Controller {
  getInfo(): Promise<AppInfo>;
  getSettings(): Promise<AppSettings>;
  getSnapshot(): Promise<Snapshot>;
  getItemContent(request: { kind: ItemKind; id: string; projectKey: string | null }): Promise<ItemContent>;
  getFileText(request: { projectKey: string; file: 'config' | 'lock' }): Promise<{ text: string | null; note: string | null }>;
  chooseMode(mode: Mode): Promise<AppInfo>;
  addRoot(): Promise<SettingsResult>;
  removeRoot(path: string): Promise<SettingsResult>;
  setTheme(theme: AppSettings['theme']): Promise<SettingsResult>;
  setIncludeExamples(on: boolean): Promise<SettingsResult>;
  setRole(projectKey: string, role: FolderRole | null): Promise<SettingsResult>;
  setMapLayout(layout: unknown): Promise<SettingsResult>;
  listSketches(): Promise<SketchResult<SketchSummary[]>>;
  saveSketch(sketch: unknown): Promise<SketchResult<SketchSummary>>;
  loadSketch(name: unknown): Promise<SketchResult<Sketch>>;
  deleteSketch(name: unknown): Promise<SketchResult<null>>;
  checkForUpdates(): Promise<{ status: string }>;
  openLink(url: string): Promise<boolean>;
  getKnowledgeGraph(storeKey: unknown): Promise<GraphResult>;
  getPageText(request: { storeKey: unknown; page: unknown }): Promise<PageResult>;
  copyText(text: string): Promise<boolean>;
}

const KINDS: readonly ItemKind[] = ['skill', 'prompt', 'team'];
const SAVE_FAILED = 'The change could not be saved, so it was not made. The viewer\'s settings folder may be full or not writable.';

/** A sketch call answers with a sentence, never an error that escapes: a bad name, a damaged file and a refused path are all plain messages. */
function sketchResult<T>(run: () => T): SketchResult<T> {
  try { return { ok: true, value: run(), message: null }; }
  catch (error) { return { ok: false, value: null, message: error instanceof SketchError ? error.message : 'The sketch could not be saved or read here.' }; }
}

export function createController(host: Host): Controller {
  const loaded = loadSettings(host.appDir);
  let settings = loaded.settings;
  let notice: string | null = loaded.notice;
  let mode: Mode | null = host.forcedMode ?? settings.mode;
  let sample: SampleWorld | null = null;
  let known = new Set<string>();
  let stores = new Set<string>();
  let updates: UpdateState = initialUpdateState(UPDATES_ENABLED);

  const realHome = (): string => realpathSync(host.home ?? homedir());
  const readContext = (): ReadContext | null => {
    if (mode === 'sample') {
      sample ??= seedSample(host.appDir, host.sampleDir);
      return { mode, home: sample.home, env: sample.env, roots: [sample.projects], roles: settings.roles };
    }
    if (mode === 'real') {
      const home = realHome(), state = host.env?.XDG_STATE_HOME ?? process.env.XDG_STATE_HOME;
      const env: NodeJS.ProcessEnv = { HOME: home };
      if (typeof state === 'string' && state.startsWith('/')) env.XDG_STATE_HOME = state;
      return { mode, home, env, roots: settings.roots, includeExamples: settings.includeExamples, roles: settings.roles, tokenSource: host.env ?? process.env };
    }
    return null;
  };
  const storeDir = (): string | null => { const c = readContext(); return c === null ? null : storeRootOf(c.home); };
  /** Saves first and only then keeps the change in memory, so what the window shows is what is on disk. */
  const persist = (next: AppSettings): SettingsResult => {
    try { saveSettings(host.appDir, next); } catch { return { settings, message: SAVE_FAILED }; }
    settings = next; notice = null;
    return { settings, message: null };
  };
  /** A project key the window sends must be one of the last snapshot's and still be inside the folders now chosen. */
  const liveKey = (key: unknown): key is string => {
    if (typeof key !== 'string' || !known.has(key)) return false;
    const c = readContext();
    if (c === null) return false;
    try { resolveInside(c.roots, key); return true; } catch { return false; }
  };
  const forget = (): void => { known = new Set(); stores = new Set(); };
  /** The folder of a store the window named: one of the last snapshot's stores, still a real folder. */
  const storeFolder = (key: unknown): string | null => {
    if (typeof key !== 'string' || !stores.has(key)) return null;
    try { const real = realpathSync(key); return lstatSync(real).isDirectory() ? real : null; } catch { return null; }
  };

  const info = (): AppInfo => {
    let storePath = '';
    try { const c = readContext(); storePath = c === null ? '' : storeRootOf(c.home); } catch { storePath = ''; }
    return { version: host.version, mode, storePath, updates, platform: host.platform, firstRun: mode === null, notice };
  };

  return {
    async getInfo() { return info(); },
    async getSettings() { return settings; },
    async getSnapshot() {
      let c: ReadContext | null;
      try { c = readContext(); } catch { throw new Error('The sample data could not be prepared. Try again, or choose your own Bowerloom.'); }
      if (c === null) throw new Error('Choose what to look at first.');
      // The first real-data launch with no folder chosen: look near the person once, and use what is found. They can change the list.
      if (c.mode === 'real' && !settings.discovered && settings.roots.length === 0) {
        const found = discoverNearby(c.home).slice(0, MAX_ROOTS), r = persist({ ...settings, roots: found, discovered: true });
        if (r.message !== null) notice = r.message; else c = readContext()!;
      }
      const result = await readSnapshot(c);
      known = new Set(result.snapshot.projects.map(p => p.key));
      stores = new Set(storeChoices(result.snapshot).map(c => c.key));
      return result.snapshot;
    },
    async getItemContent(request) {
      const kind = request?.kind, id = request?.id;
      if (!KINDS.includes(kind) || !isId(id)) return { kind: 'skill', id: '', where: 'store', files: [], pinned: null, note: 'That is not a valid request.' };
      if (request.projectKey !== null) {
        if (!liveKey(request.projectKey)) return { kind, id, where: 'project', files: [], pinned: null, note: 'That project is not in the list any more. Choose "Look again".' };
        return readItemContent(request.projectKey, 'project', kind, id);
      }
      const dir = storeDir();
      return dir === null ? { kind, id, where: 'store', files: [], pinned: null, note: 'Nothing is open yet.' } : readItemContent(dir, 'store', kind, id);
    },
    async getFileText(request) {
      const key = request?.projectKey;
      if (!liveKey(key) || (request.file !== 'config' && request.file !== 'lock')) return { text: null, note: 'That is not a valid request, or the project is not in the list any more.' };
      try {
        const real = resolveInside([key], key);
        const file = resolveInside([real], join(real, request.file === 'config' ? 'bowerloom.json' : 'bowerloom.lock.json'));
        const bytes = readGuarded(file, 4 * 1024 * 1024);
        return { text: safeText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), note: null };
      } catch {
        let present = true; try { lstatSync(join(key, request.file === 'config' ? 'bowerloom.json' : 'bowerloom.lock.json')); } catch { present = false; }
        return { text: null, note: present ? 'This file is not shown. It may be a link, too large, unreadable, or changeable by other people.' : 'This file is not in the project.' };
      }
    },
    async chooseMode(next) {
      if (next !== 'sample' && next !== 'real') throw new Error('Unknown choice.');
      mode = next; forget();
      if (host.forcedMode === null && next === 'real') { const r = persist({ ...settings, mode: 'real' }); if (r.message !== null) notice = r.message; }
      if (next === 'sample') sample = null;
      return info();
    },
    async addRoot() {
      const picked = await host.pickFolder();
      if (picked === null) return { settings, message: null };
      let real: string;
      try { real = realpathSync(picked); } catch { return { settings, message: 'That folder could not be opened, so it was not added.' }; }
      try { if (!lstatSync(real).isDirectory()) return { settings, message: 'That is not a folder, so it was not added.' }; } catch { return { settings, message: 'That folder could not be opened, so it was not added.' }; }
      if (settings.roots.includes(real)) return { settings, message: 'That folder is already in the list.' };
      if (settings.roots.length >= MAX_ROOTS) return { settings, message: `The list holds at most ${MAX_ROOTS} folders. Remove one first.` };
      forget();
      return persist({ ...settings, roots: [...settings.roots, real] });
    },
    async removeRoot(path) {
      forget();
      return persist({ ...settings, roots: settings.roots.filter(r => r !== path) });
    },
    async setTheme(theme) {
      if (theme !== 'system' && theme !== 'light' && theme !== 'dark') return { settings, message: null };
      return persist({ ...settings, theme });
    },
    async setIncludeExamples(on) {
      forget();
      return persist({ ...settings, includeExamples: on === true });
    },
    async setRole(projectKey, role) {
      if (!liveKey(projectKey) || (role !== null && !FOLDER_ROLES.includes(role))) return { settings, message: 'That folder is not in the list any more. Choose "Look again".' };
      const roles = { ...settings.roles };
      if (role === null) delete roles[projectKey]; else roles[projectKey] = role;
      return persist({ ...settings, roles });
    },
    async setMapLayout(layout) {
      if (layout !== null && (typeof layout !== 'object' || Array.isArray(layout))) return { settings, message: 'That layout is not valid.' };
      return persist({ ...settings, mapLayout: layout === null ? {} : parseLayout(layout) });
    },
    async listSketches() { return sketchResult(() => listSketches(host.appDir)); },
    async saveSketch(sketch) { return sketchResult(() => saveSketch(host.appDir, sketch)); },
    async loadSketch(name) { return sketchResult(() => loadSketch(host.appDir, name)); },
    async deleteSketch(name) { return sketchResult(() => { deleteSketch(host.appDir, name); return null; }); },
    async getKnowledgeGraph(storeKey) {
      const dir = storeFolder(storeKey);
      if (dir === null) return { ok: false, graph: null, message: 'That store is not in the list any more. Choose "Look again".' };
      try { return { ok: true, graph: buildGraph(dir), message: null }; } catch { return { ok: false, graph: null, message: 'The store could not be read.' }; }
    },
    async getPageText(request) {
      const dir = storeFolder(request?.storeKey);
      return dir === null ? { text: null, note: 'That store is not in the list any more. Choose "Look again".' } : readPage(dir, request.page);
    },
    async checkForUpdates() { updates = await checkForUpdates(updates); return { status: updates.status }; },
    async openLink(url) {
      if (!isAllowedExternal(url)) return false;
      await host.openExternal(url);
      return true;
    },
    async copyText(text) {
      if (typeof text !== 'string' || text.length === 0 || text.length > 20000 || host.copyText === undefined) return false;
      host.copyText(text);
      return true;
    },
  };
}
