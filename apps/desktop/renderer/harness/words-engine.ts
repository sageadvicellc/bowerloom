/**
 * The fixed words of the two sheets that reach the packages: "New harness from a folder" (adoption) and "Install a folder's harness" (the projection, with its
 * removal and recovery), and the drift report inside it. The same shape and limits as WORDS (words.ts): a label at most 5 words, a hint at most 12, a paragraph at
 * most 25, and no banned word, so "adopt", "apply", "import" and "MCP" never reach the screen. tests/engine-words.test.ts holds the table and the builders to it.
 * The words that come from a plan (a reason, a rule, a path) are shown as the packages wrote them.
 */
import type { ChangeView, DriftLineView, EngineId, Gate, ModeChoice, RecoveryView, Refusal, ResultWord } from '../../shared/engine/types.js';
import type { Tone } from '../../shared/harness/status.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const ENGINE_WORDS = deepFreeze({
  label: {
    adoptTitle: 'New harness from a folder', installTitle: 'Install a folder\'s harness', removeTitle: 'Remove what Bowerloom wrote', recoverTitle: 'Finish a stopped install',
    recoverAdoptTitle: 'Finish a stopped harness', fromFolder: 'From a folder', installFolder: 'Install from a folder',
    stepFolder: 'Folder', stepReview: 'Review', stepConfirm: 'Confirm', stepInterfaces: 'Engines', steps: 'Steps',
    chooseFolder: 'Choose a folder', folders: 'Folders', next: 'Next', back: 'Back', cancel: 'Cancel', close: 'Close',
    found: 'What Bowerloom found', foundIn: 'Found in', pickCopy: 'Pick one copy', differ: 'Rules that differ by engine', notCarried: 'Not carried over',
    secrets: 'Secrets replaced', filesWritten: 'Files it writes', approveEach: 'Approve each one', acknowledgeEach: 'Acknowledge each one', fixFirst: 'Fix these first',
    notes: 'Notes', problems: 'Problems', waiting: 'Still waiting for', everyInterface: 'Every engine',
    approveLines: 'Approve each weaker rule', planWithApprovals: 'Plan with these approvals', lossReport: 'What each engine gets', trust: 'Waiting for your trust',
    review: 'Code and commands to read', drift: 'AGENTS.md and CLAUDE.md differ', reconcile: 'What to do', driftLines: 'Changed since Bowerloom wrote them',
    approved: 'Approved weaker rules', changes: 'Files it changes', notApplied: 'Choices that did not count', environment: 'Environment',
    acceptAgents: 'Accept AGENTS.md', merge: 'Merge', keepBoth: 'Keep both', writeClaude: 'Write CLAUDE.md as @AGENTS.md',
    planRemoval: 'Plan a removal', planRecovery: 'Plan a recovery', keepMine: 'Keep my versions', folderGone: 'Folders it removes',
    nothingToChange: 'Nothing to change', finish: 'Finish', engineChoices: 'Engines to install for', resultDetails: 'Lines',
    planning: 'Planning', writing: 'Writing', refusal: 'Bowerloom stopped', installIt: 'Install it', acknowledged: 'Acknowledged', becomes: 'becomes', newFile: 'New',
    planAgain: 'Plan again', tryAgain: 'Try again', result: 'What Bowerloom did', writtenFiles: 'Written', removedFiles: 'Removed', restoredFiles: 'Put back', keptFiles: 'Kept as they are',
    leftBehind: 'Left behind', leftFolders: 'Folders left', undo: 'Undo', converted: 'Older Bowerloom copies', filterLeaks: 'Skills read past their filter',
    pendingTrust: 'Skills that wait for trust', checkByHand: 'Files to check by hand', foldersRemoved: 'Folders it removes when empty', exactText: 'The exact text',
    stepResult: 'Done', bodyFolder: 'Pick a folder', bodyReview: 'Review the plan', bodyConfirm: 'Confirm each one', bodyResult: 'What Bowerloom did', bodyInterfaces: 'Pick the engines',
    writeFiles: 'Write files', undoneFiles: 'Taken back', engineFound: 'Found here', engineNamed: 'Named, not found', shape: 'Read as',
    mergeIt: 'Merge into the harness', mergeText: 'CLAUDE.md text to move', restoreMode: 'Restore mode', recordMode: 'Keep new mode', modes: 'File modes',
    checkYes: 'Yes', checkPartly: 'Partly', checkNo: 'No', checkSave: 'Save', checkSkip: 'Skip',
    modeRestored: 'Mode put back', modeRecorded: 'New mode kept', everyEngine: 'Use for every engine', everyEngineTitle: 'For every engine',
    saveTitle: 'Edit a folder\'s harness', editFolder: 'Edit from a folder', stepEdit: 'Edit', bodyEdit: 'Edit the harness', reviewSave: 'Review the save',
    agentSkills: 'Skills each agent uses', skillsHere: 'Skills in this harness', interfacesHere: 'Engines it lists', agentsAndSkills: 'Agents and skills',
    removeSkill: 'Remove', keepSkill: 'Keep', savePoints: 'Save points', goBack: 'Go back', goBackTitle: 'Back to a save point', nowMark: 'Now',
    setAside: 'Set old save points aside', planSetAside: 'Review setting them aside', checkHere: 'Check these files',
    saved: 'Saved', savePoint: 'Save point', noAgents: 'No agents', noSkills: 'No skills',
    copySkills: 'Skills from another folder', copyAdd: 'Add', copyTakeOut: 'Take out', copiedMark: 'Copied',
  },
  hint: {
    pickFolder: 'Pick the folder Bowerloom reads.', samplePick: 'Sample folders. Nothing is read or written.', readOnly: 'Bowerloom only reads until you approve.',
    checkSaving: 'Saving your answer.',
    noFolders: 'No folder yet. Choose one to start.', holdsHarness: 'Holds a harness already.', noHarness: 'No harness here yet.',
    installedBefore: 'Bowerloom installed here before.', stopped: 'An install stopped part way here.', stoppedHarness: 'A new harness stopped part way here.',
    pickOne: 'Pick one to go on.', tickEach: 'Tick each one to go on.', tickToApprove: 'I read this and approve it.', tickToAcknowledge: 'I read this. Leave it out.',
    allTicked: 'Every one is ticked.', nothingWaits: 'Nothing is waiting.', listedOnly: 'Listed only.', needsAck: 'Needs your acknowledgement.', mustFix: 'Change the file first.',
    shownInFull: 'Shown in full. Read it before you approve.', pendingTrust: 'Pending trust', trusted: 'Trusted',
    fromVariable: 'read from a variable when it runs', noLines: 'Nothing to install for this engine.', defaultChoice: 'The default',
    approveChanged: 'The plan changed. Approve it again.', pickInterface: 'Pick at least one engine.',
    previewTag: 'Preview', previewKept: 'Installed earlier. Left as it is.', previewOff: 'Preview. Start Bowerloom with BOWERLOOM_PREVIEW_ENGINES=1 to install.',
    previewOnly: 'This harness lists preview engines only. Set BOWERLOOM_PREVIEW_ENGINES=1.',
    sameAsNow: 'The folder already matches. Nothing is written.', removeNote: 'Bowerloom puts back what it replaced and deletes only its own files.',
    acceptAgentsText: 'CLAUDE.md becomes one line: @AGENTS.md.', mergeText: 'Moves CLAUDE.md into the harness.', keepBothText: 'CLAUDE.md stays. Claude Code keeps reading it.',
    sampleNote: 'Sample. Nothing is written to your disk.',
    keptChanged: 'Changed since. It stays.', keptUnsafe: 'Not safe to read. It stays.',
    noBridge: 'This window cannot reach Bowerloom. Start it with the real launch command.',
    agentsPresent: 'AGENTS.md is in the folder.', agentsPlanned: 'This install writes AGENTS.md.', approvedEarlier: 'approved earlier, unchanged since', approvedNow: 'approved now',
    readyToWrite: 'Ready to write.',
    journalOk: 'The stopped run\'s record is whole.', journalDamaged: 'The stopped run\'s record is damaged. Check these files by hand.',
    saveDone: 'The save is done. The save stays, and Bowerloom clears its note.',
    nothingFound: 'Bowerloom found nothing to carry over in this folder.', noEngines: 'This harness lists no engine. Add one to harness.json.',
    nothingToRemove: 'Nothing to remove. Bowerloom wrote nothing here.', nothingChanged: 'Nothing changed. The folder already matched the plan.',
    noText: 'Bowerloom has no file text for this approval.', cannotApprove: 'This line cannot be approved here. Change the harness first.',
    leftBehindWhy: 'Bowerloom could not remove these. Check them by hand.', keptWhy: 'These changed since, so Bowerloom left them.',
    merged: 'Merged. The harness now holds the CLAUDE.md text.', mergeThen: 'Next, the install uses Accept AGENTS.md.',
    addsPart: 'harness.json gains the instructions part.', noClaudeText: 'Bowerloom cannot show this text. Plan again.',
    draftNote: 'Your changes stay a draft until you save.', noSavePoints: 'No save point yet. The first save keeps one.',
    savedNote: 'Saved. Installed files change only when you install.', installNext: 'Install it to write each engine\'s files.',
    removedMark: 'Removed when you save.', stoppedChange: 'A change to the harness stopped part way here.', linkHint: 'Press an agent\'s circle, then a skill, to link them.',
    noAgentsHere: 'This harness has no agents to link skills to.', currentPoint: 'The harness is this save point now.', pointKept: 'Save point kept:',
    setAsideNote: 'Nothing is deleted. Go back starts again from the next save.', setAsideDone: 'The old save points were set aside as',
    notLoading: 'The harness does not load now. Check these files by hand.',
    canRun: 'Can run as a program.', modeOnly: 'Only its permission to run changes.',
    onlyModes: 'Only whether files can run changes. No text changes.',
    ackExecutables: 'I read the files that can run, from another folder.',
    copyPick: 'Pick a folder whose skill you want here.', noOtherFolders: 'No other folder with skills yet. Choose one.',
    heldHere: 'This harness has it already.', copyNoSkills: 'That folder has no skills.',
  },
  paragraph: {
    adoptIntro: 'Bowerloom reads the files your engines use and proposes a harness. It writes only into .bowerloom, and only after you approve.',
    installIntro: 'Bowerloom writes each engine\'s own files from the folder\'s harness. You read every line first. Nothing changes until you approve the plan.',
    approveIntro: 'These rules are weaker in some engines than the harness asks. Read each one. Tick it to install it anyway.',
    driftIntro: 'Some engines read AGENTS.md and some read CLAUDE.md, so they would follow different instructions.',
    approvalsIntro: 'Each of these runs a command or sends a value. Read the words and tick each one.',
    acksIntro: 'Each of these may hold a rule Bowerloom does not carry. Tick each one to leave it out.',
    removeIntro: 'Bowerloom puts back each file it replaced and deletes the files it made. Your own changes elsewhere stay.',
    recoverIntro: 'An earlier run stopped part way. This plan finishes it or takes it back. Nothing else runs until it is done.',
    keepIntro: 'You changed these files after Bowerloom wrote them. Keep your versions, or put Bowerloom\'s back.',
    resultIntro: 'Bowerloom wrote only what the plan you approved listed. Each file is below.',
    notReady: 'Not ready: Bowerloom\'s plan is not ready though nothing waits on you. Plan again to check.',
    mergeIntro: 'Merge adds the text of CLAUDE.md to the harness instructions, under its own heading. CLAUDE.md itself does not change yet.',
    modeIntro: 'Only the file mode changed after Bowerloom wrote these files. Put the recorded mode back, or keep the new one.',
    checkAsk: 'Did this do what you wanted?', checkWhy: 'What were you trying to do?', checkThanks: 'Thanks. This stays on this computer.', checkFailed: 'Your answer was not saved.',
    everyEngineIntro: 'Each item reaches only the engines whose files held it. Tick a part to use its items for every engine.',
    saveIntro: 'Bowerloom changes only this folder\'s .bowerloom harness. You read every file first. Nothing changes until you save.',
    goBackIntro: 'Go back puts the harness as it was at that save point. Bowerloom keeps the harness as it is now as a save point too.',
  },
} as const);

