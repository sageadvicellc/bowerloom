/** The window. It asks the main process for plain data, works out the words with the shared view models, and draws them. */
import type { AppInfo, AppSettings, FolderRole, ItemContent, ItemKind, SettingsResult, Snapshot, ViewerApi } from '../shared/types.js';
import { EXPLAINERS, KIND_WORDS, humanBytes, plural, titleOf } from '../shared/words.js';
import {
  cacheSummary, contextStoreRows, folderRows, foldersProblem, homeModel, itemDetail, libraryRows, projectDetail, projectRows, rowsOfRole, slicesByProject, storeSummary, ROLE_WORDS,
} from '../shared/viewmodel.js';
import type { Chip, Link, SliceGroup, SliceModel, Tone } from '../shared/viewmodel.js';
import { ICONS, h, icon } from './dom.js';
import { applyMotionTokens } from './motion-tokens.js';
import { mapHost, renderMap } from './map/mount.js';
import { disposeKnowledge, knowledgeHost } from './graph/knowledge.js';
import { mountPrototype } from './proto/mount.js';
import { isHomeHash, mountHome } from './home/mount.js';

declare global { interface Window { bowerloom: ViewerApi } }
// The prototype page has no bridge (main.ts leaves the preload out there), so `window.bowerloom` is missing then. This stand-in keeps the top of
// this file from failing, and any call on it is refused. The prototype is mounted at the bottom and never calls it.
const api: ViewerApi = window.bowerloom ?? new Proxy({} as ViewerApi, { get: () => () => Promise.reject(new Error('This page has no bridge.')) });

type Screen = Link['screen'];
interface Route extends Link { tab?: ItemKind }
interface Banner { text: string; retry: (() => void) | null }
const state: { info: AppInfo | null; settings: AppSettings | null; snap: Snapshot | null; route: Route; history: Route[]; error: string | null; busy: boolean; notice: string | null; banner: Banner | null; focusHeading: boolean; raw: Record<string, { text: string | null; note: string | null } | undefined> } =
  { info: null, settings: null, snap: null, route: { screen: 'home' }, history: [], error: null, busy: false, notice: null, banner: null, focusHeading: false, raw: {} };

const root = document.getElementById('root')!;
// The graph screen lives as long as the window; its observers are released when the window goes away.
window.addEventListener('pagehide', () => disposeKnowledge());

/**
 * Runs one call to the main process. A refusal or a failure shows a plain message with a way to try again, and never leaves
 * the window blank or lost. Returns null when the call failed.
 */
async function act<T>(what: string, run: () => Promise<T>, retry: (() => void) | null = null): Promise<T | null> {
  try { const value = await run(); if (state.banner !== null) { state.banner = null; } return value; }
  catch { state.banner = { text: `${what} did not work. Nothing was changed. You can try again.`, retry }; render(); return null; }
}
/** The settings changes answer with a sentence when they could not be made or kept. */
function settled(result: SettingsResult | null): void {
  if (result === null) return;
  state.settings = result.settings;
  state.banner = result.message === null ? null : { text: result.message, retry: null };
}
const asOfBar = (text: string): HTMLElement => h('div', { class: 'toolbar small muted' }, h('span', { text }), button('Look again', () => { void reload(); }, 'btn secondary'));

// ------------------------------------------------------------------------------------------------------------- helpers

const chip = (c: Chip | { label: string; tone: Tone }): HTMLElement => h('span', { class: `chip ${c.tone}`, text: c.label });
function explain(id: keyof typeof EXPLAINERS): HTMLElement {
  const e = EXPLAINERS[id]!;
  return h('details', { class: 'explain' }, h('summary', { text: `What is this? ${e.title}` }), h('p', {}, h('strong', { text: `${e.title}. ` }), e.body));
}
/**
 * Where the technical parts live: full paths, codes, hashes, file names. Collapsed, so the main words stay plain, with a button that
 * copies them to send to whoever looks after Bowerloom.
 */
