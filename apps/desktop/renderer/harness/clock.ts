/**
 * The one place of the harness-first preview that reads the computer's clock. It turns "now" into the plain stamp (a day count and a time of day) that the store takes.
 * Everything else (the store, the sample, the words) is pure, so a test can run it with a fixed stamp.
 */
import type { Stamp } from '../../shared/harness/types.js';

const two = (n: number): string => String(n).padStart(2, '0');

/** Now, as a stamp on today. */
export function realNow(): Stamp {
  const at = new Date();
  return { daysAgo: 0, time: `${two(at.getHours())}:${two(at.getMinutes())}` };
}

/** Now, in milliseconds since 1970: the time shown as "Last read" after a read ends in this window. */
export const realNowMs = (): number => Date.now();

/** A moment as one plain line, such as "Nov 5, 2026, 3:12 PM", in the zone of this computer (or the zone given, for a test). Null for a time that is not a number. */
export function clockText(atMs: number, timeZone?: string): string | null {
  if (!Number.isFinite(atMs) || Number.isNaN(new Date(atMs).getTime())) return null;
  // The time of day is written with a narrow space in some versions of the text library; one plain space keeps the line the same everywhere.
  return new Date(atMs).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', ...(timeZone === undefined ? {} : { timeZone }) }).replace(/\s/g, ' ');
}
