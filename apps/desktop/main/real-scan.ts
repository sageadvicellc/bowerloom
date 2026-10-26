/**
 * The reader of a real setup. It finds places (tool folders under the home folder, work folders found by walking down from a folder the person picked), counts what each holds
 * (step one), and reads the names, descriptions and structure of the places the person selected (step two). It reads; it never writes, and it holds no key value.
 *
 * It knows nothing about any one person's folders. Where to look comes from the adapter table (shared/real/adapters.ts); where to start comes from the home folder it is
 * given and from the folders the person picks. The place ids it hands out are the only ones `read` accepts.
 */
import { basename, dirname, join } from 'node:path';
import { ADAPTERS, adapterOf, appLabel, classify, recordsOfFile } from '../shared/real/adapters.js';
import type { ConfigKind } from '../shared/real/adapters.js';
import { firstHeading, firstSentence, parseFrontmatter } from '../shared/real/frontmatter.js';
import { countsOf, tallyWords, topicsOf } from '../shared/real/place.js';
import type { NoteEntry, PlaceRead, StampedRecord } from '../shared/real/place.js';
import { cleanLine, cut } from '../shared/real/redact.js';
import { hashText } from '../shared/proto/sample.js';
import { REAL_LIMITS } from '../shared/real/types.js';
import type { RealApp, RealDiscovery, RealPlace, RealPlaceKind } from '../shared/real/types.js';
import { addTally, couldNotRead, listDir, makeBudget, newTally, peekNames, readHead, readText, realFolderFollowing, resolveInside, shortPath, walkFiles } from './real-fs.js';
import type { Budget, Tally } from './real-fs.js';
import { textOf, listOf } from '../shared/real/yaml.js';

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
  readonly root: string;
  readonly folders: readonly FolderPart[];
  readonly files: readonly FilePart[];
}

export class RealRefusal extends Error {
  readonly code: 'BAD_ARGUMENT' | 'UNKNOWN_PLACE' | 'TOO_MANY' | 'BUSY' | 'NO_HOME';
  constructor(code: RealRefusal['code'], message: string) { super(message); this.code = code; }
}

const ALL_PROJECT_FOLDERS: ReadonlyMap<string, RealApp> = new Map(ADAPTERS.flatMap(a => a.projectFolders.map(f => [f, a.id] as const)));
const ALL_PROJECT_FILES: ReadonlyMap<string, { app: RealApp; config: ConfigKind }> = new Map(ADAPTERS.flatMap(a => a.projectFiles.map(f => [f.name, { app: a.id, config: f.config }] as const)));
const hasMarker = (names: readonly string[]): boolean => names.some(n => ALL_PROJECT_FOLDERS.has(n) || ALL_PROJECT_FILES.has(n));

const placeId = (kind: RealPlaceKind, root: string, apps: readonly string[]): string => `place-${hashText(`${kind}\u0000${root}\u0000${apps.join(',')}`).slice(0, 12)}`;
const labelOfFolder = (root: string): string => cleanLine(basename(root)).slice(0, 60) || 'This folder';
const yieldToLoop = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

// ---------------------------------------------------------------------------------------------------------------------- finding places

