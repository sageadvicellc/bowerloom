/**
 * The two notes of the kept read. `LastRead` is drawn on the Read screen: the time of the last read, one line about it (the folders are being checked, they changed, or nothing was read just
 * now), and "Read again", which goes back to the first question. `SavedDamagedNote` is drawn on the Welcome screen when the kept read could not be used. Both draw nothing when there is
 * nothing to say. The lines are ours, drawn as text.
 */
import type { ReactElement } from 'react';
import { HButton } from '../parts/controls.js';
import { useSavedScan } from './saved-scan.js';
import { REAL, savedAtLine } from './words-real.js';
import './real.css';

export function LastRead(): ReactElement | null {
  const saved = useSavedScan();
  if (saved.readAtMs === null) return null;
  const status = saved.changed ? REAL.hint.folderChanged : saved.checking ? REAL.hint.checkingFolders : saved.fromSaved ? REAL.hint.savedShown : '';
  return (
    <div className="hxr-lastread" data-last-read="">
      <p className="hxr-count" data-last-read-time="">{savedAtLine(saved.readAtMs)}</p>
      {status === '' ? null : <p className="hxf-status hxr-lastread-status" role="status" {...(saved.changed ? { 'data-folder-changed': '' } : {})}>{status}</p>}
      <HButton icon="search" onClick={saved.readAgain}>{REAL.label.readAgain}</HButton>
    </div>
  );
}

export function SavedDamagedNote(): ReactElement | null {
  const saved = useSavedScan();
  return saved.damaged ? <p className="hxf-plain" role="status" data-saved-damaged="">{REAL.hint.savedDamaged}</p> : null;
}
