/**
 * The team object of Bowerloom 0.8: `team.json`, the relay map, adoption of a 0.7 team, and the start plan.
 * Spec: 2026-10-28-bowerloom-teams-and-relay.md. Decision 7 keeps the relay bus out of 0.8: nothing here opens a
 * socket or starts a process. README.md states the rules.
 */
export {
  CREW_BLOCK, CREW_FORMAT_07, DELIVERY_MODES, HUMAN, INBOX_MODES, MAP_NAMES, MODEL_CLASSES, RELAY_MAP_FORMAT, RELAY_MAP_PATH,
  START_MODES, START_PLAN_FORMAT, TEAM_FORMAT, TEAM_LEGACY_NAMES, TEAM_LIMITS, TEAM_NAMES,
} from './words.js';
export type { DeliveryMode, InboxMode, StartMode } from './words.js';
export type {
  Extensions, MemberFile, RelayMap, RelayRoute, Team, TeamFile, TeamGuardrails, TeamLimits, TeamLoadResult, TeamMember, TeamOptions,
} from './types.js';
export { bypassPointers, folderKey, namesBypass, normalizeFolder } from './scan.js';
export { validateTeam } from './validate.js';
export type { ValidateOptions } from './validate.js';
export { loadTeam } from './load.js';
export { scanFiles } from './validate.js';
export { applyTeamAdoption, planTeamAdoption } from './adopt.js';
export type {
  AdoptionAnswers, AdoptionApplyResult, AdoptionDefault, AdoptionHooks, AdoptionInput, AdoptionPlan, AdoptionQuestion, AdoptionWrite,
  MemberAnswer,
} from './adopt.js';
export { DELIVERY_TABLE, START_TABLE, atLeast, billingOf, isVersion } from './engines.js';
export type { Billing, DeliveryRow, StartRow } from './engines.js';
export { planTeamStart } from './start.js';
export type {
  Delivery, DeliveryLine, RelaySummary, StartCommand, StartHarness, StartInput, StartMember, StartPlan, StartPlanResult,
} from './start.js';
