/**
 * The fixed words of Runs, Compare and the Record button on the person's own folders (beta.2). A run here is a note the person keeps: Bowerloom starts no engine and cannot see one running.
 * The words obey the same limits as WORDS (a label at most 5 words, a hint at most 12, a paragraph at most 25) and the same banned-word rule; tests/runs-real-model.test.ts holds them to it.
 * "Token" is a banned word of the screens, so the two counts are called Input and Output.
 */
const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const RUNS_REAL = deepFreeze({
  label: {
    addRun: 'Add a run', recordRun: 'Record this run', openRuns: 'Open Runs', saveRun: 'Save the run', cancel: 'Cancel', close: 'Close',
    project: 'Project', engine: 'Engine', instruction: 'Instruction', whenStarted: 'When it started', started: 'Started', status: 'Status',
    markDone: 'Mark as done', markNotDone: 'Mark as not done', figures: 'From the engine log', yourNotes: 'Your notes', saveRating: 'Save rating and notes',
    recording: 'Recording', saving: 'Saving', reading: 'Reading the log', tryAgain: 'Try again', startNewList: 'Start a new list', readAgain: 'Read again', keepEditing: 'Keep editing', leave: 'Leave', unsavedTitle: 'Unsaved changes',
  },
  hint: {
    recordedToast: 'Recorded. Find it in Runs.',
    chooseProject: 'Choose a project', noFolders: 'No project is known yet. Add one in Projects.',
    needInstruction: 'Write the instruction you gave.', needProject: 'Choose a project.', needTime: 'Give the time it started.',
    figuresLoading: 'Reading the engine log.', listLoading: 'Reading your saved runs.',
    listFailed: 'Could not read your saved runs.', damaged: 'Your saved runs file is damaged. Start a new list.',
    leaveAsk: 'You have unsaved ratings or notes. Leave without saving?',
    foldersFailed: 'Could not read your projects.', saveFailed: 'Could not save. Try again.', recordFailed: 'Could not record the run. Try again.',
    savedToast: 'Saved rating and notes.', doneToast: 'Marked as done.', notDoneToast: 'Marked as not done.',
    noBridge: 'This window cannot reach Bowerloom. Close it and open the app again.',
    compareNeedTwo: 'Record this instruction in a second engine to compare.',
    saved: 'Saved on this computer, in Bowerloom. Your project files do not change.',
    groupNote: 'Runs of one instruction are grouped for Compare.',
  },
  paragraph: {
    recordNote: 'Bowerloom cannot see your Terminal. Record the run to keep a note of it, and to read its figures later.',
    addNote: 'Record a run you started in your own Terminal. Bowerloom keeps your note on this computer.',
    chatNote: 'Bowerloom reads numbers from the engine log. It never reads the chat.',
    ratingLocked: 'A run you have not marked as done cannot be rated.',
  },
} as const);

/** "Recorded. Find it in Runs." */
export const recordedToast = (): string => RUNS_REAL.hint.recordedToast;
/** "3 runs. Runs of one instruction are grouped for Compare." */
export const runsHintReal = (n: number): string => (n === 0 ? 'No runs yet.' : `${n} ${n === 1 ? 'run' : 'runs'}. ${RUNS_REAL.hint.groupNote}`);
/** "Your saved runs file is damaged. Bowerloom kept it as runs.damaged-....json." The name is a file name, never a path. */
export const keptWords = (name: string): string => `Your saved runs file is damaged. Bowerloom kept it as ${name}.`;
