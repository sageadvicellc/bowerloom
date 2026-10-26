/**
 * The fixed words of the first-run screens, Projects, the install sheet, Interfaces and Version history, in one frozen table (the same shape and the same limits as WORDS in words.ts:
 * a label at most 5 words, a hint at most 12, a paragraph at most 25, no banned word). They are copied from the design pictures S1.1 to S1.3, S6, S7.1 to S7.3, S10 and S11.
 * tests/harness-install.test.ts holds this table and the builders at the bottom to the rules.
 */
import type { FileState, InstallState } from '../../shared/harness/types.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const FLOW = deepFreeze({
  /** Names of things and buttons: at most 5 words each. */
  label: {
    // First run
    findMyFiles: 'Find my files', stepLook: 'Look', stepChoose: 'Choose', stepRead: 'Read', firstSteps: 'First steps', stepDone: 'done', lookingTitle: 'Looking for your files', searchProgress: 'Search progress',
    looksRight: 'Looks right', showDetails: 'Show details', hideDetails: 'Hide details', addFolder: 'Add a folder', notNow: 'Not now', makeFromThis: 'Make a harness from this', sources: 'Sources',
    partsInSource: 'What Bowerloom reads', foundAt: 'Found in',
    // Projects
    update: 'Update', install: 'Install', review: 'Review', assignHarness: 'Assign harness', assignAnother: 'Assign another harness', removeFromProject: 'Remove from project', project: 'Project', noHarnessYet: 'No harness yet',
    projectRows: 'Projects', interfacesOfInstall: 'Interfaces',
    // Install sheet
    stepProject: 'Project', stepHarness: 'Harness', stepInterfaces: 'Interfaces', stepReview: 'Review', installSteps: 'Install steps', next: 'Next', installAHarness: 'Install a harness', folders: 'Folders', harnessChoices: 'Harnesses',
    interfaceChoices: 'Interfaces to install for', manifestKind: 'Manifest', fileNew: 'New', fileUpdate: 'Update', fileConflict: 'Conflict', fileSame: 'Same',
    showDifference: 'Show the difference', hideDifference: 'Hide the difference', yourFile: 'Your file', harnessCopy: 'Harness copy',
    conflictChoice: 'How to settle it',
    // Interfaces
    useInterface: 'Use this interface', whatWrites: 'What Bowerloom writes', cannotUse: 'Cannot use', lookAgain: 'Look again', looking: 'Looking',
    // History
    undone: 'Undone', historyList: 'Changes',
  },
  /** Short lines: at most 12 words each. */
  hint: {
    welcomeLineOne: 'Build a harness from your agents and skills.', welcomeLineTwo: 'Then run it in any interface you use.',
    tickOne: 'Tick at least one source.', notInPreview: 'Not in this preview.', noSources: 'No source is ticked.',
    manifestNote: 'Bowerloom manifest. Commit this file to share the harness.',
    pickFolder: 'Pick the folder to install into.', pickHarness: 'Pick the harness to install.', pickInterfaces: 'Each interface gets its own files. Pick the ones to install for.',
    installNote: 'Nothing changes until you press Install. You can undo in Version history.',
    pickToContinue: 'Pick one to continue.',
    removeNote: 'This does not delete your files. It removes only what Bowerloom wrote.',
    yourFileNone: 'Not in this preview.', historyHint: 'Newest first. Undo puts back what the change replaced.',
    lookedAgain: 'Looked again. Nothing changed.', noneOffered: 'No interface is switched on. Turn one on in Interfaces.',
    pickInterface: 'Pick at least one interface.', undoFirst: 'Undo the newer change first', noProject: 'That project is not here.',
  },
  /** A short paragraph: at most 25 words each. */
  paragraph: {
    chooseLine: 'Untick a source to skip it. Bowerloom reads the names and text of the files you keep. The text stays on this computer.',
    readLine: 'A harness is a saved list of agents and skills. Bowerloom stores it as one small file in the project you install it to.',
  },
} as const);

// ---- Words built from a name or a number

/** "Found 4 sources". */
export const foundSources = (n: number): string => `Found ${n} ${n === 1 ? 'source' : 'sources'}`;
/** "Read 4 sources. Make a harness from each." */
export const readTitle = (n: number): string => `Read ${n} ${n === 1 ? 'source' : 'sources'}. Make a harness from each.`;
/** "Make all 4". */
export const makeAll = (n: number): string => `Make all ${n}`;
/** "Make a harness from Caveman (plug-in)": the name of a button. */
export const makeFrom = (name: string): string => `Make a harness from ${name}`;
/** "Nothing changed: that link is there already.": the note when a change did nothing. The reason is a few lowercase words from the store. */
export const nothingChanged = (reason: string): string => `Nothing changed: ${reason}.`;
/** "Removed Weekly report crew.": the note after a harness leaves a project. */
export const removedWords = (harness: string): string => `Removed ${harness}.`;
/** "Update Weekly report crew in bowerloom": the name of a project button. */
export const actionName = (action: string, harness: string, project: string): string => `${action} ${harness} in ${project}`;
/** "Install Codex": the name of a button in the details. */
export const installFor = (name: string): string => `Install ${name}`;
/** "Update Codex". */
export const updateFor = (name: string): string => `Update ${name}`;
/** "Review Codex". */
export const reviewFor = (name: string): string => `Review ${name}`;
/** "Saved in the project as .bowerloom/harnesses/weekly-report-crew.json. Commit it to share the harness." */
export const savedAs = (path: string): string => `Saved in the project as ${path}. Commit it to share the harness.`;
/** "Conflict: .codex/agents/writer.toml already exists. Pick one." */
export const conflictTitle = (path: string): string => `Conflict: ${path} already exists. Pick one.`;
/** "Settled. Keep mine." */
export const settledWords = (choice: string): string => `Settled. ${choice}.`;
/** "7 new files, 2 updates and 1 conflict, in ~/Sage Advice/code/internal-tools/bowerloom. Bowerloom writes only these files." */
export const reviewLine = (summary: string, projectPath: string): string => `${summary}, in ${projectPath}. Bowerloom writes only these files.`;
/** "Install Weekly report crew in bowerloom": the name of a button. */
export const installAction = (harness: string, project: string): string => `Install ${harness} in ${project}`;
/** "Use Codex": the name of a switch. */
export const interfaceSwitch = (name: string): string => `Use ${name}`;
/** "4 interfaces. Bowerloom installs only for the ones that are switched on." */
export const interfacesHint = (n: number): string => `${n} ${n === 1 ? 'interface' : 'interfaces'}. Bowerloom installs only for the ones that are switched on.`;
/** "Undo Installed Weekly report crew in bowerloom": the name of a button. */
export const undoName = (text: string): string => `Undo ${text}`;
/** The words of a file state in the review. */
export const FILE_WORDS: Readonly<Record<FileState, string>> = Object.freeze({ new: FLOW.label.fileNew, update: FLOW.label.fileUpdate, conflict: FLOW.label.fileConflict, same: FLOW.label.fileSame });
/** The tone of a file state's dot. */
export const FILE_TONE: Readonly<Record<FileState, 'good' | 'warn' | 'bad' | 'quiet'>> = Object.freeze({ new: 'good', update: 'warn', conflict: 'bad', same: 'quiet' });
/** The button of a project row for an install state, or null when it needs none. */
export function actionFor(state: InstallState): string | null {
  return state === 'conflict' ? FLOW.label.review : state === 'out-of-date' ? FLOW.label.update : state === 'not-installed' ? FLOW.label.install : null;
}
