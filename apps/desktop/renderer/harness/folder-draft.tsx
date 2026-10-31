/**
 * The drafts of the folders' harnesses, held once for the window and keyed by folder. The Builder and the save sheet read and change the same draft of a
 * folder, so the sheet's review is the review of what the Builder drew. Each folder keeps:
 *  - `base`: its harness as main read it (`planSave(id, [])`), or null before a read and after a save, so the next view reads it again;
 *  - `versions`: its save points as main listed them, or null before a read;
 *  - `stack`: its unsaved changes, as a bounded undo stack of drafts (shared/harness/draft-undo.ts);
 *  - `positions`: where the person moved each node of its graph. Kept in memory for the session, never saved.
 * `save-draft.ts` stays the only reducer of a draft; this file only keeps the drafts. A draft is never kept on a harness it was not made on: a read whose
 * harness differs from the base starts the draft again. Nothing here calls main.
 */
import { createContext, useCallback, useContext, useMemo, useReducer } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Answer, DefinitionView, VersionView } from '../../shared/engine/types.js';
import { draftCount } from '../../shared/harness/save-draft.js';
import type { SaveDraft } from '../../shared/harness/save-draft.js';
import { canRedo, canUndo, pushDraft, redoDraft, resetDraft, startDraft, undoCount, undoDraft } from '../../shared/harness/draft-undo.js';
import type { DraftStack } from '../../shared/harness/draft-undo.js';
import type { Point } from '../../shared/harness/types.js';

export interface FolderEntry {
  readonly base: DefinitionView | null;
  readonly versions: Answer<readonly VersionView[]> | null;
  readonly stack: DraftStack;
  readonly positions: Readonly<Record<string, Point>>;
}
export type FolderDrafts = Readonly<Record<string, FolderEntry>>;

/** A folder not read yet: no base, no save points, an empty draft, no node moved. */
export const EMPTY_FOLDER: FolderEntry = Object.freeze({ base: null, versions: null, stack: startDraft(), positions: Object.freeze({}) });

export type FolderDraftAction =
  /** Main read the folder's harness and its save points. */
  | { readonly kind: 'loaded'; readonly folder: string; readonly base: DefinitionView; readonly versions: Answer<readonly VersionView[]> | null }
  | { readonly kind: 'versions'; readonly folder: string; readonly versions: Answer<readonly VersionView[]> }
  /** A change made with a save-draft function, from the draft now. */
  | { readonly kind: 'change'; readonly folder: string; next(draft: SaveDraft): SaveDraft }
  /** A draft made already: a Builder gesture's, or the Notes keeper added from an answer. */
  | { readonly kind: 'push'; readonly folder: string; readonly draft: SaveDraft }
  | { readonly kind: 'undo' | 'redo' | 'discard' | 'saved'; readonly folder: string }
  | { readonly kind: 'move'; readonly folder: string; readonly node: string; readonly at: Point };

const sameHarness = (a: DefinitionView, b: DefinitionView): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
/** True when reading `base` for a folder starts its draft again with changes in it: the harness is not the one the draft was made on. */
export const loadDropsDraft = (entry: FolderEntry, base: DefinitionView): boolean =>
  entry.base !== null && !sameHarness(entry.base, base) && draftCount(entry.base, entry.stack.present) > 0;
const put = (s: FolderDrafts, folder: string, entry: FolderEntry): FolderDrafts => ({ ...s, [folder]: entry });
/** The folder's own entry, or undefined. A name like `__proto__` or `constructor` never reaches the prototype's property. */
export const entryOf = (s: FolderDrafts, folder: string): FolderEntry | undefined => (Object.hasOwn(s, folder) ? s[folder] : undefined);
/** The stack after a step: the same state when the stack did not change, so React draws nothing. */
const withStack = (s: FolderDrafts, folder: string, entry: FolderEntry, stack: DraftStack): FolderDrafts => (stack === entry.stack ? s : put(s, folder, { ...entry, stack }));