/** The words of each result, as a dot and a word. Colour is never the only signal. */
export const RESULT_WORDS: Readonly<Record<ResultWord, string>> = Object.freeze({ exact: 'Exact', translated: 'Translated', weakened: 'Weakened', absent: 'Absent' });
export const RESULT_TONE: Readonly<Record<ResultWord, Tone>> = Object.freeze({ exact: 'good', translated: 'quiet', weakened: 'warn', absent: 'bad' });

/** The part names of a plan as a person says them. A part a later package adds is shown by its own name. */
const PARTS: Readonly<Record<string, string>> = Object.freeze({
  'system-prompt': 'Instructions', memory: 'Memory', 'tool-guidance': 'Tool guidance', skills: 'Skills', subagents: 'Agents', guardrails: 'Guardrails', hooks: 'Hooks',
  mcp: 'Servers', plugins: 'Plug-ins', scripts: 'Scripts', 'engine-private': 'Engine files', commands: 'Commands', legacy: 'Older Bowerloom files',
});
export const partName = (part: string | null): string => (part === null ? 'Other' : PARTS[part] ?? part);

export const GATE_WORDS: Readonly<Record<Gate, string>> = Object.freeze({ none: ENGINE_WORDS.hint.listedOnly, acknowledge: ENGINE_WORDS.hint.needsAck, block: ENGINE_WORDS.hint.mustFix });
export const GATE_TONE: Readonly<Record<Gate, Tone>> = Object.freeze({ none: 'quiet', acknowledge: 'warn', block: 'bad' });

