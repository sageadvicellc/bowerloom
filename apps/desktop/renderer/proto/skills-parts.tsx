/**
 * The parts of the skills manager: one skill card, one library section, and the "Add skills" panel. They draw what the logic gives them and report
 * what the person did through callbacks; the screen sends the change to the store.
 */
import { useId } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement, RefObject } from 'react';
import { FOLDER_CANDIDATES } from '../../shared/proto/library-catalog.js';
import type { FolderCandidate } from '../../shared/proto/library-catalog.js';
import { LIBRARY_STAYS_REFERENCE } from '../../shared/proto/library-install.js';
import type { LibraryOffer } from '../../shared/proto/library-install.js';
import { stateWords } from '../../shared/proto/skills-logic.js';
import type { LibraryGroup, Placement, SkillRow } from '../../shared/proto/skills-logic.js';
import { HarnessIcon } from './icons.js';
import { MenuButton } from './library-parts.js';
import type { MenuEntry } from './library-parts.js';

// ------------------------------------------------------------------------------------------------------------- one card

/** What a card can do. The screen decides what each one means. */
export interface CardHandlers {
  entries(itemId: string): readonly MenuEntry[];
  onInstall(itemId: string, scopeId: string): void;
  onProjectChoice(itemId: string, keep: boolean): void;
  onResolve(itemId: string): void;
  onPointerDown(itemId: string, name: string, e: ReactPointerEvent<HTMLElement>): void;
}

/** One skill as a card. In a project it can be hidden there or kept from the global harness. A library skill installs as a copy. */
export function SkillCard({ row, placement, level, inProject, isNew, lifted, handlers }: {
  row: SkillRow; placement: Placement; level: 3 | 4; inProject: boolean; isNew: boolean; lifted: boolean; handlers: CardHandlers;
}): ReactElement {
  const { item } = row, id = useId();
  const Heading = level === 3 ? 'h3' : 'h4';
  const state = stateWords(row), fromLibrary = item.library !== null;
  const newer = item.library?.newerVersion;
  const canChoose = inProject && (row.state === 'inherited' || row.state === 'hidden' || row.state === 'replaced');
  return (
    <article className={`lib-card${isNew ? ' is-new' : ''}${row.state === 'hidden' ? ' is-hidden' : ''}${lifted ? ' is-lifted' : ''}`} aria-labelledby={id} onPointerDown={e => handlers.onPointerDown(item.id, item.name, e)} data-item={item.id}>
      <header className="lib-card-head">
        <span className="lib-kind"><HarnessIcon name={fromLibrary ? 'group' : 'skill'} size={16} /></span>
        <Heading id={id}>{item.name}</Heading>
      </header>
      <ul className="lib-flags" aria-label="States">
        {state === null ? null : <li className="chip quiet">{state}</li>}
        {fromLibrary ? <li className="chip quiet">Read only</li> : null}
        {newer === undefined ? null : <li className="chip good">New version waiting: {newer}</li>}
        {row.conflict ? <li className="chip warn">Found in several tools</li> : null}
      </ul>
      <p className="lib-desc">{item.description}</p>
      <dl className="lib-facts">
        <div><dt>Installed in</dt><dd>{placement.installed}{placement.notes.length === 0 ? '' : `. ${placement.notes.join(' ')}`}</dd></div>
        <div><dt>Found in</dt><dd>{placement.found}</dd></div>
        <div><dt>Written to</dt><dd>{placement.written}</dd></div>
      </dl>
      <div className="lib-card-actions">
        <MenuButton label="Install to" menuLabel={fromLibrary ? `Install an editable copy of ${item.name} to` : `Install ${item.name} to`} entries={() => handlers.entries(item.id)} onPick={scopeId => handlers.onInstall(item.id, scopeId)} />
        {canChoose ? (
          <button type="button" className="btn secondary" aria-label={`${row.state === 'inherited' ? 'Hide in this project' : 'Keep from global'}: ${item.name}`} onClick={() => handlers.onProjectChoice(item.id, row.state !== 'inherited')}>
            {row.state === 'inherited' ? 'Hide in this project' : 'Keep from global'}
          </button>
        ) : null}
        {row.conflict ? <button type="button" className="btn secondary" aria-label={`Resolve the conflict: ${item.name}`} onClick={() => handlers.onResolve(item.id)}>Resolve the conflict</button> : null}
      </div>
    </article>
  );
}

// ------------------------------------------------------------------------------------------------------------- one library

