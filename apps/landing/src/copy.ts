export type CopyState = 'idle' | 'copied' | 'failed';
type Clipboard = { writeText: (text: string) => Promise<void> | void } | null | undefined;

/** Writes the exact text to the clipboard. It never throws: a refusal, an error, or no clipboard all report `failed`. */
export async function copyText(text: string, clipboard: Clipboard): Promise<Exclude<CopyState, 'idle'>> {
  if (!clipboard) return 'failed';
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** The words for the button and its live region. */
export function copyLabel(state: CopyState): string {
  if (state === 'copied') return 'Copied';
  if (state === 'failed') return 'Copy failed. Select the command.';
  return 'Copy';
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * One copy button's behavior, apart from React so it can be tested without a browser. `press` copies and then shows the result for `ms`, and then goes back to idle.
 * A second press clears the first timer, so only one return to idle is ever pending. After `dispose` a copy that finishes late changes nothing and sets no timer.
 */
export function createCopyController(options: {
  text: string;
  clipboard: () => Clipboard;
  set: (state: CopyState) => void;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  ms?: number;
}) {
  const { text, clipboard, set, setTimer = setTimeout, clearTimer = clearTimeout, ms = 2400 } = options;
  let timer: Timer | null = null;
  let disposed = false;
  const clear = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  return {
    async press() {
      const result = await copyText(text, clipboard());
      if (disposed) return;
      clear();
      set(result);
      timer = setTimer(() => { timer = null; set('idle'); }, ms);
    },
    dispose() { disposed = true; clear(); },
  };
}
