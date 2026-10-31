/**
 * The fixed words of notes in the harness-first window (spec 6.9; first five minutes, sections 4, 7, 8 and 9): the notes step, the Notes panel inside My
 * agents, the keeper build, and the tour. A label has at most 5 words and a hint at most 12. The screen words are section 8's: "notes" for a knowledge source,
 * "Notes keeper" for the wiki keeper kit, "tidy-up report" for the refinement report. The home rule holds here too, so "harness", "plan" and "version" never
 * reach these words. A file path is never a label: a path sits behind "Show details". tests/notes-words.test.ts holds the table and the builders to it.
 */
import type { TourStep } from './tour/tour.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const NOTES = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    notes: 'Notes', keeper: 'Notes keeper', useMine: 'Use my notes', startFresh: 'Start fresh', create: 'Create', chooseAgain: 'Choose another folder',
    startHistory: 'Start its history', declineHistory: 'No history for now', notNow: 'Not now', showDetails: 'Show details', hideDetails: 'Hide details', starterFiles: 'Starter files',
    historyFiles: 'Files it records', addKeeper: 'Add the Notes keeper', addRest: 'Add the other skills', add: 'Add', skillsShelf: 'Skills',
    notesShelf: 'Notes', kitSkills: 'Ready-made skills', yourNotes: 'Your notes', addNotes: 'Add notes', help: 'Help', replay: 'Help: replay the tour',
    notesEachAgent: 'Notes each agent reads', buildKeeper: 'Build my Notes keeper', setUpNotes: 'Set up my notes', showAround: 'Show me around',
    tour: 'Tour', tourSteps: 'Tour steps', tourSkip: 'Skip tour', tourBack: 'Back', tourNext: 'Next', tourDone: 'Done', whatNext: 'What next',
    stepMap: 'Agents', stepNotes: 'Notes', stepKeeper: 'Keeper', stepShelves: 'Shelves', stepSave: 'Save', stepHelp: 'Help', stepNext: 'What next',
    takeOff: 'Take off', reading: 'Reading the folder', writing: 'Writing', folder: 'Folder', latestReport: 'Latest report', notesSteps: 'Notes steps', building: 'Build the keeper',
  },
  /** Short lines: at most 12 words each. */
  hint: {
    question: 'Where do you keep your notes?',
    useHint: 'Pick the folder that holds your notes.',
    freshHint: 'Pick or make an empty folder for new notes.',
    offerHistory: 'This folder keeps no history. Start one so changes can be undone.',
    starterNote: 'Bowerloom writes these files, then records them in the history.',
    historyNote: 'Bowerloom records these files as the first point in the history.',
    reportOnly: 'No history, so the keeper only reports and changes no page.',
    gitMissing: 'Git is not on this computer, so the keeper only reports.',
    unreadable: 'Bowerloom cannot read this folder\'s history.',
    noCommit: 'Its history has no first commit. Finish it with git.',
    refused: 'Its git settings could start a program, so Bowerloom stopped.',
    ready: 'Your notes are ready.',
    created: 'Your notes are ready, with a history from the start.',
    moreKinds: 'More kinds of notes are coming.',
    noNotes: 'No notes yet. Use your notes or start fresh.',
    notAttached: 'Not on a shelf yet.',
    noKeeper: 'Add the ready-made Notes keeper to look after your notes.',
    keeperDraft: 'From the ready-made kit. It stays a draft until you save.',
    keeperNoSkills: 'The Notes keeper has no skills, so it can do nothing yet.',
    dropSkill: 'Drop a skill here.',
    dropNotes: 'Drop your notes here.',
    shelvesNote: 'Drag a card onto a shelf, or press its Add button.',
    sampleNotes: 'Sample notes. Nothing is read or written.',
    nextLead: 'Three ideas for your Notes keeper.',
    helpLives: 'Help sits at the top of this sheet.',
    noSummary: 'Bowerloom could not read these notes now.',
    firstRunNote: 'Next, build an agent that looks after them.',
  },
} as const);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "14 pages", or "At least 500 pages" when a bound stopped the count. */
export const pagesWords = (n: number, complete: boolean): string => (complete ? plural(n, 'page', 'pages') : `At least ${plural(n, 'page', 'pages')}`);
/** "Last change 2026-10-28", from the time of the last commit, or "No history yet". */
export const lastChangeWords = (at: string | null): string => (at === null ? 'No history yet' : `Last change ${at.slice(0, 10)}`);
/** "Read by notes-keeper, editor", or "No agent reads these yet." */
export const usedByWords = (agents: readonly string[]): string => (agents.length === 0 ? 'No agent reads these yet.' : `Read by ${agents.join(', ')}`);
/** "Tidy-up report 2026-10-29", or "No tidy-up report yet." The report's path sits behind "Show details". */
export const reportWords = (latest: { readonly date: string; readonly path: string } | null): string => (latest === null ? 'No tidy-up report yet.' : `Tidy-up report ${latest.date}`);
/** "And 3 more.": the file names past the list's end. */
export const moreWords = (n: number): string => `And ${n} more.`;
/** "2 hidden names stay out." */
export const hiddenWords = (n: number): string => `${plural(n, 'hidden name stays', 'hidden names stay')} out.`;
/** "Add add-source to the Notes keeper": the name of a skill card's Add button. */
export const addToKeeperName = (skill: string): string => `Add ${skill} to the Notes keeper`;
/** "Put Garden notes on the Notes shelf": the name of a notes card's Add button. */
export const onShelfName = (notes: string): string => `Put ${notes} on the Notes shelf`;
/** "Take add-source off the Notes keeper". */
export const takeOffName = (item: string): string => `Take ${item} off the Notes keeper`;