export const CHANGE_WORDS: Readonly<Record<ChangeView['action'], string>> = Object.freeze({ create: 'New', replace: 'Replaces yours', 'take-over': 'Yours already, kept', update: 'Update', unchanged: 'Same', restore: 'Puts yours back', keep: 'Yours, left as is', delete: 'Deletes' });
export const CHANGE_TONE: Readonly<Record<ChangeView['action'], Tone>> = Object.freeze({ create: 'good', replace: 'warn', 'take-over': 'quiet', update: 'good', unchanged: 'quiet', restore: 'good', keep: 'quiet', delete: 'warn' });

export const RECOVERY_ACTION_WORDS: Readonly<Record<RecoveryView['action'], string>> = Object.freeze({ complete: 'Finish the stopped run', rollback: 'Take the stopped run back', keep: 'Keep your versions', mode: 'Settle the file modes' });
export const RECOVERY_DECISION_WORDS: Readonly<Record<'undo' | 'none' | 'keep', string>> = Object.freeze({ undo: 'Undo', none: 'Nothing to do', keep: 'Keep yours' });
export const RECOVERY_NOW_WORDS: Readonly<Record<'present' | 'missing' | 'unsafe', string>> = Object.freeze({ present: 'There now', missing: 'Gone', unsafe: 'Not safe to read' });
export const TRUST_WORDS: Readonly<Record<'pending trust' | 'trusted', string>> = Object.freeze({ 'pending trust': 'Pending trust', trusted: 'Trusted' });

