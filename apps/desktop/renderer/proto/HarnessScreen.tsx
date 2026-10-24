/** STUB of the harness screen. A later slice replaces this file; it shows only the title and the number of items in the world. */
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';

export function HarnessScreen({ world }: ScreenProps) {
  return (
    <div className="page">
      <h1 tabIndex={-1}>{ROUTE_LABELS.harness}</h1>
      <p className="muted">{countLine('harness', world)}</p>
    </div>
  );
}
