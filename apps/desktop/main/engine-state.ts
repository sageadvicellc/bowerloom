/**
 * The private state root of the install sheets in the window: `$XDG_STATE_HOME/bowerloom` when that is an absolute path, else `~/.local/state/bowerloom`,
 * the same rule as the command line (packages/project-context, privateStateRoot). It reads that one variable and nothing else of the environment,
 * and the preview switch below.
 */
import { privateStateRoot } from '../../../packages/project-context/src/index.js';
import { PREVIEW_ENGINES_ENV, previewEnginesAllowed } from '../../../packages/harness-definition/src/words.js';

export function engineStateRoot(home: string): string {
  const xdg = process.env.XDG_STATE_HOME;
  return privateStateRoot(xdg === undefined ? {} : { XDG_STATE_HOME: xdg }, home);
}

/**
 * Whether the app may install to preview engines (OpenCode, Pi, DeepSeek Harness): true only when BOWERLOOM_PREVIEW_ENGINES is exactly 1 in the environment
 * of the main process. It reads that one variable, and only the yes or no leaves this file. The window never sees the environment.
 */
export function enginePreviewSwitch(): boolean {
  return previewEnginesAllowed({ [PREVIEW_ENGINES_ENV]: process.env.BOWERLOOM_PREVIEW_ENGINES });
}

/**
 * The environment the usage log and the problem report see: the program search path (to find each engine's version command) and the log's off switch
 * (BOWERLOOM_EVENT_LOG=off), and nothing else of the main process's environment.
 */
export function diagnosticsEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, BOWERLOOM_EVENT_LOG: process.env.BOWERLOOM_EVENT_LOG };
}
