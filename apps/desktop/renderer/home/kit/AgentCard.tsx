/**
 * The agent card of the map. It tells what the agent can do at a glance, without opening anything: a glyph tile, the agent's name, one line about its job, and
 * a row of count chips ("12 skills", "2 tools", "1 notes set"; a kind with nothing in it has no chip). A chip is a button that opens a mini accordion inside the
 * card, listing that kind's items by name, one to a line, with a small glyph of the kind. Several can be open at once. The list shows the first six and a
 * "Show more" button. Only the card that was opened grows. A line in a list is a button too: it selects that item and the details panel shows it.
 * Pressing the card anywhere else (the name, the empty parts of it) selects the agent. A line that has something to say keeps its small badge ("needs a key",
 * "2 different copies"), and the badge of copies is a button.
 * The keyboard goes through the card, then its chips, then the lines of the lists that are open. A closed list cannot be reached (it is inert and hidden).
 * A selected card is filled and has a 2 px accent edge, as every card does. A card whose item is selected keeps the same look (it is the owner), and the line
 * has an edge of its own.
 * The list opens and closes by letting its row grow from 0 to its natural height in 160 ms with the strong ease-out (a token); with reduce motion it is at once.
 */
import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { CARD_WORDS, CHIP_KINDS, chipLabel } from '../../../shared/home/cards.js';
import type { ShelfEntry, Shelves } from '../../../shared/home/cards.js';
import { WORDS } from '../words.js';
import { Badge } from './Badge.js';
import { Glyph } from './Glyph.js';
import { KitIcon } from './icons.js';

/** How many lines a list shows before "Show more". */
export const LIST_LIMIT = 6;

const PLURAL: Readonly<Record<ShelfEntry['kind'], string>> = { skill: 'skills', tool: 'tools', note: 'notes' };

export interface AgentCardProps {
  name: string;
  hint: string;
  shelves: Shelves;
  /** True when the agent itself is selected. */
  selected: boolean;
  /** The id of the selected item of this agent, if one is. The card is then the owner: it keeps the highlight, and that line has its own. */
  itemId?: string | null;
  onSelect(): void;
  onSelectItem(entry: ShelfEntry): void;
  /** Called when the person presses a badge of copies on a line. */
  onBadgePress?(entry: ShelfEntry): void;
  /** The id of the agent, so a drag can find the card it lands on. */
  dropAgent: string;
  dataTour?: string;
  fresh?: boolean;
  /** The kinds whose list starts open (the kit gallery and the tests draw them open). */
  defaultOpen?: readonly ShelfEntry['kind'][];
}

function Lines({ kind, entries, itemId, expanded, onSelectItem, onBadgePress, onMore }: {
  kind: ShelfEntry['kind']; entries: readonly ShelfEntry[]; itemId: string | null; expanded: boolean;
  onSelectItem(entry: ShelfEntry): void; onBadgePress?(entry: ShelfEntry): void; onMore(): void;
}): ReactElement {
  const shown = expanded ? entries : entries.slice(0, LIST_LIMIT);
  return (
    <>
      <ul className="kit-acc-list">
        {shown.map(entry => (
          <li key={entry.id} className="kit-acc-row" data-line={entry.id} data-selected={entry.id === itemId ? '' : undefined}>
            <button type="button" className="kit-acc-main" aria-pressed={entry.id === itemId} onClick={() => onSelectItem(entry)}>
              <KitIcon name={kind} size={16} /><span className="kit-acc-name">{entry.name}</span>
            </button>
            {entry.badge === undefined ? null : <span className="kit-acc-badge"><Badge badge={entry.badge} {...(onBadgePress === undefined || !entry.badge.label.endsWith(CARD_WORDS.copiesSuffix) ? {} : { onPress: () => onBadgePress(entry) })} /></span>}
          </li>
        ))}
      </ul>
      {entries.length > LIST_LIMIT ? (
        <button type="button" className="kit-acc-more" aria-expanded={expanded} aria-label={`${expanded ? WORDS.label.showLess : WORDS.label.showMore} ${PLURAL[kind]}`} onClick={onMore}>{expanded ? WORDS.label.showLess : WORDS.label.showMore}</button>
      ) : null}
    </>
  );
}

export function AgentCard({ name, hint, shelves, selected, itemId = null, onSelect, onSelectItem, onBadgePress, dropAgent, dataTour, fresh, defaultOpen = [] }: AgentCardProps): ReactElement {
  const nameId = useId(), hintId = useId(), base = useId();
  const [open, setOpen] = useState<ReadonlySet<ShelfEntry['kind']>>(new Set(defaultOpen));
  const [more, setMore] = useState<ReadonlySet<ShelfEntry['kind']>>(new Set());
  const flip = (set: ReadonlySet<ShelfEntry['kind']>, kind: ShelfEntry['kind']): ReadonlySet<ShelfEntry['kind']> => { const next = new Set(set); if (!next.delete(kind)) next.add(kind); return next; };
  const lists: Readonly<Record<ShelfEntry['kind'], readonly ShelfEntry[]>> = { skill: shelves.skills, tool: shelves.tools, note: shelves.notes };
  const kinds = CHIP_KINDS.filter(kind => lists[kind].length > 0);
  const owner = !selected && itemId !== null;
  return (
    <div className="kit-card" data-kind="agent" data-size="large" data-selected={selected ? '' : undefined} data-owner={owner ? '' : undefined} data-fresh={fresh === true ? '' : undefined} data-tour={dataTour} data-drop-agent={dropAgent}>
      <Glyph name="agent" size="large" />
      <button type="button" className="kit-card-main" id={nameId} aria-pressed={selected} aria-current={owner ? 'true' : undefined} aria-describedby={hintId} onClick={onSelect}>{name}</button>
      <p className="kit-hint kit-card-hint" id={hintId}>{hint}</p>
      {kinds.length === 0 ? null : (
        <div className="kit-chips" role="group" aria-labelledby={nameId}>
          {kinds.map(kind => (
            <button key={kind} type="button" className="kit-chip" data-kind={kind} aria-expanded={open.has(kind)} aria-controls={`${base}-${kind}`} onClick={() => setOpen(current => flip(current, kind))}>
              <span>{chipLabel(kind, lists[kind].length)}</span><KitIcon name="chevron" size={16} />
            </button>
          ))}
        </div>
      )}
      {kinds.map(kind => (
        <div key={kind} className="kit-acc" id={`${base}-${kind}`} data-kind={kind} data-open={open.has(kind) ? '' : undefined} inert={!open.has(kind)}>
          <div className="kit-acc-inner">
            <Lines kind={kind} entries={lists[kind]} itemId={itemId} expanded={more.has(kind)} onSelectItem={onSelectItem} onMore={() => setMore(current => flip(current, kind))} {...(onBadgePress === undefined ? {} : { onBadgePress })} />
          </div>
        </div>
      ))}
    </div>
  );
}
