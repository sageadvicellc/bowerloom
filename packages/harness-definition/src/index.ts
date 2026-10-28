/**
 * The harness definition core of Bowerloom 0.8: what Bowerloom stores, before any part moves into an engine.
 * Specs: 2026-10-27-bowerloom-harness-definition.md, and the fidelity rule of 2026-10-27-bowerloom-locked-in-parts.md.
 */
export {
  DEFINITION_LIMITS, ENGINE_IDS, GUARDRAIL_ACTIONS, GUARDRAIL_EFFECTS, HARNESS_FORMAT, MCP_TRANSPORTS, OVERRIDABLE_PARTS,
  PART_KEYS, PART_KINDS, PART_LOCATIONS, RESULTS, STRENGTHS, TOOL_CLASSES, isEngineId, isId, isServerName,
} from './words.js';
export type {
  EngineId, GuardrailAction, GuardrailEffect, McpTransport, OverridablePart, PartKey, PartKind, Result, Strength, ToolClass,
} from './words.js';
export type {
  Definition, DefinitionFile, EngineTarget, EnvValue, Filterable, GuardrailRule, HarnessFile, HookEntry, JsonValue,
  LayerOverride, LoadResult, McpServer, PartEntries, PartPointers, PrivateBlocks, Problem, SandboxRequirement, SecretRef,
  SkillEntry, SourceRecord, SubagentEntry,
} from './types.js';
export { parseStrictJson, readFrontmatter } from './json.js';
export type { FrontmatterResult, StrictJsonCode, StrictJsonResult } from './json.js';
export { loadDefinition } from './load.js';
export { REVISION_PREFIX, canonicalBytes, computeRevision } from './revision.js';
export { isReferenceOnly, isSecretKey, scanSecrets } from './secrets.js';
export type { SecretFinding } from './secrets.js';
export { entriesOf, resolveLayers } from './layers.js';
export type { HiddenItem, LayerInput, Placed, ResolveResult, ResolvedHarness } from './layers.js';
export { appliesTo, selectForEngine } from './select.js';
export type { EngineView } from './select.js';
export { checkFidelity, needsOverride, parseFidelityOverride } from './fidelity.js';
export type { FidelityOverride, FidelityVerdict, LossLine, LossReport, ParseOverrideResult } from './fidelity.js';
