/**
 * The body of the Add drawer: five tabs (Skills, Tools, Notes, Agents, From a shared file) and, under them, the kit's own card for each thing. A card is
 * added to an agent by the "Add to" button and its small picker (the keyboard path), or by dragging it onto an agent card. Every add is a draft change
 * made through the store's own action, so the Save bar counts it and "Go back" undoes it. A line joins the card to the agent for a moment; with less
 * motion a plain note says the same. Ready-made agents sit under Agents, because the map shows the person's own agents only.
 *
 * To use it, put it inside a `Drawer` under a `ProtoProvider`, give each agent card on the page a `data-drop-agent="<agent id>"` element, and pass
 * `stageFile` (adds a shared file's bundle to the draft). `nameOf` turns a stored name into the words on a card.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { SHELF_LIMIT, visibleCount } from '../../../shared/home/cards.js';
import { ADD_TABS, DEFAULT_TAB, addAction, agentChoices, entriesFor, installAction, newAgentId, nextTab, plainName, stageAdd, stageInstall } from '../../../shared/home/add-model.js';
import type { AddEntry, AddTab, AgentChoice, NameOf } from '../../../shared/home/add-model.js';
import type { Bundle } from '../../../shared/proto/types.js';
import { useProtoStore } from '../../proto/session.js';
import { DragFollower } from '../kit/DragFollower.js';
import { useCardDrag } from '../kit/drag.js';
import { Button } from '../kit/Button.js';
import { AddRow } from './AddRow.js';
import { FileTab } from './FileTab.js';
import { useConnectLine } from './ConnectLine.js';
import { DROP_ATTRIBUTE, dropAgentOf } from './dom-helpers.js';
import { ADD_WORDS, addedTo, agentAdded, alreadyOn } from './add-words.js';
import './add.css';

const L = ADD_WORDS.label, H = ADD_WORDS.hint;
const TAB_LABEL: Readonly<Record<AddTab, string>> = { skills: L.skills, tools: L.tools, notes: L.notes, agents: L.agents, file: L.file };

export interface AddDrawerBodyProps {
  nameOf?: NameOf;
  /** Adds what a shared file holds to the draft. */
  stageFile(bundle: Bundle): void;
  initialTab?: AddTab;
  /** When given, the "2 different copies" badge on a card opens the dialog for that item. */
  onOpenCopies?(itemId: string): void;
  /** The text of a small shared file, offered as "Try a sample file". Only the Add test page passes it. */
  sampleFile?: string;
}

interface Note { readonly text: string; readonly key: number }

