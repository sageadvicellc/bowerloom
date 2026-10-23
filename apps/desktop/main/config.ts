/** The app's own settings, kept in its own folder (Electron userData). Nothing here is Bowerloom's data. */
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { AppSettings } from '../shared/types.js';

export const CONFIG_FILE = 'viewer-settings.json';
export const MAX_ROOTS = 20;
const MAX_BYTES = 65536;

export const DEFAULT_SETTINGS: AppSettings = Object.freeze({ theme: 'system', roots: [], mode: null }) as AppSettings;
const fresh = (): AppSettings => ({ theme: 'system', roots: [], mode: null });

/** The settings in `text`, or null when it is not a settings file at all (not JSON, or not an object). Unknown keys are ignored. */
export function parseSettings(text: string): AppSettings | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const theme = v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system';
  const roots = Array.isArray(v.roots) ? [...new Set(v.roots.filter((r): r is string => typeof r === 'string' && isAbsolute(r) && !r.includes('\0') && r.length < 4096))].slice(0, MAX_ROOTS) : [];
  const mode = v.mode === 'sample' || v.mode === 'real' ? v.mode : null;
  return { theme, roots, mode };
}

export interface Loaded { settings: AppSettings; notice: string | null }

/**
 * Reads the settings file. A file that is not there is a first run and gives the defaults. A file that is damaged, too big,
 * a link, or unreadable gives the defaults and a plain notice, and the file is left as it is (a later save keeps a .bak copy).
 */
export function loadSettings(dir: string): Loaded {
  const file = join(dir, CONFIG_FILE);
  let stat;
  try { stat = lstatSync(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { settings: fresh(), notice: null };
    return { settings: fresh(), notice: 'The viewer\'s own settings could not be read, so the standard settings are in use.' };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { settings: fresh(), notice: 'The viewer\'s settings file is a shortcut or not a plain file, so it was not used. The standard settings are in use.' };
  if (stat.size > MAX_BYTES) return { settings: fresh(), notice: 'The viewer\'s settings file is far too big, so it was not used. The standard settings are in use.' };
  let text: string;
  try { text = readFileSync(file, 'utf8'); } catch { return { settings: fresh(), notice: 'The viewer\'s own settings could not be read, so the standard settings are in use.' }; }
  const parsed = parseSettings(text);
  if (parsed === null) return { settings: fresh(), notice: 'The viewer\'s settings file is damaged, so the standard settings are in use. Your next change keeps a copy of the damaged file next to it.' };
  const listed = (() => { try { const r = (JSON.parse(text) as { roots?: unknown }).roots; return Array.isArray(r) ? r.length : 0; } catch { return 0; } })();
  return { settings: parsed, notice: listed > parsed.roots.length ? `Some folders in the viewer's list were left out (a list holds at most ${MAX_ROOTS} folders, and each must be a full path).` : null };
}

/** Saves the settings. An older file is first copied to `.bak`. On any failure the temporary file is removed and the error is thrown. */
export function saveSettings(dir: string, settings: AppSettings): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, CONFIG_FILE), temp = `${file}.tmp`;
  try {
    try { if (lstatSync(file).isFile()) copyFileSync(file, `${file}.bak`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, file);
  } catch (error) {
    try { rmSync(temp, { force: true }); } catch { /* nothing more to do */ }
    throw error;
  }
}
