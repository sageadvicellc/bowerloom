/**
 * The reader of a real setup. It finds places (tool folders under the home folder, work folders found by walking down from a folder the person picked), counts what each holds
 * (step one), and reads the names, descriptions and structure of the places the person selected (step two). It reads; it never writes, and it holds no key value.
 *
 * It knows nothing about any one person's folders. Where to look comes from the adapter table (shared/real/adapters.ts); where to start comes from the home folder it is
 * given and from the folders the person picks. The place ids it hands out are the only ones `read` accepts.
 */
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { ADAPTERS, adapterOf, appLabel, classify, recordsOfFile, walkEnter, walkPrune } from '../shared/real/adapters.js';
import type { ConfigKind } from '../shared/real/adapters.js';
import { firstHeading, firstSentence, parseFrontmatter } from '../shared/real/frontmatter.js';
import { countsOf, tallyWords, topicsOf } from '../shared/real/place.js';
import { APPROVALS_MAX_BYTES, approvalKey, parseApprovals } from '../shared/real/linked-approvals.js';
import type { NoteEntry, PlaceRead, StampedRecord } from '../shared/real/place.js';
import { cleanLine, cleanPath, cut, safeText } from '../shared/real/redact.js';
import { hashText } from '../shared/world/sample.js';
import { REAL_LIMITS } from '../shared/real/types.js';
import type { LinkProblem, RealApp, RealDiscovery, RealPlace, RealPlaceKind } from '../shared/real/types.js';
import { addTally, couldNotRead, isThere, listDir, makeBudget, miss, mustStop, newTally, readHead, readText, realFolder, realFolderFollowing, resolveInside, shortPath, statLine, walkFiles } from './real-fs.js';
import type { Budget, Tally, WalkOptions } from './real-fs.js';
import { textOf, listOf } from '../shared/real/yaml.js';
import { isPlainName } from './safe.js';
import type { RealHarness, RealHarnessPart } from '../shared/real/types.js';

/** Folders that are never entered while hunting for notes or work folders: dependencies, caches, build output, and the system's media folders. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'Library', 'Applications', 'Movies', 'Music', 'Pictures', '__pycache__', 'venv', '.venv', 'dist', 'build', 'target', '.next', '.cache', '.gradle', 'Pods', 'vendor',
  'coverage', '.turbo', 'out', '.nuxt', '.svelte-kit', 'site-packages', '.Trash', '.npm', '.cargo', '.rustup',
]);

interface FolderPart { readonly app: RealApp; readonly name: string; readonly abs: string }
interface FilePart { readonly app: RealApp; readonly name: string; readonly abs: string; readonly config: ConfigKind }

/** A place the reader knows, kept in the main process. The page only ever sees its id, label and counts. */
export interface PlaceInternal {
  readonly id: string;
  readonly kind: RealPlaceKind;
  readonly label: string;
  /** The folder as the person knows it (a path that may pass through a shortcut). It is for the label, the id and the path shown. */
  readonly root: string;
  /**
   * The real location of the folder, found when the place was discovered. Every later read must stay inside it, and it must still be where it was: a folder swapped
   * for a shortcut after discovery is not followed.
   */
  readonly realRoot: string;
  readonly folders: readonly FolderPart[];
  readonly files: readonly FilePart[];
}

export class RealRefusal extends Error {
  readonly code: 'BAD_ARGUMENT' | 'UNKNOWN_PLACE' | 'TOO_MANY' | 'BUSY' | 'NO_HOME';
  constructor(code: RealRefusal['code'], message: string) { super(message); this.code = code; }
}

const holdsSkillFile = (names: readonly string[]): boolean => names.some(n => n.toLowerCase() === 'skill.md');
/** A folder below a program's folder that sits under a skills root: `skills/..` or `skill/..`, or the same inside a Hermes profile (`profiles/<name>/skills/..`). Nothing else is a skill's home. */
const UNDER_SKILLS_ROOT = /^(?:profiles\/[^/]+\/)?skills?\/[^/]+(?:\/[^/]+)*$/i;
/**
 * A folder that holds a SKILL.md, below a skills root, is one skill: its subfolders are its own references and assets, and are not entered. A SKILL.md anywhere else (a Hermes
 * profile folder, a namespace folder of agents) marks nothing, so the folders below it are read as usual. The plug-in store is the exception (it is read for agents only).
 */
export const isSkillFolder = (names: readonly string[], rel: string): boolean => !rel.startsWith('plugins/') && UNDER_SKILLS_ROOT.test(rel) && holdsSkillFile(names);

const ALL_PROJECT_FOLDERS: ReadonlyMap<string, RealApp> = new Map(ADAPTERS.flatMap(a => a.projectFolders.map(f => [f, a.id] as const)));
const ALL_PROJECT_FILES: ReadonlyMap<string, { app: RealApp; config: ConfigKind }> = new Map(ADAPTERS.flatMap(a => a.projectFiles.map(f => [f.name, { app: a.id, config: f.config }] as const)));
const hasMarker = (names: readonly string[]): boolean => names.some(n => ALL_PROJECT_FOLDERS.has(n) || ALL_PROJECT_FILES.has(n));

const placeId = (kind: RealPlaceKind, root: string, apps: readonly string[]): string => `place-${hashText(`${kind}\u0000${root}\u0000${apps.join(',')}`).slice(0, 12)}`;
const labelOfFolder = (root: string): string => safeText(basename(root), 60) || 'This folder';
const yieldToLoop = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

// ---------------------------------------------------------------------------------------------------------------------- finding places

/** The places under the home folder: one for each program that has a folder or a file there. */
export function findHomePlaces(home: string): PlaceInternal[] {
  const out: PlaceInternal[] = [];
  const realRoot = realFolderFollowing(home) ?? home;
  for (const adapter of ADAPTERS) {
    const folders: FolderPart[] = [], files: FilePart[] = [];
    for (const name of adapter.homeFolders) { const real = realFolderFollowing(join(home, name)); if (real !== null) folders.push({ app: adapter.id, name, abs: real }); }
    for (const f of adapter.homeFiles) { const abs = join(home, f.path); if (isThere(abs)) files.push({ app: adapter.id, name: f.path, abs, config: f.config }); }
    if (folders.length === 0 && files.length === 0) continue;
    out.push({ id: placeId('home', home, [adapter.id]), kind: 'home', label: `${adapter.label} at home`, root: home, realRoot, folders, files });
  }
  return out;
}

