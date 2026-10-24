/**
 * The data model of the Bowerloom 0.8 clickable prototype (spec: sections 2 and 6).
 * Types only: no runtime import, no runtime export. Every value is plain JSON: string-literal unions and readonly arrays.
 * There is no clock value and no class. A version is ordered by a logical counter, never by time.
 */

/** The programs a person talks to. One adapter each in the real app. */
export type InterfaceId = 'claude-code' | 'codex' | 'opencode';

/** Whether an interface was found on this computer. `unknown` means the prototype has not looked. */
export type InstalledState = 'installed' | 'not-installed' | 'unknown';

/** What a knowledge slice does for one interface: `blocks reads` outside the slice, or only `advisory only` (spec 6.9). */
export type Enforcement = 'blocks reads' | 'advisory only';

/** One interface in the world: its installed state, a plain-text notice (or null), and the wall it can enforce. */
export interface InterfaceInfo { readonly id: InterfaceId; readonly installed: InstalledState; readonly notice: string | null; readonly enforcement: Enforcement }

/** `global` is the harness root (exactly one per world). `project` is one project folder. */
export type ScopeKind = 'global' | 'project';

/** A place where a harness lives. A project scope inherits from its parent scope. The path is invented sample data. */
export interface Scope { readonly id: string; readonly kind: ScopeKind; readonly name: string; readonly parentId: string | null; readonly path: string }

/** The four kinds of item a harness holds. */
export type HarnessItemKind = 'skill' | 'agent' | 'tool' | 'context-slice';

/** The three kinds of tool in beta.1. Plugins are not a tool kind (spec 6.13). */
export type ToolKind = 'mcp' | 'prompt' | 'hook';

/** One place an item was found: in which interface, at which invented path, with a hash of the text and the text itself. One skill can be found in three interfaces with different text. */
export interface FoundAt { readonly interface: InterfaceId; readonly path: string; readonly contentHash: string; readonly text: string }

/** Marks an item that comes from an installed library. It is read-only, pinned to a version, and shows a newer version when one is waiting. */
export interface LibraryRef { readonly library: string; readonly pinnedVersion: string; readonly newerVersion?: string }

/** An installed source of items, such as ECC. `newerVersion` is set when a new version is waiting. */
export interface LibrarySource { readonly id: string; readonly name: string; readonly installedVersion: string; readonly newerVersion?: string }

/** The fields every item shares. `scopeId` is the scope that owns the item. `library` is null for an item the person owns. */
interface ItemBase { readonly id: string; readonly name: string; readonly scopeId: string; readonly foundAt: readonly FoundAt[]; readonly library: LibraryRef | null }

/** A reusable set of instructions for one kind of task. */
export interface SkillItem extends ItemBase { readonly kind: 'skill'; readonly description: string }

/**
 * How much an agent may do with an attached tool.
 * PLACEHOLDER VALUES: the real class names are still open (spec 6.13 says "such as read-only or read-write"). Do not show these strings as final words.
 */
export type AccessClass = 'read-only' | 'read-write';

/** A tool attached to an agent, with the access class chosen for that attachment. A tool is attached or not; there is no per-action list. */
export interface ToolAttachment { readonly toolId: string; readonly access: AccessClass }

/** The neutral definition of an agent (spec 6.4): the same for every interface. `sliceId` is the knowledge slice the agent reads, if any. */
export interface AgentDefinition { readonly name: string; readonly role: string; readonly instructions: string; readonly skillIds: readonly string[]; readonly toolAttachments: readonly ToolAttachment[]; readonly sliceId?: string }

/** A feature only one interface has. It carries a badge label, so Bowerloom drops nothing without telling the person. */
export interface InterfaceExtra { readonly interface: InterfaceId; readonly badge: string; readonly key: string; readonly value: string }

/** A named role with a neutral definition plus per-interface extras. */
export interface AgentItem extends ItemBase { readonly kind: 'agent'; readonly definition: AgentDefinition; readonly extras: readonly InterfaceExtra[] }

/** The name of the variable or keychain entry that holds a secret, and whether it points at something. The value is never stored. */
export interface SecretRef { readonly kind: 'env' | 'keychain'; readonly name: string; readonly state: 'present' | 'missing' }

/** A secret reference without its state: what an export bundle or an import preview carries. */
export interface SecretSlot { readonly kind: SecretRef['kind']; readonly name: string }

/** An MCP server (the protocol that connects agents to outside services). `secret` is null when the server needs none. */
export interface McpTool extends ItemBase { readonly kind: 'tool'; readonly toolKind: 'mcp'; readonly secret: SecretRef | null }

/** A saved prompt (a slash command). Its text is in `foundAt`. */
export interface PromptTool extends ItemBase { readonly kind: 'tool'; readonly toolKind: 'prompt' }

/** A script an interface runs on its own. `runsCode` is always true and drives the "runs code" badge. A person cannot create or edit one in the app. */
export interface HookTool extends ItemBase { readonly kind: 'tool'; readonly toolKind: 'hook'; readonly runsCode: true }

/** Any tool, told apart by `toolKind`. */
export type ToolItem = McpTool | PromptTool | HookTool;