function details(lines: readonly string[]): HTMLElement | null {
  const clean = lines.filter(Boolean);
  if (clean.length === 0) return null;
  const text = clean.join('\n');
  const status = h('span', { class: 'small muted', role: 'status' });
  return h('details', { class: 'explain' }, h('summary', { text: 'Details for the curious' }),
    h('pre', { class: 'file', tabindex: 0, text }),
    h('div', { class: 'toolbar' }, button('Copy details', async () => { const ok = await act('Copying', () => api.copyText(text)); status.textContent = ok ? 'Copied.' : 'Could not copy. You can select the text and copy it yourself.'; }, 'btn secondary'), status));
}
const powerChip = (sentence: string): HTMLElement => chip({ label: `Powerful: ${sentence.charAt(0).toLowerCase()}${sentence.slice(1).replace(/\.$/, '')}`, tone: 'warn' });
function empty(title: string, body: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'card empty' }, icon(ICONS.empty, 40), h('h2', { text: title }), h('p', { class: 'muted', text: body }), action);
}
const button = (label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement => h('button', { type: 'button', class: cls, on: { click: onClick } }, label);
function bar(label: string, percent: number, right: string): HTMLElement {
  const fill = h('span');
  fill.style.width = `${Math.max(2, percent)}%`;
  return h('div', { class: 'stack' }, h('div', { class: 'bar-label' }, h('span', { text: label }), h('span', { class: 'muted', text: right })), h('div', { class: 'bar', role: 'img', aria: { label: `${label}: ${right}` } }, fill));
}
function go(route: Route, replace = false): void {
  if (!replace) state.history.push(state.route);
  state.route = route; state.focusHeading = true; render();
  document.getElementById('main')?.scrollTo(0, 0);
}
const back = (): void => { const prev = state.history.pop(); state.route = prev ?? { screen: 'home' }; state.focusHeading = true; render(); };
function backButton(label: string): HTMLElement { return h('button', { type: 'button', class: 'back', on: { click: back } }, `← ${label}`); }
const rowButton = (onClick: () => void, ...children: (Node | string)[]): HTMLElement => h('button', { type: 'button', class: 'row', on: { click: onClick } }, ...children);
const fileBlock = (name: string, text: string | null, note: string | null, powers: string[] = []): HTMLElement =>
  h('div', { class: 'stack' }, h('div', { class: 'toolbar' }, h('span', { class: 'file-name', text: name }), powers.length ? h('span', { class: 'chips' }, ...powers.map(powerChip)) : null),
    text !== null ? h('pre', { class: 'file', tabindex: 0, text }) : h('p', { class: 'muted', text: note ?? 'Nothing to show.' }));

// ------------------------------------------------------------------------------------------------------------- screens

/** What is being read, with a way to change it. Only for real data: the sample is fixed. */
function lookingAt(s: Snapshot): HTMLElement | null {
  if (s.mode !== 'real') return null;
  const roots = state.settings?.roots ?? [];
  const add = button('Add a folder', async () => { settled(await act('Adding the folder', () => api.addRoot())); await reload(); }, 'btn secondary');
  return h('div', { class: 'card' }, h('h2', { text: 'Looking at' }),
    roots.length === 0 ? h('p', { text: 'No folder yet. Add the folder where your projects live.' }) : h('ul', { class: 'looking' }, ...roots.map(r => h('li', { class: 'toolbar' }, h('span', { class: 'tech', text: r }), button('Remove', async () => { settled(await act('Removing the folder', () => api.removeRoot(r))); await reload(); }, 'btn secondary')))),
    h('div', {}, add));
}

function homeScreen(s: Snapshot): HTMLElement {
  const m = homeModel(s);
  const addFolder = (): HTMLElement => button('Add a folder where your projects live', async () => { settled(await act('Adding the folder', () => api.addRoot())); await reload(); });
  return h('div', { class: 'page' },
    h('h1', { text: 'Home' }),
    m.sample ? h('div', { class: 'warning', role: 'note' }, icon(ICONS.warning, 20), 'You are looking at sample data, a made-up library with three projects. It is not your own Bowerloom.') : null,
    h('p', { class: 'lead', text: m.sentence }), asOfBar(m.asOf),
    lookingAt(s),
    h('div', { class: 'grid' }, ...m.counts.map(c => h('button', { type: 'button', class: 'stat', on: { click: () => go(c.link) } }, h('span', { class: 'value', text: c.value === null ? 'Unknown' : String(c.value) }), h('span', { class: 'muted', text: c.label })))),
    h('h2', { text: 'Needs attention' }),
    m.needsFolder ? h('div', { class: 'card' }, h('h3', { text: 'No project folder chosen yet' }), h('p', { text: 'The viewer does not know where your projects live, so it cannot say how they are doing. Choose the folder that holds them. It looks a few levels deep for projects that use Bowerloom, and changes nothing there.' }), h('div', {}, addFolder())) : null,
    m.attention.length === 0
      ? (m.needsFolder ? null : h('div', { class: 'card' }, h('div', { class: 'chips' }, chip({ label: 'All clear', tone: 'good' })), h('p', { text: 'Nothing needs your attention. Everything Bowerloom manages here is in place.' })))
      : h('div', { class: 'row-list' }, ...m.attention.map(a => h('div', { class: `card attention ${a.tone}` },
        h('div', { class: 'toolbar' }, h('h3', { text: a.title }), chip({ label: a.tone === 'bad' ? 'Needs a person' : a.tone === 'warn' ? 'Worth a look' : 'For your information', tone: a.tone })),
        h('p', { text: a.body }), h('p', {}, h('strong', { text: 'What a person would do: ' }), a.todo),
        a.members ? h('details', { class: 'explain' }, h('summary', { text: `Show the ${a.members.length} projects` }), h('ul', { class: 'sentences' }, ...a.members.map(m => h('li', {}, h('button', { type: 'button', class: 'back', on: { click: () => go({ screen: 'project', key: m.key }) } }, m.name))))) : null,
        h('div', { class: 'toolbar' }, a.link ? button('Take me there', () => go(a.link!), 'btn secondary') : null, a.technical ? details([`Technical name: ${a.technical}`]) : null)))));
}

/** The map is drawn by React, in one element that is kept and put back each time, so it keeps its place while other screens are looked at. */
function mapScreen(s: Snapshot): HTMLElement {
  renderMap({
    snapshot: s, saved: state.settings?.mapLayout ?? {}, api,
    onOpen: link => go(link),
    onLayout: layout => { void (async () => { settled(await act('Keeping the places', () => api.setMapLayout(layout))); })(); },
  });
  return h('div', { class: 'page wide map-page' },
    h('div', { class: 'map-head' }, h('h1', { text: 'Map', title: 'Everything Bowerloom looks after, as things you can move. Your places are remembered by the viewer; nothing in your folders changes.' })),
    mapHost());
}

/** The graph is drawn on a canvas in one element that is kept, so its picture and place survive other screens. */
function graphScreen(s: Snapshot): HTMLElement {
  return h('div', { class: 'page wide map-page' },
    h('div', { class: 'map-head' }, h('h1', { text: 'Knowledge graph', title: 'The pages of a context store and the links between them. Read only: nothing in your folders changes.' })),
    knowledgeHost({ snapshot: s, api, storeKey: state.route.key ?? null }));
}

function libraryScreen(s: Snapshot): HTMLElement {
  const tab = state.route.tab ?? state.route.kind ?? 'skill';
  const kinds: ItemKind[] = ['skill', 'prompt', 'team'];
  const rows = libraryRows(s, tab);
  return h('div', { class: 'page' },
    h('h1', { text: 'Library' }), h('p', { class: 'lead', text: 'Everything you have saved to use again. Projects pick from here.' }), asOfBar(homeModel(s).asOf), explain('store'),
    s.library.failed ? h('div', { class: 'warning', role: 'alert' }, icon(ICONS.warning, 20), 'The library could not be read, so what is listed here may be missing or wrong. Choose "Look again".') : null,
    h('div', { class: 'tabs', role: 'tablist' }, ...kinds.map(k => h('button', { type: 'button', role: 'tab', aria: { selected: String(k === tab) }, on: { click: () => go({ screen: 'library', tab: k }, true) } }, `${KIND_WORDS[k].many} (${s.library.failed ? '?' : (k === 'skill' ? s.library.skills : k === 'prompt' ? s.library.prompts : s.library.teams).length})`))),
    h('p', { class: 'muted', text: KIND_WORDS[tab].what }),
    s.library.pinsError ? h('div', { class: 'warning' }, icon(ICONS.warning, 20), 'The list of fixed-version skills could not be read, so some skills may be missing here.') : null,
    s.store.state === 'absent' ? empty('The shared library is not set up yet', 'This is normal. The shared library is a newer feature (beta.3). Until it is set up, each of your projects keeps its own skills, prompts and teams. Open Projects to see them.', button('Open Projects', () => go({ screen: 'projects' }), 'btn secondary')) : null,
    s.store.state === 'absent' ? null : rows.length === 0 && s.library.failed ? null : rows.length === 0 ? empty(`No ${KIND_WORDS[tab].many.toLowerCase()} yet`, `Your library has no ${KIND_WORDS[tab].many.toLowerCase()} yet. They appear here when someone creates them with Bowerloom.`)
      : h('div', { class: 'row-list' }, ...rows.map(r => rowButton(() => go({ screen: 'item', kind: r.kind, id: r.id }),
        h('span', { class: 'title', text: r.label }), chip({ label: r.origin, tone: r.originTone }),
        h('span', { class: 'meta' }, h('span', { text: r.version }), h('span', { text: r.used }), r.problem ? chip({ label: r.problem, tone: 'bad' }) : null)))));
}

let contentFor: { key: string; content: ItemContent | null } = { key: '', content: null };
function itemScreen(s: Snapshot): HTMLElement {
  const { kind, id, fromProject } = state.route;
  if (kind === undefined || id === undefined) return empty('Nothing selected', 'Pick an item from the library.');
  const key = `${fromProject ?? 'store'}:${kind}:${id}`;
  if (contentFor.key !== key) {
    contentFor = { key, content: null };
    void act('Reading what is inside', () => api.getItemContent({ kind, id, projectKey: fromProject ?? null })).then(c => { if (contentFor.key === key) { contentFor.content = c ?? { kind, id, where: fromProject ? 'project' : 'store', files: [], pinned: null, note: 'This could not be read. Choose "Look again" to try once more.' }; render(); } });
  }
  const d = itemDetail(s, kind, id, contentFor.content, fromProject ?? null);
  const wait = contentFor.content === null;
  return h('div', { class: 'page' },
    backButton('Back'), h('h1', { text: d.title }), h('p', { class: 'lead', text: d.what }),
    h('div', { class: 'card' }, h('dl', { class: 'kv' }, h('dt', { text: 'Kind' }), h('dd', { text: d.kindWords }), h('dt', { text: 'Where it came from' }), h('dd', { text: d.origin }), h('dt', { text: 'Version' }), h('dd', { text: d.version })), d.origin === 'Yours' ? null : explain('pin')),
    d.powers.length ? h('div', { class: 'warning' }, icon(ICONS.warning, 20), h('div', {}, h('strong', { text: 'This team has helpers with powerful settings. ' }), d.powers.join(' '), ' Read the helper files below before you trust them.')) : null,
    d.rawPowers.length ? details([`Settings: ${d.rawPowers.join(', ')}`]) : null,
    h('h2', { text: 'Projects that use it' }),
    d.usedBy.length === 0 ? h('p', { class: 'muted', text: 'No project uses this yet.' }) : h('div', { class: 'row-list' }, ...d.usedBy.map(u => rowButton(() => go({ screen: 'project', key: u.key }), h('span', { class: 'title', text: u.name })))),
    h('h2', { text: 'What is inside' }),
    wait ? h('p', { class: 'muted', text: 'Reading…' }) : null,
    d.note ? h('p', { class: 'muted', text: d.note }) : null,
    d.pinned ? h('div', { class: 'card' }, ...d.pinned.map(l => h('p', { text: l }))) : null,
    ...d.files.map(f => h('div', { class: 'card' }, fileBlock(f.path, f.text, f.note, f.powers))));
}

function folderRowView(r: ReturnType<typeof projectRows>[number]): HTMLElement {
  return rowButton(() => go({ screen: 'project', key: r.key }), h('span', { class: 'title', text: r.name }), chip(r.chip), h('span', { class: 'meta' }, h('span', { text: r.summary }), r.guess === null ? null : h('span', { class: 'guess', text: r.guess })));
}

/** Who is reading what, and how the person says what kind of folder each is. Used on a folder's own page and in Settings. */
function roleChooser(key: string, current: FolderRole, guess: FolderRole, chosen: boolean): HTMLElement {
  const set = async (role: FolderRole | null): Promise<void> => { settled(await act('Saving your choice', () => api.setRole(key, role))); await reload(); };
  return h('div', { class: 'card' }, h('h2', { text: 'What kind of folder is this?' }),
    h('p', { class: 'muted', text: chosen ? `You chose this. Bowerloom's guess was: ${ROLE_WORDS[guess].label}.` : `This is Bowerloom's guess: ${ROLE_WORDS[guess].label}. You can change it.` }),
    h('div', { class: 'chips', role: 'group', aria: { label: 'Kind of folder' } }, ...(['project', 'workspace', 'context-store'] as FolderRole[]).map(role => h('button', { type: 'button', class: current === role ? 'btn' : 'btn secondary', aria: { pressed: String(current === role) }, on: { click: () => { void set(role); } } }, ROLE_WORDS[role].label))),
    chosen ? h('div', {}, button('Use the guess again', () => { void set(null); }, 'btn secondary')) : null,
    h('p', { class: 'small muted', text: ROLE_WORDS[current].what }), explain('role'));
}

function projectsScreen(s: Snapshot): HTMLElement {
  const projects = rowsOfRole(s, 'project'), workspaces = rowsOfRole(s, 'workspace'), stores = contextStoreRows(s);
  const addFolder = button('Add a folder where your projects live', async () => { settled(await act('Adding the folder', () => api.addRoot())); await reload(); });
  return h('div', { class: 'page' },
    h('div', { class: 'toolbar' }, h('h1', { text: 'Projects' }), s.mode === 'real' ? addFolder : null),
    h('p', { class: 'lead', text: 'The folders on this computer that use Bowerloom, and whether each one is in good shape.' }),
    workspaces.length ? h('h2', { text: 'Workspace' }) : null, workspaces.length ? h('p', { class: 'muted', text: 'The folder that holds the rest. It is not a project itself.' }) : null,
    ...workspaces.map(folderRowView),
    h('h2', { text: 'Projects' }), h('p', { class: 'small muted', text: 'Bowerloom guesses what kind of folder each one is. If one is wrong, open it and change it.' }),
    projects.length === 0 ? empty('No projects found yet', s.mode === 'sample' ? 'The sample has no projects.' : 'Tell the viewer where your projects live. It looks inside that folder, a few levels deep, for projects that use Bowerloom.', s.mode === 'real' ? button('Add a folder where your projects live', async () => { settled(await act('Adding the folder', () => api.addRoot())); await reload(); }) : undefined)
      : h('div', { class: 'row-list' }, ...projects.map(folderRowView)),
    stores.length ? h('h2', { text: 'Context stores' }) : null, stores.length ? explain('contextStore') : null,
    ...stores.map(c => h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { text: c.name }), chip(c.chip)),
      h('p', { text: `Holds ${c.pages}.` }), c.manages.length ? h('p', { class: 'small', text: `Looked after by: ${c.manages.join(', ')}.` }) : null,
      c.guess === null ? null : h('p', { class: 'small guess', text: `${c.guess} Open the folder and choose "What kind of folder is this?".` }),
      h('p', { text: c.note }), c.readBy.length ? h('ul', { class: 'sentences' }, ...c.readBy.map(r => h('li', {}, h('button', { type: 'button', class: 'back', on: { click: () => go({ screen: 'project', key: r.key }) } }, r.name), ` ${r.how}.`))) : null,
      h('div', {}, button('Open this folder', () => go({ screen: 'project', key: c.key }), 'btn secondary')))));
}

