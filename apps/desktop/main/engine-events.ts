/**
 * The app's side of the local usage log (packages/diagnostics): one recorder that writes a line to the log in the private state root. The log stays on this
 * computer. It holds no name, path or file text, and the person turns it off with BOWERLOOM_EVENT_LOG=off. A write that fails is logged to the console and
 * never thrown, so it can never change the result of a call.
 */
import { recordEvent } from '../../../packages/diagnostics/src/index.js';

export interface RecorderDeps {
  readonly stateRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  /** The home folder, hidden as `~` in a note before it is stored. */
  readonly home?: string;
  /** Where a failed write is told. Default: the console. */
  readonly onFailure?: (message: string) => void;
}

/** Returns true only when a line was written. False when the log is off or the write failed (a failure is told, never thrown). */
export function createRecorder(deps: RecorderDeps): (input: Readonly<Record<string, unknown>>) => boolean {
  const now = deps.now ?? (() => new Date());
  const tell = deps.onFailure ?? ((message: string) => console.error(message));
  return input => {
    try {
      const result = recordEvent({ stateRoot: deps.stateRoot, env: deps.env, now: now(), ...(deps.home === undefined ? {} : { home: deps.home }) }, input);
      if (!result.ok) { tell(`Bowerloom could not write its local event log: ${result.code}`); return false; }
      if (result.notice !== undefined) tell(result.notice);
      return result.written;
    } catch {
      tell('Bowerloom could not write its local event log: FAILED');
      return false;
    }
  };
}
