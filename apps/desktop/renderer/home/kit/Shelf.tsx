/** A titled row of cards, with a plain sentence when it is empty and "Show more" after eight. Every card on a shelf is the same ItemCard. */
import { useId, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { SHELF_LIMIT, visibleCount } from '../../../shared/home/cards.js';
import type { ShelfEntry } from '../../../shared/home/cards.js';
import { WORDS } from '../words.js';
import { IconButton } from './IconButton.js';
import { ItemCard } from './ItemCard.js';

export interface ShelfProps {
  title: string;
  entries: readonly ShelfEntry[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** What the shelf says when it holds nothing. */
  emptyText: string;
  /** One short line under the title that says what the shelf is. */
  hint?: string;
  limit?: number;
  /** The heading level, so a shelf fits under whatever heading holds it. */
  level?: 2 | 3 | 4;
  onDragStart?(e: ReactPointerEvent<HTMLElement>, entry: ShelfEntry): void;
  onBadgePress?(entry: ShelfEntry): void;
  /** Gives every card a quiet "Remove" button. */
  onRemove?(entry: ShelfEntry): void;
  /** The id of the card that was just added, if it is on this shelf. */
  freshId?: string | null;
  /** Flips when the same card is shown again, so it is made afresh and its arrival plays again. */
  freshPhase?: 0 | 1;
  /** Starts with the long list open (the kit gallery shows both). */
  defaultExpanded?: boolean;
}

export function Shelf({ title, entries, selectedId, onSelect, emptyText, hint, limit = SHELF_LIMIT, level = 3, onDragStart, onBadgePress, onRemove, freshId = null, freshPhase = 0, defaultExpanded = false }: ShelfProps): ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const headingId = useId();
  // A card that was just added is never hidden behind "Show more".
  const hiddenFresh = freshId !== null && entries.findIndex(e => e.id === freshId) >= limit;
  const shown = visibleCount(entries.length, expanded || hiddenFresh, limit);
  const Heading = level === 2 ? 'h2' : level === 4 ? 'h4' : 'h3';
  return (
    <section className="kit-shelf" aria-labelledby={headingId}>
      <div className="kit-shelf-head">
        <Heading className="kit-heading" id={headingId}>{title}</Heading>
        {hint === undefined ? null : <p className="kit-hint">{hint}</p>}
      </div>
      {entries.length === 0 ? <p className="kit-hint">{emptyText}</p> : (
        <ul className="kit-shelf-list">
          {entries.slice(0, shown).map(entry => (
            <li key={entry.id === freshId ? `${entry.id}:${freshPhase}` : entry.id} data-entry={entry.id}>
              <ItemCard kind={entry.kind} name={entry.name} selected={entry.id === selectedId} onSelect={() => onSelect(entry.id)} fresh={entry.id === freshId}
                {...(entry.hint === undefined ? {} : { hint: entry.hint })}
                {...(onRemove === undefined ? {} : { onRemove: () => onRemove(entry) })}
                {...(entry.badge === undefined ? {} : { badge: entry.badge })}
                {...(onDragStart === undefined ? {} : { onDragStart: (e: ReactPointerEvent<HTMLElement>) => onDragStart(e, entry) })}
                {...(onBadgePress === undefined || entry.badge === undefined ? {} : { onBadgePress: () => onBadgePress(entry) })} />
            </li>
          ))}
        </ul>
      )}
      {entries.length > limit ? <IconButton icon={expanded || hiddenFresh ? 'chevron-up' : 'chevron'} label={expanded || hiddenFresh ? WORDS.label.showLess : WORDS.label.showMore} side="right" aria-expanded={expanded || hiddenFresh} data-more="" onClick={() => setExpanded(e => !e)} /> : null}
    </section>
  );
}
