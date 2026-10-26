/**
 * Turns what the reader found (records and notes, place by place) into the World that the home screens already read. Pure: the clock value comes in as an argument.
 *
 * The rules:
 *  - Ids are stable. An item's id comes from its place and the path of its first file (and its name, for a file that holds several connections), so the same setup
 *    gives the same ids on every read. A page's id comes from its place and its path.
 *  - One thing found in two programs is ONE item with a `foundAt` for each program. Things are the same when they share a scope (the home folder, or one work folder), a
 *    kind, and a name once it is lowercased and stripped of everything but letters and digits. If the texts differ, the item has two different copies, which is the
 *    "different copies" case the screens already know.
 *  - Items from the home folder are in the `global` scope. Each work folder or picked folder is its own scope under it.
 *  - The world has three programs of its own (Claude Code, Codex, OpenCode). A program beyond them (Hermes, Bowerloom's own folder) has things listed in `others`
 *    (name and hint) unless `foldExtraApps` is set. With it set, those programs are programs of the world too: each thing found in one gets a `foundAt` under the program's
 *    own name (`hermes`, `bowerloom`), whether or not the same thing is also in one of the three, and the program is listed in `interfaces` as installed.
 *  - Names are the front matter name, else the file or folder name. A hint is the description, else the first sentence of the text, cut by the plain layer.
 *  - Notes pages become wiki pages (title, folder, tags, a short summary; never the page text). Each place with notes gets one set of notes for the whole place, and one
 *    for each of its biggest top folders.
 */
import type {
  AccessClass, AgentItem, ContextSliceItem, FoundAt, InterfaceId, InterfaceInfo, Scope, SkillItem, Slice, ToolAttachment, ToolItem, WikiPage, World,
} from '../proto/types.js';
import { hashText } from '../proto/sample.js';
import { INTERFACE_WORDS } from '../proto/words.js';
import { adapterOf, isKnownInterface, secretNameOf } from './adapters.js';
import { parseFrontmatter } from './frontmatter.js';
import { tallyWords, topicsOf } from './place.js';
import type { NoteEntry, PlaceRead, StampedRecord } from './place.js';
import { cleanLine, cleanPath, cut } from './redact.js';
import { REAL_LIMITS } from './types.js';
import type { RealApp, RealCounts, RealKind, RealOther, RealResult } from './types.js';

export interface BuildOptions {
  /** The time the read happened, in milliseconds, for the age of each file. The shared code never reads a clock. */
  readonly nowMs: number;
  readonly foldExtraApps?: boolean;
}

/** What the main process counted while it read. */
export interface BatchTally { readonly tooBig: number; readonly binary: number; readonly unreadable: number; readonly linksOutside: number; readonly stoppedEarly: boolean; readonly truncated: boolean; readonly overBytes?: boolean }

const INTERFACE_ORDER: readonly InterfaceId[] = ['claude-code', 'codex', 'opencode'];
/** The programs beyond the three, in the order the world lists them when `foldExtraApps` is set. */
const EXTRA_ORDER: readonly InterfaceId[] = ['hermes', 'bowerloom'];
const ALL_ORDER: readonly InterfaceId[] = [...INTERFACE_ORDER, ...EXTRA_ORDER];
const ENFORCEMENT: Readonly<Record<InterfaceId, InterfaceInfo['enforcement']>> = { 'claude-code': 'blocks reads', codex: 'advisory only', opencode: 'advisory only', hermes: 'advisory only', bowerloom: 'advisory only' };
const DAY_MS = 86_400_000;
const TOPIC_SLICES = 12;
const TOPIC_MIN_PAGES = 3;

export const GLOBAL_SCOPE: Scope = Object.freeze({ id: 'global', kind: 'global', name: 'Your home folder', parentId: null, path: '~' });

/** A name reduced to its letters and digits, to tell whether two names are the same thing. */
export const sameName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

const shortHash = (text: string, n = 10): string => hashText(text).slice(0, n);
const joinPath = (place: string, rel: string): string => cleanPath(place.endsWith('/') ? `${place}${rel}` : `${place}/${rel}`);

/**
 * How much text goes to the page. One text is cut at `excerptChars`; once `resultTextChars` have gone in all, each further text is cut at `minExcerptChars`. A cut text ends with a
 * mark that says how long it was, so two copies that differ only past the cut still differ. The result is therefore at most `resultTextChars` plus `minExcerptChars` for each item.
 */
