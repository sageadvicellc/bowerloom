/**
 * The project config of the Bowerloom 0.7.0 beta: the file `bowerloom.json`, its strict parser, and a reader.
 * Spec 06 adds the resolver and the writer.
 */
export { CONFIG_FILE, CONFIG_FORMAT, CONFIG_LIMITS, isStorePromptId, isStoreSkillId, isStoreTeamId, parseConfig, serializeConfig, validateConfig } from './schema.js';
export type { ConfigEntry, ConfigKind, ConfigSource, ProjectConfig } from './schema.js';
export { readConfig } from './config.js';
export type { ConfigRead } from './config.js';
export { CONFIG_REFUSAL_CODES, configRefusal, isConfigRefusal, refusalWithNext } from './refusal.js';
export type { ConfigRefusalCode } from './refusal.js';
export { STORE_BRIEF, storeBrief } from './brief.js';
export { LOCK_FILE, LOCK_FORMAT, LOCK_LIMITS, LOCK_LISTS, LOCK_REMOTES, lockAgrees, lockItem, lockPairs, lockSourceLabel, parseLock, readLock, readLockBytes, serializeLock, storePairs } from './lock.js';
export type { AuthoredPin, LockItem, LockKind, LockRead, ProjectLock } from './lock.js';
export { isSharedProject, hasOriginUrl, unknownSharedNote } from './shared.js';
export type { SharedProject } from './shared.js';
export { normalizeRemote, readStoreRepo } from './git.js';
export type { StoreRepo, StoreRepoProblem } from './git.js';
export { currentSha256, scratchName, writeGuardedFile } from './write.js';
export type { GuardedWrite } from './write.js';
export { NOT_SHAREABLE, lockMismatch, notShareable, MIGRATE_REASON, migrateUnsupported, migrateTeamMissing } from './refusal.js';
export type { NotShareableCause } from './refusal.js';
