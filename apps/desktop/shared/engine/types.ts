/**
 * The plain data the harness-first window gets about adoption and the projection, and the calls it may make. The main process runs the packages
 * (packages/adoption, packages/project-sync) and hands back only these shapes: no absolute path of the person's folders, no file bytes, and no function.
 * The sample launch answers the same calls from synthetic fixtures in memory (shared/engine/sample.ts) and writes nothing.
 */

import type { SavedScanAnswer, SavedScanCheck } from '../real/saved-scan.js';

/** The engine ids are the harness definition core's own list (shared/engine/engines.ts). Only the type is named here, so this file, which the bridge imports, pulls in no package. */
import type { EngineId } from '../../../../packages/harness-definition/src/words.js';
export type { EngineId };

/** How each engine is named on a screen. */
export const ENGINE_NAMES: Readonly<Record<EngineId, string>> = Object.freeze({
  'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'Pi', 'deepseek-harness': 'DeepSeek Harness',
});

/** The result words of the fidelity check, from best to worst. */
export const RESULTS = Object.freeze(['exact', 'translated', 'weakened', 'absent'] as const);
export type ResultWord = (typeof RESULTS)[number];

/** The three ways to settle a CLAUDE.md that does not follow AGENTS.md. Accept AGENTS.md is the default. */
export const RECONCILE = Object.freeze(['accept-agents', 'merge', 'keep-both'] as const);
export type Reconcile = (typeof RECONCILE)[number];

/** A refusal of a package, as plain words. `paths` are relative to the project or written with `~`. */
export interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly paths: readonly string[];
  /** For a refusal because files Bowerloom wrote changed since: each one, with why. */
  readonly drift?: readonly DriftLineView[];
  /** For a step that stopped part way (NOTES_PARTIAL): the code of the refusal that stopped it. */
  readonly step?: string;
}
/** Every call answers this way, so a refusal reaches the window with its words and is never lost in an error. */
export type Answer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal };

/** A folder the person chose, by the id the main process gave it. */
export interface FolderInfo {
  readonly id: string;
  /** The folder, written with `~` for the home folder. */
  readonly label: string;
  readonly name: string;
  /** True when the folder holds `.bowerloom/harness.json`. */
  readonly hasDefinition: boolean;
  /**
   * True when the folder's harness has an entry, instructions, a source or knowledge, so an import is refused there (IMPORT_FOLDER_HAS_HARNESS); false when the harness is
   * empty; left out when main did not read it. Main fills it from the harness it loads. The Import sheet marks such a folder as refused before the person goes on.
   */
  readonly holdsParts?: boolean;
  /** The engines harness.json lists, when it loads. */
  readonly engines: readonly EngineId[];
  /**
   * True when the app may install to preview engines (OpenCode, Pi, DeepSeek Harness): main read BOWERLOOM_PREVIEW_ENGINES=1 from its own environment.
   * Only this one answer reaches the window, never the environment. The same for every folder.
   */
  readonly previewEngines: boolean;
  /** The engines the receipt of an earlier install here lists, in engine order. Empty when nothing is installed. */
  readonly installedEngines: readonly EngineId[];
  /** Why the definition does not load, or null. */
  readonly problem: string | null;
  /** True when Bowerloom has a receipt of an earlier install here. */
  readonly projected: boolean;
  /** True when an install, a removal or an adoption stopped part way. */
  readonly unfinished: { readonly projection: boolean; readonly adoption: boolean };
}

// ---- adoption -----------------------------------------------------------------------------------------------------------

export type AdoptPart = 'system-prompt' | 'skills' | 'subagents' | 'guardrails' | 'hooks' | 'mcp' | 'engine-private';
export type Gate = 'none' | 'acknowledge' | 'block';

export interface PlaceView {
  readonly path: string;
  readonly pointer: string | null;
  readonly engines: readonly EngineId[];
  readonly shape: string;
  readonly shapeVersion: string | null;
}
export interface AdoptItemView {
  /** `<part>/<id>`, the key an approval names. */
  readonly key: string;
  readonly part: AdoptPart;
  readonly id: string;
  readonly places: readonly PlaceView[];
  /** null: every engine of the harness. */
  readonly engines: readonly EngineId[] | null;
  readonly needsApproval: readonly string[];
  readonly notes: readonly string[];
}
export interface AdoptConflictView {
  readonly key: string;
  readonly part: AdoptPart;
  readonly id: string;
  readonly variants: readonly { readonly key: string; readonly places: readonly PlaceView[] }[];
  /** The variant the person picked, or null. */
  readonly picked: string | null;
}
export interface AdoptDifferenceView {
  readonly action: string;
  readonly pattern: string;
  readonly rules: readonly { readonly id: string; readonly effect: string; readonly engines: readonly EngineId[] }[];
}
export interface AdoptUnmappedView {
  readonly id: string;
  readonly path: string;
  readonly pointer: string | null;
  readonly part: string | null;
  readonly reason: string;
  readonly gate: Gate;
  readonly acknowledged: boolean;
  /** A hash of what the person reads about this entry (its id, place, part, reason and gate). An acknowledgement names it (U3). */
  readonly hash: string;
}
export interface AdoptSecretView { readonly path: string; readonly pointer: string; readonly reference: string; readonly key: string }
/** One approval adoption needs: the item, every reason a person reads, and the secrets it replaced. */
export interface AdoptApprovalView {
  readonly key: string;
  readonly part: AdoptPart;
  readonly id: string;
  readonly reasons: readonly string[];
  readonly places: readonly PlaceView[];
  readonly secrets: readonly AdoptSecretView[];
  /** The exact text the approval covers, from the planned definition files: the hook or server entry, the skill, the agent (U7). */
  readonly text: readonly { readonly path: string; readonly text: string }[];
  /** A hash of everything above. A tick names it, so a change to any of it clears the tick (U3). */
  readonly hash: string;
  /** Why this approval cannot be given here, or null. An approval with no text to show is a block, never a tick (W4). */
  readonly blocked: string | null;
}
/** The parts that take "Use for every engine" (decision D8B), in the order the sheet shows them. */
export type EveryEnginePart = 'guardrails' | 'hooks' | 'mcp';
export const EVERY_ENGINE_PARTS: readonly EveryEnginePart[] = Object.freeze(['guardrails', 'hooks', 'mcp'] as const);
/** "Use for every engine" for one part: whether it is ticked, how many items it widens, and the items it never widens, each with why (D8B). */
export interface AdoptEveryEngineView {
  readonly part: EveryEnginePart;
  readonly chosen: boolean;
  readonly widens: number;
  readonly notWidened: readonly { readonly id: string; readonly reason: string }[];
}
export interface AdoptView {
  readonly folder: string;
  readonly harness: { readonly id: string; readonly description: string };
  readonly engines: readonly { readonly id: EngineId; readonly version: string | null; readonly model: string | null; readonly detected: boolean }[];
  readonly read: number;
  readonly items: readonly AdoptItemView[];
  readonly conflicts: readonly AdoptConflictView[];
  readonly differences: readonly AdoptDifferenceView[];
  /** One row per part, guardrails, hooks and servers, in that order (D8B). */
  readonly everyEngine: readonly AdoptEveryEngineView[];
  readonly unmapped: readonly AdoptUnmappedView[];
  readonly secrets: readonly AdoptSecretView[];
  readonly managed: readonly { readonly catalog: string; readonly id: string; readonly skill: string | null; readonly reason: string }[];
  readonly warnings: readonly string[];
  /** The files written into `.bowerloom`, relative to it. */
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
  readonly approvals: readonly AdoptApprovalView[];
  readonly problems: readonly { readonly code: string; readonly path: string; readonly message: string }[];
  readonly ready: boolean;
  readonly revision: string;
}
/** What the person chose in the adopt sheet. Sent with every plan, so the plan the window shows is the plan that will be written. */
export interface AdoptChoices {
  /** The picked variant key of each conflict, by conflict key. */
  readonly picks: Readonly<Record<string, string>>;
  /** The gated unmapped entries the person acknowledged, each by id and by the hash of what the person read. */
  readonly acknowledged: readonly { readonly id: string; readonly hash: string }[];
  /** The parts ticked "Use for every engine" (D8B). None when left out. */
  readonly everyEngine?: readonly EveryEnginePart[];
}
export interface AdoptWritten { readonly written: readonly string[] }
/** One approval as the window sends it: the key and the hash of what the person read. */
export interface AdoptApproval { readonly key: string; readonly hash: string }

