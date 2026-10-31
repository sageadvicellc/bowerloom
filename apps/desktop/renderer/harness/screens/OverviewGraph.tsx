/**
 * The graph of the Overview (Task 2): every place the first read found, each as a box with a header, in a fixed grid, and inside an open place the Builder's two columns (agents at
 * the left, every other part at the right). It draws the Builder's own cards, curves, buttons and small map (the classes of harness.css and the functions of shared/harness/layout.ts);
 * only the boxes are new. It is read-only: nothing drags, nothing is saved, and there is no animation loop.
 *
 * Scale. `visibleOf` decides what is on the page, so the page never holds more than OVERVIEW_LIMITS.domNodes boxes and cards at any zoom. Under OVERVIEW_LIMITS.detailZoom an open place
 * draws as a box with its counts and no cards.
 * Mouse and touch. Drag the background to pan. Ctrl and the wheel (or a pinch) zoom about the pointer, the wheel alone pans. The buttons at the top right zoom and fit; the small map
 * at the foot shows the places and the window, and a press on it moves the window there. A press on a card selects it; a press on the background clears.
 * Keyboard. Each place header is a real button in the tab order: Enter or Space opens and closes the place, and the arrow keys move to the next place. The cards are one tab stop:
 * the arrow keys move to the nearest card on the page in that direction (the window follows it), Enter or Space selects, Escape clears, and + - 0 zoom in, zoom out and fit.
 * Selecting a shared skill lights every copy and draws thin dotted curves to the copies that are on the page.
 * All text comes from the person's own files and is drawn as plain text.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { FIT_FOOT, ZOOM_STEP, centerOnMiniMap, edgePath, fitView, miniMap, zoomAt } from '../../../shared/harness/layout.js';
import type { GraphNode, View } from '../../../shared/harness/layout.js';
import { OVERVIEW_LIMITS } from '../../../shared/harness/overview.js';
import type { Overview, OverviewGroup } from '../../../shared/harness/overview.js';
import { layoutOf, neighbourOf, sharedEdgesOf, visibleOf } from '../../../shared/harness/overview-layout.js';
import type { Direction, LaidCluster, LaidEdge, LaidNode } from '../../../shared/harness/overview-layout.js';
import { HIcon, KIND_ICON } from '../icons.js';
import { HIconButton } from '../parts/controls.js';
import { WORDS } from '../words.js';
import { OVERVIEW, alsoInWords, countsWords, nodeName, toggleName, usesLineWords } from '../words-overview.js';
import { brightOf, firstView, litPlaces, neighbourPlace, revealView, usesCounts } from './OverviewModel.js';
import type { OverviewIndex } from './OverviewModel.js';

export interface OverviewGraphProps {
  overview: Overview;
  /** The ids of the places drawn open. */
  expanded: ReadonlySet<string>;
  index: OverviewIndex;
  selectedId: string | null;
  /** A new value opens the graph on its first view again (a different set of places, or "Expand all"). */
  fitKey: string;
  onSelect(id: string | null): void;
  /** The header of a place was pressed. */
  onToggle(groupId: string): void;
  /** The mark and the button of a place, drawn at the right of its header. */
  place(group: OverviewGroup): ReactNode;
  /** The size of the stage before it is measured (the page, a test). */
  initialSize?: { readonly w: number; readonly h: number };
  /** The view before the first fit (a test). Left out, the graph starts fitted to the window. */
  initialView?: View;
}

const MAP = { w: 140, h: 92 } as const;
const FIRST_SIZE = { w: 1200, h: 720 } as const;
const DRAG_START = 4;
const ARROWS: Readonly<Record<string, Direction>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const nodeKey = (id: string): string => `node:${id}`;
const headKey = (id: string): string => `head:${id}`;

