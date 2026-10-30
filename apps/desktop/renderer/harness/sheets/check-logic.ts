/**
 * The after-apply check, as plain logic: the three steps of "Did this do what you wanted?" and what each tap records. The component
 * (after-apply-check.tsx) holds no rule of its own, so tests read every step here.
 */
import { CHECK_NOTE_LIMIT } from '../../../shared/engine/types.js';
import type { CheckAnswer } from '../../../shared/engine/types.js';

export type CheckState =
  | { readonly step: 'ask' }
  | { readonly step: 'why'; readonly answer: 'partly' | 'no'; readonly note: string }
  | { readonly step: 'thanks' };

export const CHECK_START: CheckState = Object.freeze({ step: 'ask' });

export type CheckAction =
  | { readonly kind: 'answer'; readonly answer: CheckAnswer }
  | { readonly kind: 'type'; readonly note: string }
  | { readonly kind: 'save' }
  | { readonly kind: 'skip' };

/** What one action records: an answer, with the note or without it. */
export interface CheckRecord { readonly answer: CheckAnswer; readonly note: string | null }

/** At most 500 characters, as the person typed them. */
export const cappedNote = (note: string): string => (note.length > CHECK_NOTE_LIMIT ? note.slice(0, CHECK_NOTE_LIMIT) : note);

/**
 * The next state and the line to record, if any. Yes records at once. Partly and No ask what the person was trying to do and record nothing yet; Save records
 * the answer with the note (an empty note is none), and Skip records the answer without it. After that the check says thanks and takes no more taps.
 */
export function checkNext(state: CheckState, action: CheckAction): { readonly state: CheckState; readonly record: CheckRecord | null } {
  if (state.step === 'ask' && action.kind === 'answer') {
    if (action.answer === 'yes') return { state: { step: 'thanks' }, record: { answer: 'yes', note: null } };
    return { state: { step: 'why', answer: action.answer, note: '' }, record: null };
  }
  if (state.step === 'why') {
    if (action.kind === 'type') return { state: { ...state, note: cappedNote(action.note) }, record: null };
    if (action.kind === 'skip') return { state: { step: 'thanks' }, record: { answer: state.answer, note: null } };
    if (action.kind === 'save') {
      const note = state.note.trim();
      return { state: { step: 'thanks' }, record: { answer: state.answer, note: note === '' ? null : note } };
    }
  }
  return { state, record: null };
}
