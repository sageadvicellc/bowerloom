/**
 * The skills manager (spec section 7, screen 3): every skill as a card, grouped as Yours, From libraries and Found in several tools, with search,
 * a harness filter, an interface filter, install by menu or by drag, a panel to add skills, and hide or keep in a project. Every change goes
 * through the store and stays in memory; the changes wait on this screen and are applied on the Harness screen.
 *
 * `SkillsScreen` draws the title and the number of skills when there is no session above it (the shell test renders every screen with only a world).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { keepBothOutcome, keepOneOutcome, overrideOutcome } from '../../shared/proto/editor-actions.js';
import type { EditorOutcome } from '../../shared/proto/editor-actions.js';
import type { FolderCandidate } from '../../shared/proto/library-catalog.js';
import {
  contextFor, folderNote, installOutcome, installTargets, libraryOffers, scopeLabel, waitingSentence, waitingView, countWord,
} from '../../shared/proto/library-install.js';
import { planProjection } from '../../shared/proto/plan.js';
import { describePlacement, EVERY_HARNESS, groupSkills, INTERFACE_CHIPS, skillRows, skillsSummary, useIndex } from '../../shared/proto/skills-logic.js';
import type { SkillRow } from '../../shared/proto/skills-logic.js';
import { isDirty } from '../../shared/proto/store.js';
import type { InterfaceId, Plan } from '../../shared/proto/types.js';
import { ConflictDialog } from './harness-parts.js';
import { useOptionalProtoStore } from './harness-session.js';
import { doneNote, notedNote, refusedNote, usePointerDrag, WaitingPanel } from './library-parts.js';
import type { Note } from './library-parts.js';
import type { ProtoSession } from './session.js';
import { AddSkillsPanel, LibrarySection, SkillCard } from './skills-parts.js';
import type { CardHandlers } from './skills-parts.js';
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';

/** The screen. With a session it is the manager; without one it is the title and the number of skills. */
export function SkillsScreen({ world }: ScreenProps): ReactElement {
  const session = useOptionalProtoStore();
  if (session === null) {
    return (
      <div className="page">
        <h1 tabIndex={-1}>{ROUTE_LABELS.skills}</h1>
        <p className="muted">{countLine('skills', world)}</p>
      </div>
    );
  }
  return <SkillsManager session={session} />;
}

interface Shown { readonly note: Note; readonly waits: boolean }

