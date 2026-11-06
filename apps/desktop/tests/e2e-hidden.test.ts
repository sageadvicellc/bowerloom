// The test switch --e2e-hidden: it changes whether a window is shown, and nothing else. Nothing here needs Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchOf } from '../main/launch.js';
import { E2E_HIDDEN_FLAG, e2eHidden, hiddenWindowOptions, leaveDock, revealWindow } from '../main/window-options.js';
import { DESKTOP } from './support.js';

test('the switch is read from the arguments only, and no launch plan changes with it', () => {
  assert.equal(E2E_HIDDEN_FLAG, '--e2e-hidden');
  assert.equal(e2eHidden([]), false);
  assert.equal(e2eHidden(['--sample', E2E_HIDDEN_FLAG]), true);
  for (const flags of [[], ['--sample'], ['--home-sample'], ['--home-real'], ['--sample', '--sample-preview-engines']]) assert.deepEqual(launchOf([...flags, E2E_HIDDEN_FLAG]), launchOf(flags), flags.join(' '));
});

test('a hidden start never shows the window and hides the Dock icon; any other start does the old thing', () => {
  let shown = 0, hidden = 0;
  const window = { show: (): void => { shown++; } }, app = { dock: { hide: (): void => { hidden++; } } };
  revealWindow(window, ['--sample']); leaveDock(app, ['--sample']);
  assert.deepEqual({ shown, hidden }, { shown: 1, hidden: 0 });
  revealWindow(window, ['--sample', E2E_HIDDEN_FLAG]); leaveDock(app, [E2E_HIDDEN_FLAG]);
  assert.deepEqual({ shown, hidden }, { shown: 1, hidden: 1 });
  assert.doesNotThrow(() => leaveDock({}, [E2E_HIDDEN_FLAG]), 'a system with no Dock');
  assert.deepEqual(hiddenWindowOptions(), { show: false, paintWhenInitiallyHidden: true });
});

test('main.ts shows through revealWindow, and the switch adds no environment reader', () => {
  const main = readFileSync(join(DESKTOP, 'main', 'main.ts'), 'utf8');
  assert.match(main, /revealWindow\(window, argv\)/);
  assert.doesNotMatch(main.replace(/revealWindow\(window, argv\)/, ''), /window\??\.show\(\)/);
  assert.doesNotMatch(readFileSync(join(DESKTOP, 'main', 'window-options.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), /process\.env/);
});
