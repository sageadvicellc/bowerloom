/**
 * The agents manager (spec section 7, screen 4): owned agents first, then each library as a group with a search and 50 rows at a time. A selected
 * agent shows its neutral definition and where it lands in each interface. A person rearranges an agent they own: attach and detach skills, reorder
 * them, attach and detach tools, change a tool's access, and pick a slice. A library agent is read only until the person makes their own copy.
 * Every change goes through the store and stays in memory; the changes wait on this screen and are applied on the Harness screen.
 *
 * `AgentsScreen` draws the title and the number of agents when there is no session above it (the shell test renders every screen with only a world).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { agentLists, moreLabel, rowsLeft, visibleRows } from '../../shared/proto/agents-logic.js';
import type { EditorOutcome } from '../../shared/proto/editor-actions.js';
import { countWord, installOutcome, waitingSentence, waitingView } from '../../shared/proto/library-install.js';
import { editsOf } from '../../shared/proto/editor-describe.js';
import { planProjection } from '../../shared/proto/plan.js';
import { isDirty } from '../../shared/proto/store.js';
import type { AgentItem, Plan } from '../../shared/proto/types.js';
import { AgentDetail, AgentListSection } from './agents-parts.js';
import { useOptionalProtoStore } from './harness-session.js';
import { doneNote, refusedNote, WaitingPanel } from './library-parts.js';
import type { Note } from './library-parts.js';
import type { ProtoSession } from './session.js';
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';

/** The screen. With a session it is the manager; without one it is the title and the number of agents. */
export function AgentsScreen({ world }: ScreenProps): ReactElement {
  const session = useOptionalProtoStore();
  if (session === null) {
    return (
      <div className="page">
        <h1 tabIndex={-1}>{ROUTE_LABELS.agents}</h1>
        <p className="muted">{countLine('agents', world)}</p>
      </div>
    );
  }
  return <AgentsManager session={session} />;
}

interface Shown { readonly note: Note; readonly waits: boolean }

function AgentsManager({ session }: { session: ProtoSession }): ReactElement {
  const { state, dispatch } = session;
  const world = state.draft, dirty = isDirty(state);
  const [query, setQuery] = useState('');
  const [limits, setLimits] = useState<Readonly<Record<string, number>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(() => agentLists(world, '')[0]?.matching[0]?.id ?? null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [copyTo, setCopyTo] = useState(() => world.scopes.find(s => s.kind === 'global')?.id ?? world.scopes[0]?.id ?? '');
  const [moved, setMoved] = useState<{ id: string; n: number } | null>(null);
  const known = useRef<Set<string> | null>(null);

  const agentGroups = useMemo(() => agentLists(world, query), [world, query]);
  const plan = useMemo<Plan>(() => (dirty ? planProjection(state.committed, state.draft) : { changes: [] }), [dirty, state.committed, state.draft]);
  const agent = world.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === selectedId);
  const total = agentGroups.reduce((n, l) => n + l.all, 0);

  // After a copy, the copy is the agent on show: it is the one agent that was not there before.
  useEffect(() => {
    if (known.current === null) return;
    const fresh = world.items.find(i => i.kind === 'agent' && !known.current!.has(i.id));
    known.current = null;
    if (fresh !== undefined) setSelectedId(fresh.id);
  }, [world.items]);

  const say = (note: Note, waits = false): void => setShown({ note, waits });
  const go = (o: EditorOutcome): void => {
    if (o.kind === 'action') {
      dispatch(o.action); say(doneNote(o.message), true);
      if (o.action.type === 'moveSkill') setMoved(prev => ({ id: o.action.type === 'moveSkill' ? o.action.skillId : '', n: (prev?.n ?? 0) + 1 }));
    } else if (o.kind === 'refused') say(refusedNote(o.message));
  };
  const makeCopy = (): void => {
    if (agent === undefined) return;
    const o = installOutcome(world, agent.id, copyTo);
    if (o.kind === 'action') known.current = new Set(world.items.map(i => i.id));
    go(o);
  };
  const onKeyRow = (e: KeyboardEvent<HTMLUListElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button.agents-row')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };

  const owned = agentGroups[0]?.all ?? 0;
  return (
    <div className="page wide lib-page agents-page">
      <div className="lib-head">
        <h1 tabIndex={-1}>{ROUTE_LABELS.agents}</h1>
        <p className="muted">{countWord(total, 'agent')}: {owned} yours, {total - owned} from libraries</p>
      </div>
      <p className="lib-lead">An agent is a named role with its own instructions, skills and tools. The same definition is written to every interface.</p>

      <div className="agents-body">
        <div className="agents-list">
          <label className="lib-field lib-search"><span>Search agents</span>
            <input type="search" value={query} placeholder="Name or role" onChange={e => { setQuery(e.target.value); setLimits({}); }} />
          </label>
          {agentGroups.map(list => {
            const shownCount = limits[list.id] ?? 50;
            return (
              <AgentListSection key={list.id} list={list} rows={visibleRows(list.matching, shownCount)} left={rowsLeft(list.matching, shownCount)} moreText={moreLabel(rowsLeft(list.matching, shownCount))}
                selectedId={selectedId} onSelect={id => { setSelectedId(id); setShown(null); }} onMore={() => setLimits(prev => ({ ...prev, [list.id]: Math.max(50, prev[list.id] ?? 50) + 50 }))} onKeyRow={onKeyRow} query={query} />
            );
          })}
        </div>
        <div className="agents-pane">
          {agent === undefined ? (
            <section className="agents-empty" aria-label="Agent details"><h2>Details</h2><p>Select an agent to read its definition.</p></section>
          ) : (
            <AgentDetail key={agent.id} committed={state.committed} world={world} agent={agent} go={go} copyTo={copyTo} onCopyTo={setCopyTo} onMake={makeCopy} moved={moved} />
          )}
        </div>
      </div>

      <WaitingPanel view={waitingView(dirty, plan)} note={shown === null ? null : { ...shown.note, text: shown.waits ? `${shown.note.text} ${waitingSentence(dirty, plan.changes.length, editsOf(plan))}` : shown.note.text }} />
    </div>
  );
}
