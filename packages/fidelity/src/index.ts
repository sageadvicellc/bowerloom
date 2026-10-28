/**
 * The fidelity engine of Bowerloom 0.8 (step 2, lane B): the neutral guardrail model, its translation into each engine,
 * a matcher per engine, and the loss report judged by the contract. Pure functions: no file writes, no engine runs.
 * Spec: 2026-10-27-bowerloom-locked-in-parts.md, sections 2, 3, 8, 10, 11, and 12. README.md states the readings.
 */
export { DECISIONS, PRECEDENCE, combineParts, morePermissive, stricter } from './decision.js';
export type { Decision } from './decision.js';
export { bashPatternRegex, decidingRules, globRegex, neutralDecision, patternProblem, patternProgram, ruleMatches } from './neutral.js';
export type { NeutralRequest, RuleShape, ShellReading } from './neutral.js';
export { listMatches, normalizeRequestPath, pathMatches, pathPatternProblem, pathRegex } from './paths.js';
export type { PathMode } from './paths.js';
export { WRAPPERS, collapseWhitespace, joinLines, opaqueForms, programWord, splitCommand, stripAssignments, stripWrappers } from './shell.js';
export type { OpaqueForm, StripOptions } from './shell.js';
export { KNOWN_ESCAPES, PATH_ALLOW_REACH, escapeSentence, escapesOf } from './escapes.js';
export type { EscapeId, KnownEscape } from './escapes.js';
export { CLAUDE_CODE_DEFAULT, claudeCodeDecide, claudeCodeHookMatches, claudeCodeRequest, webDenyHosts } from './claude-code.js';
export type { ClaudeCodeForm, ClaudeCodeLists, ClaudeCodeRequest } from './claude-code.js';
export {
  codexCommands, codexDecide, codexFilesystemDecide, codexHookMatches, codexPatternMatches, codexRequirementsRule,
  codexScriptCommands, codexShellArgv, codexSplits,
} from './codex-shell.js';
export type { CodexDecisionWord, CodexFilesystemEntry, CodexMatchOptions, CodexPrefixRule } from './codex-shell.js';
export { CODEX_DEFAULT, codexPrefix } from './codex.js';
export type { CodexForm, CodexMcpDisable } from './codex.js';
export {
  OPENCODE_DEFAULT, openCodeDecide, openCodeFromConfig, openCodePathPatterns, openCodeRequest, openCodeShellSubjects, openCodeWildcard,
} from './opencode.js';
export type { OpenCodeForm, OpenCodeKey, OpenCodePermission, OpenCodeRequest, OpenCodeRule, WildcardOptions } from './opencode.js';
export { NO_RULES_DEFAULTS } from './no-rules.js';
export type { NoRulesForm } from './no-rules.js';
export { NOT_WRITTEN } from './translation.js';
export type { EngineDefault, SandboxForm, Translation, Written } from './translation.js';
export { engineDecision, judgeGuardrails, projectGuardrails, translateGuardrails } from './project.js';
export type { EngineForm, GuardrailEntries, GuardrailProjection, GuardrailSource, GuardrailTranslation } from './project.js';
// Step 3, lane B: the translations of MCP servers, subagents, and hooks (locked-in parts spec, sections 5 to 7).
export { addPrivate, envDefaultIn, holdsEnvDefault, referenceParts, references, stringsOf } from './locked-common.js';
export type { LockedProblem } from './locked-common.js';
export { DSH_MCP_PLUGIN, translateMcp } from './locked-mcp.js';
export type { DshRow, DshValue, JsExpression, McpServerForm, McpTranslation } from './locked-mcp.js';
export { CLAUDE_CODE_TOOLS, OPENCODE_TOOL_KEYS, translateSubagents } from './locked-subagents.js';
export type { SubagentContext, SubagentForm, SubagentTranslation } from './locked-subagents.js';
export {
  CLAUDE_CODE_HOOK_EVENTS, CODEX_HOOK_EVENTS, DEFAULT_HOOK_TIMEOUT_MS, OPENCODE_HOOK_EVENTS, PROJECT_DIR, PROJECT_DIR_FORMS, translateHooks,
} from './locked-hooks.js';
export type { HookForm, HookTranslation } from './locked-hooks.js';
