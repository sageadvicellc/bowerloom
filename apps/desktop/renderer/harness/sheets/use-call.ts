/**
 * One call of a sheet to Bowerloom at a time, with its busy words and its refusal. A newer call wins: the answer of an older call that arrives late is dropped,
 * so the sheet never shows a plan for choices the person has already changed. A call that the bridge refuses before it runs (a short code) becomes a refusal
 * with plain words too.
 */
import { useCallback, useRef, useState } from 'react';
import type { Answer, EngineBridge, FolderInfo, Refusal } from '../../../shared/engine/types.js';
import { engineCodeOf } from '../real/engine-bridge.js';

const CALL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  NOT_ALLOWED: 'This window may not ask for that.',
  BAD_ARGUMENT: 'The sheet sent something Bowerloom does not take. Close the sheet and open it again.',
  UNKNOWN_FOLDER: 'Bowerloom no longer knows that folder. Choose it again.',
  BUSY: 'Bowerloom is busy with another step. Try again in a moment.',
  FAILED: 'Bowerloom could not finish this. Nothing more was changed.',
});

export const callRefusal = (error: unknown): Refusal => {
  const code = engineCodeOf(error);
  return { code, message: CALL_WORDS[code] ?? CALL_WORDS.FAILED!, paths: [] };
};

export interface Call {
  readonly busy: string | null;
  readonly refusal: Refusal | null;
  /** Runs a call. `onValue` runs only for the newest call and only when it answered with a value. */
  run<T>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean>;
  clear(): void;
}

export function useCall(): Call {
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const counter = useRef(0);
  const run = useCallback(async <T,>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean> => {
    counter.current += 1;
    const mine = counter.current;
    setBusy(words);
    let answer: Answer<T>;
    try { answer = await call(); } catch (error) { answer = { ok: false, refusal: callRefusal(error) }; }
    if (mine !== counter.current) return false;
    setBusy(null);
    if (!answer.ok) { setRefusal(answer.refusal); return false; }
    setRefusal(null);
    onValue(answer.value);
    return true;
  }, []);
  const clear = useCallback((): void => { counter.current += 1; setBusy(null); setRefusal(null); }, []);
  return { busy, refusal, run, clear };
}

/** The system folder chooser as one call: a closed chooser is a value of null, not a refusal. */
export async function chooseFolderCall(engine: EngineBridge): Promise<Answer<FolderInfo | null>> {
  const answer = await engine.chooseFolder();
  return answer ?? { ok: true, value: null };
}
