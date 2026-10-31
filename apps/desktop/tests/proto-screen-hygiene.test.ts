// House rules for the renderer screens and the prototype e2e specs: one hook for an optional session, and no fixed pause in an e2e spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const proto = join(DESKTOP, 'renderer', 'proto');
const sources = (dir: string, ext: RegExp): string[] => readdirSync(dir).filter(f => ext.test(f)).map(f => join(dir, f));

test('there is one hook for a session that may be missing, and every screen uses it', () => {
  assert.equal(existsSync(join(proto, 'setup-session.ts')), false, 'the second copy is gone');
  const own = sources(proto, /\.tsx?$/).filter(f => /export function useOptional\w*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(own.map(f => f.slice(proto.length + 1)), ['harness-session.ts']);
  for (const file of sources(proto, /\.tsx?$/)) assert.doesNotMatch(readFileSync(file, 'utf8'), /setup-session|useOptionalSession/, file);
});

test('the prototype e2e specs wait on a state of the page, never on a fixed number of milliseconds', () => {
  const specs = sources(join(DESKTOP, 'e2e'), /^proto-.*\.(spec\.)?ts$/);
  assert.ok(specs.length >= 7, 'the specs are found');
  for (const file of specs) assert.doesNotMatch(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''), /waitForTimeout\(/, file);
});

test('no assertion in the prototype e2e specs passes with either of two elements', () => {
  for (const file of sources(join(DESKTOP, 'e2e'), /^proto-.*\.spec\.ts$/)) {
    const bad = readFileSync(file, 'utf8').split('\n').filter(line => /expect\([^\n]*\.or\(/.test(line));
    assert.deepEqual(bad, [], `${file}: an assertion on "this or that" passes either way`);
  }
});
