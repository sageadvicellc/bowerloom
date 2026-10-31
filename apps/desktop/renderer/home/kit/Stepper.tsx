/**
 * A row of steps: for each step a small numbered circle and its words, as in a feature carousel but with no pill and no button. It only shows where a person is; it is not pressed.
 * A step that is done is a filled circle with a check (the one place in the home app where a check is right, because it says a step is finished) and muted words; the step
 * you are on is a larger circle in the accent colour with accent words; a step to come is dim. `current` is the index of the step you are on; a number past the last step
 * means all are done. It is an ordered list with a name, and the current step has `aria-current="step"`.
 * `compact` is for a small card (the tour): circles only, and only the current step shows its words. The words of the others stay for a screen reader.
 * `currentText` replaces the words of the current step (the tour says "Step 2 of 7" there).
 */
import type { ReactElement } from 'react';
import { KitIcon } from './icons.js';
import './stepper.css';

export type StepState = 'done' | 'now' | 'next';

/** The state of step `index` when the person is on step `current`. A `current` below 0 means nothing is done yet; one past the last step means all are done. */
export function stepState(index: number, current: number): StepState {
  return index < current ? 'done' : index === current ? 'now' : 'next';
}

export interface StepperProps {
  /** The words of each step, in order. */
  steps: readonly string[];
  /** The index of the step the person is on. */
  current: number;
  /** The name of the list, for a screen reader. */
  label: string;
  compact?: boolean;
  currentText?: string;
  /** The word a screen reader hears after a step that is done. */
  doneWord?: string;
}

export function Stepper({ steps, current, label, compact = false, currentText, doneWord }: StepperProps): ReactElement {
  return (
    <ol className="kit-stepper" aria-label={label} data-compact={compact ? '' : undefined}>
      {steps.map((words, i) => {
        const state = stepState(i, current);
        const text = state === 'now' && currentText !== undefined ? currentText : words;
        return (
          <li key={`${i}-${words}`} className="kit-step" data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="kit-step-dot" aria-hidden="true">{state === 'done' ? <KitIcon name="check" size={compact ? 14 : 16} /> : i + 1}</span>
            <span className={compact && state !== 'now' ? 'kit-step-label hm-sr' : 'kit-step-label'}>{text}{state === 'done' && doneWord !== undefined ? <span className="hm-sr"> {doneWord}</span> : null}</span>
          </li>
        );
      })}
    </ol>
  );
}
