/**
 * The details column of the Builder, for the part selected on the graph of one folder's harness. Nothing selected: what to do. An agent: what it does, and
 * each skill and notes card it uses, with Unlink, and "Link to..." for the keyboard. A skill or a notes card: what it is, the agents that use it, with Unlink,
 * and Remove (or Keep, once the draft marks it to go), with the hint that Remove deletes a skill's files when the person saves.
 * Every change is a Builder gesture (`onAct`), which goes through builderAction and onto the folder's undo stack. Every name comes from the person's own
 * files and is drawn as plain text.
 */
import type { ReactElement } from 'react';
import type { DefinitionView } from '../../../../shared/engine/types.js';
import type { BuilderAction } from '../../../../shared/harness/builder-draft.js';
import { agentPart, notesPartId, partNotes, partSkill } from '../../../../shared/harness/save-draft.js';
import type { SaveDraft } from '../../../../shared/harness/save-draft.js';
import { DetailsHead } from '../../Screen.js';
import { KIND_ICON, Tile } from '../../icons.js';
import { HButton, StateDot } from '../../parts/controls.js';
import { KIND_NAME, WORDS, unlinkName } from '../../words.js';
import { ENGINE_WORDS } from '../../words-engine.js';
import { NOTES } from '../../words-notes.js';

export interface BuilderDetailsProps {
  /** The harness as the draft makes it. */
  now: DefinitionView;
  /** The harness the draft starts from, so a skill or notes the draft marks to go can be kept again. */
  start: DefinitionView;
  draft: SaveDraft;
  selectedId: string | null;
  linkingId: string | null;
  held: boolean;
  onSelect(id: string): void;
  /** Starts (or stops) linking from an agent, for the keyboard. */
  onLinkStart(agentId: string): void;
  onAct(action: BuilderAction): void;
}

interface Row { readonly id: string; readonly name: string; readonly kind: 'agent' | 'skill' | 'context' }

function Links({ title, owner, rows, held, onSelect, onAct }: { title: string; owner: { id: string; name: string; agent: boolean }; rows: readonly Row[]; held: boolean; onSelect(id: string): void; onAct(a: BuilderAction): void }): ReactElement {
  return (
    <section className="hx-block" aria-labelledby="hx-links" data-links={owner.id}>
      <h3 className="hx-h3" id="hx-links">{title}</h3>
      {rows.length === 0 ? <p className="hx-text hx-muted">{WORDS.hint.noLinks}</p> : (
        <ul className="hx-box-list">
          {rows.map(row => (
            <li key={row.id} className="hx-box hx-box-press" data-link={row.id}>
              <Tile name={KIND_ICON[row.kind]} size="small" />
              <button type="button" className="hx-box-main" onClick={() => onSelect(row.id)}>{row.name}</button>
              <HButton size="small" disabled={held} data-unlink={row.id} aria-label={owner.agent ? unlinkName(owner.name, row.name) : unlinkName(row.name, owner.name)}
                onClick={() => onAct({ kind: 'unlink', a: owner.id, b: row.id })}>{WORDS.label.unlink}</HButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BuilderDetails({ now, start, draft, selectedId, linkingId, held, onSelect, onLinkStart, onAct }: BuilderDetailsProps): ReactElement {
  const agentId = selectedId === null ? null : agentPart(selectedId), skillId = selectedId === null ? null : partSkill(selectedId), notesName = selectedId === null ? null : partNotes(selectedId);
  const agent = agentId === null ? undefined : now.agents.find(a => a.id === agentId);
  const skill = skillId === null ? undefined : start.skills.find(s => s.id === skillId);
  const source = notesName === null ? undefined : now.sources.find(s => s.name === notesName) ?? start.sources.find(s => s.name === notesName);
  const users = (has: (a: DefinitionView['agents'][number]) => boolean): Row[] => now.agents.filter(has).map(a => ({ id: `agent:${a.id}`, name: a.name, kind: 'agent' }));
  if (agent !== undefined) {
    const rows: Row[] = [
      ...agent.skills.flatMap(id => { const s = now.skills.find(x => x.id === id); return s === undefined ? [] : [{ id: `skill:${s.id}`, name: s.name, kind: 'skill' as const }]; }),
      ...agent.notes.map(n => ({ id: notesPartId(n), name: n, kind: 'context' as const })),
    ];
    return (
      <>
        <DetailsHead tile={<Tile name={KIND_ICON.agent} size="large" />} title={agent.name} subtitle={KIND_NAME.agent} />
        <p className="hx-text">{agent.description}</p>
        <div className="hx-actions">
          <HButton icon="harness" disabled={held} aria-pressed={linkingId === selectedId} onClick={() => onLinkStart(selectedId!)}>{WORDS.label.linkTo}</HButton>
        </div>
        <Links title={WORDS.label.uses} owner={{ id: selectedId!, name: agent.name, agent: true }} rows={rows} held={held} onSelect={onSelect} onAct={onAct} />
      </>
    );
  }
  if (skill !== undefined || source !== undefined) {
    const id = selectedId!, name = skill?.name ?? source!.name;
    const rows = skill !== undefined ? users(a => a.skills.includes(skill.id)) : users(a => a.notes.includes(source!.name));
    const gone = skill !== undefined ? draft.removed.includes(skill.id) : draft.stopped.includes(source!.name);
    return (
      <>
        <DetailsHead tile={<Tile name={skill !== undefined ? KIND_ICON.skill : KIND_ICON.context} size="large" />} title={name} subtitle={skill !== undefined ? KIND_NAME.skill : NOTES.label.notes} />
        <p className="hx-text">{skill?.description ?? source!.label}</p>
        <div className="hx-actions">
          {gone ? <StateDot tone="warn">{ENGINE_WORDS.hint.removedMark}</StateDot> : null}
          <HButton icon="minus-circle" disabled={held} data-remove-part={id} onClick={() => onAct({ kind: gone ? 'keep' : 'remove', part: id })}>{gone ? ENGINE_WORDS.label.keepSkill : ENGINE_WORDS.label.removeSkill}</HButton>
          <p className="hx-text hx-muted hx-note">{skill !== undefined ? WORDS.hint.removeNote : NOTES.hint.folderStays}</p>
        </div>
        <Links title={WORDS.label.usedBy} owner={{ id, name, agent: false }} rows={rows} held={held} onSelect={onSelect} onAct={onAct} />
      </>
    );
  }
  return (
    <>
      <h2 className="kit-heading hx-dtitle" id="hm-panel-title" tabIndex={-1}>{WORDS.label.nothingSelected}</h2>
      <p className="hx-text hx-muted" data-budget="paragraph">{WORDS.hint.dropToLink}</p>
    </>
  );
}
