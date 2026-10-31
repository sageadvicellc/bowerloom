/**
 * How the app starts, as plain data. A built app with no flag opens the harness-first app on the person's own folders, with the lasting data folder of the app.
 * `--sample` opens the same app on made-up folders (no bridge, no calls, a temporary data folder): that is the flag for tests and demos.
 * The start fails closed: an argument that looks like a mode flag but is not exactly a known one (`--Sample`, `--sample=1`, `--smaple`, `--home-real`) is refused,
 * so a misspelled or retired flag never opens the app on the person's own folders.
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

/** True for an argument that is meant as a mode flag of this app: `sample` or `home` at the start of its name (any case, any value after `=`), or a near miss of `sample`. */
function looksLikeModeFlag(arg: string): boolean {
  if (!arg.startsWith('-')) return false;
  const name = arg.replace(/^-+/, '').split('=')[0]!.toLowerCase();
  if (name.startsWith('sample') || name.startsWith('home')) return true;
  const head = name.split('-')[0]!;
  return head.length >= 4 && distance(head, 'sample') <= 2;
}

/** The plan for a start. Any other argument is left to Chromium, unless it looks like a mode flag, which refuses the start. */
export function launchOf(argv: readonly string[]): Launch {
  const bad = argv.find(arg => looksLikeModeFlag(arg) && !KNOWN.has(arg));
  if (bad !== undefined) {
    return Object.freeze({ kind: 'refused', hash: REAL_BASE, preload: 'none', realReader: false, engineCalls: false, temporaryData: false, samplePreviewEngines: false, refusal: `Bowerloom does not know "${bad}". Use no flag to open the app on your own folders, or --sample to open it on made-up folders.` });
  }
  if (argv.includes(FLAGS.sample)) return Object.freeze({ kind: 'sample', hash: BASE, preload: 'none', realReader: false, engineCalls: false, temporaryData: true, samplePreviewEngines: argv.includes(SAMPLE_PREVIEW_FLAG), refusal: null });
  return APP;
}
