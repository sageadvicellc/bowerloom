/**
 * Turns what the real-setup reader found (a `RealResult`) into the state of the harness-first preview (`--prototype-v3-real`). Pure: no file, no clock, no random number.
 *
 * The reader already hands over a `World` whose items carry their file path (written with `~`) and their text, which is cut to a limit and has every known key shape hidden.
 * This file reshapes it for the harness screens:
 *  - every item is one part, with the item's own id, so the ids are the same on every read;
 *  - parts are grouped into sources by scope, program and plug-in ("Your Claude Code folder", "Caveman (plug-in)", "alpha (Codex)");
 *  - the links come from the skills and connections an agent names, and stay on the source (`ScanSource.links`): no automatic link is made;
 *  - nothing the person made in Bowerloom exists yet, so there is no harness, install, run or history;
 *  - nothing is claimed about which program a part works in (the reader cannot prove it): every part has no limit (`cannotUse` is empty) and the screens say "Not checked";
 *  - the file text is scrubbed a second time (it is cheap) and cut to its first 60 lines (a display choice that its file page says, not a problem to count). It is only ever drawn as plain text.
 */
import type { HarnessItem, Scope, WikiPage, World } from '../proto/types.js';
import { hashText } from '../proto/sample.js';
import { adapterOf } from '../real/adapters.js';
import { tallyWords } from '../real/place.js';
import { cleanLine, cut, scrubText } from '../real/redact.js';
import type { RealPlace, RealResult } from '../real/types.js';
import { createSampleWorld } from './sample.js';
import { INTERFACE_IDS } from './types.js';
import type { HarnessState, Interface, InterfaceId, Link, Part, PartKind, Project, ScanSource } from './types.js';

/** The most lines of a file that go into `Part.fileText`. */
export const FILE_LINES = 60;
/** The plain last line of a text that was cut to `FILE_LINES` lines, so the cut is never silent. */
export const FILE_CUT_LINE = `Only the first ${FILE_LINES} lines are shown.`;
/** The most characters of the one-line summary drawn on a node. */
export const SUMMARY_CHARS = 40;
/** The most characters of the description. */
export const DESCRIPTION_CHARS = 200;
/** The most sets of notes that become context parts. The largest are kept. */
export const CONTEXT_PARTS = 30;
const NAME_CHARS = 80;
/** What the Interfaces screen says about what a program can use, in real mode: the reader cannot prove it, so it says it did not check. */
export const NOT_CHECKED_NOTE = 'Bowerloom has not checked which parts this program can use.';

/** The first `n` lines of a text, with `\n` between them. */
export function firstLines(text: string, n: number): string {
  if (text === '') return '';
  return text.replace(/\r\n?/g, '\n').split('\n').slice(0, n).join('\n');
}

/** The first `FILE_LINES` lines of a text, and a plain last line when there were more. */
function shownLines(text: string): string {
  const all = text.replace(/\r\n?/g, '\n').split('\n');
  return all.length > FILE_LINES ? `${firstLines(text, FILE_LINES)}\n${FILE_CUT_LINE}` : firstLines(text, FILE_LINES);
}

const plain = (text: string): string => cleanLine(scrubText(text));

/** The first sentence of a text, as one plain line. */
function firstSentence(text: string): string {
  const line = plain(text), at = /[.!?](?=\s|$)/.exec(line);
  return at === null ? line : line.slice(0, at.index + 1);
}

// ---- Where a thing was found

/** The plug-in and version of a path under `plugins/cache/<source>/<plug-in>/<version>/agents/`, or null. A folder name is a version only when it is a dotted number ("1.2.0", "v2.0.1-beta.1"): a git hash or a date is not. */
export function pluginOf(path: string): { readonly name: string; readonly version: string | undefined } | null {
  const m = /\/plugins\/cache\/[^/]+\/([^/]+)\/([^/]+)\/agents\//.exec(path);
  if (m === null) return null;
  const version = /^v?\d+(?:\.\d+)+[\w.+-]*$/.test(m[2]!) ? m[2]!.slice(0, 24) : undefined;
  return { name: m[1]!, version };
}

