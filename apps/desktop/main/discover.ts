/**
 * Finds Bowerloom folders near the person, for the first real-data launch. Deliberately small: it looks only at the immediate
 * children of the home folder. It never goes into iCloud's Documents or Desktop, the Library, or any hidden folder, and it never
 * recurses (the scan of a chosen folder does the looking inside). A child counts when it holds a `.bowerloom` folder or a
 * `bowerloom.json`.
 */
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { isProject } from './scan.js';

export const DISCOVER_LIMITS = Object.freeze({ children: 400, results: 12 });
/** Places that are never looked at: cloud-synced or system folders and media folders. */
export const NEVER_LOOK: ReadonlySet<string> = new Set(['Library', 'Documents', 'Desktop', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public', 'Applications', 'node_modules', 'Dropbox', 'OneDrive', 'Google Drive']);

export function discoverNearby(home: string): string[] {
  let names: string[];
  try { names = readdirSync(home); } catch { return []; }
  const found: string[] = [];
  for (const name of names.sort().slice(0, DISCOVER_LIMITS.children)) {
    if (name.startsWith('.') || NEVER_LOOK.has(name)) continue;
    const path = join(home, name);
    let stat; try { stat = lstatSync(path); } catch { continue; }
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    if (!isProject(path)) continue;
    try { found.push(realpathSync(path)); } catch { continue; }
    if (found.length >= DISCOVER_LIMITS.results) break;
  }
  return found;
}
