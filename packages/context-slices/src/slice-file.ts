/**
 * The slice file, `.bowerloom/slices/<id>.yaml` (spec 05, section 4.1). `parseSlice` is pure: it reads no file. It
 * returns a definition or a fixed code with a detail that names a key only when the key is plain. No detail quotes
 * other file text.
 */
import { isMap, isScalar, parseDocument, visit } from 'yaml';
import { compilePattern } from './glob.js';

export const SLICE_FORMAT = 'bowerloom/context-slice/v1beta1' as const;
export const SLICE_LIMITS = Object.freeze({
  fileBytes: 16384, idLength: 57, patterns: 64, patternBytes: 256, whereKeys: 16, whereValues: 32, maxFiles: 256, slices: 64,
  walkEntries: 8192, walkDepth: 16, memberBytes: 1048576, readBytes: 33554432, indexBytes: 65536, referencesBytes: 196608, references: 4095, summaryChars: 160, pathBytes: 512,
});
export const SLICE_KEYS: readonly string[] = Object.freeze(['format', 'description', 'root', 'include', 'exclude', 'where', 'links', 'summary', 'maxFiles', 'guard']);

export type SliceRoot = { kind: 'project'; path: string } | { kind: 'registered'; name: string; path: string };
export interface SliceDefinition {
  format: typeof SLICE_FORMAT;
  description: string;
  root: SliceRoot;
  include: string[];
  exclude: string[];
  where: Record<string, string[]>;
  links: { follow: ('wikilink' | 'markdown')[]; depth: 1 | 2 } | null;
  summary: { kind: 'heading' } | { kind: 'none' } | { kind: 'frontmatter'; key: string };
  maxFiles: number;
  guard: 'root' | 'none';
}
export type SliceParseCode = 'SLICE_INVALID' | 'SLICE_KEY_UNKNOWN';
export type SliceParse = { ok: true; slice: SliceDefinition } | { ok: false; code: SliceParseCode; detail: string };

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLAIN_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const WHERE_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROLS = /[\p{Cc}\p{Cf}]/u;
const keyWords = (key: string): string => PLAIN_KEY.test(key) ? `the key ${key}` : 'a key with unsupported characters';

/** A plain id of at most 57 characters that does not start with `prompt-`. */
export function isSliceId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= SLICE_LIMITS.idLength && ID.test(value) && !value.startsWith('prompt-');
}
/** A folder name of a registered folder (Part B uses it; slice files name one). */
export const isFolderName = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 64 && ID.test(value);

class Failure extends Error { constructor(readonly code: SliceParseCode, readonly detail: string) { super(code); } }
const invalid = (detail: string): never => { throw new Failure('SLICE_INVALID', detail); };

/** A relative POSIX root path: no empty, dot-leading or `..` segment, at most 512 bytes. The single value `.` is the folder itself. */
export function validRootPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > SLICE_LIMITS.pathBytes || CONTROLS.test(value) || value.includes('\\') || value.startsWith('/')) return false;
  if (value === '.') return true;
  return value.split('/').every(s => s !== '' && !s.startsWith('.'));
}
function patterns(key: string, value: unknown, min: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > SLICE_LIMITS.patterns) return invalid(`${keyWords(key)} must be a list of ${min === 0 ? '0' : '1'} to ${SLICE_LIMITS.patterns} patterns`);
  for (const p of value) {
    if (typeof p !== 'string' || p.length === 0 || Buffer.byteLength(p) > SLICE_LIMITS.patternBytes) return invalid(`${keyWords(key)} has a pattern that is not valid`);
    const c = compilePattern(p); if (!c.ok) return invalid(`${keyWords(key)} has a pattern that is not valid`);
  }
  return [...value as string[]];
}
const isString = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length >= min && v.length <= max;

