/** The app's own settings, kept in its own folder (Electron userData). Nothing here is Bowerloom's data. */
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { AppSettings } from '../shared/types.js';

export const CONFIG_FILE = 'viewer-settings.json';
const MAX_ROOTS = 20;

/**
 * Updates stay off until the first release exists. The owner turns them on here (`updatesEnabled`) after a release is
 * published. While this is false the app makes no network call and the footer says so.
 */
export const DEFAULT_SETTINGS: AppSettings = Object.freeze({ theme: 'system', roots: [], mode: null, updatesEnabled: false }) as AppSettings;

export function parseSettings(text: string): AppSettings {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ...DEFAULT_SETTINGS, roots: [] }; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_SETTINGS, roots: [] };
  const v = value as Record<string, unknown>;
  const theme = v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system';
  const roots = Array.isArray(v.roots) ? [...new Set(v.roots.filter((r): r is string => typeof r === 'string' && isAbsolute(r) && !r.includes('\0') && r.length < 4096))].slice(0, MAX_ROOTS) : [];
  const mode = v.mode === 'sample' || v.mode === 'real' ? v.mode : null;
  return { theme, roots, mode, updatesEnabled: v.updatesEnabled === true };
}

export function loadSettings(dir: string): AppSettings {
  try {
    const stat = lstatSync(join(dir, CONFIG_FILE));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return { ...DEFAULT_SETTINGS, roots: [] };
    return parseSettings(readFileSync(join(dir, CONFIG_FILE), 'utf8'));
  } catch { return { ...DEFAULT_SETTINGS, roots: [] }; }
}

export function saveSettings(dir: string, settings: AppSettings): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, CONFIG_FILE), temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}
