/**
 * The time of a save point as a person says it: "Today, 8:42 AM", "Yesterday, 5:05 PM", "24 October, 9:30 AM" (and the year when it is not this year). The screen reads its own
 * clock when the person saves and passes these words to the store with the action, so the store stays pure and the history shows a real time. This file reads no clock
 * itself: both dates come in. The locale comes in too (the screen passes none, so the time follows the computer; the tests pass one). Pure: no React, no DOM.
 */

const MONTHS: readonly string[] = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The day before `now`, at the same time of day (a day is 24 hours except where the clocks change, so the date is read, not computed from milliseconds). */
const dayBefore = (now: Date): Date => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);

/** The time of day, in the person's own style ("8:42 AM" or "08:42"). */
export function timeOfDay(at: Date, locale?: string): string {
  // Newer text libraries put a narrow no-break space before "AM": it is made an ordinary space, so the words read, wrap and compare as they look.
  return at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }).replace(/[\u202f\u00a0]/g, ' ');
}

/** The words for the moment `at`, seen from `now`. */
export function clockWords(at: Date, now: Date, locale?: string): string {
  const time = timeOfDay(at, locale);
  if (sameDay(at, now)) return `Today, ${time}`;
  if (sameDay(at, dayBefore(now))) return `Yesterday, ${time}`;
  const day = `${at.getDate()} ${MONTHS[at.getMonth()] ?? ''}`;
  return at.getFullYear() === now.getFullYear() ? `${day}, ${time}` : `${day} ${at.getFullYear()}, ${time}`;
}
