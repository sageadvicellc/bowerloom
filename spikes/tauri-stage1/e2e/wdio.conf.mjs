// WebdriverIO, through @wdio/tauri-service with the embedded WebDriver server, against the test build of the Tauri spike (the `e2e` feature).
// Gate 3 on macOS. Each spec file starts the app fresh, so each spec makes its own steps. The folder pick is answered by the test-only switch of the shell, from the environment.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineFolder } from '../src/engine-folders.mjs';
import { makeScanFixture } from '../src/fixture.mjs';

const spike = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(spike, 'tauri', 'src-tauri', 'target-e2e', 'release', 'bundle', 'macos', 'Bowerloom Tauri Spike E2E.app', 'Contents', 'MacOS', 'bowerloom-tauri-spike');
let base = '';

export const config = {
  runner: 'local',
  specs: [join(spike, 'e2e', 'specs', '*.spec.mjs')],
  maxInstances: 1,
  services: [['@wdio/tauri-service', { driverProvider: 'embedded', appBinaryPath: APP }]],
  capabilities: [{ browserName: 'tauri', 'tauri:options': { application: APP } }],
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 90000 },
  onPrepare() {
    base = mkdtempSync(join(tmpdir(), 'stage1-e2e-'));
    const home = join(base, 'home');
    mkdirSync(home, { recursive: true });
    const scan = makeScanFixture(join(base, 'scan'), { projects: 3, skills: 3, fileBytes: 500 });
    process.env.SPIKE_E2E_HOME = home;
    process.env.SPIKE_E2E_SCAN = scan.picked;
    process.env.SPIKE_E2E_PICKS = engineFolder(home, 'a');
  },
  async onComplete() {
    // Set only by scripts/e2e-spec-loop.mjs for a run that does not include the close-guard spec, whose Leave step ends the app.
    if (process.env.E2E_LEAVE_CHECK === 'off') {
      if (base !== '') rmSync(base, { recursive: true, force: true });
      return;
    }
    // The close-guard spec presses Leave 4 seconds after it ends. The app must end within 15 seconds of that, and its sidecar with it.
    const running = pattern => spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).stdout.trim() !== '';
    const until = Date.now() + 15000;
    while (running(APP) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 250));
    const leftApp = running(APP);
    const leftCore = running('Bowerloom Tauri Spike E2E.app/Contents/Resources/core.mjs');
    if (base !== '') rmSync(base, { recursive: true, force: true });
    if (leftApp || leftCore) throw new Error(`After Leave, the app is ${leftApp ? 'still running' : 'gone'} and its core is ${leftCore ? 'still running' : 'gone'}.`);
    console.log('Leave closed the app, and its core ended with it.');
  },
};
