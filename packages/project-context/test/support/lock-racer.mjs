// One racer of the lock race in lock.test.mjs (track 11 of beta.3, item 5). Not a test file. It takes the project lock
// of a folder N times, holds it 0 to 3 ms each time, and prints one line per try: `ok` or the refusal code.
// A slot collision line adds the holder verdict the product published on its diagnostics channel, such as
// `PROJECT_LOCK_SLOT_COLLISION silent`.
// Usage: node lock-racer.mjs <project-context index URL> <folder> <N>
import { subscribe } from 'node:diagnostics_channel';
const [index, dir, count] = process.argv.slice(2);
const { withProjectLock, LOCK_SLOT_COLLISION_CHANNEL } = await import(index);
let verdict = 'unknown'; subscribe(LOCK_SLOT_COLLISION_CHANNEL, message => { verdict = message?.holder ?? 'unknown'; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let i = 0; i < Number(count); i++) {
  try { await withProjectLock(dir, new AbortController().signal, () => sleep(Math.floor(Math.random() * 4))); process.stdout.write('ok\n'); }
  catch (error) { const code = error?.code ?? 'ERROR'; process.stdout.write(code === 'PROJECT_LOCK_SLOT_COLLISION' ? `${code} ${verdict}\n` : `${code}\n`); }
  await sleep(Math.floor(Math.random() * 3));
}
