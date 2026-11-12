/**
 * The shape rules of the arguments of the `bowerloomModules` calls (shared/api/modules.ts names the calls). Main checks every argument with these before it acts on it. Pure functions: no Electron and no Node module.
 * The preload does not load this file: it only forwards what the page passes, and main refuses a bad shape. These checks say only that a value has the shape of an id or a path. Whether a module may read a place is
 * decided by packages/module-scope, and by nothing in the page.
 */
import { MODULE_PATH_LIMIT, MODULE_REFUSAL_CODES } from './modules.js';
import type { ModuleRefusalCode } from './modules.js';

const MODULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLACE_ID = /^place-[0-9a-f]{12}$/;

export const isModuleId = (value: unknown): value is string => typeof value === 'string' && MODULE_ID.test(value);
export const isPlaceId = (value: unknown): value is string => typeof value === 'string' && PLACE_ID.test(value);
/** A relative path as text: not empty, not over the limit, no NUL. Whether it is plain and stays in the place is decided by the package. */
/** A lone surrogate is not text: it is half of a pair. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
export const isPathText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MODULE_PATH_LIMIT && !value.includes('\0') && !LONE_SURROGATE.test(value);

/** The short code in an error from a modules call, or 'FAILED'. The same rule as `modulesCodeOf` of the client (renderer/api/client.ts), here so a screen can read a code without reaching the client. */
const CODE_PATTERN = new RegExp(`\\b(${MODULE_REFUSAL_CODES.filter(c => c !== 'FAILED').join('|')})\\b`);
export function modulesCode(error: unknown): ModuleRefusalCode {
  const found = String(error instanceof Error ? error.message : error).match(CODE_PATTERN);
  return found === null ? 'FAILED' : (found[1] as ModuleRefusalCode);
}
