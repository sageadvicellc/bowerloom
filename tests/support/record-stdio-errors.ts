// A test preload, `node --import <this file> main.js ...`: records each 'error' event of stdout and stderr, with its
// code, to the file named by TEST_STDIO_LOG, one line each, such as `stdout EPIPE`. Not a test file, and not part of
// the product. It wraps `emit` and adds no listener, so a stream with no listener of its own still crashes as before:
// the record proves that a broken-pipe test really met the broken pipe.
import { appendFileSync } from 'node:fs';

const log = process.env.TEST_STDIO_LOG;
if (!log) throw new Error('record-stdio-errors: TEST_STDIO_LOG is not set');
for (const [name, stream] of [['stdout', process.stdout], ['stderr', process.stderr]] as const) {
  const emit = stream.emit.bind(stream);
  stream.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
    if (event === 'error') appendFileSync(log, `${name} ${String((args[0] as { code?: unknown } | undefined)?.code)}\n`);
    return emit(event, ...args);
  }) as typeof stream.emit;
}
