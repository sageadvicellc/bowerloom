/**
 * Every word a person reads on the Welcome screen, the Find screen and the closing note, in one frozen table of the same shape as `WORDS`
 * (renderer/home/words.ts): a label has at most 5 words, a hint at most 12, and no banned word appears. `tests/home-first-run.test.ts` holds this table,
 * the builders at the bottom and the markup of both screens to those rules. The Welcome sentence is two lines of one sentence, so each line is a hint.
 * A file path is never a word here: the paths sit in the data, and the Find screen shows them only behind "Show details".
 */
import { agentsCount } from '../words.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const FIND_WORDS = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    findMyAgents: 'Find my agents',
    lookingTitle: 'Looking for your agents',
    readTitle: 'Read what is inside?',
    readingTitle: 'Reading your agents',
    nothingTitle: 'No agents found',
    whereILooked: 'Where I looked',
    toolsFound: 'Tools found',
    looking: 'Looking',
    notFound: 'Not found',
    showDetails: 'Show details',
    hideDetails: 'Hide details',
    looksRight: 'Looks right',
    yesRead: 'Yes, read them',
    notNow: 'Not now',
    back: 'Back',
    close: 'Close',
    findMore: 'Find more',
    progress: 'Reading progress',
    places: 'Places to read',
  },
  /** One line under a label, or one line of text: at most 12 words. */
  hint: {
    welcomeLineOne: 'See everything your AI agents can do,',
    welcomeLineTwo: 'and change it in one place.',
    welcomeNote: 'Nothing is changed until you press Save.',
    placesHint: 'Untick a place to skip it.',
    pickOne: 'Tick at least one place.',
    readOnly: 'Only the places you ticked are opened.',
    readSafe: 'Nothing is changed. Keys and passwords are never copied.',
    nothingHint: 'Nothing was found on this computer.',
    closingNote: 'Saved in this preview. Help replays the tour any time.',
  },
  popover: {},
});

/** "Found 10 agents" or "Found 1 agent". */
export const foundTitle = (agents: number): string => `Found ${agentsCount(agents)}`;
/** "3 places, 10 agents": what the second question is about. */
export const readSummary = (places: number, agents: number): string => `${places} ${places === 1 ? 'place' : 'places'}, ${agentsCount(agents)}`;
/** "Reading Your home folder". */
export const readingNow = (place: string): string => `Reading ${place}`;
/** "2 of 3". */
export const readProgress = (done: number, total: number): string => `${done} of ${total}`;
/** "1 agent here has changes you have not saved." or "2 agents here have changes you have not saved." */
export const unsavedHere = (n: number): string => `${n} ${n === 1 ? 'agent here has' : 'agents here have'} changes you have not saved.`;
