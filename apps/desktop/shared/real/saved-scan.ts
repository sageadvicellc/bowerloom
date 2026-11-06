/**
 * The saved read: the last answer of the reader, kept in the app's own state folder so the next launch can show it without reading any folder. It holds only what the window
 * already received (the places of step one and the result of step two, with `~` paths and hidden keys), a version, the time of the read, and a fingerprint of the watched folders.
 * The file is untrusted when it is loaded: `parseSavedScan` checks its size, its version and its shape, and gives a plain reason when it cannot be believed. Pure: no file, no clock.
 */
import { TOPIC_SLICES } from './map-world.js';
import { REAL_LIMITS } from './types.js';
import type { RealPlace, RealResult } from './types.js';

/** The version of the file. A file with another number is not read (a newer app may have written it). */
export const SAVED_SCAN_VERSION = 1;
/** The most bytes the file may hold. A bigger read is not saved, and a bigger file is not loaded. */
export const SAVED_SCAN_MAX_BYTES = 24 * 1024 * 1024;

export interface SavedScan {
  readonly version: typeof SAVED_SCAN_VERSION;
  /** When the read ended, in milliseconds since 1970. */
  readonly savedAtMs: number;
  /** A SHA-256 of the names, sizes and change times of the places the read looked at (main/scan-session.ts). */
  readonly fingerprint: string;
  /** The places the person ticked, as step one handed them to the window. */
  readonly chosen: readonly RealPlace[];
  readonly result: RealResult;
}

/** Why a saved read is not used. */
/** `unsupported`: a shape this app does not make (a set of notes with an id another has, an agent that names a set of notes). The file is left where it is, as for `too-big` and `wrong-version`. */
export type DamageWhy = 'unreadable' | 'too-big' | 'linked' | 'wrong-version' | 'bad-shape' | 'not-private' | 'unsupported';

/** What main hands the window at launch. `saved` carries a read that passed every check. */
export type SavedScanAnswer =
  | { readonly status: 'none' }
  | { readonly status: 'damaged'; readonly why: DamageWhy }
  | { readonly status: 'saved'; readonly savedAtMs: number; readonly chosen: readonly RealPlace[]; readonly result: RealResult };

/**
 * The answer of the folder check: the watched folders are as they were, they changed, or they could not be checked (a folder could not be found again from the path the window shows,
 * or the check ran out of time). `unchecked` is never `same`: a note says so, and Read again is the way on.
 */
export type SavedScanCheck = 'same' | 'changed' | 'unchecked';

export type ParsedSavedScan = { readonly ok: true; readonly scan: SavedScan } | { readonly ok: false; readonly why: DamageWhy };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isText = (v: unknown, max = 100000): v is string => typeof v === 'string' && v.length <= max;
const isTexts = (v: unknown, max = 10000): v is string[] => Array.isArray(v) && v.length <= max && v.every(x => isText(x));
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

const COUNT_KEYS = ['agents', 'skills', 'tools', 'hooks', 'notes'] as const;
const WORLD_KEYS = ['interfaces', 'items', 'scopes', 'overrides', 'wikiPages', 'slices', 'versions', 'libraries'] as const;
const KINDS: readonly string[] = ['home', 'project', 'picked'];

/**
 * The most each list may hold: what the reader can hand over in one read, taken from its own limits and its own sets of notes (`TOPIC_SLICES` topic sets and one set of the whole place, for each
 * place, each one also an item). A read the reader can make must never pass a cap in the wrong direction, because a file refused here is not shown. A file past a cap cannot have been made
 * by the reader, and the window does work for each entry, so it is refused before anything walks it. Items are the files read (skills, agents, prompts: at most `itemsPerCall`), the
 * connections and hooks (a file of settings may hold up to `recordsPerFile`, so a further `itemsPerCall`), and one item for each set of notes.
 */
