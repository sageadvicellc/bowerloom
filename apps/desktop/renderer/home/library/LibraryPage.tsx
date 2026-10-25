/**
 * The Library page: the body of the 0.8 home app's fourth place, a stage and a details panel (the same two columns as the map) with the layers that belong to
 * them. Render it inside `ProtoProvider`, in the shell's `hm-root`, between the top bar and the Save bar. On the stage: the title, a segmented control (Skills,
 * Agents, Tools, Notes), a search box with a live count, "Sort by" (Name or Recently added), "Add from the web", and a list of everything the person owns of the
 * kind picked, including what no agent uses. The panel shows the details of the row that is picked, read only, with the actions: Add to an agent, Make my own
 * copy, Update, Remove from library. Every action stages a draft change through the store, so the Save bar counts it, the version history lists it and "Go back"
 * undoes it. Escape closes the top layer only: a help popover, the agent picker, a dialog, then the web sheet. When a layer closes the focus goes back to the
 * control that opened it, or, if that is gone (a removed row), to the row that took its place.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { libraryCounts, libraryDetails, listLibrary, removePlan, agentsFor } from '../../../shared/home/library-model.js';
import type { LibraryKind, LibrarySort, UpdateInfo } from '../../../shared/home/library-model.js';
import type { AgentRef } from '../../../shared/home/details.js';
import { addToAgentAction, makeOwnCopyAction, removeFromLibraryAction, useUpdateAction } from '../../../shared/home/library-actions.js';
import { plainNameOf } from '../../../shared/home/plain-names.js';
import { reduceStore } from '../../../shared/proto/store.js';
import { useProtoStore } from '../../proto/session.js';
import { CopiesDialog } from '../copies/CopiesDialog.js';
import { Button } from '../kit/Button.js';
import { HelpPopover } from '../kit/HelpPopover.js';
import { useLeaving } from '../kit/presence.js';
import { LibraryDetails } from './LibraryDetails.js';
import { LibraryList } from './LibraryList.js';
import { LibrarySortToggle } from './LibrarySortToggle.js';
import { LibraryTabs, tabId } from './LibraryTabs.js';
import { RemoveDialog } from './RemoveDialog.js';
import { UpdateDialog } from './UpdateDialog.js';
import { WebSheet } from './WebSheet.js';
import { LIBRARY_WORDS, addedItems, addedTo, countLine, removedLine } from './library-words.js';
import './library.css';

const L = LIBRARY_WORDS.label, H = LIBRARY_WORDS.hint;

export interface LibraryPageProps {
  /**
   * Called when a person presses an agent under "Used by". Without it the Library opens that agent in its own Agents tab; with it the shell can take the
   * person to the map and pick the agent there.
   */
  onOpenAgent?(agentId: string): void;
  /**
   * True inside the shell: the page then adds its stage and its panel to the shell's own body (a wrapper that takes no box of its own) instead of making a
   * body of its own, and its stage takes `mainId` as its id so the page has one main place at a time.
   */
  shell?: { readonly mainId: string | undefined };
}

const KIND_OF_ITEM: Readonly<Record<'skill' | 'agent' | 'tool', LibraryKind>> = Object.freeze({ skill: 'skill', agent: 'agent', tool: 'tool' });

/** What a dialog is about, taken when it opens: the thing may be gone by the time the dialog fades out. */
interface RemoveSnapshot { readonly id: string; readonly name: string; readonly line: string; readonly agents: readonly AgentRef[] }
interface UpdateSnapshot { readonly id: string; readonly name: string; readonly info: UpdateInfo }

/** Where the focus goes after something changed and the control that had it is gone. */
type FocusAfter = { readonly row: number } | 'heading' | 'title';

