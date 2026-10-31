/**
 * How the app starts, as plain data. A built app with no flag opens the harness-first app on the person's own folders, with the lasting data folder of the app.
 * `--sample` opens the same app on made-up folders (no bridge, no calls, a temporary data folder): that is the flag for tests and demos.
 * The home app of the 0.8 work keeps two dev flags, `--home-sample` and `--home-real`; no shipped screen leads to it.
 * Pure: the arguments go in, the plan comes out, so a test can read it without Electron.
 */
import { SAMPLE_PREVIEW_FLAG } from '../shared/engine/sample-switch.js';
import { BASE, REAL_BASE } from '../shared/harness/route.js';
import { REAL_HASH } from '../shared/real/types.js';

export const FLAGS = Object.freeze({ sample: '--sample', homeSample: '--home-sample', homeReal: '--home-real' });

export type LaunchKind = 'app' | 'sample' | 'home-sample' | 'home-real';

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
  /** True for the made-up launches: they keep their own temporary data folder and remove it when the app quits. */
  readonly temporaryData: boolean;
  readonly samplePreviewEngines: boolean;
}

const APP: Launch = Object.freeze({ kind: 'app', hash: REAL_BASE, preload: 'real', realReader: true, engineCalls: true, temporaryData: false, samplePreviewEngines: false });
const HOME_SAMPLE: Launch = Object.freeze({ kind: 'home-sample', hash: '#prototype-v2', preload: 'none', realReader: false, engineCalls: false, temporaryData: true, samplePreviewEngines: false });
const HOME_REAL: Launch = Object.freeze({ kind: 'home-real', hash: REAL_HASH, preload: 'real', realReader: true, engineCalls: false, temporaryData: true, samplePreviewEngines: false });

/** The plan for a start. With two mode flags the one with the fewest rights wins: the sample, then the home sample, then the home reader. Any other argument is left to Chromium. */
export function launchOf(argv: readonly string[]): Launch {
  if (argv.includes(FLAGS.sample)) return Object.freeze({ kind: 'sample', hash: BASE, preload: 'none', realReader: false, engineCalls: false, temporaryData: true, samplePreviewEngines: argv.includes(SAMPLE_PREVIEW_FLAG) });
  if (argv.includes(FLAGS.homeSample)) return HOME_SAMPLE;
  if (argv.includes(FLAGS.homeReal)) return HOME_REAL;
  return APP;
}
