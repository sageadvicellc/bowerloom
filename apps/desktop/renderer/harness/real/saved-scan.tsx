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
import type { DamageWhy, SavedScanAnswer, SavedScanCheck } from '../../../shared/real/saved-scan.js';
import type { HarnessState } from '../../../shared/harness/types.js';
import { parseRoute } from '../../../shared/harness/route.js';
import { go } from '../router.js';
import { useUi } from '../ui.js';
import { damagedWords } from './words-real.js';

export interface SavedScanState {
  /** When the read on the screen ended, or null when no read has been made or kept. */
  readonly readAtMs: number | null;
  /** True when the read on the screen was the kept one, not one made in this window. */
  readonly fromSaved: boolean;
  /** The check of the folders is running. */
  readonly checking: boolean;
  /** The check found that a folder changed since the read. */
  readonly changed: boolean;
  /** The check could not be made to the end (a folder could not be found again, or it ran out of time). Never taken for "nothing changed". */
  readonly unchecked: boolean;
  /** A kept read was there but could not be used. */
  readonly damaged: boolean;
  /** Why, for the words (`damagedWords`). Null when nothing is damaged. */
  readonly damagedWhy: DamageWhy | null;
}

export type SavedAction =
  | { readonly type: 'saved'; readonly atMs: number }
  | { readonly type: 'damaged'; readonly why: DamageWhy }
  | { readonly type: 'unusable' }
  | { readonly type: 'none' }
  | { readonly type: 'checked'; readonly forAtMs: number; readonly verdict: SavedScanCheck }
  | { readonly type: 'read'; readonly atMs: number }
  /** Bowerloom wrote into a folder after this read (the Library's Add): the read on the screen is old. */
  | { readonly type: 'wrote' };

export const firstSaved = (): SavedScanState => ({ readAtMs: null, fromSaved: false, checking: false, changed: false, unchecked: false, damaged: false, damagedWhy: null });

/** The action for what main answered at launch. */
export const startFromAnswer = (answer: SavedScanAnswer): SavedAction => (answer.status === 'saved' ? { type: 'saved', atMs: answer.savedAtMs } : answer.status === 'damaged' ? { type: 'damaged', why: answer.why } : { type: 'none' });

export function savedReduce(state: SavedScanState, action: SavedAction): SavedScanState {
  switch (action.type) {
    case 'saved': return { readAtMs: action.atMs, fromSaved: true, checking: true, changed: false, unchecked: false, damaged: false, damagedWhy: null };
    case 'damaged': return { ...firstSaved(), damaged: true, damagedWhy: action.why };
    case 'unusable': return { ...firstSaved(), damaged: true, damagedWhy: 'bad-shape' };
    case 'none': return firstSaved();
    case 'checked': return state.readAtMs === action.forAtMs && state.fromSaved ? { ...state, checking: false, changed: state.changed || action.verdict === 'changed', unchecked: action.verdict === 'unchecked' } : state;
    case 'wrote': return state.readAtMs === null ? state : { ...state, changed: true };
    case 'read': return { readAtMs: action.atMs, fromSaved: false, checking: false, changed: false, unchecked: false, damaged: false, damagedWhy: null };
  }
}

export interface SavedScanValue extends SavedScanState {
  /** Goes to the first question again: the folders are looked at, the person ticks and answers, and the read is made anew. */
  readAgain(): void;
  /** A read ended in this window at this time. */
  markRead(atMs: number): void;
  /** Something was written into a folder after the read: the read on the screen is old. */
  markWrote(): void;
}

const NOTHING: SavedScanValue = { ...firstSaved(), readAgain: () => undefined, markRead: () => undefined, markWrote: () => undefined };
export const SavedScanContext = createContext<SavedScanValue>(NOTHING);
export const useSavedScan = (): SavedScanValue => useContext(SavedScanContext);

/** Whether the bridge has the two calls of the kept read (a bridge of an older build, or a test's, may not). */
const canAsk = (engine: EngineBridge | null): engine is EngineBridge => engine !== null && typeof engine.savedScan === 'function' && typeof engine.checkSavedScan === 'function';

/** What loading the kept read does to the window. A test gives made-up ones. */
export interface LoadHooks {
  dispatch(action: SavedAction): void;
  replaceWorld(next: HarnessState): void;
  /** The name of the screen the address names now, or null. */
  route(): string | null;
  goRead(): void;
  /** A short note drawn over any screen (the Welcome screen draws its own). */
  toast(text: string): void;
  /** The window may draw its first screen now. */
  ready(): void;
  /** False once the window has gone: nothing is done then. */
  isLive(): boolean;
}

/**
 * Asks main for the kept read and does what the answer says. A kept read that passes is drawn as a live read would be. A kept read that cannot be used, or a call that fails, is told as
 * damaged: on the Welcome screen as its note, on any other screen (an address the person came back to) as a short note over it, so it is never silent. The check follows a kept read.
 */
export async function loadSaved(engine: EngineBridge, h: LoadHooks): Promise<void> {
  const damaged = (action: SavedAction): void => {
    if (!h.isLive()) return;
    h.dispatch(action);
    const here = h.route();
    if (here !== null && here !== 'welcome') h.toast(damagedWords(action.type === 'damaged' ? action.why : 'bad-shape'));
    h.ready();
  };
  let answer: SavedScanAnswer;
  try { answer = await engine.savedScan(); } catch (error) { console.error('The saved read could not be asked for.', error); damaged({ type: 'damaged', why: 'unreadable' }); return; }
  if (!h.isLive()) return;
  if (answer.status === 'damaged') { damaged({ type: 'damaged', why: answer.why }); return; }
  if (answer.status === 'none') { h.dispatch({ type: 'none' }); h.ready(); return; }
  let next: HarnessState;
  // The same mapping a live read goes through. A kept read it cannot map is dropped as damaged, and nothing is loaded.
  try { next = realToHarnessState(answer.result, answer.chosen); } catch (error) { console.error('The saved read could not be drawn.', error); damaged({ type: 'unusable' }); return; }
  h.replaceWorld(next);
  h.dispatch(startFromAnswer(answer));
  h.ready();
  // The first screen of a launch is the Welcome; with a read to show, the window opens on the Read screen. An address the person came back to is left where it is.
  const here = h.route();
  if (here === null || here === 'welcome') h.goRead();
  let verdict: SavedScanCheck;
  try { verdict = await engine.checkSavedScan(); } catch { verdict = 'unchecked'; }
  if (h.isLive()) h.dispatch({ type: 'checked', forAtMs: answer.savedAtMs, verdict });
}

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
    void loadSaved(engine, {
      dispatch, replaceWorld: next => uiNow.current.replaceWorld(next), route: () => parseRoute(location.hash)?.name ?? null, goRead: () => go({ name: 'read' }),
      toast: text => uiNow.current.showToast(text), ready: () => setReady(true), isLive: () => live.current,
    });
  }, [engine]);
  const readAgain = useCallback((): void => go({ name: 'choose' }), []);
  const markRead = useCallback((atMs: number): void => dispatch({ type: 'read', atMs }), []);
  const markWrote = useCallback((): void => dispatch({ type: 'wrote' }), []);
  const value = useMemo<SavedScanValue>(() => ({ ...state, readAgain, markRead, markWrote }), [state, readAgain, markRead, markWrote]);
  return <SavedScanContext value={value}>{ready ? children : null}</SavedScanContext>;
}
