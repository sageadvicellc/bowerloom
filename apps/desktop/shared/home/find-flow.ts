/**
 * The Find flow of the first minute, as a pure machine: the search lights step by step, the list shows (a tick is an agent; the machine only knows ids), the person ticks the ones to read, and a second
 * question comes before anything is read ("Read what is inside?"). Nothing is read before the person says yes to that question. No React, no DOM, no clock:
 * the screen decides when each step happens (a timer, or at once under reduce motion) and sends the matching action.
 *
 * Steps: `looking` (tiles lighting), `places` (the list, with ticks), `confirm` (the second question), `reading` (a short progress), `done` (read,
 * the map comes next) and `left` (the person said "Not now"). A state is frozen. An action that does not fit the step returns the very same state.
 */

export type FindStep = 'looking' | 'places' | 'confirm' | 'reading' | 'done' | 'left';

export interface FindState {
  readonly step: FindStep;
  /** How many tiles there are, and how many are lit so far. */
  readonly tiles: number;
  readonly lit: number;
  /** Every place that was found, in list order, and the ones that are ticked (a subset of `places`, in the same order). */
  readonly places: readonly string[];
  readonly ticked: readonly string[];
  /** How many ticked places have been read so far. */
  readonly read: number;
}

export type FindAction =
  | { readonly type: 'light' } | { readonly type: 'lightAll' } | { readonly type: 'settle' }
  | { readonly type: 'toggle'; readonly id: string }
  /** Ticks every id, or unticks every id except those in `keep` (the ones that cannot be skipped). Only on the list step. */
  | { readonly type: 'selectAll' } | { readonly type: 'clear'; readonly keep: readonly string[] }
  | { readonly type: 'looksRight' } | { readonly type: 'back' } | { readonly type: 'yes' } | { readonly type: 'notNow' }
  /** The list step ends at once, with at least one agent ticked: used when the contents were already read (the setup of a real person), so no second question is asked. */
  | { readonly type: 'choose' }
  | { readonly type: 'read' } | { readonly type: 'readAll' };

const make = (s: FindState, change: Partial<FindState>): FindState => Object.freeze({ ...s, ...change });

/** A flow at its first step. `ticked` is the person's earlier choice (Find more); ids that are not places are dropped, and every place is ticked when it is left out. */
export function startFind(tiles: number, places: readonly string[], ticked?: readonly string[]): FindState {
  const keep = ticked === undefined ? places : places.filter(id => ticked.includes(id));
  return Object.freeze({ step: 'looking', tiles, lit: 0, places: Object.freeze([...places]), ticked: Object.freeze([...keep]), read: 0 });
}

/** How many places will be read. */
export const readTotal = (s: FindState): number => s.ticked.length;

export function findReduce(s: FindState, action: FindAction): FindState {
  switch (action.type) {
    case 'light': return s.step === 'looking' && s.lit < s.tiles ? make(s, { lit: s.lit + 1 }) : s;
    case 'lightAll': return s.step === 'looking' ? make(s, { step: 'places', lit: s.tiles }) : s;
    case 'settle': return s.step === 'looking' && s.lit >= s.tiles ? make(s, { step: 'places' }) : s;
    case 'toggle': {
      if (s.step !== 'places' || !s.places.includes(action.id)) return s;
      const on = s.ticked.includes(action.id);
      return make(s, { ticked: Object.freeze(s.places.filter(id => (id === action.id ? !on : s.ticked.includes(id)))) });
    }
    case 'selectAll': return s.step === 'places' ? make(s, { ticked: Object.freeze([...s.places]) }) : s;
    case 'clear': return s.step === 'places' ? make(s, { ticked: Object.freeze(s.places.filter(id => action.keep.includes(id))) }) : s;
    case 'choose': return s.step === 'places' && s.ticked.length > 0 ? make(s, { step: 'done', read: s.ticked.length }) : s;
    case 'looksRight': return s.step === 'places' && s.ticked.length > 0 ? make(s, { step: 'confirm', read: 0 }) : s;
    case 'back': return s.step === 'confirm' ? make(s, { step: 'places' }) : s;
    case 'yes': return s.step === 'confirm' ? make(s, { step: 'reading', read: 0 }) : s;
    case 'notNow': return s.step === 'places' || s.step === 'confirm' ? make(s, { step: 'left' }) : s;
    case 'read': {
      if (s.step !== 'reading') return s;
      const read = s.read + 1;
      return read >= s.ticked.length ? make(s, { step: 'done', read: s.ticked.length }) : make(s, { read });
    }
    case 'readAll': return s.step === 'reading' ? make(s, { step: 'done', read: s.ticked.length }) : s;
  }
}
