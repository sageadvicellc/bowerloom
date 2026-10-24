/**
 * The wiki graph of the Knowledge screen, drawn on a canvas by force-graph (a fork of the 0.7 graph code: renderer/graph/ is not touched).
 * It owns the canvas and the lasso. React gives it data and the lit set; it tells React what the lasso picked.
 *
 * Motion (Jhey leads this surface). The graph settles into place and then STOPS: the engine cools by itself, and force-graph pauses its drawing
 * when nothing changes, so there is no loop. With "reduce motion" on, the layout runs before the first drawing and the graph appears settled.
 * The lit and dim change fades in `MOTION.graph.highlight.ms`. The lasso (Emil) has no delay: it draws as the pointer moves.
 *
 * Lasso. force-graph can suspend its own gestures while the lasso is on: enablePanInteraction, enableZoomInteraction, enableNodeDrag and
 * enablePointerInteraction all take false. A loop is drawn on an overlay canvas that takes the pointer; its points go to graph space with
 * screen2GraphCoords(x, y) (x and y in CSS pixels from the canvas corner), and the pages inside are found in graph space.
 */
import type { LassoMode, Point } from '../../shared/proto/slice-lasso.js';
import { lassoMode, nearestNode, nodesInPolygon, polygonBounds, thinPath } from '../../shared/proto/slice-lasso.js';
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
const DIM_ALPHA = 0.3;
/** Where each page rested after the last layout, per page list. A visit after the first starts settled. */
const rested = new WeakMap<readonly WikiPage[], Map<string, { x: number; y: number }>>();