/** The recovery of a stopped run in the `.bowerloom` folder: an adoption that stopped part way, or a Merge that did (decision D4A). */
export interface AdoptRecoveryView {
  /**
   * `adoption`: the stopped run made a new harness; recovery removes its files. `merge`: the stopped run was a Merge; recovery puts the files back.
   * `save`: the stopped run was a save of the harness; recovery takes it back, putting each file as it was before, unless the save was done (`done`).
   */
  readonly kind: 'adoption' | 'merge' | 'save';
  readonly journal: 'ok' | 'damaged';
  /**
   * A save only: true when the save finished and only its note was left (a whole journal, every file the save's target, none changed since). Recovery
   * then changes no file: the save stays, and Bowerloom clears its note. `remove` and `restore` are empty.
   */
  readonly done?: boolean;
  readonly check: readonly string[];
  readonly remove: readonly string[];
  /** Files that go back to the bytes the stopped Merge replaced. Empty for an adoption. */
  readonly restore: readonly string[];
  readonly kept: readonly { readonly path: string; readonly reason: 'changed' | 'unsafe' }[];
  readonly dirs: readonly string[];
  readonly revision: string;
}
/**
 * What a recovery of a stopped harness did. `revision` is the harness revision after it, or null when the folder's harness does not load (after an adoption is
 * taken back, null also when no harness is left). `check` lists the files a person checks by hand: every file of a damaged journal, and every file the
 * recovery kept because it changed since the stop.
 */
export interface AdoptRecovered {
  readonly removed: readonly string[]; readonly restored: readonly string[]; readonly kept: readonly string[]; readonly leftFolders: readonly string[];
  readonly revision: string | null;
  readonly check: readonly string[];
}

// ---- the projection -------------------------------------------------------------------------------------------------------

export interface LossView {
  readonly part: string;
  readonly entry: string;
  readonly field: string | null;
  readonly engine: EngineId;
  readonly result: ResultWord;
  readonly reason: string;
}
/** One engine's lines, part by part, in the order the plan lists them. */
export interface EngineLossView {
  readonly engine: EngineId;
  readonly version: string | null;
  readonly parts: readonly { readonly part: string; readonly lines: readonly LossView[] }[];
  readonly counts: Readonly<Record<ResultWord, number>>;
}
export interface TrustView { readonly engine: EngineId; readonly path: string; readonly entry: string | null; readonly state: 'pending trust' | 'trusted'; readonly reason: string }
export interface ReviewView {
  readonly path: string;
  readonly engine: EngineId;
  readonly kind: 'code' | 'command';
  readonly part: string | null;
  readonly entry: string | null;
  /** The whole text: a command with its arguments, or the whole file of code. Never cut. */
  readonly text: string;
  /** Each environment name the command gets, with its value, or null for a value read from a variable when it runs. */
  readonly env: readonly { readonly name: string; readonly value: string | null }[];
}
export interface InstructionDriftView {
  /** `present`: the folder holds AGENTS.md. `planned`: the install writes it. */
  readonly agents: 'present' | 'planned';
  readonly engines: readonly { readonly engine: EngineId; readonly hidden: 'AGENTS.md' | 'CLAUDE.md' | null; readonly rule: string }[];
  readonly actions: readonly Reconcile[];
  readonly defaultAction: 'accept-agents';
}
/** `mode`: the bytes are the ones Bowerloom wrote and only the file mode changed (decision D5A). */
export interface DriftLineView { readonly path: string; readonly reason: 'changed' | 'missing' | 'unsafe' | 'mode' }
export interface ApprovedView {
  readonly part: string; readonly entry: string; readonly field: string | null; readonly engine: EngineId; readonly result: 'weakened' | 'absent'; readonly when: string; readonly reason: string;
  /** True for an approval recorded by an earlier install and reused for the unchanged entry; false for one ticked in this sheet. */
  readonly earlier: boolean;
}
/**
 * One path of a plan. `take-over`: the person's file already holds what Bowerloom would write (or means the same to the engine), so the install records it
 * and writes nothing. `keep`: a removal leaves a taken-over file as it is, unwritten. The others write or delete the file.
 */
export interface ChangeView { readonly path: string; readonly action: 'create' | 'replace' | 'take-over' | 'update' | 'unchanged' | 'restore' | 'keep' | 'delete'; readonly engines: readonly EngineId[] }
/** The actions that write nothing in the folder. Main counts files for its dialog without them. */
export const WRITES_NOTHING: readonly ChangeView['action'][] = Object.freeze(['unchanged', 'take-over', 'keep']);
export const writesFile = (c: { readonly action: ChangeView['action'] }): boolean => !WRITES_NOTHING.includes(c.action);
/** A person's file, or one entry of a file, that an install takes over unchanged. `entry` is null for a whole file. */
export interface TakenOverView { readonly path: string; readonly entry: string | null }
export interface ProjectView {
  readonly folder: string;
  readonly harness: string;
  readonly engines: readonly EngineLossView[];
  readonly partial: boolean;
  readonly notice: string | null;
  readonly trust: readonly TrustView[];
  readonly review: readonly ReviewView[];
  readonly drift: InstructionDriftView | null;
  readonly reconcile: Reconcile | null;
  /** Files Bowerloom wrote earlier that changed or went since, with why. */
  readonly driftLines: readonly DriftLineView[];
  readonly approved: readonly ApprovedView[];
  readonly changes: readonly ChangeView[];
  /** The person's files and entries this install takes over unchanged, in path order. */
  readonly takenOver: readonly TakenOverView[];
  readonly offers: readonly { readonly action: 'write-claude-md'; readonly reason: string }[];
  readonly ignored: readonly { readonly option: string; readonly reason: string }[];
  readonly pendingTrust: readonly string[];
  readonly filterLeaks: readonly { readonly skill: string; readonly path: string; readonly engines: readonly EngineId[] }[];
  /**
   * Beta.1: the listed preview engines this plan leaves out, those among them whose files from an earlier install stay as they are, and the one sentence
   * that says so and names the switch. Empty and null when the app may install to preview engines or none is listed.
   */
  readonly skippedPreview: readonly EngineId[];
  readonly keptPreview: readonly EngineId[];
  readonly previewNotice: string | null;
  readonly noop: boolean;
  readonly revision: string;
}
/** A weakened or absent enforced line that needs a person's approval before the plan can be made. `key` names it in `ProjectInput.approve`. */
export interface ApproveLineView extends LossView {
  /** The line and the hash of its entry: a changed entry is a new key, so an earlier tick never covers it (U15). */
  readonly key: string;
  /** False for a line whose entry the definition does not hold: it is shown, and it offers no tick (SL3). */
  readonly approvable: boolean;
  /** The entry's own text in the harness, as the approval binds it (W7). Empty when the harness does not hold the entry. */
  readonly text: string;
}
/** The answer to a projection plan: the plan, or the lines a person must approve first. */
export type ProjectAnswer = { readonly kind: 'plan'; readonly plan: ProjectView } | { readonly kind: 'approve'; readonly lines: readonly ApproveLineView[]; readonly approvedSoFar: readonly string[] };
export interface ProjectInput {
  readonly engines: readonly EngineId[];
  readonly reconcile: Reconcile;
  readonly writeClaudeMd: boolean;
  /** The keys of the lines the person approved in this sheet. */
  readonly approve: readonly string[];
}
/** `written`: the files the install wrote. `takenOver`: the person's files it recorded and did not write. */
/** `warnings`: words about something that did not finish after the write worked, such as approval drafts that were not cleared. Absent when none. */
export interface ProjectWritten { readonly noop: boolean; readonly written: readonly string[]; readonly takenOver: readonly string[]; readonly leftBehind: readonly string[]; readonly warnings?: readonly string[] }