/** Where the keeper build is, for the hint of the tour's waiting step: what the person does next. */
export interface BuildProgress { readonly first: string; readonly firstDone: boolean; readonly restDone: boolean; readonly notesDone: boolean; readonly hasNotes: boolean }
export function buildHint(p: BuildProgress): string {
  if (!p.firstDone) return `Drag ${p.first} onto Skills, or press its Add button.`;
  if (!p.restDone) return `Now press ${NOTES.label.addRest}.`;
  if (p.hasNotes && !p.notesDone) return 'Drag your notes onto the Notes shelf, or press Add.';
  return 'The keeper is built. Press Next.';
}

/** The three ideas of the tour's last step (section 4 step 8). The schedule one is words only: no command on screen (spec 6.11). */
export const NEXT_IDEAS: readonly string[] = Object.freeze([
  'Ask the keeper to add a first source.',
  'Ask the keeper for a tidy-up report.',
  'Run that report on a schedule with a tool such as n8n.',
]);

/**
 * The tour of the harness-first window: the six steps of section 9, each lighting one thing by its `data-tour` id with one sentence of at most 12 words, then
 * "What next" (section 4 step 8) with no target, so it sits in the middle. The shelves step waits while the person builds the keeper: the build panel is lit and
 * open to the pointer, and the step moves on when the keeper is built (or on Next).
 */
export const TOUR_STEPS: readonly TourStep[] = Object.freeze([
  { id: 'map', target: 'map', text: 'These are your AI agents, from every tool.' },
  { id: 'notes', target: 'notes', text: 'Your notes are what your agents can read.' },
  { id: 'keeper', target: 'keeper', text: 'This agent looks after your notes.' },
  { id: 'shelves', target: 'shelves', text: 'Skills are what it knows how to do.', wait: true, area: 'build' },
  { id: 'save', target: 'save', text: 'Changes wait here until you press Save.' },
  { id: 'help', target: 'help', text: 'Replay this tour any time.' },
  { id: 'next', target: null, text: 'What next? Three ideas for your Notes keeper.', list: NEXT_IDEAS, foot: NOTES.hint.helpLives },
].map(step => Object.freeze(step)));

/** The short name of each tour step, for the stepper. */
export const TOUR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  map: NOTES.label.stepMap, notes: NOTES.label.stepNotes, keeper: NOTES.label.stepKeeper, shelves: NOTES.label.stepShelves, save: NOTES.label.stepSave,
  help: NOTES.label.stepHelp, next: NOTES.label.stepNext,
});
