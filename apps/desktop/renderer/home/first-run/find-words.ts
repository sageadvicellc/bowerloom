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
    searching: 'Search progress',
    selectAll: 'Select all',
    clearAll: 'Clear',
    agentsFound: 'Agents found',
    worksWith: 'Works with',
    readTitle: 'Read what is inside?',
    readingTitle: 'Reading your agents',
    nothingTitle: 'No agents found',
    whereILooked: 'Where I looked',
    showDetails: 'Show details',
    hideDetails: 'Hide details',
    looksRight: 'Looks right',
    yesRead: 'Yes, read them',
    notNow: 'Not now',
    back: 'Back',
    close: 'Close',
    findMore: 'Find more',
    progress: 'Reading progress',
  },
  /** One line under a label, or one line of text: at most 12 words. */
  hint: {
    welcomeLineOne: 'See everything your AI agents can do,',
    welcomeLineTwo: 'and change it in one place.',
    welcomeNote: 'Nothing is changed until you press Save.',
    pickAgents: 'Untick an agent to skip it.',
    pickOne: 'Tick at least one agent.',
    readOnly: 'Only the agents you ticked are opened.',
    readSafe: 'Nothing is changed. Keys and passwords are never copied.',
    nothingHint: 'Nothing was found on this computer.',
    closingNote: 'Saved in this preview. Your files are untouched.',
  },
  popover: {},
});

/** "Found 10 agents" or "Found 1 agent". */
export const foundTitle = (agents: number): string => `Found ${agentsCount(agents)}`;
/** "10 agents": what the second question is about. */
export const readSummary = (agents: number): string => agentsCount(agents);
/** "Reading Meeting assistant". */
export const readingNow = (agent: string): string => `Reading ${agent}`;
/** "2 of 3". */
export const readProgress = (done: number, total: number): string => `${done} of ${total}`;
/** The line under an agent whose changes wait for Save: it cannot be skipped. */
export const unsavedAgent = (): string => 'This agent has changes you have not saved.';
