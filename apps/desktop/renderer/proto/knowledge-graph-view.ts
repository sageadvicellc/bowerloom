/**
 * The wiki graph of the Knowledge screen, drawn on a canvas by force-graph (a fork of the 0.7 graph code: renderer/graph/ is not touched).
 * It owns the canvas and the lasso. React gives it data and the lit set; it tells React what the lasso picked.
 *
 * Motion (Jhey leads this surface). The graph settles into place and then STOPS. force-graph keeps a drawing loop of its own that never ends
 * (it asks for a frame about 120 times a second even when nothing changes), so `rest()` pauses it, and anything that needs a frame wakes it
 * (`wake`): the pointer moving over the graph, the lasso, a new slice, a resize, the Fit button, a layout that wakes up. A woken loop sleeps again
 * after a short idle time (`IDLE_MS`), and never while the layout is running, a fade is under way, or the pointer is down.
 * With "reduce motion" on, the layout runs before the first drawing and the graph appears settled.
 * The lit and dim change fades in `MOTION.graph.highlight.ms`. The lasso (Emil) has no delay: it draws as the pointer moves.
 *
 * Words on the picture. The eight domain folders are named on the graph (a pill at the middle of each, in its colour and shape), the pages with
 * the most links are named when there is room, and a pill is dropped when it would cover another. The page under the pointer is named by a small
 * box next to the pointer. Colour is never the only cue: each domain has its own shape (knowledge-shapes.ts).
 *
 * Lasso. force-graph can suspend its own gestures while the lasso is on: enablePanInteraction, enableZoomInteraction, enableNodeDrag and
 * enablePointerInteraction all take false. A loop is drawn on an overlay canvas that takes the pointer; its points go to graph space with
 * screen2GraphCoords(x, y) (x and y in CSS pixels from the canvas corner), and the pages inside are found in graph space.
 */
import type { LassoMode, Point } from '../../shared/proto/slice-lasso.js';
import { lassoMode, nearestNode, nodesInPolygon, polygonBounds, thinPath } from '../../shared/proto/slice-lasso.js';
import { shapeOf, traceShape } from './knowledge-shapes.js';
import type { WikiPage } from '../../shared/proto/types.js';
import { MOTION, ms } from '../motion-tokens.js';

/** A page as the graph holds it. */
export interface GraphNode { id: string; title: string; folder: string; domain: number; degree: number; x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }
interface GraphLink { source: string | GraphNode; target: string | GraphNode }

/** What the picture needs to know to draw a slice. */
export interface GraphLook {
  readonly lit: ReadonlySet<string>;
  /** The picked pages, drawn with a ring. */
  readonly marked: ReadonlySet<string>;
  /** The links that leave the slice, as "from>to". Drawn dashed. */
  readonly cut: ReadonlySet<string>;
}

/** What the picture tells the screen. */
export interface GraphEvents {
  onLasso(ids: string[], mode: LassoMode): void;
  /** While the pointer is down: how many pages are inside the loop now. */
  onLassoMove(inside: number): void;
  onPageClick(id: string): void;
  onSettled(): void;
}

/** The domain folders in order; a page's colour is the place of its domain here. */
export const domainsOf = (pages: readonly WikiPage[]): string[] => [...new Set(pages.map(p => p.folder.split('/')[0]!))].sort();

const SLOTS = 8;
/** How strongly a page outside the slice shows. Low enough to read as dim, high enough to still see the shape of the wiki. */
const DIM_ALPHA = 0.4;
/** How long force-graph's drawing loop keeps running after the last thing that needed a frame. */
export const IDLE_MS = 700;
/** The size of every word on the picture, in screen pixels. Never smaller, whatever the zoom. */
export const LABEL_PX = 12.5;
/** The most that the ring of domain anchors is stretched across a wide picture (1 is a circle). */
const MAX_WIDE = 1.8;
/** Space kept around the pages when the picture is fitted, in pixels. */
const FIT_PAD = 26;
/** How many pages are named for their links, and how many of the lit pages. */
export const NAMED_TOP = 12;
export const NAMED_LIT = 6;
/** Where each page rested after the last layout, per page list. A visit after the first starts settled. */
const rested = new WeakMap<readonly WikiPage[], Map<string, { x: number; y: number }>>();

