/**
 * The sketch board: drag teams, helpers, skills and prompts from the shelf onto a blank canvas, thread them together, name the sketch,
 * and keep it. A sketch is only a drawing in the viewer's own folder. It cannot be applied to a project yet.
 */
import { Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, addEdge, applyEdgeChanges, applyNodeChanges, useReactFlow } from '@xyflow/react';
import type { Connection, Edge, EdgeChange, Node, NodeChange, NodeProps } from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { KIND_WORDS_MAP, REL_WORDS } from '../../shared/mapmodel.js';
import type { MapKind } from '../../shared/mapmodel.js';
import { LAYOUT, snap } from '../../shared/maplayout.js';
import type { Sketch, SketchSummary, Snapshot, ViewerApi } from '../../shared/types.js';
import { MOTION } from '../motion-tokens.js';
import { titleOf } from '../../shared/words.js';
import { canThread, nextSketchId, threadWord } from '../../shared/sketchrules.js';
import type { SketchKind } from '../../shared/sketchrules.js';
import { Confirm } from './Confirm.js';
import type { Ask } from './Confirm.js';
import { KindIcon } from './icons.js';
import { Legend } from './Legend.js';

interface SketchData extends Record<string, unknown> { kind: SketchKind; label: string; /** Set while a thread is being made from the keyboard. */ mark: 'from' | 'target' | 'candidate' | null }
type SketchNode = Node<SketchData, 'sk'>;