export interface RemovalView { readonly changes: readonly ChangeView[]; readonly removeDirs: readonly string[]; readonly revision: string }
/** `kept`: files the install took over, which the removal leaves as they are. */
export interface Removed { readonly restored: readonly string[]; readonly kept: readonly string[]; readonly deleted: readonly string[]; readonly leftBehind: readonly string[]; readonly warnings?: readonly string[] }
/** The two answers to a mode drift line: put the recorded mode back, or let the record take the new mode (decision D5A). */
export type ModeChoice = 'restoreMode' | 'recordMode';
/**
 * What a recovery plan settles when no run is unfinished: paths whose person's version stays (`keep`), and mode drift paths whose mode goes back or is
 * recorded. Each path is relative to the folder, as a drift line names it. A path is named in one list at most.
 */
export interface RecoveryChoices { readonly keep: readonly string[]; readonly restoreMode: readonly string[]; readonly recordMode: readonly string[] }
export interface RecoveryView {
  readonly kind: 'apply' | 'remove' | null;
  readonly action: 'complete' | 'rollback' | 'keep' | 'mode';
  readonly steps: readonly { readonly path: string; readonly now: 'present' | 'missing' | 'unsafe'; readonly decision: 'undo' | 'none' | 'keep' }[];
  readonly keep: readonly string[];
  /** The mode drift paths and what happens to each, with the modes written as four octal digits (`0644`). Empty unless the action is `mode`. */
  readonly modes: readonly { readonly path: string; readonly choice: ModeChoice; readonly now: string; readonly recorded: string }[];
  readonly notice: string | null;
  readonly revision: string;
}
export interface Recovered { readonly leftBehind: readonly string[] }

/**
 * The Merge plan (decision D4A): the text of CLAUDE.md moves into the harness instructions, under its own heading. It edits only `.bowerloom`; the install
 * that follows uses Accept AGENTS.md, so CLAUDE.md becomes `@AGENTS.md` then, and a removal puts it back.
 */
export interface MergeView {
  readonly folder: string;
  /** The whole text of CLAUDE.md that moves, as the plan read it. */
  readonly claude: string;
  /** The heading the text goes under. */
  readonly heading: string;
  /** True when harness.json gains the instructions part. */
  readonly addsPart: boolean;
  /** The files written, relative to the folder, in write order. */
  readonly files: readonly { readonly path: string; readonly action: 'create' | 'update' }[];
  readonly revision: string;
}
export interface MergeWritten { readonly written: readonly string[] }

// ---- the save step (0.8.0-beta.1, option C) ---------------------------------------------------------------------------------

/**
 * One edit of one folder's own harness, as the window sends it. Ids only: never a path, never file text, never bytes. Main turns each edit into an edit of the
 * definition (packages/harness-definition, `editDefinition`) and reads every byte it writes itself.
 *  - `set-agent`: the skills an agent uses, by skill id. The agent's tools stay as they are.
 *  - `remove-skill`: the skill goes from the harness, and from every agent that used it.
 *  - `add-skill`: copies the skill `id` from the harness of another folder the person chose (`from`, a folder id). Main reads the skill there again.
 *  - `set-engines`: the interfaces the harness lists. An engine kept keeps its version and model.
 *  - `set-agent` with `notes`: the notes sources an agent reads, by source name. `skills` and `notes` may each be left out; one of them is there.
 *  - `set-source`: attaches the notes folder `notesId` (an id main gave out, never a path) as the source `name`. Main stores its path itself, relative
 *    when it sits inside the folder and in `~` form otherwise. The same name for the same folder is no change; a name the harness holds for another
 *    folder is refused (SOURCE_NAME_TAKEN).
 *  - `remove-source`: the source goes from the harness, and from the notes of every agent that read it.
 *  - `add-from-kit`: adds a ready-made kit that ships with Bowerloom: its agent and its skills, read by main from the kit itself, with the kit's pinned
 *    version recorded in `sources.json`. The window names the kit only.
 */
export type SaveEdit =
  | { readonly kind: 'set-agent'; readonly id: string; readonly skills?: readonly string[]; readonly notes?: readonly string[] }
  | { readonly kind: 'remove-skill'; readonly id: string }
  | { readonly kind: 'add-skill'; readonly id: string; readonly from: string }
  | { readonly kind: 'set-engines'; readonly engines: readonly EngineId[] }
  | { readonly kind: 'set-source'; readonly name: string; readonly notesId: string }
  | { readonly kind: 'remove-source'; readonly name: string }
  | { readonly kind: 'add-from-kit'; readonly kit: KitId };
/** The most edits one save takes. */
export const SAVE_EDIT_LIMIT = 200;

/** The ready-made kits that ship with Bowerloom, by id. A closed list: the window names one of these, and main reads the kit from its own files. */
export const KIT_IDS = Object.freeze(['wiki-keeper'] as const);
export type KitId = (typeof KIT_IDS)[number];
/** The marketplace name `sources.json` records for an item that came from a shipped kit. */
export const KIT_MARKETPLACE = 'bowerloom-kits';

/** One notes source of a harness as the editor draws it. `label` is the folder in `~` form, or under the harness folder's label; never a full path. */
export interface SourceView {
  readonly name: string;
  readonly kind: 'wiki-folder';
  readonly label: string;
  /** The id main gave the folder, for notesSummary and the history plan. */
  readonly notesId: string;
}

/** One folder's harness as the editor draws it: its skills, its agents with the skills each uses, and its interfaces. Text is never sent. */
export interface DefinitionView {
  readonly id: string;
  readonly description: string;
  readonly engines: readonly EngineId[];
  readonly skills: readonly { readonly id: string; readonly name: string; readonly description: string }[];
  /** `notes`: the names of the sources the agent reads. */
  readonly agents: readonly { readonly id: string; readonly name: string; readonly description: string; readonly skills: readonly string[]; readonly notes: readonly string[] }[];
  /** True when the harness holds instructions (AGENTS.md). */
  readonly instructions: boolean;
  /** The notes sources the harness records (knowledge.json), in file order. */
  readonly sources: readonly SourceView[];
  /**
   * The shipped kits the harness holds items of, each with the version `sources.json` pinned and the skills its record names, in the record's order. A skill
   * removed in a save leaves the record in the same save, so these are the kit's skills the harness still holds.
   */
  readonly kits: readonly { readonly id: KitId; readonly version: string; readonly skills: readonly string[] }[];
}

// ---- notes (spec 6.9) --------------------------------------------------------------------------------------------------------

