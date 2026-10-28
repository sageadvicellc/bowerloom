/**
 * The graph of the builder (S3). Agents sit in a column at the left and every other part in a column at the right, joined by curves.
 * Press a node to select it: the node and its neighbours stay bright and the rest fade. Drag a node to move it; the curves follow, and the place is saved in the manifest when you let go
 * (the arrow keys move the focused node by 8 units, 32 with Shift). Drag the background to pan; Ctrl and the wheel (or a pinch) zoom about the pointer, the wheel alone pans.
 * The buttons at the top right zoom in, zoom out and fit the graph; the small map at the foot shows the whole graph and the window, and a press on it moves the window there.
 * To link: select an agent and press the circle at its right edge, then press a part. The link is saved in the manifest; the agent's file does not change. Escape or a press on the background stops linking.
 * A missing part is a dashed node with a Fix button beside it. Nothing here writes to a disk. All text comes from the person's own files and is drawn as plain text.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { FIT_FOOT, ZOOM_STEP, brightIds, centerOnMiniMap, edgePath, fitView, graphOf, miniMap, zoomAt } from '../../../../shared/harness/layout.js';
import type { GraphNode, View } from '../../../../shared/harness/layout.js';
import type { Harness, HarnessState, Point } from '../../../../shared/harness/types.js';
import { HIcon, KIND_ICON } from '../../icons.js';
import { HButton, HIconButton } from '../../parts/controls.js';
import { WORDS, linkFromWords, nodeName } from '../../words.js';

export interface GraphProps {
  state: HarnessState;
  harness: Harness;
  selectedId: string | null;
  /** The agent that is being linked, or null. */
  linkingId: string | null;
  /** The ids that stay bright because of a search, or null when there is none. */
  matchIds: ReadonlySet<string> | null;
  onSelect(id: string | null): void;
  onMove(id: string, at: Point): void;
  onLinkStart(agentId: string): void;
  onLinkTarget(partId: string): void;
  onLinkCancel(): void;
  onFix(missingId: string): void;
}

const DRAG_START = 4;
const MAP = { w: 140, h: 92 } as const;