const cssVar = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const easeOut = (t: number): number => 1 - (1 - t) ** 3;
export const cutKey = (from: string, to: string): string => `${from}>${to}`;

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
  private ink = '#222'; private muted = '#666'; private faint = '#ccc'; private surface = '#fff'; private accent = '#2c5039'; private soft = '#e2eee6';
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

  constructor(private readonly host: HTMLElement, private readonly overlay: HTMLCanvasElement, private readonly events: GraphEvents) {}

  /** Builds the picture and starts the layout. The library loads on first use, so a page that never shows the graph never pays for it. */
  async start(pages: readonly WikiPage[]): Promise<void> {
    this.pageList = pages;
    const { default: ForceGraph } = await import('force-graph');
    if (this.disposed) return;
    this.readColours();
    const domains = domainsOf(pages), index = new Map(domains.map((d, i) => [d, i] as const));
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
      .onNodeHover((n: object | null) => { const id = n === null ? null : (n as GraphNode).id; if (id !== this.hovered) { this.hovered = id; this.repaint(); } })
      .onNodeClick((n: object) => this.events.onPageClick((n as GraphNode).id))
      .warmupTicks(warm).cooldownTicks(cool).cooldownTime(MOTION.graph.settleMs)
      .onEngineStop(() => this.rest());
    // Pages of one domain gather around their own point, so the colours form groups. Pages with no links would otherwise drift apart.
    const anchors = domains.map((_, i) => ({ x: 230 * Math.cos((2 * Math.PI * i) / domains.length), y: 230 * Math.sin((2 * Math.PI * i) / domains.length) }));
    const gather = Object.assign((alpha: number): void => {
      for (const n of this.held) { const a = anchors[n.domain]!; n.vx = (n.vx ?? 0) + (a.x - (n.x ?? 0)) * 0.11 * alpha; n.vy = (n.vy ?? 0) + (a.y - (n.y ?? 0)) * 0.11 * alpha; }
    }, { initialize: (list: GraphNode[]): void => { this.held = list; } });
    fg.d3Force('gather', gather as never);
    const charge = fg.d3Force('charge') as { strength?: (v: number) => { distanceMax?: (v: number) => unknown } } | undefined;
    charge?.strength?.(-46);
    (fg.d3Force('charge') as { distanceMax?: (v: number) => unknown } | undefined)?.distanceMax?.(110);
    (fg.d3Force('link') as { distance?: (v: number) => unknown } | undefined)?.distance?.(26);
    this.size();
    this.observers.push(new ResizeObserver(() => this.size()), new MutationObserver(() => { this.readColours(); this.repaint(); }));
    (this.observers[0] as ResizeObserver).observe(this.host);
    (this.observers[1] as MutationObserver).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.host.dataset.settled = '0';
    // A seam for the real-window test: it asks where a page is on the screen, to draw a loop around it.
    (this.host as HTMLElement & { graphView?: GraphView }).graphView = this;
    fg.graphData({ nodes: this.nodes, links: this.links });
    this.applyLasso();
  }

  private radius(n: GraphNode): number { return 3.2 + Math.min(7, Math.sqrt(n.degree) * 1.5); }

  private readColours(): void {
    this.palette = Array.from({ length: SLOTS }, (_, i) => cssVar(`--graph-${i + 1}`, '#5b5fa3'));
    this.ink = cssVar('--text', '#222'); this.muted = cssVar('--text-muted', '#666'); this.faint = cssVar('--border', '#ccc'); this.surface = cssVar('--surface', '#fff');
    this.accent = cssVar('--accent-strong', '#2c5039'); this.soft = cssVar('--accent-soft', '#e2eee6');
  }

  private size(): void {
    const r = this.host.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    this.fg?.width(Math.floor(r.width)).height(Math.floor(r.height));
    const ratio = window.devicePixelRatio || 1;
    this.overlay.width = Math.floor(r.width * ratio); this.overlay.height = Math.floor(r.height * ratio);
    this.overlay.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  // ---- Lit and dim ----

  /** Gives the picture a new slice to light. The change fades in; with reduced motion it is at once. */
  setLook(look: GraphLook): void {
    // The first look appears at once. After that, the change fades from the old lit set to the new one.
    this.before = this.looked && look.lit !== this.look.lit ? this.look.lit : look.lit;
    this.looked = true;
    this.look = look;
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

  /** force-graph draws again only when something moves, so a change that moves nothing has to ask. Setting the centre to itself does. */
  private repaint(): void {
    if (this.fg === null) return;
    const c = this.fg.centerAt();
    this.fg.centerAt(c.x, c.y);
  }

  private alphaOf(id: string): number {
    const dim = DIM_ALPHA;
    const was = this.before.has(id) ? 1 : dim, now = this.look.lit.has(id) ? 1 : dim;
    return was + (now - was) * easeOut(this.fade);
  }

  private paintNode(n: GraphNode, ctx: CanvasRenderingContext2D, k: number): void {
    const x = n.x ?? 0, y = n.y ?? 0, lit = this.look.lit.has(n.id), alpha = this.alphaOf(n.id);
    // A lit page is bigger and has an outline. A dim page is smaller, faint, and has none. Colour is not the only difference.
    const r = this.radius(n) * (lit ? 1.15 : 0.8);
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = this.palette[n.domain % SLOTS] ?? '#5b5fa3'; ctx.fill();
    if (lit) { ctx.lineWidth = 1.3 / k; ctx.strokeStyle = this.ink; ctx.stroke(); }
    if (this.look.marked.has(n.id)) {
      ctx.globalAlpha = 1; ctx.lineWidth = 2 / k; ctx.strokeStyle = this.accent;
      ctx.beginPath(); ctx.arc(x, y, r + 3 / k, 0, 2 * Math.PI); ctx.stroke();
      ctx.lineWidth = 1 / k; ctx.strokeStyle = this.surface; ctx.beginPath(); ctx.arc(x, y, r + 1.4 / k, 0, 2 * Math.PI); ctx.stroke();
    }
    if (n.id === this.hovered) {
      ctx.globalAlpha = 1; ctx.font = `${12 / k}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const w = ctx.measureText(n.title).width;
      ctx.fillStyle = this.surface; ctx.fillRect(x - w / 2 - 3 / k, y - r - 17 / k, w + 6 / k, 15 / k);
      ctx.fillStyle = this.ink; ctx.fillText(n.title, x, y - r - 4 / k);
    }
    ctx.globalAlpha = 1;
  }

  private ends(l: GraphLink): [string, string] { return [typeof l.source === 'object' ? l.source.id : l.source, typeof l.target === 'object' ? l.target.id : l.target]; }
  private isCut(l: GraphLink): boolean { const [a, b] = this.ends(l); return this.look.cut.has(cutKey(a, b)); }
  private linkColour(l: GraphLink): string {
    const [a, b] = this.ends(l);
    if (this.look.cut.has(cutKey(a, b))) return this.ink;
    return this.look.lit.has(a) && this.look.lit.has(b) ? this.accent : this.faint;
  }
  private linkWidth(l: GraphLink): number {
    const [a, b] = this.ends(l);
    if (this.look.cut.has(cutKey(a, b))) return 1.6;
    return this.look.lit.has(a) && this.look.lit.has(b) ? 1.3 : 0.5;
  }

  // ---- Settling ----

  private rest(): void {
    if (this.disposed || this.fg === null) return;
    const memory = new Map<string, { x: number; y: number }>();
    // A page held in place by a remembered layout is let go, so the person can still drag it later.
    for (const n of this.nodes) { memory.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 }); delete n.fx; delete n.fy; }
    rested.set(this.pageList, memory);
    // The first rest fits every page into the picture. Later rests (the layout woke up because a page was dragged) leave the view where the person put it.
    if (!this.fitted) { this.fitted = true; this.fit(); }
    this.host.dataset.settled = '1';
    // A count of the times the layout came to rest, so a test can wait for the next rest after a drag.
    this.host.dataset.rests = String(Number(this.host.dataset.rests ?? '0') + 1);
    this.events.onSettled();
  }

  /** Fits every page into the picture. */
  fit(): void { this.fg?.zoomToFit(ms(MOTION.graph.focus.ms), 36); }

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
    }
    this.overlay.classList.toggle('kn-lasso-on', this.lassoOn);
    if (!this.lassoOn) { this.cancelLasso(); }
  }

  private local(e: PointerEvent): Point { const r = this.overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  /** Pointer handlers for the overlay. They are plain methods so the component can attach them. */
  readonly down = (e: PointerEvent): void => {
    if (!this.lassoOn || e.button !== 0 || this.fg === null) return;
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
    for (const o of this.observers.splice(0)) o.disconnect();
    this.fg?.pauseAnimation();
    this.fg?._destructor();
    this.fg = null;
    this.host.replaceChildren();
  }
}
