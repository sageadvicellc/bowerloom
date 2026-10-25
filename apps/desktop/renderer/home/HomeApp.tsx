/**
 * The home app shell: a top bar (the name with the leaf, "Save points", "Add", and the "?" Help button), a stage with the map, a side panel for the shelves
 * of the agent that is picked, a Save bar at the bottom, and two right-side drawers (Add, Save points) that open over the stage. There is no left rail and no routing.
 * A small "Preview" badge with its own "?" sits beside the name, always: this prototype writes nothing to the computer, and the popover says so.
 * The map is a plain grid of the person's own agents, one card each, in one order at a time (by name, or by how recently each changed). Picking an agent fills the
 * three shelves of the panel: Skills, Tools and Notes, each card with a quiet "Remove". Removing stages a change in the draft; the Save bar counts the changes and
 * makes a save point, and "Go back" undoes it. The `data-tour` ids stay on the same things: map, agent, shelves, add, save, help (and `bar` on the top bar).
 * Every agent card carries `data-drop-agent` with the agent's id, so a drag can find the card it lands on.
 * The Add drawer holds the Add body (plain names and hints from the plain layer; a card goes to an agent by the picker or by a drag onto an agent card). After
 * an add the agent is picked, so its shelf shows the new card, both the agent card and the new card wear the same ring for a few seconds (a line across
 * the map would cross other cards), and the Save bar says what changed. The
 * "2 different copies" badge on a shelf card or a drawer card opens the copies dialog, which sits at the top of the page. The Save points drawer lists the
 * save points with "Go back to this", and under them has the Share section: "Share my agents" opens the Share sheet (a small modal sheet that makes a copy
 * of the saved agents in memory; the prototype writes nothing), and "Open a shared file" opens the Add drawer on its "From a shared file" tab, where the copy
 * can be opened again. The Notes shelf has a "Choose notes" button that opens the full-window Choose notes sheet for the agent that is picked; "Use these
 * notes" stages one change, picks the agent and rings the new card like an add does. With the Add or Save points drawer open the page keeps clear of it: the
 * shelves stay beside the map in a wide window and give way to the drawer in a narrow one. Escape closes the top layer only: the tour, then the copies
 * dialog or the Share sheet, then the Choose notes sheet, then a drawer (the sheet closes a drawer when it opens, and the tour closes both when it starts).
 * The Add picker and the drop targets leave out the agents that Find skipped, like the map.
 * The first minute (HomeFlow) sets four things from outside: the agents of places the person skipped in Find stay off the map (`skipped`), the tour starts by
 * itself once when `autoTour` is set, "Find more" reopens Find (`onFindMore`), and `closingNote` allows one short note after the first Save, once per session.
 * The tour's second step waits for a real click on an agent: that click is the step's action.
 */
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { InterfaceId } from '../../shared/proto/types.js';
import { agentCard, ownedAgents, shelvesOf } from '../../shared/home/cards.js';
import { DEFAULT_TAB } from '../../shared/home/add-model.js';
import type { AddTab } from '../../shared/home/add-model.js';
import type { ShelfEntry } from '../../shared/home/cards.js';
import { agentForTour, sortAgents, touch } from '../../shared/home/order.js';
import type { SortMode } from '../../shared/home/order.js';
import { barSentence, listChanges } from '../../shared/home/changes.js';
import { plainHintOf, plainNameOf } from '../../shared/home/plain-names.js';
import { savePointRows } from '../../shared/home/points.js';
import { changeCount, saveBar } from '../../shared/home/savebar.js';
import type { BarPhase } from '../../shared/home/savebar.js';
import { reduceStore } from '../../shared/proto/store.js';
import { useProtoStore } from '../proto/session.js';
import { AddDrawerBody } from './add/AddDrawerBody.js';
import { dropTargetFor } from './add/dom-helpers.js';
import { CopiesDialog } from './copies/CopiesDialog.js';
import { ChooseNotes } from './notes/ChooseNotes.js';
import { NotesShelf } from './notes/NotesShelf.js';
import { SavePoints } from './points/SavePoints.js';
import { ShareSheet } from './share/ShareSheet.js';
import { Badge } from './kit/Badge.js';
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
import { closingNoteSession, createTour, currentStep, tourReduce, tourSession } from './tour/tour.js';
import { FIND_WORDS } from './first-run/find-words.js';
import { WORDS, agentsCount, changesCount } from './words.js';
import './home-tokens.css';
import './kit/kit.css';
import './home.css';

