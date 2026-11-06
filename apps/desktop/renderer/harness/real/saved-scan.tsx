/**
 * What the window knows of the kept read (the last read, saved on this computer). At launch, before the first screen is drawn, it asks main for the kept read. A kept read that passes is
 * turned into the same screens a live read gives (`realToHarnessState`) and the window opens on the Read screen, with no folder read. Then it asks main, once, whether the folders
 * changed. A kept read that is missing starts the app as it always started; one that is damaged does the same and says so in plain words on the first screen.
 *
 * The state is a small pure machine (`savedReduce`) so each case is held by a test with no screen. A check that answers after a newer read is dropped, so a note never belongs to a read
 * other than the one on the screen.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { realToHarnessState } from '../../../shared/harness/real-map.js';
import type { EngineBridge } from '../../../shared/engine/types.js';
import type { SavedScanAnswer } from '../../../shared/real/saved-scan.js';
import { parseRoute } from '../../../shared/harness/route.js';
import { go } from '../router.js';
import { useUi } from '../ui.js';

export interface SavedScanState {
  /** When the read on the screen ended, or null when no read has been made or kept. */
  readonly readAtMs: number | null;
  /** True when the read on the screen was the kept one, not one made in this window. */
  readonly fromSaved: boolean;
  /** The check of the folders is running. */
  readonly checking: boolean;
  /** The check found that a folder changed since the read. */
  readonly changed: boolean;
  /** A kept read was there but could not be used. */
  readonly damaged: boolean;
}

export type SavedAction =
  | { readonly type: 'saved'; readonly atMs: number }
  | { readonly type: 'damaged' }
  | { readonly type: 'unusable' }
  | { readonly type: 'none' }
  | { readonly type: 'checked'; readonly forAtMs: number; readonly changed: boolean }
  | { readonly type: 'read'; readonly atMs: number };

export const firstSaved = (): SavedScanState => ({ readAtMs: null, fromSaved: false, checking: false, changed: false, damaged: false });

/** The action for what main answered at launch. */
export const startFromAnswer = (answer: SavedScanAnswer): SavedAction => (answer.status === 'saved' ? { type: 'saved', atMs: answer.savedAtMs } : answer.status === 'damaged' ? { type: 'damaged' } : { type: 'none' });

export function savedReduce(state: SavedScanState, action: SavedAction): SavedScanState {
  switch (action.type) {
    case 'saved': return { readAtMs: action.atMs, fromSaved: true, checking: true, changed: false, damaged: false };
    case 'damaged': case 'unusable': return { ...firstSaved(), damaged: true };
    case 'none': return firstSaved();
    case 'checked': return state.readAtMs === action.forAtMs && state.fromSaved ? { ...state, checking: false, changed: action.changed } : state;
    case 'read': return { readAtMs: action.atMs, fromSaved: false, checking: false, changed: false, damaged: false };
  }
}

export interface SavedScanValue extends SavedScanState {
  /** Goes to the first question again: the folders are looked at, the person ticks and answers, and the read is made anew. */
  readAgain(): void;
  /** A read ended in this window at this time. */
  markRead(atMs: number): void;
}

const NOTHING: SavedScanValue = { ...firstSaved(), readAgain: () => undefined, markRead: () => undefined };
export const SavedScanContext = createContext<SavedScanValue>(NOTHING);
export const useSavedScan = (): SavedScanValue => useContext(SavedScanContext);

/** Whether the bridge has the two calls of the kept read (a bridge of an older build, or a test's, may not). */
const canAsk = (engine: EngineBridge | null): engine is EngineBridge => engine !== null && typeof engine.savedScan === 'function' && typeof engine.checkSavedScan === 'function';

export function SavedScanProvider({ engine, children }: { engine: EngineBridge | null; children?: ReactNode }): ReactElement {
  const ui = useUi();
  const [state, dispatch] = useReducer(savedReduce, undefined, firstSaved);
  // Asking main is quick (it reads one file). Until it answers nothing is drawn, so the first screen is the right one.
  const [ready, setReady] = useState(!canAsk(engine));
  const asked = useRef(false), live = useRef(true), uiNow = useRef(ui);
  uiNow.current = ui;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (asked.current || !canAsk(engine)) return;
    asked.current = true;
    const finish = (action: SavedAction): void => { if (live.current) { dispatch(action); setReady(true); } };
    engine.savedScan().then(answer => {
      if (answer.status !== 'saved') { finish(startFromAnswer(answer)); return; }
      let next;
      // The same mapping a live read goes through. A kept read it cannot map is dropped as damaged, and nothing is loaded.
      try { next = realToHarnessState(answer.result, answer.chosen); } catch (error) { console.error('The saved read could not be drawn.', error); finish({ type: 'unusable' }); return; }
      if (!live.current) return;
      uiNow.current.replaceWorld(next);
      finish(startFromAnswer(answer));
      // The first screen of a launch is the Welcome; with a read to show, the window opens on the Read screen. An address the person came back to is left where it is.
      const here = parseRoute(location.hash);
      if (here === null || here.name === 'welcome') go({ name: 'read' });
      engine.checkSavedScan().then(
        verdict => { if (live.current) dispatch({ type: 'checked', forAtMs: answer.savedAtMs, changed: verdict === 'changed' }); },
        () => { if (live.current) dispatch({ type: 'checked', forAtMs: answer.savedAtMs, changed: true }); },
      );
    }, (error: unknown) => { console.error('The saved read could not be asked for.', error); finish({ type: 'none' }); });
  }, [engine]);
  const readAgain = useCallback((): void => go({ name: 'choose' }), []);
  const markRead = useCallback((atMs: number): void => dispatch({ type: 'read', atMs }), []);
  const value = useMemo<SavedScanValue>(() => ({ ...state, readAgain, markRead }), [state, readAgain, markRead]);
  return <SavedScanContext value={value}>{ready ? children : null}</SavedScanContext>;
}
