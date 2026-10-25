/**
 * The home app shell: a top bar (the name with the leaf, the clock button "Version history" with its tooltip, "Add", and the "?" Help button), a stage with the map, a
 * details panel on the right, a Save bar at the bottom, and two right-side drawers (Add, Version history) that open over the stage. There is no left rail and no routing.
 * A small "Preview" badge with its own "?" sits beside the name, always: this prototype writes nothing to the computer, and the popover says so.
 * The map is a plain grid of the person's own agents, one card each, in one order at a time (by name, or by how recently each changed). An agent card says what the agent
 * can do at a glance: its job and a count chip for each kind it holds ("3 skills", "1 tool", "1 notes set"); a chip opens a mini accordion in the card that lists the names.
 * One thing is selected at a time (`selected`: an agent, or a skill, tool or set of notes with the agent it was opened from). A selection is only a highlight, never a
 * check mark. The details panel shows the selection, read only (see details/DetailsPanel.tsx): an agent's own Skills, Tools and Notes keep a quiet "Remove". Removing
 * stages a change in the draft; the Save bar counts the changes and makes a version of the history, and "Go back" undoes it. The `data-tour` ids are map, agent,
 * details (the panel), add, save, help (and `bar` on the top bar). Every agent card carries `data-drop-agent` with the agent's id, so a drag can find the card it lands on.
 * The Add drawer holds the Add body (plain names and hints from the plain layer; a card goes to an agent by the picker or by a drag onto an agent card). After
 * an add the agent is selected, so its panel shows the new card; both the agent card and the new card wear the same ring for a few seconds (a line across
 * the map would cross other cards), and the Save bar says what changed. The
 * "2 different copies" badge on a line of an agent card, a card of the panel, the details of a skill or a drawer card opens the copies dialog, which sits at the top of the
 * page. The Version history drawer lists the earlier copies with "Go back to this", and under them has the Share section: "Share my agents" opens the Share sheet (a
 * small modal sheet that makes a copy of the saved agents in memory; the prototype writes nothing), and "Open a shared file" opens the Add drawer on its "From a shared
 * file" tab, where the copy can be opened again. The Notes section of an agent has a "Choose notes" button that opens the full-window Choose notes sheet for the agent
 * that is selected; "Use these notes" stages one change, selects the agent and rings the new card like an add does. With the Add or Version history drawer open the page
 * keeps clear of it: the panel stays beside the map in a wide window and gives way to the drawer in a narrow one. Escape closes the top layer only: the tooltip, the tour,
 * then the copies dialog or the Share sheet, then the Choose notes sheet, then a drawer (the sheet closes a drawer when it opens, and the tour closes both when it starts).
 * The Add picker and the drop targets leave out the agents that Find skipped, like the map.
 * The first minute (HomeFlow) sets four things from outside: the agents of places the person skipped in Find stay off the map (`skipped`), the tour starts by
 * itself once when `autoTour` is set, "Find more" reopens Find (`onFindMore`), and `closingNote` allows one short note after the first Save, once per session.
 * The tour's second step waits for a real click on an agent: that click is the step's action.
 */
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { InterfaceId } from '../../shared/proto/types.js';
import { agentCard, ownedAgents, shelvesOf } from '../../shared/home/cards.js';
import { agentOfSelected, detailsOf } from '../../shared/home/details.js';
import type { Selected } from '../../shared/home/details.js';
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
import { DetailsPanel } from './details/DetailsPanel.js';
import { SavePoints } from './points/SavePoints.js';
import { ShareSheet } from './share/ShareSheet.js';
import { Button } from './kit/Button.js';
import { Drawer } from './kit/Drawer.js';
import { useLeaving, usePresence } from './kit/presence.js';
import { HelpPopover } from './kit/HelpPopover.js';
import { KitIcon } from './kit/icons.js';
import { AgentCard } from './kit/AgentCard.js';
import { Tooltip } from './kit/Tooltip.js';
import { SortToggle } from './map/SortToggle.js';
import { SaveBar } from './save/SaveBar.js';
import { MOTION } from '../motion-tokens.js';
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
interface Fresh {
  readonly agentId: string; readonly entryId: string | null;
  /** True when the new card is the agent's set of notes, whose id is not known until the choice is saved. */
  readonly notes?: boolean;
  /** Flips each time something is added or shown again, so the cards that wear the mark are made afresh and their arrival plays again. */
  readonly phase: 0 | 1;
}
/** How long the "just added" mark stays, in milliseconds: the ring is drawn, held and faded inside this time (the motion tokens), and the page takes the mark off at its end. */
const FRESH_MS = MOTION.home.ring.holdMs;

