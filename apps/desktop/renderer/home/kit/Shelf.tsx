/** A titled row of cards, with a plain sentence when it is empty and "Show more" after eight. Every card on a shelf is the same ItemCard. */
import { useId, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { SHELF_LIMIT, visibleCount } from '../../../shared/home/cards.js';
import type { ShelfEntry } from '../../../shared/home/cards.js';
import { WORDS } from '../words.js';
import { Button } from './Button.js';
import { HelpPopover } from './HelpPopover.js';
import { ItemCard } from './ItemCard.js';

export interface ShelfProps {
  title: string;
  entries: readonly ShelfEntry[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** What the shelf says when it holds nothing. */
  emptyText: string;
  /** A "?" next to the title, with one sentence. */
  help?: { label: string; text: string };
  limit?: number;
  /** The heading level, so a shelf fits under whatever heading holds it. */
  level?: 2 | 3 | 4;
  onDragStart?(e: ReactPointerEvent<HTMLElement>, entry: ShelfEntry): void;
  onBadgePress?(entry: ShelfEntry): void;
  /** Gives every card a quiet "Remove" button. */
  onRemove?(entry: ShelfEntry): void;
  /** The id of the card that was just added, if it is on this shelf. */
  freshId?: string | null;
  /** Starts with the long list open (the kit gallery shows both). */
  defaultExpanded?: boolean;
}

export function Shelf({ title, entries, selectedId, onSelect, emptyText, help, limit = SHELF_LIMIT, level = 3, onDragStart, onBadgePress, onRemove, freshId = null, defaultExpanded = false }: ShelfProps): ReactElement {
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
        {help === undefined ? null : <HelpPopover label={help.label} text={help.text} size="small" />}
      </div>
      {entries.length === 0 ? <p className="kit-hint">{emptyText}</p> : (
        <ul className="kit-shelf-list">
          {entries.slice(0, shown).map(entry => (
            <li key={entry.id} data-entry={entry.id}>
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
      {entries.length > limit ? <Button aria-expanded={expanded || hiddenFresh} onClick={() => setExpanded(e => !e)}>{expanded || hiddenFresh ? WORDS.label.showLess : WORDS.label.showMore}</Button> : null}
    </section>
  );
}