function sliceCard(sm: SliceModel): HTMLElement {
  return h('div', { class: `card slice ${sm.stateLabel === 'Held' ? 'held' : 'live'}` },
    h('div', { class: 'toolbar' }, h('h3', { text: sm.id }), chip({ label: sm.stateLabel, tone: sm.tone })),
    h('dl', { class: 'kv' }, h('dt', { text: 'Reads' }), h('dd', { text: sm.where }), h('dt', { text: 'Files' }), h('dd', { text: sm.files })),
    sm.wants ? h('p', { text: sm.wants }) : null,
    sm.permission ? h('p', { text: sm.permission }) : null,
    sm.note ? h('div', { class: 'warning' }, icon(ICONS.warning, 20), sm.note) : null,
    sm.reason ? h('div', { class: 'warning' }, icon(ICONS.warning, 20), h('div', {}, h('strong', { text: 'Held. ' }), sm.reason)) : null,
    sm.agents.length ? h('p', { class: 'muted', text: `Read at the start by: ${sm.agents.join(', ')}` }) : h('p', { class: 'muted', text: 'No helper reads this one yet.' }),
    ...sm.bars.map(b => h('div', { class: 'stack' }, bar(`${b.role} reads at the start`, b.percent, `${b.startText} of ${b.wholeText}`), h('p', { class: 'small muted', text: b.percent < 100 ? b.sentence : `${b.role} reads about as much as the whole folder.` }))),
    sm.technical ? details([`Technical name: ${sm.technical}`]) : null);
}
function sliceGroupView(g: SliceGroup): HTMLElement {
  return h('div', { class: 'stack' },
    g.conflict ? h('div', { class: 'warning' }, icon(ICONS.warning, 20), g.conflict) : null,
    h('div', { class: g.conflict ? 'side-by-side' : 'stack' }, ...g.slices.map(sliceCard)));
}

