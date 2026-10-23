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

/** The stderr line of a guard whose answer could not be written. `guard-main.ts` holds the same words, to load nothing. */
export const GUARD_OUTPUT_LOST_TEXT = 'Bowerloom guard: the hook output could not be written, so the call is blocked.';
/**
 * Track 11 of beta.3, follow-up item 2 (decided: fail closed): the hook form of the read guard. Any error on stdout or
 * stderr, EPIPE among them, means Claude Code may not have its answer, so the process exits 2, which blocks the call.
 * It prints the reason once on stderr, if stderr still takes it, and never a stack. The exit listener keeps exit 2
 * even when the guard sets exit 0 after its write.
 */
export function failClosedOnBrokenPipe(): void {
  let lost = false;
  const broken = (): void => {
    if (lost) return; lost = true; process.exitCode = 2;
    try { process.stderr.write(`${GUARD_OUTPUT_LOST_TEXT}\n`); } catch { /* stderr is gone too */ }
  };
  process.stdout.on('error', broken); process.stderr.on('error', broken);
  process.on('exit', () => { if (lost) process.exitCode = 2; });
}
