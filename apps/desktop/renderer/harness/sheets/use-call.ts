/**
 * The calls of a sheet to Bowerloom, in two lanes (ruling U1):
 *  - a plan: the newest wins. The answer of an older plan that arrives late is dropped, so the sheet never shows a plan for choices the person has since changed.
 *  - a write: it has its own lane, and no plan supersedes it. While a write runs, a plan does not start, and the sheet holds every choice (`writing`).
 *    The write's answer is always taken.
 * A call that the bridge refuses before it runs (a short code), or that throws, becomes a refusal with plain words. Each new refusal has a new `refusalId`,
 * so the sheet can move the focus to it (U9).
 */
import { useCallback, useRef, useState } from 'react';
import type { Answer, EngineBridge, FolderInfo, Refusal } from '../../../shared/engine/types.js';
import { engineCodeOf } from '../real/engine-bridge.js';

const CALL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  NOT_ALLOWED: 'This window may not ask for that.',
  BAD_ARGUMENT: 'The sheet sent something Bowerloom does not take. Close the sheet and open it again.',
  UNKNOWN_FOLDER: 'Bowerloom no longer knows that folder. Choose it again.',
  FAILED: 'Bowerloom could not finish this. Nothing more was changed.',
});

export const callRefusal = (error: unknown): Refusal => {
  const code = engineCodeOf(error);
  return { code, message: CALL_WORDS[code] ?? CALL_WORDS.FAILED!, paths: [] };
};

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
  /** Shows a refusal that did not come from a call. */
  show(refusal: Refusal): void;
  /** Drops any plan in flight and the refusal shown. A running write stays. */
  clear(): void;
}

async function settle<T>(call: () => Promise<Answer<T>>): Promise<Answer<T>> {
  try { return await call(); } catch (error) { return { ok: false, refusal: callRefusal(error) }; }
}

export function useCall(): Call {
  const [busy, setBusy] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [refusal, setRefusal] = useState<{ value: Refusal; id: number } | null>(null);
  const counter = useRef(0), writingNow = useRef(false), refusals = useRef(0);
  const fail = useCallback((r: Refusal): void => { refusals.current += 1; setRefusal({ value: r, id: refusals.current }); }, []);

  const plan = useCallback(async <T,>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean> => {
    if (writingNow.current) return false;
    counter.current += 1;
    const mine = counter.current;
    setBusy(words); setRefusal(null);
    const answer = await settle(call);
    if (mine !== counter.current || writingNow.current) return false;
    setBusy(null);
    if (!answer.ok) { fail(answer.refusal); return false; }
    onValue(answer.value);
    return true;
  }, [fail]);

  const write = useCallback(async <T,>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean> => {
    if (writingNow.current) return false;
    writingNow.current = true;
    // A plan still in flight is dropped: the write is about the plan on screen now.
    counter.current += 1;
    setWriting(true); setBusy(words); setRefusal(null);
    const answer = await settle(call);
    writingNow.current = false;
    setWriting(false); setBusy(null);
    if (!answer.ok) { fail(answer.refusal); return false; }
    onValue(answer.value);
    return true;
  }, [fail]);

  const clear = useCallback((): void => {
    if (writingNow.current) return;
    counter.current += 1; setBusy(null); setRefusal(null);
  }, []);

  return { busy, writing, refusal: refusal?.value ?? null, refusalId: refusal?.id ?? 0, plan, write, show: fail, clear };
}

/** The system folder chooser and the new folder list, as one call: a closed chooser is a value of null, not a refusal (U11). */
export async function chooseFolderCall(engine: EngineBridge): Promise<Answer<{ info: FolderInfo; list: readonly FolderInfo[] } | null>> {
  const answer = await engine.chooseFolder();
  if (answer === null) return { ok: true, value: null };
  if (!answer.ok) return answer;
  return { ok: true, value: { info: answer.value, list: await engine.folders() } };
}

/** The folder list as one call, so a failure is a refusal and never an empty list (U11). */
export async function foldersCall(engine: EngineBridge): Promise<Answer<readonly FolderInfo[]>> {
  return { ok: true, value: await engine.folders() };
}
