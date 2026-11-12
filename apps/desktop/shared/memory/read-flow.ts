/**
 * The read of the Memory explorer, pure: no React, no Node module, no clock. It calls only two calls of the modules bridge: `listModuleFiles` (the markdown files of an approved folder) and `readModuleFile` (one file).
 * Main decides what may be read (packages/module-scope): the explorer reads only a folder the person approved for the module `memory-explorer`, never a path outside it, never a hidden part, never through a link.
 * Nothing is written. A refusal of any kind, or a call that throws at once, is a state with its short code and never a blank page. The same caps as the Context page hold (docs/v0.9/context-items.md):
 * at most `pagesPerPlace` notes are read for a folder, and the rest is told.
 */
import { refusalCode } from '../api/calls.js';
import type { ModulePlace, ModulesBridge } from '../api/modules.js';
import { REAL_LIMITS } from '../real/types.js';
import { analyse, parseNote } from './analytics.js';
import type { MemoryAnalytics, ParsedNote } from './analytics.js';

/** The id of the stock extension: the module the person approves folders for, and the id main finds in the app's own extension folder. */
export const MEMORY_MODULE_ID = 'memory-explorer';

/** How many notes of a folder are read, as many as the Context page shows for a place. */
export const NOTES_CAP = REAL_LIMITS.pagesPerPlace;
/** How many reads are asked of main at once. */
export const READS_AT_ONCE = 16;

export interface UnreadableCount { readonly code: string; readonly count: number }

export interface PlaceMemory {
  readonly placeId: string;
  readonly label: string;
  /** `failed`: the list of the folder was refused. Then `code` says why and nothing below is counted. */
  readonly status: 'ok' | 'failed';
  readonly code: string | null;
  /** The markdown files main listed. */
  readonly listed: number;
  /** The notes read as text. */
  readonly read: number;
  /** The notes past the cap, which are listed and not shown. */
  readonly notShown: number;
  /** Main stopped its walk at a limit, so the folder may hold more notes than `listed`. */
  readonly truncated: boolean;
  /** The folders main could not list and the entries it could not look at. Notes below them are not counted. */
  readonly skipped: { readonly folders: number; readonly entries: number };
  /** The notes that were shown and could not be read, by the code of the refusal. Sorted by code. */
  readonly unreadable: readonly UnreadableCount[];
  readonly analytics: MemoryAnalytics;
}

/** `failed`: the read as a whole failed outside any call, with its code in `code`. */
export interface MemoryState { readonly status: 'idle' | 'loading' | 'ready' | 'failed'; readonly places: readonly PlaceMemory[]; readonly code?: string | null }

const EMPTY: MemoryAnalytics = Object.freeze({ notes: 0, links: 0, tags: 0, tagUses: 0, missingLinks: 0, missingTargets: 0, capped: false, topTags: Object.freeze([]), missing: Object.freeze([]) });

const failedPlace = (place: ModulePlace, code: string): PlaceMemory => ({ placeId: place.id, label: place.label, status: 'failed', code, listed: 0, read: 0, notShown: 0, truncated: false, skipped: { folders: 0, entries: 0 }, unreadable: [], analytics: EMPTY });

export interface ReadOptions { /** Test use: another cap. */ readonly cap?: number; /** Test use: another number of reads at once. */ readonly parallel?: number; /** Test use: another parser. */ readonly parse?: typeof parseNote }

/** A refusal that is about the folder, not about one note: the rest of the reads would fail the same way, so the read stops. */
const PLACE_LEVEL: ReadonlySet<string> = new Set(['NOT_APPROVED', 'PLACE_CHANGED', 'RECORD_DAMAGED', 'RECORD_BLOCKED', 'HOME_UNREADABLE', 'UNKNOWN_MODULE', 'NOT_ALLOWED']);

/** Reads one approved folder: lists its notes, reads up to the cap, and counts. It never throws: anything unexpected is a failed place. */
export async function readPlaceMemory(bridge: Pick<ModulesBridge, 'listModuleFiles' | 'readModuleFile'>, moduleId: string, place: ModulePlace, options: ReadOptions = {}): Promise<PlaceMemory> {
  try { return await readPlace(bridge, moduleId, place, options); } catch { return failedPlace(place, 'FAILED'); }
}

