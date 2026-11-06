/**
 * The steps of the real-setup reader as a pure machine, so the order can be tested with no screen. The person asks to find the setup (step one: places and counts), ticks
 * the places, confirms (the second question), and only then are the contents read (step two). Nothing is read in step two for a place that was not ticked, and a step
 * cannot be skipped: `yes` works only from `confirm`, and `confirm` is reached only from `places` with at least one place ticked.
 */
import type { RealDiscovery, RealPlace } from '../../../shared/real/types.js';

export type RealStep = 'start' | 'looking' | 'places' | 'confirm' | 'reading' | 'done' | 'error';

export interface RealState {
  readonly step: RealStep;
  readonly places: readonly RealPlace[];
  readonly ticked: readonly string[];
  readonly couldNotRead: number;
  readonly stoppedEarly: boolean;
  readonly notes: readonly string[];
  /** The short code of the last failure. */
  readonly error: string;
  /** Where "Try again" goes back to. */
  readonly retry: 'start' | 'places';
  /** The note after the folder chooser was closed with no folder. */
  readonly pickedNothing: boolean;
}

export type RealAction =
  | { readonly type: 'find' }
  | { readonly type: 'found'; readonly found: RealDiscovery }
  | { readonly type: 'picked'; readonly found: RealDiscovery; readonly cancelled: boolean }
  | { readonly type: 'toggle'; readonly id: string }
  | { readonly type: 'looksRight' }
  | { readonly type: 'yes' }
  | { readonly type: 'back' }
  | { readonly type: 'notNow' }
  | { readonly type: 'done' }
  | { readonly type: 'fail'; readonly code: string }
  | { readonly type: 'retry' };

export const startState = (): RealState => ({ step: 'start', places: [], ticked: [], couldNotRead: 0, stoppedEarly: false, notes: [], error: '', retry: 'start', pickedNothing: false });

/** The places of two lists, the first list's order first, each id once (a later copy replaces an earlier one). */
function merge(old: readonly RealPlace[], added: readonly RealPlace[]): RealPlace[] {
  const out = new Map(old.map(p => [p.id, p] as const));
  for (const p of added) out.set(p.id, p);
  return [...out.values()];
}

export function realReduce(state: RealState, action: RealAction): RealState {
  switch (action.type) {
    case 'find': return state.step === 'start' || state.step === 'error' ? { ...startState(), step: 'looking' } : state;
    case 'found': {
      if (state.step !== 'looking') return state;
      const f = action.found;
      return { ...state, step: 'places', places: f.places, ticked: f.places.filter(p => !p.empty).map(p => p.id), couldNotRead: f.couldNotRead, stoppedEarly: f.stoppedEarly, notes: f.notes, pickedNothing: false };
    }
    case 'picked': {
      if (state.step !== 'places') return state;
      if (action.cancelled) return { ...state, pickedNothing: true };
      const known = new Set(state.places.map(p => p.id)), fresh = action.found.places.filter(p => !known.has(p.id));
      return { ...state, places: merge(state.places, action.found.places), ticked: [...state.ticked, ...fresh.filter(p => !p.empty).map(p => p.id)], couldNotRead: state.couldNotRead + action.found.couldNotRead, stoppedEarly: state.stoppedEarly || action.found.stoppedEarly, notes: [...new Set([...state.notes, ...action.found.notes])], pickedNothing: false };
    }
    case 'toggle': {
      if (state.step !== 'places' || !state.places.some(p => p.id === action.id)) return state;
      return { ...state, ticked: state.ticked.includes(action.id) ? state.ticked.filter(id => id !== action.id) : [...state.ticked, action.id] };
    }
    case 'looksRight': return state.step === 'places' && state.ticked.length > 0 ? { ...state, step: 'confirm' } : state;
    case 'back': return state.step === 'confirm' ? { ...state, step: 'places' } : state;
    case 'notNow': return state.step === 'confirm' || state.step === 'places' ? { ...state, step: 'places' } : state;
    case 'yes': return state.step === 'confirm' ? { ...state, step: 'reading' } : state;
    case 'done': return state.step === 'reading' ? { ...state, step: 'done' } : state;
    case 'fail': return state.step === 'looking' || state.step === 'reading' || state.step === 'places' ? { ...state, step: 'error', error: action.code, retry: state.step === 'looking' ? 'start' : 'places' } : state;
    case 'retry': return state.step === 'error' ? (state.retry === 'start' ? startState() : { ...state, step: 'places', error: '' }) : state;
  }
}

/** The ids to hand to the second step: the ticked places, in list order, each once. */
export const selectedIds = (state: RealState): string[] => state.places.filter(p => state.ticked.includes(p.id)).map(p => p.id);

/** How many agents the ticked places hold. */
export const agentsTicked = (state: RealState): number => state.places.filter(p => state.ticked.includes(p.id)).reduce((n, p) => n + p.counts.agents, 0);