export function AddDrawerBody({ nameOf = plainName, stageFile, initialTab = DEFAULT_TAB, onOpenCopies, sampleFile }: AddDrawerBodyProps): ReactElement {
  const { state, dispatch } = useProtoStore();
  const world = state.draft;
  const [tab, setTab] = useState<AddTab>(initialTab);
  const [openId, setOpenId] = useState<string | null>(null);
  const [more, setMore] = useState<ReadonlySet<AddTab>>(new Set());
  const [note, setNote] = useState<Note | null>(null);
  const noted = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const base = useId();
  const line = useConnectLine(() => root.current?.closest('[data-home]') ?? null);

  const entries = useMemo(() => entriesFor(world, tab, nameOf), [world, tab, nameOf]);
  const byId = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);

  const say = (text: string): void => { noted.current += 1; setNote({ text, key: noted.current }); };
  const rowOf = (id: string): HTMLElement | null => root.current?.querySelector<HTMLElement>(`[data-add-id="${CSS.escape(id)}"]`) ?? null;
  const cardIn = (row: HTMLElement | null): Element | null => row?.querySelector('.kit-card') ?? null;

  /** Adds one skill, tool or note set to one agent, and tells the person. */
  const addTo = (entry: AddEntry, agent: AgentChoice, row: HTMLElement | null): void => {
    const result = stageAdd(state, agent.id, entry);
    if (result.status === 'refused') return;
    if (result.status === 'already') { say(alreadyOn(agent.name)); return; }
    const action = addAction(agent.id, entry);
    if (action === null) return;
    dispatch(action);
    say(addedTo(agent.name));
    line.show(cardIn(row), agent.id);
  };
  /** Copies one ready-made agent into the person's own agents. */
  const install = (entry: AddEntry, row: HTMLElement | null): void => {
    const result = stageInstall(state, entry);
    const action = installAction(world, entry);
    if (result.status !== 'added' || action === null) return;
    const made = newAgentId(world, result.state.draft);
    dispatch(action);
    say(agentAdded(entry.name));
    if (made !== null) line.show(cardIn(row), made);
  };

  const drag = useCardDrag({
    targetOf: dropAgentOf,
    onDrop: (id, agentId) => {
      const entry = byId.get(id);
      if (entry === undefined) return;
      const agent = agentChoices(world, entry, nameOf).find(c => c.id === agentId);
      if (agent !== undefined) addTo(entry, agent, rowOf(id));
    },
    onMiss: () => say(H.dropMiss),
  });

  // While a card is dragged, every agent card on the page is ready to take it, and the one under the pointer shows it.
  const over = drag.drag?.over ?? null, dragging = drag.drag !== null;
  // The label that follows the pointer is drawn in the page root: inside the drawer, the slide animation would make the drawer its containing block and the label would sit off by the drawer's own corner.
  const followerHost = dragging ? root.current?.closest('[data-home]') ?? null : null;
  useEffect(() => {
    if (!dragging) return undefined;
    const targets = [...document.querySelectorAll<HTMLElement>(`[${DROP_ATTRIBUTE}]`)];
    for (const el of targets) { el.setAttribute('data-drop-ready', ''); if (el.getAttribute(DROP_ATTRIBUTE) === over) el.setAttribute('data-drop-over', ''); }
    return () => { for (const el of targets) { el.removeAttribute('data-drop-ready'); el.removeAttribute('data-drop-over'); } };
  }, [dragging, over]);

  // Escape during a drag cancels the drag and nothing else: the drawer's own Escape must not see it, so it is marked handled before it gets there.
  useEffect(() => {
    if (!dragging) return undefined;
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') e.preventDefault(); };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [dragging]);

  const choose = (next: AddTab): void => { setTab(next); setOpenId(null); setNote(null); };
  const tabKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const next = nextTab(tab, e.key);
    if (next === null) return;
    e.preventDefault();
    choose(next);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`#${CSS.escape(`${base}-tab-${next}`)}`)?.focus());
  };

  const expanded = more.has(tab), shown = visibleCount(entries.length, expanded, SHELF_LIMIT);
  const toggleMore = (): void => setMore(prev => { const next = new Set(prev); if (next.has(tab)) next.delete(tab); else next.add(tab); return next; });

  return (
    <div className="add-body" ref={root}>
      <div className="add-tabs" role="tablist" aria-label={L.tabs} onKeyDown={tabKey}>
        {ADD_TABS.map(t => (
          <button key={t} type="button" role="tab" className="add-tab" id={`${base}-tab-${t}`} aria-selected={t === tab} aria-controls={`${base}-panel`} tabIndex={t === tab ? 0 : -1} onClick={() => choose(t)}>{TAB_LABEL[t]}</button>
        ))}
      </div>
      <div className="add-panel" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${tab}`} data-tab={tab}>
        {tab === 'file' ? <FileTab world={world} nameOf={nameOf} stageFile={stageFile} {...(sampleFile === undefined ? {} : { sampleFile })} /> : (
          <>
            <p className="kit-hint">{tab === 'agents' ? H.agentsTip : H.dragTip}</p>
            {entries.length === 0 ? <p className="kit-hint">{H.nothingHere}</p> : (
              <ul className="add-list">
                {entries.slice(0, shown).map(entry => (
                  <AddRow key={entry.id} entry={entry} choices={entry.kind === 'agent' ? [] : agentChoices(world, entry, nameOf)} open={openId === entry.id}
                    onToggle={() => setOpenId(current => (current === entry.id ? null : entry.id))}
                    onPick={(choice, row) => { setOpenId(null); addTo(entry, choice, row); }}
                    onInstall={row => install(entry, row)}
                    suppressClick={drag.suppressClick}
                    {...(entry.kind === 'agent' ? {} : { onDragStart: (e: Parameters<typeof drag.start>[0]) => drag.start(e, entry.id, entry.name) })}
                    {...(onOpenCopies === undefined ? {} : { onBadgePress: () => onOpenCopies(entry.id) })} />
                ))}
              </ul>
            )}
            {entries.length > SHELF_LIMIT ? <Button aria-expanded={expanded} onClick={toggleMore}>{expanded ? L.showLess : L.showMore}</Button> : null}
          </>
        )}
      </div>
      <div className="add-note" role="status" aria-live="polite" data-note={note === null ? undefined : ''}>{note === null ? null : <span key={note.key}>{note.text}</span>}</div>
      {followerHost === null ? null : createPortal(<DragFollower drag={drag.drag} followRef={drag.followRef} />, followerHost)}
      {line.view}
    </div>
  );
}