function projectScreen(s: Snapshot): HTMLElement {
  const p = s.projects.find(x => x.key === state.route.key);
  if (!p) return h('div', { class: 'page' }, backButton('Back'), empty('That project is not in the list', 'Look again from the Projects screen.'));
  const d = projectDetail(p);
  const showRaw = state.raw[`${p.key}:shown`] !== undefined;
  const toggleRaw = async (): Promise<void> => {
    if (showRaw) delete state.raw[`${p.key}:shown`];
    else { state.raw[`${p.key}:shown`] = { text: null, note: null }; state.raw[`${p.key}:config`] = (await act('Reading the file', () => api.getFileText({ projectKey: p.key, file: 'config' }))) ?? { text: null, note: 'This could not be read.' }; state.raw[`${p.key}:lock`] = (await act('Reading the file', () => api.getFileText({ projectKey: p.key, file: 'lock' }))) ?? { text: null, note: 'This could not be read.' }; }
    render();
  };
  return h('div', { class: 'page' },
    backButton('Back'), h('div', { class: 'toolbar' }, h('h1', { text: d.name }), chip(d.chip)),     h('p', { class: 'lead', text: d.sentence }),
    d.role !== 'project' ? h('div', { class: 'card' }, h('p', {}, h('strong', { text: `${d.roleLabel}. ` }), d.roleWhat)) : null,
    d.olderNote ? h('div', { class: 'warning', role: 'note' }, icon(ICONS.warning, 20), d.olderNote) : null,
    d.reasons.length ? h('div', { class: 'card' }, h('h2', { text: 'What is different, and why' }), h('ul', { class: 'sentences' }, ...d.reasons.map(r => h('li', { text: r }))), explain('drift')) : null,
    h('h2', { text: 'What this project uses' }),
    d.items.length === 0 ? h('p', { class: 'muted', text: 'Nothing is listed.' }) : h('div', { class: 'row-list' }, ...d.items.map(i => rowButton(() => go({ screen: 'item', kind: i.kind, id: i.id, ...(i.from === 'This project' ? { fromProject: p.key } : {}) }),
      h('span', { class: 'title', text: `${i.label} (${KIND_WORDS[i.kind].one.toLowerCase()})` }), chip({ label: i.match.text, tone: i.match.tone }),
      h('span', { class: 'meta' }, h('span', { text: `From: ${i.from}` }), h('span', { text: i.origin }), h('span', { text: i.version }), i.hold ? chip({ label: i.hold, tone: 'bad' }) : null)))),
    d.agents.length ? h('h2', { text: 'Helpers (agents)' }) : null,
    ...d.agents.map(a => h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { text: a.role }), chip({ label: a.status, tone: a.tone })),
      a.team ? h('p', { class: 'muted', text: `In the team ${a.team}` }) : null,
      a.powers.length ? h('div', { class: 'warning' }, icon(ICONS.warning, 20), h('div', {}, h('strong', { text: 'Powerful. ' }), a.powers.join(' '))) : h('p', { class: 'muted', text: 'No powerful settings.' }),
      a.hold ? h('p', { text: a.hold }) : null,
      a.slices.length ? h('p', { text: `Reads these reading lists at the start: ${a.slices.join(', ')}` }) : null,
      details([...(a.holdCode ? [`Technical name: ${a.holdCode}`] : []), ...(a.rawPowers.length ? [`Settings: ${a.rawPowers.join(', ')}`] : [])]))),
    d.agents.length ? explain('agent') : null,
    d.slices.length ? h('h2', { text: 'Reading lists (slices)' }) : null, d.slices.length ? explain('slice') : null, ...d.slices.map(sliceGroupView),
    d.older ? null : h('h2', { text: 'The project list' }), d.older ? null : explain('config'),
    h('div', { class: 'card' }, h('ul', { class: 'sentences' }, ...d.config.map(c => h('li', { text: c })))),
    d.older ? null : h('h2', { text: 'The lock file' }), d.older ? null : explain('lock'),
    d.older ? null : h('div', { class: 'card' }, h('p', { text: d.lockSentence }), d.lock.length ? h('ul', { class: 'sentences' }, ...d.lock.map(l => h('li', { text: l }))) : null),
    roleChooser(p.key, p.role, p.roleGuess, p.roleChosen),
    details(d.details),
    d.older ? null : h('div', {}, button(showRaw ? 'Hide the raw files' : 'Show the raw files', () => { void toggleRaw(); }, 'btn secondary')),
    !d.older && showRaw ? h('div', { class: 'stack' }, fileBlock('bowerloom.json', state.raw[`${p.key}:config`]?.text ?? null, state.raw[`${p.key}:config`]?.note ?? null), fileBlock('bowerloom.lock.json', state.raw[`${p.key}:lock`]?.text ?? null, state.raw[`${p.key}:lock`]?.note ?? null)) : null);
}