/** The next drafts of the folders. A change, an undo or a discard of a folder not read yet changes nothing. */
export function folderDraftsReduce(s: FolderDrafts, a: FolderDraftAction): FolderDrafts {
  const entry = entryOf(s, a.folder);
  switch (a.kind) {
    case 'loaded': {
      const was = entry ?? EMPTY_FOLDER;
      const keep = was.base !== null && sameHarness(was.base, a.base);
      return put(s, a.folder, { ...was, base: a.base, versions: a.versions, stack: keep ? was.stack : resetDraft(was.stack) });
    }
    case 'versions': return entry === undefined ? s : put(s, a.folder, { ...entry, versions: a.versions });
    case 'move': {
      const was = entry ?? EMPTY_FOLDER;
      return put(s, a.folder, { ...was, positions: { ...was.positions, [a.node]: a.at } });
    }
    case 'saved': return entry === undefined ? s : put(s, a.folder, { ...entry, base: null, stack: resetDraft(entry.stack) });
    default: break;
  }
  if (entry === undefined || entry.base === null) return s;
  switch (a.kind) {
    case 'change': return withStack(s, a.folder, entry, pushDraft(entry.stack, a.next(entry.stack.present)));
    case 'push': return withStack(s, a.folder, entry, pushDraft(entry.stack, a.draft));
    case 'undo': return withStack(s, a.folder, entry, undoDraft(entry.stack));
    case 'redo': return withStack(s, a.folder, entry, redoDraft(entry.stack));
    case 'discard': return withStack(s, a.folder, entry, entry.stack.past.length === 0 && entry.stack.future.length === 0 && draftCount(entry.base, entry.stack.present) === 0 ? entry.stack : resetDraft(entry.stack));
  }
}

interface Value { readonly drafts: FolderDrafts; dispatch(a: FolderDraftAction): void }
const Context = createContext<Value | null>(null);

/** Holds the drafts of every folder for the window. `initial` is for a markup test. */
export function FolderDraftProvider({ initial = {}, children }: { initial?: FolderDrafts; children?: ReactNode }): ReactElement {
  const [drafts, dispatch] = useReducer(folderDraftsReduce, initial);
  const value = useMemo<Value>(() => ({ drafts, dispatch }), [drafts]);
  return <Context value={value}>{children}</Context>;
}

/** One folder's draft and the calls that change it. With no folder (null), every call does nothing. */
export interface FolderDraft {
  readonly entry: FolderEntry;
  readonly draft: SaveDraft;
  /** How many edits the draft holds now: the count the save bar shows and "Discard N changes?" asks about. */
  readonly count: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoCount: number;
  loaded(base: DefinitionView, versions: Answer<readonly VersionView[]> | null): void;
  setVersions(versions: Answer<readonly VersionView[]>): void;
  change(next: (draft: SaveDraft) => SaveDraft): void;
  push(draft: SaveDraft): void;
  undo(): void;
  redo(): void;
  discard(): void;
  saved(): void;
  move(node: string, at: Point): void;
}

/** Every folder's draft, and the dispatch, for a sheet that plans a folder other than the one it draws (the save sheet opened on its review step). */
export function useFolderDrafts(): { readonly drafts: FolderDrafts; dispatch(a: FolderDraftAction): void } {
  const ctx = useContext(Context);
  if (ctx === null) throw new Error('The folder drafts are missing. Draw the screen inside FolderDraftProvider.');
  return ctx;
}

export function useFolderDraft(folder: string | null): FolderDraft {
  const ctx = useContext(Context);
  if (ctx === null) throw new Error('The folder drafts are missing. Draw the screen inside FolderDraftProvider.');
  const { drafts, dispatch } = ctx;
  const entry = folder === null ? EMPTY_FOLDER : entryOf(drafts, folder) ?? EMPTY_FOLDER;
  const send = useCallback((a: FolderDraftAction): void => { if (folder !== null) dispatch(a); }, [folder, dispatch]);
  return useMemo<FolderDraft>(() => {
    const f = folder ?? '';
    return {
      entry, draft: entry.stack.present, count: entry.base === null ? 0 : draftCount(entry.base, entry.stack.present),
      canUndo: canUndo(entry.stack), canRedo: canRedo(entry.stack), undoCount: undoCount(entry.stack),
      loaded: (base, versions) => send({ kind: 'loaded', folder: f, base, versions }),
      setVersions: versions => send({ kind: 'versions', folder: f, versions }),
      change: next => send({ kind: 'change', folder: f, next }),
      push: draft => send({ kind: 'push', folder: f, draft }),
      undo: () => send({ kind: 'undo', folder: f }), redo: () => send({ kind: 'redo', folder: f }),
      discard: () => send({ kind: 'discard', folder: f }), saved: () => send({ kind: 'saved', folder: f }),
      move: (node, at) => send({ kind: 'move', folder: f, node, at }),
    };
  }, [entry, folder, send]);
}
