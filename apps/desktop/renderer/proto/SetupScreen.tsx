/** STUB of the setup screen. A later slice replaces this file; it shows only the title and the number of interfaces in the world. */
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';

export function SetupScreen({ world }: ScreenProps) {
  return (
    <div className="page">
      <h1 tabIndex={-1}>{ROUTE_LABELS.setup}</h1>
      <p className="muted">{countLine('setup', world)}</p>
    </div>
  );
}
