/**
 * The fixed words of the two sheets that reach the packages: "New harness from a folder" (adoption) and "Install a folder's harness" (the projection, with its
 * removal and recovery), and the drift report inside it. The same shape and limits as WORDS (words.ts): a label at most 5 words, a hint at most 12, a paragraph at
 * most 25, and no banned word, so "adopt", "apply", "import" and "MCP" never reach the screen. tests/engine-words.test.ts holds the table and the builders to it.
 * The words that come from a plan (a reason, a rule, a path) are shown as the packages wrote them.
 */
import type { ChangeView, DriftLineView, EngineId, Gate, ModeChoice, RecoveryView, ResultWord } from '../../shared/engine/types.js';
import type { Tone } from '../../shared/harness/status.js';

const deepFreeze = <T extends object>(value: T): T => {
  for (const inner of Object.values(value)) if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  return Object.freeze(value);
};

export const ENGINE_WORDS = deepFreeze({
  label: {
    adoptTitle: 'New harness from a folder', installTitle: 'Install a folder\'s harness', removeTitle: 'Remove what Bowerloom wrote', recoverTitle: 'Finish a stopped install',
    recoverAdoptTitle: 'Finish a stopped harness', fromFolder: 'From a folder', installFolder: 'Install from a folder',
    stepFolder: 'Folder', stepReview: 'Review', stepConfirm: 'Confirm', stepInterfaces: 'Interfaces', steps: 'Steps',
    chooseFolder: 'Choose a folder', folders: 'Folders', next: 'Next', back: 'Back', cancel: 'Cancel', close: 'Close',
    found: 'What Bowerloom found', foundIn: 'Found in', pickCopy: 'Pick one copy', differ: 'Rules that differ by interface', notCarried: 'Not carried over',
    secrets: 'Secrets replaced', filesWritten: 'Files it writes', approveEach: 'Approve each one', acknowledgeEach: 'Acknowledge each one', fixFirst: 'Fix these first',
    notes: 'Notes', problems: 'Problems', waiting: 'Still waiting for', everyInterface: 'Every interface',
    approveLines: 'Approve each weaker rule', planWithApprovals: 'Plan with these approvals', lossReport: 'What each interface gets', trust: 'Waiting for your trust',
    review: 'Code and commands to read', drift: 'AGENTS.md and CLAUDE.md differ', reconcile: 'What to do', driftLines: 'Changed since Bowerloom wrote them',
    approved: 'Approved weaker rules', changes: 'Files it changes', notApplied: 'Choices that did not count', environment: 'Environment',
    acceptAgents: 'Accept AGENTS.md', merge: 'Merge', keepBoth: 'Keep both', writeClaude: 'Write CLAUDE.md as @AGENTS.md',
    planRemoval: 'Plan a removal', planRecovery: 'Plan a recovery', keepMine: 'Keep my versions', folderGone: 'Folders it removes',
    nothingToChange: 'Nothing to change', finish: 'Finish', engineChoices: 'Interfaces to install for', resultDetails: 'Lines',
    planning: 'Planning', writing: 'Writing', refusal: 'Bowerloom stopped', installIt: 'Install it', acknowledged: 'Acknowledged', becomes: 'becomes', newFile: 'New',
    planAgain: 'Plan again', result: 'What Bowerloom did', writtenFiles: 'Written', removedFiles: 'Removed', restoredFiles: 'Put back', keptFiles: 'Kept as they are',
    leftBehind: 'Left behind', leftFolders: 'Folders left', undo: 'Undo', converted: 'Older Bowerloom copies', filterLeaks: 'Skills read past their filter',
    pendingTrust: 'Skills that wait for trust', checkByHand: 'Files to check by hand', foldersRemoved: 'Folders it removes when empty', exactText: 'The exact text',
    stepResult: 'Done', bodyFolder: 'Pick a folder', bodyReview: 'Review the plan', bodyConfirm: 'Confirm each one', bodyResult: 'What Bowerloom did', bodyInterfaces: 'Pick the interfaces',
    writeFiles: 'Write files', undoneFiles: 'Taken back', engineFound: 'Found here', engineNamed: 'Named, not found', shape: 'Read as',
    mergeIt: 'Merge into the harness', mergeText: 'CLAUDE.md text to move', restoreMode: 'Restore mode', recordMode: 'Keep new mode', modes: 'File modes',
    checkYes: 'Yes', checkPartly: 'Partly', checkNo: 'No', checkSave: 'Save', checkSkip: 'Skip',
    modeRestored: 'Mode put back', modeRecorded: 'New mode kept', everyEngine: 'Use for every engine', everyEngineTitle: 'For every engine',
  },
  hint: {
    pickFolder: 'Pick the folder Bowerloom reads.', samplePick: 'Sample folders. Nothing is read or written.', readOnly: 'Bowerloom only reads until you approve.',
    noFolders: 'No folder yet. Choose one to start.', holdsHarness: 'Holds a harness already.', noHarness: 'No harness here yet.',
    installedBefore: 'Bowerloom installed here before.', stopped: 'An install stopped part way here.', stoppedHarness: 'A new harness stopped part way here.',
    pickOne: 'Pick one to go on.', tickEach: 'Tick each one to go on.', tickToApprove: 'I read this and approve it.', tickToAcknowledge: 'I read this. Leave it out.',
    allTicked: 'Every one is ticked.', nothingWaits: 'Nothing is waiting.', listedOnly: 'Listed only.', needsAck: 'Needs your acknowledgement.', mustFix: 'Change the file first.',
    shownInFull: 'Shown in full. Read it before you approve.', pendingTrust: 'Pending trust', trusted: 'Trusted',
    fromVariable: 'read from a variable when it runs', noLines: 'Nothing to install for this interface.', defaultChoice: 'The default',
    approveChanged: 'The plan changed. Approve it again.', pickInterface: 'Pick at least one interface.',
    previewTag: 'Preview', previewKept: 'Installed earlier. Left as it is.', previewOff: 'Preview. Start Bowerloom with BOWERLOOM_PREVIEW_ENGINES=1 to install.',
    previewOnly: 'This harness lists preview interfaces only. Set BOWERLOOM_PREVIEW_ENGINES=1.',
    sameAsNow: 'The folder already matches. Nothing is written.', removeNote: 'Bowerloom puts back what it replaced and deletes only its own files.',
    acceptAgentsText: 'CLAUDE.md becomes one line: @AGENTS.md.', mergeText: 'Moves CLAUDE.md into the harness.', keepBothText: 'CLAUDE.md stays. Claude Code keeps reading it.',
    sampleNote: 'Sample. Nothing is written to your disk.',
    keptChanged: 'Changed since. It stays.', keptUnsafe: 'Not safe to read. It stays.',
    noBridge: 'This window cannot reach Bowerloom. Start it with the real launch command.',
    agentsPresent: 'AGENTS.md is in the folder.', agentsPlanned: 'This install writes AGENTS.md.', approvedEarlier: 'approved earlier, unchanged since', approvedNow: 'approved now',
    readyToWrite: 'Ready to write.',
    journalOk: 'The stopped run\'s record is whole.', journalDamaged: 'The stopped run\'s record is damaged. Check these files by hand.',
    nothingFound: 'Bowerloom found nothing to carry over in this folder.', noEngines: 'This harness lists no interface. Add one to harness.json.',
    nothingToRemove: 'Nothing to remove. Bowerloom wrote nothing here.', nothingChanged: 'Nothing changed. The folder already matched the plan.',
    noText: 'Bowerloom has no file text for this approval.', cannotApprove: 'This line cannot be approved here. Change the harness first.',
    leftBehindWhy: 'Bowerloom could not remove these. Check them by hand.', keptWhy: 'These changed since, so Bowerloom left them.',
    merged: 'Merged. The harness now holds the CLAUDE.md text.', mergeThen: 'Next, the install uses Accept AGENTS.md.',
    addsPart: 'harness.json gains the instructions part.', noClaudeText: 'Bowerloom cannot show this text. Plan again.',
  },
  paragraph: {
    adoptIntro: 'Bowerloom reads the files your interfaces use and proposes a harness. It writes only into .bowerloom, and only after you approve.',
    installIntro: 'Bowerloom writes each interface\'s own files from the folder\'s harness. You read every line first. Nothing changes until you approve the plan.',
    approveIntro: 'These rules are weaker in some interfaces than the harness asks. Read each one. Tick it to install it anyway.',
    driftIntro: 'Some interfaces read AGENTS.md and some read CLAUDE.md, so they would follow different instructions.',
    approvalsIntro: 'Each of these runs a command or sends a value. Read the words and tick each one.',
    acksIntro: 'Each of these may hold a rule Bowerloom does not carry. Tick each one to leave it out.',
    removeIntro: 'Bowerloom puts back each file it replaced and deletes the files it made. Your own changes elsewhere stay.',
    recoverIntro: 'An earlier run stopped part way. This plan finishes it or takes it back. Nothing else runs until it is done.',
    keepIntro: 'You changed these files after Bowerloom wrote them. Keep your versions, or put Bowerloom\'s back.',
    resultIntro: 'Bowerloom wrote only what the plan you approved listed. Each file is below.',
    notReady: 'Not ready: Bowerloom\'s plan is not ready though nothing waits on you. Plan again to check.',
    mergeIntro: 'Merge adds the text of CLAUDE.md to the harness instructions, under its own heading. CLAUDE.md itself does not change yet.',
    modeIntro: 'Only the file mode changed after Bowerloom wrote these files. Put the recorded mode back, or keep the new one.',
    checkAsk: 'Did this do what you wanted?', checkWhy: 'What were you trying to do?', checkThanks: 'Thanks. This stays on this computer.',
    everyEngineIntro: 'Each item reaches only the engines whose files held it. Tick a part to use its items for every engine.',
  },
} as const);

/** The words of each result, as a dot and a word. Colour is never the only signal. */
export const RESULT_WORDS: Readonly<Record<ResultWord, string>> = Object.freeze({ exact: 'Exact', translated: 'Translated', weakened: 'Weakened', absent: 'Absent' });
export const RESULT_TONE: Readonly<Record<ResultWord, Tone>> = Object.freeze({ exact: 'good', translated: 'quiet', weakened: 'warn', absent: 'bad' });

/** The part names of a plan as a person says them. A part a later package adds is shown by its own name. */
const PARTS: Readonly<Record<string, string>> = Object.freeze({
  'system-prompt': 'Instructions', memory: 'Memory', 'tool-guidance': 'Tool guidance', skills: 'Skills', subagents: 'Agents', guardrails: 'Guardrails', hooks: 'Hooks',
  mcp: 'Servers', plugins: 'Plug-ins', scripts: 'Scripts', 'engine-private': 'Interface files', commands: 'Commands', legacy: 'Older Bowerloom files',
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
/** "Claude Code, version 2.1.310, model sonnet". */
export const engineDetails = (name: string, version: string | null, model: string | null): string => [name, version === null ? null : `version ${version}`, model === null ? null : `model ${model}`].filter(Boolean).join(', ');
