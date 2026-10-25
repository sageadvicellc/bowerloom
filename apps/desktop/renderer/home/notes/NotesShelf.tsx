/**
 * The Notes shelf with its "Choose notes" button. It is the kit's Shelf, unchanged, and one button that sits on the shelf's title row. The shell puts this
 * where it now draws the Notes shelf, and opens `ChooseNotes` from `onChoose`.
 */
import type { ReactElement } from 'react';
import type { ShelfEntry } from '../../../shared/home/cards.js';
import { Button } from '../kit/Button.js';
import { Shelf } from '../kit/Shelf.js';
import { NOTES_WORDS } from './notes-words.js';
import './notes.css';

export interface NotesShelfProps {
  entries: readonly ShelfEntry[];
  selectedId: string | null;
  onSelect(id: string): void;
  onRemove?(entry: ShelfEntry): void;
  freshId?: string | null;
  /** Called when the person presses "Choose notes". */
  onChoose(): void;
  /** False while there is no agent to choose for. */
  canChoose?: boolean;
}

export function NotesShelf({ entries, selectedId, onSelect, onRemove, freshId = null, onChoose, canChoose = true }: NotesShelfProps): ReactElement {
  return (
    <div className="nt-shelf" data-notes-shelf="">
      <Shelf title={NOTES_WORDS.label.notes} entries={entries} selectedId={selectedId} onSelect={onSelect} emptyText={NOTES_WORDS.hint.emptyShelf} freshId={freshId} {...(onRemove === undefined ? {} : { onRemove })} />
      <span className="nt-shelf-action"><Button icon="note" size="small" disabled={!canChoose} onClick={onChoose}>{NOTES_WORDS.label.choose}</Button></span>
    </div>
  );
}