const PLACES = REAL_LIMITS.places, SETS_PER_PLACE = TOPIC_SLICES + 1, PER_CALL = REAL_LIMITS.itemsPerCall + PLACES;
export const SAVED_SCAN_CAPS = Object.freeze({
  places: PLACES,
  scopes: PLACES + 1,
  slices: PLACES * SETS_PER_PLACE,
  setsPerPlace: SETS_PER_PLACE,
  items: 2 * REAL_LIMITS.itemsPerCall + PLACES * SETS_PER_PLACE,
  // The reader checks its budget after it has taken a page, so a read may hold a page or two past the per-call cap: a margin of one for each place.
  wikiPages: PER_CALL, overrides: PER_CALL, others: PER_CALL, ages: PER_CALL,
  harnessPlaces: PLACES, interfaces: 20, versions: 1000, libraries: 1000,
  /** An agent's lists (skills it names, connections it uses): a front matter line, so a few hundred at most. */
  agentList: REAL_LIMITS.recordsPerFile,
  /** What a set's rule may hold: the reader makes one folder for each set; a little room is left. */
  ruleFolders: 5, ruleFolderChars: 600, ruleWords: 20,
});
/** The last moment a date can hold, in milliseconds since 1970. */
const LAST_DATE_MS = 8.64e15;
/** The id of a set of notes the reader makes: the place's key, and for a topic set the topic's key (shared/real/map-world.ts). */
const SET_ID = /^real-notes-([0-9a-f]{16})(?:-[0-9a-f]{16})?$/;

const countsOk = (v: unknown): boolean => isObject(v) && COUNT_KEYS.every(k => isCount(v[k]));
const hasId = (v: unknown): boolean => isObject(v) && typeof v.id === 'string';
const foundAtOk = (v: unknown): boolean => isArray(v) && v.length <= 100 && v.every(f => isObject(f) && typeof f.interface === 'string' && typeof f.path === 'string');
const baseItemOk = (v: unknown): v is Record<string, unknown> => isObject(v) && typeof v.id === 'string' && typeof v.kind === 'string' && typeof v.scopeId === 'string' && foundAtOk(v.foundAt);

function placeOk(v: unknown): boolean {
  if (!isObject(v)) return false;
  const d = v.details;
  return typeof v.id === 'string' && /^place-[0-9a-f]{12}$/.test(v.id) && isText(v.label, 400) && typeof v.kind === 'string' && KINDS.includes(v.kind) && isTexts(v.apps, 50) && isText(v.appLabel, 400)
    && countsOk(v.counts) && typeof v.empty === 'boolean'
    && isObject(d) && isText(d.path, 4096) && isTexts(d.folders) && isTexts(d.notes) && isArray(d.topics) && d.topics.every(t => isObject(t) && isText(t.name, 400) && isCount(t.count));
}

/** A slice's rule: the folders it takes pages from (one for each set the reader makes), and the page types and tags (the reader leaves both empty). */
function ruleOk(rule: unknown): boolean {
  if (!isObject(rule) || !isArray(rule.folders) || rule.folders.length < 1 || rule.folders.length > SAVED_SCAN_CAPS.ruleFolders) return false;
  if (!rule.folders.every(f => isText(f, SAVED_SCAN_CAPS.ruleFolderChars))) return false;
  const types = rule.pageTypesAndTags;
  return isObject(types) && isTexts(types.types, SAVED_SCAN_CAPS.ruleWords) && isTexts(types.tags, SAVED_SCAN_CAPS.ruleWords);
}

/**
 * `null` when the result is believed; `too-big` when a list is longer than the reader can make (the file is left as it is: a wrong guess about a cap must never destroy a read);
 * `bad-shape` for anything else. The sizes are checked first, so a list of a hundred thousand entries is never walked, and the sets of notes are held to the reader's own structure:
 * ids it makes, each place's sets with the set of the whole place among them, so the window's work to list their pages stays in step with the pages.
 */
