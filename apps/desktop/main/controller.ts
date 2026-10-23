/**
 * The brain of the main process, without Electron: it answers the window's named calls. Every answer is plain data.
 * It reads the store and the project folders the person chose, and writes only the app's own settings file.
 */
import { realpathSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppInfo, AppSettings, ItemContent, ItemKind, Mode, Snapshot } from '../shared/types.js';
import { safeText } from '../shared/text.js';
import { readGuarded } from '../../../packages/project-authoring/src/files.js';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';
import { storeRootOf } from '../../../packages/project-context/src/index.js';
import { loadSettings, saveSettings } from './config.js';
import { readItemContent } from './content.js';
import { readSnapshot } from './reader.js';
import type { ReadContext } from './reader.js';
import { seedSample } from './sample.js';
import type { SampleWorld } from './sample.js';
import { isAllowedExternal } from './security.js';
import { resolveInside, isId } from './safe.js';
import { checkForUpdates, initialUpdateState } from './updates.js';
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
  addRoot(): Promise<AppSettings>;
  removeRoot(path: string): Promise<AppSettings>;
  setTheme(theme: AppSettings['theme']): Promise<AppSettings>;
  checkForUpdates(): Promise<{ status: string }>;
  openLink(url: string): Promise<boolean>;
}

const KINDS: readonly ItemKind[] = ['skill', 'prompt', 'team'];

export function createController(host: Host): Controller {
  let settings = loadSettings(host.appDir);
  let mode: Mode | null = host.forcedMode ?? settings.mode;
  let sample: SampleWorld | null = null;
  let contexts = new Map<string, ProjectContext>();
  let known = new Set<string>();
  let updates: UpdateState = initialUpdateState(settings.updatesEnabled);

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
  const persist = (next: AppSettings): AppSettings => { settings = next; saveSettings(host.appDir, settings); return settings; };

  const info = (): AppInfo => {
    const c = readContext();
    return { version: host.version, mode, storePath: c === null ? '' : storeRootOf(c.home), updates: updates, platform: host.platform, firstRun: mode === null };
  };

  return {
    async getInfo() { return info(); },
    async getSettings() { return settings; },
    async getSnapshot() {
      const c = readContext();
      if (c === null) throw new Error('Choose what to look at first.');
      const result = await readSnapshot(c);
      contexts = result.contexts; known = new Set(result.snapshot.projects.map(p => p.key));
      return result.snapshot;
    },
    async getItemContent(request) {
      const kind = request?.kind, id = request?.id;
      if (!KINDS.includes(kind) || !isId(id)) return { kind: 'skill', id: '', where: 'store', files: [], pinned: null, note: 'That is not a valid request.' };
      if (request.projectKey !== null) {
        if (typeof request.projectKey !== 'string' || !known.has(request.projectKey)) return { kind, id, where: 'project', files: [], pinned: null, note: 'That project is not in the list.' };
        return readItemContent(request.projectKey, 'project', kind, id);
      }
      const dir = storeDir();
      return dir === null ? { kind, id, where: 'store', files: [], pinned: null, note: 'Nothing is open yet.' } : readItemContent(dir, 'store', kind, id);
    },
    async getFileText(request) {
      const key = request?.projectKey;
      if (typeof key !== 'string' || !known.has(key) || (request.file !== 'config' && request.file !== 'lock')) return { text: null, note: 'That is not a valid request.' };
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
      mode = next;
      if (host.forcedMode === null && next === 'real') persist({ ...settings, mode: 'real' });
      if (next === 'sample') sample = null;
      return info();
    },
    async addRoot() {
      const picked = await host.pickFolder();
      if (picked === null) return settings;
      let real: string;
      try { real = realpathSync(picked); if (!lstatSync(real).isDirectory()) return settings; } catch { return settings; }
      return persist({ ...settings, roots: [...new Set([...settings.roots, real])].slice(0, 20) });
    },
    async removeRoot(path) {
      return persist({ ...settings, roots: settings.roots.filter(r => r !== path) });
    },
    async setTheme(theme) {
      if (theme !== 'system' && theme !== 'light' && theme !== 'dark') return settings;
      return persist({ ...settings, theme });
    },
    async checkForUpdates() { updates = await checkForUpdates(updates); return { status: updates.status }; },
    async openLink(url) {
      if (!isAllowedExternal(url)) return false;
      await host.openExternal(url);
      return true;
    },
  };
}