/**
 * How a notes folder keeps its history: a git repository with a commit; a folder inside a larger repository, whose history Bowerloom reads for this folder
 * only and never starts again (`parent`; `lastCommitAt` is null until that repository commits the folder); a `.git` with no first commit, or one git cannot
 * read (`no-commit`); none yet; git not installed; a `.git` whose own settings could make git start a program, so Bowerloom ran nothing there (`refused`);
 * or a `.git` Bowerloom cannot read.
 */
export type NotesHistory = 'git' | 'parent' | 'no-commit' | 'none' | 'git-missing' | 'refused' | 'unreadable';
/** Why main's own notes chooser opens: `use`, the notes the person has ("Use my notes"); `start`, an empty folder for a starter wiki ("Start fresh"). */
export const NOTES_PURPOSES = Object.freeze(['use', 'start'] as const);
export type NotesPurpose = (typeof NOTES_PURPOSES)[number];
/**
 * One notes folder, as the Notes panel shows it. Names and counts only: Bowerloom never opens a page. `pages` counts `*.md` names; `complete` is false
 * when a bound stopped the count. `latestReport` is the newest tidy-up report by the date in its name, its path relative to the notes folder.
 */
export interface NotesView {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  /** A source name made from the folder name, for `set-source`. */
  readonly suggestedName: string;
  readonly pages: number;
  readonly complete: boolean;
  readonly history: NotesHistory;
  /** UTC, to the second, or null. */
  readonly lastCommitAt: string | null;
  readonly latestReport: { readonly date: string; readonly path: string } | null;
  /** False when the listing of `reports/` stopped early, so a newer report may be unread. */
  readonly reportsComplete: boolean;
}
/** The plan of "Start fresh": the starter files of the kit, each relative to the notes folder, and one first commit. */
export interface NotesStarterView {
  readonly notes: string;
  readonly createsFolder: boolean;
  readonly folders: readonly string[];
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
  readonly kit: { readonly id: KitId; readonly version: string };
  readonly revision: string;
}
/** The most file names a history plan lists. `count` is the full number. */
export const NOTES_PLAN_LIST_LIMIT = 500;
/** The plan of starting version history in a linked notes folder: the files the first commit adds, and how many hidden names stay out of it. */
export interface NotesHistoryPlanView {
  readonly notes: string;
  readonly files: readonly { readonly path: string; readonly kind: 'file' | 'link' }[];
  readonly count: number;
  readonly hidden: number;
  readonly revision: string;
}
/** What a starter or a history start did: the number of files in the first commit, its time, and whether the folder is clean after it. */
export interface NotesWritten { readonly files: number; readonly committedAt: string; readonly clean: boolean }
/**
 * One file a save changes, as `.bowerloom/<path>`. Each mark is there only when it holds, so a plain change is `{ path, action }`:
 *  - `executable`: the file the save writes can run as a program (mode 0755).
 *  - `from`: the label of the other folder a copied file comes from (`add-skill`).
 *  - `modeOnly`: the bytes stay the same; only the execute bit changes.
 */
export interface SaveChangeView {
  readonly path: string;
  readonly action: 'create' | 'update' | 'delete';
  readonly executable?: true;
  readonly from?: string;
  readonly modeOnly?: true;
}
/** A notes source a save stops using (`remove-source`): its name, its label, and the names of the agents that read it now and lose it. */
export interface StoppedSourceView { readonly name: string; readonly label: string; readonly agents: readonly string[] }
/** A file that can run, copied from another folder by the save, and the label of that folder. */
export interface CopiedExecutableView { readonly path: string; readonly from: string }
/**
 * The save plan: the files it changes in `.bowerloom`, and the harness as it will be. With no edits it is a read of the folder's harness as it is now, and
 * `noop` is true. `revision` is what the write names.
 *  - `removedSources`: each notes source the save stops using, with the agents that lose it. Nothing in a notes folder changes.
 *  - `copiedExecutables`: each file that can run that the save copies from another folder. When there is one, `acknowledge` is the hash a person's
 *    acknowledgement names (`SaveRequest`), and main writes the plan only with it. Null when there is none.
 */
export interface SaveView {
  readonly folder: string;
  readonly changes: readonly SaveChangeView[];
  readonly definition: DefinitionView;
  readonly noop: boolean;
  readonly revision: string;
  readonly removedSources: readonly StoppedSourceView[];
  readonly copiedExecutables: readonly CopiedExecutableView[];
  readonly acknowledge: string | null;
}
/**
 * A save as the window sends it when the plan copies files that can run from another folder: the edits, and the plan's `acknowledge` hash once the person
 * ticked that they read them. The edits list alone stands for `{ edits, acknowledged: null }`.
 */
export interface SaveRequest { readonly edits: readonly SaveEdit[]; readonly acknowledged: string | null }
/** The tidy-up report main opened: its path relative to the notes folder. */
export interface ReportOpened { readonly path: string }
/** One save point of a folder, newest first in a list. `current` is true when the folder's harness is that save point now. */
export interface VersionView {
  readonly id: string;
  /** UTC, to the second. */
  readonly created: string;
  readonly label: string;
  readonly files: number;
  readonly current: boolean;
}
/** The plan of "Go back": a save whose target is the files of one save point. */
export interface RestoreView extends SaveView { readonly version: VersionView }
/**
 * What a save or a go-back wrote, as `.bowerloom/<path>`, and the save point it recorded (null when nothing changed). `warnings`: the write is done, and
 * something after it did not finish, such as recording the save point.
 */
export interface SaveWritten { readonly written: readonly string[]; readonly version: string | null; readonly warnings?: readonly string[] }
/**
 * The plan of "Set the old save points aside": the folder's save point record is renamed to a dated name in Bowerloom's private folder, and nothing is deleted.
 * `damaged` is true when the record cannot be read. `revision` is what the write names.
 */
export interface SetAsideView { readonly folder: string; readonly damaged: boolean; readonly revision: string }
/** The dated name the old save points were set aside under, in Bowerloom's private folder. */
export interface SetAsideWritten { readonly name: string }

// ---- export and import (0.8.0-beta.1, journey 4) ---------------------------------------------------------------------------

/**
 * Export writes one harness to one file; import reads one file into a folder with no harness, or with an empty one (decision T1-D2 A). The window never holds a
 * path, never file bytes, and never an environment value. Main owns both native dialogs (the save dialog of export, the open dialog of import) and each write
 * question. A bundle the person opens is read once in main and held there under an id (`bundle-<n>`); the window names it by that id only.
 * packages/harness-bundle holds the format and the checks (its README states the trust boundary).
 *
 * Main must, for every share call: check the number and type of every argument before it uses one (a bundle id against SHARE_BUNDLE_ID and by exact
 * string; a folder id and a notes id against the ids main gave out; the choices shape, with at most SHARE_NOTES_LIMIT names of at most SHARE_NAME_LIMIT characters;
 * a revision and an acknowledgement as 64 lowercase hex characters or, for the acknowledgement, null); refuse a bad one as BAD_ARGUMENT before anything runs; build every
 * summary it sends or hashes from the bundle it holds, in the same call, never from a field the window sent (the acknowledgement hashes a tool's `sha256`, not its shown
 * text); enforce
 * SAVE_EXECUTABLE_UNACKNOWLEDGED itself (the save does not check an acknowledgement); compare the acknowledgement it computes now with the one it receives; and bind a
 * write to the plan it showed last, the bundle's own hash and the choices. The temporary file of an export has a random name, is created exclusively, and
 * replaces an existing file only when the person agreed to replace the very file that `bundleTargetIdentity` still finds.
 */

/**
 * The id main gives a bundle it holds. Apart from the folder ids and the notes ids, so one can never stand for another. Main looks a bundle up by the EXACT string
 * in a Map, never by `Number()` of its digits: `bundle-01` is a well-formed id that names nothing, and it must not alias `bundle-1`.
 */