type DrawerId = 'add' | 'points';

/** What was just added, so the page can show where it went: an agent and the card on its shelf (or the agent card itself, for a ready-made agent). */
interface Fresh { readonly agentId: string; readonly entryId: string | null; /** True when the new card is the agent's set of notes, whose id is not known until the choice is saved. */ readonly notes?: boolean }
/** How long the "just added" mark stays, in milliseconds. */
const FRESH_MS = 5000;

/** How long the body stays marked as moving after a drawer opens or closes: longer than the slowest of the drawer's two clocks. */
const MOVING_MS = 320;

/** How long the closing note stays, in milliseconds. */
const NOTE_MS = 9000;

export interface HomeAppProps {
  /** The ids of agents to keep off the map (their place was unticked in Find). */
  skipped?: readonly string[];
  /** Start the tour by itself, once in a session. */
  autoTour?: boolean;
  /** Allow the closing note after the first Save. */
  closingNote?: boolean;
  /** Reopen Find. Without it the map has no "Find more" button. */
  onFindMore?(): void;
  /**
   * What the Save bar last did ("Saved", "Back to how it was"), kept outside the map so it survives a visit to Find. Without it the map keeps its own.
   */
  barPhase?: { readonly phase: BarPhase | null; set(phase: BarPhase | null): void };
}

const NONE: readonly string[] = Object.freeze([]);

/** The programs a save reaches, in the order the ticks show them, with the words for each. */
const SAVE_TARGETS: readonly { id: InterfaceId; name: string }[] = Object.freeze([
  { id: 'claude-code', name: WORDS.label.claudeCode },
  { id: 'codex', name: WORDS.label.codex },
  { id: 'opencode', name: WORDS.label.openCode },
]);

/** Where the focus goes after a change takes the thing that had it: the card that took its place on a shelf, else the panel heading. */
type FocusAfter = { readonly kind: ShelfEntry['kind']; readonly index: number } | 'heading';

/** The id of the card to mark on the shelves: the one just added, and only while its agent is the one that is picked. */
const freshOf = (fresh: Fresh | null, picked: string | null): string | null => (fresh !== null && fresh.entryId !== null && fresh.agentId === picked ? fresh.entryId : null);

