/**
 * Track 11 of beta.3, item 1: a reader that closes early, as `bowerloom use ... | head -1` does, makes the next write to
 * stdout or stderr fail with EPIPE. Node reports that as an 'error' event on the stream, and with no listener the
 * command crashed with a stack and exit code 1. This listener drops the rest of the output instead. The command still
 * finishes its work, so a change it was applying is never cut short, and the process exits with the status the command
 * sets. Any other stream error is thrown, as before.
 */
const GONE = new Set(['EPIPE', 'ERR_STREAM_DESTROYED']);

/** True when `error` says the reader of the stream has gone. */
export const readerGone = (error: unknown): boolean => GONE.has(String((error as NodeJS.ErrnoException | null)?.code));

/** Makes a write to `stream` after its reader closed end the output quietly. */
export function quietBrokenPipe(stream: NodeJS.WritableStream): void {
  stream.on('error', (error: unknown) => { if (!readerGone(error)) throw error; });
}