export const DRIFT_WORDS: Readonly<Record<DriftLineView['reason'], string>> = Object.freeze({ changed: 'Changed since', missing: 'Gone since', unsafe: 'Not safe to read', mode: 'Mode changed since' });
export const DRIFT_TONE: Readonly<Record<DriftLineView['reason'], Tone>> = Object.freeze({ changed: 'warn', missing: 'bad', unsafe: 'bad', mode: 'warn' });
/** The two actions of a mode drift line (decision D5A). */
export const MODE_CHOICE_WORDS: Readonly<Record<ModeChoice, string>> = Object.freeze({ restoreMode: ENGINE_WORDS.label.restoreMode, recordMode: ENGINE_WORDS.label.recordMode });

// ---- words built from a name or a number

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** "Claude Code and Codex", "Every interface". */
export function engineList(names: readonly string[] | null): string {
  if (names === null) return ENGINE_WORDS.label.everyInterface;
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
/** "Write 7 files". */
export const writeFilesWords = (n: number): string => `Write ${plural(n, 'file', 'files')}`;
/** "Remove 4 files". */
export const removeFilesWords = (n: number): string => `Remove ${plural(n, 'file', 'files')}`;
/** "Read 9 files in ~/Projects/inbox. Nothing is written yet." */
export const readLine = (n: number, folder: string): string => `Read ${plural(n, 'file', 'files')} in ${folder}. Nothing is written yet.`;
/** "Changes 10 files in ~/Projects/weekly-report." */
export const changesLine = (n: number, folder: string): string => `Changes ${plural(n, 'file', 'files')} in ${folder}.`;
/** "I approve plan 1a2b3c4d". */
export const approvePlanWords = (short: string): string => `I approve plan ${short}`;
/** "Two copies of AGENTS.md differ." */
export const conflictWords = (id: string, n: number): string => `${n === 2 ? 'Two' : n} copies of ${id} differ.`;
/** "Using AGENTS.md." */
export const usingWords = (variant: string): string => `Using ${variant}.`;
/** "3 exact, 1 weakened, 1 absent". */
export function countsWords(counts: Readonly<Record<ResultWord, number>>): string {
  const parts = (Object.keys(RESULT_WORDS) as ResultWord[]).filter(r => counts[r] > 0).map(r => `${counts[r]} ${r}`);
  return parts.length === 0 ? 'Nothing to install' : parts.join(', ');
}
/** "Claude Code does not read AGENTS.md." */
export const hiddenWords = (engine: string, hidden: 'AGENTS.md' | 'CLAUDE.md' | null): string => (hidden === null ? `${engine} reads both files.` : `${engine} does not read ${hidden}.`);
/** "2 of 3 ticked". */
export const tickedWords = (done: number, all: number): string => `${done} of ${all} ticked`;
/** "Wrote 7 files into the .bowerloom folder." */
export const wroteAdoption = (n: number): string => `Wrote ${plural(n, 'file', 'files')} into the .bowerloom folder.`;
/** "Installed. 10 files written." */
export const wroteInstall = (n: number): string => `Installed. ${plural(n, 'file', 'files')} written.`;
/** "Removed. 3 files deleted, 1 put back." */
export const removedWords = (deleted: number, restored: number): string => `Removed. ${plural(deleted, 'file', 'files')} deleted, ${restored} put back.`;
/** "1 conflict, 2 acknowledgements, 3 approvals". */
export function waitingWords(counts: { conflict: number; acknowledge: number; block: number; problem: number; approval: number; unreadable?: number }): string {
  const parts = [
    counts.conflict ? plural(counts.conflict, 'copy to pick', 'copies to pick') : '', counts.acknowledge ? plural(counts.acknowledge, 'acknowledgement', 'acknowledgements') : '',
    counts.approval ? plural(counts.approval, 'approval', 'approvals') : '', counts.block ? plural(counts.block, 'file to change', 'files to change') : '',
    counts.unreadable ? plural(counts.unreadable, 'approval with no text', 'approvals with no text') : '', counts.problem ? plural(counts.problem, 'problem', 'problems') : '',
  ].filter(Boolean);
  return parts.length === 0 ? ENGINE_WORDS.hint.nothingWaits : parts.join(', ');
}
/** "Engine: Codex, version 0.157.0" as the engine heading of the loss report. */
export const engineHeading = (name: string, version: string | null): string => (version === null ? name : `${name}, version ${version}`);
/** The label of a tick box of one approve line: "Approve Guardrails no-force-push in Codex". */
export const approveLineName = (part: string, entry: string, engine: string): string => `Approve ${partName(part)} ${entry} in ${engine}`;
/** The engine names of a list of ids. */
export const engineNames = (ids: readonly EngineId[], names: Readonly<Record<EngineId, string>>): string[] => ids.map(id => names[id]);

/** "Approve Servers mail": the name of an adopt approval's tick box, with its item (U8). */
export const approveItemName = (part: string, id: string): string => `Approve ${partName(part)} ${id}`;
/** "Acknowledge .claude/settings.json#/permissions/defaultMode" (U8). */
export const acknowledgeName = (where: string): string => `Acknowledge ${where}`;
/** "Writes 7 files into the .bowerloom folder." */
export const writesIntoLine = (n: number): string => `Writes ${plural(n, 'file', 'files')} into the .bowerloom folder.`;
/** "1 item reaches only some engines.", "2 items now reach every engine.": the count beside a "Use for every engine" tick (D8B). */
export function everyEngineWords(n: number, chosen: boolean): string {
  if (n === 0) return 'Nothing here to widen.';
  const one = n === 1;
  return chosen ? `${plural(n, 'item', 'items')} now ${one ? 'reaches' : 'reach'} every engine.` : `${plural(n, 'item', 'items')} ${one ? 'reaches' : 'reach'} only some engines.`;
}
/** "2 items keep their engines, because they differ." (D8B: a tick never merges a difference.) */
export const notWidenedWords = (n: number): string => (n === 1 ? '1 item keeps its engines, because it differs.' : `${n} items keep their engines, because they differ.`);
/** "Still waiting for: 2 approvals". */
export const stillWaiting = (words: string): string => `${ENGINE_WORDS.label.waiting}: ${words}`;
/** "Reconcile: There is no CLAUDE.md…" for a choice that did not count. */
export const ignoredWords = (option: string, reason: string): string => `${option}: ${reason}`;
/** "A stopped install" or "A stopped removal", for the kind of a stopped run. */
const KIND_WORDS = Object.freeze({ apply: 'A stopped install', remove: 'A stopped removal' });
export const recoveryKindWords = (kind: RecoveryView['kind']): string => (kind === null ? 'No run stopped; only kept paths' : KIND_WORDS[kind]);
/** "Now 0700. Bowerloom wrote 0644." for one mode drift path. */
export const modeLine = (now: string, recorded: string): string => `Now ${now}. Bowerloom wrote ${recorded}.`;
/** "Restore mode: AGENTS.md", the name of one action of a mode line, so no two buttons sound the same (U8). */
export const modeActionName = (choice: ModeChoice, path: string): string => `${MODE_CHOICE_WORDS[choice]}: ${path}`;
/** "It goes under the heading From CLAUDE.md." */
export const headingLine = (heading: string): string => `It goes under the heading ${heading}.`;
// ---- the save step

/** What to do next after each refusal of the save step, under the refusal's own words. Main's and the packages' codes, each once. */
export const SAVE_REFUSAL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  SAVE_NO_DEFINITION: 'Make a harness first with New harness from a folder.',
  SAVE_SOURCE_MISSING: 'Choose another folder, or check that its harness loads.',
  SAVE_USAGE: 'Close the sheet and open it again.',
  SAVE_STALE: 'The harness changed since. Review the save again.',
  SAVE_DEFINITION_INVALID: 'Fix the files listed, then review the save again.',
  SAVE_SECRET_FOUND: 'Use a ${NAME} reference in place of the value.',
  SAVE_RECOVERY_REQUIRED: 'Finish the stopped change first, then save.',
  SAVE_PARTIAL: 'Finish the stopped change. It puts the files back.',
  SAVE_PATH_UNSAFE: 'Check the files listed by hand, then try again.',
  SAVE_TOO_LARGE: 'Make the harness smaller, then try again.',
  SAVE_STATE_UNSAFE: 'Bowerloom\'s private folder is not safe. Check who can write it.',
  SAVE_ABORTED: 'Nothing more changed. Save again when you are ready.',
  SAVE_RECOVER_NOTHING: 'Nothing stopped here. You can save now.',
  SAVE_FINISH_BLOCKED: 'Take the stopped save back, then save again.',
  EDIT_BAD_EDIT: 'Close the sheet and open it again.',
  EDIT_UNSAFE_ID: 'Close the sheet and open it again.',
  EDIT_UNKNOWN_ID: 'The harness changed since. Choose the folder again.',
  EDIT_DUPLICATE_ID: 'This harness holds that skill already.',
  EDIT_TOO_LARGE: 'Make the change smaller, then try again.',
  EDIT_SECRET_FOUND: 'Use a ${NAME} reference in place of the value.',
  EDIT_INVALID: 'The harness would not load. Clear the last change.',
  VERSION_USAGE: 'Close the sheet and open it again.',
  VERSION_UNKNOWN: 'That save point is gone. Pick another one.',
  VERSION_CORRUPT: 'Set the old save points aside to start a new record.',
  VERSION_TOO_LARGE: 'This harness is too large to keep a save point.',
  VERSION_STALE: 'The save points changed since. Review setting them aside again.',
  VERSION_NOTHING: 'There are no save points to set aside.',
  SAVE_POINT_TOO_LARGE: 'Make the harness smaller, then save again.',
  EDIT_UNSAFE_PATH: 'Choose the notes folder again, then save.',
  SOURCE_NAME_TAKEN: 'Give these notes another name, then save.',
  KIT_INVALID: 'Install Bowerloom again to repair the notes keeper.',
  KIT_ALREADY_ADDED: 'The notes keeper is here already. Nothing to add.',
  KNOWLEDGE_PATH_UNSAFE: 'Choose a notes folder inside your home folder.',
  KNOWLEDGE_PATH_ESCAPES: 'Choose the notes folder again, then save.',
  KNOWLEDGE_PATH_OUTSIDE: 'Move the notes into your home folder, then choose them again.',
  SAVE_EXECUTABLE_UNACKNOWLEDGED: 'Tick that you read the files that can run, then save.',
});