const VERSION = /^v?(\d+(?:\.\d+)*)(?:-([\w.-]*))?(?:\+[\w.-]*)?$/;
/** Orders two versions as numbers, so 1.10.0 is newer than 1.9.0, and a release is newer than its own beta. Negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const x = VERSION.exec(a), y = VERSION.exec(b), nx = (x?.[1] ?? '').split('.').filter(Boolean).map(Number), ny = (y?.[1] ?? '').split('.').filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(nx.length, ny.length); i += 1) { const d = (nx[i] ?? 0) - (ny[i] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  const px = x?.[2], py = y?.[2];
  if (px === undefined || py === undefined) return px === py ? 0 : px === undefined ? 1 : -1;
  const ix = px.split('.'), iy = py.split('.');
  for (let i = 0; i < Math.max(ix.length, iy.length); i += 1) {
    const u = ix[i], v = iy[i];
    if (u === undefined || v === undefined) return u === undefined ? -1 : 1;
    const bothNumbers = /^\d+$/.test(u) && /^\d+$/.test(v);
    const d = bothNumbers ? Number(u) - Number(v) : /^\d+$/.test(u) ? -1 : /^\d+$/.test(v) ? 1 : u < v ? -1 : u > v ? 1 : 0;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const titled = (name: string): string => { const words = cut(plain(name), NAME_CHARS).replace(/[-_]+/g, ' ').trim(); return words === '' ? 'A' : words.charAt(0).toUpperCase() + words.slice(1); };

const KIND_OF: Readonly<Record<HarnessItem['kind'], PartKind>> = { skill: 'skill', agent: 'agent', tool: 'tool', 'context-slice': 'context' };

/** The first program the item was found in that the harness knows. An item found only in Bowerloom's own folder has none. */
function faceOf(item: HarnessItem): InterfaceId | null {
  const found = item.foundAt.find(f => (INTERFACE_IDS as readonly string[]).includes(f.interface));
  return found === undefined ? null : (found.interface as InterfaceId);
}

/** Where the item was found in one program. Of several files of one plug-in the one in the newest version comes first; otherwise the first file. */
function foundIn(item: HarnessItem, face: InterfaceId): HarnessItem['foundAt'][number] | undefined {
  const list = item.foundAt.filter(f => f.interface === face);
  let best = list[0], bestVersion = best === undefined ? undefined : pluginOf(best.path)?.version;
  for (const f of list.slice(1)) {
    const v = pluginOf(f.path)?.version;
    if (v !== undefined && (bestVersion === undefined || compareVersions(v, bestVersion) > 0)) { best = f; bestVersion = v; }
  }
  return best;
}

// ---- A part

/** The other programs the item was found in, by name, in the order the preview lists them. The program the part is shown under, Bowerloom's own folder and a repeat do not count. */
function alsoFoundIn(item: HarnessItem, face: InterfaceId): string[] {
  const found = new Set(item.foundAt.map(f => f.interface as string));
  return INTERFACE_IDS.filter(id => id !== face && found.has(id)).map(id => adapterOf(id).label);
}

/** "a Codex", "an OpenCode". */
const an = (app: string): string => `${/^[AEIOU]/i.test(app) ? 'an' : 'a'} ${app}`;

const FALLBACK: Readonly<Record<string, { readonly summary: string; readonly description: (app: string) => string }>> = {
  skill: { summary: 'A skill.', description: app => `A skill found in ${an(app)} folder.` },
  agent: { summary: 'An agent.', description: app => `An agent found in ${an(app)} folder.` },
  mcp: { summary: 'A connection.', description: app => `A connection to another program, found in ${an(app)} folder.` },
  prompt: { summary: 'A saved prompt.', description: app => `A saved prompt, found in ${an(app)} folder.` },
  hook: { summary: 'Runs on its own.', description: app => `A hook that runs a command on its own, found in ${an(app)} folder.` },
  context: { summary: 'A set of notes.', description: () => 'A set of notes pages.' },
};
const fallbackKey = (item: HarnessItem): string => (item.kind === 'tool' ? item.toolKind : item.kind === 'context-slice' ? 'context' : item.kind);