/** The places under the home folder: one for each program that has a folder or a file there. */
export function findHomePlaces(home: string): PlaceInternal[] {
  const out: PlaceInternal[] = [];
  for (const adapter of ADAPTERS) {
    const folders: FolderPart[] = [], files: FilePart[] = [];
    for (const name of adapter.homeFolders) { const real = realFolderFollowing(join(home, name)); if (real !== null) folders.push({ app: adapter.id, name, abs: real }); }
    for (const f of adapter.homeFiles) { const abs = join(home, f.path); if (peekNames(dirname(abs)).includes(basename(abs))) files.push({ app: adapter.id, name: f.path, abs, config: f.config }); }
    if (folders.length === 0 && files.length === 0) continue;
    out.push({ id: placeId('home', home, [adapter.id]), kind: 'home', label: `${adapter.label} at home`, root: home, folders, files });
  }
  return out;
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
  const partsOf = (abs: string, list: ReturnType<typeof listDir>): { folders: FolderPart[]; files: FilePart[] } => {
    const folders: FolderPart[] = [], files: FilePart[] = [];
    for (const e of list) {
      const folderApp = ALL_PROJECT_FOLDERS.get(e.name), fileApp = ALL_PROJECT_FILES.get(e.name);
      if (folderApp !== undefined) {
        const child = join(abs, e.name);
        let real: string | null = null;
        if (e.isDirectory()) real = child;
        else if (e.isSymbolicLink()) { const r = resolveInside(child, rootReal, tally); real = r !== null && r.stat.isDirectory() ? r.real : null; }
        if (real !== null) folders.push({ app: folderApp, name: e.name, abs: real });
      } else if (fileApp !== undefined && (e.isFile() || e.isSymbolicLink())) files.push({ app: fileApp.app, name: e.name, abs: join(abs, e.name), config: fileApp.config });
    }
    return { folders, files };
  };
  const visit = (abs: string, depth: number): void => {
    if (stop) return;
    if (budget.expired()) { tally.stoppedEarly = true; stop = true; return; }
    const list = listDir(abs, tally);
    const isRoot = depth === 0;
    const atHome = homeReal !== null && abs === homeReal;
    const { folders, files } = atHome ? { folders: [], files: [] } : partsOf(abs, list);
    if (isRoot || folders.length > 0 || files.length > 0) {
      if (found.length >= REAL_LIMITS.places) { tally.truncated = true; stop = true; return; }
      const kind: RealPlaceKind = isRoot ? 'picked' : 'project';
      found.push({ id: placeId(kind, abs, [...folders, ...files].map(p => p.app)), kind, label: labelOfFolder(abs), root: abs, folders, files });
    }
    for (const e of list) {
      if (stop) return;
      entries += 1;
      if (entries > REAL_LIMITS.discoveryEntries) { tally.truncated = true; stop = true; return; }
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name) || ALL_PROJECT_FOLDERS.has(e.name)) continue;
      const child = join(abs, e.name);
      let real = child, isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        const r = resolveInside(child, rootReal, tally);
        if (r === null || !r.stat.isDirectory()) continue;
        real = r.real; isDir = true;
      }
      if (!isDir) continue;
      if (depth + 1 > REAL_LIMITS.depth) { tally.truncated = true; continue; }
      if (seen.has(real)) continue;
      seen.add(real);
      visit(child, depth + 1);
    }
  };
  visit(rootReal, 0);
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

function noteOf(rel: string, bytes: number, mtimeMs: number, head: string | null): NoteEntry {
  const slash = rel.lastIndexOf('/'), folder = slash < 0 ? '' : rel.slice(0, slash), file = rel.slice(slash + 1).replace(/\.[^.]+$/, '');
  if (head === null) return { rel, folder, title: cleanLine(file).slice(0, REAL_LIMITS.noteChars), summary: '', tags: [], type: '', bytes: Math.max(1, bytes), mtimeMs };
  const front = parseFrontmatter(head);
  const title = textOf(front.data.title) || firstHeading(front.body) || file;
  const summary = textOf(front.data.description) || textOf(front.data.summary) || firstSentence(front.body, REAL_LIMITS.noteChars);
  const tags = listOf(front.data.tags).map(t => cleanLine(t).slice(0, 30)).filter(t => t !== '').slice(0, 3);
  return { rel, folder, title: cut(cleanLine(title), REAL_LIMITS.noteChars), summary: cut(cleanLine(summary), REAL_LIMITS.noteChars), tags, type: cleanLine(textOf(front.data.type)).slice(0, 30), bytes: Math.max(1, bytes), mtimeMs };
}

/**
 * Reads one place. `withText` false is step one: skills, agents and prompts are found by their paths and their files are not opened; only config files are opened, and only
 * their structure is kept. `withText` true is step two, after the person confirmed: the text of skills, agents and prompts is read too, and the head of each notes page.
 */
