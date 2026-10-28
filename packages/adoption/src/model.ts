/** The shapes of an adoption plan, and of the candidates the engine readers give the planner. */
import type {
  EngineId, GuardrailAction, GuardrailEffect, JsonValue, McpTransport, EnvValue, Problem, Strength, ToolClass,
} from '../../harness-definition/src/index.js';

/** The parts of a plan item. `engine-private` is a file under `engines/<engine>/`. */
export type ItemPart = 'system-prompt' | 'skills' | 'subagents' | 'guardrails' | 'hooks' | 'mcp' | 'engine-private';
export type UnmappedPart = ItemPart | 'plugins' | 'commands' | 'legacy' | null;

/**
 * Where an item was found. `engines` are the engines that read that place. `shape` names the file form the reader
 * follows, and `shapeVersion` the engine version whose documented form that is.
 */
export interface Place {
  readonly path: string;
  readonly pointer?: string;
  readonly engines: readonly EngineId[];
  readonly kind: 'engine' | 'authored-0.7' | 'managed-0.7';
  readonly shape: string;
  readonly shapeVersion: string | null;
}

/**
 * What an unmapped entry asks of a person. `none`: it is listed. `acknowledge`: it could hold a deny, an ask, or a
 * sandbox value, so the plan is not ready until a person acknowledges it by id (ruling A17). `block`: the plan cannot
 * be ready until a person changes the source, such as an `@path` import to inline (ruling A15).
 */
export type Gate = 'none' | 'acknowledge' | 'block';

/** Something adoption does not carry into the definition, as a reader lists it. */
export interface Missed {
  readonly path: string;
  readonly pointer?: string;
  readonly part: UnmappedPart;
  readonly reason: string;
  readonly gate: Gate;
}

/** Something adoption does not carry into the definition, with the reason, an id, and what it asks of a person. */
export interface Unmapped extends Missed {
  /** The path, then `#` and the pointer when there is one; a later entry with the same place gets `~2`, `~3`. */
  readonly id: string;
  readonly acknowledged: boolean;
}

/** A literal secret that adoption replaced with a reference. It never holds the value. */
export interface SecretLine {
  readonly path: string;
  readonly pointer: string;
  readonly reference: string;
  readonly part: ItemPart;
  readonly id: string;
}

export type Blocks = Partial<Record<EngineId, JsonValue>>;

/** A skill folder as read: its files, with SKILL.md parsed into core fields and what does not fit them. */
export interface SkillCopy {
  readonly data: Readonly<Record<string, JsonValue>>;
  readonly body: string;
  /** Every file other than SKILL.md, relative to the folder. */
  readonly files: readonly { readonly path: string; readonly bytes: Uint8Array; readonly executable: boolean }[];
  /** SKILL.md as written, LF line endings, and whether it needs no rewrite to hold only core fields. */
  readonly text: string;
  readonly raw: Uint8Array;
  readonly rawExecutable: boolean;
  readonly clean: boolean;
}

export interface RuleShape { readonly action: GuardrailAction; readonly pattern: string; readonly effect: GuardrailEffect; readonly strength: Strength }
export interface SandboxShape { readonly files: boolean; readonly network: boolean }
export interface HookShape { readonly event: string; readonly matcher?: string; readonly command: string; readonly timeout?: number; readonly strength: Strength }
export interface ServerShape {
  readonly transport: McpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, EnvValue>>;
  readonly headers?: Readonly<Record<string, EnvValue>>;
  readonly timeout?: number;
  readonly enabled?: boolean;
}
export interface SubagentShape {
  readonly description: string;
  readonly body: string;
  readonly tools?: readonly ToolClass[];
  readonly skills?: readonly string[];
}
/** A borrowed item's source for `sources.json`: npm or git sources of 0.7 managed copies. */
export interface SourceShape {
  readonly name: string;
  readonly marketplace: string;
  readonly version: string;
  /** True: the 0.7 catalog claims this source, and Bowerloom did not check it (ruling A8). */
  readonly claimed?: true;
}

interface CandidateBase {
  readonly place: Place;
  /** Private blocks by engine. Only engines of the harness are kept. */
  readonly blocks: Blocks;
  readonly needsApproval: readonly string[];
  readonly notes: readonly string[];
  readonly secrets: readonly Omit<SecretLine, 'part' | 'id'>[];
}
export type Candidate =
  | CandidateBase & { readonly part: 'system-prompt'; readonly id: 'AGENTS.md'; readonly text: string; readonly raw: Uint8Array }
  | CandidateBase & { readonly part: 'skills'; readonly id: string; readonly skill: SkillCopy; readonly fixed: boolean; readonly source?: SourceShape }
  | CandidateBase & { readonly part: 'subagents'; readonly id: string; readonly subagent: SubagentShape; readonly models: Partial<Record<EngineId, string>> }
  | CandidateBase & { readonly part: 'guardrails'; readonly id: string; readonly rule: RuleShape }
  | CandidateBase & { readonly part: 'guardrails'; readonly id: 'sandbox'; readonly sandbox: SandboxShape }
  | CandidateBase & { readonly part: 'hooks'; readonly id: string; readonly hook: HookShape }
  | CandidateBase & { readonly part: 'mcp'; readonly id: string; readonly server: ServerShape }
  | CandidateBase & { readonly part: 'engine-private'; readonly id: string; readonly engine: EngineId; readonly value: Readonly<Record<string, JsonValue>> };

