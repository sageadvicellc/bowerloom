/**
 * The setup flow as a pure reducer (spec 6.1, 6.2 and journey 1): which step shows, which folders were picked, which places are ticked,
 * and which conflicts the person settled. It holds the state of the screen only. Nothing is read or written anywhere, and nothing here
 * touches the store: the screen sends the store its own actions. An action that changes nothing returns the very same state.
 * Pure: no clock, no random number, no file. The input is never changed.
 */
import { globalScope } from './common.js';
import type { World } from './types.js';

/** The steps in order. `done` is the end state of `bring-in`. */
export type SetupStep = 'welcome' | 'places' | 'contents' | 'review' | 'bring-in' | 'done';

export const FLOW_STEPS: readonly SetupStep[] = Object.freeze(['welcome', 'places', 'contents', 'review', 'bring-in', 'done'] as const);

/** The heading of each step. */
export const STEP_TITLES: Readonly<Record<SetupStep, string>> = Object.freeze({
  welcome: 'Welcome',
  places: 'Look for settings folders',
  contents: 'Choose what to read',
  review: 'Review what was found',
  'bring-in': 'Bring these in',
  done: 'Everything is brought in',
});

export interface SetupState {
  readonly step: SetupStep;
  readonly pickersOpen: boolean;
  readonly harnessRoot: string | null;
  readonly knowledgeRoot: string | null;
  readonly scanned: boolean;
  /** The ids of the ticked places, in the order they were ticked. */
  readonly ticked: readonly string[];
  /** Item id to a plain sentence about how the person settled that conflict. */
  readonly resolved: Readonly<Record<string, string>>;
  readonly broughtIn: boolean;
}

export type SetupAction =
  | { readonly type: 'openPickers' }
  | { readonly type: 'pickHarnessRoot'; readonly path: string }
  | { readonly type: 'pickKnowledgeRoot'; readonly path: string }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'scan' }
  | { readonly type: 'tick'; readonly id: string }
  | { readonly type: 'tickAll'; readonly ids: readonly string[] }
  | { readonly type: 'tickNone' }
  | { readonly type: 'resolved'; readonly itemId: string; readonly summary: string }
  | { readonly type: 'bringIn' }
  | { readonly type: 'reset' };

export function initialSetup(): SetupState {
  return { step: 'welcome', pickersOpen: false, harnessRoot: null, knowledgeRoot: null, scanned: false, ticked: [], resolved: {}, broughtIn: false };
}

/** "Step 2 of 5": the number of a step. The done state counts as the last step. */
export function stepNumber(step: SetupStep): number {
  return Math.min(FLOW_STEPS.indexOf(step), 4) + 1;
}

/** Number of steps a person counts: five. */
export const STEP_COUNT = 5;

function forward(state: SetupState): SetupState {
  switch (state.step) {
    case 'welcome': return state.harnessRoot !== null && state.knowledgeRoot !== null ? { ...state, step: 'places' } : state;
    case 'places': return state.scanned ? { ...state, step: 'contents' } : state;
    case 'contents': return state.ticked.length > 0 ? { ...state, step: 'review' } : state;
    case 'review': return { ...state, step: 'bring-in' };
    default: return state;
  }
}

const BACK: Readonly<Partial<Record<SetupStep, SetupStep>>> = { places: 'welcome', contents: 'places', review: 'contents', 'bring-in': 'review' };

