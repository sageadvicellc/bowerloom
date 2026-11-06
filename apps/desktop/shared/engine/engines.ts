/**
 * The engines of Bowerloom 0.8, in the order the packages list them. The list, the preview list, and the test are the harness definition core's own
 * (packages/harness-definition/src/words.ts, a file with no imports), so the app cannot drift from the packages. Beta.1 supports Claude Code and Codex;
 * OpenCode, Pi, and DeepSeek Harness are preview engines, and the app installs to them only when its main process runs with BOWERLOOM_PREVIEW_ENGINES=1.
 * The bridge does not import this file: it stays free of packages (shared/engine/types.ts).
 */
export { ENGINE_IDS, PREVIEW_ENGINE_IDS, isEngineId, isPreviewEngine } from '../../../../packages/harness-definition/src/words.js';