export const SHARE_BUNDLE_ID = /^bundle-[0-9]{1,6}$/;
/** The rows of one list in a preview that main sends; the rest are counted in `more`. The same as BUNDLE_LIMITS.listRows. */
export const SHARE_LIST_LIMIT = 200;
/** The decoded bundles main holds at once. Opening a third drops the oldest. The same as BUNDLE_LIMITS.heldBundles. */
export const SHARE_HELD_BUNDLES = 2;
/** The most notes names a choice may name, and the longest name. The same as BUNDLE_LIMITS.notesNames and nameChars. */
export const SHARE_NOTES_LIMIT = 200;
export const SHARE_NAME_LIMIT = 200;
/** The longest text of a host or a foreign-path hit that a summary carries (BUNDLE_LIMITS.displayChars). A tool's command and arguments are never cut: see SHARE_COMMAND_LIMIT. */
export const SHARE_TEXT_LIMIT = 200;
/** The most arguments of a tool, all shown (BUNDLE_LIMITS.toolArgs). A bundle with more is refused. */
export const SHARE_ARGS_LIMIT = 64;
/** The longest command or argument of a tool, shown whole (BUNDLE_LIMITS.commandChars). A bundle with a longer one is refused. */
export const SHARE_COMMAND_LIMIT = 4000;

/** One list of a preview: at most SHARE_LIST_LIMIT rows, and how many more there are ("and 12 more"). */
export interface ShareList<T> { readonly rows: readonly T[]; readonly more: number }
/**
 * A tool the bundle holds, with what a person reads before it may run. `transport` is for an MCP server and null for a hook. `runsCode` is true for a hook and for
 * an MCP server that starts a program. `command` is the program of a stdio server or the command of a hook (whole, at most SHARE_COMMAND_LIMIT), `args` the arguments of a server (all of them, at most SHARE_ARGS_LIMIT),
 * `host` the host a client would really reach for a server's url (the package's `addressOf`), `event` the event of a hook; each is null (or empty) when the tool has none.
 * `flags` says what is odd about the address: `credentials` (a user name or password in it), `backslash`, `scheme` (not http, https, ws or wss), `unreadable`. A tool that
 * runs code or reaches a host is in the acknowledgement. The command and the arguments are whole; the host is cut to SHARE_TEXT_LIMIT. Every text is drawn as plain
 * text and passed through `visible()` in main. The acknowledgement binds the whole entry in main, and the window sees the whole command and arguments.
 */
export interface ShareTool {
  readonly name: string; readonly kind: 'mcp' | 'hook'; readonly transport: string | null; readonly runsCode: boolean;
  readonly command: string | null; readonly args: readonly string[]; readonly host: string | null; readonly event: string | null;
  readonly flags: readonly ('credentials' | 'backslash' | 'scheme' | 'unreadable')[];
  /**
   * What else is bound by the acknowledgement and must be shown, from the package's `BundleTool` (additive; absent means none): the variables of a stdio server (`env`, values
   * whole: `NODE_OPTIONS`, `LD_PRELOAD`, `PATH` and the like start code, and a name is shown also when its value is a `${NAME}` reference), the headers of a remote server
   * (`headers`), and the path, query and fragment of its url (`path`). Each value is at most SHARE_COMMAND_LIMIT characters and each list at most SHARE_ARGS_LIMIT rows; the
   * package refuses a bundle past that, so nothing is cut.
   */
  readonly env?: readonly ShareNameValue[]; readonly headers?: readonly ShareNameValue[]; readonly path?: string | null;
  /** The names of the fields the acknowledgement binds and the sheet does not show (`timeout`, `enabled`, `x-<engine>` and the like), from the package's `BundleTool.hiddenFields`. Absent means none. */
  readonly hiddenFields?: readonly string[];
}
/** One variable of a stdio server's environment, or one header, with its value as the file holds it. */
export interface ShareNameValue { readonly name: string; readonly value: string }
/**
 * A file that can run: it has an execute bit, it is `hooks.json`, it is under `scripts/`, it begins with `#!` (`shebang`) or with the bytes of a program (`binary`), its
 * name ends in a code extension (`extension`), it is a manifest of commands such as `package.json` (`manifest`), or it is anything that is not a named kind of data
 * (`not-data`: no extension, another extension, text that is not UTF-8 or holds a NUL; an image or font whose bytes are not its kind is `binary`). The list is a screen,
 * not a proof: a text file can still hold commands. `path` is relative to `.bowerloom`.
 */
export interface ShareCodeFile { readonly path: string; readonly why: 'executable' | 'hook' | 'script' | 'shebang' | 'binary' | 'manifest' | 'extension' | 'not-data' }
/** Where a reference goes: the tool, the field of it, and the host that field reaches (null when the tool has no url). */
export interface ShareSink { readonly tool: string; readonly field: 'env' | 'header' | 'arg' | 'url' | 'command'; readonly host: string | null }
/**
 * A reference the file reads from THIS computer and passes to a tool: an environment variable (`env`) or a keychain entry (`keychain`), by name. Never a value. The
 * name may be set on this computer already, so the sheet says that the file passes these values to these tools, lists each sink, and never tells a person to add one
 * without showing where it goes. A reference in a url, an argument, a command or a header (field `url`, `arg`, `command`, `header`) needs the acknowledgement. Bowerloom did not check
 * whether the name exists on this computer (decision T1-D8 A), and the screen says so.
 */
export interface ShareSecret { readonly kind: 'env' | 'keychain'; readonly name: string; readonly sinks: readonly ShareSink[] }
/** A notes name the agents read. A bundle holds the name only. */
export interface ShareNote { readonly name: string; readonly readBy: readonly string[] }
export interface ShareBorrowed { readonly name: string; readonly marketplace: string; readonly version: string }
/** A file of the bundle that holds text looking like a path of another computer, the line, and the text that matched (cut to SHARE_TEXT_LIMIT). Reported, never rewritten. */
export interface ShareForeignPath { readonly path: string; readonly line: number | null; readonly text: string }
/** What a bundle holds, as the Export and Import sheets list it. Every string from a file passed `visible()` in main first. */
export interface ShareSummary {
  /** The harness id. */
  readonly harness: string;
  readonly engines: readonly EngineId[];
  readonly instructions: boolean;
  readonly counts: { readonly skills: number; readonly agents: number; readonly mcp: number; readonly hooks: number; readonly guardrails: number; readonly scripts: number; readonly files: number; readonly bytes: number };
  readonly tools: ShareList<ShareTool>;
  readonly codeFiles: ShareList<ShareCodeFile>;
  readonly secrets: ShareList<ShareSecret>;
  readonly notes: ShareList<ShareNote>;
  readonly borrowed: ShareList<ShareBorrowed>;
  readonly foreignPaths: ShareList<ShareForeignPath>;
}

/**
 * The plan of "Export": what the file holds, and nothing written. `file` is the file name main suggests to the save dialog (`<id>.bowerloom.json`), never a path.
 * `revision` is the lowercase hex SHA-256 of the bundle bytes, 64 characters with no prefix; equal harness files give an equal revision. `acknowledge` is the
 * package's `exportAcknowledgement(summary, revision)` (64 lowercase hex characters), or null when there are no foreign paths: when it is not null, `runExport`
 * writes only with it (EXPORT_NEEDS_ACKNOWLEDGEMENT otherwise).
 */
export interface ExportView {
  readonly folder: string;
  readonly file: string;
  readonly bytes: number;
  readonly summary: ShareSummary;
  readonly revision: string;
  readonly acknowledge: string | null;
}
/** What an export wrote: the file name the person chose (the last part of the path only) and its size. */
export interface ExportWritten { readonly name: string; readonly bytes: number }

