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
import { BAD_TEXT } from './text.js';

/** Squashed forms that name a bypass anywhere in a string. */
const BYPASS_WORDS = ['bypasspermissions', 'dangerouslybypass', 'dangerouslyskip', 'dangerouslyallow', 'skipdangerousmode'];
/** Whole flags that turn approvals off (research note engines-G, section 3). */
const BYPASS_FLAGS = new Set(['--yolo', '--auto']);
/** Tokens that widen what runs without a person, squashed. One token only: "accept edits" in prose is two. */
const WIDENING_TOKENS = new Set(['dangerfullaccess', 'acceptedits', 'yolo']);
const WIDENING_FLAGS = new Set(['--full-auto', '--auto-approve', '--allow-all', '--trust-all-tools', '--no-sandbox', '--enable-auto-mode']);
/** Pairs of joined words: a setting and the values that widen it. The words of a setting can be split. */
const WIDENING_PAIRS: Readonly<Record<string, readonly string[]>> = {
  approvalpolicy: ['never'],
  askforapproval: ['never'],
  approvalmode: ['yolo'],
  permissionmode: ['auto', 'acceptedits', 'bypasspermissions'],
  defaultmode: ['auto', 'acceptedits', 'bypasspermissions'],
  sandbox: ['dangerfullaccess'],
  sandboxmode: ['dangerfullaccess'],
  networkaccess: ['true', 'enabled'],
};
/** `--allowedTools Bash` or `Bash(*)`: every shell command allowed. `Bash(git status)` is narrower and passes. */
const ALLOWED_BASH = /allowed[-_\s]?tools[\s"'`:=,[\]]*bash\s*(?:\(\s*\*?\s*\))?(?=$|[\s"'`,\]])/i;
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const TOKEN_SPLIT = /[\s"'`=,;:()[\]{}]+/;
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** True when a text names a bypass flag or mode: the forms of section 4.3, rule 4. */
export function namesBypass(text: string): boolean {
  const squashed = squash(text);
  if (BYPASS_WORDS.some(w => squashed.includes(w))) return true;
  return text.split(TOKEN_SPLIT).some(t => BYPASS_FLAGS.has(t.toLowerCase()));
}

/** The text with `\uXXXX` escapes and `%XX` codes decoded and zero-width characters made spaces. */
function decoded(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(ZERO_WIDTH, ' ');
}

/** True when a text names a bypass, or a form that widens what runs without a person (rulings T7 and V6). */
export function namesWidening(text: string): boolean {
  if (namesBypass(text)) return true;
  const t = decoded(text);
  if (t !== text && namesBypass(t)) return true;
  if (ALLOWED_BASH.test(t)) return true;
  const tokens = t.split(TOKEN_SPLIT).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i]!.toLowerCase();
    if (WIDENING_FLAGS.has(lower) || WIDENING_TOKENS.has(squash(lower))) return true;
    if (lower === '-a' && squash(tokens[i + 1] ?? '') === 'never') return true;
  }
  const words = t.toLowerCase().split(WORD_SPLIT).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let k = 1; k <= 3 && i + k <= words.length; k++) {
      const key = words.slice(i, i + k).join('');
      if (key === 'dangerfullaccess') return true;
      const values = WIDENING_PAIRS[key];
      if (!values) continue;
      for (let v = 1; v <= 3 && i + k + v <= words.length; v++) if (values.includes(words.slice(i + k, i + k + v).join(''))) return true;
    }
  }
  return false;
}

/** The strings and booleans below a value, joined with spaces, in order. Numbers and keys are left out. */
function flat(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flat).filter(Boolean).join(' ');
  if (value === null || typeof value !== 'object') return '';
  return Object.values(value).map(flat).filter(Boolean).join(' ');
}

/**
 * The JSON pointers of every key or string that names a bypass or widening form; of every key whose value, nested or
 * not, widens it; and of every list or object whose strings, read in order, name one. So a flag and its value split
 * across sibling keys, list neighbours, or nested values is found. Unsafe key names show as `*`.
 */
export function bypassPointers(value: JsonValue, pointer = ''): string[] {
  if (typeof value === 'string') return namesWidening(value) ? [pointer || '/'] : [];
  if (value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...bypassPointers(v, `${pointer}/${i}`)));
  else {
    for (const [key, v] of Object.entries(value)) {
      const at = `${pointer}/${isSafeName(key) ? key.replace(/~/g, '~0').replace(/\//g, '~1') : '*'}`;
      if (namesWidening(key) || namesWidening(`${key} ${flat(v)}`)) out.push(at);
      out.push(...bypassPointers(v, at));
    }
  }
  if (!out.length && namesWidening(flat(value))) out.push(pointer || '/');
  return out;
}

/**
 * The normal form of a member folder, or null when it is not inside the project or exactly one level beside it
 * (ruling T1). `.` is the project. `../<name>` is a folder beside the project. Refused: an absolute path, `~`, a
 * backslash, a control character, an empty segment, `..` anywhere else, and anything below `../<name>`.
 */
export function normalizeFolder(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null;
  if (BAD_TEXT.test(raw) || raw.includes('\\') || raw.startsWith('/') || raw.startsWith('~')) return null;
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