interface TextBudget { left: number; cut: number }
function excerpt(text: string, budget: TextBudget): string {
  const room = Math.min(REAL_LIMITS.excerptChars, Math.max(REAL_LIMITS.minExcerptChars, budget.left));
  const out = text.length <= room ? text : `${text.slice(0, room)}\n… [cut: ${text.length} characters in all]`;
  if (out !== text) budget.cut += 1;
  budget.left -= out.length;
  return out;
}
const orderOf = (app: RealApp): number => { const at = ALL_ORDER.indexOf(app); return at < 0 ? ALL_ORDER.length : at; };
const kindAbbr = (kind: RealKind): string => (kind === 'skill' ? 'skill' : kind === 'agent' ? 'agent' : 'tool');

interface Located { readonly rec: StampedRecord; readonly read: PlaceRead; readonly scopeId: string }

interface Placed { readonly foundAt: FoundAt[]; readonly days: number[]; readonly extra: Located[] }

/**
 * Where the members of one group were found. The first file of each program of the three is a `foundAt`, in interface order; a member in any other program is `extra`.
 * With `fold` set, the other programs get a `foundAt` too (the first file of each), after the three, and nothing is `extra`.
 */
function placeMembers(members: readonly Located[], nowMs: number, fold: boolean, texts: TextBudget): Placed {
  const foundAt: FoundAt[] = [], days: number[] = [], extra: Located[] = [], seen = new Set<InterfaceId>();
  const textOf = (m: Located): string => excerpt(m.rec.text !== '' ? m.rec.text : (m.rec.description !== '' ? m.rec.description : m.rec.name), texts);
  for (const m of members) {
    if (!isKnownInterface(m.rec.app) && !fold) { extra.push(m); continue; }
    const face: InterfaceId = m.rec.app;
    if (seen.has(face)) continue;
    seen.add(face);
    const text = textOf(m);
    foundAt.push({ interface: face, path: joinPath(m.read.place.path, m.rec.relPath), contentHash: hashText(text), text });
    days.push(m.rec.mtimeMs > 0 ? Math.max(0, Math.floor((nowMs - m.rec.mtimeMs) / DAY_MS)) : 0);
  }
  return { foundAt, days, extra };
}

const accessOf = (toolNames: readonly string[]): AccessClass => {
  const reads = /(^|[_:-])(get|list|read|search|find|fetch|view|describe|query|lookup)/i, writes = /(create|update|delete|write|send|post|set|remove|edit|run|exec|push|move|rename|add|patch|put)/i;
  return toolNames.length > 0 && toolNames.every(n => reads.test(n)) && !toolNames.some(n => writes.test(n)) ? 'read-only' : 'read-write';
};

const bodyOf = (m: Located): string => {
  const body = m.rec.meta.body ?? parseFrontmatter(m.rec.text).body;
  return body.trim();
};

