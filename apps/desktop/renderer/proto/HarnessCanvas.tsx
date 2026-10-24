/**
 * The harness graph canvas: a generic, reusable picture of a HarnessMapModel. It is given a model by props and holds no world.
 * Later screens (the harness editor, the skills manager and the agent manager) drive it through the props and the callbacks below.
 *
 * What a person can do:
 *  - Drag a node: it moves and its place is reported (`onPositionsChange`). Drop it ON another node: `onDropOnNode`, and it settles back.
 *  - Drag a connection from one node's side to another node: `onConnect(sourceId, targetId)`. Keyboard: press C on a node, move to another, press Enter.
 *  - Click a node: `onSelect(id)`. Click the empty page: `onSelect(null)`.
 *  - Double click, or Enter: `onNodeMenu(id, 'open')`. Right click, the menu key, Shift+F10 or M: a menu of what can be done to the node.
 *  - Arrow keys move the focused node (Shift for a bigger step). Tab moves between nodes.
 *
 * Every state is drawn in words as well as colour. Motion comes from MOTION.map in motion-tokens.ts; with `reduceMotion` every duration is 0.
 * Only the connections of the chosen or pointed-at node are drawn in full (see harness-wires.ts), and text is never drawn smaller than about 12 px on screen:
 * as the picture shrinks, the text in it grows in step (`--hc-far-font`).
 * The entrance (nodes rise in, connections draw) plays once, the first time a canvas is shown. A scope switch is a 120 ms crossfade.
 */
import '@xyflow/react/dist/style.css';
import './canvas.css';
import { Background, BackgroundVariant, ConnectionMode, Handle, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow, useStore } from '@xyflow/react';
import type { Connection, Edge, Node, NodeChange, NodeProps } from '@xyflow/react';
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { actionsFor, describeNode, HARNESS_REL_WORDS } from '../../shared/proto/harnessmodel.js';
import type { HarnessEdge, HarnessEdgeRel, HarnessMapModel, HarnessNode, NodeAction } from '../../shared/proto/harnessmodel.js';
import { HARNESS_LAYOUT, layoutHarness, maxRowsFor, nodeAt, pinnedPlace, sizeOf, snapPoint, wireSides } from '../../shared/proto/harnesslayout.js';
import type { NodeSize, Point, Positions } from '../../shared/proto/harnesslayout.js';
import { drawnWires, neighboursOf } from '../../shared/proto/harness-wires.js';
import type { WireState } from '../../shared/proto/harness-wires.js';
import { MOTION, ms } from '../motion-tokens.js';
import { HarnessIcon, iconNameOf } from './icons.js';
import { timerSlot } from './timer-slot.js';

