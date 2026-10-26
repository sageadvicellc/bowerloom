/**
 * Every word a person reads on the screens of the real-setup reader, in one frozen table of the same shape as the home app's `WORDS`: a label has at most 5 words,
 * a hint at most 12, and no banned word appears (tests/real-view.test.ts holds the table and the markup to that). A file path is never a word here: paths sit in the
 * data and show only behind "Show details". The wording follows the Find screen of the home app.
 */
import type { RealCounts } from '../../../shared/real/types.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const REAL_WORDS = deepFreeze({
  label: {
    findMySetup: 'Find my setup',
    lookingTitle: 'Looking for your setup',
    readTitle: 'Read what is inside?',
    readingTitle: 'Reading your setup',
    nothingTitle: 'Nothing found yet',
    whereILooked: 'Where I looked',
    places: 'Places to read',
    showDetails: 'Show details',
    hideDetails: 'Hide details',
    looksRight: 'Looks right',
    yesRead: 'Yes, read them',
    notNow: 'Not now',
    back: 'Back',
    addFolder: 'Add a folder',
    tryAgain: 'Try again',
    progress: 'Reading progress',
    readOnly: 'Read-only',
    foundTitle: 'Your setup',
  },
  hint: {
    intro: 'Looks at your tool folders. Changes nothing.',
    readOnlyNote: 'Read-only. Nothing is changed or saved.',
    placesHint: 'Untick a place to skip it.',
    pickOne: 'Tick at least one place.',
    readOnly: 'Only the places you ticked are opened.',
    readSafe: 'Nothing is changed. Keys and passwords are never copied.',
    nothingHint: 'No tool folders were found. You can add a folder.',
    stoppedEarly: 'It stopped early to stay within its time limit.',
    pickedNothing: 'No folder was chosen.',
    noBridge: 'This window cannot look at your setup.',
    again: 'Something went wrong. Nothing was changed. You can try again.',
    busy: 'Another look is still running. Try again in a moment.',
    unlisted: 'That place is no longer listed. Look again.',
    notAllowed: 'This page may not look at your setup.',
    detailsTools: 'Tool folders',
    detailsTopics: 'Topics',
    detailsNotes: 'Notes',
  },
  popover: {},
});

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "2 agents, 6 skills, 3 tools, 1 hook, 6 notes": what a place holds, leaving out what it does not. */
export function countsLine(c: RealCounts): string {
  const parts = [c.agents > 0 ? plural(c.agents, 'agent', 'agents') : '', c.skills > 0 ? plural(c.skills, 'skill', 'skills') : '', c.tools > 0 ? plural(c.tools, 'tool', 'tools') : '', c.hooks > 0 ? plural(c.hooks, 'hook', 'hooks') : '', c.notes > 0 ? plural(c.notes, 'note', 'notes') : ''].filter(p => p !== '');
  return parts.length === 0 ? 'Nothing here' : parts.join(', ');
}

/** "Found 4 places" or "Found 1 place". */
export const foundPlaces = (n: number): string => `Found ${plural(n, 'place', 'places')}`;
/** "3 places, 14 agents": what the second question is about. */
export const readSummary = (places: number, agents: number): string => `${plural(places, 'place', 'places')}, ${plural(agents, 'agent', 'agents')}`;
/** "Could not read 3 things." */
export const couldNotReadLine = (n: number): string => `Could not read ${plural(n, 'thing', 'things')}.`;
/** What kind of place it is, in words: where a person would find it. */
export const KIND_WORDS: Readonly<Record<'home' | 'project' | 'picked', string>> = Object.freeze({ home: 'In your home folder', project: 'A work folder', picked: 'A folder you picked' });

/** The plain sentence for a short code the bridge gives back when a call is refused or fails. */
export function reasonWords(code: string): string {
  if (code === 'BUSY') return REAL_WORDS.hint.busy;
  if (code === 'NOT_ALLOWED') return REAL_WORDS.hint.notAllowed;
  if (code === 'UNKNOWN_PLACE' || code === 'BAD_ARGUMENT' || code === 'TOO_MANY') return REAL_WORDS.hint.unlisted;
  if (code === 'NO_BRIDGE') return REAL_WORDS.hint.noBridge;
  return REAL_WORDS.hint.again;
}
