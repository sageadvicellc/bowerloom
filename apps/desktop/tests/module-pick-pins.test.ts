// The approval of a module's place is a write in the package packages/module-scope, which the writer lists of the app do not scan. These pins hold where it can be called from: `approvePlace` is named in one file of
// the app, main/module-pick.ts; that file is imported only by main/modules-ipc.ts; the chooser that feeds it is main's own dialog, given by main/main.ts; and no renderer, preload or shared file names the package, so the
// window cannot ask for an approval or name a folder. Beside the notes-folder pins of tests/notes-pick-pins.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pickModulePlace } from '../main/module-pick.js';
import { DESKTOP, tempDir } from './support.js';

const ROOTS = ['main', 'shared', 'preload', 'renderer', 'tools', 'extensions', 'e2e'];
function sourcesUnder(dir: string): string[] {
  return readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/.test(e.name))
    .map(e => join(dir, (e as unknown as { parentPath: string }).parentPath.slice(join(DESKTOP, dir).length + 1), e.name));
}
const all = ROOTS.flatMap(sourcesUnder).sort();
const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const naming = (word: RegExp): string[] => all.filter(f => word.test(strip(read(f))));

test('approvePlace is named in main/module-pick.ts only: no renderer, preload, shared or other main file can approve a place', () => {
  assert.deepEqual(naming(/\bapprovePlace\b/).filter(f => !f.startsWith('e2e/') && f !== 'tests/module-pick-pins.test.ts'), ['main/module-pick.ts']);
  for (const f of all.filter(x => !x.startsWith('main/') && !x.startsWith('e2e/'))) assert.doesNotMatch(strip(read(f)), /module-scope|approvePlace|module-pick|readPlaceFile|revokePlace/, f);
  for (const f of all) assert.doesNotMatch(strip(read(f)), /\b(?:import|require)\s*\([^)]*(?:module-scope|module-pick)/, f);
});

test('main/module-pick.ts is imported by main/modules-ipc.ts only, and the package is named by those two files alone', () => {
  assert.deepEqual(naming(/module-pick\.js/), ['main/modules-ipc.ts']);
  assert.deepEqual(naming(/module-scope/), ['main/module-pick.ts', 'main/modules-ipc.ts']);
});

test('modules-ipc.ts calls the pick once, with main\'s chooser, and main.ts gives it the dialog and nothing else that approves', () => {
  const ipc = strip(read('main/modules-ipc.ts'));
  assert.equal((ipc.match(/\bpickModulePlace\(/g) ?? []).length, 1);
  assert.match(ipc, /pickModulePlace\(\{ moduleId: moduleOf\(id\), show: deps\.choosePlace,/, 'the moduleId is checked, and the folder comes from the chooser of main');
  const main = strip(read('main/main.ts'));
  assert.equal((main.match(/\bregisterModulesIpc\(/g) ?? []).length, 1);
  const start = main.indexOf('registerModulesIpc(');
  const block = main.slice(start, main.indexOf('\n    });', start));
  assert.match(block, /choosePlace: async \(\) => \{[\s\S]*?dialog\.showOpenDialog\(/, 'the pick is the dialog of main');
  assert.match(block, /properties: \['openDirectory'\]/, 'a folder, never a file');
  assert.match(block, /result\.canceled \|\| result\.filePaths\[0\] === undefined \? null : result\.filePaths\[0\]/);
  assert.doesNotMatch(block, /approve\b|approvePlace/, 'main.ts hands the module no approver');
});

test('module-pick.ts imports no fs name, calls the approver once with the dialog\'s own answer, and records nothing for a cancel', async t => {
  const text = strip(read('main/module-pick.ts'));
  assert.doesNotMatch(text, /node:fs|node:path|from 'fs'/, 'the module imports no fs name');
  assert.equal((text.match(/\(d\.approve \?\? approvePlace\)\(/g) ?? []).length, 1);
  assert.match(text, /const picked = await d\.show\(\);\s*if \(picked === null\) return \{ status: 'cancelled' \};\s*const result = \(d\.approve \?\? approvePlace\)\(\{ stateRoot: d\.stateRoot, home: d\.home, moduleId: d\.moduleId, picked \}\);/);
  let calls = 0;
  const cancelled = await pickModulePlace({ moduleId: 'memory', show: async () => null, stateRoot: tempDir(t), home: tempDir(t), approve: () => { calls += 1; return { status: 'refused', code: 'FAILED' }; }, tell: () => undefined });
  assert.deepEqual(cancelled, { status: 'cancelled' });
  assert.equal(calls, 0, 'the approver is not called for a cancel');
});

test('an answer of the approver is cut to the fields the page may see, and an unknown refusal is FAILED', async t => {
  const dirty = { status: 'kept', place: { id: 'place-0123456789ab', label: '~/x', approvedAt: 'now', realPath: '/Users/someone/x' } } as never;
  const kept = await pickModulePlace({ moduleId: 'memory', show: async () => '/x', stateRoot: tempDir(t), home: tempDir(t), approve: () => dirty, tell: () => undefined });
  assert.deepEqual(kept, { status: 'kept', place: { id: 'place-0123456789ab', label: '~/x', approvedAt: 'now' } });
  const odd = await pickModulePlace({ moduleId: 'memory', show: async () => '/x', stateRoot: tempDir(t), home: tempDir(t), approve: () => ({ status: 'refused', code: 'SOMETHING_ELSE' } as never), tell: () => undefined });
  assert.deepEqual(odd, { status: 'refused', code: 'FAILED' });
});
