// A hidden start (--e2e-hidden) shows no native box: each box writes its words to stderr and answers with the choice that keeps data. A start that is not hidden is untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_HIDDEN_FLAG, quietDialogs } from '../main/window-options.js';
import type { QuietDialog } from '../main/window-options.js';
import { DESKTOP } from './support.js';

function fake(): { dialog: QuietDialog; shown: string[]; original: QuietDialog } {
  const shown: string[] = [];
  const dialog: QuietDialog = {
    showErrorBox: () => { shown.push('error'); },
    showMessageBox: async () => { shown.push('question'); return { response: 1, checkboxChecked: false }; },
    showMessageBoxSync: () => { shown.push('sync'); return 1; },
    showOpenDialog: async () => { shown.push('open'); return { canceled: false, filePaths: ['/x'] }; },
    showSaveDialog: async () => { shown.push('save'); return { canceled: false, filePath: '/x' }; },
  };
  return { dialog, shown, original: { ...dialog } };
}

test('a start that is not hidden leaves every box as it is, and says nothing', () => {
  const { dialog, original } = fake();
  const said: string[] = [];
  assert.equal(quietDialogs(dialog, ['--sample'], t => said.push(t)), false);
  assert.deepEqual(dialog, original);
  assert.deepEqual(said, []);
});

test('a hidden start shows no box: each one writes its title and message to stderr', async () => {
  const { dialog, shown } = fake();
  const said: string[] = [];
  assert.equal(quietDialogs(dialog, ['x', E2E_HIDDEN_FLAG], t => said.push(t)), true);
  dialog.showErrorBox('Bowerloom could not start', 'The page did not load.');
  await dialog.showMessageBox({ title: 'Write the new harness', message: 'Write 3 files?', cancelId: 0 } as never);
  dialog.showMessageBoxSync({ title: 'Discard 2 changes?', message: 'Discard 2 changes?', cancelId: 0 } as never);
  await dialog.showOpenDialog({ title: 'Choose a folder' } as never);
  await dialog.showSaveDialog({ title: 'Save the harness file' } as never);
  assert.deepEqual(shown, [], 'no native box was reached');
  assert.equal(said.length, 5);
  assert.equal(said[0], 'Bowerloom box not shown (hidden start, error): Bowerloom could not start: The page did not load.\n');
  assert.match(said[1]!, /question\): Write the new harness: Write 3 files\?\n$/);
  assert.match(said[2]!, /question\): Discard 2 changes\?: Discard 2 changes\?\n$/);
  assert.match(said[3]!, /chooser\): Choose a folder\n$/);
});

test('the answers keep data: the cancel button, never Discard or Write; a chooser is closed with no pick', async () => {
  const { dialog } = fake();
  quietDialogs(dialog, [E2E_HIDDEN_FLAG], () => undefined);
  // The window may be the first argument or the options may stand alone.
  assert.deepEqual(await dialog.showMessageBox({ buttons: ['Cancel', 'Write'], cancelId: 0 } as never), { response: 0, checkboxChecked: false });
  assert.deepEqual(await dialog.showMessageBox({} as never, { buttons: ['Cancel', 'Write'], cancelId: 0 } as never), { response: 0, checkboxChecked: false });
  assert.equal(dialog.showMessageBoxSync({ buttons: ['Keep editing', 'Discard'], defaultId: 0, cancelId: 0 } as never), 0);
  assert.equal(dialog.showMessageBoxSync({} as never), 0, 'no options gives the first button');
  assert.equal(dialog.showMessageBoxSync({ cancelId: -1 } as never), 0, 'a cancel id that is not an index gives the first button');
  assert.deepEqual(await dialog.showOpenDialog({} as never), { canceled: true, filePaths: [] });
  assert.deepEqual(await dialog.showSaveDialog({} as never), { canceled: true, filePath: '' });
});

test('a test that replaces a box after the start still wins, as the e2e helpers do', async () => {
  const { dialog } = fake();
  quietDialogs(dialog, [E2E_HIDDEN_FLAG], () => undefined);
  dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as QuietDialog['showMessageBox'];
  assert.equal((await dialog.showMessageBox()).response, 1);
});

test('main.ts quiets the boxes before any box can show: right after the dock is left, and before the refused-start exit', () => {
  const main = readFileSync(join(DESKTOP, 'main/main.ts'), 'utf8');
  const at = main.indexOf('quietDialogs(dialog, argv');
  assert.ok(at > 0);
  assert.ok(at > main.indexOf('leaveDock(app, argv)'));
  assert.ok(at < main.indexOf('if (launch.refusal !== null)'));
  assert.ok(at < main.indexOf('function startupFailed'), 'the replacement runs when the module starts, before any call of startupFailed');
});
