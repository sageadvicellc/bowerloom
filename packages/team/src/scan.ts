/**
 * Two scans of a team: bypass words (section 4.3, rule 4) and member folders (section 8, rule 2).
 *
 * A bypass is found in any key or string value, `x-` blocks too, and in the text of kept 0.7 files. The words are
 * compared with case, spaces, and punctuation removed, so `bypassPermissions`, `bypass_permissions`, and
 * `--dangerously-bypass-approvals-and-sandbox` are all found. Prose that names a bypass is refused too: a team file
 * has no command line, so a bypass word in it has no safe use.
 */
import type { JsonValue } from '../../harness-definition/src/index.js';
import { isSafeName } from '../../harness-definition/src/index.js';

/** Squashed forms that name a bypass: Claude Code's mode and flags, and the Codex flag. */
const BYPASS_WORDS = ['bypasspermissions', 'dangerouslybypass', 'dangerouslyskip', 'skipdangerousmode'];
/**
 * Whole flags that turn approvals off: `--yolo`, and OpenCode's `--auto`, which shares its flag with `--yolo` in the
 * source (research note engines-G, section 3).
 */
const BYPASS_FLAGS = new Set(['--yolo', '--auto']);

/** True when a text names a bypass flag or mode. */
export function namesBypass(text: string): boolean {
  const squashed = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (BYPASS_WORDS.some(w => squashed.includes(w))) return true;
  return text.split(/[\s"'`=,;:()[\]{}]+/).some(t => BYPASS_FLAGS.has(t.toLowerCase()));
}

/** The JSON pointers of every key or string that names a bypass. Unsafe key names show as `*`. */
export function bypassPointers(value: JsonValue, pointer = ''): string[] {
  if (typeof value === 'string') return namesBypass(value) ? [pointer || '/'] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => bypassPointers(v, `${pointer}/${i}`));
  if (value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    const at = `${pointer}/${isSafeName(key) ? key.replace(/~/g, '~0').replace(/\//g, '~1') : '*'}`;
    if (namesBypass(key)) out.push(at);
    out.push(...bypassPointers(v, at));
  }
  return out;
}

/**
 * The normal form of a member folder, or null when it is not a relative path inside or beside the project. `.` is the
 * project. Leading `..` segments reach a worktree beside it. Refused: an absolute path, `~`, a backslash, a control
 * character, an empty segment, and `..` after a name.
 */
export function normalizeFolder(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null;
  if (/[\0-\x1f\x7f\\]/.test(raw) || raw.startsWith('/') || raw.startsWith('~')) return null;
  const segments = raw.split('/');
  if (segments.length > 1 && segments.at(-1) === '') segments.pop();
  if (segments.some(s => s === '')) return null;
  const out: string[] = [];
  let leading = true;
  for (const s of segments) {
    if (s === '.') continue;
    if (s === '..') { if (!leading) return null; out.push(s); continue; }
    leading = false;
    out.push(s);
  }
  return out.length ? out.join('/') : '.';
}

/** The key that compares two folders: one file system may fold letter case, so case does not count. */
export function folderKey(normalized: string): string {
  return normalized.normalize('NFC').toLowerCase();
}