/** A bundle main read from the file the person chose: its id, the file name only, the harness id, and what it holds. */
export interface BundleView {
  readonly bundleId: string;
  readonly name: string;
  readonly bytes: number;
  readonly harness: string;
  readonly summary: ShareSummary;
}
/**
 * What the importer decides about the notes names, as the window sends it (the package's own `ImportChoices` is another type: a name to a STORED PATH, in a Map
 * and a Set, which main builds from this after it maps each notes id to a stored path): `link` maps a source name to a notes folder id main gave out (`chooseNotesFolder`),
 * never a path; `leave` lists names to leave out. A name in neither list is left out (decision T1-D3 A). A name the bundle does not hold, or in both lists, is
 * BAD_ARGUMENT. At most SHARE_NOTES_LIMIT names in all, each at most SHARE_NAME_LIMIT characters. Names are untrusted keys (`constructor` is a valid name, and `__proto__`
 * can arrive as an own key): main reads only own properties, copies them into a Map and a Set, checks that every value is a string, and never indexes the object by a name.
 */
export interface ImportNoteChoices { readonly link: Readonly<Record<string, string>>; readonly leave: readonly string[] }
/** One notes name and what the plan does with it. `label` is the linked folder in `~` form, or null when the name is left out. */
export interface ImportNoteRow { readonly name: string; readonly choice: 'link' | 'leave'; readonly label: string | null; readonly readBy: readonly string[] }
/**
 * The plan of "Import": a save plan (`changes` lists every `.bowerloom` file as create or update; `definition` is the harness as it will be) plus the bundle's
 * summary. It extends SaveView, whose fields mean the same, with these notes:
 *  - `copiedExecutables` lists the files the import writes with an execute bit; `from` is the bundle's file name.
 *  - `acknowledge` is the package's `importAcknowledgement(summary, executables, revision)` (64 lowercase hex characters): it binds this plan's revision and
 *    every tool that runs code, every reference in a url, argument or command, every file that can run, every executable and every foreign path, or it is null
 *    when all are empty. When it is not null, `runImport` writes only with it (IMPORT_NEEDS_ACKNOWLEDGEMENT otherwise). The sheet may show one tick or two; the
 *    call carries the hash once.
 *  - `removedSources` is always empty: an import stops using nothing.
 *  - `makesHarness` (decision of 2026-10-31): true when the folder has no harness. The one plan then makes the empty harness AND writes the bundle's files, and the one
 *    approval covers both; `changes` lists `.bowerloom/harness.json` as a create like every other file. False or left out when the folder's harness is empty already.
 *  - What a folder with no harness leaves. The save point "before" is the EMPTY harness (`harness.json` alone, no parts), because that is what the write makes first;
 *    Go back to it returns the folder to an empty harness, never to "no harness at all". The write is one journaled save: when it fails after the empty harness was made, the
 *    folder holds a valid empty harness and none of the bundle's files, never half of them, and the journal says what to do (SAVE_PARTIAL, SAVE_RECOVERY_REQUIRED).
 *  - `harness.json` is `create` in `changes` only when the folder has no harness; for a harness that exists and is empty it is `update`.
 *  - The folder's harness state (none, or empty) is part of `revision`. A harness made between the plan and the write is another plan: the write is NOT_THE_PLAN_SHOWN, never an
 *    overwrite.
 *  - `acknowledge` hashes EVERY row of the bundle (every tool, code file, reference and foreign path), shown or not. The summary lists are cut at SHARE_LIST_LIMIT after
 *    `capRiskFirst` (shared/engine/share-risk.ts, one rule for the sample and main) puts the rows that run or reach a host first; the cut changes what is shown, and the sheet says
 *    so beside the tick.
 * `revision` is the save plan's revision, lowercase hex with no prefix. The write also names the bundle id and the choices, and main binds the plan to the bundle's own hash.
 */
export interface ImportView extends SaveView {
  readonly bundleId: string;
  readonly summary: ShareSummary;
  readonly notes: readonly ImportNoteRow[];
  /** True when the folder has no harness and this plan makes an empty one first, under the same approval. Additive: left out reads as false. */
  readonly makesHarness?: boolean;
}

// ---- the calls ------------------------------------------------------------------------------------------------------------

/**
 * The calls the window may make. Every write takes the revision of a plan the person approved, and the main process plans again and writes only when it is
 * the same. In the sample, the same calls run on synthetic folders in memory and write nothing.
 */
