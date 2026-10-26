/**
 * The body of the Version history drawer: a list of the points the person has saved, newest first. Each row has its name, the time it was made ("Today, 8:42 AM", read from
 * the clock when it was saved), then how long ago in words ("just now", the name of a point says what changed ("Removed List action items"), and a line under it only when the name does not, and "Go back to this" (the newest point says "You are here" instead). Going back
 * makes a new point equal to the old one, so nothing is lost and the list only grows. The rows come from `savePointRows`. Under the list, Share has its
 * own section: "Share my agents" and "Open a shared file" (storyboard open question 4: Share lives in this drawer, not in the main window).
 */
import type { ReactElement } from 'react';
import type { SavePointRow } from '../../../shared/home/points.js';
import { Button } from '../kit/Button.js';
import { ShareSection } from '../share/ShareSection.js';
import { WORDS } from '../words.js';
import './points.css';
import { EditButton } from '../read-only.js';

export interface SavePointsProps {
  rows: readonly SavePointRow[];
  /** True when changes wait in the draft: going back would drop them, and the drawer says so. */
  unsaved: boolean;
  /** Which changes wait ("Removed Write a reply and List action items"), said under the warning, so it never says that something will go without saying what. */
  which?: string | null;
  onGoBack(id: string): void;
  /** Called when the person asks to share their agents. */
  onShare(): void;
  /** Called when the person asks to open a shared file. */
  onOpenFile(): void;
}

/** True when the name of a point already says what changed ("Removed Write a reply"), so the line under it would only say it again, less well. */
const namesChange = (name: string): boolean => /^(Removed|Added|Changed|Kept)\b/.test(name);

export function SavePoints({ rows, unsaved, which = null, onGoBack, onShare, onOpenFile }: SavePointsProps): ReactElement {
  const share = <ShareSection onShare={onShare} onOpenFile={onOpenFile} />;
  if (rows.length === 0) return <><p className="kit-hint">{WORDS.hint.historyEmpty}</p>{share}</>;
  return (
    <>
      {unsaved ? (
        <div className="pt-dirty" role="status" data-dirty="">
          <p className="kit-status pt-warn" data-tone="warn"><span className="kit-dot" aria-hidden="true" /><span>{WORDS.hint.pointsDirty}</span></p>
          {which === null ? null : <p className="pt-which" data-which="">{which}</p>}
        </div>
      ) : null}
      <ol className="pt-list" aria-label={WORDS.label.versionHistory}>
        {rows.map(row => (
          <li key={row.id} className="pt-row" data-point={row.id} data-current={row.current ? '' : undefined}>
            <div className="pt-text">
              <p className="pt-name" id={`pt-name-${row.id}`}>{row.name}</p>
              {row.madeAt === undefined || row.madeAt === '' ? null : <p className="pt-clock" data-clock="">{row.madeAt}</p>}
              <p className="kit-hint pt-when">{row.when}</p>
              {row.changes === '' || namesChange(row.name) ? null : <p className="kit-hint pt-changes">{row.changes}</p>}
            </div>
            {row.current
              ? <p className="kit-hint pt-here">{WORDS.hint.pointHere}</p>
              : <EditButton icon="clock" aria-labelledby={`pt-do-${row.id} pt-name-${row.id}`} onClick={() => onGoBack(row.id)}><span id={`pt-do-${row.id}`}>{WORDS.label.goBackToThis}</span></EditButton>}
          </li>
        ))}
      </ol>
      {share}
    </>
  );
}