function foldersScreen(s: Snapshot): HTMLElement {
  const rows = folderRows(s), groups = slicesByProject(s);
  return h('div', { class: 'page' },
    h('h1', { text: 'Knowledge folders' }), h('p', { class: 'lead', text: 'Folders of notes outside your projects. A project may read one only when it has been given permission.' }), explain('folder'), explain('grant'),
    foldersProblem(s) ? h('div', { class: 'warning', role: 'alert' }, icon(ICONS.warning, 20), `${foldersProblem(s)} Choose "Look again".`) : null,
    foldersProblem(s) ? null : rows.length === 0 ? empty('No knowledge folders yet', 'When someone saves a folder of notes with Bowerloom, it shows up here with the projects allowed to read it.')
      : h('div', { class: 'row-list' }, ...rows.map(r => h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('h3', { text: r.name }), chip({ label: r.state, tone: r.tone })),
        h('p', { class: 'tech', text: r.path }), h('p', { text: r.note }),
        r.allowed.length ? h('div', { class: 'chips' }, ...r.allowed.map(a => h('button', { type: 'button', class: 'btn secondary', on: { click: () => go({ screen: 'project', key: a.key }) } }, a.name))) : null,
        ...r.unknownNotes.map(n => h('p', { class: 'small', text: n })),
        r.styles.length ? h('ul', { class: 'sentences' }, ...r.styles.map(x => h('li', { text: `${x.name}: ${x.text}` }))) : null, r.styleNote ? h('p', { class: 'small muted', text: r.styleNote }) : null,
        r.outdated.length ? h('p', { class: 'small muted', text: `Permission is out of date for: ${r.outdated.map(o => o.name).join(', ')}.` }) : null))),
    h('h2', { text: 'Reading lists (slices) in each project' }), h('p', { class: 'muted', text: 'A reading list is a short list of files from a knowledge folder. A helper reads the list at the start instead of the whole folder. Each one is Live, or Held with a reason.' }), explain('slice'),
    groups.length === 0 ? h('p', { class: 'muted', text: 'No project has a reading list yet.' }) : h('div', { class: 'stack' }, ...groups.flatMap(g => [h('h3', { text: g.project.name }), ...g.slices.map(sliceGroupView)])));
}