export interface EngineBridge {
  readonly mode: 'sample' | 'real';
  folders(): Promise<readonly FolderInfo[]>;
  /**
   * Opens the system folder chooser. Null when the person closed it. The sample has no chooser and answers null. `expectedLabel` (optional, additive): the label of the
   * folder the window wants, as a place it already shows. A pick with another label is refused as NOT_THE_FOLDER_SHOWN before main registers it, so a folder the window did
   * not accept never gets an id or appears in `folders()`. Left out, any folder is taken.
   */
  chooseFolder(expectedLabel?: string): Promise<Answer<FolderInfo> | null>;
  planAdoption(folderId: string, choices: AdoptChoices): Promise<Answer<AdoptView>>;
  /** `approvals` are the plan's own approvals the person ticked, each with the hash of what they read. */
  runAdoption(folderId: string, revision: string, choices: AdoptChoices, approvals: readonly AdoptApproval[]): Promise<Answer<AdoptWritten>>;
  planAdoptionRecovery(folderId: string): Promise<Answer<AdoptRecoveryView>>;
  runAdoptionRecovery(folderId: string, revision: string): Promise<Answer<AdoptRecovered>>;
  planProjection(folderId: string, input: ProjectInput): Promise<Answer<ProjectAnswer>>;
  runProjection(folderId: string, revision: string, input: ProjectInput): Promise<Answer<ProjectWritten>>;
  planRemoval(folderId: string): Promise<Answer<RemovalView>>;
  runRemoval(folderId: string, revision: string): Promise<Answer<Removed>>;
  /** `choices` is a keep list (the form of earlier steps) or the full choices with the mode answers. */
  planRecovery(folderId: string, choices: readonly string[] | RecoveryChoices): Promise<Answer<RecoveryView>>;
  runRecovery(folderId: string, revision: string, choices: readonly string[] | RecoveryChoices): Promise<Answer<Recovered>>;
  /** Plans Merge: CLAUDE.md into the harness instructions. Reads only. */
  planMerge(folderId: string): Promise<Answer<MergeView>>;
  /** Writes the Merge plan shown last, after main's own dialog. */
  runMerge(folderId: string, revision: string): Promise<Answer<MergeWritten>>;
  /** Plans a save of the folder's own harness with these edits. Reads only. With no edits, it reads the harness as it is. */
  planSave(folderId: string, edits: readonly SaveEdit[]): Promise<Answer<SaveView>>;
  /**
   * Writes the save plan shown last, with the same edits, after main's own dialog. It keeps a save point first. Install is a separate step. A plan that copies
   * files that can run from another folder is written only with its acknowledgement (`SaveRequest`).
   */
  runSave(folderId: string, revision: string, edits: readonly SaveEdit[] | SaveRequest): Promise<Answer<SaveWritten>>;
  /** The save points of the folder, newest first. A damaged record is a refusal, never an empty list. */
  listVersions(folderId: string): Promise<Answer<readonly VersionView[]>>;
  /** Plans "Go back" to one save point. Reads only. */
  planRestore(folderId: string, version: string): Promise<Answer<RestoreView>>;
  /** Writes the go-back plan shown last, for the same save point, after main's own dialog. */
  runRestore(folderId: string, revision: string, version: string): Promise<Answer<SaveWritten>>;
  /** Plans setting the folder's old save points aside, so a damaged record never locks the person out. Reads only. */
  planSetAside(folderId: string): Promise<Answer<SetAsideView>>;
  /** Sets the old save points aside, for the plan shown last, after main's own dialog. Nothing is deleted. */
  runSetAside(folderId: string, revision: string): Promise<Answer<SetAsideWritten>>;
  /**
   * Opens main's own folder chooser for notes. `use` ("Use my notes"): the person picks the notes they have. `start` ("Start fresh"): the person picks, or makes, an empty folder for a
   * starter wiki. Null when the person closed it. The sample answers a made-up folder.
   */
  chooseNotesFolder(purpose: NotesPurpose): Promise<Answer<NotesView> | null>;
  /** The Notes panel's read of one notes folder. Reads names only. */
  notesSummary(notesId: string): Promise<Answer<NotesView>>;
  /** Plans "Start fresh": the kit's starter wiki in an empty notes folder, then one first commit. Reads only. */
  planCreateNotes(notesId: string): Promise<Answer<NotesStarterView>>;
  /** Writes the starter plan shown last, after main's own dialog. */
  runCreateNotes(notesId: string, revision: string): Promise<Answer<NotesWritten>>;
  /** Plans starting version history in a linked notes folder that has none. Reads only. */
  planNotesHistory(notesId: string): Promise<Answer<NotesHistoryPlanView>>;
  /** Starts the history the plan shown last showed, after main's own dialog: git init, and one first commit of exactly the files listed. */
  runNotesHistory(notesId: string, revision: string): Promise<Answer<NotesWritten>>;
  /**
   * Opens the newest tidy-up report of a notes folder in the app the computer uses for it, after main's own dialog. Main finds the report itself, checks its
   * path again, and opens only the report the Notes panel was shown last. The window names the notes folder by its id only. The sample opens nothing.
   */
  openNotesReport(notesId: string): Promise<Answer<ReportOpened>>;
  /** Plans "Export" for the folder's harness: what the file would hold. Reads only. A folder with no harness is EXPORT_NO_DEFINITION. */
  planExport(folderId: string): Promise<Answer<ExportView>>;
  /**
   * Writes the export plan shown last. Main opens its own save dialog (the window gets the file name back only), then asks its own write question naming the folder,
   * the file name, the counts and the short revision, then writes one new file. `acknowledged` is the plan's `acknowledge` hash, or null when the plan has none.
   * The person closing either dialog is the refusal CANCELLED, and nothing is written.
   */
  runExport(folderId: string, revision: string, acknowledged: string | null): Promise<Answer<ExportWritten>>;
  /**
   * Opens main's own open dialog for a bundle file. Main reads it once, checks everything, holds it under an id and answers what it holds. Null when the person
   * closed the dialog. A file that fails a check is a refusal with the package's words (BUNDLE_*), and nothing is held.
   */
  chooseBundle(): Promise<Answer<BundleView> | null>;
  /**
   * Plans an import of a held bundle into a folder. Reads only. A folder with a harness that has parts is IMPORT_FOLDER_HAS_HARNESS. A folder with no harness is a valid
   * target (decision of 2026-10-31): the plan makes the empty harness and writes the files under one approval (`ImportView.makesHarness`), so SAVE_NO_DEFINITION is no
   * longer an answer of this call. Lists in the summary are cut at SHARE_LIST_LIMIT after the rows that run code or reach a host are put first, so a cut never hides one.
   */
  planImport(folderId: string, bundleId: string, choices: ImportNoteChoices): Promise<Answer<ImportView>>;
  /**
   * Writes the import plan shown last, with the same bundle and choices, after main's own dialog. It is a save: a save point is kept before and after. Install is a
   * separate step that is offered and never started. `acknowledged` is the plan's `acknowledge` hash, or null when the plan has none.
   */
  runImport(folderId: string, revision: string, bundleId: string, choices: ImportNoteChoices, acknowledged: string | null): Promise<Answer<SaveWritten>>;
  /** Drops a held bundle. True when main held it. */
  discardBundle(bundleId: string): Promise<boolean>;
  /**
   * Records the answer to "Did this do what you wanted?" in the local usage log on this computer. `note` is the person's own words, at most 500 characters, or
   * null. True when it was recorded. Nothing leaves the computer. The sample records nothing and answers false.
   */
  recordCheck(answer: CheckAnswer, note: string | null): Promise<boolean>;
  /**
   * What a launch asks first: the last read, kept on this computer, as the window got it (the places and the result), or `none` (nothing kept), or `damaged` with a short reason when
   * the kept file cannot be used. It reads no folder. The sample has no kept read and answers `none`.
   */
  savedScan(): Promise<SavedScanAnswer>;
  /** The cheap, read-only check that follows: whether the folders of the kept read changed since it was made (or could not be checked to the end). No file is opened. The sample answers `same`. */
  checkSavedScan(): Promise<SavedScanCheck>;
}

/** The three answers of the after-apply check. */
export const CHECK_ANSWERS = Object.freeze(['yes', 'partly', 'no'] as const);
export type CheckAnswer = (typeof CHECK_ANSWERS)[number];
/** The longest note the check takes, in characters. Main checks it again. */
export const CHECK_NOTE_LIMIT = 500;

/** The names of the calls, in one list, so the bridge, the handler and the tests agree. */
export const ENGINE_CALLS = Object.freeze([
  'folders', 'chooseFolder', 'planAdoption', 'runAdoption', 'planAdoptionRecovery', 'runAdoptionRecovery',
  'planProjection', 'runProjection', 'planRemoval', 'runRemoval', 'planRecovery', 'runRecovery', 'planMerge', 'runMerge', 'recordCheck',
  'planSave', 'runSave', 'listVersions', 'planRestore', 'runRestore', 'planSetAside', 'runSetAside',
  'chooseNotesFolder', 'notesSummary', 'planCreateNotes', 'runCreateNotes', 'planNotesHistory', 'runNotesHistory', 'openNotesReport',
  'planExport', 'runExport', 'chooseBundle', 'planImport', 'runImport', 'discardBundle', 'savedScan', 'checkSavedScan',
] as const);
export type EngineCall = (typeof ENGINE_CALLS)[number];
/** How many arguments each call takes. A call with another count is refused before anything runs. */
export const ENGINE_ARITY: Readonly<Record<EngineCall, number>> = Object.freeze({
  folders: 0, chooseFolder: 0, planAdoption: 2, runAdoption: 4, planAdoptionRecovery: 1, runAdoptionRecovery: 2,
  planProjection: 2, runProjection: 3, planRemoval: 1, runRemoval: 2, planRecovery: 2, runRecovery: 3, planMerge: 1, runMerge: 2, recordCheck: 2,
  planSave: 2, runSave: 3, listVersions: 1, planRestore: 2, runRestore: 3, planSetAside: 1, runSetAside: 2,
  chooseNotesFolder: 1, notesSummary: 1, planCreateNotes: 1, runCreateNotes: 2, planNotesHistory: 1, runNotesHistory: 2, openNotesReport: 1,
  planExport: 1, runExport: 3, chooseBundle: 0, planImport: 3, runImport: 5, discardBundle: 1, savedScan: 0, checkSavedScan: 0,
});
/** One channel per call, apart from every other channel of the app. */
export const ENGINE_CHANNELS: Readonly<Record<EngineCall, string>> = Object.freeze(Object.fromEntries(ENGINE_CALLS.map(c => [c, `bowerloom-engine:${c}`])) as Record<EngineCall, string>);
/** The short codes a call can be refused with before it runs. */
export const ENGINE_CALL_REFUSALS = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_BUNDLE', 'FAILED'] as const);
/** Refusals of main itself, with words, before a package runs: the write is not the plan main showed last (U16), or the person said no in main's own dialog. */
export const NOT_THE_PLAN_SHOWN = 'NOT_THE_PLAN_SHOWN';
export const CANCELLED = 'CANCELLED';
/**
 * Refusals of main itself for the save step, with words: the folder holds no harness to save yet, or the folder a skill is copied from does not hold it.
 * The package refusals (SAVE_*, EDIT_*, VERSION_*) come with the packages' own words.
 */
