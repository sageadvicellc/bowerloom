/**
 * The harness graph canvas: a generic, reusable picture of a HarnessMapModel. It is given a model by props and holds no world.
 * Later screens (the harness editor, the skills manager and the agent manager) drive it through the props and the callbacks below.
 *
 * What a person can do:
 *  - Drag a node: it moves and its place is reported (`onPositionsChange`). Drop it ON another node: `onDropOnNode`, and it settles back.
 *  - Drag a wire from one node's side to another node: `onConnect(sourceId, targetId)`. Keyboard: press C on a node, move to another, press Enter.
 *  - Click a node: `onSelect(id)`. Click the empty page: `onSelect(null)`.
 *  - Double click, or Enter: `onNodeMenu(id, 'open')`. Right click, the menu key, Shift+F10 or M: a menu of what can be done to the node.
 *  - Arrow keys move the focused node (Shift for a bigger step). Tab moves between nodes.
 *
 * Every state is drawn in words as well as colour. Motion comes from MOTION.map in motion-tokens.ts; with `reduceMotion` every duration is 0.
 */
import '@xyflow/react/dist/style.css';
import './canvas.css';
import { Background, BackgroundVariant, ConnectionMode, Controls, Handle, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow, useStore } from '@xyflow/react';
import type { Connection, Edge, Node, NodeChange, NodeProps } from '@xyflow/react';
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { actionsFor, describeNode, HARNESS_REL_WORDS } from '../../shared/proto/harnessmodel.js';
import type { HarnessEdge, HarnessEdgeRel, HarnessMapModel, HarnessNode, NodeAction } from '../../shared/proto/harnessmodel.js';
import { HARNESS_LAYOUT, layoutHarness, maxRowsFor, nodeAt, pinnedPlace, snapPoint, wireSides } from '../../shared/proto/harnesslayout.js';
import type { Point, Positions } from '../../shared/proto/harnesslayout.js';
import { MOTION, ms } from '../motion-tokens.js';
import { HarnessIcon, iconNameOf } from './icons.js';
import { timerSlot } from './timer-slot.js';

/** The public face of the canvas. Three later screens depend on it: change it only by adding. */
export interface HarnessCanvasProps {
  model: HarnessMapModel;
  selectedId: string | null;
  onSelect(id: string | null): void;
  /** A wire was dragged from `sourceId` to `targetId` (or made with the keyboard). The canvas draws nothing new: the screen decides what it means. */
  /** A wire was drawn. Answer `done` when the wire was made and `refused` when it was not; the canvas announces and animates a wire only on `done`. Answering nothing means the screen still has a question to ask. */
  onConnect(sourceId: string, targetId: string): void | 'done' | 'refused';
  /** A node was dropped on top of another one. The dropped node settles back to its place. */
  onDropOnNode(draggedId: string, targetId: string): void;
  /** `open` for double click and Enter. The rest come from the node's menu. `unhide` also means "stop replacing". */
  onNodeMenu(id: string, action: 'hide' | 'unhide' | 'replace' | 'expand' | 'collapse' | 'open'): void;
  /** Places the person chose. Without them, the canvas keeps its own. */
  positions?: Positions;
  onPositionsChange?(p: Positions): void;
  reduceMotion: boolean;
}

// ---- Local values (no motion value is missing from MOTION.map; these are sizes and steps) ----
const KEY_STEP = 16, KEY_STEP_BIG = 64;
const FIT = { padding: 0.06, maxZoom: 1, minZoom: 0.02 } as const;
/** Below this zoom a node shows only its name, bigger, so the picture still reads. */
const FAR_ZOOM = 0.7;
/** The name of a far node is drawn at about FAR_FONT_SCREEN pixels on screen, between these two sizes in the node's own units. */
const FAR_FONT_MIN = 19, FAR_FONT_MAX = 25, FAR_FONT_SCREEN = 9.5;
/** Past this many nodes the canvas draws only what is in view and plays no entry animation. */
const MANY = 80, BUSY_EDGES = 150;
/** The small map sits top right under the Fit button, where the layout leaves room (only the interfaces are in the last column). */
const MINIMAP: CSSProperties = { width: 132, height: 88, marginTop: 52 };
/** In a window narrower than this the small map would cover the last column, so it is left out. */
const MINIMAP_MIN_WIDTH = 1100;
const { nodeWidth: NODE_W, nodeHeight: NODE_H } = HARNESS_LAYOUT;