/** The tool folders and config files of a program that sit directly in a folder, named from `real` (where the folder really is). A shortcut is followed only when it stays inside `rootReal`. */
function partsIn(real: string, list: ReturnType<typeof listDir>, rootReal: string, tally: Tally): { folders: FolderPart[]; files: FilePart[] } {
  const folders: FolderPart[] = [], files: FilePart[] = [];
  for (const e of list) {
    const folderApp = ALL_PROJECT_FOLDERS.get(e.name), fileApp = ALL_PROJECT_FILES.get(e.name);
    if (folderApp !== undefined) {
      const child = join(real, e.name);
      let found: string | null = null;
      if (e.isDirectory()) found = child;
      else if (e.isSymbolicLink()) { const r = resolveInside(child, rootReal, tally); found = r !== null && r.stat.isDirectory() ? r.real : null; }
      if (found !== null) folders.push({ app: folderApp, name: e.name, abs: found });
    } else if (fileApp !== undefined && (e.isFile() || e.isSymbolicLink())) files.push({ app: fileApp.app, name: e.name, abs: join(real, e.name), config: fileApp.config });
  }
  return { folders, files };
}

/**
 * The places in a folder the person picked: the folder itself, and every folder below it (to the depth cap) that holds a tool folder or a config file of a known
 * program. A shortcut is followed only when it stays inside the picked folder. The home folder's own tool folders belong to the home places, so they are not taken again.
 */
export function findPlacesUnder(dir: string, home: string, budget: Budget, tally: Tally): PlaceInternal[] {
  const rootReal = realFolderFollowing(dir);
  if (rootReal === null) { tally.unreadable += 1; return []; }
  const homeReal = realFolderFollowing(home);
  const found: PlaceInternal[] = [];
  const seen = new Set<string>([rootReal]);
  let entries = 0, stop = false;
  const visit = (real: string, display: string, depth: number): void => {
    if (stop) return;
    if (budget.expired()) { tally.stoppedEarly = true; stop = true; return; }
    const list = listDir(real, tally, REAL_LIMITS.discoveryEntries - entries + 1, rootReal);
    const isRoot = depth === 0;
    const atHome = homeReal !== null && real === homeReal;
    const { folders, files } = atHome ? { folders: [], files: [] } : partsIn(real, list, rootReal, tally);
    if (isRoot || folders.length > 0 || files.length > 0) {
      if (found.length >= REAL_LIMITS.places) { tally.truncated = true; stop = true; return; }
      const kind: RealPlaceKind = isRoot ? 'picked' : 'project';
      found.push({ id: placeId(kind, display, [...folders, ...files].map(p => p.app)), kind, label: labelOfFolder(display), root: display, realRoot: real, folders, files });
    }
    for (const e of list) {
      if (stop) return;
      if (budget.expired()) { tally.stoppedEarly = true; stop = true; return; }
      entries += 1;
      if (entries > REAL_LIMITS.discoveryEntries) { tally.truncated = true; stop = true; return; }
      if (!isPlainName(e.name)) { miss(tally, 'unreadable', rootReal, join(real, e.name)); continue; }
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name) || ALL_PROJECT_FOLDERS.has(e.name)) continue;
      const child = join(real, e.name);
      let childReal = child, isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        const r = resolveInside(child, rootReal, tally);
        if (r === null || !r.stat.isDirectory()) continue;
        childReal = r.real; isDir = true;
      }
      if (!isDir) continue;
      if (depth + 1 > REAL_LIMITS.depth) { tally.truncated = true; continue; }
      if (seen.has(childReal)) continue;
      seen.add(childReal);
      visit(childReal, join(display, e.name), depth + 1);
    }
  };
  visit(rootReal, rootReal, 0);
  // Two work folders with one name are told apart by the folder that holds them.
  const names = new Map<string, number>();
  for (const p of found) names.set(p.label, (names.get(p.label) ?? 0) + 1);
  return found.map(p => ((names.get(p.label) ?? 0) > 1 ? { ...p, label: `${p.label} (${labelOfFolder(dirname(p.root))})`.slice(0, 80) } : p));
}

// ---------------------------------------------------------------------------------------------------------------------- reading a place

const MARKDOWN = /\.(?:md|markdown)$/i;

function stamp(records: readonly ReturnType<typeof recordsOfFile>['records'][number][], mtimeMs: number): StampedRecord[] {
  return records.map(r => ({ ...r, mtimeMs }));
}

function noteOf(rawRel: string, bytes: number, mtimeMs: number, head: string | null): NoteEntry {
  const rel = cleanPath(rawRel), slash = rel.lastIndexOf('/'), folder = slash < 0 ? '' : rel.slice(0, slash), file = rel.slice(slash + 1).replace(/\.[^.]+$/, '');
  // Everything a note hands to the page is scrubbed first: a title or a summary can hold a key as easily as a skill can.
  const plain = (text: string, max: number): string => safeText(text, max);
  if (head === null) return { rel, folder, title: plain(file, REAL_LIMITS.noteChars), summary: '', tags: [], type: '', bytes: Math.max(1, bytes), mtimeMs };
  const front = parseFrontmatter(head);
  const title = textOf(front.data.title) || firstHeading(front.body) || file;
  const summary = textOf(front.data.description) || textOf(front.data.summary) || firstSentence(front.body, REAL_LIMITS.noteChars);
  const tags = listOf(front.data.tags).map(t => plain(t, 30)).filter(t => t !== '').slice(0, 3);
  return { rel, folder, title: cut(plain(title, 4 * REAL_LIMITS.noteChars), REAL_LIMITS.noteChars), summary: cut(plain(summary, 4 * REAL_LIMITS.noteChars), REAL_LIMITS.noteChars), tags, type: plain(textOf(front.data.type), 30), bytes: Math.max(1, bytes), mtimeMs };
}

/** The most entries one list of a harness (connections, hooks, notes sources, agent files) may hold for the Overview. A longer list is a harness the reader could not read. */
export const HARNESS_LIST_MAX = 200;
/** The most parts one harness may show, and the most entries of its `agents` folder the reader looks at (of any kind), and the most bytes of its files the reader spends. Over any of them the harness is unreadable. */
export const HARNESS_PARTS_MAX = 1000, HARNESS_DIR_MAX = 1000, HARNESS_BYTES_MAX = 2 * 1024 * 1024;