export function HomeApp({ skipped = NONE, autoTour = false, closingNote = false, onFindMore, barPhase }: HomeAppProps = {}): ReactElement {
  const { state, dispatch } = useProtoStore();
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [sort, setSort] = useState<SortMode>('name');
  const [touched, setTouched] = useState<readonly string[]>([]);
  const [ownPhase, setOwnPhase] = useState<BarPhase | null>(null);
  const phase = barPhase === undefined ? ownPhase : barPhase.phase, setPhase = barPhase === undefined ? setOwnPhase : barPhase.set;
  const [copiesFor, setCopiesFor] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [note, setNote] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [addTab, setAddTab] = useState<AddTab>(DEFAULT_TAB);
  const [lastCopy, setLastCopy] = useState<string | undefined>(undefined);
  const [tour, tourDo] = useReducer(tourReduce, TOUR_STEPS, createTour);
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<FocusAfter | null>(null);
  const copiesFrom = useRef('.hm-panel');
  const chooseFrom = useRef<HTMLElement | null>(null);

  const world = state.draft;
  const owned = useMemo(() => ownedAgents(world).filter(a => !skipped.includes(a.id)), [world, skipped]);
  const agents = useMemo(() => sortAgents(owned, sort, touched), [owned, sort, touched]);
  const agent = agents.find(a => a.id === picked) ?? null;
  const card = agent === null ? null : agentCard(agent);
  const shelves = useMemo(() => (agent === null ? null : shelvesOf(world, agent)), [world, agent]);
  const changes = changeCount(state.committed, state.draft);
  const said = useMemo(() => barSentence(listChanges(state.committed, state.draft), changes), [state.committed, state.draft, changes]);
  const bar = saveBar(changes, state.committed.versions.length, phase, said);
  const nameOf = useMemo(() => plainNameOf(world), [world]);
  const pointRows = useMemo(() => (drawer === 'points' ? savePointRows(state.committed, nameOf) : []), [drawer, state.committed, nameOf]);
  const ticks = SAVE_TARGETS.filter(t => state.draft.interfaces.some(i => i.id === t.id && i.installed === 'installed')).map(t => t.name);
  const stepId = currentStep(tour)?.id ?? null;
  const freshNotes = fresh !== null && fresh.notes === true && fresh.agentId === picked ? (shelves?.notes[0]?.id ?? null) : null;

  useEffect(() => { document.title = WORDS.label.appName; }, []);
  // A new change ends what the bar said about the last save or the last Go back: without this, discarding that change would bring the old "Saved" back.
  useEffect(() => { if (changes > 0 && phase !== null) setPhase(null); }, [changes, phase, setPhase]);
  // The tour runs by itself once in a session, when the first minute asks for it. After that only the Help button runs it.
  useEffect(() => { if (autoTour && tourSession.claimAutoStart()) tourDo('start'); }, [autoTour]);
  // The closing note goes by itself.
  useEffect(() => {
    if (!note) return undefined;
    const timer = window.setTimeout(() => setNote(false), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);
  // The tour dims the page, so the person cannot click an agent. When it reaches the shelves with nothing picked, it opens one that has something to show.
  useEffect(() => {
    if (stepId !== 'shelves' || picked !== null) return;
    const first = agentForTour(world, agents);
    if (first !== null) setPicked(first.id);
  }, [stepId, picked, world, agents]);
  // The page makes room for a drawer on the drawer's own clock. The body is marked as moving in the same pass that opens or closes the drawer (before the browser
  // works out the new look), and the mark goes a moment after, so a change of the window size alone never runs the transition.
  const drawerSeen = useRef<DrawerId | null>(null);
  useLayoutEffect(() => {
    const el = body.current;
    // The first pass is the page being built, not a drawer moving: nothing is marked then.
    const changed = drawerSeen.current !== drawer;
    drawerSeen.current = drawer;
    if (el === null || !changed) return undefined;
    el.setAttribute('data-moving', '');
    const timer = window.setTimeout(() => el.removeAttribute('data-moving'), MOVING_MS);
    return () => window.clearTimeout(timer);
  }, [drawer]);
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

  // The tour dims the page and points at the bar, so a drawer, the Choose notes sheet or the Share sheet that is open would only get in its way: they close when the tour starts.
  useEffect(() => { if (tour.status === 'running') { setDrawer(null); setChoosing(false); setSharing(false); } }, [tour.status]);
  // When the Choose notes sheet closes, the focus goes back to the button that opened it. A drawer that closed to make room would otherwise take it to its own button.
  useEffect(() => {
    if (choosing || chooseFrom.current === null) return;
    const back = chooseFrom.current;
    chooseFrom.current = null;
    if (back.isConnected) back.focus();
  }, [choosing]);
  // The mark for a card that was just added goes by itself, and the card is brought into view.
  useEffect(() => {
    if (fresh === null) return undefined;
    dropTargetFor(fresh.agentId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (fresh.entryId !== null) panel.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(fresh.entryId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    else if (fresh.notes === true) panel.current?.querySelector<HTMLElement>('[data-notes-shelf] [data-entry]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const timer = window.setTimeout(() => setFresh(null), FRESH_MS);
    return () => window.clearTimeout(timer);
    // The drawer is a dependency so that, in a window where it hides the shelves, closing it brings the new card into view.
  }, [fresh, drawer]);

  const toggle = (id: DrawerId): void => { if (id === 'add') setAddTab(DEFAULT_TAB); setDrawer(current => (current === id ? null : id)); };
  /** Opens the Choose notes sheet for the agent that is picked. A drawer that is open closes first, so Escape closes one layer at a time. */
  const choose = (): void => {
    chooseFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDrawer(null);
    setChoosing(true);
  };
  /** "Use these notes" staged a change: pick that agent, move it up the recent order, and ring the new card on its Notes shelf, as an add does. */
  const chosen = (agentId: string): void => {
    setPicked(agentId);
    setPickedItem(null);
    setTouched(current => touch(current, agentId));
    setFresh({ agentId, entryId: null, notes: true });
  };
  /** "Open a shared file" in the Save points drawer: the Add drawer opens on its shared-file tab. */
  const openFile = (): void => { setSharing(false); setAddTab('file'); setDrawer('add'); };
  const pick = (id: string): void => { setPicked(current => (current === id ? null : id)); setPickedItem(null); setFresh(null); tourDo('acted'); };
  /** A card went to an agent (or a ready-made agent was copied in): pick that agent, so its shelf shows the new card. */
  const added = ({ agentId, entry }: { readonly agentId: string; readonly entry: { readonly id: string; readonly kind: string } }): void => {
    setPicked(agentId);
    setPickedItem(null);
    setTouched(current => touch(current, agentId));
    setFresh({ agentId, entryId: entry.kind === 'agent' ? null : entry.id });
  };
  /** "Show" on the note after an add: the drawer closes, and the new card is brought into view and rung again (also where the drawer had hidden the shelves). */
  const showAdded = (info: { readonly agentId: string; readonly entry: { readonly id: string; readonly kind: string } }): void => { added(info); setDrawer(null); };
  /** When the badge is gone (a copy was kept) the card is still there: the focus goes to its name. */
  const restoreCopiesFocus = (): HTMLElement | null => {
    const item = copiesFor === null ? undefined : world.items.find(i => i.id === copiesFor);
    const name = item === undefined ? '' : nameOf(item.name);
    const cards = [...document.querySelectorAll<HTMLElement>(`${copiesFrom.current} .kit-card-main`)];
    return cards.find(el => el.textContent === name) ?? null;
  };
  /** Opens the dialog for one item, and remembers whether the badge was in a drawer or on the shelves, so the focus goes back to the same place. */
  const openCopies = (id: string): void => {
    copiesFrom.current = document.activeElement?.closest('.kit-drawer') != null ? '.kit-drawer' : '.hm-panel';
    setCopiesFor(id);
  };
  const remove = (entry: ShelfEntry): void => {
    if (agent === null) return;
    const list = shelves === null ? [] : entry.kind === 'skill' ? shelves.skills : entry.kind === 'tool' ? shelves.tools : shelves.notes;
    focusAfter.current = { kind: entry.kind, index: list.findIndex(e => e.id === entry.id) };
    dispatch(removeAction(agent.id, entry.kind, entry.id));
    setTouched(current => touch(current, agent.id));
    setPickedItem(null);
    setFresh(null);
  };
  const save = (): void => {
    const savePoints = state.committed.versions.length;
    dispatch(saveAction(said ?? changesCount(changes)));
    setPhase({ kind: 'saved', at: savePoints + 1, backTo: state.headVersionId });
    setFresh(null);
    // The first Save of a guided session says where Help lives, once.
    if (closingNote && closingNoteSession.claimAutoStart()) setNote(true);
  };
  const discard = (): void => { focusAfter.current = 'heading'; setFresh(null); setPhase(null); dispatch(discardAction()); };
  /** Makes the world as it was at one save point. The bar says so, and the focus stays where the person pressed. */
  const goBackTo = (versionId: string, focus: boolean): void => {
    const action = goBackAction(versionId);
    // A save point that cannot be restored leaves everything as it is, and the bar must not say it went back.
    if (reduceStore(state, action) === state) return;
    if (focus) focusAfter.current = 'heading';
    setFresh(null);
    dispatch(action);
    setPhase({ kind: 'back', at: state.committed.versions.length + 1, backTo: null });
  };
  const goBack = (): void => { if (phase !== null && phase.backTo !== null) goBackTo(phase.backTo, true); };

  return (
    <div className="hm-root" data-home="">
      <header className="hm-bar" data-tour="bar">
        <div className="hm-brand"><KitIcon name="leaf" size={28} /><span>{WORDS.label.appName}</span></div>
        <div className="hm-preview" data-preview="">
          <Badge badge={{ label: WORDS.label.preview, tone: 'info' }} />
          <HelpPopover label={WORDS.label.aboutPreview} text={WORDS.popover.preview} size="small" />
        </div>
        <span className="hm-spacer" />
        <Button icon="clock" aria-expanded={drawer === 'points'} onClick={() => toggle('points')}>{WORDS.label.savePoints}</Button>
        <Button variant="primary" icon="plus" data-tour="add" aria-expanded={drawer === 'add'} onClick={() => toggle('add')}>{WORDS.label.add}</Button>
        <HelpPopover label={WORDS.label.help} text={WORDS.popover.help} align="end" dataTour="help" action={{ label: WORDS.label.showTour, onAction: () => tourDo('replay') }} />
      </header>

      <div className="hm-body" ref={body} data-drawer={drawer ?? undefined}>
        <main id="main" className="hm-stage">
          <div className="hm-stage-head">
            <div className="hm-stage-title">
              <h1 className="kit-heading" tabIndex={-1}>{WORDS.label.yourAgents}</h1>
              <p className="kit-hint">{agentsCount(agents.length)}. {WORDS.hint.stage}</p>
            </div>
            <div className="hm-stage-tools">
              <SortToggle mode={sort} onChange={setSort} />
              {onFindMore === undefined ? null : <Button onClick={onFindMore}>{FIND_WORDS.label.findMore}</Button>}
            </div>
          </div>
          <ul className="hm-grid" data-tour="map" aria-label={WORDS.label.yourAgents}>
            {agents.map((a, i) => {
              const words = agentCard(a);
              return (
                <li key={a.id}>
                  <ItemCard kind="agent" name={words.name} hint={words.hint} selected={a.id === picked} onSelect={() => pick(a.id)} dropAgent={a.id} fresh={fresh !== null && fresh.agentId === a.id} {...(i === 0 ? { dataTour: 'agent' } : {})} />
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
          <Shelf title={WORDS.label.skills} entries={shelves?.skills ?? []} selectedId={pickedItem} onSelect={setPickedItem} onRemove={remove} onBadgePress={entry => openCopies(entry.id)} freshId={freshOf(fresh, picked)} emptyText={WORDS.hint.emptyShelf} />
          <Shelf title={WORDS.label.tools} entries={shelves?.tools ?? []} selectedId={pickedItem} onSelect={setPickedItem} onRemove={remove} onBadgePress={entry => openCopies(entry.id)} freshId={freshOf(fresh, picked)} emptyText={WORDS.hint.emptyShelf} help={{ label: WORDS.label.aboutTools, text: WORDS.popover.connection }} />
          <NotesShelf entries={shelves?.notes ?? []} selectedId={pickedItem} onSelect={setPickedItem} onRemove={remove} freshId={freshNotes} canChoose={agent !== null} onChoose={choose} />
        </aside>

        <Drawer open={drawer === 'add'} title={WORDS.label.addDrawer} onClose={() => setDrawer(null)} dataSlot="add">
          <AddDrawerBody nameOf={nameOf} hintOf={plainHintOf} onOpenCopies={openCopies} line={false} onAdded={added} onShow={showAdded} initialTab={addTab} hideAgents={skipped} {...(lastCopy === undefined ? {} : { lastCopy })} />
        </Drawer>
        <Drawer open={drawer === 'points'} title={WORDS.label.savePoints} onClose={() => setDrawer(null)} dataSlot="points">
          <SavePoints rows={pointRows} unsaved={changes > 0} onGoBack={id => goBackTo(id, false)} onShare={() => setSharing(true)} onOpenFile={openFile} />
        </Drawer>
        <ChooseNotes open={choosing} agentId={picked} onClose={() => setChoosing(false)} onChosen={chosen} />
      </div>

      {closingNote ? <div className="hm-toast" role="status" data-open={note ? '' : undefined}>{note ? <><KitIcon name="check" size={20} /><span>{FIND_WORDS.hint.closingNote}</span></> : null}</div> : null}
      <SaveBar model={bar} ticks={ticks} onSave={save} onGoBack={goBack} onDiscard={discard} />

      {sharing ? <ShareSheet world={state.committed} hidden={skipped} unsaved={changes > 0} onClose={() => setSharing(false)} onCopy={setLastCopy} onOpenFile={openFile} /> : null}
      {copiesFor === null ? null : <CopiesDialog itemId={copiesFor} nameOf={nameOf} restoreFocus={restoreCopiesFocus} onClose={() => setCopiesFor(null)} />}

      <TourAnnouncer state={tour} />
      {tour.status === 'running' ? <TourOverlay state={tour} onNext={() => tourDo('next')} onBack={() => tourDo('back')} onSkip={() => tourDo('skip')} /> : null}
    </div>
  );
}
