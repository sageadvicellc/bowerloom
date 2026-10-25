/**
 * "Remove from the library?": says what removing does, in the person's own words ("This takes it off 3 agents."), names the agents, and says that nothing changes
 * until Save. "Remove from library" stages one change (the store takes the thing out of the library and off every agent in one step); "Cancel", Escape and the
 * scrim stage nothing.
 */
import { useId } from 'react';
import type { ReactElement } from 'react';
import type { AgentRef } from '../../../shared/home/details.js';
import { Button } from '../kit/Button.js';
import { LibraryDialog } from './LibraryDialog.js';
import { LIBRARY_WORDS } from './library-words.js';

const L = LIBRARY_WORDS.label, H = LIBRARY_WORDS.hint;

export interface RemoveDialogProps {
  name: string;
  line: string;
  agents: readonly AgentRef[];
  leaving: boolean;
  onClose(): void;
  onConfirm(): void;
  restoreFocus?(): HTMLElement | null;
}

export function RemoveDialog({ name, line, agents, leaving, onClose, onConfirm, restoreFocus }: RemoveDialogProps): ReactElement {
  const lineId = useId();
  return (
    <LibraryDialog title={L.removeTitle} name={name} leaving={leaving} size="small" describedBy={lineId} onClose={onClose} dataDialog="remove" {...(restoreFocus === undefined ? {} : { restoreFocus })}>
      <div className="lb-dialog-body">
        <p id={lineId} data-line="">{line}</p>
        {agents.length === 0 ? null : <ul className="lb-names" aria-label={L.usedBy}>{agents.map(a => <li key={a.id}>{a.name}</li>)}</ul>}
        <p className="kit-hint">{H.removeTip}</p>
      </div>
      <div className="lb-dialog-foot">
        <Button onClick={onClose}>{L.cancel}</Button>
        <Button variant="primary" onClick={onConfirm}>{L.removeFromLibrary}</Button>
      </div>
    </LibraryDialog>
  );
}
