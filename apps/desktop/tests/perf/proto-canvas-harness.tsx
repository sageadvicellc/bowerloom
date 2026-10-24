// A page that shows the harness canvas on its own, for looking at and for speed: the real HarnessCanvas with the sample world (or a made-up model of any size).
// Addresses: ?scope=scope-copperfen  ?inherited=0  ?expand=group:evergreen-kit  ?n=500 (made-up nodes)  ?theme=dark  ?reduce=1  ?positions=1 (the page keeps the places)
// The page keeps what the canvas reports in window.__calls, so a test can check it.
import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { HarnessCanvas } from '../../renderer/proto/HarnessCanvas.js';
import { buildHarnessMap } from '../../shared/proto/harnessmodel.js';
import { syntheticHarness } from '../../shared/proto/harnesslayout.js';
import type { Positions } from '../../shared/proto/harnesslayout.js';
import { generateWorld } from '../../shared/proto/sample.js';
import type { Override } from '../../shared/proto/types.js';

const q = new URLSearchParams(location.search);
const synthetic = Number(q.get('n') ?? '0');
const world = generateWorld(1);
document.documentElement.setAttribute('data-theme', q.get('theme') === 'dark' ? 'dark' : 'light');
const calls: unknown[][] = [];
(window as unknown as { __calls: unknown[][] }).__calls = calls;

function Page(): ReactElement {
  const [scopeId, setScopeId] = useState(q.get('scope') ?? 'global');
  const [showInherited, setShowInherited] = useState(q.get('inherited') !== '0');
  const [expanded, setExpanded] = useState<string[]>((q.get('expand') ?? '').split(',').filter(Boolean));
  const [extra, setExtra] = useState<Override[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [positions, setPositions] = useState<Positions>({});
  const [reduce, setReduce] = useState(q.get('reduce') === '1');
  const [last, setLast] = useState('');
  const note = (...args: unknown[]): void => { calls.push(args); setLast(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  const model = useMemo(() => {
    if (synthetic > 0) return syntheticHarness(synthetic);
    const overrides = [...world.overrides.filter(o => !removed.includes(o.itemId)), ...extra];
    return buildHarnessMap({ ...world, overrides }, { scopeId, showInherited, expandedGroups: expanded });
  }, [scopeId, showInherited, expanded, extra, removed]);
  const controlled = q.get('positions') === '1';
  (window as unknown as { __counts: { nodes: number; edges: number } }).__counts = { nodes: model.nodes.length, edges: model.edges.length };
  return (
    <>
      <div className="harness-bar">
        <label>Scope <select value={scopeId} onChange={e => setScopeId(e.target.value)}>{world.scopes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label><input type="checkbox" checked={showInherited} onChange={e => setShowInherited(e.target.checked)} /> Show inherited</label>
        <label><input type="checkbox" checked={reduce} onChange={e => setReduce(e.target.checked)} /> Reduce motion</label>
        <span id="log" role="status">{last}</span>
      </div>
      <div className="harness-stage">
        <HarnessCanvas
          model={model} selectedId={selected} reduceMotion={reduce}
          onSelect={id => { note('select', id); setSelected(id); }}
          onConnect={(a, b) => note('connect', a, b)}
          onDropOnNode={(a, b) => note('drop', a, b)}
          onNodeMenu={(id, action) => {
            note('menu', id, action);
            if (action === 'expand') setExpanded(e => [...e, id]);
            if (action === 'collapse') setExpanded(e => e.filter(x => x !== id));
            if (action === 'hide') setExtra(x => [...x, { scopeId, itemId: id, mode: 'hide' }]);
            if (action === 'unhide') { setExtra(x => x.filter(o => o.itemId !== id)); setRemoved(r => [...r, id]); }
          }}
          {...(controlled ? { positions } : {})}
          onPositionsChange={p => { note('positions', Object.keys(p).length); setPositions(p); }}
        />
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
(window as unknown as { __ready: boolean }).__ready = true;
