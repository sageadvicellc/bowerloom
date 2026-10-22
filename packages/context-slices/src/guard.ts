/**
 * The read guard's decision (spec 05, section 3.9). `decideGuard` is pure over identities: it gets the hook input and a
 * view of the file system, and answers silent, deny, or invalid. It never answers allow, so it can never approve a call
 * that Claude Code would ask about or block. Every comparison uses device and inode, never path text.
 *
 * The view is loaded only after the tool is known to be Read, Grep, or Glob, so a call of any other tool costs nothing.
 */
import { posix } from 'node:path';

export type GuardCode = 'GUARD_OUTSIDE_SLICE' | 'GUARD_SLICE_NOT_INSTALLED' | 'GUARD_ROOT_MISSING' | 'GUARD_PROJECT_MISMATCH';
export type GuardDecision = { kind: 'silent' } | { kind: 'deny'; code: GuardCode; reason: string } | { kind: 'invalid' };
export interface FsEntry { dev: string; ino: string; type: 'file' | 'dir' | 'link' | 'other'; nlink: number }
export interface GuardFs {
  lstat(path: string): FsEntry | null;
  stat(path: string): FsEntry | null;
  realpath(path: string): string | null;
  /** The entries of a folder with their lstat, or null when it cannot be listed. */
  list(path: string): { name: string; entry: FsEntry }[] | null;
}
export interface GuardSliceView {
  id: string;
  mode: 'root' | 'none';
  state: 'ok' | 'not-installed' | 'root-missing';
  /** The real path of the slice root. */
  root: string;
  /** The root as the reasons name it: a path from the project folder, or `the project folder`. */
  display: string;
  /** The root's path from the project folder, '' for the project folder itself. The folder list of a reason starts with it. */
  prefix: string;
  /** Members and covered folders, relative to the root. A covered folder ends in `/`, and the root is `./`. */
  members: string[];
  covered: string[];
}
export interface GuardView { projectOk: boolean; slices: GuardSliceView[]; fs: GuardFs }
export interface GuardInput {
  role: string;
  project: string;
  /** The slice ids of the hook arguments, for the reason texts. */
  ids: string[];
  tool: string;
  toolInput: Record<string, unknown>;
  cwd: string;
  home: string;
}

export const GUARD_TOOLS: readonly string[] = Object.freeze(['Read', 'Grep', 'Glob']);
const MAX_RESULTS = 256, MAX_CHAIN = 64, MAX_DEPTH = 16, MAX_FILES = 256;
const silent: GuardDecision = Object.freeze({ kind: 'silent' });
const nfc = (s: string): string => s.normalize('NFC');
const idOf = (e: { dev: string; ino: string }): string => `${e.dev}:${e.ino}`;