/** What to do next after each refusal of the notes calls (spec 6.9), under the refusal's own words. The package's NOTES_ codes and main's, each once. */
export const NOTES_REFUSAL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  NOTES_USAGE: 'Close this and open it again.',
  NOTES_FOLDER_MISSING: 'The folder is gone. Choose your notes folder again.',
  NOTES_PATH_UNSAFE: 'Choose a plain folder of your own, not a link.',
  NOTES_NOT_EMPTY: 'Choose an empty folder, or make a new one.',
  NOTES_TEMPLATE_INVALID: 'Install Bowerloom again to repair the starter notes.',
  NOTES_STALE: 'The folder changed. Look at the plan again.',
  NOTES_ALREADY_REPOSITORY: 'This folder keeps its history already. Nothing to do.',
  NOTES_PARENT_REPOSITORY: 'Use this folder with Use my notes, or pick one outside.',
  NOTES_NESTED_REPOSITORY: 'A folder inside keeps its own history. Move it out first.',
  NOTES_GIT_FILES: 'Remove the git settings file, then try again.',
  NOTES_NOTHING_TO_COMMIT: 'Add a page to the folder first, then try again.',
  NOTES_TOO_LARGE: 'Start the history by hand with git for this folder.',
  NOTES_GIT_MISSING: 'Install the Command Line Tools for Xcode, then try again.',
  NOTES_GIT_ARGV: 'Report a problem from the Help menu.',
  NOTES_GIT_CONFIG: 'Remove the filter, ssh, mailmap, or include settings from its git config.',
  NOTES_GIT_TIMEOUT: 'Try again. If it stops again, report a problem.',
  NOTES_GIT_OUTPUT: 'Report a problem from the Help menu.',
  NOTES_GIT_FAILED: 'Try again. If it fails again, report a problem.',
  NOTES_PARTIAL: 'Check the files listed, then start again in an empty folder.',
  KIT_INVALID: 'Install Bowerloom again to repair the notes keeper.',
  NOT_A_FOLDER: 'Choose a folder, not a file.',
  NOTES_NOT_CHOSEN: 'Choose this folder with Use my notes first.',
  REPORT_NONE: 'Ask the Notes keeper for a tidy-up report first.',
  REPORT_NOT_SHOWN: 'Close this sheet and open it again to read the notes.',
  REPORT_UNSAFE: 'Check the reports folder by hand. Bowerloom opens no link.',
  REPORT_OPEN_FAILED: 'Open the report from the notes folder by hand.',
});
/**
 * What to do after a notes write stopped part way (NOTES_PARTIAL), by the step that stopped: the starter wrote files into an empty folder; the history start
 * made a `.git` folder in a folder that had none, which the person can remove to try again. The starter's words are NOTES_PARTIAL's own.
 */
