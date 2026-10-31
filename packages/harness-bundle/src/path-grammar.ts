/**
 * The path grammar of a bundle. A bundle path is only ever a key into `.bowerloom`, and it must be at least as strict as `plainPath` of `packages/adoption/src/save.ts`,
 * because the save is the only write: whatever this accepts, `plainPath` accepts too (a test checks it over a corpus). It adds three things: a lone surrogate, a name
 * that clashes under compatibility folding (`NFKC` and lower case, where the save folds with `NFC`), and the one top-level file that never travels (`knowledge.json`).
 */
import { DEFINITION_LIMITS, KNOWLEDGE_FILE, LEGACY_NAMES } from '../../harness-definition/src/index.js';
import { BUNDLE_LIMITS } from './limits.js';
import { isWellFormedText } from './well-formed.js';

const LEGACY = new Set<string>(LEGACY_NAMES);
/** Control (`Cc`), format (`Cf`: bidirectional marks, zero-width characters, the byte order mark), line and paragraph separators, and the backslash. */
const ODD = /[\p{Cc}\p{Cf}\u2028\u2029\\]/u;

/** True when `p` is a plain path inside `.bowerloom`, by the rules in the README. Never throws. */
export function isBundlePath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > BUNDLE_LIMITS.pathChars || !isWellFormedText(p) || ODD.test(p)) return false;
  if (p === KNOWLEDGE_FILE) return false;
  const parts = p.split('/');
  if (parts.length - 1 > DEFINITION_LIMITS.depth || LEGACY.has(parts[0]!)) return false;
  return parts.every(s => s !== '' && s !== '.' && s !== '..' && !s.startsWith('.') && Buffer.byteLength(s) <= BUNDLE_LIMITS.segmentBytes);
}

const byteOrder = (a: Buffer, b: Buffer): number => Buffer.compare(a, b);

/** Sorts paths by the bytes of their UTF-8 form, the order of a bundle's `files`. */
export function sortByBytes<T>(items: readonly T[], pathOf: (item: T) => string): T[] {
  const keyed = items.map(item => ({ item, key: Buffer.from(pathOf(item), 'utf8') }));
  keyed.sort((a, b) => byteOrder(a.key, b.key));
  return keyed.map(k => k.item);
}

/**
 * The paths that clash: two equal paths, or two that name one file or folder under case or Unicode folding (`Skills/a` and `skills/b`, or an NFD and an NFC form).
 * Returns the paths at fault (at most the first pair found), or an empty list.
 */
export function clashingPaths(paths: readonly string[]): string[] {
  const seen = new Map<string, string>();
  const whole = new Set<string>();
  for (const p of paths) {
    if (whole.has(p)) return [p];
    whole.add(p);
    const parts = p.split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join('/');
      const key = prefix.normalize('NFKC').toLowerCase();
      const other = seen.get(key);
      if (other !== undefined && other !== prefix) return [other, prefix];
      seen.set(key, prefix);
    }
  }
  return [];
}
