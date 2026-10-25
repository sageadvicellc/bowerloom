/**
 * The body of the Save points drawer: a list of the points the person has saved, newest first. Each row has its name, when it was made ("just now",
 * "2 saves ago", "when you began"), one short line about what changed, and "Go back to this" (the newest point says "You are here" instead). Going back
 * makes a new point equal to the old one, so nothing is lost and the list only grows. No sharing yet. The rows come from `savePointRows`.
 */
import type { ReactElement } from 'react';
import type { SavePointRow } from '../../../shared/home/points.js';
import { Button } from '../kit/Button.js';
import { WORDS } from '../words.js';
import './points.css';

export interface SavePointsProps {
  rows: readonly SavePointRow[];
  /** True when changes wait in the draft: going back would drop them, and the drawer says so. */
  unsaved: boolean;
  onGoBack(id: string): void;
}

export function SavePoints({ rows, unsaved, onGoBack }: SavePointsProps): ReactElement {
  if (rows.length === 0) return <p className="kit-hint">{WORDS.hint.savePointsEmpty}</p>;
  return (
    <>
      {unsaved ? <p className="kit-hint pt-warn" role="status">{WORDS.hint.pointsDirty}</p> : null}
      <ol className="pt-list" aria-label={WORDS.label.savePoints}>
        {rows.map(row => (
          <li key={row.id} className="pt-row" data-point={row.id} data-current={row.current ? '' : undefined}>
            <div className="pt-text">
              <p className="pt-name" id={`pt-name-${row.id}`}>{row.name}</p>
              <p className="kit-hint pt-when">{row.when}</p>
              {row.changes === '' ? null : <p className="kit-hint pt-changes">{row.changes}</p>}
            </div>
            {row.current
              ? <p className="kit-hint pt-here">{WORDS.hint.pointHere}</p>
              : <Button icon="clock" aria-labelledby={`pt-do-${row.id} pt-name-${row.id}`} onClick={() => onGoBack(row.id)}><span id={`pt-do-${row.id}`}>{WORDS.label.goBackToThis}</span></Button>}
          </li>
        ))}
      </ol>
    </>
  );
}
