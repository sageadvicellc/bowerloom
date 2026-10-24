/** STUB of the skills screen. A later slice replaces this file; it shows only the title and the number of skills in the world. */
import { ROUTE_LABELS, countLine } from './words.js';
import type { ScreenProps } from './words.js';

export function SkillsScreen({ world }: ScreenProps) {
  return (
    <div className="page">
      <h1 tabIndex={-1}>{ROUTE_LABELS.skills}</h1>
      <p className="muted">{countLine('skills', world)}</p>
    </div>
  );
}