function validate(text: string, stem: string): SliceDefinition {
  if (!isSliceId(stem)) return invalid('the file name is not a valid slice id');
  if (typeof text !== 'string') return invalid('the file is not text');
  if (Buffer.byteLength(text) > SLICE_LIMITS.fileBytes) return invalid('the file is larger than 16384 bytes');
  if (text.startsWith('\uFEFF')) return invalid('the file starts with a byte order mark');
  if (text.includes('\r') || text.includes('\0')) return invalid('the file holds a carriage return or a null byte');
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) return invalid('the file is not valid YAML, or repeats a key');
  if (doc.warnings.length) return invalid('the file holds a tag or a value that YAML cannot resolve');
  let tagged = false, merge = false;
  visit(doc, { Node(_k, node) { if (node.tag !== undefined) tagged = true; }, Pair(_k, pair) { if (isScalar(pair.key) && pair.key.value === '<<') merge = true; } });
  if (tagged) return invalid('the file uses an explicit YAML tag, which is not allowed');
  if (merge) return invalid('the file uses a merge key, which is not allowed');
  if (!isMap(doc.contents)) return invalid('the file is not a map of keys');
  let value: unknown;
  try { value = doc.toJS({ maxAliasCount: 0 }); } catch { return invalid('the file uses an alias, which is not allowed'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('the file is not a map of keys');
  const map = value as Record<string, unknown>, keys = Object.keys(map);
  for (const key of keys) if (!SLICE_KEYS.includes(key)) throw new Failure('SLICE_KEY_UNKNOWN', PLAIN_KEY.test(key) ? key : 'a key with unsupported characters');
  const has = (k: string): boolean => Object.hasOwn(map, k);
  if (map.format !== SLICE_FORMAT) invalid('the key format must be ' + SLICE_FORMAT);
  const description = map.description;
  if (!isString(description, 1, 1024) || CONTROLS.test(description)) invalid('the key description is required, from 1 to 1024 characters, with no control characters');
  let root: SliceRoot = { kind: 'project', path: '.' };
  if (has('root')) {
    const r = map.root;
    if (typeof r === 'string') { if (!validRootPath(r)) invalid('the key root is not a relative folder path'); root = { kind: 'project', path: r }; }
    else if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
      const m = r as Record<string, unknown>, ks = Object.keys(m);
      if (!ks.every(k => k === 'registered' || k === 'path') || !isFolderName(m.registered)) invalid('the key root takes registered, a folder name, and an optional path');
      if (m.path !== undefined && !validRootPath(m.path)) invalid('the key root has a path that is not a relative folder path');
      root = { kind: 'registered', name: m.registered as string, path: (m.path as string | undefined) ?? '.' };
    } else invalid('the key root is a folder path or a registered folder');
  }
  if (!has('include')) invalid('the key include is required');
  const include = patterns('include', map.include, 1), exclude = has('exclude') ? patterns('exclude', map.exclude, 0) : [];
  const where: Record<string, string[]> = {};
  if (has('where')) {
    const w = map.where;
    if (w === null || typeof w !== 'object' || Array.isArray(w)) invalid('the key where must be a map');
    const ks = Object.keys(w as object);
    if (ks.length < 1 || ks.length > SLICE_LIMITS.whereKeys) invalid('the key where takes 1 to 16 keys');
    for (const k of ks) {
      const v = (w as Record<string, unknown>)[k];
      if (!WHERE_KEY.test(k)) invalid('the key where has a key that is not valid');
      const list = typeof v === 'string' ? [v] : v;
      if (!Array.isArray(list) || list.length < 1 || list.length > SLICE_LIMITS.whereValues || !list.every(x => isString(x, 1, 128))) invalid('the key where has a value that is not valid');
      where[k] = [...list as string[]];
    }
  }
  let links: SliceDefinition['links'] = null;
  if (has('links')) {
    const l = map.links;
    if (l === null || typeof l !== 'object' || Array.isArray(l)) invalid('the key links must be a map');
    const m = l as Record<string, unknown>;
    if (!Object.keys(m).every(k => k === 'follow' || k === 'depth')) invalid('the key links takes follow and depth only');
    const follow = m.follow;
    if (!Array.isArray(follow) || follow.length < 1 || !follow.every(f => f === 'wikilink' || f === 'markdown') || new Set(follow).size !== follow.length) invalid('the key links needs follow: a list of wikilink and markdown');
    if (m.depth !== undefined && m.depth !== 1 && m.depth !== 2) invalid('the key links takes depth 1 or 2');
    links = { follow: [...follow as ('wikilink' | 'markdown')[]], depth: (m.depth as 1 | 2 | undefined) ?? 1 };
  }
  let summary: SliceDefinition['summary'] = { kind: 'heading' };
  if (has('summary')) {
    const s = map.summary;
    if (s === 'heading') summary = { kind: 'heading' };
    else if (s === 'none') summary = { kind: 'none' };
    else if (typeof s === 'string' && s.startsWith('frontmatter:') && /^[A-Za-z0-9_-]{1,64}$/.test(s.slice(12))) summary = { kind: 'frontmatter', key: s.slice(12) };
    else invalid('the key summary is heading, none, or frontmatter:<key>');
  }
  let maxFiles: number = SLICE_LIMITS.maxFiles;
  if (has('maxFiles')) {
    const n = map.maxFiles;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > SLICE_LIMITS.maxFiles) invalid('the key maxFiles must be a whole number from 1 to 256');
    maxFiles = n as number;
  }
  let guard: 'root' | 'none' = 'root';
  if (has('guard')) { if (map.guard !== 'root' && map.guard !== 'none') invalid('the key guard is root or none'); guard = map.guard as 'root' | 'none'; }
  return { format: SLICE_FORMAT, description: description as string, root, include, exclude, where, links, summary, maxFiles, guard };
}

/** Validates the text of a slice file named `<stem>.yaml`. */
export function parseSlice(text: string, stem: string): SliceParse {
  try { return { ok: true, slice: validate(text, stem) }; }
  catch (error) {
    if (error instanceof Failure) return { ok: false, code: error.code, detail: error.detail };
    return { ok: false, code: 'SLICE_INVALID', detail: 'the file cannot be read' };
  }
}