export function OverviewGraph({ overview, expanded, index, selectedId, fitKey, onSelect, onToggle, place, initialSize, initialView }: OverviewGraphProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>(() => ({ ...(initialSize ?? FIRST_SIZE) }));
  const layout = useMemo(() => layoutOf(overview, expanded), [overview, expanded]);
  const [view, setView] = useState<View>(() => initialView ?? firstView(layout.bounds, size.w, size.h, 16, FIT_FOOT));
  const [focusId, setFocusId] = useState<string | null>(null);
  const fitted = useRef(initialSize !== undefined || initialView !== undefined);
  const nodeById = useMemo(() => new Map(layout.nodes.map(n => [n.id, n] as const)), [layout]);
  const edgeById = useMemo(() => new Map(layout.edges.map(e => [e.id, e] as const)), [layout]);
  const clusterById = useMemo(() => new Map(layout.clusters.map(c => [c.id, c] as const)), [layout]);
  const groupById = useMemo(() => new Map(overview.groups.map(g => [g.id, g] as const)), [overview]);
  const clusterIds = useMemo(() => layout.clusters.map(c => c.id), [layout]);
  const columns = useMemo(() => { const first = layout.clusters[0]; return first === undefined ? 1 : layout.clusters.filter(c => c.y === first.y).length; }, [layout]);
  const latest = useRef({ view, layout, size });
  latest.current = { view, layout, size };
  // The elements that can take the focus, by key, and the one that should take it when it is drawn.
  const els = useRef(new Map<string, HTMLElement>());
  const pending = useRef<string | null>(null);

  const visible = useMemo(() => visibleOf(layout, view, size.w, size.h, undefined, selectedId), [layout, view, size, selectedId]);
  const onPage = useMemo(() => new Set(visible.nodes), [visible]);
  const bright = useMemo(() => brightOf(overview, index, selectedId), [overview, index, selectedId]);
  const lit = useMemo(() => litPlaces(overview, index, selectedId), [overview, index, selectedId]);
  const selectedNode = selectedId === null ? undefined : nodeById.get(selectedId);
  const copies = useMemo(() => {
    const found = selectedId === null ? undefined : index.node(selectedId);
    return found === undefined || found.node.shareKey === undefined ? null : new Set(overview.sharedKeys.get(found.node.shareKey) ?? []);
  }, [overview, index, selectedId]);
  // The dotted curves of a selected shared skill: only to the copies that are on the page.
  const sharedEdges = useMemo<readonly LaidEdge[]>(() => (selectedId === null ? [] : sharedEdgesOf(layout, selectedId).filter(e => onPage.has(e.from) && onPage.has(e.to))), [layout, selectedId, onPage]);
  const tabbable = focusId !== null && onPage.has(focusId) ? focusId : selectedId !== null && onPage.has(selectedId) ? selectedId : visible.nodes[0] ?? null;
  const boxes = visible.detail === 'boxes';
  const capped = visible.clusters.length + visible.nodes.length >= OVERVIEW_LIMITS.domNodes;

  // The size of the stage, and the first fit once it is known.
  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    const read = (): void => {
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      setSize(s => (s.w === box.width && s.h === box.height ? s : { w: box.width, h: box.height }));
      if (!fitted.current) { fitted.current = true; setView(firstView(latest.current.layout.bounds, box.width, box.height, 16, FIT_FOOT)); }
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fit again when the set of places changes or "Expand all" and "Collapse all" are pressed. Not on the first draw, which is fitted already.
  const lastFit = useRef(fitKey);
  useEffect(() => { if (lastFit.current !== fitKey) { lastFit.current = fitKey; setView(firstView(latest.current.layout.bounds, latest.current.size.w, latest.current.size.h, 16, FIT_FOOT)); } }, [fitKey]);

  // Ctrl and the wheel (a pinch on a trackpad) zoom about the pointer; the wheel alone pans. The listener is not passive, so the page itself does not scroll.
  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) setView(v => zoomAt(v, Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top));
      else setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // A key that moved the focus to something that was not drawn yet: take the focus when it is.
  useEffect(() => {
    const key = pending.current;
    if (key === null) return;
    const el = els.current.get(key);
    if (el !== undefined) { pending.current = null; el.focus({ preventScroll: true }); }
  });

  // ---- Pan: drag the background. A press without a drag clears the selection.
  const pan = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const downBackground = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-node], [data-control]') !== null) return;
    pan.current = { x: e.clientX, y: e.clientY, view, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveBackground = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const p = pan.current;
    if (p === null) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < DRAG_START) return;
    p.moved = true;
    setView({ k: p.view.k, x: p.view.x + dx, y: p.view.y + dy });
  };
  const upBackground = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const p = pan.current;
    pan.current = null;
    if (p === null) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!p.moved) onSelect(null);
  };

  // ---- Keys. The cards: arrows, Enter and Space. The headers: arrows between places. The stage: Escape, + - 0.
  const moveToNode = (to: string): void => {
    const target = nodeById.get(to);
    if (target === undefined) return;
    setFocusId(to);
    setView(v => revealView(v, target, latest.current.size.w, latest.current.size.h));
    pending.current = nodeKey(to);
    const el = els.current.get(nodeKey(to));
    if (el !== undefined) { pending.current = null; el.focus({ preventScroll: true }); }
  };
  const keyNode = (e: ReactKeyboardEvent<HTMLElement>, node: LaidNode): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node.id); return; }
    const direction = ARROWS[e.key];
    if (direction === undefined) return;
    e.preventDefault();
    const to = neighbourOf(layout, node.id, direction, onPage);
    if (to !== null) moveToNode(to);
  };
  const keyHead = (e: ReactKeyboardEvent<HTMLElement>, cluster: LaidCluster): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || ARROWS[e.key] === undefined) return;
    e.preventDefault();
    const to = neighbourPlace(clusterIds, cluster.id, e.key as 'ArrowLeft', columns);
    const target = to === null ? undefined : clusterById.get(to);
    if (to === null || target === undefined) return;
    setView(v => revealView(v, target.header, latest.current.size.w, latest.current.size.h));
    pending.current = headKey(to);
    const el = els.current.get(headKey(to));
    if (el !== undefined) { pending.current = null; el.focus({ preventScroll: true }); }
  };
  const centre = (): { x: number; y: number } => ({ x: latest.current.size.w / 2, y: latest.current.size.h / 2 });
  /** Moves the view. When it leaves the detail zoom while a card has the focus, the card is about to leave the page, so the focus goes to the header of its place and the keys keep working. */
  const moveView = (next: View): void => {
    setView(next);
    if (next.k >= OVERVIEW_LIMITS.detailZoom) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.getAttribute('data-node') : null;
    const node = active === null ? undefined : nodeById.get(active);
    if (node !== undefined) pending.current = headKey(node.groupId);
  };
  const zoomBy = (factor: number): void => { const c = centre(); moveView(zoomAt(latest.current.view, factor, c.x, c.y)); };
  const fitAll = (): void => moveView(fitView(latest.current.layout.bounds, latest.current.size.w, latest.current.size.h, 16, FIT_FOOT));
  const keyStage = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { if (selectedId !== null) { e.preventDefault(); onSelect(null); } return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(ZOOM_STEP); } else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / ZOOM_STEP); } else if (e.key === '0') { e.preventDefault(); fitAll(); }
  };

  const map = useMemo(() => miniMap(layout.map, view, size.w, size.h, MAP.w, MAP.h), [layout, view, size]);
  const register = (key: string) => (el: HTMLElement | null): void => { if (el === null) els.current.delete(key); else els.current.set(key, el); };

  const nameOf = (node: LaidNode): string => {
    const counts = usesCounts(index, node.id);
    const line = usesLineWords(counts);
    return nodeName({ name: node.name, kind: node.kind, ...(node.toolKind === undefined ? {} : { toolKind: node.toolKind }), group: groupById.get(node.groupId)?.name ?? '', uses: 0, ...(line === null ? {} : { usesLine: line }), runsCode: node.runsCode === true, sharedWith: node.sharedWith.length });
  };
  const edgeEnds = (edge: LaidEdge): [GraphNode, GraphNode] | null => {
    const a = nodeById.get(edge.from), b = nodeById.get(edge.to);
    return a === undefined || b === undefined ? null : [a, b];
  };

  return (
    <div className="hx-canvas hxo-canvas" ref={host} role="group" aria-label={WORDS.label.graph} aria-describedby="hxo-keys" data-view="graph" onKeyDown={keyStage}
      onPointerDown={downBackground} onPointerMove={moveBackground} onPointerUp={upBackground} onPointerCancel={() => { pan.current = null; }}>
      <div className="hx-world hxo-world" data-detail={visible.detail} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, ['--hxo-boost' as string]: Math.min(2.2, Math.max(1, 0.9 / view.k)) }}>
        {visible.clusters.map(id => {
          const c = clusterById.get(id), g = groupById.get(id);
          if (c === undefined || g === undefined) return null;
          const open = c.expanded;
          return (
            <div key={id} className="hxo-box" role="group" aria-label={`${OVERVIEW.label.placeGroup}: ${g.name}`} data-cluster={id} data-open={open ? '' : undefined} data-boxed={open && boxes ? '' : undefined}
              data-home={g.scope === 'home' ? '' : undefined} data-lit={lit.has(id) ? '' : undefined} style={{ left: c.x, top: c.y, width: c.w, height: c.h }}>
              <div className="hxo-head" style={{ height: c.header.h }}>
                <button type="button" className="hxo-toggle" data-control="" data-place-toggle={id} aria-expanded={open} aria-label={`${toggleName(g.name, open)}, ${g.label}, ${countsWords(g.counts)}`} ref={register(headKey(id))} onKeyDown={e => keyHead(e, c)} onClick={() => onToggle(id)}>
                  <span className="hxo-chev" data-open={open ? '' : undefined} aria-hidden="true"><HIcon name="chevron" size={16} /></span>
                  <span className="hxo-text">
                    <span className="hxo-name">{g.name}</span>
                    <span className="hxo-sub"><span className="hxo-label">{g.label}</span><span className="hxo-counts">{countsWords(g.counts)}</span></span>
                  </span>
                </button>
                {boxes ? null : <span className="hxo-tools" data-control="">{place(g)}</span>}
              </div>
              {open && boxes ? <p className="hxo-boxcount" aria-hidden="true">{countsWords(g.counts)}</p> : null}
            </div>
          );
        })}
        <svg className="hx-edges hxo-edges" width="1" height="1" aria-hidden="true" focusable="false">
          {visible.edges.map(id => {
            const edge = edgeById.get(id), ends = edge === undefined ? null : edgeEnds(edge);
            if (edge === undefined || ends === null) return null;
            const on = selectedId !== null && (edge.from === selectedId || edge.to === selectedId);
            return <path key={id} d={edgePath(ends[0], ends[1])} className="hx-edge" data-on={on ? '' : undefined} data-faded={bright !== null && !on ? '' : undefined} />;
          })}
          {sharedEdges.map(edge => {
            const ends = edgeEnds(edge);
            if (ends === null) return null;
            // The curve leaves the right edge of the left card, so a copy at the left of the selection is drawn from its own side.
            const [a, b] = ends[0].x <= ends[1].x ? ends : [ends[1], ends[0]];
            return <path key={edge.id} d={edgePath(a, b)} className="hx-edge hxo-shared" data-on="" data-shared={edge.id} />;
          })}
        </svg>
        {visible.nodes.map(id => {
          const node = nodeById.get(id);
          if (node === undefined) return null;
          const selected = selectedId === id, isLit = !selected && copies !== null && copies.has(id), faded = bright !== null && !bright.has(id);
          const marked = node.sharedWith.length > 0 || node.runsCode === true;
          return (
            <div key={id} className="hx-node hxo-node" data-node={id} data-kind={node.kind} data-place={node.groupId} data-selected={selected ? '' : undefined} data-lit={isLit ? '' : undefined}
              data-faded={faded ? '' : undefined} data-marked={marked ? '' : undefined} style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
              role="button" tabIndex={tabbable === id ? 0 : -1} aria-pressed={selected} aria-label={nameOf(node)} ref={register(nodeKey(id))}
              onFocus={() => setFocusId(id)} onClick={() => onSelect(id)} onKeyDown={e => keyNode(e, node)}>
              <span className="hx-tile" aria-hidden="true"><HIcon name={KIND_ICON[node.kind]} size={20} /></span>
              <span className="hx-node-text"><span className="hx-node-name">{node.name}</span><span className="hx-node-sum">{node.summary}</span></span>
              {marked ? (
                <span className="hxo-marks" aria-hidden="true">
                  {node.sharedWith.length > 0 ? <span title={alsoInWords(node.sharedWith.length)}><HIcon name="share" size={14} /></span> : null}
                  {node.runsCode === true ? <span title={OVERVIEW.label.runsCode}><HIcon name="play" size={14} /></span> : null}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="hx-zoom" data-control="" role="group" aria-label={WORDS.label.zoomControls}>
        <HIconButton icon="zoom-in" label={WORDS.label.zoomIn} side="left" onClick={() => zoomBy(ZOOM_STEP)} />
        <HIconButton icon="zoom-out" label={WORDS.label.zoomOut} side="left" onClick={() => zoomBy(1 / ZOOM_STEP)} />
        <HIconButton icon="fit" label={WORDS.label.fitView} side="left" onClick={fitAll} />
      </div>

      <div className="hx-map" data-control="" role="group" aria-label={WORDS.label.smallMap} style={{ width: MAP.w, height: MAP.h }}
        onPointerDown={e => { const box = e.currentTarget.getBoundingClientRect(); setView(v => centerOnMiniMap(map, v, size.w, size.h, e.clientX - box.left, e.clientY - box.top)); }}>
        <svg width={MAP.w} height={MAP.h} aria-hidden="true" focusable="false">
          {map.bars.map(b => <rect key={b.id} className="hx-map-bar" data-selected={lit.has(b.id) || selectedNode?.groupId === b.id ? '' : undefined} x={b.x} y={b.y} width={Math.max(2, b.w)} height={Math.max(2, b.h)} rx={1} />)}
          <rect className="hx-map-window" x={map.window.x} y={map.window.y} width={Math.max(0, map.window.w)} height={Math.max(0, map.window.h)} />
        </svg>
      </div>

      <ul className="hx-legend hxo-legend" data-control="">
        <li>{OVERVIEW.hint.readOnly}</li>
        <li id="hxo-keys">{OVERVIEW.hint.keys}</li>
        {boxes ? <li data-zoomed-out="">{OVERVIEW.hint.zoomedOut}</li> : null}
        {capped ? <li data-more-parts="">{OVERVIEW.hint.moreParts}</li> : null}
      </ul>
    </div>
  );
}