export function Graph({ state, harness, selectedId, linkingId, matchIds, onSelect, onMove, onLinkStart, onLinkTarget, onLinkCancel, onFix }: GraphProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const fitted = useRef(false);
  const [moved, setMoved] = useState<Readonly<Record<string, Point>>>({});
  const graph = useMemo(() => graphOf(state, harness, moved), [state, harness, moved]);
  const nodeById = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);
  const latest = useRef({ view, graph, size });
  latest.current = { view, graph, size };

  // The size of the stage, and the first fit once it is known.
  useEffect(() => {
    const el = host.current;
    if (el === null) return undefined;
    const read = (): void => {
      const box = el.getBoundingClientRect();
      setSize({ w: box.width, h: box.height });
      if (!fitted.current && box.width > 0 && box.height > 0) { fitted.current = true; setView(fitView(latest.current.graph.bounds, box.width, box.height, 16, FIT_FOOT)); }
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  // Escape stops linking.
  useEffect(() => {
    if (linkingId === null) return undefined;
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onLinkCancel(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [linkingId, onLinkCancel]);

  const bright = useMemo(() => {
    if (linkingId !== null) {
      const own = new Set(harness.links.filter(l => l.from === linkingId).map(l => l.to));
      return new Set<string>([linkingId, ...graph.nodes.filter(n => n.kind !== 'agent' && !own.has(n.id)).map(n => n.id)]);
    }
    return brightIds(graph.edges, selectedId) ?? matchIds;
  }, [linkingId, harness.links, graph, selectedId, matchIds]);

  // ---- Pan: drag the background. A press without a drag selects nothing.
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
    if (!p.moved) { if (linkingId !== null) onLinkCancel(); else onSelect(null); }
  };

  // ---- Drag a node.
  const drag = useRef<{ id: string; x: number; y: number; from: Point; moved: boolean } | null>(null);
  const downNode = (e: ReactPointerEvent<HTMLElement>, node: GraphNode): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-control]') !== null) return;
    drag.current = { id: node.id, x: e.clientX, y: e.clientY, from: { x: node.x, y: node.y }, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const moveNode = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (d === null) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_START) return;
    d.moved = true;
    const k = latest.current.view.k;
    setMoved(m => ({ ...m, [d.id]: { x: d.from.x + dx / k, y: d.from.y + dy / k } }));
  };
  const upNode = (e: ReactPointerEvent<HTMLElement>, node: GraphNode): void => {
    const d = drag.current;
    drag.current = null;
    if (d === null) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) {
      const at = latest.current.graph.nodes.find(n => n.id === d.id);
      setMoved(m => { const rest = { ...m }; delete rest[d.id]; return rest; });
      if (at !== undefined) onMove(d.id, { x: at.x, y: at.y });
      return;
    }
    press(node);
  };
  /** A press on a node: when linking, a part is the target; otherwise the node is selected. */
  const press = (node: GraphNode): void => {
    if (linkingId !== null) { if (node.kind !== 'agent' && bright?.has(node.id) === true) onLinkTarget(node.id); else onLinkCancel(); return; }
    onSelect(node.id);
  };
  const keyNode = (e: ReactKeyboardEvent<HTMLElement>, node: GraphNode): void => {
    // A key pressed on the circle (a button inside the node) belongs to the circle, so Enter and Space start the link and the arrows do not move the node.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(node); return; }
    const step = e.shiftKey ? 32 : 8;
    const delta = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : null;
    if (delta === null || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    onMove(node.id, { x: node.x + delta[0]!, y: node.y + delta[1]! });
  };

  const fit = useCallback((): void => setView(fitView(latest.current.graph.bounds, latest.current.size.w, latest.current.size.h, 16, FIT_FOOT)), []);
  const centre = (): { x: number; y: number } => ({ x: latest.current.size.w / 2, y: latest.current.size.h / 2 });
  const map = useMemo(() => miniMap(graph, view, size.w, size.h, MAP.w, MAP.h), [graph, view, size]);
  const linkAgent = linkingId === null ? undefined : nodeById.get(linkingId);

  return (
    <div className="hx-canvas" ref={host} role="group" aria-label={WORDS.label.graph} data-linking={linkingId === null ? undefined : ''}
      onPointerDown={downBackground} onPointerMove={moveBackground} onPointerUp={upBackground} onPointerCancel={() => { pan.current = null; }}>
      <div className="hx-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="hx-edges" width="1" height="1" aria-hidden="true" focusable="false">
          {graph.edges.map(edge => {
            const a = nodeById.get(edge.from), b = nodeById.get(edge.to);
            if (a === undefined || b === undefined) return null;
            const on = selectedId !== null && linkingId === null && (edge.from === selectedId || edge.to === selectedId);
            return <path key={edge.id} d={edgePath(a, b)} className="hx-edge" data-on={on ? '' : undefined} data-missing={edge.missing ? '' : undefined} data-faded={bright !== null && !on ? '' : undefined} />;
          })}
        </svg>
        {graph.nodes.map(node => {
          const isBright = bright === null || bright.has(node.id), selected = selectedId === node.id;
          const candidate = linkingId !== null && node.id !== linkingId && node.kind !== 'agent' && bright?.has(node.id) === true;
          return (
            <div key={node.id} className="hx-node" data-node={node.id} data-kind={node.kind} data-selected={selected ? '' : undefined} data-faded={isBright ? undefined : ''} data-missing={node.missing ? '' : undefined}
              data-candidate={candidate ? '' : undefined} data-dragging={moved[node.id] === undefined ? undefined : ''}
              style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
              role="button" tabIndex={0} aria-pressed={selected} aria-label={node.missing ? `${node.name}. ${node.summary}` : nodeName(node.name, node.kind, node.summary)}
              onPointerDown={e => downNode(e, node)} onPointerMove={moveNode} onPointerUp={e => upNode(e, node)} onPointerCancel={() => { drag.current = null; setMoved({}); }} onKeyDown={e => keyNode(e, node)}>
              <span className="hx-tile" aria-hidden="true"><HIcon name={node.missing ? 'warning-triangle' : KIND_ICON[node.kind]} size={20} /></span>
              <span className="hx-node-text"><span className="hx-node-name">{node.name}</span><span className="hx-node-sum">{node.summary}</span></span>
              {node.isNew ? <span className="hx-node-new" aria-label={WORDS.label.new} /> : null}
              {selected && node.kind === 'agent' ? (
                <button type="button" className="hx-handle" data-control="" aria-label={WORDS.label.linkFrom} aria-pressed={linkingId === node.id} onPointerDown={e => e.stopPropagation()} onClick={() => onLinkStart(node.id)} />
              ) : null}
            </div>
          );
        })}
        {graph.nodes.filter(n => n.missing).map(n => (
          <div key={`fix-${n.id}`} className="hx-fix" data-control="" style={{ left: n.x + n.w + 8, top: n.y + n.h / 2 - 16 }}>
            <HButton size="small" onClick={() => onFix(n.id)} aria-label={`${WORDS.label.fix} ${n.name}`}>{WORDS.label.fix}</HButton>
          </div>
        ))}
      </div>

      {linkAgent === undefined ? null : (
        <div className="hx-linkbar" data-control="" role="status">
          <span>{linkFromWords(linkAgent.name)}</span>
          <HButton variant="text" size="small" onClick={onLinkCancel}>{WORDS.label.cancel}</HButton>
        </div>
      )}

      <div className="hx-zoom" data-control="" role="group" aria-label={WORDS.label.zoomControls}>
        <HIconButton icon="zoom-in" label={WORDS.label.zoomIn} side="left" onClick={() => { const c = centre(); setView(v => zoomAt(v, ZOOM_STEP, c.x, c.y)); }} />
        <HIconButton icon="zoom-out" label={WORDS.label.zoomOut} side="left" onClick={() => { const c = centre(); setView(v => zoomAt(v, 1 / ZOOM_STEP, c.x, c.y)); }} />
        <HIconButton icon="fit" label={WORDS.label.fitView} side="left" onClick={fit} />
      </div>

      <div className="hx-map" data-control="" role="group" aria-label={WORDS.label.smallMap} style={{ width: MAP.w, height: MAP.h }}
        onPointerDown={e => { const box = e.currentTarget.getBoundingClientRect(); setView(v => centerOnMiniMap(map, v, size.w, size.h, e.clientX - box.left, e.clientY - box.top)); }}>
        <svg width={MAP.w} height={MAP.h} aria-hidden="true" focusable="false">
          {map.bars.map(b => <rect key={b.id} className="hx-map-bar" data-selected={b.id === selectedId ? '' : undefined} x={b.x} y={b.y} width={Math.max(2, b.w)} height={Math.max(2, b.h)} rx={1} />)}
          <rect className="hx-map-window" x={map.window.x} y={map.window.y} width={Math.max(0, map.window.w)} height={Math.max(0, map.window.h)} />
        </svg>
      </div>

      <ul className="hx-legend" data-control="" aria-label={WORDS.label.legend}>
        <li><span className="hx-legend-dot" aria-hidden="true" />{WORDS.hint.legendNew}</li>
        <li><span className="hx-legend-dash" aria-hidden="true" />{WORDS.hint.legendMissing}</li>
      </ul>
    </div>
  );
}
