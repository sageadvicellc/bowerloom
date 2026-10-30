/**
 * The fixed words of a harness definition: engine ids, part kinds, strengths, results, tool classes, and guardrail
 * words. Harness definition spec, sections 3, 4, 11, and 13; locked-in parts spec, sections 3 and 8.
 */

/** The format name and version in `harness.json`. */
export const HARNESS_FORMAT = 'bowerloom/harness/v1beta1' as const;

/** Engine ids, one set for every package (decision 2). Step 0 renames the old `Harness` type; the two meet later. */
export const ENGINE_IDS = Object.freeze(['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'] as const);
export type EngineId = (typeof ENGINE_IDS)[number];
export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);
}

/**
 * Bowerloom 0.8.0-beta.1 supports Claude Code and Codex. The other three engines stay in the code as preview engines:
 * install to them is refused unless the preview switch is on. Adoption still reads their files, and removal still removes
 * the files an earlier flagged install wrote. This is the one list; every other package takes it from here.
 */
export const PREVIEW_ENGINE_IDS = Object.freeze(['opencode', 'pi', 'deepseek-harness'] as const satisfies readonly EngineId[]);
export type PreviewEngineId = (typeof PREVIEW_ENGINE_IDS)[number];
export function isPreviewEngine(value: unknown): value is PreviewEngineId {
  return typeof value === 'string' && (PREVIEW_ENGINE_IDS as readonly string[]).includes(value);
}
/** The engines beta.1 supports, in the order of `ENGINE_IDS`. */
export const SUPPORTED_ENGINE_IDS = Object.freeze(ENGINE_IDS.filter(id => !isPreviewEngine(id)) as Exclude<EngineId, PreviewEngineId>[]);
export type SupportedEngineId = (typeof SUPPORTED_ENGINE_IDS)[number];

/** The environment variable that turns preview engines on. Only the exact value `1` does. */
export const PREVIEW_ENGINES_ENV = 'BOWERLOOM_PREVIEW_ENGINES';
/** True when the given environment turns preview engines on. Anything but the exact text `1` means off. */
export function previewEnginesAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  return Object.hasOwn(env, PREVIEW_ENGINES_ENV) && env[PREVIEW_ENGINES_ENV] === '1';
}

/** `enforced`: the engine must block the action. `advisory`: the text only asks the model. */
export const STRENGTHS = Object.freeze(['enforced', 'advisory'] as const);
export type Strength = (typeof STRENGTHS)[number];

/** How one engine carries one entry. */
export const RESULTS = Object.freeze(['exact', 'translated', 'weakened', 'absent'] as const);
export type Result = (typeof RESULTS)[number];

/** The eight part kinds of Harness² (section 4). */
export const PART_KINDS = Object.freeze([
  'system-prompt', 'skills', 'memory', 'tool-guidance', 'subagents', 'guardrails', 'scripts', 'plugins',
] as const);
export type PartKind = (typeof PART_KINDS)[number];

/** The part kinds plus the two stored files with no Harness² slot: `hooks.json` and `mcp.json` (section 4). */
export const PART_KEYS = Object.freeze([...PART_KINDS, 'hooks', 'mcp'] as const);
export type PartKey = (typeof PART_KEYS)[number];

/**
 * The parts a loss line can name: the part keys, plus `engine-private` for a file under `engines/<engine>/`. Such a file
 * belongs to no part of section 4, so it has a loss-line part of its own. A line of it is always advisory.
 */
export const LOSS_PARTS = Object.freeze([...PART_KEYS, 'engine-private'] as const);
export type LossPart = (typeof LOSS_PARTS)[number];

/** Parts whose items a lower layer can `hide` or `replace` (section 6). */
export const OVERRIDABLE_PARTS = Object.freeze(['skills', 'subagents', 'guardrails', 'hooks', 'mcp'] as const);
export type OverridablePart = (typeof OVERRIDABLE_PARTS)[number];

/** Where each part lives in the `.bowerloom` folder (section 8). A folder ends in `/`. */
export const PART_LOCATIONS = Object.freeze({
  'system-prompt': 'instructions/AGENTS.md',
  memory: 'instructions/AGENTS.md',
  skills: 'skills/',
  subagents: 'agents/',
  guardrails: 'guardrails.json',
  scripts: 'scripts/',
  plugins: 'sources.json',
  hooks: 'hooks.json',
  mcp: 'mcp.json',
} as const satisfies Record<Exclude<PartKey, 'tool-guidance'>, string>);

/** Neutral tool classes (section 4.1). `mcp:<server>` names one MCP server. */
export const TOOL_CLASSES = Object.freeze(['read', 'search', 'edit', 'write', 'shell', 'web', 'task', 'skill'] as const);
export type ToolClass = (typeof TOOL_CLASSES)[number] | `mcp:${string}`;

/** Guardrail actions (locked-in parts spec, section 8.1). `mcp` is an MCP tool. */
export const GUARDRAIL_ACTIONS = Object.freeze(['shell', 'read', 'edit', 'write', 'web', 'mcp', 'subagent', 'skill'] as const);
export type GuardrailAction = (typeof GUARDRAIL_ACTIONS)[number];

/** Guardrail effects. The precedence is fixed: `deny` beats `ask`, and `ask` beats `allow`. */
export const GUARDRAIL_EFFECTS = Object.freeze(['allow', 'ask', 'deny'] as const);
export type GuardrailEffect = (typeof GUARDRAIL_EFFECTS)[number];

/** MCP transports. `sse` and `ws` load, and the projection lanes report them `absent` where an engine lacks them. */
export const MCP_TRANSPORTS = Object.freeze(['stdio', 'http', 'sse', 'ws'] as const);
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/** Bounds on a definition folder. A scan line over `lineChars` is not scanned: it is a refusal. */
export const DEFINITION_LIMITS = Object.freeze({
  files: 4096,
  fileBytes: 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  frontmatterBytes: 64 * 1024,
  entries: 1024,
  folderEntries: 4096,
  depth: 16,
  problems: 200,
  lineChars: 4096,
});

/**
 * Names that a 0.7 layer or store keeps in its `.bowerloom` folder. A 0.8 loader neither reads nor changes them
 * (definition spec, section 8, rule 6). Any other top-level name that section 8 does not define is refused.
 * The list is a snapshot of 0.7.0-beta.3; a name 0.7 adds later must join it.
 */
export const LEGACY_NAMES = Object.freeze([
  'skills.json', 'bowerloom.json', 'manifest.json', 'team.yaml', 'brief.json', 'installation-receipt.json', 'startup.json',
  'store.json', 'journal.json', 'managed-pending.json', 'START-HERE.md', 'milestones.md', 'optional-controls.md',
  'startup-review.md', 'working-agreement.md', 'folders', 'authoring', 'managed', 'prompts', 'teams', 'slices',
  'store-cache', '.gitignore', '.git', '.bowerloom-revision.json',
] as const);

/** A lowercase name with single hyphens, up to 64 characters: harness, skill, subagent, rule, and hook ids. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
/** An MCP server name: letters, digits, `_`, and `-`, up to 64 characters. */
export function isServerName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}