const SketchCard = memo(function SketchCard({ data, selected }: NodeProps<SketchNode>): ReactElement {
  return (
    <div className={`bw-node kind-${data.kind} is-dropped${selected ? ' is-selected' : ''}${data.mark === null ? '' : ` is-link-${data.mark}`}`}>
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

const edgeClass = (from: SketchKind, fresh = false): string => `bw-edge rel-${threadWord(from)}${fresh ? ' is-new' : ''}`;
const idOf = (e: Element | null): string | null => e?.closest('.react-flow__node')?.getAttribute('data-id') ?? null;

export function SketchBoard({ snapshot, api }: { snapshot: Snapshot; api: ViewerApi }): ReactElement {
  const flow = useReactFlow();
  const shelf = useMemo(() => shelfOf(snapshot), [snapshot]);
  const [nodes, setNodes] = useState<SketchNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [name, setName] = useState('My harness');
  const [saved, setSaved] = useState<SketchSummary[]>([]);
  const [note, setNote] = useState('');
  // True when the board holds something that is not saved yet.
  const [dirty, setDirty] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  // A thread being made from the keyboard: where it starts, and where it could end.
  const [linking, setLinking] = useState<{ from: string; targets: string[]; at: number } | null>(null);
  const refresh = useCallback(async () => { const r = await api.listSketches(); if (r.ok && r.value !== null) setSaved(r.value); }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);

  const add = (item: ShelfItem, at: { x: number; y: number } | null): void => {
    setNodes(prev => [...prev, { id: nextSketchId(prev.map(n => n.id)), type: 'sk', position: at ?? snap({ x: 40 * (prev.length % 8), y: 40 * (prev.length % 8) }), data: { kind: item.kind, label: item.label, mark: null } }]);
    setDirty(true); setNote(`${item.label} was added.`);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-bowerloom-shelf'); if (raw === '') return;
    let item: ShelfItem; try { item = JSON.parse(raw) as ShelfItem; } catch { return; }
    const known = shelf.find(s => s.id === item.id); if (known === undefined) return;
    add(known, snap(flow.screenToFlowPosition({ x: e.clientX - LAYOUT.nodeWidth / 2, y: e.clientY - LAYOUT.nodeHeight / 2 })));
  };
  const threaded = useCallback((from: string, to: string): boolean => edges.some(e => e.source === from && e.target === to), [edges]);
  const isValid = useCallback((c: Connection | Edge): boolean => { const a = nodes.find(n => n.id === c.source), b = nodes.find(n => n.id === c.target); return a !== undefined && b !== undefined && a.id !== b.id && canThread(a.data.kind, b.data.kind) && !threaded(a.id, b.id); }, [nodes, threaded]);
  const connect = useCallback((from: string, to: string): void => {
    const a = nodes.find(n => n.id === from), b = nodes.find(n => n.id === to);
    if (a === undefined || b === undefined) return;
    setEdges(prev => addEdge({ source: from, target: to, sourceHandle: null, targetHandle: null, className: edgeClass(a.data.kind, true) }, prev));
    setDirty(true); setNote(`${a.data.label} ${REL_WORDS[threadWord(a.data.kind)]} ${b.data.label}.`);
  }, [nodes]);
  const onConnect = useCallback((c: Connection) => { if (isValid(c)) connect(c.source, c.target); else setNote('That thread is not allowed. A team owns a helper, and a helper uses a skill or a prompt.'); }, [isValid, connect]);

  // The marks that show a keyboard thread: where it starts, the one chosen, and the others it could reach.
  const shown = useMemo(() => nodes.map(n => { const mark: SketchData['mark'] = linking === null ? null : n.id === linking.from ? 'from' : n.id === linking.targets[linking.at] ? 'target' : linking.targets.includes(n.id) ? 'candidate' : null; return n.data.mark === mark ? n : { ...n, data: { ...n.data, mark } }; }), [nodes, linking]);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.target instanceof HTMLInputElement) return;
    if (linking !== null) {
      const to = (n: number): void => { e.preventDefault(); const at = (linking.at + n + linking.targets.length) % linking.targets.length; setLinking({ ...linking, at }); const t = nodes.find(x => x.id === linking.targets[at]); setNote(`${t?.data.label ?? ''}. Press Enter to connect, Escape to cancel.`); };
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) to(1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) to(-1);
      else if (e.key === 'Enter') { e.preventDefault(); const target = linking.targets[linking.at]; if (target !== undefined) connect(linking.from, target); setLinking(null); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLinking(null); setNote('The thread was cancelled.'); }
      return;
    }
    if (e.key.toLowerCase() !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return;
    const id = idOf(e.target as Element), from = nodes.find(n => n.id === id);
    if (from === undefined) return;
    e.preventDefault();
    const targets = nodes.filter(n => n.id !== from.id && canThread(from.data.kind, n.data.kind) && !threaded(from.id, n.id)).map(n => n.id);
    if (targets.length === 0) { setNote(`${from.data.label} has nothing it can be threaded to yet.`); return; }
    setLinking({ from: from.id, targets, at: 0 });
    setNote(`Making a thread from ${from.data.label}. Use the arrow keys to choose where it goes: ${nodes.find(n => n.id === targets[0])?.data.label}. Press Enter to connect, Escape to cancel.`);
  };

  const sketch = (): Sketch => ({ version: 1, name: name.trim(), nodes: nodes.map(n => ({ id: n.id, kind: n.data.kind, label: n.data.label, x: Math.round(n.position.x), y: Math.round(n.position.y) })), edges: edges.map(e => ({ from: e.source, to: e.target })) });
  const save = async (): Promise<void> => { const r = await api.saveSketch(sketch()); if (r.ok) setDirty(false); setNote(r.ok ? `Saved "${name.trim()}".` : r.message ?? 'It could not be saved.'); await refresh(); };
  const open = async (n: string): Promise<void> => {
    const r = await api.loadSketch(n); if (!r.ok || r.value === null) { setNote(r.message ?? 'It could not be opened.'); return; }
    const kindOf = new Map(r.value.nodes.map(x => [x.id, x.kind] as const));
    setName(r.value.name); setLinking(null); setDirty(false);
    setNodes(r.value.nodes.map(x => ({ id: x.id, type: 'sk', position: { x: x.x, y: x.y }, data: { kind: x.kind, label: x.label, mark: null } })));
    setEdges(r.value.edges.map((e, i) => ({ id: `e${i}`, source: e.from, target: e.to, className: edgeClass(kindOf.get(e.from) ?? 'agent') })));
    setNote(`Opened "${r.value.name}".`); window.setTimeout(() => { void flow.fitView({ padding: 0.2 }); }, MOTION.map.settleGrace);
  };
  const remove = async (n: string): Promise<void> => { const r = await api.deleteSketch(n); setNote(r.ok ? `Deleted "${n}".` : r.message ?? 'It could not be deleted.'); await refresh(); };
  const clear = (): void => { setNodes([]); setEdges([]); setLinking(null); setDirty(false); setNote('The board is empty.'); };
  // Things that cannot be taken back ask first. A board with nothing unsaved needs no question.
  const guard = (text: string, yes: string, run: () => void): void => { if (dirty) setAsk({ text, yes, no: 'No, keep it', onYes: run }); else run(); };

  return (
    <div className="bw-sketch">
      <aside className="bw-shelf" aria-label="The shelf: things to put on the board">
        <h2>The shelf</h2>
        <p className="muted small">Drag something onto the board, or press Enter on it. Then pull from the dot on its right edge to the dot on the left edge of another. From the keyboard, choose a thing on the board, press C, use the arrow keys to pick where the thread goes, and press Enter.</p>
        {(['team', 'agent', 'skill', 'prompt'] as SketchKind[]).map(kind => (
          <div key={kind} className="bw-shelf-group">
            <h3>{KIND_WORDS_MAP[kind as MapKind]}s</h3>
            <ul>{shelf.filter(s => s.kind === kind).map(s => (
              <li key={s.id}><button type="button" className={`bw-shelf-item kind-${kind}`} draggable onDragStart={e => { e.dataTransfer.setData('application/x-bowerloom-shelf', JSON.stringify(s)); e.dataTransfer.effectAllowed = 'copy'; }}
                onKeyDown={e => { if (e.key === 'Enter') add(s, null); }}
                aria-label={`${s.label}. Drag onto the board, or press Enter to add it.`}><KindIcon kind={kind as MapKind} size={14} />{s.label}</button></li>))}</ul>
            {shelf.filter(s => s.kind === kind).length === 0 ? <p className="muted small">None yet.</p> : null}
          </div>))}
      </aside>
      <div className="bw-board">
        <div className="bw-toolbar" role="toolbar" aria-label="Sketch controls">
          <label className="bw-namefield">Name <input value={name} onChange={e => setName(e.target.value)} maxLength={48} aria-label="Name of the sketch" /></label>
          <button type="button" className="bw-btn primary" onClick={() => { void save(); }}>Save</button>
          <select aria-label="Open a saved sketch" value="" onChange={e => { const n = e.target.value; if (n !== '') guard(`Opening "${n}" replaces what is on the board, and the board has changes that are not saved.`, 'Yes, open it', () => { void open(n); }); }}><option value="">Open a saved sketch{saved.length === 0 ? ' (none yet)' : ''}</option>{saved.map(s => <option key={s.name} value={s.name}>{s.name} ({s.nodes} things)</option>)}</select>
          {saved.some(s => s.name === name.trim()) ? <button type="button" className="bw-btn" onClick={() => setAsk({ text: `Delete the saved sketch "${name.trim()}"? This cannot be undone.`, yes: 'Yes, delete it', no: 'No, keep it', onYes: () => { void remove(name.trim()); } })}>Delete this sketch</button> : null}
          <button type="button" className="bw-btn" onClick={() => guard('Clearing the board removes things that are not saved.', 'Yes, clear it', clear)}>Clear the board</button>
          <button type="button" className="bw-btn" disabled aria-describedby="bw-apply-note">Apply to a project</button>
          <span id="bw-apply-note" className="small muted">Coming when the app can safely write; for now this is a drawing.</span>
        </div>
        {ask !== null ? <Confirm ask={ask} onClose={() => setAsk(null)} /> : null}
        <div className="bw-canvas" role="group" onKeyDown={onKey} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop} aria-label="The sketch board. Choose a thing and press C to start a thread.">
          <ReactFlow<SketchNode, Edge>
            nodes={shown} edges={edges} nodeTypes={nodeTypes} fitView={false} minZoom={0.2} maxZoom={2} snapToGrid snapGrid={[LAYOUT.gridSnap, LAYOUT.gridSnap]}
            onNodesChange={(c: NodeChange<SketchNode>[]) => { if (c.some(x => x.type === 'position' || x.type === 'remove')) setDirty(true); setNodes(p => applyNodeChanges(c, p)); }} onEdgesChange={(c: EdgeChange[]) => { if (c.some(x => x.type === 'remove')) setDirty(true); setEdges(p => applyEdgeChanges(c, p)); }}
            onConnect={onConnect} isValidConnection={isValid} deleteKeyCode={['Backspace', 'Delete']} selectionOnDrag panOnDrag={[1, 2]} panOnScroll multiSelectionKeyCode={['Meta', 'Shift']} nodesFocusable edgesFocusable
          >
            <Background variant={BackgroundVariant.Dots} gap={LAYOUT.gridSnap * 1.5} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable ariaLabel="Overview of the sketch" nodeColor={n => `var(--kind-${(n.data as SketchData).kind})`} maskColor="var(--minimap-mask)" />
          </ReactFlow>
          {nodes.length === 0 ? <p className="bw-empty" role="status">An empty board. Drag a team from the shelf to begin.</p> : null}
          <div className="bw-overlay"><Legend rels={['owns', 'uses']} /></div>
        </div>
        <p className="bw-status" role="status" aria-live="polite">{note === '' ? `${nodes.length} things, ${edges.length} threads` : note}</p>
      </div>
    </div>
  );
}
