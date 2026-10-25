/**
 * The home app shell: a top bar (the name with the leaf, "Save points", "Add", and the "?" Help button), a stage with the map, a side panel for the shelves
 * of the agent that is picked, a Save bar at the bottom, and two right-side drawers (Add, Save points) that open over the stage. There is no left rail and no routing.
 * The map is a plain grid of the person's own agents, one card each, in one order at a time (by name, or by how recently each changed). Picking an agent fills the
 * three shelves of the panel: Skills, Tools and Notes, each card with a quiet "Remove". Removing stages a change in the draft; the Save bar counts the changes and
 * makes a save point, and "Go back" undoes it. The `data-tour` ids stay on the same things: map, agent, shelves, add, save, help (and `bar` on the top bar).
 * Every agent card carries `data-drop-agent` with the agent's id, so a drag can find the card it lands on.
 */
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { InterfaceId } from '../../shared/proto/types.js';
import { agentCard, ownedAgents, shelvesOf } from '../../shared/home/cards.js';
import type { ShelfEntry } from '../../shared/home/cards.js';
import { agentForTour, sortAgents, touch } from '../../shared/home/order.js';
import type { SortMode } from '../../shared/home/order.js';
import { changeCount, saveBar } from '../../shared/home/savebar.js';
import type { BarPhase } from '../../shared/home/savebar.js';
import { useProtoStore } from '../proto/session.js';
import { Button } from './kit/Button.js';
import { Drawer } from './kit/Drawer.js';
import { HelpPopover } from './kit/HelpPopover.js';
import { KitIcon } from './kit/icons.js';
import { ItemCard } from './kit/ItemCard.js';
import { Shelf } from './kit/Shelf.js';
import { SortToggle } from './map/SortToggle.js';
import { SaveBar } from './save/SaveBar.js';
import { discardAction, goBackAction, removeAction, saveAction } from './store-actions.js';
import { TourAnnouncer, TourOverlay } from './tour/TourOverlay.js';
import { TOUR_STEPS } from './tour/steps.js';
import { createTour, currentStep, tourReduce, tourSession } from './tour/tour.js';
import { WORDS, agentsCount, changesCount } from './words.js';
import './home-tokens.css';
import './kit/kit.css';
import './home.css';

type DrawerId = 'add' | 'points';

/** The programs a save reaches, in the order the ticks show them, with the words for each. */
const SAVE_TARGETS: readonly { id: InterfaceId; name: string }[] = Object.freeze([
  { id: 'claude-code', name: WORDS.label.claudeCode },
  { id: 'codex', name: WORDS.label.codex },
  { id: 'opencode', name: WORDS.label.openCode },
]);

/** Where the focus goes after a change takes the thing that had it: the card that took its place on a shelf, else the panel heading. */
type FocusAfter = { readonly kind: ShelfEntry['kind']; readonly index: number } | 'heading';

