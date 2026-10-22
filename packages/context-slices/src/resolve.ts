/**
 * How a slice selects files (spec 05, section 3.5). `resolveSlice(def, reader)` is a pure function of the definition and
 * a read-only view of the tree, so the plan and the managed planner run the same code and agree or refuse. The reader
 * does the I/O and the consistency pass; this module only decides.
 */
import { parseDocument } from 'yaml';
import { canMatchBelow, compilePattern, isLiteral, literalPath, matchPattern } from './glob.js';
import type { CompiledPattern } from './glob.js';
import { splitFrontmatter } from './frontmatter.js';
import { extractLinks } from './links.js';
import { SLICE_LIMITS } from './slice-file.js';
import type { SliceDefinition } from './slice-file.js';

export type HoldCode = 'SLICE_SOURCE_UNSAFE' | 'SLICE_PATH_MISSING' | 'SLICE_EMPTY' | 'SLICE_TOO_LARGE';
/** A reason the slice is held. The reader throws it too, for a folder it cannot list safely. */
export class SliceTreeError extends Error {
  constructor(readonly code: HoldCode, readonly detail: string) { super(code); this.name = 'SliceTreeError'; }
}
export type EntryType = 'file' | 'dir' | 'link' | 'other';
/** What `lstat` says. `safe` is true when the user owns the entry and the group and others cannot write it. */
export interface EntryInfo { type: EntryType; size: number; nlink: number; safe: boolean }
export interface TreeReader {
  /** Names in a folder; the path is relative to the root, '' for the root. Throws SliceTreeError for an unsafe folder or more than 1024 names. */
  list(dir: string): string[];
  /** lstat of a path relative to the root; null when absent. */
  stat(path: string): EntryInfo | null;
  /** The bytes of a member file of at most 1 MiB. */
  read(path: string): Uint8Array;
  /** The closing pass: the same entries with the same identities, sizes, and times. Throws when something changed. */
  close?(): void;
}
export interface Member { path: string; bytes: number; summary: string | null; oversize: boolean }
export interface SliceNotes { unparsed: string[]; unresolvedLinks: number; ambiguousLinks: number; emptyPatterns: string[]; notText: number; oversize: string[] }
export interface SliceHold { code: HoldCode; detail: string }
export interface SliceResolution { members: Member[]; covered: string[]; notes: SliceNotes; hold: SliceHold | null; readBytes: number }

