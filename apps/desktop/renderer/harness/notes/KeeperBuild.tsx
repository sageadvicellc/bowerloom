/**
 * Building the Notes keeper (first five minutes, section 4 step 5): the keeper's card with two shelves, Skills and Notes, and beside it the ready-made skills
 * and the person's notes as cards. The person drags the first skill, "add-source", onto Skills; one button adds the rest; and the notes card goes onto the
 * Notes shelf. Every drag has a button that does the same, and each thing on a shelf has a button that takes it off. All of it is a draft until Save.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { DefinitionView } from '../../../shared/engine/types.js';
import { Tile } from '../icons.js';
import { HButton } from '../parts/controls.js';
import { NOTES, addToKeeperName, onShelfName, takeOffName } from '../words-notes.js';
import { ItemCard, Shelf } from './cards.js';
import type { NotesCard } from './notes-logic.js';

export interface KeeperBuildProps {
  keeper: { readonly name: string; readonly skills: readonly string[]; readonly notes: readonly string[] };
  /** The skills the Skills shelf offers, in the kit's order, with their names and descriptions. */
  offered: DefinitionView['skills'];
  cards: readonly NotesCard[];
  held: boolean;
  /** True when the keeper comes from the kit in this draft, not saved yet. */
  fromKit: boolean;
  onLink(skill: string, on: boolean): void;
  onLinkRest(): void;
  onAttach(card: NotesCard, on: boolean): void;
}

/** The ids that are new on a shelf since the last draw, so they rise in once. */
function useArrived(ids: readonly string[]): readonly string[] {
  const seen = useRef<readonly string[] | null>(null);
  const [arrived, setArrived] = useState<readonly string[]>([]);
  useEffect(() => {
    if (seen.current !== null) setArrived(ids.filter(id => !seen.current!.includes(id)));
    seen.current = ids;
  }, [ids.join('\n')]);
  return arrived;
}

export function KeeperBuild({ keeper, offered, cards, held, fromKit, onLink, onLinkRest, onAttach }: KeeperBuildProps): ReactElement {
  const linked = offered.filter(s => keeper.skills.includes(s.id));
  // A skill the keeper uses that the kit does not offer still shows on its shelf.
  const others = keeper.skills.filter(id => !offered.some(s => s.id === id)).map(id => ({ id, name: id }));
  const left = offered.filter(s => !keeper.skills.includes(s.id));
  const shelfNotes = keeper.notes.map(n => ({ id: n, name: cards.find(c => c.source.name === n)?.name ?? n }));
  const looseNotes = cards.filter(c => !keeper.notes.includes(c.source.name));
  const arrivedSkills = useArrived(keeper.skills), arrivedNotes = useArrived(keeper.notes);
  const cardOf = (key: string): NotesCard | undefined => cards.find(c => c.key === key || c.source.name === key);
  return (
    <section className="hxn-build" data-section="keeper-build" data-tour="build" aria-label={NOTES.label.building}>
      <div className="hxn-keeper" data-tour="keeper" data-keeper={keeper.name}>
        <div className="hxn-keeper-head">
          <Tile name="robot" size="large" />
          <span className="hxn-card-text">
            <span className="hxn-keeper-name">{NOTES.label.keeper}</span>
            <span className="hxn-card-sub">{fromKit ? NOTES.hint.keeperDraft : keeper.name}</span>
          </span>
        </div>
        <div className="hxn-shelves" data-tour="shelves">
          <Shelf shelf="skills" title={NOTES.label.skillsShelf} items={[...linked.map(s => ({ id: s.id, name: s.name })), ...others]} empty={NOTES.hint.dropSkill} held={held}
            arrived={arrivedSkills} onDrop={id => onLink(id, true)} onTakeOff={id => onLink(id, false)} takeOffName={takeOffName} />
          <Shelf shelf="notes" title={NOTES.label.notesShelf} items={shelfNotes} empty={NOTES.hint.dropNotes} held={held} arrived={arrivedNotes}
            onDrop={key => { const c = cardOf(key); if (c !== undefined) onAttach(c, true); }}
            onTakeOff={name => { const c = cardOf(name); if (c !== undefined) onAttach(c, false); }} takeOffName={takeOffName} />
        </div>
      </div>
      <div className="hxn-tray">
        <h4 className="hxn-tray-head">{NOTES.label.kitSkills}</h4>
        {left.length === 0 ? null : (
          <ul className="hxn-cards" aria-label={NOTES.label.kitSkills}>
            {left.map(s => (
              <ItemCard key={s.id} kind="skill" id={s.id} name={s.name} draggable={!held}
                action={<HButton size="small" disabled={held} aria-label={addToKeeperName(s.name)} data-add-skill={s.id} onClick={() => onLink(s.id, true)}>{NOTES.label.add}</HButton>} />
            ))}
          </ul>
        )}
        <HButton icon="plus" disabled={held || left.length === 0} data-link-rest="" onClick={onLinkRest}>{NOTES.label.addRest}</HButton>
        {looseNotes.length === 0 ? null : (
          <>
            <h4 className="hxn-tray-head">{NOTES.label.yourNotes}</h4>
            <ul className="hxn-cards" aria-label={NOTES.label.yourNotes}>
              {looseNotes.map(c => (
                <ItemCard key={c.key} kind="notes" id={c.key} name={c.name} draggable={!held}
                  action={<HButton size="small" disabled={held} aria-label={onShelfName(c.name)} data-add-notes={c.key} onClick={() => onAttach(c, true)}>{NOTES.label.add}</HButton>} />
              ))}
            </ul>
          </>
        )}
        <p className="hxe-text hxe-muted">{NOTES.hint.shelvesNote}</p>
      </div>
    </section>
  );
}
