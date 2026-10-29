/**
 * The harness definition core of Bowerloom 0.8: what Bowerloom stores, before any part moves into an engine.
 * Specs: 2026-10-27-bowerloom-harness-definition.md, and the fidelity rule of 2026-10-27-bowerloom-locked-in-parts.md.
 * README.md in this package states the trust boundary and the rules for the later lanes.
 */
export {
  DEFINITION_LIMITS, ENGINE_IDS, GUARDRAIL_ACTIONS, GUARDRAIL_EFFECTS, HARNESS_FORMAT, LEGACY_NAMES, LOSS_PARTS, MCP_TRANSPORTS,
  OVERRIDABLE_PARTS, PART_KEYS, PART_KINDS, PART_LOCATIONS, PREVIEW_ENGINES_ENV, PREVIEW_ENGINE_IDS, RESULTS, STRENGTHS, SUPPORTED_ENGINE_IDS, TOOL_CLASSES,
  isEngineId, isId, isPreviewEngine, isServerName, previewEnginesAllowed,
} from './words.js';
export type {
  EngineId, GuardrailAction, GuardrailEffect, LossPart, McpTransport, OverridablePart, PartKey, PartKind, PreviewEngineId, Result, Strength, SupportedEngineId,
  ToolClass,
} from './words.js';
export type {
  AdoptedFrom, AdoptedRecord, Definition, DefinitionFile, EngineTarget, EnvValue, Filterable, GuardrailRule, HarnessFile, HookEntry, JsonValue,
  LayerOverride, LoadResult, McpServer, PartEntries, PartPointers, PrivateBlocks, Problem, SandboxRequirement, SecretRef,
  ScriptEntry, SkillEntry, SkillSettings, SourceRecord, SubagentEntry,
} from './types.js';
export { jsonValueFault, parseStrictJson, readFrontmatter } from './json.js';
export type { FrontmatterResult, StrictJsonCode, StrictJsonResult } from './json.js';
export { isDefinitionFolder, loadDefinition } from './load.js';
export { adoptedPaths, isPermissionKey } from './schema.js';
export { REVISION_PREFIX, canonicalBytes, computeRevision, fileContentHash, skillContentHash } from './revision.js';
export { INCOMPLETE_RULES, isReferenceOnly, isSafeName, isSecretKey, safeName, scanSecrets } from './secrets.js';
export type { SecretFinding } from './secrets.js';
export { entriesOf, resolveLayers } from './layers.js';
export type { ApprovedChange, HiddenItem, LayerInput, Placed, ResolveOptions, ResolveResult, ResolvedHarness, TrustReason } from './layers.js';
export { appliesTo, selectForEngine } from './select.js';
export type { EngineView, Excluded, ExcludedPart, ViewSource } from './select.js';
export {
  checkFidelity, entryHash, fidelityApprovalMatches, layerApprovalMatches, needsApproval, parseFidelityApproval,
  parseLayerApproval, strengthOf,
} from './fidelity.js';
export type {
  ApprovalOptions, FidelityApproval, FidelitySource, FidelityVerdict, JudgedLine, LayerApproval, LossLine, LossReport, ParseResult,
} from './fidelity.js';