/** A knowledge slice shown as an item of a harness. `sliceId` points into `World.slices`. */
export interface ContextSliceItem extends ItemBase { readonly kind: 'context-slice'; readonly sliceId: string }

/** Any item of any kind, told apart by `kind`. */
export type HarnessItem = SkillItem | AgentItem | ToolItem | ContextSliceItem;

/** What a project does with an item it would inherit: keep it, hide it, or replace it (spec 6.3). */
export type OverrideMode = 'inherit' | 'hide' | 'replace';

/** One choice per scope per item. `replacementItemId` is set only when `mode` is `replace`. */
export interface Override { readonly scopeId: string; readonly itemId: string; readonly mode: OverrideMode; readonly replacementItemId?: string }

/** One page of the knowledge base. `links` holds page ids. `joinedSinceVisit` is true when the page matched a live slice rule after the last visit. No page text lives here. */
export interface WikiPage { readonly id: string; readonly title: string; readonly folder: string; readonly type: string; readonly tags: readonly string[]; readonly summary: string; readonly bytes: number; readonly links: readonly string[]; readonly joinedSinceVisit: boolean }

/** A slice rule in the three handles of spec 6.9: folders, page types and tags, and links from the seed pages (one or two hops, or null for none). */
export interface SliceRule { readonly folders: readonly string[]; readonly pageTypesAndTags: { readonly types: readonly string[]; readonly tags: readonly string[] }; readonly linksFromSeeds: { readonly hops: 1 | 2 } | null }

/** A saved choice of pages. `seeds` holds page ids. A live slice follows its rule. A pinned slice freezes its page list in `pinnedPageIds`. */
export interface Slice { readonly id: string; readonly name: string; readonly seeds: readonly string[]; readonly rule: SliceRule; readonly pinned: boolean; readonly pinnedPageIds?: readonly string[] }

/** One saved state of a harness. `counter` is a logical integer that grows with each apply, never a clock value. `parentId` is null for the first version. `snapshotJson` is the harness as JSON text. */
export interface Version { readonly id: string; readonly parentId: string | null; readonly counter: number; readonly label: string; readonly snapshotJson: string }

/** The whole sample world: everything the prototype screens read. */
export interface World {
  readonly interfaces: readonly InterfaceInfo[];
  readonly items: readonly HarnessItem[];
  readonly scopes: readonly Scope[];
  readonly overrides: readonly Override[];
  readonly wikiPages: readonly WikiPage[];
  readonly slices: readonly Slice[];
  readonly versions: readonly Version[];
  readonly libraries: readonly LibrarySource[];
}

/** One file change in a projection plan, for one interface. `preview` is the text the person sees before anything is written. */
export interface PlanChange { readonly interface: InterfaceId; readonly path: string; readonly action: 'add' | 'change' | 'remove'; readonly preview: string }

/** What projecting a harness would change, per interface, shown before any write (spec 6.5). */
export interface Plan { readonly changes: readonly PlanChange[]; /** How many items differ (an edit is one item, not one file). Set by `planProjection`. */ readonly edits?: number }

/** A tool as an export bundle names it: no secret value, and no state either. */
export interface ToolReference { readonly toolId: string; readonly name: string; readonly toolKind: ToolKind; readonly secret: SecretSlot | null }

/** An item an export bundle carries. Tools travel as references, and slices as rules. */
export type BundleItem = SkillItem | AgentItem;

/** An export bundle (spec 6.7): harness items, tool references with no secret values, and slice rules. No wiki page text. */
export interface Bundle { readonly scopeIds: readonly string[]; readonly items: readonly BundleItem[]; readonly toolRefs: readonly ToolReference[]; readonly sliceRules: readonly { readonly sliceId: string; readonly name: string; readonly rule: SliceRule }[] }

/** A file an import would write. `characters` is how many characters the file would hold. */
export interface ImportFile { readonly path: string; readonly action: 'add' | 'change'; readonly characters: number }

/** An imported item that meets one already there. */
export interface ImportClash { readonly itemId: string; readonly name: string; readonly reason: 'same-name' | 'different-text' | 'different-secret' }

/** One access class an import would give: this agent may use this tool this way. */
export interface ImportGrant { readonly agent: string; readonly tool: string; readonly access: AccessClass }

/**
 * What an import would do, shown before it does anything: every file, every secret the person must add, every clash, every access class it
 * would grant, and every reference it cannot resolve (`missingRefs`, one plain sentence each).
 */
export interface ImportPreview {
  readonly files: readonly ImportFile[]; readonly secretsToAdd: readonly SecretSlot[]; readonly clashes: readonly ImportClash[];
  readonly grants: readonly ImportGrant[]; readonly missingRefs: readonly string[];
  /** Items whose harness this workspace does not have, so they land in the global harness. `fromScope` is the id the file gave. */
  readonly moved: readonly { readonly itemName: string; readonly fromScope: string; readonly toScope: string }[];
  /** Hooks that would arrive. A hook has no file and no code: it arrives as a name only. */
  readonly hooks: readonly { readonly name: string; readonly scope: string }[];
}
