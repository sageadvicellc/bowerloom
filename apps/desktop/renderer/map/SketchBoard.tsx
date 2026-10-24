/**
 * The sketch board: drag teams, helpers, skills and prompts from the shelf onto a blank canvas, thread them together, name the sketch,
 * and keep it. A sketch is only a drawing in the viewer's own folder. It cannot be applied to a project yet.
 */
import { Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, addEdge, applyEdgeChanges, applyNodeChanges, useReactFlow } from '@xyflow/react';
import type { Connection, Edge, EdgeChange, Node, NodeChange, NodeProps } from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactElement } from 'react';
import { KIND_WORDS_MAP } from '../../shared/mapmodel.js';
import type { MapKind } from '../../shared/mapmodel.js';
import { LAYOUT, snap } from '../../shared/maplayout.js';
import type { Sketch, SketchSummary, Snapshot, ViewerApi } from '../../shared/types.js';
import { titleOf } from '../../shared/words.js';
import { KindIcon } from './icons.js';

type SketchKind = Sketch['nodes'][number]['kind'];
interface SketchData extends Record<string, unknown> { kind: SketchKind; label: string }
type SketchNode = Node<SketchData, 'sk'>;

/** Which thread is allowed: a team owns helpers, and a helper uses skills and prompts. The same rule the map uses for what holds what. */
export const THREADS: Record<SketchKind, readonly SketchKind[]> = { team: ['agent'], agent: ['skill', 'prompt'], skill: [], prompt: [] };
export const canThread = (from: SketchKind, to: SketchKind): boolean => THREADS[from].includes(to);

