/**
 * The plain data the harness-first window gets about adoption and the projection, and the calls it may make. The main process runs the packages
 * (packages/adoption, packages/project-sync) and hands back only these shapes: no absolute path of the person's folders, no file bytes, and no function.
 * The sample launch answers the same calls from synthetic fixtures in memory (shared/engine/sample.ts) and writes nothing.
 */

/** The engines of Bowerloom 0.8, in the order the packages list them. */
export const ENGINE_IDS = Object.freeze(['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'] as const);
export type EngineId = (typeof ENGINE_IDS)[number];
export const isEngineId = (value: unknown): value is EngineId => typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);

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
export interface AdoptView {
  readonly folder: string;
  readonly harness: { readonly id: string; readonly description: string };
  readonly engines: readonly { readonly id: EngineId; readonly version: string | null; readonly model: string | null; readonly detected: boolean }[];
  readonly read: number;
  readonly items: readonly AdoptItemView[];
  readonly conflicts: readonly AdoptConflictView[];
  readonly differences: readonly AdoptDifferenceView[];
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
}
export interface AdoptWritten { readonly written: readonly string[] }
/** One approval as the window sends it: the key and the hash of what the person read. */
export interface AdoptApproval { readonly key: string; readonly hash: string }

/** The recovery of a stopped run in the `.bowerloom` folder: an adoption that stopped part way, or a Merge that did (decision D4A). */
export interface AdoptRecoveryView {
  /** `adoption`: the stopped run made a new harness; recovery removes its files. `merge`: the stopped run was a Merge; recovery puts the files back. */
  readonly kind: 'adoption' | 'merge';
  readonly journal: 'ok' | 'damaged';
  readonly check: readonly string[];
  readonly remove: readonly string[];
  /** Files that go back to the bytes the stopped Merge replaced. Empty for an adoption. */
  readonly restore: readonly string[];
  readonly kept: readonly { readonly path: string; readonly reason: 'changed' | 'unsafe' }[];
  readonly dirs: readonly string[];
  readonly revision: string;
}
export interface AdoptRecovered { readonly removed: readonly string[]; readonly restored: readonly string[]; readonly kept: readonly string[]; readonly leftFolders: readonly string[] }

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
export interface ChangeView { readonly path: string; readonly action: 'create' | 'replace' | 'update' | 'unchanged' | 'restore' | 'delete'; readonly engines: readonly EngineId[] }
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
  readonly offers: readonly { readonly action: 'write-claude-md'; readonly reason: string }[];
  readonly ignored: readonly { readonly option: string; readonly reason: string }[];
  readonly pendingTrust: readonly string[];
  readonly filterLeaks: readonly { readonly skill: string; readonly path: string; readonly engines: readonly EngineId[] }[];
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
export interface ProjectWritten { readonly noop: boolean; readonly written: readonly string[]; readonly leftBehind: readonly string[] }

export interface RemovalView { readonly changes: readonly ChangeView[]; readonly removeDirs: readonly string[]; readonly revision: string }
export interface Removed { readonly restored: readonly string[]; readonly deleted: readonly string[]; readonly leftBehind: readonly string[] }
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
}

/** The names of the calls, in one list, so the bridge, the handler and the tests agree. */
export const ENGINE_CALLS = Object.freeze([
  'folders', 'chooseFolder', 'planAdoption', 'runAdoption', 'planAdoptionRecovery', 'runAdoptionRecovery',
  'planProjection', 'runProjection', 'planRemoval', 'runRemoval', 'planRecovery', 'runRecovery', 'planMerge', 'runMerge',
] as const);
export type EngineCall = (typeof ENGINE_CALLS)[number];
/** How many arguments each call takes. A call with another count is refused before anything runs. */
export const ENGINE_ARITY: Readonly<Record<EngineCall, number>> = Object.freeze({
  folders: 0, chooseFolder: 0, planAdoption: 2, runAdoption: 4, planAdoptionRecovery: 1, runAdoptionRecovery: 2,
  planProjection: 2, runProjection: 3, planRemoval: 1, runRemoval: 2, planRecovery: 2, runRecovery: 3, planMerge: 1, runMerge: 2,
});
/** One channel per call, apart from every other channel of the app. */
export const ENGINE_CHANNELS: Readonly<Record<EngineCall, string>> = Object.freeze(Object.fromEntries(ENGINE_CALLS.map(c => [c, `bowerloom-engine:${c}`])) as Record<EngineCall, string>);
/** The short codes a call can be refused with before it runs. */
export const ENGINE_CALL_REFUSALS = Object.freeze(['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'FAILED'] as const);
/** Refusals of main itself, with words, before a package runs: the write is not the plan main showed last (U16), or the person said no in main's own dialog. */
export const NOT_THE_PLAN_SHOWN = 'NOT_THE_PLAN_SHOWN';
export const CANCELLED = 'CANCELLED';