/** One item of the planned definition. */
export interface PlanItem {
  readonly part: ItemPart;
  readonly id: string;
  /** Every place the item was found, in path order. */
  readonly places: readonly Place[];
  /** The engine filter: null means every engine of the harness. */
  readonly engines: readonly EngineId[] | null;
  /** The engines whose private block the item carries. */
  readonly privateBlocks: readonly EngineId[];
  /** Why a person must look at this item before adoption writes it. Empty when nothing needs a look. */
  readonly needsApproval: readonly string[];
  readonly notes: readonly string[];
  /** The 0.7 source recorded in `sources.json`, for a converted managed copy. */
  readonly source?: SourceShape;
}

/** How a person resolves a conflict: pick one variant, or keep variants under distinct ids. */
export type AdoptionChoice = { readonly pick: string } | { readonly rename: Readonly<Record<string, string>> };

/** Items that share a part and an id and differ. Variants are in path order, never import order. */
export interface Conflict {
  readonly key: string;
  readonly part: ItemPart;
  readonly id: string;
  readonly variants: readonly { readonly key: string; readonly places: readonly Place[]; readonly sha256: string; readonly fixed: boolean }[];
  readonly options: readonly ('pick' | 'rename')[];
  readonly choice: AdoptionChoice | null;
}

/** Guardrail rules for the same action and pattern whose effect differs between engines. Both are kept, each with its engines. */
export interface Difference {
  readonly action: GuardrailAction;
  readonly pattern: string;
  readonly rules: readonly { readonly id: string; readonly effect: GuardrailEffect; readonly engines: readonly EngineId[] }[];
}

/** A 0.7 managed copy, and the definition skill it became. */
export interface ManagedConversion {
  readonly catalog: string;
  readonly kind: string;
  readonly id: string;
  /** The definition skill, or null when the copy was not converted. */
  readonly skill: string | null;
  readonly source: SourceShape | null;
  readonly copies: readonly string[];
  readonly reason: string;
}

export interface PlannedFile {
  /** Relative to the `.bowerloom` folder. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mode: number;
}

export interface PlanEngine {
  readonly id: EngineId;
  /** The version a person recorded, or the pinned DeepSeek Harness tag. Null when unknown. */
  readonly version: string | null;
  readonly model: string | null;
  /** True when an engine file named this engine; false when the input or the 0.7 default named it. */
  readonly detected: boolean;
  /** The file shapes read for this engine, each with the engine version whose documented form it is. */
  readonly shapes: readonly { readonly path: string; readonly shape: string; readonly shapeVersion: string | null }[];
}

export const ADOPTION_PLAN_FORMAT = 'bowerloom/adoption-plan/v1beta1' as const;

export interface AdoptionPlan {
  readonly format: typeof ADOPTION_PLAN_FORMAT;
  readonly projectDir: string;
  readonly definitionFolder: string;
  readonly harness: { readonly id: string; readonly description: string };
  readonly engines: readonly PlanEngine[];
  /** Every file adoption read, with its hash. Adoption changes none of them. */
  readonly read: readonly { readonly path: string; readonly sha256: string }[];
  readonly items: readonly PlanItem[];
  readonly conflicts: readonly Conflict[];
  readonly differences: readonly Difference[];
  readonly unmapped: readonly Unmapped[];
  readonly secrets: readonly SecretLine[];
  readonly managed: readonly ManagedConversion[];
  readonly warnings: readonly string[];
  /** The files apply writes into the `.bowerloom` folder, in byte order. */
  readonly files: readonly PlannedFile[];
  /** The keys (`<part>/<id>`) of every item that needs approval. Apply takes the confirmed ones (ruling A7). */
  readonly approvalsRequired: readonly string[];
  /** What the loader says about the planned definition. Empty when it loads. */
  readonly problems: readonly Problem[];
  /**
   * True when apply can write: no conflict waits for a choice, every gated unmapped entry is acknowledged, nothing
   * blocks, and the definition loads. Apply also needs every approval in `approvalsRequired`.
   */
  readonly ready: boolean;
  readonly writesAuthorized: false;
  readonly revision: string;
}