// Every control character, format character, and the line and paragraph separators, as plainText escapes them.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
export const plain = (value: string): string => value.replace(HIDDEN, c => Array.from({ length: c.length }, (_, i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`).join(''));

const deny = (code: GuardCode, reason: string): GuardDecision => ({ kind: 'deny', code, reason });
const formReason = (path: string, role: string): string => `Bowerloom guard: the path ${plain(path)} is written in a form the guard does not accept for agent ${role}. Use a plain absolute path without ., .., or a leading ~ other than ~/.`;

/** True when a path value is written in a form the guard does not read. */
function badForm(value: string): boolean {
  if (value !== value.trim() || /[\p{Cc}\p{Cf}]/u.test(value)) return true;
  if (value.split('/').some(s => s === '.' || s === '..')) return true;
  return value.startsWith('~') && value !== '~' && !value.startsWith('~/');
}

/** Splits at unescaped `/`, keeping escapes in the pieces. */
function splitSlash(text: string): string[] {
  const out: string[] = []; let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) { cur += c + text[i + 1]!; i++; } else if (c === '/') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
const hasUnescaped = (text: string, chars: string): boolean => {
  for (let i = 0; i < text.length; i++) { const c = text[i]!; if (c === '\\') { i++; continue; } if (chars.includes(c)) return true; }
  return false;
};
const unescape = (text: string): string => text.replace(/\\(.)/gsu, '$1');

/** Brace expansion, nested, in the comma form and the range form. Returns null when more than `limit` results arise. */
export function expandBraces(pattern: string, limit = MAX_RESULTS): string[] | null {
  const out: string[] = [];
  const go = (text: string, from: number): boolean => {
    let open = -1;
    for (let i = from; i < text.length; i++) { const c = text[i]!; if (c === '\\') { i++; continue; } if (c === '{') { open = i; break; } }
    if (open < 0) { out.push(text); return out.length <= limit; }
    // Find the matching close, and the top-level commas.
    let depth = 0, close = -1; const commas: number[] = [];
    for (let i = open; i < text.length; i++) {
      const c = text[i]!;
      if (c === '\\') { i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { close = i; break; } }
      else if (c === ',' && depth === 1) commas.push(i);
    }
    if (close < 0) return go(text, open + 1);
    const prefix = text.slice(0, open), suffix = text.slice(close + 1), inner = text.slice(open + 1, close);
    let alts: string[];
    if (commas.length > 0) {
      alts = []; let at = open + 1;
      for (const c of commas) { alts.push(text.slice(at, c)); at = c + 1; }
      alts.push(text.slice(at, close));
    } else {
      const range = expandRange(inner, limit);
      if (range === 'too-many') return false;
      // No comma and no range: a tool may read it as one alternative or as literal braces, so both are checked.
      alts = range ?? [inner, `\\{${inner}\\}`];
    }
    if (alts.length > limit) return false;
    for (const alt of alts) if (!go(prefix + alt + suffix, 0)) return false;
    return true;
  };
  return go(pattern, 0) ? out : null;
}
function expandRange(inner: string, limit: number): string[] | 'too-many' | null {
  const num = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(inner);
  if (num) {
    const a = Number(num[1]), b = Number(num[2]), step = Math.max(1, Math.abs(Number(num[3] ?? 1)));
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return 'too-many';
    if (Math.floor(Math.abs(b - a) / step) + 1 > limit) return 'too-many';
    const width = /^-?0\d/.test(num[1]!) || /^-?0\d/.test(num[2]!) ? Math.max(num[1]!.length, num[2]!.length) : 0;
    const out: string[] = [];
    for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? step : -step) out.push(width ? String(v).padStart(width, '0') : String(v));
    return out;
  }
  const chr = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/.exec(inner);
  if (chr) {
    const a = chr[1]!.charCodeAt(0), b = chr[2]!.charCodeAt(0), step = Math.max(1, Math.abs(Number(chr[3] ?? 1))), out: string[] = [];
    for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? step : -step) out.push(String.fromCharCode(v));
    return out;
  }
  return null;
}

type Tool = 'Read' | 'Grep' | 'Glob';
/** The decision for one hook call. `getView` runs only for Read, Grep, and Glob. */
export function decideGuard(input: GuardInput, getView: () => GuardView): GuardDecision {
  if (!GUARD_TOOLS.includes(input.tool)) return silent;
  const tool = input.tool as Tool, ti = input.toolInput;
  if (!posix.isAbsolute(input.cwd)) return { kind: 'invalid' };
  const field = (k: string): string | undefined | 'bad' => { const v = ti[k]; return v === undefined ? undefined : typeof v === 'string' ? v : 'bad'; };
  const raw = tool === 'Read' ? field('file_path') : field('path'), pattern = tool === 'Glob' ? field('pattern') : undefined;
  if (raw === 'bad' || pattern === 'bad') return { kind: 'invalid' };
  if (tool === 'Glob' && pattern === undefined) return { kind: 'invalid' };
  if (tool === 'Read' && raw === undefined) return { kind: 'invalid' };

  const view = getView(), ids = input.ids.join(', '), role = input.role, project = input.project;
  if (!view.projectOk) return deny('GUARD_PROJECT_MISMATCH', `Bowerloom guard: the project at ${plain(project)} does not manage agent ${role}, or it is not the folder that apply wrote this copy for. Run bowerloom apply in the project that holds .claude/agents/${role}.md.`);
  const missing = view.slices.find(s => s.state === 'not-installed');
  if (missing) return deny('GUARD_SLICE_NOT_INSTALLED', `Bowerloom guard: slice ${missing.id} of agent ${role} is not installed, or its copy changed. Every read, search, and file listing of this agent is blocked. Run bowerloom apply in ${plain(project)}.`);
  const lost = view.slices.find(s => s.state === 'root-missing');
  if (lost) return deny('GUARD_ROOT_MISSING', `Bowerloom guard: the folder of slice ${lost.id} cannot be found, or it changed since apply, so every read, search, and file listing of agent ${role} is blocked. Run bowerloom apply in ${plain(project)} to see why.`);
  const areas = view.slices.filter(s => s.mode === 'root');
  if (areas.length === 0) return silent;
  const fs = view.fs;

  // Written forms.
  const values = [raw, pattern].filter((v): v is string => typeof v === 'string');
  for (const v of values) if (badForm(v)) return deny('GUARD_OUTSIDE_SLICE', formReason(v, role));

  const resolveAgainst = (base: string, v: string): string => v === '~' ? input.home : v.startsWith('~/') ? posix.resolve(input.home, v.slice(2)) : v.startsWith('/') ? posix.resolve(v) : posix.resolve(base, v);
  const base = raw === undefined ? input.cwd : resolveAgainst(input.cwd, raw), shown = raw ?? input.cwd;

  const ctx = new Context(fs, view, areas);
  const decide = (target: string): GuardDecision => ctx.classify(tool, target, role, ids, shown);

  if (tool !== 'Glob') return decide(base);

  // Glob: the pattern may hold braces, so each result is a path of its own.
  const pat = pattern!;
  if (hasUnescaped(pat, '()|!')) return deny('GUARD_OUTSIDE_SLICE', formReason(pat, role));
  const results = expandBraces(pat);
  if (results === null) return deny('GUARD_OUTSIDE_SLICE', formReason(pat, role));
  for (const r of results) {
    if (r.split('/').some(s => s === '.' || s === '..') || /[\p{Cc}\p{Cf}]/u.test(r)) return deny('GUARD_OUTSIDE_SLICE', formReason(pat, role));
    let at = base, rest = r;
    if (r.startsWith('~/')) { at = input.home; rest = r.slice(2); }
    else if (r.startsWith('/')) { at = '/'; rest = r.slice(1); }
    // A tilde anywhere but the leading ~/ is refused: a tool may expand it.
    if (rest.includes('~')) return deny('GUARD_OUTSIDE_SLICE', formReason(pat, role));
    const prefix: string[] = [];
    for (const seg of splitSlash(rest)) { if (hasUnescaped(seg, '*?[')) break; if (seg !== '') prefix.push(unescape(seg)); }
    const result = decide(posix.resolve(at, ...prefix));
    if (result.kind !== 'silent') return result;
  }
  return silent;
}

class Context {
  private memo = new Map<string, FsEntry | null>();
  private rootIds = new Map<string, string[]>();
  constructor(private fs: GuardFs, private view: GuardView, private areas: GuardSliceView[]) {}
  private lstat(p: string): FsEntry | null { const k = 'l' + p; if (!this.memo.has(k)) this.memo.set(k, this.fs.lstat(p)); return this.memo.get(k)!; }
  private stat(p: string): FsEntry | null { const k = 's' + p; if (!this.memo.has(k)) this.memo.set(k, this.fs.stat(p)); return this.memo.get(k)!; }
  private rootIdent(s: GuardSliceView): string | null { const e = this.stat(s.root); return e === null ? null : idOf(e); }
  /** The identities of a root's real chain, with the same chain through the data volume of macOS when it exists. */
  private chainOfRoot(s: GuardSliceView): string[] {
    const cached = this.rootIds.get(s.id); if (cached) return cached;
    const out: string[] = [], walk = (start: string): void => { for (let p = start, n = 0; n < MAX_CHAIN; n++) { const e = this.stat(p); if (e) out.push(idOf(e)); if (p === '/') break; p = posix.dirname(p); } };
    walk(s.root);
    const data = posix.join('/System/Volumes/Data', s.root), here = this.lstat(data), mine = this.stat(s.root);
    if (here && mine && idOf(here) === idOf(mine)) walk(data);
    this.rootIds.set(s.id, out); return out;
  }
  private chainMemo = new Map<string, { idents: Set<string>; real: string; exists: boolean }>();
  private chains(target: string): { idents: Set<string>; real: string; exists: boolean } {
    const known = this.chainMemo.get(target); if (known) return known;
    const made = this.buildChains(target); this.chainMemo.set(target, made); return made;
  }
  private buildChains(target: string): { idents: Set<string>; real: string; exists: boolean } {
    let real = this.fs.realpath(target), exists = real !== null;
    if (real === null) {
      let anc = target; const rest: string[] = [];
      for (let n = 0; n < MAX_CHAIN * 4 && anc !== '/'; n++) { rest.unshift(posix.basename(anc)); anc = posix.dirname(anc); const r = this.fs.realpath(anc); if (r !== null) { real = posix.join(r, ...rest); break; } }
      if (real === null) real = target;
    }
    const idents = new Set<string>();
    for (const [start, st] of [[target, true], [real, false]] as const) {
      let n = 0;
      for (let p = start; n < MAX_CHAIN; n++, p = posix.dirname(p)) {
        const e = st ? this.lstat(p) : this.stat(p); if (e) idents.add(idOf(e));
        if (p === '/') break;
      }
    }
    return { idents, real, exists };
  }
  private memberPaths(s: GuardSliceView): Set<string> { return new Set(s.members.map(nfc)); }
  /** True when the entry is a member of the slice: a regular file with one link, found by the member list, under real folders. */
  private isMemberOf(s: GuardSliceView, st: FsEntry, real: string): boolean {
    if (st.type !== 'file' || st.nlink !== 1) return false;
    const rootEntry = this.stat(s.root); if (rootEntry === null || rootEntry.dev !== st.dev) return false;
    const check = (m: string): boolean => {
      const parts = m.split('/');
      for (let i = 1; i < parts.length; i++) { const d = this.lstat(posix.join(s.root, ...parts.slice(0, i))); if (d === null || d.type !== 'dir') return false; }
      const e = this.lstat(posix.join(s.root, m));
      return e !== null && e.type === 'file' && e.nlink === 1 && idOf(e) === idOf(st);
    };
    if (real.startsWith(s.root + '/')) { const rel = real.slice(s.root.length + 1); for (const m of s.members) if (nfc(m) === nfc(rel) && check(m)) return true; }
    for (const m of s.members) if (check(m)) return true;
    return false;
  }
  private coveredOk(s: GuardSliceView, rel: string): boolean {
    const members = this.memberPaths(s); let files = 0;
    const walk = (abs: string, relPath: string, depth: number): boolean => {
      if (depth > MAX_DEPTH) return false;
      const list = this.fs.list(abs); if (list === null) return false;
      for (const { name, entry } of list) {
        if (name.startsWith('.')) return false;
        const childRel = relPath === '' ? name : relPath + '/' + name;
        if (entry.type === 'dir') { if (!walk(posix.join(abs, name), childRel, depth + 1)) return false; }
        else if (entry.type === 'file' && entry.nlink === 1 && members.has(nfc(childRel))) { if (++files > MAX_FILES) return false; }
        else return false;
      }
      return true;
    };
    return walk(rel === '' ? s.root : posix.join(s.root, rel), rel, 1);
  }

  classify(tool: Tool, target: string, role: string, ids: string, shown: string): GuardDecision {
    if (posix.resolve(target).split('/')[1]?.startsWith('.')) return deny('GUARD_OUTSIDE_SLICE', formReason(shown, role));
    const folderOnly = tool !== 'Read', exists = this.chains(target).exists;
    // For Grep and Glob the target may not exist: the deepest existing ancestor decides, as a folder.
    let subject = target;
    if (folderOnly && !exists) { for (let p = posix.dirname(target); ; p = posix.dirname(p)) { if (this.lstat(p) !== null || p === '/') { subject = p; break; } } }
    const sees = this.chains(subject), st = this.stat(subject);
    const allSlices = this.view.slices.filter(s => s.state === 'ok');
    const inside = this.areas.filter(a => { const id = this.rootIdent(a); return id !== null && sees.idents.has(id); });
    const isMember = (): boolean => {
      if (st === null) return false;
      for (const s of allSlices) { const id = this.rootIdent(s); if (id !== null && sees.idents.has(id) && this.isMemberOf(s, st, sees.real)) return true; }
      return false;
    };
    const area = inside[0] ?? this.areas[0]!;
    const readReason = (): GuardDecision => deny('GUARD_OUTSIDE_SLICE', `Bowerloom guard: ${plain(shown)} is under ${plain(area.display)}, and no context slice of agent ${role} (${ids}) lists it. Read the files that your slice skills list. To widen a slice, ask the main session to edit .bowerloom/slices/${area.id}.yaml and run bowerloom apply.`);
    if (tool === 'Read') {
      if (inside.length > 0) return isMember() ? silent : readReason();
      // A hard link outside every area to a file on a guarded device, that no slice lists, may be a second name of a file under a root.
      if (st !== null && st.type === 'file' && st.nlink > 1 && this.areas.some(a => this.stat(a.root)?.dev === st.dev) && !isMember()) return readReason();
      return silent;
    }
    const folders = (): string => {
      const names: string[] = [];
      for (const s of this.areas) for (const c of s.covered) names.push(c === './' ? (s.prefix === '' ? '.' : s.prefix) : posix.join(s.prefix, c.slice(0, -1)));
      return names.length ? names.slice(0, 5).join(', ') : 'none';
    };
    const refuse = (): GuardDecision => deny('GUARD_OUTSIDE_SLICE', `Bowerloom guard: a search of ${plain(shown)} would reach files that no context slice of agent ${role} (${ids}) lists. Search one listed file, or a folder whose files are all listed: ${plain(folders())}.`);
    if (inside.length > 0) {
      if (st === null) return refuse();
      if (st.type === 'file') return isMember() ? silent : refuse();
      if (st.type === 'dir') {
        for (const s of allSlices) {
          const id = this.rootIdent(s); if (id === null || !sees.idents.has(id)) continue;
          for (const c of s.covered) {
            const rel = c === './' ? '' : c.slice(0, -1), e = this.lstat(rel === '' ? s.root : posix.join(s.root, rel));
            if (e !== null && e.type === 'dir' && idOf(e) === idOf(st) && this.coveredOk(s, rel)) return silent;
          }
        }
      }
      return refuse();
    }
    // Not inside an area: a folder that holds an area is refused, because a search would reach it.
    if (st !== null && st.type === 'dir') {
      for (const a of this.areas) if (this.chainOfRoot(a).includes(idOf(st))) return refuse();
    }
    return silent;
  }
}
