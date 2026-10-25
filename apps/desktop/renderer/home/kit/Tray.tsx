/**
 * The tray of an agent tile: the list of one kind (skills, tools or note sets) of one agent. It sits directly under the grid row of its tile, as wide as the row, and
 * pushes the later rows down. It lists the items as the kit's compact rows, in columns that fill the width, and shows the first 12 with a "Show more" button. A row is a
 * button: it selects that item and the details panel shows it. A row that has something to say keeps its state ("2 different copies", "needs a key"), and the state of
 * copies is a text button too. It opens and closes by letting its grid row grow from 0 to its own height in 160 ms with the strong ease-out (the accordion token); with
 * reduce motion it is at once. A tray that is closed is inert and hidden, so the keyboard cannot reach it. The tile owns the tray: the count button on the tile has
 * `aria-expanded` and `aria-controls` that point at the tray's id (`trayId`).
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { CARD_WORDS } from '../../../shared/home/cards.js';
import type { ShelfEntry } from '../../../shared/home/cards.js';
import { WORDS } from '../words.js';
import { ItemCard } from './ItemCard.js';

/** How many rows a tray shows before "Show more". */
export const TRAY_LIMIT = 12;

const PLURAL: Readonly<Record<ShelfEntry['kind'], string>> = { skill: 'skills', tool: 'tools', note: 'notes' };

/** The id of the tray of one kind of one agent. The count button on the tile points at it with `aria-controls`. */
export const trayId = (agentId: string, kind: ShelfEntry['kind']): string => `tray-${agentId}-${kind}`;

export interface TrayProps {
  agentId: string;
  /** The agent's name, for the name of the region that a screen reader hears. */
  agentName: string;
  kind: ShelfEntry['kind'];
  entries: readonly ShelfEntry[];
  open: boolean;
  /** The id of the selected item of this agent, if one is. */
  itemId?: string | null;
  onSelectItem(entry: ShelfEntry): void;
  /** Called when the person presses a state of copies on a row. */
  onBadgePress?(entry: ShelfEntry): void;
}

export function Tray({ agentId, agentName, kind, entries, open, itemId = null, onSelectItem, onBadgePress }: TrayProps): ReactElement {
  const [more, setMore] = useState(false);
  const shown = more ? entries : entries.slice(0, TRAY_LIMIT);
  return (
    <div className="kit-tray" id={trayId(agentId, kind)} data-kind={kind} data-agent={agentId} data-open={open ? '' : undefined} inert={!open} role="group" aria-label={`${agentName}: ${PLURAL[kind]}`}>
      <div className="kit-tray-inner">
        <div className="kit-tray-body">
          <ul className="kit-tray-list">
            {shown.map(entry => (
              <li key={entry.id} data-line={entry.id}>
                <ItemCard kind={entry.kind} name={entry.name} selected={entry.id === itemId} onSelect={() => onSelectItem(entry)}
                  {...(entry.hint === undefined ? {} : { hint: entry.hint })}
                  {...(entry.badge === undefined ? {} : { badge: entry.badge })}
                  {...(onBadgePress === undefined || entry.badge === undefined || !entry.badge.label.endsWith(CARD_WORDS.copiesSuffix) ? {} : { onBadgePress: () => onBadgePress(entry) })} />
              </li>
            ))}
          </ul>
          {entries.length > TRAY_LIMIT ? (
            <button type="button" className="kit-tray-more" aria-expanded={more} aria-label={`${more ? WORDS.label.showLess : WORDS.label.showMore} ${PLURAL[kind]}`} onClick={() => setMore(m => !m)}>{more ? WORDS.label.showLess : WORDS.label.showMore}</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
