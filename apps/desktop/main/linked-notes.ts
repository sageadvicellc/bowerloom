/**
 * The notes folders a harness links in its `knowledge.json`, read for the Library (issue 143, the Context tab). The reader of main/real-scan.ts stays as it is (it is the frozen library of the
 * base: packages/engine-api/golden); this module adds to the result it hands out, in main, before the result is kept and sent to the page (main/main.ts wires it through the `keepRead` hook).
 * It reads only. The approval of a folder is written by packages/notes-source (`approveFolder`), when the person picks the folder in main's own notes chooser. This module imports no fs name.
 *
 * What is read, for each chosen place that holds a `.bowerloom` folder:
 *  - A link below the harness folder (`.` or a relative path) is part of the project and is read.
 *  - A link in `~/` form is read only when the record of approvals holds the real folder it leads to now (a swapped shortcut is another folder). `knowledge.json` can come from a cloned repository.
 *  - A stored path must be a stored form (the rule of the harness package): `.`, a plain relative path, or `~/` and a plain relative path. Once its shortcuts are resolved, the folder must still be below
 *    its base, must not be the home folder or above it, and must have no hidden part below the base. A linked folder is read whole: a subfolder that holds a tool folder is still notes.
 *  - Nothing is dropped without a word: each link that is not read is a problem with its reason (gone, form, approval, damaged record, unreadable list, over a limit).
 * The caps of a place hold for its own notes and its linked folders together (`filesPerPlace`, `pagesPerPlace`).
 */
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import type { NoteEntry } from '../shared/real/place.js';
import { ADAPTERS } from '../shared/real/adapters.js';
import { firstHeading, firstSentence, parseFrontmatter } from '../shared/real/frontmatter.js';
import { cleanLine, cleanPath, cut, safeText } from '../shared/real/redact.js';
import { listOf, textOf } from '../shared/real/yaml.js';
import { REAL_LIMITS } from '../shared/real/types.js';
import type { RealHarness, RealHarnessPlace, RealPlace, RealResult } from '../shared/real/types.js';
import type { ContextSliceItem, Slice, WikiPage } from '../shared/world/types.js';
import { hashText } from '../shared/world/sample.js';
import type { LinkProblem } from '../shared/harness/types.js';
import { APPROVALS_LIMITS, approvalKeyOf, readApprovals } from '../../../packages/notes-source/src/index.js';
import { isThere, makeBudget, newTally, readHead, readText, realFolder, realFolderFollowing, walkFiles } from './real-fs.js';
import type { Budget, Tally, WalkOptions, WalkedFile } from './real-fs.js';
import { SKIP_DIRS } from './real-scan.js';
import type { Fingerprinter } from './scan-session.js';
import { pickFailureOf } from './pick-failures.js';

/** The most notes folders one harness may link. A longer list is read up to this many, and the rest is a problem the Library says. */
export const LINKED_NOTES_MAX = 8;
/** The most sources of a `knowledge.json` looked at. */
const LIST_MAX = 200;

export interface LinkedLimits { readonly filesPerPlace: number; readonly pagesPerPlace: number }
export interface LinkedDeps {
  readonly home: string;
  /** The private state folder that holds the record of approvals. */
  readonly stateRoot: string;
  readonly now?: () => number;
  /** A test lowers the caps. */
  readonly limits?: LinkedLimits;
}

const SCOPE_PREFIX = 'scope-real-', HARNESS_PREFIX = 'harness-';
const shortHash = (text: string, n = 16): string => hashText(text).slice(0, n);
const MARKDOWN = /\.(?:md|markdown)$/i;
const PROJECT_FOLDERS: ReadonlySet<string> = new Set(ADAPTERS.flatMap(a => a.projectFolders));
const PROJECT_FILES: ReadonlySet<string> = new Set(ADAPTERS.flatMap(a => a.projectFiles.map(f => f.name)));
const hasMarker = (names: readonly string[]): boolean => names.some(n => PROJECT_FOLDERS.has(n) || PROJECT_FILES.has(n));