/** The public face of the canvas. Three later screens depend on it: change it only by adding. */
export interface HarnessCanvasProps {
  model: HarnessMapModel;
  selectedId: string | null;
  onSelect(id: string | null): void;
  /** A connection was dragged from `sourceId` to `targetId` (or made with the keyboard). The canvas draws nothing new: the screen decides what it means. */
  /** A connection was drawn. Answer `done` when it was made and `refused` when it was not; the canvas announces and animates a connection only on `done`. Answering nothing means the screen still has a question to ask. */
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
/** Fit leaves the top strip free for the toolbar, so no node is ever under a button. */
const FIT_TOP = 60, FIT_SIDE = 16;
const FIT = { padding: { top: `${FIT_TOP}px`, right: `${FIT_SIDE}px`, bottom: `${FIT_SIDE}px`, left: `${FIT_SIDE}px` }, maxZoom: 1, minZoom: 0.02 } as const;
/** The room the layout may use: the window less the fit padding. */
const FIT_ROOM = { width: 2 * FIT_SIDE, height: FIT_TOP + FIT_SIDE } as const;
/** Below this zoom a node shows less (no detail line, only the chips that flag something), so the larger text still fits. */
const FAR_ZOOM = 0.85;
/** Text is drawn at about this many pixels on screen at the least: names, then the small text (the kind word, chips, the group button). The values in the node's own units are these divided by the zoom, up to a limit. */
const NAME_SCREEN = 12.5, SMALL_SCREEN = 12.2, FAR_FONT_MAX = 44;
/** Past this many nodes the canvas draws only what is in view and plays no entry animation. */
const MANY = 80, BUSY_EDGES = 150;
/** More connections than this: the connections do not draw themselves in. */
const DRAW_IN_MAX = 40;
/** The small map sits top right under the toolbar, where the layout leaves room (only the interfaces are in the last column). */
const MINIMAP: CSSProperties = { width: 132, height: 88, marginTop: 52 };
/** In a window narrower than this the small map would cover the last column, so it is left out. */
const MINIMAP_MIN_WIDTH = 1100;
/** How long the crossfade of a scope switch lasts. A local value: motion-tokens.ts has none for it. */
const SWITCH_MS = 120;
const { nodeWidth: NODE_W, nodeHeight: NODE_H } = HARNESS_LAYOUT;
/** Only the first canvas of a session plays the entrance. */
let entranceSpent = false;

interface NodeData extends Record<string, unknown> { n: HarnessNode; settle: 'drop' | 'connect' | null; wires: number; linked: boolean }
type HcNode = Node<NodeData, 'hc'>;

interface Actions { toggleGroup(id: string, expanded: boolean): void }
const ActionsContext = createContext<Actions>({ toggleGroup: () => undefined });

const TONE: Readonly<Record<string, string>> = { 'runs code': 'warn', 'secret missing': 'bad', conflict: 'warn', 'new version': 'good', 'not installed': 'warn' };
/** Badges that stay on a node even when it is far away. The rest (inherited, library, extras) are left out of the way and still read by a screen reader. */
const FLAGS = new Set([...Object.keys(TONE), 'hidden', 'replaced']);
const SHOWN_BADGES = 2, SHOWN_BADGES_GROUP = 1;

const HcNodeView = memo(function HcNodeView({ data, selected }: NodeProps<HcNode>): ReactElement {
  const { n, settle, linked } = data;
  const actions = useContext(ActionsContext), size = sizeOf(n);
  const limit = n.kind === 'group' ? SHOWN_BADGES_GROUP : SHOWN_BADGES, shown = n.badges.slice(0, limit), more = n.badges.length - shown.length;
  // A flag needs room: the kind word then loses its second part ("Tool · MCP" is "Tool"), and the tooltip and the details still say all of it.
  const kindText = shown.some(b => FLAGS.has(b)) || n.kind === 'group' ? n.kindLabel.replace(/ · .*$/, '') : n.kindLabel;
  const cls = ['hc-node', `kind-${n.kind}`, n.kind === 'interface' || n.kind === 'scope' ? 'size-large' : n.kind === 'skill' ? 'size-small' : 'size-medium', n.toolKind === null ? '' : `tool-${n.toolKind}`, selected ? 'is-selected' : '', n.inherited ? 'is-inherited' : '', n.hidden ? 'is-hidden' : '', n.replaced ? 'is-replaced' : '',
    n.conflict ? 'is-conflict' : '', n.badges.some(b => FLAGS.has(b)) || n.kind === 'group' ? 'has-flags' : '', n.notInstalled ? 'is-missing' : '', n.libraryPinned ? 'is-library' : '', linked ? 'is-linked' : '', settle === 'drop' ? 'is-dropped' : '', settle === 'connect' ? 'is-connected' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} title={describeNode(n)} style={{ width: size.w, height: size.h }}>
      <Handle type="source" id="l" position={Position.Left} className="hc-handle" />
      <span className="hc-icon"><HarnessIcon name={iconNameOf(n)} size={16} /></span>
      <span className="hc-text">
        <span className="hc-top">
          <span className="hc-kind">{kindText}</span>
          {shown.map(b => <span key={b} className={`hc-chip ${TONE[b] ?? 'quiet'}${FLAGS.has(b) ? ' flag' : ''}`}>{b}</span>)}
          {more > 0 ? <span className="hc-chip quiet" title={n.badges.slice(SHOWN_BADGES).join(', ')}>+{more}</span> : null}
        </span>
        <span className="hc-label">{n.label}</span>
        <span className="hc-detail">{n.detail}</span>
      </span>
      {n.kind === 'group' ? <button type="button" className="hc-toggle nodrag nopan" tabIndex={-1} aria-label={n.expanded ? `Show ${n.label} as one group` : `Show every item of ${n.label}`}
        onClick={e => { e.stopPropagation(); actions.toggleGroup(n.id, n.expanded); }} onDoubleClick={e => { e.stopPropagation(); }}>{n.expanded ? 'Close' : 'Open'}</button> : null}
      <Handle type="source" id="r" position={Position.Right} className="hc-handle" />
    </div>
  );
});
const nodeTypes = { hc: HcNodeView };

