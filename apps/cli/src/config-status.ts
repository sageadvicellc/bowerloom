import type { ConfigRead } from '../../../packages/project-config/src/index.js';

/** The `config` object of the status JSON, or null for a project with no bowerloom.json. */
export function configObject(read: ConfigRead): Record<string, unknown> | null {
  if (read.state === 'absent') return null;
  const base = { path: 'bowerloom.json', sha256: read.sha256, bytes: read.bytes };
  return read.state === 'valid'
    ? { ...base, state: 'valid', code: null, harnesses: [...read.config.harnesses], counts: { skills: read.config.skills.length, prompts: read.config.prompts.length, teams: read.config.teams.length } }
    : { ...base, state: 'invalid', code: read.code, harnesses: [], counts: { skills: 0, prompts: 0, teams: 0 } };
}
export const configLine = (read: ConfigRead): string[] => read.state === 'absent' ? []
  : [read.state === 'valid' ? `Config: bowerloom.json (${read.config.skills.length} skills, ${read.config.prompts.length} prompts, ${read.config.teams.length} teams)` : `Config: bowerloom.json (invalid, ${read.code})`];