async function readPlace(bridge: Pick<ModulesBridge, 'listModuleFiles' | 'readModuleFile'>, moduleId: string, place: ModulePlace, options: ReadOptions): Promise<PlaceMemory> {
  const cap = options.cap ?? NOTES_CAP, parallel = Math.max(1, options.parallel ?? READS_AT_ONCE), parse = options.parse ?? parseNote;
  let listed: Awaited<ReturnType<ModulesBridge['listModuleFiles']>>;
  try { listed = await new Promise(resolve => resolve(bridge.listModuleFiles(moduleId, place.id))); } catch (error) { return failedPlace(place, refusalCode(error, 'modules')); }
  // An answer of the wrong shape is a failure, not a list.
  if (typeof listed !== 'object' || listed === null || !Array.isArray(listed.files) || !listed.files.every(f => typeof f === 'string')) return failedPlace(place, 'FAILED');
  const all = listed.files, shown = all.slice(0, cap), parsed: ParsedNote[] = [], unreadable = new Map<string, number>();
  let next = 0, aborted: string | null = null;
  const count = (code: string): void => { unreadable.set(code, (unreadable.get(code) ?? 0) + 1); };
  const worker = async (): Promise<void> => {
    for (let i = next++; i < shown.length && aborted === null; i = next++) {
      const path = shown[i]!;
      let text: string;
      try {
        const file = await new Promise<{ readonly text: string }>(resolve => resolve(bridge.readModuleFile(moduleId, place.id, path)));
        if (typeof file !== 'object' || file === null || typeof file.text !== 'string') throw new Error('bad answer');
        text = file.text;
      } catch (error) {
        const code = refusalCode(error, 'modules');
        // A refusal about the folder ends the read: the notes after it would be refused the same way.
        if (PLACE_LEVEL.has(code)) { aborted = code; return; }
        count(code);
        continue;
      }
      // The parser is read apart from the call: a bug in it is told as its own code and never as a refusal.
      try { parsed.push(parse(path, text)); } catch { count('PARSE_FAILED'); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, shown.length) }, worker));
  if (aborted !== null) return failedPlace(place, aborted);
  const skipped = { folders: Number(listed.skipped?.folders) || 0, entries: Number(listed.skipped?.entries) || 0 };
  // The index and the count of notes hold every listed note, also those past the cap, so a link to a note that was not read is not missing.
  return {
    placeId: place.id, label: place.label, status: 'ok', code: null, listed: all.length, read: parsed.length, notShown: all.length - shown.length, truncated: listed.truncated === true, skipped,
    unreadable: [...unreadable].map(([code, count]) => ({ code, count })).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)), analytics: analyse(all, parsed),
  };
}

/** Reads each approved folder in turn. */
export async function readAllMemory(bridge: Pick<ModulesBridge, 'listModuleFiles' | 'readModuleFile'>, moduleId: string, places: readonly ModulePlace[], options: ReadOptions = {}): Promise<PlaceMemory[]> {
  const out: PlaceMemory[] = [];
  for (const place of places) out.push(await readPlaceMemory(bridge, moduleId, place, options));
  return out;
}

/** The notes on screen over all the folders. A folder that failed adds nothing, so the total is then a lower bound (see `totalIsPartial`). */
export const totalNotes = (places: readonly PlaceMemory[]): number => places.reduce((sum, p) => sum + (p.status === 'ok' ? p.analytics.notes : 0), 0);

/** True when the total is a lower bound: a folder failed, or a list was cut or missed folders. */
export const totalIsPartial = (places: readonly PlaceMemory[]): boolean => places.some(p => p.status === 'failed' || notesArePartial(p));

/** The notes of a folder are a lower bound when main cut its list or could not list a folder or an entry. */
export const notesArePartial = (p: PlaceMemory): boolean => p.truncated || p.skipped.folders > 0 || p.skipped.entries > 0;

/** Links, tags and missing links are lower bounds when any note was left out of the read: not shown, not read, cut, skipped, or a total cap was reached. */
export const layersArePartial = (p: PlaceMemory): boolean => notesArePartial(p) || p.notShown > 0 || p.unreadable.length > 0 || p.analytics.capped;