export function HomeApp(): ReactElement {
  const { state, dispatch } = useProtoStore();
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [sort, setSort] = useState<SortMode>('name');
  const [touched, setTouched] = useState<readonly string[]>([]);
  const [phase, setPhase] = useState<BarPhase | null>(null);
  const [tour, tourDo] = useReducer(tourReduce, TOUR_STEPS, createTour);
  const panel = useRef<HTMLElement>(null);
  const focusAfter = useRef<FocusAfter | null>(null);

  const world = state.draft;
  const owned = useMemo(() => ownedAgents(world), [world]);
  const agents = useMemo(() => sortAgents(owned, sort, touched), [owned, sort, touched]);
  const agent = agents.find(a => a.id === picked) ?? null;
  const card = agent === null ? null : agentCard(agent);
  const shelves = useMemo(() => (agent === null ? null : shelvesOf(world, agent)), [world, agent]);
  const changes = changeCount(state.committed, state.draft);
  const bar = saveBar(changes, state.committed.versions.length, phase);
  const ticks = SAVE_TARGETS.filter(t => state.draft.interfaces.some(i => i.id === t.id && i.installed === 'installed')).map(t => t.name);
  const stepId = currentStep(tour)?.id ?? null;

  useEffect(() => { document.title = WORDS.label.appName; }, []);
  // The tour runs by itself once in a session. After that only the Help button runs it.
  useEffect(() => { if (tourSession.claimAutoStart()) tourDo('start'); }, []);
  // The tour dims the page, so the person cannot click an agent. When it reaches the shelves with nothing picked, it opens one that has something to show.
  useEffect(() => {
    if (stepId !== 'shelves' || picked !== null) return;
    const first = agentForTour(world, agents);
    if (first !== null) setPicked(first.id);
  }, [stepId, picked, world, agents]);
  // After a card is removed (or a change is put back) the focus would fall to the page: put it on the card that took its place, or on the panel heading.
  useLayoutEffect(() => {
    const after = focusAfter.current;
    if (after === null || panel.current === null) return;
    focusAfter.current = null;
    const heading = panel.current.querySelector<HTMLElement>('#hm-panel-title');
    if (after === 'heading') { heading?.focus(); return; }
    const cards = panel.current.querySelectorAll<HTMLElement>(`.kit-card[data-kind="${after.kind}"] .kit-card-main`);
    (cards[Math.min(after.index, cards.length - 1)] ?? heading)?.focus();
  });

  const toggle = (id: DrawerId): void => setDrawer(current => (current === id ? null : id));
  const pick = (id: string): void => { setPicked(current => (current === id ? null : id)); setPickedItem(null); };
  const remove = (entry: ShelfEntry): void => {
    if (agent === null) return;
    const list = shelves === null ? [] : entry.kind === 'skill' ? shelves.skills : entry.kind === 'tool' ? shelves.tools : shelves.notes;
    focusAfter.current = { kind: entry.kind, index: list.findIndex(e => e.id === entry.id) };
    dispatch(removeAction(agent.id, entry.kind, entry.id));
    setTouched(current => touch(current, agent.id));
    setPickedItem(null);
  };
  const save = (): void => {
    const savePoints = state.committed.versions.length;
    dispatch(saveAction(changesCount(changes)));
    setPhase({ kind: 'saved', at: savePoints + 1, backTo: state.headVersionId });
  };
  const discard = (): void => { focusAfter.current = 'heading'; dispatch(discardAction()); };
  const goBack = (): void => {
    if (phase === null || phase.backTo === null) return;
    focusAfter.current = 'heading';
    dispatch(goBackAction(phase.backTo));
    setPhase({ kind: 'back', at: state.committed.versions.length + 1, backTo: null });
  };

  return (
    <div className="hm-root" data-home="">
      <header className="hm-bar" data-tour="bar">
        <div className="hm-brand"><KitIcon name="leaf" size={28} /><span>{WORDS.label.appName}</span></div>
        <span className="hm-spacer" />
        <Button icon="clock" aria-expanded={drawer === 'points'} onClick={() => toggle('points')}>{WORDS.label.savePoints}</Button>
        <Button variant="primary" icon="plus" data-tour="add" aria-expanded={drawer === 'add'} onClick={() => toggle('add')}>{WORDS.label.add}</Button>
        <HelpPopover label={WORDS.label.help} text={WORDS.popover.help} align="end" dataTour="help" action={{ label: WORDS.label.showTour, onAction: () => tourDo('replay') }} />
      </header>

      <div className="hm-body">
        <main id="main" className="hm-stage">
          <div className="hm-stage-head">
            <div className="hm-stage-title">
              <h1 className="kit-heading" tabIndex={-1}>{WORDS.label.yourAgents}</h1>
              <p className="kit-hint">{agentsCount(agents.length)}. {WORDS.hint.stage}</p>
            </div>
            <SortToggle mode={sort} onChange={setSort} />
          </div>
          <ul className="hm-grid" data-tour="map" aria-label={WORDS.label.yourAgents}>
            {agents.map((a, i) => {
              const words = agentCard(a);
              return (
                <li key={a.id}>
                  <ItemCard kind="agent" name={words.name} hint={words.hint} selected={a.id === picked} onSelect={() => pick(a.id)} dropAgent={a.id} {...(i === 0 ? { dataTour: 'agent' } : {})} />
                </li>
              );
            })}
          </ul>
        </main>

        <aside className="hm-panel" ref={panel} data-tour="shelves" aria-labelledby="hm-panel-title">
          <div className="hm-panel-head">
            <h2 className="kit-heading" id="hm-panel-title" tabIndex={-1}>{card === null ? WORDS.label.pickAnAgent : card.name}</h2>
            <p className="kit-hint">{card === null ? WORDS.hint.panel : card.hint}</p>
          </div>
          <Shelf title={WORDS.label.skills} entries={shelves?.skills ?? []} selectedId={pickedItem} onSelect={setPickedItem} onRemove={remove} emptyText={WORDS.hint.emptyShelf} />
          <Shelf title={WORDS.label.tools} entries={shelves?.tools ?? []} selectedId={pickedItem} onSelect={setPickedItem} onRemove={remove} emptyText={WORDS.hint.emptyShelf} help={{ label: WORDS.label.aboutTools, text: WORDS.popover.connection }} />
          <Shelf title={WORDS.label.notes} entries={shelves?.notes ?? []} selectedId={pickedItem} onSelect={setPickedItem} onRemove={remove} emptyText={WORDS.hint.emptyShelf} />
        </aside>

        <Drawer open={drawer === 'add'} title={WORDS.label.addDrawer} onClose={() => setDrawer(null)} dataSlot="add">
          <p className="kit-hint">{WORDS.hint.addEmpty}</p>
        </Drawer>
        <Drawer open={drawer === 'points'} title={WORDS.label.savePoints} onClose={() => setDrawer(null)} dataSlot="points">
          <p className="kit-hint">{WORDS.hint.savePointsEmpty}</p>
        </Drawer>
      </div>

      <SaveBar model={bar} ticks={ticks} onSave={save} onGoBack={goBack} onDiscard={discard} />

      <TourAnnouncer state={tour} />
      {tour.status === 'running' ? <TourOverlay state={tour} onNext={() => tourDo('next')} onBack={() => tourDo('back')} onSkip={() => tourDo('skip')} /> : null}
    </div>
  );
}
