/**
 * The two lanes of a sheet's calls to Bowerloom, as plain logic (ruling U1; the hook in use-call.ts draws from it):
 *  - a plan: the newest wins. An older plan's answer that arrives late is dropped. A plan does not start while a write runs.
 *  - a write: its own lane. No plan supersedes it, its answer is always taken, and a second write waits for none: it is refused while one runs.
 * A refusal, or an error the call throws, arrives as plain words.
 */
import type { Answer, Refusal } from '../../../shared/engine/types.js';
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

async function settle<T>(call: () => Promise<Answer<T>>): Promise<Answer<T>> {
  try { return await call(); } catch (error) { return { ok: false, refusal: callRefusal(error) }; }
}

/** What the lanes tell their owner: the busy words, whether a write runs, and the refusal to show (null clears it). */
export interface LaneSinks { busy(words: string | null): void; writing(on: boolean): void; refusal(r: Refusal | null): void }

export class CallLanes {
  private counter = 0;
  private writingNow = false;
  constructor(private readonly sinks: LaneSinks) {}

  get writing(): boolean { return this.writingNow; }

  async plan<T>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean> {
    if (this.writingNow) return false;
    this.counter += 1;
    const mine = this.counter;
    this.sinks.busy(words); this.sinks.refusal(null);
    const answer = await settle(call);
    if (mine !== this.counter || this.writingNow) return false;
    this.sinks.busy(null);
    if (!answer.ok) { this.sinks.refusal(answer.refusal); return false; }
    onValue(answer.value);
    return true;
  }

  async write<T>(words: string, call: () => Promise<Answer<T>>, onValue: (value: T) => void): Promise<boolean> {
    if (this.writingNow) return false;
    this.writingNow = true;
    // A plan still in flight is dropped: the write is about the plan on screen now.
    this.counter += 1;
    this.sinks.writing(true); this.sinks.busy(words); this.sinks.refusal(null);
    const answer = await settle(call);
    this.writingNow = false;
    this.sinks.writing(false); this.sinks.busy(null);
    if (!answer.ok) { this.sinks.refusal(answer.refusal); return false; }
    onValue(answer.value);
    return true;
  }

  /** Drops any plan in flight and the refusal shown. A running write stays. */
  clear(): void {
    if (this.writingNow) return;
    this.counter += 1; this.sinks.busy(null); this.sinks.refusal(null);
  }
}