export const NOTES_PARTIAL_WORDS: Readonly<Record<'starter' | 'history', string>> = Object.freeze({
  starter: NOTES_REFUSAL_WORDS.NOTES_PARTIAL!,
  history: 'Bowerloom just made its .git folder. Remove it, then try again.',
});
/** The next-step words of a notes refusal, for the write that was running: `history`, `starter`, or none. */
export function notesNextWords(refusal: Refusal, during: 'starter' | 'history' | null): string | null {
  if (refusal.code === 'NOTES_PARTIAL' && during !== null) return NOTES_PARTIAL_WORDS[during];
  return NOTES_REFUSAL_WORDS[refusal.code] ?? null;
}
const plain = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** "Save 3 files". */
export const saveFilesWords = (n: number): string => `Save ${plain(n, 'file', 'files')}`;
/** "Go back to v2". */
export const goBackWords = (id: string): string => `Go back to ${id}`;
/** "From ~/Projects/source": where a copied file or skill comes from. */
export const fromWords = (label: string): string => `From ${label}`;
/** "Add summarize from ~/Projects/source": the name of a copy's Add button. */
export const copyAddName = (skill: string, label: string): string => `Add ${skill} from ${label}`;
/** "Take summarize out": the name of the button that takes a copy out of the draft. */
export const copyTakeOutName = (skill: string): string => `Take ${skill} out`;
/** "2 changes, not saved yet." */
export const draftWords = (n: number): string => (n === 0 ? 'No change yet.' : `${plain(n, 'change', 'changes')}, not saved yet.`);
/** "2026-10-30 12:00 UTC, 3 files": when a save point was kept, and how many files it holds. */
export const savePointLine = (created: string, files: number): string => `${created.slice(0, 10)} ${created.slice(11, 16)} UTC, ${plain(files, 'file', 'files')}`;

/** "Claude Code, version 2.1.310, model sonnet". */
export const engineDetails = (name: string, version: string | null, model: string | null): string => [name, version === null ? null : `version ${version}`, model === null ? null : `model ${model}`].filter(Boolean).join(', ');