export const SAVE_NO_DEFINITION = 'SAVE_NO_DEFINITION';
export const SAVE_SOURCE_MISSING = 'SAVE_SOURCE_MISSING';
/** The save points before and after the save could not both be kept, so the save would leave Go back with no entry for it. */
export const SAVE_POINT_TOO_LARGE = 'SAVE_POINT_TOO_LARGE';
/** A set-source whose name the harness holds already for another notes folder. */
export const SOURCE_NAME_TAKEN = 'SOURCE_NAME_TAKEN';
/** A save that copies files that can run from another folder, written without the acknowledgement the plan shown last asked for. */
export const SAVE_EXECUTABLE_UNACKNOWLEDGED = 'SAVE_EXECUTABLE_UNACKNOWLEDGED';
/** The words of those refusals, the same in main and in the sample. */
export const SAVE_MAIN_WORDS: Readonly<Record<typeof SAVE_NO_DEFINITION | typeof SAVE_SOURCE_MISSING | typeof SAVE_POINT_TOO_LARGE | typeof SOURCE_NAME_TAKEN | typeof SAVE_EXECUTABLE_UNACKNOWLEDGED, string>> = Object.freeze({
  SAVE_EXECUTABLE_UNACKNOWLEDGED: 'This save copies files that can run as programs from another folder. Tick that you read them, then save. Nothing was written.',
  SOURCE_NAME_TAKEN: 'The harness has notes of that name for another folder already. Nothing was written.',
  SAVE_NO_DEFINITION: 'This folder has no harness yet, so there is nothing to save. Make one first with New harness from a folder. Nothing was written.',
  SAVE_SOURCE_MISSING: 'The folder to copy from does not hold that skill, or its harness does not load. Nothing was written.',
  SAVE_POINT_TOO_LARGE: 'This harness is too large for Bowerloom to keep a save point before and after this save, so Go back would have no entry for it. Nothing was written.',
});
/**
 * Refusals of main itself for export and import, with words. The last three are also codes of packages/harness-bundle (`BUNDLE_MESSAGES`), and a test keeps
 * the sentences equal. `EXPORT_NO_DEFINITION` is main's alone: the folder has no harness to export. Package refusals (BUNDLE_*) come with the package's words.
 */
export const EXPORT_NO_DEFINITION = 'EXPORT_NO_DEFINITION';
export const IMPORT_FOLDER_HAS_HARNESS = 'IMPORT_FOLDER_HAS_HARNESS';
export const IMPORT_NEEDS_ACKNOWLEDGEMENT = 'IMPORT_NEEDS_ACKNOWLEDGEMENT';
export const EXPORT_NEEDS_ACKNOWLEDGEMENT = 'EXPORT_NEEDS_ACKNOWLEDGEMENT';
export const SHARE_MAIN_WORDS: Readonly<Record<typeof EXPORT_NO_DEFINITION | typeof IMPORT_FOLDER_HAS_HARNESS | typeof IMPORT_NEEDS_ACKNOWLEDGEMENT | typeof EXPORT_NEEDS_ACKNOWLEDGEMENT | 'BUNDLE_FILE_FAILED', string>> = Object.freeze({
  EXPORT_NO_DEFINITION: 'This folder has no harness yet, so there is nothing to export. Make one first with New harness from a folder. Nothing was written.',
  IMPORT_FOLDER_HAS_HARNESS: 'This folder has a harness with parts or settings in it already. An import goes only into a folder with no harness, or with an empty one. Nothing was written.',
  IMPORT_NEEDS_ACKNOWLEDGEMENT: 'This file holds tools or files that can run, values it reads from this computer, or paths from another computer. Tick that you read them, then import. Nothing was written.',
  EXPORT_NEEDS_ACKNOWLEDGEMENT: 'These files hold a path from this computer. Tick that you read them, then export. Nothing was written.',
  BUNDLE_FILE_FAILED: 'The file could not be read or written. The disk may be full or read-only, the name may be too long, or you may lack permission. Nothing was read or written.',
});
/** The one sentence for a save place inside the harness's own folder. Main refuses with it, and the window shows it as it is (no second line follows it). */
export const EXPORT_TARGET_IN_HARNESS_WORDS = 'That place is inside the folder .bowerloom of this harness, and a file there would break the harness. Choose a place outside it, such as your Desktop. Nothing was written.';
/**
 * Refusals of main itself for a ready-made kit, with words: the kit that ships with Bowerloom is missing or damaged (KIT_INVALID, whose message goes on
 * with the reason), or the harness holds the kit already.
 */
export const KIT_INVALID = 'KIT_INVALID';
export const KIT_ALREADY_ADDED = 'KIT_ALREADY_ADDED';
export const KIT_MAIN_WORDS: Readonly<Record<typeof KIT_INVALID | typeof KIT_ALREADY_ADDED, string>> = Object.freeze({
  KIT_INVALID: 'The ready-made notes keeper that ships with Bowerloom is missing or damaged, so Bowerloom will not use it. Nothing was written.',
  KIT_ALREADY_ADDED: 'This harness holds the notes keeper already. Nothing was written.',
});
/**
 * A refusal of main itself for a notes folder: Bowerloom plans and writes the starter or the history only in a folder the person chose with main's own notes
 * chooser in this window. A source read from a harness's `knowledge.json` is read-only.
 */
export const NOTES_NOT_CHOSEN = 'NOTES_NOT_CHOSEN';
export const NOTES_MAIN_WORDS: Readonly<Record<typeof NOTES_NOT_CHOSEN, string>> = Object.freeze({
  NOTES_NOT_CHOSEN: 'Bowerloom changes a notes folder only after you choose it here with "Use my notes" or "Start fresh". Nothing was changed.',
});
/**
 * Refusals of main itself for "open the tidy-up report", with words: the folder holds no report; the newest report now is not the one the Notes panel was
 * shown last; the report is not a plain file of its own in the folder (a link, a second link, or a reports folder that is a link); or the computer could
 * not open it.
 */
export const REPORT_NONE = 'REPORT_NONE';
export const REPORT_NOT_SHOWN = 'REPORT_NOT_SHOWN';
export const REPORT_UNSAFE = 'REPORT_UNSAFE';
export const REPORT_OPEN_FAILED = 'REPORT_OPEN_FAILED';
export const REPORT_MAIN_WORDS: Readonly<Record<typeof REPORT_NONE | typeof REPORT_NOT_SHOWN | typeof REPORT_UNSAFE | typeof REPORT_OPEN_FAILED, string>> = Object.freeze({
  REPORT_NONE: 'This notes folder holds no tidy-up report yet. Nothing was opened.',
  REPORT_NOT_SHOWN: 'The newest tidy-up report is not the one shown here. Nothing was opened. Read the notes again.',
  REPORT_UNSAFE: 'The tidy-up report is not a plain file of its own in the notes folder, so Bowerloom will not open it. Nothing was opened.',
  REPORT_OPEN_FAILED: 'Your computer could not open the tidy-up report. Nothing was changed.',
});
