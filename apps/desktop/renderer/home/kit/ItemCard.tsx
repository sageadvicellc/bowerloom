/**
 * The one row. A skill, tool or note (and a ready-made agent in the Add drawer) is drawn as a compact row of one height: a 28 px tile with the glyph of its kind, the
 * name over one line of hint (each clipped with an ellipsis, never wrapped), and at the end of the hint line the words of a state (a small dot and short words) and a
 * quiet "Remove", so the name always has the whole width. A selected row is shown by a filled tint and a 2 px accent border, never by a check mark: a check says "actionable choice", and this is only a highlight.
 * The name is the row's button (it spans the whole row), so a screen reader hears "Write a short summary, toggle button, pressed", and the hint and state sit beside it as
 * plain text. An agent on the map is not an ItemCard: it is the AgentCard tile. A row can carry `data-drop-agent` too, so a drag can find where it lands.
 */
import { useId } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { CardBadge } from '../../../shared/home/cards.js';
import { WORDS } from '../words.js';
import { EditIconButton } from '../read-only.js';
import { Badge } from './Badge.js';
import { Glyph } from './Glyph.js';

export type CardKind = 'agent' | 'skill' | 'tool' | 'note';

/** Whether a card is drawn as a tile. No ItemCard is: the tile is the AgentCard of the map, and every ItemCard is a row of the one height. Kept for a screen that asks. */
export const isLarge = (_kind: CardKind): boolean => false;

export interface ItemCardProps {
  kind: CardKind;
  name: string;
  hint?: string;
  badge?: CardBadge;
  selected: boolean;
  onSelect(): void;
  /** Called on a pointer press, to start a drag (see `useCardDrag`). */
  onDragStart?(e: ReactPointerEvent<HTMLElement>): void;
  /** Called when the person clicks the badge. Without it the badge is only words. */
  onBadgePress?(): void;
  /** Called when the person presses "Remove". Without it the card has no such button. */
  onRemove?(): void;
  /** On an agent card: the id of the agent, so a drag can find where it lands. */
  dropAgent?: string;
  /** The tour finds the card by this id. */
  dataTour?: string;
  /** True for a moment after something was added to this card's place, so the person sees where it went. */
  fresh?: boolean;
  /** For the kit gallery only: draws a state that needs the pointer or the keyboard. */
  demo?: 'hover' | 'focus';
}

export function ItemCard({ kind, name, hint, badge, selected, onSelect, onDragStart, onBadgePress, onRemove, dropAgent, dataTour, fresh, demo }: ItemCardProps): ReactElement {
  const hintId = useId(), nameId = useId(), removeId = useId();
  return (
    <div className="kit-card" data-kind={kind} data-size="small" data-selected={selected ? '' : undefined} data-removable={onRemove === undefined ? undefined : ''} data-demo={demo} data-fresh={fresh === true ? '' : undefined} data-tour={dataTour} data-drop-agent={dropAgent} onPointerDown={onDragStart}>
      <Glyph name={kind} />
      <div className="kit-card-text">
        <div className="kit-card-line">
          <button type="button" className="kit-card-main" id={nameId} aria-pressed={selected} aria-describedby={hint === undefined ? undefined : hintId} onClick={onSelect}>{name}</button>
        </div>
        {hint === undefined && badge === undefined ? null : (
          <div className="kit-card-line">
            {hint === undefined ? <span className="kit-card-hint" /> : <p className="kit-hint kit-card-hint" id={hintId}>{hint}</p>}
            {badge === undefined ? null : <span className="kit-card-badge"><Badge badge={badge} {...(onBadgePress === undefined ? {} : { onPress: onBadgePress })} /></span>}
          </div>
        )}
      </div>
      {onRemove === undefined ? null : (
        <span className="kit-card-remove">
          <EditIconButton icon="remove" label={WORDS.label.remove} side="below-end" id={removeId} aria-labelledby={`${removeId} ${nameId}`} data-remove="" data-no-drag="" onClick={onRemove} />
        </span>
      )}
    </div>
  );
}
