/** STUB of the agents screen. A later slice replaces this file; it shows only the title and the number of agents in the world. */
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';

export function AgentsScreen({ world }: ScreenProps) {
  return (
    <div className="page">
      <h1 tabIndex={-1}>{ROUTE_LABELS.agents}</h1>
      <p className="muted">{countLine('agents', world)}</p>
    </div>
  );
}
