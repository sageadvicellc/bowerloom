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
