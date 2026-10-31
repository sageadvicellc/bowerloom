/**
 * Which step of the Find flow a person is on, as pure logic for the stepper (kit/Stepper.tsx). Three steps: Look (the search), Choose (the list to tick) and Read (the question
 * "Read what is inside?" and the reading). A number past the last step means all are done. No React, no DOM, no clock.
 * The sample flow (shared/home/find-flow.ts) and the reader of the person's own setup (real/flow.ts) have different step names, so each has its own mapping.
 */
import type { FindStep } from '../../../shared/home/find-flow.js';
import type { RealStep } from '../real/flow.js';
import { FIND_WORDS } from './find-words.js';

/** The words of the three steps, in order. */
export const FIND_STEP_WORDS: readonly string[] = Object.freeze([FIND_WORDS.label.stepLook, FIND_WORDS.label.stepChoose, FIND_WORDS.label.stepRead]);
/** The index that means every step is done. */
export const FIND_STEPS_DONE = FIND_STEP_WORDS.length;

/**
 * The step of the sample flow. `read` is true when the contents were already read before this list showed (real mode): the list is then the end of the flow, so all steps are done.
 * A person who said "Not now" is leaving, so the screen shows the step they were on (Choose).
 */
export function stageOfFind(step: FindStep, read = false): number {
  if (read) return FIND_STEPS_DONE;
  switch (step) {
    case 'looking': return 0;
    case 'places': return 1;
    case 'left': return 1;
    case 'confirm': return 2;
    case 'reading': return 2;
    case 'done': return FIND_STEPS_DONE;
  }
}

/** The step of the reader of the person's own setup. A failure shows the step that failed: `retry` says where "Try again" goes back to (the search, or the list of places). */
export function stageOfReal(step: RealStep, retry: 'start' | 'places'): number {
  switch (step) {
    case 'start': return 0;
    case 'looking': return 0;
    case 'places': return 1;
    case 'confirm': return 2;
    case 'reading': return 2;
    case 'done': return FIND_STEPS_DONE;
    case 'error': return retry === 'start' ? 0 : 1;
  }
}
