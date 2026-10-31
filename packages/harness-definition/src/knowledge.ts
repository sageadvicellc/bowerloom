/**
 * Knowledge sources (0.8 spec, sections 6.9 and 6.10; harness definition spec, section 5.1). A source is a pointer: a
 * kind, a name, and a path. Bowerloom never reads, indexes, or copies page content, so nothing here opens the folder.
 *
 * The stored path has one of three forms, so no file of a definition holds a home folder or a user name:
 * - `.`: the harness folder itself, the folder that holds `.bowerloom`.
 * - `<a>/<b>`: a folder inside the harness folder, relative to it.
 * - `~/<a>/<b>`: a folder inside the home folder.
 * No form is absolute, and no segment is empty, `.`, or `..`. A backslash, a backtick, and a control character are
 * refused, so a path is safe to quote in the projected notes section.
 */
import path from 'node:path';
import type { JsonValue, KnowledgeSource } from './types.js';
import { DEFINITION_LIMITS, KNOWLEDGE_KINDS, isId } from './words.js';
import type { KnowledgeKind } from './words.js';

/** The longest stored path, in characters. */
export const KNOWLEDGE_PATH_MAX = 1024;
const ODD = /[\0-\x1f\x7f\\`]/;
const DRIVE = /^[A-Za-z]:/;
const plain = (p: string): boolean => p.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');

/** True when a value is a stored source path: `.`, a plain relative path, or `~/` and a plain relative path. */
export function isKnowledgePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || [...value].length > KNOWLEDGE_PATH_MAX || ODD.test(value) || DRIVE.test(value)) return false;
  if (value === '.') return true;
  if (value.startsWith('~/')) return plain(value.slice(2));
  if (value.startsWith('/') || value.startsWith('~')) return false;
  return plain(value);
}

export function isKnowledgeKind(value: unknown): value is KnowledgeKind {
  return typeof value === 'string' && (KNOWLEDGE_KINDS as readonly string[]).includes(value);
}

/** Why `storedKnowledgePath` refused. Its message never repeats the path. */
export type KnowledgePathCode = 'KNOWLEDGE_PATH_UNSAFE' | 'KNOWLEDGE_PATH_ESCAPES' | 'KNOWLEDGE_PATH_OUTSIDE';
export type KnowledgePathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: KnowledgePathCode; readonly message: string };

const no = (code: KnowledgePathCode, message: string): KnowledgePathResult => ({ ok: false, code, message });
const within = (base: string, p: string): boolean => p === base || p.startsWith(base === '/' ? '/' : `${base}/`);
const below = (base: string, p: string): string => (p === base ? '' : p.slice(base === '/' ? 1 : base.length + 1));
const absolute = (p: unknown): p is string => typeof p === 'string' && path.posix.isAbsolute(p) && !ODD.test(p);
const strip = (p: string): string => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

/**
 * The stored form of a folder a person picked. Pure: it reads no disk and follows no link.
 * - `root` is the harness folder, the folder that holds `.bowerloom`; `home` is the home folder. Both are absolute.
 * - The input is an absolute path, a path relative to `root`, or a path in `~` form.
 * - A folder inside `root` is stored relative to it (`.` for `root` itself). Another folder inside `home` is stored in
 *   `~` form. Any other absolute folder is refused `KNOWLEDGE_PATH_OUTSIDE`.
 * - A relative path whose `..` leaves `root`, and a `~` path whose `..` leaves `home`, are refused `KNOWLEDGE_PATH_ESCAPES`.
 * - `home` itself, `~user`, a drive letter, a backslash, a backtick, and a control character are refused
 *   `KNOWLEDGE_PATH_UNSAFE`.
 */
export function storedKnowledgePath(input: unknown, where: { readonly root: string; readonly home: string } | null | undefined): KnowledgePathResult {
  if (where === null || typeof where !== 'object' || !absolute(where.root) || !absolute(where.home)) {
    return no('KNOWLEDGE_PATH_UNSAFE', 'The harness folder and the home folder must be absolute paths.');
  }
  const root = strip(path.posix.normalize(where.root)), home = strip(path.posix.normalize(where.home));
  if (typeof input !== 'string' || input === '' || input.length > 4 * KNOWLEDGE_PATH_MAX || ODD.test(input) || DRIVE.test(input)) {
    return no('KNOWLEDGE_PATH_UNSAFE', 'The folder path must be text with no backslash, backtick, control character, or drive letter.');
  }
  let target: string;
  if (input === '~' || input.startsWith('~/')) {
    const rest = path.posix.normalize(input.slice(2) || '.');
    if (rest === '..' || rest.startsWith('../')) return no('KNOWLEDGE_PATH_ESCAPES', 'The folder path leaves the home folder through "..".');
    target = path.posix.join(home, rest);
  } else if (input.startsWith('~')) {
    return no('KNOWLEDGE_PATH_UNSAFE', 'A path in ~ form must start with ~/, the home folder of the person who runs Bowerloom.');
  } else if (path.posix.isAbsolute(input)) {
    target = path.posix.normalize(input);
  } else {
    const rest = path.posix.normalize(input);
    if (rest === '..' || rest.startsWith('../')) return no('KNOWLEDGE_PATH_ESCAPES', 'The folder path leaves the harness folder through "..".');
    target = path.posix.join(root, rest);
  }
  target = strip(target);
  let stored: string;
  if (within(root, target)) stored = below(root, target) || '.';
  else if (target === home) return no('KNOWLEDGE_PATH_UNSAFE', 'The home folder itself cannot be a notes folder. Pick a folder inside it.');
  else if (within(home, target)) stored = `~/${below(home, target)}`;
  else return no('KNOWLEDGE_PATH_OUTSIDE', 'The folder is outside the harness folder and outside the home folder, so it has no stored form.');
  return isKnowledgePath(stored) ? { ok: true, path: stored } : no('KNOWLEDGE_PATH_UNSAFE', `The stored folder path must be at most ${KNOWLEDGE_PATH_MAX} characters.`);
}

const isObject = (v: JsonValue | undefined): v is { readonly [key: string]: JsonValue } => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Checks the parsed `knowledge.json`: `{ "sources": [ { "kind", "name", "path" } ] }`, every field required, no other
 * field, each name an id and used once, each path stored form and used once. Returns the sources, or undefined and the
 * faults. A message never repeats a path.
 */
export function checkKnowledge(value: JsonValue, fail: (code: string, message: string) => void): KnowledgeSource[] | undefined {
  if (!isObject(value)) { fail('INVALID_FIELD', 'knowledge.json must be an object.'); return undefined; }
  let ok = true;
  for (const key of Object.keys(value)) if (key !== 'sources') { ok = false; fail('UNKNOWN_FIELD', 'knowledge.json has a field other than sources.'); }
  const list = value.sources;
  if (!Array.isArray(list) || list.length > DEFINITION_LIMITS.entries) {
    fail('INVALID_FIELD', `knowledge.json needs sources: a list of 0 to ${DEFINITION_LIMITS.entries} items.`);
    return undefined;
  }
  const out: KnowledgeSource[] = [];
  const names = new Set<string>(), paths = new Set<string>();
  list.forEach((item, i) => {
    const where = `sources[${i}]`;
    if (!isObject(item)) { ok = false; fail('INVALID_FIELD', `${where} must be an object.`); return; }
    let good = true;
    for (const key of Object.keys(item)) if (!['kind', 'name', 'path'].includes(key)) { good = false; fail('UNKNOWN_FIELD', `${where} has a field other than kind, name, and path.`); }
    for (const key of ['kind', 'name', 'path']) if (!Object.hasOwn(item, key)) { good = false; fail('INVALID_FIELD', `${where} is missing the field ${key}.`); }
    if (!good) { ok = false; return; }
    const { kind, name, path: at } = item;
    if (!isKnowledgeKind(kind)) { good = false; fail('KNOWLEDGE_KIND', `${where}.kind must be ${KNOWLEDGE_KINDS.join(', or ')}. Beta.1 knows one kind of source.`); }
    if (!isId(name)) { good = false; fail('INVALID_ID', `${where}.name must be lowercase letters, digits, and single hyphens, up to 64 characters.`); }
    if (!isKnowledgePath(at)) {
      good = false;
      fail('KNOWLEDGE_PATH', `${where}.path must be a folder inside the harness folder, relative to it, or a folder in ~/ form. It cannot be absolute, hold "..", or hold a backslash, a backtick, or a control character.`);
    }
    if (!good) { ok = false; return; }
    if (names.has(name as string)) { ok = false; fail('DUPLICATE_ID', `${where} repeats the name ${name as string} of an earlier source.`); return; }
    if (paths.has(at as string)) { ok = false; fail('KNOWLEDGE_DUPLICATE_PATH', `${where} points to the same folder as an earlier source.`); return; }
    names.add(name as string); paths.add(at as string);
    out.push({ kind: kind as KnowledgeKind, name: name as string, path: at as string });
  });
  return ok ? out : undefined;
}