function SkillsManager({ session }: { session: ProtoSession }): ReactElement {
  const { state, dispatch } = session;
  const world = state.draft, dirty = isDirty(state);
  const [scopeId, setScopeId] = useState(() => world.scopes.find(s => s.kind === 'global')?.id ?? world.scopes[0]?.id ?? EVERY_HARNESS);
  const [query, setQuery] = useState('');
  const [face, setFace] = useState<InterfaceId | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [openLibs, setOpenLibs] = useState<readonly string[]>([]);
  const [panel, setPanel] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [shown, setShown] = useState<Shown | null>(null);
  const [conflictFor, setConflictFor] = useState<string | null>(null);
  const [settle, setSettle] = useState<{ scopeId: string; n: number } | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null), conflictHeading = useRef<HTMLHeadingElement>(null);

  const rows = useMemo(() => skillRows(world, scopeId), [world, scopeId]);
  const groups = useMemo(() => groupSkills(world, rows, { query, interfaceId: face }), [world, rows, query, face]);
  const index = useMemo(() => useIndex(world), [world]);
  const offers = useMemo(() => libraryOffers(world), [world]);
  const plan = useMemo<Plan>(() => (dirty ? planProjection(state.committed, state.draft) : { changes: [] }), [dirty, state.committed, state.draft]);
  const scope = world.scopes.find(s => s.id === scopeId);
  const inProject = scope?.kind === 'project';

  // The first skill that was not there before an install is the copy: it settles in when it shows.
  useEffect(() => {
    if (known.current === null) return;
    const fresh = world.items.find(i => i.kind === 'skill' && !known.current!.has(i.id));
    known.current = null;
    setNewId(fresh?.id ?? null);
  }, [world.items]);
  useEffect(() => { if (panel) panelHeading.current?.focus(); }, [panel]);

  const say = (note: Note, waits = false): void => setShown({ note, waits });
  const run = (o: EditorOutcome, onDone?: () => void): void => {
    if (o.kind === 'action') {
      if (o.action.type === 'installItem') known.current = new Set(world.items.map(i => i.id));
      dispatch(o.action); say(doneNote(o.message), true); onDone?.();
    } else if (o.kind === 'refused') say(refusedNote(o.message));
  };

  const install = (itemId: string, target: string): void => {
    run(installOutcome(world, itemId, target), () => setSettle(prev => ({ scopeId: target, n: (prev?.n ?? 0) + 1 })));
  };
  const pointer = usePointerDrag({
    targetOf: el => { const id = el.closest<HTMLElement>('[data-scope]')?.dataset.scope; return id === undefined || id === EVERY_HARNESS ? null : id; },
    onDrop: (itemId, target) => install(itemId, target),
  });
  const dragging = pointer.drag?.id ?? null, over = pointer.drag?.over ?? null;
  const handlers: CardHandlers = {
    entries: itemId => installTargets(world, itemId).map(t => ({ id: t.scopeId, label: t.label, disabled: t.disabled, ...(t.disabled ? { note: 'Already there' } : {}) })),
    onInstall: install,
    onProjectChoice: (itemId, keep) => run(overrideOutcome(contextFor(world, scopeId), itemId, keep ? 'inherit' : 'hide')),
    onResolve: setConflictFor,
    onPointerDown: (itemId, name, e) => pointer.start(e, itemId, name),
  };

  const addLibrary = (libraryId: string): void => {
    const offer = offers.find(o => o.id === libraryId);
    if (offer === undefined || offer.state === 'installed') { say(refusedNote(`${offer?.name ?? 'That library'} is already added.`)); return; }
    dispatch({ type: 'addLibrary', libraryId });
    setOpenLibs(prev => (prev.includes(libraryId) ? prev : [...prev, libraryId]));
    say(doneNote(`${offer.name} is added: ${countWord(offer.skillCount, 'skill')} and ${countWord(offer.agentCount, 'agent')}. They are read only references.`), true);
  };
  const addFromFolder = (folder: FolderCandidate): void => {
    const n = folder.skills.filter(s => ticked.has(s.id)).length;
    if (n > 0) say(notedNote(folderNote(folder.name, n)));
  };
  const tick = (skillId: string, on: boolean): void => setTicked(prev => { const next = new Set(prev); if (on) next.add(skillId); else next.delete(skillId); return next; });

  const goToConflicts = (): void => { conflictHeading.current?.focus(); conflictHeading.current?.scrollIntoView({ block: 'start' }); };
  const conflictItem = conflictFor === null ? undefined : world.items.find(i => i.id === conflictFor);
  const searching = query.trim() !== '' || face !== null;

  const cards = (list: readonly SkillRow[], level: 3 | 4): ReactElement => (
    <div className={`lib-cards${view === 'list' ? ' is-list' : ''}`}>
      {list.map(r => <SkillCard key={r.item.id} row={r} placement={describePlacement(world, r.item, index)} level={level} inProject={inProject} isNew={r.item.id === newId} lifted={r.item.id === dragging} handlers={handlers} />)}
    </div>
  );
  const chips = [{ id: EVERY_HARNESS, name: 'Every harness', suffix: '' }, ...world.scopes.map(s => ({ id: s.id, name: s.name, suffix: ` (${s.kind === 'global' ? 'global' : 'project'})` }))];

  return (
    <div className={`page wide lib-page${dragging === null ? '' : ' is-dragging'}`}>
      <div className="lib-head">
        <h1 tabIndex={-1}>{ROUTE_LABELS.skills}</h1>
        <p className="muted">{skillsSummary(groups)} in {scope === undefined ? 'every harness' : scopeLabel(scope)}</p>
      </div>
      <p className="lib-lead">A skill is a reusable set of instructions for one kind of task. Install a skill to a harness, which is a place that holds skills, agents and tools, so your agents can use it. To install, drag a card onto a harness at the top of the screen, or choose Install to on the card.</p>

      <div className="lib-toolbar">
        <label className="lib-field lib-search"><span>Search skills</span>
          <input type="search" value={query} placeholder="Name or description" onChange={e => setQuery(e.target.value)} />
        </label>
        <div className="lib-field"><span id="lib-face-label">Found in</span>
          <div className="lib-chips" role="group" aria-labelledby="lib-face-label">
            {INTERFACE_CHIPS.map(c => <button key={c.id} type="button" className="lib-chip" aria-pressed={face === c.id} onClick={() => setFace(prev => (prev === c.id ? null : c.id))}>{c.name}</button>)}
          </div>
        </div>
        <div className="lib-field"><span id="lib-view-label">View</span>
          <div className="lib-chips" role="group" aria-labelledby="lib-view-label">
            {(['grid', 'list'] as const).map(v => <button key={v} type="button" className="lib-chip" aria-pressed={view === v} onClick={() => setView(v)}>{v === 'grid' ? 'Cards' : 'List'}</button>)}
          </div>
        </div>
        <button type="button" className="btn" aria-expanded={panel} aria-controls="lib-add-panel" onClick={() => setPanel(p => !p)}>Add skills</button>
      </div>

      <div className="lib-scopes">
        <span className="lib-scopes-label" id="lib-scopes-label">Harness</span>
        <div className="lib-chips" role="group" aria-labelledby="lib-scopes-label">
          {chips.map(c => {
            const target = c.id !== EVERY_HARNESS;
            const cls = `lib-chip lib-scopechip${dragging !== null && target ? ' is-target' : ''}${over === c.id ? ' is-over' : ''}${settle?.scopeId === c.id ? ` is-settle-${settle.n % 2 === 0 ? 'a' : 'b'}` : ''}`;
            return (
              <button key={c.id} type="button" className={cls} aria-pressed={scopeId === c.id} data-scope={c.id}
                onClick={() => setScopeId(c.id)}>
                {c.name}{c.suffix === '' ? null : <span className={c.suffix === ' (project)' ? 'lib-kind-suffix' : undefined}>{c.suffix}</span>}{dragging !== null && over === c.id ? <span className="lib-drophint"> Drop to install</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {panel ? <AddSkillsPanel offers={offers} ticked={ticked} onTick={tick} onFolder={addFromFolder} onAddLibrary={addLibrary} headingRef={panelHeading} /> : null}

      {groups.conflicts.length > 0 ? (
        <p className="lib-banner" role="note">
          <span>{countWord(groups.conflicts.length, 'skill')} found in several tools with different text. Read the copies and keep one.</span>
          <button type="button" className="btn secondary" onClick={goToConflicts}>Go to {groups.conflicts.length === 1 ? 'it' : 'them'}</button>
        </p>
      ) : null}

      <section className="lib-section" aria-labelledby="lib-yours">
        <h2 id="lib-yours">Yours <span className="lib-count">{countWord(groups.yours.length, 'skill')}</span></h2>
        {groups.yours.length === 0 ? <p className="muted">{searching ? 'No skill of yours matches the search.' : 'You have no skills in this harness yet.'}</p> : cards(groups.yours, 3)}
      </section>

      <section className="lib-section" aria-labelledby="lib-libraries">
        <h2 id="lib-libraries">From libraries <span className="lib-count">{countWord(groups.libraries.length, 'library', 'libraries')}</span></h2>
        {groups.libraries.length === 0 ? <p className="muted">No library is added yet. Use Add skills to add one.</p> : groups.libraries.map(g => (
          <LibrarySection key={g.library.id} group={g} open={openLibs.includes(g.library.id)} onToggle={() => setOpenLibs(prev => (prev.includes(g.library.id) ? prev.filter(x => x !== g.library.id) : [...prev, g.library.id]))}
            matchNote={searching && g.skillCount > 0 ? `${g.rows.length} match` : null}>
            {g.rows.length === 0 ? <p className="muted">No skill of this library matches the search.</p> : cards(g.rows, 4)}
          </LibrarySection>
        ))}
      </section>

      <section className="lib-section" aria-labelledby="lib-conflicts">
        <h2 id="lib-conflicts" ref={conflictHeading} tabIndex={-1}>Found in several tools <span className="lib-count">{countWord(groups.conflicts.length, 'skill')}</span></h2>
        <p className="small muted">These skills have different text in different interfaces. Read the copies side by side, then keep one or keep both.</p>
        {groups.conflicts.length === 0 ? <p className="muted">{searching ? 'No such skill matches the search.' : 'Nothing is found in several tools with different text.'}</p> : cards(groups.conflicts, 3)}
      </section>

      <WaitingPanel view={waitingView(dirty, plan)} note={shown === null ? null : { ...shown.note, text: shown.waits ? `${shown.note.text} ${waitingSentence(dirty, plan.changes.length)}` : shown.note.text }} />
      {pointer.ghost}

      {conflictItem === undefined ? null : (
        <ConflictDialog
          world={world} item={conflictItem} onClose={() => setConflictFor(null)} fallbackFocus={() => document.querySelector<HTMLElement>('.lib-page h1')}
          onKeepOne={i => { const o = keepOneOutcome(conflictItem, i); setConflictFor(null); run(o); }}
          onKeepBoth={names => { const o = keepBothOutcome(world, conflictItem, names); if (o.kind === 'action') setConflictFor(null); run(o); }}
        />
      )}
    </div>
  );
}
