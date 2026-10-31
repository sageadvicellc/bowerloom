/**
 * Types and limits of the read-only reader of a real setup (the `--prototype-real` mode of the 0.8 preview).
 * Everything here is plain data. The reader looks at the person's tool folders, and shows names, descriptions, structure and the NAMES of keys. For the skills and agents the person ticks it also keeps their text
 * (up to `excerptChars` of each file). Key and password shapes that it knows are hidden from that text; the check goes by shape, so it is best effort. It never writes. The bridge that the page gets has exactly three calls (see `RealBridge`).
 */
import type { World } from '../world/types.js';

/** The programs the reader knows. The first three are the interfaces of the sample world; the other two are best effort. */
export type RealApp = 'claude-code' | 'codex' | 'opencode' | 'hermes' | 'bowerloom';

/** The kinds of thing an adapter can find. `prompt` is a saved prompt (a slash command); `hook` runs code on its own. */
export type RealKind = 'skill' | 'agent' | 'prompt' | 'mcp' | 'hook';

/** Where a place sits: in a tool folder under the home folder, in a work folder found by walking down, or in a folder the person picked. */
export type RealPlaceKind = 'home' | 'project' | 'picked';

/** Every limit of the reader, in one place. A test holds the reader to each. */
export const REAL_LIMITS = Object.freeze({
  /** Files looked at in one place when its contents are read. */
  filesPerPlace: 5000,
  /** The biggest file that is read at all. A bigger one is skipped and counted. */
  fileBytes: 2 * 1024 * 1024,
  /** How many folders deep the reader goes below a place or a picked folder. */
  depth: 6,
  /** How many places one session may list. */
  places: 200,
  /** Entries (files and folders) looked at while hunting for places in a picked folder. Names only: nothing is opened. */
  discoveryEntries: 50000,
  /** How long one call may run before it stops early and says so. */
  budgetMs: 25000,
  /** The most text the reader keeps for one hint line. */
  hintChars: 160,
  /** The most notes pages one place hands to the screen. */
  pagesPerPlace: 2000,
  /** The most characters of a note's title and summary. */
  noteChars: 120,
  /** The most bytes one call reads from all files together. At the cap the call stops early and says so. */
  totalBytes: 20 * 1024 * 1024,
  /** The most files (read for their text) and notes pages (read for their head) one call hands on. At the cap the call stops early and says so. */
  itemsPerCall: 10000,
  /** The most characters of one text that go to the page. A longer text is cut and marked. */
  excerptChars: 20000,
  /** The most characters of text, in all, that go to the page before every further text is cut to `minExcerptChars`. */
  resultTextChars: 4000000,
  /** The least of a text that still goes to the page after `resultTextChars` is spent. */
  minExcerptChars: 1000,
  /** The most connections or hooks one config file may give. */
  recordsPerFile: 500,
});

/** The kinds of thing the reader counts as not read, each of which can carry a few sample names. */
export type ProblemKind = 'tooBig' | 'binary' | 'unreadable' | 'linksOutside' | 'brokenLinks';
/** The most sample names kept for each kind, and the longest one (a name is a path below the folder, scrubbed and cut). */
export const SAMPLE_LIMIT = 5;
export const SAMPLE_CHARS = 80;

/** The counts of one place or of a whole result. `tools` are connections and saved prompts; `hooks` run code and are counted apart. */
export interface RealCounts { readonly agents: number; readonly skills: number; readonly tools: number; readonly hooks: number; readonly notes: number }

/** What a person can open behind "Show details": the folder, the tool folders found in it, the topics of its notes, and a plain line for each thing that went wrong. */
export interface RealPlaceDetails { readonly path: string; readonly folders: readonly string[]; readonly topics: readonly { readonly name: string; readonly count: number }[]; readonly notes: readonly string[] }

/** Step one: one place and what it holds, by count. No file name, no text. */
export interface RealPlace {
  readonly id: string;
  readonly label: string;
  readonly kind: RealPlaceKind;
  /** The names of the programs found in this place, as a person says them. */
  readonly apps: readonly string[];
  readonly appLabel: string;
  readonly counts: RealCounts;
  readonly empty: boolean;
  readonly details: RealPlaceDetails;
}

/** The answer to step one. `couldNotRead` counts things that were skipped (a file too big, a shortcut that leads away, a folder that would not open). */
export interface RealDiscovery {
  readonly places: readonly RealPlace[];
  readonly stoppedEarly: boolean;
  readonly couldNotRead: number;
  readonly notes: readonly string[];
  readonly readOnly: true;
}

/** The answer to the folder chooser: the places found in the folder, or `cancelled` when the person closed the chooser. */
export interface RealPicked extends RealDiscovery { readonly cancelled: boolean }

/** A thing found in a program the 0.8 world has no room for yet (Hermes, Bowerloom's own folder). Name and hint only. */
export interface RealOther { readonly app: string; readonly kind: RealKind; readonly name: string; readonly hint: string; readonly place: string }

/** The answer to step two: the world the home screens read, built from the selected places only. */
export interface RealResult {
  readonly world: World;
  readonly others: readonly RealOther[];
  readonly counts: RealCounts;
  /** For each item id, how many whole days ago each of its `foundAt` files was last changed, in the order of `foundAt`. Whole days, rounded down; never negative. */
  readonly ages: Readonly<Record<string, readonly number[]>>;
  readonly stoppedEarly: boolean;
  readonly couldNotRead: number;
  /** Files that were read but had a front matter block that could not be understood; they are listed with a name made from the file. */
  readonly partlyRead: number;
  /** Texts that were longer than the page is given and were cut (each ends with a mark that says so). */
  readonly textsCut: number;
  readonly notes: readonly string[];
  readonly readOnly: true;
}

/** The three calls the page gets, and nothing else. `window.bowerloomReal` is this object, frozen. */
export interface RealBridge {
  discoverPlaces(): Promise<RealDiscovery>;
  pickFolder(): Promise<RealPicked>;
  readSelected(placeIds: readonly string[]): Promise<RealResult>;
}

/** The names of the three calls, in the order the page makes them. */
export const REAL_CALLS = Object.freeze(['discoverPlaces', 'pickFolder', 'readSelected'] as const);

/** One channel for each call. They are not in `CHANNELS`: the normal bridge never sees them. */
export const REAL_CHANNELS = Object.freeze({
  discoverPlaces: 'bowerloom-real:discover-places',
  pickFolder: 'bowerloom-real:pick-folder',
  readSelected: 'bowerloom-real:read-selected',
} as const);

/** The page address of the real mode, and of the bare list that the test harness draws. */
export const REAL_HASH = '#prototype-v2/real';
export const REAL_HARNESS_HASH = '#prototype-v2/real-harness';
