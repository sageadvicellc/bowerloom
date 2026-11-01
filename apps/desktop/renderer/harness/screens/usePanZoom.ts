/**
 * The pan and zoom of a graph stage, in one place, for the Builder's graph and the Overview's graph. It holds the size of the stage (read again when the window changes), the view
 * (an offset and a zoom), the first fit once the size is known, and these gestures:
 *  - Ctrl and the wheel (a pinch on a trackpad) zoom about the pointer; the wheel alone pans. The listener is not passive, so the page itself does not scroll.
 *  - Drag the background to pan. A press on the background that does not move calls `onBackground`. A press on a node or a control (`[data-node]`, `[data-control]`) never pans.
 *  - A focused card is brought into the window by `reveal` (a screen calls it from its focus handler; see builder/Graph.tsx and OverviewGraph.tsx).
 *  - The stage never scrolls: it is `overflow: hidden`, and the browser scrolls such a box to show a focused child (a Tab onto a card out of view). That would leave the picture
 *    where the view state does not say it is, so `onScroll` puts the scroll back at 0 and a caller reveals the focused card through the view instead.
 * Every move of the view goes through `setView`, which keeps `latest.current.view` equal to the view at once (two wheel events in one frame add up) and tells `onView` the new
 * view and the old one, so a screen can move the focus before a card leaves the page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject, UIEvent as ReactUIEvent } from 'react';
import { FIT_FOOT, fitView, zoomAt } from '../../../shared/harness/layout.js';
import type { Bounds, View } from '../../../shared/harness/layout.js';
import { NO_INSETS, revealView } from './reveal-view.js';
import type { Insets } from './reveal-view.js';

const DRAG_START = 4;
const PAD = 16;

export interface PanZoomOptions {
  /** The bounds of the graph now. */
  bounds: Bounds;
  /** The view that shows the whole graph in a window. Default: the Builder's `fitView`, 16 px around it and `FIT_FOOT` free at the foot. */
  fit?(bounds: Bounds, width: number, height: number): View;
  /** Zoom by a factor about a window point. Default: the Builder's `zoomAt` (zoom 0.4 to 2). */
  zoom?(view: View, factor: number, cx: number, cy: number): View;
  /** The size assumed before the stage is measured. Default 0 by 0, so the first view is life size until it is measured. */
  size0?: { readonly w: number; readonly h: number };
  /** The view before the first fit. Default: the fit of `size0`. */
  view0?: View;
  /** True (default) to fit the graph when the stage is first measured. */
  fitOnMeasure?: boolean;
  /** A new value fits the graph again. Not on the first draw. */
  fitKey?: string;
  /** True to let a drag that starts on a card pan too (the Overview, where nothing drags); the click that ends such a drag is swallowed. Default false: the Builder drags its cards. */
  panFromNodes?: boolean;
  /** A press on the background that did not move. */
  onBackground?(): void;
  /** The view changed, by a gesture or by a call of `setView`. */
  onView?(next: View, before: View): void;
}

export interface PanZoom {
  host: RefObject<HTMLDivElement | null>;
  size: { readonly w: number; readonly h: number };
  view: View;
  /** The view and the size as they are now, also between two draws. */
  latest: RefObject<{ view: View; size: { w: number; h: number } }>;
  setView(next: View): void;
  fit(): void;
  /** Brings a card (a rectangle in graph units) into the window through the view, clear of `insets`. Nothing moves when it is in already. */
  reveal(rect: { x: number; y: number; w: number; h: number }, insets?: Insets): void;
  zoomBy(factor: number): void;
  /** The middle of the stage, in window pixels. */
  centre(): { x: number; y: number };
  /** Put these on the stage element. */
  handlers: {
    onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void;
    onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void;
    onPointerUp(e: ReactPointerEvent<HTMLDivElement>): void;
    onPointerCancel(): void;
    onScroll(e: ReactUIEvent<HTMLDivElement>): void;
    onClickCapture(e: ReactMouseEvent<HTMLDivElement>): void;
  };
}