/** The text the reader gave for the item, which the description comes from. */
function describedBy(item: HarnessItem): string {
  if (item.kind === 'skill') return item.description;
  if (item.kind === 'agent') return item.definition.role;
  return '';
}

/** The titles of the pages in a slice, one on each line, for the file view of a context part. Matched by folder name alone: two places with one name share their pages (see `pageTitlesBySlice`). */
function pageTitlesOf(item: Extract<HarnessItem, { kind: 'context-slice' }>, world: World): string[] {
  const slice = world.slices.find(s => s.id === item.sliceId), folders = slice?.rule.folders ?? [];
  return world.wikiPages.filter(p => folders.some(f => p.folder === f || p.folder.startsWith(`${f}/`))).map(p => plain(p.title));
}

const inFolder = (folder: string, rule: string): boolean => folder === rule || folder.startsWith(`${rule}/`);
const NOTE_SLICE = /^real-notes-([0-9a-f]{16})(?:-[0-9a-f]{16})?$/;

/**
 * The page titles of each set of notes (by slice id), counted for each place. The reader lists the pages place by place and names the sets after the place's label, so two places with
 * one label would each take the other's pages if they were matched by name alone. The pages of one place are the run that follows the pages of the place before it; where the
 * places read are known, a run ends at the number of notes the place was found to hold. A slice that is not one of the reader's (no place in its id) is left out and matched by name.
 */
function pageTitlesBySlice(world: World, places: readonly RealPlace[]): Map<string, string[]> {
  // Known limit: the page-to-place match is a guess by order (a run of pages after the previous place's run), not a fact the reader gave; it can put a page under the wrong place.
  const out = new Map<string, string[]>(), expected = new Map(places.map(p => [hashText(p.id).slice(0, 16), p.counts.notes] as const)), byPlace = new Map<string, World['slices'][number][]>();
  for (const slice of world.slices) { const key = NOTE_SLICE.exec(slice.id)?.[1]; if (key !== undefined) byPlace.set(key, [...(byPlace.get(key) ?? []), slice]); }
  const pages = world.wikiPages;
  let at = 0;
  for (const [key, slices] of byPlace) {
    const label = slices.find(s => s.id === `real-notes-${key}`)?.rule.folders[0];
    if (label === undefined) continue;
    const cap = expected.get(key), run: WikiPage[] = [];
    while (at < pages.length && !inFolder(pages[at]!.folder, label)) at += 1;
    while (at < pages.length && inFolder(pages[at]!.folder, label) && (cap === undefined || run.length < cap)) { run.push(pages[at]!); at += 1; }
    for (const slice of slices) out.set(slice.id, run.filter(p => slice.rule.folders.some(f => inFolder(p.folder, f))).map(p => plain(p.title)));
  }
  return out;
}

/**
 * One part from one item. `sourceId` is the scan source it belongs to and `sourceLabel` is the words shown beside it ("Your Claude Code folder"). A context item needs the world to list its pages
 * (`titles` has them for each set, counted for each place). The id is the item's own id.
 */
