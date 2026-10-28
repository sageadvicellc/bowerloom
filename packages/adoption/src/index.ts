/**
 * Adoption of Bowerloom 0.8 (step 3, lane A): reads a project's engine files and writes a harness definition by copy.
 * Spec: 2026-10-27-bowerloom-harness-definition.md, sections 8, 10, 11, 12, and 13. README.md states the mappings.
 */
export { planAdoption } from './plan.js';
export type { AdoptionInput } from './plan.js';
export { applyAdoption } from './apply.js';
export type { AdoptionResult } from './apply.js';
export { ADOPTION_PLAN_FORMAT } from './model.js';
export type {
  AdoptionChoice, AdoptionPlan, Conflict, Difference, ItemPart, ManagedConversion, Place, PlanEngine, PlanItem, PlannedFile, SecretLine,
  SourceShape, Unmapped, UnmappedPart,
} from './model.js';
export { ADOPTION_REFUSAL_CODES, AdoptionRefusal } from './refusal.js';
export type { AdoptionCode } from './refusal.js';
export { DSH_PINNED_TAG, READER_VERSIONS } from './context.js';
export { SKILL_PLACES } from './portable-readers.js';
export { parseTomlSubset } from './toml.js';
export type { TomlCode, TomlResult } from './toml.js';
