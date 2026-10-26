/**
 * The details panel: the right column of the home app. It shows, read only, what the current selection is. Four kinds can be selected, and each has its own
 * short blocks with a heading (the model is shared/home/details.ts; nothing here edits anything):
 *   an agent: where it works, and its Skills, Tools and Notes as cards, each with a quiet Remove, "Choose notes" on the notes;
 *   a skill: what it does, who uses it, where it works, where it came from, the badge of copies, the full text behind "Show the full text", and Remove;
 *   a tool: what it can reach, how far it can go, whether it needs a key, who uses it, and Remove (a key's value is never shown);
 *   a set of notes: what it covers, how many notes it can read, the first five titles, who uses it, "Choose notes", and Remove.
 * Nothing selected shows the agent shelves, empty, with "Pick an agent". Pressing a name under "Used by" selects that agent; "Back to agent" goes back to the
 * owner of the item. The heading is the panel's title and takes the focus when the panel needs a place for it to land.
 */
import { useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Fragment } from 'react';
import type { ShelfEntry } from '../../../shared/home/cards.js';
import { removeFromLabel } from '../../../shared/home/details.js';
import type { SkillTrust, ToolTrust } from '../../../shared/home/details-trust.js';
import type { AgentDetails, AgentRef, Details, NoteDetails, Selected, SkillDetails, ToolDetails } from '../../../shared/home/details.js';
import { Badge } from '../kit/Badge.js';
import { Button } from '../kit/Button.js';
import { Glyph } from '../kit/Glyph.js';
import { Shelf } from '../kit/Shelf.js';
import { NOTES_WORDS } from '../notes/notes-words.js';
import { NotesShelf } from '../notes/NotesShelf.js';
import type { Place } from '../../../shared/home/where-it-lives.js';
import { WORDS } from '../words.js';
import { WhereItLives } from './WhereItLives.js';
import './details.css';
import { IconButton } from '../kit/IconButton.js';
import { EditButton } from '../read-only.js';

const L = WORDS.label, H = WORDS.hint;

export interface DetailsPanelProps {
  /** What the panel shows. Null when nothing is selected or the selection is gone: it then shows the agent shelves, empty. */
  details: Details | null;
  onSelect(selected: Selected | null): void;
  /** Takes one item off an agent. */
  onRemove(agentId: string, entry: ShelfEntry): void;
  onBadgePress(itemId: string): void;
  onChoose(): void;
  /** The id of the card that was just added to this agent's shelves, if any, and the flip that makes it arrive again. */
  freshId?: string | null;
  freshPhase?: 0 | 1;
  freshNotes?: string | null;
  /** The kit gallery and the tests draw the full text open. */
  textOpen?: boolean;
  /** Who made the skill that is shown and which release it is (a skill from outside), and what the tool that is shown reaches. */
  skillTrust?: SkillTrust | null;
  toolTrust?: ToolTrust | null;
  /** Where the agent, skill or tool is kept in each program (sample paths), for "Show where it lives". */
  places?: readonly Place[];
}

