// The numbers a look gives to controls. A number is valid from the look that made it until the screen is started again (goto), or the next look
// replaces the list. A number that is not valid gets a plain error that says what to do. The page keeps the real controls; this table only knows how many there are.
import { PersonaError } from './protocol.mjs';

export class HandleTable {
  #count = 0;
  #state = 'none'; // 'none' (no look yet), 'valid', or 'stale' (the screen was started again)

  /** A look made `count` numbers. They replace the earlier ones. */
  replace(count) { this.#count = count; this.#state = 'valid'; }

  /** The screen was started again (goto). Every number is old now. */
  invalidate() { this.#state = this.#state === 'none' ? 'none' : 'stale'; }

  get count() { return this.#count; }

  /** The number as a zero-based index, or a plain error. */
  indexOf(n) {
    if (this.#state === 'none') throw new PersonaError('There are no numbered controls yet. Run look first.');
    if (this.#state === 'stale') throw new PersonaError(`Control [${n}] is out of date, because the screen was started again. Run look to get new numbers.`);
    if (!Number.isInteger(n) || n < 1 || n > this.#count) throw new PersonaError(`There is no control [${n}]. The last look showed [1] to [${this.#count}].`);
    return n - 1;
  }
}

/** The plain error for a control that was in the last look and is not on the screen now. */
export const goneMessage = n => `Control [${n}] is not on the screen any more. The screen changed. Run look to get new numbers.`;
export const coveredMessage = n => `Control [${n}] is covered by something else, so a person could not press it. Close what is on top of it, or run look.`;
export const hiddenMessage = n => `Control [${n}] has no size on the screen, so a person could not press it. Run look.`;
export const outMessage = n => `Control [${n}] is outside the window and scrolling does not bring it into view, so a person could not reach it.`;
