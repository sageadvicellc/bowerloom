/**
 * How the app starts, as plain data. A built app with no flag opens the harness-first app on the person's own folders, with the lasting data folder of the app.
 * `--sample` opens the same app on made-up folders (no bridge, no calls, a temporary data folder): that is the flag for tests and demos.
 * Pure: the arguments go in, the plan comes out, so a test can read it without Electron.
 */
import { SAMPLE_PREVIEW_FLAG } from '../shared/engine/sample-switch.js';
import { BASE, REAL_BASE } from '../shared/harness/route.js';

export const FLAGS = Object.freeze({ sample: '--sample' });

export type LaunchKind = 'app' | 'sample';

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
}

const APP: Launch = Object.freeze({ kind: 'app', hash: REAL_BASE, preload: 'real', realReader: true, engineCalls: true, temporaryData: false, samplePreviewEngines: false });

/** The plan for a start. Any other argument is left to Chromium. */
export function launchOf(argv: readonly string[]): Launch {
  if (argv.includes(FLAGS.sample)) return Object.freeze({ kind: 'sample', hash: BASE, preload: 'none', realReader: false, engineCalls: false, temporaryData: true, samplePreviewEngines: argv.includes(SAMPLE_PREVIEW_FLAG) });
  return APP;
}
