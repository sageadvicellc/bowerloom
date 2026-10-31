/** The sort control of the Library: the shell's sort menu with the Library's ways to put things in order, "Name", "Recently added" or (for things an agent can use) "Most used". */
import type { ReactElement } from 'react';
import type { LibrarySort } from '../../../shared/home/library-model.js';
import { SortMenu } from '../kit/SortMenu.js';
import { WORDS } from '../words.js';
import { LIBRARY_WORDS } from './library-words.js';

const CHOICES: readonly { readonly mode: LibrarySort; readonly label: string }[] = Object.freeze([
  { mode: 'name', label: LIBRARY_WORDS.label.byName },
  { mode: 'added', label: LIBRARY_WORDS.label.byAdded },
  { mode: 'used', label: LIBRARY_WORDS.label.byUsed },
]);

/** `withUsed` is false on the Agents tab: an agent is used by nothing, so "Most used" would say nothing there. */
export function LibrarySortMenu({ mode, onChange, withUsed = true }: { mode: LibrarySort; onChange(mode: LibrarySort): void; withUsed?: boolean }): ReactElement {
  return <SortMenu<LibrarySort> mode={mode} choices={CHOICES.filter(choice => withUsed || choice.mode !== 'used')} onChange={onChange} label={WORDS.label.sort} menuLabel={LIBRARY_WORDS.label.sortGroup} side="below" align="start" />;
}
