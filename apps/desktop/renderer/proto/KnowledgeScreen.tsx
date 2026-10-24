/**
 * The Knowledge screen (spec 6.9; journey 5): the wiki as a graph, and the preview of one slice.
 * There are two ways to pick a slice, so a person can compare them: "Pick on the graph" (a lasso; the app writes the rule) and "Build a rule"
 * (a form with a live count). Both change one working rule. The preview always shows that rule: lit and dim pages, the page count, a rough
 * token estimate, and the links that leave the slice as dashed lines. Save, freeze and give-to-an-agent go to the in-memory store.
 * With no provider (the shell test) the screen shows the same title and count line as the stub did.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { initialKnowledge, reduceKnowledge } from '../../shared/proto/knowledge-state.js';
import type { KnowledgeAction, KnowledgeState } from '../../shared/proto/knowledge-state.js';
import { buildPreview, memoMatch } from '../../shared/proto/slice-preview.js';
import { domainsOf } from './knowledge-graph-view.js';
import type { GraphView } from './knowledge-graph-view.js';
import { sameSeeds, sliceDirty } from './knowledge-dirty.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { ActionsPanel, GraphWay, PageList, PreviewPanel, RuleBuilder } from './knowledge-panels.js';
import { useOptionalSession } from './setup-session.js';
import type { ProtoSession } from './session.js';
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';
import type { AgentItem, Slice } from '../../shared/proto/types.js';
import './knowledge-screen.css';

// The screen's state is kept while the person visits another screen. It is keyed by the session's own dispatch function,
// which is the same function for as long as the session lasts, so a restart starts again on the first slice.
const kept = new WeakMap<object, KnowledgeState>();

export function KnowledgeScreen({ world }: ScreenProps): ReactElement {
  const session = useOptionalSession();
  if (session === null) {
    return (
      <div className="page">
        <h1 tabIndex={-1}>{ROUTE_LABELS.knowledge}</h1>
        <p className="muted">{countLine('knowledge', world)}</p>
      </div>
    );
  }
  return <KnowledgeFlow session={session} />;
}

/** The flow with its session. `initial` lets a test draw the screen in any state. */
export function KnowledgeFlow({ session, initial }: { session: ProtoSession; initial?: KnowledgeState }): ReactElement {
  const { state, dispatch } = session;
  const world = state.draft, pages = world.wikiPages, slices = world.slices;
  const [ks, send] = useReducer((s: KnowledgeState, a: KnowledgeAction) => reduceKnowledge(s, a, { pages }), undefined, () => initial ?? kept.get(session.dispatch) ?? initialKnowledge(slices));
  useEffect(() => { kept.set(session.dispatch, ks); }, [ks, session.dispatch]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [agentChoice, setAgentChoice] = useState('');
  const view = useRef<GraphView | null>(null);
  const saveRef = useRef<HTMLButtonElement | null>(null);

  const saved: Slice | null = ks.chosenId === null ? null : slices.find(s => s.id === ks.chosenId) ?? null;
  const frozen = saved !== null && saved.pinned && saved.pinnedPageIds !== undefined;
  const dirty = sliceDirty(ks, saved);
  const seedsChanged = saved !== null && !sameSeeds(ks.seeds, saved.seeds);

  // A slice that is gone (an undo on another screen) leaves the screen on a new, empty slice. A saved slice that changed elsewhere, while
  // there was nothing unsaved here, is loaded again.
  const lastSaved = useRef<Slice | null>(saved);
  useEffect(() => {
    const before = lastSaved.current;
    lastSaved.current = saved;
    if (ks.chosenId !== null && saved === null) send({ type: 'reset', slice: null });
    else if (saved !== null && before !== null && before !== saved && before.id === saved.id && !sliceDirty(ks, before)) send({ type: 'reset', slice: saved });
  }, [saved]);  // eslint-disable-line react-hooks/exhaustive-deps

  // After a save that made a new slice, the screen moves to it.
  const known = useRef<ReadonlySet<string>>(new Set(slices.map(s => s.id)));
  const creating = useRef(false);
  useEffect(() => {
    if (creating.current) {
      const made = slices.find(s => !known.current.has(s.id));
      if (made !== undefined) { creating.current = false; send({ type: 'choose', slice: made }); }
    }
    known.current = new Set(slices.map(s => s.id));
  }, [slices]);

  const live = useMemo(() => memoMatch(pages, ks.rule, ks.seeds), [pages, ks.rule, ks.seeds]);
  const frozenSet = useMemo(() => (frozen ? new Set(saved.pinnedPageIds) : null), [frozen, saved]);
  const lit = frozenSet ?? live;
  const preview = useMemo(() => buildPreview(pages, lit), [pages, lit]);
  const marked = useMemo(() => new Set([...ks.picks, ...ks.seeds]), [ks.picks, ks.seeds]);
  const agents = useMemo(() => world.items.filter((i): i is AgentItem => i.kind === 'agent' && i.library === null), [world.items]);
  const libraryAgents = world.items.filter(i => i.kind === 'agent' && i.library !== null).length;
  const domains = useMemo(() => domainsOf(pages), [pages]);

  const save = (): void => {
    if (saved !== null && !seedsChanged) { dispatch({ type: 'updateSliceRule', sliceId: saved.id, rule: ks.rule }); return; }
    creating.current = true;
    dispatch({ type: 'createSlice', name: ks.name, rule: ks.rule, seeds: ks.seeds });
  };

  return (
    <div className="page wide kn-page">
      <div className="kn-head">
        <h1 tabIndex={-1}>{ROUTE_LABELS.knowledge}</h1>
        <section className="kn-slice" aria-labelledby="kn-slice-h">
          <h2 id="kn-slice-h" className="sr">Slice</h2>
          <label className="kn-field">
            <span>Choose a slice</span>
            <select value={ks.chosenId ?? ''} onChange={e => { const s = slices.find(x => x.id === e.target.value); if (s !== undefined) send({ type: 'choose', slice: s }); }}>
              {ks.chosenId === null ? <option value="">A new slice (not saved yet)</option> : null}
              {slices.map(s => <option key={s.id} value={s.id}>{s.name}{s.pinned ? ' (frozen)' : ''}</option>)}
            </select>
          </label>
          <button type="button" className="btn secondary" onClick={() => send({ type: 'newSlice' })}>Make a new slice</button>
        </section>
      </div>
      <p className="kn-lead muted">{countLine('knowledge', world)} in your wiki. A slice is a saved choice of pages. Pick one to see what an agent would get.</p>

      <div className="kn-columns">
        <div className="kn-main">
          <section className="kn-graph-section" aria-labelledby="kn-graph-h">
            <h2 id="kn-graph-h">Graph of your wiki</h2>
            <div className="kn-toolbar" role="group" aria-label="Graph tools">
              <button type="button" className="btn secondary" aria-pressed={ks.lasso} disabled={frozen} onClick={() => send({ type: 'lasso', on: !ks.lasso })}>
                Lasso: {ks.lasso ? 'on' : 'off'}
              </button>
              <button type="button" className="btn secondary" onClick={() => view.current?.fit()}>Fit all pages</button>
              <span className="small muted kn-hint">
                {frozen ? 'This slice is frozen. Unfreeze it to pick pages.' : ks.lasso ? 'Drag a loop around pages. Shift adds. Alt removes. Escape stops.' : 'Turn the lasso on to pick pages by drawing a loop.'}
              </span>
            </div>
            <KnowledgeGraph pages={pages} lit={lit} marked={marked} preview={preview} lasso={ks.lasso && !frozen} viewRef={view}
              onLasso={(ids, mode) => send({ type: 'lassoResult', ids, mode })} onPageClick={id => send({ type: 'focusPage', id })} />
            <ul className="kn-legend small" aria-label="Key to the graph">
              {domains.map((d, i) => <li key={d}><span className={`kn-sw kn-sw-${i % 8}`} aria-hidden="true" />{d}</li>)}
              <li><span className="kn-key kn-key-lit" aria-hidden="true" />Lit: in the slice</li>
              <li><span className="kn-key kn-key-dim" aria-hidden="true" />Dim: not in the slice</li>
              <li><span className="kn-key kn-key-cut" aria-hidden="true" />Dashed line: a link that leaves the slice</li>
              <li><span className="kn-key kn-key-pick" aria-hidden="true" />Ring: a picked page</li>
            </ul>
          </section>

          <section className="kn-pick" aria-labelledby="kn-pick-h">
            <h2 id="kn-pick-h">Pick the pages</h2>
            <div className="kn-ways" role="radiogroup" aria-label="Way to pick">
              <label className={ks.way === 'graph' ? 'kn-way-choice kn-way-on' : 'kn-way-choice'}>
                <input type="radio" name="kn-way" checked={ks.way === 'graph'} onChange={() => send({ type: 'way', way: 'graph' })} />
                <span>Pick on the graph</span>
              </label>
              <label className={ks.way === 'rule' ? 'kn-way-choice kn-way-on' : 'kn-way-choice'}>
                <input type="radio" name="kn-way" checked={ks.way === 'rule'} onChange={() => send({ type: 'way', way: 'rule' })} />
                <span>Build a rule</span>
              </label>
            </div>
            <fieldset className="kn-lock" disabled={frozen}>
              <legend className="sr">{ks.way === 'graph' ? 'Pick on the graph' : 'Build a rule'}</legend>
              {frozen ? <p className="kn-frozen">This slice is frozen, so its rule cannot change. Unfreeze it to change the rule.</p> : null}
              {ks.way === 'graph' ? <GraphWay state={ks} pages={pages} send={send} /> : <RuleBuilder state={ks} pages={pages} send={send} open={open} onOpen={f => setOpen(o => { const n = new Set(o); if (n.has(f)) n.delete(f); else n.add(f); return n; })} />}
            </fieldset>
          </section>

          <PageList state={ks} pages={pages} lit={lit} send={send} />
        </div>

        <div className="kn-side">
          <PreviewPanel state={ks} pages={pages} preview={preview} interfaces={world.interfaces} saved={saved} liveCount={live.size} />
          <ActionsPanel state={ks} saved={saved} dirty={dirty} seedsChanged={seedsChanged} agents={agents} slices={slices} livePages={live.size} send={send}
            onSave={save} onPin={() => { if (saved !== null) dispatch({ type: 'pinSlice', sliceId: saved.id }); }} onUnpin={() => { if (saved !== null) dispatch({ type: 'unpinSlice', sliceId: saved.id }); }}
            onGive={id => { if (saved !== null && id !== '') dispatch({ type: 'assignSlice', agentId: id, sliceId: saved.id }); }} onTake={id => dispatch({ type: 'assignSlice', agentId: id, sliceId: null })}
            agentChoice={agentChoice} onAgentChoice={setAgentChoice} saveRef={saveRef} />
          {libraryAgents > 0 ? <p className="small muted">{libraryAgents} library agents come from a library and cannot be changed here.</p> : null}
        </div>
      </div>
    </div>
  );
}