/**
 * What the reader sees of a folder's `.bowerloom` (read only: plain bounded JSON through the reader's own file reads; nothing is written and a link is never followed). Null when the
 * folder has no `harness.json`. The engines come from `harness.json`, the connections from `mcp.json`, the hooks from `hooks.json` and the notes sources from `knowledge.json`; the
 * skills are the records the reader already found in the folder, and the agents are the plain markdown files of `agents/`. A command, an argument, an env or header value, a url or a
 * path is never kept, and a part id is its kind and a number, never a name. A file that is not valid JSON, has the wrong shape, repeats a name, is over a limit (200 entries in a list,
 * 1,000 parts, 2 MiB of files for the folder) or cannot be read makes `readable: false` with no part. That is all "unreadable" means: the full rules of the harness loader are not checked here.
 */
export function harnessOf(dir: string, records: readonly StampedRecord[], tally: Tally, budget: Budget): RealHarness | null {
  if (!isThere(join(dir, 'harness.json'))) return null;
  const none = unreadableHarness();
  let spent = 0;
  const read = (abs: string): string => {
    const got = readText(abs, dir, tally, budget);
    if (got === null) throw new Error('unreadable');
    spent += got.length;
    if (spent > HARNESS_BYTES_MAX) throw new Error('limit');
    return got;
  };
  const json = (name: string, required: boolean): unknown => (!required && !isThere(join(dir, name)) ? undefined : JSON.parse(read(join(dir, name))) as unknown);
  const object = (value: unknown): Record<string, unknown> => { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('shape'); return value as Record<string, unknown>; };
  const list = (value: unknown): readonly unknown[] => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > HARNESS_LIST_MAX) throw new Error('shape'); return value; };
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  /** The names of a list, each used once (as the loader requires). */
  const named = (items: readonly unknown[], key: string): string[] => {
    const seen = new Set<string>(), out: string[] = [];
    // An entry with no name, or a name that is not text, makes the file unreadable: the Library says so for the folder, and never drops the entry without a word.
    // A name that shows as nothing once its invisible characters are taken out counts as no name.
    for (const item of items) { const raw = text(object(item)[key]); if (raw === '' || safeText(raw, 80) === '') throw new Error('shape'); if (seen.has(raw)) throw new Error('twice'); seen.add(raw); out.push(raw); }
    return out;
  };
  try {
    const head = object(json('harness.json', true));
    // An engine with no id (or one that shows as nothing) makes the file unreadable: the Library says so for the folder, and the entry is never dropped without a word.
    const engines = list(head.engines).map(e => safeText(text(object(e).id), 40)).map(id => { if (id === '') throw new Error('shape'); return ADAPTERS.find(a => a.id === id)?.label ?? id; });
    const parts: RealHarnessPart[] = [], links: { from: string; to: string }[] = [];
    const count: Record<string, number> = {};
    const idOf = (kind: string): string => { count[kind] = (count[kind] ?? 0) + 1; return `harness-${kind}-${count[kind]}`; };
    const skillIds = new Map<string, string>();
    for (const r of records.filter(x => x.app === 'bowerloom' && x.kind === 'skill')) {
      const id = idOf('skill'); skillIds.set(r.slug, id);
      parts.push({ id, kind: 'skill', name: safeText(r.name, 80) || safeText(r.slug, 80), summary: summaryOf(r.description, 'A skill.'), ...(r.text === '' ? {} : { contentHash: hashText(r.text) }) });
    }
    const knowledge = json('knowledge.json', false);
    if (knowledge !== undefined) for (const name of named(list(object(knowledge).sources), 'name')) parts.push({ id: idOf('notes'), kind: 'context', name: safeText(name, 80), summary: 'A set of notes.' });
    const mcp = json('mcp.json', false);
    if (mcp !== undefined) for (const name of named(list(object(mcp).servers), 'name')) parts.push({ id: idOf('mcp'), kind: 'tool', name: safeText(name, 80), summary: 'A connection.', toolKind: 'mcp' });
    const hooks = json('hooks.json', false);
    if (hooks !== undefined) for (const name of named(list(object(hooks).hooks), 'id')) parts.push({ id: idOf('hook'), kind: 'tool', name: safeText(name, 80), summary: 'Runs on its own.', toolKind: 'hook' });
    // The agents are the plain markdown files of `agents/`: the reader finds no agent in this folder by itself. A folder of more than HARNESS_DIR_MAX entries is not looked through.
    const entries = realFolder(join(dir, 'agents')) !== null ? listDir(join(dir, 'agents'), tally, HARNESS_DIR_MAX + 1, dir) : [];
    if (entries.length > HARNESS_DIR_MAX) throw new Error('limit');
    const agentFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
    if (agentFiles.length > HARNESS_LIST_MAX) throw new Error('limit');
    for (const f of agentFiles) {
      const slug = f.name.slice(0, -3), data = parseFrontmatter(read(join(dir, 'agents', f.name))).data, id = idOf('agent');
      parts.push({ id, kind: 'agent', name: safeText(textOf(data.name), 80) || safeText(slug, 80), summary: summaryOf(textOf(data.description), 'An agent.') });
      for (const k of listOf(data.skills)) { const to = skillIds.get(k); if (to !== undefined) links.push({ from: id, to }); }
    }
    if (parts.length > HARNESS_PARTS_MAX) throw new Error('limit');
    return { readable: true, engines, parts, links };
  } catch (error) {
    // The known ways a harness is unreadable: bad JSON, the wrong shape, a name used twice, a limit, a file that cannot be read. Anything else is a fault of Bowerloom or of
    // the disk: it is still shown as unreadable, and the log names its class and code (never a path) so it is not lost.
    if (error instanceof SyntaxError || (error instanceof Error && error.constructor === Error && KNOWN_UNREADABLE.has(error.message))) return none;
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`Bowerloom: the reader met an error it does not know while it read a harness (${error instanceof Error ? error.constructor.name : typeof error}${typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? `, ${code}` : ''}).`);
    return none;
  }
}
/** The messages of the errors `harnessOf` throws on purpose. */
const KNOWN_UNREADABLE: ReadonlySet<string> = new Set(['shape', 'limit', 'twice', 'unreadable']);
/** A harness that is there and cannot be read. */
export const unreadableHarness = (): RealHarness => ({ readable: false, engines: [], parts: [], links: [] });
const summaryOf = (description: string, fallback: string): string => {
  const line = safeText(description, 200), at = line.search(/[.!?](?=\s|$)/), one = cut(at < 0 ? line : line.slice(0, at + 1), 40);
  return one === '' ? fallback : one;
};

