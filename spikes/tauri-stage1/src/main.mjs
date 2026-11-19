// The Electron main process of the spike. It has no window and no dock icon. It runs one scenario (--scenario=NAME), writes its result as JSON to --out=FILE, and quits.
// The scenarios that end the main process in a chosen way (hold, quit, crash) write the process ids first and then wait for the test.
// This file is spike code. It is not the shipped main process, and nothing of the shipped app imports it.
import { app, utilityProcess } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCoreHost } from './host.mjs';
import { HOLDERS, SCENARIOS, reportPids } from './scenarios.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const scenario = arg('scenario');
const out = arg('out');
const options = JSON.parse(arg('options') ?? '{}');
const userData = arg('user-data');

if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
if (userData !== undefined) { mkdirSync(userData, { recursive: true }); app.setPath('userData', userData); }

const hosts = [];
const events = [];

function makeHost(extra = {}) {
  const home = options.home ?? '';
  const host = createCoreHost({
    fork: (path, args, opts) => utilityProcess.fork(path, args, opts),
    childPath: join(import.meta.dirname, 'child.mjs'),
    env: { ...process.env, SPIKE_HOME: home, SPIKE_STATE: home === '' ? '' : join(home, '.local', 'state', 'bowerloom') },
    onEvent: message => events.push(message.seq),
    onLog: text => process.stderr.write(`host: ${text}\n`),
    ...extra,
  });
  hosts.push(host);
  return host.start().then(() => host);
}

let stopping = false;
if (options.noStop !== true) {
  app.on('before-quit', event => {
    if (stopping || hosts.length === 0) return;
    event.preventDefault();
    stopping = true;
    Promise.all(hosts.map(h => h.stop())).finally(() => app.quit());
  });
}

const write = value => writeFileSync(out, JSON.stringify(value));

app.whenReady().then(async () => {
  try {
    if (HOLDERS.has(scenario)) {
      const host = await makeHost();
      reportPids({ host, out });
      if (scenario === 'quit') setTimeout(() => app.quit(), 300);
      if (scenario === 'crash') setTimeout(() => process.crash(), 300);
      return;
    }
    const run = SCENARIOS[scenario];
    if (run === undefined) throw new Error(`unknown scenario ${scenario}`);
    const host = await makeHost();
    const result = await run({ host, makeHost, options, events });
    write(result);
  } catch (error) {
    write({ error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) });
  }
  app.quit();
});
