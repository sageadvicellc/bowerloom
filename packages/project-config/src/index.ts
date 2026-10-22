/**
 * The project config of the Bowerloom 0.7.0 beta: the file `bowerloom.json`, its strict parser, and a reader.
 * Spec 06 adds the resolver and the writer.
 */
export { CONFIG_FILE, CONFIG_FORMAT, CONFIG_LIMITS, isStorePromptId, isStoreSkillId, isStoreTeamId, parseConfig, serializeConfig, validateConfig } from './schema.js';
export type { ConfigEntry, ConfigKind, ConfigSource, ProjectConfig } from './schema.js';
export { readConfig } from './config.js';
export type { ConfigRead } from './config.js';
export { CONFIG_REFUSAL_CODES, configRefusal, isConfigRefusal } from './refusal.js';
export type { ConfigRefusalCode } from './refusal.js';
