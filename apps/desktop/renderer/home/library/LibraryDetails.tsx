/**
 * The details of one thing in the Library, read only (no text can be edited). It answers, in this order: what it is and what it does, the actions (Add to an
 * agent, Make my own copy, Update, Remove from library), who uses it (each agent is a button), where it works, where it came from (source, who made it, which
 * release, when it was added), for a tool what it can reach and how far it can go, the flags (runs code, needs a key, different copies, update available),
 * and the full text behind "Show the full text". The author and the release tag are the item's own data. Every action stages a draft change through the page;
 * this component only asks.
 */
import { useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { AgentChoice } from '../../../shared/home/add-model.js';
import { LIBRARY_MODEL_WORDS } from '../../../shared/home/library-model.js';
import type { LibraryDetails as Details } from '../../../shared/home/library-model.js';
import { Badge } from '../kit/Badge.js';
import { Button } from '../kit/Button.js';
import { Glyph } from '../kit/Glyph.js';
import type { Place } from '../../../shared/home/where-it-lives.js';
import { WhereItLives } from '../details/WhereItLives.js';
import { AgentPicker } from './AgentPicker.js';
import { LIBRARY_WORDS } from './library-words.js';
import '../details/details.css';
import './library.css';

const L = LIBRARY_WORDS.label, H = LIBRARY_WORDS.hint;

const KIND_WORD = { skill: L.kindSkill, agent: L.kindAgent, tool: L.kindTool, note: L.kindNotes } as const;
const GLYPH = { skill: 'skill', agent: 'agent', tool: 'tool', note: 'note' } as const;

export interface LibraryDetailsProps {
  /** What the panel shows. Null when nothing is picked. */
  details: Details | null;
  /** The agents the thing can be added to. */
  choices: readonly AgentChoice[];
  /** What was last said about this thing ("Added to Meeting assistant."). */
  say: string;
  onPickAgent(agentId: string): void;
  onOpenAgent(agentId: string): void;
  onRemove(): void;
  onCopy(): void;
  onUpdate(): void;
  onBadgePress(): void;
  /** Where the thing is kept in each program (sample paths), for "Show where it lives". Empty for a set of notes. */
  places?: readonly Place[];
}

function Block({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const id = useId();
  return <section className="dt-block" aria-labelledby={id}><h3 className="dt-sub" id={id}>{title}</h3>{children}</section>;
}

function Head({ kind, name, line }: { kind: string; name: string; line: string }): ReactElement {
  return (
    <div className="hm-panel-head dt-head">
      <Glyph name={GLYPH[kind as keyof typeof GLYPH]} />
      <div className="dt-head-text">
        <h2 className="kit-heading" id="lb-panel-title" tabIndex={-1}>{name}</h2>
        {line === '' ? null : <p className="kit-hint">{line}</p>}
      </div>
    </div>
  );
}

export function LibraryDetails({ details, choices, say, onPickAgent, onOpenAgent, onRemove, onCopy, onUpdate, onBadgePress, places = [] }: LibraryDetailsProps): ReactElement {
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState(false);
  const textId = useId();
  const addButtonId = useId();
  if (details === null) {
    return (
      <>
        <div className="hm-panel-head"><h2 className="kit-heading" id="lb-panel-title" tabIndex={-1}>{L.pickSomething}</h2><p className="kit-hint">{H.pickTip}</p></div>
      </>
    );
  }
  const d = details;
  const hasFlags = d.runsCode || d.needsKey || d.keyReady || d.copies > 0 || d.update !== null;
  return (
    <>
      <Head kind={d.kind} name={d.name} line={KIND_WORD[d.kind]} />
      <Block title={d.kind === 'note' ? L.whatItCovers : L.whatItDoes}><p>{d.kind === 'note' && d.notes !== null ? d.notes.topics : d.hint}</p></Block>
      <div className="lb-actions" role="group" aria-label={d.name}>
        {d.canAdd ? <Button icon="plus" id={addButtonId} aria-expanded={picking} onClick={() => setPicking(p => !p)}>{L.addToAgent}</Button> : null}
        {d.canCopy ? <Button onClick={onCopy}>{L.makeCopy}</Button> : null}
        {d.update !== null ? <Button icon="sparkle" onClick={onUpdate}>{L.update}</Button> : null}
        <Button onClick={onRemove}>{L.removeFromLibrary}</Button>
      </div>
      {d.kind === 'tool' && !d.canAdd ? <p className="kit-hint">{H.hookNoAdd}</p> : null}
      {picking ? <AgentPicker choices={choices} onPick={c => { setPicking(false); onPickAgent(c.id); requestAnimationFrame(() => document.getElementById(addButtonId)?.focus()); }} onClose={() => { setPicking(false); requestAnimationFrame(() => document.getElementById(addButtonId)?.focus()); }} /> : null}
      <p className="lb-say" role="status" data-say="">{say}</p>
      {hasFlags ? (
        <div className="lb-flags" data-flags="">
          {d.runsCode ? <Badge badge={{ label: L.runsCode, tone: 'warn' }} /> : null}
          {d.needsKey ? <Badge badge={{ label: L.needsKey, tone: 'warn' }} /> : null}
          {d.copies > 0 ? <Badge badge={{ label: `${d.copies} ${LIBRARY_MODEL_WORDS.copiesSuffix}`, tone: 'warn' }} onPress={onBadgePress} /> : null}
          {d.update !== null ? <Badge badge={{ label: L.updateAvailable, tone: 'new' }} /> : null}
        </div>
      ) : null}
      {d.needsKey ? <p className="kit-hint">{H.needsKeyLine}</p> : null}
      {d.keyReady ? <p className="kit-hint">{H.keyReady}</p> : null}

      {d.kind === 'agent' ? (
        <Block title={L.whatItHas}>
          {d.has === null || d.has.skills.length + d.has.tools.length + d.has.notes.length === 0 ? <p className="kit-hint">{H.agentHasNothing}</p> : (
            <ul className="lb-lines" data-has="">
              {[...d.has.skills, ...d.has.tools, ...d.has.notes].map((name, i) => <li key={i}>{name}</li>)}
            </ul>
          )}
        </Block>
      ) : (
        <Block title={L.usedBy}>
          {d.usedBy.length === 0 ? <p className="kit-hint">{H.noUsers}</p> : (
            <ul className="dt-chips" data-used-by="">{d.usedBy.map(a => <li key={a.id}><button type="button" className="dt-agent" onClick={() => onOpenAgent(a.id)}>{a.name}</button></li>)}</ul>
          )}
        </Block>
      )}

      {d.kind === 'tool' ? (
        <>
          <Block title={L.whatItReaches}><p data-reach="">{d.reach}</p></Block>
          <Block title={L.whatItCanDo}><p data-ability="">{d.ability}</p></Block>
        </>
      ) : null}

      {d.kind === 'note' && d.notes !== null ? (
        <Block title={L.someNotes}>
          <p className="kit-hint">{d.notes.countLine}</p>
          {d.notes.titles.length === 0 ? null : <ul className="dt-titles">{d.notes.titles.map((t, i) => <li key={i}>{t}</li>)}</ul>}
        </Block>
      ) : (
        <Block title={L.whereItWorks}>
          {d.works.length === 0 ? <p className="kit-hint">{H.noPrograms}</p> : <ul className="dt-chips" data-programs="">{d.works.map(name => <li key={name} className="dt-chip">{name}</li>)}</ul>}
          <WhereItLives key={`${d.kind}:${d.id}`} places={places} />
        </Block>
      )}

      <Block title={L.whereItCameFrom}>
        <dl className="lb-facts" data-origin="">
          <dt>{L.source}</dt><dd>{d.origin.source}</dd>
          {d.origin.outside ? <><dt>{L.madeBy}</dt><dd data-budget="content" data-field="author">{d.origin.author}</dd></> : null}
          {d.origin.release === null ? null : <><dt>{L.release}</dt><dd data-budget="content" data-field="release">{d.origin.release}</dd></>}
          <dt>{L.added}</dt><dd data-field="added">{d.origin.added}</dd>
        </dl>
        {d.canCopy ? <p className="kit-hint">{H.copyTip}</p> : null}
      </Block>

      {d.kind === 'note' ? null : (
        <div className="dt-full">
          <Button aria-expanded={open} aria-controls={textId} onClick={() => setOpen(o => !o)}>{open ? L.hideFullText : L.showFullText}</Button>
          {open ? <div className="dt-text" id={textId} role="region" aria-label={L.fullText} tabIndex={0} data-budget="content">{(d.text.length === 0 ? [H.noText] : d.text).map((line, i) => <p key={i}>{line}</p>)}</div> : null}
        </div>
      )}
    </>
  );
}

