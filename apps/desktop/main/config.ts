/** The app's own settings, kept in its own folder (Electron userData). Nothing here is Bowerloom's data. */
import { chmodSync, closeSync, constants, copyFileSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { FOLDER_ROLES } from '../shared/types.js';
import type { AppSettings, FolderRole } from '../shared/types.js';
import { assertAppWritable } from './boundary.js';

export const CONFIG_FILE = 'viewer-settings.json';
export const MAX_ROOTS = 20;
export const MAX_ROLES = 200;
const MAX_BYTES = 65536;

export const DEFAULT_SETTINGS: AppSettings = Object.freeze({ theme: 'system', roots: [], mode: null, includeExamples: false, roles: {}, discovered: false }) as AppSettings;
const fresh = (): AppSettings => ({ theme: 'system', roots: [], mode: null, includeExamples: false, roles: {}, discovered: false });

/** The settings in `text`, or null when it is not a settings file at all (not JSON, or not an object). Unknown keys are ignored. */
export function parseSettings(text: string): AppSettings | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const theme = v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system';
  const roots = Array.isArray(v.roots) ? [...new Set(v.roots.filter((r): r is string => typeof r === 'string' && isAbsolute(r) && !r.includes('\0') && r.length < 4096))].slice(0, MAX_ROOTS) : [];
  const mode = v.mode === 'sample' || v.mode === 'real' || v.mode === 'sandbox' ? v.mode : null;
  const roles: Record<string, FolderRole> = {};
  if (v.roles !== null && typeof v.roles === 'object' && !Array.isArray(v.roles)) for (const [k, r] of Object.entries(v.roles as Record<string, unknown>).slice(0, MAX_ROLES)) if (isAbsolute(k) && !k.includes('\0') && k.length < 4096 && (FOLDER_ROLES as readonly unknown[]).includes(r)) roles[k] = r as FolderRole;
  return { theme, roots, mode, includeExamples: v.includeExamples === true, roles, discovered: v.discovered === true };
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

const refuseLink = (path: string): void => {
  let stat; try { stat = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('A link or a folder is where the viewer keeps a file, so nothing was written.');
};

/**
 * Saves the settings. An older file is first copied to `.bak`. Neither the `.bak` nor the temporary file may be a link or
 * anything but a plain file: a link there would send the write somewhere else, so the save is refused. The temporary file is
 * made new, with the flags that refuse a link, and every file is private to the owner. On any failure the temporary file is
 * removed and the error is thrown.
 */
export function saveSettings(dir: string, settings: AppSettings): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, CONFIG_FILE), temp = `${file}.tmp`, backup = `${file}.bak`;
  // Every path written is checked by the boundary first: inside the viewer's own folder, no "..", no link on the way.
  assertAppWritable(dir, file); assertAppWritable(dir, temp); assertAppWritable(dir, backup);
  refuseLink(backup); refuseLink(temp); refuseLink(file);
  try {
    // A leftover plain temporary file from a stopped save is replaced, not trusted.
    rmSync(temp, { force: true });
    try { if (lstatSync(file).isFile()) { copyFileSync(file, backup); chmodSync(backup, 0o600); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { const data = Buffer.from(`${JSON.stringify(settings, null, 2)}\n`); let at = 0; while (at < data.length) at += writeSync(fd, data, at); } finally { closeSync(fd); }
    chmodSync(temp, 0o600);
    renameSync(temp, file);
  } catch (error) {
    try { rmSync(temp, { force: true }); } catch { /* nothing more to do */ }
    throw error;
  }
}