interface NodeData extends Record<string, unknown> { n: HarnessNode; settle: 'drop' | 'connect' | null; wires: number }
type HcNode = Node<NodeData, 'hc'>;

interface Actions { toggleGroup(id: string, expanded: boolean): void }
const ActionsContext = createContext<Actions>({ toggleGroup: () => undefined });

const TONE: Readonly<Record<string, string>> = { 'runs code': 'warn', 'secret missing': 'bad', conflict: 'warn', 'new version': 'good', 'not installed': 'warn' };
/** Badges that stay on a node even when it is far away. The rest (inherited, library, extras) are left out of the way and still read by a screen reader. */
const FLAGS = new Set([...Object.keys(TONE), 'hidden', 'replaced']);
const SHOWN_BADGES = 2;

const HcNodeView = memo(function HcNodeView({ data, selected }: NodeProps<HcNode>): ReactElement {
  const { n, settle } = data;
  const actions = useContext(ActionsContext);
  const shown = n.badges.slice(0, SHOWN_BADGES), more = n.badges.length - shown.length;
  const cls = ['hc-node', `kind-${n.kind}`, n.toolKind === null ? '' : `tool-${n.toolKind}`, selected ? 'is-selected' : '', n.inherited ? 'is-inherited' : '', n.hidden ? 'is-hidden' : '', n.replaced ? 'is-replaced' : '',
    n.conflict ? 'is-conflict' : '', n.badges.some(b => FLAGS.has(b)) || n.kind === 'group' ? 'has-flags' : '', n.notInstalled ? 'is-missing' : '', n.libraryPinned ? 'is-library' : '', settle === 'drop' ? 'is-dropped' : '', settle === 'connect' ? 'is-connected' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} title={describeNode(n)}>
      <Handle type="source" id="l" position={Position.Left} className="hc-handle" />
      <span className="hc-icon"><HarnessIcon name={iconNameOf(n)} size={20} /></span>
      <span className="hc-text">
        <span className="hc-top">
          <span className="hc-kind">{n.kindLabel}</span>
          {shown.map(b => <span key={b} className={`hc-chip ${TONE[b] ?? 'quiet'}${FLAGS.has(b) ? ' flag' : ''}`}>{b}</span>)}
          {more > 0 ? <span className="hc-chip quiet" title={n.badges.slice(SHOWN_BADGES).join(', ')}>+{more}</span> : null}
          {n.kind === 'group' ? <button type="button" className="hc-toggle nodrag nopan" tabIndex={-1} aria-label={n.expanded ? `Show ${n.label} as one group` : `Show every item of ${n.label}`}
            onClick={e => { e.stopPropagation(); actions.toggleGroup(n.id, n.expanded); }} onDoubleClick={e => { e.stopPropagation(); }}>{n.expanded ? 'Close' : 'Open'}</button> : null}
        </span>
        <span className="hc-label">{n.label}</span>
        <span className="hc-detail">{n.detail}</span>
      </span>
      <Handle type="source" id="r" position={Position.Right} className="hc-handle" />
    </div>
  );
});
const nodeTypes = { hc: HcNodeView };

// ---- Pure helpers for the drawing ----

const NODE_KEYS = ['id', 'kind', 'toolKind', 'interfaceId', 'kindLabel', 'label', 'detail', 'scopeId', 'fromScope', 'inherited', 'hidden', 'replaced', 'replacedBy', 'libraryPinned', 'newerVersion', 'runsCode', 'secretMissing', 'conflict', 'notInstalled', 'groupId', 'memberCount', 'expanded'] as const;
/** True when two nodes say the same thing, so the first one's object can be kept and the canvas does not draw it again. */
function sameNode(a: HarnessNode, b: HarnessNode): boolean {
  return a === b || (NODE_KEYS.every(k => a[k] === b[k]) && a.badges.length === b.badges.length && a.badges.every((x, i) => x === b.badges[i]));
}

type WireState = 'plain' | 'active' | 'quiet';
const wireStateOf = (e: Pick<HarnessEdge, 'from' | 'to'>, activeId: string | null): WireState => (activeId === null ? 'plain' : e.from === activeId || e.to === activeId ? 'active' : 'quiet');

