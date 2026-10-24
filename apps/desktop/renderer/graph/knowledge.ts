/**
 * The Knowledge graph screen: an Obsidian-style picture of a context store, drawn on a canvas by force-graph. The window only ever
 * holds ids, titles, tags, folders, sizes and links. A page's text is fetched one page at a time and shown as plain text.
 * The screen keeps its own element and state, so it is not rebuilt when other parts of the app redraw.
 */
import ForceGraph from 'force-graph';
import './knowledge.css';
import type { GraphNode, KnowledgeGraph, Snapshot, ViewerApi } from '../../shared/types.js';
import { NO_FILTER, colourSlot, filterGraph, neighbours, radiusOf, summary, topFolder } from '../../shared/graphmodel.js';
import type { GraphFilter } from '../../shared/graphmodel.js';
import { storeChoices } from '../../shared/viewmodel.js';
import type { StoreChoice } from '../../shared/viewmodel.js';
import { MOTION, ms, prefersReducedMotion } from '../motion-tokens.js';

const SLOTS = 8;
type FGNode = GraphNode & { x?: number; y?: number };
interface FGLink { source: string | FGNode; target: string | FGNode }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const btn = (label: string, onClick: () => void, cls = 'bw-btn'): HTMLButtonElement => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };

export interface KnowledgeProps { snapshot: Snapshot; api: ViewerApi; /** A store to open first, for example the one the person came from. */ storeKey: string | null }

const host = el('div', 'kg-host');
let built = false;

// State of the screen. One store at a time.
let api: ViewerApi;
let choices: StoreChoice[] = [];
let store: StoreChoice | null = null;
let graph: KnowledgeGraph | null = null;
let filter: GraphFilter = NO_FILTER;
let colourBy: 'folder' | 'tag' = 'folder';
let selected: string | null = null;
let hovered: string | null = null;
let paused = false, listView = false, loadToken = 0;
let fg: InstanceType<typeof ForceGraph> | null = null;
/** The picture fits itself to the window once after each load, then the person's own zoom is left alone. */
let fitted = false;
let palette: string[] = [], inkColour = '#222', mutedColour = '#666', surfaceColour = '#fff';

// Elements
const picker = el('select', 'kg-input'), searchBox = el('input', 'kg-input'), folderSel = el('select', 'kg-input'), tagSel = el('select', 'kg-input'), colourSel = el('select', 'kg-input'), depthSel = el('select', 'kg-input');
const orphanBox = el('input'), status = el('p', 'kg-status small muted'), notices = el('div', 'kg-notices'), canvasBox = el('div', 'kg-canvas'), listBox = el('div', 'kg-list'), panel = el('aside', 'kg-panel');
const pauseBtn = btn('Pause', () => togglePause()), listBtn = btn('Show as a list', () => { listView = !listView; syncView(); });

function readColours(): void {
  const css = getComputedStyle(document.documentElement);
  palette = Array.from({ length: SLOTS }, (_, i) => css.getPropertyValue(`--graph-${i + 1}`).trim() || '#5b5fa3');
  inkColour = css.getPropertyValue('--text').trim() || '#222'; mutedColour = css.getPropertyValue('--text-muted').trim() || '#666'; surfaceColour = css.getPropertyValue('--surface').trim() || '#fff';
}
const keyOf = (n: GraphNode): string => (colourBy === 'tag' ? n.tags[0] ?? '(no tag)' : topFolder(n));
const colourOf = (n: GraphNode): string => palette[colourSlot(keyOf(n), SLOTS)] ?? '#5b5fa3';

let shown = { nodes: [] as GraphNode[], edges: [] as { from: string; to: string }[] };
let neighbourSet = new Set<string>();
let fade = 0, fadeTarget = 0, fadeAt = 0;

function focusSet(): Set<string> {
  const id = hovered ?? selected;
  if (id === null) return new Set();
  const set = new Set([id]);
  for (const e of shown.edges) { if (e.from === id) set.add(e.to); if (e.to === id) set.add(e.from); }
  return set;
}
function setHover(id: string | null): void {
  if (id === hovered) return;
  hovered = id; neighbourSet = focusSet(); fadeTarget = id !== null || selected !== null ? 1 : 0; fadeAt = performance.now();
}