function storageScreen(s: Snapshot): HTMLElement {
  const st = storeSummary(s.store);
  return h('div', { class: 'page' },
    h('h1', { text: 'Storage' }), h('p', { class: 'lead', text: 'Where your library lives on this computer, and the copies Bowerloom has saved.' }),
    h('div', { class: 'card' }, h('h2', { text: 'Your library' }), explain('store'),
      h('dl', { class: 'kv' }, h('dt', { text: 'State' }), h('dd', { text: st.state }), h('dt', { text: 'Where it is' }), h('dd', { class: 'tech', text: st.location }), h('dt', { text: 'Sharing' }), h('dd', { text: st.git }), h('dt', { text: 'GitHub access key' }), h('dd', { text: st.token })),
      explain('token'), st.lines.length ? h('p', { class: 'muted', text: `It holds ${st.lines.join(', ')}.` }) : null),
    h('div', { class: 'card' }, h('h2', { text: 'Saved copies' }), explain('cache'), h('p', { text: cacheSummary(s.cache) }),
      s.cache.entries.length ? h('div', { class: 'row-list' }, ...s.cache.entries.map(e => h('div', { class: 'row static-row' }, h('span', { class: 'title', text: e.label ?? 'Unnamed copy' }), chip({ label: e.bytes === null ? 'Size unknown' : humanBytes(e.bytes), tone: 'quiet' }), h('span', { class: 'meta' }, h('span', { text: e.status === 'completed' ? 'Complete' : 'Not finished' }), e.files !== null ? h('span', { text: plural(e.files, 'file') }) : null)))) : null,
      s.cache.unreadable.length ? h('p', { class: 'small muted', text: `Some places could not be checked: ${s.cache.unreadable.join(', ')}.` }) : null));
}

