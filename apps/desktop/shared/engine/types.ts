/**
 * The plain data the harness-first window gets about adoption and the projection, and the calls it may make. The main process runs the packages
 * (packages/adoption, packages/project-sync) and hands back only these shapes: no absolute path of the person's folders, no file bytes, and no function.
 * The sample launch answers the same calls from synthetic fixtures in memory (shared/engine/sample.ts) and writes nothing.
 */

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
  readonly part: string; readonly entry: string; readonly field: string | null; readonly engine: EngineId; readonly result: 'weakened' | 'absent'; readonly who: string; readonly when: string; readonly reason: string;
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
 * How a notes folder keeps its history: a git repository with a commit; a `.git` with no first commit, or one git cannot read (`no-commit`); none yet; git
 * not installed; a `.git` whose own settings could make git start a program, so Bowerloom ran nothing there (`refused`); or a `.git` Bowerloom cannot read.
 */
export type NotesHistory = 'git' | 'no-commit' | 'none' | 'git-missing' | 'refused' | 'unreadable';
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
/** One file a save changes, as `.bowerloom/<path>`. */
export interface SaveChangeView { readonly path: string; readonly action: 'create' | 'update' | 'delete' }
/**
 * The save plan: the files it changes in `.bowerloom`, and the harness as it will be. With no edits it is a read of the folder's harness as it is now, and
 * `noop` is true. `revision` is what the write names.
 */
export interface SaveView {
  readonly folder: string;
  readonly changes: readonly SaveChangeView[];
  readonly definition: DefinitionView;
  readonly noop: boolean;
  readonly revision: string;
}
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

// ---- the calls ------------------------------------------------------------------------------------------------------------

/**
 * The calls the window may make. Every write takes the revision of a plan the person approved, and the main process plans again and writes only when it is
 * the same. In the sample, the same calls run on synthetic folders in memory and write nothing.
 */
export interface EngineBridge {
  readonly mode: 'sample' | 'real';
  folders(): Promise<readonly FolderInfo[]>;
  /** Opens the system folder chooser. Null when the person closed it. The sample has no chooser and answers null. */
  chooseFolder(): Promise<Answer<FolderInfo> | null>;
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
  /** Writes the save plan shown last, with the same edits, after main's own dialog. It keeps a save point first. Install is a separate step. */
  runSave(folderId: string, revision: string, edits: readonly SaveEdit[]): Promise<Answer<SaveWritten>>;
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
   * Records the answer to "Did this do what you wanted?" in the local usage log on this computer. `note` is the person's own words, at most 500 characters, or
   * null. True when it was recorded. Nothing leaves the computer. The sample records nothing and answers false.
   */
  recordCheck(answer: CheckAnswer, note: string | null): Promise<boolean>;
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
  'chooseNotesFolder', 'notesSummary', 'planCreateNotes', 'runCreateNotes', 'planNotesHistory', 'runNotesHistory',
] as const);
export type EngineCall = (typeof ENGINE_CALLS)[number];
/** How many arguments each call takes. A call with another count is refused before anything runs. */
export const ENGINE_ARITY: Readonly<Record<EngineCall, number>> = Object.freeze({
  folders: 0, chooseFolder: 0, planAdoption: 2, runAdoption: 4, planAdoptionRecovery: 1, runAdoptionRecovery: 2,
  planProjection: 2, runProjection: 3, planRemoval: 1, runRemoval: 2, planRecovery: 2, runRecovery: 3, planMerge: 1, runMerge: 2, recordCheck: 2,
  planSave: 2, runSave: 3, listVersions: 1, planRestore: 2, runRestore: 3, planSetAside: 1, runSetAside: 2,
  chooseNotesFolder: 1, notesSummary: 1, planCreateNotes: 1, runCreateNotes: 2, planNotesHistory: 1, runNotesHistory: 2,
});
/** One channel per call, apart from every other channel of the app. */
export const ENGINE_CHANNELS: Readonly<Record<EngineCall, string>> = Object.freeze(Object.fromEntries(ENGINE_CALLS.map(c => [c, `bowerloom-engine:${c}`])) as Record<EngineCall, string>);
/** The short codes a call can be refused with before it runs. */
export const ENGINE_CALL_REFUSALS = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'FAILED'] as const);
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
/** The words of those refusals, the same in main and in the sample. */
export const SAVE_MAIN_WORDS: Readonly<Record<typeof SAVE_NO_DEFINITION | typeof SAVE_SOURCE_MISSING | typeof SAVE_POINT_TOO_LARGE | typeof SOURCE_NAME_TAKEN, string>> = Object.freeze({
  SOURCE_NAME_TAKEN: 'The harness has notes of that name for another folder already. Nothing was written.',
  SAVE_NO_DEFINITION: 'This folder has no harness yet, so there is nothing to save. Make one first with New harness from a folder. Nothing was written.',
  SAVE_SOURCE_MISSING: 'The folder to copy from does not hold that skill, or its harness does not load. Nothing was written.',
  SAVE_POINT_TOO_LARGE: 'This harness is too large for Bowerloom to keep a save point before and after this save, so Go back would have no entry for it. Nothing was written.',
});
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
