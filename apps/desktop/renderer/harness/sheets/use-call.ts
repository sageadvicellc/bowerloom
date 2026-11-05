/**
 * The calls of a sheet to Bowerloom, in two lanes (ruling U1):
 *  - a plan: the newest wins. The answer of an older plan that arrives late is dropped, so the sheet never shows a plan for choices the person has since changed.
 *  - a write: it has its own lane, and no plan supersedes it. While a write runs, a plan does not start, and the sheet holds every choice (`writing`).
 *    The write's answer is always taken.
 * A call that the bridge refuses before it runs (a short code), or that throws, becomes a refusal with plain words. Each new refusal has a new `refusalId`,
 * so the sheet can move the focus to it (U9).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Answer, EngineBridge, FolderInfo, Refusal, VersionView } from '../../../shared/engine/types.js';
import { CallLanes, callRefusal } from './call-lanes.js';

export { callRefusal };

export interface Call {
  /** The words of the call that runs now, or null. */
  readonly busy: string | null;
  /** True while a write runs. The sheet holds every choice, tick and Back. */
  readonly writing: boolean;
  readonly refusal: Refusal | null;
  /** A new number for each refusal shown, so the sheet can focus it once. */
  readonly refusalId: number;
  /** Runs a plan. `onValue` runs only for the newest plan and only for a value. Refused at once (false) while a write runs. */
  plan<T>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean>;
  /** Runs a write in its own lane. Its answer is always taken. Refused at once (false) while another write runs. */
  write<T>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean>;
  /** Drops any plan in flight and the refusal shown. A running write stays. */
  clear(): void;
}

export function useCall(): Call {
  const [busy, setBusy] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [refusal, setRefusal] = useState<{ value: Refusal; id: number } | null>(null);
  const refusals = useRef(0);
  const lanes = useMemo(() => new CallLanes({
    busy: setBusy, writing: setWriting,
    refusal: r => { if (r === null) setRefusal(null); else { refusals.current += 1; setRefusal({ value: r, id: refusals.current }); } },
  }), []);
  const plan = useCallback(<T,>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean> => lanes.plan(words, call, onValue), [lanes]);
  const write = useCallback(<T,>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean> => lanes.write(words, call, onValue), [lanes]);
  const clear = useCallback((): void => lanes.clear(), [lanes]);
  return { busy, writing, refusal: refusal?.value ?? null, refusalId: refusal?.id ?? 0, plan, write, clear };
}

/**
 * The system folder chooser and the new folder list, as one call: a closed chooser is a value of null, not a refusal (U11). `expect` is the label of the folder the window
 * wants, when it wants one: main then refuses (NOT_THE_FOLDER_SHOWN) a pick with another label before it registers that folder, so a folder the window did not accept never
 * gets an id and never appears in the list. Without it, any folder is taken.
 */
export async function chooseFolderCall(engine: EngineBridge, expect?: string): Promise<Answer<{ info: FolderInfo; list: readonly FolderInfo[] } | null>> {
  const answer = expect === undefined ? await engine.chooseFolder() : await engine.chooseFolder(expect);
  if (answer === null) return { ok: true, value: null };
  if (!answer.ok) return answer;
  return { ok: true, value: { info: answer.value, list: await engine.folders() } };
}

/**
 * The chooser for one place the screen shows (the Overview): the label goes to main unless it is cut down (`…/name`, a place outside home). A pick that main refuses as not the
 * folder shown calls `onWrong` (the screen's own note) and is a closed chooser, not a failure: nothing was registered. Any other refusal passes on.
 */
export async function chooseWanted(engine: EngineBridge, label: string, onWrong: () => void): Promise<Answer<{ info: FolderInfo; list: readonly FolderInfo[] } | null>> {
  const answer = await chooseFolderCall(engine, label.startsWith('…') ? undefined : label);
  if (!answer.ok && answer.refusal.code === 'NOT_THE_FOLDER_SHOWN') { onWrong(); return { ok: true, value: null }; }
  return answer;
}

/** The folder list as one call, so a failure is a refusal and never an empty list (U11). */
export async function foldersCall(engine: EngineBridge): Promise<Answer<readonly FolderInfo[]>> {
  return { ok: true, value: await engine.folders() };
}

/**
 * The save points of a folder as one answer: a read that throws is a refusal in words, so a save point record that cannot be read never undoes a plan or a
 * set-aside that worked. The caller shows it as the save points' own failure.
 */
export async function versionsCall(engine: EngineBridge, id: string): Promise<Answer<readonly VersionView[]>> {
  try { return await engine.listVersions(id); } catch (error) { return { ok: false, refusal: callRefusal(error) }; }
}