function settingsScreen(s: Snapshot): HTMLElement {
  const set = state.settings!, info = state.info!;
  const theme = (value: AppSettings['theme'], label: string): HTMLElement => h('button', { type: 'button', class: set.theme === value ? 'btn' : 'btn secondary', aria: { pressed: String(set.theme === value) }, on: { click: async () => { settled(await act('Changing the look', () => api.setTheme(value))); applyTheme(); render(); } } }, label);
  return h('div', { class: 'page' },
    h('h1', { text: 'Settings' }),
    h('div', { class: 'card' }, h('h2', { text: 'Folders being searched for projects' }), h('p', { class: 'muted', text: 'The viewer looks inside these folders for projects. Adding or removing one only changes this list in the viewer. It never changes the folder.' }),
      s.mode === 'sample' ? h('p', { text: 'You are looking at sample data, so this list is not used.' }) : set.roots.length === 0 ? h('p', { class: 'muted', text: 'No folders yet.' }) : h('div', { class: 'row-list' }, ...set.roots.map(r => h('div', { class: 'row static-row' }, h('span', { class: 'tech', text: r }), button('Remove from the list', async () => { settled(await act('Removing the folder', () => api.removeRoot(r))); await reload(); }, 'btn secondary')))),
      s.mode === 'real' ? button('Add a folder where your projects live', async () => { settled(await act('Adding the folder', () => api.addRoot())); await reload(); }) : null,
      s.mode === 'real' ? h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: state.settings?.includeExamples === true, on: { change: async on => { settled(await act('Changing the setting', () => api.setIncludeExamples(on))); await reload(); } } }), h('span', { text: 'Also look inside example and test folders' })) : null),
    s.projects.length ? h('div', { class: 'card' }, h('h2', { text: 'What kind of folder is each one?' }), h('p', { class: 'muted', text: 'Bowerloom guesses. Your choice is remembered by the viewer only, and changes no folder.' }),
      h('div', { class: 'row-list' }, ...s.projects.map(p => h('div', { class: 'row static-row' }, h('span', { class: 'title', text: p.name }),
        h('span', { class: 'chips', role: 'group', aria: { label: `Kind of folder: ${p.name}` } }, ...(['project', 'workspace', 'context-store'] as FolderRole[]).map(role => h('button', { type: 'button', class: p.role === role ? 'btn' : 'btn secondary', aria: { pressed: String(p.role === role) }, on: { click: () => { void (async () => { settled(await act('Saving your choice', () => api.setRole(p.key, role))); await reload(); })(); } } }, ROLE_WORDS[role].label))))))) : null,
    h('div', { class: 'card' }, h('h2', { text: 'What you are looking at' }),
      h('p', { text: info.mode === 'sample' ? 'Sample data, made to show every state.' : info.mode === 'sandbox' ? 'The sandbox: invented content in its own pretend home, safe to break.' : 'Your own Bowerloom.' }), h('p', { class: 'tech', text: info.storePath }),
      h('div', { class: 'chips' }, ...(['real', 'sample', 'sandbox'] as const).filter(m => m !== info.mode && (m !== 'sandbox' || info.sandbox.exists)).map(m =>
        button(m === 'real' ? 'Look at my Bowerloom' : m === 'sample' ? 'Try the sample data' : 'Open the sandbox', async () => { state.info = (await act('Switching', () => api.chooseMode(m))) ?? state.info; state.history = []; await reload(); go({ screen: 'home' }, true); }, 'btn secondary'))),
      !info.sandbox.exists ? h('p', { class: 'small muted', text: 'There is no sandbox yet. It is made by the sandbox command (see the README).' }) : null),
    h('div', { class: 'card' }, h('h2', { text: 'Appearance' }), h('div', { class: 'chips' }, theme('system', 'Match my computer'), theme('light', 'Light'), theme('dark', 'Dark'))),
    h('div', { class: 'card' }, h('h2', { text: 'About' }), h('dl', { class: 'kv' }, h('dt', { text: 'Version' }), h('dd', { text: info.version }), h('dt', { text: 'Updates' }), h('dd', { text: info.updates.status })),
      button('Check for updates', async () => { const r = await act('Checking for updates', () => api.checkForUpdates()); if (r !== null) { state.notice = r.status; state.info = (await act('Reading the version', () => api.getInfo())) ?? state.info; } render(); }, 'btn secondary'), state.notice ? h('p', { role: 'status', text: state.notice }) : null,
      h('p', { class: 'small muted', text: 'This viewer only looks. It does not change your library or your projects.' })));
}

function welcome(): HTMLElement {
  return h('div', { class: 'welcome' },
    h('div', { class: 'brand' }, icon(ICONS.leaf, 32), 'Bowerloom Viewer'),
    h('h1', { text: 'See everything Bowerloom looks after' }),
    h('p', { class: 'lead', text: 'Bowerloom keeps your AI skills, prompts, and teams in one place and shares them with your projects. This app shows you all of it, in plain words, and changes nothing.' }),
    h('div', { class: 'choices' }, button('Look at my Bowerloom', async () => { state.info = (await act('Opening your Bowerloom', () => api.chooseMode('real'))) ?? state.info; await reload(); go({ screen: 'home' }, true); }, 'btn big'), button('Try it with sample data', async () => { state.info = (await act('Opening the sample data', () => api.chooseMode('sample'))) ?? state.info; await reload(); go({ screen: 'home' }, true); }, 'btn big secondary')),
    h('p', { class: 'small muted', text: 'The sample data is a made-up library with three projects. One is in good shape, one has drifted, and one has a damaged lock file.' }));
}

// ------------------------------------------------------------------------------------------------------------- shell

const NAV: { screen: Screen; label: string; icon: readonly string[] }[] = [
  { screen: 'home', label: 'Home', icon: ICONS.home }, { screen: 'map', label: 'Map', icon: ICONS.map }, { screen: 'graph', label: 'Knowledge graph', icon: ICONS.graph }, { screen: 'library', label: 'Library', icon: ICONS.library }, { screen: 'projects', label: 'Projects', icon: ICONS.projects },
  { screen: 'folders', label: 'Knowledge folders', icon: ICONS.folders }, { screen: 'storage', label: 'Storage', icon: ICONS.storage }, { screen: 'settings', label: 'Settings', icon: ICONS.settings },
];
const section = (screen: Screen): Screen => screen === 'item' ? 'library' : screen === 'project' ? 'projects' : screen;

