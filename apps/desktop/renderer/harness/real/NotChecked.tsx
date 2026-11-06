/**
 * What the screens that say where something works show for the person's own folders. The reader cannot prove that a part works in any program, so it says where the part was found,
 * says "Not checked", and adds the model badge the reader gave an agent. A list of programs here would be a claim nothing supports.
 */
import type { ReactElement } from 'react';
import type { Part } from '../../../shared/harness/types.js';
import { REAL, foundInLine, modelBadgeLine } from './words-real.js';

export function NotChecked({ part }: { part?: Part | undefined }): ReactElement {
  return (
    <div className="hx-not-checked" data-not-checked="">
      {part === undefined ? null : <p className="hx-text hx-muted" data-found-in="">{foundInLine(part.source)}</p>}
      <p className="hx-text">{REAL.label.notChecked}</p>
      {part?.badge === undefined ? null : <p className="hx-text hx-muted" data-model-badge="">{modelBadgeLine(part.badge)}</p>}
    </div>
  );
}
