/**
 * The place of a found file (spec 6.1): the settings folder that holds it, or the cache folder of a library version.
 * Worked out from the `foundAt` path alone. The text of a file is never looked at. Pure: no clock, no random number, no file.
 */
import type { FoundAt, InterfaceId } from './types.js';

/** The settings folder of each program. A file beside the folder (`.mcp.json`, `opencode.json`) belongs to its program's folder. */
const FOLDER: Readonly<Record<InterfaceId, string>> = { 'claude-code': '.claude', codex: '.codex', opencode: '.opencode', hermes: '.hermes', bowerloom: '.bowerloom' };
/** The folder names that mark a place when they appear in a path. */
const MARKERS: ReadonlySet<string> = new Set(['.claude', '.codex', '.opencode', '.bowerloom', '.bowerloom-store']);

/** The id of the place that holds one found file. It is the place's path. */
export function placeIdOf(found: FoundAt): string {
  const parts = found.path.split('/');
  const cache = parts.indexOf('.cache');
  if (cache >= 0 && parts.length > cache + 2) return parts.slice(0, cache + 3).join('/');
  const at = parts.findIndex(p => MARKERS.has(p));
  return at >= 0 ? parts.slice(0, at + 1).join('/') : `${parts.slice(0, -1).join('/')}/${FOLDER[found.interface]}`;
}
