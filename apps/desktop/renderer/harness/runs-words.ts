/**
 * The fixed words of the Start sheet, Runs and Compare (S8, S9), copied from the design pictures. They obey the same limits as WORDS (a label at most 5 words, a hint at most 12, a paragraph
 * at most 25) and the same banned-word rule; tests/harness-runs.test.ts holds them to it.
 */
import { notYetWords } from './words.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const RUN_WORDS = deepFreeze({
  label: {
    project: 'Project', interfaces: 'Engines', instruction: 'Instruction', harnessAndProject: 'Harness and project', started: 'Started',
    bringFront: 'Bring window to the front', openCompare: 'Open compare', closeCompare: 'Close compare', close: 'Close', compare: 'Compare',
    yourNotes: 'Your notes', saveRating: 'Save rating and notes', ratingGroup: 'Rating', pickProject: 'Pick a project', runsList: 'Runs',
  },
  hint: {
    startPlaceholder: 'Say what the harness should do.',
    switchedOff: 'Switched off. Turn it on in Engines.',
    emptyHarness: 'This harness is empty. Add parts before you start it.',
    needsInstall: 'Install first, then start.',
    bringTip: 'Brings the engine window forward.',
    noRuns: 'No runs yet. Press Start on a harness.', noRunsReal: 'Runs are not in beta.1.',
    noGroup: 'That group of runs is not here.', noRun: 'That run is not here.',
    needInstruction: 'Write an instruction to start.', needInterface: 'Tick an engine to start.', needProject: 'Pick a project to start.',
    saved: 'Saved on this computer, in Bowerloom. Your project files do not change.',
    savedToast: 'Saved rating and notes.',
  },
  paragraph: {
    startNote: 'Bowerloom opens each engine with your instruction. It never reads the chat.',
    chatNote: 'Bowerloom does not read or keep the chat. Read it in the engine window.',
    ratingLocked: 'A run that is still going cannot be rated. The rating unlocks when it is done.',
  },
} as const);

/** The note of a button that does nothing yet: "Not in this preview." on the sample, "Not in beta.1." on the person's own folders. */
export const bringToastWords = (real: boolean): string => notYetWords(real);
/** The tip of "Bring window to the front": what it would do, then why it does nothing yet. */
export const bringTipWords = (real: boolean): string => `${RUN_WORDS.hint.bringTip} ${notYetWords(real)}`;
/** The line over an empty list of runs. Start is blocked on the person's own folders, so the line must not point to it. */
export const noRunsWords = (real: boolean): string => (real ? RUN_WORDS.hint.noRunsReal : RUN_WORDS.hint.noRuns);
/** "Claude Code is still running. Save again when it is done." */
export const stillRunning = (names: readonly string[]): string => `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} still running. Save again when done.`;
/** "Compare: Write a weekly report..." */
export const compareTitle = (instruction: string): string => `Compare: ${instruction}`;
/** The name of the button that opens one run's window: "Bring Claude Code window to the front". */
export const bringName = (name: string): string => `Bring ${name} window to the front`;

/** The first sentence of an instruction, for the heading of a group: "Write a weekly report from the notes in Meetings." The whole text stays in the details and in Compare. */
export function firstSentence(text: string): string {
  const found = /^.*?[.!?](?=\s|$)/s.exec(text.trim());
  return found === null ? text.trim() : found[0];
}
