/**
 * The fixed words of the two sheets that reach the packages: "New harness from a folder" (adoption) and "Install a folder's harness" (the projection, with its
 * removal and recovery), and the drift report inside it. The same shape and limits as WORDS (words.ts): a label at most 5 words, a hint at most 12, a paragraph at
 * most 25, and no banned word, so "adopt", "apply", "import" and "MCP" never reach the screen. tests/engine-words.test.ts holds the table and the builders to it.
 * The words that come from a plan (a reason, a rule, a path) are shown as the packages wrote them.
 */
import type { ChangeView, EngineId, Gate, ResultWord } from '../../shared/engine/types.js';
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
  },
  hint: {
    pickFolder: 'Pick the folder Bowerloom reads.', samplePick: 'Sample folders. Nothing is read or written.', readOnly: 'Bowerloom only reads until you approve.',
    noFolders: 'No folder yet. Choose one to start.', holdsHarness: 'Holds a harness already.', noHarness: 'No harness here yet.',
    installedBefore: 'Bowerloom installed here before.', stopped: 'An install stopped part way here.', stoppedHarness: 'A new harness stopped part way here.',
    pickOne: 'Pick one to go on.', tickEach: 'Tick each one to go on.', tickToApprove: 'I read this and approve it.', tickToAcknowledge: 'I read this. Leave it out.',
    allTicked: 'Every one is ticked.', nothingWaits: 'Nothing is waiting.', listedOnly: 'Listed only.', needsAck: 'Needs your acknowledgement.', mustFix: 'Change the file first.',
    shownInFull: 'Shown in full. Read it before you approve.', pendingTrust: 'Pending trust', trusted: 'Trusted',
    fromVariable: 'read from a variable when it runs', noLines: 'Nothing to install for this interface.', defaultChoice: 'The default',
    mergeNotBuilt: 'Not built yet. Pick another way.', approveChanged: 'The plan changed. Approve it again.', pickInterface: 'Pick at least one interface.',
    sameAsNow: 'The folder already matches. Nothing is written.', removeNote: 'Bowerloom puts back what it replaced and deletes only its own files.',
    acceptAgentsText: 'CLAUDE.md becomes one line: @AGENTS.md.', mergeText: 'Moves CLAUDE.md into the harness.', keepBothText: 'CLAUDE.md stays. Claude Code keeps reading it.',
    sampleNote: 'Sample. Nothing is written to your disk.',
    keptChanged: 'Changed since. It stays.', keptUnsafe: 'Not safe to read. It stays.',
    noBridge: 'This window cannot reach Bowerloom. Start it with the real launch command.',
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

export const CHANGE_WORDS: Readonly<Record<ChangeView['action'], string>> = Object.freeze({ create: 'New', replace: 'Replaces yours', update: 'Update', unchanged: 'Same', restore: 'Puts yours back', delete: 'Deletes' });
export const CHANGE_TONE: Readonly<Record<ChangeView['action'], Tone>> = Object.freeze({ create: 'good', replace: 'warn', update: 'good', unchanged: 'quiet', restore: 'good', delete: 'warn' });

export const RECOVERY_ACTION_WORDS: Readonly<Record<'complete' | 'rollback' | 'keep', string>> = Object.freeze({ complete: 'Finish the stopped run', rollback: 'Take the stopped run back', keep: 'Keep your versions' });
export const RECOVERY_DECISION_WORDS: Readonly<Record<'undo' | 'none' | 'keep', string>> = Object.freeze({ undo: 'Undo', none: 'Nothing to do', keep: 'Keep yours' });
export const RECOVERY_NOW_WORDS: Readonly<Record<'present' | 'missing' | 'unsafe', string>> = Object.freeze({ present: 'There now', missing: 'Gone', unsafe: 'Not safe to read' });
export const TRUST_WORDS: Readonly<Record<'pending trust' | 'trusted', string>> = Object.freeze({ 'pending trust': 'Pending trust', trusted: 'Trusted' });

export const DRIFT_WORDS: Readonly<Record<'changed' | 'missing' | 'unsafe', string>> = Object.freeze({ changed: 'Changed since', missing: 'Gone since', unsafe: 'Not safe to read' });

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
export function waitingWords(counts: { conflict: number; acknowledge: number; block: number; problem: number; approval: number }): string {
  const parts = [
    counts.conflict ? plural(counts.conflict, 'copy to pick', 'copies to pick') : '', counts.acknowledge ? plural(counts.acknowledge, 'acknowledgement', 'acknowledgements') : '',
    counts.approval ? plural(counts.approval, 'approval', 'approvals') : '', counts.block ? plural(counts.block, 'file to change', 'files to change') : '', counts.problem ? plural(counts.problem, 'problem', 'problems') : '',
  ].filter(Boolean);
  return parts.length === 0 ? ENGINE_WORDS.hint.nothingWaits : parts.join(', ');
}
/** "Engine: Codex, version 0.157.0" as the engine heading of the loss report. */
export const engineHeading = (name: string, version: string | null): string => (version === null ? name : `${name}, version ${version}`);
/** The label of a tick box of one approve line: "Approve Guardrails no-force-push in Codex". */
export const approveLineName = (part: string, entry: string, engine: string): string => `Approve ${partName(part)} ${entry} in ${engine}`;
/** The engine names of a list of ids. */
export const engineNames = (ids: readonly EngineId[], names: Readonly<Record<EngineId, string>>): string[] => ids.map(id => names[id]);