export function readPlace(place: PlaceInternal, home: string, withText: boolean, budget: Budget): PlaceRead {
  const tally = newTally();
  const records: StampedRecord[] = [], notes: NoteEntry[] = [];
  let partlyRead = 0, filesLeft = REAL_LIMITS.filesPerPlace, notesLeftOut = 0;
  for (const folder of place.folders) {
    const adapter = adapterOf(folder.app);
    const files = walkFiles(folder.abs, folder.abs, {
      maxDepth: REAL_LIMITS.depth, maxFiles: filesLeft, maxEntries: REAL_LIMITS.discoveryEntries, skipDirs: new Set(adapter.skipInside), skipHidden: false,
      accept: rel => classify(folder.app, rel) !== null,
    }, budget, tally);
    filesLeft -= files.length;
    for (const f of files) {
      const role = classify(folder.app, f.rel);
      if (role === null) continue;
      const relPath = `${folder.name}/${f.rel}`;
      if (role.what === 'note') { notes.push(noteOf(f.rel.replace(/^profiles\/[^/]+\//, ''), f.size, f.mtimeMs, withText ? readHead(f.abs, folder.abs, tally) : null)); continue; }
      const text = role.what === 'config' || withText ? readText(f.abs, folder.abs, tally) : null;
      if ((role.what === 'config' || withText) && text === null) continue;
      const result = recordsOfFile(folder.app, role, relPath, f.rel, text);
      if (result.unreadable) tally.unreadable += 1;
      if (result.partial) partlyRead += 1;
      records.push(...stamp(result.records, f.mtimeMs));
    }
  }
  for (const file of place.files) {
    const role = { what: 'config', config: file.config } as const;
    const text = readText(file.abs, dirname(file.abs), tally);
    if (text === null) continue;
    const result = recordsOfFile(file.app, role, file.name, file.name, text);
    if (result.unreadable) tally.unreadable += 1;
    records.push(...stamp(result.records, 0));
  }
  if (place.kind !== 'home') {
    const rootReal = realFolderFollowing(place.root);
    if (rootReal !== null) {
      const walked = walkFiles(place.root, rootReal, {
        maxDepth: REAL_LIMITS.depth, maxFiles: REAL_LIMITS.filesPerPlace, maxEntries: REAL_LIMITS.discoveryEntries, skipDirs: new Set([...SKIP_DIRS, ...ALL_PROJECT_FOLDERS.keys()]), skipHidden: true,
        accept: rel => MARKDOWN.test(rel), boundary: hasMarker,
      }, budget, tally);
      const shown = withText ? walked.slice(0, REAL_LIMITS.pagesPerPlace) : walked;
      notesLeftOut = walked.length - shown.length;
      for (const f of shown) notes.push(noteOf(f.rel, f.size, f.mtimeMs, withText ? readHead(f.abs, rootReal, tally) : null));
    }
  }
  const apps = [...new Set([...place.folders.map(p => p.app), ...place.files.map(p => p.app)])];
  const names = [...place.folders.map(p => p.name), ...place.files.map(p => p.name)];
  return { place: { id: place.id, kind: place.kind, label: place.label, path: shortPath(place.root, home), apps }, records, notes, notesLeftOut, partlyRead, folders: names, tally };
}

/** The step-one entry for a place: counts and details, no text. */
export function summarise(place: PlaceInternal, home: string, budget: Budget): { place: RealPlace; tally: Tally } {
  const read = readPlace(place, home, false, budget);
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

// ---------------------------------------------------------------------------------------------------------------------- the scanner

export interface ScannerDeps { readonly home: string; readonly now?: () => number }

export interface Batch { readonly reads: readonly PlaceRead[]; readonly tally: Tally }

export interface Scanner {
  discover(): Promise<RealDiscovery>;
  addFolder(dir: string): Promise<RealDiscovery>;
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
    const out: RealPlace[] = [];
    for (const p of places) {
      if (budget.expired()) { tally.stoppedEarly = true; break; }
      const s = summarise(p, home, budget);
      addTally(tally, s.tally);
      out.push(s.place);
      await yieldToLoop();
    }
    return out;
  };
  const answer = (places: RealPlace[], tally: Tally): RealDiscovery => ({
    places, stoppedEarly: tally.stoppedEarly, couldNotRead: couldNotRead(tally), readOnly: true,
    notes: [...(tally.truncated ? ['Some folders were big, so only part of them was looked at.'] : []), ...(tally.stoppedEarly ? ['It stopped early to stay within its time limit.'] : [])],
  });
  return {
    knownIds: () => [...known.keys()],
    discover: () => guard(async () => {
      known.clear();
      const budget = makeBudget(now), tally = newTally();
      const places = findHomePlaces(home);
      for (const p of places) known.set(p.id, p);
      return answer(await describe(places, budget, tally), tally);
    }),
    addFolder: dir => guard(async () => {
      if (typeof dir !== 'string' || dir === '' || dir.includes('\u0000')) throw new RealRefusal('BAD_ARGUMENT', 'That is not a folder.');
      if (realFolderFollowing(dir) === null) throw new RealRefusal('BAD_ARGUMENT', 'That folder is not there any more.');
      const budget = makeBudget(now), tally = newTally();
      const places = findPlacesUnder(dir, home, budget, tally).filter(p => known.has(p.id) || known.size < REAL_LIMITS.places);
      for (const p of places) known.set(p.id, p);
      return answer(await describe(places, budget, tally), tally);
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
      for (const p of chosen) {
        if (budget.expired()) { tally.stoppedEarly = true; break; }
        const r = readPlace(p, home, true, budget);
        addTally(tally, r.tally as Tally);
        reads.push(r);
        await yieldToLoop();
      }
      return { reads, tally };
    }),
  };
}

