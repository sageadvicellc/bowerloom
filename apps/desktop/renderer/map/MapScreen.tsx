/**
 * The Map screen: everything Bowerloom manages, as nodes you can drag, and wires between them. Hands-on: drag a node, select several
 * with a box, press a button to tidy up, and the places are remembered by the viewer (never in your folders).
 * The Sketch tab is a drawing board for a harness; it is only a drawing.
 */
import { Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow } from '@xyflow/react';
import type { Edge, Node, NodeChange, NodeProps } from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { KIND_WORDS_MAP, MAP_KINDS, REL_WORDS, STATUS_WORDS, buildMap, filterMap, hoverLine, outlineOf } from '../../shared/mapmodel.js';
import type { EdgeRel, MapKind, MapNode, MapStatus, ScopeFilter } from '../../shared/mapmodel.js';
import { LAYOUT, PLACE_LIMITS, autoLayout, prunePlaces, snap } from '../../shared/maplayout.js';
import { createKeeper } from '../../shared/layoutkeeper.js';
import type { Place } from '../../shared/maplayout.js';
import type { Snapshot, ViewerApi } from '../../shared/types.js';
import type { Link } from '../../shared/viewmodel.js';
import { MOTION, ms } from '../motion-tokens.js';
import { KindIcon } from './icons.js';
import { Legend } from './Legend.js';
import { createWireCache, sameNode } from './wires.js';
import { SketchBoard } from './SketchBoard.js';

export interface MapProps {
  snapshot: Snapshot;
  /** The places saved by the viewer. */
  saved: Record<string, Place>;
  api: ViewerApi;
  /** Opens the full page that goes with a node. */
  onOpen(link: Link): void;
  /** Called with the places to keep (null: forget them all). */
  onLayout(layout: Record<string, Place> | null): void;
}

interface NodeData extends Record<string, unknown> { n: MapNode; dim: boolean; exiting: boolean; dropped: boolean }
type BwNodeType = Node<NodeData, 'bw'>;

const STATUS_TONE: Record<MapStatus, string> = { ready: 'good', 'not-locked': 'quiet', drifted: 'warn', held: 'warn', 'cannot-open': 'bad' };

const BwNode = memo(function BwNode({ data, selected }: NodeProps<BwNodeType>): ReactElement {
  const { n, dim, exiting, dropped } = data;
  return (
    <div className={`bw-node kind-${n.kind}${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${exiting ? ' is-exiting' : ''}${dropped ? ' is-dropped' : ''}${n.unlisted === true ? ' is-unlisted' : ''}`} title={hoverLine(n)}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="bw-handle" />
      <span className="bw-node-icon"><KindIcon kind={n.kind} /></span>
      <span className="bw-node-text">
        <span className="bw-node-kind">{KIND_WORDS_MAP[n.kind]}</span>
        <span className="bw-node-label">{n.label}</span>
      </span>
      {n.unlisted === true ? <span className="bw-chip quiet">Not listed</span> : null}
      {n.status !== null ? <span className={`bw-chip ${STATUS_TONE[n.status]}`}>{STATUS_WORDS[n.status]}</span> : null}
      <Handle type="source" position={Position.Right} isConnectable={false} className="bw-handle" />
    </div>
  );
});
const nodeTypes = { bw: BwNode };

const SCOPES: { id: ScopeFilter; label: string; hint: string }[] = [
  { id: 'everything', label: 'Everything', hint: 'The whole picture' },
  { id: 'global', label: 'This computer', hint: 'The shared library and the knowledge folders' },
  { id: 'project', label: 'Projects', hint: 'The folders of work and what is in them' },
];

