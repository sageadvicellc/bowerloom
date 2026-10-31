/**
 * Every fixed word a person reads on the screens that run on their own folders (`--prototype-v3-real`), in one frozen table of the same shape as WORDS: a label has at most 5 words, a hint 12, a paragraph or a popover 25,
 * and no banned word appears (tests/harness-words.test.ts holds the table and the builders at the bottom to that). Words that are the same as the home app's reader (the places, the counts) are taken from its table, so they cannot drift.
 * A file path or a name from a file is never a word here: it is the person's own text, drawn as text.
 */
import type { RealNotes } from '../../../shared/harness/types.js';
import { REAL_LIMITS } from '../../../shared/real/types.js';
import { PARTLY_READ_NOTE } from '../../../shared/harness/real-map.js';
import { REAL_WORDS, countsLine, couldNotReadLine, foundPlaces, readSummary } from '../../home/real/words.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const REAL = deepFreeze({
  label: {
    lookingTitle: 'Looking at your folders',
    consentTitle: 'Read what is inside?',
    readingTitle: 'Reading your folders',
    nothingTitle: 'Nothing found yet',
    errorTitle: REAL_WORDS.label.errorTitle,
    places: 'Folders to read',
    foldersToRead: 'Folders to read',
    readProgress: REAL_WORDS.label.progress,
    looksRight: REAL_WORDS.label.looksRight,
    showDetails: REAL_WORDS.label.showDetails,
    hideDetails: REAL_WORDS.label.hideDetails,
    addFolder: REAL_WORDS.label.addFolder,
    yesRead: REAL_WORDS.label.yesRead,
    notNow: REAL_WORDS.label.notNow,
    back: REAL_WORDS.label.back,
    tryAgain: REAL_WORDS.label.tryAgain,
    useSample: 'Use the sample',
    aboutRead: 'About this read',
    aboutFolders: 'About these folders',
    showAllNotes: 'Show all notes',
    showFewerNotes: 'Show fewer notes',
    toolFolders: REAL_WORDS.hint.detailsTools,
    topics: REAL_WORDS.hint.detailsTopics,
    notInBeta: 'Not in beta.1',
    beta: 'Beta',
    aboutBeta: 'About this beta',
    cancel: 'Cancel',
    notesFirstLines: 'first lines of notes pages',
    replaceTitle: 'Read your folders again?',
    notChecked: 'Not checked',
  },
  hint: {
    readOnly: REAL_WORDS.hint.readOnlyNote,
    untick: 'Untick a folder to skip it.',
    pickOne: 'Tick at least one folder.',
    noFolders: 'No tool folders were found. You can add a folder.',
    nothingRead: 'Nothing was found in the folders you ticked.',
    nothingChoice: 'Add another folder, or look at the sample.',
    nothingStopped: 'It stopped early, and nothing was found yet.',
    alreadyListed: 'Already in the list.',
    addedAway: 'The folder you added is in the list, not ticked.',
    stoppedEarly: 'It stopped early to stay within its limits.',
    pickedNothing: REAL_WORDS.hint.pickedNothing,
    consentOne: 'It reads text only in the folders you ticked.',
    consentTwo: 'It reads skills, agents, prompts and first lines of notes pages.',
    consentThree: REAL_WORDS.hint.readHidden,
    consentFour: 'Your files are not changed.',
    consentLinks: 'Linked folders are followed to where they point.',
    nextStep: 'Pick a smaller folder to read all of it.',
    detailsFrom: 'These notes are from the first look at each folder.',
    replaceLine: 'Reading again starts over. It changes nothing on your computer.',
  },
  paragraph: {
    chooseLine: 'To count what each folder holds, Bowerloom opened settings files and read names and structure. It reads text only in folders you keep ticked.',
    consentNotes: 'It looks through the whole folder for notes pages. It reads the first lines of up to 2000 of them.',
    readLine: 'A harness is a saved list of agents and skills. Bowerloom stores it as one small file in the project you install it to.',
    betaAbout: 'Bowerloom is in beta. It reads your own folders and writes only after you approve what it will write.',
  },
  /**
   * The list of the Beta mark's popover in this mode: every control that is not in beta.1. Install from a folder and Edit from a folder work, so no line is worded
   * so that it could mean them: the lines that share a name with a working control say where the blocked one is.
   */
  notInBeta: ['Start', 'Compare', 'Runs', 'Assign to project, in the Harnesses details', 'Assign harness, Install, Update and Review, in Projects', 'Add (the plus button), in the Library', 'Add a folder, in Projects'],
} as const);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export { countsLine, couldNotReadLine, foundPlaces, readSummary };

/** "Found in your Claude Code folder": where a real part was found, from the words beside it ("Your Claude Code folder", "Caveman plug-in"). */
export const foundInLine = (source: string): string => `Found in ${source.startsWith('Your ') ? `your ${source.slice(5)}` : source}`;
/** "Model setting: Claude Code only": the badge the reader gave an agent. */
export const modelBadgeLine = (badge: string): string => `Model setting: ${badge}`;

/** "12 sources, 180 parts in all.": the count line at the top of the Read list. */
export const readCountLine = (sources: number, parts: number): string => `${plural(sources, 'source', 'sources')}, ${plural(parts, 'part', 'parts')} in all.`;
/** "3 texts were cut short." */
export const textsCutLine = (n: number): string => `${n} ${n === 1 ? 'text was' : 'texts were'} cut short.`;
/** The line on the nothing-found screen after a read: plain, unless the read stopped early (then nothing found proves little, and it says so). */
export const nothingReadLine = (real: RealNotes | null): string => (real !== null && real.stoppedEarly ? REAL.hint.nothingStopped : REAL.hint.nothingRead);
/** "and 4 more notes." The lines after the first few. */
export const moreNotes = (n: number): string => `and ${plural(n, 'more note', 'more notes')}.`;
/** "3 folders ticked.": the line over the folders the person is asked about. */
export const foldersLine = (n: number): string => `${plural(n, 'folder', 'folders')} ticked.`;

/**
 * The summary line for what could not be read. When the whole read finished, it says so first: "Everything was read, except 11 things that could not be opened or were skipped."
 * When the read was partial or stopped early, it does not say "everything".
 */
export const skippedLine = (n: number, whole: boolean): string => {
  const things = n === 1 ? '1 thing' : `${n} things`, was = n === 1 ? 'was' : 'were';
  return whole ? `Everything was read, except ${things} that could not be opened or ${was} skipped.` : `${things} could not be opened or ${was} skipped.`;
};
/** The limits of the reader, from its own constants, so a very big folder is explained and the numbers cannot drift. */
export const limitsLine = (): string => `Bowerloom looks at up to ${REAL_LIMITS.filesPerPlace.toLocaleString('en-US')} files and ${REAL_LIMITS.depth} folders deep in each folder, so a very big folder is only partly read.`;
/** Whether a note says a folder was only partly read: the reader's sentence for one place, or its sentence for a list of places. */
export const isPartlyNote = (note: string): boolean => note === PARTLY_READ_NOTE || /^Some folders were big, so only part of them was looked at\.$/.test(note);
