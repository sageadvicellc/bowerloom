/**
 * The "Choose notes" test page, at the address #prototype-v2/notes. It exists so that every flow of the layer can be tried and tested without the shell: the
 * agents of the sample world, the Notes shelf of the agent that is picked with its "Choose notes" button, the layer itself, and the real Save bar (it counts
 * the changes, saves, goes back and discards). It keeps its own store around the 700-page sample world. Nothing is written anywhere.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { agentCard, ownedAgents, shelvesOf } from '../../../shared/home/cards.js';
import { barSentence, listChanges } from '../../../shared/home/changes.js';
import { changeCount, saveBar, withStartPoint } from '../../../shared/home/savebar.js';
import type { BarPhase } from '../../../shared/home/savebar.js';
import { withSampleCopies } from '../../../shared/home/sample-copies.js';
import { createStore, reduceStore } from '../../../shared/proto/store.js';
import { ProtoProvider, useProtoStore } from '../../proto/session.js';
import { loadWorld } from '../../proto/world.js';
import { KitIcon } from '../kit/icons.js';
import { ItemCard } from '../kit/ItemCard.js';
import { SaveBar } from '../save/SaveBar.js';
import { discardAction, goBackAction, removeAction, saveAction } from '../store-actions.js';
import { WORDS, changesCount } from '../words.js';
import { ChooseNotes } from './ChooseNotes.js';
import { NotesShelf } from './NotesShelf.js';
import { NOTES_WORDS } from './notes-words.js';
import '../home-tokens.css';
import '../kit/kit.css';
import '../home.css';
import './notes.css';

const L = NOTES_WORDS.label, H = NOTES_WORDS.hint;
/** How long the "just chosen" mark stays, in milliseconds. */
const FRESH_MS = 5000;

function Page(): ReactElement {
  const { state, dispatch } = useProtoStore();
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [phase, setPhase] = useState<BarPhase | null>(null);
  const world = state.draft;
  const agents = useMemo(() => ownedAgents(world), [world]);
  const agent = agents.find(a => a.id === picked) ?? null;
  const shelf = useMemo(() => (agent === null ? [] : shelvesOf(world, agent).notes), [world, agent]);
  const changes = changeCount(state.committed, state.draft);
  const said = useMemo(() => barSentence(listChanges(state.committed, state.draft), changes), [state.committed, state.draft, changes]);
  const bar = saveBar(changes, state.committed.versions.length, phase, said);

  useEffect(() => { document.title = WORDS.label.appName; }, []);
  // A new change ends what the bar said about the last save or Go back.
  useEffect(() => { if (changes > 0 && phase !== null) setPhase(null); }, [changes, phase]);
  useEffect(() => {
    if (!fresh) return undefined;
    const timer = window.setTimeout(() => setFresh(false), FRESH_MS);
    return () => window.clearTimeout(timer);
  }, [fresh]);

  const pick = (id: string): void => { setPicked(current => (current === id ? null : id)); setPickedItem(null); setFresh(false); };
  const save = (): void => {
    const points = state.committed.versions.length;
    dispatch(saveAction(said ?? changesCount(changes)));
    setPhase({ kind: 'saved', at: points + 1, backTo: state.headVersionId });
    setFresh(false);
  };
  const goBack = (): void => {
    if (phase === null || phase.backTo === null) return;
    const action = goBackAction(phase.backTo);
    if (reduceStore(state, action) === state) return;
    dispatch(action);
    setPhase({ kind: 'back', at: state.committed.versions.length + 1, backTo: null });
  };
  const remove = (entry: { readonly kind: 'skill' | 'tool' | 'note'; readonly id: string }): void => { if (agent !== null) { dispatch(removeAction(agent.id, entry.kind, entry.id)); setPickedItem(null); } };

  return (
    <div className="hm-root nt-page" data-home="">
      <header className="hm-bar">
        <div className="hm-brand"><KitIcon name="leaf" size={28} /><span>{WORDS.label.appName}</span></div>
      </header>
      <div className="hm-body">
        <main id="main" className="hm-stage">
          <div className="hm-stage-head">
            <div className="hm-stage-title">
              <h1 className="kit-heading" tabIndex={-1}>{L.pageTitle}</h1>
              <p className="kit-hint">{H.pageTip}</p>
            </div>
          </div>
          <ul className="hm-grid" aria-label={L.yourAgents}>
            {agents.map(a => {
              const words = agentCard(a);
              return <li key={a.id}><ItemCard kind="agent" name={words.name} hint={words.hint} selected={a.id === picked} onSelect={() => pick(a.id)} /></li>;
            })}
          </ul>
        </main>
        <aside className="hm-panel" aria-labelledby="nt-panel-title">
          <div className="hm-panel-head">
            <h2 className="kit-heading" id="nt-panel-title" tabIndex={-1}>{agent === null ? WORDS.label.pickAnAgent : agentCard(agent).name}</h2>
            <p className="kit-hint">{agent === null ? H.noAgent : agentCard(agent).hint}</p>
          </div>
          <NotesShelf entries={shelf} selectedId={pickedItem} onSelect={setPickedItem} onRemove={remove} freshId={fresh ? (shelf[0]?.id ?? null) : null} canChoose={agent !== null} onChoose={() => setOpen(true)} />
        </aside>
        <ChooseNotes open={open} agentId={picked} onClose={() => setOpen(false)} onChosen={() => setFresh(true)} />
      </div>
      <SaveBar model={bar} ticks={[]} onSave={save} onGoBack={goBack} onDiscard={() => { setPhase(null); dispatch(discardAction()); }} />
    </div>
  );
}

export function NotesHarness(): ReactElement {
  // The first save point is the world as it was found, so "Go back" always has somewhere to go.
  const [store] = useState(() => createStore(withStartPoint(withSampleCopies(loadWorld()))));
  return <ProtoProvider store={store}><Page /></ProtoProvider>;
}
