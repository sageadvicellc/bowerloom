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

import type { Resolved } from '../../../packages/project-sync/src/index.js';
import { lockPairs } from '../../../packages/project-config/src/index.js';
/** Spec 06, 3.20 and 4.6: the store, items, unselected and lock fields of the status `config` object. */
export function configAdditions(resolved: Resolved | null, read: ConfigRead, shared: boolean, lockError: string | null, lockFile: { state: string; code: string | null } | null = null): Record<string, unknown> {
  // `lockFile` is the lock as read beside an invalid config (review F4). A project with no config has no config object.
  void read;
  if (resolved === null) return { store: 'not-needed', storeCode: null, items: [], unselected: { skills: [], prompts: [], teams: [] }, lock: { state: lockError ? 'invalid' : lockFile?.state ?? 'not-used', code: lockError ?? lockFile?.code ?? null, sha256: null, bytes: null, items: 0, shared } };
  const store = resolved.storeCode !== null ? 'refused' : resolved.store.state === 'present' ? 'ok' : resolved.store.state;
  const items = (['skills', 'prompts', 'teams'] as const).flatMap(name => resolved[name].map(i => ({ kind: i.kind, id: i.id, source: i.origin, via: [...i.via], state: i.hold === null ? 'ok' : 'missing' })));
  const l = resolved.lock;
  return { store, storeCode: resolved.storeCode, items, unselected: resolved.unselected, lock: { state: l.state, code: l.code, sha256: l.sha256, bytes: l.bytes, items: resolved.lockValue ? lockPairs(resolved.lockValue).length : 0, shared } };
}