const cmp = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const fold = (s: string): string => s.normalize('NFC').toLowerCase();
const BAD_PATH = /[`\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const join = (dir: string, name: string): string => dir === '' ? name : dir + '/' + name;
const tooLarge = (detail: string): never => { throw new SliceTreeError('SLICE_TOO_LARGE', detail); };
const unsafe = (path: string): never => { throw new SliceTreeError('SLICE_SOURCE_UNSAFE', path); };

/** The text of a summary: format characters go, white space and control characters collapse to one space, 160 characters at most. */
export function cleanSummary(text: string): string | null {
  const cleaned = text.replace(/\p{Cf}/gu, '').replace(/[\s\p{Cc}]+/gu, ' ').trim();
  const cut = Array.from(cleaned).slice(0, SLICE_LIMITS.summaryChars).join('').trim();
  return cut === '' ? null : cut;
}
function frontmatterMap(text: string): Record<string, unknown> | null {
  const fm = splitFrontmatter(text); if (fm === null) return null;
  try {
    const doc = parseDocument(fm.block, { uniqueKeys: true });
    if (doc.errors.length || doc.warnings.length) return null;
    const value: unknown = doc.toJS({ maxAliasCount: 0 });
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
const scalar = (v: unknown): string | null => typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;
function whereMatches(map: Record<string, unknown>, where: Record<string, string[]>): boolean {
  return Object.entries(where).every(([key, allowed]) => {
    if (!Object.hasOwn(map, key)) return false;
    const v = map[key], list = Array.isArray(v) ? v : [v];
    return list.some(el => { const s = scalar(el); return s !== null && allowed.includes(s); });
  });
}
function summaryOf(def: SliceDefinition, text: string): string | null {
  if (def.summary.kind === 'none') return null;
  if (def.summary.kind === 'frontmatter') { const map = frontmatterMap(text); const v = map === null ? undefined : map[def.summary.key]; return typeof v === 'string' ? cleanSummary(v) : null; }
  const fm = splitFrontmatter(text), lines = (fm === null ? text : fm.rest).split('\n').slice(0, 64);
  const heading = lines.find(l => l.startsWith('# '));
  return heading === undefined ? null : cleanSummary(heading.slice(2));
}

interface Folder { entered: boolean; hidden: boolean; bad: boolean; subdirs: string[]; files: string[] }

/** Resolves a slice against a tree. Throws only what the reader's closing pass throws. */
export function resolveSlice(def: SliceDefinition, reader: TreeReader): SliceResolution {
  const notes: SliceNotes = { unparsed: [], unresolvedLinks: 0, ambiguousLinks: 0, emptyPatterns: [], notText: 0, oversize: [] };
  let result: SliceResolution;
  try { result = run(def, reader, notes); }
  catch (error) {
    if (!(error instanceof SliceTreeError)) throw error;
    result = { members: [], covered: [], notes, hold: { code: error.code, detail: error.detail }, readBytes: 0 };
  }
  reader.close?.();
  return result;
}

function run(def: SliceDefinition, reader: TreeReader, notes: SliceNotes): SliceResolution {
  const compile = (p: string): CompiledPattern => { const c = compilePattern(p); if (!c.ok) throw new TypeError('A slice definition holds a pattern that parseSlice refuses.'); return c.pattern; };
  const includes = def.include.map(compile), excludes = def.exclude.map(compile);
  const selected = (path: string): boolean => includes.some(p => matchPattern(p, path)) && !excludes.some(p => matchPattern(p, path));
  const walkAll = def.links !== null;

  // 1. Walk.
  const files = new Map<string, EntryInfo>(), folders = new Map<string, Folder>();
  let entries = 0;
  const visit = (dir: string, depth: number): void => {
    if (depth > SLICE_LIMITS.walkDepth) tooLarge(dir);
    const st = reader.stat(dir);
    if (st === null || st.type !== 'dir' || !st.safe) unsafe(dir === '' ? '.' : dir);
    const names = reader.list(dir);
    if (new Set(names.map(fold)).size !== names.length) unsafe(dir === '' ? '.' : dir);
    const info: Folder = { entered: true, hidden: false, bad: false, subdirs: [], files: [] };
    folders.set(dir, info);
    for (const name of [...names].sort(cmp)) {
      if (name.startsWith('.')) { info.hidden = true; continue; }
      if (++entries > SLICE_LIMITS.walkEntries) tooLarge('the folder');
      const path = join(dir, name), s = reader.stat(path);
      if (s === null || s.type === 'other') { info.bad = true; continue; }
      if (s.type === 'link') { if (selected(path)) unsafe(path); info.bad = true; continue; }
      if (s.type === 'dir') {
        info.subdirs.push(path);
        if (walkAll || includes.some(p => canMatchBelow(p, path))) visit(path, depth + 1);
        else folders.set(path, { entered: false, hidden: false, bad: false, subdirs: [], files: [] });
      } else { files.set(path, s); info.files.push(path); }
    }
  };
  visit('', 0);

  // 2 and 3. Candidates: include, then exclude. Each must be safe to read.
  const candidates = [...files.keys()].filter(selected).sort(cmp);
  for (const path of candidates) { const s = files.get(path)!; if (s.nlink !== 1 || !s.safe) unsafe(path); }
  for (const p of includes) {
    if (isLiteral(p)) { const lit = literalPath(p)!; if (!files.has(lit)) throw new SliceTreeError('SLICE_PATH_MISSING', lit); }
    else if (![...files.keys()].some(f => matchPattern(p, f))) notes.emptyPatterns.push(p.source);
  }

  // 4 and 5. Text only, then the frontmatter filter.
  const members = new Map<string, Member>(), texts = new Map<string, string>();
  let readBytes = 0;
  const hasWhere = Object.keys(def.where).length > 0;
  const addFile = (path: string, s: EntryInfo): boolean => {
    if (BAD_PATH.test(path) || Buffer.byteLength(path) > SLICE_LIMITS.pathBytes) { notes.notText++; return false; }
    if (s.size > SLICE_LIMITS.memberBytes) {
      if (hasWhere) return false;
      members.set(path, { path, bytes: s.size, summary: null, oversize: true }); notes.oversize.push(path); return true;
    }
    const data = reader.read(path); readBytes += data.length;
    if (readBytes > SLICE_LIMITS.readBytes) tooLarge('the files');
    let text: string; try { text = decoder.decode(data); } catch { notes.notText++; return false; }
    if (hasWhere) {
      if (!path.endsWith('.md')) return false;
      const map = frontmatterMap(text);
      if (map === null) { notes.unparsed.push(path); return false; }
      if (!whereMatches(map, def.where)) return false;
    }
    texts.set(path, text);
    members.set(path, { path, bytes: data.length, summary: summaryOf(def, text), oversize: false });
    if (members.size > def.maxFiles) tooLarge('the files');
    return true;
  };
  for (const path of candidates) addFile(path, files.get(path)!);

  // 6. Links, breadth first, in byte order.
  if (def.links !== null) followLinks(def, reader, files, members, texts, notes, excludes, addFile);

  // 7 and 9. Bounds, then covered folders.
  const list = [...members.values()].sort((a, b) => cmp(a.path, b.path));
  if (list.length === 0) throw new SliceTreeError('SLICE_EMPTY', 'the slice');
  const covered = coveredFolders(folders, new Set(list.map(m => m.path)));
  if (Buffer.byteLength(JSON.stringify([...list.map(m => m.path), ...covered])) > SLICE_LIMITS.referencesBytes) tooLarge('the paths');
  notes.unparsed.sort(cmp); notes.emptyPatterns.sort(cmp); notes.oversize.sort(cmp);
  return { members: list, covered, notes, hold: null, readBytes };
}

function coveredFolders(folders: Map<string, Folder>, members: Set<string>): string[] {
  const below = (dir: string): number => { let n = 0; const prefix = dir === '' ? '' : dir + '/'; for (const m of members) if (m.startsWith(prefix)) n++; return n; };
  const clean = new Map<string, boolean>();
  const isClean = (dir: string): boolean => {
    const known = clean.get(dir); if (known !== undefined) return known;
    const f = folders.get(dir);
    const result = f !== undefined && f.entered && !f.hidden && !f.bad && f.files.every(x => members.has(x)) && f.subdirs.every(isClean);
    clean.set(dir, result); return result;
  };
  const out: string[] = [];
  for (const dir of folders.keys()) if (isClean(dir) && below(dir) >= 1) out.push(dir === '' ? './' : dir + '/');
  return out.sort(cmp);
}

function followLinks(
  def: SliceDefinition, reader: TreeReader, files: Map<string, EntryInfo>, members: Map<string, Member>, texts: Map<string, string>,
  notes: SliceNotes, excludes: CompiledPattern[], addFile: (path: string, s: EntryInfo) => boolean,
): void {
  const links = def.links!, stems = new Map<string, string[]>();
  for (const f of files.keys()) if (f.endsWith('.md')) { const stem = fold(f.slice(f.lastIndexOf('/') + 1, -3)); stems.set(stem, [...(stems.get(stem) ?? []), f]); }
  const seen = new Set<string>(members.keys()), counted = new Set<string>();
  const count = (kind: 'unresolved' | 'ambiguous', from: string, target: string): void => {
    const key = `${kind}\0${from}\0${target}`; if (counted.has(key)) return; counted.add(key);
    if (kind === 'unresolved') notes.unresolvedLinks++; else notes.ambiguousLinks++;
  };
  let frontier = [...members.values()].filter(m => !m.oversize && m.path.endsWith('.md')).map(m => m.path).sort(cmp);
  for (let depth = 0; depth < links.depth && frontier.length; depth++) {
    const next: string[] = [];
    for (const from of frontier) {
      const text = texts.get(from); if (text === undefined) continue;
      const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : [];
      for (const link of extractLinks(text)) {
        if (!links.follow.includes(link.kind)) continue;
        const target = resolveLink(link.kind, link.target, base, stems);
        if (target === 'ignore') continue;
        if (target === 'ambiguous') { count('ambiguous', from, link.target); continue; }
        if (target === 'unresolved') { count('unresolved', from, link.target); continue; }
        if (seen.has(target)) continue;
        // Every folder on the path must be a real, safe folder; a link anywhere on it holds the slice.
        const parts = target.split('/'); let missing = false;
        for (let i = 1; i < parts.length && !missing; i++) {
          const dir = parts.slice(0, i).join('/'), s = reader.stat(dir);
          if (s === null) missing = true;
          else if (s.type === 'link' || s.type !== 'dir' || !s.safe) unsafe(dir);
        }
        const s = missing ? null : reader.stat(target);
        if (s === null || s.type === 'dir') { count('unresolved', from, link.target); continue; }
        if (s.type === 'link') unsafe(target);
        if (s.type !== 'file') { count('unresolved', from, link.target); continue; }
        if (s.nlink !== 1 || !s.safe) unsafe(target);
        seen.add(target);
        if (excludes.some(p => matchPattern(p, target))) continue;
        if (addFile(target, s) && target.endsWith('.md') && !members.get(target)!.oversize) next.push(target);
      }
    }
    frontier = next.sort(cmp);
  }
}

type Resolved = string | 'ignore' | 'ambiguous' | 'unresolved';
function resolveLink(kind: 'wikilink' | 'markdown', raw: string, base: string[], stems: Map<string, string[]>): Resolved {
  if (kind === 'wikilink') {
    const target = raw.normalize('NFC');
    if (target.startsWith('/') || target.includes('\\') || /[\p{Cc}\p{Cf}]/u.test(target)) return 'unresolved';
    const segs = target.split('/');
    if (segs.some(s => s === '' || s.startsWith('.'))) return 'unresolved';
    if (segs.length === 1) {
      const stem = fold(target.endsWith('.md') ? target.slice(0, -3) : target), hits = stems.get(stem) ?? [];
      return hits.length === 1 ? hits[0]! : hits.length > 1 ? 'ambiguous' : 'unresolved';
    }
    const last = segs[segs.length - 1]!;
    return last.includes('.') ? segs.join('/') : segs.join('/') + '.md';
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.startsWith('#')) return 'ignore';
  if (raw.startsWith('/')) return 'unresolved';
  const cut = raw.search(/[#?]/), path = cut >= 0 ? raw.slice(0, cut) : raw;
  if (path === '') return 'unresolved';
  let decoded: string; try { decoded = decodeURIComponent(path); } catch { return 'unresolved'; }
  decoded = decoded.normalize('NFC');
  if (decoded.includes('\\') || /[\p{Cc}\p{Cf}]/u.test(decoded)) return 'unresolved';
  const stack = [...base];
  for (const seg of decoded.split('/')) {
    if (seg === '') return 'unresolved';
    if (seg === '.') continue;
    if (seg === '..') { if (stack.length === 0) return 'unresolved'; stack.pop(); continue; }
    stack.push(seg);
  }
  if (stack.length === 0 || stack.some(s => s.startsWith('.'))) return 'unresolved';
  return stack.join('/');
}