function resultWhy(v: unknown): DamageWhy | null {
  if (!isObject(v)) return 'bad-shape';
  const w = v.world, C = SAVED_SCAN_CAPS;
  if (!isObject(w) || !WORLD_KEYS.every(k => isArray(w[k])) || !isArray(v.others) || !isObject(v.ages)) return 'bad-shape';
  const lists = w as Record<(typeof WORLD_KEYS)[number], unknown[]>;
  if (lists.items.length > C.items || lists.wikiPages.length > C.wikiPages || lists.scopes.length > C.scopes || lists.slices.length > C.slices || lists.overrides.length > C.overrides
    || lists.interfaces.length > C.interfaces || lists.versions.length > C.versions || lists.libraries.length > C.libraries || v.others.length > C.others || Object.keys(v.ages).length > C.ages
    || (isArray(v.harnessPlaces) && v.harnessPlaces.length > C.harnessPlaces)) return 'too-big';
  if (v.harnessPlaces !== undefined && !isArray(v.harnessPlaces)) return 'bad-shape';
  if (!lists.scopes.every(hasId) || !lists.wikiPages.every(hasId)) return 'bad-shape';
  // The sets of notes.
  const ids = new Set<string>(), perPlace = new Map<string, number>();
  for (const s of lists.slices) {
    const id = isObject(s) && typeof s.id === 'string' ? s.id : '', key = SET_ID.exec(id)?.[1];
    if (key === undefined || !isObject(s) || !ruleOk(s.rule)) return 'bad-shape';
    // Two folder names can meet under the id's hash: the reader then makes two sets with one id. That is the reader's fault, not a broken file: it is refused and left.
    if (ids.has(id)) return 'unsupported';
    ids.add(id);
    perPlace.set(key, (perPlace.get(key) ?? 0) + 1);
  }
  for (const [key, n] of perPlace) {
    if (!ids.has(`real-notes-${key}`)) return 'bad-shape';
    if (n > C.setsPerPlace) return 'too-big';
  }
  if (perPlace.size > C.places) return 'too-big';
  // The items.
  let sets = 0;
  for (const item of lists.items) {
    if (!baseItemOk(item)) return 'bad-shape';
    if (item.kind === 'context-slice') {
      sets += 1;
      if (typeof item.sliceId !== 'string' || !ids.has(item.sliceId)) return 'bad-shape';
    } else if (item.kind === 'agent') {
      const d = item.definition;
      if (!isObject(d)) return 'bad-shape';
      if (!isArray(d.skillIds) || !isArray(d.toolAttachments)) return 'bad-shape';
      if (d.skillIds.length > C.agentList || d.toolAttachments.length > C.agentList) return 'too-big';
      if (!d.skillIds.every(x => typeof x === 'string') || !d.toolAttachments.every(t => isObject(t) && typeof t.toolId === 'string')) return 'bad-shape';
      // The reader never gives an agent a set of notes. The window looks the set up in the list of items for each agent, so a file full of them would make the window do heavy work.
      if (d.sliceId !== undefined) return 'unsupported';
    }
  }
  if (sets > C.slices) return 'too-big';
  if (!countsOk(v.counts) || typeof v.stoppedEarly !== 'boolean' || !isCount(v.couldNotRead) || !isCount(v.partlyRead) || !isCount(v.textsCut) || !isTexts(v.notes) || v.readOnly !== true) return 'bad-shape';
  return null;
}

/** Believes a text only when it is a saved read of this version, of a sane size, with every part in the shape the window expects. Never throws. */
export function parseSavedScan(text: string): ParsedSavedScan {
  if (typeof text !== 'string' || text.length > SAVED_SCAN_MAX_BYTES) return { ok: false, why: 'too-big' };
  let v: unknown;
  try { v = JSON.parse(text) as unknown; } catch { return { ok: false, why: 'bad-shape' }; }
  if (!isObject(v)) return { ok: false, why: 'bad-shape' };
  if (typeof v.version === 'number' && v.version !== SAVED_SCAN_VERSION) return { ok: false, why: 'wrong-version' };
  if (v.version !== SAVED_SCAN_VERSION) return { ok: false, why: 'bad-shape' };
  if (!isCount(v.savedAtMs) || v.savedAtMs > LAST_DATE_MS || typeof v.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(v.fingerprint)) return { ok: false, why: 'bad-shape' };
  if (!isArray(v.chosen) || v.chosen.length === 0 || v.chosen.length > REAL_LIMITS.places || !v.chosen.every(placeOk)) return { ok: false, why: 'bad-shape' };
  const why = resultWhy(v.result);
  if (why !== null) return { ok: false, why };
  return { ok: true, scan: v as unknown as SavedScan };
}