/** Fits the pages that have links; pages with no links drift near the edge and would shrink the picture. */
function fitAll(): void { fg?.zoomToFit(ms(MOTION.graph.focus.ms), 50, (n: object) => !(n as GraphNode).orphan || shown.nodes.every(x => x.orphan)); }

function buildCanvas(): void {
  if (fg !== null) return;
  readColours();
  fg = new ForceGraph(canvasBox)
    .nodeId('id').nodeLabel(() => '').backgroundColor('rgba(0,0,0,0)')
    .nodeVal((n: object) => Math.pow(radiusOf(n as GraphNode), 2) / 4)
    .linkColor(() => mutedColour).linkWidth(0.6).linkDirectionalArrowLength(0)
    .d3AlphaDecay(MOTION.graph.alphaDecay).d3VelocityDecay(MOTION.graph.velocityDecay)
    .nodeCanvasObjectMode(() => 'replace')
    .nodeCanvasObject((raw: object, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = raw as FGNode, r = radiusOf(n), x = n.x ?? 0, y = n.y ?? 0, active = neighbourSet.size > 0;
      const t = ms(MOTION.graph.highlight.ms) === 0 ? fadeTarget : Math.min(1, (performance.now() - fadeAt) / MOTION.graph.highlight.ms), f = fadeTarget === 1 ? t : 1 - t;
      const lit = !active || neighbourSet.has(n.id);
      ctx.globalAlpha = lit ? 1 : 1 - 0.82 * (active ? Math.max(f, fadeTarget === 1 ? t : 0) : 0);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
      if (n.orphan) { ctx.lineWidth = 1.4 / scale; ctx.strokeStyle = colourOf(n); ctx.fillStyle = surfaceColour; ctx.fill(); ctx.stroke(); } else { ctx.fillStyle = colourOf(n); ctx.fill(); }
      if (n.id === selected) { ctx.lineWidth = 2.2 / scale; ctx.strokeStyle = inkColour; ctx.beginPath(); ctx.arc(x, y, r + 2.5 / scale, 0, 2 * Math.PI); ctx.stroke(); }
      const showLabel = n.id === selected || n.id === hovered || (active && neighbourSet.has(n.id) && scale > 1.6) || (n.degree >= 12 && scale > 2) || scale > 3.5;
      if (showLabel) { ctx.font = `${12 / scale}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = inkColour; ctx.fillText(n.title, x, y + r + 2 / scale); }
      ctx.globalAlpha = 1;
    })
    .nodePointerAreaPaint((raw: object, colour: string, ctx: CanvasRenderingContext2D) => { const n = raw as FGNode; ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(n.x ?? 0, n.y ?? 0, radiusOf(n) + 2, 0, 2 * Math.PI); ctx.fill(); })
    .linkCanvasObjectMode(() => undefined)
    .onNodeHover((n: object | null) => { setHover(n === null ? null : (n as GraphNode).id); canvasBox.classList.toggle('kg-pointer', n !== null); })
    .onNodeClick((n: object) => select((n as GraphNode).id, false))
    .onBackgroundClick(() => select(null, false))
    .onEngineStop(() => { if (!paused) status.dataset.settled = '1'; if (!fitted) { fitted = true; fitAll(); } });
  fg.linkColor((l: object) => { const k = l as FGLink, a = typeof k.source === 'object' ? k.source.id : k.source, b = typeof k.target === 'object' ? k.target.id : k.target; return neighbourSet.size === 0 || (neighbourSet.has(a) && neighbourSet.has(b)) ? mutedColour : 'rgba(127,127,127,0.12)'; });
  const size = (): void => { const r = canvasBox.getBoundingClientRect(); if (r.width > 0 && r.height > 0) fg!.width(Math.floor(r.width)).height(Math.floor(r.height)); };
  const charge = fg.d3Force('charge') as { strength?: (v: number) => { distanceMax?: (v: number) => unknown } } | undefined; charge?.strength?.(-70);
  (fg.d3Force('charge') as { distanceMax?: (v: number) => unknown } | undefined)?.distanceMax?.(140);
  const link = fg.d3Force('link') as { distance?: (v: number) => unknown } | undefined; link?.distance?.(38);
  new ResizeObserver(size).observe(canvasBox); size();
  // Stop drawing while the screen is not in view, and again when it comes back, unless the person paused it.
  new IntersectionObserver(entries => { const visible = entries.some(e => e.isIntersecting); if (!visible) fg!.pauseAnimation(); else if (!paused) fg!.resumeAnimation(); }).observe(canvasBox);
  const recolour = (): void => { readColours(); };
  new MutationObserver(recolour).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolour);
}

/** Puts the current filter's pages into the canvas. Pages that stay keep their places, so filtering does not scramble the picture. */
function refresh(): void {
  if (graph === null) return;
  shown = filterGraph(graph, filter);
  buildCanvas();
  const old = new Map<string, FGNode>(((fg!.graphData().nodes as FGNode[]) ?? []).map(n => [n.id, n]));
  const nodes: FGNode[] = shown.nodes.map(n => { const prev = old.get(n.id); return prev ? Object.assign(prev, n) : { ...n }; });
  const calm = prefersReducedMotion();
  fg!.warmupTicks(calm ? 200 : 0).cooldownTicks(calm ? 0 : MOTION.graph.cooldownTicks).cooldownTime(MOTION.graph.settleMs);
  fitted = false;
  fg!.graphData({ nodes, links: shown.edges.map(e => ({ source: e.from, target: e.to })) });
  neighbourSet = focusSet();
  status.textContent = graph === null ? '' : summary(graph, shown); delete status.dataset.settled;
  renderList(); renderPanel(); syncControls();
  if (!paused && !listView) fg!.resumeAnimation();
}

function select(id: string | null, fromList: boolean): void {
  selected = id; neighbourSet = focusSet(); fadeTarget = id !== null || hovered !== null ? 1 : 0; fadeAt = performance.now();
  if (filter.local !== null) filter = { ...filter, local: id === null ? null : { id, depth: filter.local.depth } };
  if (id !== null && fg !== null && !fromList) { /* the picture stays where it is when you click in it */ }
  if (id !== null && fg !== null && fromList) { const n = (fg.graphData().nodes as FGNode[]).find(x => x.id === id); if (n?.x !== undefined && n.y !== undefined) fg.centerAt(n.x, n.y, ms(MOTION.graph.focus.ms)); }
  if (filter.local !== null) refresh(); else { renderPanel(); renderList(); }
}

function togglePause(): void { paused = !paused; if (fg !== null) { if (paused) fg.pauseAnimation(); else fg.resumeAnimation(); } pauseBtn.textContent = paused ? 'Resume' : 'Pause'; pauseBtn.setAttribute('aria-pressed', String(paused)); }

function syncView(): void {
  canvasBox.hidden = listView; listBox.hidden = !listView; listBtn.textContent = listView ? 'Show as a picture' : 'Show as a list';
  pauseBtn.disabled = listView;
  if (listView) fg?.pauseAnimation(); else if (!paused) fg?.resumeAnimation();
}

function fillSelect(sel: HTMLSelectElement, first: string, values: string[], current: string | null): void {
  sel.replaceChildren(); const o = el('option', '', first); o.value = ''; sel.append(o);
  for (const v of values) { const o2 = el('option', '', v === '' ? '(top level)' : v); o2.value = v; sel.append(o2); }
  sel.value = current ?? '';
}
function syncControls(): void {
  if (graph === null) return;
  const tops = [...new Set(graph.nodes.map(n => n.folder === '' ? '' : n.folder.split('/')[0]!))].sort();
  fillSelect(folderSel, 'All folders', tops.filter(t => t !== ''), filter.folder);
  fillSelect(tagSel, 'All tags', graph.tags, filter.tag);
  orphanBox.checked = filter.showOrphans; depthSel.value = filter.local === null ? '0' : String(filter.local.depth);
}

function pageButton(n: GraphNode): HTMLButtonElement { const b = btn(n.title, () => select(n.id, true), 'kg-link'); b.title = n.id; return b; }

let pageText: { id: string; text: string | null; note: string | null } | null = null;
function renderPanel(): void {
  panel.replaceChildren();
  const g = graph;
  if (g === null || store === null) return;
  panel.classList.remove('kg-in'); void panel.offsetWidth; panel.classList.add('kg-in');
  const by = g.nodes.find(n => n.id === selected);
  if (by === undefined) {
    panel.append(el('h2', '', store.name), el('p', 'muted', store.pages === null ? 'A knowledge folder.' : `${store.pages} pages.`), el('p', 'muted', 'Click a page in the picture, or choose one in the list, to see what it links to and what links to it.'));
  } else {
    const nb = neighbours(g, by.id);
    const close = btn('Close', () => select(null, false), 'bw-btn'); close.setAttribute('aria-label', 'Close the page panel');
    panel.append(el('h2', '', by.title), el('p', 'muted small kg-path', by.id));
    const meta = el('p', 'small'); meta.textContent = `${by.folder === '' ? 'Top level' : `Folder: ${by.folder}`}. ${by.bytes < 1024 ? `${by.bytes} bytes` : `${Math.round(by.bytes / 1024)} KB`}. ${by.orphan ? 'No links in or out.' : `${nb.out.length} out, ${nb.back.length} in.`}`; panel.append(meta);
    if (by.tags.length) { const t = el('p', 'kg-tags'); for (const x of by.tags) { const c = btn(`#${x}`, () => { filter = { ...filter, tag: x }; refresh(); }, 'kg-tag'); t.append(c); } panel.append(t); }
    const list = (title: string, nodes: GraphNode[]): void => { panel.append(el('h3', '', `${title} (${nodes.length})`)); if (!nodes.length) panel.append(el('p', 'muted small', 'None.')); else { const ul = el('ul', 'kg-ul'); for (const n of nodes) { const li = el('li'); li.append(pageButton(n)); ul.append(li); } panel.append(ul); } };
    list('Links to', nb.out); list('Linked from', nb.back);
    const read = btn('Read this page', async () => { const r = await api.getPageText({ storeKey: store!.key, page: by.id }); pageText = { id: by.id, ...r }; renderPanel(); });
    panel.append(el('div', 'kg-actions'), read, btn('Show only nearby pages', () => { filter = { ...filter, local: { id: by.id, depth: 1 } }; refresh(); }), close);
    if (pageText !== null && pageText.id === by.id) { const pre = el('pre', 'file', pageText.text ?? pageText.note ?? ''); pre.tabIndex = 0; panel.append(pre); }
  }
  const d = el('details', 'explain'); d.append(el('summary', '', 'Bowerloom items that point at this store'));
  const pointing = el('ul', 'kg-ul');
  for (const r of store.readBy) pointing.append(el('li', '', `${r.name} ${r.how}.`));
  for (const m of store.manages) pointing.append(el('li', '', `Managed by ${m}.`));
  d.append(pointing.childElementCount ? pointing : el('p', 'muted small', 'Nothing in Bowerloom points at this store yet.')); panel.append(d);
}

function renderList(): void {
  listBox.replaceChildren();
  const rows = [...shown.nodes].sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title)).slice(0, 500);
  const ul = el('ul', 'kg-ul kg-rows');
  for (const n of rows) { const li = el('li'); const b = pageButton(n); b.setAttribute('aria-current', String(n.id === selected)); li.append(b, el('span', 'small muted', ` ${n.folder === '' ? 'top level' : n.folder}, ${n.degree} ${n.degree === 1 ? 'link' : 'links'}${n.orphan ? ', orphan' : ''}`)); ul.append(li); }
  listBox.append(ul);
  if (shown.nodes.length > rows.length) listBox.append(el('p', 'muted small', `Showing the ${rows.length} pages with the most links. Use the search or the filters to narrow it.`));
}

