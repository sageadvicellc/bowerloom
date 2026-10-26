/**
 * The home app shell: a top bar (the name with the leaf, the clock button "Version history" with its tooltip, "Add", and the "?" Help button), a stage with the map, a
 * details panel on the right, a Save bar at the bottom, and two right-side drawers (Add, Version history) that open over the stage. There is no left rail and no routing.
 * "Preview", plain words with a small dot and its own "?" popover, sits beside the name, always: this prototype writes nothing to the computer, and the popover says so.
 * The map is a plain grid of the person's own agents, one tile each (every tile has the same width and the same height), in one order at a time (by name, or by how
 * recently each changed). A tile says what the agent can do at a glance: its job and one line of counts ("3 skills · 1 tool · 1 note set"). A count is a text button that
 * opens a tray under the tile's row of the grid, as wide as the row, with that kind's items as compact rows; the later rows move down, one tray is open at a time, and the
 * same count again closes it. The grid does not know how many columns it has, so HomeApp reads them (useColumns) to put the tray after the last tile of the row.
 * One thing is selected at a time (`selected`: an agent, or a skill, tool or set of notes with the agent it was opened from). A selection is only a highlight, never a
 * check mark. The details panel shows the selection, read only (see details/DetailsPanel.tsx): an agent's own Skills, Tools and Notes keep a quiet "Remove". Removing
 * stages a change in the draft; the Save bar counts the changes and makes a version of the history, and "Go back" undoes it. The `data-tour` ids are map, agent,
 * details (the panel), add, save, help (and `bar` on the top bar). Every agent card carries `data-drop-agent` with the agent's id, so a drag can find the card it lands on.
 * The Add drawer holds the Add body (plain names and hints from the plain layer; a card goes to an agent by the picker or by a drag onto an agent card). After
 * an add the agent is selected, so its panel shows the new card; both the agent card and the new card wear the same ring for a few seconds (a line across
 * the map would cross other cards), and the Save bar says what changed. The
 * "2 different copies" state on a row of a tray, a row of the panel, the details of a skill or a row of a drawer opens the copies dialog, which sits at the top of the
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
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import type { InterfaceId } from '../../shared/proto/types.js';
import { CHIP_KINDS, agentCard, ownedAgents, shelvesOf } from '../../shared/home/cards.js';
import { agentOfSelected, detailsOf } from '../../shared/home/details.js';
import type { Selected } from '../../shared/home/details.js';
import { DEFAULT_TAB } from '../../shared/home/add-model.js';
import type { AddTab } from '../../shared/home/add-model.js';
import type { ShelfEntry } from '../../shared/home/cards.js';
import { agentForTour, sortAgents, touch } from '../../shared/home/order.js';
import type { SortMode } from '../../shared/home/order.js';
import { libraryChangeCount, libraryChangeList } from '../../shared/home/library-changes.js';
import { plainHintOf, plainNameOf, plainNameOfSaved } from '../../shared/home/plain-names.js';
import { nowInWords } from '../clock.js';
import { skillTrust, toolTrust } from '../../shared/home/details-trust.js';
import { placesOf } from '../../shared/home/where-it-lives.js';
import { describeChanges, savePointRows } from '../../shared/home/points.js';
import { saveBar } from '../../shared/home/savebar.js';
import type { BarPhase } from '../../shared/home/savebar.js';
import { barSaid, placeOf, stillInDraft } from '../../shared/home/change-undo.js';
import { reduceStore } from '../../shared/proto/store.js';
import type { StoreAction } from '../../shared/proto/store.js';
import { useProtoStore } from '../proto/session.js';
import { AddDrawerBody } from './add/AddDrawerBody.js';
import { dropTargetFor } from './add/dom-helpers.js';
import { CopiesDialog } from './copies/CopiesDialog.js';
import { ChooseNotes } from './notes/ChooseNotes.js';
import { DetailsPanel } from './details/DetailsPanel.js';
import { SavePoints } from './points/SavePoints.js';
import { ShareSheet } from './share/ShareSheet.js';
import { HowItWorks } from './trust/HowItWorks.js';
import { LibraryPage } from './library/LibraryPage.js';
import { Sidebar } from './shell/Sidebar.js';
import { keyShortcuts, navModeOf, onMac, shellKey, toggleTip } from './shell/shell-state.js';
import type { View } from './shell/shell-state.js';
import { useWindowWidth } from './shell/useWindowWidth.js';
import { LIBRARY_WORDS } from './library/library-words.js';
import type { LibraryKind } from '../../shared/home/library-model.js';
import { IconButton } from './kit/IconButton.js';
import { SortMenu } from './kit/SortMenu.js';
import { useReadOnly } from './read-only.js';
import type { DataSource } from './read-only.js';
import { Drawer } from './kit/Drawer.js';
import { useLeaving, usePresence } from './kit/presence.js';
import { ShellNote } from './shell/ShellNote.js';
import type { NoteView } from './shell/ShellNote.js';
import { useChangeList } from './save/useChangeList.js';
import { AgentCard } from './kit/AgentCard.js';
import { AgentTrays } from './map/AgentTrays.js';
import { rowOf, useColumns } from './map/useColumns.js';
import { SaveBar } from './save/SaveBar.js';
import { MOTION } from '../motion-tokens.js';
import { discardAction, goBackAction, removeAction, saveAction } from './store-actions.js';
import { TourAnnouncer, TourOverlay } from './tour/TourOverlay.js';
import { TOUR_STEPS } from './tour/steps.js';
import { closingNoteSession, createTour, currentStep, tourReduce, tourSession } from './tour/tour.js';
import { FIND_WORDS } from './first-run/find-words.js';
import { WORDS, agentsCount, changesCount, removedNote } from './words.js';
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
  /** Where the setup on show came from: the made-up sample (default) or the person's own files. Read-only mode says which in the mark's popover. */
  dataSource?: DataSource;
}

