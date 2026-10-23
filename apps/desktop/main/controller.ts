/**
 * The brain of the main process, without Electron: it answers the window's named calls. Every answer is plain data.
 * It reads the store and the project folders the person chose, and writes only the app's own settings file.
 */
import { realpathSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppInfo, AppSettings, ItemContent, ItemKind, Mode, SettingsResult, Snapshot } from '../shared/types.js';
import { safeText } from '../shared/text.js';
import { readGuarded } from '../../../packages/project-authoring/src/files.js';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';
import { storeRootOf } from '../../../packages/project-context/src/index.js';
import { MAX_ROOTS, loadSettings, saveSettings } from './config.js';
import { readItemContent } from './content.js';
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
  checkForUpdates(): Promise<{ status: string }>;
  openLink(url: string): Promise<boolean>;
  copyText(text: string): Promise<boolean>;
}

const KINDS: readonly ItemKind[] = ['skill', 'prompt', 'team'];
const SAVE_FAILED = 'The change could not be saved, so it was not made. The viewer\'s settings folder may be full or not writable.';

export function createController(host: Host): Controller {
  const loaded = loadSettings(host.appDir);
  let settings = loaded.settings;
  let notice: string | null = loaded.notice;
  let mode: Mode | null = host.forcedMode ?? settings.mode;
  let sample: SampleWorld | null = null;
  let known = new Set<string>();
  let updates: UpdateState = initialUpdateState(UPDATES_ENABLED);

  const realHome = (): string => realpathSync(host.home ?? homedir());
  const readContext = (): ReadContext | null => {
    if (mode === 'sample') {
      sample ??= seedSample(host.appDir, host.sampleDir);
      return { mode, home: sample.home, env: sample.env, roots: [sample.projects] };
    }
    if (mode === 'real') {
      const home = realHome(), state = host.env?.XDG_STATE_HOME ?? process.env.XDG_STATE_HOME;
      const env: NodeJS.ProcessEnv = { HOME: home };
      if (typeof state === 'string' && state.startsWith('/')) env.XDG_STATE_HOME = state;
      return { mode, home, env, roots: settings.roots, tokenSource: host.env ?? process.env };
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
  const forget = (): void => { known = new Set(); };

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
      const result = await readSnapshot(c);
      known = new Set(result.snapshot.projects.map(p => p.key));
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
