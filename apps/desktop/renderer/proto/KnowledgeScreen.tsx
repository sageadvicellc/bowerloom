/** STUB of the knowledge screen. A later slice replaces this file; it shows only the title and the number of pages in the world. */
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';

export function KnowledgeScreen({ world }: ScreenProps) {
  return (
    <div className="page">
      <h1 tabIndex={-1}>{ROUTE_LABELS.knowledge}</h1>
      <p className="muted">{countLine('knowledge', world)}</p>
    </div>
  );
}
