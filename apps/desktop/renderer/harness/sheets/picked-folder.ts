/**
 * Which folder a sheet picks when it opens. A folder that was asked for stays picked, even when the sheet cannot use it (it may have gained a harness since): the sheet then says
 * why, and never swaps in another folder. A folder that main no longer lists is gone: nothing is picked, and `goneRefusal` says so in words.
 */
import type { FolderInfo, Refusal } from '../../../shared/engine/types.js';
import { callRefusal } from './call-lanes.js';

export function pickRequested(list: readonly FolderInfo[], wanted: string | null, usable: (folder: FolderInfo) => boolean): { id: string | null; gone: boolean } {
  if (wanted === null) return { id: list.find(usable)?.id ?? null, gone: false };
  return list.some(x => x.id === wanted) ? { id: wanted, gone: false } : { id: null, gone: true };
}

/** The refusal for a folder asked for that main no longer knows. */
export const goneRefusal = (): Refusal => callRefusal(new Error('UNKNOWN_FOLDER'));

/** The "gone" note after the chooser answers: a usable folder takes it away; a closed chooser, or a folder the sheet cannot take, leaves it as it was. */
export const goneAfterChoose = (gone: boolean, got: { readonly info: FolderInfo } | null, usable: (folder: FolderInfo) => boolean): boolean => (got !== null && usable(got.info) ? false : gone);
