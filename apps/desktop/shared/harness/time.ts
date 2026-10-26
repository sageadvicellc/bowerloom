/**
 * Times, as the person reads them. The store never reads a clock: the page hands it a `Stamp` (a day count and a time of day), so these are pure.
 */
import type { HistoryEntry, Run, Stamp } from './types.js';

/** "Today", "Yesterday" or "3 days ago". */
export function dayWords(daysAgo: number): string {
  if (daysAgo <= 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return `${daysAgo} days ago`;
}

/** "Today 10:40", "Yesterday 16:30". */
export const stampWords = (stamp: Stamp): string => `${dayWords(stamp.daysAgo)} ${stamp.time}`;

/** "Today at 10:42", for a details column. */
export const stampAtWords = (stamp: Stamp): string => `${dayWords(stamp.daysAgo)} at ${stamp.time}`;

/** "started 10:42" for today, "started yesterday 16:05" before. */
export const startedWords = (stamp: Stamp): string => (stamp.daysAgo <= 0 ? `started ${stamp.time}` : `started ${dayWords(stamp.daysAgo).toLowerCase()} ${stamp.time}`);

/** The group a history entry sits under: "Today", "Yesterday" or "Earlier". */
export const dayGroupOf = (stamp: Stamp): string => (stamp.daysAgo <= 0 ? 'Today' : stamp.daysAgo === 1 ? 'Yesterday' : 'Earlier');

/** What an entry changed, after the time: "10 files written", "manifest changed", "manifest created". */
export function entryChange(entry: HistoryEntry): string {
  if (entry.filesWritten > 0) return `${entry.filesWritten} ${entry.filesWritten === 1 ? 'file' : 'files'} written`;
  return entry.manifest === 'created' ? 'manifest created' : entry.manifest === 'changed' ? 'manifest changed' : 'settings changed';
}

/** The second line of an entry: "Today 10:40 · Hanna · this Mac · 10 files written". */
export const entryMeta = (entry: HistoryEntry): string => [stampWords(entry.stamp), entry.person, entry.computer, entryChange(entry)].join(' · ');

/** Splits a list of entries (newest first) into the days they fall on, keeping the order. */
export function groupByDay(entries: readonly HistoryEntry[]): { day: string; entries: HistoryEntry[] }[] {
  const out: { day: string; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayGroupOf(entry.stamp), last = out[out.length - 1];
    if (last !== undefined && last.day === day) last.entries.push(entry); else out.push({ day, entries: [entry] });
  }
  return out;
}

/**
 * How many minutes a run has been open, from its start to `now`. A start on an earlier day counts the days between, and a clock that reads earlier than the start on the same day means midnight passed.
 */
export function minutesOpen(run: Run, now: Stamp): number {
  const minutes = (time: string): number => { const [h, m] = time.split(':'); return Number(h) * 60 + Number(m); };
  const since = (run.started.daysAgo - now.daysAgo) * 1440 + minutes(now.time) - minutes(run.started.time);
  return since < 0 ? since + 1440 : since;
}
