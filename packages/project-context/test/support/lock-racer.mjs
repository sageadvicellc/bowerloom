// One racer of the lock race in lock.test.mjs (track 11 of beta.3, item 5). Not a test file. It takes the project lock
// of a folder N times, holds it 0 to 3 ms each time, and prints one line per try: `ok` or the refusal code.
// Usage: node lock-racer.mjs <project-context index URL> <folder> <N>
const [index, dir, count] = process.argv.slice(2);
const { withProjectLock } = await import(index);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let i = 0; i < Number(count); i++) {
  try { await withProjectLock(dir, new AbortController().signal, () => sleep(Math.floor(Math.random() * 4))); process.stdout.write('ok\n'); }
  catch (error) { process.stdout.write(`${error?.code ?? 'ERROR'}\n`); }
  await sleep(Math.floor(Math.random() * 3));
}
