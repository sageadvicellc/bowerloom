/**
 * Adoption of Bowerloom 0.8 (step 3, lane A): reads a project's engine files and writes a harness definition by copy.
 * Spec: 2026-10-27-bowerloom-harness-definition.md, sections 8, 10, 11, 12, and 13. README.md states the mappings.
 */
export { planAdoption } from './plan.js';
export type { AdoptionInput } from './plan.js';
export { applyAdoption } from './apply.js';
export { applyAdoptionRecovery, planAdoptionRecovery, JOURNAL, JOURNAL_FORMAT, RECOVERY_PLAN_FORMAT } from './journal.js';
export type { AdoptionRecoveryPlan, AdoptionRecoveryResult, RecoveryInput } from './journal.js';
export type { AdoptionResult } from './apply.js';
export {
  SAVE_JOURNAL, SAVE_JOURNAL_LIMIT, SAVE_PAYLOAD_LIMIT, SAVE_PLAN_FORMAT, SAVE_RECOVERY_FORMAT, SAVE_REFUSAL_CODES, SaveRefusal, applySave, planSave, planSaveRecovery,
  refuseWhileSaveStopped, runSaveRecovery, saveStopped,
} from './save.js';
export type { SaveChange, SaveCode, SaveInput, SavePlan, SaveRecoveryMode, SaveRecoveryPlan, SaveRecoveryResult, SaveResult, SaveTarget } from './save.js';
export { ADOPTION_PLAN_FORMAT, EVERY_ENGINE_PARTS } from './model.js';
export type {
  AdoptionChoice, AdoptionPlan, Conflict, Difference, EveryEngine, EveryEnginePart, Gate, ItemPart, ManagedConversion, Missed, Place, PlanEngine, PlanItem, PlannedFile, SecretLine,
  SourceShape, Unmapped, UnmappedPart,
} from './model.js';
export { ADOPTION_REFUSAL_CODES, AdoptionRefusal } from './refusal.js';
export type { AdoptionCode } from './refusal.js';
export { DSH_PINNED_TAG, READER_VERSIONS } from './context.js';
export { SKILL_PLACES } from './portable-readers.js';
export { UNMAPPED_LIMIT } from './plan.js';
export { READ_BUDGET } from './files.js';
export { TOML_MAX_DEPTH, parseTomlSubset } from './toml.js';
export type { TomlCode, TomlResult } from './toml.js';
