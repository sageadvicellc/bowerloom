/**
 * One row of the Add drawer: the kit's own card, the "Add to" button beside it, and, when the button is open, a small picker of agents under it. The card
 * and the button do the same thing (open the picker), so a person can use whichever they reach. A card can also be dragged onto an agent. A ready-made
 * agent has no picker: its button, "Add agent", copies it into the person's own agents at once. An agent that already has the card says "Has it" in the picker and cannot
 * be picked; a card that every agent has says "On all agents" as its state, and its button is off.
 */
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { AddEntry, AgentChoice } from '../../../shared/home/add-model.js';
import { Button } from '../kit/Button.js';
import { Glyph } from '../kit/Glyph.js';
import { ItemCard } from '../kit/ItemCard.js';
import { ADD_WORDS } from './add-words.js';

const L = ADD_WORDS.label;

export interface AddRowProps {
  entry: AddEntry;
  choices: readonly AgentChoice[];
  open: boolean;
  onToggle(): void;
  /** The person chose an agent in the picker. `row` is the row, for the line to start from. */
  onPick(choice: AgentChoice, row: HTMLElement | null): void;
  /** A ready-made agent was asked for. */
  onInstall(row: HTMLElement | null): void;
  onDragStart?(e: ReactPointerEvent<HTMLElement>): void;
  /** True once, right after a drag ended: the click that follows a drag must not open the picker. */
  suppressClick(): boolean;
  /** Called when the person presses the "2 different copies" badge. */
  onBadgePress?(): void;
  /** Where the card came from ("Made by you", "Open skills library"), drawn under it so no card is left blank. */
  source?: string;
}

/** One agent in the picker. The name is the button (its ::after covers the row), so the button holds the name and nothing else. */
function PickRow({ choice, onPick }: { choice: AgentChoice; onPick(): void }): ReactElement {
  const noteId = useId();
  return (
    <li className="add-pick" data-has={choice.has ? '' : undefined}>
      <Glyph name="agent" size="small" />
      <button type="button" className="add-pick-main" aria-disabled={choice.has ? 'true' : undefined} aria-describedby={choice.has ? noteId : undefined} data-agent={choice.id} onClick={onPick}>{choice.name}</button>
      {choice.has ? <span className="kit-hint add-pick-note" id={noteId}>{L.alreadyAdded}</span> : null}
    </li>
  );
}

function AgentPicker({ entry, choices, onPick, onClose }: { entry: AddEntry; choices: readonly AgentChoice[]; onPick(choice: AgentChoice): void; onClose(): void }): ReactElement {
  const list = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // The focus goes to the first agent that does not have the card yet, so the keyboard path is one key to open and one to choose.
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
    <div className="add-picker" role="group" aria-labelledby={titleId} data-picker={entry.id} onKeyDown={key} ref={list}>
      <p className="kit-hint add-picker-title" id={titleId}>{L.pickAgent}</p>
      {choices.length === 0 ? <p className="kit-hint">{ADD_WORDS.hint.noAgents}</p> : (
        <ul className="add-picker-list">
          {choices.map(c => (
            <PickRow key={c.id} choice={c} onPick={() => onPick(c)} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function AddRow({ entry, choices, open, onToggle, onPick, onInstall, onDragStart, suppressClick, onBadgePress, source }: AddRowProps): ReactElement {
  const row = useRef<HTMLLIElement>(null), button = useRef<HTMLButtonElement>(null);
  const nameId = useId();
  const ready = entry.kind === 'agent';
  // Every agent has it: nothing is left to add, and the card says so instead of opening a picker that has nothing to pick.
  const onAll = !ready && choices.length > 0 && choices.every(c => c.has);
  const shown = entry.badge ?? (onAll ? { label: L.onAll, tone: 'info' as const } : undefined);
  const press = ready ? () => onInstall(row.current) : onToggle;
  const close = (): void => { onToggle(); button.current?.focus(); };
  return (
    <li className="add-row" ref={row} data-add-id={entry.id} data-add-kind={entry.kind} data-draggable={onDragStart === undefined ? undefined : ''}>
      <div className="add-row-main">
        <div className="add-row-card">
          <ItemCard kind={entry.kind} name={entry.name} hint={entry.hint} selected={!ready && open} onSelect={() => { if (!suppressClick()) press(); }}
            {...(shown === undefined ? {} : { badge: shown })}
            {...(onBadgePress === undefined || entry.badge === undefined ? {} : { onBadgePress })}
            {...(onDragStart === undefined ? {} : { onDragStart })} />
        </div>
        <span className="hm-sr" id={nameId}>{entry.name}</span>
        <Button ref={button} {...(ready ? { icon: 'plus' as const } : { 'aria-expanded': open })} disabled={onAll} aria-labelledby={`${nameId}-do ${nameId}`} onClick={press}>
          <span id={`${nameId}-do`}>{ready ? L.addAgent : L.addTo}</span>
        </Button>
      </div>
      {source === undefined ? null : <p className="kit-hint add-row-source" data-source="" data-budget="content">{source}</p>}
      {!ready && open ? <AgentPicker entry={entry} choices={choices} onPick={c => { onPick(c, row.current); button.current?.focus(); }} onClose={close} /> : null}
    </li>
  );
}
