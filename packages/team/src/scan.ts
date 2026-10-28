/**
 * Two scans of a team: bypass and widening words (section 4.3, rule 4; review ruling T7) and member folders (section 8,
 * rule 2; ruling T1).
 *
 * A bypass or widening form is found in any key or string value, `x-` blocks too, and in the text of kept 0.7 files:
 * - the strong bypass words anywhere in a string, with case, spaces, and punctuation removed: `bypassPermissions`,
 *   `bypass_permissions`, `--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`;
 * - a widening word or flag as one token: `danger-full-access`, `acceptEdits`, `--yolo`, `--auto`, `--full-auto`,
 *   `--auto-approve`, `--allow-all`, `--trust-all-tools`;
 * - a widening pair of tokens, in text, as a key and its value, or as two neighbouring strings of a list:
 *   `approval_policy never`, `--ask-for-approval never`, `--permission-mode auto` or `acceptEdits`, `defaultMode auto`,
 *   `--sandbox danger-full-access`.
 * Prose such as "we accept edits" is two tokens and is not a flag.
 */
import type { JsonValue } from '../../harness-definition/src/index.js';
import { isSafeName } from '../../harness-definition/src/index.js';

/** Squashed forms that name a bypass anywhere in a string. */
const BYPASS_WORDS = ['bypasspermissions', 'dangerouslybypass', 'dangerouslyskip', 'skipdangerousmode'];
/** Whole flags that turn approvals off (research note engines-G, section 3). */
const BYPASS_FLAGS = new Set(['--yolo', '--auto']);
/** Tokens that widen what runs without a person, squashed. */
const WIDENING_TOKENS = new Set(['dangerfullaccess', 'acceptedits']);
const WIDENING_FLAGS = new Set(['--full-auto', '--auto-approve', '--allow-all', '--trust-all-tools']);
/** Pairs of squashed tokens: a setting and the value that widens it. */
const WIDENING_PAIRS: Readonly<Record<string, readonly string[]>> = {
  approvalpolicy: ['never'],
  askforapproval: ['never'],
  permissionmode: ['auto', 'acceptedits', 'bypasspermissions'],
  defaultmode: ['auto', 'acceptedits', 'bypasspermissions'],
  sandbox: ['dangerfullaccess'],
  sandboxmode: ['dangerfullaccess'],
};
const TOKEN_SPLIT = /[\s"'`=,;:()[\]{}]+/;
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** True when a text names a bypass flag or mode: the forms of section 4.3, rule 4. */
export function namesBypass(text: string): boolean {
  const squashed = squash(text);
  if (BYPASS_WORDS.some(w => squashed.includes(w))) return true;
  return text.split(TOKEN_SPLIT).some(t => BYPASS_FLAGS.has(t.toLowerCase()));
}

/** True when a text names a bypass, or a form that widens what runs without a person (ruling T7). */
export function namesWidening(text: string): boolean {
  if (namesBypass(text)) return true;
  const tokens = text.split(TOKEN_SPLIT).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (WIDENING_FLAGS.has(t.toLowerCase()) || WIDENING_TOKENS.has(squash(t))) return true;
    const next = tokens[i + 1];
    if (next !== undefined && WIDENING_PAIRS[squash(t)]?.includes(squash(next))) return true;
  }
  return false;
}

/**
 * The JSON pointers of every key or string that names a bypass or widening form, of every key whose value widens it,
 * and of every pair of neighbouring strings in a list that does. Unsafe key names show as `*`.
 */
export function bypassPointers(value: JsonValue, pointer = ''): string[] {
  if (typeof value === 'string') return namesWidening(value) ? [pointer || '/'] : [];
  if (Array.isArray(value)) {
    const out = value.flatMap((v, i) => bypassPointers(v, `${pointer}/${i}`));
    for (let i = 0; i + 1 < value.length; i++) {
      const a = value[i], b = value[i + 1];
      if (typeof a === 'string' && typeof b === 'string' && namesWidening(`${a} ${b}`)) out.push(`${pointer}/${i}`);
    }
    return out;
  }
  if (value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    const at = `${pointer}/${isSafeName(key) ? key.replace(/~/g, '~0').replace(/\//g, '~1') : '*'}`;
    if (namesWidening(key) || (typeof v === 'string' && namesWidening(`${key} ${v}`))) out.push(at);
    out.push(...bypassPointers(v, at));
  }
  return out;
}

/**
 * The normal form of a member folder, or null when it is not inside the project or exactly one level beside it
 * (ruling T1). `.` is the project. `../<name>` is a folder beside the project. Refused: an absolute path, `~`, a
 * backslash, a control character, an empty segment, `..` anywhere else, and anything below `../<name>`.
 */
export function normalizeFolder(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null;
  if (/[\p{Cc}\p{Cf}\\]/u.test(raw) || raw.startsWith('/') || raw.startsWith('~')) return null;
  const segments = raw.split('/');
  if (segments.length > 1 && segments.at(-1) === '') segments.pop();
  if (segments.some(s => s === '')) return null;
  const out = segments.filter(s => s !== '.');
  if (out[0] === '..') return out.length === 2 && out[1] !== '..' ? out.join('/') : null;
  if (out.includes('..')) return null;
  return out.length ? out.join('/') : '.';
}

/** The key that compares two folders: one file system may fold case, so case does not count. */
export function folderKey(normalized: string): string {
  return normalized.normalize('NFC').toLowerCase();
}
