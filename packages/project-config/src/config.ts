/** Reads `bowerloom.json` of a discovered project. Reads only; nothing here writes the file. */
import { createHash } from 'node:crypto';
import { readConfigBytes } from '../../project-context/src/index.js';
import type { ProjectContext } from '../../project-context/src/index.js';
import { configRefusal, isConfigRefusal } from './refusal.js';
import { parseConfig } from './schema.js';
import type { ProjectConfig } from './schema.js';

export type ConfigRead =
  | { state: 'absent' }
  | { state: 'valid'; config: ProjectConfig; sha256: string; bytes: number }
  | { state: 'invalid'; code: 'CONFIG_INVALID' | 'CONFIG_LIMIT' | 'CONFIG_DUPLICATE_ID'; sha256: string; bytes: number; detail?: string };

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
    if (isConfigRefusal(error) && (error.code === 'CONFIG_INVALID' || error.code === 'CONFIG_LIMIT' || error.code === 'CONFIG_DUPLICATE_ID')) {
      const detail = (error as { detail?: unknown }).detail;
      return { state: 'invalid', code: error.code, sha256, bytes: bytes.length, ...(typeof detail === 'string' ? { detail } : {}) };
    }
    throw error;
  }
}

/** The refusal for a config that did not read: its code, and the sentence that names the first bad engine id when there is one. */
export function invalidConfigRefusal(read: Extract<ConfigRead, { state: 'invalid' }>): ReturnType<typeof configRefusal> {
  return configRefusal(read.code, read.code === 'CONFIG_INVALID' ? read.detail : undefined);
}
