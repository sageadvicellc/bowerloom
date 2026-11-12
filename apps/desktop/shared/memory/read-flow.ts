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
  /** The notes that were shown and could not be read, by the code of the refusal. Sorted by code. */
  readonly unreadable: readonly UnreadableCount[];
  readonly analytics: MemoryAnalytics;
}

export interface MemoryState { readonly status: 'idle' | 'loading' | 'ready'; readonly places: readonly PlaceMemory[] }

const EMPTY: MemoryAnalytics = Object.freeze({ notes: 0, links: 0, tags: 0, tagUses: 0, missingLinks: 0, missingTargets: 0, topTags: Object.freeze([]), missing: Object.freeze([]) });

const failedPlace = (place: ModulePlace, code: string): PlaceMemory => ({ placeId: place.id, label: place.label, status: 'failed', code, listed: 0, read: 0, notShown: 0, truncated: false, unreadable: [], analytics: EMPTY });

export interface ReadOptions { /** Test use: another cap. */ readonly cap?: number; /** Test use: another number of reads at once. */ readonly parallel?: number }

/** Reads one approved folder: lists its notes, reads up to the cap, and counts. It never throws. */
export async function readPlaceMemory(bridge: Pick<ModulesBridge, 'listModuleFiles' | 'readModuleFile'>, moduleId: string, place: ModulePlace, options: ReadOptions = {}): Promise<PlaceMemory> {
  const cap = options.cap ?? NOTES_CAP, parallel = Math.max(1, options.parallel ?? READS_AT_ONCE);
  let listed: Awaited<ReturnType<ModulesBridge['listModuleFiles']>>;
  try { listed = await new Promise(resolve => resolve(bridge.listModuleFiles(moduleId, place.id))); } catch (error) { return failedPlace(place, refusalCode(error, 'modules')); }
  const shown = listed.files.slice(0, cap), parsed: ParsedNote[] = [], unreadable = new Map<string, number>();
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < shown.length; i = next++) {
      const path = shown[i]!;
      try {
        const file = await new Promise<{ readonly text: string }>(resolve => resolve(bridge.readModuleFile(moduleId, place.id, path)));
        parsed.push(parseNote(path, file.text));
      } catch (error) {
        const code = refusalCode(error, 'modules');
        unreadable.set(code, (unreadable.get(code) ?? 0) + 1);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, shown.length) }, worker));
  return {
    placeId: place.id, label: place.label, status: 'ok', code: null, listed: listed.files.length, read: parsed.length, notShown: listed.files.length - shown.length, truncated: listed.truncated,
    unreadable: [...unreadable].map(([code, count]) => ({ code, count })).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)), analytics: analyse(shown, parsed),
  };
}

/** Reads each approved folder in turn. */
export async function readAllMemory(bridge: Pick<ModulesBridge, 'listModuleFiles' | 'readModuleFile'>, moduleId: string, places: readonly ModulePlace[], options: ReadOptions = {}): Promise<PlaceMemory[]> {
  const out: PlaceMemory[] = [];
  for (const place of places) out.push(await readPlaceMemory(bridge, moduleId, place, options));
  return out;
}

/** The notes on screen over all the folders. */
export const totalNotes = (places: readonly PlaceMemory[]): number => places.reduce((sum, p) => sum + (p.status === 'ok' ? p.analytics.notes : 0), 0);
