/**
 * What the screens share besides the harness world: which sheets are open (the install sheet and the start sheet are opened from several screens), the harness picked in the list,
 * the toast ("Installed. Undo"), and the shell (the details column and the navigation). All of it lives in memory.
 *
 * On the person's own folders (the state holds `real`) `openInstall` and `openStart` show the note "Not in this preview." and open nothing.
 * The next builders plug in here: `openInstall({ projectId, harnessId, step })` opens the install sheet at a step, `openStart({ harnessId, projectId })` opens the start sheet,
 * `showToast(text, action)` shows a note with one action, and `pickedHarnessId` is the harness the Harness list has selected.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { parseRoute } from '../../shared/harness/route.js';
import { routeGone } from '../../shared/harness/status.js';
import type { HarnessState, InterfaceId } from '../../shared/harness/types.js';
import { go } from './router.js';
import { useHarnessStore } from './session.js';
import { WORDS } from './words.js';

export type InstallStep = 'project' | 'interfaces' | 'review';

export interface InstallState {
  readonly open: boolean; readonly projectId: string | null; readonly harnessId: string | null; readonly step: InstallStep;
  /** The interfaces the sheet opens with ticked, or null for the default ones. */
  readonly interfaceIds: readonly InterfaceId[] | null;
}
export interface StartState { readonly open: boolean; readonly harnessId: string | null; readonly projectId: string | null }
/** The two sheets that reach the packages. `mode` says what the install sheet plans: an install, a removal, or the recovery of a stopped run. */
export type EngineSheetMode = 'install' | 'remove' | 'recover';
export interface AdoptState { readonly open: boolean; readonly folderId: string | null }
export interface ProjectSheetState { readonly open: boolean; readonly folderId: string | null; readonly mode: EngineSheetMode; readonly keep: readonly string[] }
/** The save sheet: one folder's own harness, edited as a draft until Save, with its save points (option C). */
export interface SaveSheetState { readonly open: boolean; readonly folderId: string | null }
export interface ToastState { readonly id: number; readonly text: string; readonly action: { readonly label: string; readonly run: () => void } | null }

export interface Ui {
  readonly install: InstallState;
  /**
   * Opens the install sheet. A step that is left out is the first step with something still to choose: "project" with no project, else "interfaces".
   * `interfaceIds` are the interfaces to tick (the Start sheet passes the ones the person ticked); left out, the sheet ticks the default ones.
   */
  openInstall(request?: { projectId?: string | null; harnessId?: string | null; step?: InstallStep; interfaceIds?: readonly InterfaceId[] | null }): void;
  setInstallStep(step: InstallStep): void;
  closeInstall(): void;
  readonly start: StartState;
  openStart(request: { harnessId: string; projectId?: string | null }): void;
  closeStart(): void;
  /** The adopt sheet ("New harness from a folder"). It opens in either launch: on the person's own folders it plans read-only and writes only after approval. */
  readonly adopt: AdoptState;
  openAdopt(request?: { folderId?: string | null }): void;
  closeAdopt(): void;
  /** The install sheet of a folder's own harness, with its removal and recovery. */
  readonly projectSheet: ProjectSheetState;
  openProject(request?: { folderId?: string | null; mode?: EngineSheetMode; keep?: readonly string[] }): void;
  closeProject(): void;
  /** The save sheet of a folder's own harness. It opens in either launch: on the person's own folders it plans read-only and writes only after approval. */
  readonly saveSheet: SaveSheetState;
  openSave(request?: { folderId?: string | null }): void;
  closeSave(): void;
  /** The harness the Harness list has selected, or null. */
  readonly pickedHarnessId: string | null;
  pickHarness(id: string | null): void;
  /**
   * Replaces the whole world (a real read, or the sample again) and clears what pointed into the old one: the picked harness, the note with its old Undo, the open sheets,
   * and an open address that names a harness, part, project or run the new world does not hold (it goes to the Harnesses list).
   */
  replaceWorld(next: HarnessState): void;
  readonly toast: ToastState | null;
  /** Shows a note at the foot of the window for a few seconds, with one optional action. The time stops while the pointer or the focus is on it. */
  showToast(text: string, action?: { label: string; run: () => void }): void;
  hideToast(): void;
  /** Stops the note's timer (true) or starts it again from the full time (false). The note calls it for hover and focus. */
  holdToast(held: boolean): void;
  /** The number of sheets that are open, so the shell knows a layer holds the page. */
  readonly layers: number;
  pushLayer(): () => void;
}

const Context = createContext<Ui | null>(null);

export const TOAST_MS = 8000;