/** How long the body stays marked as moving after a drawer opens or closes: longer than the slowest of the drawer's two clocks. */
const MOVING_MS = 320;

/** How long the closing note stays, in milliseconds, before it fades. */
const NOTE_MS = 6000;

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
const flip = (current: Fresh | null): 0 | 1 => (current !== null && current.phase === 0 ? 1 : 0);

const freshOf = (fresh: Fresh | null, picked: string | null): string | null => (fresh !== null && fresh.entryId !== null && fresh.agentId === picked ? fresh.entryId : null);

export function HomeApp({ skipped = NONE, autoTour = false, closingNote = false, onFindMore, barPhase }: HomeAppProps = {}): ReactElement {
  const { state, dispatch } = useProtoStore();
  const [selected, setSelected] = useState<Selected | null>(null);
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [sort, setSort] = useState<SortMode>('name');
  const [touched, setTouched] = useState<readonly string[]>([]);
  const [ownPhase, setOwnPhase] = useState<BarPhase | null>(null);
  const phase = barPhase === undefined ? ownPhase : barPhase.phase, setPhase = barPhase === undefined ? setOwnPhase : barPhase.set;
  const [copiesFor, setCopiesFor] = useState<string | null>(null);
  const copies = useLeaving(copiesFor);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [note, setNote] = useState(false);
  const toast = usePresence(note);
  const [choosing, setChoosing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sheet = usePresence(sharing);
  const [addTab, setAddTab] = useState<AddTab>(DEFAULT_TAB);
  const [lastCopy, setLastCopy] = useState<string | undefined>(undefined);
  const [tour, tourDo] = useReducer(tourReduce, TOUR_STEPS, createTour);
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<FocusAfter | null>(null);
  const copiesFrom = useRef('.hm-panel');
  const clock = useRef<HTMLButtonElement>(null), addButton = useRef<HTMLButtonElement>(null);

  const world = state.draft;
  const owned = useMemo(() => ownedAgents(world).filter(a => !skipped.includes(a.id)), [world, skipped]);
  const agents = useMemo(() => sortAgents(owned, sort, touched), [owned, sort, touched]);
  // The agent whose card is lit: the selected agent, or the owner of the selected skill, tool or set of notes.
  const picked = agentOfSelected(selected);
  const agent = agents.find(a => a.id === picked) ?? null;
  const shelves = useMemo(() => (agent === null ? null : shelvesOf(world, agent)), [world, agent]);
  const details = useMemo(() => detailsOf(world, agents, selected), [world, agents, selected]);
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
  const startingTour = useRef(false), wantFirst = useRef(true);
  useEffect(() => { if (autoTour && tourSession.claimAutoStart()) { startingTour.current = true; tourDo('start'); } }, [autoTour]);
  // The first agent in the order shown is picked when the map first shows, and again when a tour ends or is skipped, so the shelves are never empty on the first
  // view. Not while a tour runs (or is about to): its click step waits for the person to pick an agent, and that click must pick something. A pick the person put
  // down stays down: this runs once for each of those moments, not whenever nothing is picked.
  useEffect(() => {
    if (tour.status === 'running') { startingTour.current = false; wantFirst.current = true; return; }
    if (startingTour.current || !wantFirst.current) return;
    wantFirst.current = false;
    const first = agents[0];
    if (selected === null && first !== undefined) setSelected({ kind: 'agent', id: first.id });
  }, [tour.status, selected, agents]);
  // The closing note goes by itself.
  useEffect(() => {
    if (!note) return undefined;
    const timer = window.setTimeout(() => setNote(false), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);
  // The tour dims the page, so the person cannot click an agent. When it reaches the shelves with nothing picked, it opens one that has something to show.
  useEffect(() => {
    if (stepId !== 'details' || selected !== null) return;
    const first = agentForTour(world, agents);
    if (first !== null) setSelected({ kind: 'agent', id: first.id });
  }, [stepId, selected, world, agents]);
  // A selection whose thing is gone (it was removed, a change was put back, a place was skipped) falls back to its agent, else to nothing.
  useEffect(() => {
    if (selected === null || details !== null) return;
    const owner = selected.kind === 'agent' ? undefined : selected.ownerAgentId;
    setSelected(owner !== undefined && agents.some(a => a.id === owner) ? { kind: 'agent', id: owner } : null);
  }, [selected, details, agents]);
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
  // The panel shows a new thing when the selection changes, so it starts at its top: a skill opened from the foot of an agent's long panel would otherwise show its middle.
  const shown = selected === null ? '' : `${selected.kind}:${selected.id}:${selected.ownerAgentId ?? ''}`;
  useLayoutEffect(() => { if (panel.current !== null) panel.current.scrollTop = 0; }, [shown]);
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
    setDrawer(null);
    setChoosing(true);
  };
  /** Where the focus goes when the Choose notes sheet closes and the button that opened it is gone: the button on the Notes shelf, else the panel heading. */
  const chooseTarget = (): HTMLElement | null => panel.current?.querySelector<HTMLElement>('[data-notes-shelf] .nt-shelf-action button') ?? panel.current?.querySelector<HTMLElement>('#hm-panel-title') ?? null;
  /** "Use these notes" staged a change: pick that agent, move it up the recent order, and ring the new card on its Notes shelf, as an add does. */
  const chosen = (agentId: string): void => {
    setSelected({ kind: 'agent', id: agentId });
    setTouched(current => touch(current, agentId));
    setFresh(current => ({ agentId, entryId: null, notes: true, phase: flip(current) }));
  };
  /** "Open a shared file" in the Version history drawer: the Add drawer opens on its shared-file tab. */
  const openFile = (): void => { setSharing(false); setAddTab('file'); setDrawer('add'); };
  /** The card of an agent was pressed: it is selected, and pressed again it is put down. An agent whose item is selected is selected itself by this press. */
  const pick = (id: string): void => { setSelected(current => (current !== null && current.kind === 'agent' && current.id === id ? null : { kind: 'agent', id })); setFresh(null); tourDo('acted'); };
  /** A line in an agent card, or a card in the panel, was pressed: that item is selected, and the agent it was opened from keeps the highlight as its owner. */
  const pickItem = (ownerAgentId: string, entry: ShelfEntry): void => { setSelected({ kind: entry.kind, id: entry.id, ownerAgentId }); tourDo('acted'); };
  /** A card went to an agent (or a ready-made agent was copied in): pick that agent, so its shelf shows the new card. */
  const added = ({ agentId, entry }: { readonly agentId: string; readonly entry: { readonly id: string; readonly kind: string } }): void => {
    setSelected({ kind: 'agent', id: agentId });
    setTouched(current => touch(current, agentId));
    setFresh(current => ({ agentId, entryId: entry.kind === 'agent' ? null : entry.id, phase: flip(current) }));
  };
  /** "Show" on the note after an add: the drawer closes, and the new card is brought into view and rung again (also where the drawer had hidden the shelves). */
  const showAdded = (info: { readonly agentId: string; readonly entry: { readonly id: string; readonly kind: string } }): void => { added(info); setDrawer(null); };
  /** When the badge is gone (a copy was kept) the card is still there: the focus goes to its name, else (the details of that skill) to the panel heading. */
  const restoreCopiesFocus = (): HTMLElement | null => {
    // The dialog is held for its exit after it closes, so the item it was about is the held value, not the (already empty) state.
    const item = copies.value === null ? undefined : world.items.find(i => i.id === copies.value);
    const name = item === undefined ? '' : nameOf(item.name);
    const cards = [...document.querySelectorAll<HTMLElement>(`${copiesFrom.current} .kit-card-main`)];
    return cards.find(el => el.textContent === name) ?? (copiesFrom.current === '.hm-panel' ? panel.current?.querySelector<HTMLElement>('#hm-panel-title') ?? null : null);
  };
  /** Opens the dialog for one item, and remembers whether the badge was in a drawer or on the shelves, so the focus goes back to the same place. */
  const openCopies = (id: string): void => {
    copiesFrom.current = document.activeElement?.closest('.kit-drawer') != null ? '.kit-drawer' : '.hm-panel';
    setCopiesFor(id);
  };
  /** Takes one item off one agent: from its shelves in the panel, or from the details of the item. The agent is then the selection, and the focus lands near where the item was. */
  const remove = (agentId: string, entry: ShelfEntry): void => {
    const target = agents.find(a => a.id === agentId);
    if (target === undefined) return;
    const own = shelvesOf(world, target);
    const list = entry.kind === 'skill' ? own.skills : entry.kind === 'tool' ? own.tools : own.notes;
    focusAfter.current = selected !== null && selected.kind !== 'agent' ? 'heading' : { kind: entry.kind, index: list.findIndex(e => e.id === entry.id) };
    dispatch(removeAction(agentId, entry.kind, entry.id));
    setTouched(current => touch(current, agentId));
    setSelected({ kind: 'agent', id: agentId });
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
          <HelpPopover pill={WORDS.label.preview} label={WORDS.label.aboutPreview} text={WORDS.popover.preview} />
        </div>
        <span className="hm-spacer" />
        <Tooltip text={WORDS.label.versionHistory}>
          {aria => <Button round icon="clock" aria-label={WORDS.label.versionHistory} aria-expanded={drawer === 'points'} ref={clock} onClick={() => toggle('points')} {...aria} />}
        </Tooltip>
        <Button variant="primary" icon="plus" data-tour="add" aria-expanded={drawer === 'add'} ref={addButton} onClick={() => toggle('add')}>{WORDS.label.add}</Button>
        <HelpPopover label={WORDS.label.help} text={WORDS.popover.help} align="end" dataTour="help" action={{ label: WORDS.label.showTour, onAction: () => { setSelected(null); tourDo('replay'); } }} />
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
              const mine = selected !== null && selected.kind !== 'agent' && selected.ownerAgentId === a.id ? selected.id : null;
              return (
                <li key={fresh !== null && fresh.agentId === a.id ? `${a.id}:${fresh.phase}` : a.id}>
                  <AgentCard name={words.name} hint={words.hint} shelves={shelvesOf(world, a)} selected={selected !== null && selected.kind === 'agent' && selected.id === a.id} itemId={mine} onSelect={() => pick(a.id)} onSelectItem={entry => pickItem(a.id, entry)} onBadgePress={entry => openCopies(entry.id)}
                    dropAgent={a.id} fresh={fresh !== null && fresh.agentId === a.id} {...(i === 0 ? { dataTour: 'agent' } : {})} />
                </li>
              );
            })}
          </ul>
        </main>

        <aside className="hm-panel" ref={panel} data-tour="details" aria-labelledby="hm-panel-title">
          <DetailsPanel details={details} onSelect={next => { setSelected(next); tourDo('acted'); }} onRemove={remove} onBadgePress={openCopies} onChoose={choose} freshId={freshOf(fresh, picked)} freshPhase={fresh?.phase ?? 0} freshNotes={freshNotes} />
        </aside>

        <Drawer open={drawer === 'add'} title={WORDS.label.addDrawer} onClose={() => setDrawer(null)} dataSlot="add" returnTo={() => addButton.current}>
          <AddDrawerBody nameOf={nameOf} hintOf={plainHintOf} onOpenCopies={openCopies} line={false} onAdded={added} onShow={showAdded} initialTab={addTab} hideAgents={skipped} {...(lastCopy === undefined ? {} : { lastCopy })} />
        </Drawer>
        <Drawer open={drawer === 'points'} title={WORDS.label.versionHistory} onClose={() => setDrawer(null)} dataSlot="points" returnTo={() => clock.current}>
          <SavePoints rows={pointRows} unsaved={changes > 0} onGoBack={id => goBackTo(id, false)} onShare={() => setSharing(true)} onOpenFile={openFile} />
        </Drawer>
        <ChooseNotes open={choosing} agentId={picked} onClose={() => setChoosing(false)} onChosen={chosen} returnTo={chooseTarget} />
      </div>

      {closingNote ? <div className="hm-toast" role="status" data-open={toast.mounted && !toast.leaving ? '' : undefined} data-leaving={toast.leaving ? '' : undefined}>{toast.mounted ? <><KitIcon name="check" size={20} /><span>{FIND_WORDS.hint.closingNote}</span></> : null}</div> : null}
      <SaveBar model={bar} ticks={ticks} onSave={save} onGoBack={goBack} onDiscard={discard} />

      {sheet.mounted ? <ShareSheet world={state.committed} hidden={skipped} unsaved={changes > 0} leaving={sheet.leaving} onClose={() => setSharing(false)} onCopy={setLastCopy} onOpenFile={openFile} /> : null}
      {copies.value === null ? null : <CopiesDialog itemId={copies.value} nameOf={nameOf} leaving={copies.leaving} restoreFocus={restoreCopiesFocus} onClose={() => setCopiesFor(null)} />}

      <TourAnnouncer state={tour} />
      {tour.status === 'running' ? <TourOverlay state={tour} onNext={() => tourDo('next')} onBack={() => tourDo('back')} onSkip={() => tourDo('skip')} /> : null}
    </div>
  );
}
