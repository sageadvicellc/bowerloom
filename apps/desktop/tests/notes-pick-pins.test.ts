// The approval of a linked notes folder is a write in main that the writer lists do not see (it goes through packages/notes-source). These pins hold where it can be called from: `approveFolder` is named in
// one file of the app, main/notes-pick.ts; that file is imported only by main/main.ts; it calls `approveFolder` once, only with the folder the chooser's own dialog gave, and never for "Start fresh". No
// renderer, preload or shared file names it, so the window cannot ask for an approval. Beside the adoption and projection pins of tests/security.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

// Every folder of the app that holds code: the app, its tools, its extensions and its end-to-end specs.
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

test('approveFolder is named in main/notes-pick.ts only: no renderer, preload, shared or other main file can approve a folder', () => {
  assert.deepEqual(naming(/\bapproveFolder\b/), ['main/notes-pick.ts']);
  for (const f of all.filter(x => !x.startsWith('main/'))) assert.doesNotMatch(strip(read(f)), /notes-source|approveFolder|notes-pick/, f);
  // No dynamic import or require reaches the package from anywhere, so a name cannot be hidden from the checks above.
  for (const f of all) assert.doesNotMatch(strip(read(f)), /\b(?:import|require)\s*\([^)]*(?:notes-source|notes-pick)/, f);
});

/** The text of the call `name(...)`, from its opening parenthesis to the one that closes it, whatever its length. Strings of the call hold no parenthesis. */
function callText(src: string, name: string): string {
  const open = src.indexOf(`${name}(`) + name.length;
  assert.ok(open >= name.length, `${name}( is in the source`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return assert.fail(`${name}( is never closed`);
}

test('main/notes-pick.ts is imported by main/main.ts only, and main.ts calls it once, with the dialog of main', () => {
  assert.deepEqual(naming(/notes-pick\.js/), ['main/main.ts']);
  const main = strip(read('main/main.ts'));
  assert.equal((main.match(/\bpickNotesFolder\(/g) ?? []).length, 1);
  const call = callText(main, 'pickNotesFolder');
  assert.match(call, /show: async \(\) => \{[\s\S]*?dialog\.showOpenDialog\(/, 'the pick is the dialog of main');
  assert.match(call, /result\.canceled \|\| result\.filePaths\[0\] === undefined \? null : result\.filePaths\[0\]/);
  assert.doesNotMatch(call, /approve\b/, 'main.ts hands the module no approver');
});

test('notes-pick.ts calls approveFolder once, with the folder the dialog gave, never for Start fresh, and never with anything else', () => {
  const text = strip(read('main/notes-pick.ts'));
  assert.equal((text.match(/\bapproveFolder\(/g) ?? []).length, 0, 'no direct call: the one call goes through the default of the approver');
  assert.equal((text.match(/\(d\.approve \?\? approveFolder\)\(/g) ?? []).length, 1);
  assert.match(text, /const picked = await d\.show\(\);\s*if \(picked === null \|\| d\.purpose !== 'use'\) return picked;\s*const kept = \(d\.approve \?\? approveFolder\)\(d\.stateRoot, picked\);/);
  assert.doesNotMatch(text, /node:fs/, 'the module imports no fs name');
});
