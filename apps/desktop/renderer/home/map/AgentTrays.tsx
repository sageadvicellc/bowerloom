/**
 * The trays of the agents in one grid row: for each agent, one tray for each kind it holds. Only the one the page has open has any height; the others are inert.
 * The row of the grid puts them after its last tile (see HomeApp), as wide as the row.
 */
import type { ReactElement } from 'react';
import { CHIP_KINDS } from '../../../shared/home/cards.js';
import type { ShelfEntry, Shelves } from '../../../shared/home/cards.js';
import { Tray } from '../kit/Tray.js';

export interface TrayAgent { readonly id: string; readonly name: string; readonly shelves: Shelves; readonly itemId: string | null }

export function AgentTrays({ agents, open, onSelectItem, onBadgePress }: {
  agents: readonly TrayAgent[];
  open: { readonly agentId: string; readonly kind: ShelfEntry['kind'] } | null;
  onSelectItem(agentId: string, entry: ShelfEntry): void;
  onBadgePress?(entry: ShelfEntry): void;
}): ReactElement {
  return (
    <>
      {agents.map(agent => {
        const lists: Readonly<Record<ShelfEntry['kind'], readonly ShelfEntry[]>> = { skill: agent.shelves.skills, tool: agent.shelves.tools, note: agent.shelves.notes };
        return CHIP_KINDS.filter(kind => lists[kind].length > 0).map(kind => (
          <Tray key={`${agent.id}:${kind}`} agentId={agent.id} agentName={agent.name} kind={kind} entries={lists[kind]} itemId={agent.itemId} open={open !== null && open.agentId === agent.id && open.kind === kind}
            onSelectItem={entry => onSelectItem(agent.id, entry)} {...(onBadgePress === undefined ? {} : { onBadgePress })} />
        ));
      })}
    </>
  );
}
