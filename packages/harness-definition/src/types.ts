/** The shapes of a loaded harness definition (harness definition spec, sections 3, 4, and 8). */
import type {
  EngineId, GuardrailAction, GuardrailEffect, McpTransport, OverridablePart, PartKey, Strength, ToolClass,
} from './words.js';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** One fault, with the definition-relative file it came from. Never holds a secret value. */
export interface Problem {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  /** The index of the layer in a chain, for layer problems. */
  readonly layer?: number;
}

/** An engine to project to, with an optional version and an optional explicit model. */
export interface EngineTarget {
  readonly id: EngineId;
  readonly version?: string;
  readonly model?: string;
}

/** From each part key to its location. `tool-guidance` lists sections of the instructions or skills. */
export type PartPointers = {
  readonly [K in Exclude<PartKey, 'tool-guidance'>]?: string;
} & { readonly 'tool-guidance'?: readonly string[] };

/** A per-item decision for inheritance (section 6). */
export interface LayerOverride {
  readonly part: OverridablePart;
  readonly id: string;
  readonly action: 'hide' | 'replace';
}

/** `harness.json`. Sources live in `sources.json`, the file the `plugins` pointer names. */
export interface HarnessFile {
  readonly format: string;
  readonly id: string;
  readonly description: string;
  readonly engines: readonly EngineTarget[];
  readonly parts: PartPointers;
  readonly overrides: readonly LayerOverride[];
}

/** Engine-private blocks, from the `x-<engine>` keys of an entry, kept unchanged. */
export type PrivateBlocks = Readonly<Partial<Record<EngineId, JsonValue>>>;

/** An entry that can carry an engine filter. No filter means every engine of the harness. */
export interface Filterable {
  readonly engines?: readonly EngineId[];
}
interface Private {
  readonly privateBlocks: PrivateBlocks;
}

/** `skills/<id>/SKILL.md` with the open core fields only. */
export interface SkillEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  /** The Markdown after the frontmatter, with LF line endings. */
  readonly body: string;
  /** Every file of the skill folder, relative to it, in byte order. */
  readonly files: readonly string[];
}

/** `agents/<id>.md`. */
export interface SubagentEntry extends Filterable, Private {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly body: string;
  /** One explicit model per engine. Bowerloom keeps no alias table. */
  readonly model?: Readonly<Partial<Record<EngineId, string>>>;
  readonly tools?: readonly ToolClass[];
  readonly skills?: readonly string[];
}

/** A rule of `guardrails.json`. */
export interface GuardrailRule extends Filterable, Private {
  readonly id: string;
  readonly action: GuardrailAction;
  readonly pattern: string;
  readonly effect: GuardrailEffect;
  readonly strength: Strength;
}

/** The `sandbox` of `guardrails.json`: a requirement for a file sandbox, a network sandbox, or both. */
export interface SandboxRequirement extends Filterable, Private {
  readonly files: boolean;
  readonly network: boolean;
}

/** A command hook of `hooks.json`. `timeout` is in milliseconds. */
export interface HookEntry extends Filterable, Private {
  readonly id: string;
  readonly event: string;
  readonly matcher?: string;
  readonly command: string;
  readonly timeout?: number;
  readonly strength: Strength;
}

/** A keychain entry that holds a secret. */
export interface SecretRef {
  readonly keychain: string;
}
/** A literal with no secret, a string with `${NAME}` references, or a keychain reference. */
export type EnvValue = string | SecretRef;

/** A server of `mcp.json`. `id` equals `name`. `timeout` is in milliseconds. */
export interface McpServer extends Filterable, Private {
  readonly id: string;
  readonly name: string;
  readonly transport: McpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, EnvValue>>;
  readonly headers?: Readonly<Record<string, EnvValue>>;
  readonly timeout?: number;
  readonly enabled?: boolean;
}

/** A borrowed item: its plugin or library, marketplace, and pinned version (section 7). */
export interface SourceRecord {
  readonly name: string;
  readonly marketplace: string;
  readonly version: string;
  readonly items: readonly { readonly part: OverridablePart; readonly id: string }[];
}

/** The entries of every part that holds entries. */
export interface PartEntries {
  readonly skills: readonly SkillEntry[];
  readonly subagents: readonly SubagentEntry[];
  readonly rules: readonly GuardrailRule[];
  readonly sandbox: readonly SandboxRequirement[];
  readonly hooks: readonly HookEntry[];
  readonly mcp: readonly McpServer[];
}

/** One file of a definition, by its path relative to the `.bowerloom` folder, with `/` separators. */
export interface DefinitionFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** A loaded definition folder. */
export interface Definition {
  /** The absolute path of the `.bowerloom` folder. */
  readonly folder: string;
  readonly harness: HarnessFile;
  /** `instructions/AGENTS.md`, with LF line endings, when the definition has one. */
  readonly instructions?: string;
  readonly entries: PartEntries;
  readonly sources: readonly SourceRecord[];
  /** Files under `scripts/`, relative to it. */
  readonly scripts: readonly string[];
  /** Files under `engines/<engine>/`, relative to that folder. */
  readonly enginePrivate: Readonly<Partial<Record<EngineId, readonly string[]>>>;
  /** Every definition file, in byte order of path. Legacy files in the folder are not among them. */
  readonly files: readonly DefinitionFile[];
  /** The revision: a hash over the canonical files (section 9). */
  readonly revision: string;
}

export type LoadResult =
  | { readonly ok: true; readonly definition: Definition }
  | { readonly ok: false; readonly problems: readonly Problem[] };
