/** The skills manifest of the Bowerloom 0.7.0 beta (build plan 01, M3): `.bowerloom/skills.json`, `skills add` and `skills check`. */
export { MANIFEST_FORMAT, MANIFEST_FILE, MANIFEST_LIMITS, STORE_MANIFEST_LIMITS, parseManifest, serializeManifest, validateManifest, validateEntry, isExactVersion, isCommit, isEntryId } from './schema.js';
export type { ManifestLimits, Manifest, Entry, NpmEntry, GitEntry, LocalEntry, PinnedEntry, PinnedContent, NpmSource, GitSource, LocalSource } from './schema.js';
export { ENGINE_IDS, ENGINE_NAMES, WRITER_ENGINE_IDS, DEFAULT_ENGINES, EngineWriterRefusal, isEngine, isWriterEngine, isEngineWriterRefusal, parseEngineId, engineFromOldId, oldIdOf, oldIdOfWriter, writerEngines } from './engine.js';
export type { Engine, WriterEngine, OldEngineId } from './engine.js';
export { toNpmRequest, toGitRequest } from './requests.js';
export { parseSkillSpec } from './spec.js';
export type { SkillSpec, NpmSpec, GitSpec } from './spec.js';
export { createPublicTransport, PUBLIC_HOSTS, PUBLIC_GET_LIMITS } from './public-get.js';
export type { PublicTransport } from './public-get.js';
export { resolveNpm } from './resolve-npm.js';
export { resolveGit } from './resolve-git.js';
export { addLocalEntry, planManifestChange, applyManifestChange, readManifestState, projectTarget, storeTarget, MANIFEST_CHANGE_FORMAT, MANIFEST_PATH, STORE_MANIFEST_PATH } from './add.js';
export type { ManifestChangePlan, ManifestChangeReceipt, ManifestTarget } from './add.js';
export { checkManifest, pinOf, MANIFEST_CHECK_FORMAT } from './check.js';
export type { ManifestCheck } from './check.js';
export { manifestRefusal, isManifestRefusal, MANIFEST_REFUSAL_CODES } from './refusal.js';
export type { ManifestRefusalCode } from './refusal.js';
export { GithubToken, GITHUB_TOKEN_VARIABLE } from './github-token.js';