export function UiProvider({ children }: { children?: ReactNode }): ReactElement {
  const harnessStore = useHarnessStore();
  const [install, setInstall] = useState<InstallState>({ open: false, projectId: null, harnessId: null, step: 'project', interfaceIds: null });
  const [start, setStart] = useState<StartState>({ open: false, harnessId: null, projectId: null });
  const [picked, setPicked] = useState<string | null>(null);
  const [adopt, setAdopt] = useState<AdoptState>({ open: false, folderId: null });
  const [projectSheet, setProjectSheet] = useState<ProjectSheetState>({ open: false, folderId: null, mode: 'install', keep: [] });
  const [saveSheet, setSaveSheet] = useState<SaveSheetState>({ open: false, folderId: null });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [layers, setLayers] = useState(0);
  const counter = useRef(0), timer = useRef<number | null>(null), held = useRef(false), shown = useRef(false);

  const stopTimer = useCallback((): void => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } }, []);
  const startTimer = useCallback((): void => {
    stopTimer();
    if (held.current) return;
    timer.current = window.setTimeout(() => { timer.current = null; shown.current = false; setToast(null); }, TOAST_MS);
  }, [stopTimer]);
  const hideToast = useCallback((): void => { stopTimer(); shown.current = false; setToast(null); }, [stopTimer]);
  const showToast = useCallback((text: string, action?: { label: string; run: () => void }): void => {
    counter.current += 1;
    shown.current = true;
    setToast({ id: counter.current, text, action: action === undefined ? null : { label: action.label, run: action.run } });
    startTimer();
  }, [startTimer]);
  const holdToast = useCallback((on: boolean): void => {
    held.current = on;
    if (on) stopTimer(); else if (shown.current) startTimer();
  }, [stopTimer, startTimer]);
  const pushLayer = useCallback((): (() => void) => { setLayers(n => n + 1); return () => setLayers(n => Math.max(0, n - 1)); }, []);

  const ui = useMemo<Ui>(() => ({
    install,
    openInstall: (request = {}) => {
      // On the person's own folders nothing can be installed in this preview: a note says so and no sheet opens.
      if (harnessStore.getState().real !== undefined) { showToast(WORDS.hint.previewOnly); return; }
      setInstall(current => {
        const projectId = request.projectId === undefined ? current.projectId : request.projectId, harnessId = request.harnessId === undefined ? current.harnessId : request.harnessId;
        return { open: true, projectId, harnessId, step: request.step ?? (projectId === null ? 'project' : 'interfaces'), interfaceIds: request.interfaceIds ?? null };
      });
    },
    setInstallStep: step => setInstall(current => ({ ...current, step })),
    closeInstall: () => setInstall(current => ({ ...current, open: false })),
    start,
    openStart: request => {
      if (harnessStore.getState().real !== undefined) { showToast(WORDS.hint.previewOnly); return; }
      setStart({ open: true, harnessId: request.harnessId, projectId: request.projectId ?? null });
    },
    closeStart: () => setStart(current => ({ ...current, open: false })),
    adopt,
    openAdopt: (request = {}) => setAdopt({ open: true, folderId: request.folderId ?? null }),
    closeAdopt: () => setAdopt(current => ({ ...current, open: false })),
    projectSheet,
    openProject: (request = {}) => setProjectSheet({ open: true, folderId: request.folderId ?? null, mode: request.mode ?? 'install', keep: request.keep ?? [] }),
    closeProject: () => setProjectSheet(current => ({ ...current, open: false })),
    saveSheet,
    openSave: (request = {}) => setSaveSheet({ open: true, folderId: request.folderId ?? null }),
    closeSave: () => setSaveSheet(current => ({ ...current, open: false })),
    pickedHarnessId: picked, pickHarness: setPicked,
    replaceWorld: next => {
      harnessStore.loadWorld(next);
      setPicked(null); hideToast();
      setInstall(current => ({ ...current, open: false, projectId: null, harnessId: null })); setStart(current => ({ ...current, open: false, projectId: null, harnessId: null }));
      const route = parseRoute(location.hash);
      if (route !== null && routeGone(harnessStore.getState(), route)) go({ name: 'harnesses' });
    },
    toast, showToast, hideToast, holdToast, layers, pushLayer,
  }), [install, start, adopt, projectSheet, saveSheet, picked, toast, showToast, hideToast, holdToast, layers, pushLayer, harnessStore]);
  return <Context value={ui}>{children}</Context>;
}

export function useUi(): Ui {
  const ui = useContext(Context);
  if (ui === null) throw new Error('The preview state is missing. Draw the screen inside UiProvider.');
  return ui;
}
