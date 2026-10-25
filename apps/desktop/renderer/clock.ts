/**
 * The one place of the renderer that reads the computer's clock for the home app: the time a save point is made, in words ("Today, 8:42 AM"). The home app's own files never read
 * a clock (a test holds them to that), so the store stays pure: the screen asks for the words here when the person presses Save or Go back, and passes them in the action.
 */
import { clockWords } from '../shared/clock-words.js';

/** The time right now, in words, as the computer's own settings show it. */
export function nowInWords(): string {
  const now = new Date();
  return clockWords(now, now);
}