/** One installed library: its name, its version, a notice when a new version waits, and its skills when it is open. A library with no skills has nothing to open. */
export function LibrarySection({ group, open, onToggle, matchNote, children }: {
  group: LibraryGroup; open: boolean; onToggle(): void; matchNote: string | null; children: ReactElement | null;
}): ReactElement {
  const bodyId = useId();
  const { library } = group;
  const heading = (
    <>
      <HarnessIcon name="group" size={18} />
      <span className="lib-group-name">{library.name}</span>
      <span className="muted">{group.skillCount === 1 ? '1 skill' : `${group.skillCount} skills`}{matchNote === null ? '' : `, ${matchNote}`}</span>
    </>
  );
  return (
    <div className="lib-group">
      <h3>
        {group.skillCount === 0 ? <span className="lib-group-toggle is-plain">{heading}</span> : (
          <button type="button" className="lib-group-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
            <svg className={`lib-chevron${open ? ' is-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" /></svg>
            {heading}
          </button>
        )}
      </h3>
      <p className="lib-group-meta">
        <span>Pinned to version {group.pinnedVersion}. Read only.</span>
        {group.newerVersion === null ? null : <span className="chip good">New version waiting: {group.newerVersion}</span>}
        {group.skillCount === 0 ? <span>It holds {group.agentCount === 1 ? '1 agent' : `${group.agentCount} agents`} and no skills. See the Agents screen.</span> : null}
      </p>
      {open && group.skillCount > 0 ? <div id={bodyId}>{children}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------- add skills

/** The panel for new skills: a folder, or a library. It says in one sentence that a library stays a reference until an item is edited. */
export function AddSkillsPanel({ offers, ticked, onTick, onFolder, onAddLibrary, headingRef }: {
  offers: readonly LibraryOffer[]; ticked: ReadonlySet<string>; onTick(skillId: string, on: boolean): void; onFolder(folder: FolderCandidate): void; onAddLibrary(libraryId: string): void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}): ReactElement {
  const panelId = useId();
  return (
    <section className="lib-panel" id="lib-add-panel" aria-labelledby={panelId}>
      <h2 id={panelId} ref={headingRef} tabIndex={-1}>Add skills</h2>
      <div className="lib-panel-cols">
        <section aria-labelledby={`${panelId}-folder`} className="lib-source">
          <h3 id={`${panelId}-folder`}>From a folder</h3>
          <p className="small muted">Bowerloom found these folders. It reads a folder only after you approve it.</p>
          <ul className="lib-folders">
            {FOLDER_CANDIDATES.map(folder => {
              const count = folder.skills.filter(s => ticked.has(s.id)).length;
              return (
                <li key={folder.id}>
                  <fieldset className="lib-fieldset">
                    <legend>{folder.name}</legend>
                    <p className="tech">{folder.path}</p>
                    <ul>
                      {folder.skills.map(s => (
                        <li key={s.id}>
                          <label className="lib-tick"><input type="checkbox" checked={ticked.has(s.id)} onChange={e => onTick(s.id, e.target.checked)} />
                            <span><strong>{s.name}</strong> <span className="chip quiet">Found, not read yet</span><span className="lib-tickdesc small muted">{s.description}</span></span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="btn secondary" disabled={count === 0} aria-label={`${count === 0 ? 'Tick a skill to add it' : `Add the ${count === 1 ? 'ticked skill' : `${count} ticked skills`}`}: ${folder.name}`} onClick={() => onFolder(folder)}>
                      {count === 0 ? 'Tick a skill to add it' : `Add the ${count === 1 ? 'ticked skill' : `${count} ticked skills`}`}
                    </button>
                  </fieldset>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby={`${panelId}-library`} className="lib-source">
          <h3 id={`${panelId}-library`}>From a library</h3>
          <p className="small muted">{LIBRARY_STAYS_REFERENCE}</p>
          <ul className="lib-offers">
            {offers.map(o => (
              <li key={o.id} className="lib-offer">
                <div>
                  <p><strong>{o.name}</strong> <span className="muted small">version {o.version}</span></p>
                  <p className="small muted">{o.summary}</p>
                  {o.newerVersion === null ? null : <p className="small"><span className="chip good">New version waiting: {o.newerVersion}</span></p>}
                </div>
                {o.state === 'installed'
                  ? <span className="chip good">Installed</span>
                  : <button type="button" className="btn" aria-label={`Add this library: ${o.name}`} onClick={() => onAddLibrary(o.id)}>Add this library</button>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
