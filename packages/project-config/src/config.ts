/** Reads `bowerloom.json` of a discovered project. Reads only; nothing here writes the file. */
import { createHash } from 'node:crypto';
import { readConfigBytes } from '../../project-context/src/index.js';
import type { ProjectContext } from '../../project-context/src/index.js';
import { isConfigRefusal } from './refusal.js';
import type { ConfigRefusalCode } from './refusal.js';
import { parseConfig } from './schema.js';
import type { ProjectConfig } from './schema.js';

export type ConfigRead =
  | { state: 'absent' }
  | { state: 'valid'; config: ProjectConfig; sha256: string; bytes: number }
  | { state: 'invalid'; code: 'CONFIG_INVALID' | 'CONFIG_LIMIT' | 'CONFIG_DUPLICATE_ID'; sha256: string; bytes: number };

/**
 * Checks the project pins, checks the file with checkConfigFile, reads it through the open file it checked, checks the pins
 * again, then hashes and parses. A file that is missing gives `absent`. A file that parses badly gives `invalid` with its
 * code. Throws CONFIG_UNSAFE or PROJECT_UNSAFE only; those stop every command.
 */
export function readConfig(project: ProjectContext): ConfigRead {
  const bytes = readConfigBytes(project);
  if (bytes === null) return { state: 'absent' };
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try { return { state: 'valid', config: parseConfig(bytes), sha256, bytes: bytes.length }; }
  catch (error) {
    if (isConfigRefusal(error)) return { state: 'invalid', code: error.code satisfies ConfigRefusalCode, sha256, bytes: bytes.length };
    throw error;
  }
}
