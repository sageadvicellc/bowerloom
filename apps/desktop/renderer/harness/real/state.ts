/**
 * The steps of the real Choose screen. It is the home app's machine (renderer/home/real/flow.ts, which cannot skip a question) plus cases of its own: the folders were read and held
 * nothing, so the person goes back to the list of folders with what the reader said, and may add a folder or look at the sample; a folder that is already listed says so and adds nothing
 * twice; and a folder that arrives after the person has gone on is kept (not ticked) and said on the list, never dropped.
 */
import { realReduce, startState } from '../../home/real/flow.js';
import type { RealAction, RealState } from '../../home/real/flow.js';
import type { RealNotes } from '../../../shared/harness/types.js';
import type { RealDiscovery, RealPlace } from '../../../shared/real/types.js';

export interface ChooseState extends RealState {
  /** True after a read that found no agent, skill, tool or notes in the ticked folders. */
  readonly nothingRead: boolean;
  /** What the reader said about that empty read (things it could not read, that it stopped early, its notes), or null. */
  readonly readNotes: RealNotes | null;
  /** True right after a folder was added that the list already held. */
  readonly alreadyListed: boolean;
  /** True after a folder was added while the person was past the list (at the second question). It is in the list, not ticked. */
  readonly addedAway: boolean;
}
export type ChooseAction = RealAction | { readonly type: 'emptied'; readonly real: RealNotes };

export const firstState = (): ChooseState => ({ ...startState(), nothingRead: false, readNotes: null, alreadyListed: false, addedAway: false });

const merge = (old: readonly RealPlace[], added: readonly RealPlace[]): RealPlace[] => [...new Map([...old, ...added].map(p => [p.id, p] as const)).values()];

/** A folder that was added: nothing twice for one already listed, and the person's ticks unchanged when it comes after the list. */
function picked(state: ChooseState, found: RealDiscovery): ChooseState {
  const known = new Set(state.places.map(p => p.id)), fresh = found.places.filter(p => !known.has(p.id));
  if (found.places.length > 0 && fresh.length === 0) return { ...state, alreadyListed: true, pickedNothing: false };
  if (state.step === 'places') {
    const next = realReduce(state, { type: 'picked', found, cancelled: false });
    return { ...next, nothingRead: fresh.length > 0 ? false : state.nothingRead, readNotes: fresh.length > 0 ? null : state.readNotes, alreadyListed: false, addedAway: false };
  }
  // At the second question, while reading, or on an error: the reader asked for this folder, so it joins the list, unticked (the person confirmed other ticks, and those stand).
  if (state.step === 'looking' || state.step === 'start') return state;
  return {
    ...state, places: merge(state.places, found.places), couldNotRead: state.couldNotRead + found.couldNotRead, stoppedEarly: state.stoppedEarly || found.stoppedEarly,
    notes: [...new Set([...state.notes, ...found.notes])], pickedNothing: false, alreadyListed: false, addedAway: true,
  };
}

export function reduceChoose(state: ChooseState, action: ChooseAction): ChooseState {
  if (action.type === 'emptied') return state.step === 'reading' ? { ...state, step: 'places', nothingRead: true, readNotes: action.real, alreadyListed: false, addedAway: false } : state;
  if (action.type === 'picked' && !action.cancelled) return picked(state, action.found);
  const next = realReduce(state, action);
  if (next === state) return state;
  const inList = next.step === 'places', keep = action.type !== 'looksRight';
  return {
    ...next, nothingRead: state.nothingRead && inList && keep, readNotes: state.nothingRead && inList && keep ? state.readNotes : null,
    alreadyListed: false, addedAway: state.addedAway && inList && action.type !== 'toggle' && keep,
  };
}
