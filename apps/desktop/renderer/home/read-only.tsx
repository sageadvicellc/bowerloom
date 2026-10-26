/**
 * Read-only mode. The home app can be opened to look at a setup without any way to change it (`#prototype-v2/map/readonly`, `#prototype-v2/readonly`), for testing a
 * real setup. `ReadOnlyScope` does two things. It tells every screen below it (`useReadOnly`), so each control that would change the setup is shown but held back: it
 * keeps its place and its Tab stop, says `aria-disabled`, gives the reason in its tooltip ("Read-only: your setup is not changed."), and does nothing when it is pressed.
 * And it hands the screens a store whose `dispatch` is empty, so even a control that was forgotten, a key (Ctrl+Z) or a drag cannot change anything: the state and the
 * count of versions never move. Looking still works: picking, details, trays, Library tabs and filters, the version history list, "Look inside", and "Create share file",
 * which builds its file in memory and writes nothing. `EditButton` and `EditIconButton` are the two buttons that every edit control uses.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Store } from '../../shared/proto/store.js';
import { ProtoProvider } from '../proto/session.js';
import { Button } from './kit/Button.js';
import type { ButtonProps } from './kit/Button.js';
import { IconButton } from './kit/IconButton.js';
import type { IconButtonProps } from './kit/IconButton.js';
import { Tooltip } from './kit/Tooltip.js';
import type { TipSide } from './kit/Tooltip.js';
import { WORDS } from './words.js';

/** The reason every held-back control gives, in its tooltip. */
export const READ_ONLY_REASON: string = WORDS.hint.readOnlyWhy;

/** Where the setup came from: the made-up sample, or the person's own files. */
export type DataSource = 'sample' | 'real';

const ReadOnlyContext = createContext(false);

/** True inside a read-only scope. The default is false: everything works as it always has. */
export const useReadOnly = (): boolean => useContext(ReadOnlyContext);

/** The same store with a `dispatch` that does nothing. */
export const guardedStore = (store: Store): Store => ({ getState: store.getState, subscribe: store.subscribe, dispatch: () => undefined });

export function ReadOnlyScope({ readOnly, store, children }: { readOnly: boolean; store: Store; children?: ReactNode }): ReactElement {
  const used = useMemo(() => (readOnly ? guardedStore(store) : store), [readOnly, store]);
  return <ReadOnlyContext.Provider value={readOnly}><ProtoProvider store={used}>{children}</ProtoProvider></ReadOnlyContext.Provider>;
}

/** Just the flag, for a test or a screen drawn on its own. */
export const ReadOnlyFlag = ReadOnlyContext.Provider;

/** A button that changes the setup. Read only, it is held back; otherwise it is the kit's Button. */
export function EditButton({ side = 'left', onClick, ...rest }: ButtonProps & { side?: TipSide }): ReactElement {
  const readOnly = useReadOnly();
  if (!readOnly) return <Button {...rest} {...(onClick === undefined ? {} : { onClick })} />;
  const { disabled: _disabled, type: _type, ...kept } = rest;
  return <Tooltip text={READ_ONLY_REASON} side={side}>{aria => <Button {...kept} aria-disabled="true" data-readonly="" {...aria} />}</Tooltip>;
}

/** An icon button that changes the setup. Read only, it is held back, and its tooltip gives the reason in place of its name. */
export function EditIconButton({ onClick, tip, ...rest }: IconButtonProps): ReactElement {
  const readOnly = useReadOnly();
  if (!readOnly) return <IconButton {...rest} {...(tip === undefined ? {} : { tip })} {...(onClick === undefined ? {} : { onClick })} />;
  const { disabled: _disabled, ...kept } = rest;
  return <IconButton {...kept} tip={READ_ONLY_REASON} aria-disabled="true" data-readonly="" />;
}