/** One edge object per wire and state, so pointing at a node redraws only the wires next to it. */
function createWireCache(): { edges(list: readonly HarnessEdge[], places: Positions, activeId: string | null): Edge[] } {
  const made = new Map<string, Edge>();
  return {
    edges(list, places, activeId) {
      const live = new Set<string>();
      const out = list.map(e => {
        const a = places[e.from], b = places[e.to], sides = a === undefined || b === undefined ? { source: 'r' as const, target: 'l' as const } : wireSides(a, b), state = wireStateOf(e, activeId);
        const key = `${e.id}|${state}|${sides.source}${sides.target}|${e.label}`; live.add(key);
        let edge = made.get(key);
        if (edge === undefined) {
          edge = { id: e.id, source: e.from, target: e.to, sourceHandle: sides.source, targetHandle: sides.target, type: 'default', className: `hc-edge rel-${e.rel} is-${state}`, label: e.label, selectable: false, focusable: false, data: { rel: e.rel } };
          made.set(key, edge);
        }
        return edge;
      });
      if (made.size > live.size * 4) for (const k of made.keys()) if (!live.has(k)) made.delete(k);
      return out;
    },
  };
}

const LEGEND: readonly HarnessEdgeRel[] = ['uses', 'has-tool', 'reads', 'lands-in', 'replaces'];
const LEGEND_WORDS: Readonly<Record<HarnessEdgeRel, string>> = { uses: 'An agent uses a skill', 'has-tool': 'An agent has a tool (with its access)', reads: 'An agent reads a slice', 'lands-in': 'An item is written to an interface', replaces: 'A new item replaces an inherited one' };

// ---- The menu of one node ----

function NodeMenu({ node, x, y, onPick, onClose }: { node: HarnessNode; x: number; y: number; onPick(a: NodeAction): void; onClose(): void }): ReactElement {
  const choices = actionsFor(node), first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')], at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); items[(at + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(at + items.length - 1) % items.length]?.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); onClose(); }
    else e.stopPropagation();
  };
  return (
    <div className="hc-menu" role="menu" aria-label={`What to do with ${node.label}`} style={{ left: x, top: y }} onKeyDown={onKey}>
      {choices.map((c, i) => <button key={c.action} ref={i === 0 ? first : undefined} type="button" role="menuitem" className="hc-menu-item" onClick={() => onPick(c.action)}>{c.label}</button>)}
    </div>
  );
}

// ---- The canvas ----