function shell(content: HTMLElement, banner: HTMLElement | null = null): HTMLElement {
  const info = state.info!, attention = state.snap ? homeModel(state.snap).attention.length : 0;
  const nav = h('nav', { class: 'nav', aria: { label: 'Main' } }, ...NAV.map(n => {
    const b = h('button', { type: 'button', on: { click: () => { state.history = []; go({ screen: n.screen }, true); } } }, icon(n.icon), n.label, n.screen === 'home' && attention > 0 ? chip({ label: String(attention), tone: 'warn' }) : null);
    if (section(state.route.screen) === n.screen) b.setAttribute('aria-current', 'page');
    return b;
  }));
  return h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' }, h('div', { class: 'brand' }, icon(ICONS.leaf, 28), 'Bowerloom'), info.mode === 'sandbox' ? h('div', { class: 'sandbox-badge', role: 'note' }, 'Sandbox: safe to break') : null, nav, button('Look again', () => { void reload(); }, 'btn secondary')),
    h('main', { id: 'main' }, banner, content),
    h('footer', { class: 'footer' }, h('span', { text: `Bowerloom Viewer ${info.version}` }), h('span', { text: info.updates.status }), h('span', { class: 'spacer' }), h('span', { text: info.mode === 'sample' ? 'Showing sample data' : info.mode === 'sandbox' ? 'Sandbox: safe to break' : 'Showing your own Bowerloom' })));
}

function body(): HTMLElement {
  if (state.error) return h('div', { class: 'page', role: 'alert' }, empty('Something went wrong', state.error, button('Try again', () => { void reload(); })));
  if (state.snap === null) return h('div', { class: 'page' }, h('p', { class: 'muted', role: 'status', text: 'Reading your Bowerloom…' }));
  switch (state.route.screen) {
    case 'map': return mapScreen(state.snap);
    case 'graph': return graphScreen(state.snap);
    case 'library': return libraryScreen(state.snap);
    case 'item': return itemScreen(state.snap);
    case 'projects': return projectsScreen(state.snap);
    case 'project': return projectScreen(state.snap);
    case 'folders': return foldersScreen(state.snap);
    case 'storage': return storageScreen(state.snap);
    case 'settings': return settingsScreen(state.snap);
    default: return homeScreen(state.snap);
  }
}

function bannerView(): HTMLElement | null {
  const notices: HTMLElement[] = [];
  if (state.info?.notice) notices.push(h('div', { class: 'warning', role: 'alert' }, icon(ICONS.warning, 20), state.info.notice));
  if (state.banner) notices.push(h('div', { class: 'warning', role: 'alert' }, icon(ICONS.warning, 20), h('span', { text: state.banner.text }), state.banner.retry ? button('Try again', state.banner.retry, 'btn secondary') : null));
  return notices.length === 0 ? null : h('div', { class: 'stack banners' }, ...notices);
}

/** Tells a screen reader which screen is now showing, and moves the keyboard to its heading. */
function announce(): void {
  const live = document.getElementById('live');
  const heading = document.querySelector<HTMLElement>('main h1');
  if (!state.focusHeading) return;
  state.focusHeading = false;
  if (heading !== null) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
  if (live !== null) live.textContent = heading?.textContent ?? '';
}

function render(): void {
  if (state.info === null || state.settings === null) return;
  const banner = bannerView();
  const content = state.info.firstRun ? h('div', { class: 'welcome-wrap' }, banner, welcome()) : null;
  const view = state.info.firstRun ? h('main', { id: 'main', class: 'solo' }, content) : shell(body(), banner);
  const live = h('div', { id: 'live', class: 'sr', role: 'status', aria: { live: 'polite' } });
  root.replaceChildren(view, live);
  document.title = `Bowerloom Viewer - ${titleOf(state.route.screen)}`;
  announce();
}

function applyTheme(): void {
  const t = state.settings?.theme ?? 'system';
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

async function reload(): Promise<void> {
  const info = await act('Starting', () => api.getInfo(), () => { void reload(); }), settings = await act('Reading the viewer\'s settings', () => api.getSettings(), () => { void reload(); });
  if (info === null || settings === null) { state.error = 'The viewer could not start properly.'; render(); return; }
  state.info = info; state.settings = settings; applyTheme();
  if (state.info.mode === null) { state.snap = null; render(); return; }
  state.error = null; state.snap = null; render();
  try {
    state.snap = await api.getSnapshot(); state.banner = null;
    // The first real-data look may have found and saved folders while it read, so the list shown is read again.
    state.settings = (await api.getSettings().catch(() => null)) ?? state.settings;
    state.info = (await api.getInfo().catch(() => null)) ?? state.info;
  }
  catch (error) { state.error = error instanceof Error && /sample data could not be prepared|Choose what to look at/.test(error.message) ? error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : 'Bowerloom could not be read. Choose "Look again" to try once more.'; }
  state.focusHeading = true;
  render();
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyMotionTokens();
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => applyMotionTokens());
// The clickable prototype of Bowerloom 0.8 opens on the address #prototype. It keeps everything in memory and skips the normal start.
// The 0.8 home app opens on #prototype-v2 (and its kit gallery on #prototype-v2/kit). It shares the in-memory sample and has no bridge either.
if (location.hash === '#prototype') { applyTheme(); mountPrototype(root); } else if (isHomeHash(location.hash)) { applyTheme(); mountHome(root); } else void reload();