/** How notes pages are walked. The automatic walk of a place stops at a work folder, which is a place of its own; a linked folder is read whole. */
const notesWalk = (limits: LinkedLimits, linked: boolean): WalkOptions => ({
  maxDepth: REAL_LIMITS.depth, maxFiles: limits.filesPerPlace, maxEntries: REAL_LIMITS.discoveryEntries, skipDirs: new Set([...SKIP_DIRS, ...PROJECT_FOLDERS]), skipHidden: true,
  accept: rel => MARKDOWN.test(rel), ...(linked ? {} : { boundary: hasMarker }),
});

// ---------------------------------------------------------------------------------------------------------------------- the stored forms

const ODD = /[\0-\x1f\x7f\\`]/;
/** The rule of `isKnowledgePath` in the harness package: `.`, a plain relative path, or `~/` and a plain relative path. A plain path has no empty, `.`, `..` or hidden segment. */
function isStoredPath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || [...value].length > 1024 || ODD.test(value) || /^[A-Za-z]:/.test(value)) return false;
  const plain = (rest: string): boolean => rest.split('/').every(seg => seg !== '' && !seg.startsWith('.'));
  if (value === '.') return true;
  if (value.startsWith('~/')) return plain(value.slice(2));
  if (value.startsWith('/') || value.startsWith('~')) return false;
  return plain(value);
}

type Stored = { readonly ok: true; readonly real: string } | { readonly ok: false; readonly why: 'form' | 'gone' };

/**
 * The folder a stored path names. Not a stored form: `form`. Not there: `gone`. A folder that, once its shortcuts are resolved, is not below its base (the harness folder, or the home
 * folder), is the home folder itself, or has a hidden part below the base is `form` too: a shortcut such as `~/notes` to `~/.ssh` is no notes folder.
 */
export function resolveStored(stored: unknown, rootReal: string, home: string): Stored {
  if (!isStoredPath(stored)) return { ok: false, why: 'form' };
  const homeBased = stored.startsWith('~/'), base = homeBased ? realFolderFollowing(home) : rootReal;
  if (base === null) return { ok: false, why: 'gone' };
  const real = realFolderFollowing(stored === '.' ? base : join(base, homeBased ? stored.slice(2) : stored));
  if (real === null) return { ok: false, why: 'gone' };
  const inside = relative(base, real);
  if (inside.startsWith('..') || isAbsolute(inside)) return { ok: false, why: 'form' };
  if (inside === '' ? homeBased : inside.split(sep).some(part => part.startsWith('.'))) return { ok: false, why: 'form' };
  return { ok: true, real };
}

export interface LinkedRoot { readonly real: string; readonly stored: string }

/** The approvals of this computer, as the reader sees them: the keys, and whether the record is damaged, its folder is blocked (a link, another owner, open to others), or the record is full. */
export interface Approvals { readonly approved: ReadonlySet<string>; readonly damaged: boolean; readonly blocked: boolean; readonly full: boolean }
export function approvalsOf(stateRoot: string): Approvals {
  const r = readApprovals(stateRoot);
  return { approved: r.status === 'ok' ? r.keys : new Set(), damaged: r.status === 'damaged', blocked: r.status === 'blocked', full: r.status === 'ok' && r.keys.size >= APPROVALS_LIMITS.keys };
}
/** Why a `~/` link has no approval: each case has its own words, and its own way out (the damaged record is replaced by the next pick; a blocked folder and a full record are not). */
const whyNoApproval = (a: Approvals, key: string | null): LinkProblem['reason'] => {
  if (a.blocked) return 'blocked';
  if (a.damaged) return 'damaged';
  if (a.full) return 'full';
  // A pick of this folder that could not be saved, in this session: the same words as a record that cannot be used, never "link it again".
  const failed = key === null ? undefined : pickFailureOf(key);
  return failed === 'full' ? 'full' : failed === 'failed' ? 'blocked' : 'approval';
};

/**
 * The folders linked by the harness folder `rootReal`, and each link that was not read, with its reason. A root inside another root is read by the outer one, and each folder is returned once.
 */
export function linkedRootsOf(rootReal: string, home: string, approvals: Approvals, budget: Budget, tally: Tally): { roots: LinkedRoot[]; problems: LinkProblem[] } {
  const none = { roots: [], problems: [] };
  const harness = realFolder(join(rootReal, '.bowerloom'));
  if (harness === null) return none;
  const file = join(harness, 'knowledge.json');
  if (!isThere(file)) return none;
  const text = readText(file, harness, tally, budget);
  const unreadable = { roots: [], problems: [{ reason: 'unreadable', label: '' } as const] };
  if (text === null) return unreadable;
  let sources: unknown;
  try { sources = (JSON.parse(text) as { sources?: unknown } | null)?.sources; } catch { return unreadable; }
  if (sources === undefined) return none;
  if (!Array.isArray(sources)) return unreadable;
  const roots: LinkedRoot[] = [], problems: LinkProblem[] = [];
  const label = (stored: unknown): string => (typeof stored === 'string' ? safeText(stored, 60) : '');
  // Only the wiki folders count, and only then are they cut at the list limit.
  const links = sources.filter(x => (x as { kind?: unknown } | null)?.kind === 'wiki-folder').slice(0, LIST_MAX) as { path?: unknown }[];
  for (const link of links) {
    if (roots.length >= LINKED_NOTES_MAX) { problems.push({ reason: 'limit', label: label(link.path) }); continue; }
    const got = resolveStored(link.path, rootReal, home);
    if (!got.ok) { problems.push({ reason: got.why, label: label(link.path) }); continue; }
    const stored = link.path as string;
    if (stored.startsWith('~/')) {
      // The key is the native real path, as the write made it, so a stored path in another case finds the folder on a volume that ignores case.
      const key = approvalKeyOf(got.real);
      if (key === null || !approvals.approved.has(key)) { problems.push({ reason: whyNoApproval(approvals, key), label: label(stored) }); continue; }
    }
    if (roots.some(r => r.real === got.real)) continue;
    roots.push({ real: got.real, stored });
  }
  const inside = (a: string, b: string): boolean => a !== b && !relative(b, a).startsWith('..') && !isAbsolute(relative(b, a));
  return { roots: roots.filter(r => !roots.some(o => inside(r.real, o.real))), problems };
}

// ---------------------------------------------------------------------------------------------------------------------- the walk

/** One folder's share of the pages: where it is, what its pages are called, and the files that fit the room. */
export interface LinkedGroup { readonly root: LinkedRoot; readonly self: boolean; readonly name: string; readonly files: readonly WalkedFile[]; readonly cut: boolean }
export interface Collected { readonly problems: LinkProblem[]; readonly groups: LinkedGroup[]; readonly leftOut: number }

/** The name each linked folder's pages carry in front of their path: the folder's own name, and a short hash after it when two folders share the name. */
function namesOf(roots: readonly LinkedRoot[]): string[] {
  const base = roots.map(r => basename(r.real));
  return base.map((b, i) => (base.indexOf(b) === i && base.lastIndexOf(b) === i ? b : `${b}-${shortHash(roots[i]!.real, 4)}`));
}

/** Walks the linked folders of one harness folder under the caps it shares with its own notes. Used by the read and by the check, so the two cannot disagree. */
export function collectLinked(rootReal: string, home: string, approvals: Approvals, limits: LinkedLimits, budget: Budget, tally: Tally): Collected {
  const found = linkedRootsOf(rootReal, home, approvals, budget, tally);
  const problems = [...found.problems], groups: LinkedGroup[] = [];
  if (found.roots.length === 0) return { problems, groups, leftOut: 0 };
  const own = walkFiles(rootReal, rootReal, notesWalk(limits, false), budget, tally);
  const have = new Set(own.map(f => f.abs));
  let room = limits.filesPerPlace - own.length, pageRoom = limits.pagesPerPlace - Math.min(own.length, limits.pagesPerPlace), leftOut = 0;
  const others = found.roots.filter(r => r.real !== rootReal), names = namesOf(others);
  // The harness folder linked to itself first: its pages below a work folder (the automatic walk stops there) are what is added.
  const ordered = [...found.roots.filter(r => r.real === rootReal), ...others];
  for (const root of ordered) {
    const self = root.real === rootReal;
    if (budget.expired()) { tally.stoppedEarly = true; break; }
    if (room <= 0) { problems.push({ reason: 'limit', label: safeText(root.stored, 60) }); continue; }
    // One file more than the room is asked for, so a folder that does not fit is known to be cut. The files of the automatic walk come first in the walk of the folder itself.
    const got = walkFiles(root.real, root.real, { ...notesWalk(limits, true), maxFiles: room + 1 + (self ? own.length : 0) }, budget, tally);
    const fresh = got.filter(f => !have.has(f.abs));
    const cutHere = fresh.length > room;
    const files = fresh.slice(0, room);
    for (const f of files) have.add(f.abs);
    room -= files.length;
    if (cutHere) { leftOut += 1; problems.push({ reason: 'limit', label: safeText(root.stored, 60) }); }
    const taken = Math.min(files.length, Math.max(pageRoom, 0));
    leftOut += files.length - taken;
    pageRoom -= taken;
    groups.push({ root, self, name: self ? '' : names[others.indexOf(root)]!, files: files.slice(0, taken), cut: cutHere });
  }
  return { problems, groups, leftOut };
}

// ---------------------------------------------------------------------------------------------------------------------- the result

/** The folder a shown path names: `~` and `~/..` are below the home folder, an absolute path is itself, anything else is nothing. */
function folderOfShown(path: string, home: string): string | null {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return isAbsolute(path) && !path.includes('\u0000') ? path : null;
}

function noteOf(rawRel: string, bytes: number, head: string | null): NoteEntry {
  const rel = cleanPath(rawRel), slash = rel.lastIndexOf('/'), folder = slash < 0 ? '' : rel.slice(0, slash), file = rel.slice(slash + 1).replace(/\.[^.]+$/, '');
  const plain = (text: string, max: number): string => safeText(text, max);
  if (head === null) return { rel, folder, title: plain(file, REAL_LIMITS.noteChars), summary: '', tags: [], type: '', bytes: Math.max(1, bytes), mtimeMs: 0 };
  const front = parseFrontmatter(head);
  const title = textOf(front.data.title) || firstHeading(front.body) || file;
  const summary = textOf(front.data.description) || textOf(front.data.summary) || firstSentence(front.body, REAL_LIMITS.noteChars);
  const tags = listOf(front.data.tags).map(t => plain(t, 30)).filter(t => t !== '').slice(0, 3);
  return {
    rel, folder, title: cut(plain(title, 4 * REAL_LIMITS.noteChars), REAL_LIMITS.noteChars), summary: cut(plain(summary, 4 * REAL_LIMITS.noteChars), REAL_LIMITS.noteChars),
    tags, type: plain(textOf(front.data.type), 30), bytes: Math.max(1, bytes), mtimeMs: 0,
  };
}

/** The harness folder a chosen place stands for, as a real folder, or null (a home place, a place that is gone, or one with no `.bowerloom` folder). */
function harnessFolderOf(place: RealPlace, home: string): string | null {
  if (place.kind === 'home') return null;
  const dir = folderOfShown(place.details.path, home);
  const real = dir === null ? null : realFolderFollowing(dir);
  return real === null || realFolder(join(real, '.bowerloom')) === null ? null : real;
}

/**
 * Adds the pages of the linked notes folders to a result, and the problems of the links that were not read to its harness places. The place's own notes are in the result already (the reader
 * made them). A set of notes of its own, "<place> linked notes", holds the linked pages. Nothing else of the result changes.
 */
function addLinkedNotesNow(result: RealResult, chosen: readonly RealPlace[], deps: LinkedDeps): RealResult {
  const harnessPlaces = result.harnessPlaces;
  if (harnessPlaces === undefined || harnessPlaces.length === 0) return result;
  const limits = deps.limits ?? REAL_LIMITS, budget = makeBudget(deps.now ?? (() => Date.now())), tally = newTally();
  const approvals = approvalsOf(deps.stateRoot);
  const byHarness = new Map<string, RealPlace>(chosen.map(p => [`${HARNESS_PREFIX}${shortHash(p.id)}`, p]));
  const wikiPages: WikiPage[] = [...result.world.wikiPages], slices: Slice[] = [...result.world.slices], items = [...result.world.items];
  const used = new Set(wikiPages.map(p => p.id));
  let added = 0, leftOut = 0;
  const updated: RealHarnessPlace[] = harnessPlaces.map(h => {
    const place = byHarness.get(h.id), rootReal = place === undefined ? null : harnessFolderOf(place, deps.home);
    if (place === undefined || rootReal === null) return h;
    const got = collectLinked(rootReal, deps.home, approvals, limits, budget, tally);
    leftOut += got.leftOut;
    const label = cleanLine(place.label).replace(/\//g, '-').slice(0, 60) || 'Notes', scopeId = `${SCOPE_PREFIX}${shortHash(place.id)}`;
    const pages: NoteEntry[] = [], folders = new Set<string>();
    for (const g of got.groups) {
      for (const f of g.files) {
        if (budget.expired()) { tally.stoppedEarly = true; break; }
        const rel = g.self ? f.rel : `${g.name}/${f.rel}`, source = shortHash(g.root.real);
        const note = noteOf(rel, f.size, readHead(f.abs, g.root.real, tally, budget));
        pages.push(note);
        folders.add(g.self ? label : `${label}/${g.name}`);
        const id0 = `real-page-${shortHash(`${place.id}\u0000${source}\u0000${note.rel}`)}`;
        let id = id0, n = 2;
        while (used.has(id)) { id = `${id0}-${n}`; n += 1; }
        used.add(id);
        wikiPages.push({ id, title: note.title === '' ? note.rel : note.title, folder: note.folder === '' ? label : `${label}/${note.folder}`, type: note.type === '' ? 'note' : note.type, tags: [...note.tags], summary: note.summary, bytes: note.bytes, links: [], joinedSinceVisit: false });
        added += 1;
      }
    }
    if (pages.length > 0) {
      const id = `linked-notes-${shortHash(place.id)}`, name = `${label} linked notes`;
      slices.push({ id, name, seeds: [], rule: { folders: [...folders], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, pinned: false });
      const item: ContextSliceItem = { id: `item-${id}`, kind: 'context-slice', name, scopeId, foundAt: [], library: null, sliceId: id };
      items.push(item);
    }
    const harness: RealHarness & { linkProblems?: readonly LinkProblem[] } = got.problems.length === 0 ? h.harness : { ...h.harness, linkProblems: got.problems };
    return { ...h, harness };
  });
  if (added === 0 && updated.every((u, i) => u === harnessPlaces[i]) && leftOut === 0) return result;
  const notes = leftOut > 0 ? [...result.notes, `${leftOut} linked notes pages are not shown.`] : result.notes;
  return { ...result, world: { ...result.world, wikiPages, slices, items }, counts: { ...result.counts, notes: result.counts.notes + added }, harnessPlaces: updated, notes, stoppedEarly: result.stoppedEarly || tally.stoppedEarly };
}

// ---------------------------------------------------------------------------------------------------------------------- the check

/** What the check of the saved read adds: for each watched place with a harness folder, its approvals, the links that fail, and the linked files under the same room as the read. */
function linkedWatchTextNow(home: string, watched: readonly { readonly id: string; readonly kind: RealPlace['kind']; readonly path: string }[], deps: Omit<LinkedDeps, 'home'>): { readonly text: string; readonly complete: boolean } {
  const limits = deps.limits ?? REAL_LIMITS, budget = makeBudget(deps.now ?? (() => Date.now())), tally = newTally();
  const approvals = approvalsOf(deps.stateRoot), lines: string[] = [];
  if (approvals.approved.size > 0 || approvals.damaged || approvals.blocked) lines.push(`approvals|${approvals.blocked ? 'blocked' : approvals.damaged ? 'damaged' : hashText([...approvals.approved].sort().join(','))}`);
  let complete = true;
  for (const w of [...watched].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (w.kind === 'home') continue;
    const dir = folderOfShown(w.path, home), rootReal = dir === null ? null : realFolderFollowing(dir);
    if (rootReal === null || realFolder(join(rootReal, '.bowerloom')) === null) continue;
    const got = collectLinked(rootReal, home, approvals, limits, budget, tally);
    lines.push(`place|${w.id}`);
    // A link that fails shows as a change of the place, and the check cannot say "same" while one cannot be resolved.
    for (const p of got.problems) {
      lines.push(`${p.reason === 'gone' ? 'gone|link' : `p|${p.reason}`}|${hashText(p.label).slice(0, 8)}`);
      if (p.reason === 'gone' || p.reason === 'form' || p.reason === 'unreadable') complete = false;
    }
    for (const g of got.groups) {
      const tag = hashText(g.root.real).slice(0, 8);
      for (const f of g.files) lines.push(`l|${tag}|${f.rel}|${f.size}|${f.mtimeMs}`);
      if (g.cut) lines.push(`l|${tag}|cut`);
    }
  }
  if (tally.stoppedEarly) complete = false;
  return { text: lines.join('\n'), complete };
}

/** The fingerprinter of the saved read with the linked notes folders added: the same answer as `base` when nothing linked changed, and never complete when `base` is not or a link cannot be resolved. */
export const withLinkedNotes = (base: Fingerprinter, deps: Omit<LinkedDeps, 'home'>): Fingerprinter => async (home, watched, now, budgetMs) => {
  const first = await base(home, watched, now, budgetMs), linked = linkedWatchText(home, watched, deps);
  return { fingerprint: linked.text === '' ? first.fingerprint : createHash('sha256').update(`${first.fingerprint}\n${linked.text}`).digest('hex'), complete: first.complete && linked.complete };
};

/**
 * Adds the linked notes to a result. Anything unexpected that is thrown while they are read leaves the result as the reader made it, and says so: each harness place gets an `unreadable` problem,
 * so a failure is never a silent loss of pages. The class of the error goes to the log, never its message, which can hold a path.
 */
export function addLinkedNotes(result: RealResult, chosen: readonly RealPlace[], deps: LinkedDeps): RealResult {
  try { return addLinkedNotesNow(result, chosen, deps); } catch (error) {
    console.error(`Bowerloom could not read the linked notes folders (${error instanceof Error ? error.constructor.name : typeof error}).`);
    const places = result.harnessPlaces;
    if (places === undefined || places.length === 0) return result;
    const problem: LinkProblem = { reason: 'unreadable', label: '' };
    return { ...result, harnessPlaces: places.map(h => ({ ...h, harness: { ...h.harness, linkProblems: [problem] } as RealHarness })) };
  }
}

/** The check of the linked notes folders for the saved read. An unexpected throw makes the check unresolved, so the saved read is never called "same" on a check that failed. */
export function linkedWatchText(home: string, watched: readonly { readonly id: string; readonly kind: RealPlace['kind']; readonly path: string }[], deps: Omit<LinkedDeps, 'home'>): { readonly text: string; readonly complete: boolean } {
  try { return linkedWatchTextNow(home, watched, deps); } catch (error) {
    console.error(`Bowerloom could not check the linked notes folders (${error instanceof Error ? error.constructor.name : typeof error}).`);
    return { text: 'linked|unreadable', complete: false };
  }
}
