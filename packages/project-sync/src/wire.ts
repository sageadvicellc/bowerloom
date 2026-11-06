/**
 * The engines of a managed copy, as the stored records spell them. The requests, plans, journals, receipts and
 * catalogs of managed copies are hashed and survive a crash, so they keep the old spelling (`harnesses`, `claude`)
 * in step 0 of 0.8. project-sync plans with `WriterEngine` and maps at this edge, in both directions.
 */
import { engineFromOldId, oldIdOfWriter } from '../../skill-manifest/src/engine.js';
import type { OldEngineId, WriterEngine } from '../../skill-manifest/src/engine.js';
import { syncError } from './refusal.js';
import type { SyncCode } from './refusal.js';

/** The engines as a managed request stores them. */
export const toWire = (engines: readonly WriterEngine[]): OldEngineId[] => engines.map(oldIdOfWriter);
/**
 * The engines of a stored list. Only `claude` and `codex` are ever stored. Any other id is a damaged record: it is a coded
 * refusal that names the record and, when the id is short plain text, the id. It is never read as a smaller list.
 */
export function fromWire(wire: readonly OldEngineId[], record: string, code: SyncCode = 'MANAGED_SKILL_REFUSED'): WriterEngine[] {
  const list: readonly unknown[] = Array.isArray(wire) ? wire : [undefined];
  return list.map(id => {
    const engine = engineFromOldId(id);
    if (engine === undefined) {
      const shown = typeof id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(id) ? `the engine "${id}"` : 'an id that is not plain text';
      throw syncError(code, `${record} names ${shown}, and only claude and codex are stored. Nothing was changed.`);
    }
    return engine;
  });
}