/** The rule of the flow: a state and an action in, the next state out. */
export function reduceSetup(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case 'openPickers': return state.pickersOpen ? state : { ...state, pickersOpen: true };
    case 'pickHarnessRoot': return action.path === '' || action.path === state.harnessRoot ? state : { ...state, harnessRoot: action.path };
    case 'pickKnowledgeRoot': return action.path === '' || action.path === state.knowledgeRoot ? state : { ...state, knowledgeRoot: action.path };
    case 'next': return forward(state);
    case 'back': { const earlier = BACK[state.step]; return earlier === undefined ? state : { ...state, step: earlier }; }
    case 'scan': return state.step !== 'places' || state.scanned ? state : { ...state, scanned: true };
    case 'tick':
      if (action.id === '') return state;
      return { ...state, ticked: state.ticked.includes(action.id) ? state.ticked.filter(t => t !== action.id) : [...state.ticked, action.id] };
    case 'tickAll': {
      const added = action.ids.filter((id, n) => id !== '' && !state.ticked.includes(id) && action.ids.indexOf(id) === n);
      return added.length === 0 ? state : { ...state, ticked: [...state.ticked, ...added] };
    }
    case 'tickNone': return state.ticked.length === 0 ? state : { ...state, ticked: [] };
    case 'resolved': return action.itemId === '' ? state : { ...state, resolved: { ...state.resolved, [action.itemId]: action.summary } };
    case 'bringIn': return state.step !== 'bring-in' ? state : { ...state, step: 'done', broughtIn: true };
    case 'reset': return initialSetup();
  }
}

// ---------------------------------------------------------------------------------------------------- the two folder pickers

const FALLBACK_ROOT = '/Users/sample/Studio';

/** A short list of invented folders for both pickers. The world's own harness root comes first, then a folder inside it, then two apart from it. */
export function folderChoices(world: World): string[] {
  const home = globalScope(world), root = (home === undefined ? FALLBACK_ROOT : home.path).replace(/\/+$/, '');
  return [root, `${root}/knowledge`, '/Users/sample/Documents/Notes', '/Users/sample/Work'];
}

/** How the two chosen folders sit: apart, the same folder, the knowledge root inside the harness root, or the other way round. */
export type Nesting = 'apart' | 'same' | 'knowledge-inside' | 'harness-inside';

export function nestingOf(harnessRoot: string, knowledgeRoot: string): Nesting {
  const trim = (p: string): string => p.replace(/\/+$/, '');
  const h = trim(harnessRoot), k = trim(knowledgeRoot);
  if (h === k) return 'same';
  if (k.startsWith(`${h}/`)) return 'knowledge-inside';
  if (h.startsWith(`${k}/`)) return 'harness-inside';
  return 'apart';
}

// ---------------------------------------------------------------------------------------------------- the bring in step, told honestly

/** What stops Bring in when the draft holds edits that this flow did not make. */
export const BRING_BLOCKED_WORDS = 'You have unsaved changes on the Harness screen. Apply or discard them first.';

/** The counts on the Bring in step. The prototype keeps every item it found, ticked or not, so the count says how many of them the ticks cover. */
export function bringInWords(review: { readonly itemCount: number }, world: World): { readonly count: string; readonly keeps: string } {
  const found = world.items.filter(i => i.foundAt.length > 0).length;
  return { count: `${review.itemCount} of ${found} items are in the places you ticked.`, keeps: 'The prototype keeps every item it found.' };
}

/** What the flow knew about the draft when it began, and after its own last edit: the draft as text, and whether it was already dirty at the start. */
export interface DraftBaseline { readonly snapshot: string; readonly foreign: boolean }

/** True when the draft holds edits the setup flow did not make, so Bring in would apply them under its own label. */
export function unrelatedEdits(baseline: DraftBaseline | undefined, currentSnapshot: string, dirty: boolean): boolean {
  if (baseline === undefined || !dirty) return false;
  return baseline.foreign || baseline.snapshot !== currentSnapshot;
}

/** The conflicts that are settled now: those the person settled and that the world no longer shows as a conflict. Undo or Discard brings a conflict back, and it leaves this list. */
export function settledList(resolved: Readonly<Record<string, string>>, conflicts: readonly { readonly itemId: string }[]): [string, string][] {
  const open = new Set(conflicts.map(c => c.itemId));
  return Object.entries(resolved).filter(([id]) => !open.has(id));
}