export function LibraryPage({ onOpenAgent, shell }: LibraryPageProps = {}): ReactElement {
  const { state, dispatch } = useProtoStore();
  const world = state.draft;
  const [kind, setKind] = useState<LibraryKind>('skill');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removeFor, setRemoveFor] = useState<RemoveSnapshot | null>(null);
  const [updateFor, setUpdateFor] = useState<UpdateSnapshot | null>(null);
  const [copiesFor, setCopiesFor] = useState<string | null>(null);
  const [webOpen, setWebOpen] = useState(false);
  const [say, setSay] = useState('');
  const [note, setNote] = useState('');
  const removing = useLeaving(removeFor), updating = useLeaving(updateFor), copies = useLeaving(copiesFor);
  const panelId = useId();
  const panel = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null), webButton = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<FocusAfter | null>(null);

  const counts = useMemo(() => libraryCounts(world), [world]);
  const listed = useMemo(() => listLibrary(world, kind, query, sort), [world, kind, query, sort]);
  const details = useMemo(() => (selectedId === null ? null : libraryDetails(world, kind, selectedId)), [world, kind, selectedId]);
  const choices = useMemo(() => (selectedId === null ? [] : agentsFor(world, kind, selectedId)), [world, kind, selectedId]);
  const nameOf = useMemo(() => plainNameOf(world), [world]);
  const searching = query.trim() !== '';

  useEffect(() => { document.title = 'Bowerloom'; }, []);
  // A thing that is gone (removed, or put back by "Go back") leaves nothing picked.
  useEffect(() => { if (selectedId !== null && details === null) setSelectedId(null); }, [selectedId, details]);
  // The panel starts at its top when a different thing is picked.
  useLayoutEffect(() => { if (panel.current !== null) panel.current.scrollTop = 0; }, [selectedId, kind]);
  // After a change takes away the control that had the focus, it goes to the row that took its place, or to a heading.
  useLayoutEffect(() => {
    const after = focusAfter.current;
    if (after === null) return;
    focusAfter.current = null;
    if (after === 'title') { body.current?.querySelector<HTMLElement>('main h1')?.focus(); return; }
    if (after === 'heading') { panel.current?.querySelector<HTMLElement>('#lb-panel-title')?.focus(); return; }
    const buttons = body.current?.querySelectorAll<HTMLElement>('.lb-list .kit-card-main') ?? [];
    (buttons[Math.min(after.row, buttons.length - 1)] ?? body.current?.querySelector<HTMLElement>('main h1'))?.focus();
  });

  const clearSays = (): void => { setSay(''); setNote(''); };
  const changeKind = (next: LibraryKind): void => { if (next === kind) return; setKind(next); setQuery(''); setSelectedId(null); clearSays(); };
  const pick = (id: string): void => { setSelectedId(current => (current === id ? null : id)); clearSays(); };
  const rowButton = (id: string | null): HTMLElement | null => (id === null ? null : body.current?.querySelector<HTMLElement>(`.lb-list li[data-row-id="${CSS.escape(id)}"] .kit-card-main`) ?? null);

  const pickAgent = (agentId: string): void => {
    if (selectedId === null) return;
    const action = addToAgentAction(world, kind, selectedId, agentId);
    if (action === null) return;
    dispatch(action);
    setSay(addedTo(choices.find(c => c.id === agentId)?.name ?? ''));
  };
  const openAgent = (agentId: string): void => {
    if (onOpenAgent !== undefined) { onOpenAgent(agentId); return; }
    setKind('agent'); setQuery(''); setSelectedId(agentId); clearSays();
    focusAfter.current = 'heading';
  };
  const askRemove = (): void => {
    if (selectedId === null) return;
    const plan = removePlan(world, kind, selectedId);
    if (plan !== null) setRemoveFor({ id: selectedId, name: plan.name, line: plan.line, agents: plan.agents });
  };
  const confirmRemove = (): void => {
    if (removeFor === null) return;
    focusAfter.current = { row: Math.max(0, listed.rows.findIndex(r => r.id === removeFor.id)) };
    dispatch(removeFromLibraryAction(removeFor.id));
    setRemoveFor(null); setSelectedId(null); setSay('');
    setNote(removedLine(removeFor.name));
  };
  const makeCopy = (): void => {
    if (selectedId === null) return;
    const action = makeOwnCopyAction(world, kind, selectedId);
    if (action === null) return;
    const next = reduceStore(state, action);
    const known = new Set(world.items.map(i => i.id));
    const made = next.draft.items.find(i => !known.has(i.id));
    if (made === undefined) return;
    dispatch(action);
    setSelectedId(made.id); setNote(''); setSay(LIBRARY_WORDS.hint.ownCopyMade);
    focusAfter.current = 'heading';
  };
  const askUpdate = (): void => {
    if (selectedId === null || details === null || details.update === null) return;
    setUpdateFor({ id: selectedId, name: details.name, info: details.update });
  };
  const confirmUpdate = (): void => {
    if (updateFor === null) return;
    const action = useUpdateAction(world, kind, updateFor.id, updateFor.info);
    if (action !== null) dispatch(action);
    setUpdateFor(null); setSay(LIBRARY_WORDS.hint.updated);
    focusAfter.current = 'heading';
  };
  const added = ({ count, firstKind }: { readonly count: number; readonly firstKind: 'skill' | 'agent' | 'tool' }): void => {
    setKind(KIND_OF_ITEM[firstKind]); setQuery(''); setSort('added'); setSelectedId(null); setSay('');
    setNote(addedItems(count));
  };
  /** Where the focus goes when the copies dialog closes and the badge it opened from is gone: the row, else the heading of the panel. */
  const copiesFocus = (): HTMLElement | null => rowButton(copies.value) ?? panel.current?.querySelector<HTMLElement>('#lb-panel-title') ?? null;
  const removeFocus = (): HTMLElement | null => rowButton(removing.value?.id ?? null);

  return (
    <div className={shell === undefined ? 'hm-body' : 'lb-fill'} ref={body} data-library="">
      <main id={shell === undefined ? 'main' : shell.mainId} className="hm-stage">
        <div className="hm-stage-head">
          <div className="hm-stage-title">
            <div className="lb-title-line">
              <h1 className="kit-heading" tabIndex={-1}>{L.title}</h1>
              <HelpPopover label={L.aboutLibrary} text={LIBRARY_WORDS.popover.library} />
            </div>
            <p className="kit-hint lb-tip">{H.pageTip}</p>
          </div>
          <div className="hm-stage-tools">
            <Button variant="primary" icon="plus" ref={webButton} onClick={() => setWebOpen(true)}>{L.addFromWeb}</Button>
          </div>
        </div>
        <div className="lb-sticky">
          <div className="lb-find">
            <LibraryTabs kind={kind} counts={counts} onChange={changeKind} panelId={panelId} />
            <input className="lb-search" type="search" autoComplete="off" spellCheck={false} aria-label={L.search} placeholder={L.searchPlaceholder} value={query} onChange={e => { setQuery(e.target.value); }} />
            <LibrarySortToggle mode={sort} onChange={setSort} />
          </div>
          <p className="kit-hint lb-count" role="status" data-count="">{note !== '' ? note : countLine(listed.rows.length, listed.total, kind, searching)}</p>
        </div>
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(panelId, kind)}>
          <LibraryList kind={kind} rows={listed.rows} selectedId={selectedId} onSelect={pick} onBadgePress={setCopiesFor} label={L.listName} empty={searching ? H.noMatch : H.emptyKind} />
        </div>
      </main>

      <aside className="hm-panel" ref={panel} aria-labelledby="lb-panel-title">
        <LibraryDetails key={`${kind}:${selectedId ?? ''}`} details={details} choices={choices} say={say} onPickAgent={pickAgent} onOpenAgent={openAgent}
          onRemove={askRemove} onCopy={makeCopy} onUpdate={askUpdate} onBadgePress={() => setCopiesFor(selectedId)} />
      </aside>

      <WebSheet open={webOpen} onClose={() => setWebOpen(false)} onAdded={added} returnTo={() => webButton.current} />

      {removing.value === null ? null : (
        <RemoveDialog name={removing.value.name} line={removing.value.line} agents={removing.value.agents} leaving={removing.leaving} onClose={() => setRemoveFor(null)} onConfirm={confirmRemove} restoreFocus={removeFocus} />
      )}
      {updating.value === null ? null : (
        <UpdateDialog name={updating.value.name} info={updating.value.info} leaving={updating.leaving} onClose={() => setUpdateFor(null)} onConfirm={confirmUpdate} restoreFocus={() => panel.current?.querySelector<HTMLElement>('#lb-panel-title') ?? null} />
      )}
      {copies.value === null ? null : <CopiesDialog itemId={copies.value} nameOf={nameOf} leaving={copies.leaving} restoreFocus={copiesFocus} onClose={() => setCopiesFor(null)} />}
    </div>
  );
}

