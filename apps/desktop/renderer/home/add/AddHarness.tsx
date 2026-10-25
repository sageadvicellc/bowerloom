/**
 * The Add test page, at the address #prototype-v2/add. It exists so that every way of adding, and the "two different copies" dialog, can be tried and
 * tested without the shell: a grid of agent cards that take a dragged card (each carries `data-drop-agent`), a button that opens the Add drawer, the
 * count of changes waiting, "Go back" (to the first save point), and a shelf of skills where one skill has the "2 different copies" badge. It keeps its own
 * small world (see add-demo-world.ts) in the ordinary store. Nothing is written anywhere.
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { agentHint, itemBadge, ownedAgents } from '../../../shared/home/cards.js';
import type { ShelfEntry } from '../../../shared/home/cards.js';
import { changeCount, plainName } from '../../../shared/home/add-model.js';
import { withStartPoint } from '../../../shared/home/savebar.js';
import { createStore } from '../../../shared/proto/store.js';
import { ProtoProvider, useProtoStore } from '../../proto/session.js';
import { Button } from '../kit/Button.js';
import { Drawer } from '../kit/Drawer.js';
import { KitIcon } from '../kit/icons.js';
import { ItemCard } from '../kit/ItemCard.js';
import { Shelf } from '../kit/Shelf.js';
import { AddDrawerBody } from './AddDrawerBody.js';
import { CopiesDialog } from '../copies/CopiesDialog.js';
import { goBackAction } from '../store-actions.js';
import { addDemoWorld } from './add-demo-world.js';
import { sharedFileSample } from './add-sample-file.js';
import { ADD_WORDS, changesCount, keptCopy } from './add-words.js';
import '../home-tokens.css';
import '../kit/kit.css';
import '../home.css';
import './add.css';

const L = ADD_WORDS.label, H = ADD_WORDS.hint;
const none = (): void => undefined;
const SAMPLE = sharedFileSample();
function Page(): ReactElement {
  const { state, dispatch } = useProtoStore();
  const [drawer, setDrawer] = useState(false);
  const [copiesFor, setCopiesFor] = useState<string | null>(null);
  const [kept, setKept] = useState('');
  const stage = useRef<HTMLElement>(null);
  const world = state.draft;
  const agents = useMemo(() => ownedAgents(world), [world]);
  const skills = useMemo(() => world.items.flatMap((i): ShelfEntry[] => {
    if (i.kind !== 'skill' || i.library !== null) return [];
    const badge = itemBadge(i);
    return [{ id: i.id, kind: 'skill', name: plainName(i.name), ...(badge === null ? {} : { badge }) }];
  }), [world]);
  const waiting = changeCount(state);
  const nameOfItem = (id: string): string => plainName(world.items.find(i => i.id === id)?.name ?? '');
  // When the badge is gone the card is still there: the focus goes back to it.
  const restore = (): HTMLElement | null => {
    const name = copiesFor === null ? '' : nameOfItem(copiesFor);
    return [...(stage.current?.querySelectorAll<HTMLElement>('.kit-shelf .kit-card-main') ?? [])].find(el => el.textContent === name) ?? null;
  };

  return (
    <div className="add-page" data-home="">
      <header className="add-bar">
        <div className="add-brand"><KitIcon name="leaf" size={28} /><span>{L.brand}</span></div>
        <span className="add-spacer" />
        <span className="add-count" role="status" aria-label={L.changes} data-count={waiting}>{changesCount(waiting)}</span>
        <Button icon="clock" disabled={waiting === 0} onClick={() => { const first = state.committed.versions[0]; if (first !== undefined) dispatch(goBackAction(first.id)); }}>{L.goBack}</Button>
        <Button variant="primary" icon="plus" aria-expanded={drawer} onClick={() => setDrawer(open => !open)}>{L.add}</Button>
      </header>
      <div className="add-stage-wrap">
        <main id="main" className="add-stage" ref={stage} data-drawer={drawer ? '' : undefined}>
          <div className="add-stage-head">
            <h1 className="kit-heading" tabIndex={-1}>{L.pageTitle}</h1>
            <p className="kit-hint">{H.pageTip}</p>
          </div>
          <section className="add-section-block" aria-labelledby="add-agents-title">
            <h2 className="kit-heading" id="add-agents-title">{L.yourAgents}</h2>
            <ul className="add-grid" aria-labelledby="add-agents-title">
              {agents.map(a => (
                <li key={a.id} data-drop-agent={a.id}>
                  <ItemCard kind="agent" name={plainName(a.name)} hint={agentHint(a)} selected={false} onSelect={none} />
                </li>
              ))}
            </ul>
          </section>
          <section className="add-section-block">
            <Shelf title={L.yourSkills} entries={skills} selectedId={null} onSelect={none} emptyText={H.nothingHere} level={2} onBadgePress={entry => setCopiesFor(entry.id)} />
            <p className="kit-hint">{H.skillsTip}</p>
          </section>
          <p className="add-kept" role="status">{kept}</p>
        </main>
        <Drawer open={drawer} title={L.addDrawer} dataSlot="add" onClose={() => setDrawer(false)}>
          <AddDrawerBody sampleFile={SAMPLE} onOpenCopies={setCopiesFor} />
        </Drawer>
      </div>
      {copiesFor === null ? null : (
        <CopiesDialog itemId={copiesFor} nameOf={plainName} restoreFocus={restore} onClose={() => setCopiesFor(null)} onKept={(copy, name) => setKept(keptCopy(copy.number, name))} />
      )}
    </div>
  );
}

export function AddHarness(): ReactElement {
  // The first save point is the world as it was found, so "Go back" always has somewhere to go.
  const [store] = useState(() => createStore(withStartPoint(addDemoWorld())));
  return <ProtoProvider store={store}><Page /></ProtoProvider>;
}
