/**
 * The state of the list above the Save bar: whether it is open, the rows (worked out only while it is open), and what one row's Undo does. Both pages that
 * carry a Save bar use it, so the list works the same on the map, on the Library page and on the Library test page.
 */
import { useEffect, useMemo, useState } from 'react';
import type { StoreAction, StoreState } from '../../../shared/world/store.js';
import { changeEntries } from '../../../shared/home/change-undo.js';
import type { ChangeEntry } from '../../../shared/home/change-undo.js';

export interface ChangeList { readonly open: boolean; setOpen(open: boolean): void; readonly entries: readonly ChangeEntry[]; undo(entry: ChangeEntry): void }

/** `listable` is true when the bar says "N changes" (three or more, or two that do not fit a sentence): only then is there a list to open, so a list that is open when it stops being so closes. */
export function useChangeList(state: StoreState, listable: boolean, dispatch: (action: StoreAction) => void): ChangeList {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && !listable) setOpen(false); }, [open, listable]);
  const entries = useMemo(() => (open ? changeEntries(state) : []), [open, state]);
  const undo = (entry: ChangeEntry): void => { if (entry.undo !== null) dispatch({ type: 'withdraw', at: entry.undo.at }); };
  return { open, setOpen, entries, undo };
}