/** Builds the result of step two from the places that were read. */
export function buildRealResult(reads: readonly PlaceRead[], tally: BatchTally, options: BuildOptions): RealResult {
  const texts: TextBudget = { left: REAL_LIMITS.resultTextChars, cut: 0 };
  const scopes: Scope[] = [GLOBAL_SCOPE];
  const scopeOf = new Map<string, string>();
  for (const r of reads) {
    if (r.place.kind === 'home') { scopeOf.set(r.place.id, GLOBAL_SCOPE.id); continue; }
    const id = `scope-real-${shortHash(r.place.id, 8)}`;
    scopeOf.set(r.place.id, id);
    scopes.push({ id, kind: 'project', name: cleanLine(r.place.label).slice(0, 60), parentId: GLOBAL_SCOPE.id, path: cleanPath(r.place.path) });
  }

  // Group the records: one group is one item.
  const groups = new Map<string, Located[]>();
  for (const read of reads) for (const rec of read.records) {
    const scopeId = scopeOf.get(read.place.id) ?? GLOBAL_SCOPE.id;
    const key = `${scopeId}|${rec.kind}|${sameName(rec.slug) || rec.slug}`;
    const list = groups.get(key) ?? [];
    list.push({ rec, read, scopeId });
    groups.set(key, list);
  }
  const ordered = [...groups.entries()].map(([key, members]) => ({ key, members: [...members].sort((a, b) => orderOf(a.rec.app) - orderOf(b.rec.app) || (a.rec.relPath < b.rec.relPath ? -1 : a.rec.relPath > b.rec.relPath ? 1 : 0)) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const usedIds = new Set<string>();
  const idFor = (first: Located): string => {
    const base = `real-${kindAbbr(first.rec.kind)}-${shortHash(`${first.read.place.id}\u0000${first.rec.relPath}\u0000${first.rec.name}`)}`;
    let id = base, n = 2;
    while (usedIds.has(id)) { id = `${base}-${n}`; n += 1; }
    usedIds.add(id);
    return id;
  };

  const skills: SkillItem[] = [], tools: ToolItem[] = [], agentGroups: { id: string; members: Located[]; placed: Placed }[] = [], ages: Record<string, number[]> = {}, others: RealOther[] = [], slugsOf = new Map<string, string[]>();
  const toOther = (m: Located): RealOther => ({ app: adapterOf(m.rec.app).label, kind: m.rec.kind, name: m.rec.name, hint: cut(m.rec.description, 120), place: m.read.place.label });

  for (const { members } of ordered) {
    const first = members[0]!, placed = placeMembers(members, options.nowMs, options.foldExtraApps === true, texts);
    if (placed.foundAt.length === 0) { others.push(toOther(members[0]!)); continue; }
    for (const m of placed.extra) others.push(toOther(m));
    const id = idFor(first), rec = first.rec, base = { id, name: rec.name, scopeId: first.scopeId, foundAt: placed.foundAt, library: null } as const;
    ages[id] = placed.days;
    const describe = members.map(m => m.rec.description).find(d => d !== '') ?? '';
    if (rec.kind === 'skill') { skills.push({ ...base, kind: 'skill', description: describe }); slugsOf.set(id, members.map(m => m.rec.slug)); }
    else if (rec.kind === 'agent') agentGroups.push({ id, members, placed });
    else if (rec.kind === 'prompt') tools.push({ ...base, kind: 'tool', toolKind: 'prompt' });
    else if (rec.kind === 'hook') tools.push({ ...base, kind: 'tool', toolKind: 'hook', runsCode: true });
    else {
      const name = members.map(m => secretNameOf(m.rec.meta.envNames ?? [], m.rec.meta.headerNames ?? [])).find(n => n !== null) ?? null;
      tools.push({ ...base, kind: 'tool', toolKind: 'mcp', secret: name === null ? null : { kind: 'env', name, state: 'present' } });
    }
  }

  // Agents last: they point at skills and connections by name.
  const skillBy = new Map<string, SkillItem>();
  for (const s of skills) { skillBy.set(`${s.scopeId}|${sameName(s.name)}`, s); for (const slug of slugsOf.get(s.id) ?? []) skillBy.set(`${s.scopeId}|${sameName(slug)}`, s); }
  const agents: AgentItem[] = [];
  for (const { id, members, placed } of agentGroups) {
    const first = members[0]!, rec = first.rec;
    const skillIds: string[] = [], attach = new Map<string, string[]>();
    for (const m of members) {
      for (const name of m.rec.meta.skills ?? []) {
        const hit = skillBy.get(`${first.scopeId}|${sameName(name)}`) ?? skillBy.get(`${GLOBAL_SCOPE.id}|${sameName(name)}`);
        if (hit !== undefined && !skillIds.includes(hit.id)) skillIds.push(hit.id);
      }
      for (const raw of m.rec.meta.toolNames ?? []) {
        const server = raw.startsWith('mcp__') ? raw.slice(5).split('__')[0]! : '';
        for (const t of tools) {
          if (t.toolKind !== 'mcp' || (t.scopeId !== first.scopeId && t.scopeId !== GLOBAL_SCOPE.id)) continue;
          const n = sameName(t.name);
          const named = server !== '' ? sameName(server) === n : sameName(raw) === n || (raw.includes('_') && sameName(raw.split('_')[0]!) === n);
          if (named) attach.set(t.id, [...(attach.get(t.id) ?? []), raw]);
        }
      }
    }
    const toolAttachments: ToolAttachment[] = [...attach].map(([toolId, names]) => ({ toolId, access: accessOf(names) }));
    const body = excerpt(bodyOf(first), texts), describe = members.map(m => m.rec.description).find(d => d !== '') ?? '';
    const modelFrom = members.find(m => m.rec.meta.model !== undefined && placed.foundAt.some(f => f.interface === m.rec.app));
    const extras = modelFrom === undefined ? [] : [{ interface: modelFrom.rec.app, badge: `${INTERFACE_WORDS[modelFrom.rec.app]} only`, key: 'model', value: modelFrom.rec.meta.model! }];
    agents.push({
      id, kind: 'agent', name: rec.name, scopeId: first.scopeId, foundAt: placed.foundAt, library: null, extras,
      definition: { name: rec.name, role: members.map(m => m.rec.meta.role).find(r => r !== undefined) ?? cut(describe, 60), instructions: body !== '' ? body : describe, skillIds, toolAttachments },
    });
  }

  // Notes: pages and sets of pages.
  const wikiPages: WikiPage[] = [], slices: Slice[] = [], sliceItems: ContextSliceItem[] = [];
  for (const read of reads) {
    if (read.notes.length === 0) continue;
    const label = cleanLine(read.place.label).replace(/\//g, '-').slice(0, 60) || 'Notes', scopeId = scopeOf.get(read.place.id) ?? GLOBAL_SCOPE.id, key = shortHash(read.place.id, 8);
    const pages = read.notes.map((n: NoteEntry): WikiPage => ({
      id: `real-page-${shortHash(`${read.place.id}\u0000${n.rel}`, 12)}`, title: n.title === '' ? n.rel : n.title, folder: n.folder === '' ? label : `${label}/${n.folder}`,
      type: n.type === '' ? 'note' : n.type, tags: [...n.tags], summary: n.summary, bytes: n.bytes, links: [], joinedSinceVisit: false,
    }));
    const seen = new Set<string>();
    for (const p of pages) { let id = p.id, n = 2; while (seen.has(id)) { id = `${p.id}-${n}`; n += 1; } seen.add(id); wikiPages.push({ ...p, id }); }
    const addSlice = (id: string, name: string, folder: string): void => {
      const slice: Slice = { id, name, seeds: [], rule: { folders: [folder], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, pinned: false };
      slices.push(slice);
      sliceItems.push({ id: `item-${id}`, kind: 'context-slice', name, scopeId, foundAt: [], library: null, sliceId: id });
    };
    addSlice(`real-notes-${key}`, `${label} notes`, label);
    for (const topic of topicsOf(read.notes, TOPIC_SLICES)) {
      if (topic.count < TOPIC_MIN_PAGES || topic.name === 'Top level') continue;
      addSlice(`real-notes-${key}-${shortHash(topic.name, 6)}`, `${cut(topic.name, 40)} notes`, `${label}/${topic.name}`);
    }
  }

  const apps = new Set<RealApp>(reads.flatMap(r => r.place.apps));
  const interfaces: InterfaceInfo[] = (options.foldExtraApps === true ? ALL_ORDER.filter(id => INTERFACE_ORDER.includes(id) || apps.has(id)) : INTERFACE_ORDER)
    .map(id => ({ id, installed: apps.has(id) ? 'installed' : 'unknown', notice: null, enforcement: ENFORCEMENT[id] }));
  const byName = <T extends { name: string; id: string }>(list: T[]): T[] => [...list].sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  const world: World = { interfaces, items: [...byName(skills), ...byName(agents), ...byName(tools), ...sliceItems], scopes, overrides: [], wikiPages, slices, versions: [], libraries: [] };

  const counts: RealCounts = {
    agents: agents.length, skills: skills.length, tools: tools.filter(t => t.toolKind !== 'hook').length, hooks: tools.filter(t => t.toolKind === 'hook').length, notes: wikiPages.length,
  };
  const sum = tally.tooBig + tally.binary + tally.unreadable + tally.linksOutside;
  const partlyRead = reads.reduce((n, r) => n + r.partlyRead, 0), notesLeftOut = reads.reduce((n, r) => n + r.notesLeftOut, 0);
  const notes: string[] = [
    ...(sum > 0 ? [`Could not read ${sum} ${sum === 1 ? 'thing' : 'things'}.`] : []),
    ...(partlyRead > 0 ? [`${partlyRead} ${partlyRead === 1 ? 'file has a header' : 'files have headers'} that could not be fully understood, so ${partlyRead === 1 ? 'it is' : 'they are'} listed by file name.`] : []),
    ...(notesLeftOut > 0 ? [`${notesLeftOut} notes pages are not shown.`] : []),
    ...(texts.cut > 0 ? [`${texts.cut} long ${texts.cut === 1 ? 'text was' : 'texts were'} shortened.`] : []),
    ...tallyWords({ ...tally, tooBig: 0, binary: 0, unreadable: 0, linksOutside: 0 }),
  ];
  return { world, others, counts, ages, stoppedEarly: tally.stoppedEarly, couldNotRead: sum, partlyRead, textsCut: texts.cut, notes, readOnly: true };
}
