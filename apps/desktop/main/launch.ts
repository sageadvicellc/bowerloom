/**
 * How the app starts, as plain data. A built app with no flag opens the harness-first app on the person's own folders, with the lasting data folder of the app.
 * `--sample` opens the same app on made-up folders (no bridge, no calls, a temporary data folder): that is the flag for tests and demos.
 * The start fails closed: an argument that looks like a mode flag but is not exactly a known one (`--Sample`, `--sample=1`, `--smaple`, `--home-real`) is refused,
 * so a misspelled or retired flag never opens the app on the person's own folders. A dash of any kind counts as a hyphen, the short forms and whole words of a mode
 * (`sam`, `sa`, a bare `sample`, `demo`, `mock`, `fake`, `test`) are refused, and `--sample-preview-engines` without `--sample` is refused.
 * Pure: the arguments go in, the plan comes out, so a test can read it without Electron.
 */
import { SAMPLE_PREVIEW_FLAG } from '../shared/engine/sample-switch.js';
import { BASE, REAL_BASE } from '../shared/harness/route.js';

export const FLAGS = Object.freeze({ sample: '--sample' });

export type LaunchKind = 'app' | 'sample' | 'refused';

export interface Launch {
  readonly kind: LaunchKind;
  /** The address the window opens on. The page is told its mode by this address, never by whether a bridge is there. */
  readonly hash: string;
  /** The bridge script the window gets: the reader and the engine calls, or none at all. */
  readonly preload: 'real' | 'none';
  /** Whether main answers the three calls of the read-only reader. */
  readonly realReader: boolean;
  /** Whether main answers the adopt, install and save calls (these read until a person approves a plan, and then write through the packages). */
  readonly engineCalls: boolean;
  /** True for the made-up launch: it keeps its own temporary data folder and removes it when the app quits. */
  readonly temporaryData: boolean;
  readonly samplePreviewEngines: boolean;
  /** For a refused start: the words main writes to the terminal before it exits. Null for any other start. */
  readonly refusal: string | null;
}

const APP: Launch = Object.freeze({ kind: 'app', hash: REAL_BASE, preload: 'real', realReader: true, engineCalls: true, temporaryData: false, samplePreviewEngines: false, refusal: null });

/** The flags this launch plan knows. Anything else that looks like a mode flag is refused. */
const KNOWN = new Set<string>([FLAGS.sample, SAMPLE_PREVIEW_FLAG]);

/** The number of single-letter edits (insert, delete, change, swap of two neighbours) between two short words. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** Every dash a person or a document can type for a hyphen: the hyphen-minus, U+2010 to U+2015, the minus sign U+2212, and the small and wide forms. */
const DASH = '-\\u2010-\\u2015\\u2212\\ufe58\\ufe63\\uff0d';
const LEADING_DASHES = new RegExp(`^[${DASH}]+`);
const STARTS_WITH_DASH = new RegExp(`^[${DASH}]`);
/** Whole words that name a mode: a short form of `sample`, or a word for a made-up or test start. Only the whole word counts, so `--test-type` of Chromium is left alone. */
const MODE_WORDS = new Set<string>(['sample', 'samp', 'sam', 'sa', 'demo', 'mock', 'fake', 'test']);

/** True for an argument that is meant as a mode flag of this app: `sample` or `home` at the start of its name (any case, any value after `=`), a near miss of `sample`, or a whole mode word (with or without dashes of any kind). */
function looksLikeModeFlag(arg: string): boolean {
  const dashed = STARTS_WITH_DASH.test(arg);
  const name = arg.replace(LEADING_DASHES, '').split('=')[0]!.toLowerCase();
  if (MODE_WORDS.has(name)) return true;
  if (!dashed) return false;
  if (name.startsWith('sample') || name.startsWith('home')) return true;
  const head = name.split(new RegExp(`[${DASH}]`))[0]!;
  return head.length >= 4 && distance(head, 'sample') <= 2;
}

/** The plan for a start. Any other argument is left to Chromium, unless it looks like a mode flag, which refuses the start. */
export function launchOf(argv: readonly string[]): Launch {
  const bad = argv.find(arg => looksLikeModeFlag(arg) && !KNOWN.has(arg));
  if (bad !== undefined) {
    return Object.freeze({ kind: 'refused', hash: REAL_BASE, preload: 'none', realReader: false, engineCalls: false, temporaryData: false, samplePreviewEngines: false, refusal: `Bowerloom does not know "${bad}". Use no flag to open the app on your own folders, or --sample to open it on made-up folders.` });
  }
  // The preview switch belongs to the sample. Alone it would change nothing, so a person who typed it meant something else: refuse, never guess.
  if (argv.includes(SAMPLE_PREVIEW_FLAG) && !argv.includes(FLAGS.sample)) {
    return Object.freeze({ kind: 'refused', hash: REAL_BASE, preload: 'none', realReader: false, engineCalls: false, temporaryData: false, samplePreviewEngines: false, refusal: `Bowerloom: "${SAMPLE_PREVIEW_FLAG}" works only together with ${FLAGS.sample}. Use ${FLAGS.sample} ${SAMPLE_PREVIEW_FLAG}, or no flag to open the app on your own folders.` });
  }
  if (argv.includes(FLAGS.sample)) return Object.freeze({ kind: 'sample', hash: BASE, preload: 'none', realReader: false, engineCalls: false, temporaryData: true, samplePreviewEngines: argv.includes(SAMPLE_PREVIEW_FLAG), refusal: null });
  return APP;
}
