/**
 * The one card. An agent card is larger. Every card, agent or not, leads with the same rounded tile and the glyph of its kind (the agent's is three joined nodes,
 * not a person). They share this component and one layout: a tile, a name, an optional one-line hint, and at most one small state badge. A selected card is
 * shown by a filled tint and a 2 px accent border, never by a check mark: a check says "actionable choice", and this is only a highlight. The name is the card's button (it spans the
 * whole card), so a screen reader hears "Meeting assistant, toggle button, pressed", and the hint and badge sit beside it as plain text.
 * A card on a shelf can also carry a quiet "Remove" button (`onRemove`). It is a real button, so the keyboard reaches it, and its name reads "Remove" and then the
 * card's own name. An agent card carries `data-drop-agent` with the agent's id, so a drag can find the card it lands on.
 */
import { useId } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { CardBadge } from '../../../shared/home/cards.js';
import { WORDS } from '../words.js';
import { Badge } from './Badge.js';
import { Glyph } from './Glyph.js';

export type CardKind = 'agent' | 'skill' | 'tool' | 'note';

/** Whether a card is drawn large. Only an agent is. */
export const isLarge = (kind: CardKind): boolean => kind === 'agent';

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
    <div className="kit-card" data-kind={kind} data-size={isLarge(kind) ? 'large' : 'small'} data-selected={selected ? '' : undefined} data-removable={onRemove === undefined ? undefined : ''} data-demo={demo} data-fresh={fresh === true ? '' : undefined} data-tour={dataTour} data-drop-agent={dropAgent} onPointerDown={onDragStart}>
      <Glyph name={kind} size={isLarge(kind) ? 'large' : 'normal'} />
      <button type="button" className="kit-card-main" id={nameId} aria-pressed={selected} aria-describedby={hint === undefined ? undefined : hintId} onClick={onSelect}>{name}</button>
      {hint === undefined ? null : <p className="kit-hint kit-card-hint" id={hintId}>{hint}</p>}
      {onRemove === undefined ? null : (
        <span className="kit-card-remove">
          <button type="button" className="kit-remove" id={removeId} aria-labelledby={`${removeId} ${nameId}`} data-no-drag="" onClick={onRemove}>{WORDS.label.remove}</button>
        </span>
      )}
      {badge === undefined ? null : <span className="kit-card-badge"><Badge badge={badge} {...(onBadgePress === undefined ? {} : { onPress: onBadgePress })} /></span>}
    </div>
  );
}