const SketchCard = memo(function SketchCard({ data, selected }: NodeProps<SketchNode>): ReactElement {
  return (
    <div className={`bw-node kind-${data.kind} is-dropped${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="bw-handle live" aria-label="Thread in" />
      <span className="bw-node-icon"><KindIcon kind={data.kind as MapKind} /></span>
      <span className="bw-node-text"><span className="bw-node-kind">{KIND_WORDS_MAP[data.kind as MapKind]}</span><span className="bw-node-label">{data.label}</span></span>
      <Handle type="source" position={Position.Right} className="bw-handle live" aria-label="Thread out" />
    </div>
  );
});
const nodeTypes = { sk: SketchCard };

interface ShelfItem { id: string; kind: SketchKind; label: string }
/** What can be put on the board: the shared library, and the helpers of the projects. Names only. */
export function shelfOf(s: Snapshot): ShelfItem[] {
  const out = new Map<string, ShelfItem>(), add = (kind: SketchKind, id: string, label = titleOf(id)): void => { out.set(`${kind}:${id}`, { id: `${kind}:${id}`, kind, label }); };
  for (const t of s.library.teams) add('team', t.id); for (const k of s.library.skills) add('skill', k.id); for (const p of s.library.prompts) add('prompt', p.id);
  for (const p of s.projects) { for (const a of p.agents) add('agent', a.role, a.role); for (const i of p.items) if (i.kind !== 'team' || i.from === 'project') { if (i.note === 'reserved') continue; add(i.kind, i.id); } }
  return [...out.values()].sort((a, b) => (a.kind === b.kind ? (a.label < b.label ? -1 : 1) : a.kind < b.kind ? -1 : 1));
}

export function SketchBoard({ snapshot, api }: { snapshot: Snapshot; api: ViewerApi }): ReactElement {
  const flow = useReactFlow();
  const shelf = useMemo(() => shelfOf(snapshot), [snapshot]);
  const [nodes, setNodes] = useState<SketchNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [name, setName] = useState('My harness');
  const [saved, setSaved] = useState<SketchSummary[]>([]);
  const [note, setNote] = useState('');
  const counter = useRef(1);
  const refresh = useCallback(async () => { const r = await api.listSketches(); if (r.ok && r.value !== null) setSaved(r.value); }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-bowerloom-shelf'); if (raw === '') return;
    let item: ShelfItem; try { item = JSON.parse(raw) as ShelfItem; } catch { return; }
    if (!shelf.some(s => s.id === item.id)) return;
    const at = snap(flow.screenToFlowPosition({ x: e.clientX - LAYOUT.nodeWidth / 2, y: e.clientY - LAYOUT.nodeHeight / 2 }));
    setNodes(prev => [...prev, { id: `sk-${counter.current++}`, type: 'sk', position: at, data: { kind: item.kind, label: item.label } }]);
    setNote(`${item.label} was added.`);
  };
  const isValid = useCallback((c: Connection | Edge): boolean => { const a = nodes.find(n => n.id === c.source), b = nodes.find(n => n.id === c.target); return a !== undefined && b !== undefined && a.id !== b.id && canThread(a.data.kind, b.data.kind); }, [nodes]);
  const onConnect = useCallback((c: Connection) => { if (isValid(c)) setEdges(prev => addEdge({ ...c, className: 'bw-edge rel-uses is-new' }, prev)); else setNote('That thread is not allowed. A team threads to a helper, and a helper to a skill or a prompt.'); }, [isValid]);

  const sketch = (): Sketch => ({ version: 1, name: name.trim(), nodes: nodes.map(n => ({ id: n.id, kind: n.data.kind, label: n.data.label, x: Math.round(n.position.x), y: Math.round(n.position.y) })), edges: edges.map(e => ({ from: e.source, to: e.target })) });
  const save = async (): Promise<void> => { const r = await api.saveSketch(sketch()); setNote(r.ok ? `Saved "${name.trim()}".` : r.message ?? 'It could not be saved.'); await refresh(); };
  const load = async (n: string): Promise<void> => {
    const r = await api.loadSketch(n); if (!r.ok || r.value === null) { setNote(r.message ?? 'It could not be opened.'); return; }
    setName(r.value.name); counter.current = r.value.nodes.length + 1;
    setNodes(r.value.nodes.map(x => ({ id: x.id, type: 'sk', position: { x: x.x, y: x.y }, data: { kind: x.kind, label: x.label } })));
    setEdges(r.value.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, className: 'bw-edge rel-uses' })));
    setNote(`Opened "${r.value.name}".`); window.setTimeout(() => { void flow.fitView({ padding: 0.2 }); }, 30);
  };
  const remove = async (n: string): Promise<void> => { const r = await api.deleteSketch(n); setNote(r.ok ? `Deleted "${n}".` : r.message ?? 'It could not be deleted.'); await refresh(); };
  const clear = (): void => { setNodes([]); setEdges([]); setNote('The board is empty.'); };

  return (
    <div className="bw-sketch">
      <aside className="bw-shelf" aria-label="The shelf: things to put on the board">
        <h2>The shelf</h2>
        <p className="muted small">Drag something onto the board. Then pull from the dot on its right edge to the dot on the left edge of another.</p>
        {(['team', 'agent', 'skill', 'prompt'] as SketchKind[]).map(kind => (
          <div key={kind} className="bw-shelf-group">
            <h3>{KIND_WORDS_MAP[kind as MapKind]}s</h3>
            <ul>{shelf.filter(s => s.kind === kind).map(s => (
              <li key={s.id}><button type="button" className={`bw-shelf-item kind-${kind}`} draggable onDragStart={e => { e.dataTransfer.setData('application/x-bowerloom-shelf', JSON.stringify(s)); e.dataTransfer.effectAllowed = 'copy'; }}
                onKeyDown={e => { if (e.key === 'Enter') { setNodes(prev => [...prev, { id: `sk-${counter.current++}`, type: 'sk', position: snap({ x: 40 * (prev.length % 8), y: 40 * (prev.length % 8) }), data: { kind: s.kind, label: s.label } }]); setNote(`${s.label} was added.`); } }}
                aria-label={`${s.label}. Drag onto the board, or press Enter to add it.`}><KindIcon kind={kind as MapKind} size={14} />{s.label}</button></li>))}</ul>
            {shelf.filter(s => s.kind === kind).length === 0 ? <p className="muted small">None yet.</p> : null}
          </div>))}
      </aside>
      <div className="bw-board">
        <div className="bw-toolbar" role="toolbar" aria-label="Sketch controls">
          <label className="bw-namefield">Name <input value={name} onChange={e => setName(e.target.value)} maxLength={48} aria-label="Name of the sketch" /></label>
          <button type="button" className="bw-btn primary" onClick={() => { void save(); }}>Save</button>
          <select aria-label="Open a saved sketch" value="" onChange={e => { if (e.target.value !== '') void load(e.target.value); }}><option value="">Open a saved sketch{saved.length === 0 ? ' (none yet)' : ''}</option>{saved.map(s => <option key={s.name} value={s.name}>{s.name} ({s.nodes} things)</option>)}</select>
          {saved.some(s => s.name === name.trim()) ? <button type="button" className="bw-btn" onClick={() => { void remove(name.trim()); }}>Delete this sketch</button> : null}
          <button type="button" className="bw-btn" onClick={clear}>Clear the board</button>
          <button type="button" className="bw-btn" disabled aria-describedby="bw-apply-note">Apply to a project</button>
          <span id="bw-apply-note" className="small muted">Coming when the app can safely write; for now this is a drawing.</span>
        </div>
        <div className="bw-canvas" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop} aria-label="The sketch board">
          <ReactFlow<SketchNode, Edge>
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView={false} minZoom={0.2} maxZoom={2} snapToGrid snapGrid={[LAYOUT.gridSnap, LAYOUT.gridSnap]}
            onNodesChange={(c: NodeChange<SketchNode>[]) => setNodes(p => applyNodeChanges(c, p))} onEdgesChange={(c: EdgeChange[]) => setEdges(p => applyEdgeChanges(c, p))}
            onConnect={onConnect} isValidConnection={isValid} deleteKeyCode={['Backspace', 'Delete']} selectionOnDrag panOnDrag={[1, 2]} panOnScroll multiSelectionKeyCode={['Meta', 'Shift']} nodesFocusable edgesFocusable
          >
            <Background variant={BackgroundVariant.Dots} gap={LAYOUT.gridSnap * 1.5} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable ariaLabel="Overview of the sketch" nodeColor={n => `var(--kind-${(n.data as SketchData).kind})`} maskColor="var(--minimap-mask)" />
          </ReactFlow>
          {nodes.length === 0 ? <p className="bw-empty" role="status">An empty board. Drag a team from the shelf to begin.</p> : null}
        </div>
        <p className="bw-status" role="status" aria-live="polite">{note === '' ? `${nodes.length} things, ${edges.length} threads` : note}</p>
      </div>
    </div>
  );
}
