/**
 * The private state root of the install sheets in the window: `$XDG_STATE_HOME/bowerloom` when that is an absolute path, else `~/.local/state/bowerloom`,
 * the same rule as the command line (packages/project-context, privateStateRoot). It reads that one variable and nothing else of the environment.
 */
import { privateStateRoot } from '../../../packages/project-context/src/index.js';

export function engineStateRoot(home: string): string {
  const xdg = process.env.XDG_STATE_HOME;
  return privateStateRoot(xdg === undefined ? {} : { XDG_STATE_HOME: xdg }, home);
}