export function partOfItem(item: HarnessItem, sourceId: string, sourceLabel: string, world?: World, titles?: ReadonlyMap<string, readonly string[]>): Part {
  const face = faceOf(item), first = (face === null ? undefined : foundIn(item, face)) ?? item.foundAt[0];
  const app = face === null ? 'Claude Code' : adapterOf(face).label, fallback = FALLBACK[fallbackKey(item)]!;
  const name = cut(plain(item.name), NAME_CHARS) || item.id;
  let description = '', summary = '', fileText = '', path = first?.path ?? '';
  if (item.kind === 'context-slice') {
    const pages = titles?.get(item.sliceId) ?? (world === undefined ? [] : pageTitlesOf(item, world));
    description = `A set of ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} of notes.`;
    summary = `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}.`;
    fileText = shownLines(pages.join('\n'));
    path = world?.scopes.find(s => s.id === item.scopeId)?.path ?? '';
  } else {
    const said = describedBy(item);
    description = said === '' ? fallback.description(app) : cut(plain(said), DESCRIPTION_CHARS);
    summary = said === '' ? fallback.summary : cut(firstSentence(said), SUMMARY_CHARS);
    fileText = shownLines(scrubText(first?.text ?? ''));
    const other = face === null ? [] : alsoFoundIn(item, face);
    if (other.length > 0) description = `${description} Also found in ${other.length === 1 ? other[0]! : `${other.slice(0, -1).join(', ')} and ${other.at(-1)!}`}.`;
  }
  const plug = pluginOf(path), model = item.kind === 'agent' ? item.extras.find(e => e.key === 'model') : undefined;
  return {
    id: item.id, kind: KIND_OF[item.kind], name, summary: summary === '' ? fallback.summary : summary, description: description === '' ? fallback.description(app) : description,
    path: path.split('/').map(plain).join('/'), source: sourceLabel, origin: sourceId,
    ...(plug?.version === undefined ? {} : { version: plug.version }), fileText, cannotUse: [], inLibrary: true,
    ...(model === undefined || plain(model.badge) === '' ? {} : { badge: cut(plain(model.badge), 40) }),
  };
}

// ---- Sources

const FACE_ORDER: readonly string[] = [...INTERFACE_IDS, 'notes'];

interface Where { readonly key: string; readonly name: string; readonly label: string; readonly interfaceName: string; readonly harnessName: string; readonly order: readonly [number, number, string] }

/** Why an item with no program the preview knows is left out: only Bowerloom's own folder holds it, or it is in a program the preview has no room for. */
const leftOutWhy = (item: HarnessItem): 'bowerloom' | 'unknown' => (item.foundAt.every(f => (f.interface as string) === 'bowerloom') ? 'bowerloom' : 'unknown');
const thingsWord = (n: number): string => `${n} ${n === 1 ? 'thing' : 'things'}`;

/** Which source an item belongs to: its scope, the first program it was found in, and the plug-in it came from. Null for an item with no program the preview knows (see `leftOutWhy`). */
function whereIs(item: HarnessItem, scopes: readonly Scope[]): Where | null {
  // Known limit: an item whose scope id is not in the list falls back to the first scope (index 0), so it can be shown under the wrong folder.
  const scopeAt = Math.max(0, scopes.findIndex(s => s.id === item.scopeId)), scope = scopes[scopeAt], home = scope === undefined || scope.kind === 'global', folder = scope === undefined ? '' : cut(plain(scope.name), NAME_CHARS);
  if (item.kind === 'context-slice') {
    return { key: `${item.scopeId}|notes`, name: home ? 'Your notes' : `${folder} (notes)`, label: home ? 'Your notes' : `${folder} notes`, interfaceName: 'Notes', harnessName: home ? 'Your notes' : `${folder} notes`, order: [scopeAt, FACE_ORDER.indexOf('notes'), ''] };
  }
  const face = faceOf(item);
  if (face === null) return null;
  const app = adapterOf(face).label, first = foundIn(item, face)!, plug = pluginOf(first.path), order = FACE_ORDER.indexOf(face);
  if (plug !== null) {
    const name = titled(plug.name);
    return { key: `${item.scopeId}|${face}|${plug.name}`, name: `${name} (plug-in)`, label: `${name} plug-in`, interfaceName: app, harnessName: `${name} plug-in`, order: [scopeAt, order, plug.name] };
  }
  return home
    ? { key: `${item.scopeId}|${face}|`, name: `Your ${app} folder`, label: `Your ${app} folder`, interfaceName: app, harnessName: `${app} folder`, order: [scopeAt, order, ''] }
    : { key: `${item.scopeId}|${face}|`, name: `${folder} (${app})`, label: `${folder} (${app})`, interfaceName: app, harnessName: `${folder} ${app}`, order: [scopeAt, order, ''] };
}

