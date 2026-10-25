/**
 * The small picker under "Add to an agent": every agent of the person, in name order. An agent that already has the thing is marked "Has it" and cannot be
 * chosen. The focus goes to the first agent that can be chosen, the arrows move between agents, and Escape closes the picker (and nothing under it).
 * It is the Add drawer's picker, with the Library's words.
 */
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import type { AgentChoice } from '../../../shared/home/add-model.js';
import { Glyph } from '../kit/Glyph.js';
import { LIBRARY_WORDS } from './library-words.js';
import '../add/add.css';

const L = LIBRARY_WORDS.label, H = LIBRARY_WORDS.hint;

function PickRow({ choice, onPick }: { choice: AgentChoice; onPick(): void }): ReactElement {
  const noteId = useId();
  return (
    <li className="add-pick" data-has={choice.has ? '' : undefined}>
      <Glyph name="agent" size="small" />
      <button type="button" className="add-pick-main" aria-disabled={choice.has ? 'true' : undefined} aria-describedby={choice.has ? noteId : undefined} data-agent={choice.id} onClick={() => { if (!choice.has) onPick(); }}>{choice.name}</button>
      {choice.has ? <span className="kit-hint add-pick-note" id={noteId}>{L.hasIt}</span> : null}
    </li>
  );
}

export interface AgentPickerProps {
  choices: readonly AgentChoice[];
  onPick(choice: AgentChoice): void;
  onClose(): void;
}

export function AgentPicker({ choices, onPick, onClose }: AgentPickerProps): ReactElement {
  const list = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    (buttons.find(b => b.getAttribute('aria-disabled') !== 'true') ?? buttons[0])?.focus();
  }, []);
  const key = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.findIndex(b => b === document.activeElement);
    const go = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : null;
    if (go === null) return;
    e.preventDefault();
    buttons[(go + buttons.length) % buttons.length]?.focus();
  };
  return (
    <div className="add-picker lb-picker" role="group" aria-labelledby={titleId} data-picker="" onKeyDown={key} ref={list}>
      <p className="kit-hint add-picker-title" id={titleId}>{L.pickAgent}</p>
      {choices.length === 0 ? <p className="kit-hint">{H.noAgentsToPick}</p> : (
        <ul className="add-picker-list">
          {choices.map(c => <PickRow key={c.id} choice={c} onPick={() => onPick(c)} />)}
        </ul>
      )}
    </div>
  );
}
