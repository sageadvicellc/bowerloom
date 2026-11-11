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

/** Now, as the ISO text of the sample bridge's reads. */
export const realNowIso = (): string => new Date().toISOString();

/** A moment as one plain line, such as "Nov 5, 2026, 3:12 PM", in the zone of this computer (or the zone given, for a test). Null for a time that is not a number. */
export function clockText(atMs: number, timeZone?: string): string | null {
  if (!Number.isFinite(atMs) || Number.isNaN(new Date(atMs).getTime())) return null;
  // The time of day is written with a narrow space in some versions of the text library; one plain space keeps the line the same everywhere.
  return new Date(atMs).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', ...(timeZone === undefined ? {} : { timeZone }) }).replace(/\s/g, ' ');
}

// ---- the times of the recorded runs (Runs, Compare and the Add a run form), in the zone of this computer

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** "Nov 11, 10:30", in the computer's own time zone. An unreadable time is "Unknown time". */
export function startedAtWords(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Unknown time';
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The value of a `datetime-local` field ("2026-11-11T10:30", in the computer's time zone) as the ISO time main takes, or null. */
export function localInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (m === null) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
/** The value for a `datetime-local` field for a moment, in the computer's time zone. */
export function isoToLocalInput(ms: number): string {
  const d = new Date(ms), two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