const NONE: readonly string[] = Object.freeze([]);

/** The two ways to put the agents in order. */
const SORT_CHOICES: readonly { readonly mode: SortMode; readonly label: string }[] = Object.freeze([{ mode: 'name', label: WORDS.label.byName }, { mode: 'recent', label: WORDS.label.byRecent }]);

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

export function HomeApp({ skipped = NONE, autoTour = false, closingNote = false, onFindMore, barPhase, dataSource = 'sample' }: HomeAppProps = {}): ReactElement {
  const readOnly = useReadOnly();
  const { state, dispatch } = useProtoStore();
  const [view, setView] = useState<View>('agents');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  // The details panel can be put away, so the map has the whole width (a fourth column of tiles where the stage can hold four). The tour and "Skip to details" bring it back.
  const [detailsOpen, setDetailsOpen] = useState(true);
  // The left navigation: what the person chose with its toggle (null until they do, so it follows the window width), and, when it is hidden, whether it is drawn over the page.
  const [navChosen, setNavChosen] = useState<boolean | null>(null);
  const [overlay, setOverlay] = useState(false);
  const width = useWindowWidth();
  const navMode = navModeOf(width, navChosen);
  const navShown = navMode === 'open' || (navMode === 'hidden' && overlay);
  // The Library page the navigation opens on, and whether its four pages show under "Library".
  const [libraryKind, setLibraryKind] = useState<LibraryKind>('skill');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [webOpen, setWebOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>('name');
  const [touched, setTouched] = useState<readonly string[]>([]);
  const [ownPhase, setOwnPhase] = useState<BarPhase | null>(null);
  const phase = barPhase === undefined ? ownPhase : barPhase.phase, setPhase = barPhase === undefined ? setOwnPhase : barPhase.set;
  const [copiesFor, setCopiesFor] = useState<string | null>(null);
  // The tray that is open under the map: one at a time, the list of one kind of one agent.
  const [tray, setTray] = useState<{ readonly agentId: string; readonly kind: ShelfEntry['kind'] } | null>(null);
  // The one tile of the grid that is a Tab stop: the one that had the focus last, else the agent that is picked, else the first.
  const [stopId, setStopId] = useState<string | null>(null);
  const grid = useRef<HTMLUListElement>(null);
  const columns = useColumns(grid, 3, view);
  const copies = useLeaving(copiesFor);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [note, setNote] = useState<NoteView | null>(null);
  const noteKeys = useRef(0);
  const [choosing, setChoosing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sheet = usePresence(sharing);
  const [howOpen, setHowOpen] = useState(false);
  const how = usePresence(howOpen);
  const [addTab, setAddTab] = useState<AddTab>(DEFAULT_TAB);
  const [lastCopy, setLastCopy] = useState<string | undefined>(undefined);
  const [tour, tourDo] = useReducer(tourReduce, TOUR_STEPS, createTour);
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<FocusAfter | null>(null);
  const copiesFrom = useRef('.hm-panel');
  const clock = useRef<HTMLButtonElement>(null), addButton = useRef<HTMLButtonElement>(null), findButton = useRef<HTMLButtonElement>(null);
  const navToggle = useRef<HTMLButtonElement>(null), topToggle = useRef<HTMLButtonElement>(null), webButton = useRef<HTMLButtonElement>(null);

  const world = state.draft;
  const owned = useMemo(() => ownedAgents(world).filter(a => !skipped.includes(a.id)), [world, skipped]);
  const agents = useMemo(() => sortAgents(owned, sort, touched), [owned, sort, touched]);
  // The agent whose card is lit: the selected agent, or the owner of the selected skill, tool or set of notes.
  const picked = agentOfSelected(selected);
  const agent = agents.find(a => a.id === picked) ?? null;
  const shelves = useMemo(() => (agent === null ? null : shelvesOf(world, agent)), [world, agent]);
  const details = useMemo(() => detailsOf(world, agents, selected), [world, agents, selected]);
  // The maker and the release of a skill from outside, and what a tool reaches: read from the Library's facts, for the details panel.
  const skillFacts = useMemo(() => (details !== null && details.kind === 'skill' ? skillTrust(world, details.id) : null), [world, details]);
  const toolFacts = useMemo(() => (details !== null && details.kind === 'tool' ? toolTrust(world, details.id) : null), [world, details]);
  // Where the picked agent, skill or tool is kept in each program: sample paths, for "Show where it lives".
  const places = useMemo(() => (details === null ? [] : placesOf(world, details.kind, details.id, details.name)), [world, details]);
  const shelvesById = useMemo(() => new Map(agents.map(a => [a.id, shelvesOf(world, a)] as const)), [world, agents]);
  const tabId = stopId !== null && agents.some(a => a.id === stopId) ? stopId : agent?.id ?? agents[0]?.id ?? null;
  // One set of helpers counts and names the changes of both places, so a change made on the Library page lands in the same Save bar and the same history.
  const changes = libraryChangeCount(state.committed, state.draft);
  const said = useMemo(() => barSaid(libraryChangeList(state.committed, state.draft), changes), [state.committed, state.draft, changes]);
  const which = useMemo(() => describeChanges(libraryChangeList(state.committed, state.draft)), [state.committed, state.draft]);
  const bar = saveBar(changes, state.committed.versions.length, phase, said);
  const nameOf = useMemo(() => plainNameOf(world), [world]);
  const pointRows = useMemo(() => (drawer === 'points' ? savePointRows(state.committed, plainNameOfSaved(state.committed)) : []), [drawer, state.committed]);
  const ticks = SAVE_TARGETS.filter(t => state.draft.interfaces.some(i => i.id === t.id && i.installed === 'installed')).map(t => t.name);
  const changeList = useChangeList(state, changes >= 2 && said === null, dispatch);
  // The newest state, for the things that run later than the render that made them (the Undo on a note, the keys).
  const latest = useRef(state);
  latest.current = state;
  // The list has an Undo for every change, so the note after Remove (which sits under the list) gives way to it.
  useEffect(() => { if (changeList.open) setNote(null); }, [changeList.open]);
  // A note about a removal is true only while the draft still holds that removal: Ctrl+Z, an Undo in the list or Go back takes the note away with the change.
  useEffect(() => { if (note !== null && note.watch !== undefined && !stillInDraft(state, note.watch)) setNote(null); }, [state, note]);
  const stepId = currentStep(tour)?.id ?? null;
  const freshNotes = fresh !== null && fresh.notes === true && fresh.agentId === picked ? (shelves?.notes[0]?.id ?? null) : null;

  useEffect(() => { document.title = WORDS.label.appName; }, []);
  // A new change ends what the bar said about the last save or the last Go back: without this, discarding that change would bring the old "Saved" back.
  useEffect(() => { if (changes > 0 && phase !== null) setPhase(null); }, [changes, phase, setPhase]);
  // The tour runs by itself once in a session, when the first minute asks for it. After that only the Help button runs it.
  const startingTour = useRef(false), wantFirst = useRef(true);
  // True when the tour picked an agent because the person pressed Next without clicking one: the third step then says so.
  const [tourPicked, setTourPicked] = useState(false);
  useEffect(() => { if (autoTour && tourSession.claimAutoStart()) { startingTour.current = true; tourDo('start'); } }, [autoTour]);
  // The first agent in the order shown is picked when the map first shows, so the shelves are never empty on the first view. Not while a tour runs (or is about to):
  // its click step waits for the person to pick an agent, and that click must pick something. A tour that ends never picks an agent by itself: what the person
  // picked stays, and when they picked nothing the panel waits for them. A pick the person put down stays down: this runs once, not whenever nothing is picked.
  useEffect(() => {
    if (tour.status === 'running') { startingTour.current = false; wantFirst.current = false; return; }
    if (startingTour.current || !wantFirst.current) return;
    wantFirst.current = false;
    const first = agents[0];
    if (selected === null && first !== undefined) setSelected({ kind: 'agent', id: first.id });
  }, [tour.status, selected, agents]);
  // Ctrl+Z (Cmd+Z on a Mac) takes back the last change and Shift+Ctrl+Z (Shift+Cmd+Z) puts it back, unless the focus is in a text field (which keeps its own undo) or a layer
  // that holds the page (a dialog, the Share sheet, the tour) is open. The store keeps the steps; this only asks for one.
  const keysBlocked = useRef(false);
  keysBlocked.current = tour.status === 'running' || sharing || howOpen || choosing || copiesFor !== null;
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.altKey || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const redo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.shiftKey), undo = k === 'z' && !e.shiftKey;
      if (!undo && !redo) return;
      const at = e.target;
      if (at instanceof HTMLElement && (at.isContentEditable || /^(input|textarea|select)$/i.test(at.tagName))) return;
      if (keysBlocked.current || document.querySelector('[aria-modal="true"]') !== null) return;
      e.preventDefault();
      dispatch({ type: undo ? 'undo' : 'redo' });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [dispatch]);
  /** The toggle of the left navigation: put it away or bring it back; under 900 px it opens or closes the drawer over the page. The focus stays on a toggle that is still there. */
  const toggleNav = (): void => {
    if (navMode === 'hidden') {
      const next = !overlay;
      setOverlay(next);
      if (!next) requestAnimationFrame(() => topToggle.current?.focus());
      return;
    }
    setNavChosen(navMode !== 'open');
    requestAnimationFrame(() => navToggle.current?.focus());
  };
  const toggleDetails = (): void => setDetailsOpen(open => !open);
  const latestToggles = useRef({ toggleNav, toggleDetails });
  latestToggles.current = { toggleNav, toggleDetails };
  // Ctrl+B (Cmd+B on a Mac) puts the navigation away or brings it back, and Ctrl+Shift+B the details. Not while the tour runs or a dialog holds the page.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const which = shellKey(e);
      if (which === null || keysBlocked.current || document.querySelector('[aria-modal="true"]') !== null) return;
      e.preventDefault();
      if (which === 'nav') latestToggles.current.toggleNav(); else latestToggles.current.toggleDetails();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // The navigation drawer (under 900 px) closes with Escape, and the focus goes back to its toggle. A layer above it (a tooltip, a popover) has handled the key first.
  useEffect(() => {
    if (!overlay) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault(); setOverlay(false); requestAnimationFrame(() => topToggle.current?.focus());
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [overlay]);
  // Wider than 900 px again, the drawer is not needed.
  useEffect(() => { if (navMode !== 'hidden') setOverlay(false); }, [navMode]);

  // The tour dims the page, so the person cannot click an agent. When it reaches the shelves with nothing picked, it opens one that has something to show, and its
  // sentence says so ("We picked one for you."): the tour never picks an agent in silence.
  useEffect(() => {
    if (tour.status !== 'running') { setTourPicked(false); return; }
    if (stepId !== 'details' || selected !== null) return;
    const first = agentForTour(world, agents);
    if (first !== null) { setSelected({ kind: 'agent', id: first.id }); setTourPicked(true); }
  }, [tour.status, stepId, selected, world, agents]);
  // Back at the first two steps the pick is the person's again: a click there is theirs.
  useEffect(() => { if (stepId === 'map' || stepId === 'agent') setTourPicked(false); }, [stepId]);
  useEffect(() => { if (stepId !== null && stepId !== 'details' && stepId !== 'add' && stepId !== 'save' && stepId !== 'share' && stepId !== 'help') setTourPicked(false); }, [stepId]);
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
  useEffect(() => { if (tour.status === 'running') { setView('agents'); setDrawer(null); setChoosing(false); setSharing(false); setDetailsOpen(true); setOverlay(false); } }, [tour.status]);
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

  /** The arrow keys, Home and End on a tile or on one of its counts: the focus (and the one Tab stop) goes to another tile, in reading order; Up and Down go by a row. */
  const gridKeys = (e: ReactKeyboardEvent<HTMLUListElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const from = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-drop-agent]') : null;
    if (from === null || !grid.current?.contains(from)) return;
    const at = agents.findIndex(a => a.id === from.getAttribute('data-drop-agent'));
    if (at < 0) return;
    const last = agents.length - 1;
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'ArrowDown' ? at + columns : e.key === 'ArrowUp' ? at - columns : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    const next = agents[Math.max(0, Math.min(last, to))];
    if (next === undefined || next.id === agents[at]?.id) return;
    // A tile that is not the Tab stop can still take the focus from here; it becomes the stop as it does (gridFocus).
    dropTargetFor(next.id, grid.current ?? document)?.querySelector<HTMLElement>('.kit-card-main')?.focus();
  };
  /** The focus came to a tile or one of its counts: that tile is the Tab stop from now on. */
  const gridFocus = (e: ReactFocusEvent<HTMLUListElement>): void => {
    const tile = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-drop-agent]') : null;
    const id = tile?.getAttribute('data-drop-agent');
    if (id !== null && id !== undefined) setStopId(id);
  };
  /** Space on a tile: the tray of its first count opens, or the tray that is open under it closes. */
  const spaceOn = (agentId: string, shelves: ReturnType<typeof shelvesOf>): void => {
    if (tray !== null && tray.agentId === agentId) { setTray(null); return; }
    const lists = { skill: shelves.skills, tool: shelves.tools, note: shelves.notes };
    const first = CHIP_KINDS.find(kind => lists[kind].length > 0);
    if (first !== undefined) setTray({ agentId, kind: first });
  };
  /** "Skip to details": the focus goes to the heading of the details panel. */
  const skipToDetails = (e: ReactMouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    if (!detailsOpen) { setDetailsOpen(true); requestAnimationFrame(() => document.querySelector<HTMLElement>('.hm-panel [tabindex="-1"]')?.focus()); return; }
    document.querySelector<HTMLElement>('.hm-panel [tabindex="-1"]')?.focus();
  };
  /** A count on a tile was pressed: its tray opens, another tray closes, and the same count again closes it. */
  const toggleTray = (agentId: string, kind: ShelfEntry['kind']): void => setTray(current => (current !== null && current.agentId === agentId && current.kind === kind ? null : { agentId, kind }));
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
  /** An agent was pressed under "Used by" on the Library page: the app moves to Agents and picks that agent, and the focus goes to its details. */
  const openAgent = (agentId: string): void => {
    focusAfter.current = 'heading';
    setView('agents');
    setSelected({ kind: 'agent', id: agentId });
    setFresh(null);
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
  const showAdded = (info: { readonly agentId: string; readonly entry: { readonly id: string; readonly kind: string } }): void => { added(info); setDrawer(null); setDetailsOpen(true); };
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
    const removal = removeAction(agentId, entry.kind, entry.id);
    dispatch(removal);
    setTouched(current => touch(current, agentId));
    setSelected({ kind: 'agent', id: agentId });
    setFresh(null);
    say('check', removedNote(entry.name), { label: WORDS.label.undo, run: () => undoRemoval(removal) }, removal);
  };
  /** Shows a note above the Save bar. A new note replaces the one that was there and starts its six seconds again. */
  const say = (icon: NoteView['icon'], text: string, action?: NoteView['action'], watch?: object): void => {
    noteKeys.current += 1;
    setNote({ key: noteKeys.current, icon, text, ...(action === undefined ? {} : { action }), ...(watch === undefined ? {} : { watch }) });
  };
  /** "Undo" on the note after Remove: takes that one removal out of the draft, if it is still part of it. The focus goes to the panel heading, as after any change. */
  const undoRemoval = (removal: StoreAction): void => {
    const current = latest.current, at = placeOf(current, removal);
    setNote(null);
    const action: StoreAction = { type: 'withdraw', at: [at] };
    if (at < 0 || reduceStore(current, action) === current) return;
    focusAfter.current = 'heading';
    dispatch(action);
  };
  const save = (): void => {
    const savePoints = state.committed.versions.length;
    dispatch(saveAction(said ?? which ?? changesCount(changes), nowInWords()));
    setPhase({ kind: 'saved', at: savePoints + 1, backTo: state.headVersionId });
    setFresh(null);
    // The first Save of a guided session says so once more, in a note.
    if (closingNote && closingNoteSession.claimAutoStart()) say('check', FIND_WORDS.hint.closingNote); else setNote(null);
  };
  const discard = (): void => { focusAfter.current = 'heading'; setFresh(null); setPhase(null); setNote(null); dispatch(discardAction()); };
  /** Makes the world as it was at one save point. The bar says so, and the focus stays where the person pressed. */
  const goBackTo = (versionId: string, focus: boolean): void => {
    const action = goBackAction(versionId, nowInWords());
    // A save point that cannot be restored leaves everything as it is, and the bar must not say it went back.
    if (reduceStore(state, action) === state) return;
    if (focus) focusAfter.current = 'heading';
    setFresh(null);
    setNote(null);
    dispatch(action);
    setPhase({ kind: 'back', at: state.committed.versions.length + 1, backTo: null });
  };
  const goBack = (): void => { if (phase !== null && phase.backTo !== null) goBackTo(phase.backTo, true); };

  const mac = onMac();
  const navName = navShown ? WORDS.label.hideNav : WORDS.label.showNav, detailsName = detailsOpen ? WORDS.label.hideDetails : WORDS.label.showDetails;
  /** A press in the navigation drawer (under 900 px) does its work and puts the drawer away. */
  const act = (run: () => void) => (): void => { setOverlay(false); run(); };
  const goAgents = (): void => { setView('agents'); };
  const goLibrary = (kind: LibraryKind | null): void => {
    if (kind === null) { if (view === 'library') setLibraryOpen(open => !open); else { setView('library'); setLibraryOpen(true); } return; }
    setView('library'); setLibraryOpen(true); setLibraryKind(kind);
  };
  const title = view === 'agents' ? WORDS.label.viewAgents : LIBRARY_WORDS.label.title;

  return (
    <div className="hm-root" data-home="" data-nav={navMode}>
      <a className="hm-skip" href="#hm-panel-title" onClick={skipToDetails}>{WORDS.label.skipToDetails}</a>
      <Sidebar mode={navMode} overlay={navMode === 'hidden' && overlay} view={view} libraryKind={libraryKind} libraryOpen={libraryOpen} addOpen={drawer === 'add'} historyOpen={drawer === 'points'} findOpen={false}
        readOnly={readOnly} real={dataSource === 'real'} toggleRef={navToggle} addRef={addButton} historyRef={clock} findRef={findButton}
        onToggle={toggleNav} onAgents={act(goAgents)} onLibrary={kind => { setOverlay(false); goLibrary(kind); }} onAdd={act(() => toggle('add'))} onFind={act(() => onFindMore?.())}
        onShare={act(() => setSharing(true))} onHistory={act(() => toggle('points'))} onTour={() => { setSelected(null); tourDo('replay'); }} onHow={() => setHowOpen(true)} />
      {navMode === 'hidden' && overlay ? <div className="hm-nav-scrim" data-nav-scrim="" aria-hidden="true" onClick={() => { setOverlay(false); requestAnimationFrame(() => topToggle.current?.focus()); }} /> : null}

      <div className="hm-col">
        <header className="hm-topbar">
          {navMode === 'hidden' ? <span className="hm-topbar-nav"><IconButton ref={topToggle} icon="sidebar-left" label={navName} tip={toggleTip(navName, 'nav', mac)} side="below" aria-expanded={overlay} aria-controls="hm-nav" aria-keyshortcuts={keyShortcuts('nav')} data-nav-toggle="" onClick={toggleNav} /></span> : null}
          <h1 className="kit-heading" tabIndex={-1}>{title}</h1>
          <div className="hm-topbar-tools">
            {view === 'agents'
              ? <SortMenu<SortMode> mode={sort} choices={SORT_CHOICES} onChange={setSort} label={WORDS.label.sort} menuLabel={WORDS.label.sortGroup} />
              : <IconButton ref={webButton} icon="globe" label={LIBRARY_WORDS.label.addFromWeb} side="below-end" onClick={() => setWebOpen(true)} />}
            <IconButton icon="sidebar-right" label={detailsName} tip={toggleTip(detailsName, 'details', mac)} side="below-end" aria-expanded={detailsOpen} aria-controls="hm-panel" aria-keyshortcuts={keyShortcuts('details')} data-details-toggle="" onClick={toggleDetails} />
          </div>
        </header>

        <div className="hm-body" ref={body} data-drawer={drawer ?? undefined} data-details={!detailsOpen ? 'closed' : undefined}>
          {view === 'agents' ? (
            <div className="hm-view" id="hm-view-agents">
            <main id="main" className="hm-stage">
              <div className="hm-stage-head">
                <p className="kit-hint">{agentsCount(agents.length)}. {WORDS.hint.stage}</p>
              </div>
              <ul className="hm-grid" ref={grid} data-tour="map" aria-label={WORDS.label.yourAgents} onKeyDown={gridKeys} onFocus={gridFocus}>
                {agents.flatMap((a, i) => {
                  const words = agentCard(a), shelves = shelvesById.get(a.id) ?? shelvesOf(world, a);
                  const mine = selected !== null && selected.kind !== 'agent' && selected.ownerAgentId === a.id ? selected.id : null;
                  const kindsOpen = tray !== null && tray.agentId === a.id ? tray.kind : null;
                  const tile = (
                    <li key={fresh !== null && fresh.agentId === a.id ? `${a.id}:${fresh.phase}` : a.id} className="hm-tile">
                      <AgentCard name={words.name} hint={words.hint} shelves={shelves} selected={selected !== null && selected.kind === 'agent' && selected.id === a.id} itemId={mine} onSelect={() => pick(a.id)}
                        openKind={kindsOpen} onToggleKind={kind => toggleTray(a.id, kind)} tabStop={a.id === tabId} onSpace={() => spaceOn(a.id, shelves)}
                        dropAgent={a.id} fresh={fresh !== null && fresh.agentId === a.id} {...(i === 0 ? { dataTour: 'agent' } : {})} />
                    </li>
                  );
                  const row = rowOf(i, agents.length, columns);
                  if (!row.last) return [tile];
                  const here = agents.slice(row.start, row.end + 1).map(b => {
                    const own = selected !== null && selected.kind !== 'agent' && selected.ownerAgentId === b.id ? selected.id : null;
                    return { id: b.id, name: agentCard(b).name, shelves: shelvesById.get(b.id) ?? shelvesOf(world, b), itemId: own };
                  });
                  return [tile, <li key={`tray-row-${row.start}`} className="hm-tray-slot"><AgentTrays agents={here} open={tray} onSelectItem={pickItem} onBadgePress={entry => openCopies(entry.id)} /></li>];
                })}
              </ul>
            </main>

            <aside className="hm-panel" ref={panel} data-tour="details" id="hm-panel" aria-labelledby="hm-panel-title">
              <DetailsPanel details={details} onSelect={next => { setSelected(next); tourDo('acted'); }} onRemove={remove} onBadgePress={openCopies} onChoose={choose} freshId={freshOf(fresh, picked)} freshPhase={fresh?.phase ?? 0} freshNotes={freshNotes} skillTrust={skillFacts} toolTrust={toolFacts} places={places} />
            </aside>
            </div>
          ) : (
            <div className="hm-view" id="hm-view-library">
              <LibraryPage shell={{ mainId: 'main', kind: libraryKind, onKind: setLibraryKind, webOpen, onWebOpen: setWebOpen, webButton }} onOpenAgent={openAgent} selectedAgent={picked} />
            </div>
          )}

          <Drawer open={drawer === 'add'} title={WORDS.label.addDrawer} onClose={() => setDrawer(null)} dataSlot="add" returnTo={() => addButton.current}>
            <AddDrawerBody nameOf={nameOf} hintOf={plainHintOf} onOpenCopies={openCopies} line={false} onAdded={added} onShow={showAdded} initialTab={addTab} hideAgents={skipped} selectedAgent={picked} {...(lastCopy === undefined ? {} : { lastCopy })} />
          </Drawer>
          <Drawer open={drawer === 'points'} title={WORDS.label.versionHistory} onClose={() => setDrawer(null)} dataSlot="points" returnTo={() => clock.current}>
            <SavePoints rows={pointRows} unsaved={changes > 0} which={which ?? (changes > 0 ? changesCount(changes) : null)} onGoBack={id => goBackTo(id, false)} onShare={() => setSharing(true)} onOpenFile={openFile} />
          </Drawer>
          <ChooseNotes open={choosing} agentId={picked} onClose={() => setChoosing(false)} onChosen={chosen} returnTo={chooseTarget} />
        </div>

        <ShellNote note={note} onGone={() => setNote(null)} />
        <SaveBar model={bar} ticks={ticks} onSave={save} onGoBack={goBack} onDiscard={discard} list={changeList} />
      </div>

      {sheet.mounted ? <ShareSheet world={state.committed} hidden={skipped} unsaved={changes > 0} leaving={sheet.leaving} onClose={() => setSharing(false)} onCopy={setLastCopy} onOpenFile={openFile} /> : null}
      {how.mounted ? <HowItWorks leaving={how.leaving} onClose={() => setHowOpen(false)} /> : null}
      {copies.value === null ? null : <CopiesDialog itemId={copies.value} nameOf={nameOf} leaving={copies.leaving} restoreFocus={restoreCopiesFocus} onClose={() => setCopiesFor(null)} />}

      <TourAnnouncer state={tour} picked={tourPicked} />
      {tour.status === 'running' ? <TourOverlay state={tour} picked={tourPicked} onNext={() => tourDo('next')} onBack={() => tourDo('back')} onSkip={() => tourDo('skip')} /> : null}
    </div>
  );
}