/** The links an agent's definition makes: to the skills it names, the connections it uses and the notes it reads. A link to a part that is not held is dropped. */
export function linksOf(item: HarnessItem, held: ReadonlySet<string>, world: World): Link[] {
  if (item.kind !== 'agent') return [];
  const targets = [...item.definition.skillIds, ...item.definition.toolAttachments.map(t => t.toolId)];
  if (item.definition.sliceId !== undefined) { const slice = world.items.find(i => i.kind === 'context-slice' && i.sliceId === item.definition.sliceId); if (slice !== undefined) targets.push(slice.id); }
  return [...new Set(targets)].filter(to => held.has(to) && to !== item.id).map(to => ({ from: item.id, to }));
}

// ---- Interfaces and projects

function interfacesOf(result: RealResult, places: readonly RealPlace[]): Interface[] {
  const table = createSampleWorld().interfaces;
  return INTERFACE_IDS.map(id => {
    const base = table.find(i => i.id === id)!, adapter = adapterOf(id), label = adapter.label;
    const installed = result.world.interfaces.find(i => i.id === id)?.installed === 'installed';
    const note = NOT_CHECKED_NOTE;
    if (!installed) return { ...base, foundAt: 'Not found on this computer', health: 'not-found', healthWords: 'Not found', on: false, cannotUseNote: note };
    const home = places.find(p => p.kind === 'home' && p.apps.includes(label));
    const folders = home === undefined ? [] : adapter.homeFolders.filter(f => home.details.folders.includes(f));
    const foundAt = folders.length > 0 ? `Found at ${folders.map(f => `~/${f}`).join(' and ')}` : home !== undefined ? `Found at ~/${adapter.homeFolders[0] ?? ''}` : 'Found in a folder you chose';
    return { ...base, foundAt, health: 'ready', healthWords: 'Ready', on: true, cannotUseNote: note };
  });
}

const projectsOf = (places: readonly RealPlace[]): Project[] => places.filter(p => p.kind === 'project' || p.kind === 'picked').map(p => ({ id: p.id, name: cut(plain(p.label), NAME_CHARS), path: p.details.path }));

// ---- The state

/** The notes the reader writes for facts the Read screen already counts in its own words (things it could not read, texts cut, stopped early). They are left out here so each fact shows once. */
const COUNTED_NOTE = [/^Could not read \d+ things?\.$/, /^\d+ long texts? (?:was|were) shortened\.$/, /^It stopped early to stay within its (?:size|time) limit\.$/];
/** The reader's sentence for a place that hit its file or depth limit, taken from the reader itself. The Read screen says it once, with the limits, and each place's details say which place it was. */
export const PARTLY_READ_NOTE = tallyWords({ tooBig: 0, binary: 0, unreadable: 0, linksOutside: 0, stoppedEarly: false, truncated: true })[0]!;
/** A stopped-early line is for the whole read, not for one place. */
const STOPPED_NOTE = COUNTED_NOTE[2]!;