function Canvas(props: MapProps): ReactElement {
  const { snapshot, saved, onOpen, onLayout } = props;
  const flow = useReactFlow();
  const model = useMemo(() => buildMap(snapshot), [snapshot]);
  const [scope, setScope] = useState<ScopeFilter>('everything');
  const [kinds, setKinds] = useState<ReadonlySet<MapKind> | null>(null);
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState<'select' | 'move'>('select');
  const [panel, setPanel] = useState<string | null>(null);
  const [outline, setOutline] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [places, setPlaces] = useState<Record<string, Place>>({});
  // Every move can be taken back: the places before each change are kept (the last 30), and Undo puts them back.
  const [undo, setUndo] = useState<Record<string, Place>[]>([]);
  const base = useMemo(() => autoLayout(model.nodes, model.edges), [model]);
  const view = useMemo(() => filterMap(model, { scope, kinds, query }), [model, scope, kinds, query]);
  const placeOf = useCallback((id: string): Place => places[id] ?? saved[id] ?? base.get(id) ?? { x: 0, y: 0 }, [places, saved, base]);

  // The nodes React Flow holds. They leave gently: a node that is filtered out stays for a moment, marked as leaving.
  const [nodes, setNodes] = useState<BwNodeType[]>([]);
  const nodesRef = useRef<BwNodeType[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const remember = useCallback(() => setUndo(u => [...u.slice(-29), Object.fromEntries(nodesRef.current.filter(n => !n.data.exiting).map(n => [n.id, n.position]))]), []);
  // The things the canvas holds. A node whose words did not change keeps the very same object, so a keystroke in the search box or a
  // new scan redraws only what changed. A node that is filtered out stays for a moment, marked as leaving, so it can fade.
  const placeRef = useRef(placeOf), queryRef = useRef(query);
  placeRef.current = placeOf; queryRef.current = query;
  useEffect(() => {
    const now = new Set(view.nodes.map(n => n.id)), dimming = queryRef.current.trim() !== '';
    setNodes(prev => {
      const prevById = new Map(prev.map(p => [p.id, p]));
      const next = view.nodes.map((n): BwNodeType => {
        const old = prevById.get(n.id), dim = dimming && !view.matches.has(n.id);
        if (old !== undefined && !old.data.exiting && !old.data.dropped && old.data.dim === dim && sameNode(old.data.n, n)) return old;
        return { id: n.id, type: 'bw', position: old?.position ?? placeRef.current(n.id), selected: old?.selected ?? false, data: { n: old !== undefined && sameNode(old.data.n, n) ? old.data.n : n, dim, exiting: false, dropped: false } };
      });
      const leaving = prev.filter(p => !now.has(p.id) && !p.data.exiting).map(p => ({ ...p, data: { ...p.data, exiting: true } }));
      return [...next, ...leaving];
    });
    const timer = window.setTimeout(() => setNodes(prev => prev.filter(p => !p.data.exiting)), ms(MOTION.map.nodeExit.ms) + MOTION.map.exitGrace);
    return () => window.clearTimeout(timer);
  }, [view]);

  // Wires next to the chosen or hovered thing are drawn strongly and the rest step back. One state, and one object for each wire, so
  // pointing at a thing redraws only the wires next to it.
  const [hoverId, setHoverId] = useState<string | null>(null), [showAll, setShowAll] = useState(false);
  const activeId = panel ?? hoverId, wires = useMemo(createWireCache, []);
  const edges: Edge[] = useMemo(() => wires.edges(view.edges, activeId, showAll), [wires, view, activeId, showAll]);
  const byId = useMemo(() => new Map(model.nodes.map(n => [n.id, n] as const)), [model]);
  const hover = hoverId === null || byId.get(hoverId) === undefined ? '' : hoverLine(byId.get(hoverId)!);

  // Places are gathered, merged with what was saved, and written once. Two drags close together are both kept, and the write is
  // forced when the screen goes away, the window loses focus, or the window closes.
  const savedRef = useRef(saved), onLayoutRef = useRef(onLayout), validRef = useRef<ReadonlySet<string>>(new Set());
  savedRef.current = saved; onLayoutRef.current = onLayout; validRef.current = new Set(model.nodes.map(n => n.id));
  const keeper = useMemo(() => createKeeper({ delay: MOTION.map.saveDebounce, saved: () => savedRef.current, commit: l => onLayoutRef.current(l === null ? null : prunePlaces(l, validRef.current, PLACE_LIMITS.soft, PLACE_LIMITS.hard)) }), []);
  useEffect(() => {
    const flush = (): void => keeper.flush();
    window.addEventListener('blur', flush); window.addEventListener('beforeunload', flush); window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('blur', flush); window.removeEventListener('beforeunload', flush); window.removeEventListener('pagehide', flush); keeper.flush(); };
  }, [keeper]);
  const keep = useCallback((next: Record<string, Place>) => keeper.keep(next), [keeper]);
  // A move made with the arrow keys takes the same road as a drag: it is saved, and one burst of key presses is one step to undo.
  const dragging = useRef(false), burst = useRef<number | undefined>(undefined);
  const onNodesChange = useCallback((changes: NodeChange<BwNodeType>[]) => {
    if (!dragging.current) {
      const moved = changes.filter((c): c is Extract<NodeChange<BwNodeType>, { type: 'position' }> => c.type === 'position' && c.position !== undefined);
      if (moved.length > 0) {
        if (burst.current === undefined) remember();
        window.clearTimeout(burst.current); burst.current = window.setTimeout(() => { burst.current = undefined; }, MOTION.map.keyMoveBurst);
        const next: Record<string, Place> = {}; for (const c of moved) next[c.id] = snap(c.position!);
        setPlaces(p => ({ ...p, ...next })); keep(next);
      }
    }
    setNodes(prev => applyNodeChanges(changes, prev));
  }, [remember, keep]);
  const onDragStop = useCallback((_e: unknown, _n: BwNodeType, moved: BwNodeType[]) => {
    dragging.current = false;
    const next: Record<string, Place> = {}; for (const m of moved) next[m.id] = snap(m.position);
    setPlaces(p => ({ ...p, ...next })); keep(next);
  }, [keep]);

  const tidy = useCallback(() => {
    remember();
    const placed = autoLayout(view.nodes, view.edges); const next: Record<string, Place> = {};
    for (const n of view.nodes) next[n.id] = snap(placed.get(n.id) ?? { x: 0, y: 0 });
    setTidying(true); setPlaces(p => ({ ...p, ...next })); setNodes(prev => prev.map(p => ({ ...p, position: next[p.id] ?? p.position }))); keep(next);
    window.setTimeout(() => { setTidying(false); void flow.fitView({ duration: ms(MOTION.map.fit.ms), padding: 0.15 }); }, ms(MOTION.map.layoutMove.ms) + MOTION.map.settleGrace);
  }, [view, flow, keep, remember]);
  const reset = useCallback(() => {
    remember();
    setPlaces({}); keeper.forget(); setTidying(true);
    setNodes(prev => prev.map(p => ({ ...p, position: base.get(p.id) ?? p.position })));
    window.setTimeout(() => { setTidying(false); void flow.fitView({ duration: ms(MOTION.map.fit.ms), padding: 0.15 }); }, ms(MOTION.map.layoutMove.ms) + MOTION.map.settleGrace);
  }, [base, flow, keeper, remember]);
  const undoMove = useCallback(() => {
    const last = undo[undo.length - 1]; if (last === undefined) return;
    setUndo(u => u.slice(0, -1)); setTidying(true);
    setNodes(prev => prev.map(p => ({ ...p, position: last[p.id] ?? p.position }))); setPlaces(p => ({ ...p, ...last })); keep(last);
    window.setTimeout(() => setTidying(false), ms(MOTION.map.layoutMove.ms) + MOTION.map.settleGrace);
  }, [undo, keep]);
  const fit = useCallback(() => { void flow.fitView({ duration: ms(MOTION.map.fit.ms), padding: 0.15 }); }, [flow]);

  const selected = panel === null ? null : model.nodes.find(n => n.id === panel) ?? null;
  // The panel takes the keyboard when it opens, and Close gives it back to the thing it was about. A screen reader is told in words.
  const heading = useRef<HTMLHeadingElement>(null), lastOpened = useRef<string | null>(null), [announce, setAnnounce] = useState('');
  const selectedId = selected?.id ?? null;
  const opened = useMemo(() => selected === null ? '' : `Opened ${KIND_WORDS_MAP[selected.kind]} ${selected.label}${selected.status === null ? '' : `, ${STATUS_WORDS[selected.status]}`}. ${model.edges.filter(e => e.from === selected.id || e.to === selected.id).length} connections.`, [selected, model]);
  useEffect(() => { if (selectedId !== null) { lastOpened.current = selectedId; heading.current?.focus(); } }, [selectedId]);
  useEffect(() => { if (opened !== '') setAnnounce(opened); }, [opened]);
  const closePanel = useCallback(() => {
    const id = lastOpened.current; setPanel(null); setAnnounce('Closed.');
    window.requestAnimationFrame(() => { const node = id === null ? null : document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`); (node ?? document.querySelector<HTMLElement>('.bw-map .react-flow__renderer'))?.focus(); });
  }, []);
  const toggleKind = (k: MapKind): void => setKinds(prev => { const all = new Set<MapKind>(MAP_KINDS.filter(x => x !== 'machine')); const cur = prev ?? all; const next = new Set(cur); if (next.has(k)) next.delete(k); else next.add(k); return next.size === all.size ? null : next; });
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const el = (e.target as HTMLElement).closest('.react-flow__node') as HTMLElement | null;
    if (e.key === 'Enter' && el !== null) { e.preventDefault(); setPanel(el.getAttribute('data-id')); }
    if (e.key === 'Escape' && panel !== null) closePanel();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); undoMove(); }
  };
  const connections = selected === null ? [] : model.edges.filter(e => e.from === selected.id || e.to === selected.id).map(e => { const other = model.nodes.find(n => n.id === (e.from === selected.id ? e.to : e.from)); return other === undefined ? null : { id: e.id, text: e.from === selected.id ? `${REL_WORDS[e.rel]} ${other.label}` : `${other.label} ${REL_WORDS[e.rel]} it`, other: other.id }; }).filter((x): x is { id: string; text: string; other: string } => x !== null);
  const counts = `${view.nodes.length} ${view.nodes.length === 1 ? 'thing' : 'things'}, ${view.edges.length} ${view.edges.length === 1 ? 'wire' : 'wires'}`;

  return (
    <div className={`bw-map${tidying ? ' is-tidying' : ''}${panel !== null ? ' has-panel' : ''}`} onKeyDown={onKey}>
      <div className="bw-toolbar" role="toolbar" aria-label="Map controls">
        <div className="bw-seg" role="group" aria-label="What to show">{SCOPES.map(s => <button key={s.id} type="button" className={scope === s.id ? 'on' : ''} aria-pressed={scope === s.id} title={s.hint} onClick={() => setScope(s.id)}>{s.label}</button>)}</div>
        <input className="bw-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find something" aria-label="Find something on the map" />
        <div className="bw-seg" role="group" aria-label="Tool">
          <button type="button" className={tool === 'select' ? 'on' : ''} aria-pressed={tool === 'select'} title="Drag a box to select several things" onClick={() => setTool('select')}>Select</button>
          <button type="button" className={tool === 'move' ? 'on' : ''} aria-pressed={tool === 'move'} title="Drag to move the whole picture" onClick={() => setTool('move')}>Move</button>
        </div>
        <button type="button" className="bw-btn" onClick={undoMove} disabled={undo.length === 0} title="Take back the last move">Undo</button>
        <button type="button" className="bw-btn" onClick={tidy} title="Lay things out from left to right">Tidy up</button>
        <button type="button" className="bw-btn" onClick={fit}>Fit all</button>
        <button type="button" className="bw-btn" onClick={reset} title="Forget the places you chose">Reset layout</button>
        <button type="button" className={`bw-btn${showAll ? ' on' : ''}`} aria-pressed={showAll} onClick={() => setShowAll(a => !a)} title="Draw every wire at full strength">Show all wires</button>
        <button type="button" className={`bw-btn${outline ? ' on' : ''}`} aria-pressed={outline} onClick={() => setOutline(o => !o)}>Text outline</button>
      </div>
      <details className="bw-kinds-menu">
        <summary>Kinds shown: {kinds === null ? 'all' : `${kinds.size} of ${MAP_KINDS.length - 1}`}</summary>
        <div className="bw-kinds" role="group" aria-label="Kinds of thing to show">
          {MAP_KINDS.filter(k => k !== 'machine').map(k => <button key={k} type="button" className={`bw-kindchip kind-${k}${kinds === null || kinds.has(k) ? ' on' : ''}`} aria-pressed={kinds === null || kinds.has(k)} onClick={() => toggleKind(k)}><KindIcon kind={k} size={14} />{KIND_WORDS_MAP[k]}</button>)}
        </div>
      </details>
      <div className="bw-stage">
        <div className="bw-canvas" role="group" aria-label="The map. Tab to a thing, press Enter to open it, arrow keys move it.">
          <ReactFlow<BwNodeType, Edge>
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDragStart={() => { dragging.current = true; remember(); }} onNodeDragStop={onDragStop}
            onNodeClick={(_e, n) => setPanel(n.id)}
            onNodeMouseEnter={(_e, n) => setHoverId(n.id)} onNodeMouseLeave={() => setHoverId(null)}
            fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.1} maxZoom={2}
            snapToGrid snapGrid={[LAYOUT.gridSnap, LAYOUT.gridSnap]} nodesConnectable={false} elementsSelectable nodesFocusable edgesFocusable={false}
            selectionOnDrag={tool === 'select'} panOnDrag={tool === 'move' ? true : [1, 2]} panOnScroll multiSelectionKeyCode={['Meta', 'Shift']} deleteKeyCode={null}
            onlyRenderVisibleElements={view.nodes.length > 80} nodeDragThreshold={3} aria-label="Map of what Bowerloom manages"
          >
            <Background variant={BackgroundVariant.Dots} gap={LAYOUT.gridSnap * 1.5} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable ariaLabel="Overview of the map" nodeColor={n => `var(--kind-${(n.data as NodeData).n.kind})`} maskColor="var(--minimap-mask)" />
          </ReactFlow>
          {view.nodes.length === 0 ? <p className="bw-empty" role="status">Nothing matches. Change what is shown above.</p> : null}
          <div className="bw-overlay"><p className="bw-status" role="status" aria-live="polite">{hover === '' ? counts : hover}</p><Legend /></div>
        </div>
        <aside className={`bw-panel${selected !== null ? ' open' : ''}`} aria-label="About the chosen thing" hidden={selected === null}>
          {selected !== null ? (
            <div className="bw-panel-body">
              <div className="bw-panel-head"><span className={`bw-node-icon kind-${selected.kind}`}><KindIcon kind={selected.kind} size={22} /></span><div><p className="bw-node-kind">{KIND_WORDS_MAP[selected.kind]}</p><h2 ref={heading} tabIndex={-1}>{selected.label}</h2></div><button type="button" className="bw-btn" onClick={closePanel} aria-label="Close the details">Close</button></div>
              {selected.status !== null ? <p><span className={`bw-chip ${STATUS_TONE[selected.status]}`}>{STATUS_WORDS[selected.status]}</span></p> : null}
              <p>{selected.description}</p>
              {selected.guess !== undefined ? <p className="small muted">{selected.guess} Open the full page to change it.</p> : null}
              {selected.reasons.length > 0 ? <><h3>Why</h3><ul>{selected.reasons.map(r => <li key={r}>{r}</li>)}</ul></> : null}
              {connections.length > 0 ? <><h3>Connected to</h3><ul className="bw-conn">{connections.map(c => <li key={c.id}><button type="button" className="bw-link" onClick={() => setPanel(c.other)}>{c.text}</button></li>)}</ul></> : null}
              {selected.link !== null ? <button type="button" className="bw-btn primary" onClick={() => onOpen(selected.link!)}>Open the full page</button> : null}
            </div>
          ) : null}
        </aside>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {outline ? <OutlineView model={view} onOpen={setPanel} /> : null}
    </div>
  );
}

interface OutlineNode { id: string; text: string; kids: OutlineNode[] }
/** Nests the flat outline by depth, so a screen reader hears lists inside lists. */
function nest(rows: { id: string; text: string; depth: number }[]): OutlineNode[] {
  const top: OutlineNode[] = [], stack: { depth: number; node: OutlineNode }[] = [];
  for (const r of rows) {
    const node: OutlineNode = { id: r.id, text: r.text, kids: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= r.depth) stack.pop();
    (stack.length === 0 ? top : stack[stack.length - 1]!.node.kids).push(node); stack.push({ depth: r.depth, node });
  }
  return top;
}
function OutlineList({ nodes, onOpen }: { nodes: OutlineNode[]; onOpen(id: string): void }): ReactElement {
  return <ul>{nodes.map(n => <li key={n.id}><button type="button" className="bw-link" onClick={() => onOpen(n.id)}>{n.text}</button>{n.kids.length > 0 ? <OutlineList nodes={n.kids} onOpen={onOpen} /> : null}</li>)}</ul>;
}
function OutlineView({ model, onOpen }: { model: { nodes: MapNode[]; edges: { id: string; from: string; to: string; rel: EdgeRel }[] }; onOpen(id: string): void }): ReactElement {
  const tree = useMemo(() => nest(outlineOf(model)), [model]);
  return (
    <section className="bw-outline" aria-label="The map as text">
      <h2>The map as text</h2>
      <p className="muted">The same map as a list: what holds what, and what reads what.</p>
      <OutlineList nodes={tree} onOpen={onOpen} />
    </section>
  );
}

export function MapScreen(props: MapProps): ReactElement {
  const [tab, setTab] = useState<'map' | 'sketch'>('map');
  const tabs = ['map', 'sketch'] as const;
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const i = tabs.indexOf(tab); let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length; else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length; else if (e.key === 'Home') next = 0; else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault(); setTab(tabs[next]!); document.getElementById(`bw-tab-${tabs[next]}`)?.focus();
  };
  // Both pages stay in the window and one is hidden, so what is on the sketch board, and where you were on the map, survive a switch.
  return (
    <div className="bw-wrap">
      <div className="bw-tabs" role="tablist" aria-label="Map or sketch" onKeyDown={onKey}>
        {tabs.map(t => <button key={t} id={`bw-tab-${t}`} type="button" role="tab" aria-selected={tab === t} aria-controls={`bw-page-${t}`} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>{t === 'map' ? 'Map' : 'Sketch'}</button>)}
      </div>
      <div id="bw-page-map" role="tabpanel" aria-labelledby="bw-tab-map" hidden={tab !== 'map'}><ReactFlowProvider><Canvas {...props} /></ReactFlowProvider></div>
      <div id="bw-page-sketch" role="tabpanel" aria-labelledby="bw-tab-sketch" hidden={tab !== 'sketch'}><ReactFlowProvider><SketchBoard snapshot={props.snapshot} api={props.api} /></ReactFlowProvider></div>
    </div>
  );
}