/** A block with a small heading. */
function Block({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const id = useId();
  return <section className="dt-block" aria-labelledby={id}><h3 className="dt-sub" id={id}>{title}</h3>{children}</section>;
}

function Programs({ works }: { works: readonly string[] }): ReactElement {
  return works.length === 0 ? <p className="kit-hint">{H.noPrograms}</p> : <ul className="dt-chips" data-programs="">{works.map(name => <li key={name} className="dt-chip">{name}</li>)}</ul>;
}

/** The agents that hold an item. Each name is a button: it selects that agent. */
function UsedBy({ agents, onSelect }: { agents: readonly AgentRef[]; onSelect(selected: Selected): void }): ReactElement {
  return (
    <Block title={L.usedBy}>
      {agents.length === 0 ? <p className="kit-hint">{H.noUsers}</p> : (
        <ul className="dt-chips" data-used-by="">{agents.map(a => <li key={a.id}><button type="button" className="dt-agent" onClick={() => onSelect({ kind: 'agent', id: a.id })}>{a.name}</button></li>)}</ul>
      )}
    </Block>
  );
}

function Head({ kind, glyph, name, line }: { kind: string; glyph: 'agent' | 'skill' | 'tool' | 'note'; name: string; line: string }): ReactElement {
  return (
    <div className="hm-panel-head dt-head">
      <Glyph name={glyph} />
      <div className="dt-head-text">
        {kind === '' ? null : <p className="kit-hint dt-kind">{kind}</p>}
        <h2 className="kit-heading" id="hm-panel-title" tabIndex={-1}>{name}</h2>
        {line === '' ? null : <p className="kit-hint">{line}</p>}
      </div>
    </div>
  );
}

function Back({ owner, onSelect }: { owner: AgentRef | null; onSelect(selected: Selected): void }): ReactElement | null {
  return owner === null ? null : <div className="dt-back"><IconButton icon="back" label={L.backToAgent} side="right" data-back="" onClick={() => onSelect({ kind: 'agent', id: owner.id })} /></div>;
}

function Remove({ owner, entry, onRemove }: { owner: AgentRef | null; entry: ShelfEntry; onRemove(agentId: string, entry: ShelfEntry): void }): ReactElement | null {
  return owner === null ? null : <div className="dt-actions"><EditButton onClick={() => onRemove(owner.id, entry)}>{removeFromLabel(owner.name)}</EditButton></div>;
}

export function AgentBody({ details, onSelect, onRemove, onBadgePress, onChoose, freshId = null, freshPhase = 0, freshNotes = null, places = [] }: DetailsPanelProps & { details: AgentDetails | null }): ReactElement {
  const shelves = details?.shelves;
  const pick = (entry: ShelfEntry): void => { if (details !== null) onSelect({ kind: entry.kind, id: entry.id, ownerAgentId: details.id }); };
  const take = (entry: ShelfEntry): void => { if (details !== null) onRemove(details.id, entry); };
  return (
    <>
      <Head kind="" glyph="agent" name={details === null ? L.pickAnAgent : details.name} line={details === null ? H.panel : details.hint} />
      {details === null ? null : <Block title={L.whereItWorks}><Programs works={details.works} /></Block>}
      <Shelf title={L.skills} entries={shelves?.skills ?? []} selectedId={null} onSelect={id => { const e = shelves?.skills.find(x => x.id === id); if (e !== undefined) pick(e); }} onRemove={take} onBadgePress={entry => onBadgePress(entry.id)} freshId={freshId} freshPhase={freshPhase} emptyText={H.emptyShelf} />
      <Shelf title={L.tools} entries={shelves?.tools ?? []} selectedId={null} onSelect={id => { const e = shelves?.tools.find(x => x.id === id); if (e !== undefined) pick(e); }} onRemove={take} onBadgePress={entry => onBadgePress(entry.id)} freshId={freshId} freshPhase={freshPhase} emptyText={H.emptyShelf} hint={H.tools} />
      <NotesShelf entries={shelves?.notes ?? []} selectedId={null} onSelect={id => { const e = shelves?.notes.find(x => x.id === id); if (e !== undefined) pick(e); }} onRemove={take} freshId={freshNotes} freshPhase={freshPhase} canChoose={details !== null} onChoose={onChoose} />
      {/* Last, so the shelves (and the first Remove) are not pushed down by a stop of the keyboard that most people do not need. */}
      {details === null ? null : <WhereItLives key={details.id} places={places} />}
    </>
  );
}

function SkillBody({ details, onSelect, onRemove, onBadgePress, textOpen = false, skillTrust = null, places = [] }: DetailsPanelProps & { details: SkillDetails }): ReactElement {
  const [open, setOpen] = useState(textOpen);
  const textId = useId();
  return (
    <>
      <Back owner={details.owner} onSelect={onSelect} />
      <Head kind={L.kindSkill} glyph="skill" name={details.name} line="" />
      <Block title={L.whatItDoes}><p>{details.hint}</p></Block>
      <UsedBy agents={details.usedBy} onSelect={onSelect} />
      <Block title={L.whereItWorks}><Programs works={details.works} /><WhereItLives key={details.id} places={places} /></Block>
      <Block title={L.whereItCameFrom}>
        <p>{details.source}</p>
        {skillTrust === null ? null : (
          <dl className="dt-facts" data-origin="">
            <dt>{L.madeBy}</dt><dd data-field="author" data-budget="content">{skillTrust.madeBy}</dd>
            {skillTrust.release === null ? null : <><dt>{L.release}</dt><dd data-field="release" data-budget="content">{skillTrust.release}</dd></>}
          </dl>
        )}
      </Block>
      {details.badge === null ? null : <div className="dt-badge"><Badge badge={details.badge} onPress={() => onBadgePress(details.id)} /></div>}
      <div className="dt-full">
        <Button aria-expanded={open} aria-controls={textId} onClick={() => setOpen(o => !o)}>{open ? L.hideFullText : L.showFullText}</Button>
        {open ? <div className="dt-text" id={textId} role="region" aria-label={L.fullText} tabIndex={0} data-budget="content">{details.text.map((line, i) => <p key={i}>{line}</p>)}</div> : null}
      </div>
      <Remove owner={details.owner} entry={{ id: details.id, kind: 'skill', name: details.name }} onRemove={onRemove} />
    </>
  );
}

function ToolBody({ details, onSelect, onRemove, toolTrust = null, places = [] }: DetailsPanelProps & { details: ToolDetails }): ReactElement {
  return (
    <>
      <Back owner={details.owner} onSelect={onSelect} />
      <Head kind={L.kindTool} glyph="tool" name={details.name} line="" />
      <Block title={L.whatItReaches}><p>{details.hint}</p></Block>
      {toolTrust === null ? null : <Block title={L.reaches}><p data-reaches="" data-budget="content">{toolTrust.reaches}</p><p className="kit-hint" data-can="">{toolTrust.can}</p></Block>}
      <Block title={L.howFarItGoes}><p data-access="">{details.access}</p></Block>
      {details.needsKey ? <div className="dt-key" data-key="missing">{details.badge === null ? null : <Badge badge={details.badge} />}<p>{H.needsKeyLine}</p></div> : null}
      {details.keyReady ? <p className="dt-key" data-key="ready">{H.keyReady}</p> : null}
      {details.runsCode ? <div className="dt-badge"><Badge badge={{ label: L.runsCode, tone: 'warn' }} /></div> : null}
      <UsedBy agents={details.usedBy} onSelect={onSelect} />
      <WhereItLives key={details.id} places={places} />
      <Remove owner={details.owner} entry={{ id: details.id, kind: 'tool', name: details.name }} onRemove={onRemove} />
    </>
  );
}

function NoteBody({ details, onSelect, onRemove, onChoose }: DetailsPanelProps & { details: NoteDetails }): ReactElement {
  return (
    <>
      <Back owner={details.owner} onSelect={onSelect} />
      <Head kind={L.kindNotes} glyph="note" name={details.name} line={details.countLine} />
      <Block title={L.whatItCovers}><p>{details.topics}</p></Block>
      <Block title={L.someNotes}>
        {details.titles.length === 0 ? <p className="kit-hint">{H.noNotes}</p> : <ul className="dt-titles">{details.titles.map((title, i) => <li key={i}>{title}</li>)}</ul>}
      </Block>
      <UsedBy agents={details.usedBy} onSelect={onSelect} />
      <div className="dt-actions">
        {details.owner === null ? null : <Button icon="note" onClick={onChoose}>{NOTES_WORDS.label.choose}</Button>}
      </div>
      <Remove owner={details.owner} entry={{ id: details.id, kind: 'note', name: details.name }} onRemove={onRemove} />
    </>
  );
}

export function DetailsPanel(props: DetailsPanelProps): ReactElement {
  const { details } = props;
  if (details === null || details.kind === 'agent') return <AgentBody {...props} details={details} />;
  return (
    <Fragment>
      {details.kind === 'skill' ? <SkillBody {...props} details={details} /> : details.kind === 'tool' ? <ToolBody {...props} details={details} /> : <NoteBody {...props} details={details} />}
    </Fragment>
  );
}

