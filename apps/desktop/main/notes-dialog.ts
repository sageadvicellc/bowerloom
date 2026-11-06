/** The words of main's own notes chooser (spec 6.9; first five minutes, section 4, step 3). The window names the purpose only; main words the dialog. */
import type { NotesPurpose } from '../shared/engine/types.js';

export const NOTES_DIALOG: Readonly<Record<NotesPurpose, { readonly title: string; readonly message: string; readonly button: string }>> = Object.freeze({
  use: Object.freeze({ title: 'Choose your notes folder', message: 'Pick the folder that holds your notes.', button: 'Use this folder' }),
  start: Object.freeze({ title: 'Choose a folder for your notes', message: 'Pick an empty folder, or make a new one.', button: 'Start notes here' }),
});
