/**
 * The parts of the agents manager: the list of agents, and the detail of the selected one (its definition, its skills in order, its tools, its slice,
 * its extras, and where it lands in each interface). They draw what the logic gives them and report what the person did as outcomes, which the
 * screen sends to the store. A library agent is shown read only: its controls stay on the page, and using one says why nothing changed.
 */
import { useId, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import {
  assignSliceOutcome, attachableSkills, attachableSlices, attachableTools, attachSkillOutcome, attachToolChoice, changeAccessOutcome, describeAgent, detachSkillOutcome,
  detachToolOutcome, moveSkillOutcome, whereItLands,
} from '../../shared/proto/agents-logic.js';
import type { AgentList } from '../../shared/proto/agents-logic.js';
import { ACCESS_WORDS } from '../../shared/proto/harnessmodel.js';
import type { EditorOutcome } from '../../shared/proto/editor-actions.js';
import { scopeLabel } from '../../shared/proto/library-install.js';
import type { AccessClass, AgentItem, World } from '../../shared/proto/types.js';
import { Combobox, usePointerDrag } from './library-parts.js';

const ACCESS_CLASSES = Object.keys(ACCESS_WORDS) as AccessClass[];

// ------------------------------------------------------------------------------------------------------------- list

/** One list of agents, a page of rows at a time. */
export function AgentListSection({ list, rows, left, moreText, selectedId, onSelect, onMore, onKeyRow, query }: {
  list: AgentList; rows: readonly AgentItem[]; left: number; moreText: string; selectedId: string | null; onSelect(id: string): void; onMore(): void;
  onKeyRow(e: KeyboardEvent<HTMLUListElement>): void; query: string;
}): ReactElement {
  const headingId = useId();
  const matching = list.matching.length;
  return (
    <section className="agents-group" aria-labelledby={headingId}>
      <h2 id={headingId}>{list.title} <span className="lib-count">{list.library === null ? `${list.all} ${list.all === 1 ? 'agent' : 'agents'}` : `${list.all} agents`}</span></h2>
      {list.library === null ? null : (
        <p className="lib-group-meta">
          <span>Version {list.library.installedVersion}. Read only.</span>
          {list.library.newerVersion === undefined ? null : <span className="chip good">New version waiting: {list.library.newerVersion}</span>}
        </p>
      )}
      {query.trim() === '' ? null : <p className="small muted">{matching} of {list.all} match</p>}
      {rows.length === 0 ? <p className="muted">{list.all === 0 ? 'No agents here.' : 'No agent matches the search.'}</p> : (
        <ul className="agents-rows" onKeyDown={onKeyRow}>
          {rows.map(a => (
            <li key={a.id}>
              <button type="button" className="agents-row" aria-current={a.id === selectedId ? 'true' : undefined} onClick={() => onSelect(a.id)}>
                <span className="agents-row-name">{a.name}</span>
                <span className="agents-row-role">{a.definition.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {left > 0 ? (
        <div className="agents-more">
          <button type="button" className="btn secondary" aria-label={`${moreText} in ${list.title}`} onClick={onMore}>{moreText}</button>
          <p className="small muted">Showing {rows.length} of {matching}</p>
        </div>
      ) : (matching > 50 ? <p className="small muted">Showing all {matching}</p> : null)}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------------------- detail

/** The detail of one agent. `go` receives each outcome; `copyTo` and `onCopyTo` are the harness the copy of a library agent goes to. */
export function AgentDetail({ committed, world, agent, go, copyTo, onCopyTo, onMake, moved }: {
  committed: World; world: World; agent: AgentItem; go(o: EditorOutcome): void; copyTo: string; onCopyTo(scopeId: string): void; onMake(): void; moved: { id: string; n: number } | null;
}): ReactElement {
  const view = describeAgent(world, agent);
  const readOnly = view.refusal !== null;
  const [toolId, setToolId] = useState(''), [access, setAccess] = useState<AccessClass>('read-only');
  const skillOptions = attachableSkills(world, agent).map(s => ({ id: s.id, label: s.name, hint: s.description }));
  const tools = attachableTools(world, agent);
  const slices = attachableSlices(world, agent);
  const landing = whereItLands(committed, world, agent);
  const ids = { skills: useId(), tools: useId(), slice: useId(), extras: useId(), lands: useId(), instr: useId() };
  const blocked = (): void => go({ kind: 'refused', message: view.refusal ?? 'This agent cannot be changed.' });
  const currentSlice = view.sliceItemId ?? '';
  const sliceChoices = currentSlice !== '' && !slices.some(s => s.id === currentSlice) && view.slice !== null ? [...slices, { id: currentSlice, name: view.slice, sliceId: '' }] : slices;
  const attachedTool = tools.find(t => t.id === toolId) ?? tools[0];

  const pointer = usePointerDrag({
    targetOf: el => el.closest<HTMLElement>('li.agents-skill')?.dataset.position ?? null,
    onDrop: (skillId, position) => go(moveSkillOutcome(world, agent, skillId, Number(position))),
    onMiss: () => go({ kind: 'refused', message: 'Drop the skill on another skill in the list, or use Move up and Move down.' }),
  });
  const dragId = pointer.drag?.id ?? null, overPosition = pointer.drag?.over ?? null;

  return (
    <article className={`agents-detail${dragId === null ? '' : ' is-dragging'}`} aria-labelledby={`${ids.instr}-name`}>
      <header className="agents-detail-head">
        <h2 id={`${ids.instr}-name`} tabIndex={-1}>{view.name}</h2>
        <p className="agents-origin"><span className={`chip ${readOnly ? 'quiet' : 'good'}`}>{readOnly ? 'Library' : 'Yours'}</span> <span className="muted">{view.origin}</span></p>
        <p className="agents-role">{view.role}</p>
      </header>

      {readOnly ? (
        <section className="agents-readonly" aria-label="Read only">
          <p><strong>Read-only: it comes from {view.libraryName}.</strong> You can read it here. To change it, make your own copy first.</p>
          {view.newerVersion === null ? null : <p className="small"><span className="chip good">New version waiting: {view.newerVersion}</span></p>}
          <div className="agents-copy">
            <label className="lib-field"><span>Copy into</span>
              <select value={copyTo} onChange={e => onCopyTo(e.target.value)}>
                {world.scopes.map(s => <option key={s.id} value={s.id}>{scopeLabel(s)}</option>)}
              </select>
            </label>
            <button type="button" className="btn" onClick={onMake}>Make my own copy</button>
          </div>
        </section>
      ) : null}

      <section aria-labelledby={ids.instr}>
        <h3 id={ids.instr}>Instructions</h3>
        <pre className="file agents-instructions" tabIndex={0} aria-label="Instructions, read only">{view.instructions}</pre>
      </section>

      <section aria-labelledby={ids.skills}>
        <h3 id={ids.skills}>Skills, in order</h3>
        {view.skills.length === 0 ? <p className="muted">This agent uses no skills yet.</p> : (
          <ol className="agents-skills">
            {view.skills.map(s => (
              <li key={s.id} data-position={s.position} className={`agents-skill${overPosition === String(s.position) && dragId !== s.id ? ' is-over' : ''}${dragId === s.id ? ' is-lifted' : ''}${moved?.id === s.id ? ` is-moved-${moved.n % 2 === 0 ? 'a' : 'b'}` : ''}`}>
                <span className="agents-handle" aria-hidden="true" onPointerDown={e => { if (readOnly) { blocked(); return; } pointer.start(e, s.id, s.name); }}><svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" focusable="false"><circle cx="4" cy="4" r="1.5" /><circle cx="10" cy="4" r="1.5" /><circle cx="4" cy="9" r="1.5" /><circle cx="10" cy="9" r="1.5" /><circle cx="4" cy="14" r="1.5" /><circle cx="10" cy="14" r="1.5" /></svg></span>
                <span className="agents-skill-name">{s.name}{s.missing ? <span className="chip bad"> Missing</span> : null}<span className="sr">, place {s.position + 1} of {s.count}</span></span>
                <span className="agents-skill-actions">
                  <button type="button" className="btn secondary" aria-label={`Move up: ${s.name}`} aria-disabled={readOnly || s.position === 0 ? true : undefined} onClick={() => go(moveSkillOutcome(world, agent, s.id, s.position - 1))}>Move up</button>
                  <button type="button" className="btn secondary" aria-label={`Move down: ${s.name}`} aria-disabled={readOnly || s.position === s.count - 1 ? true : undefined} onClick={() => go(moveSkillOutcome(world, agent, s.id, s.position + 1))}>Move down</button>
                  <button type="button" className="btn secondary" aria-label={`Detach: ${s.name}`} aria-disabled={readOnly ? true : undefined} onClick={() => go(detachSkillOutcome(world, agent, s.id))}>Detach</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {readOnly ? <button type="button" className="btn secondary is-off" aria-disabled="true" onClick={blocked}>Attach a skill</button>
          : <Combobox label="Attach a skill" placeholder="Type a skill name" options={skillOptions} onPick={id => go(attachSkillOutcome(world, agent, id))} emptyText="Every skill you can reach is already attached." />}
        {view.skills.length > 1 ? <p className="small muted">Drag a skill by its handle, or use Move up and Move down.</p> : null}
      </section>

      <section aria-labelledby={ids.tools}>
        <h3 id={ids.tools}>Tools</h3>
        {view.tools.length === 0 ? <p className="muted">This agent has no tools yet.</p> : (
          <ul className="agents-tools">
            {view.tools.map(t => (
              <li key={t.id}>
                <span className="agents-tool-name">{t.name} <span className="chip quiet">{t.kind}</span></span>
                <label className="lib-field inline"><span>Access</span>
                  <select aria-label={`Access for ${t.name}`} value={t.access} aria-disabled={readOnly ? true : undefined} onChange={e => { if (readOnly) { blocked(); return; } go(changeAccessOutcome(world, agent, t.id, e.target.value as AccessClass)); }}>
                    {ACCESS_CLASSES.map(c => <option key={c} value={c}>{ACCESS_WORDS[c]}</option>)}
                  </select>
                </label>
                <button type="button" className="btn secondary" aria-label={`Detach: ${t.name}`} aria-disabled={readOnly ? true : undefined} onClick={() => go(detachToolOutcome(world, agent, t.id))}>Detach</button>
              </li>
            ))}
          </ul>
        )}
        {readOnly ? <button type="button" className="btn secondary is-off" aria-disabled="true" onClick={blocked}>Attach a tool</button> : tools.length === 0 ? <p className="small muted">There is no other tool to attach. A hook is never attached.</p> : (
          <div className="agents-attach">
            <label className="lib-field"><span>Tool to attach</span>
              <select value={attachedTool?.id ?? ''} onChange={e => setToolId(e.target.value)}>{tools.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            </label>
            <label className="lib-field"><span>Access</span>
              <select value={access} onChange={e => setAccess(e.target.value as AccessClass)}>{ACCESS_CLASSES.map(c => <option key={c} value={c}>{ACCESS_WORDS[c]}</option>)}</select>
            </label>
            <button type="button" className="btn secondary" onClick={() => { if (attachedTool !== undefined) go(attachToolChoice(world, agent, attachedTool.id, access)); }}>Attach tool</button>
          </div>
        )}
      </section>

      <section aria-labelledby={ids.slice}>
        <h3 id={ids.slice}>Knowledge slice</h3>
        <label className="lib-field"><span>Slice this agent reads</span>
          <select value={currentSlice} aria-disabled={readOnly ? true : undefined} onChange={e => { if (readOnly) { blocked(); return; } go(assignSliceOutcome(world, agent, e.target.value === '' ? null : e.target.value)); }}>
            <option value="">None</option>
            {sliceChoices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </section>

      <section aria-labelledby={ids.extras}>
        <h3 id={ids.extras}>Only in some interfaces</h3>
        <p className="small muted">{view.extrasNote}</p>
        {view.extras.length === 0 ? null : (
          <ul className="agents-extras">
            {view.extras.map(x => <li key={`${x.badge}${x.key}`}><span className="chip warn">{x.badge}</span> <span>{x.key}: {x.value}</span></li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby={ids.lands}>
        <h3 id={ids.lands}>Where it lands</h3>
        <ul className="agents-landing">
          {landing.map(l => (
            <li key={l.interface}>
              <h4>{l.name}</h4>
              <p>{l.status}</p>
              {l.files.length === 0 ? null : (
                <details>
                  <summary>See what would be written</summary>
                  <ul>
                    {l.files.map(f => (
                      <li key={f.path}>
                        <span className={`chip ${f.waiting === null ? 'quiet' : 'warn'}`}>{f.waiting === null ? 'Up to date' : f.waiting === 'add' ? 'Add' : f.waiting === 'change' ? 'Change' : 'Remove'}</span>{' '}<span className="tech">{f.path}</span>
                        <pre className="file">{f.preview}</pre>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
      {pointer.ghost}
    </article>
  );
}
