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
  if (state === 'failed') return 'Copy failed. Select the command and copy it.';
  return 'Copy';
}