async function load(next: StoreChoice | null): Promise<void> {
  const token = ++loadToken;
  store = next; graph = null; selected = null; hovered = null; pageText = null; filter = NO_FILTER; neighbourSet = new Set();
  notices.replaceChildren(); panel.replaceChildren();
  if (next === null) { status.textContent = 'There is no context store to show yet.'; fg?.graphData({ nodes: [], links: [] }); return; }
  status.textContent = 'Reading the pages…';
  const result = await api.getKnowledgeGraph(next.key);
  if (token !== loadToken) return;
  if (!result.ok || result.graph === null) { status.textContent = result.message ?? 'The store could not be read.'; return; }
  graph = result.graph;
  for (const n of graph.notices) { const p = el('p', 'warning kg-notice', n); p.setAttribute('role', 'note'); notices.append(p); }
  if (graph.broken > 0) notices.append(el('p', 'muted small', `${graph.broken} ${graph.broken === 1 ? 'link points' : 'links point'} at a page that is not in the store.`));
  refresh();
}

function build(): void {
  built = true;
  searchBox.type = 'search'; searchBox.placeholder = 'Search pages'; searchBox.setAttribute('aria-label', 'Search pages');
  searchBox.addEventListener('input', () => { filter = { ...filter, search: searchBox.value }; refresh(); });
  picker.setAttribute('aria-label', 'Context store'); picker.addEventListener('change', () => { void load(choices.find(c => c.key === picker.value) ?? null); });
  folderSel.setAttribute('aria-label', 'Folder'); folderSel.addEventListener('change', () => { filter = { ...filter, folder: folderSel.value || null }; refresh(); });
  tagSel.setAttribute('aria-label', 'Tag'); tagSel.addEventListener('change', () => { filter = { ...filter, tag: tagSel.value || null }; refresh(); });
  for (const [v, l] of [['folder', 'Colour by folder'], ['tag', 'Colour by tag']] as const) { const o = el('option', '', l); o.value = v; colourSel.append(o); }
  colourSel.setAttribute('aria-label', 'Colour pages by'); colourSel.addEventListener('change', () => { colourBy = colourSel.value === 'tag' ? 'tag' : 'folder'; });
  for (const [v, l] of [['0', 'Whole graph'], ['1', 'Selected page and 1 step'], ['2', 'Selected page and 2 steps']] as const) { const o = el('option', '', l); o.value = v; depthSel.append(o); }
  depthSel.setAttribute('aria-label', 'How much of the graph to show'); depthSel.addEventListener('change', () => { const d = Number(depthSel.value); filter = { ...filter, local: d === 0 || selected === null ? null : { id: selected, depth: d === 2 ? 2 : 1 } }; if (d !== 0 && selected === null) { depthSel.value = '0'; status.textContent = 'Choose a page first, then show only its neighbours.'; return; } refresh(); });
  orphanBox.type = 'checkbox'; orphanBox.checked = true; orphanBox.addEventListener('change', () => { filter = { ...filter, showOrphans: orphanBox.checked }; refresh(); });
  const orphanLabel = el('label', 'kg-check'); orphanLabel.append(orphanBox, ' Show pages with no links');
  const fit = btn('Fit all', fitAll);
  const reset = btn('Clear filters', () => { filter = NO_FILTER; searchBox.value = ''; refresh(); });
  const bar = el('div', 'bw-toolbar kg-bar'); bar.append(picker, searchBox, folderSel, tagSel, colourSel, depthSel, orphanLabel, fit, pauseBtn, listBtn, reset);
  const stage = el('div', 'kg-stage'); canvasBox.setAttribute('role', 'img'); canvasBox.setAttribute('aria-label', 'A picture of the pages and their links. Use "Show as a list" for a version you can read and move through with the keyboard.');
  listBox.hidden = true; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const left = el('div', 'kg-main'); left.append(canvasBox, listBox);
  stage.append(left, panel);
  host.append(bar, status, notices, stage);
}

/** Puts the screen into the page and returns its element. The same element each time, so the picture and its place are kept. */
export function knowledgeHost(props: KnowledgeProps): HTMLElement {
  api = props.api;
  if (!built) build();
  const next = storeChoices(props.snapshot);
  const same = next.length === choices.length && next.every((c, i) => c.key === choices[i]!.key);
  choices = next;
  if (!same) {
    picker.replaceChildren(); for (const c of choices) { const o = el('option', '', `${c.name}${c.kind === 'knowledge-folder' ? ' (knowledge folder)' : ''}`); o.value = c.key; picker.append(o); }
    picker.hidden = choices.length <= 1;
    const wanted = choices.find(c => c.key === props.storeKey) ?? choices.find(c => c.key === store?.key) ?? choices[0] ?? null;
    if (wanted !== null) picker.value = wanted.key;
    void load(wanted);
  }
  return host;
}