/** How the reader walks one tool folder. The fingerprint of a read (`fingerprintOf`) walks it the same way, so the two cannot disagree about which files count. */
function folderWalk(folder: FolderPart, maxFiles: number): WalkOptions {
  const adapter = adapterOf(folder.app);
  // Only the top-level folders that can hold something are entered (`walkRoots`), and a skill folder is a leaf. What is left out on purpose never marks the place as partly read.
  return {
    maxDepth: REAL_LIMITS.depth, maxFiles, maxEntries: REAL_LIMITS.discoveryEntries, skipDirs: new Set(adapter.skipInside), skipHidden: false,
    accept: rel => classify(folder.app, rel) !== null, enter: rel => walkEnter(folder.app, rel), prune: rel => walkPrune(folder.app, rel),
    ...(adapter.walkRoots === undefined ? {} : { rootDirs: new Set(adapter.walkRoots) }), leafWhen: isSkillFolder, nestedWhen: holdsSkillFile,
  };
}

/** How the reader walks a work or picked folder for notes pages. */
const notesWalk = (linked = false): WalkOptions => ({
  maxDepth: REAL_LIMITS.depth, maxFiles: REAL_LIMITS.filesPerPlace, maxEntries: REAL_LIMITS.discoveryEntries, skipDirs: new Set([...SKIP_DIRS, ...ALL_PROJECT_FOLDERS.keys()]), skipHidden: true,
  // The automatic walk stops at a work folder, which is a place of its own. A notes folder the person linked is read whole: a subfolder that holds a tool folder is still notes.
  accept: rel => MARKDOWN.test(rel), ...(linked ? {} : { boundary: hasMarker }),
});

/** The most notes folders one harness may link. A longer list is read up to this many, and the rest is a problem the Library says. */
export const LINKED_NOTES_MAX = 8;

/** What the reader needs besides the place: the approvals of this machine, and the caps (a test lowers them). */
export interface LinkContext {
  readonly approved: ReadonlySet<string>;
  /** True when the approval record is there and damaged: a home link then says so, and is not read. */
  readonly damaged?: boolean;
  readonly limits?: { readonly filesPerPlace: number; readonly pagesPerPlace: number };
}
export const NO_LINK_CONTEXT: LinkContext = Object.freeze({ approved: new Set<string>() });

/** Loads the approval record. No record holds no approval. A record that is a link, is not a plain file, is too big or is damaged holds none either, and is told as damaged. */
export function loadApprovals(file: string | undefined, budget: Budget, tally: Tally): { readonly approved: ReadonlySet<string>; readonly damaged: boolean } {
  const none = { approved: new Set<string>(), damaged: false };
  if (file === undefined || !isThere(file)) return none;
  const damaged = { approved: new Set<string>(), damaged: true };
  const dir = realFolder(dirname(file));
  if (dir === null) return damaged;
  const text = readText(join(dir, basename(file)), dir, tally, budget);
  if (text === null || text.length > APPROVALS_MAX_BYTES) return damaged;
  const keys = parseApprovals(text);
  return keys === null ? damaged : { approved: keys, damaged: false };
}

