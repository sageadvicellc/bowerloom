/**
 * The saved read: the last answer of the reader, kept in the app's own state folder so the next launch can show it without reading any folder. It holds only what the window
 * already received (the places of step one and the result of step two, with `~` paths and hidden keys), a version, the time of the read, and a fingerprint of the watched folders.
 * The file is untrusted when it is loaded: `parseSavedScan` checks its size, its version and its shape, and gives a plain reason when it cannot be believed. Pure: no file, no clock.
 */
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
export type DamageWhy = 'unreadable' | 'too-big' | 'linked' | 'wrong-version' | 'bad-shape';

/** What main hands the window at launch. `saved` carries a read that passed every check. */
export type SavedScanAnswer =
  | { readonly status: 'none' }
  | { readonly status: 'damaged'; readonly why: DamageWhy }
  | { readonly status: 'saved'; readonly savedAtMs: number; readonly chosen: readonly RealPlace[]; readonly result: RealResult };

/** The answer of the folder check: the watched folders are as they were, or they changed (or could not be checked to the end). */
export type SavedScanCheck = 'same' | 'changed';

export type ParsedSavedScan = { readonly ok: true; readonly scan: SavedScan } | { readonly ok: false; readonly why: DamageWhy };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isText = (v: unknown, max = 100000): v is string => typeof v === 'string' && v.length <= max;
const isTexts = (v: unknown, max = 10000): v is string[] => Array.isArray(v) && v.length <= max && v.every(x => isText(x));
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

const COUNT_KEYS = ['agents', 'skills', 'tools', 'hooks', 'notes'] as const;
const WORLD_KEYS = ['interfaces', 'items', 'scopes', 'overrides', 'wikiPages', 'slices', 'versions', 'libraries'] as const;
const KINDS: readonly string[] = ['home', 'project', 'picked'];

const countsOk = (v: unknown): boolean => isObject(v) && COUNT_KEYS.every(k => isCount(v[k]));

function placeOk(v: unknown): boolean {
  if (!isObject(v)) return false;
  const d = v.details;
  return typeof v.id === 'string' && /^place-[0-9a-f]{12}$/.test(v.id) && isText(v.label, 400) && typeof v.kind === 'string' && KINDS.includes(v.kind) && isTexts(v.apps, 50) && isText(v.appLabel, 400)
    && countsOk(v.counts) && typeof v.empty === 'boolean'
    && isObject(d) && isText(d.path, 4096) && isTexts(d.folders) && isTexts(d.notes) && isArray(d.topics) && d.topics.every(t => isObject(t) && isText(t.name, 400) && isCount(t.count));
}

function resultOk(v: unknown): boolean {
  if (!isObject(v)) return false;
  const w = v.world;
  return isObject(w) && WORLD_KEYS.every(k => isArray(w[k])) && isArray(v.others) && countsOk(v.counts) && isObject(v.ages)
    && typeof v.stoppedEarly === 'boolean' && isCount(v.couldNotRead) && isCount(v.partlyRead) && isCount(v.textsCut) && isTexts(v.notes) && v.readOnly === true
    && (v.harnessPlaces === undefined || isArray(v.harnessPlaces));
}

/** Believes a text only when it is a saved read of this version, of a sane size, with every part in the shape the window expects. Never throws. */
export function parseSavedScan(text: string): ParsedSavedScan {
  if (typeof text !== 'string' || text.length > SAVED_SCAN_MAX_BYTES) return { ok: false, why: 'too-big' };
  let v: unknown;
  try { v = JSON.parse(text) as unknown; } catch { return { ok: false, why: 'bad-shape' }; }
  if (!isObject(v)) return { ok: false, why: 'bad-shape' };
  if (typeof v.version === 'number' && v.version !== SAVED_SCAN_VERSION) return { ok: false, why: 'wrong-version' };
  if (v.version !== SAVED_SCAN_VERSION) return { ok: false, why: 'bad-shape' };
  if (!isCount(v.savedAtMs) || typeof v.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(v.fingerprint)) return { ok: false, why: 'bad-shape' };
  if (!isArray(v.chosen) || v.chosen.length === 0 || v.chosen.length > REAL_LIMITS.places || !v.chosen.every(placeOk)) return { ok: false, why: 'bad-shape' };
  if (!resultOk(v.result)) return { ok: false, why: 'bad-shape' };
  return { ok: true, scan: v as unknown as SavedScan };
}
