/** STUB of the versions screen. A later slice replaces this file; it shows only the title and the number of versions in the world. */
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';

export function VersionsScreen({ world }: ScreenProps) {
  return (
    <div className="page">
      <h1 tabIndex={-1}>{ROUTE_LABELS.versions}</h1>
      <p className="muted">{countLine('versions', world)}</p>
    </div>
  );
}
