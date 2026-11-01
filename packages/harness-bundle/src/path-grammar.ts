/**
 * The path grammar of a bundle. A bundle path is only ever a key into `.bowerloom`, and it must be at least as strict as `plainPath` of `packages/adoption/src/save.ts`,
 * because the save is the only write: whatever this accepts, `plainPath` accepts too (a test reads both). It adds four things: a lone surrogate, a name that ends in a dot
 * or a space or is a Windows device name (two names collapse on Windows and on some network shares), a name that clashes under the shared fold (`foldName`, also used by the
 * save), and the one top-level file that never travels (`knowledge.json`, in any case).
 */
import { DEFINITION_LIMITS, KNOWLEDGE_FILE, LEGACY_NAMES } from '../../harness-definition/src/index.js';
import { foldName } from '../../harness-definition/src/fold.js';
import { BUNDLE_LIMITS } from './limits.js';
import { isWellFormedText } from './well-formed.js';

const LEGACY = new Set<string>(LEGACY_NAMES);
/** Control (`Cc`), format (`Cf`: bidirectional marks, zero-width characters, the byte order mark), line and paragraph separators, and the backslash. */
const ODD = /[\p{Cc}\p{Cf}\u2028\u2029\\]/u;
/** A Windows device name, with or without an extension, after the fold (so a superscript digit counts as the digit). */
const DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/;

/** True when `p` is a plain path inside `.bowerloom`, by the rules in the README. Never throws. */
export function isBundlePath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > BUNDLE_LIMITS.pathChars || !isWellFormedText(p) || ODD.test(p)) return false;
  if (foldName(p) === KNOWLEDGE_FILE) return false;
  const parts = p.split('/');
  if (parts.length - 1 > DEFINITION_LIMITS.depth || LEGACY.has(parts[0]!)) return false;
  return parts.every(s => s !== '' && s !== '.' && s !== '..' && !s.startsWith('.') && !/[. ]$/.test(s) && Buffer.byteLength(s) <= BUNDLE_LIMITS.segmentBytes && !DEVICE.test(foldName(s)));
}

/** Sorts paths by the bytes of their UTF-8 form, the order of a bundle's `files`. */
export function sortByBytes<T>(items: readonly T[], pathOf: (item: T) => string): T[] {
  const keyed = items.map(item => ({ item, key: Buffer.from(pathOf(item), 'utf8') }));
  keyed.sort((a, b) => Buffer.compare(a.key, b.key));
  return keyed.map(k => k.item);
}

/**
 * The paths that clash: two equal paths, or two that name one file or folder under the shared fold (`Skills/a` and `skills/b`, `straße` and `strasse`, an NFD and an NFC
 * form). Returns the paths at fault (the first pair found), or an empty list. Each segment is folded once, so the work is linear in the size of the paths.
 */
export function clashingPaths(paths: readonly string[]): string[] {
  const seen = new Map<string, string>();
  const whole = new Set<string>();
  const folded = new Map<string, string>();
  const fold = (segment: string): string => {
    let f = folded.get(segment);
    if (f === undefined) { f = foldName(segment); folded.set(segment, f); }
    return f;
  };
  for (const p of paths) {
    if (whole.has(p)) return [p];
    whole.add(p);
    const parts = p.split('/');
    let key = '', prefix = '';
    for (let i = 0; i < parts.length; i += 1) {
      prefix = i === 0 ? parts[0]! : `${prefix}/${parts[i]!}`;
      key = i === 0 ? fold(parts[0]!) : `${key}/${fold(parts[i]!)}`;
      const other = seen.get(key);
      if (other !== undefined && other !== prefix) return [other, prefix];
      seen.set(key, prefix);
    }
  }
  return [];
}
