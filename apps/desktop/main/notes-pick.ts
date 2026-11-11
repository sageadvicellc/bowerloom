/**
 * The pick of a notes folder in main's own chooser, and the approval it carries. When the person picks a folder to use as their notes ("Use my notes", `purpose` 'use'), the pick is the person's approval
 * to read that folder when a harness links it in `~/` form: `approveFolder` of packages/notes-source records it. This is the only caller of `approveFolder` in the app, and main/main.ts is the only caller of
 * this module (tests/notes-pick-pins.test.ts holds both). It is called only with the dialog's own answer; nothing from the window reaches it. "Start fresh" (`purpose` 'start') makes a new folder and
 * records nothing. A folder that could not be approved is told at once in a native message box, in words of its own, and the folder is handed back unchanged: the link itself still works.
 * This module imports no fs name.
 */
import { approvalKeyOf, approveFolder } from '../../../packages/notes-source/src/index.js';
import type { Approved } from '../../../packages/notes-source/src/index.js';
import type { NotesPurpose } from '../shared/engine/types.js';
import { clearPickFailure, recordPickFailure } from './pick-failures.js';

/** The words of a message box. `message` is the line, `detail` says what happens next. Each case has its own words and its own way out. */
export interface PickNotice { readonly message: string; readonly detail: string }
export const PICK_NOTICES: Readonly<Record<Exclude<Approved, 'kept'>, PickNotice>> = Object.freeze({
  full: { message: 'Bowerloom keeps at most 2000 approved folders.', detail: 'It will not read this folder.' },
  failed: { message: 'Bowerloom could not save approvals on this computer.', detail: '' },
  'not-a-folder': { message: 'That is not a folder Bowerloom can approve.', detail: '' },
  'not-moved': { message: 'Bowerloom could not set aside its damaged list of approvals.', detail: '' },
});

export interface PickDeps {
  readonly purpose: NotesPurpose;
  /** main's chooser: the folder the person picked, or null. */
  readonly show: () => Promise<string | null>;
  readonly stateRoot: string;
  /** Test use: another approver. Defaults to the package. */
  readonly approve?: typeof approveFolder;
  /** One fixed line for the log. It never holds a path. */
  readonly tell: (line: string) => void;
  /** The native message box. A failure of the box never changes the pick. */
  readonly warn: (notice: PickNotice) => Promise<void>;
}

export async function pickNotesFolder(d: PickDeps): Promise<string | null> {
  const picked = await d.show();
  if (picked === null || d.purpose !== 'use') return picked;
  const kept = (d.approve ?? approveFolder)(d.stateRoot, picked);
  // The last failure of this folder is kept in memory, so the Library says "could not save" for a link to it and not "link it again" (main/pick-failures.ts). A success clears it.
  const key = approvalKeyOf(picked);
  if (key !== null) { if (kept === 'kept') clearPickFailure(key); else recordPickFailure(key, kept === 'full' ? 'full' : 'failed'); }
  if (kept !== 'kept') {
    d.tell(`Bowerloom could not keep the approval of a notes folder (${kept}).`);
    try { await d.warn(PICK_NOTICES[kept]); } catch { /* the box failed; the line above is the record */ }
  }
  return picked;
}