export function usePanZoom(options: PanZoomOptions): PanZoom {
  const opts = useRef(options);
  opts.current = options;
  const fitOf = (bounds: Bounds, w: number, h: number): View => (opts.current.fit ?? ((b, x, y) => fitView(b, x, y, PAD, FIT_FOOT)))(bounds, w, h);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>(() => ({ ...(options.size0 ?? { w: 0, h: 0 }) }));
  const [view, setViewState] = useState<View>(() => options.view0 ?? fitOf(options.bounds, size.w, size.h));
  const latest = useRef({ view, size });
  const fitted = useRef(options.fitOnMeasure === false || options.view0 !== undefined);

  const setView = useCallback((next: View): void => {
    const before = latest.current.view;
    if (next === before) return;
    latest.current.view = next;
    setViewState(next);
    opts.current.onView?.(next, before);
  }, []);
  const fit = useCallback((): void => { const { size: s } = latest.current; setView(fitOf(opts.current.bounds, s.w, s.h)); }, [setView]);
  const reveal = useCallback((rect: { x: number; y: number; w: number; h: number }, insets: Insets = NO_INSETS): void => {
    const { view: v, size: s } = latest.current;
    setView(revealView(v, rect, s.w, s.h, 24, insets));
  }, [setView]);
  const centre = useCallback((): { x: number; y: number } => ({ x: latest.current.size.w / 2, y: latest.current.size.h / 2 }), []);
  const zoomBy = useCallback((factor: number): void => {
    const c = centre(), zoom = opts.current.zoom ?? zoomAt;
    setView(zoom(latest.current.view, factor, c.x, c.y));
  }, [centre, setView]);

  // The size of the stage, and the first fit once it is known.
  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    const read = (): void => {
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      latest.current.size = { w: box.width, h: box.height };
      setSize(s => (s.w === box.width && s.h === box.height ? s : { w: box.width, h: box.height }));
      if (!fitted.current) { fitted.current = true; setView(fitOf(opts.current.bounds, box.width, box.height)); }
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [setView]);

  const lastFit = useRef(options.fitKey);
  useEffect(() => { if (lastFit.current !== options.fitKey) { lastFit.current = options.fitKey; fit(); } }, [options.fitKey, fit]);

  // Ctrl and the wheel zoom about the pointer; the wheel alone pans.
  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const box = el.getBoundingClientRect(), v = latest.current.view;
      if (e.ctrlKey || e.metaKey) setView((opts.current.zoom ?? zoomAt)(v, Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top));
      else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [setView]);

  const pan = useRef<{ x: number; y: number; view: View; moved: boolean; pointer: number; onNode: boolean } | null>(null);
  const swallow = useRef(false);
  const handlers: PanZoom['handlers'] = {
    onPointerDown: e => {
      swallow.current = false;
      const target = e.target as HTMLElement;
      if (e.button !== 0 || target.closest('[data-control]') !== null) return;
      const onNode = target.closest('[data-node]') !== null;
      if (onNode && opts.current.panFromNodes !== true) return;
      pan.current = { x: e.clientX, y: e.clientY, view: latest.current.view, moved: false, pointer: e.pointerId, onNode };
      // A press on the background is captured at once. A press on a card is captured only once it becomes a drag, so a plain click still reaches the card.
      if (!onNode) e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: e => {
      const p = pan.current;
      if (p === null) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (!p.moved && Math.hypot(dx, dy) < DRAG_START) return;
      if (!p.moved && p.onNode) e.currentTarget.setPointerCapture(p.pointer);
      p.moved = true;
      setView({ k: p.view.k, x: p.view.x + dx, y: p.view.y + dy });
    },
    onPointerUp: e => {
      const p = pan.current;
      pan.current = null;
      if (p === null) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (p.moved && p.onNode) swallow.current = true;
      if (!p.moved && !p.onNode) opts.current.onBackground?.();
    },
    onPointerCancel: () => { pan.current = null; },
    onScroll: e => { const el = e.currentTarget; if (el.scrollLeft !== 0 || el.scrollTop !== 0) { el.scrollLeft = 0; el.scrollTop = 0; } },
    onClickCapture: e => { if (swallow.current) { swallow.current = false; e.stopPropagation(); e.preventDefault(); } },
  };
  return { host, size, view, latest, setView, fit, reveal, zoomBy, centre, handlers };
}
