/**
 * The details column of the builder. Nothing picked: "Nothing selected" and what to do. A part picked: its name and kind, what it does, where it works, its file (the first lines, as plain text),
 * "View file", "Link to..." (an agent, in the Graph: it starts linking, the same as the circle on the node, for the keyboard and for a large target) and "Remove from this harness" (which says that the file is not deleted),
 * what it uses (an agent) or which agents use it (any other part), and where else it is used.
 * A missing part picked: what it is and a Fix button. Every name and line here comes from the person's own files and is drawn as plain text.
 */
import type { ReactElement } from 'react';
import { excerptOf } from '../../../../shared/harness/frontmatter.js';
import { harnessesHolding, usedByAgents, usedInOtherWords, usesOf, worksIn } from '../../../../shared/harness/status.js';
import type { Harness, HarnessState, Part } from '../../../../shared/harness/types.js';
import { DetailsHead } from '../../Screen.js';
import { KIND_ICON, Tile } from '../../icons.js';
import { HButton, StateDot } from '../../parts/controls.js';
import { KIND_NAME, WORDS, missingKind, namedBy } from '../../words.js';
import { NotChecked } from '../../real/NotChecked.js';

export interface BuilderDetailsProps {
  state: HarnessState;
  harness: Harness;
  selectedId: string | null;
  onSelect(id: string): void;
  onViewFile(partId: string): void;
  onRemove(partId: string): void;
  onFix(missingId: string): void;
  /** The agent that is being linked, or null. */
  linkingId?: string | null;
  /** Starts (or stops) linking from an agent. Left out in the List view, which has no linking. */
  onLinkStart?: ((agentId: string) => void) | undefined;
}

function PartDetails({ state, harness, part, linkingId, onSelect, onViewFile, onRemove, onLinkStart }: { state: HarnessState; harness: Harness; part: Part; linkingId: string | null } & Pick<BuilderDetailsProps, 'onSelect' | 'onViewFile' | 'onRemove' | 'onLinkStart'>): ReactElement {
  const others = harnessesHolding(state, part.id).filter(h => h.id !== harness.id).length;
  const rows = part.kind === 'agent' ? usesOf(state, harness, part.id) : usedByAgents(state, harness, part.id);
  return (
    <>
      <DetailsHead tile={<Tile name={KIND_ICON[part.kind]} size="large" />} title={part.name} subtitle={KIND_NAME[part.kind]} />
      <p className="hx-text">{part.description}</p>
      <section className="hx-block" aria-labelledby="hx-works-in">
        <h3 className="hx-h3" id="hx-works-in">{WORDS.label.worksIn}</h3>
        {state.real === undefined ? <ul className="hx-inline-list">{worksIn(state, part).map(i => <li key={i.id}><StateDot tone="good">{i.name}</StateDot></li>)}</ul> : <NotChecked part={part} />}
      </section>
      <section className="hx-block" aria-labelledby="hx-file">
        <h3 className="hx-h3" id="hx-file">{WORDS.label.file}</h3>
        <p className="hx-text hx-muted hx-path">{part.path}</p>
        <pre className="hx-excerpt" data-budget="content">{excerptOf(part.fileText)}</pre>
      </section>
      <div className="hx-actions">
        <HButton icon="eye" onClick={() => onViewFile(part.id)}>{WORDS.label.viewFile}</HButton>
        {part.kind === 'agent' && onLinkStart !== undefined ? <HButton icon="harness" aria-pressed={linkingId === part.id} onClick={() => onLinkStart(part.id)}>{WORDS.label.linkTo}</HButton> : null}
        <HButton icon="minus-circle" onClick={() => onRemove(part.id)}>{WORDS.label.removeFromHarness}</HButton>
        <p className="hx-text hx-muted hx-note">{WORDS.hint.removeNote}</p>
      </div>
      {rows.length === 0 ? null : (
        <section className="hx-block" aria-labelledby="hx-uses">
          <h3 className="hx-h3" id="hx-uses">{part.kind === 'agent' ? WORDS.label.uses : WORDS.label.usedBy}</h3>
          <ul className="hx-box-list">
            {rows.map(row => (
              <li key={row.id} className="hx-box hx-box-press">
                <Tile name={KIND_ICON[row.kind]} size="small" />
                <button type="button" className="hx-box-main" onClick={() => onSelect(row.id)}>{row.name}</button>
                <span className="hx-box-kind">{KIND_NAME[row.kind]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {others === 0 ? null : <StateDot tone="good" className="hx-block-state">{usedInOtherWords(others)}</StateDot>}
    </>
  );
}

export function BuilderDetails({ state, harness, selectedId, linkingId = null, onSelect, onViewFile, onRemove, onFix, onLinkStart }: BuilderDetailsProps): ReactElement {
  const part = selectedId === null ? undefined : state.parts.find(p => p.id === selectedId && harness.partIds.includes(p.id));
  const ref = selectedId === null ? undefined : harness.missing.find(m => m.id === selectedId);
  if (part !== undefined) return <PartDetails state={state} harness={harness} part={part} linkingId={linkingId} onSelect={onSelect} onViewFile={onViewFile} onRemove={onRemove} onLinkStart={onLinkStart} />;
  if (ref !== undefined) {
    const users = harness.links.filter(l => l.to === ref.id).map(l => state.parts.find(p => p.id === l.from)).filter((p): p is Part => p !== undefined);
    return (
      <>
        <DetailsHead tile={<Tile name="warning-triangle" size="large" />} title={ref.name} subtitle={missingKind(ref.kind)} />
        <p className="hx-text">{users.length === 0 ? WORDS.hint.missingNode : namedBy(users.map(u => u.name))}</p>
        <div className="hx-actions"><HButton variant="primary" onClick={() => onFix(ref.id)}>{WORDS.label.fix}</HButton></div>
      </>
    );
  }
  return (
    <>
      <h2 className="kit-heading hx-dtitle" id="hm-panel-title" tabIndex={-1}>{WORDS.label.nothingSelected}</h2>
      <p className="hx-text hx-muted" data-budget="paragraph">{WORDS.paragraph.pickAPart}</p>
    </>
  );
}
