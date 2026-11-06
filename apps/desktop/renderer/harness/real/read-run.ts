/**
 * The end of a read (question two). The answer is mapped to the state of the preview; an answer with nothing in it goes back to the list with what the reader said; otherwise the state is
 * loaded and the app goes to Read. Anything that throws on the way (the mapping, the load, the move) ends on the error screen and is logged, so a bar never moves for ever.
 * The `.then(ok).catch(fail)` shape is the point: a throw inside `ok` is caught too.
 */
import type { HarnessState } from '../../../shared/harness/types.js';
import { realToHarnessState } from '../../../shared/harness/real-map.js';
import type { RealPlace, RealResult } from '../../../shared/real/types.js';
import { codeOf } from '../../home/real/bridge.js';
import type { ChooseAction } from './state.js';

export interface ReadDeps {
  /** Loads the state into the store. */
  apply(next: HarnessState): void;
  send(action: ChooseAction): void;
  /** Goes on to the Read screen. */
  leave(): void;
  /** False once the screen has gone: nothing is said to it then. */
  isLive(): boolean;
  /** Where an error is written for the person who runs the app. */
  log?(error: unknown): void;
}

export function runRead(read: Promise<RealResult>, chosen: readonly RealPlace[], deps: ReadDeps): Promise<void> {
  return read.then(result => {
    if (!deps.isLive()) return;
    const next = realToHarnessState(result, chosen);
    if (next.parts.length === 0) { deps.send({ type: 'emptied', real: next.real! }); return; }
    deps.apply(next);
    deps.send({ type: 'done' });
    deps.leave();
  }).catch((error: unknown) => {
    (deps.log ?? ((e: unknown) => console.error('The read could not be finished.', e)))(error);
    if (deps.isLive()) deps.send({ type: 'fail', code: codeOf(error) });
  });
}
