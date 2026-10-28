/**
 * What leaves the package as text (review rulings T3 and T15). Every problem message and path, and every question,
 * passes the secret scan before it is returned. When the scan fires, the text is dropped and the message says a value
 * was withheld. A capped problem list ends with a line that says how many more there are.
 */
import { scanSecrets, type Problem } from '../../harness-definition/src/index.js';
import { BAD_TEXT, BAD_TEXT_ALL } from './text.js';
import { TEAM_LIMITS } from './words.js';

/** A problem, with the cause of a failed file operation when there was one. */
export interface TeamProblem extends Problem {
  readonly cause?: { readonly name: string; readonly code?: string };
}

const WITHHELD = 'A value in this message looks like a secret, so the message was withheld.';

/** True when a text holds a value that the secret scan finds, or a control or format character. */
export function unsafeText(text: string): boolean {
  if (BAD_TEXT.test(text.replace(/\n/g, ''))) return true;
  return scanSecrets([{ path: 'message.txt', bytes: Buffer.from(text, 'utf8') }]).length > 0;
}

/** The text, or null when it is not safe to show. */
export function shown(text: string): string | null {
  return unsafeText(text) ? null : text;
}

/** Plain text: control and format characters removed, and spaces collapsed. */
export function plain(text: string): string {
  return text.replace(BAD_TEXT_ALL, ' ').replace(/\s+/g, ' ').trim();
}

/** Each problem with its message and path checked, capped at the problem limit with a line that counts the rest. */
export function finish<T extends Problem>(problems: readonly T[]): (T | TeamProblem)[] {
  const out: (T | TeamProblem)[] = problems.map(p => ({
    ...p,
    path: unsafeText(p.path) ? '(a path not shown)' : p.path,
    message: unsafeText(p.message) ? `${WITHHELD} (${p.code})` : p.message,
  }));
  const max = TEAM_LIMITS.problems;
  if (out.length <= max) return out;
  const more = out.length - (max - 1);
  return [...out.slice(0, max - 1), { code: 'TEAM_PROBLEMS_TRUNCATED', path: '.', message: `The list stops here, and ${more} more problems are not shown. Fix these and check again.` }];
}