const STORED_ODD = /[\0-\x1f\x7f\\`]/;
/** The rule of `isKnowledgePath` in the harness package: `.`, a plain relative path, or `~/` and a plain relative path. A plain path has no empty, `.`, `..` or hidden segment. */
function isStoredPath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || [...value].length > 1024 || STORED_ODD.test(value) || /^[A-Za-z]:/.test(value)) return false;
  const plain = (rest: string): boolean => rest.split('/').every(seg => seg !== '' && !seg.startsWith('.'));
  if (value === '.') return true;
  if (value.startsWith('~/')) return plain(value.slice(2));
  if (value.startsWith('/') || value.startsWith('~')) return false;
  return plain(value);
}

type Stored = { readonly ok: true; readonly real: string } | { readonly ok: false; readonly why: 'form' | 'gone' };

/**
 * The folder a stored notes path names. A path that is not a stored form is `form`. A folder that is not there is `gone`. A folder that, once its shortcuts are resolved, is not below its
 * base (the harness folder, or the home folder), is the home folder itself, or has a hidden part below the base is `form` too: a shortcut such as `~/notes` to `~/.ssh` is no notes folder.
 */
function resolveStored(stored: unknown, rootReal: string, home: string): Stored {
  if (!isStoredPath(stored)) return { ok: false, why: 'form' };
  const homeBased = stored.startsWith('~/');
  const base = homeBased ? realFolderFollowing(home) : rootReal;
  if (base === null) return { ok: false, why: 'gone' };
  const real = realFolderFollowing(stored === '.' ? base : join(base, homeBased ? stored.slice(2) : stored));
  if (real === null) return { ok: false, why: 'gone' };
  const inside = relative(base, real);
  if (inside.startsWith('..') || isAbsolute(inside)) return { ok: false, why: 'form' };
  if (inside === '' ? homeBased : inside.split(sep).some(part => part.startsWith('.'))) return { ok: false, why: 'form' };
  return { ok: true, real };
}

const shortHash = (text: string): string => hashText(text).slice(0, 8);
/** The name each linked folder's pages carry in front of their path: the folder's own name, and a short hash after it when two folders share the name. */
function linkedNames(roots: readonly LinkedRoot[]): string[] {
  const base = roots.map(r => basename(r.real));
  return base.map((b, i) => (base.indexOf(b) === i && base.lastIndexOf(b) === i ? b : `${b}-${shortHash(roots[i]!.real).slice(0, 4)}`));
}

export interface LinkedRoot { readonly real: string; readonly stored: string }
export interface LinkedNotes { readonly roots: readonly LinkedRoot[]; readonly problems: readonly LinkProblem[] }

/**
 * The notes folders the person linked to the harness of a place, by the stored path `knowledge.json` keeps (`wiki-folder`), and what could not be read, each with its reason. Nothing is
 * searched for. A link below the harness folder is part of the project. A link in `~/` form is read only when this machine holds the person's approval for that folder and path
 * (`ctx.approved`): `knowledge.json` can come from a cloned repository. A root inside another root is left out, because the outer one reads it. Nothing is dropped without a problem.
 */
export function linkedNotesRoots(place: PlaceInternal, home: string, ctx: LinkContext, budget: Budget, tally: Tally): LinkedNotes {
  const own = place.kind === 'home' ? undefined : place.folders.find(f => f.app === 'bowerloom');
  if (own === undefined || realFolderFollowing(own.abs) !== own.abs) return { roots: [], problems: [] };
  const file = join(own.abs, 'knowledge.json');
  if (!isThere(file)) return { roots: [], problems: [] };
  const text = readText(file, own.abs, tally, budget);
  if (text === null) return { roots: [], problems: [{ reason: 'unreadable', label: '' }] };
  let sources: unknown;
  try { sources = (JSON.parse(text) as { sources?: unknown } | null)?.sources; } catch { return { roots: [], problems: [{ reason: 'unreadable', label: '' }] }; }
  if (sources === undefined) return { roots: [], problems: [] };
  if (!Array.isArray(sources)) return { roots: [], problems: [{ reason: 'unreadable', label: '' }] };
  const roots: LinkedRoot[] = [], problems: LinkProblem[] = [];
  const label = (stored: unknown): string => (typeof stored === 'string' ? safeText(stored, 60) : '');
  // Only the wiki folders count, and only then are they cut at the list limit.
  const links = sources.filter(x => (x as { kind?: unknown } | null)?.kind === 'wiki-folder').slice(0, HARNESS_LIST_MAX) as { path?: unknown }[];
  for (const link of links) {
    if (roots.length >= LINKED_NOTES_MAX) { problems.push({ reason: 'limit', label: label(link.path) }); continue; }
    const got = resolveStored(link.path, place.realRoot, home);
    if (!got.ok) { problems.push({ reason: got.why === 'gone' ? 'gone' : 'form', label: label(link.path) }); continue; }
    const stored = link.path as string;
    if (stored.startsWith('~/') && !ctx.approved.has(approvalKey(place.realRoot, stored, got.real))) { problems.push({ reason: ctx.damaged === true ? 'damaged' : 'approval', label: label(stored) }); continue; }
    if (roots.some(r => r.real === got.real)) continue;
    roots.push({ real: got.real, stored });
  }
  // A root inside another root is read by the outer one.
  const inside = (a: string, b: string): boolean => a !== b && !relative(b, a).startsWith('..') && !isAbsolute(relative(b, a));
  return { roots: roots.filter(r => !roots.some(o => inside(r.real, o.real))), problems };
}

/**
 * Reads one place. `withText` false is step one: skills, agents and prompts are found by their paths and their files are not opened; only config files are opened, and only
 * their structure is kept. `withText` true is step two, after the person confirmed: the text of skills, agents and prompts is read too, and the head of each notes page.
 */
export function readPlace(place: PlaceInternal, home: string, withText: boolean, budget: Budget, link: LinkContext = NO_LINK_CONTEXT): PlaceRead {
  const tally = newTally();
  const records: StampedRecord[] = [], notes: NoteEntry[] = [];
  let partlyRead = 0, filesLeft = REAL_LIMITS.filesPerPlace, notesLeftOut = 0;
  let linkProblems: LinkProblem[] = [];
  // Every read in this function is held to the real folder that was recorded when the place was discovered (`place.realRoot`, or the real tool folder).
  folders: for (const folder of place.folders) {
    if (mustStop(budget, tally)) break;
    if (realFolderFollowing(folder.abs) !== folder.abs) { tally.unreadable += 1; continue; }
    // Only the top-level folders that can hold something are entered (`walkRoots`), and a skill folder is a leaf. What is left out on purpose never marks the place as partly read.
    const files = walkFiles(folder.abs, folder.abs, folderWalk(folder, filesLeft), budget, tally);
    filesLeft -= files.length;
    for (const f of files) {
      if (mustStop(budget, tally)) break folders;
      const role = classify(folder.app, f.rel);
      if (role === null) continue;
      const relPath = `${folder.name}/${f.rel}`;
      if (role.what === 'note') { notes.push(noteOf(f.rel.replace(/^profiles\/[^/]+\//, ''), f.size, f.mtimeMs, withText ? readHead(f.abs, folder.abs, tally, budget) : null)); continue; }
      const text = role.what === 'config' || withText ? readText(f.abs, folder.abs, tally, budget) : null;
      if ((role.what === 'config' || withText) && text === null) continue;
      const result = recordsOfFile(folder.app, role, relPath, f.rel, text);
      if (result.unreadable) miss(tally, 'unreadable', folder.abs, f.abs);
      if (result.partial) partlyRead += 1;
      records.push(...stamp(result.records, f.mtimeMs));
    }
  }
  for (const file of place.files) {
    if (mustStop(budget, tally)) break;
    const role = { what: 'config', config: file.config } as const;
    const text = readText(file.abs, place.realRoot, tally, budget);
    if (text === null) continue;
    const result = recordsOfFile(file.app, role, file.name, file.name, text);
    if (result.unreadable) miss(tally, 'unreadable', place.realRoot, file.abs);
    records.push(...stamp(result.records, 0));
  }
  if (place.kind !== 'home' && !mustStop(budget, tally)) {
    const rootReal = place.realRoot;
    if (realFolderFollowing(rootReal) !== rootReal) tally.unreadable += 1;
    else {
      // A place whose own folder is the linked notes folder is read whole too: the person picked it as notes.
      const found = linkedNotesRoots(place, home, link, budget, tally);
      linkProblems = [...found.problems];
      const limits = link.limits ?? REAL_LIMITS;
      const walked = walkFiles(rootReal, rootReal, { ...notesWalk(found.roots.some(r => r.real === rootReal)), maxFiles: limits.filesPerPlace }, budget, tally);
      const shown = withText ? walked.slice(0, limits.pagesPerPlace) : walked;
      let added = 0;
      for (const f of shown) {
        if (withText && mustStop(budget, tally)) break;
        notes.push(noteOf(f.rel, f.size, f.mtimeMs, withText ? readHead(f.abs, rootReal, tally, budget) : null));
        added += 1;
      }
      notesLeftOut = walked.length - added;
      // The notes folders the person linked, under the same caps as the place's own notes: what the place's walk used is not left to them.
      const have = new Set(walked.map(f => f.abs));
      let room = limits.filesPerPlace - walked.length, pageRoom = limits.pagesPerPlace - added;
      const others = found.roots.filter(r => r.real !== rootReal);
      const names = linkedNames(others);
      for (const [n, root] of others.entries()) {
        if (mustStop(budget, tally)) break;
        // No room is left: the folder is not walked, and the Library is told.
        if (room <= 0) { linkProblems.push({ reason: 'limit', label: safeText(root.stored, 60) }); continue; }
        // One file more than the room is asked for, so a folder that does not fit is known to be cut.
        const walkedMore = walkFiles(root.real, root.real, { ...notesWalk(true), maxFiles: room + 1 }, budget, tally);
        const cut = walkedMore.length > room;
        const more = walkedMore.slice(0, room).filter(f => !have.has(f.abs));
        for (const f of walkedMore) have.add(f.abs);
        room -= more.length;
        if (cut) { notesLeftOut += 1; linkProblems.push({ reason: 'limit', label: safeText(root.stored, 60) }); }
        const take = withText ? more.slice(0, Math.max(pageRoom, 0)) : more;
        const source = shortHash(root.real);
        for (const f of take) {
          if (withText && mustStop(budget, tally)) break;
          notes.push({ ...noteOf(`${names[n]}/${f.rel}`, f.size, f.mtimeMs, withText ? readHead(f.abs, root.real, tally, budget) : null), source });
          added += 1; pageRoom -= 1;
        }
        notesLeftOut += more.length - take.length;
      }
    }
  }
  const apps = [...new Set([...place.folders.map(p => p.app), ...place.files.map(p => p.app)])];
  const own = withText && place.kind !== 'home' ? place.folders.find(p => p.app === 'bowerloom') : undefined;
  // A `.bowerloom` that is a link, or that is not the folder found at the start, is unreadable: it is never shown as "no harness here".
  const ownChanged = own !== undefined && (realFolder(join(place.realRoot, own.name)) === null || realFolderFollowing(own.abs) !== own.abs);
  const harness = own === undefined ? null : ownChanged ? unreadableHarness() : harnessOf(own.abs, records, tally, budget);
  const names = [...place.folders.map(p => p.name), ...place.files.map(p => p.name)];
  return { place: { id: place.id, kind: place.kind, label: place.label, path: shortPath(place.root, home), apps }, records, notes, notesLeftOut, partlyRead, ...(harness === null ? {} : { harness: linkProblems.length > 0 ? { ...harness, linkProblems } : harness }), folders: names, tally };
}

/** The step-one entry for a place: counts and details, no text. */
export function summarise(place: PlaceInternal, home: string, budget: Budget, link: LinkContext = NO_LINK_CONTEXT): { place: RealPlace; tally: Tally } {
  const read = readPlace(place, home, false, budget, link);
  const counts = countsOf(read.records, read.notes.length + read.notesLeftOut);
  const labels = read.place.apps.map(appLabel);
  const empty = counts.agents + counts.skills + counts.tools + counts.hooks + counts.notes === 0;
  const words = tallyWords(read.tally);
  const tally = newTally();
  addTally(tally, read.tally as Tally);
  return {
    tally,
    place: {
      id: place.id, label: place.label, kind: place.kind, apps: labels, appLabel: labels.length === 0 ? 'Notes' : labels.join(', '), counts, empty,
      details: { path: read.place.path, folders: read.folders, topics: topicsOf(read.notes), notes: empty ? ['Nothing was found here.', ...words] : words },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------- the fingerprint of a read

/** A place a person ticked, as the window holds it: only the three things the fingerprint needs. `path` is the one the window shows (`~` for the home folder). */
export interface WatchedPlace { readonly id: string; readonly kind: RealPlaceKind; readonly path: string }

/** The folder a shown path names: `~` and `~/..` are below the home folder, an absolute path is itself, anything else is nothing. */
function folderOfShown(path: string, home: string): string | null {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return isAbsolute(path) && !path.includes('\u0000') ? path : null;
}

/**
 * The place a work or picked folder is, built from its path alone (its tool folders and config files, not the work folders below it). Null when the folder is not there. `unresolved` is
 * true when something the first read could take could not be taken from here: a tool folder that is a link (the first read allowed one that stays inside the picked folder, but only
 * the project is known here), or a folder that would not list.
 */
function placeAt(dir: string, home: string, kind: RealPlaceKind): { readonly place: PlaceInternal; readonly unresolved: boolean } | null {
  const real = realFolderFollowing(dir);
  if (real === null) return null;
  const tally = newTally();
  const homeReal = realFolderFollowing(home);
  const { folders, files } = homeReal !== null && real === homeReal ? { folders: [], files: [] } : partsIn(real, listDir(real, tally, REAL_LIMITS.discoveryEntries + 1, real), real, tally);
  const place: PlaceInternal = { id: placeId(kind, dir, [...folders, ...files].map(p => p.app)), kind, label: labelOfFolder(dir), root: dir, realRoot: real, folders, files };
  return { place, unresolved: tally.linksOutside + tally.brokenLinks + tally.unreadable > 0 };
}

/**
 * Whether another entry beside any part of this path is shown with the same name. The window's path is cleaned (spaces collapsed or trimmed, a long part cut, a key-like part hidden),
 * so `trailing ` and `trailing` are both shown as `trailing`: a path rebuilt from it may name the neighbour, and the neighbour's files would be taken for the folder's own. The parts are
 * checked from the home folder down (from the root for a path outside it). `listed` keeps what a folder showed, for the other places of one walk.
 */
function pathIsAmbiguous(dir: string, home: string, listed: Map<string, Map<string, number>>): boolean {
  const base = dir.startsWith(home + sep) ? home : sep, parts = relative(base, dir).split(sep).filter(x => x !== '');
  let at = base;
  for (const part of parts) {
    let shownCounts = listed.get(at);
    if (shownCounts === undefined) {
      const lost = newTally(), list = listDir(at, lost, AMBIGUITY_ENTRIES + 1);
      // A folder too big to list whole, or one that will not list, cannot be told apart from its neighbours.
      if (list.length > AMBIGUITY_ENTRIES || lost.unreadable > 0) return true;
      shownCounts = new Map<string, number>();
      for (const e of list) { const shown = shortPath(join(at, e.name), home); shownCounts.set(shown, (shownCounts.get(shown) ?? 0) + 1); }
      listed.set(at, shownCounts);
    }
    if ((shownCounts.get(shortPath(join(at, part), home)) ?? 0) > 1) return true;
    at = join(at, part);
  }
  return false;
}
/** The most entries of one folder that are listed to tell a name from its neighbours. */
const AMBIGUITY_ENTRIES = 20000;

/** The files of a `.bowerloom` folder that the harness loader opens (`harnessOf`). The reader lists no part for them, so the walk does not see them: the fingerprint names them. */
const HARNESS_FILES: readonly string[] = ['harness.json', 'mcp.json', 'hooks.json', 'knowledge.json'];

/** What the reader keeps from a config file, as text: the kinds, names and facts of its entries, and nothing else. Null when the file cannot be read or understood. */
function keptOf(app: RealApp, config: ConfigKind, name: string, abs: string, containReal: string, budget: Budget, tally: Tally): string | null {
  const text = readText(abs, containReal, tally, budget);
  if (text === null) return null;
  const found = recordsOfFile(app, { what: 'config', config }, name, name, text);
  return found.unreadable ? null : found.records.map(r => JSON.stringify([r.kind, r.name, r.slug, r.description, r.meta])).sort().join(';');
}

/**
 * One line for each file the reader would list in a place, with its size and change time, and one for each tool folder or config file that is gone. `flags.unresolved` is set when a file
 * that must be read could not be. A config file that a program rewrites during any session (`~/.claude.json`, and `settings.local.json`, which holds the permissions a person approves)
 * counts by what the reader keeps from it, so a new connection or hook shows and the rest does not. The four files of a `.bowerloom` folder count by size and change time.
 */
function watchLines(place: PlaceInternal, home: string, budget: Budget, tally: Tally, flags: { unresolved: boolean }, link: LinkContext): string[] {
  const out: string[] = [];
  const kept = (app: RealApp, config: ConfigKind, name: string, abs: string, contain: string): string => {
    const text = keptOf(app, config, name, abs, contain, budget, tally);
    if (text === null) { flags.unresolved = true; return 'unreadable'; }
    return text;
  };
  for (const folder of place.folders) {
    if (realFolderFollowing(folder.abs) !== folder.abs) { out.push(`gone|${folder.name}`); continue; }
    for (const f of walkFiles(folder.abs, folder.abs, folderWalk(folder, REAL_LIMITS.filesPerPlace), budget, tally)) {
      const role = f.rel === 'settings.local.json' ? classify(folder.app, f.rel) : null;
      out.push(role !== null && role.what === 'config' ? `k|${folder.name}/${f.rel}|${kept(folder.app, role.config, f.rel, f.abs, folder.abs)}` : `f|${folder.name}/${f.rel}|${f.size}|${f.mtimeMs}`);
    }
    if (folder.app === 'bowerloom') for (const name of HARNESS_FILES) out.push(`b|${name}|${statLine(join(folder.abs, name)) ?? 'gone'}`);
  }
  for (const file of place.files) {
    const stat = statLine(file.abs);
    out.push(stat === null ? `h|${file.name}|gone` : place.kind === 'home' ? `h|${file.name}|${kept(file.app, file.config, file.name, file.abs, place.realRoot)}` : `h|${file.name}|${stat}`);
  }
  if (place.kind !== 'home') {
    if (realFolderFollowing(place.realRoot) !== place.realRoot) out.push('gone|root');
    else {
      const found = linkedNotesRoots(place, home, link, budget, tally), limits = link.limits ?? REAL_LIMITS;
      const walked = walkFiles(place.realRoot, place.realRoot, { ...notesWalk(found.roots.some(r => r.real === place.realRoot)), maxFiles: limits.filesPerPlace }, budget, tally);
      for (const f of walked) out.push(`n|${f.rel}|${f.size}|${f.mtimeMs}`);
      // A link that fails shows as a change of the place, and the check cannot say "same" while one cannot be resolved.
      for (const problem of found.problems) {
        out.push(`${problem.reason === 'gone' ? 'gone|link' : `p|${problem.reason}`}|${hashText(problem.label).slice(0, 8)}`);
        if (problem.reason === 'gone' || problem.reason === 'form' || problem.reason === 'unreadable') flags.unresolved = true;
      }
      // A linked notes folder is read the same way, under the same room as a read, so a change past the cap does not change the fingerprint.
      const have = new Set(walked.map(f => f.abs));
      let room = limits.filesPerPlace - walked.length;
      for (const root of found.roots.filter(r => r.real !== place.realRoot)) {
        const tag = hashText(root.real).slice(0, 8);
        if (room <= 0) { out.push(`l|${tag}|cut`); continue; }
        const got = walkFiles(root.real, root.real, { ...notesWalk(true), maxFiles: room + 1 }, budget, tally);
        const more = got.slice(0, room).filter(f => !have.has(f.abs));
        for (const f of got) have.add(f.abs);
        room -= more.length;
        for (const f of more) out.push(`l|${tag}|${f.rel}|${f.size}|${f.mtimeMs}`);
        if (got.length > room + more.length) out.push(`l|${tag}|cut`);
      }
    }
  }
  return out;
}

/** Makes every unfinished walk's text its own, even when two end in the same millisecond. */
let unfinishedCount = 0;

/**
 * What the watched places look like right now, as text: one line for each file the reader lists in them (its path below the place, its size and its change time), for each config
 * file at the home folder (the same two facts), for each tool folder the home folder holds (whether or not it was ticked, so a new program shows), and for each place that is gone.
 * It walks the folders exactly as a read does (`folderWalk`, `notesWalk`) but opens no file, so a change that keeps a file's size and change time is not seen. `complete` is false
 * when the time or a count ran out before the walk ended, or when a work or picked folder could not be found again from the path the window shows (that path is cleaned for the
 * screen: spaces are collapsed, a long part is cut, a key-like part is hidden). The text then holds the clock, so it matches nothing, and the check says it could not check, never
 * "same". A `gone` line is written only for a place that was rebuilt and has lost a tool folder. Nothing is written. The caller hashes the text (main/scan-session.ts).
 */
export async function watchTextOf(home: string, watched: readonly WatchedPlace[], now: () => number = () => Date.now(), budgetMs: number = REAL_LIMITS.budgetMs, approvalsFile?: string, limits?: LinkContext['limits']): Promise<{ readonly text: string; readonly complete: boolean }> {
  const budget = makeBudget(now, budgetMs), tally = newTally();
  const link: LinkContext = { ...loadApprovals(approvalsFile, budget, tally), ...(limits === undefined ? {} : { limits }) };
  let unresolved = false;
  const ambiguity = new Map<string, Map<string, number>>();
  const homePlaces = findHomePlaces(home);
  const lines: string[] = ['bowerloom-read-fingerprint-1', ...homePlaces.map(p => `roster|${p.id}`).sort()];
  // The approvals of linked home folders decide what is read, so they are part of the fingerprint. A record with none adds nothing.
  if (link.approved.size > 0 || link.damaged === true) lines.push(`approvals|${link.damaged === true ? 'damaged' : hashText([...link.approved].sort().join(','))}`);
  for (const w of [...watched].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (mustStop(budget, tally)) break;
    const dir = folderOfShown(w.path, home);
    const rebuilt = w.kind === 'home' ? (homePlaces.find(p => p.id === w.id) ?? null) : dir === null ? null : placeAt(dir, home, w.kind);
    lines.push(`place|${w.id}`);
    if (rebuilt === null) {
      // A home place that is not in the list has lost its folder. A work or picked folder that cannot be rebuilt may be gone or may only have a name the window's path does not hold: either way it cannot be checked.
      if (w.kind === 'home') lines.push('gone'); else unresolved = true;
      continue;
    }
    const place = 'place' in rebuilt ? rebuilt.place : rebuilt;
    // A path that a neighbour shares, or that holds a link the walk cannot take, may name another folder than the one read: it cannot be checked.
    if ('place' in rebuilt && (rebuilt.unresolved || (dir !== null && pathIsAmbiguous(dir, home, ambiguity)))) unresolved = true;
    const flags = { unresolved: false };
    lines.push(...watchLines(place, home, budget, tally, flags, link));
    if (flags.unresolved) unresolved = true;
    await yieldToLoop();
  }
  // A cap that cuts a folder short (`truncated`) cuts it at the same place every time, so it does not make the walk incomplete; only the clock or the count of files does.
  const complete = !tally.stoppedEarly && !unresolved;
  if (!complete) lines.push(`unfinished|${now()}|${(unfinishedCount += 1)}`);
  return { text: lines.join('\n'), complete };
}

// ---------------------------------------------------------------------------------------------------------------------- the scanner

export interface ScannerDeps {
  readonly home: string; readonly now?: () => number;
  /** The file of this machine's approvals of linked home folders (main/linked-approvals.ts). Without it no linked home folder is read. */
  readonly approvalsFile?: string;
}

export interface Batch { readonly reads: readonly PlaceRead[]; readonly tally: Tally }

export interface Scanner {
  /** Looks again at the home folder. Folders the person picked earlier stay listed and can still be read. */
  discover(): Promise<RealDiscovery>;
  addFolder(dir: string): Promise<RealDiscovery>;
  /** Asks `choose` for a folder (the chooser window) and adds it, all inside one call, so no other call can start while the chooser is open. Null when the person closed it. */
  pick(choose: () => Promise<string | null>): Promise<RealDiscovery | null>;
  read(ids: unknown): Promise<Batch>;
  /** The ids handed out so far. */
  knownIds(): readonly string[];
}

export function createScanner(deps: ScannerDeps): Scanner {
  const home = deps.home, now = deps.now ?? (() => Date.now());
  const known = new Map<string, PlaceInternal>();
  let busy = false;
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    if (busy) throw new RealRefusal('BUSY', 'Another look is still running.');
    busy = true;
    try { return await run(); } finally { busy = false; }
  };
  const describe = async (places: readonly PlaceInternal[], budget: Budget, tally: Tally): Promise<RealPlace[]> => {
    const out: RealPlace[] = [], link: LinkContext = loadApprovals(deps.approvalsFile, budget, tally);
    for (const p of places) {
      if (mustStop(budget, tally)) break;
      const s = summarise(p, home, budget, link);
      addTally(tally, s.tally);
      out.push(s.place);
      await yieldToLoop();
    }
    return out;
  };
  const answer = (places: RealPlace[], tally: Tally): RealDiscovery => ({
    places, stoppedEarly: tally.stoppedEarly, couldNotRead: couldNotRead(tally), readOnly: true,
    notes: [...(tally.truncated ? ['Some folders were big, so only part of them was looked at.'] : []), ...(tally.overBytes ? ['It stopped early to stay within its size limit.'] : tally.stoppedEarly ? ['It stopped early to stay within its time limit.'] : [])],
  });
  const addFolderNow = async (dir: unknown): Promise<RealDiscovery> => {
    if (typeof dir !== 'string' || dir === '' || dir.includes('\u0000')) throw new RealRefusal('BAD_ARGUMENT', 'That is not a folder.');
    if (realFolderFollowing(dir) === null) throw new RealRefusal('BAD_ARGUMENT', 'That folder is not there any more.');
    const budget = makeBudget(now), tally = newTally();
    const places = findPlacesUnder(dir, home, budget, tally).filter(p => known.has(p.id) || known.size < REAL_LIMITS.places);
    for (const p of places) known.set(p.id, p);
    return answer(await describe(places, budget, tally), tally);
  };
  return {
    knownIds: () => [...known.keys()],
    discover: () => guard(async () => {
      // Only the places under the home folder are listed again. A folder the person picked keeps its place in the list, so a second look does not undo the pick.
      for (const [id, place] of known) if (place.kind === 'home') known.delete(id);
      const budget = makeBudget(now), tally = newTally();
      const places = findHomePlaces(home);
      for (const p of places) known.set(p.id, p);
      return answer(await describe(places, budget, tally), tally);
    }),
    addFolder: dir => guard(() => addFolderNow(dir)),
    pick: choose => guard(async () => {
      const dir = await choose();
      return dir === null ? null : addFolderNow(dir);
    }),
    read: ids => guard(async () => {
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > REAL_LIMITS.places) throw new RealRefusal(ids instanceof Array && ids.length > REAL_LIMITS.places ? 'TOO_MANY' : 'BAD_ARGUMENT', 'Choose at least one place.');
      const chosen: PlaceInternal[] = [];
      for (const id of ids) {
        if (typeof id !== 'string' || id.length > 64) throw new RealRefusal('BAD_ARGUMENT', 'That place is not one I listed.');
        const p = known.get(id);
        if (p === undefined) throw new RealRefusal('UNKNOWN_PLACE', 'That place is not one I listed.');
        if (!chosen.includes(p)) chosen.push(p);
      }
      const budget = makeBudget(now), tally = newTally(), reads: PlaceRead[] = [];
      const link: LinkContext = loadApprovals(deps.approvalsFile, budget, tally);
      for (const p of chosen) {
        if (mustStop(budget, tally)) break;
        const r = readPlace(p, home, true, budget, link);
        addTally(tally, r.tally as Tally);
        reads.push(r);
        await yieldToLoop();
      }
      return { reads, tally };
    }),
  };
}