/** The id of a source: the whole hash of its key. A second key with the same hash gets a number after it, so no two sources share an id. */
export function sourceIdFor(key: string, used: ReadonlySet<string>): string {
  const base = `src-real-${hashText(key)}`;
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/**
 * The state of the preview for one read of the person's folders. `places` are the places that were read (the ones the person ticked): their work folders and picked folders become the projects,
 * and their home places say where each program was found. The sample's interface table gives the files each program would be written to.
 */
export function realToHarnessState(result: RealResult, places: readonly RealPlace[]): HarnessState {
  const world = result.world, notes = result.notes.filter(n => n !== PARTLY_READ_NOTE && !COUNTED_NOTE.some(r => r.test(n)));
  // Place each item in a source. An item that only Bowerloom's own folder holds is left out.
  const placed: { item: HarnessItem; where: Where }[] = [];
  let leftOutBowerloom = 0, leftOutUnknown = 0;
  for (const item of world.items) {
    const where = whereIs(item, world.scopes);
    if (where !== null) placed.push({ item, where });
    else if (leftOutWhy(item) === 'bowerloom') leftOutBowerloom += 1;
    else leftOutUnknown += 1;
  }
  // Notes: keep the largest sets, up to the limit. The page titles of every set are listed once, and the sizes come from that list.
  const titles = pageTitlesBySlice(world, places), titlesOf = (item: Extract<HarnessItem, { kind: 'context-slice' }>): readonly string[] => titles.get(item.sliceId) ?? pageTitlesOf(item, world);
  const sets = placed.filter(p => p.item.kind === 'context-slice');
  const sizes = new Map<string, number>(sets.map(p => [p.item.id, p.item.kind === 'context-slice' ? titlesOf(p.item).length : 0]));
  const keptSets = new Set([...sets].sort((a, b) => sizes.get(b.item.id)! - sizes.get(a.item.id)! || (a.item.id < b.item.id ? -1 : 1)).slice(0, CONTEXT_PARTS).map(p => p.item.id));
  const keep = placed.filter(p => p.item.kind !== 'context-slice' || keptSets.has(p.item.id));

  const sourceIds = new Map<string, string>(), usedIds = new Set<string>();
  const wheres = new Map<string, Where>();
  for (const { where } of keep) if (!wheres.has(where.key)) wheres.set(where.key, where);
  const ordered = [...wheres.values()].sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || (a.order[2] < b.order[2] ? -1 : a.order[2] > b.order[2] ? 1 : 0));
  for (const w of ordered) { const id = sourceIdFor(w.key, usedIds); usedIds.add(id); sourceIds.set(w.key, id); }

  const parts: Part[] = [];
  for (const kind of ['agent', 'skill', 'tool', 'context'] as const) {
    for (const { item, where } of keep) if (KIND_OF[item.kind] === kind) parts.push(partOfItem(item, sourceIds.get(where.key)!, where.label, world, titles));
  }
  const held = new Set(parts.map(p => p.id));
  const sources: ScanSource[] = ordered.map(w => {
    const members = keep.filter(p => p.where.key === w.key), links = members.flatMap(p => linksOf(p.item, held, world));
    return { id: sourceIds.get(w.key)!, name: w.name, interfaceName: w.interfaceName, harnessName: w.harnessName, partIds: members.map(p => p.item.id), links };
  });

  // The notes this file writes come first: the screen shows the first few and hides the rest, and these say what is missing from the list.
  const own: string[] = [];
  if (leftOutBowerloom > 0) own.push(`${thingsWord(leftOutBowerloom)} in a Bowerloom folder ${leftOutBowerloom === 1 ? 'is' : 'are'} not shown.`);
  if (leftOutUnknown > 0) own.push(`${thingsWord(leftOutUnknown)} in a program Bowerloom does not know ${leftOutUnknown === 1 ? 'is' : 'are'} not shown.`);
  if (sets.length > keptSets.size) { const n = sets.length - keptSets.size; own.push(`${n} ${n === 1 ? 'set' : 'sets'} of notes ${n === 1 ? 'is' : 'are'} not shown.`); }
  // What the reader said about each place that was read, from the first look at it. A text cut to 60 lines for the preview is not a problem and is not counted: its file page says so.
  const placeNotes = places.map(p => ({ name: p.label, notes: p.details.notes.filter(n => !STOPPED_NOTE.test(n)), ...(p.kind === 'home' ? { toolHome: true } : {}) })).filter(p => p.notes.length > 0);
  const onlyPartRead = result.notes.includes(PARTLY_READ_NOTE) || placeNotes.some(p => p.notes.includes(PARTLY_READ_NOTE));
  return {
    parts, harnesses: [], projects: projectsOf(places), installs: [], interfaces: interfacesOf(result, places), runs: [], history: [], sources, chosenSourceIds: sources.map(s => s.id),
    nextId: 100, real: { couldNotRead: result.couldNotRead, stoppedEarly: result.stoppedEarly, notes: [...own, ...notes], textsCut: result.textsCut, ...(onlyPartRead ? { onlyPartRead } : {}), ...(placeNotes.length > 0 ? { places: placeNotes } : {}) },
  };
}