function Flow({ props, box }: { props: HarnessCanvasProps; box: { width: number; height: number } }): ReactElement {
  const { model, selectedId, reduceMotion } = props;
  const flow = useReactFlow<HcNode, Edge>();
  const latest = useRef(props); latest.current = props;
  const dur = (v: number): number => (reduceMotion ? 0 : ms(v));
  const zoom = useStore(s => Math.round(s.transform[2] * 20) / 20), far = zoom < FAR_ZOOM;

  // Places. The ones the person chose come from the screen, or are kept here when the screen gives none.
  const [own, setOwn] = useState<Positions>({});
  const pinned = props.positions ?? own;
  const pinnedRef = useRef(pinned); pinnedRef.current = pinned;
  // The layout depends on the window only through its rows, so a small resize does not move the nodes.
  const sizeRef = useRef(box); sizeRef.current = box;
  const rows = maxRowsFor(box, model);
  const layout = useMemo(() => layoutHarness(model, sizeRef.current, pinned), [model, rows, pinned]); // eslint-disable-line react-hooks/exhaustive-deps
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const commit = useCallback((next: Positions) => { latest.current.onPositionsChange?.(next); if (latest.current.positions === undefined) setOwn(next); }, []);

  const wireCounts = useMemo(() => { const m = new Map<string, number>(); for (const e of model.edges) { m.set(e.from, (m.get(e.from) ?? 0) + 1); m.set(e.to, (m.get(e.to) ?? 0) + 1); } return m; }, [model]);
  const many = model.nodes.length > MANY, busy = model.edges.length > BUSY_EDGES;

  // Settling after a drop or a connect: a short, one-time note on the nodes that took part.
  const [settle, setSettle] = useState<{ ids: ReadonlySet<string>; kind: 'drop' | 'connect' } | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const settleNodes = useCallback((ids: string[], kind: 'drop' | 'connect') => {
    if (reduceMotion) return;
    window.clearTimeout(settleTimer.current);
    setSettle({ ids: new Set(ids), kind });
    const t = kind === 'drop' ? MOTION.map.drop.ms : MOTION.map.connect.ms;
    settleTimer.current = window.setTimeout(() => setSettle(null), ms(t) + MOTION.map.settleGrace);
  }, [reduceMotion]);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // The nodes React Flow holds. A node that says the same thing, at the same place, keeps the very same object.
  const build = useCallback((prev: readonly HcNode[]): HcNode[] => {
    const before = new Map(prev.map(p => [p.id, p]));
    return model.nodes.map(n => {
      const old = before.get(n.id), place = layoutRef.current[n.id] ?? { x: 0, y: 0 }, sel = n.id === selectedId, wires = wireCounts.get(n.id) ?? 0;
      const sm: 'drop' | 'connect' | null = settle?.ids.has(n.id) === true ? settle.kind : null;
      if (old !== undefined && sameNode(old.data.n, n) && old.position.x === place.x && old.position.y === place.y && old.selected === sel && old.data.settle === sm && old.data.wires === wires) return old;
      return {
        id: n.id, type: 'hc', position: place, selected: sel, data: { n: old !== undefined && sameNode(old.data.n, n) ? old.data.n : n, settle: sm, wires },
        width: NODE_W, height: NODE_H, initialWidth: NODE_W, initialHeight: NODE_H, ariaLabel: `${describeNode(n)} ${wires} ${wires === 1 ? 'wire' : 'wires'}.`,
        ...(old?.measured === undefined ? {} : { measured: old.measured }),
      } satisfies HcNode;
    });
  }, [model, selectedId, settle, wireCounts]);
  const [nodes, setNodes] = useState<HcNode[]>(() => build([]));
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setNodes(prev => build(prev)); }, [build, layout]);

  // Moves from a drag go into the nodes as they happen. Selection is not React Flow's to change: the screen owns it.
  const onNodesChange = useCallback((changes: NodeChange<HcNode>[]) => {
    const kept = changes.filter(c => c.type !== 'select' && c.type !== 'remove');
    if (kept.length > 0) setNodes(prev => applyNodeChanges(kept, prev));
  }, []);

  // Wires: the ones next to the hovered or chosen node are drawn strongly.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const wires = useMemo(createWireCache, []);
  const edges = useMemo(() => wires.edges(model.edges, layout, hoverId ?? selectedId), [wires, model, layout, hoverId, selectedId]);

  // Drag, drop and move.
  const before = useRef<Point | null>(null), [settling, setSettling] = useState(false), [settlingTimer] = useState(timerSlot);
  useEffect(() => () => settlingTimer.clear(), [settlingTimer]);
  const centre = (p: Point): Point => ({ x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 });
  const onDragStart = useCallback((_e: unknown, node: HcNode) => { before.current = { ...node.position }; settlingTimer.clear(); setSettling(false); }, [settlingTimer]);
  const onDragStop = useCallback((_e: unknown, node: HcNode) => {
    const current: Positions = {}; for (const n of flow.getNodes()) current[n.id] = n.position;
    const target = nodeAt(current, centre(node.position), node.id);
    if (target !== null) {
      // Dropped ON a node: tell the screen, and let the dropped node settle back where it was.
      const home = layoutRef.current[node.id] ?? before.current ?? node.position;
      setSettling(true); setNodes(prev => prev.map(p => (p.id === node.id ? { ...p, position: home } : p)));
      settleNodes([target, node.id], 'drop');
      settlingTimer.set(() => setSettling(false), ms(MOTION.map.drop.ms) + MOTION.map.settleGrace);
      latest.current.onDropOnNode(node.id, target);
      return;
    }
    const at = snapPoint(node.position);
    setNodes(prev => prev.map(p => (p.id === node.id ? { ...p, position: at } : p)));
    commit({ ...pinnedRef.current, [node.id]: at });
  }, [flow, commit, settleNodes, settlingTimer]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;
    if (latest.current.onConnect(c.source, c.target) === 'done') settleNodes([c.source, c.target], 'connect');
  }, [settleNodes]);

  // Keyboard and menu.
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null), [linkFrom, setLinkFrom] = useState<string | null>(null), [announce, setAnnounce] = useState('');
  const byId = useMemo(() => new Map(model.nodes.map(n => [n.id, n])), [model]);
  const focusNode = useCallback((id: string) => { window.requestAnimationFrame(() => { rootRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.focus(); }); }, []);
  const openMenuAt = useCallback((id: string, clientX: number, clientY: number) => {
    const r = rootRef.current?.getBoundingClientRect(); if (r === undefined) return;
    setMenu({ id, x: Math.max(4, Math.min(r.width - 220, clientX - r.left)), y: Math.max(4, Math.min(r.height - 120, clientY - r.top)) });
  }, []);
  const closeMenu = useCallback(() => { setMenu(prev => { if (prev !== null) focusNode(prev.id); return null; }); }, [focusNode]);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node'), id = el?.getAttribute('data-id') ?? null;
    if (e.key === 'Escape') {
      if (linkFrom !== null) { setLinkFrom(null); setAnnounce('Connecting cancelled.'); } else if (selectedId !== null) props.onSelect(null);
      return;
    }
    if (el === null || id === null || menu !== null) return;
    const n = byId.get(id);
    if (e.key === 'Enter') {
      e.preventDefault();
      if (linkFrom !== null && linkFrom !== id) {
        const from = linkFrom, a = byId.get(from)?.label ?? '', b = n?.label ?? '';
        setLinkFrom(null);
        // The screen decides first. Only a wire that was made is announced and animated.
        const result = props.onConnect(from, id);
        if (result === 'done') { setAnnounce(`Connected ${a} to ${b}.`); settleNodes([from, id], 'connect'); } else setAnnounce(result === 'refused' ? `Could not connect ${a} to ${b}.` : '');
      } else props.onNodeMenu(id, 'open');
    } else if (e.key === ' ') { e.preventDefault(); props.onSelect(id); }
    else if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setLinkFrom(id); setAnnounce(`Connecting from ${n?.label ?? 'this node'}. Move to another node and press Enter, or press Escape to cancel.`); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10') || (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey)) { e.preventDefault(); const r = el.getBoundingClientRect(); openMenuAt(id, r.left + 24, r.bottom - 8); }
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP, dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const now = pinnedPlace(pinnedRef.current, id) ?? layoutRef.current[id]; if (now === undefined) return;
      commit({ ...pinnedRef.current, [id]: snapPoint({ x: now.x + dx, y: now.y + dy }) });
    }
  };

  const actions = useMemo<Actions>(() => ({ toggleGroup: (id, expanded) => latest.current.onNodeMenu(id, expanded ? 'collapse' : 'expand') }), []);
  const fit = useCallback(() => { void flow.fitView({ ...FIT, duration: dur(MOTION.map.fit.ms) }); }, [flow, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = MOTION.map;
  const vars = {
    '--hc-far-font': `${Math.min(FAR_FONT_MAX, Math.max(FAR_FONT_MIN, FAR_FONT_SCREEN / Math.max(zoom, 0.05)))}px`, '--hc-w': `${NODE_W}px`, '--hc-h': `${NODE_H}px`,
    '--hc-hover-ms': `${dur(m.hover.ms)}ms`, '--hc-hover-ease': m.hover.ease, '--hc-select-ms': `${dur(m.select.ms)}ms`, '--hc-select-ease': m.select.ease,
    '--hc-enter-ms': `${dur(m.nodeEnter.ms)}ms`, '--hc-enter-ease': m.nodeEnter.ease, '--hc-enter-distance': `${m.nodeEnter.distance}px`, '--hc-enter-scale': String(m.nodeEnter.scaleFrom),
    '--hc-edge-ms': `${dur(m.edgeDraw.ms)}ms`, '--hc-edge-ease': m.edgeDraw.ease,
    '--hc-drop-ms': `${dur(m.drop.ms)}ms`, '--hc-drop-ease': m.drop.ease, '--hc-drop-scale': String(m.drop.scaleFrom), '--hc-connect-ms': `${dur(m.connect.ms)}ms`, '--hc-connect-ease': m.connect.ease,
  } as CSSProperties;
  const menuNode = menu === null ? undefined : byId.get(menu.id);

  return (
    <div ref={rootRef} className={`hc-root${reduceMotion ? ' is-reduced' : ''}${many ? ' is-many' : ''}${busy ? ' is-busy' : ''}${far ? ' is-far' : ''}${settling ? ' is-settling' : ''}${linkFrom !== null ? ' is-linking' : ''}`} style={vars} onKeyDown={onKeyDown}>
      <ActionsContext.Provider value={actions}>
        <ReactFlow<HcNode, Edge>
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onConnect={onConnect} isValidConnection={c => c.source !== c.target}
          onNodeClick={(_e, n) => props.onSelect(n.id)} onNodeDoubleClick={(_e, n) => props.onNodeMenu(n.id, 'open')} onPaneClick={() => { props.onSelect(null); setMenu(null); setLinkFrom(null); }}
          onNodeContextMenu={(e, n) => { e.preventDefault(); openMenuAt(n.id, e.clientX, e.clientY); }} onNodeDragStart={onDragStart} onNodeDragStop={onDragStop}
          onNodeMouseEnter={(_e, n) => setHoverId(n.id)} onNodeMouseLeave={() => setHoverId(null)}
          connectionMode={ConnectionMode.Loose} connectionRadius={28} nodesConnectable nodesDraggable nodesFocusable edgesFocusable={false} elementsSelectable disableKeyboardA11y
          selectionOnDrag={false} selectionKeyCode={null} multiSelectionKeyCode={null} deleteKeyCode={null} panOnScroll nodeDragThreshold={3}
          minZoom={FIT.minZoom} maxZoom={2} fitView fitViewOptions={FIT} onlyRenderVisibleElements={many} aria-label="Harness graph"
        >
          <Background variant={BackgroundVariant.Dots} gap={HARNESS_LAYOUT.gridSnap * 3} size={1} />
          <Controls showInteractive={false} showFitView={false} position="bottom-left" />
          {many && box.width >= MINIMAP_MIN_WIDTH ? <MiniMap pannable zoomable position="top-right" style={MINIMAP} ariaLabel="Small map of the whole graph" nodeColor={n => `var(--hc-kind-${(n.data as NodeData).n.kind})`} maskColor="var(--minimap-mask)" /> : null}
          <Panel position="top-right"><button type="button" className="hc-fit" onClick={fit}>Fit to view</button></Panel>
          <Panel position="top-left">
            <details className="hc-legend">
              <summary>What the wires mean</summary>
              <ul>{LEGEND.map(r => <li key={r}><svg width="40" height="8" aria-hidden="true" className={`rel-${r}`}><line x1="2" y1="4" x2="38" y2="4" /></svg><span><b>{HARNESS_REL_WORDS[r]}</b>: {LEGEND_WORDS[r]}</span></li>)}</ul>
            </details>
          </Panel>
        </ReactFlow>
      </ActionsContext.Provider>
      {menu !== null && menuNode !== undefined ? <NodeMenu node={menuNode} x={menu.x} y={menu.y} onClose={closeMenu} onPick={a => { const id = menu.id; setMenu(null); focusNode(id); props.onNodeMenu(id, a); }} /> : null}
      {linkFrom !== null ? <p className="hc-banner" role="status">Connecting from {byId.get(linkFrom)?.label ?? 'a node'}. Move to another node and press Enter. Escape cancels.</p> : null}
      <p className="hc-sr" role="status" aria-live="polite">{announce}</p>
    </div>
  );
}

/** Draws a harness graph. See the notes at the top of this file. */
export function HarnessCanvas(props: HarnessCanvasProps): ReactElement {
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  // The canvas waits for its first measure, so the rows of the layout come from the real height.
  useLayoutEffect(() => {
    const el = frame.current; if (el === null) return;
    const read = (): void => { const width = Math.round(el.clientWidth), height = Math.round(el.clientHeight); if (width > 0 && height > 0) setBox(prev => (prev !== null && Math.abs(prev.width - width) < 2 && Math.abs(prev.height - height) < 2 ? prev : { width, height })); };
    read();
    const ro = new ResizeObserver(read); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={frame} className="hc-frame">
      {box === null ? null : <ReactFlowProvider key={props.model.scopeId}><Flow props={props} box={box} /></ReactFlowProvider>}
    </div>
  );
}
