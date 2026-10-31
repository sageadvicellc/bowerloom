/**
 * The notes folders the person chose in this window, in memory only: the notes step (in the first run or in the Notes panel) adds each one, and the Notes panel
 * and the map show it as a card until it goes on an agent's shelf and is saved. A new launch starts with none. Bowerloom never reads a page of them.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { NotesView } from '../../../shared/engine/types.js';

export interface NotesSession {
  readonly chosen: readonly NotesView[];
  /** Adds a chosen folder, or puts its newer read in place of the old one (same id). */
  choose(view: NotesView): void;
}

const Context = createContext<NotesSession | null>(null);
const EMPTY: NotesSession = Object.freeze({ chosen: Object.freeze([]) as readonly NotesView[], choose: () => undefined });

export function NotesProvider({ children }: { children?: ReactNode }): ReactElement {
  const [chosen, setChosen] = useState<readonly NotesView[]>([]);
  const choose = useCallback((view: NotesView): void => setChosen(list => (list.some(v => v.id === view.id) ? list.map(v => (v.id === view.id ? view : v)) : [...list, view])), []);
  const value = useMemo<NotesSession>(() => ({ chosen, choose }), [chosen, choose]);
  return <Context value={value}>{children}</Context>;
}

/** The chosen notes. Outside a provider (a markup test) there are none, and choosing keeps nothing. */
export function useNotesSession(): NotesSession {
  return useContext(Context) ?? EMPTY;
}
