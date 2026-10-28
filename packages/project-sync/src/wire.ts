/**
 * The engines of a managed copy, as the stored records spell them. The requests, plans, journals, receipts and
 * catalogs of managed copies are hashed and survive a crash, so they keep the old spelling (`harnesses`, `claude`)
 * in step 0 of 0.8. project-sync plans with `WriterEngine` and maps at this edge, in both directions.
 */
import { engineFromOldId, oldIdOfWriter } from '../../skill-manifest/src/engine.js';
import type { OldEngineId, WriterEngine } from '../../skill-manifest/src/engine.js';

/** The engines as a managed request stores them. */
export const toWire = (engines: readonly WriterEngine[]): OldEngineId[] => engines.map(oldIdOfWriter);
/** The engines of a stored list. Only `claude` and `codex` are ever stored. Any other id throws, so a damaged record is never read as a smaller list. */
export const fromWire = (wire: readonly OldEngineId[]): WriterEngine[] => wire.map(id => {
  const engine = engineFromOldId(id);
  if (engine === undefined) throw new TypeError('A stored engine id is not claude or codex.');
  return engine;
});
