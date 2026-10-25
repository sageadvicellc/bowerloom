/**
 * The agent tile of the map. Every agent tile has the same width and the same height (--hm-tile-w, --hm-tile-h) whatever the name or the counts, so the grid is
 * even. It holds a 24 px glyph tile and the name (one line, ellipsis; the whole name is in the details panel), the job (one line, ellipsis; the whole job is its hover text, and it is also in the details panel), and ONE line of
 * plain text buttons joined by dots: "12 skills · 2 tools · 1 note set" (a kind with nothing in it is left out, and the words are singular or plural to fit). No pills,
 * no wrapping and no list inside the tile: pressing a count opens that kind's list in a tray under the tile's row (see Tray.tsx and the map in HomeApp). The count button
 * has `aria-expanded` and `aria-controls`. Pressing the tile anywhere else (the name, the empty parts of it) selects the agent. The tiles of the map are one stop in the Tab order
 * (`tabStop`, a roving stop): the tile that has it is reached by Tab, then its counts; the arrow keys (the page, see HomeApp) move the stop to another tile. Enter picks the
 * tile; Space (`onSpace`) opens or closes its tray. A selected tile is filled and has a 2 px accent edge, as every card does; a tile whose item is selected keeps the same look (it is the owner), and a tile whose
 * tray is open keeps the accent edge.
 */
import { Fragment, useId } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { CHIP_KINDS, chipLabel } from '../../../shared/home/cards.js';
import type { ShelfEntry, Shelves } from '../../../shared/home/cards.js';
import { Glyph } from './Glyph.js';
import { trayId } from './Tray.js';

export interface AgentCardProps {
  name: string;
  hint: string;
  shelves: Shelves;
  /** True when the agent itself is selected. */
  selected: boolean;
  /** The id of the selected item of this agent, if one is. The tile is then the owner: it keeps the highlight. */
  itemId?: string | null;
  onSelect(): void;
  /** The kind whose tray is open under this tile, if any. */
  openKind?: ShelfEntry['kind'] | null;
  /** Called when the person presses a count. The page opens, switches or closes the tray. */
  onToggleKind?(kind: ShelfEntry['kind']): void;
  /** The id of the agent, so a drag can find the tile it lands on and the counts can name their tray. */
  dropAgent: string;
  dataTour?: string;
  fresh?: boolean;
  /** True when this tile is the one stop of the grid in the Tab order. The name and the counts of every other tile are reached by the arrow keys, not by Tab. Default: true. */
  tabStop?: boolean;
  /** Called when Space is pressed on the name: the page opens the tray of the first count, or closes the tray that is open. Without it Space picks the tile, as for any button. */
  onSpace?(): void;
}

export function AgentCard({ name, hint, shelves, selected, itemId = null, onSelect, openKind = null, onToggleKind, dropAgent, dataTour, fresh, tabStop = true, onSpace }: AgentCardProps): ReactElement {
  const nameId = useId(), hintId = useId();
  const lists: Readonly<Record<ShelfEntry['kind'], readonly ShelfEntry[]>> = { skill: shelves.skills, tool: shelves.tools, note: shelves.notes };
  const kinds = CHIP_KINDS.filter(kind => lists[kind].length > 0);
  const owner = !selected && itemId !== null;
  const stop = tabStop ? 0 : -1;
  // Space is answered on the key going down and the click that a button makes when the key comes up is stopped, so Space opens the tray and does not also pick the tile.
  const space = (e: KeyboardEvent<HTMLButtonElement>): void => { if (e.key === ' ' && onSpace !== undefined) { e.preventDefault(); if (e.type === 'keydown' && !e.repeat) onSpace(); } };
  return (
    <div className="kit-card" data-kind="agent" data-size="tile" data-selected={selected ? '' : undefined} data-owner={owner ? '' : undefined} data-tray={openKind !== null && !selected && !owner ? '' : undefined} data-fresh={fresh === true ? '' : undefined} data-tour={dataTour} data-drop-agent={dropAgent}>
      <Glyph name="agent" size="small" />
      <button type="button" className="kit-card-main" id={nameId} aria-pressed={selected} aria-current={owner ? 'true' : undefined} aria-describedby={hintId} tabIndex={stop} onKeyDown={space} onKeyUp={space} onClick={onSelect}>{name}</button>
      <p className="kit-hint kit-card-hint" id={hintId} title={hint} data-budget="tooltip">{hint}</p>
      <div className="kit-summary" role="group" aria-labelledby={nameId}>
        {kinds.map((kind, i) => (
          <Fragment key={kind}>
            {i === 0 ? null : <span className="kit-sep" aria-hidden="true">·</span>}
            <button type="button" className="kit-count" data-kind={kind} aria-expanded={openKind === kind} aria-controls={trayId(dropAgent, kind)} tabIndex={stop} onClick={() => onToggleKind?.(kind)}>{chipLabel(kind, lists[kind].length)}</button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