// ---- Pure helpers for the drawing ----

const NODE_KEYS = ['id', 'kind', 'toolKind', 'interfaceId', 'kindLabel', 'label', 'detail', 'scopeId', 'fromScope', 'inherited', 'hidden', 'replaced', 'replacedBy', 'libraryPinned', 'newerVersion', 'runsCode', 'secretMissing', 'conflict', 'notInstalled', 'groupId', 'memberCount', 'expanded', 'memberKind'] as const;
/** True when two nodes say the same thing, so the first one's object can be kept and the canvas does not draw it again. */
function sameNode(a: HarnessNode, b: HarnessNode): boolean {
  return a === b || (NODE_KEYS.every(k => a[k] === b[k]) && a.badges.length === b.badges.length && a.badges.every((x, i) => x === b.badges[i]));
}

/** One edge object per connection and state, so pointing at a node redraws only the connections next to it. */
function createWireCache(): { edges(list: readonly { edge: HarnessEdge; state: WireState }[], places: Positions): Edge[] } {
  const made = new Map<string, Edge>();
  return {
    edges(list, places) {
      const live = new Set<string>();
      const out = list.map(({ edge: e, state }) => {
        const a = places[e.from], b = places[e.to], sides = a === undefined || b === undefined ? { source: 'r' as const, target: 'l' as const } : wireSides(a, b);
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
const LEGEND_WORDS: Readonly<Record<HarnessEdgeRel, string>> = { uses: 'An agent uses a skill', 'has-tool': 'An agent has a tool (with its access)', reads: 'An agent reads a slice', 'lands-in': 'An item is written to an interface (one faint line per agent; choose an agent to see them all)', replaces: 'A new item replaces an inherited one' };

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

function Flow({ props, box, entrance }: { props: HarnessCanvasProps; box: { width: number; height: number }; entrance: boolean }): ReactElement {
  const { model, selectedId, reduceMotion } = props;
  const flow = useReactFlow<HcNode, Edge>();
  const latest = useRef(props); latest.current = props;
  const dur = (v: number): number => (reduceMotion ? 0 : ms(v));
  // The zoom is read in steps of 0.02 and rounded down, so text that grows as the picture shrinks never ends up a little under its size.
  const zoom = useStore(s => Math.max(0.02, Math.floor(s.transform[2] * 50) / 50)), far = zoom < FAR_ZOOM;

  // The entrance plays once, for the first canvas of a session; its class is dropped when it is over so a node that comes later does not replay it.
  const [plays] = useState(entrance), [entering, setEntering] = useState(entrance);
  useEffect(() => {
    if (!plays) return undefined;
    entranceSpent = true;
    const t = window.setTimeout(() => setEntering(false), ms(MOTION.map.nodeEnter.ms) + ms(MOTION.map.edgeDraw.ms) + 120);
    return () => window.clearTimeout(t);
  }, [plays]);

  // Places. The ones the person chose come from the screen, or are kept here when the screen gives none.
  const [own, setOwn] = useState<Positions>({});
  const pinned = props.positions ?? own;
  const pinnedRef = useRef(pinned); pinnedRef.current = pinned;
  // The layout depends on the window only through its rows, so a small resize does not move the nodes.
  const room = useMemo(() => ({ width: Math.max(1, box.width - FIT_ROOM.width), height: Math.max(1, box.height - FIT_ROOM.height) }), [box]);
  const roomRef = useRef(room); roomRef.current = room;
  const rows = maxRowsFor(room, model);
  const layout = useMemo(() => layoutHarness(model, roomRef.current, pinned), [model, rows, pinned]); // eslint-disable-line react-hooks/exhaustive-deps
  const sizes = useMemo(() => Object.fromEntries(model.nodes.map(n => [n.id, sizeOf(n)])) as Record<string, NodeSize>, [model]);
  const sizesRef = useRef(sizes); sizesRef.current = sizes;
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const commit = useCallback((next: Positions) => { latest.current.onPositionsChange?.(next); if (latest.current.positions === undefined) setOwn(next); }, []);

  const wireCounts = useMemo(() => { const m = new Map<string, number>(); for (const e of model.edges) { m.set(e.from, (m.get(e.from) ?? 0) + 1); m.set(e.to, (m.get(e.to) ?? 0) + 1); } return m; }, [model]);
  const many = model.nodes.length > MANY, busy = model.edges.length > BUSY_EDGES;
  // The node a person points at, or else the chosen one: its connections are drawn in full, and its neighbours are marked.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const focusId = hoverId ?? selectedId;
  const linkedIds = useMemo(() => (focusId === null ? new Set<string>() : neighboursOf(model, focusId)), [model, focusId]);
  const shown = useMemo(() => drawnWires(model, focusId), [model, focusId]);

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
      const old = before.get(n.id), place = layoutRef.current[n.id] ?? { x: 0, y: 0 }, sel = n.id === selectedId, wires = wireCounts.get(n.id) ?? 0, linked = linkedIds.has(n.id), size = sizeOf(n);
      const sm: 'drop' | 'connect' | null = settle?.ids.has(n.id) === true ? settle.kind : null;
      if (old !== undefined && sameNode(old.data.n, n) && old.position.x === place.x && old.position.y === place.y && old.selected === sel && old.data.settle === sm && old.data.wires === wires && old.data.linked === linked) return old;
      return {
        id: n.id, type: 'hc', position: place, selected: sel, data: { n: old !== undefined && sameNode(old.data.n, n) ? old.data.n : n, settle: sm, wires, linked },
        width: size.w, height: size.h, initialWidth: size.w, initialHeight: size.h, ariaLabel: `${describeNode(n)} ${wires} ${wires === 1 ? 'connection' : 'connections'}.`,
        ...(old?.measured === undefined ? {} : { measured: old.measured }),
      } satisfies HcNode;
    });
  }, [model, selectedId, settle, wireCounts, linkedIds]);
  const [nodes, setNodes] = useState<HcNode[]>(() => build([]));
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setNodes(prev => build(prev)); }, [build, layout]);

  // Moves from a drag go into the nodes as they happen. Selection is not React Flow's to change: the screen owns it.
  const onNodesChange = useCallback((changes: NodeChange<HcNode>[]) => {
    const kept = changes.filter(c => c.type !== 'select' && c.type !== 'remove');
    if (kept.length > 0) setNodes(prev => applyNodeChanges(kept, prev));
  }, []);

  // Connections: the ones next to the hovered or chosen node are drawn in full, one faint line per agent stays, the rest are not drawn.
  const wires = useMemo(createWireCache, []);
  const edges = useMemo(() => wires.edges(shown, layout), [wires, shown, layout]);
  const drawIn = entering && shown.length <= DRAW_IN_MAX;

  // Drag, drop and move.
  const before = useRef<Point | null>(null), [settling, setSettling] = useState(false), [settlingTimer] = useState(timerSlot);
  useEffect(() => () => settlingTimer.clear(), [settlingTimer]);
  const centre = (p: Point, id: string): Point => { const s = sizesRef.current[id] ?? { w: NODE_W, h: NODE_H }; return { x: p.x + s.w / 2, y: p.y + s.h / 2 }; };
  const onDragStart = useCallback((_e: unknown, node: HcNode) => { before.current = { ...node.position }; settlingTimer.clear(); setSettling(false); }, [settlingTimer]);
  const onDragStop = useCallback((_e: unknown, node: HcNode) => {
    const current: Positions = {}; for (const n of flow.getNodes()) current[n.id] = n.position;
    const target = nodeAt(current, centre(node.position, node.id), node.id, sizesRef.current);
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
  // A group that opens or closes changes how many nodes there are, so the picture fits again (a smooth move), and every node is still in view.
  const groupState = useMemo(() => model.nodes.filter(n => n.kind === 'group').map(n => `${n.id}:${n.expanded ? 1 : 0}`).join(), [model]);
  const seenGroups = useRef(groupState);
  useEffect(() => {
    if (seenGroups.current === groupState) return undefined;
    seenGroups.current = groupState;
    const id = window.requestAnimationFrame(() => window.requestAnimationFrame(() => fit()));
    return () => window.cancelAnimationFrame(id);
  }, [groupState, fit]);

  const m = MOTION.map;
  const vars = {
    '--hc-far-font': `${Math.min(FAR_FONT_MAX, NAME_SCREEN / zoom).toFixed(2)}px`, '--hc-far-small': `${Math.min(FAR_FONT_MAX, SMALL_SCREEN / zoom).toFixed(2)}px`, '--hc-w': `${NODE_W}px`, '--hc-h': `${NODE_H}px`, '--hc-switch-ms': `${dur(SWITCH_MS)}ms`,
    '--hc-hover-ms': `${dur(m.hover.ms)}ms`, '--hc-hover-ease': m.hover.ease, '--hc-select-ms': `${dur(m.select.ms)}ms`, '--hc-select-ease': m.select.ease,
    '--hc-enter-ms': `${dur(m.nodeEnter.ms)}ms`, '--hc-enter-ease': m.nodeEnter.ease, '--hc-enter-distance': `${m.nodeEnter.distance}px`, '--hc-enter-scale': String(m.nodeEnter.scaleFrom),
    '--hc-edge-ms': `${dur(m.edgeDraw.ms)}ms`, '--hc-edge-ease': m.edgeDraw.ease,
    '--hc-drop-ms': `${dur(m.drop.ms)}ms`, '--hc-drop-ease': m.drop.ease, '--hc-drop-scale': String(m.drop.scaleFrom), '--hc-connect-ms': `${dur(m.connect.ms)}ms`, '--hc-connect-ease': m.connect.ease,
  } as CSSProperties;
  const menuNode = menu === null ? undefined : byId.get(menu.id);

  return (
    <div ref={rootRef} className={`hc-root${reduceMotion ? ' is-reduced' : ''}${entering ? ' is-entering' : ''}${plays ? '' : ' is-fade'}${drawIn ? ' is-drawing' : ''}${many ? ' is-many' : ''}${busy ? ' is-busy' : ''}${far ? ' is-far' : ''}${settling ? ' is-settling' : ''}${linkFrom !== null ? ' is-linking' : ''}`} style={vars} onKeyDown={onKeyDown}>
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
          {many && box.width >= MINIMAP_MIN_WIDTH ? <MiniMap pannable zoomable position="top-right" style={MINIMAP} ariaLabel="Small map of the whole graph" nodeColor={n => `var(--hc-kind-${(n.data as NodeData).n.kind})`} maskColor="var(--minimap-mask)" /> : null}
          <Panel position="top-right">
            <div className="hc-toolbar" role="group" aria-label="View">
              <button type="button" className="hc-fit hc-zoom" aria-label="Zoom out" onClick={() => { void flow.zoomOut({ duration: dur(MOTION.map.fit.ms) }); }}>{'\u2212'}</button>
              <button type="button" className="hc-fit hc-zoom" aria-label="Zoom in" onClick={() => { void flow.zoomIn({ duration: dur(MOTION.map.fit.ms) }); }}>+</button>
              <button type="button" className="hc-fit" onClick={fit}>Fit to view</button>
            </div>
          </Panel>
          <Panel position="top-left">
            <details className="hc-legend">
              <summary>What the connections mean</summary>
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
  // True until the first canvas has used up the entrance: later canvases (a scope switch, another visit) only crossfade.
  const entrance = !entranceSpent;
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
      {box === null ? null : <ReactFlowProvider key={props.model.scopeId}><Flow props={props} box={box} entrance={entrance} /></ReactFlowProvider>}
    </div>
  );
}
