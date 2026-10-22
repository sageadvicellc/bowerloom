/**
 * The fixed refusals of `bowerloom.json`. Internal to packages/project-config.
 * CONFIG_UNSAFE lives with the guards that raise it, in packages/project-context/src/refusal.ts.
 * A message never carries a path. CONFIG_DUPLICATE_ID names the kind and the id, which are plain words of at most 64 characters.
 */
import { DefinitionError } from '../../contracts/src/index.js';

const MESSAGES = {
  CONFIG_INVALID: 'bowerloom.json does not match the project config format.',
  CONFIG_LIMIT: 'bowerloom.json lists too many items.',
  CONFIG_DUPLICATE_ID: 'bowerloom.json lists an item twice.',
} as const;

export type ConfigRefusalCode = keyof typeof MESSAGES;
export const CONFIG_REFUSAL_CODES: readonly ConfigRefusalCode[] = Object.freeze(Object.keys(MESSAGES) as ConfigRefusalCode[]);
/** The refusal for `code`. `message` replaces the fixed one only for CONFIG_DUPLICATE_ID, which names the item. */
export const configRefusal = (code: ConfigRefusalCode, message?: string): DefinitionError =>
  new DefinitionError(code, code === 'CONFIG_DUPLICATE_ID' && message !== undefined ? message : MESSAGES[code]);
export function refuse(code: ConfigRefusalCode, message?: string): never { throw configRefusal(code, message); }
export const isConfigRefusal = (error: unknown): error is DefinitionError & { code: ConfigRefusalCode } =>
  error instanceof DefinitionError && (CONFIG_REFUSAL_CODES as readonly string[]).includes(error.code);
