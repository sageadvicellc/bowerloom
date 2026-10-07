import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const realHome = os.homedir();
const { testHome } = await import('./support/isolate-home.js');

test('isolate-home points HOME at a private folder of this process under a kept folder in the real HOME', () => {
  assert.notEqual(testHome, realHome); assert.equal(os.homedir(), testHome);
  assert.ok(testHome.startsWith(path.join(fs.realpathSync(realHome), '.bowerloom-test-homes') + path.sep));
  // Its parent is this file's own kept folder; only this process writes there during the run.
  assert.equal(path.dirname(path.dirname(testHome)), path.join(fs.realpathSync(realHome), '.bowerloom-test-homes'));
  const s = fs.lstatSync(testHome); assert.ok(s.isDirectory() && !s.isSymbolicLink()); assert.equal(s.mode & 0o777, 0o700); assert.equal(s.uid, process.getuid!());
});

test('every test file that makes folders in HOME gives itself its own HOME first', () => {
  // The skills CLI reads records with mtime pins on every parent folder; see tests/support/isolate-home.ts.
  const root = process.cwd(), files: string[] = [];
  for (const dir of ['tests', ...fs.readdirSync(path.join(root, 'packages')).map(p => path.join('packages', p, 'test')), ...fs.readdirSync(path.join(root, 'apps')).map(p => path.join('apps', p, 'test'))]) {
    let names: string[] = []; try { names = fs.readdirSync(path.join(root, dir)); } catch { continue; }
    for (const n of names) if (/\.(?:test\.)?(?:mjs|ts)$/.test(n)) files.push(path.join(dir, n));
  }
  const inHome = /mkdtemp(?:Sync)?\(\s*(?:path\.)?join\(\s*(?:fs\.)?realpathSync\(\s*(?:os\.)?homedir\(\)/;
  const offenders = files.filter(f => { const text = fs.readFileSync(path.join(root, f), 'utf8'); return inHome.test(text) && !text.includes('support/isolate-home.js') && !text.includes("from './v2-fixture.mjs'"); });
  assert.ok(files.length > 50); assert.deepEqual(offenders, []);
});