const cssVar = (style: CSSStyleDeclaration, name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const cutKey = (from: string, to: string): string => `${from}>${to}`;

/** `#rrggbb` with an opacity, as a canvas colour. Anything else is returned as it is. */
export function withAlpha(colour: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour);
  if (m === null) return colour;
  const n = parseInt(m[1]!, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A rectangle on the picture, in graph units. */
export interface Box { x0: number; y0: number; x1: number; y1: number }
export const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * Chooses which of the wanted labels fit. `want` is in order of importance; the first rectangle that does not cover one already chosen is kept,
 * and one that does is dropped. A label may offer several places (above, below, beside), and the first free place wins.
 */
export function placeLabels<T>(want: readonly { key: T; spots: readonly Box[] }[], visible: (b: Box) => boolean = () => true): { key: T; box: Box }[] {
  const out: { key: T; box: Box }[] = [];
  for (const w of want) {
    const spot = w.spots.find(b => visible(b) && !out.some(o => overlaps(o.box, b)));
    if (spot !== undefined) out.push({ key: w.key, box: spot });
  }
  return out;
}

/**
 * How strongly a link is drawn: 0 for one that touches neither the lit slice nor the page under the pointer (it is faint), 1 for one that touches the
 * slice, 2 for one inside the slice, 3 for one on the page under the pointer. With nothing lit (a new slice) every link is a plain link, 1.
 * While a page is pointed at, the pointer decides and the slice does not.
 */
export function linkRank(lit: ReadonlySet<string>, hovered: string | null, a: string, b: string): 0 | 1 | 2 | 3 {
  if (hovered !== null) return a === hovered || b === hovered ? 3 : 0;
  if (lit.size === 0) return 1;
  const la = lit.has(a), lb = lit.has(b);
  return la && lb ? 2 : la || lb ? 1 : 0;
}

/** A label that was drawn in the last frame, in screen pixels from the corner of the picture. For a test and for a screenshot check. */
export interface DrawnLabel { readonly kind: 'hub' | 'page'; readonly text: string; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly fontPx: number }

/** What the status line says when the graph could not be built. The page list and the rule builder do not depend on the graph. */
export const GRAPH_FAILED_WORDS = 'The graph could not be drawn. The list of pages still works.';

/** Starts a view and tells `onFailed` if it cannot start (the library did not load, or the drawing code threw). Never throws and never leaves a promise unhandled. */
export async function startGraph(view: { start(pages: readonly WikiPage[]): Promise<void> }, pages: readonly WikiPage[], onFailed: (error: unknown) => void): Promise<void> {
  try { await view.start(pages); } catch (error) { onFailed(error); }
}

export class GraphView {
  private fg: import('force-graph').default | null = null;
  private nodes: GraphNode[] = [];
  private links: GraphLink[] = [];
  private look: GraphLook = { lit: new Set(), marked: new Set(), cut: new Set() };
  private before: ReadonlySet<string> = new Set();
  private fade = 1;
  private raf = 0;
  private scale = 1;
  private hovered: string | null = null;
  private lassoOn = false;
  private palette: string[] = [];
  private domains: string[] = [];
  private font = 'sans-serif';
  private ink = '#222'; private muted = '#666'; private faint = '#ccc'; private surface = '#fff'; private accent = '#2c5039'; private soft = '#e2eee6';
  private tone = { lit: '#666', quiet: '#ccc', strong: '#222' };
  private observers: (ResizeObserver | MutationObserver)[] = [];
  private path: Point[] = [];
  private graphPath: Point[] = [];
  private dragging = false;
  private overlayFrame = 0;
  private lastInside = -1;
  private disposed = false;
  private fitted = false;
  private looked = false;
  private held: GraphNode[] = [];
  private pageList: readonly WikiPage[] = [];
  private viewW = 0; private viewH = 0;
  private sleepTimer: ReturnType<typeof setTimeout> | undefined;
  private sleepFor = 0;
  private engineRunning = true;
  private pointerDown = false;
  private userView = false;
  private refitTimer: ReturnType<typeof setTimeout> | undefined;
  private pointer = { x: 0, y: 0 };
  private topDegree: GraphNode[] = [];
  private topLit: GraphNode[] = [];
  private byId = new Map<string, GraphNode>();
  private drawn: DrawnLabel[] = [];

  constructor(private readonly host: HTMLElement, private readonly overlay: HTMLCanvasElement, private readonly events: GraphEvents, private readonly tip: HTMLElement | null = null) {}

  /** Builds the picture and starts the layout. The library loads on first use, so a page that never shows the graph never pays for it. */
  async start(pages: readonly WikiPage[]): Promise<void> {
    this.pageList = pages;
    const { default: ForceGraph } = await import('force-graph');
    if (this.disposed) return;
    this.readColours();
    const domains = domainsOf(pages), index = new Map(domains.map((d, i) => [d, i] as const));
    this.domains = domains;
    const degree = new Map<string, number>(), known = new Set(pages.map(p => p.id)), seen = new Set<string>(), links: GraphLink[] = [];
    for (const p of pages) for (const to of p.links) {
      const k = `${p.id}>${to}`;
      if (to === p.id || !known.has(to) || seen.has(k)) continue;
      seen.add(k); links.push({ source: p.id, target: to });
      degree.set(p.id, (degree.get(p.id) ?? 0) + 1); degree.set(to, (degree.get(to) ?? 0) + 1);
    }
    const memory = rested.get(pages);
    this.nodes = pages.map(p => {
      const at = memory?.get(p.id);
      return { id: p.id, title: p.title, folder: p.folder, domain: index.get(p.folder.split('/')[0]!) ?? 0, degree: degree.get(p.id) ?? 0, ...(at === undefined ? {} : { x: at.x, y: at.y, fx: at.x, fy: at.y }) };
    });
    this.byId = new Map(this.nodes.map(n => [n.id, n] as const));
    this.topDegree = [...this.nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)).slice(0, NAMED_TOP);
    this.links = links;

    const calm = ms(1) === 0;
    // A reduced-motion visit, or a visit after the first, starts settled: the layout runs before the first drawing, or not at all.
    const warm = memory !== undefined ? 0 : calm ? Math.max(MOTION.graph.warmup.min, Math.min(MOTION.graph.warmup.max, Math.floor(MOTION.graph.warmup.budget / Math.max(1, this.nodes.length)))) : 0;
    const cool = memory !== undefined || calm ? 0 : MOTION.graph.cooldownTicks;

    const fg = new ForceGraph(this.host) as import('force-graph').default;
    this.fg = fg;
    fg.nodeId('id').nodeLabel(() => '').backgroundColor('rgba(0,0,0,0)')
      .d3AlphaDecay(MOTION.graph.alphaDecay).d3VelocityDecay(MOTION.graph.velocityDecay)
      .linkDirectionalArrowLength(0)
      .linkColor((l: object) => this.linkColour(l as GraphLink)).linkWidth((l: object) => this.linkWidth(l as GraphLink))
      .linkLineDash((l: object) => (this.isCut(l as GraphLink) ? [6 / this.scale, 4 / this.scale] : null))
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject((n: object, ctx: CanvasRenderingContext2D, k: number) => this.paintNode(n as GraphNode, ctx, k))
      .nodePointerAreaPaint((n: object, colour: string, ctx: CanvasRenderingContext2D) => { const p = n as GraphNode; ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(p.x ?? 0, p.y ?? 0, this.radius(p) + 2, 0, 2 * Math.PI); ctx.fill(); })
      .onRenderFramePre((_ctx: CanvasRenderingContext2D, k: number) => { this.scale = k; })
      .onRenderFramePost((ctx: CanvasRenderingContext2D, k: number) => this.paintLabels(ctx, k))
      .onNodeClick((n: object) => this.events.onPageClick((n as GraphNode).id))
      .onNodeDrag(() => { this.engineRunning = true; this.userView = true; this.wake(); })
      .warmupTicks(warm).cooldownTicks(cool).cooldownTime(MOTION.graph.settleMs)
      .onEngineStop(() => this.rest());
    // Pages of one domain gather around their own point, so the colours form groups. Pages with no links would otherwise drift apart.
    // On a wide, short picture the ring of anchors is stretched to match, so the network fills the picture instead of sitting small in the middle.
    const box = this.host.getBoundingClientRect(), wide = box.width > 0 && box.height > 0 ? Math.max(1, Math.min(MAX_WIDE, box.width / box.height)) : 1;
    const anchors = domains.map((_, i) => ({ x: 230 * wide * Math.cos((2 * Math.PI * i) / domains.length), y: 230 * Math.sin((2 * Math.PI * i) / domains.length) }));
    const gather = Object.assign((alpha: number): void => {
      for (const n of this.held) { const a = anchors[n.domain]!; n.vx = (n.vx ?? 0) + (a.x - (n.x ?? 0)) * 0.11 * alpha; n.vy = (n.vy ?? 0) + (a.y - (n.y ?? 0)) * 0.11 * alpha; }
    }, { initialize: (list: GraphNode[]): void => { this.held = list; } });
    fg.d3Force('gather', gather as never);
    const charge = fg.d3Force('charge') as { strength?: (v: number) => { distanceMax?: (v: number) => unknown } } | undefined;
    charge?.strength?.(-90);
    (fg.d3Force('charge') as { distanceMax?: (v: number) => unknown } | undefined)?.distanceMax?.(130);
    (fg.d3Force('link') as { distance?: (v: number) => unknown } | undefined)?.distance?.(26);
    this.size();
    this.observers.push(new ResizeObserver(() => this.size()), new MutationObserver(() => { this.readColours(); this.repaint(); }));
    (this.observers[0] as ResizeObserver).observe(this.host);
    (this.observers[1] as MutationObserver).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // In the capture phase: the zoom and drag code of force-graph stops these events at the canvas, and they would never reach the host.
    this.host.addEventListener('pointermove', this.onHostMove, { passive: true, capture: true });
    this.host.addEventListener('pointerleave', this.onHostLeave, { passive: true });
    this.host.addEventListener('pointerdown', this.onHostDown, { passive: true, capture: true });
    this.host.addEventListener('pointerup', this.onHostUp, { passive: true, capture: true });
    this.host.addEventListener('wheel', this.onHostWheel, { passive: true, capture: true });
    this.host.dataset.settled = '0';
    // A seam for the real-window test: it asks where a page is on the screen, to draw a loop around it.
    (this.host as HTMLElement & { graphView?: GraphView }).graphView = this;
    this.engineRunning = true;
    fg.graphData({ nodes: this.nodes, links: this.links });
    this.applyLasso();
  }

  private radius(n: GraphNode): number { return 3.2 + Math.min(7, Math.sqrt(n.degree) * 1.5); }

  private readColours(): void {
    const style = getComputedStyle(this.host);
    this.palette = Array.from({ length: SLOTS }, (_, i) => cssVar(style, `--graph-${i + 1}`, '#5b5fa3'));
    this.ink = cssVar(style, '--text', '#222'); this.muted = cssVar(style, '--text-muted', '#666'); this.faint = cssVar(style, '--border', '#ccc'); this.surface = cssVar(style, '--surface', '#fff');
    this.accent = cssVar(style, '--accent-strong', '#2c5039'); this.soft = cssVar(style, '--accent-soft', '#e2eee6');
    this.font = cssVar(style, '--font-body', 'sans-serif');
    // Links in three strengths: a link on the page that is pointed at, a link that touches the slice, and a link that does not.
    this.tone = { strong: this.ink, lit: withAlpha(this.ink, 0.4), quiet: withAlpha(this.ink, 0.14) };
  }

  private size(): void {
    const r = this.host.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    this.viewW = Math.floor(r.width); this.viewH = Math.floor(r.height);
    this.fg?.width(this.viewW).height(this.viewH);
    const ratio = window.devicePixelRatio || 1;
    this.overlay.width = Math.floor(r.width * ratio); this.overlay.height = Math.floor(r.height * ratio);
    this.overlay.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
    // A new size is drawn at once. If the person has not moved the view, the picture is fitted to the new size.
    this.wake(500);
    if (this.fitted && !this.userView) { clearTimeout(this.refitTimer); this.refitTimer = setTimeout(() => { if (!this.disposed && !this.userView) this.fg?.zoomToFit(0, FIT_PAD, this.fitFilter()); }, 120); }
  }

  // ---- The drawing loop ----

  /** Starts force-graph's drawing loop if it was paused, and lets it sleep again `hold` ms after the last call. */
  private wake(hold = IDLE_MS): void {
    if (this.fg === null || this.disposed) return;
    this.fg.resumeAnimation();
    // The latest call decides when the loop sleeps, so a shorter wait after a longer one does not cut the longer one short.
    this.sleepFor = Math.max(hold, this.sleepTimer === undefined ? 0 : this.sleepFor);
    clearTimeout(this.sleepTimer);
    this.sleepTimer = setTimeout(() => this.sleep(), this.sleepFor);
  }

  /** Stops the loop, unless something still needs it. This runs from a timer, never from inside a frame: a pause inside a frame is undone by that frame. */
  private sleep(): void {
    this.sleepTimer = undefined; this.sleepFor = 0;
    if (this.fg === null || this.disposed) return;
    if (this.engineRunning || this.fade < 1 || this.dragging || this.pointerDown) { this.wake(); return; }
    this.fg.pauseAnimation();
  }

  /** The labels drawn in the last frame, for a test: their words, kind and place on the screen. */
  labels(): readonly DrawnLabel[] { return this.drawn; }

  /** True while force-graph's drawing loop is running, for a test. */
  looping(): boolean { return this.sleepTimer !== undefined || this.engineRunning; }

  // ---- Lit and dim ----

  /** Gives the picture a new slice to light. The change fades in; with reduced motion it is at once. */
  setLook(look: GraphLook): void {
    // The first look appears at once. After that, the change fades from the old lit set to the new one.
    this.before = this.looked && look.lit !== this.look.lit ? this.look.lit : look.lit;
    this.looked = true;
    this.look = look;
    // The pages named for a lit slice: the ones with the most links inside the whole wiki.
    this.topLit = look.lit.size === 0 || look.lit.size === this.nodes.length ? [] : this.nodes.filter(n => look.lit.has(n.id)).sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id)).slice(0, NAMED_LIT);
    this.beginFade();
  }

  private beginFade(): void {
    cancelAnimationFrame(this.raf);
    const dur = ms(MOTION.graph.highlight.ms);
    if (dur === 0 || this.fg === null) { this.fade = 1; this.repaint(); return; }
    this.fade = 0;
    let start: number | null = null;
    const step = (ts: number): void => {
      if (start === null) start = ts;
      this.fade = Math.min(1, (ts - start) / dur);
      this.repaint();
      this.raf = this.fade < 1 ? requestAnimationFrame(step) : 0;
    };
    this.raf = requestAnimationFrame(step);
  }

  /** force-graph draws again only when something moves, so a change that moves nothing has to ask. Setting the centre to itself does, and a paused loop is woken to draw it. */
  private repaint(): void {
    if (this.fg === null) return;
    const c = this.fg.centerAt();
    this.fg.centerAt(c.x, c.y);
    this.wake(250);
  }

  private alphaOf(id: string): number {
    const dim = DIM_ALPHA;
    const was = this.before.has(id) ? 1 : dim, now = this.look.lit.has(id) ? 1 : dim;
    return was + (now - was) * easeOut(this.fade);
  }

  private paintNode(n: GraphNode, ctx: CanvasRenderingContext2D, k: number): void {
    const x = n.x ?? 0, y = n.y ?? 0, lit = this.look.lit.has(n.id), hovered = n.id === this.hovered, alpha = hovered ? 1 : this.alphaOf(n.id);
    // A lit page is bigger and has an outline. A dim page is smaller, faint, and has none. Colour is not the only difference: each domain has its own shape.
    const r = this.radius(n) * (lit || hovered ? 1.15 : 0.8);
    ctx.globalAlpha = alpha;
    traceShape(ctx, n.domain, x, y, r);
    ctx.fillStyle = this.palette[n.domain % SLOTS] ?? '#5b5fa3'; ctx.fill();
    if (lit) { ctx.lineWidth = 1.3 / k; ctx.strokeStyle = this.ink; ctx.stroke(); }
    if (hovered) {
      ctx.lineWidth = 2 / k; ctx.strokeStyle = this.ink; ctx.stroke();
      ctx.lineWidth = 1 / k; ctx.strokeStyle = this.surface; ctx.beginPath(); ctx.arc(x, y, r + 2.5 / k, 0, 2 * Math.PI); ctx.stroke();
      ctx.lineWidth = 1.5 / k; ctx.strokeStyle = this.ink; ctx.beginPath(); ctx.arc(x, y, r + 4 / k, 0, 2 * Math.PI); ctx.stroke();
    }
    if (this.look.marked.has(n.id)) {
      ctx.globalAlpha = 1; ctx.lineWidth = 2 / k; ctx.strokeStyle = this.accent;
      ctx.beginPath(); ctx.arc(x, y, r + 3 / k, 0, 2 * Math.PI); ctx.stroke();
      ctx.lineWidth = 1 / k; ctx.strokeStyle = this.surface; ctx.beginPath(); ctx.arc(x, y, r + 1.4 / k, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---- Words on the picture ----

  /** Names the domain folders and the busiest pages, after every page is drawn. A pill that would cover another is dropped. */
  private paintLabels(ctx: CanvasRenderingContext2D, k: number): void {
    const fg = this.fg;
    if (fg === null || this.nodes.length === 0 || this.viewW === 0) return;
    const px = LABEL_PX / k, padX = 6 / k, padY = 3.5 / k, h = px + 2 * padY, gap = 4 / k, glyph = 4.5 / k, glyphSpace = glyph * 2 + 5 / k;
    const tl = fg.screen2GraphCoords(0, 0), br = fg.screen2GraphCoords(this.viewW, this.viewH);
    const visible = (b: Box): boolean => b.x1 > tl.x && b.x0 < br.x && b.y1 > tl.y && b.y0 < br.y;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';

    // The middle of each domain, and how many pages it holds.
    const hubs = this.domains.map((name, domain) => ({ name, domain, x: 0, y: 0, count: 0 }));
    for (const n of this.nodes) { const hub = hubs[n.domain]; if (hub !== undefined && n.x !== undefined && n.y !== undefined) { hub.x += n.x; hub.y += n.y; hub.count += 1; } }
    const hubFont = `600 ${px}px ${this.font}`, pageFont = `500 ${px}px ${this.font}`;
    ctx.font = hubFont;
    const wanted: { key: { kind: 'hub'; hub: (typeof hubs)[number]; text: string; w: number } | { kind: 'page'; node: GraphNode; text: string; w: number }; spots: Box[] }[] = [];
    for (const hub of [...hubs].filter(x => x.count > 0).sort((a, b) => b.count - a.count)) {
      const w = padX * 2 + glyphSpace + ctx.measureText(hub.name).width, cx = hub.x / hub.count, cy = hub.y / hub.count;
      // The middle of the domain first. If another domain's pill is already there, one pill's height above or below is tried before the label is dropped.
      const at = (dy: number): Box => ({ x0: cx - w / 2, x1: cx + w / 2, y0: cy + dy - h / 2, y1: cy + dy + h / 2 });
      wanted.push({ key: { kind: 'hub', hub, text: hub.name, w }, spots: [at(0), at(-(h + gap / 2)), at(h + gap / 2)] });
    }
    const ramp = clamp01((k - 0.5) / 0.25);
    ctx.font = pageFont;
    if (ramp > 0) {
      const seen = new Set<string>();
      for (const n of [...this.topLit, ...this.topDegree]) {
        if (seen.has(n.id) || n.x === undefined || n.y === undefined) continue;
        seen.add(n.id);
        const text = n.title.length > 30 ? `${n.title.slice(0, 29)}…` : n.title, w = padX * 2 + glyphSpace + ctx.measureText(text).width, rr = this.radius(n) * 1.15 + gap;
        wanted.push({ key: { kind: 'page', node: n, text, w }, spots: [
          { x0: n.x - w / 2, x1: n.x + w / 2, y1: n.y - rr, y0: n.y - rr - h },
          { x0: n.x - w / 2, x1: n.x + w / 2, y0: n.y + rr, y1: n.y + rr + h },
          { x0: n.x + rr, x1: n.x + rr + w, y0: n.y - h / 2, y1: n.y + h / 2 },
          { x0: n.x - rr - w, x1: n.x - rr, y0: n.y - h / 2, y1: n.y + h / 2 },
        ] });
      }
    }
    const chosen = placeLabels(wanted, visible);
    this.drawn = chosen.map(({ key, box }) => ({ kind: key.kind, text: key.text, x0: (box.x0 - tl.x) * k, y0: (box.y0 - tl.y) * k, x1: (box.x1 - tl.x) * k, y1: (box.y1 - tl.y) * k, fontPx: LABEL_PX }));
    for (const { key, box } of chosen) {
      const hub = key.kind === 'hub', domain = hub ? key.hub.domain : key.node.domain, colour = this.palette[domain % SLOTS] ?? '#5b5fa3';
      const dimmed = !hub && this.look.lit.size > 0 && !this.look.lit.has(key.node.id);
      const alpha = hub ? 1 : ramp * (dimmed ? 0.85 : 1), w = box.x1 - box.x0, cy = (box.y0 + box.y1) / 2;
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.roundRect(box.x0, box.y0, w, h, h / 2);
      ctx.fillStyle = this.surface; ctx.fill();
      if (hub) { ctx.globalAlpha = alpha * 0.22; ctx.fillStyle = colour; ctx.fill(); ctx.globalAlpha = alpha; }
      ctx.lineWidth = (hub ? 1.6 : 1) / k; ctx.strokeStyle = hub ? colour : this.faint; ctx.stroke();
      traceShape(ctx, domain, box.x0 + padX + glyph, cy, glyph); ctx.fillStyle = colour; ctx.fill();
      ctx.lineWidth = 0.8 / k; ctx.strokeStyle = this.ink; ctx.stroke();
      ctx.font = hub ? hubFont : pageFont; ctx.fillStyle = this.ink;
      ctx.fillText(key.text, box.x0 + padX + glyphSpace, cy);
    }
    ctx.globalAlpha = 1;
  }

  private ends(l: GraphLink): [string, string] { return [typeof l.source === 'object' ? l.source.id : l.source, typeof l.target === 'object' ? l.target.id : l.target]; }
  private isCut(l: GraphLink): boolean { const [a, b] = this.ends(l); return this.look.cut.has(cutKey(a, b)); }
    private rankOf(l: GraphLink): 0 | 1 | 2 | 3 { const [a, b] = this.ends(l); return linkRank(this.look.lit, this.hovered, a, b); }
  private linkColour(l: GraphLink): string {
    const [a, b] = this.ends(l);
    const rank = this.rankOf(l);
    if (this.hovered === null && this.look.cut.has(cutKey(a, b))) return this.ink;
    return rank === 3 ? this.tone.strong : rank === 2 ? this.accent : rank === 1 ? this.tone.lit : this.tone.quiet;
  }
  private linkWidth(l: GraphLink): number {
    const [a, b] = this.ends(l);
    const rank = this.rankOf(l);
    if (this.hovered === null && this.look.cut.has(cutKey(a, b))) return 1.6;
    return rank === 3 ? 1.8 : rank === 2 ? 1.3 : rank === 1 ? 0.8 : 0.5;
  }

  // ---- The pointer over the picture ----

  /** The page under a point (CSS pixels from the canvas corner), or null. The reach is a few pixels past the edge of the page. */
  pageAt(px: number, py: number): GraphNode | null {
    const fg = this.fg;
    if (fg === null) return null;
    const g = fg.screen2GraphCoords(px, py), k = fg.zoom();
    let best: GraphNode | null = null, bestGap = Infinity;
    for (const n of this.nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const gap = Math.hypot(n.x - g.x, n.y - g.y) * k - this.radius(n) * 1.15 * k;
      if (gap <= 3 && gap < bestGap) { bestGap = gap; best = n; }
    }
    return best;
  }

  private readonly onHostMove = (e: PointerEvent): void => {
    if (this.fg === null || this.lassoOn) return;
    this.wake();
    const r = this.host.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    // Dragging the background moves the view; dragging a page moves the page. Either way, it is the person's view now.
    if (e.buttons !== 0) { this.userView = true; this.hover(null); return; }
    this.hover(this.pageAt(this.pointer.x, this.pointer.y));
  };
  private readonly onHostLeave = (): void => { this.hover(null); };
  private readonly onHostDown = (): void => { this.pointerDown = true; this.wake(); };
  private readonly onHostUp = (): void => { this.pointerDown = false; this.wake(); };
  private readonly onHostWheel = (): void => { if (this.lassoOn) return; this.userView = true; this.wake(); };

  private hover(n: GraphNode | null): void {
    const id = n === null ? null : n.id;
    if (id !== this.hovered) { this.hovered = id; this.repaint(); }
    const tip = this.tip;
    if (tip === null) return;
    if (n === null) { tip.hidden = true; return; }
    if (tip.dataset.page !== n.id) {
      tip.dataset.page = n.id;
      const title = document.createElement('strong'), where = document.createElement('span');
      title.textContent = n.title;
      where.textContent = `Folder ${this.domains[n.domain] ?? n.folder}, ${n.degree === 1 ? '1 link' : `${n.degree} links`}`;
      tip.replaceChildren(title, where);
    }
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = this.pointer.x + 16 + w > this.viewW - 4 ? this.pointer.x - 12 - w : this.pointer.x + 16;
    const y = this.pointer.y + 18 + h > this.viewH - 4 ? this.pointer.y - 12 - h : this.pointer.y + 18;
    tip.style.left = `${Math.max(4, Math.round(x))}px`; tip.style.top = `${Math.max(4, Math.round(y))}px`;
  }

  // ---- Settling ----

  private rest(): void {
    if (this.disposed || this.fg === null) return;
    const memory = new Map<string, { x: number; y: number }>();
    // A page held in place by a remembered layout is let go, so the person can still drag it later.
    for (const n of this.nodes) { memory.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 }); delete n.fx; delete n.fy; }
    rested.set(this.pageList, memory);
    // The first rest fits every page into the picture. Later rests (the layout woke up because a page was dragged) leave the view where the person put it.
    let hold = 150;
    if (!this.fitted) { this.fitted = true; this.fit(); hold = ms(MOTION.graph.focus.ms) + 150; }
    this.engineRunning = false;
    this.host.dataset.settled = '1';
    // A count of the times the layout came to rest, so a test can wait for the next rest after a drag.
    this.host.dataset.rests = String(Number(this.host.dataset.rests ?? '0') + 1);
    this.events.onSettled();
    // The layout has stopped, so force-graph's own drawing loop stops too (once the fit has been drawn). It starts again when something needs a frame.
    this.wake(hold);
  }

  /** The pages that the fit is made around: the pages near the middle. A few pages with no links drift far out, and fitting around them would shrink the network. */
  private fitFilter(): (n: object) => boolean {
    const placed = this.nodes.filter(n => n.x !== undefined && n.y !== undefined);
    if (placed.length < 20) return () => true;
    const med = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
    const mx = med(placed.map(n => n.x!)), my = med(placed.map(n => n.y!));
    const dist = placed.map(n => Math.hypot(n.x! - mx, n.y! - my)).sort((a, b) => a - b);
    const limit = dist[Math.floor(dist.length * 0.96)]!;
    return (n: object) => { const p = n as GraphNode; return p.x === undefined || p.y === undefined || Math.hypot(p.x - mx, p.y - my) <= limit; };
  }

  /** Fits the pages into the picture. */
  fit(): void {
    this.userView = false;
    this.wake(ms(MOTION.graph.focus.ms) + 150);
    this.fg?.zoomToFit(ms(MOTION.graph.focus.ms), FIT_PAD, this.fitFilter());
  }

  // ---- The lasso ----

  /** Turns the lasso on or off. While it is on, force-graph's own gestures are suspended and the overlay takes the pointer. */
  setLasso(on: boolean): void {
    this.lassoOn = on;
    this.applyLasso();
  }

  private applyLasso(): void {
    const fg = this.fg;
    if (fg !== null) {
      const free = !this.lassoOn;
      fg.enablePanInteraction(free).enableZoomInteraction(free).enableNodeDrag(free).enablePointerInteraction(free);
      this.wake();
    }
    this.overlay.classList.toggle('kn-lasso-on', this.lassoOn);
    if (this.lassoOn) this.hover(null);
    if (!this.lassoOn) { this.cancelLasso(); }
  }

  private local(e: PointerEvent): Point { const r = this.overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  /** Pointer handlers for the overlay. They are plain methods so the component can attach them. */
  readonly down = (e: PointerEvent): void => {
    if (!this.lassoOn || e.button !== 0 || this.fg === null) return;
    this.wake();
    this.overlay.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.dragging = true; this.lastInside = -1;
    this.path = [p]; this.graphPath = [this.fg.screen2GraphCoords(p.x, p.y)];
    this.drawLoop();
  };

  readonly move = (e: PointerEvent): void => {
    if (!this.dragging || this.fg === null) return;
    const p = this.local(e), before = this.path.length;
    thinPath(this.path, p, 2);
    if (this.path.length === before) return;
    this.graphPath.push(this.fg.screen2GraphCoords(p.x, p.y));
    // Drawing is not throttled: the loop follows the pointer with no delay. The count of pages inside is asked once per frame.
    this.drawLoop();
    if (this.overlayFrame === 0) this.overlayFrame = requestAnimationFrame(() => { this.overlayFrame = 0; this.countInside(); });
  };

  readonly up = (e: PointerEvent): void => {
    if (!this.dragging || this.fg === null) return;
    this.dragging = false;
    if (this.overlay.hasPointerCapture(e.pointerId)) this.overlay.releasePointerCapture(e.pointerId);
    const mode = lassoMode(e), bounds = polygonBounds(this.graphPath);
    let ids: string[];
    const tiny = bounds === null || this.path.length < 3 || ((bounds.maxX - bounds.minX) * this.scale < 8 && (bounds.maxY - bounds.minY) * this.scale < 8);
    if (tiny) {
      // A click with the lasso on picks the page under the pointer, if there is one.
      const g = this.graphPath[0]!, hit = nearestNode(this.nodes, g, 9 / this.scale);
      ids = hit === null ? [] : [hit];
    } else ids = nodesInPolygon(this.nodes, this.graphPath, bounds);
    this.clearLoop();
    this.events.onLasso(ids, mode);
  };

  readonly cancel = (): void => { this.cancelLasso(); };

  private cancelLasso(): void {
    this.dragging = false; this.path = []; this.graphPath = []; cancelAnimationFrame(this.overlayFrame); this.overlayFrame = 0;
    this.clearLoop();
  }

  private countInside(): void {
    if (!this.dragging) return;
    const n = nodesInPolygon(this.nodes, this.graphPath).length;
    if (n !== this.lastInside) { this.lastInside = n; this.events.onLassoMove(n); }
  }

  private clearLoop(): void { const c = this.overlay.getContext('2d'); c?.clearRect(0, 0, this.overlay.width, this.overlay.height); }

  private drawLoop(): void {
    const c = this.overlay.getContext('2d');
    if (c === null) return;
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (this.path.length < 2) return;
    c.beginPath(); c.moveTo(this.path[0]!.x, this.path[0]!.y);
    for (let i = 1; i < this.path.length; i += 1) c.lineTo(this.path[i]!.x, this.path[i]!.y);
    c.closePath();
    c.globalAlpha = 0.18; c.fillStyle = this.accent; c.fill(); c.globalAlpha = 1;
    c.lineWidth = 2.5; c.lineJoin = 'round'; c.strokeStyle = this.accent; c.setLineDash([]); c.stroke();
    c.lineWidth = 1; c.strokeStyle = this.surface; c.setLineDash([2, 5]); c.stroke(); c.setLineDash([]);
  }

  /** Where each page sits now, for a test or a screenshot. */
  placed(): readonly GraphNode[] { return this.nodes; }

  /** Screen position (CSS pixels from the canvas corner) of a page. */
  screenOf(id: string): Point | null {
    const n = this.nodes.find(x => x.id === id);
    return n === undefined || n.x === undefined || n.y === undefined || this.fg === null ? null : this.fg.graph2ScreenCoords(n.x, n.y);
  }

  /** The zoom and the centre of the view, for a test: it says whether the view moved, whatever the pages did. */
  viewport(): { k: number; x: number; y: number } | null {
    if (this.fg === null) return null;
    const c = this.fg.centerAt();
    return { k: this.fg.zoom(), x: c.x, y: c.y };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.overlayFrame);
    clearTimeout(this.sleepTimer); clearTimeout(this.refitTimer);
    for (const o of this.observers.splice(0)) o.disconnect();
    this.host.removeEventListener('pointermove', this.onHostMove, { capture: true }); this.host.removeEventListener('pointerleave', this.onHostLeave);
    this.host.removeEventListener('pointerdown', this.onHostDown, { capture: true }); this.host.removeEventListener('pointerup', this.onHostUp, { capture: true }); this.host.removeEventListener('wheel', this.onHostWheel, { capture: true });
    if (this.tip !== null) { this.tip.hidden = true; delete this.tip.dataset.page; }
    this.fg?.pauseAnimation();
    this.fg?._destructor();
    this.fg = null;
    this.host.replaceChildren();
  }
}
